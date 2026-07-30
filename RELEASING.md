# Releasing

This document is for maintainers.

## One-time npm setup

The package is published as `@beremaran/opencode-goal`.

1. Sign in to npm with an account that can publish the `@beremaran` scope.
2. Seed the package from a clean `main` checkout:

   ```bash
   npm ci
   npm run check
   npm publish --access public
   ```

3. In the package settings on npmjs.com, configure GitHub Actions as a trusted
   publisher:
   - Organization or user: `beremaran`
   - Repository: `opencode-goal`
   - Workflow filename: `publish.yml`
   - Environment: leave blank

No npm token or repository secret is needed after trusted publishing is
configured.

## Regular release

1. Update the version in `package.json` and `package-lock.json`.
2. Move the relevant changelog entries from `Unreleased` into a dated version.
3. Run `npm run check` and `npm pack --dry-run`.
4. Merge the release change into `main`.
5. Publish a GitHub release whose tag exactly matches `v<package version>`.

Publishing the GitHub release runs `.github/workflows/publish.yml`. The workflow
checks the tag against `package.json`, runs the full test suite, and publishes
the package to npm with provenance.
