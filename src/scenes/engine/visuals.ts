import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  QuadraticBezierCurve3,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { BufferGeometry, Object3D, Sprite } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { makeGlow } from './effects';
import type { Label3D } from './labels';

/** What the visuals need from the world; `World` implements this. */
export interface Scenery {
  readonly resolution: Vector2;
  readonly lineMaterials: Set<LineMaterial>;
  readonly reducedMotion: boolean;
  addLabel(anchor: Object3D, title: string, sub?: string, className?: string, lift?: number, liftPx?: number): Label3D;
  removeLabel(label: Label3D): void;
}

export type Shape = 'sphere' | 'box' | 'icosahedron' | 'octahedron' | 'dodecahedron' | 'disc';

function shapeGeometry(shape: Shape): { geometry: BufferGeometry; radius: number } {
  switch (shape) {
    case 'box':
      return { geometry: new BoxGeometry(1.6, 1.6, 1.6), radius: 1.3 };
    case 'icosahedron':
      return { geometry: new IcosahedronGeometry(1.1), radius: 1.1 };
    case 'octahedron':
      return { geometry: new OctahedronGeometry(1.0), radius: 1.0 };
    case 'dodecahedron':
      return { geometry: new DodecahedronGeometry(1.25), radius: 1.25 };
    case 'disc':
      return { geometry: new CylinderGeometry(1.7, 1.7, 0.34, 40), radius: 1.7 };
    default:
      return { geometry: new SphereGeometry(1.05, 32, 24), radius: 1.05 };
  }
}

export interface NodeOptions {
  shape: Shape;
  color: Color;
  position: Vector3;
  title: string;
  sub?: string;
  /** Final scale of the node (it springs in from nothing). */
  scale?: number;
  /** Stacked copies of the shape, e.g. 3 discs for a stack frame. */
  layers?: number;
  labelClass?: string;
}

/**
 * A holographic node: emissive core, wire shell, soft halo and an HTML label. `anchor` is the fixed
 * base position links attach to; `body` floats gently around it.
 */
export class NodeVisual {
  readonly anchor = new Group();
  readonly body = new Group();
  readonly radius: number;
  readonly label: Label3D;
  /** Fully shrunk after despawn(); the owner can drop its reference. */
  gone = false;

  private core: Mesh[] = [];
  private coreMaterial: MeshStandardMaterial;
  private shell: LineSegments;
  private halo: Sprite;
  private size = 0.001;
  private velocity = 0;
  private target: number;
  private base: Color;
  private leaked = false;
  private ghost = false;
  private phase = Math.random() * Math.PI * 2;
  private geometry: BufferGeometry;

