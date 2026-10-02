"""Read AnnData ``.h5ad`` files lazily with h5py.

Every read opens the file, takes the slice it needs and closes it again: no
h5py handle outlives a call, so none is shared across a gunicorn fork or
between threads, and a rewritten file is seen on the next request. Opening
is cheap next to any read (well under a millisecond for the 5.6 GB demo
file); repeat requests are answered from the result cache instead.

Selections follow the zarr reader's contract (same shapes, any index order,
repeats allowed) so the routes cannot tell the two formats apart. What h5ad
cannot match is its layout: a dense matrix written by anndata is usually
contiguous (not chunked), and sparse matrices are compressed along one axis
only, so the cost of a gene column depends on how the file was written --
see ``_sparse`` and the h5ad notes in the documentation.
"""

import h5py
import logging
from typing import Literal, Tuple, Dict, Any, List, Optional
import numpy as np
import scipy.sparse as sp
from .caching import DatasetCache, cached_method

logger = logging.getLogger(__name__)

#: Entries of a sparse matrix's ``indices`` read per block when a selection
#: runs along its minor axis (a gene column of a CSR X): 4M int32, 16 MB.
_SCAN_BLOCK = 1 << 22

#: A sorted selection whose rows (or columns) span at most this many bytes is
#: read as one block and picked in memory; h5py point selection costs one
#: hyperslab per index, which loses to a contiguous read well before this.
_SPAN_BYTES = 8 << 20

#: Selected rows of a sparse matrix whose stored entries lie closer together
#: than this are fetched with one read.
_COALESCE_GAP = 1 << 16


def _open(path):
    """Open ``path`` read-only.

    HDF5 locks files by default, and that fails on file systems without
    flock (some Lustre and NFS mounts: "unable to lock file, errno = 38").
    This server never writes, so it retries without the lock rather than
    refusing the file.
    """
    try:
        return h5py.File(path, "r")
    except OSError as exc:
        if "lock" not in str(exc).lower():
            raise
        try:
            return h5py.File(path, "r", locking=False)
        except TypeError:  # h5py < 3.5 has no locking argument
            raise exc


def _attr_str(obj, name, default=None):
    value = obj.attrs.get(name, default)
    return value.decode("utf-8") if isinstance(value, bytes) else value


def _encoding(obj):
    return _attr_str(obj, "encoding-type")


def _index_name(group) -> str:
    """The obs/var member holding the index (anndata's ``_index`` attribute)."""
    return _attr_str(group, "_index", "_index") or "_index"


def _sparse_group_shape(group: h5py.Group):
    """(n_rows, n_cols) of a sparse-matrix group, or None.

    Standard AnnData (>=0.7) stores the shape as an attribute on the group;
    much older stores wrote it as a child dataset. Handle both.
    """
    if "shape" in group.attrs:
        return tuple(int(v) for v in group.attrs["shape"][...])
    if "shape" in group.keys():
        return tuple(int(v) for v in group["shape"][...])
    return None


def _check_range(indices: np.ndarray, size: int, axis_name: str):
    if indices.size and (indices[0] < 0 or indices[-1] >= size):
        bad = indices[0] if indices[0] < 0 else indices[-1]
        raise IndexError(f"{axis_name} index {bad} is out of range for size {size}")


