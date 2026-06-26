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
  /**
   * Optional pre-change snapshot hook (managed hosting). When set, the client
   * pings this URL with `Authorization: Bearer <snapshotToken>` before the FIRST
   * mutating request, so a restore point predates AI-driven edits. Best-effort:
   * failures never block the write. The host side debounces, so calling on every
   * write-bearing request (stateless transport) is safe.
   */
  snapshotUrl?: string;
  snapshotToken?: string;
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
  private snapshotUrl?: string;
  private snapshotToken?: string;
  /** One snapshot trigger per client instance (= per stateless request). */
  private snapshotRequested = false;

  constructor(opts: FlarumClientOptions) {
    // Normalise: strip trailing slash, ensure we target the /api root.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.userId = opts.userId;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.readOnly = opts.readOnly ?? false;
    this.snapshotUrl = opts.snapshotUrl;
    this.snapshotToken = opts.snapshotToken;
  }

  /**
   * Fire a pre-change snapshot request (best-effort, never throws). Called once,
   * before the first write. The host responds fast (it just queues a snapshot)
   * and debounces, so we don't await on the critical path beyond a short cap.
   */
  private triggerSnapshot(): void {
    if (this.snapshotRequested || !this.snapshotUrl || !this.snapshotToken) return;
    this.snapshotRequested = true;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    fetch(this.snapshotUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.snapshotToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: ctrl.signal,
    })
      .catch(() => {
        /* snapshot is a safety net, not a gate: swallow all failures */
      })
      .finally(() => clearTimeout(t));
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

    const mutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

    // Read-only guard: the single chokepoint every tool flows through.
    if (this.readOnly && mutating) {
      throw new Error(
        `Refusing ${method} ${path}: server is in read-only mode. ` +
          `Set FLARUM_MODE=write (and remove READ_ONLY) to allow writes.`,
      );
    }

    // Pre-change safety snapshot: a write is about to happen and is allowed —
    // ask the host for a restore point first (best-effort, once per session).
    if (mutating) this.triggerSnapshot();

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
