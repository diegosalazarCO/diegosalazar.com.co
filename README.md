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
`src/content/blog/` — no code changes needed.

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
