import { Hud } from '../engine/hud';
import { readPalette } from '../engine/palette';
import { Tour } from '../engine/tour';
import type { TourContext } from '../engine/tour';
import { World } from '../engine/world';
import { ArchitectureDemo } from './architecture-demo';
import { HardwareDemo } from './hardware-demo';
import { HardwareStage } from './hardware-stage';
import { ARC_COLORS } from './theme';

type Mode = 'hardware' | 'architecture';

export function boot(root: HTMLElement) {
  const hud = new Hud(root);
  const stage = root.closest<HTMLElement>('[data-stage]')!;
  const palette = readPalette(root, ARC_COLORS);

  let world: World;
  try {
    world = new World({
      host: root.querySelector<HTMLElement>('[data-canvas]')!,
      labelHost: root.querySelector<HTMLElement>('[data-labels]')!,
      clearArea: stage.querySelector<HTMLElement>('[data-clear]')!,
      background: palette.bg,
      accent: palette.color.strong,
    });
  } catch (error) {
    console.warn('WebGL unavailable, showing the written fallback.', error);
    hud.fail();
    return;
  }

  const hardwareStage = new HardwareStage(world, palette);
  const hardware = new HardwareDemo(world, hardwareStage, hud, palette);
  const architecture = new ArchitectureDemo(world, hud, palette);
  world.addStage(hardwareStage);
  world.addStage(architecture);

  const tour = new Tour((playing) => hud.setPlaying(playing));
  const fix = root.querySelector<HTMLInputElement>('[data-fix]')!;
  let mode: Mode = 'hardware';

  const setMode = (next: Mode) => {
    tour.stop();
    mode = next;
    world.show(next === 'hardware' ? hardwareStage : architecture);
    (next === 'hardware' ? hardware : architecture).enter();
  };
  hud.tabs('hardware', (id) => setMode(id as Mode));
  setMode('hardware');

  // --- controls ---------------------------------------------------------------------------------

  const manual: Record<string, () => unknown> = {
    alloc: () => hardware.allocate(),
    strong: () => hardware.addStrong(),
    weak: () => hardware.addWeak(),
    unowned: () => hardware.addUnowned(),
    release: () => hardware.release(),
    read: () => hardware.read(),
    reset: () => (mode === 'hardware' ? hardware.reset() : (setFix(false), architecture.reset())),
    'arch-login': () => architecture.login(),
    'arch-feature': () => architecture.openFeature(),
    'arch-back': () => architecture.back(),
    'arch-logout': () => architecture.logout(),
  };

  hud.onAction((action) => {
    if (action === 'tour') return tour.playing ? tour.stop() : tour.start(mode === 'hardware' ? hardwareStory : architectureStory);
    tour.stop(); // any hands-on input takes over from the guided story
    manual[action]?.();
  });

  function setFix(on: boolean) {
    fix.checked = on;
    architecture.setFixed(on);
  }
  fix.addEventListener('change', () => {
    tour.stop();
    architecture.setFixed(fix.checked);
  });

  stage.addEventListener('stage:focus', (e) => world.setAutoRotate((e as CustomEvent<{ on: boolean }>).detail.on));

  // --- guided stories: the whole lesson without touching anything ------------------------------

  async function hardwareStory(t: TourContext) {
    await hardware.reset();
    await t.pause(300);
    await t.step(() => hardware.allocate(), 2600);
    await t.step(() => hardware.addStrong(), 2400);
    await t.step(() => hardware.addWeak(), 2800);
    await t.step(() => hardware.addUnowned(), 2800);
    await t.step(() => hardware.read(), 2800);
    await t.step(() => hardware.release(), 2400);
    await t.step(() => hardware.release(), 3600);
    await t.step(() => hardware.read(), 4200);
  }

  async function architectureStory(t: TourContext) {
    setFix(false);
    await architecture.reset();
    await t.pause(300);
    await t.step(() => architecture.login(), 3200);
    await t.step(() => architecture.openFeature(), 2400);
    await t.step(() => architecture.back(), 2400);
    await t.step(() => architecture.logout(), 4200);
    await t.step(() => setFix(true), 2600);
    await t.step(() => architecture.login(), 3000);
    await t.step(() => architecture.logout(), 4200);
  }

  world.start();
  requestAnimationFrame(() => hud.ready());
}
