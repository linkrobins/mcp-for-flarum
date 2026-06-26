import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { clientFromEnv, createMcpServer } from "./server.js";

/**
 * Run the MCP server over Streamable HTTP so it can be hosted.
 *
 * Stateless mode: each POST /mcp request spins up a fresh server + transport,
 * which keeps tenants isolated and is the most robust shape for a hosted /
 * load-balanced deployment. If MCP_AUTH_TOKEN is set, requests must present a
 * matching `Authorization: Bearer <token>` (a minimal gate; OAuth can layer on
 * later for a multi-tenant product).
 */

const JSONRPC_UNAUTHORIZED = {
  jsonrpc: "2.0",
  error: { code: -32001, message: "Unauthorized" },
  id: null,
};

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 4_000_000) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", reject);
  });
}

function authorized(req: IncomingMessage): boolean {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) return true; // no gate configured
  const header = req.headers["authorization"];
  return header === `Bearer ${expected}`;
}

export function isLocalHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export async function runHttp(): Promise<void> {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  // Fail-closed: bind to localhost by default, and refuse to expose a
  // non-localhost interface without an auth token.
  const host = process.env.HOST ?? "127.0.0.1";
  if (!isLocalHost(host) && !process.env.MCP_AUTH_TOKEN) {
    process.stderr.write(
      `[mcp-for-flarum] Refusing to bind ${host} without MCP_AUTH_TOKEN set.\n` +
        "Set MCP_AUTH_TOKEN (or bind HOST=127.0.0.1 for local-only use).\n",
    );
    process.exit(1);
  }
  // Validate config up front so misconfig fails fast, not on first request.
  clientFromEnv();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // Lightweight health check for load balancers / uptime monitors.
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name: "mcp-for-flarum" }));
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. POST to /mcp." }));
      return;
    }

    if (!authorized(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify(JSONRPC_UNAUTHORIZED));
      return;
    }

    if (req.method !== "POST") {
      // Stateless mode does not support GET (SSE) or session DELETE.
      res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Use POST." }, id: null }));
      return;
    }

    const server = createMcpServer(clientFromEnv());
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    // Tear down per-request resources when the connection closes.
    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      const body = await readBody(req);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      process.stderr.write(`[mcp-for-flarum] http request error: ${(err as Error).stack ?? err}\n`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }));
      }
    }
  });

  httpServer.listen(port, host, () => {
    process.stderr.write(
      `[mcp-for-flarum] HTTP transport listening on http://${host}:${port}/mcp` +
        `${process.env.MCP_AUTH_TOKEN ? " (bearer auth on)" : " (localhost only, no auth token set)"}\n`,
    );
  });
}
