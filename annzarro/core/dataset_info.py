"""What a dataset says about itself: attribution, README and AnnData structure, from metadata alone.

The dataset's owner records attribution in ``uns["annzarro"]`` (a group of text values; see
``docs/deployment/dataset-attribution.md``) and a description in ``uns["README"]`` (a Markdown
string). ``read_info`` returns up to three parts, each read only when asked for:

``about``
    ``title``, ``description``, ``license`` (an SPDX id or text), ``license_url``, ``citation``,
    ``doi``, ``authors``, ``source_url``, ``contact``, ``attribution``. Missing keys are left out.
    A dataset written by CELLxGENE (``uns["title"]``, ``uns["citation"]``) is accepted as a
    fallback. Links are only ever http(s) or mailto.
``readme``
    ``uns["README"]`` as text, cut at ``MAX_README_BYTES`` (and saying so).
``structure``
    ``n_obs``, ``n_vars``, the obs and var columns with their types, the keys of obsm, varm, obsp,
    varp and layers with their shapes, and the ``uns`` tree, each capped in size and depth.

It reads group listings, attributes, shapes and dtypes, and the few text values above (each only
after the store has said how big it is). Never X, never a matrix.
"""
from __future__ import annotations

import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import numpy as np

from . import dataset_schema, store_details
from .dataset_schema import FIELDS, MAX_FIELD_BYTES, contact_url as _contact_url, http_url as _http_url

__all__ = ["PARTS", "MAX_README_BYTES", "read_info", "InfoError"]

PARTS = ("about", "readme", "structure")

#: The README is cut here (UTF-8 bytes) and the reply says so.
MAX_README_BYTES = 256 * 1024
#: A text value stored bigger than this (compressed) is not read at all.
MAX_STORED_TEXT = 8 * 1024 * 1024
#: Longest accepted value of an attribution field (UTF-8 bytes); one long field is cut, not refused.
#: Names listed per group of the structure, and nodes and depth of the uns tree.
MAX_ITEMS = 200
MAX_UNS_NODES = 400
MAX_UNS_CHILDREN = 100
MAX_UNS_DEPTH = 4

#: Keys of ``uns`` that other tools write and that say the same thing (CELLxGENE: title, citation).
UNS_FALLBACKS = {"title": "title", "citation": "citation", "license": "license", "doi": "doi",
                 "description": "description"}
README_KEYS = ("README", "readme")

SPDX_URL = "https://spdx.org/licenses/{}.html"
#: Identifiers that get a link to spdx.org when ``license_url`` is not given.
SPDX_IDS = {
    "CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC-BY-NC-SA-4.0", "CC-BY-ND-4.0",
    "CC-BY-NC-ND-4.0", "CC-BY-3.0", "CC-BY-SA-3.0", "CC-BY-NC-3.0", "CC-BY-NC-SA-3.0", "MIT",
    "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "GPL-3.0-only", "GPL-3.0-or-later", "GPL-2.0-only",
    "LGPL-3.0-only", "AGPL-3.0-only", "MPL-2.0", "ODbL-1.0", "ODC-By-1.0", "PDDL-1.0", "Unlicense",
}
_DOI = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)?(10\.\d{4,9}/\S+)$", re.IGNORECASE)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_STRING_KINDS = ("S", "U", "O", "T")
_MISSING = object()
#: Bounds of the plain tree read from ``uns["annzarro"]``: depth, nodes, children of a group, items of a list.
TREE_DEPTH = 4
TREE_NODES = 300
TREE_CHILDREN = 100
TREE_LIST = 500


class InfoError(RuntimeError):
    """The store cannot be read as AnnData; the message says why."""


# ---- opening ---------------------------------------------------------------------------------

def _open_on_disk(path: str):
    """The root group of the local zarr store at ``path``, read from the files on disk, never from its
    consolidated listing: what is read is what is on disk now, and nothing else of the store is visited."""
    import zarr
    from .store_check import _ZARR3
    from .zarr_reader import zarr_format_problem
    problem = zarr_format_problem(path)
    if problem:
        raise InfoError(problem)
    if not any(os.path.exists(os.path.join(path, f)) for f in (".zgroup", ".zarray", "zarr.json")):
        raise InfoError(f"{os.path.basename(path)} does not look like a zarr store (no .zgroup or zarr.json)")
    try:
        return zarr.open_group(path, mode="r", **({"use_consolidated": False} if _ZARR3 else {}))
    except Exception as exc:
        raise InfoError(f"Cannot open {os.path.basename(path)}: {exc}") from exc


