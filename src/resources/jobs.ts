/**
 * Jobs resource — `client.jobs.get / list / cancel / wait`.
 *
 * Wraps the `/v1/jobs` endpoints on the OCRQueen API.
 *
 * `wait()` is the SDK's flagship convenience: a customer who just wants
 * "submit a doc, get the result, no plumbing" should write two lines,
 * not a polling loop. We do the polling for them with sensible
 * exponential backoff.
 *
 * Mirror of the Python SDK's `resources/jobs.py`.
 */

import { APIConnectionError, APIError, APITimeoutError, ValidationError } from "../_errors.js";
import type { HttpClient } from "../_http.js";
import { type ExtractJob, jobFromBody } from "./extract.js";

export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);

// Polling defaults. Start short so a fast extraction feels instant;
// back off to avoid hammering the server when a job is slow.
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_POLL_MAX_INTERVAL_MS = 5_000;
const DEFAULT_WAIT_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

export interface JobList {
  jobs: ExtractJob[];
  /** Pagination cursor from the server. `null` when no further page. */
  nextCursor: string | null;
  raw: Record<string, unknown>;
}

export interface ListJobsOptions {
  status?: JobStatus;
  /** 1..100. Server caps higher values silently. */
  limit?: number;
  cursor?: string;
}

export interface WaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
}

// ── Resource ────────────────────────────────────────────────────────

