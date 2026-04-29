import { describe, expect, test } from "bun:test";
import {
  getHttpSecurityConfig,
  isOriginAllowed,
  isRequestAuthorized,
  validateHttpSecurityConfig,
} from "../src/http-security.js";
import { withCleanEnv } from "./env.js";

describe("http security config", () => {
  test("keeps permissive defaults when hardening is disabled", () => {
    withCleanEnv(() => {
      const config = getHttpSecurityConfig();

      expect(config.harden).toBe(false);
      expect(config.requireAuth).toBe(false);
      expect(config.restrictOrigins).toBe(false);
      expect(config.allowedHosts).toEqual(["127.0.0.1", "localhost"]);
      expect(isRequestAuthorized(undefined, config)).toBe(true);
      expect(isOriginAllowed("https://client.example", config)).toBe(true);
    });
  });

  test("parses hardened mode auth, origins and hosts from environment", () => {
    withCleanEnv(() => {
      process.env.MCP_HTTP_HARDEN = "true";
      process.env.MCP_HTTP_AUTH_TOKEN = "secret-token";
      process.env.MCP_HTTP_ALLOWED_ORIGINS = "https://app.example, https://admin.example";
      process.env.MCP_HTTP_ALLOWED_HOSTS = "mcp.example,127.0.0.1";

      const config = getHttpSecurityConfig();

      expect(config.harden).toBe(true);
      expect(config.requireAuth).toBe(true);
      expect(config.allowedOrigins).toEqual(["https://app.example", "https://admin.example"]);
      expect(config.allowedHosts).toEqual(["mcp.example", "127.0.0.1"]);
      expect(isRequestAuthorized("Bearer secret-token", config)).toBe(true);
      expect(isRequestAuthorized("secret-token", config)).toBe(true);
      expect(isRequestAuthorized("Bearer wrong", config)).toBe(false);
      expect(isOriginAllowed("https://app.example", config)).toBe(true);
      expect(isOriginAllowed("https://other.example", config)).toBe(false);
    });
  });

  test("rejects incomplete hardened configuration", () => {
    withCleanEnv(() => {
      process.env.MCP_HTTP_HARDEN = "true";
      process.env.MCP_HTTP_AUTH_TOKEN = "secret-token";

      expect(() => validateHttpSecurityConfig(getHttpSecurityConfig())).toThrow(
        "MCP_HTTP_ALLOWED_ORIGINS"
      );
    });
  });
});