def _take(ds, indices, axis: int = 0) -> np.ndarray:
    """``ds`` selected at ``indices`` along ``axis``, in the order given.

    h5py point selection needs strictly increasing, unique indices and
    raises otherwise; zarr takes any order and repeats, and so do the routes
    (a lasso, a client's column order). So the sorted unique set is read and
    put back in the requested order in memory. A narrow span is read as one
    contiguous block, which beats one hyperslab per index.
    """
    uniq, inverse = np.unique(np.asarray(indices, dtype=np.int64), return_inverse=True)
    _check_range(uniq, ds.shape[axis], "row" if axis == 0 else "column")
    where = [slice(None)] * len(ds.shape)
    if uniq.size == 0:
        where[axis] = slice(0, 0)
        return ds[tuple(where)]
    lo, hi = int(uniq[0]), int(uniq[-1]) + 1
    per_index = ds.dtype.itemsize * int(np.prod(ds.shape)) // max(ds.shape[axis], 1)
    if (hi - lo) * per_index <= max(_SPAN_BYTES, 2 * uniq.size * per_index):
        where[axis] = slice(lo, hi)
        positions = (uniq - lo)[inverse]
    else:
        where[axis] = uniq
        positions = inverse
    return np.take(ds[tuple(where)], positions, axis=axis)


def _dense(ds: h5py.Dataset, rows=None, cols=None) -> np.ndarray:
    """A dense dataset selected like ``zarr_array[rows, :][:, cols]``.

    A single column comes back n x 1 and a single row 1 x n, as from zarr.
    A 1-D dataset ignores ``cols``, as the zarr reader does.
    """
    if len(ds.shape) < 2 or cols is None:
        return ds[()] if rows is None else _take(ds, rows, 0)
    if rows is None:
        return _take(ds, cols, 1)
    # Read the smaller of the two rectangles from disk, cut the other in memory.
    if len(rows) * ds.shape[1] <= ds.shape[0] * len(cols):
        block = _take(ds, rows, 0)
        _check_range(np.unique(cols), ds.shape[1], "column")
        return block[:, np.asarray(cols, dtype=np.int64)]
    block = _take(ds, cols, 1)
    _check_range(np.unique(rows), ds.shape[0], "row")
    return block[np.asarray(rows, dtype=np.int64), :]


def _major_slices(group, indptr, selection, n_minor) -> sp.csr_matrix:
    """Selected rows of a CSR group (columns of a CSC one), in major space.

    Major slice k is stored contiguously at ``[indptr[k], indptr[k+1])``, so
    only those ranges are read; neighbouring ranges share one read.
    """
    uniq, inverse = np.unique(np.asarray(selection, dtype=np.int64), return_inverse=True)
    _check_range(uniq, len(indptr) - 1, "major-axis")
    starts, ends = indptr[uniq], indptr[uniq + 1]
    data_ds, idx_ds = group["data"], group["indices"]
    data_parts, idx_parts = [], []
    i = 0
    while i < uniq.size:
        j = i
        while j + 1 < uniq.size and starts[j + 1] - ends[j] <= _COALESCE_GAP:
            j += 1
        s, e = int(starts[i]), int(ends[j])
        data, idx = data_ds[s:e], idx_ds[s:e]
        for k in range(i, j + 1):
            data_parts.append(data[starts[k] - s:ends[k] - s])
            idx_parts.append(idx[starts[k] - s:ends[k] - s])
        i = j + 1
    new_indptr = np.concatenate(([0], np.cumsum(ends - starts)))
    data = np.concatenate(data_parts) if data_parts else np.empty(0, dtype=data_ds.dtype)
    idx = np.concatenate(idx_parts) if idx_parts else np.empty(0, dtype=np.int64)
    m = sp.csr_matrix((data, idx, new_indptr), shape=(uniq.size, n_minor))
    return m if np.array_equal(inverse, np.arange(uniq.size)) else m[inverse]


