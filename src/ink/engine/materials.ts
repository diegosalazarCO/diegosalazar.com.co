/**
 * Every shader of the ink flight, written once in TSL. three compiles the same node graphs to WGSL
 * for WebGPU and to GLSL for the WebGL 2 fallback, so there is no second shader to keep in step.
 *
 * The look has one rule: light never makes grey. A plate is ink on paper, and anything the lamp
 * does to it (a surface turning away, a shadow cast by the relief) is drawn as more ink, in line
 * screens that live in the plate's own space like the hatching of the drawing itself.
 */
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  normalize,
  positionGeometry,
  positionWorld,
  screenCoordinate,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;
type Vec3 = Node<'vec3'>;

/** State shared by every material: one set of uniforms, written once per frame. */
export const world = {
  /** What distance dissolves into: bone paper in the first act, near-black in the second. */
  fog: uniform(new THREE.Color(0xe9dfc8)),
  ink: uniform(new THREE.Color(0x0b0a08)),
  /** 0 = paper act (light is drawn as hatching) .. 1 = night act (the lamp reveals colour prints). */
  night: uniform(0),
  fogDensity: uniform(0.052),
  /** Viewport width / height. */
  aspect: uniform(1),
  /** projectionMatrix[1][1], i.e. 1 / tan(fov / 2). */
  focal: uniform(1),
  /** Signed length of the dust streaks along the rail, in world units. */
  streak: uniform(0),
};

const LAMP_REACH = 1.7; // plate units at which the lamp has lost half its strength
const LAMP_POWER = 1.45;
const HATCH_PITCH = 58; // lines per plate unit: about one line every 7 px at the framing distance

/** exp² distance fog towards the world tone. */
function fogged(colour: Vec3): Vec3 {
  const d = length(positionWorld.sub(cameraPosition)).mul(world.fogDensity);
  return mix(colour, world.fog, float(1).sub(exp(d.mul(d).negate())));
}

/** How much of the pixel a hairline around the sheet covers. `p` is in plate units, centred. */
function frame(p: Vec2, size: Vec2): Float {
  const half = size.mul(0.5);
  const edge = min(half.x.sub(abs(p.x)), half.y.sub(abs(p.y)));
  const width = float(0.007);
  return float(1).sub(smoothstep(width, width.add(fwidth(edge)), edge));
}

/**
 * One anti-aliased line screen. Returns ink coverage 0..1 for a wanted tone.
 * When the lines get thinner than a pixel the screen fades to its mean, so far plates go evenly
 * grey instead of shimmering.
 */
function screen(p: Vec2, angle: number, pitch: number, coverage: Float, warp: Float): Float {
  const phase = dot(p, vec2(Math.cos(angle), Math.sin(angle))).mul(pitch).add(warp);
  const ridge = abs(fract(phase).sub(0.5)).mul(2); // 0 on the line's spine, 1 halfway to the next
  const pixel = max(fwidth(phase).mul(2), 1e-4);
  const sharp = clamp(coverage.sub(ridge).div(pixel).add(0.5), 0, 1);
  return mix(sharp, coverage, smoothstep(0.6, 1.6, pixel)).mul(smoothstep(0.0, 0.06, coverage));
}

/** Two crossing screens: the first carries light tone, the second joins in for deep shadow. */
function hatch(p: Vec2, tone: Float, warp: Float): Float {
  const first = screen(p, 0.62, HATCH_PITCH, clamp(tone.mul(1.5).sub(0.06), 0, 0.74), warp);
  const second = screen(p, -0.93, HATCH_PITCH * 1.09, clamp(tone.sub(0.4).mul(1.7), 0, 0.8), warp.negate());
  return float(1).sub(float(1).sub(first).mul(float(1).sub(second)));
}

/**
 * Turns "how lit is this point" into the final colour.
 *  shade: 1 where the surface is lit like flat paper, 0 where it is turned away or in cast shadow
 *  pool:  the lamp's reach, 0 (out of range) .. 1
 */
