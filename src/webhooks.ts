/**
 * Webhook signature verification — public helper for customers.
 *
 * OCRQueen signs every outbound webhook (`extraction.completed`,
 * `extraction.failed`) with an HMAC-SHA256 over the raw body, keyed by
 * the webhook endpoint's signing secret. The signature ships in the
 * `OCRQueen-Signature` header as `sha256=<hex>`.
 *
 * CUSTOMER USAGE:
 *
 *     import { verifyWebhook } from "ocrqueen";
 *
 *     app.post("/webhook", async (req, res) => {
 *       const sig = req.headers["ocrqueen-signature"] ?? "";
 *       if (!verifyWebhook(req.rawBody, sig, { secret: MY_WEBHOOK_SECRET })) {
 *         return res.status(401).end();
 *       }
 *       // safe to act on the payload
 *     });
 *
 * SECURITY RULES (every one has a test):
 *
 *   1. ALWAYS use the RAW request body — do NOT `JSON.parse` and re-
 *      stringify; that re-serialization changes byte order/spacing and
 *      breaks the HMAC.
 *   2. Comparison is constant-time via `crypto.timingSafeEqual` to
 *      defeat timing attacks.
 *   3. Returns `false` (NEVER throws) on every failure mode: missing
 *      signature, malformed header, wrong-length sig, secret typo,
 *      body tampered. The handler can then return 401 cleanly.
 *   4. The secret is never logged or echoed in any output.
 *
 * Mirror of the Python SDK's `ocrqueen/webhooks.py`.
 */

import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyWebhookOptions {
  secret: string;
}

const HEX_RE = /^[0-9a-f]+$/i;
const SHA256_HEX_LEN = 64;

/**
 * Verify the `OCRQueen-Signature` header against the raw body.
 *
 * @param body Raw request body bytes — NOT a re-serialized JSON value.
 *   Strings are accepted for ergonomics (some frameworks expose
 *   `req.body` as a string before parsing) but are encoded as UTF-8.
 * @param signatureHeader The `OCRQueen-Signature` header value. Accepts
 *   either `sha256=<hex>` (canonical) or a bare hex digest.
 * @returns `true` iff the signature matches; `false` for every other
 *   case. Never throws.
 */
export function verifyWebhook(
  body: Buffer | Uint8Array | string,
  signatureHeader: string,
  opts: VerifyWebhookOptions,
): boolean {
  // Type guards — return false on garbage rather than throw.
  if (typeof signatureHeader !== "string" || signatureHeader.length === 0) {
    return false;
  }
  if (!opts || typeof opts.secret !== "string" || opts.secret.length === 0) {
    return false;
  }

  // Normalize body to a Buffer.
  let bodyBuf: Buffer;
  if (typeof body === "string") {
    bodyBuf = Buffer.from(body, "utf-8");
  } else if (body instanceof Uint8Array) {
    bodyBuf = Buffer.from(body);
  } else {
    return false;
  }

  // Strip canonical prefix; tolerate the legacy bare-hex form.
  let candidate = signatureHeader.trim();
  if (candidate.startsWith("sha256=")) {
    candidate = candidate.slice("sha256=".length);
  }
  // Cheap pre-check: must be exactly 64 hex chars before we touch HMAC.
  if (candidate.length !== SHA256_HEX_LEN || !HEX_RE.test(candidate)) {
    return false;
  }

  const expected = createHmac("sha256", opts.secret).update(bodyBuf).digest("hex");

  // Buffers of equal length are required by timingSafeEqual; we already
  // enforced both are 64 chars.
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(candidate.toLowerCase(), "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
