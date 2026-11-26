"""Landing-page screenshot: the four-panel overview of the demonstration data.

Run: .venv-docs/bin/python docs/_tools/shoot_index.py [--port 8810]
"""
import argparse
import os
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import Session  # noqa: E402

VIEW = json.loads((HERE / "views" / "overview.json").read_text())

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8810)
    a = ap.parse_args()
    out = Path(os.environ.get("LANDING_OUT") or HERE.parent / "_static" / "screens" / "index")
    with Session(a.port, out) as s:
        # The view gives the panel row 1300 px (its "height"), so the plots have room; the window is taller than the
        # row, and the capture ends at the row's bottom edge, with none of the "Create New Panel" chooser under it.
        page = s.open(VIEW, viewport={"width": 1600, "height": 1500})
        s.shot(page, "overview")
        bottom = page.evaluate("document.querySelector('.tile-container > .panel-wrapper').getBoundingClientRect().bottom")
        scale = page.evaluate("window.devicePixelRatio")
    from PIL import Image
    png = out / "overview.png"
    im = Image.open(png).convert("RGB")
    im.crop((0, 0, im.width, round(bottom * scale))).save(png, optimize=True)
    if png.stat().st_size > 400_000:     # keep the landing image under ~400 KB
        Image.open(png).convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT).save(png, optimize=True)
