import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  FogExp2,
  MathUtils,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Group, Object3D } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Label3D } from './labels';
import type { Scenery } from './visuals';

/**
 * Where the camera should look from. `halfW` / `halfH` are the half-extents (world units, as seen on
 * screen) that must fit inside the clear area of the HUD; the World solves the distance from them.
 */
export interface Pose {
  target: Vector3;
  /** Radians around Y, 0 = looking down -Z. */
  azimuth: number;
  /** Radians above the horizon. */
  elevation: number;
  halfW: number;
  halfH: number;
}

/** One self-contained 3D diorama (e.g. the RAM board, or the MVVM graph). */
export interface Stage {
  readonly group: Group;
  update(dt: number, time: number): void;
  pose(portrait: boolean): Pose;
  /** Viewport switched between landscape and portrait. */
  layout?(portrait: boolean): void;
}

export interface WorldOptions {
  /** Element the canvas is mounted in (fills the stage). */
  host: HTMLElement;
  /** Element HTML labels are mounted in. */
  labelHost: HTMLElement;
  /** The empty HUD area the subject should be centred in. */
  clearArea: HTMLElement;
  background: Color;
  accent: Color;
}

const PORTRAIT_BELOW = 0.9;

/**
 * Renderer, orbit camera and frame loop shared by every scene.
 *
 * The camera is framed against the HUD's clear area rather than the whole viewport: the projection is
 * shifted (setViewOffset) so the subject is centred in the free space, and the distance is solved so
 * its `Pose` extents fit there. Animations therefore never hide under floating cards, on any screen.
 */
