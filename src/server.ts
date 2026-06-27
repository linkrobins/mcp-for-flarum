import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FlarumClient } from "./flarum-client.js";
import { registerTools } from "./tools/index.js";
import { registerExtensionTools } from "./tools/extensions.js";
import { registerDocsTools } from "./tools/docs.js";
import { registerDevTools } from "./tools/dev.js";
import { diagClientFromEnv, registerDiagnosticTools } from "./tools/diagnostics.js";
import { registerExtensionPrompts } from "./prompts.js";

export const VERSION = "0.6.2";

/**
 * Default outbound User-Agent. Explicit and identifiable so that forums behind a
 * Cloudflare/WAF that blocks generic or empty user-agents (Cloudflare error 1010)
 * don't reject the server, and so admins can allowlist this tool by name.
 * Override with FLARUM_USER_AGENT.
 */
export const DEFAULT_USER_AGENT = `mcp-for-flarum/${VERSION} (+https://github.com/linkrobins/mcp-for-flarum)`;

/**
 * Build the server-level instructions returned in the MCP initialize response.
 * Compliant clients inject these into the model's context as standing guidance,
 * so this is the strongest server-side lever for steering the AI toward the
 * built-in Flarum knowledge (short of client-side hooks the server can't
 * control). Built per-session from the enabled capabilities so the AI is only
 * ever told about tools that are actually registered for it.
 */
export function buildInstructions(caps: {
  docs: boolean;
  dev: boolean;
  extensions: boolean;
  diagnostics: boolean;
}): string {
  const { dev } = caps;
  const lines: string[] = [
    "This server connects you to a Flarum forum's API and ships built-in Flarum 2.0 knowledge. Prefer these tools and references over training-data assumptions about Flarum (its API and conventions change). Use the right capability for the job:",
    "- **Forum data**: read with `flarum_list`/`flarum_get`/`flarum_search` and write with `flarum_create`/`flarum_update`/`flarum_delete`/`flarum_create_discussion`/`flarum_reply` (`flarum_request` is the raw escape hatch). Call `flarum_whoami` first to confirm which user and permissions you're acting as. Respect read-only mode (write tools are hidden and mutations refused when it's on), and prefer a typed tool over a hand-built URL.",
  ];
  if (dev) {
    lines.push(
      "- **Building or reviewing extension code**: BEFORE writing, scaffolding, modifying, or reviewing ANY Flarum 2.0 extension, call `flarum_dev` for the relevant topic(s) and follow its contracts. They encode the conventions and compatibility rules that prevent real production bugs: cross-database portability, fail-closed API fields, lazy-chunk-safe frontend extends, queue-driver portability (sync/database/redis/Horizon), Redis and multi-server file storage, and soft-dependent integration with realtime/audit/widgets/sitemap. Treat it as a requirement. The `build-flarum-extension`, `review-flarum-extension`, and `check-flarum-compatibility` prompts run this workflow for you.",
    );
  }
  if (caps.docs) {
    lines.push(
      "- **How Flarum itself works**: use `flarum_docs_search`/`flarum_docs_get`/`flarum_docs_list` for the authoritative, live 2.0 documentation (extenders, endpoints, permissions, settings) instead of recalling it from memory.",
    );
  }
  if (caps.extensions) {
    lines.push(
      "- **Installing/updating extensions on the forum**: use the `flarum_ext_*` tools. Run `flarum_ext_why_not` to check compatibility before installing, don't auto-enable, and take a backup before a major or bulk update, since enabling an incompatible extension can take the whole site down.",
    );
  }
  if (caps.diagnostics) {
    lines.push(
      "- **Troubleshooting a managed forum**: use `flarum_triage` for a boot-error/post-update bundle and `flarum_diag` for a single check. These are read-only and recommend-only: diagnose and suggest fixes, never auto-apply.",
    );
  }
  if (dev) {
    lines.push(
      "When a task involves building or auditing an extension, consulting `flarum_dev` first is the expected workflow.",
    );
  }
  return lines.join("\n");
}

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

/**
 * Whether the extension-development reference tool (flarum_dev) is enabled. On
 * by default: it serves static, curated development guidance and never touches
 * the configured forum or its API key, so it's safe in any mode (including
 * read-only and with no API key). Opt out with FLARUM_DEV=0/false/off.
 */
export function devEnabled(): boolean {
  return !/^(0|false|no|off)$/i.test(process.env.FLARUM_DEV ?? "");
}

/** Build a fully-wired MCP server for a given Flarum client. */
export function createMcpServer(client: FlarumClient): McpServer {
  // Resolve enabled capabilities up front so the instructions describe exactly
  // the tools that get registered below.
  const docs = docsEnabled();
  const dev = devEnabled();
  const extensions = extensionsEnabled();
  const diag = diagClientFromEnv();

  const server = new McpServer(
    { name: "mcp-for-flarum", version: VERSION },
    { instructions: buildInstructions({ docs, dev, extensions, diagnostics: diag !== null }) },
  );
  registerTools(server, client);
  if (extensions) registerExtensionTools(server, client);
  if (docs) registerDocsTools(server, process.env.FLARUM_USER_AGENT || DEFAULT_USER_AGENT);
  if (dev) {
    registerDevTools(server);
    // Prompts orchestrate the flarum_dev workflow, so they ride with it.
    registerExtensionPrompts(server);
  }
  // Managed-only: registers just when srvup injected DIAG_URL (hosting stacks).
  if (diag) registerDiagnosticTools(server, diag);
  return server;
}
