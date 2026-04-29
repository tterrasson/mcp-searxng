import { describe, expect, test } from "bun:test";
import { ProxyType, resolveProxyUrl } from "../src/proxy.js";
import { withCleanEnv } from "./env.js";

describe("proxy resolution", () => {
  test("prefers search-specific proxy over global proxy", () => {
    withCleanEnv(() => {
      process.env.HTTP_PROXY = "http://global-proxy:8080";
      process.env.SEARCH_HTTP_PROXY = "http://search-proxy:8080";

      expect(resolveProxyUrl("http://searx.example/search", ProxyType.SEARCH)).toBe(
        "http://search-proxy:8080"
      );
    });
  });

  test("uses URL-reader HTTPS proxy for HTTPS target URLs", () => {
    withCleanEnv(() => {
      process.env.URL_READER_HTTP_PROXY = "http://reader-http-proxy:8080";
      process.env.URL_READER_HTTPS_PROXY = "http://reader-https-proxy:8443";

      expect(resolveProxyUrl("https://example.com/article", ProxyType.URL_READER)).toBe(
        "http://reader-https-proxy:8443"
      );
    });
  });

  test("honors NO_PROXY exact and subdomain bypass rules", () => {
    withCleanEnv(() => {
      process.env.HTTP_PROXY = "http://proxy:8080";
      process.env.NO_PROXY = "localhost,example.com";

      expect(resolveProxyUrl("http://localhost:8080", ProxyType.SEARCH)).toBeUndefined();
      expect(resolveProxyUrl("https://api.example.com", ProxyType.URL_READER)).toBeUndefined();
      expect(resolveProxyUrl("https://elsewhere.test", ProxyType.URL_READER)).toBe("http://proxy:8080");
    });
  });

  test("rejects unsupported proxy protocols", () => {
    withCleanEnv(() => {
      process.env.HTTP_PROXY = "socks5://proxy:1080";

      expect(() => resolveProxyUrl("http://example.com", ProxyType.SEARCH)).toThrow(
        "Unsupported proxy protocol"
      );
    });
  });
});
