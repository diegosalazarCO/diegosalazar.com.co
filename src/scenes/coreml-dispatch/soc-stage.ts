import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CurvePath,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineCurve3,
  LineLoop,
  LineSegments,
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Sprite } from 'three';
import { Effects, makeGlow } from '../engine/effects';
import type { Palette } from '../engine/palette';
import type { Pose, Stage, World } from '../engine/world';
import type { Unit } from './model';
import { BOARD, anePlateTexture, boardTextures, dieTexture, dramTexture, lidTexture, shadowTexture } from './textures';

export const SOC_COLORS = ['ane', 'gpu', 'cpu', 'alert'] as const;
export type SocPalette = Palette<(typeof SOC_COLORS)[number]>;
export type PresetName = 'overview' | 'ane' | 'gpu' | 'cpu';

const Y = new Vector3(0, 1, 0);
/** Height tokens hover at: above the tiles, under the heat spreader. */
const HOVER = 1.45;
const FABRIC_Y = 0.7;
const LANE_Z = 5;

export const BLOCK_X: Record<Unit, number> = { cpu: -10, gpu: 0, ane: 10 };

type Kind = 'p' | 'e' | 'l2' | 'gtile' | 'lane' | 'mac' | 'sram';
interface Tile {
  unit: Unit;
  kind: Kind;
  x: number;
  z: number;
  w: number;
  d: number;
  /** Base slab (omitted for overlay-only items such as SIMD lanes). */
  h: number;
  y0: number;
  /** Index within its group (row-major for MACs; tile for lanes). */
  i: number;
  r?: number;
  c?: number;
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The SoC diorama: evaluation board with SMT parts, an organic package with two LPDDR5X stacks, and a die
 * floor plan (4P + 4E CPU with shared L2, 16-core SIMD GPU, 16-core Neural Engine built around an 8×8
 * systolic MAC array with SRAM tiles), under a lid that can be lifted.
 *
 * The floor plan is illustrative: block counts follow a base Apple-silicon layout, but Apple does not
 * publish the Neural Engine's internals, so the MAC array is a model of how such accelerators work.
 */
export class SocStage implements Stage {
  readonly group = new Group();
  readonly effects = new Effects(this.group);
  readonly tickers = new Set<(dt: number, time: number) => void>();

  private tiles: Tile[] = [];
  private overlay!: InstancedMesh;
  private base!: InstancedMesh;
  private activity: Record<Unit, number> = { ane: 0, gpu: 0, cpu: 0 };
  private goal: Record<Unit, number> = { ane: 0, gpu: 0, cpu: 0 };
  private execStart: Record<Unit, number> = { ane: 0, gpu: 0, cpu: 0 };
  private halos = {} as Record<Unit | 'alert', Sprite>;
  private stall = 0;
  private stallGoal = 0;
  private cacheFlash = 0;
  private lid!: Mesh;
  private lidMat!: MeshStandardMaterial;
  private lidEdges!: LineSegments;
  private lidOn = true;
  private lidY = 1.95;
  private lidZ = 0;
  private lidOpacity = 0.97;
  private yawGoal = 0;
  private placed = false;
  private time = 0;
  private tmp = new Color();
  private dummy = new Object3D();

  constructor(
    private world: World,
    private palette: SocPalette,
  ) {
    this.buildBoard();
    this.buildSmt();
    this.buildPackage();
    this.buildFloorPlan();
    this.buildFabric();
    this.buildLid();
    this.buildHalosAndLabels();
  }

  // --- construction -----------------------------------------------------------------------------

