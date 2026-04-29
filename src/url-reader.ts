import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isIP } from "node:net";
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { resolveProxyUrl, ProxyType } from "./proxy.js";
import { logMessage } from "./logging.js";
import { getHttpSecurityConfig } from "./http-security.js";
import {
  createURLFormatError,
  createURLSecurityPolicyError,
  createNetworkError,
  createServerError,
  createContentError,
  createConversionError,
  createTimeoutError,
  createEmptyContentWarning,
  createUnexpectedError,
  type ErrorContext
} from "./error-handler.js";

const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

turndownService.addRule('images', {
  filter: 'img',
  replacement: (_content, node) => {
    const alt = (node as Element).getAttribute('alt')?.trim() ?? '';
    return alt;
  },
});

turndownService.addRule('media', {
  filter: ['video', 'audio'],
  replacement: () => '',
});

interface PaginationOptions {
  startChar?: number;
  maxLength?: number;
  section?: string;
  readHeadings?: boolean;
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.+$/, "");
  return lower === "localhost" || lower.endsWith(".localhost");
}

function isPrivateIpv4(hostname: string): boolean {
  if (isIP(hostname) !== 4) {
    return false;
  }

  return (
    hostname.startsWith("10.") ||
    hostname.startsWith("127.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    hostname.startsWith("169.254.")
  );
}

function isPrivateIPv6(hostname: string): boolean {
  // url.hostname wraps IPv6 in brackets (e.g. "[::1]") — strip them first
  const addr = (hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname
  ).toLowerCase();

  if (isIP(addr) !== 6) return false;

  if (addr === "::1") return true; // loopback
  if (addr === "::") return true; // unspecified
  if (/^f[cd]/i.test(addr)) return true; // ULA fc00::/7
  if (/^fe[89ab][0-9a-f]:/i.test(addr)) return true; // link-local fe80::/10

  // IPv4-mapped ::ffff:<ipv4> — delegate to the IPv4 check
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);

  const mappedHex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    const ipv4 = [
      (high >> 8) & 0xff,
      high & 0xff,
      (low >> 8) & 0xff,
      low & 0xff,
    ].join(".");
    return isPrivateIpv4(ipv4);
  }

  return false;
}

function assertUrlAllowed(url: URL): void {
  const security = getHttpSecurityConfig();
  if (!security.harden || security.allowPrivateUrls) {
    return;
  }

  if (isPrivateHostname(url.hostname) || isPrivateIpv4(url.hostname) || isPrivateIPv6(url.hostname)) {
    throw createURLSecurityPolicyError(url.toString());
  }
}

function extractSectionHtml(html: string, heading: string): string | null {
  const needle = heading.toLowerCase();
  const { document } = parseHTML(html);
  const all = Array.from((document as any).querySelectorAll('h1,h2,h3,h4,h5,h6')) as Element[];
  const target = all.find(h => h.textContent?.toLowerCase().includes(needle));
  if (!target) return null;

  const level = parseInt(target.tagName[1]);
  const container = (document as any).createElement('div');
  container.appendChild(target.cloneNode(true));

  let next = target.nextElementSibling;
  while (next) {
    if (/^H[1-6]$/i.test(next.tagName) && parseInt(next.tagName[1]) <= level) break;
    container.appendChild(next.cloneNode(true));
    next = next.nextElementSibling;
  }

  return container.innerHTML;
}

