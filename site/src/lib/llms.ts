/**
 * Build llms.txt / llms-full.txt from the docs content collection.
 * Endpoints use this in both `astro dev` and static prerender.
 */
import { getCollection } from 'astro:content';

const SECTION_ORDER = ['start', 'concepts', 'guides', 'reference', 'design'];

export type LlmsEntry = {
  slug: string;
  title: string;
  summary: string;
  description: string;
  section: string;
  order: number;
  body: string;
  url: string;
};

function urlFor(origin: string, slug: string): string {
  if (!slug || slug === 'index') return `${origin}/docs/`;
  return `${origin}/docs/${slug}/`;
}

export function resolveOrigin(siteUrl?: string | URL | null, basePath?: string): string {
  const rawBase =
    basePath ||
    (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) ||
    process.env.BASE_PATH ||
    '/diffing';
  const base = String(rawBase).replace(/\/$/, '') || '';

  let site = '';
  if (siteUrl) {
    site = String(siteUrl).replace(/\/$/, '');
  } else {
    site = (process.env.SITE_URL || 'https://ahmedragab20.github.io').replace(/\/$/, '');
  }

  if (base && site.endsWith(base)) return site;
  return `${site}${base}`;
}

export async function loadLlmsEntries(origin: string): Promise<LlmsEntry[]> {
  const docs = await getCollection('docs');
  const entries: LlmsEntry[] = docs.map((entry) => {
    const slug = entry.id === 'index' ? '' : entry.id;
    return {
      slug,
      title: entry.data.title,
      summary: entry.data.summary || entry.data.description,
      description: entry.data.description,
      section: entry.data.section,
      order: entry.data.order,
      body: entry.body ?? '',
      url: urlFor(origin, entry.id),
    };
  });

  entries.sort((a, b) => {
    const sa = SECTION_ORDER.indexOf(a.section);
    const sb = SECTION_ORDER.indexOf(b.section);
    if (sa !== sb) return sa - sb;
    return a.order - b.order || a.title.localeCompare(b.title);
  });

  return entries;
}

function packageVersion(): string {
  return typeof __DIFFING_VERSION__ !== 'undefined' ? __DIFFING_VERSION__ : '0.0.0';
}

export async function buildLlmsTxt(origin: string): Promise<string> {
  const version = packageVersion();
  const entries = await loadLlmsEntries(origin);

  return `# diffing

> Local-first CLI for reviewing, navigating, and discussing git diffs with AI.
> Version ${version}. MIT. Loopback-only by default.

Site: ${origin}/
Package: https://www.npmjs.com/package/diffing
Repo: https://github.com/ahmedragab20/diffing

## Docs

${entries.map((e) => `- [${e.title}](${e.url}): ${e.summary || e.description}`).join('\n')}

## Optional

- [Full documentation corpus](${origin}/llms-full.txt): concatenated guides and reference for bulk ingest
- [GitHub README](https://github.com/ahmedragab20/diffing#readme)

## Agent quick facts

- Install: \`npm install -g diffing\`
- Start review: \`diffing\` (web default) or \`diffing --tui\`
- MCP: \`diffing mcp\` — 37 tools
- Themes: 52; default rose-pine; picker key \`g t\` (plain \`t\` is tab size)
- Await timeout exit 2 = park, do not silent-loop
- Plans: submit → park → obey verdict (approved / changes-requested / rejected)
- Storage: ~/.diffing/<repo>-<hash>/ ; settings ~/.config/diffing/settings.json
- Never write agent scratch into the consumer working tree
`;
}

export async function buildLlmsFullTxt(origin: string): Promise<string> {
  const version = packageVersion();
  const entries = await loadLlmsEntries(origin);

  return [
    `# diffing — full documentation corpus`,
    ``,
    `Version ${version}. Generated for AI ingest. Prefer individual pages when possible.`,
    ``,
    ...entries.map((e) =>
      [
        `---`,
        `url: ${e.url}`,
        `title: ${e.title}`,
        `---`,
        ``,
        `# ${e.title}`,
        ``,
        e.body.trim(),
        ``,
      ].join('\n'),
    ),
  ].join('\n');
}
