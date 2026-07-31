import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    summary: z.string(),
    order: z.number().default(99),
    section: z.enum(['start', 'concepts', 'guides', 'reference', 'design']),
  }),
});

export const collections = { docs };
