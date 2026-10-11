#!/usr/bin/env python
"""Rewrite a zarr format 2 AnnData store as zarr format 3, plain or sharded, for tests.

AnnData written with ``ad.settings.zarr_write_format = 3`` (the default under
zarr 3 for newer anndata) produces a store with ``zarr.json`` in every node and
no ``.zgroup``/``.zarray``. The reader's v3 handling is tested against such a
store; building it from the v2 fixture keeps the two equal in content, so a
test can compare what each one reads back.

The copy runs at the zarr level: group and array attributes (``encoding-type``,
``shape``, ``categories``) are copied verbatim, nothing is re-encoded, and big
arrays are copied in blocks of whole shard rows, so a store larger than memory
converts. Consolidated metadata is written at the end.

``sharded=True`` rewrites the large dense arrays the way ``docs/data/preparing-a-store.md``
recommends: inner chunks from the aspect rule for cells x genes layers, whole rows
``(max(1, 2 * target // n), n)`` (the docs' ``10**6 // n``) for n x n obsp/varp, shards of ``shard_factor`` inner chunks per
axis (``pair_shard_factor`` row blocks for obsp/varp), and 1-D sparse components sharded 8
chunks to a shard. Arrays under ``min_shard_bytes`` keep their chunks. The defaults suit a
real store (5e5 values per chunk, 8 MiB); tests pass smaller numbers.

Needs zarr >= 3 (which reads v2 and writes v3); anndata is not required::

    python annzarro/tests/utils/make_fixture_zarr_v3.py SRC.zarr DST.zarr [--sharded]
"""
import math
import sys

import numpy as np
import zarr

BLOCK_BYTES = 128 * 2 ** 20


def layer_chunks(n_obs, n_vars, target=5e5):
    """The docs' aspect rule (docs/data/chunking.md)."""
    rows = 2 ** round(math.log2(math.sqrt(target * n_obs / n_vars)))
    cols = 2 ** round(math.log2(target / rows))
    return min(rows, n_obs), min(cols, n_vars)


def _is_string(array):
    return array.dtype.kind in "OTU" or "str" in str(array.dtype).lower()


def _plan(path, array, sharded, target, shard_factor, pair_shard_factor, min_shard_bytes):
    """(chunks, shards) the copy of ``array`` is written with."""
    chunks = tuple(int(c) for c in array.chunks)
    if not sharded or _is_string(array) or not array.shape:
        return chunks, None
    if int(np.prod(array.shape)) * array.dtype.itemsize < min_shard_bytes:
        return chunks, None
    if len(array.shape) == 2:
        n, m = array.shape
        if path.split("/")[0] in ("obsp", "varp") and n == m:
            inner = (min(n, max(1, int(2 * target) // n)), n)      # the docs' 10**6 // n at the default
            return inner, (min(inner[0] * pair_shard_factor, -(-n // inner[0]) * inner[0]), n)
        inner = layer_chunks(n, m, target)
        return inner, tuple(min(c * shard_factor, -(-s // c) * c) for c, s in zip(inner, (n, m)))
    if len(array.shape) == 1:
        return chunks, (chunks[0] * min(8, max(1, -(-array.shape[0] // chunks[0]))),)
    return chunks, None


def _copy_array(src, dst_group, name, path, **plan_args):
    chunks, shards = _plan(path, src, **plan_args)
    kw = {}
    if _is_string(src):
        dtype = str                       # v2 vlen-utf8; v3 has a native string dtype
    else:
        dtype = src.dtype
        kw["fill_value"] = src.fill_value if src.fill_value is not None else 0
    out = dst_group.create_array(name, shape=src.shape, dtype=dtype,
                                 chunks=chunks, shards=shards,
                                 attributes=dict(src.attrs), **kw)
    if not src.shape:
        out[...] = src[...]
        return
    unit = (shards or chunks)[0]
    row_bytes = int(np.prod(src.shape[1:])) * (8 if _is_string(src) else src.dtype.itemsize)
    step = max(unit, BLOCK_BYTES // max(row_bytes, 1) // unit * unit)
    for start in range(0, src.shape[0], step):
        out[start:start + step] = src[start:start + step]


def _copy(src, dst, path, **plan_args):
    for name, member in src.members():
        member_path = f"{path}/{name}" if path else name
        if isinstance(member, zarr.Group):
            _copy(member, dst.create_group(name, attributes=dict(member.attrs)), member_path, **plan_args)
        else:
            _copy_array(member, dst, name, member_path, **plan_args)


def convert(src_path, dst_path, sharded=False, target=5e5, shard_factor=4, pair_shard_factor=16,
            min_shard_bytes=8 * 2 ** 20):
    if int(zarr.__version__.split(".")[0]) < 3:
        raise SystemExit("zarr >= 3 is required to write a format 3 store")
    import warnings
    src = zarr.open_group(src_path, mode="r")
    dst = zarr.open_group(dst_path, mode="w", zarr_format=3, attributes=dict(src.attrs))
    _copy(src, dst, "", sharded=sharded, target=target, shard_factor=shard_factor,
          pair_shard_factor=pair_shard_factor, min_shard_bytes=min_shard_bytes)
    with warnings.catch_warnings():       # "consolidated metadata is not part of the v3 spec"
        warnings.simplefilter("ignore")
        zarr.consolidate_metadata(dst_path)
    return dst_path


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2], sharded="--sharded" in sys.argv[3:])
    print(f"wrote {sys.argv[2]}")
