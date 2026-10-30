import type { Message } from '../engine/hud';
import { OPS, UNITS } from './model';
import type { ComputeUnits, Estimate, Fault } from './model';

const K = 'Core ML · Dispatch';
const ms = (n: number) => `${n.toFixed(n < 10 ? 2 : 1)} ms`;

export const idle = (): Message => ({
  kicker: K,
  title: 'One model, three engines',
  text: 'Core ML splits a network across the CPU, GPU and Neural Engine. Choose which units it may use, tap an operation to break it, and watch the data move.',
  detail:
    'This is an illustrative floor plan, not a die shot: block counts follow a base Apple-silicon layout, and the numbers are simulated. Orders of magnitude follow public figures (Neural Engine ≈ 16–38 TOPS across generations, unified memory ≈ 100–400 GB/s).',
});

export const mode = (m: ComputeUnits, e: Estimate): Message => {
  const base = { kicker: K, tone: 'info' as const };
  if (m === 'all')
    return {
      ...base,
      title: '.all · Neural Engine first',
      text: `Each op goes to the most efficient unit that can run it: Neural Engine, then GPU, then CPU. This model finishes in <strong>${ms(e.latencyMs)}</strong> at ${e.efficiency.toFixed(1)} TOPS/W.`,
      detail:
        'Core ML decides the placement once, when the model loads. The first load on the Neural Engine also compiles the graph for that device, which is cached afterwards.',
    };
  if (m === 'cpuAndGPU')
    return {
      ...base,
      title: '.cpuAndGPU · Neural Engine off',
      text: `Work reroutes into the GPU’s SIMD lanes: <strong>${ms(e.latencyMs)}</strong> and ${e.efficiency.toFixed(2)} TOPS/W. Slower and hungrier, but no ANE compile on first load and no alignment rules.`,
      detail:
        'A good fit for models with dynamic shapes or ops the Neural Engine rejects: everything stays on one unit, so there are no hops between engines.',
    };
  return {
    ...base,
    title: '.cpuAndNeuralEngine · GPU stays free',
    text: `Inference stays on the Neural Engine and CPU, leaving the GPU free for rendering. Anything the Neural Engine can’t take falls back to the <strong>CPU</strong>, never the GPU.`,
    detail: 'Useful when the app is also drawing (games, AR, video): the GPU budget is not touched by inference.',
  };
};

export const fault = (kind: Fault | null, opId: string, m: ComputeUnits, before: Estimate, after: Estimate): Message => {
  const op = OPS.find((o) => o.id === opId)!;
  if (!kind) {
    return { kicker: K, title: 'Back to normal', text: `${op.name} is placeable again: <strong>${ms(after.latencyMs)}</strong>.`, tone: 'ok' };
  }
  const worse = `${ms(before.latencyMs)} → <strong>${ms(after.latencyMs)}</strong>`;
  const target = after.steps.find((s) => s.op.id === opId)!.unit;
  if (kind === 'unaligned') {
    if (!after.steps.some((s) => s.fallback))
      return {
        kicker: K,
        title: 'Unaligned tensor · no penalty',
        text: `${op.name} has an unaligned shape, but the GPU doesn’t share the Neural Engine’s alignment rules, so nothing changes (${ms(after.latencyMs)}).`,
        tone: 'ok',
      };
    return {
      kicker: K,
      title: `Unaligned tensor · falls back to the ${UNITS[target].label}`,
      text: `The Neural Engine wants aligned, padded layouts. ${op.name} hops ANE → ${UNITS[target].label} → ANE: ${after.transitions} unit switches of sync and layout conversion. ${worse}.`,
      detail:
        'Apple’s guidance for transformers on the Neural Engine is to keep the last axis contiguous and aligned to 64 bytes. Padding a dimension is often cheaper than the fallback.',
      tone: 'warn',
    };
  }
  return {
    kicker: K,
    title: `Unsupported op · CPU only`,
    text: `${op.name} can’t run on an accelerator. The Neural Engine stalls and flushes its SRAM, the tensor drains back over the fabric into the CPU’s L2, and execution returns afterwards. ${worse}.`,
    detail:
      'Each switch of unit is a synchronisation point plus a layout conversion. One CPU op in the middle of a Neural Engine graph can cost more than the rest of the model combined.',
    tone: 'fault',
  };
};

export const lid = (on: boolean): Message => ({
  kicker: K,
  title: on ? 'Heat spreader on' : 'Silicon X-ray',
  text: on
    ? 'The lid hides the die. Dispatch continues underneath, but you can only watch it in the pipeline and the telemetry.'
    : 'With the lid lifted the die is exposed: CPU clusters on the left, the GPU’s 16 cores in the middle, the Neural Engine on the right, joined to the memory stacks by copper fabric.',
});

export const preset = (name: 'overview' | 'ane' | 'gpu' | 'cpu'): Message | null => {
  switch (name) {
    case 'ane':
      return {
        kicker: K,
        title: 'Neural Engine · systolic MAC array',
        text: 'Weights wait in SRAM beside a grid of multiply-accumulate cells. Each operation sweeps a diagonal wavefront across the array while results gather in the right-hand SRAM.',
        detail: 'Apple has not published the Neural Engine’s microarchitecture, so this is a model of how matrix-multiply accelerators work, not a die photo.',
      };
    case 'gpu':
      return {
        kicker: K,
        title: 'GPU · SIMD lanes',
        text: 'Sixteen shader cores, each running threads in lockstep groups of 32 lanes (a SIMD-group). Work spreads across all of them, which is why the GPU suits big, regular tensors.',
      };
    case 'cpu':
      return {
        kicker: K,
        title: 'CPU · and the unified memory bus',
        text: 'Four performance and four efficiency cores around shared L2 banks. Every unit reaches the same LPDDR5X through the fabric, so a hop between units moves a handoff, not a copy across a bus.',
      };
    default:
      return null;
  }
};

export const reset = (): Message => ({ kicker: K, title: 'Reset', text: 'All compute units allowed, every op aligned, lid lifted.' });

