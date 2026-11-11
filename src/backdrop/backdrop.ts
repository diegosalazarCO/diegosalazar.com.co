import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LinearFilter,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  VideoTexture,
  WebGLRenderer,
} from 'three';

/**
 * Site backdrop: one source image (the hero film, or a still of it) drawn two ways and cross-faded.
 *
 *  - "film":  the frame as a relief, each vertex pushed toward the viewer by its own luminance,
 *             so the picture has parallax under the pointer.
 *  - "field": the same frame resampled as a sparse grid of points that keep the film's colours,
 *             dim enough to sit behind text.
 *
 * `progress` moves between them: 0 = film (top of the homepage), 1 = field (everywhere else).
 */

const ASPECT = 16 / 9;
const FOV = 32;
const DISTANCE = 4;

const sampleLuma = /* glsl */ `
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  // Luminance averaged over a wide neighbourhood: a soft height map, so hard edges in the
  // picture bend instead of tearing when they are pushed in depth.
  float softLuma(sampler2D map, vec2 uv) {
    vec2 o = vec2(0.012, 0.021);
    float l = luma(texture2D(map, uv).rgb) * 0.28;
    l += luma(texture2D(map, uv + vec2(o.x, 0.0)).rgb) * 0.18;
    l += luma(texture2D(map, uv - vec2(o.x, 0.0)).rgb) * 0.18;
    l += luma(texture2D(map, uv + vec2(0.0, o.y)).rgb) * 0.18;
    l += luma(texture2D(map, uv - vec2(0.0, o.y)).rgb) * 0.18;
    return l;
  }
`;

const filmVertex = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uDepth;
  varying vec2 vUv;
  ${sampleLuma}
  void main() {
    vUv = uv;
    vec3 p = position;
    p.z += softLuma(uMap, uv) * uDepth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const filmFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uDim;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(uMap, vUv).rgb;
    // darken toward the bottom-left, where the hero copy sits
    float shade = mix(0.55, 1.0, smoothstep(0.0, 0.75, vUv.x + vUv.y * 0.6));
    gl_FragColor = vec4(c * uDim * shade, uOpacity);
  }
`;

const fieldVertex = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uDepth;
  uniform float uTime;
  uniform float uSize;
  uniform float uSpread;
  attribute vec2 aUv;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vLuma;
  ${sampleLuma}
  void main() {
    vec3 c = texture2D(uMap, aUv).rgb;
    float l = luma(c);
    vColor = c;
    vLuma = l;
    vec3 p = position;
    float drift = sin(uTime * 0.25 + aSeed * 6.2831);
    p.z += softLuma(uMap, aUv) * uDepth + (aSeed - 0.5) * uSpread + drift * 0.03 * uSpread;
    p.y += drift * 0.004 * uSpread;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.3 + l * 0.9) / -mv.z;
  }
`;

const fieldFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vLuma;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.32, length(d));
    gl_FragColor = vec4(vColor, a * uOpacity * (0.35 + vLuma));
  }
`;

export interface BackdropOptions {
  canvas: HTMLCanvasElement;
  /** A playing <video> (homepage) or an image URL (every other page). */
  source: HTMLVideoElement | string;
  /** Element whose scroll-through drives film -> field. Without it the backdrop stays a field. */
  hero?: HTMLElement | null;
}

export async function mountBackdrop({ canvas, source, hero }: BackdropOptions): Promise<() => void> {
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);

  const texture: Texture =
    typeof source === 'string' ? await new TextureLoader().loadAsync(source) : new VideoTexture(source);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;

  const compact = window.matchMedia('(max-width: 720px)').matches;
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 20);
  camera.position.z = DISTANCE;
  const rig = new Group();
  scene.add(rig);

  const film = new Mesh(
    new PlaneGeometry(ASPECT, 1, compact ? 96 : 192, compact ? 54 : 108),
    new ShaderMaterial({
      uniforms: { uMap: { value: texture }, uDepth: { value: 0.05 }, uOpacity: { value: 1 }, uDim: { value: 0.62 } },
      vertexShader: filmVertex,
      fragmentShader: filmFragment,
      transparent: true,
      depthTest: false,
    }),
  );
  rig.add(film);

  const cols = compact ? 120 : 230;
  const rows = Math.round(cols / ASPECT);
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const seeds = new Float32Array(cols * rows);
  for (let y = 0, i = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++, i++) {
      const u = (x + 0.5) / cols;
      const v = (y + 0.5) / rows;
      positions.set([(u - 0.5) * ASPECT, v - 0.5, 0], i * 3);
      uvs.set([u, v], i * 2);
      seeds[i] = Math.random();
    }
  }
  const fieldGeometry = new BufferGeometry();
  fieldGeometry.setAttribute('position', new BufferAttribute(positions, 3));
  fieldGeometry.setAttribute('aUv', new BufferAttribute(uvs, 2));
  fieldGeometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
  const field = new Points(
    fieldGeometry,
    new ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uDepth: { value: 0.09 },
        uTime: { value: 0 },
        uSize: { value: 1 },
        uSpread: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: fieldVertex,
      fragmentShader: fieldFragment,
      transparent: true,
      depthTest: false,
    }),
  );
  field.frustumCulled = false;
  rig.add(field);

  // Scale the 16:9 subject so it always covers the viewport, with a little overscan for the tilt.
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, compact ? 1.5 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visibleH = 2 * DISTANCE * Math.tan((FOV * Math.PI) / 360);
    const visibleW = visibleH * camera.aspect;
    const scale = Math.max(visibleH, visibleW / ASPECT) * 1.05;
    rig.scale.setScalar(scale);
    // Narrow screens crop hard: keep the left of the frame (the photographer) in view.
    rig.position.x = camera.aspect < 0.8 ? (scale * ASPECT - visibleW) * 0.42 : 0;
    field.material.uniforms.uSize.value = ((h * dpr * scale) / (rows * 1.15)) * (compact ? 0.6 : 1);
  }
  resize();
  window.addEventListener('resize', resize);

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointer = (e: PointerEvent) => {
    pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  const target = () => {
    if (!hero) return 1;
    const span = hero.offsetHeight * 0.85;
    return Math.min(1, Math.max(0, window.scrollY / span));
  };
  let progress = target();
  const ease = (t: number) => t * t * (3 - 2 * t);

  let frame = 0;
  let running = true;
  const start = performance.now();
  function tick() {
    if (!running) return;
    frame = requestAnimationFrame(tick);
    progress += (target() - progress) * 0.12;
    const p = ease(progress);
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;

    rig.rotation.y = pointer.x * 0.045;
    rig.rotation.x = pointer.y * 0.03;

    film.material.uniforms.uOpacity.value = 1 - ease(Math.min(1, progress / 0.7));
    film.material.uniforms.uDepth.value = 0.05 + p * 0.2;
    const f = field.material.uniforms;
    f.uTime.value = (performance.now() - start) / 1000;
    f.uDepth.value = 0.05 + p * 0.45;
    f.uSpread.value = p * 0.5;
    // brightest mid-transition, then settles to a level text can sit on
    f.uOpacity.value = ease(Math.min(1, progress / 0.5)) * (0.5 - 0.3 * ease(Math.max(0, (progress - 0.5) / 0.5)));
    film.visible = film.material.uniforms.uOpacity.value > 0.002;
    field.visible = f.uOpacity.value > 0.002;
    renderer.render(scene, camera);
  }
  tick();

  const onVisibility = () => {
    running = !document.hidden;
    if (running) tick();
    else cancelAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    running = false;
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', onPointer);
    document.removeEventListener('visibilitychange', onVisibility);
    renderer.dispose();
  };
}
