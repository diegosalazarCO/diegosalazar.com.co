# diegosalazar.com.co

Personal site, built with [Astro](https://astro.build). Replaces a WordPress-to-static export
previously hosted on S3.

## Structure

```text
src/
  components/   small, single-purpose UI pieces (Header, Footer, cards)
  layouts/      page shells (BaseLayout)
  content/      markdown content: portfolio/ and blog/ collections
  assets/       source images, optimized at build time
  pages/        routes (file-based)
public/         passthrough static files (CNAME, robots.txt, videos)
```

Content lives as markdown with typed frontmatter (see `src/content.config.ts`). Add a new
portfolio piece or blog post by dropping a `.md` file into `src/content/portfolio/` or
`src/content/blog/` — no code changes needed. Delete the file to remove it.

### Portfolio items

Every file in `src/content/portfolio/` renders through the same template
([src/pages/portfolio-item/\[slug\]/index.astro](src/pages/portfolio-item/%5Bslug%5D/index.astro)) —
add a project by copying an existing `.md` file as a starting point. Frontmatter fields that
control organization:

- `order` — controls position in the homepage list and `/portfolio/` grid (lower = earlier)
- `category` — space-separated words (e.g. `"AI Fashion Product"`); each word becomes its own
  filter button on `/portfolio/`
- `heroVideo` — optional, shows a looping video instead of the hero image on the detail page

### Blog posts

Files in `src/content/blog/` render on `/blog/` as a masonry grid — posts with a `heroImage`
show as image tiles, posts without one show as text tiles, and tile height cycles through
tall/square/wide for visual rhythm.

## Commands

| Command           | Action                                      |
| :----------------- | :------------------------------------------- |
| `npm install`      | Install dependencies                          |
| `npm run dev`       | Start local dev server at `localhost:4321`    |
| `npm run build`     | Build the production site to `./dist/`        |
| `npm run preview`   | Preview the production build locally          |

## Deploy

Pushing to `master` triggers `.github/workflows/deploy.yml`, which builds the site and deploys
it to GitHub Pages. The custom domain is set via `public/CNAME`.

One-time setup in the GitHub repo settings: **Settings → Pages → Source → GitHub Actions**, and
point the domain's DNS at GitHub Pages (see GitHub's
[custom domain docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)).
