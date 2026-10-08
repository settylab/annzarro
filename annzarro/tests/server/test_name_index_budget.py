"""The name indices behind the focus pickers' search have a memory budget.

On the hosted 1B-cell demo the server grew from 5.8 to 33 GB over 400 s and
peaked at 51.5 GB: a dataset-wide name index of 1B names (about 24 GB of
names and 8 GB of offsets, plus temporaries) was built inside a request, and
kept. Clicking into the Focused Cell box asked for it (the box lists the first
names, and the app also searched every cell of the dataset). Now

  - listing the first names builds no index;
  - an index that would pass ``server.name_index_max_mb`` is refused (413,
    ``name_index_too_large``) before a name is read, and /data/subset says the
    dataset cannot be searched by name;
  - the cached indices are bounded by bytes, least recently used first;
  - an index is built without n-long temporaries.
"""
import os
import shutil

import pytest

from annzarro.core import name_index
from annzarro.core.name_index import NameChunks, NameIndex, NameIndexTooLarge
from annzarro.server.core import create_app

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr"
)
SUBSET = '{"n":60,"seed":0}'


@pytest.fixture
def make_client(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    store = data_dir / "a.zarr"
    shutil.copytree(FIXTURE, store)

    def make(**config):
        name_index.clear()
        app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False,
                          "data_dir": str(data_dir), **config})
        return app.test_client(), str(store)

    yield make
    name_index.clear()


def _names(resp):
    assert resp.status_code == 200, resp.get_json()
    return [m["name"] for m in resp.get_json()["matches"]]


# -- the first names ------------------------------------------------------------

def test_listing_the_first_names_builds_no_index(make_client):
    client, store = make_client()
    reply = client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "entity": "cells", "q": "", "limit": 5})
    assert reply.status_code == 200
    body = reply.get_json()
    assert name_index.index_state(store, "cells") == "absent", "an index was built to list the first names"
    everything = client.get("/api/v1/data/cells", query_string={"dataset_path": store}).get_json()["cells"]
    assert [m["name"] for m in body["matches"]] == everything[:5]
    assert [m["index"] for m in body["matches"]] == [0, 1, 2, 3, 4]
    assert body["truncated"] is True and body["total"] == len(everything)


def test_the_first_names_of_a_subset_and_of_the_dataset_beside_it(make_client):
    client, store = make_client()
    shown = client.get("/api/v1/data/cells", query_string={"dataset_path": store, "subset": SUBSET}).get_json()["cells"]
    sub = client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "entity": "cells", "q": "", "limit": 4, "subset": SUBSET}).get_json()
    assert [m["name"] for m in sub["matches"]] == shown[:4]
    assert [m["index"] for m in sub["matches"]] == [0, 1, 2, 3]
    rows = [m["row"] for m in sub["matches"]]
    assert rows == sorted(rows) and len(set(rows)) == 4          # dataset rows of the subset's first cells
    whole = client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "entity": "cells", "q": "", "limit": 4, "subset": SUBSET, "scope": "dataset"}).get_json()
    assert [m["row"] for m in whole["matches"]] == [0, 1, 2, 3]
    assert name_index.index_state(store, "cells") == "absent"
    assert name_index.cached_bytes() == 0
    genes = client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "entity": "genes", "q": "", "limit": 3}).get_json()
    allg = client.get("/api/v1/data/genes", query_string={"dataset_path": store}).get_json()["genes"]
    assert [m["name"] for m in genes["matches"]] == allg[:3]


def test_a_search_with_text_still_builds_and_finds(make_client):
    client, store = make_client()
    name = client.get("/api/v1/data/cells", query_string={"dataset_path": store}).get_json()["cells"][7]
    assert _names(client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "entity": "cells", "q": name, "mode": "exact"})) == [name]
    assert name_index.index_state(store, "cells") == "ready"
    assert name_index.cached_bytes() > 0


# -- the budget -----------------------------------------------------------------

def test_a_dataset_wide_search_that_would_not_fit_is_refused_before_names_are_read(make_client):
    # 200 cells x 32 bytes does not fit 3,000 bytes; the 60 cells of the subset do
    client, store = make_client(name_index_max_mb=3000 / 2 ** 20)
    reply = client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "entity": "cells", "q": "cell", "limit": 5, "subset": SUBSET, "scope": "dataset"})
    assert reply.status_code == 413
    body = reply.get_json()
    assert body["reason"] == "name_index_too_large" and body["names"] == 200
    assert name_index.index_state(store, "cells") == "absent"
    shown = client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "entity": "cells", "q": "cell", "limit": 5, "subset": SUBSET})
    assert shown.status_code == 200, "the cells of the subset can still be searched"
    status = client.get("/api/v1/data/names/status", query_string={
        "dataset_path": store, "entity": "cells", "subset": SUBSET, "scope": "dataset"}).get_json()
    assert status["state"] == "unavailable"


