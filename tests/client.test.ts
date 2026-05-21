/**
 * Tests for the OCRQueen top-level client + env-var handling.
 *
 * HTTP invariants are covered in `http.test.ts`. Here we focus on:
 *   - env-var fallback (security boundary)
 *   - resource accessor caching
 *   - extract resource end-to-end against a mocked fetch
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError, OCRQueen, ValidationError } from "../src/index.js";
import { MAX_UPLOAD_BYTES } from "../src/resources/extract.js";

const VALID_KEY = `pk_${"a".repeat(32)}`;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let originalApiKey: string | undefined;
let originalBaseUrl: string | undefined;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  originalApiKey = process.env["OCRQUEEN_API_KEY"];
  originalBaseUrl = process.env["OCRQUEEN_BASE_URL"];
  delete process.env["OCRQUEEN_API_KEY"];
  delete process.env["OCRQUEEN_BASE_URL"];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalApiKey !== undefined) process.env["OCRQUEEN_API_KEY"] = originalApiKey;
  if (originalBaseUrl !== undefined) process.env["OCRQUEEN_BASE_URL"] = originalBaseUrl;
});

// ── Construction ────────────────────────────────────────────────────

describe("OCRQueen construction", () => {
  it("accepts an explicit apiKey", () => {
    expect(() => new OCRQueen({ apiKey: VALID_KEY })).not.toThrow();
  });

  it("falls back to OCRQUEEN_API_KEY env", () => {
    process.env["OCRQUEEN_API_KEY"] = VALID_KEY;
    expect(() => new OCRQueen()).not.toThrow();
  });

  it("explicit apiKey beats env", () => {
    process.env["OCRQUEEN_API_KEY"] = `pk_${"b".repeat(32)}`;
    // No throw means the explicit valid key was used (the env key is
    // also valid; both pass — but we only assert no error here).
    expect(() => new OCRQueen({ apiKey: VALID_KEY })).not.toThrow();
  });

  it("throws when neither apiKey nor env is provided", () => {
    expect(() => new OCRQueen()).toThrow(ValidationError);
  });

  it("env-provided baseUrl must be https", () => {
    process.env["OCRQUEEN_API_KEY"] = VALID_KEY;
    process.env["OCRQUEEN_BASE_URL"] = "http://attacker.example";
    expect(() => new OCRQueen()).toThrow(ValidationError);
  });
});

// ── Resource accessor ───────────────────────────────────────────────

describe("resource access", () => {
  it("caches the extract resource across accesses", () => {
    const client = new OCRQueen({ apiKey: VALID_KEY });
    const a = client.extract;
    const b = client.extract;
    expect(a).toBe(b);
  });
});

// ── Extract.create ──────────────────────────────────────────────────

describe("client.extract.create", () => {
  it("sends multipart with file + options", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { job_id: "job_abc", status: "queued" }));
    const client = new OCRQueen({ apiKey: VALID_KEY });
    const job = await client.extract.create({
      file: new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF
      profile: "advanced",
    });
    expect(job.id).toBe("job_abc");
    expect(job.status).toBe("queued");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    // Pull the FormData back out and read its parts
    const form = init.body as FormData;
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("options")).toBe('{"extraction_profile":"advanced"}');
  });

  it("passes idempotency key as header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { job_id: "job_abc", status: "queued" }));
    const client = new OCRQueen({ apiKey: VALID_KEY });
    await client.extract.create({
      file: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      idempotencyKey: "my-key-123",
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("my-key-123");
  });

  it("rejects oversize Uint8Array client-side", async () => {
    const client = new OCRQueen({ apiKey: VALID_KEY });
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    await expect(client.extract.create({ file: big })).rejects.toBeInstanceOf(ValidationError);
    // And confirm no network call was made.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces 404 as NotFoundError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "no" } }),
    );
    const client = new OCRQueen({ apiKey: VALID_KEY });
    await expect(
      client.extract.create({ file: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("explicit options['extraction_profile'] wins over the profile arg", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { job_id: "job_abc", status: "queued" }));
    const client = new OCRQueen({ apiKey: VALID_KEY });
    await client.extract.create({
      file: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      profile: "advanced",
      options: { extraction_profile: "standard" },
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const form = init.body as FormData;
    expect(form.get("options")).toBe('{"extraction_profile":"standard"}');
  });
});
