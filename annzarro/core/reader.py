from typing import Protocol, Literal, Optional, List, Dict, Any

class Reader(Protocol):
    def get_metadata(self) -> str:
        pass

    def get_cell_gene_names(self, dataset_path: str, entity: Literal["cells", "genes"], use_cache: bool = True) -> list:
        pass

    def get_obs_var(self, entity: Literal["cells", "genes"], dataset_path: Optional[str] = None,
               indices: Optional[List[int]] = None, column_names: Optional[List[str]] = None,
               include_categories: bool = True) -> Dict[str, Any]:
        pass