def _minor_scan(group, indptr, selection, n_major, n_minor) -> sp.csr_matrix:
    """Selected columns of a CSR group (rows of a CSC one), in major space.

    A minor-axis entry can sit anywhere, so every stored index has to be
    looked at. That is done ``_SCAN_BLOCK`` entries at a time, and only the
    data between the first and last hit of a block is read: memory stays
    bounded however large the matrix is, where loading the whole matrix to
    slice one column needed all of it at once (1.5 GB for the demo X).
    """
    uniq, inverse = np.unique(np.asarray(selection, dtype=np.int64), return_inverse=True)
    _check_range(uniq, n_minor, "minor-axis")
    if uniq.size == 0:
        return sp.csr_matrix((n_major, 0), dtype=group["data"].dtype)
    nnz = int(indptr[-1])
    data_ds, idx_ds = group["data"], group["indices"]
    pos_parts, col_parts, val_parts = [], [], []
    for s in range(0, nnz, _SCAN_BLOCK):
        block = idx_ds[s:min(s + _SCAN_BLOCK, nnz)]
        if uniq.size == 1:
            hit = np.flatnonzero(block == uniq[0])
            col = np.zeros(hit.size, dtype=np.int64)
        else:
            col = np.minimum(np.searchsorted(uniq, block), uniq.size - 1)
            hit = np.flatnonzero(uniq[col] == block)
            col = col[hit]
        if hit.size == 0:
            continue
        first = int(hit[0])
        values = data_ds[s + first:s + int(hit[-1]) + 1]
        pos_parts.append(hit + s)
        col_parts.append(col)
        val_parts.append(values[hit - first])
    if pos_parts:
        pos, col, values = (np.concatenate(p) for p in (pos_parts, col_parts, val_parts))
    else:
        pos = col = np.empty(0, dtype=np.int64)
        values = np.empty(0, dtype=data_ds.dtype)
    major = np.searchsorted(indptr, pos, side="right") - 1
    m = sp.csr_matrix((values, (major, col)), shape=(n_major, uniq.size))
    return m if np.array_equal(inverse, np.arange(uniq.size)) else m[:, inverse]


def _sparse(group: h5py.Group, rows=None, cols=None):
    """A csr/csc group selected as ``M[rows, :][:, cols]``, as scipy.sparse.

    Reads only what the selection needs: along the compressed (major) axis
    that is the selected ranges, along the other axis a bounded scan of the
    indices. Returns None for an encoding it cannot read.
    """
    fmt = _encoding(group)
    shape = _sparse_group_shape(group)
    if (fmt not in ("csr_matrix", "csc_matrix") or shape is None
            or not all(k in group for k in ("data", "indices", "indptr"))):
        return None
    if fmt == "csr_matrix":
        major, minor, (n_major, n_minor) = rows, cols, shape
    else:
        major, minor, (n_minor, n_major) = cols, rows, shape
    indptr = group["indptr"][()].astype(np.int64)
    if major is not None:
        m = _major_slices(group, indptr, major, n_minor)
        if minor is not None:
            minor = np.asarray(minor, dtype=np.int64)
            _check_range(np.unique(minor), n_minor, "minor-axis")
            m = m[:, minor]
    elif minor is not None:
        m = _minor_scan(group, indptr, minor, n_major, n_minor)
    else:
        m = sp.csr_matrix((group["data"][()], group["indices"][()], indptr),
                          shape=(n_major, n_minor))
    return m if fmt == "csr_matrix" else m.T


def _matrix(obj, rows=None, cols=None) -> np.ndarray:
    """X, a layer, or an obsp/varp member, selected and dense."""
    if isinstance(obj, h5py.Dataset):
        return _dense(obj, rows, cols)
    if isinstance(obj, h5py.Group):
        m = _sparse(obj, rows, cols)
        if m is not None:
            return m.toarray()
        logger.warning(f"Unsupported matrix encoding '{_encoding(obj)}' at {obj.name}")
    return np.array([])


def _is_string(ds: h5py.Dataset) -> bool:
    return h5py.check_string_dtype(ds.dtype) is not None or ds.dtype.kind in ("S", "O")


def _values(ds: h5py.Dataset, indices=None) -> np.ndarray:
    """A 1-D dataset (or a selection of it), strings decoded to str."""
    data = ds[()] if indices is None else _take(ds, indices)
    if _is_string(ds):
        data = np.array([v.decode("utf-8") if isinstance(v, bytes) else v
                         for v in data.tolist()], dtype=object)
    return data