  constructor(
    private scenery: Scenery,
    private parent: Object3D,
    opts: NodeOptions,
  ) {
    const { geometry, radius } = shapeGeometry(opts.shape);
    this.geometry = geometry;
    const scale = opts.scale ?? 1;
    this.target = scale;
    this.radius = radius * scale;
    this.base = opts.color.clone();

    this.coreMaterial = new MeshStandardMaterial({
      color: this.base.clone().multiplyScalar(0.3),
      emissive: this.base,
      emissiveIntensity: 0.6,
      roughness: 0.35,
      metalness: 0.6,
      transparent: true,
      opacity: 0.94,
    });
    const layers = opts.layers ?? 1;
    for (let i = 0; i < layers; i++) {
      const mesh = new Mesh(geometry, this.coreMaterial);
      mesh.position.y = (i - (layers - 1) / 2) * 0.75;
      this.core.push(mesh);
      this.body.add(mesh);
    }

    this.shell = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: this.base, transparent: true, opacity: 0.75 }));
    this.shell.scale.setScalar(1.16);
    this.body.add(this.shell);

    this.halo = makeGlow(this.base, radius * 5.2, 0.4);
    this.body.add(this.halo);

    this.body.scale.setScalar(this.size);
    this.anchor.position.copy(opts.position);
    this.anchor.add(this.body);
    parent.add(this.anchor);

    this.label = scenery.addLabel(this.body, opts.title, opts.sub, opts.labelClass, radius * scale + 0.9);
  }

  update(dt: number, time: number) {
    // damped spring: pops in with a little overshoot, shrinks smoothly when despawned
    const accel = 170 * (this.target - this.size) - 15 * this.velocity;
    this.velocity += accel * dt;
    this.size = Math.max(0.0001, this.size + this.velocity * dt);
    this.body.scale.setScalar(this.size);
    this.label.el.style.opacity = String(Math.min(1, Math.max(0, this.size * 1.3 - 0.1)));

    if (!this.scenery.reducedMotion) {
      this.body.position.y = Math.sin(time * 1.4 + this.phase) * 0.14;
      this.shell.rotation.y += dt * 0.35;
    }
    if (this.leaked) {
      this.coreMaterial.emissiveIntensity = 0.55 + 0.4 * Math.sin(time * 13 + this.phase) * Math.sin(time * 4.3);
    }
    if (this.target === 0 && this.size < 0.02) this.gone = true;
  }

  despawn() {
    this.target = 0;
  }

  tint(color: Color) {
    this.base.copy(color);
    this.coreMaterial.emissive.copy(color);
    this.coreMaterial.color.copy(color).multiplyScalar(0.3);
    (this.shell.material as LineBasicMaterial).color.copy(color);
    this.halo.material.color.copy(color);
  }

  /** Red and flickering: alive, but unreachable from any root. */
  setLeaked(on: boolean, color: Color) {
    this.leaked = on;
    this.label.toggle('leaked', on);
    if (on) this.tint(color);
    else this.coreMaterial.emissiveIntensity = 0.6;
  }

  /** Keep only the outline: where an object used to live. */
  setGhost(on: boolean, color: Color) {
    this.ghost = on;
    this.coreMaterial.opacity = on ? 0 : 0.94;
    this.halo.visible = !on;
    (this.shell.material as LineBasicMaterial).opacity = on ? 0.55 : 0.75;
    this.label.toggle('dead', on);
    if (on) this.tint(color);
  }

  get isGhost() {
    return this.ghost;
  }

  worldPosition(out = new Vector3()): Vector3 {
    return this.body.getWorldPosition(out);
  }

  dispose() {
    this.parent.remove(this.anchor);
    this.scenery.removeLabel(this.label);
    this.geometry.dispose();
    this.shell.geometry.dispose();
    this.coreMaterial.dispose();
    (this.shell.material as LineBasicMaterial).dispose();
    this.halo.material.dispose();
  }
}

export interface LinkOptions {
  from: Object3D;
  to: Object3D;
  color: Color;
  /** Offset of the curve's midpoint from the straight line (stage-local units). */
  bend: Vector3;
  fromRadius?: number;
  toRadius?: number;
  dashed?: boolean;
  width?: number;
  /** A packet drifting from `from` to `to`, so ownership direction reads at a glance. */
  flow?: boolean;
}

/** A curved, thick line between two anchors, with an arrowhead and an optional flowing packet. */
export class LinkVisual {
  /** The visible curve in stage-local coordinates; hand it to Effects.pulse. */
  path = new QuadraticBezierCurve3(new Vector3(), new Vector3(), new Vector3());
  gone = false;

  private line!: Line2;
  private material: LineMaterial;
  private arrow: Mesh;
  private flowSprite?: Sprite;
  private opacity = 1;
  private goal = 1;
  private dim = 1;
  private phase = Math.random();
  private dashed: boolean;

