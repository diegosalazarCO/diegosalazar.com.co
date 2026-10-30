import { Box3, Color, GridHelper, Group, LineBasicMaterial, Vector3 } from 'three';
import type { Hud } from '../engine/hud';
import { Effects, makeGlow } from '../engine/effects';
import { LinkVisual, NodeVisual } from '../engine/visuals';
import type { Shape } from '../engine/visuals';
import type { Pose, Stage, World } from '../engine/world';
import { ArcGraph } from './arc-graph';
import type { GraphNode } from './arc-graph';
import * as copy from './copy';
import type { ArcPalette } from './theme';

type Screen = 'login' | 'dash' | 'feat';
type Role = 'vc' | 'vm' | 'int' | 'feat';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const SPEC: Record<Role, { title: string; shape: Shape; scale: number }> = {
  vc: { title: 'DashboardVC', shape: 'box', scale: 1.35 },
  vm: { title: 'DashboardVM', shape: 'sphere', scale: 1.35 },
  int: { title: 'Interactor', shape: 'icosahedron', scale: 1.25 },
  feat: { title: 'FeatureVC', shape: 'box', scale: 1.15 },
};

/** Where each role sits for session k; later sessions stack back and to the right. */
function place(role: Role, k: number): Vector3 {
  const base = { vc: [-6.5, 4.2, 0], vm: [0, 1.5, 3.4], int: [6.5, 4.2, 0], feat: [-11.5, 1.3, 4] }[role];
  return new Vector3(base[0] + 4 * k, base[1], base[2] - 9 * k);
}

/**
 * Tab 2: a Clean-Architecture screen stack on the heap. Login builds ViewController → ViewModel →
 * Interactor; logout releases AppRoot's reference and ARC's cascade decides what survives.
 * Anything alive but unreachable from AppRoot is a leak, detected rather than scripted.
 */
export class ArchitectureDemo implements Stage {
  readonly group = new Group();
  private fx = new Effects(this.group);
  private graph: ArcGraph;
  private nodes = new Map<string, NodeVisual>();
  private links = new Map<string, LinkVisual>();
  private roles = new Map<string, Role>();
  private sessions = 0;
  private screen: Screen = 'login';
  fixed = false;
  private queue: Promise<void> = Promise.resolve();
  private fault: Color;

  constructor(
    private world: World,
    private hud: Hud,
    private palette: ArcPalette,
  ) {
    this.fault = palette.color.fault;
    const grid = new GridHelper(90, 45, 0x3a3a3a, 0x232323);
    (grid.material as LineBasicMaterial).transparent = true;
    (grid.material as LineBasicMaterial).opacity = 0.55;
    const glow = makeGlow(palette.color.strong, 60, 0.07);
    glow.position.set(0, 0.5, -4);
    this.group.add(grid, glow);

    this.graph = new ArcGraph({
      onCount: (node) => this.onCount(node),
      onFree: (node) => this.onFree(node),
      onEdgeRemoved: (edge) => this.links.get(edge.id)?.fadeOut(),
    });
    this.graph.addNode('root', true);
    this.addNode('root', new Vector3(0, 9.2, 0), 'dodecahedron', palette.ink, 1.35, 'AppRoot', 'window · coordinator');
    this.sync();
  }

  // --- Stage -----------------------------------------------------------------------------------

  pose(portrait: boolean): Pose {
    // always frame at least the first session's footprint so the camera doesn't lurch on login
    const box = new Box3(new Vector3(-8.5, 0, -1), new Vector3(8.5, 10.5, 5.5));
    this.nodes.forEach((n) => box.expandByPoint(n.anchor.position));
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const elevation = portrait ? 0.78 : 0.5;
    return {
      target: center.setY(center.y - 0.5),
      azimuth: -0.14,
      elevation,
      halfW: size.x / 2 + 3,
      halfH: (size.y / 2) * Math.cos(elevation) + (size.z / 2) * Math.sin(elevation) + 3.2,
    };
  }

  update(dt: number, time: number) {
    this.fx.update(dt);
    this.nodes.forEach((node, id) => {
      node.update(dt, time);
      if (node.gone) {
        node.dispose();
        this.nodes.delete(id);
      }
    });
    this.links.forEach((link, id) => {
      link.update(dt, time);
      if (link.gone) {
        link.dispose();
        this.links.delete(id);
      }
    });
  }

  // --- model -> visuals --------------------------------------------------------------------------

  private addNode(id: string, position: Vector3, shape: Shape, color: Color, scale: number, title: string, sub: string) {
    const node = new NodeVisual(this.world, this.group, { shape, color, position, scale, title, sub });
    this.nodes.set(id, node);
    return node;
  }

  private onCount(node: GraphNode) {
    if (node.id === 'root') return;
    const visual = this.nodes.get(node.id);
    const title = visual?.label.el.querySelector('.t')?.textContent ?? '';
    visual?.label.set(title, node.alive ? `RC ${node.strong}` : 'freed');
  }

  private onFree(node: GraphNode) {
    const visual = this.nodes.get(node.id);
    if (!visual) return;
    this.fx.burst(visual.anchor.position, this.palette.color.strong, { count: 70, speed: 4, life: 0.9 });
    visual.despawn();
  }