def _open_group(path: str, remote: bool, on_disk: bool = False):
    """(root, closer) of the store at ``path``; a store that is not AnnData raises InfoError.

    ``on_disk`` opens a local zarr store without its consolidated listing (``_open_on_disk``).
    """
    if remote:
        from . import zarr_reader
        return zarr_reader._get_root(path), (lambda: None)
    if os.path.isfile(path):
        if not path.endswith(".h5ad"):
            raise InfoError(f"{os.path.basename(path)} is a file but not an .h5ad")
        from .h5ad_reader import _open
        context = _open(path)
        file = context.__enter__()
        return file, (lambda: context.__exit__(None, None, None))
    if on_disk:
        return _open_on_disk(path), (lambda: None)
    from .store_check import StoreCheckError, _open
    try:
        root, _remote, _consolidated = _open(path, None)
    except StoreCheckError as exc:
        raise InfoError(str(exc)) from exc
    return root, (lambda: None)


def _is_group(node) -> bool:
    return hasattr(node, "attrs") and not hasattr(node, "dtype")


def _has(group, key: str) -> bool:
    try:
        return key in group
    except Exception:
        return False


def _names(group) -> List[str]:
    try:
        return [str(name) for name in group.keys()]
    except Exception:
        return []


# ---- text values -----------------------------------------------------------------------------

def _stored_bytes(node) -> Optional[int]:
    from .read_guard import _stored_bytes as zarr_stored
    size = zarr_stored(node)
    if size is not None:
        return size
    try:                                    # h5py
        return int(node.id.get_storage_size())
    except Exception:
        return None


def _decode(value) -> Optional[str]:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, str):
        return str(value)
    return None


def _cut(text: str, limit: int) -> Tuple[str, bool, int]:
    """(text cut to ``limit`` UTF-8 bytes, whether it was cut, its full size in bytes)."""
    data = text.encode("utf-8", errors="replace")
    if len(data) <= limit:
        return text, False, len(data)
    return data[:limit].decode("utf-8", errors="ignore"), True, len(data)


def _read_strings(node, limit_items: int = 1):
    """The strings of a text array: ``("ok", [str, ...])`` or ``(problem, None)``.

    ``problem`` is ``not_text`` (not a string array, or a group), ``too_large`` (stored bigger than
    ``MAX_STORED_TEXT``, not read) or ``unreadable``.
    """
    if not hasattr(node, "dtype") or not hasattr(node, "shape"):
        return "not_text", None
    if getattr(node.dtype, "kind", None) not in _STRING_KINDS and "string" not in str(node.dtype).lower():
        return "not_text", None
    count = 1
    for d in node.shape:
        count *= int(d)
    if len(node.shape) > 1 or count > limit_items:
        return "not_text", None
    stored = _stored_bytes(node)
    if stored is not None and stored > MAX_STORED_TEXT:
        return "too_large", None
    if stored is None and getattr(node.dtype, "kind", None) in ("U", "S"):
        if count * int(node.dtype.itemsize or 0) > MAX_STORED_TEXT:
            return "too_large", None
    try:
        value = node[()]
    except Exception:
        return "unreadable", None
    values = np.asarray(value, dtype=object).reshape(-1).tolist()
    out = [_decode(v) for v in values]
    if any(v is None for v in out):
        return "not_text", None
    return "ok", out


def _clean(text: str) -> str:
    return _CONTROL.sub("", text).strip()


def _read_field(node, limit: int = MAX_FIELD_BYTES):
    """(text or None, note or None) of one attribution value; a number or a group is not text."""
    status, values = _read_strings(node)
    if status != "ok":
        return None, status
    text = _clean(values[0]) if values else ""
    if not text:
        return None, "empty"
    return _cut(text, limit)[0], None


