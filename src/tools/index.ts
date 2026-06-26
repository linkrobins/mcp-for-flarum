import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FlarumClient, FlarumError } from "../flarum-client.js";

/** Render any value as a tool result, surfacing Flarum API errors cleanly. */
function result(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

function errorResult(err: unknown) {
  if (err instanceof FlarumError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Flarum API error (${err.status}):\n${JSON.stringify(err.body, null, 2)}`,
        },
      ],
    };
  }
  return {
    isError: true,
    content: [
      { type: "text" as const, text: `Error: ${(err as Error).message}` },
    ],
  };
}

export function registerTools(server: McpServer, client: FlarumClient): void {
  // ---- Generic JSON:API tools: full coverage of every resource type ----

  server.registerTool(
    "flarum_list",
    {
      title: "List Flarum resources",
      description:
        "List or search any Flarum resource collection (discussions, posts, users, tags, " +
        "groups, notifications, flags, etc., including third-party extension resources). " +
        "Supports JSON:API filter, include, sort and pagination. " +
        'Example: type="discussions", filter={ q: "search terms" }, include="user,tags".',
      inputSchema: {
        type: z
          .string()
          .describe('Resource type, e.g. "discussions", "posts", "users", "tags", "groups".'),
        filter: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe('JSON:API filters, e.g. { q: "hello", tag: "support" }.'),
        include: z
          .string()
          .optional()
          .describe('Comma-separated relationships to include, e.g. "user,tags".'),
        sort: z.string().optional().describe('Sort, e.g. "-createdAt" or "commentCount".'),
        limit: z.number().int().positive().max(50).optional().describe("Page size (page[limit])."),
        offset: z.number().int().min(0).optional().describe("Page offset (page[offset])."),
      },
    },
    async ({ type, filter, include, sort, limit, offset }) => {
      try {
        const data = await client.request({
          path: `/${type}`,
          query: {
            filter,
            include,
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
    "flarum_get",
    {
      title: "Get a Flarum resource",
      description:
        "Fetch a single Flarum resource by type and id, optionally including relationships. " +
        'Example: type="discussions", id="42", include="posts,user".',
      inputSchema: {
        type: z.string().describe('Resource type, e.g. "discussions", "users".'),
        id: z.string().describe("Resource id."),
        include: z.string().optional().describe("Comma-separated relationships to include."),
      },
    },
    async ({ type, id, include }) => {
      try {
        const data = await client.request({ path: `/${type}/${id}`, query: { include } });
        return result(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_create",
    {
      title: "Create a Flarum resource",
      description:
        "Create any Flarum resource via JSON:API. Provide the resource type, its attributes, " +
        "and optional relationships. Requires an API key whose user has permission. " +
        'Example: type="discussions", attributes={ title, content }, ' +
        'relationships={ tags: { data: [{ type: "tags", id: "1" }] } }.',
      inputSchema: {
        type: z.string().describe('Resource type, e.g. "discussions", "posts".'),
        attributes: z.record(z.string(), z.unknown()).describe("Resource attributes."),
        relationships: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("JSON:API relationships object."),
      },
    },
    async ({ type, attributes, relationships }) => {
      try {
        const data = await client.request({
          method: "POST",
          path: `/${type}`,
          body: { data: { type, attributes, ...(relationships ? { relationships } : {}) } },
        });
        return result(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_update",
    {
      title: "Update a Flarum resource",
      description:
        "Update (PATCH) any Flarum resource by type and id. Used for editing posts/discussions " +
        "and for moderation: lock/sticky a discussion, approve/hide a post, change user groups, etc. " +
        'Example: type="discussions", id="42", attributes={ isLocked: true }.',
      inputSchema: {
        type: z.string().describe("Resource type."),
        id: z.string().describe("Resource id."),
        attributes: z.record(z.string(), z.unknown()).optional().describe("Attributes to change."),
        relationships: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Relationships to change."),
      },
    },
    async ({ type, id, attributes, relationships }) => {
      try {
        const data = await client.request({
          method: "PATCH",
          path: `/${type}/${id}`,
          body: {
            data: {
              type,
              id,
              ...(attributes ? { attributes } : {}),
              ...(relationships ? { relationships } : {}),
            },
          },
        });
        return result(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_delete",
    {
      title: "Delete a Flarum resource",
      description:
        "Delete any Flarum resource by type and id (e.g. delete a post, discussion, or user). " +
        "Irreversible. Requires appropriate permissions on the API key's user.",
      inputSchema: {
        type: z.string().describe("Resource type."),
        id: z.string().describe("Resource id."),
      },
    },
    async ({ type, id }) => {
      try {
        await client.request({ method: "DELETE", path: `/${type}/${id}` });
        return result({ deleted: true, type, id });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_request",
    {
      title: "Raw Flarum API request",
      description:
        "Escape hatch: make an arbitrary request to any Flarum API endpoint, for anything not " +
        "covered by the typed tools (custom extension routes, non-JSON:API endpoints, etc.). " +
        'Path is relative to the API root, e.g. "/discussions" or "/fof/gamification/ranks".',
      inputSchema: {
        method: z
          .enum(["GET", "POST", "PATCH", "PUT", "DELETE"])
          .default("GET")
          .describe("HTTP method."),
        path: z.string().describe('API path relative to /api, e.g. "/users/1".'),
        query: z.record(z.string(), z.unknown()).optional().describe("Query parameters."),
        body: z.unknown().optional().describe("Request body (object), sent as JSON."),
      },
    },
    async ({ method, path, query, body }) => {
      try {
        const data = await client.request({ method, path, query, body });
        return result(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ---- Convenience tools: ergonomic shortcuts for the common operations ----

  server.registerTool(
    "flarum_whoami",
    {
      title: "Current Flarum user",
      description:
        "Return the forum's basic info and the user the configured API key acts as. " +
        "Useful to verify connectivity and permissions.",
      inputSchema: {},
    },
    async () => {
      try {
        const forum = await client.request({ path: "/", query: {} });
        return result(forum);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_search",
    {
      title: "Search discussions",
      description:
        "Full-text search across discussions using Flarum's gambit/search " +
        '(filter[q]). Example: query="upgrade postgres".',
      inputSchema: {
        query: z.string().describe("Search query string."),
        include: z
          .string()
          .optional()
          .default("user,tags,firstPost")
          .describe("Relationships to include."),
        limit: z.number().int().positive().max(50).optional().default(20),
      },
    },
    async ({ query, include, limit }) => {
      try {
        const data = await client.request({
          path: "/discussions",
          query: { filter: { q: query }, include, page: { limit } },
        });
        return result(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_create_discussion",
    {
      title: "Create a discussion",
      description:
        "Start a new discussion (thread) with a title and first-post content. " +
        "Optionally attach tag ids (required by forums that use the Tags extension).",
      inputSchema: {
        title: z.string().describe("Discussion title."),
        content: z.string().describe("First post content (Markdown)."),
        tagIds: z.array(z.string()).optional().describe("Tag ids to attach."),
      },
    },
    async ({ title, content, tagIds }) => {
      try {
        const relationships = tagIds?.length
          ? { tags: { data: tagIds.map((id) => ({ type: "tags", id })) } }
          : undefined;
        const data = await client.request({
          method: "POST",
          path: "/discussions",
          body: {
            data: { type: "discussions", attributes: { title, content }, ...(relationships ? { relationships } : {}) },
          },
        });
        return result(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_reply",
    {
      title: "Reply to a discussion",
      description: "Post a reply (comment) to an existing discussion by its id.",
      inputSchema: {
        discussionId: z.string().describe("Target discussion id."),
        content: z.string().describe("Reply content (Markdown)."),
      },
    },
    async ({ discussionId, content }) => {
      try {
        const data = await client.request({
          method: "POST",
          path: "/posts",
          body: {
            data: {
              type: "posts",
              attributes: { content },
              relationships: { discussion: { data: { type: "discussions", id: discussionId } } },
            },
          },
        });
        return result(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
