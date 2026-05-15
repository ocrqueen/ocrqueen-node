/**
 * Exception hierarchy for the SDK.
 *
 * Every error this SDK throws extends `OCRQueenError`, so callers can
 * catch the family with a single check. Specific subclasses let them
 * branch on the recoverable cases (rate limit, insufficient balance)
 * without parsing message strings.
 *
 * SECURITY RULE: an error MUST NEVER carry the customer's API key in
 * any form. Many bug reports include `JSON.stringify(err)` or
 * `console.log(err)` — leaking the key there is a silent credential
 * exposure. We assert this in the test suite.
 *
 * Mirror of the Python SDK's `ocrqueen/_errors.py`.
 */

/**
 * Optional structured context every SDK error carries.
 *
 * Fields are typed `T | undefined` rather than `T?` so callers can pass
 * `undefined` directly under `exactOptionalPropertyTypes`. Semantically
 * equivalent; just lets the call sites stay terse.
 */
export interface ErrorContext {
  /** HTTP status — undefined for transport-level errors. */
  statusCode: number | undefined;
  /** OCRQueen error code from the response body (e.g. `RATE_LIMITED`). */
  errorCode: string | undefined;
  /** X-Request-ID echoed by the API — gold for support tickets. */
  requestId: string | undefined;
}

const EMPTY_CTX: ErrorContext = {
  statusCode: undefined,
  errorCode: undefined,
  requestId: undefined,
};

/** Base for every exception this SDK raises. */
export class OCRQueenError extends Error {
  readonly statusCode: number | undefined;
  readonly errorCode: string | undefined;
  readonly requestId: string | undefined;

  constructor(message: string, ctx: ErrorContext = EMPTY_CTX) {
    super(message);
    // The `.name` property is what Node prints in stack traces — keep
    // it tight (one class per name).
    this.name = this.constructor.name;
    this.statusCode = ctx.statusCode;
    this.errorCode = ctx.errorCode;
    this.requestId = ctx.requestId;
  }
}

// ── Transport / network ────────────────────────────────────────────

/**
 * Could not reach the API at all — DNS failure, TCP reset, TLS
 * handshake failure. Retry is generally safe (we haven't sent anything
 * the server might have processed).
 */
export class APIConnectionError extends OCRQueenError {}

/**
 * Request did not complete within the configured timeout. Retry is
 * safe ONLY for idempotent operations (GET, or POST with an
 * Idempotency-Key); otherwise the server may have started processing
 * and a blind retry could double-bill.
 */
export class APITimeoutError extends APIConnectionError {}

// ── HTTP-layer ─────────────────────────────────────────────────────

/** Generic 4xx/5xx response that doesn't fit a specific subclass. */
export class APIError extends OCRQueenError {}

/** 401 — API key missing, malformed, or revoked. NOT retryable. */
export class AuthenticationError extends APIError {}

/** 403 — key valid but lacks the scope needed for this call. NOT retryable. */
export class PermissionDeniedError extends APIError {}

/** 404 — resource doesn't exist (or belongs to a different customer). */
export class NotFoundError extends APIError {}

/** 400 — request rejected before processing (bad MIME, options, etc.). */
export class BadRequestError extends APIError {}

/** 5xx — server-side problem. Retryable for idempotent operations only. */
export class ServerError extends APIError {}

/**
 * 429 — too many requests in the current window. Carries
 * `retryAfterSeconds` from the Retry-After header.
 */
export class RateLimitError extends APIError {
  readonly retryAfterSeconds: number | undefined;
  constructor(
    message: string,
    ctx: ErrorContext & { retryAfterSeconds: number | undefined } = {
      ...EMPTY_CTX,
      retryAfterSeconds: undefined,
    },
  ) {
    super(message, ctx);
    this.retryAfterSeconds = ctx.retryAfterSeconds;
  }
}

/**
 * 402 — wallet balance below the cost of this request. Carries
 * `balanceCents` from the X-Wallet-Balance-Cents header.
 */
export class InsufficientBalanceError extends APIError {
  readonly balanceCents: number | undefined;
  constructor(
    message: string,
    ctx: ErrorContext & { balanceCents: number | undefined } = {
      ...EMPTY_CTX,
      balanceCents: undefined,
    },
  ) {
    super(message, ctx);
    this.balanceCents = ctx.balanceCents;
  }
}

// ── Validation (raised client-side BEFORE any network call) ────────

/**
 * A constructor or method argument failed local validation before any
 * network call. Examples: an `apiKey` that doesn't match `pk_...`,
 * a `baseUrl` that isn't `https://`, a file path that doesn't exist.
 *
 * We raise this client-side so customers see an immediate clear error
 * rather than a confusing 401 or 400 round-trip.
 */
export class ValidationError extends OCRQueenError {}
