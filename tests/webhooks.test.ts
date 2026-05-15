/**
 * Tests for the public `verifyWebhook` helper.
 *
 * Each test is the executable form of a security contract. Don't relax
 * them without a security review.
 */

import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyWebhook } from "../src/index.js";

function sign(body: Buffer | string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

// ── Happy paths ─────────────────────────────────────────────────────

describe("verifyWebhook — happy paths", () => {
  it("accepts canonical sha256= header", () => {
    const body = Buffer.from('{"event":"extraction.completed"}');
    expect(verifyWebhook(body, sign(body, "secret"), { secret: "secret" })).toBe(true);
  });

  it("accepts bare hex digest (legacy header form)", () => {
    const body = Buffer.from('{"x":1}');
    const hex = createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyWebhook(body, hex, { secret: "secret" })).toBe(true);
  });

  it("accepts uppercase hex", () => {
    const body = Buffer.from('{"x":1}');
    const upper = createHmac("sha256", "secret").update(body).digest("hex").toUpperCase();
    expect(verifyWebhook(body, `sha256=${upper}`, { secret: "secret" })).toBe(true);
  });

  it("accepts string body (auto-UTF-8 encoded)", () => {
    const body = '{"x":1}';
    expect(verifyWebhook(body, sign(body, "secret"), { secret: "secret" })).toBe(true);
  });

  it("accepts Uint8Array body", () => {
    const body = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x31, 0x7d]); // {"x":1}
    expect(verifyWebhook(body, sign(Buffer.from(body), "secret"), { secret: "secret" })).toBe(true);
  });
});

// ── Security: tampered / forged / wrong secret ─────────────────────

describe("verifyWebhook — rejects tampering", () => {
  it("rejects tampered body", () => {
    const sig = sign(Buffer.from('{"amount":100}'), "secret");
    expect(verifyWebhook('{"amount":10000}', sig, { secret: "secret" })).toBe(false);
  });

  it("rejects wrong secret", () => {
    const body = '{"x":1}';
    expect(verifyWebhook(body, sign(body, "A"), { secret: "B" })).toBe(false);
  });

  it("rejects forged hex of correct length", () => {
    const forged = `sha256=${"0".repeat(64)}`;
    expect(verifyWebhook('{"x":1}', forged, { secret: "secret" })).toBe(false);
  });
});

// ── Security: malformed inputs never throw ─────────────────────────

describe("verifyWebhook — returns false (never throws) on garbage", () => {
  it("empty signature", () => {
    expect(verifyWebhook("body", "", { secret: "secret" })).toBe(false);
  });

  it("empty secret", () => {
    expect(verifyWebhook("body", `sha256=${"a".repeat(64)}`, { secret: "" })).toBe(false);
  });

  it("signature too short", () => {
    expect(verifyWebhook("body", "sha256=ff", { secret: "secret" })).toBe(false);
  });

  it("signature contains non-hex chars", () => {
    expect(verifyWebhook("body", `sha256=${"g".repeat(64)}`, { secret: "secret" })).toBe(false);
  });

  // Garbage shapes — TS prevents these at compile time, but the runtime
  // must still reject them since customers can bypass types. The `any`
  // casts model a real customer who calls us from un-typed code.
  it("non-string signature header", () => {
    expect(verifyWebhook("body", 12345 as any, { secret: "secret" })).toBe(false);
  });

  it("missing opts.secret entirely", () => {
    expect(verifyWebhook("body", `sha256=${"a".repeat(64)}`, {} as any)).toBe(false);
  });

  it("non-string, non-bytes body", () => {
    expect(verifyWebhook(42 as any, `sha256=${"a".repeat(64)}`, { secret: "s" })).toBe(false);
  });
});