def _read_tree(node, path: str, state: Dict[str, Any], depth: int = 0):
    """``node`` of uns as plain Python (dicts, lists, strings, numbers), bounded in depth, nodes and size.

    Whatever cannot be read as one of those (a matrix, a too-large or too-deep member) is left out and its
    path appended to ``state["skipped"]``; the caller decides what that means.
    """
    state["nodes"] -= 1
    if state["nodes"] < 0:
        state["skipped"].append(path)
        return _MISSING
    if _is_group(node):
        if depth >= TREE_DEPTH:
            state["skipped"].append(path)
            return _MISSING
        out = {}
        names = _names(node)
        if state.get("by_name"):
            # read from disk, the members come in the filesystem's order: sort them, so the result (and,
            # past the cap, which members are read) does not change from one directory listing to the next
            names = sorted(names)
        for name in names[:TREE_CHILDREN]:
            try:
                value = _read_tree(node[name], f"{path}/{name}", state, depth + 1)
            except Exception:
                value = _MISSING
                state["skipped"].append(f"{path}/{name}")
            if value is not _MISSING:
                out[name] = value
        return out
    kind = getattr(getattr(node, "dtype", None), "kind", None)
    shape = tuple(int(d) for d in getattr(node, "shape", ()) or ())
    if kind in _STRING_KINDS or "string" in str(getattr(node, "dtype", "")).lower():
        status, values = _read_strings(node, TREE_LIST)
        if status != "ok":
            state["skipped"].append(path)
            return _MISSING
        return values[0] if not shape else values
    count = 1
    for d in shape:
        count *= d
    if len(shape) > 1 or count > TREE_LIST or not _stored_bytes_ok(node):
        state["skipped"].append(path)
        return _MISSING
    try:
        value = node[()]
    except Exception:
        state["skipped"].append(path)
        return _MISSING
    return value.item() if not shape and hasattr(value, "item") else np.asarray(value).tolist()


def _stored_bytes_ok(node) -> bool:
    size = _stored_bytes(node)
    return size is None or size <= MAX_STORED_TEXT


def _about_from(uns, by_name: bool = False) -> Dict[str, Any]:
    fields: Dict[str, Any] = {}
    ignored: List[str] = []
    fallbacks: List[str] = []
    unknown: List[str] = []
    schema = dataset_schema.normalise(None)["schema"]
    group = uns["annzarro"] if uns is not None and _has(uns, "annzarro") else None
    if group is not None and not _is_group(group):
        ignored.append("annzarro")
        group = None
    if group is not None:
        state = {"nodes": TREE_NODES, "skipped": [], "by_name": by_name}
        tree = _read_tree(group, "annzarro", state)
        result = dataset_schema.normalise(tree)
        fields.update(result["fields"])
        unknown = result["unknown"]
        schema = result["schema"]
        ignored.extend(f"annzarro/{name}" for name in result["ignored"])
        ignored.extend(p for p in state["skipped"] if p.count("/") == 1 and p not in ignored)
    from_annzarro = bool(fields)
    if uns is not None:
        for name, key in UNS_FALLBACKS.items():
            if name in fields or not _has(uns, key):
                continue
            value, _note = _read_field(uns[key])
            if value is not None:
                fields[name] = value
                fallbacks.append(key)
    # derived links; only http(s) and mailto ever leave here
    doi = fields.get("doi")
    match = _DOI.match(doi) if doi else None
    if match and "doi_url" not in fields:
        fields["doi"] = match.group(1)
        fields["doi_url"] = "https://doi.org/" + quote(match.group(1), safe="/()-._~:;")
    if "license" in fields and "license_url" not in fields:
        spdx = fields.get("license_id") or fields["license"]
        if spdx in SPDX_IDS:
            fields["license_url"] = SPDX_URL.format(spdx)
        elif _http_url(fields["license"]):
            fields["license_url"] = fields["license"]
    if "contact" in fields and "contact_url" not in fields:
        link = _contact_url(fields["contact"])
        if link:
            fields["contact_url"] = link
    source = "annzarro" if from_annzarro else ("uns" if fallbacks else None)
    has_readme = uns is not None and any(_has(uns, k) for k in README_KEYS)
    return {"present": bool(fields), "source": source, "fallbacks": fallbacks, "ignored": ignored,
            "unknown": unknown, "schema": schema, "has_readme": has_readme, **fields}


