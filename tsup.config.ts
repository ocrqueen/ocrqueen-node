// ── tsup build config — produces dist/ for both ESM and CJS consumers ─
// Customers using `import` get the ESM build, customers using `require`
// get the CJS build. Both share one set of type declarations.
//
// `dts: true` runs the TypeScript compiler at build time to emit .d.ts
// alongside the JS — meaning users get full type-checked autocomplete
// the moment they `npm install ocrqueen`.

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  // Source maps disabled in the shipped package — they bloat the wheel
  // and would expose original file paths. Re-enable for local debugging
  // by passing `--sourcemap` on the CLI.
  sourcemap: false,
  // Clean the dist folder before each build so stale files from a
  // previous version can't leak into the npm publish.
  clean: true,
  // Don't bundle Node built-ins. We have no runtime deps to bundle
  // anyway (T5 — zero dependency surface for users).
  target: "node20",
  splitting: false,
  minify: false,
  // Re-export `package.json` metadata used at runtime (just `version`).
  // Falls back to a string literal if package.json layout changes —
  // see src/version.ts.
});