  constructor(
    private scenery: Scenery,
    private parent: Object3D,
    private opts: LinkOptions,
  ) {
    this.dashed = Boolean(opts.dashed);
    this.material = new LineMaterial({
      color: opts.color,
      linewidth: opts.width ?? 2.6,
      worldUnits: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      dashed: this.dashed,
      dashSize: 0.75,
      gapSize: 0.5,
    });
    this.material.resolution.copy(scenery.resolution);
    scenery.lineMaterials.add(this.material);

    this.arrow = new Mesh(new ConeGeometry(0.3, 0.85, 14), new MeshBasicMaterial({ color: opts.color, transparent: true, opacity: 0 }));
    if (opts.flow) {
      this.flowSprite = makeGlow(opts.color, 0.95, 0);
      parent.add(this.flowSprite);
    }
    parent.add(this.arrow);
    this.rebuild();
  }

  /** Recompute the curve from the current anchor positions. */
  rebuild() {
    const { from, to, bend, fromRadius = 0, toRadius = 0 } = this.opts;
    const p0 = from.position.clone();
    const p2 = to.position.clone();
    const p1 = p0.clone().lerp(p2, 0.5).add(bend);
    const full = new QuadraticBezierCurve3(p0, p1, p2);

    // trim the ends so the line starts and stops at the node surfaces (exact sub-curve of a quadratic Bézier)
    const length = full.getLength();
    const a = Math.min(0.4, fromRadius / length);
    const b = 1 - Math.min(0.4, (toRadius + 0.35) / length);
    const q0 = full.getPoint(a);
    const q2 = full.getPoint(b);
    const q1 = p0
      .clone()
      .multiplyScalar((1 - a) * (1 - b))
      .add(p1.clone().multiplyScalar((1 - a) * b + a * (1 - b)))
      .add(p2.clone().multiplyScalar(a * b));
    this.path = new QuadraticBezierCurve3(q0, q1, q2);

    const points = this.path.getPoints(36);
    const geometry = new LineGeometry();
    geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
    if (this.line) {
      this.parent.remove(this.line);
      this.line.geometry.dispose();
    }
    this.line = new Line2(geometry, this.material);
    if (this.dashed) this.line.computeLineDistances();
    this.parent.add(this.line);

    const tangent = this.path.getTangent(1).normalize();
    this.arrow.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tangent);
    this.arrow.position.copy(q2).addScaledVector(tangent, -0.3);
  }

  update(dt: number, time: number) {
    this.opacity += (this.goal - this.opacity) * (1 - Math.exp(-dt * 9));
    const o = this.opacity * this.dim;
    this.material.opacity = o * 0.95;
    (this.arrow.material as MeshBasicMaterial).opacity = o;
    if (this.dashed) this.material.dashOffset -= dt * 1.6;

    if (this.flowSprite) {
      const u = (time * 0.32 + this.phase) % 1;
      this.flowSprite.position.copy(this.path.getPoint(u));
      this.flowSprite.material.opacity = Math.sin(u * Math.PI) * 0.9 * o * (this.scenery.reducedMotion ? 0 : 1);
    }
    if (this.goal === 0 && this.opacity < 0.02) this.gone = true;
  }

  appear() {
    this.goal = 1;
  }

  fadeOut() {
    this.goal = 0;
  }

  /** Dim without removing, e.g. weak links to an object that is gone. */
  setDim(amount: number) {
    this.dim = amount;
  }

  setColor(color: Color) {
    this.material.color.copy(color);
    (this.arrow.material as MeshBasicMaterial).color.copy(color);
    this.flowSprite?.material.color.copy(color);
  }

  setFlow(on: boolean) {
    if (this.flowSprite) this.flowSprite.visible = on;
  }

  dispose() {
    this.scenery.lineMaterials.delete(this.material);
    this.parent.remove(this.line, this.arrow);
    if (this.flowSprite) {
      this.parent.remove(this.flowSprite);
      this.flowSprite.material.dispose();
    }
    this.line.geometry.dispose();
    this.material.dispose();
    this.arrow.geometry.dispose();
    (this.arrow.material as MeshBasicMaterial).dispose();
  }
}