def _categorical(codes: np.ndarray, categories: np.ndarray) -> np.ndarray:
    """Codes mapped to their categories; -1 (missing) becomes None."""
    codes = np.asarray(codes, dtype=np.int64)
    values = np.full(codes.shape, None, dtype=object)
    valid = (codes >= 0) & (codes < len(categories))
    values[valid] = np.asarray(categories, dtype=object)[codes[valid]]
    return values


def _column(f: h5py.File, obj, indices=None) -> Tuple[np.ndarray, Optional[list]]:
    """One obs/var (or dataframe) column: (values, categories or None).

    Handles every column encoding anndata writes to h5ad: plain and string
    arrays, categoricals (as a group, and anndata 0.7's codes dataset with a
    reference to its categories), and the nullable integer, boolean and
    string encodings (values + mask, masked entries None).
    """
    enc = _encoding(obj)
    if isinstance(obj, h5py.Group):
        if enc == "categorical" or ("codes" in obj and "categories" in obj):
            categories = _values(obj["categories"])
            return _categorical(_values(obj["codes"], indices), categories), categories.tolist()
        if (enc or "").startswith("nullable") or ("values" in obj and "mask" in obj):
            values = _values(obj["values"], indices)
            mask = np.asarray(_values(obj["mask"], indices), dtype=bool)
            if mask.any():
                values = values.astype(object)
                values[mask] = None
            return values, None
        if "0" in obj:  # an array wrapped in a group (pre-0.7 obsm dataframes)
            return _values(obj["0"], indices), None
        raise ValueError(f"Unsupported AnnData encoding '{enc}' at {obj.name} "
                         f"(children: {list(obj.keys())})")
    ref = obj.attrs.get("categories")
    if isinstance(ref, h5py.Reference):
        categories = _values(f[ref])
        return _categorical(_values(obj, indices), categories), categories.tolist()
    return _values(obj, indices), None


def _uns_value(node) -> Any:
    """A uns member as plain JSON-able Python, as ZarrReader._uns_value.

    Groups become dicts of their members (to any depth; the encoding
    attributes are not members), arrays become (nested) lists, scalars
    Python scalars and strings str.
    """
    if isinstance(node, h5py.Group):
        return {name: _uns_value(node[name]) for name in node.keys()}
    value = node[()]
    if isinstance(value, np.ndarray):
        if value.dtype.kind in ("S", "O", "U"):
            flat = [v.decode("utf-8") if isinstance(v, bytes) else
                    (v if v is None or isinstance(v, (int, float, bool, str)) else str(v))
                    for v in value.ravel().tolist()]
            if value.ndim == 0:
                return flat[0]
            return np.array(flat, dtype=object).reshape(value.shape).tolist()
        return value.tolist()
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, np.generic):
        return value.item()
    return value


