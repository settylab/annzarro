"""Write a dataset's attribution and README into a local zarr store (``annzarro store annotate``).

The fields go to ``uns["annzarro"]`` and the README to ``uns["README"]``, as anndata writes uns
values, so ``anndata.read_zarr`` reads them back and ``core/dataset_info.py`` shows them. The group
always carries the schema marker (``schema`` and ``schema_version``, ``core/dataset_schema.py``) at
the current version. Only what is given is written; the other fields of the group stay as they are.
A field may be its simple form (text) or a richer one (an object, a list of objects): the writer
refuses what the reader would not use. A consolidated store is
consolidated again, so a reader does not see a stale listing.
"""
from __future__ import annotations

import json
import os
from typing import Dict, List, Optional

import zarr

from . import dataset_schema
from .dataset_info import MAX_README_BYTES
from .dataset_schema import FIELDS

__all__ = ["annotate_store", "AnnotateError", "FIELDS"]

_ZARR3 = int(zarr.__version__.split(".")[0]) >= 3


class AnnotateError(RuntimeError):
    """The store cannot be annotated; the message says why."""


def _format_of(path: str) -> int:
    if os.path.exists(os.path.join(path, "zarr.json")):
        return 3
    if os.path.exists(os.path.join(path, ".zgroup")):
        return 2
    raise AnnotateError(f"{path} does not look like a zarr store (no .zgroup or zarr.json)")


def _is_consolidated(path: str, fmt: int) -> bool:
    if fmt == 2:
        return os.path.exists(os.path.join(path, ".zmetadata"))
    try:
        with open(os.path.join(path, "zarr.json"), encoding="utf-8") as fh:
            return bool(json.load(fh).get("consolidated_metadata"))
    except (OSError, ValueError):
        return False


def _dict_group(parent, name: str):
    group = parent.require_group(name)
    group.attrs["encoding-type"] = "dict"
    group.attrs["encoding-version"] = "0.1.0"
    return group


def _put_value(group, name: str, value) -> None:
    """``value`` (text, number, bool, list of those, or an object) as the member ``name`` of ``group``, replacing it.

    A list of objects is written as an object keyed ``"0"``, ``"1"``, ... (anndata cannot write a list of dicts;
    the reader takes both as one list).
    """
    if name in group:
        del group[name]
    if isinstance(value, dict) or (isinstance(value, (list, tuple)) and value and all(isinstance(v, dict) for v in value)):
        items = value if isinstance(value, dict) else {str(i): v for i, v in enumerate(value)}
        child = _dict_group(group, name)
        for key, item in items.items():
            _put_value(child, str(key), item)
        return
    values = list(value) if isinstance(value, (list, tuple)) else None
    if values is not None and not values:
        return
    sample = values[0] if values is not None else value
    if isinstance(sample, str):
        if values is not None and not all(isinstance(v, str) for v in values):
            raise AnnotateError(f"{name}: a list mixes text with other values")
        _put_text(group, name, values if values is not None else value)
    elif isinstance(sample, (bool, int, float)):
        _put_number(group, name, values if values is not None else value)
    else:
        raise AnnotateError(f"{name}: {type(sample).__name__} cannot be stored")


def _put_number(group, name: str, value) -> None:
    import numpy as np
    arr = np.asarray(value)
    if _ZARR3:
        node = group.create_array(name, shape=arr.shape, dtype=arr.dtype)
        node[...] = arr
    else:
        node = group.create_dataset(name, data=arr)
    node.attrs["encoding-type"] = "numeric-scalar" if arr.ndim == 0 else "array"
    node.attrs["encoding-version"] = "0.2.0" if arr.ndim == 0 else "0.2.0"


def _put_text(group, name: str, value) -> None:
    """A string scalar, or a 1-D string array for a list, replacing the member of that name."""
    if name in group:
        del group[name]
    values = value if isinstance(value, (list, tuple)) else None
    if _ZARR3:
        if values is None:
            node = group.create_array(name, shape=(), dtype=str)
            node[()] = value
        else:
            node = group.create_array(name, shape=(len(values),), dtype=str)
            node[:] = list(values)
    else:
        import numcodecs
        import numpy as np
        shape = () if values is None else (len(values),)
        node = group.create_dataset(name, shape=shape, dtype=object, object_codec=numcodecs.VLenUTF8())
        if values is None:
            node[()] = value
        else:
            node[:] = np.array(values, dtype=object)
    node.attrs["encoding-type"] = "string" if values is None else "string-array"
    node.attrs["encoding-version"] = "0.2.0"


def annotate_store(path: str, fields: Optional[Dict[str, object]] = None,
                   readme: Optional[str] = None) -> List[str]:
    """Write ``fields`` (names of ``dataset_info.FIELDS``; ``authors`` may be a list) and ``readme``.

    Returns the uns paths written. Raises AnnotateError for a store that is not local, not zarr, or
    a README over the size ``AnnZarro`` shows.
    """
    from .remote import is_remote_path
    path = str(path)
    if is_remote_path(path):
        raise AnnotateError("annotate writes to a local store; a remote store is annotated where it is stored")
    if not os.path.isdir(path):
        raise AnnotateError(f"{path} is not a zarr store directory (an .h5ad file is annotated with anndata: "
                            "adata.uns['annzarro'] = {...})")
    fields = {k: v for k, v in (fields or {}).items() if v not in (None, "", [], {})}
    known = {spelling for spellings in FIELDS.values() for spelling in spellings}
    unknown = [k for k in fields if k not in known]
    if unknown:
        raise AnnotateError(f"unknown field(s) {', '.join(unknown)}; use {', '.join(FIELDS)}")
    unusable = dataset_schema.normalise(fields)["ignored"]
    if unusable:
        raise AnnotateError(f"{', '.join(unusable)}: not a form AnnZarro reads (see the field table in the deployment guide)")
    if readme is not None and len(readme.encode("utf-8")) > MAX_README_BYTES:
        raise AnnotateError(f"the README is {len(readme.encode('utf-8')) / 1024:,.0f} KB; AnnZarro shows "
                            f"{MAX_README_BYTES // 1024} KB, so shorten it")
    if not fields and readme is None:
        raise AnnotateError("nothing to write: give a field or a README")
    fmt = _format_of(path)
    try:
        root = zarr.open_group(path, mode="r+", **({"zarr_format": fmt} if _ZARR3 else {}),
                               **({"use_consolidated": False} if _ZARR3 else {}))
    except Exception as exc:
        raise AnnotateError(f"Cannot open {path} for writing: {exc}") from exc
    written = []
    uns = _dict_group(root, "uns")
    if fields:
        group = _dict_group(uns, "annzarro")
        _put_text(group, "schema", dataset_schema.SCHEMA_NAME)
        _put_text(group, "schema_version", dataset_schema.format_version(dataset_schema.CURRENT_VERSION))
        written.append("uns/annzarro/schema_version")
        for name, value in fields.items():
            _put_value(group, name, value)
            written.append(f"uns/annzarro/{name}")
    if readme is not None:
        _put_text(uns, "README", readme)
        written.append("uns/README")
    if _is_consolidated(path, fmt):
        zarr.consolidate_metadata(path, **({"zarr_format": fmt} if _ZARR3 else {}))
    return written
