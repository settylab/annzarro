"""Gene signature scores: one number per cell for a list of genes.

A signature is a *recipe*: genes plus how to score them. This module turns a
recipe and a store into a vector, over **all cells of the dataset** for the
reference statistics, and returns the values of the cells the caller shows.

Recipe (``version`` 1), a JSON object::

    {"genes": ["CD3E", "CD8A"],   # up genes, the signature; at most 2,000 distinct names
     "down": [],                  # reserved for up/down signatures; must be empty for now
     "input": "X",                # "X" or the name of a layer
     "method": "zscore_mean",     # "zscore_mean" (default) or "mean"; "control_adjusted" is reserved
     "clip": 10,                  # z-scores are clipped at +-clip: a number above 0, or null for no clipping
     "seed": null,                # reserved for control_adjusted: the seed of the control genes
     "version": 1}                # the algorithm version

Every field but ``genes`` is optional. A reserved field or method is *accepted
by the format* and refused by the engine with a reason until the step that
implements it, so adding it later changes no stored recipe.

Methods
    zscore_mean  mean over genes of clip((x - mu) / sd, +-clip); mu and sd over all cells, zeros included
    mean         mean over genes of x

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
import logging
import math
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Tuple

import numpy as np

logger = logging.getLogger(__name__)

#: Bumped when a change makes the same recipe give different numbers. Part of every cache key.
ALGORITHM_VERSION = 1

#: Distinct gene names one signature may hold.
MAX_GENES = 2000
#: Longest gene name accepted (names longer than any real one are a sign of a hostile request).
MAX_NAME_CHARS = 1000

DEFAULT_CLIP = 10.0
DEFAULT_METHOD = "zscore_mean"
METHODS = ("zscore_mean", "mean")
#: Named by the format, not yet computed.
RESERVED_METHODS = ("control_adjusted",)

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

_FIELDS = ("genes", "down", "input", "method", "clip", "seed", "version", "title")


@dataclass(frozen=True)
class Recipe:
    genes: Tuple[str, ...]
    down: Tuple[str, ...] = ()
    input: str = "X"
    method: str = DEFAULT_METHOD
    clip: Optional[float] = DEFAULT_CLIP
    seed: Optional[int] = None
    version: int = ALGORITHM_VERSION

    @property
    def effective_clip(self) -> Optional[float]:
        """The clip that changes the numbers: only the z-score mean clips."""
        return self.clip if self.method == "zscore_mean" else None

    def describe(self) -> Dict[str, Any]:
        return {"method": self.method, "input": self.input, "clip": self.effective_clip,
                "version": self.version, "genes": len(self.genes)}


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
    if len(genes) + len(down) > MAX_GENES:
        raise ScoreError(413, "too_many_genes",
                         f"A signature holds at most {MAX_GENES:,} genes; this one has {len(genes) + len(down):,}.",
                         limit=MAX_GENES, requested=len(genes) + len(down))
    if down:
        raise ScoreError(400, "down_not_available", "Down genes are not available yet; send the genes in 'genes'.")
    method = raw.get("method", DEFAULT_METHOD)
    if method in RESERVED_METHODS:
        raise ScoreError(400, "method_not_available", f"The method '{method}' is not available yet.")
    if method not in METHODS:
        raise ScoreError(400, "bad_method", f"Unknown method {method!r}; use one of {', '.join(METHODS)}.")
    clip = parse_clip(raw["clip"]) if "clip" in raw else DEFAULT_CLIP
    seed = raw.get("seed")
    if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2 ** 63):
        raise ScoreError(400, "bad_seed", "seed must be a whole number from 0 up, or null.")
    source = raw.get("input", "X")
    if not isinstance(source, str) or not source or len(source) > MAX_NAME_CHARS:
        raise ScoreError(400, "bad_recipe", "input must be 'X' or the name of a layer.")
    version = raw.get("version", ALGORITHM_VERSION)
    if isinstance(version, bool) or version != ALGORITHM_VERSION:
        raise ScoreError(400, "unsupported_version",
                         f"This server computes scores with algorithm version {ALGORITHM_VERSION}; "
                         f"the recipe asks for {version!r}.", supported=ALGORITHM_VERSION)
    return Recipe(genes=genes, down=down, input=source, method=method, clip=clip, seed=seed, version=ALGORITHM_VERSION)


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

    def close(self) -> None:
        pass


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

    def estimate(self) -> Dict[str, Any]:
        return {"entries": self.entries, "seconds": round(self.seconds, 2), "tier": self.tier,
                "live_max_s": LIVE_MAX_S, "auto_max_s": AUTO_MAX_S, "max_s": CONFIRM_MAX_S, "layout": self.layout,
                "n_cells": self.n_obs, "genes": len(self.columns), "genes_requested": len(self.recipe.genes),
                "genes_missing": len(self.missing)}


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


def plan(reader, dataset_path: str, recipe: Recipe) -> Plan:
    """Open the store, resolve the genes and estimate the read. Reads no gene."""
    genes = list(recipe.genes)
    var_names = reader.get_cell_gene_names(dataset_path, "genes") if genes else []
    with open_source(reader, dataset_path, recipe.input) as source:
        if genes and len(var_names) != source.n_var:
            raise ScoreError(500, "read_failed", f"The gene names ({len(var_names)}) do not match "
                                                 f"the matrix ({source.n_var} columns).")
        by_name, missing, duplicated = _resolve_names(var_names, genes)
        columns = sorted(set(by_name.values()))
        entries = source.entries(columns)
        seconds = estimate_seconds(source.layout, entries, source.remote) if columns else 0.0
        return Plan(dataset_path=dataset_path, reader=reader, recipe=recipe, n_obs=source.n_obs, n_var=source.n_var,
                    layout=source.layout, backend=source.backend, remote=source.remote, columns=columns,
                    names={col: name for name, col in by_name.items()}, missing=missing, duplicated=duplicated,
                    entries=entries, seconds=seconds, tier=tier_of(seconds))


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


NO_SCORE_MESSAGES = {
    "empty_signature": "The signature has no genes.",
    "no_gene_present": "None of the signature's genes is in this dataset.",
    "no_usable_gene": "Every gene of the signature is constant or has no values, so no score can be made.",
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
        n = self.n_obs
        v = np.asarray(values, dtype=np.float64)
        if rows is not None:
            rows, v = _canonical(np.asarray(rows, dtype=np.int64), v)
        finite = np.isfinite(v)
        n_finite = n - int(v.size - finite.sum())          # cells with a value, implicit zeros included
        if n_finite == 0:
            self.stats.append(GeneStat(name, col, "no_values"))
            return
        vf = v[finite]
        implicit = n - int(v.size) if rows is not None else 0
        mean = float(vf.sum()) / n_finite
        lo, hi = (float(vf.min()), float(vf.max())) if vf.size else (0.0, 0.0)
        if implicit:
            lo, hi = min(lo, 0.0), max(hi, 0.0)
        centred = vf - mean
        sd = math.sqrt((float((centred * centred).sum()) + implicit * mean * mean) / n_finite)
        constant = lo == hi or not (sd > 0 and math.isfinite(sd))
        stat = GeneStat(name, col, "constant" if constant else "used", mean, 0.0 if constant else sd,
                        int(np.count_nonzero(vf)) / n, None)
        self.stats.append(stat)
        if constant and self.zscore:
            return                                          # no spread, no z-score
        self.n_used += 1

        if self.zscore:
            z = centred / sd
            z0 = float(self._clip(np.float64(-mean / sd)))
            if self.clip is not None:
                over = int((np.abs(z) > self.clip).sum()) + (implicit if abs(mean / sd) > self.clip else 0)
                stat.clipped = over / n
            transformed = self._clip(z)
        else:
            z0, transformed = 0.0, vf

        if rows is None:
            column = np.zeros(n, dtype=np.float64)
            column[finite] = transformed
            if self.shown is not None:
                column, finite = column[self.shown], finite[self.shown]
            self.acc += column
            if not finite.all():
                self._mark_missing(np.flatnonzero(~finite))
            return
        # sparse: every cell holds z0; a stored entry adds what it differs by, a missing one cancels z0
        correction = np.full(v.size, -z0, dtype=np.float64)
        correction[finite] = transformed - z0
        self.baseline += z0
        pos, hit = self._positions(rows)
        self.acc[pos] += correction if hit is None else correction[hit]
        bad = ~finite if hit is None else ~finite[hit]
        if bad.any():
            self._mark_missing(pos[bad])

    def result(self) -> Optional[np.ndarray]:
        if self.n_used == 0:
            return None
        total = self.acc + self.baseline if self.acc.dtype == np.float64 else self.acc + np.float32(self.baseline)
        if self.missing_count is None:
            out = total / self.n_used
        else:
            denom = self.n_used - self.missing_count.astype(np.int64)
            with np.errstate(divide="ignore", invalid="ignore"):
                out = np.where(denom > 0, total / np.maximum(denom, 1), np.nan)
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
    acc = _Accumulator(recipe, plan_.n_obs, shown)
    total = len(plan_.columns)
    done = 0
    yield "progress", (0, total)
    with open_source(plan_.reader, plan_.dataset_path, recipe.input) as source:
        tasks = source.tasks(plan_.columns)
        for task, rows_values, peak in _pipeline(tasks, source.threads, READ_AHEAD_ENTRIES):
            if should_stop is not None and should_stop():
                raise ScoreCancelled()
            for col, rows, values in rows_values:
                acc.add(plan_.names[col], col, rows, values)
                result.entries_read += int(values.size)
            result.max_in_flight_entries = max(result.max_in_flight_entries, peak)
            done += len(task.cols)
            yield "progress", (done, total)
    result.genes = sorted(acc.stats, key=lambda g: g.column)
    result.n_used = acc.n_used
    result.values = acc.result()
    if result.values is None:
        result.reason = "no_usable_gene"
    result.seconds = time.perf_counter() - started
    yield "result", result


class ScoreCancelled(Exception):
    pass
