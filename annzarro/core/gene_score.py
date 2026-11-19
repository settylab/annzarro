"""Gene signature scores: one number per cell for a list of genes.

A signature is a *recipe*: genes plus how to score them. This module turns a
recipe and a store into a vector, over **all cells of the dataset** for the
reference statistics, and returns the values of the cells the caller shows.

Recipe (``version`` 1), a JSON object::

    {"genes": ["CD3E", "CD8A"],   # up genes, the signature; at most 2,000 distinct names
     "down": [],                  # reserved for up/down signatures; must be empty for now
     "input": "X",                # "X" or the name of a layer
     "method": "zscore_mean",     # "zscore_mean" (default), "mean", "sum", "detected", "fraction_of_total", "control_adjusted"
     "clip": 10,                  # z-scores are clipped at +-clip: a number above 0, or null for no clipping
     "seed": null,                # control_adjusted only: the seed of the control genes (null is 0)
     "bins": 25,                  # control_adjusted only: gene bins, 2 to 200
     "controls": 50,              # control_adjusted only: control genes drawn per bin, 1 to 1,000
     "detect_above": 0,           # detected only: a gene is detected in a cell when its value is above this (0 or more)
     "version": 1}                # the algorithm version

Every field but ``genes`` is optional. ``down`` is accepted by the format and refused by the engine
with a reason until the step that implements it, so adding it later changes no stored recipe.

Methods
    zscore_mean  mean over genes of clip((x - mu) / sd, +-clip); mu and sd over all cells, zeros included
    mean         mean over genes of x
    sum          sum over genes of x; a gene with no value in a cell adds nothing, a cell with no value for any gene is NaN
    detected     the FRACTION of the signature's genes detected in the cell, 0 to 1: the mean of the indicator
                 "x > detect_above" (the default 0: a non-zero value, for the non-negative matrices counts and
                 normalised values are). A fraction rather than a count, so it means the same when a gene is missing from
                 the dataset or has no value in a cell, and compares between signatures of different sizes.
    fraction_of_total
                 the signature's summed expression over the sum of the cell's values over ALL genes, in PERCENT (0 to
                 100), as percent mitochondrial is reported. The denominator is every gene of the matrix, the signature's
                 own included, and not a subset: that is what the percentage of a cell's counts means. Meaningful for counts and for linear normalised values; on log-transformed
                 or scaled input the result carries a warning. Needs the total of every cell: one pass over the matrix.
    control_adjusted
                 mean over genes of x, minus the mean over control genes of x (Tirosh et al. 2016; scanpy's
                 ``score_genes``). Genes are cut into ``N_BINS`` bins by detection rate; for each bin that
                 holds a signature gene, ``CTRL_SIZE`` genes of that bin outside the signature are drawn as
                 controls. The draw ranks the genes of the bin by ``subset.rank_keys(n_genes, seed)`` and takes
                 the smallest, so a stored seed gives the same controls on every machine.

Edge cases (see ``compute``): a gene that is not in the dataset is listed and
excluded; a constant gene is excluded from the z-score mean and listed; the
first of duplicate names in ``var`` is used; non-finite values (NaN, inf) are
missing: ignored per gene, and a cell's score averages its other genes (NaN
when it has none); no usable gene gives no score, never zeros.

The sparse algorithm reads each gene's stored entries once. With z0 the z-score of
a zero, every cell starts at z0 and a stored entry adds ``z(x) - z0``, so a gene
costs its stored entries, not the number of cells. Reads run ahead of the
arithmetic by at most ``READ_AHEAD_ENTRIES`` entries, in gene order, so a result
does not depend on the number of threads.
"""
from __future__ import annotations

import contextvars
import dataclasses
import logging
import math
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Tuple

import numpy as np

from . import matrix_kind

logger = logging.getLogger(__name__)

#: Bumped when a change makes the same recipe give different numbers. Part of every cache key.
ALGORITHM_VERSION = 1

#: Longest gene name accepted (names longer than any real one are a sign of a hostile request).
MAX_NAME_CHARS = 1000

DEFAULT_CLIP = 10.0
DEFAULT_METHOD = "zscore_mean"
METHODS = ("zscore_mean", "mean", "sum", "control_adjusted", "detected", "fraction_of_total")

#: Control-adjusted scoring: gene bins and controls drawn per bin (scanpy's defaults).
N_BINS = 25
CTRL_SIZE = 50
BINS_RANGE = (2, 200)
CONTROLS_RANGE = (1, 1000)
#: The seed a control-adjusted recipe without one means.
DEFAULT_SEED = 0
#: What genes are binned by: ``detection`` (the share of cells with a stored value, free in a CSC store) or
#: ``mean`` (scanpy's, which reads every stored value). The algorithm version stands for ``detection``.
BINNINGS = ("detection", "mean")
#: Stored entries read at a time when counting or summing every gene.
STAT_CHUNK = 1 << 22

#: Estimated seconds up to which a score is computed without asking, and up to which it may be
#: asked for with one confirmation. Above the second it is refused.
AUTO_MAX_S = 60.0
#: Estimated seconds below which an open signature may update live; from here edits wait for "Update score".
#: Reported with the estimate so a client does not hard-code it.
LIVE_MAX_S = 5.0
CONFIRM_MAX_S = 600.0

#: Stored entries (or matrix elements) read per second, by layout. Set conservatively below
#: what ``annzarro/tests/server/test_gene_score_bench.py`` measures, so an estimate is rarely low.
#: ``csr`` counts every stored entry of the matrix once per scan.
RATES = {
    "csc": 30e6,
    "csr": 60e6,
    "dense": 200e6,
}
#: Remote stores are read at this fraction of a local store's rate.
REMOTE_RATE_FACTOR = 0.1
#: Fixed cost of opening the store and reading its names, seconds.
BASE_SECONDS = 0.2

#: Entries read ahead of the arithmetic. Bounds memory: 12 bytes an entry.
READ_AHEAD_ENTRIES = 48_000_000
#: Neighbouring genes whose entries lie within this many entries of each other are read in one go
#: (zarr and HDF5 decode whole chunks), up to ``MAX_GROUP_ENTRIES``.
GROUP_GAP_ENTRIES = 1 << 16
MAX_GROUP_ENTRIES = 1 << 22
#: Reader threads. HDF5 reads are serialised by h5py, so it uses one.
READ_THREADS = 6
#: A CSR matrix or a dense array is read this many genes (and at most BATCH_ENTRIES stored hits) at a time.
MAX_BATCH_GENES = 256
BATCH_ENTRIES = 24_000_000
#: Stored entries of one gene worked through at a time (float64 temporaries are this long).
SEGMENT_ENTRIES = 1 << 22
#: Cells up to which the running sum is float64; above it float32 saves memory.
FLOAT64_CELLS = 20_000_000


