#!/usr/bin/env python3
"""Turn flat illustrations into "plates" that the /ink/ flight can extrude.

For every entry in src/ink/catalog.json this writes, into src/assets/ink/:

  <id>.webp          the illustration, resized for the GPU (colour texture and gallery image)
  <id>.relief.webp   lossless RGB: R,G = surface normal x,y   B = height  (512 px on the long side)

plus one shared atlas.webp of thumbnails (what a plate shows while it is far away) and
src/ink/plates.gen.json, the manifest the page and the engine read. There is no mesh file: the
browser triangulates each plate from the relief's height channel (src/ink/engine/rtin.ts).

Height comes from Depth Anything V2 Small (Apache-2.0), run once here on the CPU with ONNX Runtime;
nothing neural ships to the browser. Usage:

  pip install numpy pillow onnxruntime
  python3 tools/plates/build_plates.py --art ../art            # all plates
  python3 tools/plates/build_plates.py --art ../art --only portrait --preview /tmp/preview

The model (99 MB) is fetched from Hugging Face on first use into --model.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

SITE = Path(__file__).resolve().parents[2]
CATALOG = SITE / 'src/ink/catalog.json'
MANIFEST = SITE / 'src/ink/plates.gen.json'
OUT = SITE / 'src/assets/ink'
MODEL_URL = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx'

COLOUR_LONG = 1536    # px, long side of the colour texture
RELIEF_LONG = 512     # px, long side of the relief texture
THUMB_H = 256         # px, atlas cell height
THUMB_PAD = 4         # px of edge-extended gutter so mips never bleed between cells
PLATE_H = 2.0         # world units the normals are baked for; width follows the aspect ratio
RELIEF_SLOPE = 0.012  # steepest slope the relief keeps, in height per depth-map pixel at 518 px


# ---------------------------------------------------------------------------- small numerics

def gaussian(a: np.ndarray, sigma: float) -> np.ndarray:
    """Separable Gaussian blur with reflected edges (numpy only, so there is no scipy to install)."""
    if sigma <= 0:
        return a
    radius = max(1, int(math.ceil(sigma * 3)))
    xs = np.arange(-radius, radius + 1)
    kernel = np.exp(-(xs * xs) / (2 * sigma * sigma))
    kernel /= kernel.sum()
    out = a.astype(np.float64)
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (radius, radius)
        padded = np.pad(out, pad, mode='reflect' if out.shape[axis] > radius else 'edge')
        acc = np.zeros_like(out)
        n = out.shape[axis]
        for k, w in enumerate(kernel):
            acc += w * (padded[k:k + n, :] if axis == 0 else padded[:, k:k + n])
        out = acc
    return out


def smoothstep(lo: float, hi: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def resize(a: np.ndarray, w: int, h: int, how=Image.BICUBIC) -> np.ndarray:
    return np.asarray(Image.fromarray(a.astype(np.float32), 'F').resize((w, h), how), dtype=np.float64)


def otsu(values: np.ndarray) -> float:
    hist, edges = np.histogram(values, bins=128, range=(0.0, 1.0))
    p = hist / max(hist.sum(), 1)
    w0 = np.cumsum(p)
    mu = np.cumsum(p * (edges[:-1] + edges[1:]) * 0.5)
    between = (mu[-1] * w0 - mu) ** 2 / np.maximum(w0 * (1 - w0), 1e-9)
    return float(edges[int(np.argmax(between)) + 1])


def poisson(divergence: np.ndarray) -> np.ndarray:
    """Solve laplace(h) = divergence with zero flux through the border. Mirroring the field makes it
    periodic, so the 5-point Laplacian is diagonal in Fourier space and the solve is two FFTs."""
    h, w = divergence.shape
    mirrored = np.block([[divergence, divergence[:, ::-1]], [divergence[::-1, :], divergence[::-1, ::-1]]])
    fy = np.fft.fftfreq(2 * h)[:, None]
    fx = np.fft.rfftfreq(2 * w)[None, :]
    eigen = 2 * np.cos(2 * np.pi * fy) + 2 * np.cos(2 * np.pi * fx) - 4
    eigen[0, 0] = 1.0
    spectrum = np.fft.rfft2(mirrored) / eigen
    spectrum[0, 0] = 0.0
    return np.fft.irfft2(spectrum, s=mirrored.shape)[:h, :w]


def bas_relief(height: np.ndarray, limit: float) -> np.ndarray:
    """Gradient-domain depth compression (Weyrich et al., "Digital Bas-Relief from 3D Scenes", 2007).

    A depth map has cliffs wherever one thing stands in front of another, and a displaced sheet
    turns each cliff into a wall of stretched texture. A sculptor's relief has no walls: forms swell
    out of the ground and overlap by a hair. So work on slopes instead of heights. Gentle slopes
    (the shape of a body) pass through; steep ones (silhouettes) are squashed to `limit`; then the
    surface whose slopes best match is rebuilt with one Poisson solve.
    """
    gx = np.zeros_like(height)
    gy = np.zeros_like(height)
    gx[:, :-1] = height[:, 1:] - height[:, :-1]
    gy[:-1, :] = height[1:, :] - height[:-1, :]
    steepness = np.hypot(gx, gy) / limit
    gain = np.tanh(steepness) / np.maximum(steepness, 1e-9)
    gx *= gain
    gy *= gain
    divergence = gx + gy
    divergence[:, 1:] -= gx[:, :-1]
    divergence[1:, :] -= gy[:-1, :]
    relief = poisson(divergence)
    return relief - relief.min()


# ---------------------------------------------------------------------------- depth

class Depth:
    def __init__(self, model: Path):
        import onnxruntime as ort
        if not model.exists():
            print(f'fetching Depth Anything V2 Small -> {model}')
            model.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve(MODEL_URL, model)
        self.session = ort.InferenceSession(str(model), providers=['CPUExecutionProvider'])
        self.input = self.session.get_inputs()[0].name

    def __call__(self, im: Image.Image, short: int) -> np.ndarray:
        """Relative inverse depth, robustly normalised to 0 (far) .. 1 (near)."""
        w, h = im.size
        s = short / min(w, h)
        tw, th = max(14, round(w * s / 14) * 14), max(14, round(h * s / 14) * 14)
        x = np.asarray(im.resize((tw, th), Image.BICUBIC), dtype=np.float32) / 255.0
        x = (x - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
        d = self.session.run(None, {self.input: x.transpose(2, 0, 1)[None]})[0][0].astype(np.float64)
        lo, hi = np.percentile(d, [0.5, 99.5])
        return np.clip((d - lo) / max(hi - lo, 1e-6), 0.0, 1.0)


# ---------------------------------------------------------------------------- height field

def paper_of(rgb: np.ndarray) -> tuple[np.ndarray, float, np.ndarray, np.ndarray]:
    """The page colour (median of the outer ring), how much of the ring is that colour, the
    per-pixel distance from it, and the ring itself."""
    h, w, _ = rgb.shape
    m = max(2, int(min(h, w) * 0.035))
    ring = np.zeros((h, w), dtype=bool)
    ring[:m] = ring[-m:] = True
    ring[:, :m] = ring[:, -m:] = True
    paper = np.median(rgb[ring], axis=0)
    dist = np.linalg.norm(rgb - paper, axis=2)
    return paper, float((dist[ring] < 0.13).mean()), dist, ring


def paper_floor(height: np.ndarray, paper: np.ndarray, sigma: float) -> np.ndarray:
    """The surface the blank paper lies on, fitted from paper pixels alone (normalised convolution)."""
    weight = gaussian(paper.astype(np.float64), sigma)
    return (gaussian(height * paper, sigma) + 1e-3 * np.median(height[paper])) / (weight + 1e-3)


def height_field(im: Image.Image, depth: np.ndarray, kind: str | None) -> tuple[np.ndarray, str]:
    """Depth -> the height the plate is embossed to, 0 (the page itself) .. 1.

    sheet: figures drawn on blank paper. The paper is detected and pressed flat, so only the
           figures rise out of the page.
    panel: a full-bleed picture. The whole image is relief.
    Either way the depth is compressed into a bas-relief, and eased to zero at the rim so the sheet
    has a flat edge to sit on.
    """
    dh, dw = depth.shape
    short = min(dh, dw)
    rgb = np.asarray(im.resize((dw, dh), Image.BILINEAR), dtype=np.float64) / 255.0
    paper, ring_fraction, dist, ring = paper_of(rgb)
    luminance = float(paper @ np.array([0.299, 0.587, 0.114]))
    if kind is None:
        kind = 'sheet' if ring_fraction > 0.8 and luminance > 0.7 else 'panel'

    background = None
    if kind == 'sheet':
        paperish = gaussian(dist, 1.2) < 0.11
        if (ring & paperish).mean() < 0.01:  # nothing usable: treat as a panel
            return height_field(im, depth, 'panel')
        # The model gives blank paper a soft, uneven depth. Fit that surface and subtract it, so the
        # page ends up exactly flat. Two passes: the first trusts only paper that is as far away as
        # the page edge; the second re-admits every paper pixel that turned out to sit on the fitted
        # floor, which keeps white fur (paper-coloured, but raised) out of the fit.
        background = paperish & (depth < np.median(depth[ring & paperish]) + 0.10)
        raised = depth
        for spread in (0.14, 0.08):
            raised = np.clip(depth - paper_floor(depth, background, spread * short), 0.0, None)
            background = paperish & (raised < 0.06)
        height = np.clip(raised / max(float(np.percentile(raised[~background], 99.5)), 1e-6), 0.0, 1.0)
        height *= smoothstep(0.04, 0.16, gaussian(height, 1.0))
    else:
        lo, hi = np.percentile(depth, [1.0, 99.0])
        height = np.clip((depth - lo) / max(hi - lo, 1e-6), 0.0, 1.0)

    # Slopes are per pixel of the depth map, so the limit scales with its resolution.
    height = bas_relief(height, RELIEF_SLOPE * 518.0 / short)
    if background is not None and background.any():
        # The solve is free to tilt the page a little; lay it flat again.
        height = np.clip(height - paper_floor(height, background, 0.08 * short), 0.0, None)
    height = np.clip(height / max(float(np.percentile(height, 99.7)), 1e-6), 0.0, 1.0)
    if background is not None:
        height *= smoothstep(0.0, 0.05, height)

    ys, xs = np.mgrid[0:dh, 0:dw]
    edge = np.minimum(np.minimum(xs, dw - 1 - xs), np.minimum(ys, dh - 1 - ys)).astype(np.float64)
    height *= smoothstep(0.0, 0.05 * short, edge)
    return gaussian(height, 0.7), kind


def relief_texture(height: np.ndarray, aspect: float, depth_scale: float) -> Image.Image:
    """R,G = unit normal x,y in the plate's frame (x right, y up, z towards the viewer), B = height."""
    h, w = height.shape
    world_w, world_h = PLATE_H * aspect, PLATE_H
    smooth = gaussian(height, 1.0)
    dzdx = np.gradient(smooth, axis=1) * (w / world_w) * depth_scale
    dzdy = -np.gradient(smooth, axis=0) * (h / world_h) * depth_scale  # image rows run downwards
    inv = 1.0 / np.sqrt(dzdx * dzdx + dzdy * dzdy + 1.0)
    rgb = np.stack([-dzdx * inv * 0.5 + 0.5, -dzdy * inv * 0.5 + 0.5, height], axis=2)
    return Image.fromarray(np.clip(np.rint(rgb * 255.0), 0, 255).astype(np.uint8), 'RGB')


