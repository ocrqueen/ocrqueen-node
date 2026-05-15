# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
