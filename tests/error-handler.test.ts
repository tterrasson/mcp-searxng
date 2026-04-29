import { describe, expect, test } from "bun:test";
import {
  MCPSearXNGError,
  createConfigurationError,
  createContentError,
  createDataError,
  createEmptyContentWarning,
  createJSONError,
  createNetworkError,
  createNoResultsMessage,
  createServerError,
  createTimeoutError,
  createUnexpectedError,
  createURLFormatError,
  validateEnvironment,
} from "../src/error-handler.js";
import { withCleanEnv } from "./env.js";

describe("error handling helpers", () => {
  test("creates user-facing network errors with actionable causes", () => {
    expect(createNetworkError({ code: "ECONNREFUSED" }, { url: "https://example.com" }).message)
      .toBe("🌐 Connection Error: website is not responding (https://example.com)");

    expect(createNetworkError({ code: "ENOTFOUND" }, { url: "https://missing.example/path" }).message)
      .toBe('🌐 DNS Error: Cannot resolve hostname "missing.example"');

    expect(createNetworkError({ code: "EAI_NONAME" }, {}).message)
      .toBe('🌐 DNS Error: Cannot resolve hostname "unknown"');

    expect(createNetworkError({ code: "ETIMEDOUT" }, { searxngUrl: "https://search.example" }).message)
      .toBe("🌐 Timeout Error: SearXNG server is too slow to respond");
  });

  test("detects TLS errors from codes, causes, and messages", () => {
    expect(createNetworkError(
      { message: "fetch failed", cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } },
      { url: "https://example.com" },
    ).message).toContain("SSL/TLS Error");

    expect(createNetworkError(
      { message: "TLS handshake failed" },
      { searxngUrl: "https://search.example" },
    ).message).toContain("Certificate verification failed for SearXNG server");
  });

  test("adds target-specific guidance for generic fetch failures", () => {
    expect(createNetworkError({ message: "fetch failed" }, { searxngUrl: "https://search.example" }).message)
      .toContain("Check if the SEARXNG_URL is correct");

    expect(createNetworkError({ message: "Connection failed" }, { url: "https://example.com" }).message)
      .toContain("Check if the website URL is accessible");

    expect(createNetworkError({ message: "socket hang up" }, { url: "https://example.com" }).message)
      .toBe("🌐 Network Error: socket hang up");
  });

  test("formats server errors by status and target", () => {
    expect(createServerError(403, "Forbidden", "", { searxngUrl: "https://search.example" }).message)
      .toBe("🚫 SearXNG server Error (403): Authentication required or IP blocked");
    expect(createServerError(403, "Forbidden", "", { url: "https://example.com" }).message)
      .toBe("🚫 Website Error (403): Access blocked (bot detection or geo-restriction)");
    expect(createServerError(404, "Not Found", "", { searxngUrl: "https://search.example" }).message)
      .toBe("🚫 SearXNG server Error (404): Search endpoint not found");
    expect(createServerError(429, "Too Many Requests", "", {}).message)
      .toBe("🚫 Website Error (429): Rate limit exceeded");
    expect(createServerError(500, "Server Error", "", {}).message)
      .toBe("🚫 Website Error (500): Internal server error");
    expect(createServerError(418, "I'm a teapot", "", {}).message)
      .toBe("🚫 Website Error (418): I'm a teapot");
  });

  test("formats parser, data, URL, content, timeout, and unexpected errors", () => {
    expect(createConfigurationError("missing value")).toBeInstanceOf(MCPSearXNGError);
    expect(createConfigurationError("missing value").message)
      .toBe("🔧 Configuration Error: missing value");

    expect(createJSONError("not json\nsecond line", {}).message)
      .toBe('🔍 SearXNG Response Error: Invalid JSON format. Response: "not json second line..."');
    expect(createDataError({}, {}).message)
      .toBe("🔍 SearXNG Data Error: Missing results array in response");
    expect(createNoResultsMessage("rare query"))
      .toContain('No results found for "rare query"');
    expect(createURLFormatError("not-a-url").message)
      .toBe('🔧 URL Format Error: Invalid URL "not-a-url"');
    expect(createContentError("Binary response", "https://example.com/file").message)
      .toBe("📄 Content Error: Binary response (https://example.com/file)");
    expect(createTimeoutError(250, "https://example.com/path").message)
      .toBe("⏱️ Timeout Error: example.com took longer than 250ms to respond");
    expect(createEmptyContentWarning("https://example.com", 100, "<html></html>"))
      .toContain("May contain only media or require JavaScript");
    expect(createUnexpectedError("plain failure", {}).message)
      .toBe("❓ Unexpected Error: plain failure");
  });

  test("validates required SearXNG and auth environment configuration", () => {
    withCleanEnv(() => {
      expect(validateEnvironment()).toContain("SEARXNG_URL not set");
    });

    withCleanEnv(() => {
      process.env.SEARXNG_URL = "ftp://search.example";
      expect(validateEnvironment()).toContain("SEARXNG_URL invalid protocol: ftp:");
    });

    withCleanEnv(() => {
      process.env.SEARXNG_URL = "not a url";
      expect(validateEnvironment()).toContain("SEARXNG_URL invalid format: not a url");
    });

    withCleanEnv(() => {
      process.env.SEARXNG_URL = "https://search.example";
      process.env.AUTH_USERNAME = "user";
      expect(validateEnvironment()).toContain("AUTH_USERNAME set but AUTH_PASSWORD missing");
    });

    withCleanEnv(() => {
      process.env.SEARXNG_URL = "https://search.example";
      process.env.AUTH_PASSWORD = "pass";
      expect(validateEnvironment()).toContain("AUTH_PASSWORD set but AUTH_USERNAME missing");
    });

    withCleanEnv(() => {
      process.env.SEARXNG_URL = "https://search.example";
      process.env.AUTH_USERNAME = "user";
      process.env.AUTH_PASSWORD = "pass";
      expect(validateEnvironment()).toBeNull();
    });
  });
});
