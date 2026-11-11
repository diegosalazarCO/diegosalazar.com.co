/**
 * Everything a plate needs before it can be drawn up close, done away from the main thread:
 * fetch and decode its two images, read the height channel back, and triangulate it.
 *
 * The mesh is never downloaded. It is derived here from the relief texture the plate needs anyway,
 * at a tolerance chosen for this screen, in a couple of milliseconds.
 */
import { Rtin } from './rtin';

export interface StreamRequest {
  job: number;
  colour: string;
  relief: string;
  /** Largest height error the mesh may have, as a fraction of the plate's full relief depth. */
  tolerance: number;
}

export interface Prepared {
  job: number;
  colour: ImageBitmap;
  relief: ImageBitmap;
  /** x, y in lattice units (0 .. GRID - 1, y down), z = height 0..1. */
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
  triangles: number;
  /** Time spent meshing, for the debug readout. */
  meshMs: number;
}

export type StreamReply = ({ ok: true } & Prepared) | { ok: false; job: number; error: string };

export const GRID = 257;

let rtin: Rtin | null = null;
let scratch: OffscreenCanvas | HTMLCanvasElement | null = null;

async function bitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  // Raw bytes, please: the relief is data, and the colour is tagged sRGB on the texture instead.
  return createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

/** The relief's blue channel, resampled so that lattice vertex k reads the texture at k / (GRID - 1). */
function lattice(relief: ImageBitmap): Float32Array {
  scratch ??= typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(GRID, GRID);
  scratch.width = scratch.height = GRID;
  const context = scratch.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  context.imageSmoothingQuality = 'high';
  context.clearRect(0, 0, GRID, GRID);
  context.drawImage(relief, 0.5, 0.5, GRID - 1, GRID - 1);
  const pixels = context.getImageData(0, 0, GRID, GRID).data;

  const height = new Float32Array(GRID * GRID);
  for (let i = 0; i < height.length; i++) height[i] = pixels[i * 4 + 2] / 255;
  // The sheet has no side walls, so its rim sits exactly on the page.
  for (let k = 0; k < GRID; k++) {
    height[k] = height[(GRID - 1) * GRID + k] = 0;
    height[k * GRID] = height[k * GRID + GRID - 1] = 0;
  }
  return height;
}

export async function prepare(request: StreamRequest): Promise<Prepared> {
  const [colour, relief] = await Promise.all([bitmap(request.colour), bitmap(request.relief)]);
  const started = performance.now();
  const height = lattice(relief);
  rtin ??= new Rtin(GRID);
  rtin.measure(height);
  const mesh = rtin.extract(height, request.tolerance);
  return { job: request.job, colour, relief, ...mesh, meshMs: performance.now() - started };
}
