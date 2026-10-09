"""The name index's memory budget, through /data/names.

On the hosted 1B-cell demo the server grew from 5.8 to 33 GB over 400 s and
peaked at 51.5 GB: a dataset-wide name index of 1B names (24 GB of names and
8 GB of offsets) was built inside a request, and kept. Clicking into the
Focused Cell box asked for it. Now

  - listing the first names builds no index;
  - a dataset whose index would pass ``server.name_index_max_mb`` gets none:
    searches scan the names, with the answers of the index (and ``partial``
    when the scan stopped early), and /data/names/status says ``streaming``;
  - below the budget everything is as before.
"""
import os
import shutil

import pytest

from annzarro.core import name_index
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
    name_index.configure(None, None)


def _get(client, store, **q):
    return client.get("/api/v1/data/names", query_string={"dataset_path": store, "entity": "cells", **q})


def test_listing_the_first_names_builds_no_index(make_client):
    client, store = make_client()
    reply = _get(client, store, q="", limit=5)
    assert reply.status_code == 200
    body = reply.get_json()
    assert [m["index"] for m in body["matches"]] == [0, 1, 2, 3, 4]
    assert body["truncated"] is True and body["total"] > 5
    assert name_index.index_state(store, "cells") == "absent"
    assert name_index.cached_bytes() == 0
    # the same names an index lists
    full = _get(client, store, q="a", limit=500)               # builds the index
    assert name_index.index_state(store, "cells") == "ready"
    assert _get(client, store, q="", limit=5).get_json() == body


def test_a_dataset_over_the_budget_is_searched_without_an_index(make_client):
    client, store = make_client()
    queries = [{"q": "cell_0", "limit": 7}, {"q": "cell_0", "limit": 500}, {"q": "1", "limit": 20},
               {"q": "nothing like this"}, {"q": "(cell_1|cell_2)", "mode": "regex", "limit": 30}]
    want = [_get(client, store, **q).get_json() for q in queries]
    exact_name = want[0]["matches"][2]["name"]
    want_exact = _get(client, store, q=exact_name, mode="exact").get_json()
    assert name_index.index_state(store, "cells") == "ready"

    client, store = make_client(name_index_max_mb=0.0002)      # 200 bytes: no index fits
    assert name_index.index_state(store, "cells") == "absent"
    status = client.get("/api/v1/data/names/status", query_string={"dataset_path": store, "entity": "cells"})
    assert status.get_json() == {"state": "streaming"}
    for q, expected in zip(queries, want):
        got = _get(client, store, **q).get_json()
        assert got["matches"] == expected["matches"], q
        assert got["truncated"] == expected["truncated"], q
        assert got["total"] == expected["total"], q
        assert got["partial"] is False and got["scanned"] == got["total"], q
    got = _get(client, store, q=exact_name, mode="exact").get_json()
    assert got["matches"] == want_exact["matches"] and got["partial"] is False
    assert name_index.cached_bytes() == 0 and name_index.index_state(store, "cells") == "streaming"


def test_the_scan_cap_counts_whole_chunks(make_client):
    # the fixture's names are one chunk: the cap (checked between chunks)
    # cannot cut it short; the partial answer is tested on many chunks in
    # tests/core/test_name_index_budget.py
    client, store = make_client(name_index_max_mb=0.0002, name_search_scan_names=1)
    body = _get(client, store, q="nothing like this").get_json()
    assert body["matches"] == [] and body["partial"] is False and body["scanned"] == body["total"]


def test_the_dataset_wide_search_under_a_subset_streams_too(make_client):
    client, store = make_client(name_index_max_mb=0.0002)
    body = _get(client, store, q="cell_0", subset=SUBSET, scope="dataset", limit=10)
    assert body.status_code == 200, body.get_json()
    got = body.get_json()
    assert got["matches"] and all(m["row"] >= 0 for m in got["matches"])
    assert name_index.cached_bytes() == 0
    # the subset's own names (a few) are still indexed in memory
    shown = _get(client, store, q="cell_0", subset=SUBSET, limit=10)
    assert shown.status_code == 200 and "partial" not in shown.get_json()


def test_below_the_budget_nothing_changes(make_client):
    client, store = make_client(name_index_max_mb=64)
    body = _get(client, store, q="cell_0", limit=3).get_json()
    assert "partial" not in body and len(body["matches"]) == 3
    assert name_index.index_state(store, "cells") == "ready"
    assert 0 < name_index.cached_bytes() <= 64 * 2 ** 20
