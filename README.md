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
  backdrop/     the site-wide WebGL backdrop (see below)
  scenes/       interactive full-screen scenes for `layout: fullscreen` posts (see below)
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

**Portfolio** (`src/templates/portfolio/ProjectTemplate.astro`): a sticky editorial split —
media (hero image/video + any `gallery` items, image or video, stacked) on one side, content
on the other, which stays in view as you scroll past the media; stacks mobile-first below
900px. The `layout` field (`standard` / `video` / `gallery`) still tags each project and is
free to point at a dedicated template again later if one project ever needs to diverge.

**Blog** (`src/templates/blog/`):
- `standard` (default) — full article: hero/embed, prose content
- `micro` — centered, large-type treatment for short posts, so a one-paragraph post doesn't
  look like an empty page
- `embed` — media-first: a large YouTube/SoundCloud embed up top, text below
- `fullscreen` — an interactive scene fills the viewport (no site chrome); the post's markdown
  becomes the "About" sheet and the no-WebGL fallback. Needs `scene: <id>` in frontmatter

Shared pieces used across templates live in `src/components/` (`ProjectLayout`, `ProjectMedia`,
`ProjectMeta`, `ProjectNav`, `PostMeta`) so each template file stays focused on layout, not
repeated markup.

Other frontmatter worth knowing:
- `order` (portfolio) — position in the homepage list and `/portfolio/` grid (lower = earlier)
- `category` (portfolio) — space-separated words (e.g. `"AI Fashion Product"`); each word becomes
  its own filter button on `/portfolio/`
- blog posts with no `heroImage` render as text tiles in the `/blog/` masonry grid; tile height
  cycles through tall/square/wide for visual rhythm

### Interactive scenes (`layout: fullscreen`)

A fullscreen post renders a **scene**: a self-contained interactive piece (WebGL diorama + HUD) inside
a shared stage. `src/templates/blog/FullscreenPost.astro` owns the shell (back link, About sheet, Focus
view, Fullscreen toggle and the viewport grid); the scene fills the grid with its own HUD.

```text
src/scenes/
  index.ts          registry: scene id -> component (the only file to touch to add a scene)
  engine/           shared 3D + HUD kit, knows nothing about any one scene
    world.ts          renderer, orbit camera, frame loop; frames the subject in the HUD's clear
                      area; setPose() flies the camera anywhere (stage switches, "dive into a tile")
    visuals.ts        NodeVisual / LinkVisual (holographic nodes, curved arrowed links)
    effects.ts        packets along a path, particle bursts, ripples, halos
    labels.ts         HTML labels pinned to 3D objects
    palette.ts        reads `--scene-*` CSS tokens so CSS stays the colour source of truth
    hud.ts, tour.ts   data-* driven HUD glue; cancellable scripted walkthroughs
  ui/               Tabs / Caption / Dock components + hud.css (the shared HUD look)
  arc-memory/       one scene: ArcMemoryScene.astro (HUD markup + tokens), main.ts (boot) and
                    its own logic (arc-graph.ts is a pure reference-counting model)
  coreml-dispatch/  another: a light-themed SoC diorama driven by model.ts, a pure model of how Core ML
                    places ops on the Neural Engine / GPU / CPU (procedural textures, no image assets)
```

To add a scene: create `src/scenes/<id>/` with a `<Id>Scene.astro` (compose `Tabs`, `Caption`, `Dock`,
declare `--scene-*` colour tokens on its root, load `main.ts` with a dynamic `import()` so three.js
stays out of every other page), register it in `src/scenes/index.ts`, then write a post with
`layout: fullscreen` and `scene: <id>`. A scene's 3D parts implement `Stage` (a `Group`, an
`update()` and a `pose()`), so they can be switched, reframed per screen shape and narrated the same way.
A scene can re-theme the whole stage (HUD, labels, shell) by overriding the `--hud-*` tokens in `ui/hud.css`
on `.stage:has([data-scene='<id>'])`; `coreml-dispatch` does this for a light, orange-accented look, and passes
`background: null` to `World` so its backdrop is plain CSS. HUD pieces tagged `data-hud` fade out in Focus view; the empty `[data-clear]` area is what the camera
is framed against, so nothing ends up under a card.

`three` is bundled by Vite as a lazy chunk, shared with the site backdrop. Scenes must stay usable without WebGL:
`Hud.fail()` swaps in the written fallback.

### Section system

Every block on every page opens the same way: a hairline, then a mono row of index / name / aside
(`.section-head` in `src/styles/global.css`). Use `components/Section.astro` for a block and
`components/PageHeader.astro` for a page title; lists use `.rows` / `.row`. Small metadata is always
`.label` (mono, uppercase). Keep new pages on these primitives so the site stays one system.

### Backdrop (`src/backdrop/`)

A fixed three.js canvas behind every non-immersive page, generated from the hero film
(`public/videos/hero.mp4`). On the homepage the playing `<video>` is the texture: it is drawn as a
relief (vertices pushed in depth by a blurred luminance map) that tilts with the pointer, and as
you scroll past the hero it dissolves into a sparse field of points that keep the film's colours.
Other pages show only the point field, sampled from `src/assets/backdrop/still.jpg` (a frame of the
film; regenerate it with `ffmpeg -ss 2 -i public/videos/hero.mp4 -frames:v 1 -vf scale=960:-1 …` if
the film changes). three.js is loaded with a dynamic `import()` after the page is readable, and the
backdrop is skipped for `prefers-reduced-motion`, Save-Data, or no WebGL, where the hero falls back
to the plain video.

### Ink flight (`src/ink/`, route `/ink/`)

A scroll-driven flight through the manga plates. Each drawing is a sheet of paper on a camera rail;
as the camera reaches it the sheet rises into relief and a lamp draws the form in hatching. With no
JavaScript, no GPU, reduced motion or Save-Data the same markup is a plain gallery.

```text
src/ink/
  catalog.json      hand-edited: which drawings, in what order, with titles (paths into the art repo)
  plates.gen.json   generated manifest; plates.ts joins it with the hashed asset URLs
  InkFlight.astro   markup (gallery + flight), page palette, boot script
  engine/
    flight.ts         renderer, frame loop, lamp, streaming policy, resolution governor
    rail.ts           pure maths: where plates hang and where the camera is for a scroll position
    plate.ts          one drawing: far quad (atlas thumbnail) <-> near relief mesh, streamed in and out
    materials.ts      every shader, in TSL (one graph -> WGSL for WebGPU, GLSL for the WebGL 2 fallback)
    stream.ts         fetch + decode + triangulate, run in stream.worker.ts
    rtin.ts           adaptive mesher (right-triangulated irregular network)
    hud.ts            scroll position -> rail position; captions, index rail, text tone
src/assets/ink/     generated: <id>.webp (drawing), <id>.relief.webp (normal + height), atlas.webp
tools/plates/       build_plates.py, the offline pipeline that writes all of the above
```

To add or reorder drawings: edit `catalog.json`, then run (needs `pip install numpy pillow onnxruntime`;
the depth model, named in the script header, is downloaded on first use):

```
python3 tools/plates/build_plates.py --art ../art
```

Commit the regenerated `src/assets/ink/` and `plates.gen.json`. The pipeline estimates depth, presses
blank paper flat, compresses the depth into a bas-relief (so forms swell out of the page instead of
standing on cliffs) and bakes a normal + height texture. No mesh is shipped: the browser triangulates
each plate from the height channel in a worker. `/ink/?gl` forces the WebGL 2 backend, `?mesh` (or
the W key) shows the triangulation with live triangle and draw-call counts.

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
