"""An obsp row is a per-cell source only up to the large-plot threshold (1M cells; requirements 8.6, engine review M3),
and the cell-name list of a large store is never built to find the row."""
import numpy as np
import pytest

from annzarro.core import cell_sources as cs
from annzarro.core import get_reader
from annzarro.tests.core.cell_sources_store import make_cell_store
from annzarro.tests.core.gene_score_store import N_OBS

SOURCE = {"type": "obsp", "key": "dense_p", "column": "41"}


@pytest.fixture(scope="module")
def store(tmp_path_factory):
    return make_cell_store(tmp_path_factory.mktemp("obsp") / "s.zarr", "csc", "zarr")[0]


def test_the_limit_is_the_large_plot_threshold():
    assert cs.OBSP_MAX_CELLS == 1_000_000


def test_a_row_of_a_dataset_over_the_limit_is_refused_with_the_count_and_the_limit(store, monkeypatch):
    reader = get_reader(store)
    assert cs.cost(reader, store, SOURCE).n_cells == N_OBS                      # inside the limit
    monkeypatch.setattr(cs, "OBSP_MAX_CELLS", N_OBS - 1)
    with pytest.raises(cs.CellSourceError) as info:
        cs.cost(reader, store, SOURCE)
    assert (info.value.status, info.value.reason) == (422, "obsp_too_large")
    assert info.value.extra == {"count": N_OBS, "limit": N_OBS - 1} and "obs or obsm" in info.value.message
    monkeypatch.setattr(cs, "OBSP_MAX_CELLS", N_OBS)
    cs.cost(reader, store, SOURCE)                                                # exactly the limit is allowed


def test_the_cell_names_of_a_large_dataset_are_never_listed(store, monkeypatch):
    reader = get_reader(store)
    monkeypatch.setattr(cs, "OBSP_MAX_CELLS", N_OBS - 1)

    def listed(*a, **k):
        raise AssertionError("the list of every cell name was built")
    monkeypatch.setattr(type(reader), "get_cell_gene_names", listed)
    for name in ("41", "CELL0041"):
        with pytest.raises(cs.CellSourceError) as info:
            list(cs.column(reader, store, {**SOURCE, "column": name}, None))
        assert info.value.reason == "obsp_too_large"


def test_a_row_of_a_dataset_inside_the_limit_is_read_as_before(store):
    reader = get_reader(store)
    values = np.concatenate([s.values for s in cs.column(reader, store, SOURCE, None)])
    assert values.shape == (N_OBS,)