def test_the_subset_reply_says_whether_every_cell_can_be_searched(make_client):
    client, store = make_client()
    ok = client.get("/api/v1/data/subset", query_string={"dataset_path": store, "subset": SUBSET}).get_json()
    assert ok["name_search"] == {"dataset": True}
    client, store = make_client(name_index_max_mb=3000 / 2 ** 20)
    small = client.get("/api/v1/data/subset", query_string={"dataset_path": store, "subset": SUBSET}).get_json()
    assert small["name_search"] == {"dataset": False}


def test_estimate_refuses_before_loading_anything():
    def load():
        raise AssertionError("the names were read for an index that cannot fit")

    with pytest.raises(NameIndexTooLarge) as caught:
        name_index.get_index("/nowhere-1B.zarr", "cells", load, n_names=1_000_000_000, max_mb=6144)
    assert caught.value.names == 1_000_000_000
    assert "32" in str(caught.value) or "GB" in str(caught.value)
    # 95.6M names (the biggest store measured: 4.15 GB kept) fit the default
    assert 95_600_000 * name_index.ESTIMATE_BYTES_PER_NAME < name_index.DEFAULT_MAX_MB * 2 ** 20


def test_the_cache_is_bounded_by_bytes_least_recently_used_first(tmp_path):
    name_index.clear()
    names = [f"cell_{i:06d}" for i in range(5000)]
    one = NameIndex(names).nbytes
    limit_mb = (2.5 * one) / 2 ** 20                    # room for two indices, not three
    try:
        for key in ("a", "b"):
            name_index.get_index(str(tmp_path / key), "cells", lambda: names, max_mb=limit_mb)
        name_index.get_index(str(tmp_path / "a"), "cells", lambda: names, max_mb=limit_mb)    # a is the newer now
        name_index.get_index(str(tmp_path / "c"), "cells", lambda: names, max_mb=limit_mb)
        assert name_index.cached_bytes() <= 2.5 * one
        assert name_index.index_state(str(tmp_path / "b"), "cells") == "absent", "the least recently used stayed"
        assert name_index.index_state(str(tmp_path / "a"), "cells") == "ready"
        assert name_index.index_state(str(tmp_path / "c"), "cells") == "ready"
    finally:
        name_index.clear()


def test_an_index_larger_than_the_budget_is_returned_but_not_kept(tmp_path):
    name_index.clear()
    names = [f"cell_{i:06d}" for i in range(5000)]
    try:
        index = name_index.get_index(str(tmp_path / "big"), "cells", lambda: names, max_mb=0.01)
        assert len(index) == 5000 and index.search("cell_000042", 1)["matches"][0]["index"] == 42
        assert name_index.index_state(str(tmp_path / "big"), "cells") == "absent"
    finally:
        name_index.clear()


# -- building without temporaries -------------------------------------------------

def test_offsets_are_right_across_many_chunks():
    names = [f"Cell_{i}" if i % 7 else f"cell-{i}x" for i in range(10)]
    chunks = [names[0:3], names[3:3], names[3:4], names[4:10]]
    index = NameIndex(NameChunks(iter(chunks)))
    plain = NameIndex(names)
    assert len(index) == len(plain) == 10
    assert index._starts.tolist() == plain._starts.tolist()
    for i, name in enumerate(names):
        assert index.name(i) == name
        assert index.search(name, 1, mode="exact")["matches"] == [{"name": name, "index": i}]


def test_building_keeps_no_n_long_temporary(monkeypatch):
    """The 1B-cell build joined every length and offset (4 + 8 + 8 + 8 bytes a name
    on top of the index). The offsets are now made a chunk at a time."""
    import numpy as np
    seen = []
    real = np.cumsum

    def spy(a, *args, **kwargs):
        out = real(a, *args, **kwargs)
        seen.append(len(out))
        return out

    monkeypatch.setattr(np, "cumsum", spy)
    chunk = 1 << 12
    monkeypatch.setattr(NameIndex, "_CHUNK", chunk)
    NameIndex([f"n{i}" for i in range(chunk * 5 + 17)])
    assert seen and max(seen) <= chunk, f"an array of {max(seen)} was made at once"
