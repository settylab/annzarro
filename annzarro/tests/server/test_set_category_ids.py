"""Level ids of a numeric categorical column in the Count plot's sets (0.8.1 S2).

A "Levels of a column" set picks categories of an obs column. The browser used to build each category's id from the
label the obs route sent as a JSON number: a float32 category 0.1 arrives as 0.10000000149011612 (a float64), an
integer above 2**53 as a number JavaScript cannot hold exactly, so the id it wrote (`c:0.10000000149011612`,
`c:9007199254740992`) matched no level of the engine (`c:0.1`, `c:9007199254740993`) or the wrong one. The route now
sends each category's id beside its label (``ids``), the very id the engine gives that level (it keeps the ids it always
had: a float32 category is its float64 widening, ``c:0.10000000149011612``), and the browser uses it as it is.
"""
import json

import numpy as np
import pytest

from annzarro.core import cell_groups as cg
from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.tests.server.test_cell_groups_route import parse
from annzarro.tests.server.test_categorical_codes import _categorical, _frame
from annzarro.tests.zarr_compat import open_group, write_array

N_OBS = 60
F32 = np.array([0.1, 0.2, 0.3], dtype=np.float32)
F32_IDS = [cg.canonical_label(float(v)) for v in F32]    # the engine's ids: the float32 widened, as in 0.8.0
BIG = np.array([2 ** 53 + 1, 2 ** 53 + 3, 2 ** 53 + 5], dtype=np.int64)
URL = "/api/v1/data/cell_groups"


@pytest.fixture
def store(tmp_path):
    zarr_reader.clear_cache()
    cell_subset.clear()
    path = str(tmp_path / "data" / "num.zarr")
    root = open_group(path)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    x = write_array(root, "X", np.zeros((N_OBS, 3), dtype=np.float32))
    x.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    codes = np.arange(N_OBS) % 3
    codes[::7] = 2                                    # uneven: 0 -> a, 1 -> b, 2 -> c
    _frame(root, "obs", [f"c{i}" for i in range(N_OBS)], lambda g: (
        _categorical(g, "f32", codes, F32, strings=False),
        _categorical(g, "big", codes, BIG, strings=False)))
    _frame(root, "var", [f"g{i}" for i in range(3)], lambda g: None)
    config = {"TESTING": True, "data_dir": str(tmp_path / "data"), "log_file": str(tmp_path / "t.log"),
              "auth_enabled": False}
    yield create_app(config).test_client(), path, codes
    zarr_reader.clear_cache()
    cell_subset.clear()


def _labels(client, path, column, n):
    resp = client.get("/api/v1/data/obs", query_string={
        "dataset_path": path, "columns": column, "category_ranks": ",".join(map(str, range(n)))})
    assert resp.status_code == 200
    return resp.get_json()


def _sets_grid(client, path, column, picks):
    """``{(in set 0, in set 1): cells}`` of two sets {column in level id}, as the engine counts them."""
    parts = [{"source": {"type": "obs", "key": column}, "member": {"levels": [i]}} for i in picks]
    resp = client.post(URL, query_string={"dataset_path": path}, data=json.dumps(
        {"shape": "grid", "mode": "sets", "partitionings": parts}), content_type="application/json")
    assert resp.status_code == 200, resp.get_data(as_text=True)
    frames, blocks = parse(resp.get_data())
    axes = frames[-1]["axes"]
    order = [list(a["levels"]) for a in axes]
    counts = blocks["counts"]
    out = {}
    for k, n in enumerate(counts.tolist()):
        out[(order[0][k // len(order[1])] == "@in", order[1][k % len(order[1])] == "@in")] = n
    return out


def _engine_ids(client, path, column):
    """The ids the engine gives the levels of the column, from a grouping's reply."""
    resp = client.post(URL, query_string={"dataset_path": path}, data=json.dumps(
        {"shape": "grouping", "partitionings": [{"source": {"type": "obs", "key": column}}]}),
        content_type="application/json")
    frames, _ = parse(resp.get_data())
    return [lv["id"] if isinstance(lv, dict) else lv for lv in frames[-1]["partitionings"][0]["levels"]]


@pytest.mark.parametrize("column", ["f32", "big"])
def test_the_route_sends_the_ids_the_engine_gives_the_levels(store, column):
    client, path, _ = store
    out = _labels(client, path, column, 3)
    assert len(out["ids"]) == len(out["labels"]) == 3
    assert sorted(out["ids"]) == sorted(_engine_ids(client, path, column))


def test_the_ids_are_the_engines_as_they_always_were(store):
    """A float32 level is its float64 widening (0.8.0 ids, so every stored link keeps its levels); an integer is exact."""
    client, path, _ = store
    assert sorted(_labels(client, path, "f32", 3)["ids"]) == sorted(F32_IDS)
    assert F32_IDS[0] == "c:0.10000000149011612"
    assert sorted(_labels(client, path, "big", 3)["ids"]) == [f"c:{2 ** 53 + k}" for k in (1, 3, 5)]


@pytest.mark.parametrize("column", ["f32", "big"])
def test_two_sets_made_from_the_routes_ids_count_their_own_cells(store, column):
    """Each set holds exactly the cells of its category, found through the id the route sent for it."""
    client, path, codes = store
    # the route's ids in the order of its ranking; the category of each id is read back from the engine's grouping
    ids = _labels(client, path, column, 3)["ids"]
    expect = {i: int((codes == k).sum()) for k, i in enumerate(F32_IDS if column == "f32" else
                                                                  [f"c:{int(v)}" for v in BIG])}
    for a, b in ((0, 1), (1, 2), (0, 2)):
        got = _sets_grid(client, path, column, [ids[a], ids[b]])
        assert got[(True, False)] == expect[ids[a]], (column, a, b, got)
        assert got[(False, True)] == expect[ids[b]], (column, a, b, got)
        assert got[(True, True)] == 0
        assert got[(False, False)] == N_OBS - expect[ids[a]] - expect[ids[b]]
