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
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import numpy as np

from . import store_details

__all__ = ["PARTS", "MAX_README_BYTES", "read_info", "InfoError"]

PARTS = ("about", "readme", "structure")

#: The README is cut here (UTF-8 bytes) and the reply says so.
MAX_README_BYTES = 256 * 1024
#: A text value stored bigger than this (compressed) is not read at all.
MAX_STORED_TEXT = 8 * 1024 * 1024
#: Longest accepted value of an attribution field (UTF-8 bytes); one long field is cut, not refused.
MAX_FIELD_BYTES = 16 * 1024
MAX_AUTHORS = 500
MAX_AUTHOR_BYTES = 300
#: Names listed per group of the structure, and nodes and depth of the uns tree.
MAX_ITEMS = 200
MAX_UNS_NODES = 400
MAX_UNS_CHILDREN = 100
MAX_UNS_DEPTH = 4

#: Keys of ``uns["annzarro"]``, with the spellings accepted for each (the first is the name).
FIELDS = {
    "title": ("title",),
    "description": ("description",),
    "license": ("license", "licence"),
    "license_url": ("license_url", "licence_url"),
    "citation": ("citation",),
    "doi": ("doi",),
    "authors": ("authors", "author"),
    "source_url": ("source_url",),
    "contact": ("contact",),
    "attribution": ("attribution",),
}
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
_EMAIL = re.compile(r"^[^\s@<>\"']+@[^\s@<>\"']+\.[^\s@<>\"']+$")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_STRING_KINDS = ("S", "U", "O", "T")


class InfoError(RuntimeError):
    """The store cannot be read as AnnData; the message says why."""


# ---- opening ---------------------------------------------------------------------------------

def _open_group(path: str, remote: bool):
    """(root, closer) of the store at ``path``; a store that is not AnnData raises InfoError."""
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


def _read_authors(node):
    if _is_group(node):
        return None, "not_text"
    status, values = _read_strings(node, MAX_AUTHORS)
    if status != "ok":
        return None, status
    authors = [_cut(_clean(v), MAX_AUTHOR_BYTES)[0] for v in values if _clean(v)]
    return (authors or None), (None if authors else "empty")


# ---- about -----------------------------------------------------------------------------------

def _http_url(value: Optional[str]) -> Optional[str]:
    if not value or re.search(r"\s", value):
        return None
    return value if re.match(r"^https?://[^/\s]+", value, re.IGNORECASE) else None