function printed(albedo: Vec3, shade: Float, pool: Float, p: Vec2, size: Vec2, warp: Float): Vec3 {
  // The red spot colour is an object, never a surface: it takes no shading and keeps glowing at night.
  const red = smoothstep(0.3, 0.52, albedo.r.sub(max(albedo.g, albedo.b)));

  const ink = hatch(p, float(1).sub(shade), warp).mul(float(1).sub(red));
  const overprint = mix(vec3(0.05, 0.045, 0.04), vec3(0.3, 0.27, 0.24), world.night);
  const drawn = mix(albedo, albedo.mul(overprint), ink.mul(mix(0.94, 0.55, world.night)));

  // By day the page only dims a little outside the lamp. At night the lamp is what shows the print.
  const day = drawn.mul(mix(0.8, 1.0, pool));
  const lit = pool.mul(mix(0.3, 1.0, clamp(shade, 0, 1)));
  const dark = drawn.mul(lit.mul(1.25).add(0.11));
  const colour = mix(mix(day, dark, world.night), albedo, red.mul(mix(0.35, 0.9, world.night)));

  const lined = mix(colour, world.ink, frame(p, size).mul(float(1).sub(world.night)));
  return fogged(lined);
}

/**
 * The near plate: an adaptive mesh pushed out along z by the height it carries, shaded per pixel
 * from the relief texture (normal in R,G, height in B).
 *
 * Plate-specific numbers are uniforms, not constants, so every plate generates the same shader
 * text and the render pipeline is compiled once.
 */
export function reliefMaterial(options: {
  colour: THREE.Texture;
  relief: THREE.Texture;
  /** Plate size and relief depth in plate units, as baked into the normals. */
  width: number;
  height: number;
  depth: number;
  /** Shadow ray samples: 8 on capable GPUs, 5 on phones. */
  steps: number;
}) {
  /** 0 = a flat sheet .. 1 = fully embossed. */
  const extrude = uniform(0);
  /** The lamp, in the plate's own space. */
  const light = uniform(new THREE.Vector3(0, 0.5, 2));
  const size = uniform(new THREE.Vector2(options.width, options.height));
  const depth = uniform(options.depth);
  const lift = depth.mul(extrude);

  // Vertex: the mesh stores x, y in plate units and the height 0..1 in z.
  const material = new THREE.MeshBasicNodeMaterial();
  material.positionNode = vec3(positionGeometry.xy, positionGeometry.z.mul(lift));
  const uv = varying(vec2(positionGeometry.x.div(size.x).add(0.5), float(0.5).sub(positionGeometry.y.div(size.y))));

  // Fragment: rebuild the surface point and its normal from the relief texture.
  const relief = texture(options.relief, uv);
  const height = relief.b;
  const tilt = relief.rg.mul(2).sub(1);
  const slope = tilt.div(sqrt(max(float(1).sub(dot(tilt, tilt)), 0.04))).mul(extrude);
  const normal = normalize(vec3(slope, 1));
  const p = vec2(uv.x.sub(0.5).mul(size.x), float(0.5).sub(uv.y).mul(size.y));
  const point = vec3(p, height.mul(lift));

  const toLight = light.sub(point);
  const distance = length(toLight);
  const direction = toLight.div(distance);

  // Height-field shadow: walk towards the lamp only as far as the ray needs to clear the relief,
  // and keep the worst "terrain above the ray" as an angle, which gives a penumbra for free.
  const reach = clamp(lift.sub(point.z).div(max(toLight.z, 1e-3)), 0, 1);
  const jitter = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189));
  let blocked: Float = float(0);
  for (let k = 0; k < options.steps; k++) {
    const t = reach.mul(jitter.mul(0.7).add(k + 0.15).div(options.steps));
    const q = point.add(toLight.mul(t));
    const quv = vec2(q.x.div(size.x).add(0.5), float(0.5).sub(q.y.div(size.y)));
    const terrain = texture(options.relief, quv).level(1.5).b.mul(lift);
    blocked = max(blocked, terrain.sub(q.z).sub(lift.mul(0.02)).div(t.mul(distance).add(0.03)));
  }
  const shadow = float(1).sub(smoothstep(0.0, 0.24, blocked));

  // Shade relative to how the flat page would be lit by the same lamp: blank paper stays blank.
  const shade = clamp(dot(normal, direction).div(max(direction.z, 0.15)), 0, 1.4).mul(shadow);
  const fall = distance.div(LAMP_REACH);
  const pool = clamp(float(LAMP_POWER).div(fall.mul(fall).add(1)), 0, 1);

  // Lines bend over the form, the way an engraver wraps hatching around a volume.
  const warp = height.mul(lift).mul(9);
  const albedo = texture(options.colour, uv).rgb;
  material.colorNode = printed(albedo, shade, pool, p, size, warp);
  material.fog = false;

  return { material, extrude, light, depth };
}

