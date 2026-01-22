import h5py
import logging
from typing import Literal, Tuple, Dict, Any, List, Optional

logger = logging.getLogger(__name__)

class h5adReader:

    def __init__(self):
        pass

    def _extract_h5ad_shape(self, file: h5py.File, has_fields: dict) -> Tuple[int, int]:
        #Check if we can extract the shape from X
        if has_fields['has_X']:
            #X is a dense array
            if isinstance(file['X'], h5py.Dataset):
                return file['X'].shape
            #X is a sparse array
            elif isinstance(file['X'], h5py.Group):
                required_keys = {"data", "indices", "indptr", "shape"}
                if required_keys.issubset(file["X"].keys()):
                    #Extract the shape
                    return tuple(file['X']['shape'][...])
                #Else we need to try a different approach
        #See if we can extract shape from layers
        if has_fields['has_layers']:
            first_layer = list(file["layers"].keys())[0]
            return file["layers"][first_layer].shape
        #See if we can extract shape from obs/var
        if has_fields['has_obs'] and has_fields['has_var']:
            n_obs = len(file["obs"]) if "obs" in file else 0
            n_vars = len(file["var"]) if "var" in file else 0
            return (n_obs, n_vars)
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
                columns = [c for c in obj.keys() if c != "_index"]
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

    def get_metadata(self, file_path: str) -> dict:
        metadata = {}
        try:
            with h5py.File(file_path, "r") as file:
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

                metadata['embeddings'] = [k for k in file['obsm'].keys() if k.startswith("X_")] if "obsm" in file else []
                metadata['obs_columns_info'] = self._get_obs_var_columns_metadata(file, "obs") if metadata['has_obs'] else {}
                metadata['var_columns_info'] = self._get_obs_var_columns_metadata(file, "var") if metadata['has_var'] else {}
                metadata['layers_info'] = self._get_h5ad_layers_metadata(file) if metadata['has_layers'] else {}
                metadata['obsm_info'], metadata['obsm_dataframes'] = self._get_h5ad_obsm_varm_metadata(file, "obsm") if metadata['has_obsm'] else ({}, {})
                metadata['varm_info'], metadata['varm_dataframes'] = self._get_h5ad_obsm_varm_metadata(file, "varm") if metadata['has_varm'] else ({}, {})
        except Exception as e:
            logger.error(f"Could not get h5ad metadata: {e}")

        return metadata

    def get_cell_gene_names(self, file_name: str, entity: Literal["cells", "genes"], use_cache: bool = True) -> list[str]:
        obj_name = "obs" if entity == "cells" else "var"
        with h5py.File(file_name, "r") as f:
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


    def get_obs_var(self, entity: Literal["cells", "genes"], dataset_path: Optional[str] = None, 
                    column_names: Optional[List[str]] = None, indices: Optional[List[int]] = None, 
                    include_categories: bool = True) -> Dict[str, Any]:
        with h5py.File(dataset_path, "r") as f:
            layer = "obs" if entity == "cells" else "var"
            if layer not in f:
                raise ValueError(f"The H5AD file does not contain '{layer}' group.")

            result = {}
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



