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
  /**
   * Extra `ExtractOptions` — `callback_url`, `bypass_cache`,
   * `retain_hours`, `result_retain_hours` (0-168, defaults to
   * `retain_hours`), `storage_destination_id`. Server validates.
   * See /docs/data-retention for the retention-related options.
   */
  options?: Record<string, unknown>;
  /** Stripe-style key — retrying with the same key returns the same job. */
  idempotencyKey?: string;
  /** Optional filename hint for the multipart `file` part. */
  filename?: string;
}

export interface ExtractJob {
  id: string;
  status: string;
  /**
   * `general` (default) or `patent`. Branch on this to choose between
   * the `document` and `patent` extraction fields.
   */
  domain: string;
  /** Populated for `domain === "general"` jobs. */
  document?: Record<string, unknown> | null;
  /** Populated for `domain === "patent"` jobs. */
  patent?: Record<string, unknown> | null;
  /** Markdown rendering of the extraction (when the server emits one). */
  markdown?: string | null;
  /** True if the server returned a cached extraction without re-running. */
  cacheHit: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  /**
   * Legacy alias — same as `document` for general-domain jobs and
   * `patent` for patent-domain jobs. Prefer `document` / `patent` so
   * the dispatch is explicit at the call site.
   */
  result?: Record<string, unknown> | null;
  /** Full server response — kept for advanced callers who need a field
   * the typed surface doesn't expose. */
  raw: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * MIME types for common upload extensions. We ship our own table because
 * the platform's built-in detection misses `.pptx` / `.heic` and falls
 * back to `application/octet-stream`, which the server rejects with
 * `UNSUPPORTED_FILE_TYPE`. Keep in sync with the Python SDK.
 */
const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function guessMime(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = filename.slice(dot).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Build an `ExtractJob` from a `JobResponse`-shaped server body.
 *
 * Centralized so every endpoint that returns this shape (`POST /v1/extract`,
 * `GET /v1/jobs/{id}`, `GET /v1/jobs`, `DELETE /v1/jobs/{id}`) maps the
 * wire fields the same way. Wire format uses `job_id` and a nested
 * `error: { code, message }`; we surface those as `.id` and
 * `.errorCode / .errorMessage` for ergonomics, preserving the raw body.
 */
export function jobFromBody(body: unknown): ExtractJob {
  if (!body || typeof body !== "object") {
    throw new ValidationError("unexpected job response shape");
  }
  const obj = body as Record<string, unknown>;
  const errorRaw = obj["error"];
  const error =
    errorRaw && typeof errorRaw === "object" ? (errorRaw as Record<string, unknown>) : {};
  const domain = typeof obj["domain"] === "string" ? (obj["domain"] as string) : "general";
  const document =
    obj["document"] !== undefined ? (obj["document"] as Record<string, unknown> | null) : null;
  const patent =
    obj["patent"] !== undefined ? (obj["patent"] as Record<string, unknown> | null) : null;
  return {
    id: typeof obj["job_id"] === "string" ? (obj["job_id"] as string) : "",
    status: typeof obj["status"] === "string" ? (obj["status"] as string) : "",
    domain,
    document,
    patent,
    markdown: typeof obj["markdown"] === "string" ? (obj["markdown"] as string) : null,
    cacheHit: obj["cache_hit"] === true,
    errorCode: typeof error["code"] === "string" ? (error["code"] as string) : null,
    errorMessage: typeof error["message"] === "string" ? (error["message"] as string) : null,
    result: domain === "patent" ? patent : document,
    raw: obj,
  };
}

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
    return { blob: new Blob([bytes], { type: guessMime(name) }), filename: name };
  }

  // Blob — already in the right shape, just size-check. Preserve any
  // caller-set type; otherwise infer from the filename hint.
  if (input instanceof Blob) {
    if (input.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `file is ${input.size} bytes — exceeds the ${MAX_UPLOAD_BYTES} byte limit`,
      );
    }
    const filename = filenameHint ?? "upload.bin";
    if (input.type) {
      return { blob: input, filename };
    }
    const buf = await input.arrayBuffer();
    return {
      blob: new Blob([buf], { type: guessMime(filename) }),
      filename,
    };
  }

  // Uint8Array (incl. Buffer).
  if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
    if (input.byteLength > MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `file is ${input.byteLength} bytes — exceeds the ${MAX_UPLOAD_BYTES} byte limit`,
      );
    }
    const filename = filenameHint ?? "upload.bin";
    // TS's lib.dom types narrow `BlobPart` to `Uint8Array<ArrayBuffer>`
    // while we accept the broader `Uint8Array<ArrayBufferLike>` (which
    // includes SharedArrayBuffer). Wrap in `new Uint8Array(input)` to
    // copy into a guaranteed-ArrayBuffer-backed view.
    return {
      blob: new Blob([new Uint8Array(input)], { type: guessMime(filename) }),
      filename,
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
    const body = (await response.json()) as unknown;
    return jobFromBody(body);
  }
}
