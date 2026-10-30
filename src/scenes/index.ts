import ArcMemoryScene from './arc-memory/ArcMemoryScene.astro';

/**
 * Interactive scenes available to `layout: fullscreen` blog posts.
 * A post opts in with `scene: <id>` in its frontmatter; the template renders the component
 * inside the shared stage shell (src/templates/blog/FullscreenPost.astro).
 */
export const scenes = {
  'arc-memory': ArcMemoryScene,
} as const;

export type SceneId = keyof typeof scenes;

export function isSceneId(id: string | undefined): id is SceneId {
  return id !== undefined && id in scenes;
}
