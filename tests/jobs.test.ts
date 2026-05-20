/**
 * Tests for the jobs resource: get / list / cancel / wait.
 *
 * `wait()` is exercised against a stubbed `get()` so the tests are
 * fast and deterministic — no real long sleeps, no HTTP.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APITimeoutError, NotFoundError, OCRQueen, ValidationError } from "../src/index.js";
import type { ExtractJob } from "../src/resources/extract.js";

const VALID_KEY = `pk_${"a".repeat(32)}`;

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

// ── get ─────────────────────────────────────────────────────────────

describe("jobs.get", () => {
  it("returns the job", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "job_abc", status: "completed" }));
    const client = new OCRQueen({ apiKey: VALID_KEY });
    const job = await client.jobs.get("job_abc");
    expect(job.id).toBe("job_abc");
    expect(job.status).toBe("completed");
  });

  it("404 → NotFoundError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "no" } }),
    );
    const client = new OCRQueen({ apiKey: VALID_KEY });
    await expect(client.jobs.get("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects empty id", async () => {
    const client = new OCRQueen({ apiKey: VALID_KEY });
    await expect(client.jobs.get("")).rejects.toBeInstanceOf(ValidationError);
  });
});

// ── list ────────────────────────────────────────────────────────────

describe("jobs.list", () => {
  it("returns jobs + cursor", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        jobs: [
          { id: "job_1", status: "completed" },
          { id: "job_2", status: "queued" },
        ],
        next_cursor: "abc",
      }),
    );
    const client = new OCRQueen({ apiKey: VALID_KEY });
    const page = await client.jobs.list();
    expect(page.jobs).toHaveLength(2);
    expect(page.jobs[0]?.id).toBe("job_1");
    expect(page.nextCursor).toBe("abc");
  });

  it("passes filters as query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { jobs: [], next_cursor: null }));
    const client = new OCRQueen({ apiKey: VALID_KEY });
    await client.jobs.list({ status: "completed", limit: 10, cursor: "prev" });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get("status")).toBe("completed");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("cursor")).toBe("prev");
  });

  it("rejects out-of-range limit", async () => {
    const client = new OCRQueen({ apiKey: VALID_KEY });
    await expect(client.jobs.list({ limit: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(client.jobs.list({ limit: 101 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("skips non-object jobs in the response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { jobs: [{ id: "job_1", status: "completed" }, "garbage"] }),
    );
    const client = new OCRQueen({ apiKey: VALID_KEY });
    const page = await client.jobs.list();
    expect(page.jobs.map((j) => j.id)).toEqual(["job_1"]);
  });
});

// ── cancel ──────────────────────────────────────────────────────────

describe("jobs.cancel", () => {
  it("returns updated job", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "job_x", status: "cancelled" }));
    const client = new OCRQueen({ apiKey: VALID_KEY });
    const job = await client.jobs.cancel("job_x");
    expect(job.status).toBe("cancelled");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("DELETE");
  });
});

// ── purge ───────────────────────────────────────────────────────────

describe("jobs.purge", () => {
  it("POSTs to /v1/jobs/:id/purge and returns void", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new OCRQueen({ apiKey: VALID_KEY });
    const result = await client.jobs.purge("job_y");
    expect(result).toBeUndefined();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
  });

  it("rejects empty id", async () => {
    const client = new OCRQueen({ apiKey: VALID_KEY });
    await expect(client.jobs.purge("")).rejects.toThrow(/jobId is required/);
  });
});

// ── wait ────────────────────────────────────────────────────────────

describe("jobs.wait", () => {
  it("returns immediately when first poll is terminal", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "job_done", status: "completed" }));
    const client = new OCRQueen({ apiKey: VALID_KEY });
    const job = await client.jobs.wait("job_done");
    expect(job.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("polls until terminal", async () => {
    const states: ExtractJob[] = [
      { id: "job_x", status: "queued", raw: {} },
      { id: "job_x", status: "processing", raw: {} },
      { id: "job_x", status: "completed", raw: {} },
    ];
    const client = new OCRQueen({ apiKey: VALID_KEY });
    const getSpy = vi.spyOn(client.jobs, "get");
    for (const s of states) getSpy.mockResolvedValueOnce(s);
    const job = await client.jobs.wait("job_x", {
      pollIntervalMs: 1,
      maxPollIntervalMs: 5,
    });
    expect(job.status).toBe("completed");
    expect(getSpy).toHaveBeenCalledTimes(3);
  });

  it("times out when never terminal", async () => {
    const client = new OCRQueen({ apiKey: VALID_KEY });
    vi.spyOn(client.jobs, "get").mockResolvedValue({
      id: "job_x",
      status: "queued",
      raw: {},
    });
    await expect(
      client.jobs.wait("job_x", {
        timeoutMs: 30,
        pollIntervalMs: 5,
        maxPollIntervalMs: 10,
      }),
    ).rejects.toBeInstanceOf(APITimeoutError);
  });

  it("accepts ExtractJob OR id string", async () => {
    const client = new OCRQueen({ apiKey: VALID_KEY });
    const getSpy = vi.spyOn(client.jobs, "get").mockResolvedValue({
      id: "job_x",
      status: "completed",
      raw: {},
    });
    const j1 = await client.jobs.wait({ id: "job_x", status: "queued", raw: {} });
    const j2 = await client.jobs.wait("job_x");
    expect(j1.status).toBe("completed");
    expect(j2.status).toBe("completed");
    expect(getSpy).toHaveBeenCalledWith("job_x");
  });

  it("rejects bad timeout/interval values", async () => {
    const client = new OCRQueen({ apiKey: VALID_KEY });
    await expect(client.jobs.wait("job_x", { timeoutMs: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(client.jobs.wait("job_x", { pollIntervalMs: -1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      client.jobs.wait("job_x", { pollIntervalMs: 10, maxPollIntervalMs: 5 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects empty job id", async () => {
    const client = new OCRQueen({ apiKey: VALID_KEY });
    await expect(client.jobs.wait("")).rejects.toBeInstanceOf(ValidationError);
    await expect(client.jobs.wait({ id: "", status: "queued", raw: {} })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

// ── fetchImage ─────────────────────────────────────────────────────

describe("jobs.fetchImage", () => {
  it("follows the 302 from the proxy to R2 and returns bytes", async () => {
    const proxyUrl = "https://api.ocrqueen.com/v1/jobs/job_abc/figures/0";
    const r2Url = "https://r2.example.com/x.jpg?signed=true";
    const imgBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    fetchMock.mockImplementation(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.startsWith("https://api.ocrqueen.com/")) {
        return new Response(null, {
          status: 302,
          headers: { Location: r2Url },
        });
      }
      if (u === r2Url) {
        return new Response(imgBytes, { status: 200 });
      }
      throw new Error(`unexpected fetch URL: ${u}`);
    });

    const client = new OCRQueen({ apiKey: VALID_KEY });
    const got = await client.jobs.fetchImage(proxyUrl);
    expect(got).toEqual(imgBytes);
  });

  it("accepts a relative path too", async () => {
    const r2Url = "https://r2.example.com/y.jpg?signed=true";
    const imgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    fetchMock.mockImplementation(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/v1/jobs/job_abc/images/blk_1")) {
        return new Response(null, {
          status: 302,
          headers: { Location: r2Url },
        });
      }
      if (u === r2Url) {
        return new Response(imgBytes, { status: 200 });
      }
      throw new Error(`unexpected fetch URL: ${u}`);
    });

    const client = new OCRQueen({ apiKey: VALID_KEY });
    const got = await client.jobs.fetchImage("/v1/jobs/job_abc/images/blk_1");
    expect(got).toEqual(imgBytes);
  });

  it("404 from the proxy → NotFoundError", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: { code: "FIGURE_NOT_FOUND" } }));
    const client = new OCRQueen({ apiKey: VALID_KEY });
    await expect(client.jobs.fetchImage("/v1/jobs/job/figures/9")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("rejects empty input", async () => {
    const client = new OCRQueen({ apiKey: VALID_KEY });
    await expect(client.jobs.fetchImage("")).rejects.toBeInstanceOf(ValidationError);
  });
});

// ── resource caching ───────────────────────────────────────────────

describe("client.jobs", () => {
  it("caches the resource instance", () => {
    const client = new OCRQueen({ apiKey: VALID_KEY });
    expect(client.jobs).toBe(client.jobs);
  });
});
