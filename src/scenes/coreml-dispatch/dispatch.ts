import type { Color, Curve, Vector3 } from 'three';
import type { Effects } from '../engine/effects';
import type { Hud } from '../engine/hud';
import type { World } from '../engine/world';
import * as copy from './copy';
import { estimate } from './model';
import type { ComputeUnits, Estimate, Fault, Step, Unit } from './model';
import type { PresetName, SocPalette, SocStage } from './soc-stage';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const FAULT_CYCLE: (Fault | null)[] = [null, 'unaligned', 'unsupported'];
/** The op the dock's fault button breaks. */
const DEFAULT_OP = 'attn';

/**
 * Plays one model inference over and over across the die, following the plan `estimate()` computes:
 * a token leaves memory, executes each op on its unit (systolic wavefront, SIMD lanes, core pulses),
 * and pays a visible stall whenever it has to hop to a different unit. Changing the compute units or
 * breaking an op re-plans and restarts the run, so what you see is always the real placement.
 */
export class DispatchDemo {
  private mode: ComputeUnits = 'all';
  private faults = new Map<string, Fault>();
  private est: Estimate = estimate('all');
  private epoch = 0;
  private fx: Effects;

  constructor(
    private world: World,
    private stage: SocStage,
    private hud: Hud,
    private palette: SocPalette,
  ) {
    this.fx = stage.effects;
  }

  start() {
    this.paint();
    this.hud.say(copy.idle());
    this.hud.radio('camera', 'overview');
    if (this.world.reducedMotion) {
      this.setXray(true, true);
    } else {
      // the lid comes off a moment after load: product shot first, then the silicon
      setTimeout(() => this.setXray(true, false, true), 1500);
    }
    this.restart();
  }

  // --- controls ---------------------------------------------------------------------------------

  setMode(mode: ComputeUnits, say = true) {
    this.mode = mode;
    this.hud.selectTab(mode);
    this.replan();
    if (say) this.hud.say(copy.mode(mode, this.est));
  }

  /** Tap an op: cycle healthy → unaligned → unsupported → healthy. */
  cycleFault(opId: string) {
    // compare against the healthy baseline for this op, not against the previous fault in the cycle
    const healthy = new Map(this.faults);
    healthy.delete(opId);
    const before = estimate(this.mode, healthy);
    const current = this.faults.get(opId) ?? null;
    const next = FAULT_CYCLE[(FAULT_CYCLE.indexOf(current) + 1) % FAULT_CYCLE.length];
    if (next) this.faults.set(opId, next);
    else this.faults.delete(opId);
    this.replan();
    this.hud.say(copy.fault(next, opId, this.mode, before, this.est));
  }

  /** The dock button: cycle the default op's fault. */
  toggleFault() {
    this.cycleFault(DEFAULT_OP);
  }

  clearFaults() {
    if (!this.faults.size) return;
    const before = this.est;
    this.faults.clear();
    this.replan();
    this.hud.say(copy.fault(null, DEFAULT_OP, this.mode, before, this.est));
  }

  setPreset(name: PresetName, say = true) {
    this.world.setPose(name === 'overview' ? null : () => this.stage.presetPose(name, this.world.portrait));
    this.hud.radio('camera', name);
    this.hud.root.dataset.preset = name;
    const message = copy.preset(name);
    if (say && message) this.hud.say(message);
  }

  setXray(on: boolean, instant = false, silent = false) {
    this.stage.setLid(!on, instant);
    this.hud.radio('xray', on ? 'on' : null);
    if (!silent) this.hud.say(copy.lid(!on));
  }

  toggleXray() {
    this.setXray(this.stage.lidIsOn);
  }

  reset() {
    this.faults.clear();
    this.mode = 'all';
    this.hud.selectTab('all');
    this.setPreset('overview', false);
    this.setXray(true, false, true);
    this.replan();
    this.hud.say(copy.reset());
  }

  // --- planning ---------------------------------------------------------------------------------

  private replan() {
    this.est = estimate(this.mode, this.faults);
    this.paint();
    this.restart();
  }

  private restart() {
    this.epoch++;
    for (const u of ['ane', 'gpu', 'cpu'] as Unit[]) this.stage.setActivity(u, 0);
    this.stage.setStall(0);
    void this.loop(this.epoch);
  }

  /** Pipeline strip + telemetry for the current plan. */
  private paint() {
    const q = <T extends HTMLElement>(selector: string) => this.hud.root.querySelector<T>(selector);
    for (const step of this.est.steps) {
      const chip = q(`[data-op="${step.op.id}"]`);
      if (chip) {
        chip.dataset.unit = step.unit;
        chip.dataset.fault = this.faults.get(step.op.id) ?? 'none';
        chip.querySelector('.u')!.textContent = step.unit.toUpperCase();
      }
      const hop = q(`[data-hop="${step.op.id}"]`);
      if (hop) hop.dataset.switched = String(step.switched);
    }
    this.hud.radio('fault', this.faults.size ? 'on' : null);
    this.telemetry();
  }