# ---- readme ----------------------------------------------------------------------------------

def _readme_from(uns) -> Dict[str, Any]:
    key = next((k for k in README_KEYS if uns is not None and _has(uns, k)), None)
    if key is None:
        return {"present": False, "text": None, "truncated": False, "bytes": 0, "problem": None}
    node = uns[key]
    status, values = _read_strings(node)
    if status != "ok":
        return {"present": True, "text": None, "truncated": False, "bytes": 0, "problem": status}
    text, cut, size = _cut(_CONTROL.sub("", values[0] if values else ""), MAX_README_BYTES)
    return {"present": bool(text.strip()), "text": text, "truncated": cut, "bytes": size,
            "limit_bytes": MAX_README_BYTES, "problem": None}


# ---- structure -------------------------------------------------------------------------------
#
# Each element is a typed entry named after the on-disk AnnData spec: ``encoding`` is the
# ``encoding-type`` attribute (``array``, ``csr_matrix``, ``dataframe``, ``categorical`` ...), ``shape``
# and ``dtype`` come from metadata, and anything specific to an encoding sits beside them
# (``nnz``, ``density``, ``columns``, ``categories``, ``ordered``, ``length``). Every list and
# label is capped and the reply says which caps it applied (``caps``).

#: Longest label (dtype, name, preview) in a structure reply, in characters.
LABEL_CHARS = 100
#: Column names listed for a dataframe in obsm or varm.
MAX_COLUMN_NAMES = 50
#: Categories whose labels (and colours) are read, per categorical column, and categorical columns read per request.
CATEGORY_LABELS = 10
MAX_LABEL_COLUMNS = 100
#: uns values previewed per request, and the longest colour list shown as swatches.
MAX_UNS_PREVIEWS = 100
MAX_SWATCHES = 15
#: Seconds a remote store's structure may take before the reply is cut where it is (``capped: "deadline"``).
REMOTE_BUDGET_S = 10.0
STANDARD_GROUPS = ("X", "obs", "var", "obsm", "varm", "obsp", "varp", "layers", "uns", "raw")
_SPARSE = ("csr_matrix", "csc_matrix")
_NULLABLE = ("nullable-integer", "nullable-boolean", "nullable-string-array")


class _Walk:
    """What one structure read may still spend: a deadline and the budgets of the optional small reads."""

    def __init__(self, remote: bool, budget_s: Optional[float] = None):
        self.remote = remote
        budget = REMOTE_BUDGET_S if budget_s is None else budget_s
        self.deadline = time.monotonic() + budget if remote else None
        self.capped: Optional[str] = None
        self.label_columns = MAX_LABEL_COLUMNS
        self.previews = MAX_UNS_PREVIEWS

    def over(self) -> bool:
        if self.deadline is not None and time.monotonic() > self.deadline:
            self.capped = "deadline"
        return self.capped == "deadline"


def _short(text, limit: int = LABEL_CHARS) -> str:
    text = _CONTROL.sub("", str(text))
    return text if len(text) <= limit else text[:limit - 1] + "\u2026"


def _dtype_label(dtype) -> str:
    kind = getattr(dtype, "kind", None)
    if kind == "V" and getattr(dtype, "names", None):
        return f"record, {len(dtype.names)} fields"
    if kind in _STRING_KINDS or "string" in str(dtype).lower():
        return "string"
    return _short(dtype)


def _shape_of(node) -> Optional[List[int]]:
    shape = getattr(node, "shape", None)
    if shape is None and hasattr(node, "attrs"):
        shape = node.attrs.get("shape")
    try:
        return [int(d) for d in shape] if shape is not None else None
    except Exception:
        return None


def _encoding(node) -> Optional[str]:
    try:
        return store_details._text(node.attrs.get("encoding-type"))
    except Exception:
        return None


