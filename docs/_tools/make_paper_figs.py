"""Web PNGs of the paper figures for docs/_static/figures/paper/ (overview.png ... scale.png),
plus same-size gallery thumbnails (overview-thumb.png ...) for paper/index.md.

Files are named after the docs page that shows them, not after a figure number, so a
renumbering of the paper changes nothing here. The raster figures are taken from the PNGs in
manuscript/figures/. The two TikZ figures (procedure, deployment) are compiled with pdflatex in
a minimal wrapper that loads the same packages and TikZ libraries as manuscript/main.tex,
rendered with pdftocairo and trimmed. Images named by the earlier figure numbers (fig1.png ...)
are deleted.

Run: .venv-docs/bin/python docs/_tools/make_paper_figs.py [--paper ~/gits/annzarro-paper]
Refresh some figures after the paper regenerates them (e.g. figures/fig_scale.py and
figures/fig6_performance.py, which write manuscript/figures/fig_scale.png and fig6_performance.png):
     .venv-docs/bin/python docs/_tools/make_paper_figs.py --only scale performance
Needs pdflatex (TeX Live) and pdftocairo (poppler) on PATH.
"""
import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "_static" / "figures" / "paper"
MAX_W = 1600
MAX_KB = 400

# docs page -> manuscript/figures source
RASTER = {"overview": "fig1_overview.png", "interface": "fig5_app.png",
          "cell-by-cell": "fig2_cell_by_cell.png", "gene-by-gene": "fig3_gene_by_gene.png",
          "cells-and-genes": "fig4_cells_by_genes.png", "scale": "fig_scale.png",
          "performance": "fig6_performance.png"}
TIKZ = {"procedure": "fig_procedure.tex", "deployment": "fig_deploy.tex"}
RETIRED = [f"fig{n}{t}.png" for n in range(1, 10) for t in ("", "-thumb")]

# Same packages and libraries as manuscript/main.tex.
WRAPPER = r"""\documentclass{article}
\usepackage[paperwidth=17.4cm,paperheight=30cm,margin=0.5cm]{geometry}
\pagestyle{empty}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{xcolor}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning,calc,shapes.geometric}
\begin{document}
\noindent\begin{minipage}{16.4cm}
\input{%s}
\end{minipage}
\end{document}
"""


def trim(im: Image.Image, pad: int = 24) -> Image.Image:
    bg = Image.new(im.mode, im.size, (255, 255, 255))
    box = ImageChops.difference(im, bg).getbbox()
    if box is None:
        return im
    l, t, r, b = box
    return im.crop((max(l - pad, 0), max(t - pad, 0), min(r + pad, im.width), min(b + pad, im.height)))


THUMB = (800, 500)


def thumb(im: Image.Image, n: str) -> None:
    """Gallery thumbnail: the whole figure, letterboxed on white to one aspect ratio."""
    im = im.copy()
    im.thumbnail((THUMB[0] - 40, THUMB[1] - 40), Image.LANCZOS)
    out = Image.new("RGB", THUMB, (255, 255, 255))
    out.paste(im, ((THUMB[0] - im.width) // 2, (THUMB[1] - im.height) // 2))
    out.save(OUT / f"{n}-thumb.png", optimize=True)


def save(im: Image.Image, n: str) -> None:
    im = im.convert("RGB")
    thumb(im, n)
    if im.width > MAX_W:
        im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
    path = OUT / f"{n}.png"
    im.save(path, optimize=True)
    if path.stat().st_size > MAX_KB * 1024:
        im.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, optimize=True)
    print(f"{n}.png {im.width}x{im.height} {path.stat().st_size // 1024} KB")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--paper", type=Path, default=Path.home() / "gits/annzarro-paper")
    ap.add_argument("--only", nargs="*", help="pages whose figure to (re)make, e.g. scale")
    a = ap.parse_args()
    figs = a.paper / "manuscript" / "figures"
    OUT.mkdir(parents=True, exist_ok=True)
    want = set(a.only or list(RASTER) + list(TIKZ))
    for f in RETIRED:
        (OUT / f).unlink(missing_ok=True)
    for n, src in RASTER.items():
        if n in want:
            save(Image.open(figs / src), n)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for n, src in TIKZ.items():
            if n not in want:
                continue
            shutil.copy(figs / src, tmp / src)
            (tmp / f"w{n}.tex").write_text(WRAPPER % src)
            subprocess.run(["pdflatex", "-interaction=nonstopmode", f"w{n}.tex"], cwd=tmp,
                           check=True, stdout=subprocess.DEVNULL)
            subprocess.run(["pdftocairo", "-png", "-r", "300", "-singlefile", f"w{n}.pdf", f"w{n}"],
                           cwd=tmp, check=True)
            save(trim(Image.open(tmp / f"w{n}.png").convert("RGB")), n)


if __name__ == "__main__":
    main()
