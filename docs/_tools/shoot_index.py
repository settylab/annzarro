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
        page = s.open(VIEW)
        s.shot(page, "overview")
