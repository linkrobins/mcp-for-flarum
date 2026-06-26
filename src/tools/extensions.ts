/**
 * Extension-management tools, driving the official `flarum/extension-manager`
 * extension over the API. These let an AI client search Packagist, check
 * compatibility, install/update/remove extensions, and enable/disable them --
 * all without shell access, because the manager runs composer server-side.
 *
 * Opt-in: these tools register only when FLARUM_EXTENSIONS is enabled (see
 * server.ts), because composer install/update/remove is high-privilege and
 * should not be reachable from an ordinary write token by default.
 *
 * Preconditions on the target forum:
 *   - flarum/extension-manager installed + enabled (probe: GET
 *     /extension-manager/extensions returns 405, not 404).
 *   - The acting API-key user is an admin (every endpoint asserts admin).
 *   - Server can run composer: proc_open/escapeshellarg enabled, and
 *     vendor/storage/composer.json/composer.lock writable.
 *
 * Queue behaviour (validated against live forums) decides the response shape:
 *   - async (queue_jobs=1 + real queue, e.g. redis/database): endpoint returns
 *     202 {processing:true}; a worker runs composer and records a row in
 *     `extension-manager-tasks`. We poll that for the terminal result.
 *   - sync (queue_jobs=0 or driver=sync): the request blocks until composer
 *     finishes and returns the result inline (200/201); no task row is created.
 *   - database queue with no running worker: the task sits at `pending`
 *     forever -- awaitTask times out and says so rather than hanging.
 * The tools detect the mode from the response (202 -> poll; else done), so the
 * same call works across all three setups.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FlarumClient } from "../flarum-client.js";
import { result, errorResult } from "./shared.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Numeric id of the most recent task, or 0 if there are none. */
async function latestTaskId(client: FlarumClient): Promise<number> {
  const doc = await client.request<{ data?: Array<{ id: string }> }>({
    path: "/extension-manager-tasks",
    query: { sort: "-createdAt", page: { limit: 1 } },
  });
  const id = doc.data?.[0]?.id;
  return id ? parseInt(id, 10) || 0 : 0;
}

interface TaskAttributes {
  status: "pending" | "running" | "failure" | "success";
  operation: string;
  command: string;
  package: string | null;
  output: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  peakMemoryUsed: number | null;
}

/**
 * Wait for the task created by a just-dispatched async operation to finish.
 *
 * `sinceId` is the latest task id captured BEFORE dispatch, so we only consider
 * a task that is genuinely newer -- important because the manager is
 * single-flight: if a composer job was already running, our dispatch also
 * returns 202 {processing:true} WITHOUT enqueuing a new task. In that case no
 * task with id > sinceId ever appears and we time out with a clear message
 * rather than reporting someone else's job as ours.
 */
async function awaitTask(
  client: FlarumClient,
  opts: { sinceId: number; timeoutMs: number; intervalMs: number; maxOutputChars: number },
): Promise<unknown> {
  const deadline = Date.now() + opts.timeoutMs;
  let lastSeen: (TaskAttributes & { id: string }) | null = null;
  let first = true;

  while (Date.now() < deadline) {
    if (!first) await sleep(opts.intervalMs);
    first = false;
    const doc = await client.request<{
      data?: Array<{ id: string; attributes: TaskAttributes }>;
    }>({
      path: "/extension-manager-tasks",
      query: { sort: "-createdAt", page: { limit: 1 } },
    });
    const row = doc.data?.[0];
    if (!row || (parseInt(row.id, 10) || 0) <= opts.sinceId) continue; // not our task yet

    lastSeen = { id: row.id, ...row.attributes };
    if (row.attributes.status === "success" || row.attributes.status === "failure") {
      const a = row.attributes;
      const output =
        opts.maxOutputChars > 0 && a.output && a.output.length > opts.maxOutputChars
          ? `${a.output.slice(0, opts.maxOutputChars)}... [truncated ${a.output.length - opts.maxOutputChars} chars]`
          : a.output;
      return {
        taskId: row.id,
        status: a.status,
        operation: a.operation,
        command: a.command,
        package: a.package,
        finishedAt: a.finishedAt,
        peakMemoryKB: a.peakMemoryUsed,
        output,
      };
    }
  }

  return {
    status: "timeout",
    waitedMs: opts.timeoutMs,
    note: lastSeen
      ? `Task ${lastSeen.id} still ${lastSeen.status} after ${opts.timeoutMs}ms. ` +
        `Re-check with flarum_ext_tasks.`
      : `No new task appeared. Either a composer job was already running (the manager ` +
        `runs one at a time), or no queue worker is consuming jobs. Check flarum_ext_tasks ` +
        `and that a worker is running.`,
    lastSeen,
  };
}