  private buildBoard() {
    const { map, bump } = boardTextures();
    const body = new Mesh(new BoxGeometry(BOARD.w, 0.8, BOARD.d), new MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.6, metalness: 0.4 }));
    body.position.y = -0.4;
    const top = new Mesh(
      new PlaneGeometry(BOARD.w, BOARD.d).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 1.6, roughness: 0.5, metalness: 0.35 }),
    );
    top.position.y = 0.003;
    const edge = new LineSegments(new EdgesGeometry(body.geometry), new LineBasicMaterial({ color: 0x6a6a6a, transparent: true, opacity: 0.55 }));
    edge.position.copy(body.position);

    const shadow = new Mesh(
      new PlaneGeometry(96, 74).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, fog: false }),
    );
    shadow.position.y = -1.2;

    // gold edge connector with a key notch
    const fingers: number[] = [];
    for (let x = -21; x <= 21; x += 1.5) if (Math.abs(x - 4) > 1.1) fingers.push(x);
    const gold = new InstancedMesh(new BoxGeometry(0.6, 0.05, 1.4), new MeshStandardMaterial({ color: 0xb48f58, metalness: 1, roughness: 0.3 }), fingers.length);
    fingers.forEach((x, i) => gold.setMatrixAt(i, new Matrix4().makeTranslation(x, 0.04, BOARD.d / 2 - 1.1)));
    this.group.add(shadow, body, top, edge, gold);
  }

  /** 0402-style decoupling capacitors, ferrite inductors and a quartz crystal around the package. */
  private buildSmt() {
    const spots: { x: number; z: number; rot: number }[] = [];
    for (const z of [-14.6, 14.6]) for (let x = -18; x <= 18; x += 1.2) spots.push({ x, z, rot: 0 });
    for (const x of [-21.6, 21.6]) for (let z = -10; z <= 10; z += 1.2) spots.push({ x, z, rot: Math.PI / 2 });

    const body = new InstancedMesh(new BoxGeometry(0.62, 0.3, 0.34), new MeshStandardMaterial({ color: 0x8f7658, roughness: 0.6, metalness: 0.1 }), spots.length);
    const ends = new InstancedMesh(new BoxGeometry(0.16, 0.32, 0.36), new MeshStandardMaterial({ color: 0xd4d6d9, roughness: 0.25, metalness: 1 }), spots.length * 2);
    const m = new Matrix4();
    const q = new Quaternion();
    spots.forEach((s, i) => {
      q.setFromAxisAngle(Y, s.rot);
      body.setMatrixAt(i, m.compose(new Vector3(s.x, 0.17, s.z), q, new Vector3(1, 1, 1)));
      for (const side of [-1, 1]) {
        const off = new Vector3(side * 0.39, 0, 0).applyQuaternion(q);
        ends.setMatrixAt(i * 2 + (side < 0 ? 0 : 1), m.compose(new Vector3(s.x + off.x, 0.17, s.z + off.z), q, new Vector3(1, 1, 1)));
      }
    });
    this.group.add(body, ends);

    const ferrite = new MeshStandardMaterial({ color: 0x151618, roughness: 0.35, metalness: 0.6 });
    const metal = new MeshStandardMaterial({ color: 0xcfd1d4, roughness: 0.25, metalness: 1 });
    for (const [x, z] of [[-23.8, -9], [-23.8, -5.6], [-23.8, 6], [23.8, -9], [23.8, 6], [23.8, 9.4]]) {
      const coil = new Mesh(new BoxGeometry(1.5, 0.9, 2.1), ferrite);
      coil.position.set(x, 0.45, z);
      for (const s of [-1, 1]) {
        const cap = new Mesh(new BoxGeometry(0.3, 0.92, 2.14), metal);
        cap.position.set(x + s * 0.62, 0.46, z);
        this.group.add(cap);
      }
      this.group.add(coil);
    }
    const crystal = new Mesh(new BoxGeometry(3.2, 0.85, 2.4), metal);
    crystal.position.set(-22.4, 0.43, -12.4);
    this.group.add(crystal);
  }

  private buildPackage() {
    const pkg = new Mesh(new BoxGeometry(36, 0.5, 22), new MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.55, metalness: 0.55 }));
    pkg.position.y = 0.25;
    const rim = new LineSegments(new EdgesGeometry(pkg.geometry), new LineBasicMaterial({ color: 0x8a8a8a, transparent: true, opacity: 0.35 }));
    rim.position.copy(pkg.position);
    this.group.add(pkg, rim);

    // two LPDDR5X packages joined to the die by dense micro-bump rows
    const dramTop = dramTexture();
    const side = new MeshStandardMaterial({ color: 0x111215, metalness: 0.8, roughness: 0.35 });
    const top = new MeshStandardMaterial({ map: dramTop, metalness: 0.5, roughness: 0.4 });
    for (const z of [-7.8, 7.8]) {
      const dram = new Mesh(new BoxGeometry(12, 0.7, 4.2), [side, side, top, side, side, side]);
      dram.position.set(0, 0.85, z);
      this.group.add(dram);
    }
    const xs: number[] = [];
    for (let x = -11.8; x <= 11.8; x += 0.4) xs.push(x);
    const bumps = new InstancedMesh(new SphereGeometry(0.09, 8, 6), new MeshStandardMaterial({ color: 0xc89a5e, metalness: 1, roughness: 0.3 }), xs.length * 2);
    xs.forEach((x, i) => {
      bumps.setMatrixAt(i, new Matrix4().makeTranslation(x, 0.56, -5.5));
      bumps.setMatrixAt(xs.length + i, new Matrix4().makeTranslation(x, 0.56, 5.5));
    });
    this.group.add(bumps);
  }

  private addTile(t: Omit<Tile, 'i'> & { i?: number }) {
    this.tiles.push({ i: 0, ...t });
  }

  private buildFloorPlan() {
    // die
    const dieSide = new MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.7, roughness: 0.4 });
    const dieTop = new MeshStandardMaterial({ map: dieTexture(), metalness: 0.75, roughness: 0.32 });
    const die = new Mesh(new BoxGeometry(31, 0.5, 9.2), [dieSide, dieSide, dieTop, dieSide, dieSide, dieSide]);
    die.position.y = 0.75;
    this.group.add(die);

    const top = 1.0;
    // CPU: 4 performance cores, 4 efficiency cores, two shared L2 banks
    [[-13.6, -2.05], [-11, -2.05], [-13.6, 2.05], [-11, 2.05]].forEach(([x, z], i) =>
      this.addTile({ unit: 'cpu', kind: 'p', x, z, w: 2.4, d: 3.5, h: 0.2, y0: top, i }),
    );
    [[-8, -2.05], [-6.2, -2.05], [-8, 2.05], [-6.2, 2.05]].forEach(([x, z], i) =>
      this.addTile({ unit: 'cpu', kind: 'e', x, z, w: 1.4, d: 3.5, h: 0.14, y0: top, i }),
    );
    [-2.05, 2.05].forEach((z, i) => this.addTile({ unit: 'cpu', kind: 'l2', x: -9.25, z, w: 0.7, d: 3.5, h: 0.12, y0: top, i }));

    // GPU: 4×4 shader cores, each with 8 SIMD execution lanes
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const i = r * 4 + c;
        const x = -3.075 + c * 2.05;
        const z = -3.075 + r * 2.05;
        this.addTile({ unit: 'gpu', kind: 'gtile', x, z, w: 1.85, d: 1.85, h: 0.12, y0: top, i, r, c });
        for (let l = 0; l < 8; l++) this.addTile({ unit: 'gpu', kind: 'lane', x: x - 0.7 + l * 0.2, z, w: 0.12, d: 1.35, h: 0, y0: top + 0.12, i, r: l, c: i });
      }
    }

    // ANE: SRAM weight cache (left), 8×8 systolic MAC array on a 16-core plate, accumulator SRAM (right)
    const plate = new Mesh(new BoxGeometry(6.4, 0.1, 8.1).translate(0, 0.05, 0), new MeshStandardMaterial({ map: anePlateTexture(), metalness: 0.6, roughness: 0.4 }));
    plate.position.set(BLOCK_X.ane, top, 0);
    this.group.add(plate);
    [-3.15, -1.05, 1.05, 3.15].forEach((z, i) => {
      this.addTile({ unit: 'ane', kind: 'sram', x: 5.9, z, w: 1.3, d: 1.9, h: 0.12, y0: top, i, c: 0 });
      this.addTile({ unit: 'ane', kind: 'sram', x: 14.1, z, w: 1.3, d: 1.9, h: 0.12, y0: top, i: i + 4, c: 1 });
    });
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        this.addTile({ unit: 'ane', kind: 'mac', x: BLOCK_X.ane + (c - 3.5) * 0.72, z: (r - 3.5) * 0.9, w: 0.52, d: 0.7, h: 0.1, y0: top + 0.1, i: r * 8 + c, r, c });
      }
    }

    // instanced slabs and their glow overlays: two draw calls for the whole floor plan
    const slabs = this.tiles.filter((t) => t.h > 0);
    this.base = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.4 }), slabs.length);
    slabs.forEach((t, i) => {
      this.dummy.position.set(t.x, t.y0 + t.h / 2, t.z);
      this.dummy.scale.set(t.w, t.h, t.d);
      this.dummy.updateMatrix();
      this.base.setMatrixAt(i, this.dummy.matrix);
      this.base.setColorAt(i, this.tmp.set(t.kind === 'mac' || t.kind === 'sram' ? 0x2a2c31 : t.kind === 'p' ? 0x2d2e33 : 0x26272b));
    });
    this.overlay = new InstancedMesh(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false }),
      this.tiles.length,
    );
    this.tiles.forEach((t, i) => {
      this.dummy.position.set(t.x, t.y0 + t.h + 0.012, t.z);
      this.dummy.scale.set(t.w * 0.88, 1, t.d * 0.88);
      this.dummy.updateMatrix();
      this.overlay.setMatrixAt(i, this.dummy.matrix);
      this.overlay.setColorAt(i, this.tmp.setScalar(0));
    });
    this.overlay.frustumCulled = this.base.frustumCulled = false;
    this.group.add(this.base, this.overlay);

    // block outlines in each unit's colour
    (['cpu', 'gpu', 'ane'] as Unit[]).forEach((unit) => {
      const [x0, x1] = unit === 'cpu' ? [-15, -5] : unit === 'gpu' ? [-4.2, 4.2] : [5, 15];
      const pts = [x0, -4.3, x1, -4.3, x1, 4.3, x0, 4.3].flatMap((v, i, a) => (i % 2 ? [] : [v, 1.03, a[i + 1]]));
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pts, 3));
      const outline = new LineLoop(g, new LineBasicMaterial({ color: this.palette.color[unit], transparent: true, opacity: 0.55 }));
      this.group.add(outline);
    });
  }

  /** Copper fabric lanes joining each block to the memory stacks. */
  private buildFabric() {
    const mat = new MeshBasicMaterial({ color: 0xa8814f, transparent: true, opacity: 0.85 });
    const ribbon = (x0: number, z0: number, x1: number, z1: number, w = 0.09) => {
      const m = new Mesh(new BoxGeometry(Math.abs(x1 - x0) + w, 0.03, Math.abs(z1 - z0) + w), mat);
      m.position.set((x0 + x1) / 2, 0.52, (z0 + z1) / 2);
      this.group.add(m);
    };
    for (const sign of [-1, 1]) {
      for (const o of [0, 0.22, 0.44]) ribbon(-14, sign * (LANE_Z + o * sign), 14, sign * (LANE_Z + o * sign));
      for (const x of Object.values(BLOCK_X)) ribbon(x, sign * 4.6, x, sign * LANE_Z);
    }
  }

  private buildLid() {
    this.lidMat = new MeshStandardMaterial({ map: lidTexture(), metalness: 0.92, roughness: 0.34, transparent: true, opacity: 0.97 });
    this.lid = new Mesh(new BoxGeometry(33.4, 0.55, 12), this.lidMat);
    this.lidEdges = new LineSegments(new EdgesGeometry(this.lid.geometry), new LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.6 }));
    this.lid.add(this.lidEdges);
    this.lid.position.set(0, this.lidY, 0);
    this.group.add(this.lid);
  }

  private buildHalosAndLabels() {
    for (const unit of ['cpu', 'gpu', 'ane'] as Unit[]) {
      const halo = makeGlow(this.palette.color[unit], 13, 0);
      halo.position.set(BLOCK_X[unit], 1.5, 0);
      this.halos[unit] = halo;
      this.group.add(halo);
    }
    const alert = makeGlow(this.palette.color.alert, 16, 0);
    alert.position.set(BLOCK_X.ane, 1.5, 0);
    this.halos.alert = alert;
    this.group.add(alert);

    const labels: [Unit, string, string][] = [
      ['ane', 'Neural Engine', '16 cores · systolic MACs'],
      ['gpu', 'GPU', '16 cores · SIMD32 lanes'],
      ['cpu', 'CPU', '4 P + 4 E · shared L2'],
    ];
    for (const [unit, title, sub] of labels) {
      const anchor = new Group();
      anchor.position.set(BLOCK_X[unit], 0.7, 4.75);
      this.group.add(anchor);
      const label = this.world.addLabel(anchor, title, sub, 'unit below');
      label.el.style.setProperty('--tint', this.palette.css[unit]);
    }
    const mem = new Group();
    mem.position.set(0, 1.2, -9.9);
    this.group.add(mem);
    this.world.addLabel(mem, 'LPDDR5X', 'unified memory · on package', 'quiet', 0.2);
  }

  // --- API for the controller ---------------------------------------------------------------------

  /** Token route: out of memory (north stack) into a block. */
  memToUnit(unit: Unit, dx = 0): CurvePath<Vector3> {
    const x = BLOCK_X[unit] + dx;
    return this.route([[dx * 0.4, 0.8, -8], [dx * 0.4, FABRIC_Y, -LANE_Z], [x, FABRIC_Y, -LANE_Z], [x, HOVER, -3.4], [x, HOVER, 0]]);
  }

  /** Token route: hop between blocks along the north lane. */
  hop(a: Unit, b: Unit, dx = 0): CurvePath<Vector3> {
    return this.route([[BLOCK_X[a], HOVER, 0], [BLOCK_X[a], HOVER, -3.4], [BLOCK_X[a] + dx, FABRIC_Y, -LANE_Z + dx * 0.1], [BLOCK_X[b] + dx, FABRIC_Y, -LANE_Z + dx * 0.1], [BLOCK_X[b], HOVER, -3.4], [BLOCK_X[b], HOVER, 0]]);
  }

  /** Surge route: ANE back across the south lane into the CPU's L2 banks. */
  surgeToCpuCache(dz = 0): CurvePath<Vector3> {
    const z = LANE_Z + dz;
    return this.route([[BLOCK_X.ane, HOVER, 0], [BLOCK_X.ane, HOVER, 3.4], [BLOCK_X.ane, FABRIC_Y, z], [-9.25, FABRIC_Y, z], [-9.25, HOVER, 3.4], [-9.25, HOVER, 2.05]]);
  }

  /** Token route: result back out to the south memory stack. */
  unitToMem(unit: Unit, dx = 0): CurvePath<Vector3> {
    const x = BLOCK_X[unit];
    const z = LANE_Z + dx * 0.1;
    return this.route([[x, HOVER, 0], [x, HOVER, 3.4], [x + dx, FABRIC_Y, z], [dx * 0.4, FABRIC_Y, z], [dx * 0.4, 0.8, 8]]);
  }

  private route(points: number[][]): CurvePath<Vector3> {
    const path = new CurvePath<Vector3>();
    const v = points.map(([x, y, z]) => new Vector3(x, y, z));
    for (let i = 1; i < v.length; i++) path.add(new LineCurve3(v[i - 1], v[i]));
    return path;
  }

  /** Ease a unit's activity up or down; `begin` restarts its pattern clock. */
  setActivity(unit: Unit, level: number, begin = false) {
    this.goal[unit] = level;
    if (begin) this.execStart[unit] = this.time;
  }

  /** Neural Engine thermal / bus stall warning, 0..1. */
  setStall(level: number) {
    this.stallGoal = level;
  }

  flashCache() {
    this.cacheFlash = 1;
  }

  setLid(on: boolean, instant = false) {
    this.lidOn = on;
    if (instant) {
      this.lidY = on ? 1.95 : 13;
      this.lidZ = on ? 0 : -12;
      this.lidOpacity = on ? 0.97 : 0.13;
    }
  }

  get lidIsOn() {
    return this.lidOn;
  }

  /** Unit centre in world space, for anchoring callouts. */
  anchor(unit: Unit): Object3D {
    const o = new Object3D();
    o.position.set(BLOCK_X[unit], 1.4, 0);
    this.group.add(o);
    return o;
  }

  // --- Stage -------------------------------------------------------------------------------------

  presetPose(name: PresetName, portrait: boolean): Pose {
    const at = (x: number, y: number, z: number) => new Vector3(x, y, z).applyAxisAngle(Y, portrait ? -Math.PI / 2 : 0);
    const p = (target: Vector3, azimuth: number, elevation: number, halfW: number, halfH: number): Pose => ({ target, azimuth, elevation, halfW, halfH });
    if (portrait) {
      return {
        overview: p(at(0, 0.8, 0), 0, 0.98, 14.5, 19),
        ane: p(at(10, 1, 0), 0, 0.98, 6.4, 5.6),
        gpu: p(at(0, 1, 0), 0, 0.98, 6.4, 5.4),
        cpu: p(at(-6, 0.9, -1.5), 0, 0.98, 11.5, 9.8),
      }[name];
    }
    return {
      overview: p(at(0, 0.2, 1), -0.28, 0.62, 26, 12.2),
      ane: p(at(10, 1, 0), -0.12, 0.95, 7.4, 4.9),
      gpu: p(at(0, 1, 0), 0, 0.95, 6.6, 4.7),
      cpu: p(at(-6, 0.9, -1.5), 0.22, 0.8, 12.8, 7.8),
    }[name];
  }

  pose(portrait: boolean): Pose {
    return this.presetPose('overview', portrait);
  }

  /** Portrait phones turn the board so its long axis runs down the screen. */
  layout(portrait: boolean) {
    this.yawGoal = portrait ? -Math.PI / 2 : 0;
    if (!this.placed) {
      this.group.rotation.y = this.yawGoal;
      this.placed = true;
    }
  }

  update(dt: number, time: number) {
    this.time = time;
    this.group.rotation.y += (this.yawGoal - this.group.rotation.y) * (1 - Math.exp(-dt * 3));
    this.effects.update(dt);
    this.tickers.forEach((tick) => tick(dt, time));

    const k = 1 - Math.exp(-dt * 6);
    for (const u of ['ane', 'gpu', 'cpu'] as Unit[]) this.activity[u] += (this.goal[u] - this.activity[u]) * k;
    this.stall += (this.stallGoal - this.stall) * (1 - Math.exp(-dt * 8));
    this.cacheFlash = Math.max(0, this.cacheFlash - dt * 1.4);

    this.paintOverlay(time);
    this.paintHalos(time);
    this.moveLid(dt);
  }

  private paintOverlay(time: number) {
    const c = this.palette.color;
    const a = this.activity;
    const stallFlicker = this.stall * (0.55 + 0.45 * Math.sin(time * 26));
    this.tiles.forEach((t, idx) => {
      const e = time - this.execStart[t.unit];
      const act = a[t.unit];
      let level = 0.05;
      switch (t.kind) {
        case 'mac': {
          // diagonal wavefront sweeping from the top-left corner (weights stationary, activations flowing)
          const front = ((e - 0.2) * 9) % 20;
          const d = (t.r ?? 0) + (t.c ?? 0) - front;
          level = 0.07 + act * (Math.exp(-(d * d) / 3.4) + 0.1);
          break;
        }
        case 'sram': {
          const left = t.c === 0;
          level = 0.08 + act * (left ? 0.3 + 0.7 * Math.max(0, Math.sin(e * 6 + t.i)) : 0.2 + 0.8 * Math.max(0, Math.sin(e * 4.5 - 1 + t.i * 0.7)));
          break;
        }
        case 'lane': {
          const wave = Math.sin((t.i * 0.9 + (t.r ?? 0) * 0.55) - e * 9);
          level = 0.05 + act * (0.12 + 0.88 * smooth(0.45, 1, wave));
          break;
        }
        case 'gtile':
          level = 0.04 + act * 0.2;
          break;
        case 'p':
          level = 0.07 + act * (0.25 + 0.75 * Math.abs(Math.sin(e * 5 + t.i * 1.3)));
          break;
        case 'e':
          level = 0.05 + act * (0.12 + 0.35 * Math.abs(Math.sin(e * 4 + t.i * 0.9)));
          break;
        case 'l2':
          level = 0.08 + act * 0.3 + this.cacheFlash * (0.8 + 0.2 * Math.sin(time * 30));
          break;
      }
      this.tmp.copy(c[t.unit]);
      if (t.unit === 'ane' && this.stall > 0.02) {
        this.tmp.lerp(c.alert, Math.min(1, this.stall * 1.4));
        level = level * (1 - this.stall * 0.5) + stallFlicker * 0.7;
      }
      if (t.kind === 'l2' && this.cacheFlash > 0) this.tmp.lerp(c.alert, this.cacheFlash * 0.7);
      this.overlay.setColorAt(idx, this.tmp.multiplyScalar(Math.max(0, level)));
    });
    this.overlay.instanceColor!.needsUpdate = true;
  }

  private paintHalos(time: number) {
    for (const u of ['ane', 'gpu', 'cpu'] as Unit[]) {
      this.halos[u].material.opacity = this.activity[u] * 0.38 * (1 - this.stall * (u === 'ane' ? 1 : 0));
    }
    this.halos.alert.material.opacity = this.stall * (0.45 + 0.25 * Math.sin(time * 18));
  }

  private moveLid(dt: number) {
    // lifted: up and well back, so it never sits between the camera and the die in close-ups
    const goalY = this.lidOn ? 1.95 : 13;
    const goalZ = this.lidOn ? 0 : -12;
    const goalO = this.lidOn ? 0.97 : 0.13;
    const k = 1 - Math.exp(-dt * 4);
    this.lidY += (goalY - this.lidY) * k;
    this.lidZ += (goalZ - this.lidZ) * k;
    this.lidOpacity += (goalO - this.lidOpacity) * k;
    this.lid.position.set(0, this.lidY, this.lidZ);
    this.lid.rotation.x = (this.lidY - 1.95) * -0.012;
    this.lid.visible = this.lidOpacity > 0.02;
    this.lidMat.opacity = this.lidOpacity;
    this.lidMat.depthWrite = this.lidOpacity > 0.6;
    (this.lidEdges.material as LineBasicMaterial).opacity = 0.2 + this.lidOpacity * 0.45;
  }
}

