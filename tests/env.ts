const KNOWN_ENV_KEYS = [
  "SEARXNG_URL",
  "AUTH_USERNAME",
  "AUTH_PASSWORD",
  "USER_AGENT",
  "URL_READER_USER_AGENT",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "SEARCH_HTTP_PROXY",
  "SEARCH_HTTPS_PROXY",
  "search_http_proxy",
  "search_https_proxy",
  "URL_READER_HTTP_PROXY",
  "URL_READER_HTTPS_PROXY",
  "url_reader_http_proxy",
  "url_reader_https_proxy",
  "NO_PROXY",
  "no_proxy",
  "MCP_HTTP_HARDEN",
  "MCP_HTTP_AUTH_TOKEN",
  "MCP_HTTP_ALLOWED_ORIGINS",
  "MCP_HTTP_ALLOWED_HOSTS",
  "MCP_HTTP_EXPOSE_FULL_CONFIG",
  "MCP_HTTP_ALLOW_PRIVATE_URLS",
];

export function clearKnownEnv(): void {
  for (const key of KNOWN_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreEnv(snapshot: Map<string, string | undefined>): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

export function withCleanEnv<T>(fn: () => Promise<T>): Promise<T>;
export function withCleanEnv<T>(fn: () => T): T;
export function withCleanEnv<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const snapshot = new Map<string, string | undefined>();
  for (const key of KNOWN_ENV_KEYS) {
    snapshot.set(key, process.env[key]);
  }

  clearKnownEnv();

  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(() => restoreEnv(snapshot));
    }
    restoreEnv(snapshot);
    return result;
  } catch (error) {
    restoreEnv(snapshot);
    throw error;
  }
}