class ScoreError(Exception):
    """A request the engine refuses, with the HTTP status, reason code and extra fields the route sends."""

    def __init__(self, status: int, reason: str, message: str, **extra):
        super().__init__(message)
        self.status, self.reason, self.message, self.extra = status, reason, message, extra


# ---------------------------------------------------------------------------
# The recipe
# ---------------------------------------------------------------------------

_FIELDS = ("genes", "down", "input", "method", "clip", "seed", "bins", "controls", "detect_above", "version", "title")


@dataclass(frozen=True)
class Recipe:
    genes: Tuple[str, ...]
    down: Tuple[str, ...] = ()
    input: str = "X"
    method: str = DEFAULT_METHOD
    clip: Optional[float] = DEFAULT_CLIP
    seed: Optional[int] = None
    version: int = ALGORITHM_VERSION
    bins: int = N_BINS
    controls: int = CTRL_SIZE
    detect_above: float = 0.0

    @property
    def effective_clip(self) -> Optional[float]:
        """The clip that changes the numbers: only the z-score mean clips."""
        return self.clip if self.method == "zscore_mean" else None

    @property
    def effective_seed(self) -> Optional[int]:
        """The seed that changes the numbers: only the control-adjusted score draws controls."""
        if self.method != "control_adjusted":
            return None
        return DEFAULT_SEED if self.seed is None else self.seed

    @property
    def effective_detect_above(self) -> Optional[float]:
        return self.detect_above if self.method == "detected" else None

    @property
    def effective_bins(self) -> Optional[int]:
        return self.bins if self.method == "control_adjusted" else None

    @property
    def effective_controls(self) -> Optional[int]:
        return self.controls if self.method == "control_adjusted" else None

    def describe(self) -> Dict[str, Any]:
        return {"method": self.method, "input": self.input, "clip": self.effective_clip,
                "seed": self.effective_seed, "bins": self.effective_bins, "controls": self.effective_controls,
                "detect_above": self.effective_detect_above, "version": self.version, "genes": len(self.genes)}


def _names(value, field_name: str) -> Tuple[str, ...]:
    if not isinstance(value, list):
        raise ScoreError(400, "bad_recipe", f"'{field_name}' must be a list of gene names.")
    seen, out = set(), []
    for name in value:
        if not isinstance(name, str):
            raise ScoreError(400, "bad_recipe", f"'{field_name}' must hold only text; got {type(name).__name__}.")
        if len(name) > MAX_NAME_CHARS:
            raise ScoreError(400, "bad_recipe", f"A gene name is over {MAX_NAME_CHARS} characters.")
        if name not in seen:
            seen.add(name)
            out.append(name)
    return tuple(out)


