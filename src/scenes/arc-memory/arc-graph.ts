/**
 * A tiny model of Swift's reference counting, independent of any rendering.
 *
 * - strong edges own their target: the target is freed when its last strong edge is released
 * - weak / unowned edges never keep a target alive (they are tallied separately)
 * - freeing a node runs its "deinit": every edge it owned is released, which may cascade
 * - weak / unowned edges *to* a freed node stay in the graph, because that is exactly
 *   the situation the demo wants to show (weak reads nil, unowned is dangling)
 *
 * Both tabs of the scene drive this model and subscribe to its events to animate.
 */

export type RefKind = 'strong' | 'weak' | 'unowned';

export interface GraphNode {
  id: string;
  /** Roots (AppRoot, a thread's stack frame) are always alive and are where leak detection starts. */
  root: boolean;
  alive: boolean;
  strong: number;
  weak: number;
  unowned: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: RefKind;
}

export interface GraphListener {
  /** Reference tallies of a node changed. */
  onCount?(node: GraphNode): void;
  /** A node's strong count reached zero (its deinit is about to release what it owned). */
  onFree?(node: GraphNode): void;
  /** An edge disappeared: released by its owner, or dropped because its owner was freed. */
  onEdgeRemoved?(edge: GraphEdge, reason: 'released' | 'owner-freed'): void;
}

const COUNT_FIELD = { strong: 'strong', weak: 'weak', unowned: 'unowned' } as const;

export class ArcGraph {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();

  constructor(private listener: GraphListener = {}) {}

  addNode(id: string, root = false): GraphNode {
    const node: GraphNode = { id, root, alive: true, strong: 0, weak: 0, unowned: 0 };
    this.nodes.set(id, node);
    return node;
  }

  node(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  edge(id: string): GraphEdge | undefined {
    return this.edges.get(id);
  }

  edgesFrom(id: string): GraphEdge[] {
    return [...this.edges.values()].filter((e) => e.from === id);
  }

  edgesTo(id: string, kind?: RefKind): GraphEdge[] {
    return [...this.edges.values()].filter((e) => e.to === id && (!kind || e.kind === kind));
  }

  /** Form a reference. Owners and targets must be alive: Swift cannot hand out a ref to a dead object. */
  link(id: string, from: string, to: string, kind: RefKind): GraphEdge {
    const owner = this.nodes.get(from);
    const target = this.nodes.get(to);
    if (!owner?.alive || !target?.alive) throw new Error(`Cannot link ${from} -> ${to}: both ends must be alive`);

    const edge: GraphEdge = { id, from, to, kind };
    this.edges.set(id, edge);
    target[COUNT_FIELD[kind]]++;
    this.listener.onCount?.(target);
    return edge;
  }

  /** Release a reference. Returns false when the edge doesn't exist. */
  unlink(id: string, reason: 'released' | 'owner-freed' = 'released'): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;
    this.edges.delete(id);

    const target = this.nodes.get(edge.to);
    if (target) {
      const field = COUNT_FIELD[edge.kind];
      target[field] = Math.max(0, target[field] - 1);
      this.listener.onCount?.(target);
    }
    this.listener.onEdgeRemoved?.(edge, reason);

    if (target && edge.kind === 'strong' && target.alive && !target.root && target.strong === 0) this.free(target);
    return true;
  }

  private free(node: GraphNode) {
    node.alive = false;
    this.listener.onFree?.(node);
    for (const owned of this.edgesFrom(node.id)) this.unlink(owned.id, 'owner-freed');
  }

  /** Alive nodes reachable from a root through strong edges. */
  private reachable(): Set<string> {
    const seen = new Set<string>();
    const stack = [...this.nodes.values()].filter((n) => n.root && n.alive).map((n) => n.id);
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of this.edgesFrom(id)) if (e.kind === 'strong') stack.push(e.to);
    }
    return seen;
  }

  /** Alive but unreachable from any root: the definition of a leak. */
  leakedIds(): string[] {
    const reachable = this.reachable();
    return [...this.nodes.values()].filter((n) => n.alive && !reachable.has(n.id)).map((n) => n.id);
  }

  clear() {
    this.nodes.clear();
    this.edges.clear();
  }
}