# ---------------------------------------------------------------------------- build

def build(args: argparse.Namespace) -> None:
    catalog = json.loads(CATALOG.read_text())['plates']
    art = Path(args.art).resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    previous = {p['id']: p for p in json.loads(MANIFEST.read_text())['plates']} if MANIFEST.exists() else {}
    only = set(args.only.split(',')) if args.only else None

    depth_model = Depth(Path(args.model))
    plates, thumbs = [], []

    for entry in catalog:
        pid = entry['id']
        source = art / entry['src']
        if not source.exists():
            # A catalog entry may be written before its drawing lands in the art repo.
            print(f'!! {pid}: {source} does not exist yet, plate skipped')
            continue
        im = Image.open(source).convert('RGB')
        aspect = im.width / im.height
        thumb_w = max(8, round(THUMB_H * aspect))
        thumbs.append((pid, im.resize((thumb_w, THUMB_H), Image.LANCZOS)))

        if only is not None and pid not in only:
            if pid not in previous:
                sys.exit(f'{pid}: not built yet, run without --only first')
            plates.append({**previous[pid], **{k: entry[k] for k in ('title', 'note', 'act')}})
            continue

        depth = depth_model(im, args.res)
        height, kind = height_field(im, depth, entry.get('kind'))
        depth_scale = float(entry.get('depth', 0.42 if kind == 'panel' else 0.36))

        # colour
        scale = min(1.0, COLOUR_LONG / max(im.size))
        cw, ch = round(im.width * scale), round(im.height * scale)
        colour = im if scale == 1.0 else im.resize((cw, ch), Image.LANCZOS)
        colour.save(OUT / f'{pid}.webp', 'WEBP', quality=84, method=6)

        # relief (normal + height)
        rs = RELIEF_LONG / max(im.size)
        rw, rh = max(2, round(im.width * rs)), max(2, round(im.height * rs))
        relief = relief_texture(np.clip(resize(height, rw, rh), 0.0, 1.0), aspect, depth_scale)
        relief.save(OUT / f'{pid}.relief.webp', 'WEBP', lossless=True, quality=100, method=6)

        plates.append({
            'id': pid,
            'title': entry['title'],
            'note': entry['note'],
            'act': entry['act'],
            'kind': kind,
            'width': cw,
            'height': ch,
            'depth': depth_scale,
        })
        print(f'{pid:18s} {kind:5s} {cw}x{ch}  relief {rw}x{rh}  depth {depth_scale}')

        if args.preview:
            preview(Path(args.preview), pid, colour, height)

    # thumbnail atlas: one texture for every far-away plate
    cell_h = THUMB_H + 2 * THUMB_PAD
    row_w = 2048
    x = y = 0
    places = {}
    for pid, thumb in thumbs:
        cell_w = thumb.width + 2 * THUMB_PAD
        if x + cell_w > row_w:
            x, y = 0, y + cell_h
        places[pid] = (x, y)
        x += cell_w
    atlas_w = max(px + t.width + 2 * THUMB_PAD for (pid, t), (px, _) in zip(thumbs, places.values()))
    atlas_h = y + cell_h
    atlas = Image.new('RGB', (atlas_w, atlas_h))
    for pid, thumb in thumbs:
        px, py = places[pid]
        padded = np.pad(np.asarray(thumb), ((THUMB_PAD, THUMB_PAD), (THUMB_PAD, THUMB_PAD), (0, 0)), mode='edge')
        atlas.paste(Image.fromarray(padded), (px, py))
    atlas.save(OUT / 'atlas.webp', 'WEBP', quality=80, method=6)
    for plate, (pid, thumb) in zip(plates, thumbs):
        px, py = places[pid]
        plate['atlas'] = [
            round((px + THUMB_PAD) / atlas_w, 6), round((py + THUMB_PAD) / atlas_h, 6),
            round((px + THUMB_PAD + thumb.width) / atlas_w, 6), round((py + THUMB_PAD + THUMB_H) / atlas_h, 6),
        ]

    wanted = {f'{p["id"]}{ext}' for p in plates for ext in ('.webp', '.relief.webp')} | {'atlas.webp'}
    for stale in OUT.iterdir():
        if stale.name not in wanted:
            stale.unlink()
            print(f'removed stale {stale.name}')

    MANIFEST.write_text(json.dumps({
        'generatedBy': 'tools/plates/build_plates.py',
        'plateHeight': PLATE_H,
        'atlas': {'width': atlas_w, 'height': atlas_h},
        'plates': plates,
    }, indent=2) + '\n')
    print(f'{len(plates)} plates, atlas {atlas_w}x{atlas_h}')


def preview(folder: Path, pid: str, colour: Image.Image, height: np.ndarray) -> None:
    """Colour | height, side by side, for eyeballing a plate without a browser."""
    folder.mkdir(parents=True, exist_ok=True)
    w, h = 384, round(384 * colour.height / colour.width)
    sheet = Image.new('RGB', (w * 2, h), 'white')
    sheet.paste(colour.resize((w, h)), (0, 0))
    sheet.paste(Image.fromarray((np.clip(resize(height, w, h), 0, 1) * 255).astype(np.uint8)).convert('RGB'), (w, 0))
    sheet.save(folder / f'{pid}.jpg', quality=85)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--art', default=str(SITE.parent / 'art'), help='path to the art repo checkout')
    parser.add_argument('--model', default=str(Path.home() / '.cache/depth-anything-v2-small/model.onnx'))
    parser.add_argument('--res', type=int, default=518, help='short side fed to the depth model (multiple of 14)')
    parser.add_argument('--only', help='comma-separated plate ids to rebuild; the rest are kept as they are')
    parser.add_argument('--preview', help='folder for colour|height preview sheets')
    build(parser.parse_args())
