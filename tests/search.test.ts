import { afterEach, describe, expect, mock, test } from "bun:test";
import { performWebSearch, formatSearchResults } from "../src/search.js";
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

describe("formatSearchResults", () => {
  test("returns fallback message for empty results", () => {
    expect(formatSearchResults([])).toBe("No results found.");
  });

  test("formats a single result with all fields", () => {
    const output = formatSearchResults([
      { title: "Bun Runtime", url: "https://bun.sh", score: 0.95, content: "Fast JS runtime." },
    ]);
    expect(output).toBe(
      "1. Bun Runtime\n   URL: https://bun.sh\n   Score: 0.95\n   Fast JS runtime."
    );
  });

  test("formats multiple results separated by blank lines", () => {
    const output = formatSearchResults([
      { title: "First", url: "https://first.com", score: 0.9, content: "First result." },
      { title: "Second", url: "https://second.com", score: 0.7, content: "Second result." },
    ]);
    const parts = output.split("\n\n");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toStartWith("1. First");
    expect(parts[1]).toStartWith("2. Second");
  });

  test("handles results with empty content gracefully", () => {
    const output = formatSearchResults([
      { title: "No Snippet", url: "https://example.com", score: 0.5, content: "" },
    ]);
    expect(output).toBe("1. No Snippet\n   URL: https://example.com\n   Score: 0.5\n   ");
  });
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

      const fetchMock = mock(async (_url: string, _init?: RequestInit) => Response.json({ results: [] }));
      globalThis.fetch = fetchMock as any;

      await performWebSearch(mcpServerStub(), "query", 1, "week", "all", 9);

      const [requestUrl] = fetchMock.mock.calls[0];
      const url = new URL(requestUrl as string);

      expect(url.searchParams.has("time_range")).toBe(false);
      expect(url.searchParams.has("language")).toBe(false);
      expect(url.searchParams.has("safesearch")).toBe(false);
    });
  });

  test("keeps safesearch zero and applies configured search proxy", async () => {
    await withCleanEnv(async () => {
      process.env.SEARXNG_URL = "https://searx.example/";
      process.env.SEARCH_HTTPS_PROXY = "http://search-proxy:8080";

      const fetchMock = mock(async (_url: string, _init?: RequestInit) => Response.json({ results: [] }));
      globalThis.fetch = fetchMock as any;

      await performWebSearch(mcpServerStub(), "query", 1, undefined, "all", 0);

      const [requestUrl, requestOptions] = fetchMock.mock.calls[0];
      const url = new URL(requestUrl as string);

      expect(url.searchParams.get("safesearch")).toBe("0");
      expect((requestOptions as any).proxy).toBe("http://search-proxy:8080");
    });
  });

  test("fails before fetch when required environment is invalid", async () => {
    await withCleanEnv(async () => {
      const fetchMock = mock(async () => Response.json({ results: [] }));
      globalThis.fetch = fetchMock as any;

      await expect(performWebSearch(mcpServerStub(), "query")).rejects.toThrow(
        "SEARXNG_URL not set"
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  test("reports SearXNG HTTP errors with endpoint-specific reasons", async () => {
    await withCleanEnv(async () => {
      process.env.SEARXNG_URL = "https://searx.example";
      globalThis.fetch = mock(async () =>
        new Response("blocked", { status: 403, statusText: "Forbidden" })
      ) as any;

      await expect(performWebSearch(mcpServerStub(), "query")).rejects.toThrow(
        "Authentication required or IP blocked"
      );
    });
  });

  test("still reports HTTP errors when the response body cannot be read", async () => {
    await withCleanEnv(async () => {
      process.env.SEARXNG_URL = "https://searx.example";
      globalThis.fetch = mock(async () => ({
        ok: false,
        status: 500,
        statusText: "Server Error",
        text: mock(async () => {
          throw new Error("body unavailable");
        }),
      })) as any;

      await expect(performWebSearch(mcpServerStub(), "query")).rejects.toThrow(
        "Internal server error"
      );
    });
  });

  test("reports invalid JSON with a response preview", async () => {
    await withCleanEnv(async () => {
      process.env.SEARXNG_URL = "https://searx.example";
      globalThis.fetch = mock(async () => ({
        ok: true,
        json: mock(async () => {
          throw new SyntaxError("Unexpected token <");
        }),
        text: mock(async () => "<html>not json</html>\nsecond line"),
      })) as any;

      await expect(performWebSearch(mcpServerStub(), "query")).rejects.toThrow(
        'Invalid JSON format. Response: "<html>not json</html> second line..."'
      );
    });
  });

  test("rejects malformed SearXNG payloads without a results array", async () => {
    await withCleanEnv(async () => {
      process.env.SEARXNG_URL = "https://searx.example";
      globalThis.fetch = mock(async () => Response.json({ answers: [] })) as any;

      await expect(performWebSearch(mcpServerStub(), "query")).rejects.toThrow(
        "Missing results array"
      );
    });
  });

  test("wraps network failures with SearXNG configuration guidance", async () => {
    await withCleanEnv(async () => {
      process.env.SEARXNG_URL = "https://searx.example";
      globalThis.fetch = mock(async () => {
        throw new Error("fetch failed");
      }) as any;

      await expect(performWebSearch(mcpServerStub(), "query")).rejects.toThrow(
        "Check if the SEARXNG_URL is correct"
      );
    });
  });
});
