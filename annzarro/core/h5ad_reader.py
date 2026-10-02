import h5py
import logging
from typing import Literal, Tuple, Dict, Any, List, Optional
import numpy as np
from scipy.sparse import csr_matrix, csc_matrix
from .caching import CacheSettings, DatasetCache, cached_method

logger = logging.getLogger(__name__)

class h5adReader(CacheSettings):

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
        """Extract (n_obs, n_vars) from a sparse-matrix group.

        Standard AnnData (>=0.7) stores the shape as an attribute on the group
        (``encoding-type`` csr/csc_matrix, ``shape`` attr); much older stores
        wrote it as a child dataset. Handle both, returning None if neither.
        """
        if "shape" in group.attrs:
            return tuple(int(v) for v in group.attrs["shape"][...])
        if "shape" in group.keys():
            return tuple(int(v) for v in group["shape"][...])
        return None

    def _extract_h5ad_shape(self, file: h5py.File, has_fields: dict) -> Tuple[int, int]:
        #Check if we can extract the shape from X
        if has_fields['has_X']:
            #X is a dense array
            if isinstance(file['X'], h5py.Dataset):
                return file['X'].shape
            #X is a sparse array (shape in group attrs for standard AnnData)
            elif isinstance(file['X'], h5py.Group):
                shape = self._sparse_group_shape(file['X'])
                if shape is not None:
                    return shape
        #See if we can extract shape from layers
        if has_fields['has_layers']:
            first_layer = list(file["layers"].keys())[0]
            layer = file["layers"][first_layer]
            if isinstance(layer, h5py.Dataset):
                return layer.shape
            elif isinstance(layer, h5py.Group):
                shape = self._sparse_group_shape(layer)
                if shape is not None:
                    return shape
        #Fall back to the lengths of the obs/var index datasets (n_obs, n_vars)
        if has_fields['has_obs'] and has_fields['has_var']:
            def _index_len(group_name):
                if group_name not in file:
                    return 0
                group = file[group_name]
                idx_key = "_index"
                if isinstance(group, h5py.Group) and idx_key in group:
                    return int(group[idx_key].shape[0])
                return 0
            return (_index_len("obs"), _index_len("var"))
        else:
            return (0, 0)

    def _get_obs_var_columns_metadata(self, file: h5py.File, obj_name: str) -> dict:
        """
        Returns a dictionary of columns in obs/var with their type:
        'categorical', 'numeric', or 'other'.
        """
        obj_columns_info = {}
        for col in file[obj_name].keys():
            if col == "_index":
                continue
            obj = file[obj_name][col]
            encoding_type = obj.attrs.get('encoding-type', None)

            if isinstance(obj, h5py.Group):
                col_type = "categorical"  # categorical columns are groups
            elif isinstance(obj, h5py.Dataset):
                encoding_type = obj.attrs.get("encoding-type", None)
                if encoding_type in (b'categorical', 'categorical'):
                    col_type = "categorical"
                else:
                    col_type = str(obj.dtype)  # numeric or string dtype
            else:
                col_type = "other"

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
                encoding_type = layer.attrs.get("encoding-type", None)
                if encoding_type is not None:
                    if isinstance(encoding_type, bytes):
                        encoding_type = encoding_type.decode("utf-8")
                    if encoding_type in ['csr_matrix', 'csc_matrix', 'coo_matrix'] and "shape" in layer.attrs:
                        layer_type = encoding_type
                        layer_shape = tuple(int(x) for x in layer.attrs["shape"][...])

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
                    dataframes[key]["encoding_type"] = attrs["encoding-type"]
                if "encoding-version" in attrs: 
                    dataframes[key]["encoding_version"] = attrs["encoding-version"]

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
        metadata = {}
        try:
            with h5py.File(dataset_path, "r") as file:
                anndata_keys = ['X', 'obs', 'var', 'obsm', 'varm', 'obsp', 'varp', 'layers', 'uns']

                for key in anndata_keys:
                    metadata[f"has_{key}"] = key in file.keys()

                metadata['shape'] = self._extract_h5ad_shape(file, metadata)

                for key in anndata_keys:
                    if key == "X":
                        continue
                    elif key == "obs" or key == "var":
                        metadata[f'{key}_columns'] = list(file[key].keys()) if key in file else []
                    else:
                        metadata[key] = {'keys': list(file[key].keys()) if key in file else []}

                # every obsm key (not only X_*), as the axis menus offer
                metadata['embeddings'] = list(file['obsm'].keys()) if "obsm" in file else []
                metadata['obs_columns_info'] = self._get_obs_var_columns_metadata(file, "obs") if metadata['has_obs'] else {}
                metadata['var_columns_info'] = self._get_obs_var_columns_metadata(file, "var") if metadata['has_var'] else {}
                metadata['layers_info'] = self._get_h5ad_layers_metadata(file) if metadata['has_layers'] else {}
                metadata['obsm_info'], metadata['obsm_dataframes'] = self._get_h5ad_obsm_varm_metadata(file, "obsm") if metadata['has_obsm'] else ({}, {})
                metadata['varm_info'], metadata['varm_dataframes'] = self._get_h5ad_obsm_varm_metadata(file, "varm") if metadata['has_varm'] else ({}, {})
        except Exception as e:
            logger.error(f"Could not get h5ad metadata: {e}")

        return metadata

    def get_cell_gene_names(self, dataset_path: str, entity: Literal["cells", "genes"], use_cache: bool = True) -> list[str]:
        obj_name = "obs" if entity == "cells" else "var"
        with h5py.File(dataset_path, "r") as f:
            if obj_name not in f:
                raise ValueError(f"The H5AD file does not contain '{obj_name}' group.")

            obj = f[obj_name]
            if "_index" in obj:
                names = [x.decode("utf-8") for x in obj["_index"][...]]
            else:
                names = []
                
        return names
    
    def _get_obs_var_numerical_data(self, obj: h5py.Dataset, indices: list[int] = None) -> list:
        col_data_raw = obj[...] if indices is None else obj[indices]
        # Decode bytes if needed
        col_data = []
        for num in col_data_raw:
            if isinstance(num, bytes):
                x = num.decode("utf-8")
            elif hasattr(num, "item"):
                x = num.item()
            else:
                x = num

            col_data.append(x)
        return col_data

    def _get_obs_var_categorical_data(self, obj: h5py.Group, indices: list[int] = None):
        encoding_type = obj.attrs.get("encoding-type", None)
        category_names = None
        categories_exist = False
        if encoding_type in (b"categorical", "categorical"):
            # Retrieve all possible categories
            categories_exist = True
            if "categories" in obj.attrs:
                categories_raw = obj.attrs["categories"]
            else:
                categories_raw = obj.get("categories", [])
            category_names = [val.decode("utf-8") if isinstance(val, bytes) else val for val in categories_raw]
        
        if 'codes' in obj:
            values_ds = obj['codes']
            if indices is None:
                col_data_raw = values_ds[:]
            else:
                col_data_raw = values_ds[indices]
            col_data = [int(x.decode("utf-8")) if isinstance(x, bytes) else int(x) for x in col_data_raw]
            if category_names is not None:
                # map integer codes to category strings
                col_data = [category_names[i] if (i >= 0 and i < len(category_names)) else None for i in col_data]
        
        return col_data, category_names, categories_exist


    @cached_method
    def get_obs_var(self, entity: Literal["cells", "genes"], dataset_path: Optional[str] = None,
                    column_names: Optional[List[str]] = None, indices: Optional[List[int]] = None,
                    include_categories: bool = True) -> Dict[str, Any]:
        with h5py.File(dataset_path, "r") as f:
            layer = "obs" if entity == "cells" else "var"
            if layer not in f:
                raise ValueError(f"The H5AD file does not contain '{layer}' group.")

            result = {'data': {}}
            data = {}
            categories = {}
            categories_exist = False

            if column_names is not None:
                columns_to_get = [col for col in column_names]
            else:
                columns_to_get = [col for col in f[layer].keys()]

            for col_name in columns_to_get:
                if col_name not in f[layer]:
                    continue
                obj = f[layer][col_name]
                
                #Numerical data
                if isinstance(obj, h5py.Dataset):
                    data[col_name] = self._get_obs_var_numerical_data(obj, indices)
                #Possibly categorical data
                elif isinstance(obj,h5py.Group):
                    #Get the categories
                    data[col_name], categories[col_name], categories_exist = self._get_obs_var_categorical_data(obj, indices)
                else:
                    raise ValueError("This column is not a Group nor a Dataset - it is therefore not supported")
                
            result["data"] = data
            if include_categories and categories_exist:
                result["categories"] = categories
        return result
    
    def _is_dataframe(self, obj: h5py.Group) -> bool:
        """Check if an h5py object is encoded as a dataframe."""
        if not isinstance(obj, h5py.Group):
            return False

        encoding_type = obj.attrs.get('encoding-type', None)
        if encoding_type in (b'dataframe', 'dataframe'):
            return True

        # Alternative: check for dataframe structure markers
        if 'column-order' in obj.attrs or '_index' in obj:
            return True

        return False


    def _get_dataframe_column(self, obj: h5py.Group, column_name: str, indices: Optional[List[int]] = None) -> np.ndarray:
        """Get a specific column from a dataframe-encoded h5py Group."""
        if column_name not in obj:
            raise ValueError(f"Column '{column_name}' not found in dataframe")

        col_obj = obj[column_name]

        # Handle categorical data
        if isinstance(col_obj, h5py.Group) and 'codes' in col_obj:
            codes_ds = col_obj['codes']
            if indices is None:
                codes = codes_ds[:]
            else:
                codes = codes_ds[indices]

            # Get categories if they exist
            if 'categories' in col_obj:
                categories = col_obj['categories'][:]
                categories = np.array([cat.decode('utf-8') if isinstance(cat, bytes) else cat for cat in categories])
                return np.array([categories[int(code)] if 0 <= int(code) < len(categories) else None for code in codes])
            return codes

        # Handle array-encoded columns (Group with '0' dataset)
        elif isinstance(col_obj, h5py.Group) and '0' in col_obj:
            data_ds = col_obj['0']
            if indices is None:
                data = data_ds[:]
            else:
                data = data_ds[indices]

            # Decode bytes if needed
            if data.dtype.kind == 'S' or data.dtype.kind == 'O':
                data = np.array([val.decode('utf-8') if isinstance(val, bytes) else val for val in data])

            return data

        # Regular dataset
        elif isinstance(col_obj, h5py.Dataset):
            if indices is None:
                data = col_obj[:]
            else:
                data = col_obj[indices]

            # Decode bytes if needed
            if data.dtype.kind == 'S' or data.dtype.kind == 'O':
                data = np.array([val.decode('utf-8') if isinstance(val, bytes) else val for val in data])

            return data

        raise ValueError(f"Unsupported column type for '{column_name}'")


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
        with h5py.File(dataset_path, "r") as root:
            obj = "obsm" if entity == "cells" else "varm"

            # Check if the layer and key exist
            if obj not in root or key not in root[obj]:
                return np.array([])

            obsm_varm_obj = root[obj][key]

            # Check if this is a dataframe and column_name is specified
            is_dataframe = self._is_dataframe(obsm_varm_obj)

            if is_dataframe and column_name is not None:
                # Get specific column from dataframe
                try:
                    return self._get_dataframe_column(obsm_varm_obj, column_name, indices)
                except ValueError:
                    # Column not found, return empty array
                    return np.array([])

            # Check if we're dealing with a regular array but requested a specific column
            if not is_dataframe and column_name is not None:
                if isinstance(obsm_varm_obj, h5py.Dataset):
                    # Try to interpret column_name as an integer index
                    if col_indices is not None:
                        return self._get_dense_array(obsm_varm_obj, indices, col_indices)
                    try:
                        col_idx = int(column_name)
                        if col_idx < obsm_varm_obj.shape[1]:
                            # Extract single column efficiently at h5py level
                            return self._get_dense_array(obsm_varm_obj, indices, [col_idx])
                    except (ValueError, IndexError) as e:
                        logger.error(f"Error extracting column {column_name} from array {obj}/{key}: {e}")

            # Get the obsm/varm data as a regular array
            if isinstance(obsm_varm_obj, h5py.Dataset):
                return self._get_dense_array(obsm_varm_obj, indices, col_indices)
            else:
                # If it's a Group but not a dataframe, try to handle it
                logger.warning(f"{obj}/{key} is a Group but not recognized as a dataframe")
                return np.array([])
    
    def _get_dense_array(self, obj: h5py.Dataset, row_indices: Optional[List[int]] = None,
                    col_indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get a dense array from an h5py Dataset, with optional subsetting.

        Args:
            obj: h5py Dataset
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select

        Returns:
            numpy.ndarray: The requested data
        """
        # Efficient h5py-level slicing
        if row_indices is None and col_indices is None:
            data = obj[:]
        elif row_indices is None and col_indices is not None:
            if len(col_indices) == 1:
                data = obj[:, col_indices[0]]  # 1D array
            else:
                data = obj[:, col_indices]
        elif row_indices is not None and col_indices is None:
            data = obj[row_indices]
        else:
            if len(col_indices) == 1:
                data = obj[row_indices, col_indices[0]]  # 1D array
            else:
                # h5py doesn't support np.ix_, use two-step indexing
                data = obj[row_indices, :][:, col_indices]

        return data


    def _load_sparse_matrix(self, X_obj: h5py.Group, row_indices: Optional[List[int]] = None,
                        col_indices: Optional[List[int]] = None):
        """
        Load a sparse matrix from an h5py group.

        Args:
            X_obj: h5py Group containing sparse matrix components
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select

        Returns:
            scipy.sparse matrix or None if loading fails
        """
        # Check for required sparse matrix components
        has_data = "data" in X_obj
        has_indices = "indices" in X_obj
        has_indptr = "indptr" in X_obj
        has_shape = "shape" in X_obj or "shape" in X_obj.attrs

        if not (has_data and has_indices and has_indptr and has_shape):
            return None

        # Get sparse matrix components
        sp_data = X_obj["data"][:]
        sp_indices = X_obj["indices"][:]
        sp_indptr = X_obj["indptr"][:]

        # Get shape from either dataset or attribute
        if "shape" in X_obj:
            sp_shape = tuple(X_obj["shape"][:])
        else:
            sp_shape = tuple(X_obj.attrs["shape"])

        # Check encoding type
        encoding_type = X_obj.attrs.get("encoding-type", b"csr_matrix")
        if isinstance(encoding_type, bytes):
            encoding_type = encoding_type.decode("utf-8")

        # Construct sparse matrix
        if encoding_type == "csr_matrix":
            sparse_matrix = csr_matrix((sp_data, sp_indices, sp_indptr), shape=sp_shape)
        elif encoding_type == "csc_matrix":
            sparse_matrix = csc_matrix((sp_data, sp_indices, sp_indptr), shape=sp_shape)
        else:
            return None

        # Apply subsetting
        if row_indices is not None:
            sparse_matrix = sparse_matrix[row_indices, :]
        if col_indices is not None:
            sparse_matrix = sparse_matrix[:, col_indices]

        return sparse_matrix


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
        with h5py.File(dataset_path, "r") as root:
            if "X" not in root:
                return np.array([])

            X_obj = root["X"]

            # Handle dense matrix (Dataset)
            if isinstance(X_obj, h5py.Dataset):
                return self._get_dense_array(X_obj, row_indices, col_indices)

            # Handle sparse matrix (Group with CSR/CSC format)
            elif isinstance(X_obj, h5py.Group):
                sparse_matrix = self._load_sparse_matrix(X_obj, row_indices, col_indices)

                if sparse_matrix is None:
                    return np.array([])

                # Convert to dense array
                dense = sparse_matrix.toarray()

                # Handle single column case to return 1D array
                if col_indices is not None and len(col_indices) == 1:
                    dense = dense.ravel()

                return dense

            return np.array([])


    @cached_method
    def get_uns(self, key: str, dataset_path: Optional[str] = None):
        with h5py.File(dataset_path, "r") as root:
            obj = "uns"
            if obj not in root or key not in root[obj]:
                return None

            uns_obj = root[obj][key]

            # Handle Dataset (arrays, scalars)
            if isinstance(uns_obj, h5py.Dataset):
                data = uns_obj[()]

                # Decode bytes to strings if needed
                if isinstance(data, bytes):
                    return data.decode('utf-8')
                elif isinstance(data, np.ndarray):
                    # Handle array of bytes
                    if data.dtype.kind in ('S', 'O'):
                        if data.ndim == 0:
                            # Scalar
                            return data.item().decode('utf-8') if isinstance(data.item(), bytes) else data.item()
                        else:
                            # Array - decode and convert to Python list of strings
                            decoded = np.array([val.decode('utf-8') if isinstance(val, bytes) else val for val in data.flat]).reshape(data.shape)
                            return decoded.tolist()
                    return data
                else:
                    return data

            # Handle Group (dictionaries, dataframes, nested structures)
            elif isinstance(uns_obj, h5py.Group):
                # Try to convert to dictionary recursively
                result = {}
                for subkey in uns_obj.keys():
                    # Recursively get nested data
                    subobj = uns_obj[subkey]
                    if isinstance(subobj, h5py.Dataset):
                        subdata = subobj[()]
                        if isinstance(subdata, bytes):
                            result[subkey] = subdata.decode('utf-8')
                        elif isinstance(subdata, np.ndarray) and subdata.dtype.kind in ('S', 'O'):
                            if subdata.ndim == 0:
                                result[subkey] = subdata.item().decode('utf-8') if isinstance(subdata.item(), bytes) else subdata.item()
                            else:
                                decoded = np.array([val.decode('utf-8') if isinstance(val, bytes) else val for val in subdata.flat]).reshape(subdata.shape)
                                result[subkey] = decoded.tolist()
                        else:
                            result[subkey] = subdata
                    elif isinstance(subobj, h5py.Group):
                        # Nested group - return as-is or could recursively process
                        result[subkey] = dict(subobj.attrs) if len(subobj.keys()) == 0 else f"<HDF5 Group: {subkey}>"
                    else:
                        result[subkey] = None

                # Also include attributes if any
                if len(uns_obj.attrs) > 0:
                    for attr_key, attr_val in uns_obj.attrs.items():
                        if attr_key not in result:
                            if isinstance(attr_val, bytes):
                                result[attr_key] = attr_val.decode('utf-8')
                            else:
                                result[attr_key] = attr_val

                return result
            return None

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
        # 'X' is offered as a layer; without a layer of that name it is X
        with h5py.File(dataset_path, "r") as root:
            use_x = layer_name == "X" and "X" in root and \
                ("layers" not in root or "X" not in root["layers"])
        if use_x:
            return self.get_X(dataset_path=dataset_path, row_indices=row_indices, col_indices=col_indices)

        with h5py.File(dataset_path, "r") as root:
            if "layers" not in root:
                return np.array([])

            if layer_name not in root["layers"]:
                return np.array([])

            layer_obj = root["layers"][layer_name]

            # Handle dense layer (Dataset)
            if isinstance(layer_obj, h5py.Dataset):
                return self._get_dense_array(layer_obj, row_indices, col_indices)

            # Handle sparse layer (Group with CSR/CSC format)
            elif isinstance(layer_obj, h5py.Group):
                sparse_matrix = self._load_sparse_matrix(layer_obj, row_indices, col_indices)

                if sparse_matrix is None:
                    return np.array([])

                # Convert to dense array
                dense = sparse_matrix.toarray()

                # Handle single column case to return 1D array
                if col_indices is not None and len(col_indices) == 1:
                    dense = dense.ravel()

                return dense

            return np.array([])

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
        with h5py.File(dataset_path, "r") as root:
            obj = "obsp" if entity == "cells" else "varp"

            # Check if the layer and key exist
            if obj not in root or key not in root[obj]:
                return np.array([])

            obsp_varp_obj = root[obj][key]

            # Handle dense matrix (Dataset)
            if isinstance(obsp_varp_obj, h5py.Dataset):
                return self._get_dense_array(obsp_varp_obj, row_indices, col_indices)

            # Handle sparse matrix (Group with CSR/CSC format)
            elif isinstance(obsp_varp_obj, h5py.Group):
                sparse_matrix = self._load_sparse_matrix(obsp_varp_obj, row_indices, col_indices)

                if sparse_matrix is None:
                    return np.array([])

                # Convert to dense array
                return sparse_matrix.toarray()

            return np.array([])