def _frame_columns(group) -> List[str]:
    """The column names of a dataframe group in anndata's order (``column-order``), without the index."""
    index = store_details._text(group.attrs.get("_index", "_index")) or "_index"
    order = group.attrs.get("column-order")
    if order is not None and not isinstance(order, (str, bytes)):
        return [str(store_details._text(n)) for n in list(order)]
    return [n for n in _names(group) if n != index]


def _frame_rows(group) -> Optional[int]:
    try:
        index = store_details._text(group.attrs.get("_index", "_index")) or "_index"
        return int(group[index].shape[0])
    except Exception:
        return None


def _entry(name: str, node) -> Dict[str, Any]:
    """The typed entry of one obsm, varm, obsp, varp, layers or uns member, from metadata."""
    out: Dict[str, Any] = {"name": _short(name, 200)}
    if not _is_group(node):
        out.update(encoding="array", shape=_shape_of(node), dtype=_dtype_label(getattr(node, "dtype", None)))
        return out
    encoding = _encoding(node) or "group"
    out["encoding"] = encoding
    if encoding in _SPARSE:
        shape = _shape_of(node)
        out["shape"] = shape
        try:
            out["dtype"] = _dtype_label(node["data"].dtype)
            nnz = int(node["data"].shape[0])
            out["nnz"] = nnz
            cells = shape[0] * shape[1] if shape and len(shape) == 2 else 0
            out["density"] = nnz / cells if cells else None
        except Exception:
            pass
    elif encoding == "dataframe":
        names = _frame_columns(node)
        rows = _frame_rows(node)
        out["shape"] = [rows, len(names)] if rows is not None else None
        out["columns"] = len(names)
        out["column_names"] = [_short(n) for n in names[:MAX_COLUMN_NAMES]]
    elif encoding == "categorical":
        try:
            out["categories"] = int(node["categories"].shape[0])
            out["shape"] = [int(node["codes"].shape[0])]
            out["ordered"] = bool(node.attrs.get("ordered"))
        except Exception:
            pass
    elif encoding == "awkward-array":
        out["length"] = node.attrs.get("length")
        out["form"] = _short(node.attrs.get("form", ""), 200)
        try:
            out["length"] = int(out["length"])
        except Exception:
            out["length"] = None
    else:
        out["shape"] = _shape_of(node)
    return out


def _slot(root, slot: str, walk: _Walk) -> Dict[str, Any]:
    if not _has(root, slot) or not _is_group(root[slot]):
        return {"items": [], "total": 0}
    group = root[slot]
    names = _names(group)
    items = []
    for name in names[:MAX_ITEMS]:
        if walk.over():
            break
        try:
            items.append(_entry(name, group[name]))
        except Exception:
            items.append({"name": _short(name, 200), "encoding": "unreadable", "shape": None})
    return {"items": items, "total": len(names)}


def _stored_ok(node) -> bool:
    size = _stored_bytes(node)
    return size is None or size <= MAX_STORED_TEXT


def _head(node, n: int) -> Optional[List[str]]:
    """The first ``n`` values of a 1-D array as short text, or None when it is not small enough to read."""
    try:
        if len(node.shape) != 1 or not _stored_ok(node):
            return None
        values = np.asarray(node[:n], dtype=object).reshape(-1).tolist()
    except Exception:
        return None
    return [_short(_decode(v) if isinstance(v, (bytes, str)) else v) for v in values]


