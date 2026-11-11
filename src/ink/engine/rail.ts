/**
 * The camera rail: where every plate hangs and where the camera is for a scroll position.
 * Pure arithmetic, no three.js, so it can be reasoned about (and tested) on its own.
 *
 * `u` is the scroll position in plates: u = 3 is the moment plate 3 is framed (its "hero point").
 * The camera always travels down -z and never turns its head far, so nothing here can make
 * anyone seasick: plates are placed where a straight-ahead view frames them.
 */

/** Every sheet has the same area, so a landscape plate is not a giant next to a portrait one. */
const PLATE_AREA = 3; // world units²: a 3:4 sheet is 1.5 x 2
/** How much of the mean speed is left at a hero point. The camera lingers there, then hurries on. */
const DWELL = 0.82;
/** Half-width, in u, of the sidestep the camera takes around a sheet. */
const SWERVE = 0.3;

export interface Slot {
  index: number;
  /** +1: the plate hangs right of the rail, -1: left. */
  side: 1 | -1;
  /** World size of the sheet. */
  width: number;
  height: number;
  /** World position of its centre. */
  x: number;
  y: number;
  z: number;
  /** Where the camera stands when it frames this plate. */
  heroZ: number;
  /** How far past its hero point (in u) the camera crosses the plate's plane. */
  pass: number;
  /** How far the camera steps aside to get around the sheet. */
  swerve: number;
}

export interface Rail {
  slots: Slot[];
  /** Rail distance between two hero points. */
  spacing: number;
  /** Vertical field of view in degrees, and its half-angle tangents. */
  fov: number;
  tanV: number;
  tanH: number;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Radians. Positive yaw looks left; positive roll dips the left wing. */
  yaw: number;
  roll: number;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Scroll position -> distance along the rail, in plates. Monotonic, slowest at every integer. */
export const travel = (u: number): number => u - (DWELL * Math.sin(2 * Math.PI * u)) / (2 * Math.PI);

/** Inverse of `travel` on one period: how far past a hero point the camera has covered `d` plates. */
function travelInverse(d: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (travel(mid) < d) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Hang the plates for a viewport. Each one is placed so that a camera looking straight down the
 * rail from the plate's hero point sees it fill a "window" of the screen: the right or left half
 * on a wide screen (the caption takes the other half), the upper part on a tall one.
 */
export function layout(aspects: number[], viewportWidth: number, viewportHeight: number): Rail {
  const aspect = viewportWidth / viewportHeight;
  // Keep the horizontal field of view from collapsing on phones: a tall screen gets a wider lens.
  const tanV = clamp(0.3 / aspect, Math.tan((21 * Math.PI) / 180), Math.tan((34 * Math.PI) / 180));
  const tanH = tanV * aspect;
  const wide = smoothstep(0.8, 1.3, aspect);
  const halfW = mix(0.86, 0.46, wide);
  const halfH = mix(0.6, 0.8, wide);
  const centreY = mix(0.16, 0, wide);

  const sized = aspects.map((a, index) => {
    const width = Math.sqrt(PLATE_AREA * a);
    const height = Math.sqrt(PLATE_AREA / a);
    const distance = Math.max(width / 2 / (halfW * tanH), height / 2 / (halfH * tanV));
    return { index, width, height, distance };
  });
  const spacing = Math.max(9, 2.5 * Math.max(...sized.map((s) => s.distance)));

  const slots = sized.map(({ index, width, height, distance }): Slot => {
    const side = index % 2 === 0 ? 1 : -1;
    const heroZ = -index * spacing;
    const x = side * 0.4 * wide * tanH * distance;
    return {
      index,
      side,
      width,
      height,
      x,
      y: centreY * tanV * distance,
      z: heroZ - distance,
      heroZ,
      pass: travelInverse(distance / spacing),
      swerve: Math.max(0.32, width / 2 + 0.48 - Math.abs(x)),
    };
  });

  return { slots, spacing, fov: (2 * Math.atan(tanV) * 180) / Math.PI, tanV, tanH };
}

const bell = (t: number): number => (Math.abs(t) < 1 ? Math.cos((Math.PI * t) / 2) ** 2 : 0);

function position(rail: Rail, u: number): { x: number; z: number } {
  let x = 0;
  const first = Math.max(0, Math.floor(u) - 1);
  const last = Math.min(rail.slots.length - 1, Math.floor(u) + 1);
  for (let i = first; i <= last; i++) {
    const slot = rail.slots[i];
    x -= slot.side * slot.swerve * bell((u - i - slot.pass) / SWERVE);
  }
  return { x, z: -rail.spacing * travel(u) };
}

/** Where the camera is, and how it leans, at scroll position `u`. */
export function pose(rail: Rail, u: number): Pose {
  const here = position(rail, u);
  const ahead = position(rail, u + 0.01);
  const behind = position(rail, u - 0.01);
  // Turn half-way into the direction of travel and bank with it: enough to feel like flying.
  const heading = Math.atan2(-(ahead.x - behind.x), -(ahead.z - behind.z));
  return { x: here.x, y: 0, z: here.z, yaw: heading * 0.5, roll: heading * 0.3 };
}

/** 0 = a flat sheet .. 1 = fully embossed, for a plate `du` plates ahead (negative) of the camera. */
export const extrusion = (du: number): number => {
  const t = smoothstep(-0.56, -0.05, du);
  return 1 - (1 - t) ** 3;
};
