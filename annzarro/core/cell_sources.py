"""One per-cell column for any source setting, read in row slabs.

A *source* is the setting a cell plot or table already uses, ``{"type", "key", "column"?}``, and the column is one
value per cell of the dataset (or per cell of ``rows``, the cells shown)::

    obs      key: the obs column                       categorical, numeric, boolean, nullable or text
    obsm     key: the obsm key, column: the dimension  one column of a (cells x d) array, dense or sparse
    layer    key: "X" or a layer, column: the gene     one gene of the matrix (csc, csr or dense)
    obsp     key: the obsp key, column: the cell       the cell's row, over the cells shown
    table    ref: a name in ``sets``                   membership of a table's bitset over the cells shown

``gene-score`` and ``cell-group`` are not stored columns (a score is computed, a grouping is what this feeds) and are
refused. ``axis="var"`` (the gene side) is only a parameter: it raises ``NotBuilt``.

``column`` yields ``Slab``s of at most ``SLAB_ROWS`` cells that tile the cells shown in order, so memory is one slab
plus what the store must decode, not the whole column. ``rows`` is None (all cells) or the sorted, unique dataset rows.
A slab's ``kind`` says what ``values`` is:

    number     the stored numbers (a float column keeps NaN; a nullable integer column becomes float64 with NaN)
    bool       numpy bool; with a missing entry (a nullable boolean) an object array of True, False and None
    text       an object array of str
    category   the integer codes, -1 for a missing value; ``categories`` is the column's whole list, the same for every slab
    set         numpy bool, True for a cell in the table's bitset

A categorical column with more categories than ``categories.READ_ALL_MAX`` is refused (the readers renumber its codes
slab by slab, so the codes of two slabs would not mean the same thing), with the count: a grouping allows far fewer.

``cost`` says what a source asks of the store before anything is read. An obsm column is charged its whole matrix,
because zarr decodes every chunk it touches whole, so a 50 wide row-chunked float32 matrix costs its 50 columns
(CMP-13).
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterator, NamedTuple, Optional

import numpy as np

from . import categories as category_rules
from . import cost_limits
from . import gene_score as gs
from .zarr_reader import MissingKeyError

#: Most cells in one slab. A float32 slab is 16 MB; a stored column is read and cut into slabs of this size.
SLAB_ROWS = 1 << 22

#: The most cells a dataset may have for one of its obsp rows to be a per-cell source: the large-plot threshold
#: (requirements 8.6). A row is found by its cell's name, and the names of a larger dataset are not listed for that.
OBSP_MAX_CELLS = cost_limits.COST_LIMITS["obsp_source_max_cells"].default   # limits.obsp_source_max_cells

#: Read a contiguous run of cells (all cells, every slab of a full read) with a slice. Zarr turns a list of indices
#: into a fancy selection, about a quarter of the time of a 100M cell grouping; tests switch it off to compare.
USE_SLICES = True

#: Source types that are columns of the store, and the two that are not.
STORED = ("obs", "obsm", "layer", "obsp")
NOT_STORED = ("gene-score", "cell-group")


class CellSourceError(gs.ScoreError):
    """A source the engine refuses, with the HTTP status, reason code and extra fields the route sends."""


class NotBuilt(CellSourceError):
    """The gene side of a source: only the ``axis`` parameter exists (CNT-24)."""

    def __init__(self):
        super().__init__(501, "not_built", "Per-gene sources are not built.")


class Slab(NamedTuple):
    start: int                          # position of values[0] among the cells shown
    values: np.ndarray
    kind: str                           # number | bool | text | category | set
    categories: Optional[list] = None   # kind "category" only


@dataclass
class Cost:
    """What reading the source asks of the store, known without reading it."""
    entries: int            # stored values decoded, comparable with the score engine's entries
    layout: str             # column | csc | csr | dense
    n_cells: int
    heavy: bool = False     # a whole-column pass whose time the entries do not say: a text column (heavy lane)


# ---------------------------------------------------------------------------
# Opening
# ---------------------------------------------------------------------------

@contextmanager
def root(reader, dataset_path: str):
    """The open store: a zarr group or an HDF5 file (closed on leaving the block)."""
    from .h5ad_reader import h5adReader
    if isinstance(reader, h5adReader):
        from . import h5ad_reader as h5
        f = h5._open(dataset_path)
        try:
            yield f
        finally:
            f.close()
        return
    store = reader._get_root(dataset_path=dataset_path)
    if store is None:
        raise FileNotFoundError(f"Dataset path does not exist: {dataset_path}")
    yield store


def is_group(node) -> bool:
    """A zarr group or an HDF5 group (what has members), as against an array."""
    return hasattr(node, "keys")


def _key_not_found(what: str) -> CellSourceError:
    return CellSourceError(404, "key_not_found", f"This dataset has no {what}.")


def _check_obsp(n: int) -> None:
    """Refuse an obsp source on a dataset of more than ``OBSP_MAX_CELLS`` cells, before anything is read."""
    most = cost_limits.get("obsp_source_max_cells")
    if n > most:
        raise CellSourceError(422, "obsp_too_large", f"A row of an obsp matrix can be a source for up to "
                              f"{most:,} cells; this dataset has {n:,}. Use an obs or obsm column instead.",
                              count=int(n), limit=most)


def n_cells(store) -> int:
    """Cells of the dataset, from the length of the obs index; nothing is read."""
    if "obs" not in store:
        raise _key_not_found("obs table")
    obs = store["obs"]
    member = obs[obs.attrs.get("_index", "_index")]
    if is_group(member):
        for child in ("codes", "values"):
            if child in member:
                return int(member[child].shape[0])
        raise _key_not_found("cell index")
    return int(member.shape[0])


def _check_rows(rows, n: int) -> Optional[np.ndarray]:
    if rows is None:
        return None
    rows = np.asarray(rows)
    if rows.ndim != 1 or (rows.size and rows.dtype.kind not in "iu"):
        raise CellSourceError(400, "rows_invalid", "The cells shown must be a list of dataset rows.")
    rows = rows.astype(np.int64, copy=False)
    if rows.size and (rows.min() < 0 or rows.max() >= n or (np.diff(rows) <= 0).any()):
        raise CellSourceError(400, "rows_invalid", "The cells shown must be sorted, unique rows inside the dataset.",
                              n_cells=n)
    return rows


def _spans(total: int) -> Iterator[tuple]:
    step = max(int(SLAB_ROWS), 1)
    for a in range(0, total, step):
        yield a, min(a + step, total)


def _index(rows: Optional[np.ndarray], a: int, b: int) -> np.ndarray:
    return np.arange(a, b, dtype=np.int64) if rows is None else rows[a:b]


def _run(rows: Optional[np.ndarray], a: int, b: int) -> Optional[tuple]:
    """``(lo, hi)`` when the cells of slab ``a:b`` are the contiguous dataset rows ``lo:hi``, else None."""
    if not USE_SLICES or b <= a:
        return None
    if rows is None:
        return a, b
    lo, hi = int(rows[a]), int(rows[b - 1]) + 1           # rows are sorted and unique
    return (lo, hi) if hi - lo == b - a else None


def _is_zarr(reader) -> bool:
    from .h5ad_reader import h5adReader
    return not isinstance(reader, h5adReader)


def _plain_array(node, ndim: int) -> bool:
    return (not is_group(node) and getattr(node, "shape", None) is not None and len(node.shape) == ndim
            and np.dtype(node.dtype).kind in "biuf")


def _guard(should_stop) -> None:
    if should_stop is not None and should_stop():
        raise gs.ScoreCancelled()


def _gene_column(reader, dataset_path: str, name) -> int:
    """The column of gene ``name`` (the first, when ``var`` repeats it)."""
    names = reader.get_cell_gene_names(dataset_path, "genes")
    try:
        return list(names).index(name)
    except ValueError:
        raise _key_not_found(f"gene '{name}'") from None


def _cell_row(reader, dataset_path: str, column, n: int) -> int:
    """The dataset row of the cell an obsp source is about: named by its cell name, else by its row."""
    names = reader.get_cell_gene_names(dataset_path, "cells")
    text = str(column)
    try:
        return (names if isinstance(names, list) else list(names)).index(text)
    except ValueError:
        pass
    if text.isdigit() and int(text) < n:
        return int(text)
    raise _key_not_found(f"cell '{text}'")


def _describe(node):
    """``(shape, stored entries or None, layout)`` of a matrix member without reading its values."""
    if not is_group(node):
        shape = tuple(int(v) for v in node.shape)
        return shape, None, "dense"
    enc = str(node.attrs.get("encoding-type", ""))
    if enc in ("csr_matrix", "csc_matrix"):
        from . import h5ad_reader as h5
        shape = node.attrs.get("shape")
        shape = tuple(int(v) for v in shape) if shape is not None else h5._sparse_group_shape(node)
        indptr = node["indptr"]
        return tuple(shape), int(indptr[int(indptr.shape[0]) - 1]), enc[:3]
    return None, None, "column"


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def _uncached(reader, name: str, *args, **kwargs):
    """``reader.<name>(...)`` without the reader's cache: a slab is read once, and the cache would keep every one
    of them (200 to 300 MB at 100M cells). A reader whose method has no cache (a subset's) is called as it is."""
    method = getattr(reader, name)
    if hasattr(method, "__wrapped__"):
        kwargs["disable_caching"] = True
    return method(*args, **kwargs)


def _plain_obs(reader, dataset_path: str, key: str, idx: np.ndarray, run: Optional[tuple]):
    """The cells ``idx`` of a plain numeric or boolean obs column as stored, or None when the column is anything
    else (categorical, nullable, text). A numpy bool array is read as an array, as numbers are, not as a list of
    Python booleans."""
    from .h5ad_reader import h5adReader
    if isinstance(reader, h5adReader):
        import h5py
        from . import h5ad_reader as h5
        with root(reader, dataset_path) as store:
            node = store["obs"][key] if "obs" in store and key in store["obs"] else None
            if (node is None or is_group(node) or len(node.shape) != 1 or np.dtype(node.dtype).kind not in "biuf"
                    or isinstance(node.attrs.get("categories"), h5py.Reference)):
                return None
            return np.asarray(node[run[0]:run[1]]) if run is not None else np.asarray(h5._values(node, idx))
    from .zarr_reader import take_rows
    with root(reader, dataset_path) as store:
        node = store["obs"][key] if "obs" in store and key in store["obs"] else None
        if node is None or not _plain_array(node, 1):
            return None
        return np.asarray(node[run[0]:run[1]]) if run is not None else np.asarray(take_rows(node, idx))


def _as_obs(reader, dataset_path: str, key: str, idx: np.ndarray, kind: Optional[str],
            run: Optional[tuple] = None):
    """``(kind, values, categories)`` of the cells ``idx`` of an obs column. ``kind`` is what the first slab found."""
    if kind in (None, "number", "bool"):
        plain = _plain_obs(reader, dataset_path, key, idx, run)
        if plain is not None:
            return ("bool" if plain.dtype.kind == "b" else "number"), plain, None
    if kind in (None, "category"):
        got = _uncached(reader, "get_obs_var_codes", "cells", dataset_path, key, idx)
        if got is not None:
            return "category", np.asarray(got[0]), got[1]
    if kind in (None, "number"):
        numeric = _uncached(reader, "get_obs_var_numeric", "cells", dataset_path, key, idx)
        if numeric is not None:
            return "number", np.asarray(numeric), None
    listed = _uncached(reader, "get_obs_var", "cells", dataset_path, indices=idx.tolist(), column_names=[key],
                       include_categories=False)
    values = (listed.get("data") or {}).get(key)
    if values is None:
        raise _key_not_found(f"obs column '{key}'")
    present = [v for v in values if v is not None]
    if present and all(isinstance(v, (bool, np.bool_)) for v in present):
        if len(present) == len(values):
            return "bool", np.asarray(values, dtype=bool), None
        return "bool", np.asarray(values, dtype=object), None
    if all(isinstance(v, (int, float, np.integer, np.floating)) and not isinstance(v, (bool, np.bool_))
           for v in present):
        return "number", np.asarray([np.nan if v is None else v for v in values], dtype=np.float64), None
    return "text", np.asarray(values, dtype=object), None


class _Direct(NamedTuple):
    array: Any = None                   # a plain numeric or boolean column
    codes: Any = None                   # the codes of a categorical column
    dtype: Any = None                   # None for codes


def _direct_obs(reader, dataset_path: str, key: str):
    """``(_Direct, categories)`` when a zarr obs column can be sliced as stored, else ``(None, None)``."""
    if not USE_SLICES or not _is_zarr(reader):
        return None, None
    with root(reader, dataset_path) as store:
        node = store["obs"][key]
        if _plain_array(node, 1):
            return _Direct(array=node, dtype=node.dtype), None
        if (is_group(node) and node.attrs.get("encoding-type") == "categorical" and "codes" in node
                and "categories" in node and _plain_array(node["codes"], 1)):
            got = _uncached(reader, "get_obs_var_codes", "cells", dataset_path, key, np.zeros(1, dtype=np.int64))
            if got is not None:
                return _Direct(codes=node["codes"]), got[1]
    return None, None


def category_values(reader, dataset_path: str, key: str, categories: list) -> list:
    """The categories of an obs column as the store holds them. A reader lists them as Python values, which widens a
    float32 category to a float64 (0.1 becomes 0.10000000149011612); the level id is made from the stored number
    (``cell_groups.canonical_label``), so a column of a float type narrower than 64 bits gets numpy scalars of its own
    dtype back. Any other column is returned as it came."""
    try:
        with root(reader, dataset_path) as store:
            node = store["obs"][key]
            if is_group(node):
                member = node["categories"]
            else:                                       # an older h5ad: the categories are a referenced dataset
                import h5py
                ref = node.attrs.get("categories")
                member = store[ref] if isinstance(ref, h5py.Reference) else None
            dtype = np.dtype(member.dtype) if member is not None else None
    except (KeyError, TypeError, ValueError, AttributeError):
        return categories
    if dtype is None or dtype.kind != "f" or dtype.itemsize >= 8:
        return categories
    return [None if v is None else dtype.type(v) for v in categories]


def _text_node(reader, node) -> bool:
    """A plain array of strings (not a categorical or nullable group)."""
    if is_group(node) or getattr(node, "shape", None) is None or len(node.shape) != 1:
        return False
    if not _is_zarr(reader):
        import h5py
        return h5py.check_string_dtype(node.dtype) is not None or np.dtype(node.dtype).kind in "SU"
    return np.dtype(node.dtype).kind in "OUST"


def _read_text(reader, node, idx: np.ndarray, run: Optional[tuple]) -> np.ndarray:
    if not _is_zarr(reader):
        from . import h5ad_reader as h5
        if run is not None:
            data = np.asarray(node[run[0]:run[1]])
            return np.asarray([v.decode("utf-8") if isinstance(v, bytes) else v for v in data.tolist()], dtype=object)
        return np.asarray(h5._values(node, idx), dtype=object)
    from .zarr_reader import take_rows
    data = np.asarray(node[run[0]:run[1]] if run is not None else take_rows(node, idx))
    return data.astype(object)


def _text_slabs(reader, dataset_path, key, rows, total, should_stop) -> Iterator[Slab]:
    """A text column as categories: each slab is factorised against a running dictionary, so memory is the codes of
    the cells shown (two bytes each) and the distinct values, never a list of strings. The categories are sorted as
    the list path sorts them (``str``), and the codes are numbered by that order once the last slab is read. A column
    with more than ``READ_ALL_MAX`` distinct values is refused (``too_many_categories``)."""
    limit = category_rules.READ_ALL_MAX
    seen: Dict[str, int] = {}
    codes = np.full(total, 0xFFFF, dtype=np.uint16)
    for a, b in _spans(total):
        _guard(should_stop)
        with root(reader, dataset_path) as store:
            vals = _read_text(reader, store["obs"][key], _index(rows, a, b), _run(rows, a, b))
        missing = np.fromiter((v is None for v in vals), dtype=bool, count=vals.size)
        if missing.all():
            continue
        # a dictionary over the slab's strings: no fixed-width copy, whose size the longest string sets
        present = vals[~missing].tolist()
        ids = np.fromiter((seen.setdefault(v if type(v) is str else str(v), len(seen)) for v in present),
                          dtype=np.int64, count=len(present))
        if len(seen) > limit:
            raise CellSourceError(422, "too_many_categories",
                                  f"Column '{key}' has more than {limit} distinct values; the most a source can read is "
                                  f"{limit}.", count=len(seen), limit=limit)
        if len(seen) >= 0xFFFF and codes.dtype == np.uint16:
            codes = np.where(codes == 0xFFFF, np.uint32(0xFFFFFFFF), codes.astype(np.uint32)).astype(np.uint32)
        out = np.full(vals.size, codes.dtype.type(np.iinfo(codes.dtype).max), dtype=codes.dtype)
        out[~missing] = ids
        codes[a:b] = out
    order = sorted(seen)
    rank = np.empty(len(order) + 1, dtype=np.int32)
    for r, v in enumerate(order):
        rank[seen[v]] = r
    rank[-1] = -1
    sentinel = np.iinfo(codes.dtype).max
    for a, b in _spans(total):
        chunk = codes[a:b].astype(np.int64)
        chunk[chunk == sentinel] = len(order)
        yield Slab(a, rank[chunk], "category", order)


def _obs_slabs(reader, dataset_path, source, rows, total, should_stop) -> Iterator[Slab]:
    key = source.get("key")
    with root(reader, dataset_path) as store:
        if "obs" not in store or key not in store["obs"]:
            raise _key_not_found(f"obs column '{key}'")
        node = store["obs"][key]
        n_categories = None
        if is_group(node) and "categories" in node and hasattr(node["categories"], "shape"):
            n_categories = int(node["categories"].shape[0])
    if n_categories is not None and n_categories > category_rules.READ_ALL_MAX:
        raise CellSourceError(422, "too_many_categories",
                              f"Column '{key}' has {n_categories} categories; the most a source can read is "
                              f"{category_rules.READ_ALL_MAX}.", count=n_categories, limit=category_rules.READ_ALL_MAX)
    with root(reader, dataset_path) as store:
        textual = _text_node(reader, store["obs"][key])
    if textual:
        yield from _text_slabs(reader, dataset_path, key, rows, total, should_stop)
        return
    direct, categories = _direct_obs(reader, dataset_path, key)
    kind = None
    for a, b in _spans(total):
        _guard(should_stop)
        run = _run(rows, a, b) if direct is not None else None
        if run is not None:
            lo, hi = run
            if direct.dtype is None:                      # categorical: the stored codes
                yield Slab(a, np.asarray(direct.codes[lo:hi]), "category", categories)
            else:
                values = np.asarray(direct.array[lo:hi])
                yield Slab(a, values, "bool" if values.dtype.kind == "b" else "number")
            continue
        kind, values, categories_ = _as_obs(reader, dataset_path, key, _index(rows, a, b), kind, _run(rows, a, b))
        yield Slab(a, values, kind, categories_)


def _column_name(source) -> str:
    column = source.get("column")
    return "0" if column is None else str(column)


def _obsm_slabs(reader, dataset_path, source, rows, total, should_stop) -> Iterator[Slab]:
    key, column = source.get("key"), _column_name(source)
    member = position = None
    if USE_SLICES and _is_zarr(reader):
        with root(reader, dataset_path) as store:
            if "obsm" in store and key in store["obsm"] and _plain_array(store["obsm"][key], 2):
                member = store["obsm"][key]
        if member is not None:
            try:
                position = reader._column_position(column, member.shape[1], "obsm", key)
            except MissingKeyError as e:
                raise CellSourceError(404, "key_not_found", str(e)) from e
    for a, b in _spans(total):
        _guard(should_stop)
        run = _run(rows, a, b) if member is not None else None
        if run is not None:
            yield Slab(a, np.asarray(member[run[0]:run[1], position]), "number")
            continue
        try:
            got = _uncached(reader, "get_obsm_varm", "cells", key, dataset_path, indices=_index(rows, a, b),
                            column_name=column)
        except MissingKeyError as e:
            raise CellSourceError(404, "key_not_found", str(e)) from e
        got = np.asarray(got)
        if got.size == 0:
            raise _key_not_found(f"obsm '{key}'")
        yield Slab(a, got.reshape(-1), "number")


def _obsp_slabs(reader, dataset_path, source, rows, total, should_stop) -> Iterator[Slab]:
    key = source.get("key")
    with root(reader, dataset_path) as store:
        if "obsp" not in store or key not in store["obsp"]:
            raise _key_not_found(f"obsp '{key}'")
        n = n_cells(store)
    _check_obsp(n)
    cell = _cell_row(reader, dataset_path, source.get("column"), n)
    member = None
    if USE_SLICES and _is_zarr(reader):
        with root(reader, dataset_path) as store:
            if _plain_array(store["obsp"][key], 2):
                member = store["obsp"][key]
    for a, b in _spans(total):
        _guard(should_stop)
        run = _run(rows, a, b) if member is not None else None
        if run is not None:
            yield Slab(a, np.asarray(member[cell, run[0]:run[1]]), "number")
            continue
        got = np.asarray(_uncached(reader, "get_obsp_varp", key, "cells", dataset_path, row_indices=[cell],
                                   col_indices=_index(rows, a, b)))
        if got.size == 0:
            raise _key_not_found(f"obsp '{key}'")
        yield Slab(a, got.reshape(-1), "number")


def _layer_slabs(reader, dataset_path, source, rows, total, should_stop) -> Iterator[Slab]:
    col = _gene_column(reader, dataset_path, source.get("column"))
    with gs.open_source(reader, dataset_path, source.get("key") or "X") as matrix:
        _guard(should_stop)
        (_, at, values), = matrix.tasks([col])[0].read()
    at = None if at is None else np.asarray(at)          # as stored (int32 mostly): no int64 copy of the entries
    values = np.asarray(values)
    if at is not None and at.size > 1 and not bool(np.all(at[1:] > at[:-1])):
        order = np.argsort(at, kind="stable")
        at, values = at[order], values[order]
    for a, b in _spans(total):
        _guard(should_stop)
        if at is None:
            out = values[a:b] if rows is None else values[rows[a:b]]
        else:
            idx = _index(rows, a, b)
            out = np.zeros(idx.size, dtype=values.dtype)
            if at.size:
                # the rows in the entries' own type, so searchsorted does not cast the entries (a row fits: it is one)
                pos = np.searchsorted(at, idx.astype(at.dtype, copy=False) if at.dtype.kind in "iu" else idx)
                hit = (pos < at.size) & (at[np.minimum(pos, at.size - 1)] == idx)
                out[hit] = values[pos[hit]]
        yield Slab(a, out, "number")


def _table_slabs(source, rows, total, sets, should_stop) -> Iterator[Slab]:
    ref = source.get("ref")
    if not sets or ref not in sets:
        raise CellSourceError(400, "set_missing", f"The request has no set '{ref}'.")
    member = np.asarray(sets[ref], dtype=bool).reshape(-1)
    if member.size != total:
        raise CellSourceError(400, "set_length", f"Set '{ref}' holds {member.size} cells; {total} are shown.",
                              expected=total, got=int(member.size))
    for a, b in _spans(total):
        _guard(should_stop)
        yield Slab(a, member[a:b], "set")


def _refuse(source, axis: str) -> str:
    if axis != "obs":
        raise NotBuilt()
    kind = source.get("type")
    if kind in NOT_STORED:
        raise CellSourceError(400, "not_a_stored_column", f"A '{kind}' source is not a column of the dataset.")
    if kind not in STORED and kind != "table":
        raise CellSourceError(400, "unknown_source_type", f"Unknown source type '{kind}'.")
    return kind


def column(reader, dataset_path: str, source: Dict[str, Any], rows, *, axis: str = "obs",
           sets: Optional[Dict[str, Any]] = None, should_stop: Optional[Callable[[], bool]] = None) -> Iterator[Slab]:
    """The source's value for each of the cells ``rows`` (None: every cell), as slabs in order.

    ``sets`` maps the refs of ``table`` sources to a boolean array over the cells shown. ``should_stop`` is asked
    between slabs; true raises ``gene_score.ScoreCancelled``. Refusals are ``CellSourceError`` (``ScoreError``) and
    come with the first ``next()``, before any slab. Closing the iterator closes what it opened.
    """
    kind = _refuse(source, axis)
    with root(reader, dataset_path) as store:
        n = n_cells(store)
    rows = _check_rows(rows, n)
    total = n if rows is None else int(rows.size)
    if kind == "table":
        yield from _table_slabs(source, rows, total, sets, should_stop)
    elif kind == "obs":
        yield from _obs_slabs(reader, dataset_path, source, rows, total, should_stop)
    elif kind == "obsm":
        yield from _obsm_slabs(reader, dataset_path, source, rows, total, should_stop)
    elif kind == "obsp":
        yield from _obsp_slabs(reader, dataset_path, source, rows, total, should_stop)
    else:
        yield from _layer_slabs(reader, dataset_path, source, rows, total, should_stop)


# ---------------------------------------------------------------------------
# Cost
# ---------------------------------------------------------------------------

def cost(reader, dataset_path: str, source: Dict[str, Any], *, axis: str = "obs") -> Cost:
    """What the source costs, from the store's metadata; no column is read.

    obsm and obsp are charged their whole matrix: the whole array when dense, the stored entries when sparse.
    """
    kind = _refuse(source, axis)
    with root(reader, dataset_path) as store:
        n = n_cells(store)
        if kind == "obs":
            key = source.get("key")
            node = store["obs"][key] if "obs" in store and key in store["obs"] else None
            return Cost(n, "column", n, heavy=node is not None and _text_node(reader, node))
        if kind == "table":
            return Cost(0, "column", n)
        if kind in ("obsm", "obsp"):
            if kind == "obsp":
                _check_obsp(n)
            group = store[kind] if kind in store else None
            key = source.get("key")
            if group is None or key not in group:
                raise _key_not_found(f"{kind} '{key}'")
            shape, stored, layout = _describe(group[key])
            if stored is not None:
                return Cost(stored, layout, n)
            if shape is None:                            # a data frame: its columns
                width = len(group[key].attrs.get("column-order", ())) or 1
                return Cost(n * width, "column", n)
            return Cost(int(np.prod(shape)), layout, n)
    col = _gene_column(reader, dataset_path, source.get("column"))
    with gs.open_source(reader, dataset_path, source.get("key") or "X") as matrix:
        return Cost(int(matrix.entries([col])), matrix.layout, int(matrix.n_obs))
