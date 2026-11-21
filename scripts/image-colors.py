#!/usr/bin/env python3
"""Measures colors in the given regions of an image (screenshot, video frame). Used when making a pack from images or video (from-site.md).

Usage: python3 image-colors.py <image> <regions JSON file>
Regions JSON: {"name": [x0, y0, x1, y1], ...}   (px coordinates in the image)

Prints four values per region.
  median     surface color (the color that fills most of the region)
  dark       color of text or lines (on a light theme)
  light      color of text or lines (on a dark theme)
  saturated  accent color (the most saturated color)
Compression blurs the color of small text and thin lines in video frames. Measure on a zoomed-in frame and record the value as estimated.
"""
import colorsys, json, statistics, sys

from PIL import Image

img = Image.open(sys.argv[1]).convert("RGB")
with open(sys.argv[2], encoding="utf-8") as f:
    regions = json.load(f)

hx = lambda c: "#%02x%02x%02x" % tuple(int(v) for v in c)
print(f"Image {img.width}x{img.height}")
for name, (x0, y0, x1, y1) in regions.items():
    raw = img.crop((x0, y0, x1, y1)).tobytes()
    px = [tuple(raw[i:i + 3]) for i in range(0, len(raw), 3)]
    med = tuple(statistics.median(p[i] for p in px) for i in range(3))
    dark = min(px, key=sum)
    light = max(px, key=sum)
    sat = max(px, key=lambda p: colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)[1] * (0.3 + max(p) / 255))
    print(f"{name:24s} median {hx(med)}  dark {hx(dark)}  light {hx(light)}  saturated {hx(sat)}")
