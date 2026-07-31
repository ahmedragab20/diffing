# diffing documentation site

Static site (Astro) for the product landing page and documentation. Visual language follows **Gridline** (terminal-native, mono-first).

## Develop

```bash
pnpm install
pnpm dev
# → http://localhost:4321/diffing/
```

## Build

```bash
pnpm build
# → dist/ including prerendered llms.txt + llms-full.txt
pnpm preview
```

`llms.txt` / `llms-full.txt` are Astro endpoints (`src/pages/llms*.txt.ts`), so they work in **dev and production** (not only after a separate post-build script).

Environment:

| Variable | Default | Meaning |
|----------|---------|---------|
| `SITE_URL` | `https://ahmedragab20.github.io` | Canonical origin |
| `BASE_PATH` | `/diffing` | Project Pages base path |

## Deploy

GitHub Actions workflow `.github/workflows/docs.yml` builds and deploys `site/dist` to **GitHub Pages** on push to `main` when `site/**` (or the workflow) changes. Manual `workflow_dispatch` is enabled.

Live URL (once Pages is enabled on the repo):

https://ahmedragab20.github.io/diffing/

## Content

Markdown lives in `src/content/docs/`. Frontmatter:

```yaml
title: string
description: string
summary: string   # for llms.txt
order: number
section: start | concepts | guides | reference | design
```

Version badge is injected from the root `package.json` at build time.
