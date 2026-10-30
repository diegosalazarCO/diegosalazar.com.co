import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import type { Curve, Object3D } from 'three';

let glow: CanvasTexture | undefined;

/** Soft round blob, shared by every halo, packet and particle. */
export function glowTexture(): CanvasTexture {
  if (glow) return glow;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.22, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.14)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  glow = new CanvasTexture(canvas);
  glow.colorSpace = SRGBColorSpace;
  return glow;
}

export function makeGlow(color: Color, size: number, opacity = 1): Sprite {
  const sprite = new Sprite(
    new SpriteMaterial({ map: glowTexture(), color, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity }),
  );
  sprite.scale.setScalar(size);
  return sprite;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

interface Pulse {
  sprites: Sprite[];
  path: Curve<Vector3>;
  elapsed: number;
  duration: number;
  done: () => void;
}
interface Burst {
  points: Points;
  velocity: Float32Array;
  elapsed: number;
  life: number;
  gravity: number;
}
interface Timed {
  mesh: Object3D & { material: MeshBasicMaterial | SpriteMaterial };
  elapsed: number;
  duration: number;
  from: number;
  to: number;
  opacity: number;
}

/**
 * Transient visuals of one stage: data packets running along a path, particle bursts, ripples.
 * Everything is parented to the stage group, so it follows the stage if the group is moved or rotated.
 */
export class Effects {
  private pulses: Pulse[] = [];
  private bursts: Burst[] = [];
  private timed: Timed[] = [];

  constructor(private parent: Object3D) {}

  /** A bright packet with a short tail travelling along `path`. Resolves when it arrives. */
  pulse(path: Curve<Vector3>, color: Color, { duration = 1, size = 1.1 } = {}): Promise<void> {
    const trail = 6;
    const sprites: Sprite[] = [];
    for (let i = 0; i <= trail; i++) {
      const s = makeGlow(color, size * (1 - (i / (trail + 1)) * 0.75), 1 - (i / (trail + 1)) * 0.85);
      s.position.copy(path.getPointAt(0));
      this.parent.add(s);
      sprites.push(s);
    }
    return new Promise((resolve) => this.pulses.push({ sprites, path, elapsed: 0, duration, done: resolve }));
  }

  /** Expanding particle cloud. */
  burst(at: Vector3, color: Color, { count = 140, speed = 5, life = 1.3, size = 0.55, gravity = 1.2 } = {}) {
    const positions = new Float32Array(count * 3);
    const velocity = new Float32Array(count * 3);
    const dir = new Vector3();
    for (let i = 0; i < count; i++) {
      dir.set(Math.random() - 0.5, Math.random() - 0.35, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.35 + Math.random() * 0.65));
      positions.set([at.x, at.y, at.z], i * 3);
      velocity.set([dir.x, dir.y, dir.z], i * 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const points = new Points(
      geometry,
      new PointsMaterial({ map: glowTexture(), color, size, blending: AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: true }),
    );
    points.frustumCulled = false;
    this.parent.add(points);
    this.bursts.push({ points, velocity, elapsed: 0, life, gravity });
  }

  /** Flat ripple on the XZ plane, e.g. a shockwave on a chip or the board. */
  ring(at: Vector3, color: Color, { radius = 3.5, duration = 0.9, opacity = 0.9 } = {}) {
    const mesh = new Mesh(
      new RingGeometry(0.9, 1, 64),
      new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: 2 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at);
    mesh.scale.setScalar(0.01);
    this.parent.add(mesh);
    this.timed.push({ mesh, elapsed: 0, duration, from: 0.01, to: radius, opacity });
  }

  /** Quick halo that swells and fades. */
  flash(at: Vector3, color: Color, { size = 6, duration = 0.6 } = {}) {
    const sprite = makeGlow(color, 0.01, 1);
    sprite.position.copy(at);
    this.parent.add(sprite);
    this.timed.push({ mesh: sprite, elapsed: 0, duration, from: 0.01, to: size, opacity: 1 });
  }

  update(dt: number) {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.elapsed += dt;
      const u = Math.min(p.elapsed / p.duration, 1);
      p.sprites.forEach((s, k) => s.position.copy(p.path.getPointAt(easeInOut(Math.max(0, u - k * 0.022)))));
      if (u >= 1) {
        p.sprites.forEach((s) => {
          this.parent.remove(s);
          s.material.dispose();
        });
        this.pulses.splice(i, 1);
        p.done();
      }
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.elapsed += dt;
      const k = b.elapsed / b.life;
      if (k >= 1) {
        this.parent.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as PointsMaterial).dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const pos = b.points.geometry.getAttribute('position');
      const drag = Math.exp(-1.6 * dt);
      for (let j = 0; j < pos.count; j++) {
        b.velocity[j * 3] *= drag;
        b.velocity[j * 3 + 1] = b.velocity[j * 3 + 1] * drag - b.gravity * dt;
        b.velocity[j * 3 + 2] *= drag;
        pos.setXYZ(j, pos.getX(j) + b.velocity[j * 3] * dt, pos.getY(j) + b.velocity[j * 3 + 1] * dt, pos.getZ(j) + b.velocity[j * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      (b.points.material as PointsMaterial).opacity = 1 - k * k;
    }

    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      t.elapsed += dt;
      const k = Math.min(t.elapsed / t.duration, 1);
      t.mesh.scale.setScalar(t.from + (t.to - t.from) * easeOut(k));
      t.mesh.material.opacity = t.opacity * (1 - k);
      if (k >= 1) {
        this.parent.remove(t.mesh);
        t.mesh.material.dispose();
        if (t.mesh instanceof Mesh) t.mesh.geometry.dispose();
        this.timed.splice(i, 1);
      }
    }
  }
}
