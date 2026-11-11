/**
 * The ink flight: a camera on a rail, driven by the page's own scroll, past sheets of paper that
 * rise into relief as it reaches them.
 *
 * Renderer: three.js WebGPURenderer. It runs on WebGPU where the browser has it and falls back to
 * WebGL 2 by itself, with the same TSL materials either way.
 *
 * What keeps it cheap:
 *  - the scene is fill-rate bound (a few big textured sheets), so the work is in not shading twice:
 *    opaque plates are drawn front to back, the backdrop is drawn last behind the depth buffer;
 *  - only the plates around the camera hold full-resolution textures and a mesh (see plate.ts);
 *  - decoding and meshing happen in a worker (see stream.ts), the main thread only uploads;
 *  - the canvas resolution follows the measured frame time, and an idle scene renders at half rate.
 */
import * as THREE from 'three/webgpu';
import type { InkData } from '../plates';
import { Hud } from './hud';
import { backdropMaterial, dustMaterial, farMaterial, world } from './materials';
import { Plate } from './plate';
import { layout, pose, smoothstep, type Rail } from './rail';
import { prepare, type Prepared, type StreamReply, type StreamRequest } from './stream';

const PAPER_WORLD = new THREE.Color(0xe9dfc8);
const NIGHT_WORLD = new THREE.Color(0x0c0a09);
const FOLLOW = 7; // 1/s: how tightly the camera follows the scroll position
const DUST = 720;
const DUST_RANGE = 46;
const RATIOS = [1, 1.25, 1.5, 2];
const MAX_STREAMS = 2;

export interface FlightOptions {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  data: InkData;
  /** Skip WebGPU even where it exists (the `?gl` switch, for comparing backends). */
  forceWebGL?: boolean;
}

export interface Flight {
  readonly backend: 'WebGPU' | 'WebGL 2';
  setWireframe(on: boolean): void;
  /** Numbers for the debug readout and for automated checks. */
  stats(): { u: number; triangles: number; drawCalls: number; near: number; ratio: number; frameMs: number; meshMs: number };
  dispose(): void;
}

/** Fetch, decode and mesh off the main thread; fall back to doing it inline where workers can't. */
class Streamer {
  inflight = 0;
  private readonly worker: Worker | null;
  private readonly waiting = new Map<number, { resolve: (ready: Prepared) => void; reject: (error: Error) => void }>();
  private next = 1;

  constructor() {
    let worker: Worker | null = null;
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try {
        worker = new Worker(new URL('./stream.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }: MessageEvent<StreamReply>) => {
          const entry = this.waiting.get(data.job);
          this.waiting.delete(data.job);
          if (data.ok) entry?.resolve(data);
          else entry?.reject(new Error(data.error));
        };
      } catch {
        worker = null;
      }
    }
    this.worker = worker;
  }

  load(colour: string, relief: string, tolerance: number): { job: number; ready: Promise<Prepared> } {
    const request: StreamRequest = { job: this.next++, colour, relief, tolerance };
    this.inflight++;
    const ready = (
      this.worker
        ? new Promise<Prepared>((resolve, reject) => {
            this.waiting.set(request.job, { resolve, reject });
            this.worker!.postMessage(request);
          })
        : prepare(request)
    ).finally(() => this.inflight--);
    return { job: request.job, ready };
  }

  dispose(): void {
    this.worker?.terminate();
  }
}

async function loadAtlas(url: string): Promise<THREE.Texture> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`atlas: ${response.status}`);
  const image = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const atlas = new THREE.Texture(image);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.flipY = false;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.anisotropy = 4;
  atlas.needsUpdate = true;
  return atlas;
}