class h5adReader:

    def __init__(self, max_memory_mb=1000, enable_caching=True, cache_limit=10):
        """
        Initialize the h5adReader.

        Args:
            max_memory_mb: Maximum memory usage in MB for internal caching
            enable_caching: Whether to enable caching of data
            cache_limit: Maximum number of datasets to keep in memory
        """
        # Initialize the cache manager
        self.cache = DatasetCache(max_memory_mb=max_memory_mb,
                                 enable_caching=enable_caching,
                                 cache_limit=cache_limit)

        # Keep reference to cache settings for backwards compatibility
        self.max_memory_mb = max_memory_mb
        self.enable_caching = enable_caching
        self.cache_limit = cache_limit

    def get_cache_info(self):
        """
        Get information about the current cache state.

        Returns:
            dict: Information about the current cache
        """
        # Get cache info from cache manager
        cache_info = self.cache.get_cache_info()

        return cache_info

    def clear_cache(self, dataset_path=None):
        """
        Clear the internal data cache.

        Args:
            dataset_path: Optional dataset path to clear from cache.
                          If None, clears the entire cache.

        Returns:
            dict: Information about the cleared cache
        """
        logger.info(f"CLEAR_CACHE: Called with dataset_path={dataset_path}")

        # Use the cache manager to clear cache
        result = self.cache.clear_cache(dataset_path=dataset_path)

        logger.info(f"CLEAR_CACHE: Cache cleared with result: {result}")
        return result

    def _sparse_group_shape(self, group: h5py.Group):
        return _sparse_group_shape(group)

    def _index_length(self, file: h5py.File, group_name: str) -> int:
        if group_name not in file or not isinstance(file[group_name], h5py.Group):
            return 0
        member = file[group_name].get(_index_name(file[group_name]))
        if isinstance(member, h5py.Dataset):
            return int(member.shape[0])
        if isinstance(member, h5py.Group):
            for child in ("codes", "values"):
                if child in member:
                    return int(member[child].shape[0])
        return 0

    def _extract_h5ad_shape(self, file: h5py.File, has_fields: dict) -> Tuple[int, int]:
        #Check if we can extract the shape from X
        if has_fields['has_X']:
            #X is a dense array
            if isinstance(file['X'], h5py.Dataset):
                return file['X'].shape
            #X is a sparse array (shape in group attrs for standard AnnData)
            elif isinstance(file['X'], h5py.Group):
                shape = _sparse_group_shape(file['X'])
                if shape is not None:
                    return shape
        #See if we can extract shape from layers
        if has_fields['has_layers'] and len(file["layers"]):
            first_layer = list(file["layers"].keys())[0]
            layer = file["layers"][first_layer]
            if isinstance(layer, h5py.Dataset):
                return layer.shape
            elif isinstance(layer, h5py.Group):
                shape = _sparse_group_shape(layer)
                if shape is not None:
                    return shape
        #Fall back to the lengths of the obs/var indexes (n_obs, n_vars)
        return (self._index_length(file, "obs"), self._index_length(file, "var"))

    def _obs_var_columns(self, file: h5py.File, obj_name: str) -> List[str]:
        # anndata 0.7 kept categoricals' categories in a '__categories' group
        return [c for c in file[obj_name].keys() if c != "__categories"]

    def _get_obs_var_columns_metadata(self, file: h5py.File, obj_name: str) -> dict:
        """
        Returns a dictionary of columns in obs/var with their type:
        'categorical', a nullable encoding name, or the numpy dtype.
        """
        group = file[obj_name]
        index = _index_name(group)
        obj_columns_info = {}
        for col in self._obs_var_columns(file, obj_name):
            if col == index:
                continue
            obj = group[col]
            enc = _encoding(obj)
            if isinstance(obj, h5py.Group):
                if enc == "categorical" or "codes" in obj:
                    col_type = "categorical"
                elif enc:
                    col_type = enc
                else:
                    col_type = "other"
            elif isinstance(obj.attrs.get("categories"), h5py.Reference) or enc == "categorical":
                col_type = "categorical"
            else:
                col_type = str(obj.dtype)
            obj_columns_info[col] = {"type": col_type}
        return obj_columns_info

    def _get_h5ad_layers_metadata(self, file: h5py.File) -> dict:
        layers_info = {}

        for layer_name in file["layers"].keys():
            layer = file["layers"][layer_name]
            layer_type = "unknown"
            layer_shape = None

            # Sparse matrix (group with CSR/CSC/COO structure)
            if isinstance(layer, h5py.Group):
                encoding_type = _encoding(layer)
                if encoding_type in ['csr_matrix', 'csc_matrix', 'coo_matrix']:
                    shape = _sparse_group_shape(layer)
                    if shape is not None:
                        layer_type = encoding_type
                        layer_shape = shape

            # Dense matrix
            elif isinstance(layer, h5py.Dataset):
                layer_type = str(layer.dtype)
                layer_shape = layer.shape

            layers_info[layer_name] = {"type": layer_type, "shape": layer_shape}

        return layers_info

    def _get_h5ad_obsm_varm_metadata(self, file: h5py.File, type: Literal["obsm", "varm"]) -> Tuple[dict, dict]:
        info = {}
        dataframes = {}

        for key in file[type].keys():
            obj = file[type][key]

            # If group, check for dataframe-like structure
            if isinstance(obj, h5py.Group):
                attrs = obj.attrs
                columns = [c for c in obj.keys()]
                columns_info = {}
                for column in columns:
                    col_obj = obj[column]
                    if isinstance(col_obj, h5py.Group):
                        # Get the first dataset in the group (common pattern in dataframe-encoded obsm/varm)
                        ds_name = list(col_obj.keys())[0]
                        ds = col_obj[ds_name]
                        columns_info[column] = {"type": str(ds.dtype)}
                    elif isinstance(col_obj, h5py.Dataset):
                        columns_info[column] = {"type": str(col_obj.dtype)}

                info[key] = {"type": "dataframe", "columns": columns}
                dataframes[key] = {"columns": columns, "columns_info": columns_info}

                if "encoding-type" in attrs:
                    dataframes[key]["encoding_type"] = _attr_str(obj, "encoding-type")
                if "encoding-version" in attrs:
                    dataframes[key]["encoding_version"] = _attr_str(obj, "encoding-version")

            # If dataset, treat as numeric array
            elif isinstance(obj, h5py.Dataset):
                info[key] = {
                    "type": str(obj.dtype),
                    "shape": tuple(int(x) for x in obj.shape)
                }

                if len(obj.shape) > 1:
                    dataframes[key] = {"columns": [str(i) for i in range(obj.shape[1])],
                                "is_array": True,
                                "array_shape": obj.shape,
                                "array_dtype": str(obj.dtype)}

        return info, dataframes

    @cached_method
    def get_metadata(self, dataset_path: str) -> dict:
        """The file's structure (names, shapes, dtypes); no matrix is read.

        Raises on a file it cannot read instead of answering ``{}``: an empty
        answer was cached like a real one, and the dataset listing showed an
        unreadable file as a 0 x 0 dataset.
        """
        metadata = {}
        with _open(dataset_path) as file:
            if isinstance(file.get("obs"), h5py.Dataset) or isinstance(file.get("var"), h5py.Dataset):
                raise ValueError(
                    "This .h5ad was written by anndata older than 0.7 (obs/var as "
                    "compound datasets), which AnnZarro does not read. Re-save it with "
                    "a current anndata: anndata.read_h5ad(path).write_h5ad(new_path).")
            anndata_keys = ['X', 'obs', 'var', 'obsm', 'varm', 'obsp', 'varp', 'layers', 'uns']

            for key in anndata_keys:
                metadata[f"has_{key}"] = key in file.keys()

            metadata['shape'] = self._extract_h5ad_shape(file, metadata)

            for key in anndata_keys:
                if key == "X":
                    continue
                elif key == "obs" or key == "var":
                    metadata[f'{key}_columns'] = self._obs_var_columns(file, key) if key in file else []
                else:
                    metadata[key] = {'keys': list(file[key].keys()) if key in file else []}

            # every obsm key (not only X_*), as the axis menus offer
            metadata['embeddings'] = list(file['obsm'].keys()) if "obsm" in file else []
            metadata['obs_columns_info'] = self._get_obs_var_columns_metadata(file, "obs") if metadata['has_obs'] else {}
            metadata['var_columns_info'] = self._get_obs_var_columns_metadata(file, "var") if metadata['has_var'] else {}
            metadata['layers_info'] = self._get_h5ad_layers_metadata(file) if metadata['has_layers'] else {}
            metadata['obsm_info'], metadata['obsm_dataframes'] = self._get_h5ad_obsm_varm_metadata(file, "obsm") if metadata['has_obsm'] else ({}, {})
            metadata['varm_info'], metadata['varm_dataframes'] = self._get_h5ad_obsm_varm_metadata(file, "varm") if metadata['has_varm'] else ({}, {})

        return metadata

    @cached_method
    def get_cell_gene_names(self, dataset_path: str, entity: Literal["cells", "genes"], use_cache: bool = True) -> list[str]:
        obj_name = "obs" if entity == "cells" else "var"
        with _open(dataset_path) as f:
            if obj_name not in f:
                logger.warning(f"Dataset at {dataset_path} has no '{obj_name}' data")
                return []
            group = f[obj_name]
            index = _index_name(group)
            if index not in group:
                logger.warning(f"Index column '{index}' not found in {obj_name} group")
                return []
            names, _ = _column(f, group[index])
            return [None if n is None else str(n) for n in names.tolist()]

    @cached_method
    def get_obs_var(self, entity: Literal["cells", "genes"], dataset_path: Optional[str] = None,
                    column_names: Optional[List[str]] = None, indices: Optional[List[int]] = None,
                    include_categories: bool = True) -> Dict[str, Any]:
        """obs (cells) or var (genes) columns, as ZarrReader.get_obs_var.

        Without ``column_names`` every column is returned, the index under
        ``_index``. A requested column that does not exist is left out. A
        column that cannot be decoded comes back empty and is logged.
        """
        with _open(dataset_path) as f:
            layer = "obs" if entity == "cells" else "var"
            if layer not in f:
                raise ValueError(f"The H5AD file does not contain '{layer}' group.")
            group = f[layer]
            index = _index_name(group)

            data = {}
            categories = {}
            if column_names is not None:
                columns_to_get = [col for col in column_names if col in group]
            else:
                columns_to_get = [col for col in self._obs_var_columns(f, layer) if col != index]
                if index in group:
                    names, _ = _column(f, group[index], indices)
                    data['_index'] = names.tolist()

            for col_name in columns_to_get:
                try:
                    values, cats = _column(f, group[col_name], indices)
                except Exception as e:
                    logger.error(f"Error getting {layer} column {col_name}: {e}")
                    data[col_name] = []
                    continue
                data[col_name] = values.tolist()
                if cats:
                    categories[col_name] = cats

            result = {'data': data}
            if include_categories and categories:
                result["categories"] = categories
        return result

    def _is_dataframe(self, obj: h5py.Group) -> bool:
        """Check if an h5py object is encoded as a dataframe."""
        if not isinstance(obj, h5py.Group):
            return False

        if _encoding(obj) == 'dataframe':
            return True

        # Alternative: check for dataframe structure markers
        if 'column-order' in obj.attrs or '_index' in obj:
            return True

        return False

    @cached_method
    def get_obsm_varm(self, entity: Literal["cells", "genes"], key: str, dataset_path: Optional[str] = None,
                    indices: Optional[List[int]] = None, col_indices: Optional[List[int]] = None,
                    column_name: Optional[str] = None) -> np.ndarray:
        """
        Get observation/variable multi-dimensional annotations from h5ad file.

        Args:
            entity: Either "cells" (for obsm) or "genes" (for varm)
            key: Key in obsm/varm to get (e.g., "X_pca", "X_umap")
            dataset_path: Path to the h5ad file
            indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            column_name: Optional column name for dataframe-encoded obsm/varm,
                        or integer string for array column index

        Returns:
            numpy.ndarray: The obsm/varm data, or empty array if not found
        """
        with _open(dataset_path) as root:
            obj = "obsm" if entity == "cells" else "varm"

            # Check if the layer and key exist
            if obj not in root or key not in root[obj]:
                return np.array([])

            obsm_varm_obj = root[obj][key]
            is_dataframe = self._is_dataframe(obsm_varm_obj)

            if is_dataframe and column_name is not None:
                if column_name not in obsm_varm_obj:
                    logger.error(f"Column {column_name} not found in dataframe {obj}/{key}")
                    return np.array([])
                try:
                    values, _ = _column(root, obsm_varm_obj[column_name], indices)
                    return values
                except Exception as e:
                    logger.error(f"Error getting dataframe column {column_name}: {e}")
                    return np.array([])

            if not isinstance(obsm_varm_obj, h5py.Dataset):
                logger.warning(f"{obj}/{key} is a Group but not recognized as a dataframe")
                return np.array([])

            # An integer column_name picks one column of an array, 1-D, as
            # the zarr reader returns it; one out of range falls through to
            # the whole selection, as there too.
            if column_name is not None and len(obsm_varm_obj.shape) > 1:
                try:
                    col_idx = int(column_name)
                    if 0 <= col_idx < obsm_varm_obj.shape[1]:
                        return _dense(obsm_varm_obj, indices, [col_idx])[:, 0]
                except ValueError as e:
                    logger.error(f"Error extracting column {column_name} from array {obj}/{key}: {e}")

            return _dense(obsm_varm_obj, indices, col_indices)

    @cached_method
    def get_X(self, dataset_path: Optional[str] = None, row_indices: Optional[List[int]] = None, col_indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get the main expression matrix (X layer) from h5ad file.

        Args:
            dataset_path: Path to the h5ad file
            row_indices: Optional list of row indices to select (cells)
            col_indices: Optional list of column indices to select (genes)

        Returns:
            numpy.ndarray: The expression matrix data, or empty array if X doesn't exist
        """
        with _open(dataset_path) as root:
            if "X" not in root:
                return np.array([])
            return _matrix(root["X"], row_indices, col_indices)

    @cached_method
    def get_uns(self, key: str, dataset_path: Optional[str] = None):
        """uns[key] as plain Python; ``a/b`` reaches into nested dicts.

        Raises:
            KeyError: ``key`` is not in uns, as ZarrReader.get_uns.
        """
        with _open(dataset_path) as root:
            node = root['uns'] if 'uns' in root else None
            for part in key.strip('/').split('/'):
                if not isinstance(node, h5py.Group) or part not in node:
                    raise KeyError(f"No uns key '{key}' in this dataset.")
                node = node[part]
            return _uns_value(node)

    @cached_method
    def get_layer(self, layer_name: str, dataset_path: Optional[str] = None,
              row_indices: Optional[List[int]] = None, col_indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get a specific layer from h5ad file.

        Args:
            layer_name: Name of the layer to retrieve (e.g., "counts", "normalized")
            dataset_path: Path to the h5ad file
            row_indices: Optional list of row indices to select (cells)
            col_indices: Optional list of column indices to select (genes)

        Returns:
            numpy.ndarray: The layer data, or empty array if layer doesn't exist
        """
        with _open(dataset_path) as root:
            layers = root["layers"] if "layers" in root else None
            # 'X' is offered as a layer; without a layer of that name it is X
            if layer_name == "X" and "X" in root and (layers is None or "X" not in layers):
                return _matrix(root["X"], row_indices, col_indices)
            if layers is None or layer_name not in layers:
                return np.array([])
            return _matrix(layers[layer_name], row_indices, col_indices)

    @cached_method
    def get_obsp_varp(self, key: str, entity: Literal["cells", "genes"], dataset_path: Optional[str] = None,
                  row_indices: Optional[List[int]] = None, col_indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get pairwise annotations (obsp for cells, varp for genes) from h5ad file.

        Args:
            key: Key in obsp/varp to get (e.g., "distances", "connectivities")
            entity: Either "cells" (for obsp) or "genes" (for varp)
            dataset_path: Path to the h5ad file
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select

        Returns:
            numpy.ndarray: The obsp/varp data, or empty array if not found
        """
        with _open(dataset_path) as root:
            obj = "obsp" if entity == "cells" else "varp"
            if obj not in root or key not in root[obj]:
                return np.array([])
            return _matrix(root[obj][key], row_indices, col_indices)
