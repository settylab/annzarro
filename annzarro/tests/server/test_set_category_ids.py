"""Level ids of a numeric categorical column in the Count plot's sets (0.8.1 S2).

A "Levels of a column" set picks categories of an obs column. The browser used to build each category's id from the
label the obs route sent as a JSON number: a float32 category 0.1 arrives as 0.10000000149011612 (a float64), an
integer above 2**53 as a number JavaScript cannot hold exactly, so the id it wrote (`c:0.10000000149011612`,
`c:9007199254740992`) matched no level of the engine (`c:0.1`, `c:9007199254740993`) or the wrong one. The route now
sends each category's id beside its label (``ids``), made by the engine's own ``canonical_label`` from the stored
value, and the browser uses it as it is.
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


@pytest.mark.parametrize("column, values", [("f32", F32), ("big", BIG)])
def test_the_route_sends_each_categorys_id_as_the_engine_writes_it(store, column, values):
    client, path, codes = store
    out = _labels(client, path, column, 3)
    assert out["ids"] == [cg.canonical_label(v) for v in values[np.argsort(
        -np.bincount(codes, minlength=3), kind="stable")]]
    assert len(out["ids"]) == len(out["labels"])


def test_the_ids_are_the_shortest_float32_digits_and_the_exact_integers(store):
    client, path, _ = store
    assert sorted(_labels(client, path, "f32", 3)["ids"]) == ["c:0.1", "c:0.2", "c:0.3"]
    assert sorted(_labels(client, path, "big", 3)["ids"]) == [f"c:{2 ** 53 + k}" for k in (1, 3, 5)]


@pytest.mark.parametrize("column, values", [("f32", F32), ("big", BIG)])
def test_two_sets_made_from_the_routes_ids_count_their_own_cells(store, column, values):
    """The ids the route sends are levels of the engine: each set holds exactly the cells of its category."""
    client, path, codes = store
    ids = _labels(client, path, column, 3)["ids"]
    for a, b in ((0, 1), (1, 2), (0, 2)):
        got = _sets_grid(client, path, column, [cg.canonical_label(values[a]), cg.canonical_label(values[b])])
        assert cg.canonical_label(values[a]) in ids and cg.canonical_label(values[b]) in ids
        assert got[(True, False)] == int((codes == a).sum()), (column, a, b, got)
        assert got[(False, True)] == int((codes == b).sum()), (column, a, b, got)
        assert got[(True, True)] == 0
        assert got[(False, False)] == int(((codes != a) & (codes != b)).sum())


def test_a_link_stored_before_the_fix_still_finds_its_float32_level(store):
    """Before 0.8.1 the browser wrote ``c:0.10000000149011612`` for a float32 0.1; that id still names the level."""
    client, path, codes = store
    old = [f"c:{float(np.float32(v))!r}" for v in F32]
    assert old[0] == "c:0.10000000149011612"
    got = _sets_grid(client, path, "f32", [old[0], old[1]])
    assert got[(True, False)] == int((codes == 0).sum())
    assert got[(False, True)] == int((codes == 1).sum())
    assert got[(True, True)] == 0


OLD_IDS = ["c:0.10000000149011612", "c:0.20000000298023224", "c:0.30000001192092896"]


def _post(client, path, body):
    resp = client.post(URL, query_string={"dataset_path": path}, data=json.dumps(body), content_type="application/json")
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return parse(resp.get_data())


def test_a_grouping_names_the_ids_it_now_has_and_the_ones_an_old_link_stored(store):
    """The reply lists ``legacy_ids`` (old id to id); kept levels stored by the old ids are echoed as stored, counted right."""
    client, path, codes = store
    frames, _ = _post(client, path, {"shape": "grouping", "partitionings": [{"source": {"type": "obs", "key": "f32"}}]})
    info = frames[-1]["partitionings"][0]
    assert sorted(info["levels"], key=lambda lv: lv["id"] if isinstance(lv, dict) else lv)
    ids = [lv["id"] if isinstance(lv, dict) else lv for lv in info["levels"]]
    assert sorted(ids) == ["c:0.1", "c:0.2", "c:0.3"]
    assert info["legacy_ids"] == dict(zip(OLD_IDS, ["c:0.1", "c:0.2", "c:0.3"]))
    # a link with two kept levels (the third is hidden in @other), stored by the old ids
    frames, _ = _post(client, path, {"shape": "grouping", "partitionings": [
        {"source": {"type": "obs", "key": "f32"}, "levels": [OLD_IDS[0], OLD_IDS[2]]}]})
    groups = {tuple(g["key"]): g["n"] for g in frames[-1]["groups"]}
    assert groups == {(OLD_IDS[0],): int((codes == 0).sum()), (OLD_IDS[2],): int((codes == 2).sum()),
                      ("@other",): int((codes == 1).sum())}
    assert not frames[-1]["partitionings"][0].get("absent")


def test_a_group_of_a_grouping_stored_by_the_old_ids_is_still_that_group(store):
    client, path, codes = store
    inner = {"type": "cell-group", "recipe": {"partitionings": [{"source": {"type": "obs", "key": "f32"}}]}}
    parts = [{"source": inner, "member": {"group": [OLD_IDS[1]]}},
             {"source": {"type": "obs", "key": "f32"}, "member": {"levels": ["c:0.1"]}}]
    frames, blocks = _post(client, path, {"shape": "grid", "mode": "sets", "partitionings": parts})
    axis = frames[-1]["axes"][0]
    assert not axis.get("absent"), axis
    counts = blocks["counts"].tolist()
    assert counts[0] + counts[1] == int((codes == 1).sum())          # the cells in set A: both rows of the first axis
