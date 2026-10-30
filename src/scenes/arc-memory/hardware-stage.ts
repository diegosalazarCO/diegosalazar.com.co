import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CurvePath,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineCurve3,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Sprite } from 'three';
import { Effects, makeGlow } from '../engine/effects';
import type { Pose, Stage, World } from '../engine/world';
import type { ArcPalette } from './theme';

export interface Cell {
  index: number;
  chip: number;
  address: number;
  hex: string;
  /** Centre of the cell on the chip surface, stage-local. */
  position: Vector3;
}

export type CellState = 'free' | 'live' | 'fault' | 'dead' | 'probe';

interface CellRuntime {
  state: CellState;
  restore: CellState;
  value: number;
  color: Color;
  goal: Color;
  until: number;
}

const CHIPS = 8;
const CELL_COLS = 2;
const CELL_ROWS = 3;
const CHIP_X0 = 0.2;
const CHIP_PITCH = 1.85;
const CHIP_Z = -0.45;
const LANE_Z = 4.8;
const CPU = new Vector3(-10.25, 0, 0.5);
const DIMM = new Vector3(6.25, 0, 0);

/** Procedural dark PCB: faint grid, Manhattan traces and vias. */
function boardTexture(): CanvasTexture {
  const w = 1152;
  const h = 832;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#15171b';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.035)';
  g.lineWidth = 1;
  for (let x = 0; x <= w; x += 64) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  for (let y = 0; y <= h; y += 64) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  // deterministic pseudo-random traces so the board looks the same every visit
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.fillStyle = 'rgba(255,255,255,0.12)';
  for (let i = 0; i < 90; i++) {
    let x = Math.round(rnd() * 18) * 64;
    let y = Math.round(rnd() * 13) * 64;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      if (s % 2 === 0) x += (rnd() > 0.5 ? 1 : -1) * Math.round(1 + rnd() * 3) * 32;
      else y += (rnd() > 0.5 ? 1 : -1) * Math.round(1 + rnd() * 3) * 32;
      g.lineTo(x, y);
    }
    g.stroke();
    g.beginPath();
    g.arc(x, y, 3, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Top face of a DRAM chip: the 2×3 cell matrix with each cell's address printed on the silicon. */
function chipTexture(chip: number): CanvasTexture {
  const w = 248;
  const h = 480;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#0a0b0d';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.1)';
  g.lineWidth = 2;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.font = '600 26px ui-monospace, Menlo, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let r = 0; r < CELL_ROWS; r++) {
    for (let c = 0; c < CELL_COLS; c++) {
      const k = r * CELL_COLS + c;
      const cx = w * (0.28 + 0.44 * c);
      const cy = h * (0.18 + 0.32 * r);
      g.strokeStyle = 'rgba(255,255,255,0.13)';
      g.strokeRect(cx - 52, cy - 62, 104, 124);
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillText((0x1000 + chip * 0x40 + k * 4).toString(16).toUpperCase().padStart(4, '0'), cx, cy);
    }
  }
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath();
  g.arc(24, 24, 6, 0, Math.PI * 2);
  g.fill();
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function plate(text: string, w: number, h: number, font: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(40,44,52,0.85)';
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class HardwareStage implements Stage {
  readonly group = new Group();
  readonly effects = new Effects(this.group);
  /** Per-frame callbacks from the demo that animates this stage. */
  readonly tickers = new Set<(dt: number, time: number) => void>();
  readonly cells: Cell[] = [];
  /** Where the stack-frame node floats, above the CPU. */
  readonly stackAnchor = new Vector3(CPU.x, 4.6, CPU.z);

  private runtime: CellRuntime[] = [];
  private overlay: InstancedMesh;
  private glows = new Map<number, Sprite>();
  private yawGoal = 0;
  private placed = false;
  private time = 0;
  private nextTraffic = 1.2;
  private tmp = new Color();
  private matrix = new Matrix4();

  constructor(
    private world: World,
    private palette: ArcPalette,
  ) {
    this.buildBoard();
    this.buildCpu();
    const dimm = this.buildDimm();
    this.buildBus();

    this.overlay = new InstancedMesh(
      new PlaneGeometry(0.58, 0.66).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false }),
      this.cells.length,
    );
    this.cells.forEach((cell, i) => {
      this.matrix.makeTranslation(cell.position.x, cell.position.y + 0.012, cell.position.z);
      this.overlay.setMatrixAt(i, this.matrix);
      this.overlay.setColorAt(i, this.tmp.setScalar(0));
      this.runtime.push({ state: 'free', restore: 'free', value: 0, color: palette.color.strong.clone(), goal: palette.color.strong.clone(), until: 0 });
    });
    this.overlay.frustumCulled = false;
    this.group.add(this.overlay);

    // quiet orientation tags
    const cpuTag = new Group();
    cpuTag.position.set(CPU.x, 0.2, CPU.z + 5.2);
    const dimmTag = new Group();
    dimmTag.position.set(-1.4, 0.2, -5.2);
    this.group.add(cpuTag, dimmTag);
    this.world.addLabel(cpuTag, 'CPU', 'L1 · L2 cache', 'quiet');
    this.world.addLabel(dimmTag, 'DDR5 DIMM', '8 DRAM chips', 'quiet');

    // ambient energy around the silicon
    const cpuGlow = makeGlow(palette.color.strong, 15, 0.22);
    cpuGlow.position.set(CPU.x, 1.1, CPU.z);
    const dimmGlow = makeGlow(palette.color.strong, 22, 0.08);
    dimmGlow.position.set(dimm.x, 0.9, dimm.z);
    this.group.add(cpuGlow, dimmGlow);
  }

  // --- construction ---------------------------------------------------------------------------

  private buildBoard() {
    const tex = boardTexture();
    const top = new Mesh(new PlaneGeometry(36, 26).rotateX(-Math.PI / 2), new MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.25 }));
    top.position.y = 0.002;
    const body = new Mesh(new BoxGeometry(36, 0.6, 26), new MeshStandardMaterial({ color: 0x0d0e11, roughness: 0.7, metalness: 0.4 }));
    body.position.y = -0.3;
    const edge = new LineSegments(new EdgesGeometry(body.geometry), new LineBasicMaterial({ color: this.palette.color.strong, transparent: true, opacity: 0.28 }));
    edge.position.copy(body.position);
    this.group.add(body, top, edge);
  }

  private buildCpu() {
    const socket = new Mesh(new BoxGeometry(9, 0.22, 9), new MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.6, metalness: 0.5 }));
    socket.position.set(CPU.x, 0.11, CPU.z);
    const pkg = new Mesh(new BoxGeometry(7.6, 0.3, 7.6), new MeshStandardMaterial({ color: 0x20242b, roughness: 0.5, metalness: 0.5 }));
    pkg.position.set(CPU.x, 0.37, CPU.z);
    const ihs = new Mesh(new BoxGeometry(6.4, 0.32, 6.4), new MeshStandardMaterial({ color: 0xb4bac4, roughness: 0.26, metalness: 1 }));
    ihs.position.set(CPU.x, 0.68, CPU.z);
    const engraving = new Mesh(
      new PlaneGeometry(5.4, 1.1).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: plate('ARM64 · CPU', 512, 104, '700 54px ui-monospace, Menlo, monospace'), transparent: true }),
    );
    engraving.position.set(CPU.x, 0.846, CPU.z + 2.2);

    // cache tiers stacked on the heat spreader; edges glow with the accent
    const tiers = [
      { size: 4.4, y: 1.0 },
      { size: 2.6, y: 1.3 },
    ].map(({ size, y }) => {
      const mesh = new Mesh(new BoxGeometry(size, 0.3, size), new MeshStandardMaterial({ color: 0x15171c, roughness: 0.4, metalness: 0.7, emissive: this.palette.color.strong, emissiveIntensity: 0.12 }));
      mesh.position.set(CPU.x, y, CPU.z);
      const edges = new LineSegments(new EdgesGeometry(mesh.geometry), new LineBasicMaterial({ color: this.palette.color.strong, transparent: true, opacity: 0.9 }));
      mesh.add(edges);
      return mesh;
    });
    this.group.add(socket, pkg, ihs, engraving, ...tiers);
  }

  private buildDimm(): Vector3 {
    // carrier + latches
    const carrier = new Mesh(new BoxGeometry(18.4, 0.3, 7.6), new MeshStandardMaterial({ color: 0x08090b, roughness: 0.6, metalness: 0.4 }));
    carrier.position.set(DIMM.x, 0.15, DIMM.z);
    for (const side of [-1, 1]) {
      const latch = new Mesh(new BoxGeometry(0.5, 0.95, 1.5), new MeshStandardMaterial({ color: 0xcfd2d8, roughness: 0.5, metalness: 0.1 }));
      latch.position.set(DIMM.x + side * 9.45, 0.48, DIMM.z);
      this.group.add(latch);
    }
    const pcb = new Mesh(new BoxGeometry(17, 0.26, 6.4), new MeshStandardMaterial({ color: 0x16191e, roughness: 0.45, metalness: 0.55 }));
    pcb.position.set(DIMM.x, 0.43, DIMM.z);
    const pcbEdge = new LineSegments(new EdgesGeometry(pcb.geometry), new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }));
    pcb.add(pcbEdge);
    const silk = new Mesh(
      new PlaneGeometry(6.2, 0.8).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: plate('DDR5 · 16GB · 6400', 512, 64, '600 40px ui-monospace, Menlo, monospace'), transparent: true }),
    );
    silk.position.set(DIMM.x + 4.2, 0.565, -2.6);
    this.group.add(carrier, pcb, silk);

    // gold contact fingers along the front edge, with the DDR5 key notch
    const goldMat = new MeshStandardMaterial({ color: 0xd9b45a, metalness: 1, roughness: 0.22 });
    const xs: number[] = [];
    for (let x = -1.9; x <= 14.4; x += 0.24) if (x < 2.9 || x > 3.5) xs.push(x);
    const fingers = new InstancedMesh(new BoxGeometry(0.11, 0.03, 0.85), goldMat, xs.length);
    xs.forEach((x, i) => fingers.setMatrixAt(i, this.matrix.makeTranslation(x, 0.575, 2.75)));
    this.group.add(fingers);

    // PMIC + passives on the back strip
    const pmic = new Mesh(new BoxGeometry(1.5, 0.22, 1.0), new MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.4, metalness: 0.8 }));
    pmic.position.set(-1.2, 0.69, -2.4);
    const caps = new InstancedMesh(new BoxGeometry(0.28, 0.14, 0.16), new MeshStandardMaterial({ color: 0x3a3226, roughness: 0.5, metalness: 0.6 }), 14);
    for (let i = 0; i < 14; i++) caps.setMatrixAt(i, this.matrix.makeTranslation(1.3 + i * 0.9, 0.63, -2.45));
    this.group.add(pmic, caps);

    // DRAM chips and their cell matrix
    const chipMat = new MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.35, metalness: 0.85 });
    for (let chip = 0; chip < CHIPS; chip++) {
      const x = CHIP_X0 + chip * CHIP_PITCH;
      const top = new MeshStandardMaterial({ map: chipTexture(chip), roughness: 0.4, metalness: 0.6 });
      const mesh = new Mesh(new BoxGeometry(1.55, 0.26, 3.0), [chipMat, chipMat, top, chipMat, chipMat, chipMat]);
      mesh.position.set(x, 0.69, CHIP_Z);
      this.group.add(mesh);

      for (let r = 0; r < CELL_ROWS; r++) {
        for (let c = 0; c < CELL_COLS; c++) {
          const k = r * CELL_COLS + c;
          const address = 0x1000 + chip * 0x40 + k * 4;
          this.cells.push({
            index: this.cells.length,
            chip,
            address,
            hex: `0x${address.toString(16).toUpperCase()}`,
            position: new Vector3(x + (-0.5 + c) * 0.68 + 0, 0.82, CHIP_Z + (r - 1) * 0.95),
          });
        }
      }
    }
    return new Vector3(DIMM.x, 0.8, DIMM.z);
  }

  private buildBus() {
    const mat = new MeshBasicMaterial({ color: this.palette.color.strong, transparent: true, opacity: 0.32 });
    const ribbon = (a: Vector3, b: Vector3, width = 0.08) => {
      const dx = Math.abs(b.x - a.x);
      const dz = Math.abs(b.z - a.z);
      const mesh = new Mesh(new BoxGeometry(dx + width, 0.03, dz + width), mat);
      mesh.position.copy(a).lerp(b, 0.5).setY(0.04);
      this.group.add(mesh);
    };
    // three parallel lanes make the memory channel read as a bus, one lane fans out to every chip
    for (let lane = 0; lane < 3; lane++) {
      const z = LANE_Z + lane * 0.34;
      ribbon(new Vector3(-5.95, 0, 2.2 + lane * 0.34), new Vector3(-4.5 + lane * 0.34, 0, 2.2 + lane * 0.34));
      ribbon(new Vector3(-4.5 + lane * 0.34, 0, 2.2 + lane * 0.34), new Vector3(-4.5 + lane * 0.34, 0, z));
      ribbon(new Vector3(-4.5 + lane * 0.34, 0, z), new Vector3(14.4, 0, z));
    }
    for (let chip = 0; chip < CHIPS; chip++) ribbon(new Vector3(CHIP_X0 + chip * CHIP_PITCH, 0, LANE_Z), new Vector3(CHIP_X0 + chip * CHIP_PITCH, 0, 3.4));
  }

  // --- API for the demo -----------------------------------------------------------------------

  heapAnchor(cell: Cell): Vector3 {
    return new Vector3(cell.position.x, 8.4, cell.position.z);
  }

  /** Manhattan route a data packet takes from the CPU register file to a DRAM cell. */
  busPath(cell: Cell): CurvePath<Vector3> {
    const x = cell.position.x;
    const points = [
      new Vector3(-5.95, 0.2, 2.2),
      new Vector3(-4.5, 0.2, 2.2),
      new Vector3(-4.5, 0.2, LANE_Z),
      new Vector3(x, 0.2, LANE_Z),
      new Vector3(x, 0.2, 3.6),
      new Vector3(x, 1.0, 3.6),
      new Vector3(x, 1.0, cell.position.z),
    ];
    const path = new CurvePath<Vector3>();
    for (let i = 1; i < points.length; i++) path.add(new LineCurve3(points[i - 1], points[i]));
    return path;
  }

  setCell(cell: Cell, state: CellState, hold = 1.5) {
    const rt = this.runtime[cell.index];
    if (state === 'probe' || state === 'fault') rt.restore = rt.state === 'probe' || rt.state === 'fault' ? rt.restore : rt.state;
    rt.state = state;
    rt.until = this.time + hold;
    rt.goal.copy(
      state === 'fault' ? this.palette.color.fault : state === 'probe' ? this.palette.color.ok : this.palette.color.strong,
    );
    if (state === 'live') rt.color.copy(this.palette.color.strong);
  }

  // --- Stage ----------------------------------------------------------------------------------

  pose(portrait: boolean): Pose {
    return portrait
      ? { target: new Vector3(-0.8, 3, 0), azimuth: 0, elevation: 0.92, halfW: 10, halfH: 15.5 }
      : { target: new Vector3(0, 3.4, 0.8), azimuth: -0.3, elevation: 0.58, halfW: 17.5, halfH: 9.2 };
  }

  /** Portrait phones turn the board a quarter so the long axis runs down the screen. */
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

    // idle traffic on the memory bus, so the board is alive before anything is allocated
    if (!this.world.reducedMotion && time > this.nextTraffic) {
      this.nextTraffic = time + 1.4 + Math.random() * 1.8;
      const cell = this.cells[Math.floor(Math.random() * this.cells.length)];
      void this.effects.pulse(this.busPath(cell), this.palette.color.strong.clone().multiplyScalar(0.55), { duration: 1.6, size: 0.55 });
    }

    // DRAM refresh: a faint band sweeping across the chips
    const sweepX = -2 + ((time * 2.4) % 19);
    this.cells.forEach((cell, i) => {
      const rt = this.runtime[i];
      let goal = 0;
      let rate = 9;
      switch (rt.state) {
        case 'live':
          goal = 0.82 + 0.18 * Math.sin(time * 3 + i);
          break;
        case 'probe':
          goal = 1;
          if (time > rt.until) this.setCell(cell, rt.restore);
          break;
        case 'fault':
          goal = Math.sin(time * 24) > 0 ? 1 : 0.1;
          if (time > rt.until) this.setCell(cell, 'free');
          break;
        case 'dead':
          rate = 1.8;
          break;
      }
      rt.value += (goal - rt.value) * (1 - Math.exp(-dt * rate));
      rt.color.lerp(rt.goal, 1 - Math.exp(-dt * 10));

      const sweep = Math.max(0, 1 - Math.abs(cell.position.x - sweepX) / 1.5) * 0.045;
      this.tmp.copy(rt.color).multiplyScalar(rt.value);
      this.tmp.r += sweep;
      this.tmp.g += sweep;
      this.tmp.b += sweep;
      this.overlay.setColorAt(i, this.tmp);

      const active = rt.state !== 'free' && (rt.state !== 'dead' || rt.value > 0.02);
      let halo = this.glows.get(i);
      if (active && !halo) {
        halo = makeGlow(rt.color, 3.4, 0);
        halo.position.set(cell.position.x, cell.position.y + 0.5, cell.position.z);
        this.group.add(halo);
        this.glows.set(i, halo);
      }
      if (halo) {
        halo.material.color.copy(rt.color);
        halo.material.opacity = rt.value * 0.85;
      }
    });
    if (this.overlay.instanceColor) this.overlay.instanceColor.needsUpdate = true;
  }
}
