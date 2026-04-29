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

  test("normalizes proxy auth and falls back by target protocol", () => {
    withCleanEnv(() => {
      process.env.HTTP_PROXY = "http://user:pass@proxy:8080/path";
      process.env.HTTPS_PROXY = "https://secure-proxy:8443";

      expect(resolveProxyUrl("http://example.com", ProxyType.SEARCH)).toBe(
        "http://user:pass@proxy:8080"
      );
      expect(resolveProxyUrl("https://example.com", ProxyType.SEARCH)).toBe(
        "https://secure-proxy:8443"
      );
    });
  });

  test("supports wildcard and leading-dot NO_PROXY rules", () => {
    withCleanEnv(() => {
      process.env.HTTP_PROXY = "http://proxy:8080";
      process.env.NO_PROXY = "*";
      expect(resolveProxyUrl("http://anything.example", ProxyType.SEARCH)).toBeUndefined();
    });

    withCleanEnv(() => {
      process.env.HTTP_PROXY = "http://proxy:8080";
      process.env.NO_PROXY = ".example.com";

      expect(resolveProxyUrl("https://api.example.com", ProxyType.URL_READER)).toBeUndefined();
      expect(resolveProxyUrl("https://example.com", ProxyType.URL_READER)).toBe("http://proxy:8080");
    });
  });

  test("does not bypass proxy for invalid target URLs", () => {
    withCleanEnv(() => {
      process.env.HTTP_PROXY = "http://proxy:8080";
      process.env.NO_PROXY = "example.com";

      expect(resolveProxyUrl("not a url", ProxyType.SEARCH)).toBe("http://proxy:8080");
    });
  });

  test("resolves global proxies when no proxy type is supplied", () => {
    withCleanEnv(() => {
      process.env.HTTP_PROXY = "http://global-http:8080";
      process.env.HTTPS_PROXY = "https://global-https:8443";

      expect(resolveProxyUrl("http://example.com")).toBe("http://global-http:8080");
      expect(resolveProxyUrl("https://example.com")).toBe("https://global-https:8443");
    });
  });

  test("uses lowercase type-specific proxy environment variables", () => {
    withCleanEnv(() => {
      process.env.search_https_proxy = "http://lower-search-proxy:8080";
      process.env.url_reader_http_proxy = "http://lower-reader-proxy:8080";

      expect(resolveProxyUrl("https://searx.example", ProxyType.SEARCH)).toBe(
        "http://lower-search-proxy:8080"
      );
      expect(resolveProxyUrl("http://example.com", ProxyType.URL_READER)).toBe(
        "http://lower-reader-proxy:8080"
      );
    });
  });

  test("normalizes proxy URLs with username-only credentials", () => {
    withCleanEnv(() => {
      process.env.HTTP_PROXY = "http://token@proxy:8080";

      expect(resolveProxyUrl("http://example.com", ProxyType.SEARCH)).toBe(
        "http://token@proxy:8080"
      );
    });
  });

  test("rejects malformed proxy URLs", () => {
    withCleanEnv(() => {
      process.env.HTTP_PROXY = "not a proxy url";

      expect(() => resolveProxyUrl("http://example.com", ProxyType.SEARCH)).toThrow(
        "Invalid proxy URL"
      );
    });
  });
});
