"""``annzarro store check``: what in a store's layout makes AnnZarro slow.

    annzarro store check data/atlas.zarr
    annzarro store check https://host/atlas.zarr --json --fail-on warning

It reads metadata only (shapes, dtypes, chunks, attributes, the consolidated
metadata), never a chunk, so it takes a second or two on a 95.6-million-cell
store, local or remote, zarr format 2 or 3, sharded or not. Each finding says
how bad it is (``info``, ``warning``, ``slow``), what it costs in AnnZarro terms
(what one gene click or one cell click reads) and how to fix it with anndata or
zarr today. The limits are in layout_thresholds.py, shared with the server's
open-time notices (read_guard.chunking_notice), so the command and the server
never disagree.

The report is a dict (``check_store``), printed as text by ``format_report`` or
dumped as JSON; ``SCHEMA`` names the JSON layout.
"""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Iterator, List, Optional, Tuple

import numpy as np
import zarr

from . import layout_thresholds as T
from . import read_guard

SCHEMA = "annzarro-store-check/1"

DOCS = "https://annzarro.readthedocs.io/en/latest/data/chunking.html"

_SPARSE = ("csr_matrix", "csc_matrix")
_ZARR3 = int(zarr.__version__.split(".")[0]) >= 3


class StoreCheckError(RuntimeError):
    """The store cannot be opened or is not a zarr store; the message says why."""


@dataclass
class Finding:
    code: str
    severity: str
    element: str
    summary: str
    cost: str
    fix: str
    details: Dict[str, Any] = field(default_factory=dict)


def mb(n: float) -> str:
    """Bytes as the guard writes them ("MB" is 2**20)."""
    n = float(n)
    if n >= 2 ** 30:
        return f"{n / 2 ** 30:,.1f} GB"
    if n >= 2 ** 20:
        return f"{n / 2 ** 20:,.0f} MB"
    if n >= 2 ** 10:
        return f"{n / 2 ** 10:,.0f} KB"
    return f"{n:,.0f} B"


def _seconds(s: float) -> str:
    return f"{s * 1000:,.0f} ms" if s < 1 else f"{s:,.1f} s"


# --- opening --------------------------------------------------------------

def _open(path: str, max_read_mb: Optional[float]):
    """(root group, remote, consolidated) of the store at ``path``."""
    from .remote import is_remote_path, open_remote_group, RemotePolicy
    if is_remote_path(path):
        policy = RemotePolicy.from_config({"remote_stores": "allow"})
        try:
            root = open_remote_group(path, policy)
        except Exception as exc:
            raise StoreCheckError(str(exc)) from exc
        consolidated = getattr(getattr(root, "metadata", None), "consolidated_metadata", None) is not None
        if not consolidated:
            consolidated = type(getattr(root, "store", None)).__name__ == "ConsolidatedMetadataStore"
        return root, True, consolidated

    from .zarr_reader import consolidated_staleness, zarr_format_problem
    if not os.path.exists(path):
        raise StoreCheckError(f"{path} does not exist")
    if os.path.isfile(path):
        raise StoreCheckError(f"{path} is a file; store check reads zarr stores (a directory or URL). "
                              "An .h5ad file is read whole by AnnZarro; convert it with anndata first.")
    problem = zarr_format_problem(path)
    if problem:
        raise StoreCheckError(problem)
    if not any(os.path.exists(os.path.join(path, f)) for f in (".zgroup", ".zarray", "zarr.json")):
        raise StoreCheckError(f"{path} does not look like a zarr store (no .zgroup or zarr.json)")
    try:
        # a listing that no longer matches the disk is read around, as the reader does
        stale = consolidated_staleness(path)
        root = zarr.open_group(path, mode="r", **({"use_consolidated": False} if stale and _ZARR3 else {}))
    except Exception as exc:
        raise StoreCheckError(f"Cannot open {path}: {exc}") from exc
    if os.path.exists(os.path.join(path, ".zmetadata")):
        consolidated = True
    else:
        consolidated = getattr(getattr(root, "metadata", None), "consolidated_metadata", None) is not None
    return root, False, consolidated


