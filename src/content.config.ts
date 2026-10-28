import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const portfolio = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/portfolio' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string(),
      client: z.string().optional(),
      role: z.string().optional(),
      category: z.string(),
      tags: z.array(z.string()).default([]),
      date: z.coerce.date(),
      link: z.string().url().optional(),
      linkLabel: z.string().optional(),
      heroImage: image(),
      heroVideo: z.string().optional(),
      order: z.number().default(0),
    }),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      date: z.coerce.date(),
      categories: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
      heroImage: image().optional(),
      embedUrl: z.string().url().optional(),
      audioUrl: z.string().url().optional(),
      videoUrl: z.string().url().optional(),
    }),
});

export const collections = { portfolio, blog };
