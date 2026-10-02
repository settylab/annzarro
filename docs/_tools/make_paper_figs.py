"""Web PNGs of the paper figures for docs/_static/figures/paper/ (fig1.png ... fig9.png),
plus same-size gallery thumbnails (fig1-thumb.png ...) for paper/index.md.

The matplotlib figures are taken from the PNGs that the paper's figure scripts write into
manuscript/figures/. The three TikZ figures (1 focus model, 7 slot map, 8 deployment) are
compiled with pdflatex in a minimal wrapper that loads the same packages and TikZ libraries as
manuscript/main.tex, rendered with pdftocairo and trimmed. Fig 6 (tool comparison) is not an
AnnZarro view and gets no guide, but is converted too so the gallery is complete.

Run: .venv-docs/bin/python docs/_tools/make_paper_figs.py [--paper ~/gits/annzarro-paper]
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

# docs number -> manuscript/figures source
RASTER = {2: "fig5_app.png", 3: "fig2_cell_by_cell.png", 4: "fig3_gene_by_gene.png",
          5: "fig4_cells_by_genes.png", 6: "fig_comparison.png", 9: "fig6_performance.png"}
TIKZ = {1: "fig1_focus_model.tex", 7: "fig_slots.tex", 8: "fig_deploy.tex"}

# Same packages and libraries as manuscript/main.tex. \ref is mapped to the paper's figure
# numbers so the slot map's cross references read "Fig. 3" instead of "??".
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
\makeatletter
\def\ref#1{\@ifundefined{fn@#1}{??}{\csname fn@#1\endcsname}}
\expandafter\def\csname fn@fig:cellcell\endcsname{3}
\expandafter\def\csname fn@fig:genegene\endcsname{4}
\expandafter\def\csname fn@fig:cellgene\endcsname{5}
\expandafter\def\csname fn@fig:performance\endcsname{9}
\makeatother
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


def thumb(im: Image.Image, n: int) -> None:
    """Gallery thumbnail: the whole figure, letterboxed on white to one aspect ratio."""
    im = im.copy()
    im.thumbnail((THUMB[0] - 40, THUMB[1] - 40), Image.LANCZOS)
    out = Image.new("RGB", THUMB, (255, 255, 255))
    out.paste(im, ((THUMB[0] - im.width) // 2, (THUMB[1] - im.height) // 2))
    out.save(OUT / f"fig{n}-thumb.png", optimize=True)


def save(im: Image.Image, n: int) -> None:
    im = im.convert("RGB")
    thumb(im, n)
    if im.width > MAX_W:
        im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
    path = OUT / f"fig{n}.png"
    im.save(path, optimize=True)
    if path.stat().st_size > MAX_KB * 1024:
        im.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, optimize=True)
    print(f"fig{n}.png {im.width}x{im.height} {path.stat().st_size // 1024} KB")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--paper", type=Path, default=Path.home() / "gits/annzarro-paper")
    ap.add_argument("--only", type=int, nargs="*", help="figure numbers to (re)make")
    a = ap.parse_args()
    figs = a.paper / "manuscript" / "figures"
    OUT.mkdir(parents=True, exist_ok=True)
    want = set(a.only or list(RASTER) + list(TIKZ))
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
