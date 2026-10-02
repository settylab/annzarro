"""Landing-page screenshot: the four-panel overview of the demonstration data.

Run: .venv-docs/bin/python docs/_tools/shoot_index.py [--port 8810]
"""
import argparse
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
    with Session(a.port, HERE.parent / "_static" / "screens" / "index") as s:
        # Taller than the default so the HSC table shows rows below its SearchBuilder.
        page = s.open(VIEW, viewport={"width": 1600, "height": 1250})
        s.shot(page, "overview")
    from PIL import Image
    png = HERE.parent / "_static" / "screens" / "index" / "overview.png"
    if png.stat().st_size > 400_000:     # keep the landing image under ~400 KB
        Image.open(png).convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT).save(png, optimize=True)
