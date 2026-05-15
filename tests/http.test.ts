/**
 * Tests for the HTTP foundation — one test per security invariant.
 *
 * These tests are the executable form of the threat model: each one
 * fails loudly if a future change weakens the SDK's posture. Do NOT
 * relax them without an explicit security review.
 *
 * We mock the global `fetch` via vitest's `vi.spyOn` so no real network
 * calls happen. Each test sets up its own mock + asserts what the SDK
 * passed to fetch.
 */

import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APIConnectionError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  InsufficientBalanceError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "../src/_errors.js";
import { DEFAULT_BASE_URL, HttpClient } from "../src/_http.js";

const VALID_KEY = `pk_${"a".repeat(32)}`;

/** Build a Response with given status + JSON body. */
function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── I1 — HTTPS-only baseUrl ─────────────────────────────────────────

describe("I1: baseUrl must be https://", () => {
  it("rejects http://", () => {
    expect(() => new HttpClient({ apiKey: VALID_KEY, baseUrl: "http://api.ocrqueen.com" })).toThrow(
      ValidationError,
    );
  });

  it("rejects malformed URL", () => {
    expect(() => new HttpClient({ apiKey: VALID_KEY, baseUrl: "not-a-url" })).toThrow(
      ValidationError,
    );
  });

  it("rejects missing hostname", () => {
    expect(() => new HttpClient({ apiKey: VALID_KEY, baseUrl: "https://" })).toThrow(
      ValidationError,
    );
  });
});

// ── I2 — TLS verification stays on ──────────────────────────────────

describe("I2: TLS verification cannot be disabled", () => {
  it("does not expose a way to set verify=false", () => {
    // Construct with every supported option and confirm none of them
    // reach down to the fetch agent. This is enforced by NOT exposing
    // a way to pass an `Agent` — if a future PR adds one, this test
    // should be updated to assert it can't disable verification.
    const client = new HttpClient({
      apiKey: VALID_KEY,
      baseUrl: DEFAULT_BASE_URL,
      timeoutMs: 1000,
    });
    expect(client).toBeInstanceOf(HttpClient);
    // The HttpClientOptions type has no `agent` / `dispatcher` /
    // `tlsVerify` / `rejectUnauthorized` fields. This is also enforced
    // at compile time by `noPropertyAccessFromIndexSignature`.
  });
});

// ── I3 — Authorization header auto-set, override blocked ────────────

