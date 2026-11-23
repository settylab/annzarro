"""Shared pieces of the three 0.8.0 end-to-end tests (Cell Grouping, Cell-Gene Plot, Cell Count Plot).

Not a test module. A real ``annzarro start`` serves a real store (the grouping fixture of
``tests/core/grouping_store.py``: 1,200 cells, ``cell_type`` with 6 levels, ``condition``, 40 genes, layers ``logged``
and ``counts``); a headless Chromium opens the page, and every panel is opened from the "Create New Panel" chooser,
as a user does. The reference numbers are read back from the store's own arrays here, never from the data
object the store was written from.
"""
import numpy as np
import pytest
import scipy.sparse as sp

from annzarro.tests import zarr_compat
from annzarro.tests.core import grouping_store as gstore
from annzarro.tests.e2e.dsb_servers import Session, _require, start

STORE = "grouping.zarr"


@pytest.fixture(scope="module")
def grouping_server(tmp_path_factory):
    """One store, so the first load opens it; yields (base URL, the store's path)."""
    _require()
    tmp = tmp_path_factory.mktemp("e2e_grouping")
    data = tmp / "data"
    data.mkdir()
    store = gstore.make_store(str(data / STORE), "csc", "zarr", data=gstore.make_data())
    base, proc = start(tmp, data)
    yield base, store
    proc.terminate()
    proc.wait(20)


@pytest.fixture
def user(grouping_server):
    s = Session(grouping_server[0], width=1500, height=1100)
    yield s.page
    errors = list(s.errors)
    s.close()
    assert not errors, errors


# ------------------------------------------------------------------ the chooser

def create_panel(page, panel_type):
    """Open a panel of ``panel_type`` from the chooser; return its id. The first panel goes where the welcome chooser
    is, a later one is made by splitting a tile, which shows the chooser in the new half."""
    before = set(page.evaluate("() => window.PanelManager.getAllPanels().map(p => p.getId())"))
    option = f".tile-selector .panel-type-option[data-type='{panel_type}']"
    if not page.locator(option).count() and page.locator(".tile .tile-split-h").count():
        page.locator(".tile .tile-split-h").last.click()
    page.wait_for_selector(option, state="visible", timeout=30000)
    page.locator(option).first.click()
    page.wait_for_function(
        "([t, b]) => window.PanelManager.getPanelsByType(t).some(p => !b.includes(p.getId()))", arg=[panel_type, sorted(before)],
        timeout=30000)
    return page.evaluate(
        "([t, b]) => window.PanelManager.getPanelsByType(t).map(p => p.getId()).find(id => !b.includes(id))",
        [panel_type, sorted(before)])


def tile(panel_id):
    return f'.tile[data-tile-id="{panel_id}"]'


# ------------------------------------------------------------------ the store, read back on its own

def _root(store):
    return zarr_compat.open_group(store, mode="r")


def obs_levels(store, key):
    """(categories, codes) of a categorical obs column as the store holds them."""
    g = _root(store)[f"obs/{key}"]
    return [str(c) for c in np.asarray(g["categories"][:])], np.asarray(g["codes"][:]).astype(int)


def value_counts(store, key):
    """{level: cells} of a categorical obs column, in the store's category order, empty levels left out."""
    cats, codes = obs_levels(store, key)
    counts = np.bincount(codes[codes >= 0], minlength=len(cats))
    return {c: int(n) for c, n in zip(cats, counts) if n}


def gene_names(store):
    return [str(v) for v in np.asarray(_root(store)["var/_index"][:])]


def gene_column(store, layer, gene):
    """One gene's values over all cells, from the store's own CSC arrays of ``layer``."""
    root = _root(store)
    g = root["X"] if layer == "X" else root["layers"][layer]
    shape = tuple(g.attrs["shape"])
    m = sp.csc_matrix((np.asarray(g["data"][:]), np.asarray(g["indices"][:]), np.asarray(g["indptr"][:])), shape=shape)
    return np.asarray(m[:, gene_names(store).index(gene)].todense()).ravel().astype(np.float64)
