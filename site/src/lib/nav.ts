export type NavSection = {
  id: string;
  label: string;
  items: { slug: string; title: string }[];
};

/** Canonical nav order for the docs site. */
export const NAV_SECTIONS: { id: string; label: string; prefix?: string }[] = [
  { id: 'start', label: 'Start' },
  { id: 'concepts', label: 'Concepts' },
  { id: 'guides', label: 'Guides' },
  { id: 'reference', label: 'Reference' },
  { id: 'design', label: 'Design' },
];

export function withBase(path: string, base: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  if (!path || path === '/') return b || '/';
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}