def parse_clip(value) -> Optional[float]:
    """A clip: a positive finite number, or None for no clipping."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ScoreError(400, "bad_clip", "Clip must be a number above 0, or null to turn clipping off.")
    return float(value)


def _whole(value, name: str, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise ScoreError(400, f"bad_{name}", f"{name} must be a whole number from {lo} to {hi:,}.")
    return value


def parse_recipe(raw) -> Recipe:
    """The recipe a request names, validated; ScoreError (400/413) otherwise."""
    if not isinstance(raw, dict):
        raise ScoreError(400, "bad_recipe", "recipe must be an object.")
    unknown = sorted(set(raw) - set(_FIELDS))
    if unknown:
        raise ScoreError(400, "bad_recipe", f"Unknown recipe field(s): {', '.join(map(str, unknown))}.")
    if "genes" not in raw:
        raise ScoreError(400, "bad_recipe", "recipe.genes is required (a list of gene names, possibly empty).")
    genes = _names(raw["genes"], "genes")
    down = _names(raw.get("down", []), "down")
    # No gene limit: a score takes no more memory than a gene table, which has none. What bounds a request is its
    # size (the route's MAX_BODY_BYTES) and the cost estimate's tiers, which refuse what is too expensive.
    if down:
        raise ScoreError(400, "down_not_available", "Down genes are not available yet; send the genes in 'genes'.")
    method = raw.get("method", DEFAULT_METHOD)
    if method not in METHODS:
        raise ScoreError(400, "bad_method", f"Unknown method {method!r}; use one of {', '.join(METHODS)}.")
    clip = parse_clip(raw["clip"]) if "clip" in raw else DEFAULT_CLIP
    seed = raw.get("seed")
    if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2 ** 63):
        raise ScoreError(400, "bad_seed", "seed must be a whole number from 0 up, or null.")
    bins = _whole(raw.get("bins", N_BINS), "bins", *BINS_RANGE)
    controls = _whole(raw.get("controls", CTRL_SIZE), "controls", *CONTROLS_RANGE)
    detect_above = raw.get("detect_above", 0)
    if isinstance(detect_above, bool) or not isinstance(detect_above, (int, float)) or not math.isfinite(detect_above) \
            or detect_above < 0:
        raise ScoreError(400, "bad_detect_above", "detect_above must be a number from 0 up.")
    source = raw.get("input", "X")
    if not isinstance(source, str) or not source or len(source) > MAX_NAME_CHARS:
        raise ScoreError(400, "bad_recipe", "input must be 'X' or the name of a layer.")
    version = raw.get("version", ALGORITHM_VERSION)
    if isinstance(version, bool) or version != ALGORITHM_VERSION:
        raise ScoreError(400, "unsupported_version",
                         f"This server computes scores with algorithm version {ALGORITHM_VERSION}; "
                         f"the recipe asks for {version!r}.", supported=ALGORITHM_VERSION)
    return Recipe(genes=genes, down=down, input=source, method=method, clip=clip, seed=seed, version=ALGORITHM_VERSION,
                  bins=bins, controls=controls, detect_above=float(detect_above))


# ---------------------------------------------------------------------------
# Reading genes: one source per backing store
# ---------------------------------------------------------------------------

@dataclass
class _Task:
    """A read of one or more genes; ``read`` returns ``[(column, rows | None, values)]``.
    ``rows`` None means ``values`` is the whole column, one value per cell."""
    cols: List[int]
    entries: int
    read: Callable[[], List[Tuple[int, Optional[np.ndarray], np.ndarray]]]


class _Source:
    layout = ""          # "csc", "csr" or "dense"
    backend = ""         # "zarr" or "h5ad"
    threads = READ_THREADS

    def __init__(self, n_obs: int, n_var: int, remote: bool):
        self.n_obs, self.n_var, self.remote = n_obs, n_var, remote

    def entries(self, cols: Sequence[int]) -> int:
        raise NotImplementedError

    def tasks(self, cols: Sequence[int]) -> List[_Task]:
        raise NotImplementedError

    def stat_entries(self, kind: str) -> int:
        """Stored entries (matrix elements) ``column_stat(kind)`` reads."""
        raise NotImplementedError

    def row_totals(self, should_stop: Optional[Callable[[], bool]] = None) -> np.ndarray:
        """The sum of the finite values of every cell over all genes; float64, length ``n_obs``."""
        raise NotImplementedError

    def sample(self) -> np.ndarray:
        """A few thousand stored values spread over the whole matrix (``core/matrix_kind.py`` classifies them)."""
        raise NotImplementedError

    def column_stat(self, kind: str, should_stop: Optional[Callable[[], bool]] = None) -> np.ndarray:
        """One figure per gene, for every gene: ``detection`` (stored non-zero values over cells) or ``mean``
        (over the finite values, zeros included; NaN for a gene with none). Float64, length ``n_var``."""
        raise NotImplementedError

    def close(self) -> None:
        pass


def _sample_stored(data) -> np.ndarray:
    """Pieces of a stored ``data`` array, evenly spread."""
    total = int(data.shape[0])
    pieces = [np.asarray(data[s:s + matrix_kind.SAMPLE_PIECE]) for s in matrix_kind.piece_starts(total)]
    return np.concatenate(pieces) if pieces else np.empty(0)


def _sparse_stat(kind: str, n_obs: int, n_var: int, chunks, should_stop) -> np.ndarray:
    """``chunks`` yields ``(gene_of_each_entry, values or None)``; ``values`` only when the mean is asked for."""
    counts = np.zeros(n_var, dtype=np.float64)
    sums = np.zeros(n_var, dtype=np.float64)
    missing = np.zeros(n_var, dtype=np.float64)
    for genes, values in chunks:
        if should_stop is not None and should_stop():
            raise ScoreCancelled()
        if values is None:
            counts += np.bincount(genes, minlength=n_var)
            continue
        v = np.asarray(values, dtype=np.float64)
        finite = np.isfinite(v)
        sums += np.bincount(genes[finite], weights=v[finite], minlength=n_var)
        missing += np.bincount(genes[~finite], minlength=n_var)
    if kind == "detection":
        return counts / max(n_obs, 1)
    denom = n_obs - missing
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(denom > 0, sums / np.maximum(denom, 1), np.nan)


def _batch_size(n_obs: int, nnz: int, n_var: int) -> int:
    """Genes per read of a CSR matrix or a dense array: bound the entries one batch may hold."""
    average = max(nnz / max(n_var, 1), 1.0)
    return int(max(1, min(MAX_BATCH_GENES, BATCH_ENTRIES // (3 * average), BATCH_ENTRIES // max(n_obs, 1))))


def _groups(cols: np.ndarray, starts: np.ndarray, ends: np.ndarray) -> List[List[int]]:
    """Positions (into ``cols``) of the genes to read together: close neighbours in the file, capped."""
    out: List[List[int]] = []
    cur: List[int] = []
    for i in range(len(cols)):
        if cur:
            gap = int(starts[i] - ends[cur[-1]])
            span = int(ends[i] - starts[cur[0]])
            if gap > GROUP_GAP_ENTRIES or span > MAX_GROUP_ENTRIES:
                out.append(cur)
                cur = []
        cur.append(i)
    if cur:
        out.append(cur)
    return out


class _CscSource(_Source):
    """A compressed-sparse-column group (zarr or HDF5): a gene is one contiguous range."""
    layout = "csc"

    def __init__(self, group, n_obs, n_var, remote, backend):
        super().__init__(n_obs, n_var, remote)
        self.backend = backend
        self.data, self.indices = group["data"], group["indices"]
        self.indptr = np.asarray(group["indptr"][:], dtype=np.int64)
        if backend == "h5ad":
            self.threads = 1

    def entries(self, cols):
        cols = np.asarray(cols, dtype=np.int64)
        return int((self.indptr[cols + 1] - self.indptr[cols]).sum())

    def stat_entries(self, kind):
        return 0 if kind == "detection" else int(self.indptr[-1])

    def sample(self):
        return _sample_stored(self.data)

    def row_totals(self, should_stop=None):
        total = int(self.indptr[-1])
        step = int(min(max(STAT_CHUNK, 2 * self.n_obs), 1 << 26))
        out = np.zeros(self.n_obs, dtype=np.float64)
        for lo in range(0, total, step):
            if should_stop is not None and should_stop():
                raise ScoreCancelled()
            hi = min(lo + step, total)
            v = np.asarray(self.data[lo:hi], dtype=np.float64)
            ok = np.isfinite(v)
            out += np.bincount(np.asarray(self.indices[lo:hi], dtype=np.int64)[ok], weights=v[ok], minlength=self.n_obs)
        return out

    def column_stat(self, kind, should_stop=None):
        if kind == "detection":                      # the length of each gene's range: nothing is read
            return np.diff(self.indptr).astype(np.float64) / max(self.n_obs, 1)
        total = int(self.indptr[-1])

        def chunks():
            for lo in range(0, total, STAT_CHUNK):
                hi = min(lo + STAT_CHUNK, total)
                genes = np.searchsorted(self.indptr, np.arange(lo, hi, dtype=np.int64), side="right") - 1
                yield genes, np.asarray(self.data[lo:hi])
        return _sparse_stat(kind, self.n_obs, self.n_var, chunks(), should_stop)

    def tasks(self, cols):
        cols = np.sort(np.asarray(cols, dtype=np.int64))
        starts, ends = self.indptr[cols], self.indptr[cols + 1]
        out = []
        for members in _groups(cols, starts, ends):
            lo, hi = int(starts[members[0]]), int(ends[members[-1]])
            spans = [(int(cols[i]), int(starts[i]) - lo, int(ends[i]) - lo) for i in members]
            out.append(_Task([c for c, _, _ in spans], sum(b - a for _, a, b in spans),
                             lambda lo=lo, hi=hi, spans=spans: self._read(lo, hi, spans)))
        return out

    def _read(self, lo, hi, spans):
        if hi > lo:
            idx, val = np.asarray(self.indices[lo:hi]), np.asarray(self.data[lo:hi])
        else:
            idx, val = np.empty(0, np.int64), np.empty(0, np.float32)
        return [(col, idx[a:b], val[a:b]) for col, a, b in spans]


class _CsrSource(_Source):
    """A compressed-sparse-row group: a gene sits anywhere, so reading genes scans every stored index."""
    layout = "csr"

    def __init__(self, group, n_obs, n_var, remote, backend, scan):
        super().__init__(n_obs, n_var, remote)
        self.backend, self.group, self._scan = backend, group, scan
        self.nnz = int(group["indptr"][n_obs])
        # one scan at a time: a scan is already a whole pass over the file
        self.threads = 1

    def _batch(self):
        return _batch_size(self.n_obs, self.nnz, self.n_var)

    def entries(self, cols):
        scans = math.ceil(len(cols) / self._batch()) if len(cols) else 0
        return self.nnz * scans

    def stat_entries(self, kind):
        return self.nnz

    def sample(self):
        return _sample_stored(self.group["data"])

    def row_totals(self, should_stop=None):
        ptr = np.asarray(self.group["indptr"][:], dtype=np.int64)
        data = self.group["data"]
        out = np.zeros(self.n_obs, dtype=np.float64)
        r0 = 0
        while r0 < self.n_obs:
            if should_stop is not None and should_stop():
                raise ScoreCancelled()
            r1 = int(np.searchsorted(ptr, ptr[r0] + STAT_CHUNK, side="right")) - 1
            r1 = min(max(r1, r0 + 1), self.n_obs)
            lo, hi = int(ptr[r0]), int(ptr[r1])
            if hi > lo:
                v = np.asarray(data[lo:hi], dtype=np.float64)
                v[~np.isfinite(v)] = 0.0
                csum = np.concatenate(([0.0], np.cumsum(v)))
                out[r0:r1] = csum[ptr[r0 + 1:r1 + 1] - lo] - csum[ptr[r0:r1] - lo]
            r0 = r1
        return out

    def column_stat(self, kind, should_stop=None):
        indices, data = self.group["indices"], self.group["data"]

        def chunks():
            for lo in range(0, self.nnz, STAT_CHUNK):
                hi = min(lo + STAT_CHUNK, self.nnz)
                yield (np.asarray(indices[lo:hi], dtype=np.int64),
                       np.asarray(data[lo:hi]) if kind == "mean" else None)
        return _sparse_stat(kind, self.n_obs, self.n_var, chunks(), should_stop)

    def tasks(self, cols):
        cols = [int(c) for c in np.sort(np.asarray(cols, dtype=np.int64))]
        size = self._batch()
        out = []
        for i in range(0, len(cols), size):
            batch = cols[i:i + size]
            out.append(_Task(batch, min(self.n_obs * len(batch), BATCH_ENTRIES), lambda b=batch: self._read(b)))
        return out

    def _read(self, batch):
        m = self._scan(batch).tocsc()
        out = []
        for k, col in enumerate(batch):
            s, e = m.indptr[k], m.indptr[k + 1]
            out.append((col, m.indices[s:e], m.data[s:e]))
        return out


class _DenseSource(_Source):
    """A dense array of cells x genes."""
    layout = "dense"

    def __init__(self, array, n_obs, n_var, remote, backend, take):
        super().__init__(n_obs, n_var, remote)
        self.backend, self.array, self._take = backend, array, take
        if backend == "h5ad":
            self.threads = 1
        self.itemsize = int(getattr(array.dtype, "itemsize", 4))

    def _batches(self, cols):
        cols = [int(c) for c in np.sort(np.asarray(cols, dtype=np.int64))]
        size = int(max(1, min(MAX_BATCH_GENES, BATCH_ENTRIES // max(self.n_obs, 1))))
        return [cols[i:i + size] for i in range(0, len(cols), size)]

    def entries(self, cols):
        """Matrix elements decoded: every batch decodes whole stored chunks, so the columns of the
        chunk blocks it touches count, once per batch."""
        chunks = getattr(self.array, "chunks", None)
        width = int(chunks[1]) if chunks and len(chunks) == 2 else self.n_var
        total = 0
        for batch in self._batches(cols):
            blocks = len({c // width for c in batch})
            total += self.n_obs * min(blocks * width, self.n_var)
        return total

    def tasks(self, cols):
        return [_Task(batch, self.n_obs * len(batch), lambda b=batch: self._read(b))
                for batch in self._batches(cols)]

    def stat_entries(self, kind):
        return self.entries(range(self.n_var))

    def row_totals(self, should_stop=None):
        out = np.zeros(self.n_obs, dtype=np.float64)
        rows = int(max(1, min(self.n_obs, BATCH_ENTRIES // max(self.n_var, 1))))
        for r0 in range(0, self.n_obs, rows):
            if should_stop is not None and should_stop():
                raise ScoreCancelled()
            block = np.asarray(self.array[r0:r0 + rows], dtype=np.float64)
            block[~np.isfinite(block)] = 0.0
            out[r0:r0 + block.shape[0]] = block.sum(axis=1)
        return out

    def sample(self):
        """A few blocks of whole rows, evenly spread; the zeros are left to the classifier to drop."""
        rows_per_piece = max(1, matrix_kind.SAMPLE_PIECE // max(self.n_var, 1))
        out = []
        for start in matrix_kind.piece_starts(self.n_obs, size=rows_per_piece):
            out.append(np.asarray(self.array[start:start + rows_per_piece]).ravel())
        return np.concatenate(out) if out else np.empty(0)

    def column_stat(self, kind, should_stop=None):
        out = np.full(self.n_var, np.nan, dtype=np.float64)
        for batch in self._batches(range(self.n_var)):
            if should_stop is not None and should_stop():
                raise ScoreCancelled()
            block = np.asarray(self._take(batch))
            if block.ndim == 1:
                block = block.reshape(-1, 1)
            if kind == "detection":
                out[batch] = np.count_nonzero(block, axis=0) / max(self.n_obs, 1)
            else:
                v = block.astype(np.float64)
                finite = np.isfinite(v)
                n = finite.sum(axis=0)
                with np.errstate(divide="ignore", invalid="ignore"):
                    out[batch] = np.where(n > 0, np.where(finite, v, 0.0).sum(axis=0) / np.maximum(n, 1), np.nan)
        return out

    def _read(self, batch):
        block = np.asarray(self._take(batch))
        if block.ndim == 1:
            block = block.reshape(-1, 1)
        return [(col, None, block[:, k]) for k, col in enumerate(batch)]


class _OpenSource:
    """A source and what must be closed with it."""

    def __init__(self, source: _Source, closer: Optional[Callable[[], None]] = None):
        self.source, self._closer = source, closer

    def __enter__(self):
        return self.source

    def __exit__(self, *exc):
        if self._closer:
            self._closer()


def _unsupported(node_name: str, encoding):
    from .zarr_reader import UnsupportedEncodingError
    return UnsupportedEncodingError(f"{node_name} is stored as {encoding!r}; scores read dense, csr_matrix and "
                                    f"csc_matrix matrices.")


def _open_zarr(reader, dataset_path: str, input_name: str) -> _OpenSource:
    from .remote import is_remote_path
    root = reader._get_root(dataset_path=dataset_path)
    if root is None:
        raise FileNotFoundError(f"Dataset path does not exist: {dataset_path}")
    layers = root["layers"] if "layers" in root else None
    if input_name == "X" and "X" in root and (layers is None or "X" not in layers):
        node, label = root["X"], "X"
    elif layers is not None and input_name in layers:
        node, label = layers[input_name], f"layer '{input_name}'"
    else:
        what = "X matrix" if input_name == "X" else f"layer '{input_name}'"
        raise ScoreError(404, "key_not_found", f"This dataset has no {what}.")
    remote = is_remote_path(dataset_path)
    is_sparse, fmt = reader._is_sparse_matrix(node)
    if is_sparse:
        n_obs, n_var = (int(v) for v in node.attrs["shape"])
        if fmt == "csc_matrix":
            return _OpenSource(_CscSource(node, n_obs, n_var, remote, "zarr"))
        if fmt == "csr_matrix":
            def scan(batch):
                return reader._minor_axis_slice(node, (n_obs, n_var), batch, "col")
            return _OpenSource(_CsrSource(node, n_obs, n_var, remote, "zarr", scan))
        raise _unsupported(label, fmt)
    shape = getattr(node, "shape", None)
    if shape is None or len(shape) != 2:
        raise _unsupported(label, node.attrs.get("encoding-type") if hasattr(node, "attrs") else None)

    height = int(node.chunks[0]) if getattr(node, "chunks", None) else int(shape[0])
    n_rows = int(shape[0])

    def take(batch):
        # one block of stored rows at a time: zarr would decode every chunk of the columns together
        out = np.empty((n_rows, len(batch)), dtype=node.dtype)
        for r0 in range(0, n_rows, max(height, 1)):
            r1 = min(r0 + height, n_rows)
            out[r0:r1] = node[r0:r1, batch] if len(batch) > 1 else node[r0:r1, batch[0]:batch[0] + 1]
        return out
    return _OpenSource(_DenseSource(node, int(shape[0]), int(shape[1]), remote, "zarr", take))


def _open_h5ad(dataset_path: str, input_name: str) -> _OpenSource:
    import h5py
    from . import h5ad_reader as h5
    f = h5._open(dataset_path)
    try:
        layers = f["layers"] if "layers" in f else None
        if input_name == "X" and "X" in f and (layers is None or "X" not in layers):
            node, label = f["X"], "X"
        elif layers is not None and input_name in layers:
            node, label = layers[input_name], f"layer '{input_name}'"
        else:
            what = "X matrix" if input_name == "X" else f"layer '{input_name}'"
            raise ScoreError(404, "key_not_found", f"This dataset has no {what}.")
        if isinstance(node, h5py.Group):
            fmt, shape = h5._encoding(node), h5._sparse_group_shape(node)
            if fmt not in ("csr_matrix", "csc_matrix") or shape is None:
                raise _unsupported(label, fmt)
            n_obs, n_var = shape
            if fmt == "csc_matrix":
                source = _CscSource(node, n_obs, n_var, False, "h5ad")
            else:
                indptr = node["indptr"][()].astype(np.int64)

                def scan(batch):
                    return h5._minor_scan(node, indptr, batch, n_obs, n_var)
                source = _CsrSource(node, n_obs, n_var, False, "h5ad", scan)
        else:
            if len(node.shape) != 2:
                raise _unsupported(label, None)
            n_obs, n_var = (int(v) for v in node.shape)

            def take(batch):
                return h5._dense(node, None, batch)
            source = _DenseSource(node, n_obs, n_var, False, "h5ad", take)
    except BaseException:
        f.close()
        raise
    return _OpenSource(source, f.close)


def open_source(reader, dataset_path: str, input_name: str) -> _OpenSource:
    from .h5ad_reader import h5adReader
    if isinstance(reader, h5adReader):
        return _open_h5ad(dataset_path, input_name)
    return _open_zarr(reader, dataset_path, input_name)


def input_names(reader, dataset_path: str) -> List[str]:
    """The matrices a score can read: ``X`` (when the store has one), then its layers."""
    from .h5ad_reader import h5adReader
    if isinstance(reader, h5adReader):
        from . import h5ad_reader as h5
        f = h5._open(dataset_path)
        try:
            layers = sorted(f["layers"].keys()) if "layers" in f else []
            return (["X"] if "X" in f else []) + [n for n in layers if n != "X"]
        finally:
            f.close()
    root = reader._get_root(dataset_path=dataset_path)
    if root is None:
        raise FileNotFoundError(f"Dataset path does not exist: {dataset_path}")
    layers = sorted(root["layers"].keys()) if "layers" in root else []
    return (["X"] if "X" in root else []) + [n for n in layers if n != "X"]


#: Matrices looked at when the one asked about looks like raw counts, to name one that does not.
MAX_ALTERNATIVES = 12


def kind_of(reader, dataset_path: str, name: str) -> Dict[str, Any]:
    """``matrix_kind.classify`` of a sample of the matrix ``name`` (``X`` or a layer)."""
    with open_source(reader, dataset_path, name) as source:
        return matrix_kind.classify(source.sample())


def matrix_kinds(reader, dataset_path: str, name: str, suggest: bool = True) -> Dict[str, Any]:
    """What the input ``name`` looks like and, when that is something scores are not meant for, which other
    matrix of the dataset looks log-normalised: ``{"input", "kind", "stats", "suggest", "checked"}``."""
    stats = kind_of(reader, dataset_path, name)
    out = {"input": name, "kind": stats["kind"], "stats": stats, "suggest": None, "checked": {}}
    if suggest and stats["kind"] in (*matrix_kind.WARN_KINDS, "signed"):
        others = [n for n in input_names(reader, dataset_path) if n != name][:MAX_ALTERNATIVES]
        for other in others:
            try:
                out["checked"][other] = kind_of(reader, dataset_path, other)["kind"]
            except Exception as exc:                         # a layer this reader cannot read is not a candidate
                logger.info("Matrix kind of %s skipped: %s", other, exc)
        out["suggest"] = matrix_kind.suggest(out["checked"])
    return out


# ---------------------------------------------------------------------------
# Control genes (control-adjusted score)
# ---------------------------------------------------------------------------

def gene_bins(stat: np.ndarray, n_bins: int = N_BINS) -> np.ndarray:
    """The bin of each gene, as scanpy's ``score_genes`` cuts them: ``rank(method="min") // round(n / (n_bins - 1))``
    over the genes with a finite figure. Genes without one get -1. Equal figures share a bin."""
    stat = np.asarray(stat, dtype=np.float64)
    bins = np.full(stat.size, -1, dtype=np.int64)
    pool = np.flatnonzero(np.isfinite(stat))
    if pool.size == 0:
        return bins
    values = stat[pool]
    ranks = np.searchsorted(np.sort(values), values, side="left") + 1        # rank "min", from 1
    per_bin = max(int(np.round(pool.size / (n_bins - 1))), 1)
    bins[pool] = ranks // per_bin
    return bins


def choose_controls(stat: np.ndarray, signature_cols: Sequence[int], seed: int,
                    n_bins: int = N_BINS, ctrl_size: int = CTRL_SIZE) -> np.ndarray:
    """The control genes (columns, ascending): for each bin holding a signature gene, the ``ctrl_size``
    genes of that bin outside the signature with the smallest ``subset.rank_keys`` for ``seed``
    (all of them when the bin holds fewer). The same inputs give the same controls on every machine."""
    from .subset import rank_keys
    bins = gene_bins(stat, n_bins)
    sig = np.unique(np.asarray(signature_cols, dtype=np.int64))
    cuts = np.unique(bins[sig][bins[sig] >= 0])
    if cuts.size == 0:
        return np.empty(0, dtype=np.int64)
    keys = rank_keys(bins.size, seed)
    is_signature = np.zeros(bins.size, dtype=bool)
    is_signature[sig] = True
    candidates = np.flatnonzero((bins >= 0) & ~is_signature & np.isin(bins, cuts))
    out = []
    for cut in cuts:
        members = candidates[bins[candidates] == cut]
        if members.size > ctrl_size:
            members = members[np.argsort(keys[members], kind="stable")[:ctrl_size]]
        out.append(members)
    return np.sort(np.concatenate(out)) if out else np.empty(0, dtype=np.int64)


# ---------------------------------------------------------------------------
# Plan and estimate
# ---------------------------------------------------------------------------

@dataclass
class Plan:
    """What a recipe means for one store, before any gene is read."""
    dataset_path: str
    reader: Any
    recipe: Recipe
    n_obs: int
    n_var: int
    layout: str
    backend: str
    remote: bool
    columns: List[int]                     # distinct columns to read, ascending
    names: Dict[int, str]                  # column -> the requested name
    missing: List[str]                     # requested, not in the dataset
    duplicated: List[str]                  # requested, more than once in var (the first is used)
    entries: int
    seconds: float
    tier: str                              # "auto", "confirm" or "refused"
    binning: str = "detection"             # control_adjusted: what genes are binned by
    controls: Optional[List[int]] = None   # control_adjusted: the control columns, when known before reading
    stat_entries: int = 0                  # control_adjusted: entries read to bin the genes (0 on a CSC store)

    @property
    def vectors(self) -> int:
        """Running sums of one value per cell shown that the score holds at once."""
        return 2 if self.recipe.method in ("control_adjusted", "fraction_of_total") else 1

    def estimate(self) -> Dict[str, Any]:
        return {"entries": self.entries, "seconds": round(self.seconds, 2), "tier": self.tier,
                "live_max_s": LIVE_MAX_S, "auto_max_s": AUTO_MAX_S, "max_s": CONFIRM_MAX_S, "layout": self.layout,
                "n_cells": self.n_obs, "genes": len(self.columns), "genes_requested": len(self.recipe.genes),
                "genes_missing": len(self.missing),
                **({"controls": len(self.controls) if self.controls is not None else None,
                    "binning": self.binning} if self.recipe.method == "control_adjusted" else {})}


def tier_of(seconds: float) -> str:
    if seconds <= AUTO_MAX_S:
        return "auto"
    return "confirm" if seconds <= CONFIRM_MAX_S else "refused"


def estimate_seconds(layout: str, entries: int, remote: bool) -> float:
    rate = RATES[layout] * (REMOTE_RATE_FACTOR if remote else 1.0)
    return BASE_SECONDS + entries / rate


def _resolve_names(var_names: Sequence[str], wanted: Sequence[str]):
    """Column of each requested name (the first when ``var`` repeats it), what is missing, what repeats."""
    want = set(wanted)
    first: Dict[str, int] = {}
    repeated = set()
    for col, name in enumerate(var_names):
        if name in want:
            if name in first:
                repeated.add(name)
            else:
                first[name] = col
    columns = {name: first[name] for name in wanted if name in first}
    missing = [name for name in wanted if name not in first]
    return columns, missing, [name for name in wanted if name in repeated]


def plan(reader, dataset_path: str, recipe: Recipe, binning: str = "detection") -> Plan:
    """Open the store, resolve the genes and estimate the read. Reads no gene.

    A control-adjusted score also reads its control genes. They are known now when the figure that bins
    the genes costs nothing (detection on a CSC store); otherwise the estimate counts the pass that
    bins them and the most controls there can be (``N_BINS`` times ``CTRL_SIZE``), and they are drawn in ``compute``.
    """
    if binning not in BINNINGS:
        raise ValueError(f"binning must be one of {', '.join(BINNINGS)}")
    genes = list(recipe.genes)
    var_names = reader.get_cell_gene_names(dataset_path, "genes") if genes else []
    with open_source(reader, dataset_path, recipe.input) as source:
        if genes and len(var_names) != source.n_var:
            raise ScoreError(500, "read_failed", f"The gene names ({len(var_names)}) do not match "
                                                 f"the matrix ({source.n_var} columns).")
        by_name, missing, duplicated = _resolve_names(var_names, genes)
        columns = sorted(set(by_name.values()))
        controls, stat_entries = None, 0
        if recipe.method == "control_adjusted" and columns:
            stat_entries = source.stat_entries(binning)
            if stat_entries == 0:
                controls = [int(c) for c in choose_controls(source.column_stat(binning), columns,
                                                            recipe.effective_seed, recipe.bins, recipe.controls)]
                reads = columns + controls
            else:
                taken = set(columns)
                most = recipe.bins * recipe.controls
                reads = columns + [c for c in range(min(source.n_var, len(columns) + most)) if c not in taken][:most]
        elif recipe.method == "fraction_of_total" and columns:
            stat_entries = source.stat_entries("total")           # the total of every cell: one pass over the matrix
            reads = columns
        else:
            reads = columns
        entries = source.entries(reads) + stat_entries
        seconds = estimate_seconds(source.layout, entries, source.remote) if columns else 0.0
        return Plan(dataset_path=dataset_path, reader=reader, recipe=recipe, n_obs=source.n_obs, n_var=source.n_var,
                    layout=source.layout, backend=source.backend, remote=source.remote, columns=columns,
                    names={col: name for name, col in by_name.items()}, missing=missing, duplicated=duplicated,
                    entries=entries, seconds=seconds, tier=tier_of(seconds), binning=binning, controls=controls,
                    stat_entries=stat_entries)


# ---------------------------------------------------------------------------
# The score
# ---------------------------------------------------------------------------

@dataclass
class GeneStat:
    name: str
    column: int
    status: str                  # "used", "constant" (not in a z-score mean), "no_values" (every value missing)
    mean: Optional[float] = None
    sd: Optional[float] = None
    detected: Optional[float] = None     # fraction of cells with a non-zero value
    clipped: Optional[float] = None      # fraction of cells beyond the clip (z-score mean)

    def to_json(self) -> Dict[str, Any]:
        return {"name": self.name, "column": self.column, "status": self.status, "mean": self.mean,
                "sd": self.sd, "detected": self.detected, "clipped": self.clipped}


@dataclass
class ScoreResult:
    values: Optional[np.ndarray]           # float32, one per cell shown; None when there is no score
    reason: Optional[str]                  # why there is none
    genes: List[GeneStat] = field(default_factory=list)
    n_used: int = 0
    n_cells: int = 0                       # cells in the dataset (the reference population)
    n_shown: int = 0
    entries_read: int = 0
    max_in_flight_entries: int = 0
    seconds: float = 0.0
    controls: Optional[List[int]] = None   # control_adjusted: the control columns used
    n_controls_used: int = 0               # control_adjusted: controls that held a value
    input_kind: Optional[str] = None       # fraction_of_total: what the input looks like (core/matrix_kind.py)


NO_SCORE_MESSAGES = {
    "empty_signature": "The signature has no genes.",
    "no_gene_present": "None of the signature's genes is in this dataset.",
    "no_usable_gene": "Every gene of the signature is constant or has no values, so no score can be made.",
    "no_control_genes": "No control genes could be drawn: the genes of the signature fill every bin they fall in.",
}


def _canonical(rows: np.ndarray, vals: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Rows strictly increasing, repeated entries summed (as scipy reads them)."""
    if rows.size < 2 or bool(np.all(rows[1:] > rows[:-1])):
        return rows, vals
    order = np.argsort(rows, kind="stable")
    rows, vals = rows[order], vals[order]
    keep = np.concatenate(([True], rows[1:] != rows[:-1]))
    if keep.all():
        return rows, vals
    return rows[keep], np.add.reduceat(vals, np.flatnonzero(keep))


