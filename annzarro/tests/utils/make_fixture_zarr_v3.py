#!/usr/bin/env python
"""Rewrite the committed v2 fixture as a zarr format 3 store, for tests.

AnnData written with ``ad.settings.zarr_write_format = 3`` (the default under
zarr 3 for newer anndata) produces a store with ``zarr.json`` in every node and
no ``.zgroup``/``.zarray``. The reader's v3 handling is tested against such a
store; building it from the v2 fixture keeps the two byte-for-byte equal in
content, so a test can compare what each one reads back.

Needs zarr >= 3 (which reads v2 and writes v3); anndata is not required::

    python annzarro/tests/utils/make_fixture_zarr_v3.py SRC.zarr DST.zarr
"""
import sys

import numpy as np
import zarr


def _copy(src, dst):
    dst.attrs.update(dict(src.attrs))
    for name, member in src.members():
        if isinstance(member, zarr.Group):
            _copy(member, dst.create_group(name))
            continue
        data = member[...]
        if data.dtype == object:
            # v2 vlen-utf8 strings; v3 has a native string dtype.
            data = np.asarray(data, dtype=str)
        arr = dst.create_array(name, shape=data.shape, dtype=data.dtype,
                               chunks=member.chunks if data.ndim else ())
        arr[...] = data
        arr.attrs.update(dict(member.attrs))


def convert(src_path, dst_path):
    if int(zarr.__version__.split(".")[0]) < 3:
        raise SystemExit("zarr >= 3 is required to write a format 3 store")
    src = zarr.open_group(src_path, mode="r")
    dst = zarr.open_group(dst_path, mode="w", zarr_format=3)
    _copy(src, dst)
    return dst_path


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2])
    print(f"wrote {sys.argv[2]}")
