"""Categorical columns with up to one category per cell (core/categories.py).

A barcode or sample-cell id stored as a categorical has as many categories as
cells. v0.4.0 put every category into each reply for the column (the JSON
prefix of the codes encoding, or the JSON ``categories`` field): at 95.6M
cells a GB-sized list built in server memory, which the client then refused
(16-bit codes). Now:

- the dataset structure says how many categories a column has (from the
  categories array's shape, without reading it);
- ``categories=all`` (a client colouring by the column) is refused past the
  colour limit with 413 ``too_many_categories``, before anything is read;
- past READ_ALL_MAX categories a reply carries only the categories its rows
  use, and says the column's count;
- a reply that would still need more than MAX_LABELS labels is refused;
- balancing a subset across such a column is refused.
"""
import json

import numpy as np
import pytest

from annzarro.core import categories as category_rules
from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.tests.server.test_categorical_codes import _categorical, _frame, decode, values_of
from annzarro.tests.zarr_compat import open_group, write_array, write_strings
from annzarro.core import get_reader

N_OBS = 400
#: categories in the "huge" column: past READ_ALL_MAX (65,536), so the reader's
#: own threshold applies without patching it
HUGE = 70_000


def _store(tmp_path, colour_limit=None):
    rng = np.random.default_rng(3)
    path = str(tmp_path / "data" / "many.zarr")
    root = open_group(path)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    x = write_array(root, "X", np.zeros((N_OBS, 3), dtype=np.float32))
    x.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    few = rng.integers(0, 4, N_OBS)
    barcode = rng.permutation(N_OBS)                  # one category per cell
    huge = rng.choice(HUGE, N_OBS, replace=False)     # 70,000 categories, 400 used
    huge[::50] = -1                                    # and missing values

    def obs(g):
        _categorical(g, "few", few, ["a", "b", "c", "d"])
        cats = [f"BC{i:06d}-1" for i in range(N_OBS)]
        _categorical(g, "barcode", barcode, cats)
        hg = g.create_group("huge")
        hg.attrs.update({"encoding-type": "categorical", "encoding-version": "0.2.0", "ordered": False})
        write_array(hg, "codes", huge.astype(np.int32))
        write_strings(hg, "categories", [f"cell-{i:07d}" for i in range(HUGE)], chunks=(5000,))

    _frame(root, "obs", [f"c{i}" for i in range(N_OBS)], obs)
    _frame(root, "var", [f"g{i}" for i in range(3)], lambda g: None)
    config = {"TESTING": True, "data_dir": str(tmp_path / "data"),
              "log_file": str(tmp_path / "t.log"), "auth_enabled": False}
    if colour_limit is not None:
        config["ui_category_colour_limit"] = colour_limit
    client = create_app(config).test_client()
    labels = {"few": [["a", "b", "c", "d"][c] for c in few],
              "barcode": [f"BC{c:06d}-1" for c in barcode],
              "huge": [None if c < 0 else f"cell-{c:07d}" for c in huge]}
    return client, path, labels


@pytest.fixture
def many(tmp_path):
    zarr_reader.clear_cache()
    cell_subset.clear()
    yield _store(tmp_path)
    zarr_reader.clear_cache()
    cell_subset.clear()


def _codes(client, path, column, **query):
    return client.get("/api/v1/data/obs", query_string={
        "dataset_path": path, "columns": column, "format": "f32", "categorical": "codes", **query})


def test_structure_says_how_many_categories(many):
    client, path, _ = many
    info = client.get("/api/v1/data/dataset_structure",
                      query_string={"dataset_path": path}).get_json()["obs"]["columns_info"]
    assert info["few"]["n_categories"] == 4
    assert info["barcode"]["n_categories"] == N_OBS
    assert info["huge"]["n_categories"] == HUGE


def test_colouring_past_the_limit_is_refused_before_reading(many, monkeypatch):
    """categories=all (the client colouring by the column) past the colour
    limit: 413 with the count and the limit, and not one read of the
    column's codes or categories."""
    client, path, _ = many
    client.get("/api/v1/data/dataset_structure", query_string={"dataset_path": path})
    reads = []
    reader = get_reader(path)
    real = reader._read_member
    monkeypatch.setattr(reader, "_read_member", lambda *a, **k: reads.append(a) or real(*a, **k))
    resp = _codes(client, path, "huge", categories="all")
    assert resp.status_code == 413, resp.get_data(as_text=True)[:300]
    body = resp.get_json()
    assert body["reason"] == "too_many_categories"
    assert body["count"] == HUGE and body["limit"] == category_rules.DEFAULT_COLOUR_LIMIT
    assert "too many to colour by" in body["error"]
    assert body["detail"] == "70,000 distinct values (the limit is 10,000): show it in the hover or in a table instead"
    assert reads == []
    # below the limit the same request is served with every category
    few = _codes(client, path, "few", categories="all")
    assert few.status_code == 200 and decode(few)[1] == ["a", "b", "c", "d"]


def test_the_colour_limit_is_configurable(tmp_path):
    zarr_reader.clear_cache()
    client, path, _ = _store(tmp_path, colour_limit=3)
    resp = _codes(client, path, "few", categories="all")
    assert resp.status_code == 413 and resp.get_json()["limit"] == 3
    zarr_reader.clear_cache()