def _column(group, name: str, uns, walk: _Walk) -> Dict[str, Any]:
    out: Dict[str, Any] = {"name": _short(name, 200), "kind": "other", "dtype": None}
    try:
        node = group[name]
        encoding = _encoding(node)
        out["encoding"] = encoding or ("array" if not _is_group(node) else "group")
        out["kind"] = store_details._kind_of(node)
        out["nullable"] = encoding in _NULLABLE
        if out["kind"] == "categorical":
            categories = node["categories"]
            out["categories"] = int(categories.shape[0])
            out["dtype"] = _dtype_label(categories.dtype)
            out["ordered"] = bool(node.attrs.get("ordered"))
            out["codes_dtype"] = str(node["codes"].dtype)
            colours = uns[f"{name}_colors"] if uns is not None and _has(uns, f"{name}_colors") else None
            if colours is not None and not _is_group(colours):
                count = _shape_of(colours)
                out["colors"] = int(count[0]) if count else None
                out["colors_mismatch"] = out["colors"] is not None and out["colors"] != out["categories"]
            if not walk.remote and walk.label_columns > 0 and not walk.over():
                walk.label_columns -= 1
                labels = _head(categories, CATEGORY_LABELS)
                if labels is not None:
                    out["labels"] = labels
                if colours is not None and not _is_group(colours):
                    swatches = _head(colours, CATEGORY_LABELS)
                    if swatches is not None:
                        out["label_colors"] = swatches
        elif _is_group(node):
            out["dtype"] = _encoding(node)
        else:
            out["dtype"] = _dtype_label(node.dtype)
    except Exception:
        pass
    return out


def _table(root, axis: str, uns, walk: _Walk) -> Dict[str, Any]:
    if not _has(root, axis) or not _is_group(root[axis]):
        return {"columns": [], "total": 0, "index": None, "index_dtype": None}
    group = root[axis]
    names = _frame_columns(group)
    index = store_details._text(group.attrs.get("_index", "_index")) or "_index"
    try:
        index_dtype = _dtype_label(group[index].dtype)
    except Exception:
        index_dtype = None
    columns = []
    for n in names[:store_details.MAX_NAMES]:
        if walk.over():
            break
        columns.append(_column(group, n, uns, walk))
    return {"columns": columns, "total": len(names), "index": _short(index, 200), "index_dtype": index_dtype}


def _scalar_preview(node, name: str):
    """A short text for a scalar or a short ``*_colors`` list of uns, or None."""
    shape = _shape_of(node) or []
    count = 1
    for d in shape:
        count *= d
    if len(shape) > 1 or not _stored_ok(node):
        return None
    colours = name.endswith("_colors") and len(shape) == 1 and 0 < count <= MAX_SWATCHES
    if not colours and shape != []:
        return None
    kind = getattr(node.dtype, "kind", None)
    if kind not in _STRING_KINDS + ("i", "u", "f", "b"):
        return None
    try:
        values = np.asarray(node[()], dtype=object).reshape(-1).tolist()
    except Exception:
        return None
    texts = [_short(_decode(v) if isinstance(v, (bytes, str)) else v) for v in values]
    return {"colors": texts} if colours else {"value": texts[0] if texts else ""}


def _uns_node(name: str, node, depth: int, budget: List[int], walk: _Walk) -> Dict[str, Any]:
    budget[0] -= 1
    short = _short(name, 200)
    if not _is_group(node):
        out = {"name": short, "type": "array", "shape": _shape_of(node), "dtype": _dtype_label(getattr(node, "dtype", None))}
        if walk.previews > 0:
            preview = _scalar_preview(node, name)
            if preview is not None:
                walk.previews -= 1
                out.update(preview)
        return out
    encoding = _encoding(node)
    if encoding and encoding != "dict":
        return {**_entry(name, node), "type": "encoded"}      # a dataframe, categorical or sparse matrix is one thing
    out = {"name": short, "type": "group", "children": [], "total": 0}
    names = _names(node)
    out["total"] = len(names)
    if depth >= MAX_UNS_DEPTH:
        return out
    for child in names[:MAX_UNS_CHILDREN]:
        if budget[0] <= 0 or walk.over():
            break
        try:
            out["children"].append(_uns_node(child, node[child], depth + 1, budget, walk))
        except Exception:
            out["children"].append({"name": _short(child, 200), "type": "unreadable"})
    return out


def _raw_from(root, walk: _Walk) -> Optional[Dict[str, Any]]:
    if not _has(root, "raw") or not _is_group(root["raw"]):
        return None
    raw = root["raw"]
    out: Dict[str, Any] = {"shown_in_plots": False}
    try:
        out["X"] = _entry("X", raw["X"]) if _has(raw, "X") else None
        out["var_columns"] = len(_frame_columns(raw["var"])) if _has(raw, "var") and _is_group(raw["var"]) else 0
        out["varm_keys"] = [_short(n, 200) for n in _names(raw["varm"])[:MAX_ITEMS]] if _has(raw, "varm") and _is_group(raw["varm"]) else []
    except Exception:
        out["unreadable"] = True
    return out


