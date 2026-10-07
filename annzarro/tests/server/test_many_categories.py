"""Categorical columns with up to one category per cell (core/categories.py).

A barcode or sample-cell id stored as a categorical has as many categories as
cells. v0.4.0 put every category into each reply for the column (the JSON
prefix of the codes encoding, or the JSON ``categories`` field): at 95.6M
cells a GB-sized list built in server memory, which the client then refused
(16-bit codes). Now:

- the dataset structure says how many categories a column has (from the
  categories array's shape, without reading it);
- ``categories=ranked`` gives each cell's code as its category's frequency
  rank among the rows, and the labels of the first ranks only: what colouring
  by colour group needs, at any number of categories;
- past READ_ALL_MAX categories a reply carries only the categories its rows
  use, and says the column's count;
- a reply that would still need more than MAX_LABELS labels is refused;
- balancing a subset across more than MAX_BALANCE_GROUPS groups is refused.
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


def _store(tmp_path):
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


def test_ranked_codes_and_the_legend_labels_only(many, monkeypatch):
    """categories=ranked: code r is the r-th most frequent category of the
    rows, the prefix the labels of the first ranks only, and the categories
    read are those few, not the column's 70,000."""
    client, path, labels = many
    sizes = []
    reader = get_reader(path)
    real = reader._read_member
    monkeypatch.setattr(reader, "_read_member",
                        lambda member, indices=None: sizes.append(
                            member.shape[0] if indices is None else len(indices)) or real(member, indices))
    resp = _codes(client, path, "few", categories="ranked", labels="2")
    assert resp.status_code == 200
    h = resp.headers
    assert h["X-Annzarro-Categories-Order"] == "ranked"
    assert h["X-Annzarro-Categories-Used"] == "4" and h["X-Annzarro-Categories-Total"] == "4"
    ranks, top = decode(resp)
    counts = {}
    for v in labels["few"]:
        counts[v] = counts.get(v, 0) + 1
    order = sorted(counts, key=lambda v: (-counts[v], "abcd".index(v)))
    assert top == order[:2]
    assert [order[r] for r in ranks.tolist()] == labels["few"]

    sizes.clear()
    huge = _codes(client, path, "huge", categories="ranked")
    ranks, top = decode(huge)
    present = [v for v in labels["huge"] if v is not None]
    assert huge.headers["X-Annzarro-Categories-Used"] == str(len(set(present)))
    assert huge.headers["X-Annzarro-Categories-Total"] == str(HUGE)
    # one cell per category: ties keep the stored order, so rank = order of code
    by_code = sorted(set(present))
    assert top == by_code[:category_rules.RANKED_LABELS]
    assert [None if r < 0 else by_code[r] for r in ranks.tolist()] == labels["huge"]
    assert max(sizes) <= category_rules.RANKED_LABELS     # the legend's labels, not 70,000


def test_ranked_codes_follow_the_subset(many):
    client, path, labels = many
    spec = json.dumps({"n": 60, "seed": 2})
    names = client.get("/api/v1/data/cells", query_string={"dataset_path": path, "subset": spec}).get_json()["cells"]
    rows = [int(n[1:]) for n in names]
    resp = _codes(client, path, "barcode", categories="ranked", labels="5", subset=spec)
    ranks, top = decode(resp)
    shown = [labels["barcode"][r] for r in rows]
    assert resp.headers["X-Annzarro-Categories-Used"] == "60"
    assert len(top) == 5 and all(t in shown for t in top)
    assert len(set(ranks.tolist())) == 60


def test_ranked_ranks_by_frequency_in_linear_time():
    rng = np.random.default_rng(0)
    codes = rng.integers(-1, 1000, 50_000)
    ranks, top, used = category_rules.ranked(codes, 1000, lambda pos: np.array([f"k{p}" for p in pos]), 3)
    counts = np.bincount(codes[codes >= 0], minlength=1000)
    expected_order = sorted(range(1000), key=lambda k: (-counts[k], k))
    assert used == int((counts > 0).sum())
    assert top == [f"k{k}" for k in expected_order[:3]]
    rank_of = {k: r for r, k in enumerate(expected_order)}
    assert ranks.tolist() == [-1 if c < 0 else rank_of[c] for c in codes.tolist()]


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


def test_balance_across_a_one_per_cell_column_is_refused(tmp_path, monkeypatch):
    zarr_reader.clear_cache()
    cell_subset.clear()
    monkeypatch.setattr(category_rules, "MAX_BALANCE_GROUPS", 100)
    client, path, _ = _store(tmp_path)
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
