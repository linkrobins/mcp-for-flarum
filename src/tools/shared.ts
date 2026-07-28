/**
 * Helpers shared across tool modules: result/error formatting, long-field
 * trimming, and the sparse-fieldset schema. Kept here so the generic tools
 * (tools/index.ts) and the extension-manager tools (tools/extensions.ts) format
 * results and protect the context window identically.
 */

import { z } from "zod";
import { FlarumError } from "../flarum-client.js";

/** Render any value as a tool result, surfacing Flarum API errors cleanly. */
export function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function errorResult(err: unknown) {
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
    content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
  };
}

/**
 * Truncate long string attributes in a JSON:API document to protect the
 * client's context window (and the user's token bill). A forum's post bodies
 * can each be many KB of HTML; returning 50 of them whole is what blows up an
 * agent. maxChars <= 0 disables trimming.
 */
export function trimDoc(doc: unknown, maxChars: number): unknown {
  if (maxChars <= 0 || !doc || typeof doc !== "object") return doc;
  const trimResource = (r: unknown) => {
    const res = r as { attributes?: Record<string, unknown> };
    if (res && typeof res === "object" && res.attributes && typeof res.attributes === "object") {
      for (const [k, v] of Object.entries(res.attributes)) {
        if (typeof v === "string" && v.length > maxChars) {
          res.attributes[k] = `${v.slice(0, maxChars)}... [truncated ${v.length - maxChars} chars]`;
        }
      }
    }
  };
  const d = doc as { data?: unknown; included?: unknown };
  if (Array.isArray(d.data)) d.data.forEach(trimResource);
  else trimResource(d.data);
  if (Array.isArray(d.included)) d.included.forEach(trimResource);
  return doc;
}

export const fieldsSchema = z
  .record(z.string(), z.string())
  .optional()
  .describe(
    "Sparse fieldsets: return only named fields per type to save tokens, " +
      'e.g. { discussions: "title,slug,commentCount", users: "username" }.',
  );

/** The registerTool signature, loosened for the wrapper's internal use. */
type RegisterTool = (name: string, config: Record<string, unknown>, handler: unknown) => unknown;

/**
 * Wrap a server so every tool registered through it validates its arguments as
 * a *strict* object.
 *
 * Each tool already advertises `"additionalProperties": false` in its JSON
 * Schema, but zod's default object mode silently strips unknown keys instead of
 * rejecting them — so the published contract and the enforced behaviour
 * disagree. On a server that writes to a live forum that gap is expensive: a
 * caller that guesses a parameter name (`tags` for `tagIds`, say) gets a
 * success response and a wrong side effect, with nothing saying a parameter was
 * discarded.
 *
 * Strict objects emit byte-identical JSON Schema, so nothing a caller can see
 * changes; only enforcement catches up with what was always advertised.
 *
 * Applied once at the registration boundary rather than at each call site, so
 * no tool — including any added later — can be left out.
 */
export function withStrictInputs<T extends object>(server: T): T {
  return new Proxy(server, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop !== "registerTool" || typeof value !== "function") return value;

      const register = value as RegisterTool;

      return (name: string, config: Record<string, unknown>, handler: unknown) => {
        const shape = config?.inputSchema;
        // Only raw shapes need wrapping. A schema object is already explicit
        // about how it treats unknown keys, so leave the author's choice alone.
        const isRawShape =
          shape !== null && typeof shape === "object" && !(shape instanceof z.ZodType);
        if (!isRawShape) return register.call(target, name, config, handler);

        const inputSchema = z.object(shape as z.ZodRawShape).strict();
        return register.call(target, name, { ...config, inputSchema }, handler);
      };
    },
  });
}
