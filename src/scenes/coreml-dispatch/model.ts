/**
 * A deliberately small model of how Core ML places a network on the SoC, independent of rendering.
 *
 * Core ML partitions the model graph once, at load time: every op goes to the most efficient unit that
 * is both allowed by `MLComputeUnits` and able to run it (Neural Engine, then GPU, then CPU). Two things can
 * keep an op off the Neural Engine: an unaligned tensor shape (the ANE wants aligned, padded layouts, but a
 * GPU copes) or an op it doesn't support at all (CPU only). Every switch of unit costs a synchronisation
 * and a layout conversion.
 *
 * All throughput / power numbers are illustrative: orders of magnitude follow public Apple figures, and
 * the constants are tuned so the three settings tell the story, not to benchmark any real chip.
 */

export type Unit = 'ane' | 'gpu' | 'cpu';
export type ComputeUnits = 'all' | 'cpuAndGPU' | 'cpuAndNeuralEngine';

export const ALLOWED: Record<ComputeUnits, readonly Unit[]> = {
  all: ['ane', 'gpu', 'cpu'],
  cpuAndGPU: ['gpu', 'cpu'],
  cpuAndNeuralEngine: ['ane', 'cpu'],
};

/** Why an op can't run where Core ML would like it to. */
export type Fault = 'unaligned' | 'unsupported';
export type Faults = ReadonlyMap<string, Fault>;
const NO_FAULTS: Faults = new Map();

/** Core ML's preference order when several allowed units can run an op. */
const PREFERENCE: readonly Unit[] = ['ane', 'gpu', 'cpu'];

export interface Op {
  id: string;
  name: string;
  short: string;
  /** Work in billions of operations. */
  gops: number;
  /** Tensor traffic in MB if it ran with no on-chip reuse. */
  mb: number;
}

export const OPS: readonly Op[] = [
  { id: 'conv', name: 'Conv2D 3×3', short: 'Conv', gops: 3.2, mb: 38 },
  { id: 'norm', name: 'LayerNorm', short: 'Norm', gops: 0.25, mb: 6 },
  { id: 'attn', name: 'Attention QKV', short: 'Attn', gops: 2.4, mb: 30 },
  { id: 'matmul', name: 'MatMul', short: 'MatMul', gops: 2.1, mb: 24 },
  { id: 'softmax', name: 'Softmax', short: 'Softmax', gops: 0.12, mb: 4 },
];

/** Effective TOPS on this model (not peak), active power, and how much tensor traffic still reaches DRAM. */
export const UNITS: Record<Unit, { label: string; tops: number; watts: number; traffic: number }> = {
  ane: { label: 'Neural Engine', tops: 7.2, watts: 1.2, traffic: 0.45 },
  gpu: { label: 'GPU', tops: 2.8, watts: 5.5, traffic: 0.8 },
  cpu: { label: 'CPU', tops: 0.55, watts: 7, traffic: 1 },
};

/** Sync + layout conversion each time execution hops to another unit. */
export const TRANSITION_MS = 0.45;
const TRANSITION_MB = 1.5;
const TRANSITION_WATTS = 3;
const IDLE_WATTS = 0.6;

export interface Step {
  index: number;
  op: Op;
  unit: Unit;
  /** Where the previous op ran (null for the first op). */
  from: Unit | null;
  switched: boolean;
  /** Ran somewhere worse than Core ML would have chosen, because of the op's fault. */
  fallback: boolean;
  ms: number;
}

export interface Estimate {
  steps: Step[];
  transitions: number;
  latencyMs: number;
  /** Effective throughput, TOPS. */
  tops: number;
  /** Fabric traffic, GB/s. */
  bandwidth: number;
  watts: number;
  /** TOPS per watt. */
  efficiency: number;
}

export function place(op: Op, mode: ComputeUnits, faults: Faults = NO_FAULTS): Unit {
  const fault = faults.get(op.id);
  const candidates = fault === 'unsupported' ? ['cpu'] : fault === 'unaligned' ? PREFERENCE.filter((u) => u !== 'ane') : PREFERENCE;
  return candidates.find((u) => ALLOWED[mode].includes(u as Unit)) as Unit;
}

export function estimate(mode: ComputeUnits, faults: Faults = NO_FAULTS): Estimate {
  const steps: Step[] = OPS.map((op, index) => ({ op, index, unit: 'cpu', from: null, switched: false, fallback: false, ms: 0 }));
  steps.forEach((step, i) => {
    step.unit = place(step.op, mode, faults);
    step.from = i ? steps[i - 1].unit : null;
    step.switched = step.from !== null && step.from !== step.unit;
    step.fallback = step.unit !== place(step.op, mode);
    step.ms = step.op.gops / UNITS[step.unit].tops;
  });

  const transitions = steps.filter((s) => s.switched).length;
  const busyMs = steps.reduce((sum, s) => sum + s.ms, 0);
  const latencyMs = busyMs + transitions * TRANSITION_MS;
  const gops = OPS.reduce((sum, op) => sum + op.gops, 0);
  const mb = steps.reduce((sum, s) => sum + s.op.mb * UNITS[s.unit].traffic, 0) + transitions * TRANSITION_MB;
  const joules =
    steps.reduce((sum, s) => sum + s.ms * UNITS[s.unit].watts, 0) + transitions * TRANSITION_MS * TRANSITION_WATTS + latencyMs * IDLE_WATTS;
  const watts = joules / latencyMs;
  const tops = gops / latencyMs;

  return { steps, transitions, latencyMs, tops, bandwidth: mb / latencyMs, watts, efficiency: tops / watts };
}
