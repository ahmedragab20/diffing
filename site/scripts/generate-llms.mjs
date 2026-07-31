/**
 * Emit llms.txt + llms-full.txt into dist after Astro build.
 * Paths are site-relative with BASE_PATH prefix for GitHub Pages.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contentRoot = join(root, 'src/content/docs');
const dist = join(root, 'dist');
const base = (process.env.BASE_PATH || '/diffing').replace(/\/$/, '');
const site = (process.env.SITE_URL || 'https://ahmedragab20.github.io').replace(/\/$/, '');
const origin = `${site}${base}`;

const pkg = JSON.parse(await readFile(join(root, '../package.json'), 'utf8'));

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else if (ent.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, '');
  const data = {};
  for (const line of fm.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    data[m[1]] = v;
  }
  return { data, body };
}

function slugFromPath(file) {
  const rel = relative(contentRoot, file).replace(/\\/g, '/');
  if (rel === 'index.md') return '';
  return rel.replace(/\.md$/, '');
}

function urlFor(slug) {
  if (!slug) return `${origin}/docs/`;
  return `${origin}/docs/${slug}/`;
}

const files = await walk(contentRoot);
const entries = [];

for (const file of files) {
  const raw = await readFile(file, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const slug = slugFromPath(file);
  entries.push({
    slug,
    title: data.title || slug || 'Documentation',
    summary: data.summary || data.description || '',
    description: data.description || '',
    section: data.section || 'start',
    order: Number(data.order || 99),
    body,
    url: urlFor(slug),
  });
}

const sectionOrder = ['start', 'concepts', 'guides', 'reference', 'design'];
entries.sort((a, b) => {
  const sa = sectionOrder.indexOf(a.section);
  const sb = sectionOrder.indexOf(b.section);
  if (sa !== sb) return sa - sb;
  return a.order - b.order || a.title.localeCompare(b.title);
});

const llms = `# diffing

> Local-first CLI for reviewing, navigating, and discussing git diffs with AI.
> Version ${pkg.version}. MIT. Loopback-only by default.

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

const full = [
  `# diffing — full documentation corpus`,
  ``,
  `Version ${pkg.version}. Generated for AI ingest. Prefer individual pages when possible.`,
  ``,
  ...entries.map((e) => {
    return [
      `---`,
      `url: ${e.url}`,
      `title: ${e.title}`,
      `---`,
      ``,
      `# ${e.title}`,
      ``,
      e.body.trim(),
      ``,
    ].join('\n');
  }),
].join('\n');

await mkdir(dist, { recursive: true });
await writeFile(join(dist, 'llms.txt'), llms, 'utf8');
await writeFile(join(dist, 'llms-full.txt'), full, 'utf8');
console.log(`Wrote llms.txt (${entries.length} pages) and llms-full.txt → ${dist}`);
