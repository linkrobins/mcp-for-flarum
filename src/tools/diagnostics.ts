/**
 * Managed-tier troubleshooting tools.
 *
 * Why a separate channel (not the Flarum API): troubleshooting must work even
 * when Flarum won't boot, so it cannot go through the JSON:API (which is dead
 * during a boot fatal). Instead the MCP asks the srvup control plane, which owns
 * container access, to run a FIXED, whitelisted, read-only diagnostic command
 * (POST DIAG_URL). srvup resolves the tenant FROM the bearer token — there is no
 * tenant in the URL — and enforces that the token may only diag its own forum.
 *
 * Managed-only by construction: these tools register only when DIAG_URL (and a
 * token) are present. srvup injects DIAG_URL solely into the hosting compose, so
 * self-hosters never get it — the tools never appear for them, no stub, no hint.
 *
 * Wired in server.ts:
 *   const diag = diagClientFromEnv();
 *   if (diag) registerDiagnosticTools(server, diag);
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { result, errorResult } from "./shared.js";

/**
 * The v1 command whitelist (LOCKED 2026-06-26). These ids are the ONLY values
 * the client may send; srvup maps each to a fixed read-only command server-side.
 * The command is never derived from client input — only selected from this set.
 */
export const DIAG_CHECKS = [
  "flarum_info", // php flarum info
  "migrate_status", // php flarum migrate:status
  "flarum_log", // tail storage/logs/flarum.log (args: lines, level)
  "web_log", // tail PHP-FPM/web error log (args: lines)
  "composer_diagnose", // composer diagnose + dependency-conflict parse
  "disk_perms", // df + storage/ & assets/ writability/perms
  "queue_status", // queue/horizon worker liveness
] as const;

export type DiagCheck = (typeof DIAG_CHECKS)[number];

/** Per-check arguments. Bounded on purpose: no paths, no flags, no free-form. */
export interface DiagArgs {
  /** Log tails only: number of trailing lines (srvup clamps, e.g. 1..1000). */
  lines?: number;
  /** flarum_log only: minimum level filter, e.g. "error". */
  level?: string;
}

/** Shape srvup returns for one check (see docs contract). */
export interface DiagResult {
  check: DiagCheck;
  ok: boolean;
  raw: string;
  exitCode?: number;
  durationMs?: number;
  truncated?: boolean;
}

export interface DiagClientOptions {
  /** Full diag endpoint, e.g. https://linkrobins.com/hosting/mcp/diag */
  url: string;
  /** Bearer token — this client's MCP_AUTH_TOKEN. srvup resolves the tenant from it. */
  token: string;
  userAgent?: string;
  timeoutMs?: number;
}

/**
 * Thin client for the srvup diag endpoint. Mirrors the snapshot hook in
 * flarum-client.ts: bearer auth, identifiable UA, AbortController timeout. Holds
 * no container access itself — srvup does the privileged work and enforces (from
 * the token alone) that this caller may only diag its own forum.
 */
export class DiagClient {
  private url: string;
  private token: string;
  private userAgent?: string;
  private timeoutMs: number;

  constructor(opts: DiagClientOptions) {
    this.url = opts.url.replace(/\/+$/, "");
    this.token = opts.token;
    this.userAgent = opts.userAgent;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async run(check: DiagCheck, args: DiagArgs = {}): Promise<DiagResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(this.userAgent ? { "User-Agent": this.userAgent } : {}),
        },
        body: JSON.stringify({ check, args }),
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown = text;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          /* leave raw */
        }
      }
      if (!res.ok) {
        throw new Error(
          `Diag API ${check} failed: ${res.status} ${res.statusText} — ${
            typeof parsed === "string" ? parsed : JSON.stringify(parsed)
          }`,
        );
      }
      return parsed as DiagResult;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Build a DiagClient from env, or null when managed-mode is absent. Mirrors how
 * server.ts derives the snapshot token: DIAG_TOKEN || MCP_AUTH_TOKEN. Only the
 * hosting compose injects DIAG_URL, so this returns null for self-hosters.
 */
export function diagClientFromEnv(): DiagClient | null {
  const url = process.env.DIAG_URL;
  const token = process.env.DIAG_TOKEN || process.env.MCP_AUTH_TOKEN;
  if (!url || !token) return null;
  return new DiagClient({
    url,
    token,
    userAgent: process.env.FLARUM_USER_AGENT,
    timeoutMs: process.env.FLARUM_TIMEOUT ? Number(process.env.FLARUM_TIMEOUT) : undefined,
  });
}

/**
 * True only when DIAG_URL and a token are present. The structural managed-only
 * gate: srvup injects DIAG_URL only into hosting stacks, so self-hosters can't
 * set it and the diagnostic tools never register for them.
 */
export function managedDiagnosticsEnabled(): boolean {
  return Boolean(process.env.DIAG_URL && (process.env.DIAG_TOKEN || process.env.MCP_AUTH_TOKEN));
}

/** The standard bundle flarum_triage runs for a "won't boot / just broke" report. */
const TRIAGE_BUNDLE: DiagCheck[] = [
  "flarum_info",
  "migrate_status",
  "flarum_log",
  "web_log",
  "composer_diagnose",
];

export function registerDiagnosticTools(server: McpServer, diag: DiagClient): void {
  server.registerTool(
    "flarum_diag",
    {
      title: "Run one forum diagnostic check",
      description:
        "Run a single read-only diagnostic against the managed forum's container via the control " +
        "plane. Works even when the forum won't boot (does not use the Flarum API). Returns raw " +
        "captured output for you to interpret — it does not change anything. Checks: flarum_info, " +
        "migrate_status, flarum_log, web_log, composer_diagnose, disk_perms, queue_status.",
      inputSchema: {
        check: z.enum(DIAG_CHECKS).describe("Which whitelisted check to run."),
        lines: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe("Log tails (flarum_log/web_log): number of trailing lines."),
        level: z
          .string()
          .optional()
          .describe('flarum_log only: minimum level filter, e.g. "error".'),
      },
    },
    async ({ check, lines, level }) => {
      try {
        return result(await diag.run(check, { lines, level }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_triage",
    {
      title: "Triage a broken or misbehaving forum",
      description:
        "Run the standard boot-error diagnostic bundle (flarum info, migrate status, flarum log, " +
        "web/PHP-FPM error log, composer diagnose) and return all raw outputs together. Use this " +
        "first when a managed forum is down or just broke after an update. Then synthesize a " +
        "FINDINGS REPORT for each issue: severity, symptom (what's observed), evidence (the exact " +
        "log/CLI excerpt), likely cause, suggested fix, confidence, and what you couldn't check. " +
        "RECOMMEND fixes only — never state that anything was changed; these tools are read-only.",
      inputSchema: {
        lines: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .default(200)
          .describe("Trailing lines to pull for each log tail."),
      },
    },
    async ({ lines }) => {
      const checks = await Promise.all(
        TRIAGE_BUNDLE.map(async (check) => {
          try {
            return await diag.run(check, check === "flarum_log" ? { lines, level: "error" } : { lines });
          } catch (err) {
            return { check, ok: false, raw: `check failed: ${(err as Error).message}` } satisfies DiagResult;
          }
        }),
      );
      return result({ checks });
    },
  );
}
