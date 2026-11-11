/**
 * One illustration in the world. It has two bodies:
 *
 *  far   two triangles showing its thumbnail from the shared atlas. Always there, costs nothing.
 *  near  the adaptive relief mesh with the full-resolution drawing and its relief texture.
 *        Streamed in as the camera approaches and thrown away once it is well behind.
 *
 * So GPU memory is bounded by how many plates are near the camera, not by the size of the catalog.
 */
import * as THREE from 'three/webgpu';
import type { PlateData } from '../plates';
import { reliefMaterial, wireMaterial, type ReliefHandles } from './materials';
import { extrusion, type Slot } from './rail';
import { GRID, type Prepared } from './stream';

/** How squarely a sheet faces its hero camera: 1 = dead on, 0 = square to the rail. A little
 *  obliqueness reads better, because relief only shows when you are not looking straight at it. */
const FACING = 0.72;

const _target = new THREE.Vector3();
const _full = new THREE.Quaternion();
const _still = new THREE.Quaternion();

export class Plate {
  readonly group = new THREE.Group();
  readonly far: THREE.Mesh;
  near: THREE.Mesh | null = null;
  state: 'far' | 'loading' | 'near' = 'far';
  /** Id of the streaming job in flight, so a stale reply can be recognised and dropped. */
  job = 0;
  triangles = 2;

  private handles: ReliefHandles | null = null;
  private wire: THREE.Mesh | null = null;
  private textures: THREE.Texture[] = [];
  private lift = 0;
  /** Plate units: the frame the relief was baked in. */
  private readonly width: number;
  private readonly height: number;

  constructor(
    readonly data: PlateData,
    plateHeight: number,
    farShared: THREE.Material,
  ) {
    this.height = plateHeight;
    this.width = (plateHeight * data.width) / data.height;
    const w = this.width / 2;
    const h = this.height / 2;
    const [u0, v0, u1, v1] = data.atlas;

    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-w, h, 0, -w, -h, 0, w, -h, 0, w, h, 0], 3));
    quad.setAttribute('atlasUv', new THREE.Float32BufferAttribute([u0, v0, u0, v1, u1, v1, u1, v0], 2));
    quad.setAttribute('plateSize', new THREE.Float32BufferAttribute(Array(4).fill([this.width, this.height]).flat(), 2));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.far = new THREE.Mesh(quad, farShared);
    this.group.add(this.far);
  }

  /** Hang the plate in its slot, turned most of the way towards where the camera will frame it. */
  place(slot: Slot): void {
    this.group.position.set(slot.x, slot.y, slot.z);
    this.group.scale.setScalar(slot.height / this.height);
    this.group.quaternion.identity();
    this.group.lookAt(_target.set(0, 0, slot.heroZ));
    _full.copy(this.group.quaternion);
    this.group.quaternion.copy(_still.identity()).slerp(_full, FACING);
    this.group.updateMatrixWorld(true);
  }

  /** Swap the thumbnail quad for the streamed relief. Returns the mesh so the caller can precompile it. */
  adopt(ready: Prepared, options: { anisotropy: number; steps: number }): THREE.Mesh {
    const colour = new THREE.Texture(ready.colour);
    colour.colorSpace = THREE.SRGBColorSpace;
    colour.anisotropy = options.anisotropy;
    const relief = new THREE.Texture(ready.relief);
    relief.colorSpace = THREE.NoColorSpace;
    for (const map of [colour, relief]) {
      map.flipY = false; // image rows are read top-down, in both backends
      map.generateMipmaps = true;
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.needsUpdate = true;
    }
    this.textures = [colour, relief];

    // Lattice coordinates -> plate units, in place. z keeps the raw height; the shader scales it.
    const positions = ready.positions;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (positions[i] / (GRID - 1) - 0.5) * this.width;
      positions[i + 1] = (0.5 - positions[i + 1] / (GRID - 1)) * this.height;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(ready.indices, 1));
    const depth = this.data.depth;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, depth / 2), Math.hypot(this.width, this.height, depth) / 2);

    this.handles = reliefMaterial({ colour, relief, width: this.width, height: this.height, depth, steps: options.steps });
    this.handles.extrude.value = this.lift;
    this.near = new THREE.Mesh(geometry, this.handles.material);
    this.near.visible = false;
    this.group.add(this.near);
    this.triangles = ready.triangles;
    return this.near;
  }

  /** The relief is uploaded and compiled: show it. */
  reveal(wireframe: boolean): void {
    if (!this.near) return;
    this.near.visible = true;
    this.far.visible = false;
    this.state = 'near';
    this.setWireframe(wireframe);
  }

  /** Back to the thumbnail; every GPU resource of the relief is freed. */
  release(): void {
    this.job = 0;
    this.state = 'far';
    this.far.visible = true;
    this.setWireframe(false);
    if (this.near) {
      this.group.remove(this.near);
      this.near.geometry.dispose();
      this.handles?.material.dispose();
      for (const map of this.textures) {
        map.dispose();
        (map.image as ImageBitmap | null)?.close?.();
      }
    }
    this.near = null;
    this.handles = null;
    this.textures = [];
    this.triangles = 2;
  }

  setWireframe(on: boolean): void {
    if (on && this.near && this.handles && !this.wire) {
      this.wire = new THREE.Mesh(this.near.geometry, wireMaterial(this.handles));
      this.group.add(this.wire);
    } else if (!on && this.wire) {
      this.group.remove(this.wire);
      (this.wire.material as THREE.Material).dispose();
      this.wire = null;
    }
  }

  /**
   * Per frame. `du` is this plate's position relative to the camera, in plates (negative: ahead).
   * The relief eases towards its scheduled height rather than snapping to it, so a plate that
   * finishes streaming late still rises instead of popping.
   */
  update(du: number, dt: number, lamp: THREE.Vector3, pass: number): void {
    this.group.visible = du > -4.6 && du < pass + 0.42;
    if (!this.group.visible) return;
    const wanted = this.state === 'near' ? extrusion(du) : 0;
    this.lift += (wanted - this.lift) * (1 - Math.exp(-dt * 7));
    if (this.handles) {
      this.handles.extrude.value = this.lift;
      this.group.worldToLocal(this.handles.light.value.copy(lamp));
    }
  }
}
