# ocrqueen-node — Claude orientation

You are in the **official Node.js / TypeScript SDK** for OCRQueen.
Published to npm as `ocrqueen`. Mirror of `ocrqueen-python`.

## What this is

```ts
import { OCRQueen } from "ocrqueen";
const client = new OCRQueen({ apiKey: "pk_..." });
const job = await client.extract.create({ file: fs.readFileSync("doc.pdf") });
const result = await client.jobs.wait(job);
```

Sibling repos:
- `ocrqueen/ocrqueen-python` — keep this SDK's shape parallel to that one.
- `ocrqueen/openapi` — single source of truth for the API contract.
- `ocrqueen/ocrqueen` — the API itself (private; only the public HTTP
  contract is visible to this repo).

## Stack

- Node ≥ 20. CI matrix tests 20 + 22.
- **Zero runtime dependencies** (native `fetch` + `AbortSignal.timeout`).
  Do not add deps without a strong reason — supply-chain risk for users.
- Build: `tsup` → dual ESM + CJS, with `.d.ts` for both.
- Lint + format: `biome` (one tool, faster + no config drift).
- Test: `vitest` with `vi.stubGlobal('fetch', ...)` for HTTP mocking.
- Type: `tsc --strict` with **every** extra correctness flag
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.).
- Package manager: **pnpm only**. `packageManager: pnpm@10.x` is pinned
  in `package.json`. CI uses `--frozen-lockfile`.

## Public surface (don't change without thinking)

- `OCRQueen` class. `new OCRQueen({ apiKey })`. Falls back to
  `OCRQUEEN_API_KEY` env. Has `.extract` and `.jobs` resources.
- `client.extract.create({ file, profile, options, idempotencyKey })`
- `client.jobs.{get, list, cancel, wait}`
- `verifyWebhook(body, signatureHeader, { secret })` —
  `crypto.timingSafeEqual` for the compare. Returns `false`, never throws.
- Error classes mirror the Python SDK 1:1.

## Security invariants (DO NOT WEAKEN)

`src/_http.ts` is the security-critical file. Every invariant has a
test in `tests/http.test.ts`. Same model as the Python SDK:

- **I1** `baseUrl` MUST be `https://`. Env-injected http:// is rejected.
- **I2** TLS verification cannot be disabled (no agent/dispatcher
  option is exposed; native fetch validates by default).
- **I3** `Authorization` header is set by us alone; `extraHeaders`
  cannot override it.
- **I4** `apiKey` is redacted in `util.inspect`, `JSON.stringify`,
  and error messages.
- **I5** Redirects NOT followed (`redirect: "manual"`).
- **I6** Every request has `AbortSignal.timeout(...)`.

API key format validated client-side. `extra_headers` blocks
Authorization + Host overrides.

## Release flow

**No npm token anywhere.** Releases use OIDC Trusted Publishing via the
`npm` GitHub Environment, with a required manual-approval gate.

**CRITICAL gotcha (you will rediscover this if you forget):**
`npm publish --provenance` from a workflow needs **npm 11.5+** for the
OIDC auth flow to actually work. Node 20 ships with npm 10, which signs
the provenance attestation but doesn't authenticate the PUT → publish
fails with a misleading `404 Not Found`. The release workflow has an
explicit `npm install -g npm@^11` step before publish. Do not remove it.

To cut a release:

1. Bump version in BOTH `package.json` AND `src/version.ts`. Update
   `CHANGELOG.md`. Open a PR; merge after CI.
2. From `main`: `git tag vX.Y.Z && git push origin vX.Y.Z`
3. The `Release` workflow runs `build` then waits for approval in the
   `npm` environment.
4. After approval, OIDC publishes to npm, attestation auto-attached.
5. Verify with `npm audit signatures` from a fresh project — it'll
   report "1 verified attestation".

The workflow REJECTS the publish if `package.json` version doesn't
match the tag.

The Trusted Publisher binding on the npm side must match:
- Repository owner: `ocrqueen`
- Repository: `ocrqueen-node`
- Workflow filename: `release.yml`
- Environment name: `npm`
…or the publish returns 404 (npm's confusing way of saying "no auth").

## Conventions

- All third-party GitHub Actions pinned by full commit SHA.
- Biome config: literal keys allowed (TypeScript's
  `noPropertyAccessFromIndexSignature` requires bracket notation; the
  biome `useLiteralKeys` rule conflicts with TS so we disable it).
- The smoke test enforces no leaked private symbols in `dir(ocrqueen)`
  beyond what's in `__all__` equivalent (we filter modules out).
- Dual-export pattern in `package.json` `exports` map — both ESM and
  CJS consumers work.

## Where to look when something's wrong

- `pnpm install --frozen-lockfile && pnpm test` — first sanity check.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.
- Release failed at npm publish step with `404`: see the npm 11+
  gotcha above. Also verify the Trusted Publisher binding matches.

## What's intentionally not here

- No retry on transient errors. Surface to caller.
- No async-iterator streaming. Add later if customers ask.
- No browser support — this is a Node-only SDK (uses `node:fs`,
  `node:crypto`).
