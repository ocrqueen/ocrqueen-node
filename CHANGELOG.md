# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] — 2026-05-27

Tracks the V3 cutover on the API: one unified extraction pipeline, one
flat per-page rate, no profile/domain axis.

### Removed (breaking)

- `profile` field on `client.extract.create({...})` — the API no longer
  accepts `extraction_profile`. There is one pipeline; every document
  gets the full extraction (text, tables, math, code, diagrams as
  graphs, reference linking, bounding boxes).
- `ExtractionProfile` type export.
- `ExtractJob.domain` and `ExtractJob.patent` fields — the response
  shape collapses to `document` + `markdown` for every job. The
  separate patent-domain response is gone.
- The `ExtractJob.result` field is retained as a thin alias for
  `document` so existing call sites don't break.

### Migration

```typescript
// before (v0.5.x)
const job = await client.extract.create({ file: buf, profile: "advanced" });

// after (v0.6.x) — drop the field, you get the same pipeline either way
const job = await client.extract.create({ file: buf });
```

If you were passing `extraction_profile` or `domain` inside `options`,
remove those keys — the server now rejects them.

## [0.5.1] — 2026-05-21

Republish of 0.5.0 — the v0.5.0 tag failed CI on a biome import-sort
nit and never reached npm. Same contract-drift fixes as listed below
under 0.5.0.

## [0.5.0] — 2026-05-21

Fixes three SDK ↔ API contract bugs discovered during an end-to-end
smoke test against production. All three were silent failures — the
SDK didn't crash, it just returned empty / wrong fields.

### Fixed

- `ExtractJob.id` was always `""` because the SDK read `body["id"]`
  but the API returns `body["job_id"]`. Now reads `job_id`.
- `ExtractJob.result` was always `null`. The API returns the
  extraction under `document` (general domain) or `patent` (patent
  domain), not `result`. New explicit fields: `document`, `patent`,
  `markdown`, `cacheHit`, `domain`. The `result` field is kept as a
  legacy alias that mirrors `document` or `patent` based on `domain`.
- `errorCode` / `errorMessage` were read from flat `error_code` /
  `error_message` keys, but the API nests them under
  `error: { code, message }`. Now reads the nested shape.
- File uploads of `.pptx` (and other types where the Blob's `type`
  was empty) were rejected by the server with `UNSUPPORTED_FILE_TYPE`.
  The SDK now ships its own MIME table and sets `new Blob([..], { type })`
  for `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.heic`, `.heif`, `.pptx`.

### Note for upgraders

The shape of `ExtractJob` changed: `result` is still readable (now a
type alias for `document | patent`), but if you were reading
`.result` directly you may want to switch to `.document` / `.patent`
so the intent is explicit. `.raw` continues to hold the full server
body for advanced callers.

## [0.4.0] — 2026-05-21

Additive bump for Slice 8 + 9 — Figure Pipeline. SDK consumers gain
forward-compat for substantially-redesigned figure extraction on
`domain: "patent"` responses. No SDK behavior change; the SDK
remains a thin HTTP client returning the API's JSON contract verbatim.

### Added (via OpenAPI re-dump)

On `PatentFigure`:
- `source_bbox`, `shape_cluster_inner_bbox` — per-shape and tighter-inner
  bbox for the new per-shape crop pipeline
- `parent_figure` — sub-figure linkage ("FIG. 4A" → "FIG. 4")
- `is_prior_art` — deterministic PRIOR ART stamp detection
- `extraction_expectation` — `"LABELED_BLOCKS_ONLY" | "WITH_CALLOUTS" |
  "WITH_TOPOLOGY" | "FREE_FORM" | null`. Drives per-figure
  numerals-skip and faithfulness scoring on the API side.

On `ReferenceNumeral`: `confidence` (`"high" | "medium" | "low"`).

On `FlowchartNode` + `FlowchartEdge`: `confidence` per element.

On `FlowchartTopology`: `source` (`"deterministic" | "vision"`) —
distinguishes $0-cost connector-graph-derived topology from
Vision-derived.

Schema-wide: new `text_source: "pptx_shape_cluster"` on general
document `ImageBlock`s synthesised from native PPTX shape clusters
(Slice 9 discovery layer).

10 new `PatentWarningCode` values covering figure / topology /
numerals / prior-art failure modes (see API CHANGELOG for the full
list).

### Customer impact

On the locked customer reference fixture (`patent_sample_US11847293.pptx`),
real-figure recall went from 0/4 to 4/4. FIG. 2 now ships as a
25-node, 24-edge, 4-swimlane Mermaid flowchart via the API's
deterministic-first topology path.

## [0.3.2] — 2026-05-20

Additive enum bump for Slice 12 — Patent Claims Parser. No SDK
behavior change; SDK consumers gain forward-compat for the new
warning codes the API now emits on `domain: "patent"` responses.

### Added (via OpenAPI re-dump)
- `PatentWarningCode.CLAIMS_REGION_EMPTY`
- `PatentWarningCode.CLAIMS_EMPTY_BODIES_DETECTED`
- `PatentWarningCode.RESCUE_HALLUCINATED_CLAIM_DROPPED`

Plus additive schema additions (`AmendmentMarkupSpan`,
`MPFStructureBinding`, `ClaimCategory` enum, `ClaimType.MULTI_DEPENDENT`,
`ClaimType.UNKNOWN`, `ClaimEdge.dependency_kind`,
`ClaimEdge.alternative_group_id`, `PatentClaim.preamble: string | null`,
`PatentClaim.category`). Pinned v0.3.x SDKs deserialize the new
fields as optional / "unknown" per the API's `_missing_` shim;
upgrading to 0.3.2 surfaces them through the result object.

## [0.3.1] — 2026-05-20

Docs-only release. Refreshes the npm landing-page README with
patent-extraction examples + `fetchImage` usage. No runtime change.

## [0.3.0] — 2026-05-20

### Added
- `client.jobs.fetchImage(urlOrPath)` — download bytes from the new
  image-proxy URLs that the API emits on patent figures
  (`drawings[i].image_url`) and general image blocks
  (`pages[].blocks[].url`). Performs the two-step auth → 302 → R2 dance
  and returns a `Uint8Array`.

### Note
- `cost_usd` on extraction responses now reflects the customer billing
  rate (what the wallet debits), not the internal Gemini token cost.
  No SDK surface change.
- Patent extractions (`domain: "patent"`) are now priced at $0.05/page
  (was $0.10/page) to align with the Advanced tier description.

## [0.2.1] — 2026-05-16

Metadata-only release. No runtime or API behaviour change.

### Changed
- Expanded `package.json` keywords from a PDF-focused set to cover every
  supported format and use case: `pptx`, `powerpoint`, `presentation-extraction`,
  `image-extraction`, `image-ocr`, `heic`, `pdf-to-json`, `pdf-to-markdown`,
  `document-extraction`, `ocr-api`, `structured-extraction`, `rag`, `esm`.
  npm search indexes keywords, not READMEs — so even though the README
  documented all formats since v0.2.0, searches for "PPTX extraction npm" /
  "HEIC OCR" still missed us. Fixes that.

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