/** Standard options for any mutating op that may run async. */
const asyncOpts = {
  await: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "On an async (queued) forum, poll the task to completion and return its result. " +
        "false returns immediately with {processing:true}; check flarum_ext_tasks yourself.",
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .default(300_000)
    .describe("Max time to wait for an async task (default 5 min; job timeout is 3 min)."),
  maxOutputChars: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(4000)
    .describe("Truncate the (often huge) composer output. 0 disables truncation."),
};

const POLL_INTERVAL_MS = 2000;

/**
 * Dispatch a manager action and, if it came back async (202 processing), wait
 * for the resulting task. Returns the raw sync result otherwise.
 */
async function dispatchManaged(
  client: FlarumClient,
  req: { method: string; path: string; body?: unknown; query?: Record<string, unknown> },
  o: { await: boolean; timeoutMs: number; maxOutputChars: number },
): Promise<unknown> {
  const sinceId = o.await ? await latestTaskId(client) : 0;
  const res = await client.request<{ processing?: boolean } | unknown>(req);

  const processing = res && typeof res === "object" && (res as { processing?: boolean }).processing;
  if (!processing) {
    // Sync path: empty 201 bodies come back as "" -- normalise to a clear ok.
    return res && (typeof res !== "string" || res.length) ? res : { ok: true, mode: "sync" };
  }
  if (!o.await) return { processing: true, mode: "async", note: "Poll flarum_ext_tasks for the result." };

  return awaitTask(client, {
    sinceId,
    timeoutMs: o.timeoutMs,
    intervalMs: POLL_INTERVAL_MS,
    maxOutputChars: o.maxOutputChars,
  });
}

