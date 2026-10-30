import { Color } from 'three';
import { Hud } from '../engine/hud';
import { readPalette } from '../engine/palette';
import { Tour } from '../engine/tour';
import type { TourContext } from '../engine/tour';
import { World } from '../engine/world';
import { DispatchDemo } from './dispatch';
import type { ComputeUnits } from './model';
import { SOC_COLORS, SocStage } from './soc-stage';
import type { PresetName } from './soc-stage';

export function boot(root: HTMLElement) {
  const hud = new Hud(root);
  const stage = root.closest<HTMLElement>('[data-stage]')!;
  const palette = readPalette(root, SOC_COLORS);

  let world: World;
  try {
    world = new World({
      host: root.querySelector<HTMLElement>('[data-canvas]')!,
      labelHost: root.querySelector<HTMLElement>('[data-labels]')!,
      clearArea: stage.querySelector<HTMLElement>('[data-clear]')!,
      // transparent canvas: the light fog gradient behind it is plain CSS
      background: null,
      fog: new Color(0xbdbdbd),
      fogDensity: 0.004,
      accent: palette.color.ane,
      keyLight: new Color(0xfff1e0),
      rimLight: new Color(0xe8eef5),
      exposure: 1,
      envIntensity: 0.7,
      maxPixelRatio: matchMedia('(pointer: coarse)').matches ? 1.75 : 2,
    });
  } catch (error) {
    console.warn('WebGL unavailable, showing the written fallback.', error);
    hud.fail();
    return;
  }

  const soc = new SocStage(world, palette);
  world.addStage(soc);
  world.show(soc);
  const demo = new DispatchDemo(world, soc, hud, palette);
  const tour = new Tour((playing) => hud.setPlaying(playing));

  hud.tabs('all', (id) => {
    tour.stop();
    demo.setMode(id as ComputeUnits);
  });

  hud.onAction((action, el) => {
    if (action === 'tour') return tour.playing ? tour.stop() : tour.start(story);
    tour.stop(); // hands-on input takes over from the guided story
    if (action.startsWith('cam-')) demo.setPreset(action.slice(4) as PresetName);
    else if (action === 'xray') demo.toggleXray();
    else if (action === 'fault') demo.toggleFault();
    else if (action === 'op') demo.cycleFault(el.dataset.op!);
    else if (action === 'reset') demo.reset();
  });
  stage.addEventListener('stage:focus', (e) => world.setAutoRotate((e as CustomEvent<{ on: boolean }>).detail.on));

  // the whole lesson without touching anything
  async function story(t: TourContext) {
    demo.reset();
    await t.pause(1200);
    await t.step(() => demo.setPreset('ane'), 6500);
    await t.step(() => demo.setMode('cpuAndGPU'), 0);
    await t.step(() => demo.setPreset('gpu', false), 6500);
    await t.step(() => { demo.setMode('all', false); demo.setPreset('overview', false); demo.cycleFault('attn'); }, 7500);
    await t.step(() => demo.setMode('cpuAndNeuralEngine'), 9500);
    await t.step(() => { demo.setPreset('cpu', false); demo.cycleFault('attn'); }, 10500);
    await t.step(() => { demo.clearFaults(); demo.setMode('all', false); demo.setPreset('overview'); }, 4000);
  }

  world.start();
  demo.start();
  requestAnimationFrame(() => hud.ready());
}
