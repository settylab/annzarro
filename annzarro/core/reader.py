from typing import Protocol, Literal, Optional, List, Dict, Any
import numpy as np

class Reader(Protocol):
    def get_metadata(self) -> str:
        pass

    def get_cell_gene_names(self, dataset_path: str, entity: Literal["cells", "genes"], use_cache: bool = True) -> list:
        pass

    def get_obs_var(self, entity: Literal["cells", "genes"], dataset_path: Optional[str] = None,
               indices: Optional[List[int]] = None, column_names: Optional[List[str]] = None,
               include_categories: bool = True) -> Dict[str, Any]:
        pass
    def get_obsm_varm(self, entity: Literal["cells", "genes"], key: str, dataset_path: Optional[str] = None,
                    indices: Optional[List[int]] = None, col_indices: Optional[List[int]] = None,
                    column_name: Optional[str] = None) -> np.ndarray:
        pass

    def get_obsp_varp(self, key: str, entity: Literal["cells", "genes"], dataset_path: Optional[str] = None,
                  row_indices: Optional[List[int]] = None, col_indices: Optional[List[int]] = None) -> np.ndarray:
        pass

    def get_uns(self, key: str, dataset_path: Optional[str] = None):
        pass

    def get_X(dataset_path: str, row_indices, col_indices):
        pass

    def get_layer(self, layer_name: str, dataset_path: Optional[str] = None,
              row_indices: Optional[List[int]] = None, col_indices: Optional[List[int]] = None):
        pass