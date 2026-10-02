"""Write test stores through whichever zarr major version is installed.

The older suites used the zarr 2 ``create_dataset(name, data=...)`` form, which
zarr 3 rejects (``shape`` became required), so under the deployed zarr 3 those
fixtures never built and every test that used them errored. Under zarr 3 the
store is pinned to zarr FORMAT 2, the on-disk layout anndata writes and the
served datasets use; see also test_nullable_encodings.py.
"""
import numpy as np
import zarr

ZARR_V3 = int(zarr.__version__.split(".")[0]) >= 3


def open_group(path, mode="w"):
    if ZARR_V3:
        return zarr.open_group(str(path), mode=mode, zarr_format=2)
    return zarr.open_group(str(path), mode=mode)


def write_array(group, name, data, dtype=None):
    arr = np.asarray(data) if dtype is None else np.asarray(data, dtype=dtype)
    if not ZARR_V3:
        return group.create_dataset(name, data=arr)
    if arr.dtype.kind in "UO":
        out = group.create_array(name, shape=arr.shape, dtype=str)
        out[...] = arr.astype(str)
        return out
    out = group.create_array(name, shape=arr.shape, dtype=arr.dtype)
    out[...] = arr
    return out
