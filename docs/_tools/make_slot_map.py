"""Render the paper's slot map (Fig. 1b) for the docs: docs/_static/figures/slot-map.{svg,png}.

    .venv-docs/bin/python docs/_tools/make_slot_map.py

Source: docs/_tools/figures/fig_slots.tex, a copy of manuscript/figures/fig_slots.tex from
settylab/annzarro-paper with its \\ref{} figure numbers written out. It is compiled with
pdflatex (TeX Live basic has no standalone class, so the picture is boxed and the page is
cropped to the box) and converted with pdftocairo. A white backing keeps it legible in the
dark theme.
"""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "figures" / "fig_slots.tex"
OUT = HERE.parent / "_static" / "figures"

WRAPPER = r"""
\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{xcolor}
\usepackage{tikz}
\pagestyle{empty}
\setlength{\linewidth}{16.4cm}
\newsavebox\figbox
\begin{document}
\sbox\figbox{\setlength{\fboxsep}{8pt}\colorbox{white}{\begin{minipage}{16.4cm}\input{%(source)s}\end{minipage}}}
\pdfpagewidth=\wd\figbox
\pdfpageheight=\dimexpr\ht\figbox+\dp\figbox\relax
\hoffset=-1in \voffset=-1in
\shipout\vbox{\box\figbox}
\end{document}
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tex = Path(tmp) / "slot_map.tex"
        tex.write_text(WRAPPER % {"source": SOURCE.as_posix()})
        subprocess.run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", tex.name],
                       cwd=tmp, check=True, stdout=subprocess.DEVNULL)
        pdf = Path(tmp) / "slot_map.pdf"
        subprocess.run(["pdftocairo", "-svg", str(pdf), str(OUT / "slot-map.svg")], check=True)
        subprocess.run(["pdftocairo", "-png", "-r", "220", "-singlefile", str(pdf),
                        str(OUT / "slot-map")], check=True)
    print("wrote", OUT / "slot-map.svg", "and", OUT / "slot-map.png")


if __name__ == "__main__":
    main()
