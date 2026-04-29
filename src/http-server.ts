import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from
  "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { logMessage } from "./logging.js";
import {
  getHttpSecurityConfig,
  isOriginAllowed,
  isRequestAuthorized,
  validateHttpSecurityConfig,
} from "./http-security.js";

interface Session {
  transport: WebStandardStreamableHTTPServerTransport;
  mcpServer: McpServer;
}

function buildCorsHeaders(
  origin: string | null,
  security: ReturnType<typeof getHttpSecurityConfig>
): Record<string, string> {
  if (!origin || !isOriginAllowed(origin, security)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, authorization",
  };
}

function withCors(response: Response, cors: Record<string, string>): Response {
  if (Object.keys(cors).length === 0) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function createHttpServer(
  createMcpServer: () => McpServer,
  port: number
): Promise<ReturnType<typeof Bun.serve>> {
  const security = getHttpSecurityConfig();
  validateHttpSecurityConfig(security);

  const sessions = new Map<string, Session>();

  const server = Bun.serve({
    port,
    async fetch(req: Request, server) {
      const url = new URL(req.url);
      const origin = req.headers.get("origin");
      const cors = buildCorsHeaders(origin, security);

      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          },
        });
      }

      if (url.pathname === "/health" && req.method === "GET") {
        return Response.json({
          status: "healthy",
          server: "tterrasson/mcp-searxng",
          transport: "http",
        });
      }

      if (url.pathname !== "/mcp") {
        return new Response("Not Found", { status: 404 });
      }

      if (!isRequestAuthorized(req.headers.get("authorization") ?? undefined, security)) {
        return Response.json(
          {
            jsonrpc: "2.0",
            error: { code: -32001, message: "Unauthorized: missing or invalid HTTP auth token" },
            id: null
          },
          { status: 401, headers: cors }
        );
      }

      const sessionId = req.headers.get("mcp-session-id") ?? undefined;
      const clientIP = server.requestIP(req)?.address;

      if (req.method === "POST") {
        if (sessionId && sessions.has(sessionId)) {
          const { transport, mcpServer } = sessions.get(sessionId)!;
          logMessage(mcpServer, "debug", `Reusing session: ${sessionId}`);
          try {
            const response = await transport.handleRequest(req);
            return withCors(response, cors);
          } catch (error) {
            if (error instanceof Error && error.message.includes("accept")) {
              console.warn(`⚠️  Connection rejected due to missing headers:`, {
                clientIP,
                userAgent: req.headers.get("user-agent"),
                contentType: req.headers.get("content-type"),
                accept: req.headers.get("accept"),
                error: error.message,
              });
            }
            throw error;
          }
        }

        if (!sessionId) {
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            return new Response("Bad Request: invalid JSON body", { status: 400, headers: cors });
          }

          if (isInitializeRequest(body)) {
            const mcpServer = createMcpServer();
            const transport = new WebStandardStreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (id) => {
                sessions.set(id, { transport, mcpServer });
                logMessage(mcpServer, "debug", `Session initialized: ${id}`);
              },
              onsessionclosed: (id) => {
                sessions.delete(id);
              },
              enableDnsRebindingProtection: security.enableDnsRebindingProtection,
              allowedHosts: security.allowedHosts,
              allowedOrigins: security.allowedOrigins,
            });

            await mcpServer.connect(transport);
            const response = await transport.handleRequest(req, { parsedBody: body });
            return withCors(response, cors);
          }
        }

        console.warn(`⚠️  POST request rejected - invalid request:`, {
          clientIP,
          sessionId: sessionId ?? "undefined",
          userAgent: req.headers.get("user-agent"),
          contentType: req.headers.get("content-type"),
          accept: req.headers.get("accept"),
        });
        return Response.json(
          { jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: No valid session ID provided" }, id: null },
          { status: 400, headers: cors }
        );
      }

      if (req.method === "GET" || req.method === "DELETE") {
        if (!sessionId || !sessions.has(sessionId)) {
          console.warn(`⚠️  ${req.method} request rejected - missing or invalid session ID:`, {
            clientIP,
            sessionId: sessionId ?? "undefined",
            userAgent: req.headers.get("user-agent"),
          });
          return new Response("Invalid or missing session ID", { status: 400, headers: cors });
        }

        const { transport } = sessions.get(sessionId)!;

        if (req.method === "DELETE") {
          const response = await transport.handleRequest(req);
          sessions.delete(sessionId);
          return withCors(response, cors);
        }

        try {
          const response = await transport.handleRequest(req);
          return withCors(response, cors);
        } catch (error) {
          console.warn(`⚠️  GET request failed:`, {
            clientIP,
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }

      return new Response("Method Not Allowed", { status: 405, headers: cors });
    },
  });

  console.log(`HTTP server listening on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`MCP endpoint: http://localhost:${port}/mcp`);

  return server;
}