function dust(): THREE.Mesh {
  const seed = new Float32Array(DUST * 4 * 3);
  const corner = new Float32Array(DUST * 4 * 2);
  const trait = new Float32Array(DUST * 4);
  const index = new Uint16Array(DUST * 6);
  const corners = [0, -1, 0, 1, 1, 1, 1, -1];
  // A fixed generator, so the dust is the same dust on every visit.
  let state = 0x2f6e2b1;
  const random = (): number => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x297a2d39) | 0;
    return ((state ^ (state >>> 13)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < DUST; i++) {
    const [x, y, z, t] = [random(), random(), random(), random()];
    for (let v = 0; v < 4; v++) {
      seed.set([x, y, z], (i * 4 + v) * 3);
      corner.set([corners[v * 2], corners[v * 2 + 1]], (i * 4 + v) * 2);
      trait[i * 4 + v] = t;
    }
    index.set([0, 1, 2, 0, 2, 3].map((k) => i * 4 + k), i * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
  geometry.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
  geometry.setAttribute('grain', new THREE.BufferAttribute(trait, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  const mesh = new THREE.Mesh(geometry, dustMaterial(DUST_RANGE));
  mesh.frustumCulled = false; // positioned in the vertex shader
  return mesh;
}

function backdrop(): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geometry, backdropMaterial());
  mesh.frustumCulled = false;
  mesh.renderOrder = 10; // after the plates: the depth test then skips every covered pixel
  return mesh;
}

export async function mountFlight({ root, canvas, data, forceWebGL = false }: FlightOptions): Promise<Flight> {
  // Start at the highest allowed pixel ratio the display has; the governor moves along RATIOS from there.
  const ceiling = Math.min(window.devicePixelRatio || 1, 2);
  let ratio = RATIOS.reduce((best, r) => (r <= ceiling ? r : best), RATIOS[0]);
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: ratio < 2, powerPreference: 'high-performance', forceWebGL });
  await renderer.init();
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const steps = isWebGPU && !coarse ? 8 : 5;
  const anisotropy = Math.min(8, renderer.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 90);
  camera.rotation.order = 'YXZ';

  const far = farMaterial(await loadAtlas(data.atlas));
  const plates = data.plates.map((plate) => new Plate(plate, data.plateHeight, far));
  for (const plate of plates) scene.add(plate.group);
  scene.add(dust(), backdrop());

  const hud = new Hud(root);
  const streamer = new Streamer();
  const nightAt = data.plates.findIndex((plate) => plate.act === 'night');
  let rail: Rail = layout([1], 1, 1);
  let wireframe = false;
  let disposed = false;
  let u = hud.position();
  let lastZ = 0;

  // ---- size ------------------------------------------------------------------------------------
  const resize = (): void => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    rail = layout(data.plates.map((plate) => plate.width / plate.height), width, height);
    camera.fov = rail.fov;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    world.aspect.value = camera.aspect;
    world.focal.value = 1 / rail.tanV;
    plates.forEach((plate, i) => plate.place(rail.slots[i]));
    hud.measure();
    lastZ = pose(rail, u).z; // the rail may have been re-spaced: that is not speed
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // ---- pointer: it carries the lamp, and leans the camera a little ----------------------------
  const pointer = { x: 0, y: 0, at: -Infinity };
  const lean = { x: 0, y: 0 };
  const onPointer = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = 1 - (event.clientY / window.innerHeight) * 2;
    pointer.at = performance.now();
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  // ---- streaming -------------------------------------------------------------------------------
  /** Mesh tolerance for this screen: about a pixel and a half of depth error at the framing distance. */
  const tolerance = (index: number): number => {
    const slot = rail.slots[index];
    const distance = slot.heroZ - slot.z;
    const worldPerPixel = (2 * distance * rail.tanV) / (canvas.height || 1);
    const depth = data.plates[index].depth * (slot.height / data.plateHeight);
    return Math.min(0.03, Math.max(0.008, (1.5 * worldPerPixel) / depth));
  };
  let meshMs = 0;
  const stream = (plate: Plate, index: number): void => {
    const { job, ready } = streamer.load(plate.data.colour, plate.data.relief, tolerance(index));
    plate.state = 'loading';
    plate.job = job;
    ready
      .then(async (prepared) => {
        if (plate.job !== job || disposed) {
          prepared.colour.close();
          prepared.relief.close();
          return;
        }
        meshMs = prepared.meshMs;
        const mesh = plate.adopt(prepared, { anisotropy, steps });
        // Build its pipeline before it is shown, so the first frame that draws it does not hitch.
        mesh.visible = true;
        const compiled = renderer.compileAsync(mesh, camera, scene).catch(() => {});
        mesh.visible = false;
        await compiled;
        if (plate.job === job && !disposed) plate.reveal(wireframe);
      })
      .catch(() => {
        // Offline or a failed decode: the thumbnail simply stays.
        if (plate.job === job) plate.state = 'far';
      });
  };
  const streamAround = (u: number): void => {
    const centre = Math.round(u + 0.3);
    for (let ring = 0; ring <= 3; ring++) {
      for (const index of ring === 0 ? [centre] : [centre + ring, centre - ring]) {
        const plate = plates[index];
        if (!plate) continue;
        const du = u - index;
        if (du > -1.7 && du < 1.0) {
          if (plate.state === 'far' && streamer.inflight < MAX_STREAMS) stream(plate, index);
        }
      }
    }
    for (let index = 0; index < plates.length; index++) {
      const du = u - index;
      if ((du < -2.6 || du > 1.5) && plates[index].state !== 'far') plates[index].release();
    }
  };

  // ---- frame -----------------------------------------------------------------------------------
  const lamp = new THREE.Vector3(0, 1, 2);
  const lampGoal = new THREE.Vector3();
  const ray = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  let last = performance.now();
  let speed = 0;
  let frameMs = 16;
  let slow = 0;
  let fast = 0;
  let parity = 0;
  let pointerWeight = 0;
  let lampPlaced = false;
  let readoutAt = 0;
  let lastNight = -1;

  const frame = (): void => {
    const now = performance.now();
    const elapsed = now - last;
    last = now;
    const dt = Math.min(0.05, elapsed / 1000);

    const goal = hud.position();
    // A jump (the scrollbar, Home/End, a link): arrive with a short glide instead of flying the whole way.
    if (Math.abs(goal - u) > 2.5) u = goal - Math.sign(goal - u) * 0.4;
    u += (goal - u) * (1 - Math.exp(-dt * FOLLOW));
    if (Math.abs(goal - u) < 1e-4) u = goal;

    const night = nightAt < 0 ? 0 : smoothstep(nightAt - 0.74, nightAt - 0.3, u);
    const pointing = now - pointer.at < 4000;
    const moving = Math.abs(goal - u) > 1e-4 || pointing || streamer.inflight > 0 || night !== lastNight || Math.abs(speed) > 0.01;
    lastNight = night;
    // Nothing but the lamp's slow drift is changing: half the frames are enough.
    parity ^= 1;
    if (!moving && parity) return;

    // camera
    const at = pose(rail, u);
    lean.x += (pointer.x - lean.x) * (1 - Math.exp(-dt * 4));
    lean.y += (pointer.y - lean.y) * (1 - Math.exp(-dt * 4));
    camera.position.set(at.x + lean.x * 0.14, at.y + lean.y * 0.09, at.z);
    camera.rotation.set(0, at.yaw, at.roll);
    camera.updateMatrixWorld();
    speed += ((at.z - lastZ) / Math.max(dt, 1e-3) - speed) * (1 - Math.exp(-dt * 10));
    lastZ = at.z;

    // world
    world.night.value = night;
    world.fog.value.lerpColors(PAPER_WORLD, NIGHT_WORLD, night);
    world.streak.value = Math.max(-3, Math.min(3, speed * 0.085));

    // lamp: it hangs in front of the next plate the camera has not passed yet
    let focus = plates.length - 1;
    for (let i = Math.max(0, Math.floor(u) - 1); i < plates.length; i++) {
      if (u < i + rail.slots[i].pass + 0.1) {
        focus = i;
        break;
      }
    }
    const sheet = plates[focus].group;
    const slot = rail.slots[focus];
    const scale = slot.height / data.plateHeight;
    const sweep = 2.3 + (u - focus) * 3.2 + now * 0.00022;
    lampGoal.set(Math.cos(sweep) * 0.62 * (slot.width / scale), (Math.sin(sweep) * 0.3 + 0.2) * data.plateHeight, 0.95);
    sheet.localToWorld(lampGoal);
    pointerWeight += ((pointing ? 1 : 0) - pointerWeight) * (1 - Math.exp(-dt * 3));
    if (pointerWeight > 0.001) {
      // where the pointer's ray meets the plane the lamp hangs in, in front of the sheet
      ray.set(lean.x, lean.y, 0.5).unproject(camera).sub(camera.position).normalize();
      normal.set(0, 0, 1).transformDirection(sheet.matrixWorld);
      anchor.set(0, 0, 0.95).applyMatrix4(sheet.matrixWorld);
      const along = anchor.sub(camera.position).dot(normal) / ray.dot(normal);
      if (along > 0 && Number.isFinite(along)) lampGoal.lerp(ray.multiplyScalar(along).add(camera.position), pointerWeight);
    }
    if (lampPlaced) lamp.lerp(lampGoal, 1 - Math.exp(-dt * 5));
    else lamp.copy(lampGoal);
    lampPlaced = true;

    // plates
    streamAround(u);
    let near = 0;
    plates.forEach((plate, i) => {
      plate.update(u - i, dt, lamp, rail.slots[i].pass);
      if (plate.state === 'near') near++;
    });

    hud.update(u, night);
    renderer.render(scene, camera);

    // Resolution governor: step the pixel ratio down when frames run long, back up when they are easy.
    if (elapsed < 200) frameMs += (elapsed - frameMs) * 0.08;
    if (moving) {
      slow = frameMs > 24 ? slow + 1 : 0;
      fast = frameMs < 13 ? fast + 1 : 0;
      const level = RATIOS.indexOf(ratio);
      if (slow > 45 && level > 0) {
        ratio = RATIOS[level - 1];
        slow = fast = 0;
        resize();
      } else if (fast > 240 && level < RATIOS.length - 1 && RATIOS[level + 1] <= ceiling) {
        ratio = RATIOS[level + 1];
        slow = fast = 0;
        resize();
      }
    }

    if (wireframe && now - readoutAt > 250) {
      readoutAt = now;
      const info = renderer.info.render;
      hud.readout(
        `${isWebGPU ? 'WebGPU' : 'WebGL 2'} · ${info.triangles.toLocaleString('en')} tris · ${info.drawCalls} draws · ` +
          `${near} near plates · ${ratio}x · ${frameMs.toFixed(1)} ms`,
      );
    }
  };
  await renderer.setAnimationLoop(frame);

  return {
    backend: isWebGPU ? 'WebGPU' : 'WebGL 2',
    setWireframe(on) {
      wireframe = on;
      for (const plate of plates) plate.setWireframe(on && plate.state === 'near');
      if (!on) hud.readout('');
    },
    stats() {
      const info = renderer.info.render;
      return {
        u,
        triangles: info.triangles,
        drawCalls: info.drawCalls,
        near: plates.filter((plate) => plate.state === 'near').length,
        ratio,
        frameMs,
        meshMs,
      };
    },
    dispose() {
      disposed = true;
      void renderer.setAnimationLoop(null);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointer);
      streamer.dispose();
      for (const plate of plates) plate.release();
      renderer.dispose();
    },
  };
}
