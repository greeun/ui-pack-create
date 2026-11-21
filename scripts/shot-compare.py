#!/usr/bin/env python3
"""Compares a source image (screenshot, video frame) with a capture of the redraw screen built from pack components. Fidelity check for image and video input (from-site.md).

Usage:
  python3 shot-compare.py <source image> <redraw screen png> --out <comparison image> [--src-crop x0,y0,x1,y1] [--grid 24] [--skip-chroma]

What it does:
  1. Crops the source to the --src-crop area (the part the app screen occupies) and scales both pictures to the same size.
  2. Writes a comparison image with the source on top and the redraw screen below. Open it and look.
  3. Splits the screen into a grid and compares the middle color (median) of each cell. Text and small shapes barely affect the median, so this checks whether surface colors and layout match.
     A "matching cell" differs by 10 or less per channel. Prints the share and the position of the cells that differ most.
  --skip-chroma: an inspired pack changes the accent color on purpose, so cells that are chromatic in the source are left out of the share.
Compression and scaling blur the color of text and thin lines in video frames. The number checks surfaces and layout, not text color.
"""
import argparse, colorsys, statistics

from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("source")
ap.add_argument("redraw")
ap.add_argument("--out", required=True)
ap.add_argument("--src-crop", default=None)
ap.add_argument("--grid", type=int, default=24)
ap.add_argument("--skip-chroma", action="store_true")
a = ap.parse_args()

src = Image.open(a.source).convert("RGB")
if a.src_crop:
    x0, y0, x1, y1 = (int(v) for v in a.src_crop.split(","))
    src = src.crop((x0, y0, x1, y1))
red = Image.open(a.redraw).convert("RGB")
w = min(src.width, red.width, 1440)
src = src.resize((w, round(src.height * w / src.width)))
red = red.resize((w, round(red.height * w / red.width)))
h = min(src.height, red.height)

sheet = Image.new("RGB", (w, src.height + red.height + 12), (255, 0, 140))
sheet.paste(src, (0, 0))
sheet.paste(red, (0, src.height + 12))
sheet.save(a.out)


def median(img, box):
    raw = img.crop(box).resize((12, 12)).tobytes()
    px = [raw[i:i + 3] for i in range(0, len(raw), 3)]
    return tuple(statistics.median(p[i] for p in px) for i in range(3))


n = a.grid
same = total = skipped = 0
worst = []
for gy in range(n):
    for gx in range(n):
        box = (gx * w // n, gy * h // n, (gx + 1) * w // n, (gy + 1) * h // n)
        s, r = median(src, box), median(red, box)
        if a.skip_chroma and colorsys.rgb_to_hsv(*(v / 255 for v in s))[1] > 0.25 and max(s) > 40:
            skipped += 1
            continue
        d = max(abs(s[i] - r[i]) for i in range(3))
        total += 1
        if d <= 10:
            same += 1
        else:
            worst.append((d, gx, gy, s, r))

hx = lambda c: "#%02x%02x%02x" % tuple(int(v) for v in c)
print(f"Comparison image: {a.out}  (top: source, bottom: redraw screen, {w}px wide)")
print(f"Height: source {src.height}px, redraw screen {red.height}px")
print(f"Matching cells {same}/{total} ({same * 100 // max(total, 1)}%)" + (f", {skipped} chromatic cells left out" if skipped else ""))
for d, gx, gy, s, r in sorted(worst, reverse=True)[:10]:
    print(f"  Differing cell column {gx + 1}/{n} row {gy + 1}/{n}: source {hx(s)} → redraw screen {hx(r)} (difference {int(d)})")
