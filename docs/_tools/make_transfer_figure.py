"""JSON against binary transfer at 1M cells: docs/_static/figures/binary-transfer.{svg,png}.

    .venv-docs/bin/python docs/_tools/make_transfer_figure.py

Numbers: docs/_tools/data/fast_transfer_pr44.csv, a copy of figures/fast_transfer_pr44.csv
in settylab/annzarro-paper (AnnZarro PR #44; laptop, Apple M3 Max, NVMe; synthetic
1M cells x 5,000 genes; warm, client side including parse). One row per interaction,
a grey point for JSON and a blue point for binary on one log ms axis, payloads written
beside each point.
"""
from __future__ import annotations

import csv
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.ticker import FuncFormatter  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "_static" / "figures"
BLUE, GREY = "#2A78D6", "#898781"
INK, SECONDARY, GRID = "#0b0b0b", "#52514e", "#e1e0d9"


def human(nbytes: float) -> str:
    if nbytes >= 1e6:
        return f"{nbytes / 1e6:.1f} MB"
    if nbytes >= 1e3:
        return f"{nbytes / 1e3:.0f} kB"
    return f"{nbytes:.0f} B"


def main() -> None:
    lines = [l for l in (HERE / "data" / "fast_transfer_pr44.csv").read_text().splitlines()
             if not l.startswith("#")]
    data = {}
    for r in csv.DictReader(lines):
        data.setdefault(r["interaction"], {})[r["format"]] = (float(r["warm_ms"]), float(r["payload_bytes"]))
    order = ["gene column", "obsm column", "kNN row", "cell row"]

    plt.rcParams.update({"font.family": "sans-serif", "font.size": 9,
                         "axes.edgecolor": GREY, "xtick.color": GREY, "ytick.color": SECONDARY})
    fig, ax = plt.subplots(figsize=(5.6, 2.9), dpi=200)
    fig.patch.set_facecolor("white")
    for y, name in enumerate(reversed(order)):
        (tj, bj), (tb, bb) = data[name]["json"], data[name]["binary"]
        ax.plot([tb, tj], [y, y], color=GRID, lw=3, solid_capstyle="round", zorder=1)
        ax.plot(tj, y, "o", ms=8, color=GREY, zorder=2)
        ax.plot(tb, y, "o", ms=8, color=BLUE, zorder=3)
        ax.annotate(f"JSON {tj:g} ms, {human(bj)}", (tj, y), xytext=(0, 8), textcoords="offset points",
                    ha="center", fontsize=7.5, color=SECONDARY)
        ax.annotate(f"binary {tb:g} ms, {human(bb)}", (tb, y), xytext=(0, -12), textcoords="offset points",
                    ha="center", fontsize=7.5, color=INK)
    ax.set_yticks(range(len(order)), list(reversed(order)))
    ax.set_xscale("log")
    ax.set_xlim(2, 1500)
    ax.set_ylim(-0.7, len(order) - 0.4)
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}"))
    ax.set_xlabel("time per request, warm, ms", color=SECONDARY)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.tick_params(axis="y", length=0)
    ax.grid(True, axis="x", color=GRID, lw=0.6)
    ax.set_axisbelow(True)
    ax.set_title("One vector at 1M cells: JSON against binary float32", loc="left",
                 fontsize=9.5, color=INK)
    fig.tight_layout()
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / "binary-transfer.svg", facecolor="white")
    fig.savefig(OUT / "binary-transfer.png", facecolor="white")
    print("wrote", OUT / "binary-transfer.svg")


if __name__ == "__main__":
    main()
