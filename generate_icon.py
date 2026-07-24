"""
generate_icon.py — creates icon.icns for the mini-todo app.

draws a ✿ flower on a butter yellow rounded square background.

run once before building the .app bundle:
    pip install Pillow
    python3 generate_icon.py
"""

import math
import os
import shutil
import subprocess

from PIL import Image, ImageDraw


def draw_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def s(v):
        return v * size / 100

    cx, cy = size / 2, size / 2

    # ── butter yellow rounded square background ──
    pad = s(2)
    d.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=s(22),
        fill=(232, 176, 32, 255),
    )
    # subtle lighter sheen at top
    d.rounded_rectangle(
        [pad, pad, size - pad, size * 0.55],
        radius=s(22),
        fill=(252, 220, 80, 50),
    )

    # ── ✿ flower ──
    white = (255, 255, 255, 245)

    # 4 large petals at cardinal directions (0°, 90°, 180°, 270°)
    for angle in [0, 90, 180, 270]:
        rad = math.radians(angle)
        px = cx + math.cos(rad) * s(22)
        py = cy + math.sin(rad) * s(22)
        r = s(14)
        d.ellipse([px - r, py - r, px + r, py + r], fill=white)

    # 4 small dots at diagonal directions (45°, 135°, 225°, 315°)
    for angle in [45, 135, 225, 315]:
        rad = math.radians(angle)
        px = cx + math.cos(rad) * s(22)
        py = cy + math.sin(rad) * s(22)
        r = s(8)
        d.ellipse([px - r, py - r, px + r, py + r], fill=white)

    # warm cream center circle
    r = s(9)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 245, 195, 255))

    return img


# all sizes required for a valid .icns
ICON_SIZES = {
    "icon_16x16.png":      16,
    "icon_16x16@2x.png":   32,
    "icon_32x32.png":      32,
    "icon_32x32@2x.png":   64,
    "icon_128x128.png":    128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png":    256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png":    512,
    "icon_512x512@2x.png": 1024,
}


def main():
    iconset = "icon.iconset"
    os.makedirs(iconset, exist_ok=True)

    cache = {}
    for filename, px in ICON_SIZES.items():
        if px not in cache:
            cache[px] = draw_icon(px)
        cache[px].save(os.path.join(iconset, filename))
        print(f"  {filename}")

    result = subprocess.run(
        ["iconutil", "-c", "icns", iconset],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        shutil.rmtree(iconset)
        print("✓ icon.icns created")
    else:
        print("error:", result.stderr)
        print("png files saved to", iconset)


if __name__ == "__main__":
    main()