export class World implements Scenery {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 0.1, 500);
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;
  readonly resolution = new Vector2();
  readonly lineMaterials = new Set<LineMaterial>();
  readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  portrait = false;

  private timer = new Timer();
  private time = 0;
  private width = 1;
  private height = 1;
  private stages = new Set<Stage>();
  private active?: Stage;
  private leaving?: Stage;
  private override: Pose | null = null;
  private labels = new Set<Label3D>();

  private goalPosition = new Vector3();
  private goalTarget = new Vector3();
  private goalOffset = new Vector2();
  private offset = new Vector2();
  private flying = false;
  private userMoved = false;
  private shakeLeft = 0;
  private shakeAmp = 0;

  constructor(private opts: WorldOptions) {
    // throws when WebGL is unavailable; the caller shows the written fallback
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    opts.host.appendChild(this.renderer.domElement);

    this.scene.background = opts.background;
    this.scene.fog = new FogExp2(opts.background, 0.006);

    // soft reflections for the metal parts, then a warm key and a cool rim
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new AmbientLight(0xffffff, 0.3));
    const key = new DirectionalLight(opts.accent, 2.2);
    key.position.set(-14, 28, 20);
    const rim = new DirectionalLight(0x9db4ff, 0.9);
    rim.position.set(20, 14, -18);
    this.scene.add(key, rim);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.8;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = 1.45;
    this.controls.autoRotateSpeed = 0.7;
    this.controls.addEventListener('start', () => {
      this.userMoved = true;
      this.flying = false;
    });
    // double-click / double-tap re-centres the camera
    opts.host.addEventListener('dblclick', () => {
      this.userMoved = false;
      this.refit();
    });

    this.timer.connect(document);
    new ResizeObserver(() => this.resize()).observe(opts.host);
    new ResizeObserver(() => this.refit()).observe(opts.clearArea);
    document.addEventListener('visibilitychange', () => this.setRunning(!document.hidden));
    this.resize();
  }

  // --- stages -----------------------------------------------------------------------------

  addStage(stage: Stage) {
    stage.group.visible = false;
    this.scene.add(stage.group);
    this.stages.add(stage);
    stage.layout?.(this.portrait);
  }

  /** Bring a stage into view; the camera flies there from wherever it is. */
  show(stage: Stage) {
    if (this.active === stage) return;
    const first = !this.active;
    this.leaving = this.active;
    this.active = stage;
    stage.group.visible = true;
    this.override = null;
    this.userMoved = false;
    this.refit({ intro: first });
  }

  /** Aim at an arbitrary pose inside the active stage (e.g. dive into one tile of a grid). `null` returns home. */
  setPose(pose: Pose | null) {
    this.override = pose;
    this.userMoved = false;
    this.refit();
  }

  // --- labels / effects hooks ---------------------------------------------------------------

  addLabel(anchor: Object3D, title: string, sub = '', className = '', lift = 0, liftPx = 0): Label3D {
    const label = new Label3D(this.opts.labelHost, anchor, title, sub, className, lift, liftPx);
    this.labels.add(label);
    return label;
  }

  removeLabel(label: Label3D) {
    this.labels.delete(label);
    label.dispose();
  }

  shake(amplitude = 0.35, seconds = 0.5) {
    if (this.reducedMotion) return;
    this.shakeAmp = amplitude;
    this.shakeLeft = seconds;
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on && !this.reducedMotion;
  }

  start() {
    this.setRunning(true);
  }

  private setRunning(on: boolean) {
    this.renderer.setAnimationLoop(on ? this.frame : null);
    if (on) this.timer.reset();
  }

  // --- framing ----------------------------------------------------------------------------

  private resize() {
    const { host } = this.opts;
    this.width = Math.max(1, host.clientWidth);
    this.height = Math.max(1, host.clientHeight);
    this.renderer.setSize(this.width, this.height, false);
    this.resolution.set(this.width, this.height);
    this.lineMaterials.forEach((m) => m.resolution.copy(this.resolution));
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    const portrait = this.width / this.height < PORTRAIT_BELOW;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.stages.forEach((s) => s.layout?.(portrait));
    }
    this.refit();
  }

  /** Solve camera distance + projection shift so the active pose fits the HUD's clear area. */
  refit({ intro = false } = {}) {
    const stage = this.active;
    if (!stage) return;
    const pose = this.override ?? stage.pose(this.portrait);

    const host = this.opts.host.getBoundingClientRect();
    const rect = this.opts.clearArea.getBoundingClientRect();
    const fw = MathUtils.clamp(rect.width / this.width, 0.25, 1);
    const fh = MathUtils.clamp(rect.height / this.height, 0.25, 1);
    const tan = Math.tan(MathUtils.degToRad(this.camera.fov / 2));
    const margin = 1.08;
    const distance = Math.max((pose.halfH * margin) / (fh * tan), (pose.halfW * margin) / (fw * tan * this.camera.aspect));

    const cosEl = Math.cos(pose.elevation);
    const direction = new Vector3(Math.sin(pose.azimuth) * cosEl, Math.sin(pose.elevation), Math.cos(pose.azimuth) * cosEl);
    this.goalTarget.copy(pose.target);
    this.goalPosition.copy(pose.target).addScaledVector(direction, distance);
    this.goalOffset.set(this.width / 2 - (rect.left - host.left + rect.width / 2), this.height / 2 - (rect.top - host.top + rect.height / 2));

    this.controls.minDistance = distance * 0.4;
    this.controls.maxDistance = distance * 1.9;

    if (intro) {
      // glide in from higher and further out
      this.camera.position.copy(this.goalPosition).addScaledVector(direction, distance * 0.7).add(new Vector3(0, distance * 0.35, 0));
      this.controls.target.copy(this.goalTarget);
      this.offset.copy(this.goalOffset);
      this.applyOffset();
    }
    if (!this.userMoved) this.flying = true;
  }

  private applyOffset() {
    if (Math.abs(this.offset.x) + Math.abs(this.offset.y) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(this.width, this.height, this.offset.x, this.offset.y, this.width, this.height);
  }

  private updateCamera(dt: number) {
    if (this.flying) {
      const k = 1 - Math.exp(-dt * 3.2);
      this.camera.position.lerp(this.goalPosition, k);
      this.controls.target.lerp(this.goalTarget, k);
      if (this.camera.position.distanceTo(this.goalPosition) < 0.05 && this.controls.target.distanceTo(this.goalTarget) < 0.05) {
        this.flying = false;
        if (this.leaving) {
          this.leaving.group.visible = false;
          this.leaving = undefined;
        }
      }
    }
    const ko = 1 - Math.exp(-dt * 5);
    this.offset.lerp(this.goalOffset, ko);
    this.applyOffset();
    this.controls.update();
  }

  // --- frame ------------------------------------------------------------------------------

  private frame = (timestamp: number) => {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.time += dt;
    this.updateCamera(dt);
    this.stages.forEach((s) => s.group.visible && s.update(dt, this.time));
    this.labels.forEach((l) => l.update(this.camera, this.width, this.height));

    let jitter: Vector3 | undefined;
    if (this.shakeLeft > 0) {
      this.shakeLeft -= dt;
      const amp = this.shakeAmp * Math.max(0, this.shakeLeft) * 2;
      jitter = new Vector3((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
      this.camera.position.add(jitter);
    }
    this.renderer.render(this.scene, this.camera);
    if (jitter) this.camera.position.sub(jitter);
  };
}
