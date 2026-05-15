# Contributing

Thanks for considering a contribution. This repo follows the conventions of
the larger OCRQueen project; bits specific to the Node SDK live here.

## Development setup

Requires Node 20+ and pnpm 10. If you don't have pnpm:
`npm install -g pnpm@10`.

```bash
git clone git@github.com:ocrqueen/ocrqueen-node.git
cd ocrqueen-node
pnpm install
```

Run the gates that CI runs:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Pull requests

- Branch from `main`. Direct push is blocked by branch protection.
- Every PR is reviewed by a code owner — see [.github/CODEOWNERS](.github/CODEOWNERS).
- Keep diffs focused. Security-sensitive files (`src/_http.ts`,
  `src/_errors.ts`) require extra scrutiny — call out the change in
  the PR description.

## Releases (maintainers only)

We publish to npm via **Trusted Publishing** — there is no npm token
to leak. The release workflow ([.github/workflows/release.yml](.github/workflows/release.yml))
is the only path to publish.

To cut a release:

1. Open a PR that bumps `package.json` AND `src/version.ts` to the new
   version, and updates `CHANGELOG.md`. The build job asserts the tag
   and `package.json` version match, so they must be in lockstep.
2. Merge the PR (squash) once CI passes.
3. From `main`:
   ```bash
   git pull origin main
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. The `Release` workflow runs the `build` job (CI gates + tsup build),
   then waits for **manual approval** in the `npm` environment.
5. Approve the deployment in the GitHub Actions UI. The OIDC token is
   exchanged with npm, the package is published, and a Sigstore
   provenance attestation is automatically attached.

If something looks wrong between tagging and approval, **don't approve**
— nothing publishes. If a publish succeeds with a broken version, you
can't reuse that version — release a fixed `v0.1.1` instead.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.