def _members(group) -> List[Tuple[str, Any]]:
    try:
        return list(group.members())
    except AttributeError:
        return list(group.items())


def _is_array(node) -> bool:
    return hasattr(node, "shape") and hasattr(node, "dtype")


def _walk(group, prefix: str = "", depth: int = 0) -> Iterator[Tuple[str, Any]]:
    """Every node below ``group`` as (path, node), groups before their members."""
    try:
        members = _members(group)
    except Exception:
        return
    for name, node in members:
        path = f"{prefix}/{name}" if prefix else name
        yield path, node
        if not _is_array(node) and depth < 8:
            yield from _walk(node, path, depth + 1)


def _meta(arr) -> Dict[str, Any]:
    shape = tuple(int(d) for d in arr.shape)
    chunks = getattr(arr, "chunks", None)
    shards = getattr(arr, "shards", None)
    return {"shape": shape, "dtype": str(arr.dtype), "itemsize": int(getattr(arr.dtype, "itemsize", 8) or 8),
            "chunks": tuple(int(c) for c in chunks) if chunks else None,
            "shards": tuple(int(c) for c in shards) if shards else None}


def _files(meta: Dict[str, Any]) -> int:
    unit = meta["shards"] or meta["chunks"]
    if not unit or not meta["shape"]:
        return 1
    n = 1
    for size, c in zip(meta["shape"], unit):
        n *= max(1, -(-size // max(c, 1)))
    return n


def _chunk_bytes(meta: Dict[str, Any]) -> int:
    unit = meta["chunks"]
    if not unit:
        return 0
    n = 1
    for c in unit:
        n *= c
    return n * meta["itemsize"]


def _nbytes(meta: Dict[str, Any]) -> int:
    n = 1
    for d in meta["shape"]:
        n *= d
    return n * meta["itemsize"]


def _chunks_text(meta: Dict[str, Any]) -> str:
    text = str(meta["chunks"]) if meta["chunks"] else "-"
    return text + (f" in shards {meta['shards']}" if meta["shards"] else "")


# --- fix snippets ---------------------------------------------------------

def _slot(label: str) -> str:
    """``layers/counts`` -> ``adata.layers["counts"]``; ``X`` -> ``adata.X``."""
    if "/" not in label:
        return f"adata.{label}"
    group, key = label.split("/", 1)
    return f'adata.{group}["{key}"]'


FIX_CSC = '''import anndata as ad, scipy.sparse as sp
adata = ad.read_zarr(path)          # needs about 2.5x the matrix in memory while converting
{slot} = sp.csc_matrix({slot})
adata.write_zarr(path + ".new")          # a new store: check it, then swap it in'''

FIX_CSR = '''import anndata as ad, scipy.sparse as sp
adata = ad.read_zarr(path)
{slot} = sp.csr_matrix({slot})
adata.write_zarr(path + ".new")'''

FIX_FLOAT32 = '''import anndata as ad
adata = ad.read_zarr(path)
{slot} = {slot}.astype("float32")
adata.write_zarr(path + ".new")'''

FIX_RECHUNK = '''import anndata as ad, zarr
g = zarr.open_group(path, mode="r+", use_consolidated=False)
slot, key = "{group}", "{key}"
ad.io.write_elem(g[slot], key, g[slot][key][...], dataset_kwargs={{"chunks": {chunks}}})
zarr.consolidate_metadata(path)     # without this the old chunking is still advertised'''

FIX_SHARD = '''import anndata as ad, zarr
# needs zarr >= 3 (Python 3.11+) on every server that reads the store
g = zarr.open_group(path, mode="r+", use_consolidated=False)
for slot in ("X", "layers", "obsp", "varp"):
    ...   # rewrite each large dense array with dataset_kwargs={{"chunks": chunks, "shards": shards}}
zarr.consolidate_metadata(path)     # see docs/data/preparing-a-store.md for chunks and shard_shape'''

FIX_CATEGORY = '''import anndata as ad
adata = ad.read_zarr(path)
adata.{axis}["{col}"] = adata.{axis}["{col}"].astype("category")   # codes of the smallest integer type
adata.write_zarr(path + ".new")'''

FIX_CONSOLIDATE = 'import zarr\nzarr.consolidate_metadata(path)'


def _fix(template: str, path: str, **kw) -> str:
    """A snippet from ``template`` that names the store once, as ``path``."""
    return f'path = "{path}"\n' + template.format(**kw)


# --- the checks -----------------------------------------------------------

class _Checker:
    def __init__(self, root, path: str, remote: bool, consolidated: bool, limit_bytes: int):
        self.root, self.path, self.remote, self.consolidated = root, path, remote, consolidated
        self.limit = limit_bytes
        self.findings: List[Finding] = []
        self.arrays: List[Dict[str, Any]] = []

    def add(self, code, severity, element, summary, cost, fix, **details):
        self.findings.append(Finding(code, severity, element, summary, cost, fix, details))

    # -- arrays --

    def _row(self, label, encoding, meta, **extra):
        row = {"element": label, "encoding": encoding, "shape": list(meta["shape"]),
               "dtype": meta["dtype"], "chunks": list(meta["chunks"]) if meta["chunks"] else None,
               "shards": list(meta["shards"]) if meta["shards"] else None,
               "gene_column_bytes": None, "cell_row_bytes": None,
               "gene_column_seconds": None, "cell_row_seconds": None, "severity": "ok"}
        row.update(extra)
        self.arrays.append(row)
        return row

    def sparse(self, label: str, group, primary: str):
        """A CSR/CSC member. ``primary``: the read the UI makes most, "column"
        (a gene, for X and layers) or "row" (obsp/varp)."""
        fmt = group.attrs.get("encoding-type")
        shape = tuple(int(d) for d in group.attrs.get("shape", ()))
        if len(shape) != 2 or "data" not in group or "indices" not in group:
            return
        data, idx = _meta(group["data"]), _meta(group["indices"])
        nnz = data["shape"][0]
        csr = fmt == "csr_matrix"
        major = shape[0] if csr else shape[1]
        avg = nnz / max(major, 1)
        along = (max(avg * data["itemsize"], min(_chunk_bytes(data), _nbytes(data)))
                 + max(avg * idx["itemsize"], min(_chunk_bytes(idx), _nbytes(idx))))
        across = nnz * (data["itemsize"] + idx["itemsize"])
        scan_s = nnz * T.SCAN_NS_PER_NONZERO * 1e-9
        row_b, col_b = (along, across) if csr else (across, along)
        row_s, col_s = (None, scan_s) if csr else (scan_s, None)
        # a "row" of obsp/varp is the read; X and layers are read by gene column most
        info = self._row(label, "csr" if csr else "csc", dict(data, shape=shape, chunks=None, shards=None),
                         gene_column_bytes=int(col_b), cell_row_bytes=int(row_b),
                         gene_column_seconds=col_s, cell_row_seconds=row_s, nnz=nnz)
        wrong_primary = (primary == "column" and csr) or (primary == "row" and not csr)
        worst_s = col_s if primary == "column" else row_s
        want = "csc" if primary == "column" else "csr"
        want_not = "csr" if want == "csc" else "csc"
        fix = _fix(FIX_CSC if want == "csc" else FIX_CSR, self.path, slot=_slot(label))
        if wrong_primary and worst_s >= T.SPARSE_INFO_S:
            sev = ("slow" if worst_s >= T.SPARSE_SLOW_S else
                   "warning" if worst_s >= T.SPARSE_WARNING_S else "info")
            what = "Each gene click" if primary == "column" else "Each cell click"
            self.add("sparse_wrong_direction", sev, label,
                     f"{label} is {want_not.upper()} ({shape[0]:,} x {shape[1]:,}, {nnz:,} non-zeros) and is "
                     f"read by {'gene column' if primary == 'column' else 'row'}.",
                     f"{what} reads every non-zero value of {label}: ~{mb(across)} "
                     f"(about {_seconds(worst_s)} warm and local, longer over a network), "
                     f"against ~{mb(along)} from {want.upper()}.",
                     fix, estimated_seconds=round(worst_s, 4), read_bytes=int(across),
                     read_bytes_in_right_direction=int(along), nnz=nnz, format=fmt)
            info["severity"] = sev
        elif not wrong_primary and primary == "column":
            # X or a layer in CSC: the cell read scans everything. Two features make it:
            # a Gene Plot coloured by the matrix, and a table column of a named cell's expression
            if row_s is not None and row_s >= T.SPARSE_INFO_S:
                sev = "warning" if across >= T.CELL_ROW_WARNING_BYTES else "info"
                self.add("sparse_cell_direction", sev, label,
                         f"{label} is CSC: gene columns are cheap, cell rows are not.",
                         f"Colouring a Gene Plot by {label}, and a table column of a named cell's expression, "
                         f"read a cell row: every non-zero value of {label}, ~{mb(across)} "
                         f"(about {_seconds(row_s)} warm and local), against ~{mb(along)} "
                         "from CSR. Inherent to one stored direction; keep a CSR copy as a layer if cell "
                         "reads matter more.",
                         "# store the matrix a second time in the other direction\n"
                         + _fix(FIX_CSR, self.path, slot=_slot(label)),
                         estimated_seconds=round(row_s, 4), read_bytes=int(across), nnz=nnz)
        self.sparse_parts(label, data, idx, group)
        self.float64(label, data, _slot(label))

    def sparse_parts(self, label, data, idx, group):
        for name, meta in (("data", data), ("indices", idx)):
            self.chunk_size(f"{label}/{name}", meta, label)

    def dense(self, label: str, node, kind: str):
        """A dense 2-D member. kind: "matrix" (X, layers), "pairwise" (obsp/varp), "embedding" (obsm)."""
        meta = _meta(node)
        if len(meta["shape"]) != 2:
            return
        shape, chunks, isz = meta["shape"], meta["chunks"], meta["itemsize"]
        row = self._row(label, "dense", meta)
        flagged = False
        if kind == "matrix" and chunks and shape[0] and shape[1]:
            col_b = T.dense_gene_column_bytes(shape, chunks, isz)
            row_b = T.dense_cell_row_bytes(shape, chunks, isz)
            ideal = T.layer_chunks(*shape)
            for what, got, base, unit in (
                    ("gene click", col_b, T.dense_gene_column_bytes(shape, ideal, isz), "gene column"),
                    ("cell click", row_b, T.dense_cell_row_bytes(shape, ideal, isz), "cell row")):
                ratio = got / max(base, 1)
                sev = ("slow" if ratio >= T.DENSE_SLOW_FACTOR and got >= T.DENSE_SLOW_BYTES else
                       "warning" if ratio >= T.DENSE_WARNING_FACTOR and got >= T.DENSE_WARNING_BYTES else None)
                if sev:
                    flagged = True
                    self.add("dense_chunk_shape", sev, label,
                             f"{label} is dense {shape[0]:,} x {shape[1]:,} {meta['dtype']} with chunks {chunks}, "
                             f"which follow neither axis of the matrix.",
                             f"Each {what} decompresses ~{mb(got)} (a {unit} from chunks {ideal} would read "
                             f"~{mb(base)}, {ratio:,.0f}x less).",
                             _fix(FIX_RECHUNK, self.path, group=label.split("/")[0],
                                  key=label.split("/", 1)[1] if "/" in label else label, chunks=ideal)
                             + ("\n# X is rewritten with adata.write_zarr(path, chunks=...)" if label == "X" else ""),
                             decompressed_bytes=int(got), ideal_bytes=int(base), suggested_chunks=list(ideal),
                             read=unit)
            sev_order = [f.severity for f in self.findings if f.element == label and f.code == "dense_chunk_shape"]
            if sev_order:
                row["severity"] = max(sev_order, key=T.SEVERITIES.index)
            row["gene_column_bytes"], row["cell_row_bytes"] = int(col_b), int(row_b)
        elif kind == "pairwise" and chunks:
            need = read_guard.chunk_working_set(node, [0])
            row["cell_row_bytes"] = int(need)
        if not flagged:
            # pairwise rows are read whole, so the recommended (1, 8192) chunks are small on purpose
            self.chunk_size(label, meta, label, small=kind != "pairwise")
        self.float64(label, meta, _slot(label))

    def pairwise_notice(self):
        """Dense obsp/varp rows over the server's limit: the open-time notice's own logic."""
        items = read_guard.pairwise_chunking_items(self.root, self.limit)
        for item in items:
            self.add("pairwise_row_read", "slow", item["element"],
                     f"{item['element']} is dense {item['shape'][0]:,} x {item['shape'][1]:,} with chunks "
                     f"{tuple(item['chunks'])}; reading one row decompresses whole chunks.",
                     f"Focusing a cell reads one row: it holds ~{item['row_read_mb']:,.0f} MB, more than the "
                     f"server's read limit of {mb(self.limit)} (server.max_read_mb), so focusing a cell is "
                     "refused.",
                     _fix(FIX_RECHUNK, self.path, group=item["element"].split("/")[0],
                          key=item["element"].split("/", 1)[1], chunks="(1, 8192)")
                     + "\n# chunks of whole rows, a few thousand columns: (1, 8192) to (64, 8192)",
                     row_read_mb=item["row_read_mb"], chunks=item["chunks"], suggested_chunks=[1, 8192])
        for row in self.arrays:
            for item in items:
                if row["element"] == item["element"]:
                    row["severity"] = "slow"

    # -- individual rules --

    def float64(self, label, meta, slot):
        if meta["dtype"] != "float64":
            return
        size = _nbytes(meta)
        if size < T.FLOAT64_INFO_BYTES:
            return
        sev = "warning" if size >= T.FLOAT64_WARNING_BYTES else "info"
        self.add("float64", sev, label,
                 f"{label} is float64.",
                 f"Every read decompresses and sends twice the bytes of float32 "
                 f"(stored {mb(size)}, {mb(size / 2)} as float32). Fine if the values need double precision.",
                 _fix(FIX_FLOAT32, self.path, slot=slot), stored_bytes=int(size))

    def chunk_size(self, label, meta, element, small=True):
        cb = _chunk_bytes(meta)
        if not cb:
            return
        n_chunks = _files(dict(meta, shards=None))
        if cb > T.CHUNK_MAX_BYTES and _nbytes(meta) > T.CHUNK_MAX_BYTES:
            self.add("chunk_too_large", "warning", label,
                     f"{label} has chunks of {mb(cb)} uncompressed {meta['chunks']} (guidance: about 2 MB).",
                     f"Every read that touches the array decompresses at least {mb(cb)}.",
                     "# rewrite with chunks of about 5e5 values; docs/data/chunking.md has the rule and a snippet",
                     chunk_bytes=int(cb))
        elif small and cb < T.CHUNK_MIN_BYTES and n_chunks >= T.CHUNK_MIN_COUNT:
            self.add("chunk_too_small", "warning", label,
                     f"{label} has {n_chunks:,} chunks of {mb(cb)} {meta['chunks']} (guidance: about 2 MB).",
                     f"Every read pays one file open and one decompression per chunk: {n_chunks:,} files "
                     "for this array alone, slow on a network filesystem.",
                     "# rewrite with chunks of about 5e5 values; docs/data/chunking.md has the rule and a snippet",
                     chunks=n_chunks, chunk_bytes=int(cb))

    # -- obs / var --

    def dataframe(self, axis: str, group):
        n_rows = None
        try:
            index_name = group.attrs.get("_index", "_index")
            if index_name in group:
                imeta = _meta(group[index_name])
                n_rows = imeta["shape"][0] if imeta["shape"] else None
                if n_rows:
                    self.index(axis, imeta, n_rows)
        except Exception:
            pass
        for name, node in _members(group):
            if name == group.attrs.get("_index", "_index"):
                continue
            label = f"{axis}/{name}"
            try:
                if _is_array(node):
                    m = _meta(node)
                    enc = node.attrs.get("encoding-type", "")
                    if enc == "string-array" or m["dtype"] in ("object", "str", "StringDType()") \
                            or m["dtype"].startswith(("<U", "|S", "string")) or m["dtype"] == "O":
                        n = m["shape"][0] if m["shape"] else 0
                        if n >= T.STRING_COLUMN_ROWS:
                            self.add("obs_string_column", "warning", label,
                                     f"{label} is a plain string column of {n:,} values.",
                                     f"Colouring or filtering by it reads and decodes all {n:,} strings, then "
                                     "finds the categories (a categorical stores one small code per cell).",
                                     _fix(FIX_CATEGORY, self.path, axis=axis, col=name), rows=n)
                    elif m["dtype"] == "float64":
                        self.float64(label, m, f'adata.{axis}["{name}"]')
                elif node.attrs.get("encoding-type") == "categorical" and "codes" in node:
                    codes = _meta(node["codes"])
                    n = codes["shape"][0] if codes["shape"] else 0
                    if codes["dtype"] in ("int64", "uint64", "int32") and codes["itemsize"] >= 4 \
                            and "categories" in node:
                        k = int(node["categories"].shape[0])
                        small = 1 if k < 128 else 2 if k < 32768 else 4
                        if codes["itemsize"] > small:
                            size = n * codes["itemsize"]
                            saved = n * (codes["itemsize"] - small)
                            if size >= T.CODES_WARNING_BYTES:
                                self.add("categorical_wide_codes", "warning", label,
                                         f"{label} stores {k:,} categories as {codes['dtype']} codes.",
                                         f"Each colour or filter by it reads {mb(size)} of codes, "
                                         f"{mb(saved)} more than integer codes of {8 * small} bits need.",
                                         _fix(FIX_CATEGORY, self.path, axis=axis, col=name),
                                         code_bytes=int(size), categories=k, rows=n)
                    if "categories" in node and n >= T.STRING_COLUMN_ROWS and node["categories"].shape[0] > n // 2:
                        self.add("categorical_unique", "warning", label,
                                 f"{label} is a categorical with {int(node['categories'].shape[0]):,} categories "
                                 f"for {n:,} values.",
                                 "A categorical of almost unique values is a string column with extra steps: "
                                 "every use reads all the categories as well as the codes.",
                                 f'# store it as an index or free text; if it is a label, merge rare categories:\n'
                                 f'adata.{axis}["{name}"] = adata.{axis}["{name}"].cat.remove_unused_categories()',
                                 categories=int(node["categories"].shape[0]), rows=n)
            except Exception:
                continue

    def index(self, axis, imeta, n):
        chunk_rows = imeta["chunks"][0] if imeta["chunks"] else n
        if n >= T.INDEX_INFO_ROWS or chunk_rows > T.INDEX_MAX_CHUNK_ROWS:
            sev = ("warning" if n >= T.INDEX_WARNING_ROWS or chunk_rows > T.INDEX_MAX_CHUNK_ROWS else "info")
            cost = (f"The first name search (the Focused {'Cell' if axis == 'obs' else 'Gene'} picker, a subset) "
                    f"reads and decodes all {n:,} names, about {n / 10_000_000 * 1.1:,.1f} s, once per server "
                    "and axis")
            if chunk_rows > T.INDEX_MAX_CHUNK_ROWS:
                cost += f"; one chunk holds {chunk_rows:,} names and is decoded whole in memory"
            self.add("index_full_read", sev, f"{axis}/{self._index_name(axis)}",
                     f"The {axis} index has {n:,} names in chunks of {chunk_rows:,}.",
                     cost + ".",
                     "# nothing to change unless one chunk holds millions of names: write the index "
                     "in chunks of about a million\nadata.write_zarr(path)   # anndata's default chunks the index",
                     rows=n, chunk_rows=int(chunk_rows))

    def _index_name(self, axis):
        try:
            return self.root[axis].attrs.get("_index", "_index")
        except Exception:
            return "_index"

    # -- the whole store --

    def run(self, stale: Optional[str]):
        root = self.root
        nodes = list(_walk(root))
        n_files = 0
        n_chunks_total = 0
        biggest: List[Tuple[int, str]] = []
        for path, node in nodes:
            if _is_array(node):
                m = _meta(node)
                f = _files(m)
                n_files += f
                n_chunks_total += _files(dict(m, shards=None))
                biggest.append((f, path))
        slots = {name: node for name, node in _members(root)} if nodes else {}

        x = slots.get("X")
        if x is not None:
            if _is_array(x):
                self.dense("X", x, "matrix")
            elif x.attrs.get("encoding-type") in _SPARSE:
                self.sparse("X", x, "column")
        for slot, kind in (("layers", "matrix"), ("obsm", "embedding"), ("obsp", "pairwise"), ("varp", "pairwise")):
            group = slots.get(slot)
            if group is None or _is_array(group):
                continue
            for name, node in sorted(_members(group), key=lambda kv: kv[0]):
                label = f"{slot}/{name}"
                try:
                    if _is_array(node):
                        self.dense(label, node, kind)
                    elif node.attrs.get("encoding-type") in _SPARSE:
                        self.sparse(label, node, "row" if kind == "pairwise" else "column")
                except Exception:
                    continue
        if not any(k in slots for k in ("X", "obs", "var")):
            self.add("not_anndata", "warning", "(store)",
                     "The store has no X, obs or var: it is not a complete AnnData store.",
                     "AnnZarro has nothing to show from it. A write that was interrupted leaves this.",
                     "# write the store again\nadata.write_zarr(path)")
        self.pairwise_notice()
        for axis in ("obs", "var"):
            group = slots.get(axis)
            if group is not None and not _is_array(group):
                self.dataframe(axis, group)

        # store-wide
        fmt = getattr(getattr(root, "metadata", None), "zarr_format", 2)
        sharded = any(_meta(n)["shards"] for _, n in nodes if _is_array(n))
        self.zarr_format = int(fmt)
        self.n_nodes, self.n_files, self.n_chunks = len(nodes) + 1, n_files, n_chunks_total
        top = ", ".join(f"{p} ({f:,})" for f, p in sorted(biggest, reverse=True)[:3])
        if fmt == 3 and not sharded and n_chunks_total >= T.MANY_CHUNKS_V3:
            self.add("unsharded_many_chunks", "warning", "(store)",
                     f"This zarr format 3 store is not sharded and has {n_chunks_total:,} chunk files.",
                     f"Opening, copying and cold reads touch {n_chunks_total:,} small files, slow on a "
                     f"network filesystem. Largest: {top}. A sharded store keeps the same chunks in far "
                     "fewer files; AnnZarro reads only the chunks a request needs from a shard.",
                     _fix(FIX_SHARD, self.path), files=n_chunks_total)
        elif n_files >= T.MANY_FILES:
            self.add("many_files", "warning", "(store)",
                     f"The store has {n_files:,} chunk files.",
                     f"Opening, copying and cold reads touch {n_files:,} files, slow on a network "
                     f"filesystem. Largest: {top}.",
                     "# larger chunks (about 2 MB, docs/data/chunking.md), or zarr format 3 with shards:\n"
                     + _fix(FIX_SHARD, self.path), files=n_files)

        if not self.consolidated:
            nodes_n = len(nodes) + 1
            if self.remote:
                self.add("unconsolidated", "slow", "(store)",
                         "The store has no consolidated metadata (.zmetadata).",
                         f"Opening it reads the metadata of {nodes_n:,}+ groups and arrays one request at a time; "
                         "over HTTP its members may not be listable at all.",
                         "# on the machine that has the store; upload .zmetadata with it\n"
                         + _fix(FIX_CONSOLIDATE, self.path), nodes=nodes_n)
            elif nodes_n >= T.UNCONSOLIDATED_NODES:
                self.add("unconsolidated", "warning", "(store)",
                         "The store has no consolidated metadata (.zmetadata).",
                         f"Opening it reads the metadata files of {nodes_n:,} groups and arrays one by one: "
                         "milliseconds each on NFS, so seconds per open.",
                         _fix(FIX_CONSOLIDATE, self.path), nodes=nodes_n)
        if stale:
            self.add("stale_consolidated", "slow", "(store)",
                     f"The consolidated metadata is out of date: {stale}.",
                     "AnnZarro reads the store without it (slower to open), and zarr readers that trust it "
                     "see old chunking or miss elements.",
                     _fix(FIX_CONSOLIDATE, self.path))


def check_store(path: str, max_read_mb: Optional[float] = None) -> Dict[str, Any]:
    """The report for the store at ``path`` (a local directory or a URL).
    Metadata only. Raises StoreCheckError when it cannot be opened."""
    path = str(path)
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    root, remote, consolidated = _open(path, max_read_mb)
    limit = int(max_read_mb * 2 ** 20) if max_read_mb else read_guard.limit_bytes()
    stale = None
    if not remote and consolidated:
        from .zarr_reader import consolidated_staleness
        stale = consolidated_staleness(path)
    checker = _Checker(root, path, remote, consolidated, limit)
    checker.run(stale)
    findings = sorted(checker.findings, key=lambda f: (-T.SEVERITIES.index(f.severity), f.element, f.code))
    counts = {s: sum(1 for f in findings if f.severity == s) for s in T.SEVERITIES}
    from .. import __version__
    return {
        "schema": SCHEMA,
        "annzarro_version": __version__,
        "store": path,
        "remote": remote,
        "zarr_format": checker.zarr_format,
        "consolidated": bool(consolidated),
        "nodes": checker.n_nodes,
        "files": checker.n_files,
        "max_read_mb": round(limit / 2 ** 20, 1),
        "arrays": checker.arrays,
        "findings": [asdict(f) for f in findings],
        "counts": counts,
        "worst": next((s for s in reversed(T.SEVERITIES) if counts[s]), "ok"),
    }


def exceeds(report: Dict[str, Any], fail_on: str) -> bool:
    """True when the report has a finding at or above ``fail_on`` (never: "never")."""
    if fail_on == "never":
        return False
    floor = T.SEVERITIES.index(fail_on)
    return any(T.SEVERITIES.index(f["severity"]) >= floor for f in report["findings"])


# --- text -----------------------------------------------------------------

def format_report(report: Dict[str, Any]) -> str:
    out = [f"Store {report['store']}",
           f"  zarr format {report['zarr_format']}, "
           f"{'consolidated' if report['consolidated'] else 'NOT consolidated'} metadata, "
           f"{report['nodes']:,} nodes, {report['files']:,} chunk files"
           + (", remote" if report["remote"] else ""), ""]
    if report["arrays"]:
        out.append(f"{'array':34s} {'encoding':8s} {'shape':>20s} {'dtype':8s} {'chunks':30s} "
                   f"{'gene col':>9s} {'cell row':>9s}  verdict")
        for a in report["arrays"]:
            def cell(b):
                return mb(b) if b is not None else "-"
            chunks = str(tuple(a["chunks"])) if a["chunks"] else "-"
            if a["shards"]:
                chunks += f"/{tuple(a['shards'])}"
            out.append(f"{a['element'][:34]:34s} {a['encoding']:8s} {str(tuple(a['shape'])):>20s} "
                       f"{a['dtype']:8s} {chunks[:30]:30s} {cell(a['gene_column_bytes']):>9s} "
                       f"{cell(a['cell_row_bytes']):>9s}  {a['severity']}")
        out.append("")
    if not report["findings"]:
        out.append("No findings: nothing in this store's layout should make AnnZarro slow.")
    for f in report["findings"]:
        out.append(f"[{f['severity'].upper()}] {f['code']}: {f['element']}")
        out.append(f"  {f['summary']}")
        out.append(f"  Cost: {f['cost']}")
        out.append("  Fix:")
        out.extend("    " + line for line in f["fix"].splitlines())
        out.append("")
    c = report["counts"]
    out.append(f"{c['slow']} slow, {c['warning']} warning, {c['info']} info. "
               f"Rule and measurements: {DOCS}")
    return "\n".join(out)
