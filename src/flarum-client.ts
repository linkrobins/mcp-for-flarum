/**
 * Thin wrapper around the Flarum JSON:API.
 *
 * Flarum exposes every resource (discussions, posts, users, tags, groups,
 * notifications, flags, settings, and any third-party extension resource)
 * through one uniform JSON:API at `{baseUrl}/api`. This client speaks that
 * protocol generically, so the MCP tools on top of it cover the whole surface.
 *
 * Auth uses Flarum's API key header:
 *   Authorization: Token <key>; userId=<id>
 * A master key (from the `api_keys` table) can act as any user via userId.
 */

export interface FlarumClientOptions {
  baseUrl: string;
  apiKey?: string;
  /** Act as this user id when using a master API key. */
  userId?: string | number;
  timeoutMs?: number;
  /**
   * When true, the client refuses any mutating request (POST/PUT/PATCH/DELETE).
   * Enforced centrally in request() so no tool -- including the raw
   * flarum_request escape hatch -- can bypass it.
   */
  readOnly?: boolean;
}

export interface FlarumRequestOptions {
  method?: string;
  /** Path relative to the API root, e.g. "/discussions" or "/users/1". */
  path: string;
  /** Query params; arrays/objects are JSON-encoded where Flarum expects it. */
  query?: Record<string, unknown>;
  /** JSON:API request body (already shaped as { data: {...} }), or raw object. */
  body?: unknown;
}

export class FlarumError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "FlarumError";
    this.status = status;
    this.body = body;
  }
}

export class FlarumClient {
  private baseUrl: string;
  private apiKey?: string;
  private userId?: string | number;
  private timeoutMs: number;
  readonly readOnly: boolean;

  constructor(opts: FlarumClientOptions) {
    // Normalise: strip trailing slash, ensure we target the /api root.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.userId = opts.userId;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.readOnly = opts.readOnly ?? false;
  }

  private apiRoot(): string {
    return this.baseUrl.endsWith("/api") ? this.baseUrl : `${this.baseUrl}/api`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.api+json, application/json",
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      let token = `Token ${this.apiKey}`;
      if (this.userId !== undefined && this.userId !== "") {
        token += `; userId=${this.userId}`;
      }
      headers["Authorization"] = token;
    }
    return headers;
  }

  /** Flatten nested query objects into JSON:API's bracketed form. */
  private buildQuery(query?: Record<string, unknown>): string {
    if (!query) return "";
    const params = new URLSearchParams();
    const add = (key: string, value: unknown) => {
      if (value === undefined || value === null) return;
      if (Array.isArray(value)) {
        params.append(key, value.join(","));
      } else if (typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          add(`${key}[${k}]`, v);
        }
      } else {
        params.append(key, String(value));
      }
    };
    for (const [key, value] of Object.entries(query)) add(key, value);
    const s = params.toString();
    return s ? `?${s}` : "";
  }

  async request<T = unknown>(opts: FlarumRequestOptions): Promise<T> {
    const method = (opts.method ?? "GET").toUpperCase();
    const path = opts.path.startsWith("/") ? opts.path : `/${opts.path}`;

    // Read-only guard: the single chokepoint every tool flows through.
    if (this.readOnly && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      throw new Error(
        `Refusing ${method} ${path}: server is in read-only mode. ` +
          `Set FLARUM_MODE=write (and remove READ_ONLY) to allow writes.`,
      );
    }

    const url = `${this.apiRoot()}${path}${this.buildQuery(opts.query)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: this.headers(),
        body:
          opts.body !== undefined && method !== "GET" && method !== "HEAD"
            ? JSON.stringify(opts.body)
            : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: unknown = text;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          /* leave as raw text */
        }
      }

      if (!res.ok) {
        throw new FlarumError(
          `Flarum API ${method} ${path} failed: ${res.status} ${res.statusText}`,
          res.status,
          parsed,
        );
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
