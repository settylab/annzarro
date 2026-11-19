"""What kind of numbers a matrix holds: raw counts, log-normalised values, and so on.

Gene scores are meant for normalised, log-transformed data (the panel says so). A raw count matrix scores
sequencing depth, not biology, so the panel warns when the input it is told to use looks like one. The
decision is made on a sample of the stored non-zero values, spread over the whole matrix, never on a full
scan, and it is deliberately blunt: it names what the numbers look like, and the person decides.

The thresholds were chosen on real matrices (a murine bone marrow ageing study of 8,090 cells, whose layers are
raw counts, normalised counts, log counts, imputed and fold-change layers and a scaled X, and a human PBMC
3k set): whole-number layers were 100% whole, with sample maxima of 267 to 557 and 99th percentiles of 32 to
81; every other layer was 0% whole; log layers peaked at 4 to 13.5; the normalised, unlogged layer reached 1,140.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Sequence

import numpy as np

#: Share of the sampled non-zero values that must be whole numbers for a matrix to be counts.
WHOLE_SHARE = 0.99
#: Whole-number matrices whose largest sampled value is below this are binary or ordinal data, not counts.
COUNTS_MIN_MAX = 10.0
#: Matrices that are not whole numbers and peak at or above this are normalised but not log-transformed.
LOG_MAX = 50.0
#: Share of negative values from which a matrix is scaled or centred.
NEGATIVE_SHARE = 0.01
#: Fewer non-zero values than this say nothing.
MIN_SAMPLE = 100
#: The sample: this many pieces of this many consecutive stored values, spread over the matrix.
SAMPLE_PIECES = 8
SAMPLE_PIECE = 8192

KINDS = ("counts", "normalised", "log", "signed", "other", "unknown")
#: Kinds that scores are not meant for, with the reason the panel gives.
WARN_KINDS = ("counts", "normalised")


def classify(values: Sequence[float]) -> Dict[str, Any]:
    """Describe a sample of stored values: ``{"kind", "n", "whole", "min", "max", "negative"}``.

    ``counts``      whole numbers, none negative, reaching ``COUNTS_MIN_MAX`` or more
    ``normalised``  not whole, none negative, reaching ``LOG_MAX`` or more (normalised, not logged)
    ``log``         not whole, none negative, below ``LOG_MAX`` (log-normalised, imputed, smoothed)
    ``signed``      with negative values (scaled, centred, fold changes)
    ``other``       whole numbers that stay small (binary, ordinal)
    ``unknown``     too few non-zero values to say
    """
    v = np.asarray(values, dtype=np.float64).ravel()
    v = v[np.isfinite(v)]
    v = v[v != 0]
    if v.size < MIN_SAMPLE:
        return {"kind": "unknown", "n": int(v.size), "whole": None, "min": None, "max": None, "negative": None}
    whole = float(np.mean(np.abs(v - np.round(v)) < 1e-6))
    negative = float(np.mean(v < 0))
    top = float(v.max())
    if negative >= NEGATIVE_SHARE:
        kind = "signed"
    elif whole >= WHOLE_SHARE:
        kind = "counts" if top >= COUNTS_MIN_MAX else "other"
    else:
        kind = "normalised" if top >= LOG_MAX else "log"
    return {"kind": kind, "n": int(v.size), "whole": round(whole, 4), "min": float(v.min()), "max": top,
            "negative": round(negative, 4)}


def piece_starts(total: int, pieces: int = SAMPLE_PIECES, size: int = SAMPLE_PIECE) -> list:
    """Where the sampled pieces of a stored array of ``total`` values begin, evenly spread."""
    if total <= pieces * size:
        return [0]
    return [int(s) for s in np.linspace(0, total - size, pieces)]


def suggest(kinds: Dict[str, str]) -> Optional[str]:
    """The input to offer instead of one that looks like counts: a log-transformed one whose name says so
    (``log`` before ``norm``), else None. A name is required, because imputed and smoothed layers look
    log-transformed too and are not what a score should read."""
    best, best_rank = None, 0
    for name, kind in kinds.items():
        if kind != "log":
            continue
        lower = name.lower()
        rank = 2 if "log" in lower else 1 if "norm" in lower else 0
        if rank > best_rank:
            best, best_rank = name, rank
    return best
