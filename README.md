# diegosalazar.com.co

Personal site, built with [Astro](https://astro.build). Replaces a WordPress-to-static export
previously hosted on S3.

## Structure

```text
src/
  components/   small, single-purpose UI pieces (Header, Footer, cards, meta blocks)
  layouts/      page shells (BaseLayout)
  templates/    per-content-type page layouts, selected via frontmatter (see below)
  lib/          shared utilities — content queries, formatting, constants
  content/      markdown content: portfolio/ and blog/ collections
  assets/       source images, optimized at build time
  pages/        routes (file-based) — stay thin: fetch data, pick a template, render it
public/         passthrough static files (CNAME, robots.txt, videos)
```

Content lives as markdown with typed frontmatter (see `src/content.config.ts`). Add a new
portfolio piece or blog post by dropping a `.md` file into `src/content/portfolio/` or
`src/content/blog/` — no code changes needed. Delete the file to remove it.

### Layouts

Each portfolio project and blog post picks a presentation **template** via a `layout` field in
its frontmatter. The route file (`src/pages/portfolio-item/[slug]/index.astro` or
`src/pages/blog/[slug]/index.astro`) just maps that value to a component in `src/templates/` —
adding a new look is: build the template, add one line to that map, opt content into it.

**Portfolio** (`src/templates/portfolio/`):
- `standard` (default) — hero image, content, metadata
- `video` — full-bleed cinematic video hero (for projects with `heroVideo`)
- `gallery` — hero + a clickable image grid below the content (needs a `gallery: [...]` array)

**Blog** (`src/templates/blog/`):
- `standard` (default) — full article: hero/embed, prose content
- `micro` — centered, large-type treatment for short posts, so a one-paragraph post doesn't
  look like an empty page
- `embed` — media-first: a large YouTube/SoundCloud embed up top, text below

Shared pieces used across templates live in `src/components/` (`ProjectMeta`, `ProjectNav`,
`PostMeta`) so each template file stays focused on layout, not repeated markup.

Other frontmatter worth knowing:
- `order` (portfolio) — position in the homepage list and `/portfolio/` grid (lower = earlier)
- `category` (portfolio) — space-separated words (e.g. `"AI Fashion Product"`); each word becomes
  its own filter button on `/portfolio/`
- blog posts with no `heroImage` render as text tiles in the `/blog/` masonry grid; tile height
  cycles through tall/square/wide for visual rhythm

### `src/lib/`

- `content.ts` — `getSortedProjects()`, `getSortedPosts()`, `getPrevNext()`
- `format.ts` — `formatDate()`
- `constants.ts` — contact email / `mailto()` helper

Use these instead of re-deriving sorting, date formatting, or the contact link inline.

## Commands

| Command           | Action                                      |
| :----------------- | :------------------------------------------- |
| `npm install`      | Install dependencies                          |
| `npm run dev`       | Start local dev server at `localhost:4321`    |
| `npm run build`     | Build the production site to `./dist/`        |
| `npm run preview`   | Preview the production build locally          |

## Deploy

Pushing to `master` triggers `.github/workflows/deploy.yml`, which builds the site and deploys
it to GitHub Pages. The custom domain is set via `public/CNAME` and registered with GitHub Pages
(`gh api --method PUT repos/<owner>/<repo>/pages -f cname=<domain>`).

DNS for the custom domain is managed in Route53 (not GoDaddy, which is only the registrar here):
apex `A` records point at GitHub Pages' 4 IPs, `www` is a `CNAME` to `<owner>.github.io`.
