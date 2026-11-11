/**
 * Right-triangulated irregular network (RTIN) mesher for a square height grid.
 *
 * After Evans, Kirkpatrick & Townsend, "Right-Triangulated Irregular Networks" (2001), in the compact
 * form popularised by Mapbox's Martini. The grid is covered by an implicit binary tree of right
 * triangles. Each triangle is split at the midpoint of its long edge; `errors[midpoint]` holds the
 * worst height error of everything beneath that split, so extracting a mesh for a tolerance is one
 * top-down walk that stops as soon as a triangle is already flat enough. Neighbours share long-edge
 * midpoints, which is what keeps the result free of cracks and T-junctions.
 *
 * Flat paper costs two triangles; a cat's ear costs as many as it needs.
 */

export interface RtinMesh {
  /** x, y, z per vertex. x and y are lattice coordinates (0 .. grid-1, y down), z is the height. */
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
  triangles: number;
}

export class Rtin {
  readonly grid: number;
  private readonly tile: number;
  private readonly count: number;
  private readonly parents: number;
  /** Long-edge endpoints (ax, ay, bx, by) of every triangle in the tree. */
  private readonly coords: Uint16Array;
  private readonly errors: Float32Array;
  private readonly slot: Uint32Array;

  constructor(grid = 257) {
    const tile = grid - 1;
    if (tile & (tile - 1)) throw new Error('RTIN grid must be 2^k + 1');
    this.grid = grid;
    this.tile = tile;
    this.count = tile * tile * 2 - 2;
    this.parents = this.count - tile * tile;
    this.coords = new Uint16Array(this.count * 4);
    this.errors = new Float32Array(grid * grid);
    this.slot = new Uint32Array(grid * grid);

    for (let i = 0; i < this.count; i++) {
      let id = i + 2;
      let ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0;
      if (id & 1) bx = by = cx = tile;
      else ax = ay = cy = tile;
      while ((id >>= 1) > 1) {
        const mx = (ax + bx) >> 1;
        const my = (ay + by) >> 1;
        if (id & 1) {
          bx = ax; by = ay;
          ax = cx; ay = cy;
        } else {
          ax = bx; ay = by;
          bx = cx; by = cy;
        }
        cx = mx; cy = my;
      }
      const k = i * 4;
      this.coords[k] = ax;
      this.coords[k + 1] = ay;
      this.coords[k + 2] = bx;
      this.coords[k + 3] = by;
    }
  }

  /** Bottom-up pass: for every split point, how wrong the surface is if that vertex is left out. */
  measure(height: Float32Array): void {
    const { grid: size, coords, errors, count, parents } = this;
    errors.fill(0);
    for (let i = count - 1; i >= 0; i--) {
      const k = i * 4;
      const ax = coords[k], ay = coords[k + 1], bx = coords[k + 2], by = coords[k + 3];
      const mx = (ax + bx) >> 1;
      const my = (ay + by) >> 1;
      const cx = mx + my - ay;
      const cy = my + ax - mx;
      const middle = my * size + mx;
      let error = Math.abs((height[ay * size + ax] + height[by * size + bx]) / 2 - height[middle]);
      if (errors[middle] > error) error = errors[middle];
      if (i < parents) {
        const left = errors[((ay + cy) >> 1) * size + ((ax + cx) >> 1)];
        const right = errors[((by + cy) >> 1) * size + ((bx + cx) >> 1)];
        if (left > error) error = left;
        if (right > error) error = right;
      }
      errors[middle] = error;
    }
  }

  /** Top-down pass: the coarsest crack-free mesh whose height error stays under `tolerance`. */
  extract(height: Float32Array, tolerance: number): RtinMesh {
    const { grid: size, tile, errors, slot } = this;
    slot.fill(0);
    let vertices = 0;
    let triangles = 0;

    // Count first so the buffers are allocated once, at their final size.
    const count = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void => {
      const mx = (ax + bx) >> 1;
      const my = (ay + by) >> 1;
      if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * size + mx] > tolerance) {
        count(cx, cy, ax, ay, mx, my);
        count(bx, by, cx, cy, mx, my);
      } else {
        if (!slot[ay * size + ax]) slot[ay * size + ax] = ++vertices;
        if (!slot[by * size + bx]) slot[by * size + bx] = ++vertices;
        if (!slot[cy * size + cx]) slot[cy * size + cx] = ++vertices;
        triangles++;
      }
    };
    count(0, 0, tile, tile, tile, 0);
    count(tile, tile, 0, 0, 0, tile);

    const positions = new Float32Array(vertices * 3);
    const indices = vertices > 65535 ? new Uint32Array(triangles * 3) : new Uint16Array(triangles * 3);
    let cursor = 0;

    const emit = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void => {
      const mx = (ax + bx) >> 1;
      const my = (ay + by) >> 1;
      if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * size + mx] > tolerance) {
        emit(cx, cy, ax, ay, mx, my);
        emit(bx, by, cx, cy, mx, my);
      } else {
        const a = slot[ay * size + ax] - 1;
        const b = slot[by * size + bx] - 1;
        const c = slot[cy * size + cx] - 1;
        positions[a * 3] = ax; positions[a * 3 + 1] = ay; positions[a * 3 + 2] = height[ay * size + ax];
        positions[b * 3] = bx; positions[b * 3 + 1] = by; positions[b * 3 + 2] = height[by * size + bx];
        positions[c * 3] = cx; positions[c * 3 + 1] = cy; positions[c * 3 + 2] = height[cy * size + cx];
        // Lattice y runs down the image; in the world it runs up, which makes (a, b, c) counter-clockwise.
        indices[cursor++] = a;
        indices[cursor++] = b;
        indices[cursor++] = c;
      }
    };
    emit(0, 0, tile, tile, tile, 0);
    emit(tile, tile, 0, 0, 0, tile);

    return { positions, indices, triangles };
  }
}
