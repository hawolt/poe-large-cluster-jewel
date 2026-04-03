#!/usr/bin/env python3
"""
build_atlas.py
==============
1. Reads large_cluster_types.json, medium_cluster_types.json, small_cluster_types.json
   from frontend/public/data/
2. Collects every unique "icon" path (e.g. "Art/2DArt/…/Foo.png")
3. Downloads each as a .dds file from https://image.ggpk.exposed/poe1/<icon>.dds
4. Decodes DDS → RGBA via imageio + imageio-freeimage (or wand fallback)
5. Packs all sprites into a power-of-two WebP atlas using a simple shelf packer
6. Writes frontend/public/atlas.webp
7. Rewrites the three JSON files:
   - removes "icon" from each notable entry
   - replaces the top-level cluster "icon" with "atlas": {"x","y","w","h"}
"""

import json
import math
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Dependencies: pillow, imageio, imageio-freeimage  (installed in CI)
# DDS reading strategy: try imageio[freeimage], fallback to wand (ImageMagick)
# ---------------------------------------------------------------------------
from PIL import Image

IMAGE_BASE   = "https://image.ggpk.exposed/poe1/"
DATA_DIR     = Path("frontend/public/data")
OUT_ATLAS    = Path("frontend/public/atlas.webp")
JSON_FILES   = ["large_cluster_types.json", "medium_cluster_types.json", "small_cluster_types.json"]
SPRITE_SIZE  = 64   # all icons are rendered at 64×64 in the atlas
ATLAS_PADDING = 1   # 1px padding between sprites to avoid bleeding
WEBP_QUALITY = 90


# ---------------------------------------------------------------------------
# DDS loader — tries imageio+freeimage first, then wand, then errors out
# ---------------------------------------------------------------------------
def load_dds(data: bytes, icon_path: str) -> Image.Image:
    # ---- strategy 1: imageio with freeimage plugin ----
    try:
        import imageio
        import io
        img_array = imageio.v3.imread(io.BytesIO(data), extension=".dds")
        img = Image.fromarray(img_array)
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        return img
    except Exception:
        pass

    # ---- strategy 2: wand (ImageMagick Python binding) ----
    try:
        from wand.image import Image as WandImage
        with WandImage(blob=data, format="dds") as wand_img:
            wand_img.format = "png"
            png_bytes = wand_img.make_blob()
        import io
        img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        return img
    except Exception:
        pass

    raise RuntimeError(f"Could not decode DDS for {icon_path}. "
                       "Install imageio-freeimage or python-wand.")


# ---------------------------------------------------------------------------
# Download with simple retry
# ---------------------------------------------------------------------------
def download(url: str, retries: int = 3, delay: float = 2.0) -> Optional[bytes]:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "cluster-jewel-atlas-builder/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read()
        except Exception as e:
            if attempt < retries - 1:
                print(f"  retry {attempt + 1} for {url}: {e}", flush=True)
                time.sleep(delay)
            else:
                print(f"  FAILED {url}: {e}", flush=True)
                return None


# ---------------------------------------------------------------------------
# Simple shelf (strip) packer — fills rows left-to-right, opens new row when full
# Returns list of (x, y) for each sprite in the same order as `sprites`
# and (atlas_w, atlas_h) as power-of-two dimensions.
# ---------------------------------------------------------------------------
def pack_shelf(count: int, cell: int, padding: int):
    step   = cell + padding
    # Aim for a roughly square atlas
    cols   = math.ceil(math.sqrt(count))
    rows   = math.ceil(count / cols)

    raw_w  = cols * step + padding
    raw_h  = rows * step + padding

    # Round up to next power of two
    def next_pow2(n):
        p = 1
        while p < n:
            p <<= 1
        return p

    atlas_w = next_pow2(raw_w)
    atlas_h = next_pow2(raw_h)

    positions = []
    for i in range(count):
        col = i % cols
        row = i // cols
        x   = padding + col * step
        y   = padding + row * step
        positions.append((x, y))

    return positions, atlas_w, atlas_h


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    # 1. Load all JSON files
    print("Loading JSON files…", flush=True)
    datasets = {}
    for fname in JSON_FILES:
        path = DATA_DIR / fname
        with open(path, "r", encoding="utf-8") as f:
            datasets[fname] = json.load(f)

    # 2. Collect unique icon paths
    icon_paths: list[str] = []
    seen: set[str] = set()
    for data in datasets.values():
        for cluster_key, cluster in data.items():
            icon = cluster.get("icon")
            if icon and icon not in seen:
                seen.add(icon)
                icon_paths.append(icon)

    print(f"Found {len(icon_paths)} unique icons.", flush=True)

    # 3. Download + decode every icon
    sprites: dict[str, Image.Image] = {}
    for i, icon in enumerate(icon_paths):
        # The CDN serves .dds regardless of the .png extension in the JSON
        dds_url = IMAGE_BASE + icon.replace("\\", "/").removesuffix(".png") + ".dds"
        print(f"[{i+1}/{len(icon_paths)}] {dds_url}", flush=True)
        raw = download(dds_url)
        if raw is None:
            # Use a transparent placeholder so the atlas remains consistent
            img = Image.new("RGBA", (SPRITE_SIZE, SPRITE_SIZE), (0, 0, 0, 0))
        else:
            try:
                img = load_dds(raw, icon)
            except Exception as e:
                print(f"  decode error: {e} — using placeholder", flush=True)
                img = Image.new("RGBA", (SPRITE_SIZE, SPRITE_SIZE), (0, 0, 0, 0))

        img = img.resize((SPRITE_SIZE, SPRITE_SIZE), Image.LANCZOS)
        sprites[icon] = img

    # 4. Pack into atlas
    print("Packing atlas…", flush=True)
    positions, atlas_w, atlas_h = pack_shelf(len(icon_paths), SPRITE_SIZE, ATLAS_PADDING)
    atlas = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))

    icon_coords: dict[str, dict] = {}
    for idx, icon in enumerate(icon_paths):
        x, y = positions[idx]
        atlas.paste(sprites[icon], (x, y))
        icon_coords[icon] = {"x": x, "y": y, "w": SPRITE_SIZE, "h": SPRITE_SIZE}

    OUT_ATLAS.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(str(OUT_ATLAS), "WEBP", quality=WEBP_QUALITY, method=6)
    print(f"Atlas saved → {OUT_ATLAS}  ({atlas_w}×{atlas_h})", flush=True)

    # 5. Rewrite JSON files — replace top-level "icon" with "atlas" coords
    #    Notable entries don't carry their own icon (it's inherited from the cluster),
    #    so only the per-cluster-type "icon" field needs updating.
    print("Rewriting JSON files…", flush=True)
    for fname, data in datasets.items():
        for cluster_key, cluster in data.items():
            icon = cluster.pop("icon", None)
            if icon and icon in icon_coords:
                cluster["atlas"] = icon_coords[icon]
            elif icon:
                # icon was present but download failed — keep coords as null
                cluster["atlas"] = None

        out_path = DATA_DIR / fname
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"  wrote {out_path}", flush=True)

    print("Done.", flush=True)


if __name__ == "__main__":
    main()
