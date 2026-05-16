# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-05-16

### Added
- `client.jobs.purge(jobId)` — hard-erases a job's source bytes from
  object storage and clears the extracted result from the database. The
  job row remains as a billing tombstone (id, customer, page count,
  timestamps). Requires the new `jobs:write` scope on the API key;
  deliberately separate from `extract:write` so read-only keys can fetch
  results without being able to delete them. Idempotent — calling on an
  already-purged job is a no-op. Pairs with the new
  `result_retain_hours` extract option (server-side; pass through
  `options:`) so customers can control how long extracted content
  lives on OCRQueen's servers after a job completes. Full contract:
  <https://ocrqueen.com/docs/data-retention>.
- README now documents every supported file type — **PDF**, **PPTX**,
  **PPT**, **PNG**, **JPEG**, **WebP**, **HEIC**, **HEIF**. The API has
  accepted all of these since v0.1.0 but only PDF was advertised,
  costing organic discoverability on npm search and Google.
- README "Other file types" snippet block with one example per
  category, plus a `profile: "advanced"` example.

### Fixed
- README quickstart used `fs.createReadStream("paper.pdf")`. The SDK
  accepts `Uint8Array | string | Blob`, not Node read streams — the
  example errored on first run. Corrected to `fs.readFileSync(...)`.
  This was the first thing a new user saw on npm; switching to the
  working form unblocks fresh installs.
- README also called `result.markdown`; corrected to
  `result.result?.markdown`.

## [0.1.0] — 2026-05-15

First usable release. The v0.0.0 placeholder was a name claim only.

### Added

- `client.jobs.get(jobId)` — fetch a single job.
- `client.jobs.list({ status, limit, cursor })` — paginated listing.
- `client.jobs.cancel(jobId)` — cancel a queued or running job.
- `client.jobs.wait(jobOrId, { timeoutMs, pollIntervalMs, maxPollIntervalMs })`
  — exponential-backoff polling until terminal status.
- `verifyWebhook(body, signatureHeader, { secret })` — public helper
  for verifying OCRQueen webhook deliveries. Constant-time HMAC compare
  via `crypto.timingSafeEqual`; returns `false` on every malformed-input
  path (never throws).
- New TypeScript types exported: `JobStatus`, `JobList`,
  `ListJobsOptions`, `WaitOptions`, `VerifyWebhookOptions`.

### Notes

- All v0.0.x callers should be able to upgrade transparently — no
  breaking changes to existing APIs.
- This is the first release with the OIDC provenance attestation
  (via npm Trusted Publishing + Sigstore).

## [0.0.0] — 2026-05-15

### Added

- Initial package scaffold (`package.json`, dual ESM+CJS exports).
- HTTP foundation with security defaults (HTTPS-only baseUrl,
  redacted apiKey, no auto-redirects, AbortSignal timeouts).
- `client.extract.create({ file })` — submit a document for extraction.
