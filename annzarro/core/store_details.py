"""What is in a store, from its metadata alone: the dataset browser's details pane.

``describe_store`` names the obs and var columns (with a coarse type), the obsm keys, the layers and
the number of top-level ``uns`` keys of an ``.h5ad`` file or a local zarr store (format 2, 3 or
sharded). It lists groups and reads array shapes, dtypes and attributes, never a chunk and never X,
so it takes milliseconds on a store of any size. A group with more than ``MAX_NAMES`` members is
cut there and says so (``*_total``).
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

__all__ = ["MAX_NAMES", "describe_store", "counts_from_root", "StoreDetailsError"]

#: Most names listed per group (obs columns, var columns, obsm keys, layers).
MAX_NAMES = 500

_NULLABLE = {"nullable-integer": "integer", "nullable-boolean": "bool", "nullable-string-array": "string"}


class StoreDetailsError(RuntimeError):
    """The store cannot be read as AnnData; the message says why."""


def _text(value) -> Optional[str]:
    return value.decode("utf-8") if isinstance(value, bytes) else value


def _kind_of_dtype(dtype) -> str:
    kind = getattr(dtype, "kind", None)
    if kind in ("i", "u"):
        return "integer"
    if kind == "f":
        return "float"
    if kind == "b":
        return "bool"
    if kind in ("U", "S", "O", "T") or "string" in str(dtype).lower():
        return "string"
    if kind in ("M", "m"):
        return "datetime"
    return "other"


def _kind_of(node) -> str:
    """categorical, integer, float, bool, string, datetime or other, from metadata."""
    encoding = _text(node.attrs.get("encoding-type"))
    if encoding == "categorical":
        return "categorical"
    if encoding in _NULLABLE:
        return _NULLABLE[encoding]
    if hasattr(node, "dtype") and hasattr(node, "shape"):
        return _kind_of_dtype(node.dtype)
    return "other"


def _names(group) -> List[str]:
    try:
        return [str(name) for name in group.keys()]
    except Exception:
        return []


def _columns(group) -> Dict[str, Any]:
    """``{"columns": [{name, kind}], "total": n}`` of an obs/var group, in anndata's column order."""
    index = _text(group.attrs.get("_index", "_index")) or "_index"
    order = group.attrs.get("column-order")
    if order is not None and not isinstance(order, (str, bytes)):
        names = [str(_text(n)) for n in list(order)]
    else:
        names = [n for n in _names(group) if n != index]
    kept = []
    for name in names[:MAX_NAMES]:
        try:
            kept.append({"name": name, "kind": _kind_of(group[name])})
        except Exception:
            kept.append({"name": name, "kind": "other"})
    return {"columns": kept, "total": len(names)}


def _keys(root, slot: str) -> Dict[str, Any]:
    names = _names(root[slot]) if slot in root else []
    return {"keys": names[:MAX_NAMES], "total": len(names)}


def _is_group(node) -> bool:
    return hasattr(node, "attrs") and not hasattr(node, "dtype")


def _describe_group(root) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for axis in ("obs", "var"):
        found = _columns(root[axis]) if axis in root and _is_group(root[axis]) else {"columns": [], "total": 0}
        out[f"{axis}_columns"] = found["columns"]
        out[f"{axis}_columns_total"] = found["total"]
    for slot, key in (("obsm", "obsm"), ("layers", "layers")):
        found = _keys(root, slot)
        out[f"{key}_keys"] = found["keys"]
        out[f"{key}_total"] = found["total"]
    out["uns_count"] = len(_names(root["uns"])) if "uns" in root else 0
    return out


def counts_from_root(root) -> Dict[str, Optional[int]]:
    """``{"cells", "genes"}`` of an opened zarr root from the lengths of the obs and var indices (else X's shape)."""
    out: Dict[str, Optional[int]] = {"cells": None, "genes": None}
    for axis, key in (("obs", "cells"), ("var", "genes")):
        try:
            group = root[axis]
            index = _text(group.attrs.get("_index", "_index")) or "_index"
            out[key] = int(group[index].shape[0])
        except Exception:
            continue
    if out["cells"] is None or out["genes"] is None:
        try:
            shape = root["X"].shape if hasattr(root["X"], "shape") else root["X"].attrs.get("shape")
            if shape is not None and len(shape) == 2:
                out["cells"] = int(shape[0]) if out["cells"] is None else out["cells"]
                out["genes"] = int(shape[1]) if out["genes"] is None else out["genes"]
        except Exception:
            pass
    return out


def _describe_h5ad(path: str) -> Dict[str, Any]:
    from .h5ad_reader import _open
    with _open(path) as file:
        if not _is_group(file.get("obs")):
            raise StoreDetailsError("This .h5ad has no readable obs table (anndata older than 0.7 writes it as a "
                                    "compound dataset); re-save it with a current anndata.")
        return _describe_group(file)


def _describe_zarr(path: str) -> Dict[str, Any]:
    from .store_check import StoreCheckError, _open
    try:
        root, _remote, _consolidated = _open(path, None)
    except StoreCheckError as exc:
        raise StoreDetailsError(str(exc)) from exc
    info = _describe_group(root)
    info["zarr_format"] = int(getattr(getattr(root, "metadata", None), "zarr_format", 2) or 2)
    return info


def describe_store(path: str) -> Dict[str, Any]:
    """Columns, obsm keys, layers and the ``uns`` key count of the local store at ``path``.

    Keys: ``obs_columns`` and ``var_columns`` (``[{name, kind}]``), ``obs_columns_total``,
    ``var_columns_total``, ``obsm_keys``, ``obsm_total``, ``layers_keys``, ``layers_total``,
    ``uns_count`` (the number of top-level keys) and, for zarr, ``zarr_format``.

    Raises:
        StoreDetailsError: The store cannot be read as AnnData (the message says why).
    """
    path = str(path)
    try:
        if os.path.isfile(path):
            if not path.endswith(".h5ad"):
                raise StoreDetailsError(f"{os.path.basename(path)} is a file but not an .h5ad")
            return _describe_h5ad(path)
        return _describe_zarr(path)
    except StoreDetailsError:
        raise
    except Exception as exc:
        raise StoreDetailsError(f"Cannot read {os.path.basename(path)} as AnnData: {exc}") from exc