export class JobsResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Fetch a single job by id. Throws NotFoundError if it doesn't exist. */
  async get(jobId: string): Promise<ExtractJob> {
    if (!jobId) throw new ValidationError("jobId is required");
    const response = await this.#http.request({
      method: "GET",
      path: `/v1/jobs/${encodeURIComponent(jobId)}`,
    });
    return jobFromResponse((await response.json()) as unknown);
  }

  /** List the customer's jobs, most recent first. */
  async list(opts: ListJobsOptions = {}): Promise<JobList> {
    const limit = opts.limit ?? 20;
    if (limit < 1 || limit > 100) {
      throw new ValidationError("limit must be in 1..100");
    }
    const query: Record<string, string | number> = { limit };
    if (opts.status !== undefined) query["status"] = opts.status;
    if (opts.cursor !== undefined) query["cursor"] = opts.cursor;

    const response = await this.#http.request({
      method: "GET",
      path: "/v1/jobs",
      query,
    });
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== "object") {
      throw new ValidationError("unexpected response shape from /v1/jobs");
    }
    const obj = body as Record<string, unknown>;
    const rawList = Array.isArray(obj["jobs"]) ? obj["jobs"] : [];
    const items: ExtractJob[] = [];
    for (const item of rawList) {
      if (item && typeof item === "object") {
        items.push(jobFromResponse(item));
      }
    }
    return {
      jobs: items,
      nextCursor: typeof obj["next_cursor"] === "string" ? (obj["next_cursor"] as string) : null,
      raw: obj,
    };
  }

  /** Cancel a queued or in-flight job. Reservation refunded if any. */
  async cancel(jobId: string): Promise<ExtractJob> {
    if (!jobId) throw new ValidationError("jobId is required");
    const response = await this.#http.request({
      method: "DELETE",
      path: `/v1/jobs/${encodeURIComponent(jobId)}`,
    });
    return jobFromResponse((await response.json()) as unknown);
  }

  /**
   * Hard-erase a job's source bytes + extracted content (GDPR erasure).
   *
   * Deletes the source file from object storage and clears the extracted
   * result + request options from the database. The job row remains as a
   * billing tombstone (id, customer, page count, timestamps) so usage
   * reports stay accurate.
   *
   * Requires the `jobs:write` scope on the API key. Deliberately separate
   * from `extract:write` so you can issue read-only keys to dashboards or
   * pipelines that fetch results but cannot delete them.
   *
   * Idempotent — calling on an already-purged job is a no-op.
   *
   * @throws NotFoundError job doesn't exist (or belongs to another customer).
   * @throws AuthenticationError key is missing the `jobs:write` scope.
   */
  async purge(jobId: string): Promise<void> {
    if (!jobId) throw new ValidationError("jobId is required");
    await this.#http.request({
      method: "POST",
      path: `/v1/jobs/${encodeURIComponent(jobId)}/purge`,
    });
  }

  /**
   * Download bytes from an image-proxy URL referenced in an extraction result.
   *
   * The API emits stable proxy paths on image blocks
   * (`pages[].blocks[].url`) of the form
   * `/v1/jobs/{job_id}/images/{id}`. Hitting them with the
   * SDK's API key returns a 302 redirect to a short-lived signed R2
   * URL; this helper performs the two-step dance and returns the
   * raw bytes as a `Uint8Array`. Accepts either a relative path or
   * a full URL.
   *
   * @throws ValidationError empty / malformed URL
   * @throws NotFoundError figure or image block doesn't exist
   * @throws APIError unexpected status or non-redirect from the API
   */
  async fetchImage(urlOrPath: string): Promise<Uint8Array> {
    if (!urlOrPath) {
      throw new ValidationError("urlOrPath is required");
    }
    const path = proxyPath(urlOrPath);
    // Security invariant I5: redirects are NOT auto-followed. The 302
    // surfaces here so we can extract Location ourselves.
    const response = await this.#http.request({
      method: "GET",
      path,
    });
    if (response.status >= 200 && response.status < 300) {
      const buf = await response.arrayBuffer();
      return new Uint8Array(buf);
    }
    if (response.status < 300 || response.status >= 400) {
      throw new APIError(`image proxy returned unexpected status ${response.status}`, {
        statusCode: response.status,
        errorCode: undefined,
        requestId: undefined,
      });
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new ValidationError(
        `image proxy returned ${response.status} without a Location header`,
      );
    }
    // The Location points at R2 (or another presigned host) — fetch
    // bytes directly, without sending our API key.
    let r2Response: Response;
    try {
      r2Response = await fetch(location, {
        method: "GET",
        signal: AbortSignal.timeout(60_000),
        redirect: "manual",
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new APITimeoutError("image storage fetch timed out");
      }
      throw new APIConnectionError("image storage fetch failed");
    }
    if (r2Response.status !== 200) {
      throw new APIError(`image storage returned ${r2Response.status}`, {
        statusCode: r2Response.status,
        errorCode: undefined,
        requestId: undefined,
      });
    }
    const buf = await r2Response.arrayBuffer();
    return new Uint8Array(buf);
  }

  /**
   * Poll the job until it reaches a terminal status. The killer feature.
   *
   * No initial sleep — a job that's already done (cache hit) returns
   * instantly. Otherwise sleeps `pollIntervalMs`, then doubles up to
   * `maxPollIntervalMs`.
   *
   * @throws APITimeoutError if the deadline passes without termination.
   */
  async wait(jobOrId: ExtractJob | string, opts: WaitOptions = {}): Promise<ExtractJob> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const initialPollMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const maxPollMs = opts.maxPollIntervalMs ?? DEFAULT_POLL_MAX_INTERVAL_MS;

    if (timeoutMs <= 0) throw new ValidationError("timeoutMs must be positive");
    if (initialPollMs <= 0 || maxPollMs <= 0) {
      throw new ValidationError("poll intervals must be positive");
    }
    if (maxPollMs < initialPollMs) {
      throw new ValidationError("maxPollIntervalMs must be >= pollIntervalMs");
    }

    const jobId = typeof jobOrId === "string" ? jobOrId : jobOrId.id;
    if (!jobId) throw new ValidationError("job has no id; cannot poll");

    const deadline = Date.now() + timeoutMs;
    let interval = initialPollMs;

    let current = await this.get(jobId);
    while (!TERMINAL_STATUSES.has(current.status)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new APITimeoutError(
          `job ${jobId} did not reach a terminal status within ${timeoutMs}ms (last status: ${current.status})`,
        );
      }
      await sleep(Math.min(interval, remaining));
      interval = Math.min(interval * 2, maxPollMs);
      current = await this.get(jobId);
    }
    return current;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function jobFromResponse(body: unknown): ExtractJob {
  return jobFromBody(body);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Return the path portion of an OCRQueen image-proxy URL. Callers may
 * pass either `/v1/jobs/{id}/figures/0` or the full URL — we don't make
 * them strip the origin themselves.
 */
function proxyPath(urlOrPath: string): string {
  if (urlOrPath.startsWith("/")) {
    return urlOrPath;
  }
  try {
    const u = new URL(urlOrPath);
    return u.pathname + (u.search || "");
  } catch {
    return `/${urlOrPath.replace(/^\/+/, "")}`;
  }
}