export type ReliefHandles = ReturnType<typeof reliefMaterial>;

/**
 * The far plate: a flat quad showing its thumbnail from the shared atlas. One material for all of
 * them; it is the near shader with the relief and the lamp taken out, so the hand-over is seamless.
 */
export function farMaterial(atlas: THREE.Texture): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  const size = varying(attribute('plateSize', 'vec2'));
  const p = varying(positionGeometry.xy);
  const albedo = texture(atlas, attribute('atlasUv', 'vec2')).rgb;
  material.colorNode = printed(albedo, float(1), float(0), p, size, float(0));
  material.fog = false;
  return material;
}

/** The triangulation, drawn in the book's one accent colour. A debug view, off by default. */
export function wireMaterial(handles: ReliefHandles): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ wireframe: true });
  const lift = handles.depth.mul(handles.extrude);
  material.positionNode = vec3(positionGeometry.xy, positionGeometry.z.mul(lift).add(0.004));
  material.colorNode = fogged(vec3(0.62, 0.02, 0.01));
  material.fog = false;
  return material;
}

/**
 * Dust in the air between plates. Each mote is a screen-facing capsule spanned between its world
 * position and the same point a little further along the rail, so at speed the motes stretch into
 * streaks that radiate from the vanishing point: manga speed lines, but with real parallax.
 */
export function dustMaterial(range: number): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const seed = attribute('seed', 'vec3');
  const corner = attribute('corner', 'vec2'); // x: 0 = head, 1 = tail   y: -1 / +1 across the width
  const grain = attribute('grain', 'float');

  // Motes are fixed in the world and wrap around the camera, so the field is endless but stateless.
  const lead = cameraPosition.z.add(1.5);
  const offset = lead.add(seed.z.mul(range));
  const z = lead.sub(offset.sub(floor(offset.div(range)).mul(range)));
  const head = vec3(seed.x.sub(0.5).mul(11), seed.y.sub(0.5).mul(7), z);
  const tail = head.add(vec3(0, 0, world.streak));

  const view = cameraProjectionMatrix.mul(cameraViewMatrix);
  const a = view.mul(vec4(head, 1));
  const b = view.mul(vec4(tail, 1));
  const stretch = vec2(world.aspect, 1);
  const along = b.xy.div(b.w).sub(a.xy.div(a.w)).mul(stretch);
  const axis = along.div(max(length(along), 1e-4));
  const side = vec2(axis.y.negate(), axis.x);

  const end = mix(a, b, corner.x);
  const radius = mix(0.004, 0.017, grain.mul(grain)).mul(world.focal).div(end.w);
  const push = side.mul(corner.y).add(axis.mul(corner.x.mul(2).sub(1))).mul(radius).div(stretch);
  const clear = smoothstep(0.25, 0.9, min(a.w, b.w)); // fade out before a mote reaches the lens
  // A mote behind the camera would project inside out, so it is thrown outside the clip volume.
  material.vertexNode = select(clear.greaterThan(0), vec4(end.xy.add(push.mul(end.w)), end.z, end.w), vec4(2, 2, 2, 1));

  const across = varying(corner.y);
  const haze = varying(end.w).mul(world.fogDensity);
  const alpha = float(1).sub(across.mul(across)).mul(exp(haze.mul(haze).negate())).mul(varying(clear));
  material.colorNode = mix(world.ink, vec3(0.93, 0.82, 0.62), world.night);
  material.opacityNode = alpha.mul(mix(0.5, 0.34, world.night)).mul(varying(grain.mul(0.6).add(0.4)));
  material.fog = false;
  return material;
}

/**
 * The world behind everything: one triangle at the far plane, drawn after the plates so the depth
 * test rejects every pixel a plate already covers and the fill costs no overdraw.
 */
export function backdropMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ depthWrite: false });
  material.vertexNode = vec4(positionGeometry.xy, 1, 1);
  const centred = screenUV.sub(0.5).mul(vec2(world.aspect, 1));
  const vignette = float(1).sub(smoothstep(0.35, 1.25, length(centred)).mul(mix(0.16, 0.5, world.night)));
  const grain = fract(sin(dot(floor(screenCoordinate.xy), vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5);
  material.colorNode = world.fog.mul(vignette).mul(grain.mul(mix(0.035, 0.12, world.night)).add(1));
  material.fog = false;
  return material;
}