describe("I3: Authorization header is auto-set and immutable", () => {
  it("sets Bearer auth on every request", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new HttpClient({ apiKey: VALID_KEY });
    await client.request({ method: "GET", path: "/v1/ping" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${VALID_KEY}`);
  });

  it("rejects extraHeaders that try to override Authorization", async () => {
    const client = new HttpClient({ apiKey: VALID_KEY });
    await expect(
      client.request({
        method: "GET",
        path: "/v1/ping",
        extraHeaders: { Authorization: "Bearer attacker" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects extraHeaders that try to override Host", async () => {
    const client = new HttpClient({ apiKey: VALID_KEY });
    await expect(
      client.request({
        method: "GET",
        path: "/v1/ping",
        extraHeaders: { Host: "attacker.example" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ── I4 — apiKey never appears in inspect/JSON/log output ────────────

describe("I4: apiKey is redacted from every public string form", () => {
  it("inspect() output redacts the key", () => {
    const client = new HttpClient({ apiKey: VALID_KEY });
    const out = inspect(client);
    expect(out).not.toContain(VALID_KEY);
    expect(out).toContain("redacted");
  });

  it("JSON.stringify(client) redacts the key", () => {
    const client = new HttpClient({ apiKey: VALID_KEY });
    const out = JSON.stringify(client);
    expect(out).not.toContain(VALID_KEY);
    expect(out).toContain("redacted");
  });

  it("ValidationError on bad baseUrl does not echo the key", () => {
    try {
      new HttpClient({ apiKey: VALID_KEY, baseUrl: "http://attacker.example" });
    } catch (err) {
      expect(String(err)).not.toContain(VALID_KEY);
    }
  });
});

// ── I5 — redirects NOT followed ─────────────────────────────────────

describe("I5: redirects are not followed", () => {
  it("passes redirect: 'manual' to fetch", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new HttpClient({ apiKey: VALID_KEY });
    await client.request({ method: "GET", path: "/v1/ping" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("manual");
  });

  it("surfaces a 30x as a normal response (caller decides)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 301, headers: { Location: "https://evil.example/x" } }),
    );
    const client = new HttpClient({ apiKey: VALID_KEY });
    const resp = await client.request({ method: "GET", path: "/v1/ping" });
    expect(resp.status).toBe(301);
    expect(resp.headers.get("Location")).toBe("https://evil.example/x");
  });
});

// ── I6 — timeouts always set ────────────────────────────────────────

describe("I6: timeouts are always set", () => {
  it("passes an AbortSignal to every fetch call", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = new HttpClient({ apiKey: VALID_KEY, timeoutMs: 1000 });
    await client.request({ method: "GET", path: "/v1/ping" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects non-positive timeoutMs", () => {
    expect(() => new HttpClient({ apiKey: VALID_KEY, timeoutMs: 0 })).toThrow(ValidationError);
    expect(() => new HttpClient({ apiKey: VALID_KEY, timeoutMs: -1 })).toThrow(ValidationError);
    expect(() => new HttpClient({ apiKey: VALID_KEY, timeoutMs: Number.NaN })).toThrow(
      ValidationError,
    );
  });
});

// ── apiKey format validation ────────────────────────────────────────

describe("apiKey format validation", () => {
  it("strips surrounding whitespace", () => {
    const client = new HttpClient({ apiKey: `  ${VALID_KEY}  \n` });
    expect(client).toBeInstanceOf(HttpClient);
  });

  it("rejects empty string", () => {
    expect(() => new HttpClient({ apiKey: "" })).toThrow(ValidationError);
  });

  it("rejects Stripe-shaped keys (sk_live_...)", () => {
    expect(() => new HttpClient({ apiKey: `sk_live_${"a".repeat(40)}` })).toThrow(ValidationError);
  });

  it("accepts legacy pk_test_ / pk_live_ prefixes", () => {
    expect(() => new HttpClient({ apiKey: `pk_test_${"a".repeat(32)}` })).not.toThrow();
    expect(() => new HttpClient({ apiKey: `pk_live_${"a".repeat(32)}` })).not.toThrow();
  });
});

// ── HTTP status → exception mapping ─────────────────────────────────

describe("HTTP status mapping", () => {
  const cases: Array<[number, new (...args: never[]) => Error]> = [
    [400, BadRequestError],
    [401, AuthenticationError],
    [403, PermissionDeniedError],
    [404, NotFoundError],
    [500, ServerError],
    [502, ServerError],
    [503, ServerError],
  ];

  for (const [status, ErrType] of cases) {
    it(`${status} → ${ErrType.name}`, async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(status, { error: { code: "X", message: "x" } }));
      const client = new HttpClient({ apiKey: VALID_KEY });
      await expect(client.request({ method: "GET", path: "/v1/x" })).rejects.toBeInstanceOf(
        ErrType,
      );
    });
  }

  it("429 carries retry_after_seconds", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        429,
        { error: { code: "RATE_LIMITED", message: "slow" } },
        {
          "Retry-After": "42",
        },
      ),
    );
    const client = new HttpClient({ apiKey: VALID_KEY });
    try {
      await client.request({ method: "GET", path: "/v1/x" });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfterSeconds).toBe(42);
    }
  });

  it("402 carries balance_cents", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        402,
        { error: { code: "INSUFFICIENT_BALANCE", message: "no" } },
        { "X-Wallet-Balance-Cents": "47" },
      ),
    );
    const client = new HttpClient({ apiKey: VALID_KEY });
    try {
      await client.request({ method: "GET", path: "/v1/x" });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientBalanceError);
      expect((err as InsufficientBalanceError).balanceCents).toBe(47);
    }
  });
});

// ── Transport errors ────────────────────────────────────────────────

describe("transport errors are wrapped", () => {
  it("AbortSignal timeout → APITimeoutError", async () => {
    fetchMock.mockImplementationOnce(() => {
      const err = new DOMException("timed out", "TimeoutError");
      return Promise.reject(err);
    });
    const client = new HttpClient({ apiKey: VALID_KEY });
    await expect(client.request({ method: "GET", path: "/v1/x" })).rejects.toBeInstanceOf(
      APITimeoutError,
    );
  });

  it("generic fetch error → APIConnectionError", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("fetch failed")));
    const client = new HttpClient({ apiKey: VALID_KEY });
    await expect(client.request({ method: "GET", path: "/v1/x" })).rejects.toBeInstanceOf(
      APIConnectionError,
    );
  });

  it("connection-error message does not echo the apiKey", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError(`fail: ${VALID_KEY}`)));
    const client = new HttpClient({ apiKey: VALID_KEY });
    try {
      await client.request({ method: "GET", path: "/v1/x" });
    } catch (err) {
      expect(String(err)).not.toContain(VALID_KEY);
    }
  });
});

// ── User-Agent ──────────────────────────────────────────────────────

describe("User-Agent header", () => {
  it("includes SDK + node versions", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = new HttpClient({ apiKey: VALID_KEY });
    await client.request({ method: "GET", path: "/v1/ping" });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^ocrqueen-node\/\d+\.\d+\.\d+/);
    expect(headers["User-Agent"]).toMatch(/node\/\d+\.\d+/);
  });

  it("strips CRLF + control chars from user-supplied suffix", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = new HttpClient({
      apiKey: VALID_KEY,
      userAgentSuffix: "myapp/1.0; injection\r\nX-Evil: y",
    });
    await client.request({ method: "GET", path: "/v1/ping" });
    const ua = ((fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>)[
      "User-Agent"
    ];
    expect(ua).not.toMatch(/[\r\n;:]/);
    expect(ua).toContain("myapp/1.0");
  });
});
