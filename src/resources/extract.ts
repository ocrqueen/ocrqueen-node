/**
 * Extract resource — `client.extract.create(...)`.
 *
 * Wraps `POST /v1/extract` on the OCRQueen API.
 *
 * Accepts a file as `Uint8Array | Buffer`, a path string, or a Web
 * Stream / Node Readable, and normalizes to a Blob before sending so
 * the multipart encoder behaves consistently.
 *
 * Mirror of the Python SDK's `resources/extract.py`.
 */

import { Buffer } from "node:buffer";
import { readFile, stat } from "node:fs/promises";

import { ValidationError } from "../_errors.js";
import type { HttpClient } from "../_http.js";

/** Max upload — matches the server's hard cap so we fail fast locally. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

export type ExtractionProfile = "standard" | "advanced";

/** What a file upload looks like in practice. */
export type FileInput = Uint8Array | string | Blob;

export interface ExtractCreateOptions {
  file: FileInput;
  /** `standard` ($0.005/page) or `advanced` ($0.015/page). */
  profile?: ExtractionProfile;
  /** Extra `ExtractOptions` (callback_url, bypass_cache, …). Server validates. */
  options?: Record<string, unknown>;
  /** Stripe-style key — retrying with the same key returns the same job. */
  idempotencyKey?: string;
  /** Optional filename hint for the multipart `file` part. */
  filename?: string;
}

export interface ExtractJob {
  id: string;
  status: string;
  result?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Full server response — kept for advanced callers who need a field
   * the typed surface doesn't expose. */
  raw: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────────────────────────────

async function normalizeFile(
  input: FileInput,
  filenameHint: string | undefined,
): Promise<{ blob: Blob; filename: string }> {
  // Path string: read from disk, after validation.
  if (typeof input === "string") {
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(input);
    } catch {
      throw new ValidationError(`file path does not exist: ${input}`);
    }
    if (!info.isFile()) {
      throw new ValidationError(`file path is not a regular file: ${input}`);
    }
    if (info.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `file is ${info.size} bytes — exceeds the ${MAX_UPLOAD_BYTES} byte limit`,
      );
    }
    const bytes = await readFile(input);
    const name = filenameHint ?? input.split("/").pop() ?? "upload.bin";
    return { blob: new Blob([bytes]), filename: name };
  }

  // Blob — already in the right shape, just size-check.
  if (input instanceof Blob) {
    if (input.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `file is ${input.size} bytes — exceeds the ${MAX_UPLOAD_BYTES} byte limit`,
      );
    }
    return { blob: input, filename: filenameHint ?? "upload.bin" };
  }

  // Uint8Array (incl. Buffer).
  if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
    if (input.byteLength > MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `file is ${input.byteLength} bytes — exceeds the ${MAX_UPLOAD_BYTES} byte limit`,
      );
    }
    // TS's lib.dom types narrow `BlobPart` to `Uint8Array<ArrayBuffer>`
    // while we accept the broader `Uint8Array<ArrayBufferLike>` (which
    // includes SharedArrayBuffer). Wrap in `new Uint8Array(input)` to
    // copy into a guaranteed-ArrayBuffer-backed view.
    return {
      blob: new Blob([new Uint8Array(input)]),
      filename: filenameHint ?? "upload.bin",
    };
  }

  throw new ValidationError("file must be a Uint8Array/Buffer, a Blob, or a path string");
}

// ── Resource ────────────────────────────────────────────────────────

export class ExtractResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  async create(opts: ExtractCreateOptions): Promise<ExtractJob> {
    const { blob, filename } = await normalizeFile(opts.file, opts.filename);

    // Merge the simple `profile` arg into the options dict. Explicit
    // options["extraction_profile"] wins if both are passed.
    const mergedOptions: Record<string, unknown> = { ...(opts.options ?? {}) };
    if (mergedOptions["extraction_profile"] === undefined) {
      mergedOptions["extraction_profile"] = opts.profile ?? "standard";
    }

    const form = new FormData();
    form.append("file", blob, filename);
    form.append("options", JSON.stringify(mergedOptions));

    const response = await this.#http.request({
      method: "POST",
      path: "/v1/extract",
      formBody: form,
      ...(opts.idempotencyKey !== undefined ? { idempotencyKey: opts.idempotencyKey } : {}),
    });
    const body = (await response.json()) as Record<string, unknown>;

    return {
      id: typeof body["id"] === "string" ? body["id"] : "",
      status: typeof body["status"] === "string" ? body["status"] : "",
      result:
        body["result"] !== undefined ? (body["result"] as Record<string, unknown> | null) : null,
      errorCode: (body["error_code"] as string | null | undefined) ?? null,
      errorMessage: (body["error_message"] as string | null | undefined) ?? null,
      raw: body,
    };
  }
}
