"""Write a zarr AnnData store's tree as an .h5ad with the same content.

The test env has no anndata, so the h5ad twin is written member by member
with h5py, keeping every array, group and attribute; strings become HDF5
variable-length UTF-8, as anndata writes them. Dense arrays are contiguous
(anndata's h5ad default) and the arrays of a sparse group are chunked, as
h5py chunks anything written with ``maxshape``. Tests can then ask both
readers the same question and compare.
"""
import h5py
import numpy as np
import zarr


def _value(arr):
    data = arr[()]
    if isinstance(data, np.ndarray) and data.dtype.kind in ("U", "O", "T"):
        return np.array([str(v) for v in data.ravel().tolist()],
                        dtype=object).reshape(data.shape), h5py.string_dtype()
    if isinstance(data, str):
        return data, h5py.string_dtype()
    return data, None


def _attrs(src, dst):
    for k, v in src.attrs.items():
        if v is not None:
            dst.attrs[k] = v


def _copy(src, dst, sparse=False):
    _attrs(src, dst)
    # zarr 3 lists a group's members with members(), zarr 2 with items()
    for name, member in (src.members() if hasattr(src, "members") else src.items()):
        if isinstance(member, zarr.Group):
            enc = member.attrs.get("encoding-type")
            _copy(member, dst.create_group(name), sparse=enc in ("csr_matrix", "csc_matrix"))
            continue
        data, dtype = _value(member)
        if sparse and isinstance(data, np.ndarray) and data.ndim == 1 and data.size:
            ds = dst.create_dataset(name, data=data, maxshape=(None,))
        else:
            ds = dst.create_dataset(name, data=data, dtype=dtype)
        _attrs(member, ds)


def h5ad_twin(zarr_path, h5ad_path):
    """Write ``h5ad_path`` from the store at ``zarr_path``; return it as str."""
    with h5py.File(h5ad_path, "w") as f:
        _copy(zarr.open_group(str(zarr_path), mode="r"), f)
    return str(h5ad_path)