  /** Re-derive leak styling and framing after any change to the graph. */
  private sync() {
    const leaked = new Set(this.graph.leakedIds());
    this.nodes.forEach((node, id) => {
      if (id === 'root') return;
      node.setLeaked(leaked.has(id), this.fault);
    });
    this.links.forEach((link, id) => {
      const edge = this.graph.edge(id);
      if (edge && leaked.has(edge.from) && leaked.has(edge.to) && edge.kind === 'strong') {
        link.setColor(this.fault);
      }
    });
    this.hud.readout('sessions', this.sessions);
    this.hud.readout('leaked', leaked.size);
    this.hud.root.dataset.screen = this.screen;
    this.hud.enableOnly('arch-actions', {
      login: ['arch-login'],
      dash: ['arch-feature', 'arch-logout'],
      feat: ['arch-back', 'arch-logout'],
    }[this.screen]);
    this.world.refit();
  }

  private edge(id: string, from: string, to: string, kind: 'strong' | 'weak', bend: Vector3) {
    this.graph.link(id, from, to, kind);
    const a = this.nodes.get(from)!;
    const b = this.nodes.get(to)!;
    const weak = kind === 'weak';
    this.links.set(
      id,
      new LinkVisual(this.world, this.group, {
        from: a.anchor,
        to: b.anchor,
        fromRadius: a.radius,
        toRadius: b.radius,
        color: weak ? this.palette.color.weak : this.palette.color.strong,
        bend,
        dashed: weak,
        flow: !weak,
      }),
    );
  }

  // --- actions -----------------------------------------------------------------------------------

  private enqueue(job: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(job).catch((e) => console.error(e));
    return this.queue;
  }

  enter() {
    if (this.sessions === 0) this.hud.say(copy.architecture.init());
    this.sync();
  }

  login() {
    return this.enqueue(async () => {
      if (this.screen !== 'login') return;
      const n = ++this.sessions;
      const k = n - 1;
      const id = (role: Role) => `n${n}.${role}`;
      this.screen = 'dash';
      this.hud.say(this.fixed ? copy.architecture.dashSafe(n) : copy.architecture.dashLeak(n));

      const spawn = async (role: Role, color: Color) => {
        const spec = SPEC[role];
        this.graph.addNode(id(role));
        this.roles.set(id(role), role);
        this.addNode(id(role), place(role, k), spec.shape, color, spec.scale, `${spec.title} #${n}`, 'RC 0');
        this.fx.flash(place(role, k), color, { size: 5, duration: 0.6 });
        await wait(160);
      };
      const { strong } = this.palette.color;
      const ink = this.palette.ink;
      await spawn('vc', strong);
      this.edge(`n${n}.root-vc`, 'root', id('vc'), 'strong', new Vector3(0, 2.6, 0));
      await spawn('vm', ink);
      this.edge(`n${n}.vc-vm`, id('vc'), id('vm'), 'strong', new Vector3(-1.5, 1.6, 1.2));
      await spawn('int', ink.clone().multiplyScalar(0.75));
      this.edge(`n${n}.vm-int`, id('vm'), id('int'), 'strong', new Vector3(0, 1.6, 2.8));
      this.edge(`n${n}.int-vm`, id('int'), id('vm'), this.fixed ? 'weak' : 'strong', new Vector3(0, 1.6, -3));
      this.sync();
      await wait(200);
    });
  }

  openFeature() {
    return this.enqueue(async () => {
      if (this.screen !== 'dash') return;
      const n = this.sessions;
      this.screen = 'feat';
      const spec = SPEC.feat;
      this.graph.addNode(`n${n}.feat`);
      this.addNode(`n${n}.feat`, place('feat', n - 1), spec.shape, this.palette.color.strong, spec.scale, `${spec.title} #${n}`, 'RC 0');
      await wait(120);
      this.edge(`n${n}.vc-feat`, `n${n}.vc`, `n${n}.feat`, 'strong', new Vector3(0, 2, 0));
      this.hud.say(copy.architecture.featOpen());
      this.sync();
      await wait(300);
    });
  }

  back() {
    return this.enqueue(async () => {
      if (this.screen !== 'feat') return;
      this.screen = 'dash';
      this.graph.unlink(`n${this.sessions}.vc-feat`);
      this.hud.say(copy.architecture.featClosed());
      this.sync();
      await wait(400);
    });
  }

  logout() {
    return this.enqueue(async () => {
      if (this.screen === 'login') return;
      this.screen = 'login';
      this.graph.unlink(`n${this.sessions}.root-vc`);
      // only this session's objects decide the verdict; earlier leaks are still on the heap but not news
      const leaked = this.graph.leakedIds().some((id) => id.startsWith(`n${this.sessions}.`));
      this.hud.say(leaked ? copy.architecture.logoutLeaked() : copy.architecture.logoutClean());
      if (leaked) {
        this.world.shake(0.18, 0.4);
        this.hud.flash('fault');
      }
      this.sync();
      await wait(500);
    });
  }

  setFixed(on: boolean) {
    this.fixed = on;
    this.hud.say(on ? copy.architecture.fixOn() : copy.architecture.fixOff());
  }

  reset() {
    return this.enqueue(async () => {
      this.nodes.forEach((node, id) => id !== 'root' && node.despawn());
      this.links.forEach((link) => link.fadeOut());
      this.graph.clear();
      this.graph.addNode('root', true);
      this.sessions = 0;
      this.screen = 'login';
      this.hud.say(copy.architecture.reset());
      this.sync();
      await wait(250);
    });
  }
}
