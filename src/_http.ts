/**
 * HTTP transport layer with security-first defaults.
 *
 * Every request the SDK makes goes through `HttpClient`. The defaults
 * here are conservative: a customer who installs `ocrqueen` and types
 * `client.extract.create(...)` cannot accidentally end up:
 *
 *   - sending their API key over plaintext HTTP
 *   - hanging indefinitely on a slow server
 *   - leaking their API key into logs / JSON.stringify / inspect output
 *   - following a redirect to an attacker-controlled host
 *   - having TLS certificate verification disabled (impossible to
 *     disable here — there is no opt-out in the API)
 *
 * Each section below explains the threat it mitigates so future edits
 * don't quietly weaken the posture.
 *
 * Mirror of the Python SDK's `ocrqueen/_http.py`.
 */

import { inspect } from "node:util";

import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  InsufficientBalanceError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "./_errors.js";
import { VERSION } from "./version.js";

// ── Defaults ────────────────────────────────────────────────────────

export const DEFAULT_BASE_URL = "https://api.ocrqueen.com";

/**
 * Total request timeout in milliseconds. Native fetch uses a single
 * `AbortSignal` for the whole operation rather than per-phase timeouts
 * like httpx — keep this conservative.
 */
export const DEFAULT_TIMEOUT_MS = 60_000;

// API key format check. Modern OCRQueen keys are `pk_<32+ chars>`. We
// also accept the legacy `pk_live_` / `pk_test_` prefixes for customers
// who haven't rotated. Anything else is rejected client-side so a typo
// never reaches the wire (and never lands in third-party request logs).
const API_KEY_RE = /^pk_(live_|test_)?[A-Za-z0-9_-]{20,128}$/;

// ── Public types ────────────────────────────────────────────────────

export interface HttpClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  userAgentSuffix?: string;
}

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  jsonBody?: unknown;
  formBody?: FormData;
  idempotencyKey?: string;
  /** Extra headers. Cannot override Authorization or Host. */
  extraHeaders?: Record<string, string>;
}

// ── HttpClient ──────────────────────────────────────────────────────

/**
 * Thin wrapper over native `fetch` that enforces SDK invariants.
 *
 * Critical security invariants (each one has a test in
 * `tests/http.test.ts`):
 *
 *   I1  `baseUrl` MUST start with `https://`. Plain http is rejected.
 *   I2  TLS certificate verification is ON. We do not pass any agent
 *       or dispatcher that could disable it; native fetch validates
 *       by default.
 *   I3  The `Authorization` header is set on every request from the
 *       stored apiKey. We do not accept it as a per-call override —
 *       that would invite key leakage via headers param confusion.
 *   I4  `inspect(this)` and any error message NEVER contain the apiKey.
 *   I5  Redirects are NOT followed (`redirect: "manual"`). A 30x from
 *       our API to a different host would otherwise leak the auth
 *       header to that host.
 *   I6  Every request has an `AbortSignal.timeout(...)` — no infinite waits.
 */
export class HttpClient {
  // Single-underscore name + #-prefixed runtime field-like via a closure.
  // We store the key on the instance but redact it from inspect / JSON.
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #userAgent: string;

  constructor(opts: HttpClientOptions) {
    // ── Validate apiKey ──────────────────────────────────────────
    if (typeof opts.apiKey !== "string") {
      throw new ValidationError("apiKey must be a string");
    }
    const apiKey = opts.apiKey.trim();
    if (!API_KEY_RE.test(apiKey)) {
      throw new ValidationError(
        "apiKey has unexpected format. Expected `pk_...`; get a fresh one " +
          "from https://ocrqueen.com/dashboard/keys",
      );
    }
    this.#apiKey = apiKey;

    // ── I1: validate baseUrl ─────────────────────────────────────
    const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new ValidationError(`baseUrl is not a valid URL: ${baseUrl}`);
    }
    if (parsed.protocol !== "https:") {
      throw new ValidationError(`baseUrl must use https:// scheme, got ${parsed.protocol}`);
    }
    if (!parsed.hostname) {
      throw new ValidationError("baseUrl must include a hostname");
    }
    // Strip trailing slash so path concat is predictable.
    this.#baseUrl = baseUrl.replace(/\/+$/, "");

