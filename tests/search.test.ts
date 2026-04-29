import { afterEach, describe, expect, mock, test } from "bun:test";
import { performWebSearch } from "../src/search.js";
import { withCleanEnv } from "./env.js";

const originalFetch = globalThis.fetch;

function mcpServerStub() {
  return {
    sendLoggingMessage: mock(() => Promise.resolve()),
  } as any;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("performWebSearch", () => {
  test("builds the SearXNG request and normalizes results", async () => {
    await withCleanEnv(async () => {
      process.env.SEARXNG_URL = "https://searx.example";
      process.env.AUTH_USERNAME = "user";
      process.env.AUTH_PASSWORD = "pass";
      process.env.USER_AGENT = "mcp-searxng-test";

      const fetchMock = mock(async (_url: string, _init?: RequestInit) =>
        Response.json({
          results: [
            { title: "Result", content: "Snippet", url: "https://example.com", score: 42 },
            { title: "Untitled" },
          ],
        })
      );
      globalThis.fetch = fetchMock as any;

      const results = await performWebSearch(
        mcpServerStub(),
        "bun runtime",
        2,
        "month",
        "fr",
        2
      );

      expect(results).toEqual([
        { title: "Result", content: "Snippet", url: "https://example.com", score: 42 },
        { title: "Untitled", content: "", url: "", score: 0 },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [requestUrl, requestOptions] = fetchMock.mock.calls[0];
      const url = new URL(requestUrl as string);

      expect(url.origin).toBe("https://searx.example");
      expect(url.pathname).toBe("/search");
      expect(url.searchParams.get("q")).toBe("bun runtime");
      expect(url.searchParams.get("format")).toBe("json");
      expect(url.searchParams.get("pageno")).toBe("2");
      expect(url.searchParams.get("time_range")).toBe("month");
      expect(url.searchParams.get("language")).toBe("fr");
      expect(url.searchParams.get("safesearch")).toBe("2");
      expect((requestOptions as RequestInit).headers).toEqual({
        Authorization: "Basic dXNlcjpwYXNz",
        "User-Agent": "mcp-searxng-test",
      });
    });
  });

  test("ignores invalid optional search filters", async () => {
    await withCleanEnv(async () => {
      process.env.SEARXNG_URL = "https://searx.example/";

      const fetchMock = mock(async (_url: string) => Response.json({ results: [] }));
      globalThis.fetch = fetchMock as any;

      await performWebSearch(mcpServerStub(), "query", 1, "week", "all", 9);

      const [requestUrl] = fetchMock.mock.calls[0];
      const url = new URL(requestUrl as string);

      expect(url.searchParams.has("time_range")).toBe(false);
      expect(url.searchParams.has("language")).toBe(false);
      expect(url.searchParams.has("safesearch")).toBe(false);
    });
  });
});
