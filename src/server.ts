import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FlarumClient } from "./flarum-client.js";
import { registerTools } from "./tools/index.js";

export const VERSION = "0.2.1";

/** Build a FlarumClient from environment variables. */
export function clientFromEnv(): FlarumClient {
  const baseUrl = process.env.FLARUM_URL;
  if (!baseUrl) {
    process.stderr.write(
      "[mcp-for-flarum] Missing required environment variable FLARUM_URL.\n" +
        "Set FLARUM_URL (your forum's base URL) and FLARUM_API_KEY (a Flarum API key).\n",
    );
    process.exit(1);
  }
  // Read-only is opt-in via FLARUM_MODE=read or READ_ONLY=1/true/yes/on.
  const readOnly =
    process.env.FLARUM_MODE?.toLowerCase() === "read" ||
    /^(1|true|yes|on)$/i.test(process.env.READ_ONLY ?? "");

  // Managed hosting only: SNAPSHOT_URL + SNAPSHOT_TOKEN enable a best-effort
  // pre-change snapshot before the first write. Unset for self-hosters (no-op).
  const snapshotUrl = process.env.SNAPSHOT_URL || undefined;
  const snapshotToken = process.env.SNAPSHOT_TOKEN || process.env.MCP_AUTH_TOKEN || undefined;

  return new FlarumClient({
    baseUrl,
    apiKey: process.env.FLARUM_API_KEY,
    userId: process.env.FLARUM_USER_ID,
    timeoutMs: process.env.FLARUM_TIMEOUT ? Number(process.env.FLARUM_TIMEOUT) : undefined,
    readOnly,
    snapshotUrl,
    snapshotToken,
  });
}

/** Build a fully-wired MCP server for a given Flarum client. */
export function createMcpServer(client: FlarumClient): McpServer {
  const server = new McpServer({ name: "mcp-for-flarum", version: VERSION });
  registerTools(server, client);
  return server;
}