    // ── I6: timeout ──────────────────────────────────────────────
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new ValidationError("timeoutMs must be a positive number");
    }
    this.#timeoutMs = timeoutMs;

    // ── User-Agent ───────────────────────────────────────────────
    // ASCII-only suffix capped at 64 chars so it can't be used to
    // smuggle a CRLF and inject a separate header downstream.
    let ua = `ocrqueen-node/${VERSION} node/${process.versions.node}`;
    if (opts.userAgentSuffix) {
      const cleaned = opts.userAgentSuffix.replace(/[^A-Za-z0-9._/+-]/g, "").slice(0, 64);
      if (cleaned) ua = `${ua} ${cleaned}`;
    }
    this.#userAgent = ua;
  }

  /**
   * Send a single request. Maps transport + HTTP errors onto the SDK
   * exception hierarchy.
   */
  async request(opts: RequestOptions): Promise<Response> {
    // ── Build URL + query ────────────────────────────────────────
    const url = new URL(opts.path, `${this.#baseUrl}/`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }

    // ── Build headers ────────────────────────────────────────────
    // I3: Authorization is set HERE and nowhere else. extraHeaders is
    // checked for collisions before merging.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      "User-Agent": this.#userAgent,
      Accept: "application/json",
    };
    if (opts.extraHeaders) {
      for (const k of Object.keys(opts.extraHeaders)) {
        const lower = k.toLowerCase();
        if (lower === "authorization" || lower === "host") {
          throw new ValidationError(
            `extraHeaders cannot override ${k}; use the SDK constructor instead`,
          );
        }
      }
      Object.assign(headers, opts.extraHeaders);
    }
    if (opts.idempotencyKey) {
      headers["Idempotency-Key"] = opts.idempotencyKey;
    }

    // ── Build body ───────────────────────────────────────────────
    let body: BodyInit | null = null;
    if (opts.jsonBody !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.jsonBody);
    } else if (opts.formBody) {
      // `Content-Type` is set automatically by fetch when body is
      // FormData — including the multipart boundary. Setting it
      // manually here would BREAK the boundary, so don't.
      body = opts.formBody;
    }

    // ── I6 + I5: timeout + manual redirects ──────────────────────
    const signal = AbortSignal.timeout(this.#timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: opts.method,
        headers,
        body,
        redirect: "manual",
        signal,
      });
    } catch (err) {
      // Map AbortError → APITimeoutError, everything else → APIConnectionError.
      // We don't include the error message verbatim — it can carry the
      // full URL and we want to keep auth out of stringified errors.
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new APITimeoutError(`Request to ${opts.path} timed out`);
      }
      if (err instanceof Error) {
        // Strip any leak risk: only the error name + path go into the
        // public message, not raw `err.message` (which on some Node
        // versions includes URL with query strings).
        throw new APIConnectionError(`Connection error for ${opts.path} (${err.name})`);
      }
      throw new APIConnectionError(`Connection error for ${opts.path}`);
    }

    if (response.status >= 400) {
      await this.#raiseForStatus(response);
    }
    return response;
  }

  /** Map an HTTP error response onto the SDK exception hierarchy. */
  async #raiseForStatus(response: Response): Promise<never> {
    const requestId = response.headers.get("x-request-id") ?? undefined;
    let errorCode: string | undefined;
    let message = `HTTP ${response.status}`;

    // Best-effort body parse. A hostile proxy might return HTML; guard.
    try {
      const cloned = response.clone();
      const body = (await cloned.json()) as unknown;
      if (body && typeof body === "object") {
        const obj = body as Record<string, unknown>;
        const err = obj["error"];
        if (err && typeof err === "object") {
          const errObj = err as Record<string, unknown>;
          if (typeof errObj["code"] === "string") errorCode = errObj["code"];
          if (typeof errObj["message"] === "string") message = errObj["message"];
        } else if (typeof obj["detail"] === "string") {
          message = obj["detail"];
          // FastAPI default: detail starts with CODE: rest of message
          const head = obj["detail"].split(":", 1)[0]?.trim();
          if (head) errorCode = head;
        }
      }
    } catch {
      // Not JSON — leave defaults.
    }

    const ctx = { statusCode: response.status, errorCode, requestId };
    switch (response.status) {
      case 400:
        throw new BadRequestError(message, ctx);
      case 401:
        throw new AuthenticationError(message, ctx);
      case 402: {
        const bal = response.headers.get("x-wallet-balance-cents");
        const balanceCents = bal ? Number.parseInt(bal, 10) : undefined;
        throw new InsufficientBalanceError(message, {
          ...ctx,
          balanceCents: Number.isFinite(balanceCents) ? balanceCents : undefined,
        });
      }
      case 403:
        throw new PermissionDeniedError(message, ctx);
      case 404:
        throw new NotFoundError(message, ctx);
      case 429: {
        const retry = response.headers.get("retry-after");
        const retryAfterSeconds = retry ? Number.parseInt(retry, 10) : undefined;
        throw new RateLimitError(message, {
          ...ctx,
          retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
        });
      }
      default:
        if (response.status >= 500) throw new ServerError(message, ctx);
        throw new APIError(message, ctx);
    }
  }

  // ── I4 — apiKey never appears in inspect/JSON/log output ──────────

  /** node's `util.inspect` calls this when present — redact the key. */
  [inspect.custom](): string {
    return `HttpClient { baseUrl: ${JSON.stringify(this.#baseUrl)}, apiKey: '<redacted>' }`;
  }

  /** `JSON.stringify(client)` calls this — same redaction. */
  toJSON(): Record<string, string> {
    return { baseUrl: this.#baseUrl, apiKey: "<redacted>" };
  }

  // Buffer is imported to make sure tree-shakers don't accidentally
  // miss the reference in conditional code paths. Trivially used here.
  static _buffer = Buffer;
}