export function registerExtensionTools(server: McpServer, client: FlarumClient): void {
  // ---- Read tools: safe in read-only mode (GET only) ----

  server.registerTool(
    "flarum_ext_search",
    {
      title: "Search installable extensions",
      description:
        "Search Packagist for installable Flarum extensions, language packs, or themes via the " +
        "extension manager's proxy. Returns name (composer package, use as `package` for install), " +
        "extensionId (dotted id, use for update/remove/toggle), description, downloads, and whether " +
        'it is abandoned. Example: query="upload", type="extension".',
      inputSchema: {
        query: z.string().optional().describe("Search terms (filter[q])."),
        type: z
          .enum(["extension", "locale", "theme"])
          .optional()
          .describe("Narrow to extensions, language packs, or themes."),
        sort: z.string().optional().describe('e.g. "-downloads".'),
        limit: z.number().int().positive().max(20).optional().default(12),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ query, type, sort, limit, offset }) => {
      try {
        const data = await client.request({
          path: "/external-extensions",
          query: {
            filter: { ...(query ? { q: query } : {}), ...(type ? { type } : {}) },
            sort,
            page: { limit, offset },
          },
        });
        return result(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_ext_tasks",
    {
      title: "List extension-manager tasks",
      description:
        "List the extension manager's task history (install/update/remove/update-check jobs) with " +
        "status (pending|running|failure|success), operation, command, package, timestamps, and " +
        "composer output. Use to poll an async job or to see why one failed. Newest first.",
      inputSchema: {
        limit: z.number().int().positive().max(50).optional().default(5),
        offset: z.number().int().min(0).optional(),
        maxOutputChars: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(4000)
          .describe("Truncate each task's composer output. 0 disables truncation."),
      },
    },
    async ({ limit, offset, maxOutputChars }) => {
      try {
        const doc = await client.request<{ data?: Array<{ attributes?: Record<string, unknown> }> }>({
          path: "/extension-manager-tasks",
          query: { sort: "-createdAt", page: { limit, offset } },
        });
        if (maxOutputChars > 0) {
          for (const row of doc.data ?? []) {
            const out = row.attributes?.output;
            if (typeof out === "string" && out.length > maxOutputChars) {
              row.attributes!.output = `${out.slice(0, maxOutputChars)}... [truncated ${out.length - maxOutputChars} chars]`;
            }
          }
        }
        return result(doc);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ---- Mutating tools: only when writes are allowed ----
  // (why-not and check-for-updates are POST, so they also live here even though
  // they are effectively read-only; the read-only client would reject them.)
  if (client.readOnly) return;

  server.registerTool(
    "flarum_ext_why_not",
    {
      title: "Diagnose why an extension can't install/update",
      description:
        "Dry-run compatibility check for a package against the current Flarum version. Always runs " +
        "synchronously and changes nothing -- safe to call before installing. Returns a human-readable " +
        'reason string. Example: package="fof/byobu", version="*".',
      inputSchema: {
        package: z.string().describe("Composer package, e.g. \"fof/upload\"."),
        version: z.string().optional().default("*").describe('Version constraint, e.g. "^1.0".'),
      },
    },
    async ({ package: pkg, version }) => {
      try {
        const data = await client.request({
          method: "POST",
          path: "/extension-manager/why-not",
          body: { data: { package: pkg, version } },
        });
        return result(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_ext_install",
    {
      title: "Install an extension",
      description:
        "Install a Flarum extension by composer package name (runs composer require server-side). " +
        "Optionally enable it immediately afterwards. The manager pre-checks the package's flarum/core " +
        "constraint and refuses incompatible packages. Note: install does NOT enable by default. " +
        'Example: package="fof/upload", enable=true.',
      inputSchema: {
        package: z
          .string()
          .describe('Composer package, optionally with a version, e.g. "fof/upload" or "fof/upload:^1.2".'),
        enable: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Enable the extension after a successful install. Off by default: a freshly installed " +
              "extension that is incompatible with the running Flarum version can fail to boot when " +
              "enabled and take the whole forum down, and the manager API cannot then disable it " +
              "(recovery is manual). Prefer installing, verifying compatibility, then enabling separately.",
          ),
        ...asyncOpts,
      },
    },
    async ({ package: pkg, enable, await: doAwait, timeoutMs, maxOutputChars }) => {
      try {
        const outcome = await dispatchManaged(
          client,
          { method: "POST", path: "/extension-manager/extensions", body: { data: { package: pkg } } },
          { await: doAwait, timeoutMs, maxOutputChars },
        );

        // Only attempt enable when the install actually completed (sync result
        // carries {id}; async carries status:"success").
        const o = outcome as { id?: string; status?: string };
        const installed = o.id || o.status === "success";
        if (enable && installed) {
          // Extension id is the dotted form; derive it from the package name.
          const extensionId = o.id ?? pkg.split(":")[0].replace("/", "-");
          // Core enable endpoint is NOT JSON:API: flat { enabled: true } body
          // (core reads (bool)(int) of body.enabled; name comes from the path).
          await client.request({
            method: "PATCH",
            path: `/extensions/${extensionId}`,
            body: { enabled: true },
          });
          return result({ install: outcome, enabled: extensionId });
        }
        return result({ install: outcome, enabled: false });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_ext_update",
    {
      title: "Update an extension",
      description:
        'Update one installed extension by its dotted id (e.g. "fof-upload"). updateMode "soft" runs ' +
        '`composer update` within the existing constraint; "hard" runs `composer require pkg:*` to jump ' +
        "to the latest version (can break version locks). Use flarum_ext_search to find the id.",
      inputSchema: {
        extensionId: z.string().describe('Dotted extension id, e.g. "fof-upload".'),
        updateMode: z.enum(["soft", "hard"]).default("soft"),
        ...asyncOpts,
      },
    },
    async ({ extensionId, updateMode, await: doAwait, timeoutMs, maxOutputChars }) => {
      try {
        const outcome = await dispatchManaged(
          client,
          {
            method: "PATCH",
            path: `/extension-manager/extensions/${extensionId}`,
            body: { data: { updateMode } },
          },
          { await: doAwait, timeoutMs, maxOutputChars },
        );
        return result(outcome);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_ext_remove",
    {
      title: "Remove an extension",
      description:
        'Uninstall an extension by its dotted id (runs composer remove server-side). "fof-upload". ' +
        "Irreversible without reinstalling. Dependencies required by other extensions cannot be removed.",
      inputSchema: {
        extensionId: z.string().describe('Dotted extension id, e.g. "fof-upload".'),
        ...asyncOpts,
      },
    },
    async ({ extensionId, await: doAwait, timeoutMs, maxOutputChars }) => {
      try {
        const outcome = await dispatchManaged(
          client,
          { method: "DELETE", path: `/extension-manager/extensions/${extensionId}` },
          { await: doAwait, timeoutMs, maxOutputChars },
        );
        return result(outcome);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_ext_toggle",
    {
      title: "Enable or disable an installed extension",
      description:
        "Enable or disable an already-installed extension via Flarum core (no composer; instant). " +
        'Example: extensionId="fof-upload", enabled=false to disable. Disabling does not uninstall.',
      inputSchema: {
        extensionId: z.string().describe('Dotted extension id, e.g. "fof-upload".'),
        enabled: z.boolean().describe("true to enable, false to disable."),
      },
    },
    async ({ extensionId, enabled }) => {
      try {
        // Core endpoint, flat body (not JSON:API): core reads (bool)(int) body.enabled.
        await client.request({
          method: "PATCH",
          path: `/extensions/${extensionId}`,
          body: { enabled },
        });
        return result({ extensionId, enabled });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_ext_check_updates",
    {
      title: "Check for extension updates",
      description:
        "Ask the manager to check Packagist for available updates to installed packages. Async on " +
        "queued forums (poll the returned task / flarum_ext_tasks); returns inline on sync forums.",
      inputSchema: { ...asyncOpts },
    },
    async ({ await: doAwait, timeoutMs, maxOutputChars }) => {
      try {
        const outcome = await dispatchManaged(
          client,
          { method: "POST", path: "/extension-manager/check-for-updates" },
          { await: doAwait, timeoutMs, maxOutputChars },
        );
        return result(outcome);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_ext_bulk_update",
    {
      title: "Bulk update extensions",
      description:
        'Run a fleet-wide composer update. scope "minor" = safe in-range updates; "global" = ' +
        '`composer update` for everything; "major" = jump to new major versions (set dryRun to preview). ' +
        "Higher blast radius than a single-extension update -- prefer a snapshot/backup first.",
      inputSchema: {
        scope: z.enum(["minor", "major", "global"]).describe("Which bulk update to run."),
        dryRun: z
          .boolean()
          .optional()
          .default(false)
          .describe('For scope="major": preview without applying.'),
        ...asyncOpts,
      },
    },
    async ({ scope, dryRun, await: doAwait, timeoutMs, maxOutputChars }) => {
      try {
        const path =
          scope === "minor"
            ? "/extension-manager/minor-update"
            : scope === "major"
              ? "/extension-manager/major-update"
              : "/extension-manager/global-update";
        const body = scope === "major" ? { data: { dryRun: dryRun ? 1 : 0 } } : undefined;
        const outcome = await dispatchManaged(
          client,
          { method: "POST", path, body },
          { await: doAwait, timeoutMs, maxOutputChars },
        );
        return result(outcome);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_ext_configure_composer",
    {
      title: "Read or set composer config",
      description:
        'Read or set the manager\'s composer.json config (type="composer": minimum-stability, ' +
        'repositories) or private registry auth (type="auth"). Omit `data` to just read the current ' +
        "config (auth tokens are returned masked). Use to add a private/custom composer repository.",
      inputSchema: {
        type: z.enum(["composer", "auth"]).default("composer"),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'For composer: { "minimum-stability": "stable", "repositories": [...] }. ' +
              "For auth: nested { http-basic|bearer: { host: token } }. Omit to read only.",
          ),
      },
    },
    async ({ type, data }) => {
      try {
        const res = await client.request({
          method: "POST",
          path: "/extension-manager/composer",
          body: { type, ...(data ? { data } : {}) },
        });
        return result(res);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
