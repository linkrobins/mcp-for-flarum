# Managed Troubleshooting (design)

Status: design / not built. Target: paid managed (LR-hosted) tier only.

Lets a managed client invoke the MCP to isolate and troubleshoot forum problems
(boot errors, post-update breakage, mail/queue failures) and get back a findings
report. **Self-hosted clients get none of this and never see that it exists.**

## Why not a Flarum extension

Decided against. Troubleshooting must work even when Flarum won't boot, so it
cannot depend on anything that loads inside Flarum. It also must be invisible to
self-hosters, which an installable extension can't guarantee. Instead the channel
goes through infra we already own.

## Architecture

```
MCP client → MCP server (managed mode) → srvup control-plane diag API → tenant container
                                              (whitelisted read-only cmds)
```

- The MCP server does **not** hold `docker exec`/SSH. srvup owns container access
  and the tenant→container mapping; the MCP just calls srvup's diag endpoints.
- The actual command-execution logic lives in **srvup**, not in this
  (source-available) package. This repo only ever contains a *client* for an API
  that self-hosters cannot authenticate to.
- Because the path is srvup→container, it does **not** depend on Flarum's HTTP API
  being up. This is what makes boot-error diagnosis possible (the JSON:API is dead
  during a boot fatal; the container is still reachable).

## Boot-error coverage (why container access matters)

When Flarum 500s on boot the JSON:API returns HTML/500 and the existing read-only
API tools are blind. Via srvup→container we can still:

- `php flarum info` — versions, PHP, DB driver, debug flag, mail/queue/url config
- `php flarum migrate:status` — pending migrations (top cause of post-update breakage)
- tail `storage/logs/flarum.log` **and** the PHP-FPM/web error log (a true boot
  fatal often fires before Flarum's logger initializes, so it only shows in the
  web log)