class _Accumulator:
    """The running sum for the cells shown, and what each gene tells about itself."""

    def __init__(self, recipe: Recipe, n_obs: int, shown: Optional[np.ndarray]):
        self.recipe, self.n_obs, self.shown = recipe, n_obs, shown
        self.n_shown = n_obs if shown is None else int(shown.size)
        self.zscore = recipe.method == "zscore_mean"
        self.indicator = recipe.method == "detected"          # a gene adds 1 where its value is above detect_above
        self.detect_above = recipe.detect_above
        self.divide = recipe.method in ("zscore_mean", "mean", "detected")   # sum and the share of the total are not averages
        self.clip = recipe.effective_clip
        self.acc = np.zeros(self.n_shown, dtype=np.float64 if self.n_shown <= FLOAT64_CELLS else np.float32)
        self.baseline = 0.0               # sum over sparse genes of the score of a cell holding zero
        self.missing_count: Optional[np.ndarray] = None   # per cell shown: genes whose value is missing
        self.n_used = 0
        self.stats: List[GeneStat] = []

    # -- helpers ----------------------------------------------------------
    def _clip(self, z):
        return z if self.clip is None else np.clip(z, -self.clip, self.clip)

    def _mark_missing(self, positions: Optional[np.ndarray]):
        """Count a missing value for each position (None: every cell shown is missing it)."""
        if self.missing_count is None:
            self.missing_count = np.zeros(self.n_shown, dtype=np.uint16)
        if positions is None:
            self.missing_count += 1
        else:
            self.missing_count[positions] += 1

    def _positions(self, rows: np.ndarray):
        """(positions among the cells shown, mask over ``rows`` of those shown)."""
        if self.shown is None:
            return rows, None
        pos = np.searchsorted(self.shown, rows)
        pos[pos == self.shown.size] = max(self.shown.size - 1, 0)
        hit = self.shown[pos] == rows if self.shown.size else np.zeros(rows.size, dtype=bool)
        return pos[hit], hit

    # -- one gene ---------------------------------------------------------
    def add(self, name: str, col: int, rows: Optional[np.ndarray], values: np.ndarray) -> None:
        """Take in one gene: its stored entries (``rows`` given) or its whole column (``rows`` None)."""
        if rows is None:
            self._add_column(name, col, np.asarray(values, dtype=np.float64))
        else:
            self._add_sparse(name, col, *_canonical(np.asarray(rows), np.asarray(values)))

    def _gene(self, name, col, n_finite, mean, sd, lo, hi, nonzero) -> Optional["GeneStat"]:
        """Record a gene's figures; the stat when it enters the score, None when it does not."""
        constant = lo == hi or not (sd > 0 and math.isfinite(sd))
        stat = GeneStat(name, col, "constant" if constant else "used", mean, 0.0 if constant else sd,
                        nonzero / self.n_obs, None)
        self.stats.append(stat)
        if constant and self.zscore:
            return None                                     # no spread, no z-score
        self.n_used += 1
        return stat

    def _add_column(self, name, col, v) -> None:
        """A whole column (dense store), one value per cell."""
        finite = np.isfinite(v)
        n_finite = int(finite.sum())
        if n_finite == 0:
            self.stats.append(GeneStat(name, col, "no_values"))
            return
        vf = v[finite]
        mean = float(vf.sum()) / n_finite
        centred = vf - mean
        sd = math.sqrt(float((centred * centred).sum()) / n_finite)
        stat = self._gene(name, col, n_finite, mean, sd, float(vf.min()), float(vf.max()), int(np.count_nonzero(vf)))
        if stat is None:
            return
        if self.zscore:
            z = centred / sd
            if self.clip is not None:
                stat.clipped = int((np.abs(z) > self.clip).sum()) / self.n_obs
            transformed = self._clip(z)
        elif self.indicator:
            transformed = (vf > self.detect_above).astype(np.float64)
        else:
            transformed = vf
        column = np.zeros(self.n_obs, dtype=np.float64)
        column[finite] = transformed
        if self.shown is not None:
            column, finite = column[self.shown], finite[self.shown]
        self.acc += column
        if not finite.all():
            self._mark_missing(np.flatnonzero(~finite))

    def _add_sparse(self, name, col, rows, values) -> None:
        """A gene's stored entries, worked through ``SEGMENT_ENTRIES`` at a time so a gene held by a
        large share of 100 million cells needs no array of its own size in float64."""
        n = self.n_obs
        seg = SEGMENT_ENTRIES
        bounds = [(i, min(i + seg, values.size)) for i in range(0, values.size, seg)]
        total, n_nan, nonzero = 0.0, 0, 0
        lo, hi = math.inf, -math.inf
        for i, j in bounds:                                       # pass 1: sum, range, count
            v = values[i:j].astype(np.float64)
            finite = np.isfinite(v)
            n_nan += int(v.size - finite.sum())
            vf = v[finite]
            if vf.size:
                total += float(vf.sum())
                lo, hi = min(lo, float(vf.min())), max(hi, float(vf.max()))
                nonzero += int(np.count_nonzero(vf))
        n_finite = n - n_nan
        if n_finite == 0:
            self.stats.append(GeneStat(name, col, "no_values"))
            return
        implicit = n - int(values.size)                          # cells with no stored entry hold zero
        if implicit:
            lo, hi = min(lo, 0.0), max(hi, 0.0)
        mean = total / n_finite
        squares = implicit * mean * mean
        for i, j in bounds:                                       # pass 2: spread
            v = values[i:j].astype(np.float64)
            d = v[np.isfinite(v)] - mean
            squares += float((d * d).sum())
        sd = math.sqrt(squares / n_finite)
        stat = self._gene(name, col, n_finite, mean, sd, lo, hi, nonzero)
        if stat is None:
            return
        # every cell holds z0; a stored entry adds what it differs by, a missing one cancels z0
        if self.zscore:
            z0 = float(self._clip(np.float64(-mean / sd)))
            over = implicit if self.clip is not None and abs(mean / sd) > self.clip else 0
        else:
            z0, over = 0.0, 0
        self.baseline += z0
        for i, j in bounds:                                       # pass 3: the cells' share
            v = values[i:j].astype(np.float64)
            finite = np.isfinite(v)
            correction = np.full(v.size, -z0, dtype=np.float64)
            if self.zscore:
                z = (v[finite] - mean) / sd
                if self.clip is not None:
                    over += int((np.abs(z) > self.clip).sum())
                correction[finite] = self._clip(z) - z0
            elif self.indicator:
                correction[finite] = (v[finite] > self.detect_above).astype(np.float64)
            else:
                correction[finite] = v[finite]
            pos, hit = self._positions(rows[i:j].astype(np.int64))
            self.acc[pos] += correction if hit is None else correction[hit]
            bad = ~finite if hit is None else ~finite[hit]
            if bad.any():
                self._mark_missing(pos[bad])
        if self.zscore and self.clip is not None:
            stat.clipped = over / n

    def result(self) -> Optional[np.ndarray]:
        if self.n_used == 0:
            return None
        total = self.acc + self.baseline if self.acc.dtype == np.float64 else self.acc + np.float32(self.baseline)
        if self.missing_count is None:
            out = total / self.n_used if self.divide else total
        else:
            denom = self.n_used - self.missing_count.astype(np.int64)
            with np.errstate(divide="ignore", invalid="ignore"):
                out = np.where(denom > 0, total / np.maximum(denom, 1) if self.divide else total, np.nan)
        return np.ascontiguousarray(out, dtype=np.float32)


