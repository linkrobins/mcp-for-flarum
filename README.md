# Flarum MCP

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

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `FLARUM_URL` | yes | Your forum's base URL, e.g. `https://discuss.example.com` |
| `FLARUM_API_KEY` | for writes / private data | A Flarum API key (from the `api_keys` table). Without it, only public read access is available. |
| `FLARUM_USER_ID` | optional | Act as this user id when using a master API key |
| `FLARUM_TIMEOUT` | optional | Request timeout in ms (default 30000) |

### Getting an API key

Flarum has no admin UI for API keys yet. Create one directly in the database:

```sql
INSERT INTO api_keys (`key`, user_id, created_at)
VALUES (REPLACE(UUID(), '-', ''), 1, NOW());
```

Use the resulting `key` as `FLARUM_API_KEY`. Setting `user_id` (or `FLARUM_USER_ID`) makes the key act as that user, so its permissions are exactly that user's permissions.

## Usage

Run directly with `npx` (no install):

```bash
FLARUM_URL=https://discuss.example.com FLARUM_API_KEY=xxxxx npx -y flarum-mcp
```

### Claude Code

```bash
claude mcp add flarum -- env FLARUM_URL=https://discuss.example.com FLARUM_API_KEY=xxxxx npx -y flarum-mcp
```

### Claude Desktop / Cursor / Windsurf (JSON config)

```json
{
  "mcpServers": {
    "flarum": {
      "command": "npx",
      "args": ["-y", "flarum-mcp"],
      "env": {
        "FLARUM_URL": "https://discuss.example.com",
        "FLARUM_API_KEY": "xxxxx"
      }
    }
  }
}
```

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

- `POST /mcp` — the MCP endpoint (Streamable HTTP, stateless)
- `GET /health` — health check for load balancers / uptime monitors

Hosting-specific configuration:

| Variable | Default | Description |
| --- | --- | --- |
| `MCP_TRANSPORT` | `stdio` | Set to `http` to run the web service (or pass `--http`) |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `MCP_AUTH_TOKEN` | _(none)_ | If set, requests must send `Authorization: Bearer <token>`. **Strongly recommended when hosting** |

> Security: a hosted instance can read, write, and delete on the forum its key targets. Always run it behind TLS, set `MCP_AUTH_TOKEN` (or front it with your own auth/OAuth proxy), and give the API key's user the least privilege it needs. The Flarum API key stays server-side and is never exposed to clients.

### Docker

```bash
docker build -t flarum-mcp .
docker run -p 3000:3000 \
  -e FLARUM_URL=https://discuss.example.com \
  -e FLARUM_API_KEY=xxxxx \
  -e MCP_AUTH_TOKEN=a-long-random-secret \
  flarum-mcp
```

## Development

```bash
npm install
npm run build
FLARUM_URL=... FLARUM_API_KEY=... node dist/index.js
```

## License

MIT
