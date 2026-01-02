import h5py
import logging
from typing import Literal, Tuple

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
                columns = [c for c in obj.keys()]
                columns_info = {}
                for column in columns:
                    col_obj = obj[column]
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



