"""Categorical columns with up to one category per cell (core/categories.py).

A barcode or sample-cell id stored as a categorical has as many categories as
cells. v0.4.0 put every category into each reply for the column (the JSON
prefix of the codes encoding, or the JSON ``categories`` field): at 95.6M
cells a GB-sized list built in server memory, which the client then refused
(16-bit codes). Now:

- the dataset structure says how many categories a column has (from the
  categories array's shape, without reading it);
- ``categories=ranked`` gives each cell its category's rank in the column's
  ranking over ALL its cells (cached per store and column), the same under
  any subset or part; ``category_ranks=`` gives the labels of a few ranks:
  what colouring by colour group needs, at any number of categories;
- past READ_ALL_MAX categories a reply carries only the categories its rows
  use, and says the column's count;
- no reply is refused for its labels: it is streamed, and a 2M-label reply
  peaks at a bounded size, not every label as Python strings plus JSON;
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


def _labels(client, path, column, ranks, **query):
    return client.get("/api/v1/data/obs", query_string={
        "dataset_path": path, "columns": column, "category_ranks": ",".join(map(str, ranks)), **query})


def test_ranked_codes_are_the_whole_columns_ranks(many, monkeypatch):
    """categories=ranked: code r is the r-th largest category of the whole
    column (ties by stored code), no label is sent, and category_ranks= gives
    a few labels, reading only those categories."""
    client, path, labels = many
    resp = _codes(client, path, "few", categories="ranked")
    assert resp.status_code == 200
    h = resp.headers
    assert h["X-Annzarro-Categories-Order"] == "ranked"
    assert h["X-Annzarro-Categories-Used"] == "4" and h["X-Annzarro-Categories-Total"] == "4"
    ranks, prefix = decode(resp)
    assert prefix == []
    counts = {}
    for v in labels["few"]:
        counts[v] = counts.get(v, 0) + 1
    order = sorted(counts, key=lambda v: (-counts[v], "abcd".index(v)))
    assert [order[r] for r in ranks.tolist()] == labels["few"]
    named = _labels(client, path, "few", [1, 0, 7]).get_json()
    assert named["labels"] == [order[1], order[0], None]

    sizes = []
    reader = get_reader(path)
    real = reader._read_member
    monkeypatch.setattr(reader, "_read_member",
                        lambda member, indices=None: sizes.append(
                            member.shape[0] if indices is None else len(indices)) or real(member, indices))
    huge = _codes(client, path, "huge", categories="ranked")
    ranks, _ = decode(huge)
    present = sorted({v for v in labels["huge"] if v is not None})   # one cell each: ties by code
    assert huge.headers["X-Annzarro-Categories-Used"] == str(len(present))
    assert huge.headers["X-Annzarro-Categories-Total"] == str(HUGE)
    assert [None if r < 0 else present[r] for r in ranks.tolist()] == labels["huge"]
    assert _labels(client, path, "huge", [0, 2]).get_json()["labels"] == [present[0], present[2]]
    assert max(sizes) <= 2                                # two labels read, not 70,000


def test_a_category_has_the_same_rank_in_every_subset_and_part(many):
    """The rank is the column's: under a subset, in each of its parts, and
    without one, the same cell gets the same rank (and so the same colour)."""
    client, path, labels = many
    full, _ = decode(_codes(client, path, "few", categories="ranked"))
    for spec in ({"n": 60, "seed": 2}, {"n": 60, "seed": 2, "part": 1}, {"n": 25, "seed": 9}):
        sub = json.dumps(spec)
        names = client.get("/api/v1/data/cells", query_string={"dataset_path": path, "subset": sub}).get_json()["cells"]
        rows = [int(n[1:]) for n in names]
        ranks, _ = decode(_codes(client, path, "few", categories="ranked", subset=sub))
        assert ranks.tolist() == [full[r] for r in rows], spec
        assert _labels(client, path, "few", [0], subset=sub).get_json()["labels"] == \
            _labels(client, path, "few", [0]).get_json()["labels"]


def test_the_column_ranking_is_computed_once(many, monkeypatch):
    client, path, _ = many
    category_rules.clear_rankings()
    calls = []
    real = category_rules.rank_codes
    monkeypatch.setattr(category_rules, "rank_codes", lambda *a: calls.append(1) or real(*a))
    for rows in ("1,2", "3,4", None):
        q = {"rows": rows} if rows else {}
        assert _codes(client, path, "huge", categories="ranked", **q).status_code == 200
    _labels(client, path, "huge", [0])
    assert len(calls) == 1


def test_rank_codes_by_count_then_code():
    rng = np.random.default_rng(0)
    codes = rng.integers(-1, 1000, 50_000)
    ranking = category_rules.rank_codes(codes, 1000)
    counts = np.bincount(codes[codes >= 0], minlength=1000)
    expected = sorted((k for k in range(1000) if counts[k]), key=lambda k: (-counts[k], k))
    assert ranking.used == len(expected)
    assert ranking.codes_of(range(len(expected))) == expected
    assert ranking.rank_of.dtype == np.uint32
    assert ranking.ranks(codes).tolist() == [-1 if c < 0 else expected.index(c) for c in codes.tolist()]
    # one cell per category: the rank is the code; nothing sorted, nothing stored
    one_each = category_rules.rank_codes(np.random.default_rng(1).permutation(100_000), 100_000)
    assert one_each.rank_of is None and one_each.nbytes == 0 and one_each.used == 100_000
    assert one_each.ranks([5, -1, 99_999]).tolist() == [5, -1, 99_999]
    assert one_each.codes_of([0, 7, 100_000]) == [0, 7, None]
    # equal counts with categories unused: code order among those used, no sort
    some = category_rules.rank_codes(np.array([4, 1, 4, 1, 9, 9]), 12)
    assert some.ranks([1, 4, 9]).tolist() == [0, 1, 2] and some.used == 3
    assert some.codes_of([2, 0, 3]) == [9, 1, None]


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


def test_no_reply_is_refused_for_its_labels(many):
    """The 2M-label cap (413) is gone: the browser's memory guard decides."""
    client, path, labels = many
    assert not hasattr(category_rules, "MAX_LABELS")
    resp = _codes(client, path, "huge")
    assert resp.status_code == 200
    codes, categories = decode(resp)
    assert values_of(codes, categories) == labels["huge"]