- `composer diagnose` / dependency-conflict check (the "enabled/updated an
  extension and the site died" case)
- host facts: disk full, `storage/` + `assets/` writability/perms, DB reachable
  from container, queue/horizon worker alive (risendad runs redis + fof-horizon)

If the fatal is early enough that `php flarum` itself won't run, the raw error-log
tail + `composer diagnose` are usually enough to name the culprit.

## Managed-only enforcement (self-hosted sees NOTHING)

Decided: self-hosted sees nothing at all — no tools, no stub, no "managed-tier
feature" message, no mention in errors. Enforced structurally, in three layers:

1. **Capability gating by credential possession, not a flag.** Diag tools register
   only when the server boots in managed mode with valid srvup control-plane auth
   + a tenant binding. No credential → tools are never added to the advertised
   tool list. This is stronger than the `FLARUM_EXTENSIONS` opt-in (a self-hoster
   *can* set an env flag; they *cannot* mint control-plane auth).
2. **Logic lives in srvup, not here.** The source-available package contains only
   a client for an unreachable API. Nothing privileged ships to self-hosters.
3. **Server-side authz is the real boundary.** Even a forged managed-mode flag
   fails: srvup authenticates the caller and maps it to a tenant it owns; unknown
   caller → refused. Security depends on srvup's auth, which we control, not on the
   MCP behaving.

Mirror the existing gate shape in `src/server.ts`:

```ts
// only true when control-plane auth is present (self-hosters cannot obtain it)
export function managedDiagnosticsEnabled(): boolean {
  return Boolean(process.env.MCP_CONTROL_PLANE_URL && process.env.MCP_CONTROL_PLANE_TOKEN);
}
// in createMcpServer():
if (managedDiagnosticsEnabled()) registerDiagnosticTools(server, controlPlaneClient);
```

## Safety posture (same as the rest of the MCP)

- **Whitelisted commands only** — a fixed menu of read-only diagnostics, never
  free-form shell. The whitelist IS the security boundary (see TODO below).
- **Read-only / fail-closed** — diagnose and *recommend* (clear cache, run
  migration, disable extension X); never auto-apply.
- **Tenant-scoped + audited** — a client can only diagnose its own forum; every
  diag call is logged on the srvup side.

## srvup diag-API contract (v1)

Single endpoint, one whitelisted check per call. srvup resolves `{tenant}` to a
container it owns, runs the fixed command for `check`, and returns captured output.

```
POST {CONTROL_PLANE_URL}/internal/mcp/diag/{tenant}
Authorization: Bearer {CONTROL_PLANE_TOKEN}
Content-Type: application/json

{ "check": "<whitelisted-id>", "args": { "lines": 200, "level": "error" } }
```

Response:

```json
{
  "check": "flarum_log",
  "ok": true,
  "raw": "...captured stdout/stderr, secret-scrubbed, size-capped...",
  "exitCode": 0,
  "durationMs": 412,
  "truncated": false
}
```

- **`check`** must be one of the seven locked ids (below). Anything else → 400; the
  command is never derived from client input, only selected from srvup's table.
- **`args`** is per-check and bounded: `lines` (log tails, clamped e.g. 1..1000),
  `level` (flarum_log filter). No path, no flags, no free-form anything.
- **authN**: control-plane bearer token. **authZ**: token→tenant mapping enforced
  server-side; a token may only diag tenants it owns (cross-tenant → 403).
- **Hardening**: per-check timeout, output size cap (`truncated:true` when hit),
  secret-scrub on `raw` before it leaves the box, rate-limit per tenant, full audit
  log of every diag call. `ok` reflects "the check ran", not "the forum is healthy".

### check id → command (srvup-side table, the only place commands live)

| check id            | command (read-only)                                  |
|---------------------|------------------------------------------------------|
| `flarum_info`       | `php flarum info`                                    |
| `migrate_status`    | `php flarum migrate:status`                          |
| `flarum_log`        | tail `storage/logs/flarum.log` (last `lines`, `level`)|
| `web_log`           | tail PHP-FPM/web error log (last `lines`)            |
| `composer_diagnose` | `composer diagnose` (+ dependency-conflict parse)    |
| `disk_perms`        | `df` + writability/perms of `storage/`,`assets/`     |
| `queue_status`      | queue/horizon worker liveness probe                  |

## MCP side: client + tools

Reference scaffold lives in `src/tools/diagnostics.ts` (NOT yet wired into
`createMcpServer` — see scaffold header). Shape:

- **`DiagClient`** — thin control-plane HTTP client (mirrors the snapshot hook in
  `flarum-client.ts`: bearer token, AbortController timeout, identifiable UA).
- **`managedDiagnosticsEnabled()`** — true only when both `MCP_CONTROL_PLANE_URL`
  and `MCP_CONTROL_PLANE_TOKEN` are present. Self-hosters can't mint these, so the
  tools never register for them (the structural gate from §managed-only).
- **Tools** (register only behind that gate):
  - `flarum_diag` — run ONE whitelisted check; returns raw `{check, ok, raw, ...}`.
  - `flarum_triage` — run the standard boot-error bundle (info, migrate_status,
    flarum_log, web_log, composer_diagnose) and return the combined raw outputs for
    the model to fuse into the findings report.

Wiring (one line in `createMcpServer`, intentionally left undone in the scaffold):

```ts
const diag = diagClientFromEnv();
if (diag) registerDiagnosticTools(server, diag);
```

## Findings flow

1. Admin hits a problem (e.g. boot 500). Client calls `flarum_triage`.
2. MCP → srvup → container runs the bundle; raw outputs come back scrubbed/capped.
3. The model fuses them into the findings-report schema below. It **recommends**
   fixes (run migration, disable extension X, free disk); it never executes them.

## Findings report (standardize this schema)

Each finding:
`severity · symptom (observed) · evidence (exact log/CLI excerpt) · likely cause ·
suggested fix · confidence · couldn't-check`

The LLM fuses raw command outputs into this shape. It recommends; it does not act.

## v1 command whitelist (LOCKED 2026-06-26)

The whitelist is the security boundary. v1 is locked to exactly these seven
read-only checks — nothing outside this list executes:

- [x] `flarum info`
- [x] `flarum migrate:status`
- [x] flarum-log tail (`storage/logs/flarum.log`, last N lines, level filter)
- [x] web/PHP-FPM error-log tail (last N lines)
- [x] `composer diagnose` / dependency-conflict check
- [x] disk usage + `storage/`/`assets/` writability & perms check
- [x] queue/horizon worker liveness ping

Explicitly **out of v1** (mutating — surface as recommendations only, never run):
`cache:clear`, `migrate`, extension enable/disable, `composer` install/update.

Still open (implementation details, do not block the locked list):
- [ ] exact log line caps / redaction (scrub secrets from log tails before return)
- [ ] per-check timeouts
- [ ] does `flarum info` output need any field redaction before leaving the box
