"""Plot docs/_tools/data/chunk_sweep.csv (from bench_chunks.py) as
docs/_static/figures/chunk-sweep.{svg,png}.

    .venv-docs/bin/python docs/_tools/make_chunk_figure.py

One point per chunk shape: time for one gene column (x) against time for one cell row
(y), both through AnnZarro, log axes, medians with interquartile whiskers. One hue,
labelled directly; the aspect-rule shape is the filled point.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "_static" / "figures"
BLUE = "#2A78D6"
INK, SECONDARY, MUTED, GRID = "#0b0b0b", "#52514e", "#898781", "#e1e0d9"

LABEL_OFFSETS = {  # points; placed by eye after looking at the render
    "whole-gene": (8, -3),
    "aspect rule": (-9, 4),
    "anndata default": (9, -7),
    "square": (-8, 6),
    "whole-cell": (-8, 6),
}


def main() -> None:
    rows = list(csv.DictReader((HERE / "data" / "chunk_sweep.csv").open()))
    meta = json.loads((HERE / "data" / "chunk_sweep.json").read_text())
    pts = {}
    for r in rows:
        pts.setdefault((r["shape"], r["chunks"]), {})[r["interaction"]] = (
            float(r["median_s"]) * 1e3, float(r["q25_s"]) * 1e3, float(r["q75_s"]) * 1e3)

    plt.rcParams.update({"font.family": "sans-serif", "font.size": 9,
                         "axes.edgecolor": MUTED, "axes.labelcolor": SECONDARY,
                         "xtick.color": MUTED, "ytick.color": MUTED})
    fig, ax = plt.subplots(figsize=(5.6, 3.9), dpi=200)
    fig.patch.set_facecolor("white")
    for (shape, chunks), d in pts.items():
        gx, gl, gh = d["gene column"]
        cy, cl, ch = d["cell row"]
        ax.plot([gl, gh], [cy, cy], color=BLUE, lw=1, alpha=0.6, solid_capstyle="round")
        ax.plot([gx, gx], [cl, ch], color=BLUE, lw=1, alpha=0.6, solid_capstyle="round")
        filled = shape == "aspect rule"
        ax.plot(gx, cy, "o", ms=8, mfc=BLUE if filled else "white", mec=BLUE, mew=2, zorder=3)
        dx, dy = LABEL_OFFSETS.get(shape, (8, 0))
        ax.annotate(f"{shape}\n{chunks.replace('x', ' × ')}", (gx, cy), xytext=(dx, dy),
                    textcoords="offset points", ha="left" if dx > 0 else "right", va="center",
                    fontsize=8, color=INK, linespacing=1.15)
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlim(8, 400)
    ax.set_ylim(2.5, 300)
    ax.set_xlabel("one gene column, ms")
    ax.set_ylabel("one cell row, ms")
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.grid(True, which="major", color=GRID, lw=0.6)
    ax.set_axisbelow(True)
    from matplotlib.ticker import FuncFormatter
    fmt = FuncFormatter(lambda v, _: f"{v:g}")
    ax.xaxis.set_major_formatter(fmt)
    ax.yaxis.set_major_formatter(fmt)
    ax.set_title(f"Chunk shape decides which click is slow\n"
                 f"{meta['n_cells']:,} cells × {meta['n_genes']:,} genes, dense float32 layer",
                 loc="left", fontsize=9.5, color=INK)
    fig.tight_layout()
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / "chunk-sweep.svg", facecolor="white")
    fig.savefig(OUT / "chunk-sweep.png", facecolor="white")
    print("wrote", OUT / "chunk-sweep.svg")


if __name__ == "__main__":
    main()
