import {
  AdditiveBlending,
  CanvasTexture,
  CurvePath,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  QuadraticBezierCurve3,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Color, Curve } from 'three';
import type { Hud } from '../engine/hud';
import { makeGlow } from '../engine/effects';
import type { Effects } from '../engine/effects';
import { LinkVisual, NodeVisual } from '../engine/visuals';
import type { World } from '../engine/world';
import { ArcGraph } from './arc-graph';
import type { GraphEdge, GraphNode } from './arc-graph';
import * as copy from './copy';
import type { Cell, HardwareStage } from './hardware-stage';
import type { ArcPalette } from './theme';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const reversed = (c: QuadraticBezierCurve3) => new QuadraticBezierCurve3(c.v2, c.v1, c.v0);

/** Holographic column from a DRAM cell up to the object it holds: the memory made visible. */
class Beam {
  readonly group = new Group();
  private core: Mesh;
  private haze: Mesh;
  private texture: CanvasTexture;
  private height = 1;
  private grow = 0;
  private goal = 0;

  constructor(color: Color) {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 128;
    const g = canvas.getContext('2d')!;
    const fade = g.createLinearGradient(0, 128, 0, 0);
    fade.addColorStop(0, 'rgba(255,255,255,0.95)');
    fade.addColorStop(1, 'rgba(255,255,255,0.12)');
    g.fillStyle = fade;
    g.fillRect(0, 0, 8, 128);
    g.globalCompositeOperation = 'destination-out'; // scanlines
    for (let y = 0; y < 128; y += 8) g.fillRect(0, y, 8, 3);
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.wrapT = RepeatWrapping;

    const material = (map: CanvasTexture | null, opacity: number) =>
      new MeshBasicMaterial({ map, color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    this.core = new Mesh(new CylinderGeometry(0.16, 0.38, 1, 20, 1, true).translate(0, 0.5, 0), material(this.texture, 0.85));
    this.haze = new Mesh(new CylinderGeometry(0.5, 0.95, 1, 20, 1, true).translate(0, 0.5, 0), material(null, 0.1));
    this.group.add(this.core, this.haze);
    this.group.visible = false;
  }

  show(base: Vector3, height: number) {
    this.group.position.copy(base);
    this.height = height;
    this.texture.repeat.set(1, height / 1.6);
    this.goal = 1;
    this.group.visible = true;
  }

  hide() {
    this.goal = 0;
  }

  update(dt: number) {
    this.grow += (this.goal - this.grow) * (1 - Math.exp(-dt * (this.goal ? 11 : 16)));
    this.group.scale.set(1, Math.max(0.0001, this.grow * this.height), 1);
    this.texture.offset.y -= dt * 0.7;
    if (!this.goal && this.grow < 0.01) this.group.visible = false;
  }
}

/** Little spheres orbiting an object, one per strong reference: retain count you can count. */
class PipRing {
  readonly group = new Group();
  private pips: { mesh: Mesh; angle: number; size: number; goal: number }[] = [];

  constructor(
    private color: Color,
    private radius: number,
  ) {
    this.group.rotation.x = 0.4;
  }

  setCount(n: number) {
    const live = this.pips.filter((p) => p.goal > 0);
    while (live.length < n) {
      const mesh = new Mesh(new SphereGeometry(0.17, 14, 14), new MeshBasicMaterial({ color: this.color }));
      mesh.add(makeGlow(this.color, 1.1, 0.8));
      const pip = { mesh, angle: live.length ? live[live.length - 1].angle + 1 : 0, size: 0.01, goal: 1 };
      mesh.scale.setScalar(0.01);
      this.group.add(mesh);
      this.pips.push(pip);
      live.push(pip);
    }
    while (live.length > n) live.pop()!.goal = 0;
  }

  update(dt: number) {
    this.group.rotation.y += dt * 0.9;
    const live = this.pips.filter((p) => p.goal > 0);
    for (let i = this.pips.length - 1; i >= 0; i--) {
      const pip = this.pips[i];
      const index = live.indexOf(pip);
      if (index >= 0) {
        const target = (index / live.length) * Math.PI * 2;
        const diff = Math.atan2(Math.sin(target - pip.angle), Math.cos(target - pip.angle));
        pip.angle += diff * (1 - Math.exp(-dt * 6));
      }
      pip.size += (pip.goal - pip.size) * (1 - Math.exp(-dt * 12));
      pip.mesh.scale.setScalar(Math.max(0.001, pip.size));
      pip.mesh.position.set(Math.cos(pip.angle) * this.radius, 0, Math.sin(pip.angle) * this.radius);
      if (pip.goal === 0 && pip.size < 0.03) {
        this.group.remove(pip.mesh);
        pip.mesh.geometry.dispose();
        this.pips.splice(i, 1);
      }
    }
  }
}

/**
 * Tab 1: one Swift object living in a DRAM cell. Every public action is queued, so mashing buttons (or
 * a scripted tour) plays out as an ordered sequence of animations, while the ARC model decides
 * what actually happens to the object.
 */
export class HardwareDemo {
  private graph: ArcGraph;
  private stack: NodeVisual;
  private heap?: NodeVisual;
  private side?: NodeVisual;
  private cell?: Cell;
  private lastCell = -1;
  private heapPos = new Vector3();
  private links = new Map<string, LinkVisual>();
  private sideLink?: LinkVisual;
  private beam: Beam;
  private pips: PipRing;
  private ids = { s: 0, w: 0, u: 0 };
  private queue: Promise<void> = Promise.resolve();
  private fx: Effects;
  private c: ArcPalette['color'];

  constructor(
    private world: World,
    private stage: HardwareStage,
    private hud: Hud,
    private palette: ArcPalette,
  ) {
    this.fx = stage.effects;
    this.c = palette.color;
    this.graph = new ArcGraph({
      onCount: (node) => this.onCount(node),
      onEdgeRemoved: (edge) => this.onEdgeRemoved(edge),
    });
    this.graph.addNode('stack', true);

    this.stack = new NodeVisual(world, stage.group, {
      shape: 'disc',
      layers: 3,
      color: palette.ink.clone().multiplyScalar(0.78),
      position: stage.stackAnchor,
      scale: 0.8,
      title: 'Stack frame',
      sub: 'x0 → pointer',
    });

    this.beam = new Beam(this.c.strong);
    this.pips = new PipRing(this.c.strong, 2.0);
    stage.group.add(this.beam.group);
    stage.tickers.add((dt, t) => this.tick(dt, t));
    this.publish();
  }

  /** Called whenever the tab becomes visible. */
  enter() {
    if (!this.cell) this.hud.say(copy.hardware.idle());
  }

  private tick(dt: number, time: number) {
    this.stack.update(dt, time);
    this.beam.update(dt);
    this.pips.update(dt);
    for (const node of [this.heap, this.side]) node?.update(dt, time);
    if (this.heap?.gone) this.heap = this.dispose(this.heap);
    if (this.side?.gone) this.side = this.dispose(this.side);
    this.sideLink?.update(dt, time);
    this.links.forEach((link, id) => {
      link.update(dt, time);
      if (link.gone) {
        link.dispose();
        this.links.delete(id);
      }
    });
    if (this.sideLink?.gone) {
      this.sideLink.dispose();
      this.sideLink = undefined;
    }
  }

  private dispose(node: NodeVisual): undefined {
    node.dispose();
    return undefined;
  }

  // --- model callbacks --------------------------------------------------------------------

  private onCount(node: GraphNode) {
    if (node.id !== 'heap') return;
    this.pips.setCount(node.strong);
    this.heap?.label.set('HeapObject', `${this.cell?.hex ?? ''} · RC ${node.strong}`);
    this.side?.label.set('Side table', node.alive ? `weak refs · ${node.weak}` : 'weak refs → nil');
    this.publish();
  }

  private onEdgeRemoved(edge: GraphEdge) {
    this.links.get(edge.id)?.fadeOut();
    this.publish();
  }

  private publish() {
    const node = this.graph.node('heap');
    this.hud.readout('x0', this.cell?.hex ?? '—');
    this.hud.readout('strong', node?.strong ?? 0);
    this.hud.readout('weak', node?.weak ?? 0);
    this.hud.readout('unowned', node?.unowned ?? 0);
  }

  // --- actions ----------------------------------------------------------------------------

  private enqueue(job: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(job).catch((e) => console.error(e));
    return this.queue;
  }

  private get alive() {
    return Boolean(this.graph.node('heap')?.alive);
  }

  allocate() {
    return this.enqueue(async () => {
      if (this.alive) return this.hud.say(copy.hardware.alreadyAllocated(this.cell!.hex));
      this.clearObject();

      // the allocator picks a free block somewhere in the middle of the module
      let index = this.lastCell;
      while (index === this.lastCell) index = 6 + Math.floor(Math.random() * (this.stage.cells.length - 12));
      this.lastCell = index;
      const cell = (this.cell = this.stage.cells[index]);
      this.heapPos.copy(this.stage.heapAnchor(cell));
      this.graph.addNode('heap');
      this.publish();
      this.hud.say(copy.hardware.allocate(cell.hex));

      await this.fx.pulse(this.stage.busPath(cell), this.c.strong, { duration: 1.25, size: 1.4 });
      this.stage.setCell(cell, 'live');
      this.fx.ring(cell.position, this.c.strong, { radius: 3.4 });
      this.fx.flash(cell.position, this.c.strong, { size: 5 });
      this.beam.show(cell.position, this.heapPos.y - cell.position.y - 0.4);
      await wait(280);

      this.heap = new NodeVisual(this.world, this.stage.group, {
        shape: 'icosahedron',
        color: this.c.strong,
        position: this.heapPos,
        scale: 1.2,
        title: 'HeapObject',
        sub: `${cell.hex} · RC 0`,
      });
      this.heap.body.add(this.pips.group);
      this.fx.flash(this.heapPos, this.c.strong, { size: 7, duration: 0.7 });
      this.addStrongLink(1, true);
      await wait(520);
    });
  }

  private addStrongLink(n: number, instant = false) {
    const id = `s${++this.ids.s}`;
    const link = this.makeLink(this.stack, this.heap!, this.c.strong, new Vector3(0, 3.4 + 0.9 * (n - 1), 0), { flow: true });
    this.links.set(id, link);
    if (instant) this.graph.link(id, 'stack', 'heap', 'strong');
    return { id, link };
  }

  private makeLink(from: NodeVisual, to: NodeVisual, color: Color, bend: Vector3, opts: { dashed?: boolean; flow?: boolean } = {}) {
    return new LinkVisual(this.world, this.stage.group, {
      from: from.anchor,
      to: to.anchor,
      fromRadius: from.radius,
      toRadius: to.radius,
      color,
      bend,
      dashed: opts.dashed,
      flow: opts.flow,
    });
  }

  addStrong() {
    return this.enqueue(async () => {
      if (!this.alive) return this.hud.say(copy.hardware.needObject());
      const n = this.graph.node('heap')!.strong + 1;
      this.hud.say(copy.hardware.strong(n));
      const { id, link } = this.addStrongLink(n);
      await this.fx.pulse(link.path, this.c.strong, { duration: 0.95 });
      this.graph.link(id, 'stack', 'heap', 'strong');
      this.fx.flash(this.heapPos, this.c.strong, { size: 6, duration: 0.5 });
      await wait(250);
    });
  }

  addWeak() {
    return this.enqueue(async () => {
      if (!this.alive) return this.hud.say(copy.hardware.needObject());
      const first = !this.side;
      if (first) {
        this.side = new NodeVisual(this.world, this.stage.group, {
          shape: 'octahedron',
          color: this.c.weak,
          position: this.heapPos.clone().add(new Vector3(5.6, -4.8, 2.2)),
          scale: 0.8,
          title: 'Side table',
          sub: 'weak refs · 0',
        });
        this.sideLink = this.makeLink(this.heap!, this.side, this.c.weak, new Vector3(0, 1.2, 0.8), { dashed: true });
      }
      this.hud.say(copy.hardware.weak(this.graph.node('heap')!.strong, first));
      const id = `w${++this.ids.w}`;
      const link = this.makeLink(this.stack, this.side!, this.c.weak, new Vector3(0, 2.6 + 0.5 * (this.ids.w - 1), -1.2), { dashed: true });
      this.links.set(id, link);
      await this.fx.pulse(link.path, this.c.weak, { duration: 1.1 });
      this.graph.link(id, 'stack', 'heap', 'weak');
      this.fx.flash(this.side!.anchor.position, this.c.weak, { size: 5, duration: 0.5 });
      await wait(300);
    });
  }

  addUnowned() {
    return this.enqueue(async () => {
      if (!this.alive) return this.hud.say(copy.hardware.needObject());
      this.hud.say(copy.hardware.unowned(this.cell!.hex));
      const id = `u${++this.ids.u}`;
      const link = this.makeLink(this.stack, this.heap!, this.c.unowned, new Vector3(0, 1.8, 4.2 + 0.6 * (this.ids.u - 1)), { flow: true });
      this.links.set(id, link);
      await this.fx.pulse(link.path, this.c.unowned, { duration: 1 });
      this.graph.link(id, 'stack', 'heap', 'unowned');
      this.fx.flash(this.heapPos, this.c.unowned, { size: 6, duration: 0.5 });
      await wait(300);
    });
  }

  release() {
    return this.enqueue(async () => {
      const owners = this.graph.edgesTo('heap', 'strong');
      if (!this.alive || owners.length === 0) return this.hud.say(copy.hardware.nothingToRelease());
      const edge = owners[owners.length - 1];
      const link = this.links.get(edge.id)!;
      if (owners.length > 1) this.hud.say(copy.hardware.release(owners.length - 1));

      await this.fx.pulse(reversed(link.path), this.c.strong, { duration: 0.75 });
      this.graph.unlink(edge.id);
      if (this.graph.node('heap')!.alive) return wait(300);
      await this.dissolve();
    });
  }

  /** Retain count hit zero: deinit, free, and what that does to the references that remain. */
  private async dissolve() {
    const node = this.graph.node('heap')!;
    const cell = this.cell!;
    this.hud.say(copy.hardware.freed(cell.hex, node.weak, node.unowned));

    this.beam.hide();
    this.stage.setCell(cell, 'dead');
    this.fx.burst(this.heapPos, this.c.strong, { count: 160, speed: 6.5 });
    this.fx.ring(cell.position, this.c.strong, { radius: 4.2, opacity: 0.6 });
    this.world.shake(0.12, 0.3);

    if (node.unowned > 0 || node.weak > 0) {
      // keep the outline: weak refs read nil, unowned ones now point at nothing
      this.heap!.setGhost(true, node.unowned ? this.c.unowned : this.c.weak);
      this.heap!.label.set('HeapObject', `${cell.hex} · freed`);
      this.links.forEach((link, id) => {
        if (id.startsWith('u')) link.setFlow(false);
        if (id.startsWith('w')) link.setDim(0.55);
      });
      this.sideLink?.setDim(0.4);
    } else {
      this.heap!.despawn();
      this.sideLink?.fadeOut();
    }
    await wait(900);
  }

  /** The CPU follows every pointer it holds. */
  read() {
    return this.enqueue(async () => {
      const node = this.graph.node('heap');
      if (!node || node.strong + node.weak + node.unowned === 0) return this.hud.say(copy.hardware.noRefs());

      const alive = node.alive;
      const outcome = {
        strong: alive && node.strong > 0,
        weak: node.weak > 0 ? (alive ? ('ok' as const) : ('nil' as const)) : null,
        unowned: node.unowned > 0 ? (alive ? ('ok' as const) : ('trap' as const)) : null,
      };
      const first = (prefix: string) => [...this.links].find(([id]) => id.startsWith(prefix) && this.graph.edge(id))?.[1];
      const cell = this.cell!;
      const jobs: Promise<void>[] = [];

      if (outcome.strong) {
        jobs.push(
          this.fx.pulse(first('s')!.path, this.c.ok, { duration: 0.9 }).then(() => {
            this.stage.setCell(cell, 'probe', 0.6);
            this.fx.ring(cell.position, this.c.ok, { radius: 2.6, duration: 0.6 });
          }),
        );
      }
      if (outcome.weak) {
        const path = new CurvePath<Vector3>();
        path.add(first('w')!.path as Curve<Vector3>);
        if (alive && this.sideLink) path.add(this.sideLink.path as Curve<Vector3>);
        jobs.push(
          wait(550)
            .then(() => this.fx.pulse(path, this.c.weak, { duration: alive ? 1.5 : 1 }))
            .then(() => {
              if (alive) this.stage.setCell(cell, 'probe', 0.6);
              else this.tag(this.side!, 'nil', this.palette.css.weak);
            }),
        );
      }
      if (outcome.unowned) {
        jobs.push(
          wait(1100)
            .then(() => this.fx.pulse(first('u')!.path, outcome.unowned === 'trap' ? this.c.fault : this.c.ok, { duration: 0.9 }))
            .then(() => {
              if (outcome.unowned === 'ok') return this.stage.setCell(cell, 'probe', 0.6);
              this.stage.setCell(cell, 'fault', 1.8);
              this.fx.burst(this.heapPos, this.c.fault, { count: 120, speed: 7, gravity: 0 });
              this.fx.ring(cell.position, this.c.fault, { radius: 5.2 });
              this.fx.flash(this.heapPos, this.c.fault, { size: 9, duration: 0.8 });
              this.tag(this.heap!, 'trap', this.palette.css.fault);
              this.world.shake(0.55, 0.6);
              this.hud.flash('fault');
              this.hud.say(copy.hardware.trap(cell.hex));
            }),
        );
      }

      if (outcome.unowned !== 'trap') this.hud.say(copy.hardware.read(outcome));
      await Promise.all(jobs);
      await wait(400);
    });
  }

  /** A short-lived coloured tag floating above a node (e.g. "nil", "trap"). */
  private tag(node: NodeVisual, text: string, color: string) {
    const label = this.world.addLabel(node.body, text, '', 'tag', node.radius + 0.9, 46);
    label.el.style.setProperty('--tint', color);
    setTimeout(() => this.world.removeLabel(label), 2400);
  }

  reset() {
    return this.enqueue(async () => {
      this.clearObject();
      this.cell = undefined;
      this.ids = { s: 0, w: 0, u: 0 };
      this.publish();
      this.hud.say(copy.hardware.reset());
      await wait(200);
    });
  }

  /** Remove the object, its side table, links and the model state that belonged to them. */
  private clearObject() {
    if (this.cell) this.stage.setCell(this.cell, 'free');
    this.beam.hide();
    this.pips.setCount(0);
    this.heap?.despawn();
    this.side?.despawn();
    this.sideLink?.fadeOut();
    this.links.forEach((link) => link.fadeOut());
    this.graph.clear();
    this.graph.addNode('stack', true);
  }
}
