---
name: diffing-release
description: Cut a new diffing release end to end — version bump, changelog, build/test, commit, tag, push, npm publish, and GitHub release. Use when the user asks to release, ship, publish, bump, cut, or tag a new version of diffing (patch, minor, or major).
---

# Cut a diffing release

One command: `pnpm release --patch|--minor|--major`. It preflights, bumps every
version location, generates the changelog section, builds + tests, then
commits, tags, and pushes. CI (`.github/workflows/native-tui.yml`) takes over
from the tag push: builds all 7 native TUI binaries, publishes the npm package,
and creates the GitHub release.

## Decide the bump

| Bump | When |
| ------ | ------ |
| `--patch` (default) | Bug fixes and small UI polish — most releases |
| `--minor` | New user-facing features |
| `--major` | Breaking changes |

Preview first and show the human the plan before anything mutating:

```bash
pnpm release --dry-run --patch      # read-only: shows every bump, entry, command
```

Only run the real release on the human's go-ahead — it pushes to `main`,
creates a tag, and triggers a publish.

## What `pnpm release` does

1. **Preflight** — refuses to run if: working tree is dirty, not on `main`,
   or `main` is ahead of / behind `origin/main`.
2. **Bump** these 6 locations (all must stay in sync or `verify:release-bundle`
   fails):
   - `package.json` `version`
   - `Cargo.toml` `[workspace.package] version`
   - `Cargo.lock` — both `diffing-core` and `diffing-tui`
   - `site/src/layouts/BaseLayout.astro` + `site/src/pages/index.astro` —
     the `__DIFFING_VERSION__` fallback strings
3. **Changelog** — `git log <last-tag>..HEAD`, keeping only `feat`/`fix`
   subjects (skips `chore`/`style`/`docs`/`refactor`, merges, and
   `fix(release)` maintenance commits). Entries are `- <hash>: <Subject>`
   with the conventional prefix and scope stripped, subject capitalized, under
   `### Patch|Minor|Major Changes`. If there are no feat/fix commits it writes
   `- No user-facing changes` — flag this to the human: a release with nothing
   user-facing is probably not wanted.
4. **Verify** — `pnpm build && pnpm test` (`pnpm test` = vitest + cargo test).
   Skip with `--no-verify` if the human insists.
5. **Ship** — commit `chore(release): prepare vX.Y.Z`, tag `vX.Y.Z`, push
   `main` + tag.

## What CI does after the tag push

`native-tui.yml` on `refs/tags/v*` (~5–7 min, watch with
`gh run watch <id>`):

1. `build-native` — 7 target matrix (darwin arm64/x64, linux x64/arm64
   gnu+musl, win32 x64), stages each binary as an artifact.
2. `build-root` — installs, runs `verify:tui-bundle`, builds TS, checks the
   tag matches `package.json` version, downloads all binaries into
   `dist/native`, `verify:release-bundle`, `npm pack`.
3. `verify-install` — installs the tarball, `diffing doctor` finds the native
   binary.
4. `publish-root` — `npm publish --provenance` via **OIDC trusted publishing**
   (requires the npm trusted-publisher mapping for `ahmedragab20/diffing`).
   No npm token is used or needed.
5. `verify-published` — `npm install diffing@<version>` from the registry and
   doctor-checks it.
6. `create-release` — extracts the `## <version>` section from `CHANGELOG.md`
   (awk up to the next `##`), appends the
   `**Full Changelog**: …/compare/<prev>...<tag>` link, and runs
   `gh release create`. Runs only after publish is verified, so a broken
   build never produces a release entry.

## Verify a release landed

```bash
npm view diffing version                 # should be the new version
gh release list --limit 2                # new release marked Latest
gh run list --workflow=native-tui.yml    # all-green run for the tag
```

## Troubleshooting

| Symptom | Cause / fix |
| --------- | ------------- |
| Local `pnpm run verify:release-bundle` fails ("missing tui-darwin-x64") | **Expected locally.** Only the host platform's binary is staged; CI builds the other 6. Do not try to satisfy it locally. |
| `npm whoami` → 401 | Expected — local npm auth is not used. Publishing is OIDC-only via CI. |
| npm publish job fails | Check the trusted publisher for `ahmedragab20/diffing` in npm package settings. |
| npm published but no GitHub release | The `create-release` job failed or was skipped. Check `gh run view <id> --log`. If the changelog section is missing (e.g. hand-tagged), create manually: `gh release create vX.Y.Z --title vX.Y.Z --notes "$(awk '/^## X.Y.Z/{f=1;next}/^## /&&f{exit}f' CHANGELOG.md)"` |
| Release already exists | Script throws "version already X in file" — someone already bumped; reconcile first. |
| Changelog says "No user-facing changes" | Only chore/style commits since the last tag. Confirm with the human before releasing. |

## Do not

- Do not hand-bump versions or hand-commit `chore(release)` — the script owns
  that and its preflight protects against half-states.
- Do not `npm publish` locally, ever.
- Do not create the GitHub release before CI verifies the npm publish — the
  whole point of `create-release` is that release entries only appear after a
  verified publish.
- Do not run the real release (mutating) without the human's explicit go — but
  `--dry-run` first is always safe.
