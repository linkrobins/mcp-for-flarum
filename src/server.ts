import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FlarumClient } from "./flarum-client.js";
import { registerTools } from "./tools/index.js";
import { registerExtensionTools } from "./tools/extensions.js";
import { registerDocsTools } from "./tools/docs.js";
import { diagClientFromEnv, registerDiagnosticTools } from "./tools/diagnostics.js";

export const VERSION = "0.5.2";

/**
 * Default outbound User-Agent. Explicit and identifiable so that forums behind a
 * Cloudflare/WAF that blocks generic or empty user-agents (Cloudflare error 1010)
 * don't reject the server, and so admins can allowlist this tool by name.
 * Override with FLARUM_USER_AGENT.
 */
export const DEFAULT_USER_AGENT = `mcp-for-flarum/${VERSION} (+https://github.com/linkrobins/mcp-for-flarum)`;

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
    userAgent: process.env.FLARUM_USER_AGENT || DEFAULT_USER_AGENT,
    timeoutMs: process.env.FLARUM_TIMEOUT ? Number(process.env.FLARUM_TIMEOUT) : undefined,
    readOnly,
    snapshotUrl,
    snapshotToken,
  });
}

/**
 * Whether the extension-management toolset is enabled. Off by default: these
 * tools can composer-install/update/remove extensions, which is far higher
 * privilege than ordinary content writes, so they require an explicit opt-in
 * (FLARUM_EXTENSIONS=1/true/yes/on) on top of write mode and an admin key. The
 * target forum must also have flarum/extension-manager installed.
 */
export function extensionsEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.FLARUM_EXTENSIONS ?? "");
}

/**
 * Whether the official-docs tools (flarum_docs_search/get/list) are enabled.
 * On by default: they only read the public docs site and never touch the
 * configured forum or its API key, so they're safe in any mode (including
 * read-only and with no API key). Opt out with FLARUM_DOCS=0/false/off.
 */
export function docsEnabled(): boolean {
  return !/^(0|false|no|off)$/i.test(process.env.FLARUM_DOCS ?? "");
}

/** Build a fully-wired MCP server for a given Flarum client. */
export function createMcpServer(client: FlarumClient): McpServer {
  const server = new McpServer({ name: "mcp-for-flarum", version: VERSION });
  registerTools(server, client);
  if (extensionsEnabled()) registerExtensionTools(server, client);
  if (docsEnabled()) registerDocsTools(server, process.env.FLARUM_USER_AGENT || DEFAULT_USER_AGENT);
  // Managed-only: registers just when srvup injected DIAG_URL (hosting stacks).
  const diag = diagClientFromEnv();
  if (diag) registerDiagnosticTools(server, diag);
  return server;
}
