import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { withStrictInputs } from "../dist/tools/shared.js";
import { FlarumClient } from "../dist/flarum-client.js";
import { registerTools } from "../dist/tools/index.js";

// Register through the wrapper the real server uses, and keep the parsed
// schema so a test can validate arguments exactly as the SDK would.
function registerStrict(client) {
  const tools = new Map();
  const stub = { registerTool: (name, cfg, handler) => tools.set(name, { cfg, handler }) };
  registerTools(withStrictInputs(stub), client);
  return tools;
}
const writeClient = () => new FlarumClient({ baseUrl: "http://forum.test", readOnly: false });

test("an unknown parameter is rejected, not silently dropped", () => {
  const t = registerStrict(writeClient());
  const schema = t.get("flarum_create_discussion").cfg.inputSchema;

  // The exact mistake this guards: `tags` instead of `tagIds`. Previously this
  // parsed clean with the tags discarded, and the caller got a success result
  // plus an untagged discussion on a live forum.
  const bad = schema.safeParse({ title: "t", content: "c", tags: ["announcements"] });
  assert.equal(bad.success, false);
  assert.match(JSON.stringify(bad.error.issues), /unrecognized_keys|tags/i);
});

test("valid arguments still parse, with defaults applied", () => {
  const t = registerStrict(writeClient());

  const discussion = t.get("flarum_create_discussion").cfg.inputSchema.parse({
    title: "t",
    content: "c",
    tagIds: ["2", "19"],
  });
  assert.deepEqual(discussion, { title: "t", content: "c", tagIds: ["2", "19"] });

  // Defaults and clamps survive the wrapping.
  const list = t.get("flarum_list").cfg.inputSchema.parse({ type: "posts" });
  assert.equal(list.limit, 20);
  assert.equal(list.maxFieldChars, 800);
  assert.throws(() => t.get("flarum_list").cfg.inputSchema.parse({ type: "posts", limit: 999 }));
});

test("a no-argument tool still accepts an empty call", () => {
  const t = registerStrict(writeClient());
  assert.deepEqual(t.get("flarum_whoami").cfg.inputSchema.parse({}), {});
});

test("every registered tool ends up with a strict schema", () => {
  const t = registerStrict(writeClient());
  assert.ok(t.size > 0);
  for (const [name, { cfg }] of t) {
    assert.ok(cfg.inputSchema instanceof z.ZodType, `${name} kept a raw shape`);
    assert.equal(cfg.inputSchema._def.unknownKeys, "strict", `${name} is not strict`);
  }
});

test("the advertised JSON Schema is unchanged by wrapping", async () => {
  // Callers see additionalProperties:false either way — only enforcement moves.
  const { default: zodToJson } = await import("zod-to-json-schema").catch(() => ({ default: null }));
  if (!zodToJson) return; // not a dependency; the SDK generates this itself

  const shape = { a: z.string(), b: z.number().optional() };
  assert.deepEqual(zodToJson(z.object(shape)), zodToJson(z.object(shape).strict()));
});

test("the wrapper passes non-registerTool members straight through", () => {
  const target = { registerTool: () => "registered", registerPrompt: () => "prompt", version: "1.2.3" };
  const wrapped = withStrictInputs(target);
  assert.equal(wrapped.registerPrompt(), "prompt");
  assert.equal(wrapped.version, "1.2.3");
});

test("a schema the author already wrote explicitly is left alone", () => {
  let seen;
  const target = { registerTool: (_n, cfg) => (seen = cfg.inputSchema) };
  const passthrough = z.object({ a: z.string() }).passthrough();
  withStrictInputs(target).registerTool("t", { inputSchema: passthrough }, () => {});
  assert.equal(seen, passthrough, "an explicit schema should not be re-wrapped");
});

// The helper working is not the same as the helper being wired in. Drive a real
// server over a real transport and confirm an unknown parameter comes back as
// an error rather than a success with the parameter quietly discarded.
test("a real server rejects an unknown parameter over the wire", async () => {
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { createMcpServer } = await import("../dist/server.js");

  const server = createMcpServer(new FlarumClient({ baseUrl: "http://forum.test", readOnly: false }));
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  // Still advertised as additionalProperties:false, exactly as before.
  const { tools } = await client.listTools();
  const create = tools.find((t) => t.name === "flarum_create_discussion");
  assert.equal(create.inputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(create.inputSchema.properties).sort(), ["content", "tagIds", "title"]);

  const res = await client
    .callTool({ name: "flarum_create_discussion", arguments: { title: "t", content: "c", tags: ["announcements"] } })
    .catch((err) => ({ isError: true, content: [{ text: String(err) }] }));

  assert.equal(res.isError, true, "unknown parameter must not succeed");
  assert.match(JSON.stringify(res.content), /tags|unrecognized/i);

  await client.close();
});
