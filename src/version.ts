/**
 * Single source of truth for the SDK version string.
 *
 * Read by `src/_http.ts` to set the `User-Agent` header so we can later
 * rate-limit broken versions in the API gateway without pushing a new
 * SDK release.
 *
 * Bump in lockstep with the `version` field in `package.json` — the CI
 * release workflow asserts the two match before publishing.
 */
export const VERSION = "0.0.0";