def test_a_reply_carries_only_the_categories_its_rows_use(many, monkeypatch):
    """Past READ_ALL_MAX categories the categories read and sent are those of
    the requested rows, renumbered; the reply says the column's count. v0.4.0
    read and sent all 70,000 for 400 rows."""
    client, path, labels = many
    sizes = []
    reader = get_reader(path)
    real = reader._read_member
    monkeypatch.setattr(reader, "_read_member",
                        lambda member, indices=None: sizes.append(
                            member.shape[0] if indices is None else len(indices)) or real(member, indices))
    resp = _codes(client, path, "huge")
    assert resp.status_code == 200
    assert resp.headers["X-Annzarro-Categories-Total"] == str(HUGE)
    codes, categories = decode(resp)
    assert values_of(codes, categories) == labels["huge"]
    assert len(categories) == len({v for v in labels["huge"] if v is not None}) < N_OBS
    assert len(resp.get_data()) < 20 * N_OBS          # not 70,000 labels
    assert max(sizes) < N_OBS                         # never read every category


def test_used_categories_for_a_few_rows(many):
    client, path, labels = many
    resp = _codes(client, path, "barcode", rows="7,3,7", categories="used")
    codes, categories = decode(resp)
    assert values_of(codes, categories) == [labels["barcode"][7], labels["barcode"][3], labels["barcode"][7]]
    assert len(categories) == 2
    assert resp.headers["X-Annzarro-Categories-Total"] == str(N_OBS)


def test_json_labels_of_a_one_per_cell_column_in_a_subset(many):
    """Hover and table read a column's labels for the cells shown: under a
    subset, JSON or codes, labels match the full column at the subset's rows."""
    client, path, labels = many
    spec = json.dumps({"n": 50, "seed": 1})
    names = client.get("/api/v1/data/cells", query_string={"dataset_path": path, "subset": spec}).get_json()["cells"]
    rows = [int(n[1:]) for n in names]
    js = client.get("/api/v1/data/obs", query_string={"dataset_path": path, "columns": "huge,barcode", "subset": spec})
    body = js.get_json()
    assert body["data"]["huge"] == [labels["huge"][r] for r in rows]
    assert body["data"]["barcode"] == [labels["barcode"][r] for r in rows]
    assert body["n_categories"] == {"huge": HUGE}
    assert len(body["categories"]["huge"]) <= 50
    codes, categories = decode(_codes(client, path, "barcode", subset=spec, categories="used"))
    assert values_of(codes, categories) == [labels["barcode"][r] for r in rows]


def test_a_reply_needing_too_many_labels_is_refused(many, monkeypatch):
    client, path, _ = many
    monkeypatch.setattr(category_rules, "MAX_LABELS", 100)
    resp = _codes(client, path, "huge")
    assert resp.status_code == 413
    assert resp.get_json()["reason"] == "too_many_categories"
    assert "use a cell subset" in resp.get_json()["detail"]
    assert _codes(client, path, "huge", rows="1,2,3").status_code == 200
    assert _codes(client, path, "few").status_code == 200


def test_balance_across_a_one_per_cell_column_is_refused(tmp_path):
    zarr_reader.clear_cache()
    cell_subset.clear()
    client, path, _ = _store(tmp_path, colour_limit=100)
    resp = client.get("/api/v1/data/subset", query_string={
        "dataset_path": path, "subset": json.dumps({"n": 50, "seed": 0, "balance": "barcode"})})
    assert resp.status_code == 400
    assert resp.get_json()["reason"] == "too_many_categories"
    ok = client.get("/api/v1/data/subset", query_string={
        "dataset_path": path, "subset": json.dumps({"n": 50, "seed": 0, "balance": "few"})})
    assert ok.status_code == 200
    zarr_reader.clear_cache()
    cell_subset.clear()


def test_h5ad_counts_and_reads_only_used_categories(tmp_path, monkeypatch):
    import h5py
    from annzarro.core import h5ad_reader as h5mod
    path = str(tmp_path / "many.h5ad")
    codes = np.array([5, 9, -1, 5, 2], dtype=np.int32)
    with h5py.File(path, "w") as f:
        obs = f.create_group("obs")
        obs.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0",
                          "_index": "_index", "column-order": ["bc"]})
        obs.create_dataset("_index", data=np.array([f"c{i}" for i in range(5)], dtype=object),
                           dtype=h5py.string_dtype())
        g = obs.create_group("bc")
        g.attrs.update({"encoding-type": "categorical", "encoding-version": "0.2.0", "ordered": False})
        g.create_dataset("codes", data=codes)
        g.create_dataset("categories", data=np.array([f"k{i}" for i in range(12)], dtype=object),
                         dtype=h5py.string_dtype())
    reader = h5mod.h5adReader()
    info = reader.get_metadata(path)["obs_columns_info"]["bc"]
    assert info == {"type": "categorical", "n_categories": 12}
    out, cats = reader.get_obs_var_codes("cells", path, "bc", used_only=True)
    assert cats == ["k2", "k5", "k9"] and out.tolist() == [1, 2, -1, 1, 0]
    monkeypatch.setattr(category_rules, "READ_ALL_MAX", 4)
    values = reader.get_obs_var("cells", path, column_names=["bc"])
    assert values["data"]["bc"] == ["k5", "k9", None, "k5", "k2"]
    assert values["n_categories"] == {"bc": 12} and values["categories"]["bc"] == ["k2", "k5", "k9"]


def test_colour_limit_reads_the_config():
    assert category_rules.colour_limit(None) == category_rules.DEFAULT_COLOUR_LIMIT
    assert category_rules.colour_limit({"ui_category_colour_limit": 250}) == 250
    assert category_rules.colour_limit({"ui_category_colour_limit": None}) == category_rules.DEFAULT_COLOUR_LIMIT