def _contact_url(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    if _EMAIL.match(value):
        return "mailto:" + value
    return _http_url(value)


def _about_from(uns) -> Dict[str, Any]:
    fields: Dict[str, Any] = {}
    ignored: List[str] = []
    fallbacks: List[str] = []
    group = uns["annzarro"] if uns is not None and _has(uns, "annzarro") else None
    if group is not None and not _is_group(group):
        ignored.append("annzarro")
        group = None
    if group is not None:
        for name, spellings in FIELDS.items():
            for spelling in spellings:
                if not _has(group, spelling):
                    continue
                reader = _read_authors if name == "authors" else _read_field
                value, note = reader(group[spelling])
                if value is None:
                    if note != "empty":
                        ignored.append(f"annzarro/{spelling}")
                    continue
                fields[name] = value
                break
    from_annzarro = bool(fields)
    if uns is not None:
        for name, key in UNS_FALLBACKS.items():
            if name in fields or not _has(uns, key):
                continue
            value, _note = _read_field(uns[key])
            if value is not None:
                fields[name] = value
                fallbacks.append(key)
    # derived: normalised DOI and the links a client may show; only http(s) and mailto ever leave here
    doi = fields.get("doi")
    match = _DOI.match(doi) if doi else None
    if match:
        fields["doi"] = match.group(1)
        fields["doi_url"] = "https://doi.org/" + quote(match.group(1), safe="/()-._~:;")
    for key in ("license_url", "source_url"):
        if key in fields and not _http_url(fields[key]):
            ignored.append(f"annzarro/{key}")
            del fields[key]
    if "license" in fields and "license_url" not in fields:
        spdx = fields["license"]
        if spdx in SPDX_IDS:
            fields["license_url"] = SPDX_URL.format(spdx)
        elif _http_url(spdx):
            fields["license_url"] = spdx
    contact = _contact_url(fields.get("contact"))
    if contact:
        fields["contact_url"] = contact
    source = "annzarro" if from_annzarro else ("uns" if fallbacks else None)
    has_readme = uns is not None and any(_has(uns, k) for k in README_KEYS)
    return {"present": bool(fields), "source": source, "fallbacks": fallbacks, "ignored": ignored,
            "has_readme": has_readme, **fields}


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

def _dtype_label(dtype) -> str:
    kind = getattr(dtype, "kind", None)
    if kind in _STRING_KINDS or "string" in str(dtype).lower():
        return "string"
    return str(dtype)


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


def _member(name: str, node) -> Dict[str, Any]:
    """One obsm, varm, obsp, varp or layers member: its shape and kind, from metadata."""
    out: Dict[str, Any] = {"name": name}
    if _is_group(node):
        encoding = _encoding(node)
        out["encoding"] = encoding or "group"
        out["shape"] = _shape_of(node)
        if encoding == "dataframe":
            out["columns"] = len(_names(node)) - 1 if _names(node) else 0
        else:
            try:
                out["dtype"] = _dtype_label(node["data"].dtype)
            except Exception:
                pass
    else:
        out["encoding"] = "array"
        out["shape"] = _shape_of(node)
        out["dtype"] = _dtype_label(getattr(node, "dtype", None))
    return out


def _slot(root, slot: str) -> Dict[str, Any]:
    if not _has(root, slot) or not _is_group(root[slot]):
        return {"items": [], "total": 0}
    group = root[slot]
    names = _names(group)
    items = []
    for name in names[:MAX_ITEMS]:
        try:
            items.append(_member(name, group[name]))
        except Exception:
            items.append({"name": name, "encoding": "unreadable", "shape": None})
    return {"items": items, "total": len(names)}


def _column(group, name: str) -> Dict[str, Any]:
    out = {"name": name, "kind": "other", "dtype": None}
    try:
        node = group[name]
        out["kind"] = store_details._kind_of(node)
        if out["kind"] == "categorical":
            categories = node["categories"]
            out["categories"] = int(categories.shape[0])
            out["dtype"] = _dtype_label(categories.dtype)
        elif _is_group(node):
            out["dtype"] = _encoding(node)
        else:
            out["dtype"] = _dtype_label(node.dtype)
    except Exception:
        pass
    return out


def _table(root, axis: str) -> Dict[str, Any]:
    if not _has(root, axis) or not _is_group(root[axis]):
        return {"columns": [], "total": 0, "index": None}
    group = root[axis]
    index = store_details._text(group.attrs.get("_index", "_index")) or "_index"
    order = group.attrs.get("column-order")
    if order is not None and not isinstance(order, (str, bytes)):
        names = [str(store_details._text(n)) for n in list(order)]
    else:
        names = [n for n in _names(group) if n != index]
    return {"columns": [_column(group, n) for n in names[:store_details.MAX_NAMES]],
            "total": len(names), "index": index}


def _uns_node(name: str, node, depth: int, budget: List[int]) -> Dict[str, Any]:
    budget[0] -= 1
    if not _is_group(node):
        out = {"name": name, "type": "array", "shape": _shape_of(node), "dtype": _dtype_label(getattr(node, "dtype", None))}
        return out
    out = {"name": name, "type": "group", "children": [], "total": 0}
    names = _names(node)
    out["total"] = len(names)
    if depth >= MAX_UNS_DEPTH:
        return out
    for child in names[:MAX_UNS_CHILDREN]:
        if budget[0] <= 0:
            break
        try:
            out["children"].append(_uns_node(child, node[child], depth + 1, budget))
        except Exception:
            out["children"].append({"name": child, "type": "unreadable"})
    return out


def _structure_from(root) -> Dict[str, Any]:
    counts = store_details.counts_from_root(root)
    out: Dict[str, Any] = {"n_obs": counts["cells"], "n_vars": counts["genes"]}
    try:
        if _has(root, "X"):
            out["X"] = _member("X", root["X"])
    except Exception:
        pass
    out["obs"] = _table(root, "obs")
    out["var"] = _table(root, "var")
    for slot in ("obsm", "varm", "obsp", "varp", "layers"):
        out[slot] = _slot(root, slot)
    uns = root["uns"] if _has(root, "uns") and _is_group(root["uns"]) else None
    if uns is None:
        out["uns"] = {"name": "uns", "type": "group", "children": [], "total": 0}
    else:
        budget = [MAX_UNS_NODES]
        out["uns"] = _uns_node("uns", uns, 0, budget)
        out["uns"]["capped"] = budget[0] <= 0
    return out


# ---- entry -----------------------------------------------------------------------------------

def read_info(path: str, parts=PARTS, remote: bool = False) -> Dict[str, Any]:
    """The requested ``parts`` (``about``, ``readme``, ``structure``) of the store at ``path``.

    Raises:
        InfoError: The store cannot be read as AnnData (the message says why).
    """
    unknown = [p for p in parts if p not in PARTS]
    if unknown:
        raise ValueError(f"unknown parts: {', '.join(unknown)}")
    path = str(path)
    try:
        root, close = _open_group(path, remote)
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
            out["about"] = _about_from(uns)
        if "readme" in parts:
            out["readme"] = _readme_from(uns)
        if "structure" in parts:
            out["structure"] = _structure_from(root)
        return out
    except InfoError:
        raise
    except Exception as exc:
        if remote:
            raise
        raise InfoError(f"Cannot read {os.path.basename(path)} as AnnData: {exc}") from exc
    finally:
        close()
