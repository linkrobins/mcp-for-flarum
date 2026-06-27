import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpServer, buildInstructions } from "../dist/server.js";
import { FlarumClient } from "../dist/flarum-client.js";

// The server-level `instructions` are the strongest server-side lever for
// steering the connected AI toward the built-in tools. They must actually reach
// the client in the initialize response, describe only the capabilities that
// are registered, and ship the workflow prompts. Guard all of that so a future
// refactor can't silently weaken it.

test("buildInstructions always covers the core forum-data tools", () => {
  const none = buildInstructions({ docs: false, dev: false, extensions: false, diagnostics: false });
  assert.ok(none.includes("flarum_whoami"), "must mention whoami");
  assert.ok(none.includes("read-only mode"), "must mention the read-only guard");
  // No capability lines when everything is off.
  for (const k of ["flarum_dev", "flarum_docs", "flarum_ext_", "flarum_triage"]) {
    assert.ok(!none.includes(k), `should not mention ${k} when disabled`);
  }
});

test("buildInstructions adds a directive for each enabled capability", () => {
  const all = buildInstructions({ docs: true, dev: true, extensions: true, diagnostics: true });
  assert.ok(all.includes("flarum_dev"), "dev directive");
  assert.ok(all.includes("build-flarum-extension"), "points at the prompts");
  assert.ok(all.includes("flarum_docs"), "docs directive");
  assert.ok(all.includes("flarum_ext_why_not"), "extensions directive");
  assert.ok(all.includes("flarum_triage"), "diagnostics directive");
});

test("createMcpServer advertises the instructions over a real connection", async () => {
  const server = createMcpServer(new FlarumClient({ baseUrl: "http://forum.test" }));
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const instructions = client.getInstructions();
  assert.ok(instructions && instructions.includes("flarum_dev"), "default build steers to flarum_dev");

  // The workflow prompts ship alongside the dev reference (on by default).
  const { prompts } = await client.listPrompts();
  const names = prompts.map((p) => p.name).sort();
  assert.deepEqual(names, ["build-flarum-extension", "check-flarum-compatibility", "review-flarum-extension"]);

  // A prompt expands into an actionable, on-topic message.
  const built = await client.getPrompt({ name: "build-flarum-extension", arguments: { summary: "a polls feature" } });
  const text = built.messages.map((m) => m.content.text).join("\n");
  assert.ok(text.includes("a polls feature") && text.includes("flarum_dev"), "prompt weaves in args + workflow");

  await client.close();
});
