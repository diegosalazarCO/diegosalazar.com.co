import type { Palette } from '../engine/palette';

/** Colour tokens this scene reads (`--scene-*`, declared in ArcMemoryScene.astro). */
export const ARC_COLORS = ['strong', 'weak', 'unowned', 'fault', 'ok'] as const;
export type ArcPalette = Palette<(typeof ARC_COLORS)[number]>;
