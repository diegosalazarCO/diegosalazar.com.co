// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://diegosalazar.com.co',
  integrations: [sitemap()],
  vite: {
    build: {
      // three.js (~650 kB) is lazy-loaded by the interactive scenes only, never by ordinary pages
      chunkSizeWarningLimit: 700,
    },
  },
});
