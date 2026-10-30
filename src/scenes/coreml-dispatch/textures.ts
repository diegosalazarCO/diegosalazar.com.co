import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/**
 * Procedural textures for the board, die and lid: no image assets, so the scene stays a few KB of code.
 * Everything is drawn from a seeded generator, so the board looks identical on every visit.
 */

function canvas(w: number, h: number) {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  return { el, g: el.getContext('2d')! };
}

function texture(el: HTMLCanvasElement, colour = true) {
  const tex = new CanvasTexture(el);
  if (colour) tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export const BOARD = { w: 52, d: 36, pxPerUnit: 25 };

/**
 * PCB solder-mask: faint ground-plane hatch, differential trace pairs fanning out of the package,
 * length-matching meanders, via fences, test points and silkscreen. Returns a colour map and a bump map
 * drawn from the same instructions, so the traces are physically raised.
 */
export function boardTextures() {
  const W = BOARD.w * BOARD.pxPerUnit;
  const H = BOARD.d * BOARD.pxPerUnit;
  const X = (x: number) => (x + BOARD.w / 2) * BOARD.pxPerUnit;
  const Z = (z: number) => (z + BOARD.d / 2) * BOARD.pxPerUnit;

  const make = (layer: 'color' | 'bump') => {
    const { el, g } = canvas(W, H);
    const rnd = seeded(11);
    const ink = (color: string, bump: string) => (layer === 'color' ? color : bump);

    g.fillStyle = ink('#111214', '#000');
    g.fillRect(0, 0, W, H);

    // ground-plane cross-hatch
    g.strokeStyle = ink('rgba(255,255,255,0.028)', 'rgba(255,255,255,0.06)');
    g.lineWidth = 1;
    for (let i = -H; i < W; i += 11) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + H, H);
      g.stroke();
    }

    const trace = ink('#3a352f', '#fff');
    const pair = (pts: [number, number][], gap = 4.5) => {
      for (const o of [-gap / 2, gap / 2]) {
        g.beginPath();
        pts.forEach(([x, z], i) => {
          const px = X(x) + (i % 2 ? 0 : o);
          const pz = Z(z) + (i % 2 ? o : 0);
          i ? g.lineTo(px, pz) : g.moveTo(px, pz);
        });
        g.stroke();
      }
    };
    g.strokeStyle = trace;
    g.lineWidth = 1.8;
    g.lineJoin = 'round';

    // 20 differential pairs from the package's south edge to the board connector, with 45° jogs
    for (let i = 0; i < 20; i++) {
      const x0 = -14.2 + i * 1.5;
      const x1 = -21 + i * 2.2;
      const dz = Math.abs(x1 - x0);
      pair([[x0, 11.2], [x0, 12.4], [x1, 12.4 + dz], [x1, 17.2]]);
    }
    // 10 pairs each side towards the power and clock components
    for (let i = 0; i < 10; i++) {
      pair([[-18.2, -7 + i * 1.3], [-20.4 - (i % 3) * 0.6, -7 + i * 1.3], [-23.4, -4 + i * 1.3], [-24.8, -4 + i * 1.3]], 4);
      pair([[18.2, -7 + i * 1.3], [20.4 + (i % 3) * 0.6, -7 + i * 1.3], [23.4, -4 + i * 1.3], [24.8, -4 + i * 1.3]], 4);
    }
    // length-matching meanders north of the package
    for (let k = 0; k < 8; k++) {
      const x0 = -12 + k * 3.4;
      g.beginPath();
      g.moveTo(X(x0), Z(-11.2));
      for (let s = 0; s < 9; s++) g.lineTo(X(x0 + (s % 2 ? 0 : 1.1)), Z(-11.6 - s * 0.55));
      g.lineTo(X(x0), Z(-16.8));
      g.stroke();
    }

    // via fence: two rings of gold-plated ground vias around the package
    const via = (x: number, z: number) => {
      g.fillStyle = ink('#8c7448', '#fff');
      g.beginPath();
      g.arc(X(x), Z(z), 2.8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = ink('#050505', '#000');
      g.beginPath();
      g.arc(X(x), Z(z), 1.1, 0, Math.PI * 2);
      g.fill();
    };
    for (const r of [0.9]) {
      for (let x = -18 - r; x <= 18 + r; x += 0.8) {
        via(x, -11 - r);
        via(x, 11 + r);
      }
      for (let z = -11 - r; z <= 11 + r; z += 0.8) {
        via(-18 - r, z);
        via(18 + r, z);
      }
    }
    for (let i = 0; i < 60; i++) via((rnd() - 0.5) * 48, (rnd() - 0.5) * 33);

    // test points and silkscreen
    if (layer === 'color') {
      g.fillStyle = '#f9a35a';
      for (const [x, z] of [[-23, -15], [-21, -15], [23, -15], [21, -15], [-23, 15], [23, 15]]) {
        g.beginPath();
        g.arc(X(x), Z(z), 5, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.strokeStyle = ink('rgba(236,230,220,0.5)', 'rgba(255,255,255,0.4)');
    g.fillStyle = g.strokeStyle;
    g.lineWidth = 1.5;
    g.strokeRect(X(-19.2), Z(-12.2), 38.4 * BOARD.pxPerUnit, 24.4 * BOARD.pxPerUnit); // package outline
    g.beginPath(); // pin-1 marker
    g.moveTo(X(-19.2), Z(-12.2));
    g.lineTo(X(-17.8), Z(-12.2));
    g.lineTo(X(-19.2), Z(-10.8));
    g.fill();
    for (const [x, z] of [[-24.6, -16.4], [24.6, -16.4], [-24.6, 16.4], [24.6, 16.4]]) {
      g.beginPath(); // fiducials
      g.arc(X(x), Z(z), 7, 0, Math.PI * 2);
      g.moveTo(X(x) - 11, Z(z));
      g.lineTo(X(x) + 11, Z(z));
      g.moveTo(X(x), Z(z) - 11);
      g.lineTo(X(x), Z(z) + 11);
      g.stroke();
    }
    g.font = '600 15px ui-monospace, Menlo, monospace';
    g.fillText('SOC EVALUATION BOARD · ILLUSTRATIVE FLOOR PLAN', X(-24.6), Z(-17.2));
    g.font = '12px ui-monospace, Menlo, monospace';
    g.fillText('REV A · NOT A DIE SHOT', X(-24.6), Z(-16.5));
    g.fillText('TP1  TP2  TP3  TP4', X(-24), Z(-14.2));
    g.fillText('C1–C256  L1–L6  Y1', X(14.2), Z(-17.2));

    return texture(el, layer === 'color');
  };

  return { map: make('color'), bump: make('bump') };
}

/** Brushed metal heat spreader with a laser-engraved legend and one orange index mark. */
export function lidTexture() {
  const { el, g } = canvas(1024, 420);
  const rnd = seeded(5);
  const grad = g.createLinearGradient(0, 0, 1024, 420);
  grad.addColorStop(0, '#9c9fa4');
  grad.addColorStop(0.5, '#c9cbce');
  grad.addColorStop(1, '#a3a6ab');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 420);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
    g.fillRect(rnd() * 1024, rnd() * 420, 40 + rnd() * 240, 1);
  }
  g.strokeStyle = 'rgba(40,42,46,0.55)';
  g.lineWidth = 3;
  g.strokeRect(26, 26, 972, 368);
  g.fillStyle = '#f9a35a';
  g.fillRect(26, 26, 14, 368);

  g.fillStyle = 'rgba(38,40,44,0.88)';
  g.textAlign = 'center';
  g.font = '700 58px "Rajdhani", ui-sans-serif, system-ui, sans-serif';
  g.fillText('SYSTEM-ON-CHIP', 532, 190);
  g.font = '600 22px ui-monospace, Menlo, monospace';
  g.fillText('ILLUSTRATIVE FLOOR PLAN', 532, 236);
  g.font = '500 17px ui-monospace, Menlo, monospace';
  g.fillText('4P + 4E CPU  ·  16-CORE GPU  ·  16-CORE NEURAL ENGINE', 532, 280);
  g.fillText('UNIFIED MEMORY · LPDDR5X', 532, 308);
  return texture(el);
}

/** Silicon die: dark substrate with faint metal-layer grid and macro outlines. */
export function dieTexture() {
  const { el, g } = canvas(1024, 304);
  const rnd = seeded(23);
  const grad = g.createLinearGradient(0, 0, 0, 304);
  grad.addColorStop(0, '#202226');
  grad.addColorStop(1, '#131417');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 304);
  g.strokeStyle = 'rgba(255,255,255,0.035)';
  g.lineWidth = 1;
  for (let x = 0; x < 1024; x += 8) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 304);
    g.stroke();
  }
  for (let y = 0; y < 304; y += 8) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(1024, y);
    g.stroke();
  }
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,255,255,${0.012 + rnd() * 0.025})`;
    g.fillRect(rnd() * 1000, rnd() * 290, 14 + rnd() * 60, 6 + rnd() * 26);
  }
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 2;
  g.strokeRect(3, 3, 1018, 298);
  return texture(el);
}

/** Plate under the ANE's MAC array, with its 16 cores (4×4 groups) outlined. */
export function anePlateTexture() {
  const { el, g } = canvas(512, 460);
  g.fillStyle = '#15161a';
  g.fillRect(0, 0, 512, 460);
  g.strokeStyle = 'rgba(249,163,90,0.38)';
  g.lineWidth = 2;
  const pad = 26;
  const cw = (512 - pad * 2) / 4;
  const ch = (460 - pad * 2) / 4;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) g.strokeRect(pad + c * cw + 4, pad + r * ch + 4, cw - 8, ch - 8);
  return texture(el);
}

/** Soft contact shadow, so the board sits on the page instead of floating. */
export function shadowTexture() {
  const { el, g } = canvas(256, 256);
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return texture(el);
}

/** Top marking of an LPDDR5X package. */
export function dramTexture() {
  const { el, g } = canvas(512, 176);
  g.fillStyle = '#151619';
  g.fillRect(0, 0, 512, 176);
  g.strokeStyle = 'rgba(255,255,255,0.1)';
  g.lineWidth = 2;
  g.strokeRect(8, 8, 496, 160);
  g.fillStyle = '#f9a35a';
  g.beginPath();
  g.arc(30, 30, 6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(230,230,230,0.7)';
  g.font = '600 30px ui-monospace, Menlo, monospace';
  g.fillText('LPDDR5X', 64, 78);
  g.font = '500 18px ui-monospace, Menlo, monospace';
  g.fillStyle = 'rgba(230,230,230,0.42)';
  g.fillText('UNIFIED MEMORY · 8533 MT/s', 64, 112);
  return texture(el);
}