def _pipeline(tasks: List[_Task], threads: int, budget: int) -> Iterator[Tuple[_Task, list, int]]:
    """Yield each task with its result, in order, reading ahead by at most ``budget`` entries.

    Memory is bounded by the budget plus the task being worked on, however many genes there
    are; order is fixed, so the arithmetic does not depend on the number of threads.
    The third item is the peak entries in flight so far. A read runs in a copy of the caller's
    context, so a remote store's request deadline reaches the reader threads.
    """
    pending: deque = deque()
    in_flight = peak = 0
    queue = deque(tasks)
    window = max(2 * threads, 2)
    with ThreadPoolExecutor(max_workers=max(threads, 1), thread_name_prefix="gene-score") as pool:
        try:
            while pending or queue:
                while queue and len(pending) < window and (not pending or in_flight + queue[0].entries <= budget):
                    task = queue.popleft()
                    pending.append((task, pool.submit(contextvars.copy_context().run, task.read)))
                    in_flight += task.entries
                    peak = max(peak, in_flight)
                task, future = pending.popleft()
                result = future.result()
                in_flight -= task.entries
                yield task, result, peak
        finally:
            for _, future in pending:
                future.cancel()


def compute(plan_: Plan, shown_rows: Optional[np.ndarray] = None,
            should_stop: Optional[Callable[[], bool]] = None) -> Iterator[Tuple[str, Any]]:
    """Score the cells ``shown_rows`` (sorted dataset rows; None: all cells).

    A generator of ``("progress", (genes_done, genes_total))`` events and a final
    ``("result", ScoreResult)``. Closing it stops the work after the read in progress.
    ``should_stop`` is asked between reads; true raises ``ScoreCancelled``.
    """
    started = time.perf_counter()
    recipe = plan_.recipe
    shown = None if shown_rows is None else np.asarray(shown_rows, dtype=np.int64)
    n_shown = plan_.n_obs if shown is None else int(shown.size)
    result = ScoreResult(values=None, reason=None, n_cells=plan_.n_obs, n_shown=n_shown)
    if not recipe.genes:
        result.reason = "empty_signature"
    elif not plan_.columns:
        result.reason = "no_gene_present"
    if result.reason:
        yield "result", result
        return
    adjusted = recipe.method == "control_adjusted"
    share = recipe.method == "fraction_of_total"
    # the control-adjusted score is two plain means (of the signature, and of its controls); the share of the total
    # is a plain sum divided by the cell's total
    own = dataclasses.replace(recipe, method="mean") if adjusted else (
        dataclasses.replace(recipe, method="sum") if share else recipe)
    acc = _Accumulator(own, plan_.n_obs, shown)
    control_acc = _Accumulator(own, plan_.n_obs, shown) if adjusted else None
    total = len(plan_.columns)
    done = 0
    yield "progress", (0, total)
    with open_source(plan_.reader, plan_.dataset_path, recipe.input) as source:
        controls = plan_.controls
        totals = None
        if share:
            totals = source.row_totals(should_stop)
            result.input_kind = matrix_kind.classify(source.sample())["kind"]
        if adjusted and controls is None:
            stat = source.column_stat(plan_.binning, should_stop)
            controls = [int(c) for c in choose_controls(stat, plan_.columns, recipe.effective_seed,
                                                        recipe.bins, recipe.controls)]
        if adjusted:
            result.controls = list(controls)
            if not controls:
                result.reason = "no_control_genes"
                result.seconds = time.perf_counter() - started
                yield "result", result
                return
            total += len(controls)
            yield "progress", (0, total)
        signature = set(plan_.columns)
        tasks = source.tasks(sorted(signature.union(controls or ())))
        for task, rows_values, peak in _pipeline(tasks, source.threads, READ_AHEAD_ENTRIES):
            if should_stop is not None and should_stop():
                raise ScoreCancelled()
            for col, rows, values in rows_values:
                if col in signature:
                    acc.add(plan_.names[col], col, rows, values)
                else:
                    control_acc.add(f"#{col}", col, rows, values)
                result.entries_read += int(values.size)
            result.max_in_flight_entries = max(result.max_in_flight_entries, peak)
            done += len(task.cols)
            yield "progress", (done, total)
    result.genes = sorted(acc.stats, key=lambda g: g.column)
    result.n_used = acc.n_used
    result.values = acc.result()
    if result.values is None:
        result.reason = "no_usable_gene"
    elif share:
        t = totals if shown is None else totals[shown]
        with np.errstate(divide="ignore", invalid="ignore"):
            ratio = result.values.astype(np.float64) / t
        result.values = np.ascontiguousarray(np.where(t > 0, 100.0 * ratio, np.nan), dtype=np.float32)
    elif adjusted:
        base = control_acc.result()
        result.n_controls_used = control_acc.n_used
        if base is None:
            result.values, result.reason = None, "no_control_genes"
        else:
            result.values = np.ascontiguousarray(result.values.astype(np.float64) - base.astype(np.float64),
                                                 dtype=np.float32)
    result.seconds = time.perf_counter() - started
    yield "result", result


class ScoreCancelled(Exception):
    pass