@pytest.mark.parametrize("n, length", [(0, 0), (1, 1), (65_537, 3), (200_001, 9)])
def test_a_streamed_reply_decodes_as_one(n, length):
    """Chunk edges and the length pass: the stream is the same bytes as the
    one-piece encoding it replaced."""
    from annzarro.core.array_response import categorical_response
    cats = np.array([f"L{i:0{length}d}é" for i in range(n)], dtype=object)
    codes = np.arange(n, dtype=np.int64)[::-1].copy()
    if n:
        codes[0] = -1
    resp = categorical_response(codes, cats, total=n + 5)
    body = b"".join(resp.response)
    assert len(body) == int(resp.headers["Content-Length"])
    lead = int(resp.headers["X-Annzarro-Categories-Bytes"])
    assert lead % 4 == 0
    assert json.loads(body[:lead].decode("utf-8")) == cats.tolist()
    assert body[:lead].rstrip(b" ") == json.dumps(cats.tolist(), ensure_ascii=False, separators=(",", ":")).encode()
    got = np.frombuffer(body[lead:], dtype=np.dtype(resp.headers["X-Annzarro-Dtype"]).newbyteorder("<"))
    assert got.tolist() == ([-1] + codes[1:].tolist() if n else [])


def test_a_2m_label_reply_is_built_in_bounded_memory():
    """Python allocations while building and sending 2M barcode labels (the
    labels and codes themselves are the input, read before): a few MB per
    piece, not 2M str objects (~120 MB) plus their JSON (~38 MB)."""
    import tracemalloc
    from annzarro.core.array_response import categorical_response
    n = 2_000_000
    cats = np.char.add(np.char.add("ACGTACGTACGT", np.arange(n).astype("U7")), "-1")
    codes = np.arange(n, dtype=np.int32)
    tracemalloc.start()
    try:
        tracemalloc.reset_peak()
        base = tracemalloc.get_traced_memory()[0]
        resp = categorical_response(codes, cats, total=n)
        sent = 0
        for piece in resp.response:
            sent += len(piece)
        peak = tracemalloc.get_traced_memory()[1] - base
    finally:
        tracemalloc.stop()
    assert sent == int(resp.headers["Content-Length"]) > 40_000_000
    # the codes on the wire (int32, 8 MB) and their checks, the encoded pieces
    # the length pass keeps (KEEP_ENCODED_BYTES), and one piece of
    # LABEL_CHUNK labels in flight: nothing that grows with the labels
    from annzarro.core import array_response
    bound = codes.nbytes + 2 * n + array_response.KEEP_ENCODED_BYTES + (12 << 20)
    assert peak < bound, f"peak {peak / 2**20:.1f} MiB, bound {bound / 2**20:.1f} MiB"


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
