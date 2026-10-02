#!/usr/bin/env python3
"""Print a Markdown size breakdown of a desktop build (for CI job summaries).

    python annzarro/desktop/scripts/size_report.py annzarro/desktop/electron

Sizes are on disk, uncompressed, except the release files (dist/AnnZarro-*).
"""

import os
import sys
from pathlib import Path


def size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            p = os.path.join(root, f)
            if not os.path.islink(p):
                total += os.path.getsize(p)
    return total


def mb(n):
    return f"{n / 1048576:.1f}"


def main(electron_dir):
    electron = Path(electron_dir)
    server = electron / "server" / "annzarro-server"
    internal = server / "_internal"
    rows = [("frozen server, total", size(server))]
    parts = {}
    for entry in internal.iterdir():
        name = entry.name.split("-")[0].split(".")[0] if entry.is_dir() else entry.name
        if entry.name.endswith(".dist-info"):
            name = "dist-info metadata"
        elif entry.is_file() and ("python3" in entry.name.lower() or entry.name.startswith("libpython")):
            name = "Python runtime (libpython)"
        elif entry.is_file():
            name = "other shared libraries"
        parts[name] = parts.get(name, 0) + size(entry)
    exe = [p for p in server.iterdir() if p.is_file() and p.name.startswith("annzarro-server")]
    parts["launcher + pure-Python modules (PYZ)"] = sum(size(p) for p in exe)
    static = internal / "annzarro" / "static"
    if static.exists():
        parts["annzarro"] -= size(static)
        parts["frontend static/ (vendor: %s MB)" % mb(size(static / "vendor"))] = size(static)
    for name, n in sorted(parts.items(), key=lambda kv: -kv[1]):
        if n >= 256 * 1024:
            rows.append((f"  {name}", n))
    unpacked = [p for p in (electron / "dist").iterdir() if p.is_dir() and not p.name.startswith(".")]
    for d in unpacked:
        total = size(d)
        rows.append((f"app on disk ({d.name})", total))
        rows.append(("  Electron runtime", total - size(server) - sum(size(p) for p in d.rglob("app.asar"))))
        rows.append(("  app.asar (main.js, pages, icons, electron-log)", sum(size(p) for p in d.rglob("app.asar"))))
    for f in sorted((electron / "dist").glob("AnnZarro-*")):
        if f.suffix != ".blockmap":
            rows.append((f"release file {f.name}", size(f)))
    print("| Component | MB |\n|---|---:|")
    for name, n in rows:
        print(f"| {name} | {mb(n)} |")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "annzarro/desktop/electron")
