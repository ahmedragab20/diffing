import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, '../package.json'), 'utf8'));

// Project Pages: https://ahmedragab20.github.io/diffing/
const site = process.env.SITE_URL || 'https://ahmedragab20.github.io';
const base = process.env.BASE_PATH || '/diffing';

/** Prefix root-relative doc links with the site base path (GitHub Pages). */
function remarkPrefixBase() {
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  return function transformer(tree) {
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'link' || node.type === 'definition') {
        const url = node.url;
        if (
          typeof url === 'string' &&
          (url.startsWith('/docs') || url.startsWith('/llms'))
        ) {
          node.url = `${prefix}${url}`;
        }
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) visit(child);
      }
    };
    visit(tree);
  };
}

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  integrations: [sitemap()],
  markdown: {
    shikiConfig: {
      theme: 'rose-pine',
      wrap: true,
    },
    remarkPlugins: [remarkPrefixBase],
  },
  vite: {
    define: {
      __DIFFING_VERSION__: JSON.stringify(pkg.version),
    },
  },
});
