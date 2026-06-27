# MCP for Flarum

A [Model Context Protocol](https://modelcontextprotocol.io) server for [Flarum](https://flarum.org).

It gives any MCP-compatible AI client (Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Zed, and others) full access to a Flarum forum's API: read and search discussions and posts, create threads and replies, manage users, tags and groups, moderate content, change settings, and call any third-party extension endpoint.

> Flarum's whole API is uniform [JSON:API](https://jsonapi.org), so a small set of generic tools covers the **entire** surface, including extensions, rather than hundreds of hand-written ones.

## Tools

**Generic (full API coverage):**

| Tool | What it does |
| --- | --- |
| `flarum_list` | List/search any resource type with filters, includes, sort, pagination |
| `flarum_get` | Fetch one resource by type and id |
| `flarum_create` | Create any resource |
| `flarum_update` | Update any resource (also lock/sticky/approve for moderation) |
| `flarum_delete` | Delete any resource |
| `flarum_request` | Raw escape hatch for any endpoint |

**Convenience:**

| Tool | What it does |
| --- | --- |
| `flarum_whoami` | Forum info + the user the API key acts as |
| `flarum_search` | Full-text discussion search |
| `flarum_create_discussion` | Start a thread (title + content + optional tags) |
| `flarum_reply` | Reply to a discussion |

**Official docs (on by default):**

Search and read Flarum's official [2.0 documentation](https://docs.flarum.org/2.x/) so the AI can check how a setting, permission, extender, or REST endpoint is meant to work before acting. These read the public docs only (never your forum or its key), so they work in any mode, including read-only and with no API key. They read the live docs, so results always reflect the current 2.0 documentation. Turn them off with `FLARUM_DOCS=0`.

| Tool | What it does |
| --- | --- |
| `flarum_docs_search` | Search the 2.0 docs; returns ranked pages with snippets |
| `flarum_docs_get` | Read a full docs page as Markdown (by slug, path, or URL) |
| `flarum_docs_list` | List/browse the available 2.0 docs pages |

**Extension development (on by default):**

A development reference for building or reviewing a Flarum 2.0 extension: scaffolding and architecture, `composer.json`, the TypeScript frontend, backend (API resources/models/migrations), i18n, testing, static analysis & CI, and releasing. Combines the conventions the official docs establish, the de-facto FriendsOfFlarum standard, and patterns that prevent real production bugs. Static content, so it works in any mode, including read-only and with no API key. Turn it off with `FLARUM_DEV=0`.

| Tool | What it does |
| --- | --- |
| `flarum_dev` | Returns the extension-development reference; optional `topic` (scaffold, composer, frontend, backend, i18n, testing, quality-ci, release) to narrow it |

**Extension management (opt-in, off by default):**

Registered only when `FLARUM_EXTENSIONS=1` and the forum has the official [`flarum/extension-manager`](https://github.com/flarum/extension-manager) installed. These drive Composer on the server, so they need an admin key and write mode. See [Managing extensions](#managing-extensions).

| Tool | What it does |
| --- | --- |
| `flarum_ext_search` | Search Packagist for installable extensions, language packs, or themes |
| `flarum_ext_why_not` | Dry-run compatibility check for a package (changes nothing) |
| `flarum_ext_install` | Install an extension (optionally enable it after) |
| `flarum_ext_update` | Update one extension (`soft` in-range, or `hard` to latest) |
| `flarum_ext_remove` | Uninstall an extension |
| `flarum_ext_toggle` | Enable/disable an installed extension (no Composer; instant) |
| `flarum_ext_check_updates` | Check Packagist for available updates |
| `flarum_ext_bulk_update` | Bulk update: `minor`, `major` (with `dryRun`), or `global` |
| `flarum_ext_configure_composer` | Read/set `minimum-stability`, repositories, or private registry auth |
| `flarum_ext_tasks` | List install/update job history and Composer output (poll async jobs) |

**Managed hosting only (not available to self-hosters):**

Two capabilities exist only on the Link Robins managed tier. They are gated on environment that only the hosting stack injects (`DIAG_URL` and `SNAPSHOT_URL`), and those point at Link Robins' own infrastructure: a self-hoster cannot set them to anything useful, so the diagnostic tools never register and the snapshot hook stays a no-op. Setting them by hand does nothing because there is no backend to answer.

| Capability | Gate | What it does |
| --- | --- | --- |
| `flarum_diag` / `flarum_triage` | `DIAG_URL` + token | Read-only troubleshooting of a managed forum (boot errors, post-update breakage, mail/queue failures) via the hosting control plane, which works even when Flarum won't boot. See [docs/managed-troubleshooting.md](docs/managed-troubleshooting.md). |
| Pre-change snapshot | `SNAPSHOT_URL` + token | Best-effort restore point taken before the first write of a session. See `SNAPSHOT_URL` under [Hosting](#hosting-http-transport). |

Everything above this section (generic, convenience, docs, dev, and extension-management tools) is fully available to self-hosters; only these two are reserved to managed hosting. The MCP source itself is source-available but proprietary (see [License](#license)).

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `FLARUM_URL` | yes | Your forum's base URL, e.g. `https://discuss.example.com` |
| `FLARUM_API_KEY` | for writes / private data | A Flarum API key (from the `api_keys` table). Without it, only public read access is available. |
| `FLARUM_USER_ID` | optional | Act as this user id when using a master API key |
| `FLARUM_MODE` | optional | `write` (default) or `read`. In `read` mode the server refuses every mutating request (create/update/delete and any non-GET `flarum_request`) and the write tools are hidden. `READ_ONLY=1` does the same. Use it to point an AI at a real forum without risking changes. |
| `FLARUM_EXTENSIONS` | optional | `1`/`true` registers the extension-management tools (install/update/remove extensions via `flarum/extension-manager`). Off by default; requires write mode and an admin key. See [Managing extensions](#managing-extensions). |
| `FLARUM_DOCS` | optional | On by default. Set `0`/`false`/`off` to hide the official-docs tools (`flarum_docs_search`/`get`/`list`). They read the public docs only, never your forum. |
| `FLARUM_DEV` | optional | On by default. Set `0`/`false`/`off` to hide the extension-development reference tool (`flarum_dev`). Static guidance; never touches your forum. |
| `FLARUM_TIMEOUT` | optional | Request timeout in ms (default 30000) |
| `FLARUM_USER_AGENT` | optional | Override the `User-Agent` sent to your forum. Defaults to `mcp-for-flarum/<version> (+repo url)`. See [Behind Cloudflare or a WAF](#behind-cloudflare-or-a-waf). |

### Behind Cloudflare or a WAF

Many Flarum forums sit behind Cloudflare. Some WAF configurations block requests whose `User-Agent` looks scripted or empty, returning **Cloudflare error 1010** (`browser_signature_banned`) before the request ever reaches Flarum. The server sends a descriptive, identifiable User-Agent by default for exactly this reason, so the common case works out of the box.

If your forum still blocks it, allowlist the tool rather than loosening your firewall:

- **Allowlist the User-Agent.** In Cloudflare, add a WAF rule like `User-Agent contains "mcp-for-flarum"` → *Skip* / *Allow*. The default UA is `mcp-for-flarum/<version> (+https://github.com/linkrobins/mcp-for-flarum)`.
- **Or allowlist the server IP** (best for a hosted/single-source deployment).
- **Or set a custom UA** with `FLARUM_USER_AGENT` to match an existing allow rule.

Do not work around this by spoofing a browser User-Agent: it is fragile and makes the traffic impossible to allowlist or audit.

### Getting an API key

Flarum has no admin UI for API keys yet. Create one directly in the database:

```sql
INSERT INTO api_keys (`key`, user_id, created_at)
VALUES (REPLACE(UUID(), '-', ''), 1, NOW());
```

Use the resulting `key` as `FLARUM_API_KEY`. Setting `user_id` (or `FLARUM_USER_ID`) makes the key act as that user, so its permissions are exactly that user's permissions.

### Managing extensions

Set `FLARUM_EXTENSIONS=1` to let the AI install, update, remove, enable, and disable extensions. This is **off by default** because it runs Composer on your server and can change what code your forum runs, which is far more powerful than editing content. It requires all of:

- The official [`flarum/extension-manager`](https://github.com/flarum/extension-manager) installed and enabled on the forum.
- Write mode (not `FLARUM_MODE=read`) and an API key whose user is an **admin**.
- A server that can actually run Composer: the PHP functions `proc_open` and `escapeshellarg` available, and `vendor/`, `storage/`, `composer.json`, and `composer.lock` writable.

How long-running installs are reported depends on your forum's queue:

- **Background queue** (Redis, database, etc. with a running worker): the call returns once the job finishes. The tools poll the manager's task list for you and return the Composer output. If no worker is consuming jobs, the call times out and says so rather than hanging.
- **Synchronous** (`sync` queue, or the manager's "run jobs in background" setting off): the request blocks until Composer finishes and returns the result inline. Very large updates can hit PHP/gateway timeouts even though Composer keeps running.

`flarum_ext_install` does not enable the extension unless you pass `enable: true`. Use `flarum_ext_why_not` first to confirm a package is compatible with your Flarum version. For bulk or major updates, take a backup first.

**Enabling can break a forum.** The manager refuses to install an extension whose published Flarum compatibility doesn't match your version, but that check is best-effort: it reads the latest stable release's declared `flarum/core` constraint, is skipped when Packagist is unreachable or the package declares nothing, and the version Composer actually installs can differ from the one it checked. So an extension can pass the check and still fail to boot when enabled, taking the whole site down (every page, including the admin panel and this tool's own API, starts returning a 500). The manager cannot then disable it for you: recovery means removing the extension from the `extensions_enabled` setting in the database and `composer remove`-ing it by hand. This is why install does not auto-enable by default, and why a backup before enabling unfamiliar extensions is worth it.

## Install & run

Self-host it with the official Docker image, or build it from source. (It is intentionally **not** published to npm.)

### Option 1: Docker (recommended)

For a local Claude client (stdio):

```bash
docker run -i --rm \
  -e FLARUM_URL=https://discuss.example.com \
  -e FLARUM_API_KEY=xxxxx \
  ghcr.io/linkrobins/mcp-for-flarum
```

Claude Code:

```bash
claude mcp add flarum -- docker run -i --rm -e FLARUM_URL=https://discuss.example.com -e FLARUM_API_KEY=xxxxx ghcr.io/linkrobins/mcp-for-flarum
```

Claude Desktop / Cursor / Windsurf (JSON config):

```json
{
  "mcpServers": {
    "flarum": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "FLARUM_URL", "-e", "FLARUM_API_KEY", "ghcr.io/linkrobins/mcp-for-flarum"],
      "env": {
        "FLARUM_URL": "https://discuss.example.com",
        "FLARUM_API_KEY": "xxxxx"
      }
    }
  }
}
```

### Option 2: From source (no Docker)

```bash
git clone https://github.com/linkrobins/mcp-for-flarum.git
cd mcp-for-flarum
npm install && npm run build
FLARUM_URL=https://discuss.example.com FLARUM_API_KEY=xxxxx node dist/index.js
```

Then point your client's `command` at `node /absolute/path/to/mcp-for-flarum/dist/index.js`.

### Prefer not to run anything?

A managed, hosted version is offered by Link Robins, no install, no key management, and usable from web clients. See [linkrobins.com](https://linkrobins.com).

## Hosting (HTTP transport)

The same binary can run as a long-lived web service over **Streamable HTTP**, so you can host it instead of running it locally. This is what web-based clients (which can't spawn a local process) connect to.

Start in HTTP mode with `--http` (or `MCP_TRANSPORT=http`):

```bash
FLARUM_URL=https://discuss.example.com \
FLARUM_API_KEY=xxxxx \
MCP_AUTH_TOKEN=a-long-random-secret \
PORT=3000 \
node dist/index.js --http
```

It serves:

- `POST /mcp`, the MCP endpoint (Streamable HTTP, stateless)
- `GET /health`, health check for load balancers / uptime monitors

Hosting-specific configuration:

| Variable | Default | Description |
| --- | --- | --- |
| `MCP_TRANSPORT` | `stdio` | Set to `http` to run the web service (or pass `--http`) |
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. Fails closed: it **refuses to bind a non-localhost address unless `MCP_AUTH_TOKEN` is set**. To expose it (e.g. in Docker), set `HOST=0.0.0.0` and a token. |
| `MCP_AUTH_TOKEN` | _(none)_ | If set, requests must send `Authorization: Bearer <token>`. Required to expose a non-localhost interface. |
| `SNAPSHOT_URL` | _(none)_ | Optional managed-hosting hook. When set, the server fires a best-effort `POST` here before the **first write** in a session, so a restore point can be taken before AI-driven edits. Failures never block writes; unset for self-hosters. |
| `SNAPSHOT_TOKEN` | `MCP_AUTH_TOKEN` | Bearer token sent with the `SNAPSHOT_URL` ping. Defaults to `MCP_AUTH_TOKEN`. |

> Security: a hosted instance can read, write, and delete on the forum its key targets. Always run it behind TLS, set `MCP_AUTH_TOKEN` (or front it with your own auth/OAuth proxy), and give the API key's user the least privilege it needs. The Flarum API key stays server-side and is never exposed to clients.

### Docker (hosted mode)

```bash
docker run -p 3000:3000 \
  -e MCP_TRANSPORT=http \
  -e HOST=0.0.0.0 \
  -e FLARUM_URL=https://discuss.example.com \
  -e FLARUM_API_KEY=xxxxx \
  -e MCP_AUTH_TOKEN=a-long-random-secret \
  ghcr.io/linkrobins/mcp-for-flarum
```

`HOST=0.0.0.0` is needed so the published port is reachable; the server only allows it because `MCP_AUTH_TOKEN` is set.

Or use the included [`docker-compose.yml`](docker-compose.yml): set your values and `docker compose up -d`.

## Development

```bash
npm install
npm run build
FLARUM_URL=... FLARUM_API_KEY=... node dist/index.js
```

## License

Source-available and proprietary. Copyright (c) 2026 Link Robins. You may self-host and run it for your own use; you may not redistribute it or provide it to others as a hosted service. Link Robins is the only entity permitted to offer it as a hosted service. See [LICENSE](LICENSE) for the full terms.

> **No third-party hosting.** MCP directories, registries, and aggregators (for example Glama, Smithery, and similar platforms) may index and link to this repository, but may not build-and-run, "install", deploy, sandbox, or otherwise expose a hosted or remote instance of this server to their users. Hosting and running it as a service for third parties is reserved to Link Robins (LICENSE sections 2(b) and 4). See [NOTICE](NOTICE).

## Trademarks

Flarum is a trademark of the Flarum Foundation. This is an independent project that works *with* Flarum via its API; it is not affiliated with, endorsed by, or sponsored by the Flarum Foundation.
