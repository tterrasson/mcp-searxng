import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchAndConvertToMarkdown } from "../src/url-reader.js";
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

describe("fetchAndConvertToMarkdown", () => {
  test("converts HTML and applies section and character pagination", async () => {
    await withCleanEnv(async () => {
      process.env.URL_READER_USER_AGENT = "reader-test-agent";

      const html = `
        <h1>Intro</h1>
        <p>Ignore this paragraph.</p>
        <h2>Target Section</h2>
        <p>First useful paragraph.</p>
        <p>Second useful paragraph.</p>
        <h2>Next Section</h2>
        <p>Ignore this too.</p>
      `;
      const fetchMock = mock(async () => new Response(html, { status: 200 }));
      globalThis.fetch = fetchMock as any;

      const markdown = await fetchAndConvertToMarkdown(
        mcpServerStub(),
        "https://example.com/article",
        1000,
        { section: "Target Section", maxLength: 80 }
      );

      expect(markdown).toContain("Target Section");
      expect(markdown).toContain("First useful paragraph");
      expect(markdown).not.toContain("Next Section");
      expect(markdown.length).toBeLessThanOrEqual(80);

      const [, requestOptions] = fetchMock.mock.calls[0];
      expect((requestOptions as RequestInit).headers).toEqual({
        "User-Agent": "reader-test-agent",
      });
    });
  });

  test("can return only document headings", async () => {
    await withCleanEnv(async () => {
      const html = "<h1>Title</h1><p>Body</p><h2>Details</h2>";
      globalThis.fetch = mock(async () => new Response(html, { status: 200 })) as any;

      const markdown = await fetchAndConvertToMarkdown(
        mcpServerStub(),
        "https://example.com/page",
        1000,
        { readHeadings: true }
      );

      expect(markdown).toBe("# Title\n## Details");
    });
  });

  test("blocks private URLs when hardened mode is enabled", async () => {
    await withCleanEnv(async () => {
      process.env.MCP_HTTP_HARDEN = "true";

      await expect(
        fetchAndConvertToMarkdown(mcpServerStub(), "http://127.0.0.1/admin")
      ).rejects.toThrow("URL blocked by security policy");
    });
  });
});
