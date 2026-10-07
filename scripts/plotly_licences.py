#!/usr/bin/env python3
"""Write annzarro/THIRD_PARTY_LICENSES/plotly-bundled.txt.

plotly-2.20.0.min.js is a webpack bundle of plotly.js and its npm
dependencies, which are under several licences (MIT, ISC, BSD-3-Clause,
BSD-2-Clause, Zlib, Unlicense, Apache-2.0, BlueOak-1.0.0, mapbox-gl's own
BSD-3-Clause text). This collects the licence text of every package in
plotly.js 2.20.0's production dependency tree: a superset of what the bundle
contains, so nothing it contains is left out.

    mkdir /tmp/plt && cd /tmp/plt && npm init -y >/dev/null \\
        && npm install --ignore-scripts plotly.js@2.20.0
    python scripts/plotly_licences.py /tmp/plt/node_modules

The upstream banners kept in the minified file (plotly-2.20.0.min.js.LICENSE.txt)
stay at the top of the output.
"""

import collections
import json
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "annzarro" / "THIRD_PARTY_LICENSES" / "plotly-bundled.txt"
PLOTLY_VERSION = "2.20.0"
LICENCE_FILE = re.compile(r"^(licen[cs]e|copying|unlicense)", re.I)
BANNERS_MARK = "=== Banners kept in plotly-2.20.0.min.js (upstream plotly-2.20.0.min.js.LICENSE.txt) ==="
SPLIT = "=" * 78


def packages(node_modules: Path):
    """(name, version, licence id, package dir) of every installed package."""
    seen = set()
    for pkg_json in sorted(node_modules.rglob("package.json")):
        rel = pkg_json.relative_to(node_modules).parts
        # node_modules/<name>/package.json or node_modules/@scope/<name>/package.json,
        # also nested node_modules/<a>/node_modules/<b>/package.json
        if rel[-2] in ("test", "tests", "example", "examples", "dist", "src", "lib", "build"):
            continue
        parent = pkg_json.parent
        if parent.parent.name != "node_modules" and not (
                parent.parent.name.startswith("@") and parent.parent.parent.name == "node_modules"):
            continue
        try:
            meta = json.loads(pkg_json.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        name, version = meta.get("name"), meta.get("version")
        if not name or not version or (name, version) in seen:
            continue
        seen.add((name, version))
        lic = meta.get("license") or meta.get("licenses") or "UNKNOWN"
        if isinstance(lic, list):
            lic = " OR ".join(x.get("type", str(x)) if isinstance(x, dict) else str(x) for x in lic)
        elif isinstance(lic, dict):
            lic = lic.get("type", "UNKNOWN")
        author = meta.get("author")
        if isinstance(author, dict):
            author = author.get("name")
        yield name, version, lic, parent, meta.get("main") or "index.js", author


def licence_text(pkg_dir: Path, main: str):
    files = sorted(p for p in pkg_dir.iterdir() if p.is_file() and LICENCE_FILE.match(p.name))
    if files:
        return "\n\n".join(p.read_text(encoding="utf-8", errors="replace").strip() for p in files)
    # Some packages carry their licence only in the header of their source.
    src = pkg_dir / main
    if not src.suffix:
        src = src.with_suffix(".js")
    if src.is_file():
        head = src.read_text(encoding="utf-8", errors="replace")[:6000]
        m = re.match(r"\s*/\*(.*?)\*/", head, re.S)
        if m and re.search(r"copyright|licen[cs]e|permission", m.group(1), re.I):
            body = "\n".join(re.sub(r"^\s*\* ?", "", line) for line in m.group(1).splitlines())
            return f"(from the header of {src.name})\n" + body.strip()
    return None


STANDARD = {
    "MIT": """Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.""",
    "ISC": """Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.""",
}


def main(argv):
    if len(argv) != 1:
        sys.exit(__doc__)
    node_modules = Path(argv[0])
    plotly = json.loads((node_modules / "plotly.js" / "package.json").read_text())
    if plotly["version"] != PLOTLY_VERSION:
        sys.exit(f"node_modules has plotly.js {plotly['version']}, not {PLOTLY_VERSION}")

    existing = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    if BANNERS_MARK in existing:
        banners = existing.split(BANNERS_MARK, 1)[1].split(SPLIT + "\n=== Licence texts", 1)[0].strip()
    else:
        banners = existing.strip()  # the first version held only the banners

    pkgs = sorted(packages(node_modules), key=lambda p: (p[0].lower(), p[1]))
    counts = collections.Counter(p[2] for p in pkgs)
    out = [
        f"Third-party code in plotly-{PLOTLY_VERSION}.min.js",
        "",
        f"The Plotly.js bundle (plotly.js {PLOTLY_VERSION}, MIT, see plotly.txt) includes npm",
        "packages under their own licences. Below are, first, the licence banners the",
        "minified file itself keeps, then the licence text of every package in plotly.js",
        f"{PLOTLY_VERSION}'s production dependency tree ({len(pkgs)} packages, a superset of",
        "the modules the bundle contains), generated by scripts/plotly_licences.py.",
        "",
        "Licences in the tree: " + ", ".join(f"{k} ({v})" for k, v in sorted(counts.items(), key=lambda kv: -kv[1])),
        "",
        SPLIT,
        BANNERS_MARK,
        SPLIT,
        "",
        banners,
        "",
        SPLIT,
        "=== Licence texts of the packages in plotly.js's dependency tree ===",
        SPLIT,
    ]
    missing = []
    for name, version, lic, pkg_dir, main_file, author in pkgs:
        out += ["", "-" * 78, f"{name} {version}  ({lic})", "-" * 78, ""]
        text = licence_text(pkg_dir, main_file)
        if text:
            out.append(text)
        elif lic.startswith("Apache-2.0"):
            out.append(f"Licensed under the Apache License, Version 2.0 (see Apache-2.0.txt)."
                       + (f" Author: {author}." if author else ""))
        else:
            missing.append(f"{name}@{version}")
            out.append(f"The package declares the {lic} licence in its package.json and ships no"
                       f" licence text." + (f" Author: {author}." if author else ""))
            if lic in STANDARD:
                out += ["", f"The {lic} licence terms:", "", STANDARD[lic]]
    OUT.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(pkgs)} packages, {OUT.stat().st_size} bytes)")
    print("licences:", dict(counts))
    if missing:
        print(f"{len(missing)} packages declare a licence but ship no text:", ", ".join(missing))


if __name__ == "__main__":
    main(sys.argv[1:])
