#!/usr/bin/env python3
"""Write annzarro/THIRD_PARTY_LICENSES/plotly-bundled.txt.

plotly-2.35.3-annzarro.min.js is a webpack bundle of plotly.js and its npm
dependencies, which are under several licences (MIT, ISC, BSD-3-Clause,
BSD-2-Clause, Zlib, Unlicense, Apache-2.0, ...). This collects the licence text
of every package inside the bundle: the names in scripts/plotly/bundle-packages.txt
(written by scripts/build-plotly-bundle.sh: webpack's modules plus the prebuilt
stackgl set behind scatter3d), looked up in the installed trees given as
arguments. Each tree must be a node_modules directory holding those packages:

    scripts/build-plotly-bundle.sh /tmp/plt-build         # builds, lists the packages
    mkdir /tmp/plt-sg && cd /tmp/plt-sg && npm init -y >/dev/null \\
        && npm install --ignore-scripts --legacy-peer-deps <stackgl_modules/package.json dependencies>
    python scripts/plotly_licences.py /tmp/plt-build/plotly.js/node_modules /tmp/plt-sg/node_modules

The licence banners the minified file keeps (its .LICENSE.txt) are read from
/tmp/plt-build/plotly.js/dist/plotly-annzarro.min.js.LICENSE.txt when that file
exists beside the first tree, else from the current plotly-bundled.txt.
Packages named in the list but found in no tree are reported and fail the run.
"""

import collections
import json
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "annzarro" / "THIRD_PARTY_LICENSES" / "plotly-bundled.txt"
PLOTLY_VERSION = "2.35.3"
BUNDLE = f"plotly-{PLOTLY_VERSION}-annzarro.min.js"
PACKAGE_LIST = REPO / "scripts" / "plotly" / "bundle-packages.txt"
LICENCE_FILE = re.compile(r"^(licen[cs]e|copying|unlicense)", re.I)
BANNERS_MARK = f"=== Banners kept in {BUNDLE} (upstream plotly-annzarro.min.js.LICENSE.txt) ==="
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
    if not argv:
        sys.exit(__doc__)
    trees = [Path(a) for a in argv]
    plotly = json.loads((trees[0] / "plotly.js" / "package.json").read_text()) \
        if (trees[0] / "plotly.js" / "package.json").exists() else None
    if plotly and plotly["version"] != PLOTLY_VERSION:
        sys.exit(f"node_modules has plotly.js {plotly['version']}, not {PLOTLY_VERSION}")
    wanted = {l.strip() for l in PACKAGE_LIST.read_text().splitlines() if l.strip()}

    existing = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    upstream = trees[0].parent / "dist" / "plotly-annzarro.min.js.LICENSE.txt"
    if upstream.exists():
        banners = upstream.read_text(encoding="utf-8").strip()
    elif BANNERS_MARK in existing:
        banners = existing.split(BANNERS_MARK, 1)[1].split(SPLIT + "\n=== Licence texts", 1)[0].strip()
    else:
        banners = existing.strip()
    banners = banners.strip("=\n ")

    found, seen_keys = {}, set()
    for tree in trees:
        for pkg in packages(tree):
            # aliases (node_modules/regl holds @plotly/regl) match by folder name too
            parent = pkg[3].parent
            folder = pkg[3].name if parent.name == "node_modules" else f"{parent.name}/{pkg[3].name}"
            for key in (pkg[0], folder):
                if key in wanted:
                    seen_keys.add(key)
                    found.setdefault((pkg[0], pkg[1]), pkg)
    absent = sorted(wanted - seen_keys)
    if absent:
        sys.exit("not installed in any tree: " + ", ".join(absent))
    pkgs = sorted(found.values(), key=lambda p: (p[0].lower(), p[1]))
    counts = collections.Counter(p[2] for p in pkgs)
    out = [
        f"Third-party code in {BUNDLE}",
        "",
        f"The Plotly.js bundle (plotly.js {PLOTLY_VERSION}, MIT, see plotly.txt) is a custom build holding the",
        "scatter, scattergl and scatter3d traces, with the npm packages they use, under their own",
        "licences. Below are, first, the licence banners the minified file itself keeps, then the",
        f"licence text of every package inside it ({len(pkgs)} packages), generated by scripts/plotly_licences.py.",
        "The modules webpack bundled are listed exactly; scatter3d's WebGL code (stackgl) is a",
        "prebuilt file, so for it the list is every runtime dependency of that file, a superset that",
        "includes the tools glslify ran at build time (escodegen, esprima, estraverse, esutils,",
        "source-map, sprintf-js, commander, stack-trace). maplibre-gl is listed because plotly.js",
        "embeds its stylesheet; its code is not in the bundle.",
        "",
        "Licences in the bundle: " + ", ".join(f"{k} ({v})" for k, v in sorted(counts.items(), key=lambda kv: -kv[1])),
        "",
        SPLIT,
        BANNERS_MARK,
        SPLIT,
        "",
        banners,
        "",
        SPLIT,
        "=== Licence texts of the packages in the bundle ===",
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
