"""Screenshots for docs/data/showcase-store.md: the spatial demo and one showcase-store view.

Run: .venv-docs/bin/python docs/_tools/shoot_showcase.py [--port 8813]
Needs spatial_demo.zarr and bm_aging_showcase.zarr (docs/_tools/make_spatial_demo.py,
docs/_tools/make_showcase_store.py).
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import Session  # noqa: E402
from PIL import Image  # noqa: E402

OUT = HERE.parent / "_static" / "screens" / "data"


def shrink(name, limit=400_000):
    """Re-save with optimize=True; quantize to 256 colours if still above the limit."""
    p = OUT / f"{name}.png"
    im = Image.open(p)
    im.save(p, optimize=True)
    if p.stat().st_size > limit:
        im.convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT).save(p, optimize=True)

def view(name):
    return json.loads((HERE / "views" / f"{name}.json").read_text())


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8813)
    a = ap.parse_args()
    with Session(a.port, OUT) as s:
        page = s.open(view("showcase-spatial"), dataset="spatial_demo.zarr",
                      viewport={"width": 1500, "height": 560})
        s.shot(page, "spatial-demo")
        page = s.open(view("showcase-spatial-kernel-umap"), dataset="spatial_demo.zarr",
                      viewport={"width": 1100, "height": 560})
        s.shot(page, "spatial-kernel-umap")
        page = s.open(view("showcase-fig3-plasma"), dataset="bm_aging_showcase.zarr",
                      viewport={"width": 1200, "height": 600})
        s.shot(page, "showcase-fig3-plasma")
    for n in ("spatial-demo", "spatial-kernel-umap", "showcase-fig3-plasma"):
        shrink(n)
