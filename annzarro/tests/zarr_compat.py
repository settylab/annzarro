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


def write_array(group, name, data, dtype=None, chunks=None):
    arr = np.asarray(data) if dtype is None else np.asarray(data, dtype=dtype)
    kw = {} if chunks is None else {"chunks": chunks}
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
        if compressor is not _DEFAULT:
            kw["compressors"] = None if compressor is None else compressor
        out = group.create_array(name, shape=arr.shape, dtype=str, **kw)
        out[...] = arr.astype(str)
        return out
    import numcodecs
    if compressor is not _DEFAULT:
        kw["compressor"] = compressor
    return group.create_dataset(name, data=arr, dtype=object, object_codec=numcodecs.VLenUTF8(), **kw)