  private telemetry(jitter = 0) {
    const e = this.est;
    const j = (v: number) => v * (1 + (Math.random() - 0.5) * jitter);
    this.hud.readout('tops', j(e.tops).toFixed(1), false);
    this.hud.readout('bandwidth', Math.round(j(e.bandwidth)), false);
    this.hud.readout('latency', j(e.latencyMs).toFixed(2), false);
    this.hud.readout('efficiency', j(e.efficiency).toFixed(e.efficiency < 1 ? 2 : 1), false);
    this.hud.root.dataset.degraded = String(e.transitions > 0);
  }

  private setActiveOp(id: string | null) {
    this.hud.root.querySelectorAll<HTMLElement>('[data-op]').forEach((chip) => {
      chip.dataset.active = String(chip.dataset.op === id);
    });
  }

  // --- animation ----------------------------------------------------------------------------------

  private async loop(epoch: number) {
    await sleep(250);
    while (epoch === this.epoch) {
      const steps = this.est.steps;
      for (let i = 0; i < steps.length; i++) {
        if (epoch !== this.epoch) return;
        await this.execute(steps[i], steps[i + 1]?.unit ?? null, epoch);
      }
      if (epoch !== this.epoch) return;
      this.setActiveOp(null);
      const last = steps[steps.length - 1].unit;
      await this.stream((dx) => this.stage.unitToMem(last, dx), this.palette.color[last], { duration: 1 });
      this.telemetry(0.03);
      await sleep(700);
    }
  }

  private async execute(step: Step, next: Unit | null, epoch: number) {
    const { stage } = this;
    const color = this.palette.color[step.unit];
    this.setActiveOp(step.op.id);

    if (step.from === null) {
      await this.stream((dx) => stage.memToUnit(step.unit, dx), color, { duration: 1 });
    } else if (step.switched) {
      if (step.from === 'ane' && step.fallback) await this.stall(step.unit);
      else {
        this.tag(step.unit, `↯ +0.45 ms`, 'accent');
        await this.stream((dx) => stage.hop(step.from!, step.unit, dx), color, { duration: 1.1 });
      }
    }
    if (epoch !== this.epoch) return;

    stage.setActivity(step.unit, 1, true);
    await sleep(Math.min(2600, 550 + step.ms * 550));
    if (epoch !== this.epoch) return;
    if (next !== step.unit) stage.setActivity(step.unit, 0);
  }

  /** The Neural Engine can't take the next op: stall, flush SRAM, and drain the tensor to where it can run. */
  private async stall(target: Unit) {
    const { stage, fx } = this;
    const c = this.palette.color;
    stage.setActivity('ane', 0);
    stage.setStall(1);
    this.tag('ane', 'Stall · SRAM flush', 'alert');
    await sleep(500);
    if (target === 'cpu') {
      await Promise.all(
        Array.from({ length: 12 }, (_, i) => fx.pulse(stage.surgeToCpuCache(((i % 3) - 1) * 0.22), c.alert, { duration: 1.5, size: 1.35, stutter: 6, delay: i * 0.07 })),
      );
      stage.flashCache();
      this.world.shake(0.1, 0.25);
    } else {
      await this.stream((dx) => stage.hop('ane', target, dx), c.alert, { duration: 1.2, stutter: 4 });
    }
    stage.setStall(0);
    this.tag(target, '↯ +0.45 ms', 'accent');
  }

  /** Three parallel packets, slightly staggered and offset, so a transfer reads as a flow. */
  private stream(route: (dx: number) => Curve<Vector3>, color: Color, opts: { duration: number; stutter?: number }) {
    return Promise.all([-0.5, 0, 0.5].map((dx, i) => this.fx.pulse(route(dx), color, { size: 0.95, delay: i * 0.1, ...opts })));
  }

  /** Short-lived callout floating above a block. */
  private tag(unit: Unit, text: string, tone: 'alert' | 'accent') {
    const anchor = this.stage.anchor(unit);
    const label = this.world.addLabel(anchor, text, '', 'tag', 0.6, 54);
    label.el.style.setProperty('--tint', tone === 'alert' ? this.palette.css.alert : this.palette.css.ane);
    if (tone === 'alert') label.el.style.setProperty('--tag-fg', '#fff');
    setTimeout(() => {
      this.world.removeLabel(label);
      anchor.removeFromParent();
    }, 1900);
  }
}