def _structure_from(root, remote: bool = False, budget_s: Optional[float] = None) -> Dict[str, Any]:
    walk = _Walk(remote, budget_s)
    counts = store_details.counts_from_root(root)
    out: Dict[str, Any] = {"n_obs": counts["cells"], "n_vars": counts["genes"]}
    try:
        out["X"] = _entry("X", root["X"]) if _has(root, "X") else None
    except Exception:
        out["X"] = {"name": "X", "encoding": "unreadable", "shape": None}
    uns = root["uns"] if _has(root, "uns") and _is_group(root["uns"]) else None
    out["obs"] = _table(root, "obs", uns, walk)
    out["var"] = _table(root, "var", uns, walk)
    for slot in ("obsm", "varm", "obsp", "varp", "layers"):
        out[slot] = _slot(root, slot, walk)
    out["raw"] = _raw_from(root, walk)
    if uns is None:
        out["uns"] = {"name": "uns", "type": "group", "children": [], "total": 0}
    else:
        budget = [MAX_UNS_NODES]
        out["uns"] = _uns_node("uns", uns, 0, budget, walk)
        out["uns"]["capped"] = budget[0] <= 0
    out["other"] = [{"name": _short(n, 200), "encoding": _encoding(root[n]) or ("group" if _is_group(root[n]) else "array")}
                    for n in _names(root) if n not in STANDARD_GROUPS][:MAX_ITEMS]
    out["capped"] = walk.capped
    out["caps"] = {"columns": store_details.MAX_NAMES, "items": MAX_ITEMS, "uns_nodes": MAX_UNS_NODES,
                   "uns_children": MAX_UNS_CHILDREN, "uns_depth": MAX_UNS_DEPTH, "label_chars": LABEL_CHARS,
                   "category_labels": CATEGORY_LABELS, "label_columns": MAX_LABEL_COLUMNS, "column_names": MAX_COLUMN_NAMES,
                   "uns_previews": MAX_UNS_PREVIEWS, "remote_budget_s": REMOTE_BUDGET_S if remote else None}
    return out


# ---- entry -----------------------------------------------------------------------------------

def read_info(path: str, parts=PARTS, remote: bool = False, on_disk: bool = False) -> Dict[str, Any]:
    """The requested ``parts`` (``about``, ``readme``, ``structure``) of the store at ``path``.

    Args:
        path: The store.
        parts: Which parts to read.
        remote: Whether ``path`` is a remote store.
        on_disk: Read a local zarr store from its files, not its consolidated listing. The listing
            is otherwise checked against every metadata file of the store first, which on a networked
            filesystem is most of the cost; ``about`` and ``readme`` live in ``uns`` and need none of it.
            The members of an attribution group are then read in name order (the listing keeps the
            order they were written in): the same text, possibly joined in another order.

    Raises:
        InfoError: The store cannot be read as AnnData (the message says why).
    """
    unknown = [p for p in parts if p not in PARTS]
    if unknown:
        raise ValueError(f"unknown parts: {', '.join(unknown)}")
    path = str(path)
    try:
        root, close = _open_group(path, remote, on_disk=on_disk and not remote)
    except InfoError:
        raise
    except Exception as exc:
        if remote:
            raise
        raise InfoError(f"Cannot read {os.path.basename(path)} as AnnData: {exc}") from exc
    try:
        uns = root["uns"] if _has(root, "uns") and _is_group(root["uns"]) else None
        out: Dict[str, Any] = {}
        if "about" in parts:
            out["about"] = _about_from(uns, by_name=on_disk)
        if "readme" in parts:
            out["readme"] = _readme_from(uns)
        if "structure" in parts:
            out["structure"] = _structure_from(root, remote)
        return out
    except InfoError:
        raise
    except Exception as exc:
        if remote:
            raise
        raise InfoError(f"Cannot read {os.path.basename(path)} as AnnData: {exc}") from exc
    finally:
        close()
