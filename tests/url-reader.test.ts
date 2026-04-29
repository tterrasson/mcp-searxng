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
      const fetchMock = mock(async (_url: string, _init?: RequestInit) => new Response(html, { status: 200 }));
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

  test("strips nav and footer when Readability extracts article content", async () => {
    await withCleanEnv(async () => {
      const html = `<!DOCTYPE html><html><head><title>Article</title></head><body>
        <nav>Home | About | Contact</nav>
        <article>
          <h1>Main Article</h1>
          <p>This is the article body.</p>
        </article>
        <footer>Copyright 2026</footer>
      </body></html>`;
      globalThis.fetch = mock(async () => new Response(html, { status: 200 })) as any;

      const markdown = await fetchAndConvertToMarkdown(
        mcpServerStub(),
        "https://example.com/article",
        1000,
      );

      expect(markdown).toContain("Main Article");
      expect(markdown).toContain("article body");
      expect(markdown).not.toContain("Home | About | Contact");
      expect(markdown).not.toContain("Copyright 2026");
    });
  });

  test("strips image URLs, keeps alt text, and removes media elements", async () => {
    await withCleanEnv(async () => {
      const html = `<p>Intro</p>
        <img src="https://example.com/logo.png" alt="company logo">
        <img src="https://example.com/deco.png">
        <video><source src="promo.mp4">Your browser does not support video.</video>
        <audio src="podcast.mp3">Your browser does not support audio.</audio>`;
      globalThis.fetch = mock(async () => new Response(html, { status: 200 })) as any;

      const markdown = await fetchAndConvertToMarkdown(
        mcpServerStub(),
        "https://example.com/page",
        1000,
      );

      expect(markdown).toContain("company logo");
      expect(markdown).not.toContain("example.com/logo.png");
      expect(markdown).not.toContain("example.com/deco.png");
      expect(markdown).not.toContain("Your browser does not support");
      expect(markdown).not.toContain("promo.mp4");
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

  test("blocks private hostnames, IPv4 ranges, and IPv6 ranges in hardened mode", async () => {
    await withCleanEnv(async () => {
      process.env.MCP_HTTP_HARDEN = "true";
      const fetchMock = mock(async () => new Response("<h1>Never fetched</h1>"));
      globalThis.fetch = fetchMock as any;

      for (const url of [
        "http://service.localhost/status",
        "http://10.0.0.10/status",
        "http://172.20.0.10/status",
        "http://192.168.1.10/status",
        "http://169.254.1.10/status",
        "http://[::1]/status",
        "http://[::]/status",
        "http://[fd00::1]/status",
        "http://[fe80::1]/status",
        "http://[::ffff:127.0.0.1]/status",
      ]) {
        await expect(fetchAndConvertToMarkdown(mcpServerStub(), url)).rejects.toThrow(
          "URL blocked by security policy"
        );
      }

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  test("allows private URLs when the explicit security override is enabled", async () => {
    await withCleanEnv(async () => {
      process.env.MCP_HTTP_HARDEN = "true";
      process.env.MCP_HTTP_ALLOW_PRIVATE_URLS = "true";

      const fetchMock = mock(async () => new Response("<h1>Local Status</h1>", { status: 200 }));
      globalThis.fetch = fetchMock as any;

      const markdown = await fetchAndConvertToMarkdown(
        mcpServerStub(),
        "http://localhost/status",
      );

      expect(markdown).toBe("# Local Status");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  test("rejects malformed URLs before performing network I/O", async () => {
    await withCleanEnv(async () => {
      const fetchMock = mock(async () => new Response("<h1>Never fetched</h1>"));
      globalThis.fetch = fetchMock as any;

      await expect(fetchAndConvertToMarkdown(mcpServerStub(), "not a url")).rejects.toThrow(
        'Invalid URL "not a url"'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  test("rejects binary content types", async () => {
    await withCleanEnv(async () => {
      globalThis.fetch = mock(async () =>
        new Response("binary", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        })
      ) as any;

      await expect(
        fetchAndConvertToMarkdown(mcpServerStub(), "https://example.com/file.pdf")
      ).rejects.toThrow("binary or non-text content (application/pdf)");
    });
  });

  test("passes configured proxy to fetch and wraps network errors", async () => {
    await withCleanEnv(async () => {
      process.env.URL_READER_HTTPS_PROXY = "http://reader-proxy:8080";

      const fetchMock = mock(async (_url: string, _init?: RequestInit) =>
        new Response("<h1>Proxied</h1>", { status: 200 })
      );
      globalThis.fetch = fetchMock as any;

      await expect(
        fetchAndConvertToMarkdown(mcpServerStub(), "https://example.com/proxied")
      ).resolves.toBe("# Proxied");

      const [, requestOptions] = fetchMock.mock.calls[0];
      expect((requestOptions as any).proxy).toBe("http://reader-proxy:8080");
    });

    await withCleanEnv(async () => {
      globalThis.fetch = mock(async () => {
        throw new Error("fetch failed");
      }) as any;

      await expect(
        fetchAndConvertToMarkdown(mcpServerStub(), "https://example.com/down")
      ).rejects.toThrow("Check if the website URL is accessible");
    });
  });

  test("reports HTTP status failures from the target website", async () => {
    await withCleanEnv(async () => {
      globalThis.fetch = mock(async () =>
        new Response("missing", { status: 404, statusText: "Not Found" })
      ) as any;

      await expect(
        fetchAndConvertToMarkdown(mcpServerStub(), "https://example.com/missing")
      ).rejects.toThrow("Website Error (404): Page not found");
    });
  });

  test("reports HTTP status failures even when the error body cannot be read", async () => {
    await withCleanEnv(async () => {
      globalThis.fetch = mock(async () => ({
        ok: false,
        status: 500,
        statusText: "Server Error",
        headers: new Headers(),
        text: mock(async () => {
          throw new Error("body unavailable");
        }),
      })) as any;

      await expect(
        fetchAndConvertToMarkdown(mcpServerStub(), "https://example.com/broken")
      ).rejects.toThrow("Internal server error");
    });
  });

  test("reports empty and unreadable response bodies as content errors", async () => {
    await withCleanEnv(async () => {
      globalThis.fetch = mock(async () => new Response("   ", { status: 200 })) as any;

      await expect(
        fetchAndConvertToMarkdown(mcpServerStub(), "https://example.com/empty")
      ).rejects.toThrow("Website returned empty content");
    });

    await withCleanEnv(async () => {
      globalThis.fetch = mock(async () => ({
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        text: mock(async () => {
          throw new Error("stream closed");
        }),
      })) as any;

      await expect(
        fetchAndConvertToMarkdown(mcpServerStub(), "https://example.com/unreadable")
      ).rejects.toThrow("Failed to read website content: stream closed");
    });
  });

  test("returns clear pagination messages for missing sections and empty heading lists", async () => {
    await withCleanEnv(async () => {
      globalThis.fetch = mock(async () =>
        new Response("<p>Body without headings</p>", { status: 200 })
      ) as any;

      await expect(fetchAndConvertToMarkdown(
        mcpServerStub(),
        "https://example.com/no-heading",
        1000,
        { readHeadings: true }
      )).resolves.toBe("No headings found in the content.");
    });

    await withCleanEnv(async () => {
      globalThis.fetch = mock(async () =>
        new Response("<h1>Intro</h1><p>Only intro content.</p>", { status: 200 })
      ) as any;

      await expect(fetchAndConvertToMarkdown(
        mcpServerStub(),
        "https://example.com/article",
        1000,
        { section: "Missing Section" }
      )).resolves.toBe('Section "Missing Section" not found in the content.');
    });
  });

  test("returns an empty page when character pagination starts past the content", async () => {
    await withCleanEnv(async () => {
      globalThis.fetch = mock(async () =>
        new Response("<h1>Short</h1><p>Body.</p>", { status: 200 })
      ) as any;

      await expect(fetchAndConvertToMarkdown(
        mcpServerStub(),
        "https://example.com/short",
        1000,
        { startChar: 10_000 }
      )).resolves.toBe("");
    });
  });

  test("clamps negative pagination starts to the beginning of content", async () => {
    await withCleanEnv(async () => {
      globalThis.fetch = mock(async () =>
        new Response("<h1>Short</h1><p>Body.</p>", { status: 200 })
      ) as any;

      await expect(fetchAndConvertToMarkdown(
        mcpServerStub(),
        "https://example.com/short",
        1000,
        { startChar: -20, maxLength: 7 }
      )).resolves.toBe("# Short");
    });
  });

  test("returns a warning when conversion leaves no readable markdown", async () => {
    await withCleanEnv(async () => {
      globalThis.fetch = mock(async () =>
        new Response("<video><source src=\"clip.mp4\"></video>", { status: 200 })
      ) as any;

      await expect(
        fetchAndConvertToMarkdown(mcpServerStub(), "https://example.com/video-only")
      ).resolves.toContain("Page fetched but appears empty after conversion");
    });
  });
});
