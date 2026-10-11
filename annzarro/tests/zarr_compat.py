"""Write test stores through whichever zarr major version is installed.

The older suites used the zarr 2 ``create_dataset(name, data=...)`` form, which
zarr 3 rejects (``shape`` became required), so under the deployed zarr 3 those
fixtures never built and every test that used them errored. Under zarr 3 the
store is pinned to zarr FORMAT 2, the on-disk layout anndata writes and the
served datasets use; see also test_nullable_encodings.py.

``ANNZARRO_TEST_ZARR_FORMAT`` (unset, ``2``, ``3`` or ``3-sharded``) opts the suites into zarr format 3:
the committed ``fixture_small.zarr`` is swapped for a converted copy (see ``conftest.py``) and the
stores built here are format 3, plain or with every array sharded. Unset is format 2, as always.

Tests that change a store's metadata do it through the helpers below (``set_attrs``,
``require_group``, ``copy_node``, ``drop_consolidated``, ``consolidate``) and not by editing
``.zattrs``/``.zmetadata``/``zarr.json``, so one test body serves both formats.
"""
import json
import os
import shutil

import numpy as np
import zarr

ZARR_V3 = int(zarr.__version__.split(".")[0]) >= 3

FORMAT_MODE = os.environ.get("ANNZARRO_TEST_ZARR_FORMAT", "").strip()
if FORMAT_MODE not in ("", "2", "3", "3-sharded"):
    raise RuntimeError(f"ANNZARRO_TEST_ZARR_FORMAT={FORMAT_MODE!r}: use 2, 3 or 3-sharded")
if FORMAT_MODE.startswith("3") and not ZARR_V3:
    raise RuntimeError("ANNZARRO_TEST_ZARR_FORMAT=3 needs zarr 3 (zarr 2 cannot write format 3)")
NEW_FORMAT = 3 if FORMAT_MODE.startswith("3") else 2
SHARDED = FORMAT_MODE == "3-sharded"


def store_format(path):
    """The zarr format of the store at ``path``: 3 if it has a root ``zarr.json``, else 2."""
    return 3 if os.path.exists(os.path.join(str(path), "zarr.json")) else 2


def consolidate(path):
    """``zarr.consolidate_metadata`` in the store's own format (zarr 3 would otherwise write a
    format 3 consolidation of a format 2 store, or refuse)."""
    if ZARR_V3:
        return zarr.consolidate_metadata(str(path), zarr_format=store_format(path))
    return zarr.consolidate_metadata(str(path))


def open_group(path, mode="w", zarr_format=None):
    """A new store is written in format 2 (3 under ``ANNZARRO_TEST_ZARR_FORMAT=3``); an existing
    one is opened in its own format, so a test that adds to a copy of a format 3 fixture adds
    format 3 members. ``zarr_format=2`` pins a new store to format 2, for a test of something
    that exists for format 2 only (the raw string-chunk reader)."""
    if ZARR_V3:
        if mode != "w" and os.path.exists(str(path)) and os.listdir(str(path)):
            fmt = store_format(path)
        else:
            fmt = zarr_format or NEW_FORMAT
        return zarr.open_group(str(path), mode=mode, zarr_format=fmt)
    return zarr.open_group(str(path), mode=mode)


def _sharding(shape, chunks):
    """``{"chunks", "shards"}`` for a sharded array of ``shape`` (the given inner ``chunks``, else
    halves of the shape): one shard per ceil-multiple of the inner chunk, so a small array still
    has several inner chunks to a shard."""
    if not shape or 0 in shape:
        return {} if chunks is None else {"chunks": chunks}
    inner = tuple(chunks) if chunks is not None else tuple(max(1, -(-n // 2)) for n in shape)
    inner = tuple(min(c, n) for c, n in zip(inner, shape))
    shards = tuple(-(-n // c) * c for c, n in zip(inner, shape))
    return {"chunks": inner, "shards": shards}


def _shards_here(group):
    return SHARDED and ZARR_V3 and group.metadata.zarr_format == 3


def write_array(group, name, data, dtype=None, chunks=None):
    arr = np.asarray(data) if dtype is None else np.asarray(data, dtype=dtype)
    kw = {} if chunks is None else {"chunks": chunks}
    if _shards_here(group):
        kw = _sharding(arr.shape, chunks)
    if not ZARR_V3:
        return group.create_dataset(name, data=arr, **kw)
    if arr.dtype.kind in "UO":
        out = group.create_array(name, shape=arr.shape, dtype=str, **kw)
        out[...] = arr.astype(str)
        return out
    out = group.create_array(name, shape=arr.shape, dtype=arr.dtype, **kw)
    out[...] = arr
    return out


_DEFAULT = object()


def write_strings(group, name, values, chunks=None, compressor=_DEFAULT):
    """A 1-D ``vlen-utf8`` string array, the encoding anndata writes for an
    index, under either zarr major (zarr 2 would otherwise store a fixed-width
    unicode dtype). ``compressor``: a numcodecs codec, or None for none;
    zarr's default when omitted."""
    arr = np.asarray(values, dtype=object)
    kw = {} if chunks is None else {"chunks": chunks}
    if ZARR_V3:
        if _shards_here(group):
            kw = _sharding(arr.shape, chunks)
        if compressor is not _DEFAULT:
            kw["compressors"] = None if compressor is None else compressor
        out = group.create_array(name, shape=arr.shape, dtype=str, **kw)
        out[...] = arr.astype(str)
        return out
    import numcodecs
    if compressor is not _DEFAULT:
        kw["compressor"] = compressor
    return group.create_dataset(name, data=arr, dtype=object, object_codec=numcodecs.VLenUTF8(), **kw)


# --- changing a store's metadata through zarr, in either format ------------------------------

def set_attrs(path, attrs):
    """Merge ``attrs`` into the attributes of the group or array at ``path``. The consolidated
    copy is not touched; ``consolidate`` it afterwards, or leave it stale."""
    node = zarr.open(str(path), mode="r+", **({"zarr_format": store_format(path)} if ZARR_V3 else {}))
    node.attrs.update(attrs)
    return node


def get_attrs(path):
    node = zarr.open(str(path), mode="r", **({"zarr_format": store_format(path)} if ZARR_V3 else {}))
    return dict(node.attrs)


def require_group(store, rel, attrs=None):
    """Create the group ``rel`` ("uns/note") under the store root, and its parents, in the
    store's own format, with ``attrs`` merged in. Returns the group."""
    group = open_group(store, mode="r+").require_group(rel)
    if attrs:
        group.attrs.update(attrs)
    return group


def copy_node(src, dst):
    """Copy an array or group directory; a member is its directory in both formats, so this is the
    same copy of the data and of its own metadata. The parent's listing (its attributes) is the
    caller's to update with ``set_attrs``."""
    return shutil.copytree(str(src), str(dst))


def drop_consolidated(path):
    """Take the consolidated metadata away, so the store is read by walking it: ``.zmetadata``
    (format 2), or the consolidated copy inside the root ``zarr.json`` (format 3)."""
    path = str(path)
    if store_format(path) == 2:
        os.remove(os.path.join(path, ".zmetadata"))
        return
    root = os.path.join(path, "zarr.json")
    with open(root) as fh:
        doc = json.load(fh)
    doc.pop("consolidated_metadata", None)
    with open(root, "w") as fh:
        json.dump(doc, fh)


def has_consolidated(path):
    path = str(path)
    if store_format(path) == 2:
        return os.path.exists(os.path.join(path, ".zmetadata"))
    with open(os.path.join(path, "zarr.json")) as fh:
        return bool(json.load(fh).get("consolidated_metadata"))
