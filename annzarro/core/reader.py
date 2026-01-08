from typing import Protocol, Literal

class Reader(Protocol):
    def get_metadata(self) -> str:
        pass

    def get_cell_gene_names(self, dataset_path: str, entity: Literal["cells", "genes"], use_cache: bool = True) -> list:
        pass