export async function fetchAndConvertToMarkdown(
  mcpServer: McpServer,
  url: string,
  timeoutMs: number = 10000,
  paginationOptions: PaginationOptions = {}
) {
  const startTime = Date.now();
  logMessage(mcpServer, "info", `Fetching URL: ${url}`);

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    logMessage(mcpServer, "error", `Invalid URL format: ${url}`);
    throw createURLFormatError(url);
  }

  assertUrlAllowed(parsedUrl);

  // Create an AbortController instance
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Prepare request options with proxy support
    const requestOptions: RequestInit = {
      signal: controller.signal,
    };

    const proxy = resolveProxyUrl(url, ProxyType.URL_READER);
    if (proxy) {
      (requestOptions as any).proxy = proxy;
    }

    // Add User-Agent header if configured (URL_READER_USER_AGENT takes priority over USER_AGENT)
    const userAgent = process.env.URL_READER_USER_AGENT || process.env.USER_AGENT;
    if (userAgent) {
      requestOptions.headers = {
        ...requestOptions.headers,
        'User-Agent': userAgent
      };
    }

    let response: Response;
    try {
      // Fetch the URL with the abort signal
      response = await fetch(url, requestOptions);
    } catch (error: any) {
      const context: ErrorContext = {
        url,
        proxyAgent: !!proxy,
        timeout: timeoutMs
      };
      throw createNetworkError(error, context);
    }

    if (!response.ok) {
      let responseBody: string;
      try {
        responseBody = await response.text();
      } catch {
        responseBody = '[Could not read response body]';
      }

      const context: ErrorContext = { url };
      throw createServerError(response.status, response.statusText, responseBody, context);
    }

    // Check if the content is likely binary
    const contentType = response.headers.get("content-type");

    if (contentType) {
      const isTextLike = contentType.includes("text/") ||
        contentType.includes("xml") ||
        contentType.includes("json") ||
        contentType.includes("javascript");
      if (!isTextLike) {
        throw createContentError(`URL returned binary or non-text content (${contentType}).`, url);
      }
    }

    // Retrieve HTML content
    let htmlContent: string;
    try {
      htmlContent = await response.text();
    } catch (error: any) {
      throw createContentError(
        `Failed to read website content: ${error.message || 'Unknown error reading content'}`,
        url
      );
    }

    if (!htmlContent || htmlContent.trim().length === 0) {
      throw createContentError("Website returned empty content.", url);
    }

    // Parse DOM, extract article, apply DOM-level filters, convert to Markdown
    let result: string;
    try {
      const { document } = parseHTML(htmlContent);
      const article = new Readability(document as unknown as Document).parse();
      let sourceHtml = article?.content?.trim() ? article.content : htmlContent;

      if (paginationOptions.readHeadings) {
        const { document: d } = parseHTML(sourceHtml);
        const hs = Array.from((d as any).querySelectorAll('h1,h2,h3,h4,h5,h6')) as Element[];
        return hs.length > 0
          ? hs.map(h => turndownService.turndown(h.outerHTML).trim()).join('\n')
          : "No headings found in the content.";
      }

      if (paginationOptions.section) {
        const extracted = extractSectionHtml(sourceHtml, paginationOptions.section);
        if (!extracted) return `Section "${paginationOptions.section}" not found in the content.`;
        sourceHtml = extracted;
      }

      result = turndownService.turndown(sourceHtml);
    } catch (error: any) {
      throw createConversionError(error, url, htmlContent);
    }

    if (!result || result.trim().length === 0) {
      logMessage(mcpServer, "warning", `Empty content after conversion: ${url}`);
      return createEmptyContentWarning(url, htmlContent.length, htmlContent);
    }

    if (paginationOptions.startChar !== undefined || paginationOptions.maxLength !== undefined) {
      const start = Math.max(0, paginationOptions.startChar ?? 0);
      const end = paginationOptions.maxLength ? Math.min(result.length, start + paginationOptions.maxLength) : result.length;
      result = start >= result.length ? "" : result.slice(start, end);
    }

    const duration = Date.now() - startTime;
    logMessage(
      mcpServer,
      "info",
      `Successfully fetched and converted URL: ${url} (${result.length} chars in ${duration}ms)`
    );

    return result;
  } catch (error: any) {
    if (error.name === "AbortError") {
      logMessage(mcpServer, "error", `Timeout fetching URL: ${url} (${timeoutMs}ms)`);
      throw createTimeoutError(timeoutMs, url);
    }
    // Re-throw our enhanced errors
    if (error.name === 'MCPSearXNGError') {
      logMessage(mcpServer, "error", `Error fetching URL: ${url} - ${error.message}`);
      throw error;
    }

    // Catch any unexpected errors
    logMessage(mcpServer, "error", `Unexpected error fetching URL: ${url}`, error);
    const context: ErrorContext = { url };
    throw createUnexpectedError(error, context);
  } finally {
    // Clean up the timeout to prevent memory leaks
    clearTimeout(timeoutId);
  }
}
