"""S4 at the route: ``POST /api/v1/data/cell_groups`` answers "% expressing any gene" as the direct count.

The feature is the one 10.1a of aggregation-unify-080.md plans (a ``detected`` score of the up genes, ``down: []``,
``above: 0``); the value of a group is ``100 * n_above / n`` of its moments. The core is pinned in
tests/core/test_any_gene_detected.py; here the same numbers come through the route's stream, on CSC, CSR and dense
stores, with a subset shown and with down genes refused.
"""
import json

import numpy as np
import pytest

from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.server.routes import cell_groups as route
from annzarro.tests.core import grouping_store as gstore
from annzarro.tests.server.test_cell_groups_route import CELL_TYPE, grouping, parse

URL = "/api/v1/data/cell_groups"
UP = gstore.SIGNATURES["up_and_down"]["up"]
DOWN = gstore.SIGNATURES["up_and_down"]["down"]


@pytest.fixture(scope="module")
def data():
    return gstore.make_data()


@pytest.fixture(scope="module")
def layout(tmp_path_factory, data):
    base = tmp_path_factory.mktemp("anygene_route")
    (base / "data").mkdir()
    for kind in gstore.LAYOUTS:
        gstore.make_store(base / "data" / f"{kind}.zarr", kind, "zarr", data=data)
    return base


@pytest.fixture(autouse=True)
def fresh():
    zarr_reader.clear_cache()
    cell_subset.clear()
    route.CODES.clear()
    yield
    zarr_reader.clear_cache()
    cell_subset.clear()
    route.CODES.clear()


@pytest.fixture
def client(layout, tmp_path):
    return create_app({"TESTING": True, "data_dir": str(layout / "data"),
                       "log_file": str(tmp_path / "t.log")}).test_client()


def feature(genes, layer, t, down=()):
    return {"id": "any", "kind": "score",
            "recipe": {"genes": list(genes), "down": list(down), "method": "fraction_of_genes", "detect_above": t},
            "column": "fraction_of_genes", "layer": layer, "above": 0}


def ask(client, layout, kind, features, **kw):
    body = grouping([{"source": CELL_TYPE}], features=features, **kw)
    return client.post(URL, query_string={"dataset_path": str(layout / "data" / f"{kind}.zarr")},
                       data=json.dumps(body), content_type="application/json")


def oracle(data, layer, genes, t, groups, rows=None):
    x = data.layer(layer)[:, [data.var_names.index(g) for g in genes]].astype(np.float64)
    types = data.obs["cell_type"].astype(str).to_numpy()
    if rows is not None:
        x, types = x[rows], types[rows]
    finite = np.isfinite(x)
    has, expressed = finite.any(axis=1), (finite & (x > t)).any(axis=1)
    return np.array([[has[types == g["key"][0][2:]].sum(), expressed[types == g["key"][0][2:]].sum()]
                     for g in groups])


@pytest.mark.parametrize("kind", gstore.LAYOUTS)
@pytest.mark.parametrize("layer,t", [("counts", 0), ("counts", 3), ("X", 1)])
def test_the_route_answers_the_direct_count(client, layout, data, kind, layer, t):
    resp = ask(client, layout, kind, [feature(UP, layer, t)])
    assert resp.status_code == 200, resp.get_data(as_text=True)
    frames, blocks = parse(resp.get_data())
    result = frames[-1]
    assert result["features"] == [{"id": "any", "status": "ok"}]
    moments = blocks["feature_moments"][0]
    want = oracle(data, layer, UP, t, result["groups"])
    assert moments[:, 0].tolist() == want[:, 0].tolist() and moments[:, 3].tolist() == want[:, 1].tolist()
    assert (want[:, 1] < want[:, 0]).any() and want[:, 1].sum() > 0


SUBSET = {"n": 37, "seed": 5}


def test_a_subset_shown_is_the_cells_counted(client, layout, data):
    resp = ask(client, layout, "csc", [feature(UP, "counts", 1)], subset=SUBSET)
    assert resp.status_code == 200, resp.get_data(as_text=True)
    frames, blocks = parse(resp.get_data())
    rows, _ = cell_subset.select_indices(gstore.N_OBS, cell_subset.parse_spec(SUBSET), None)
    want = oracle(data, "counts", UP, 1, frames[-1]["groups"], rows=np.asarray(rows))
    moments = blocks["feature_moments"][0]
    assert frames[-1]["n_shown"] == 37
    assert moments[:, 0].tolist() == want[:, 0].tolist() and moments[:, 3].tolist() == want[:, 1].tolist()


def test_a_recipe_with_down_genes_is_refused_so_the_browser_sends_none(client, layout):
    resp = ask(client, layout, "csc", [feature(UP, "counts", 0, down=DOWN)])
    assert resp.status_code == 400, resp.get_data(as_text=True)
    assert "no meaningful signed version" in resp.get_data(as_text=True)
