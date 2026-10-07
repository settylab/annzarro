"""
/api/v1/data/names: the typeahead behind the header's Focused Cell / Gene
pickers. The pickers used to download every name and build a <select> from
it (15 MB and ~15 s of a frozen tab at a million cells); they now ask for the
few names matching what was typed. These tests pin the matching rules, the
limit, and that the index is built once per dataset, not once per keystroke.
"""
import os
import shutil
from unittest.mock import patch

import pytest

from annzarro.core import name_index
from annzarro.core.name_index import NameIndex
from annzarro.server.core import create_app

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr"
)


@pytest.fixture
def client_and_store(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    store = data_dir / "a.zarr"
    shutil.copytree(FIXTURE, store)
    name_index.clear()
    app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False,
                      "data_dir": str(data_dir)})
    yield app.test_client(), str(store)
    name_index.clear()


def _names(resp):
    assert resp.status_code == 200, resp.get_json()
    return [m["name"] for m in resp.get_json()["matches"]]


def test_exact_then_prefix_then_substring():
    ix = NameIndex(["xabc", "abcd", "Abc", "zzabcabc", "foo"])
    got = [m["name"] for m in ix.search("abc", 10)["matches"]]
    # exact (case-insensitive) first, then names starting with it, then
    # names containing it, each group in dataset order; one row once.
    assert got == ["Abc", "abcd", "xabc", "zzabcabc"]


def test_case_sensitive_exact_wins():
    ix = NameIndex(["ABC", "abc"])
    assert ix.search("abc", 1, mode="exact")["matches"] == [{"name": "abc", "index": 1}]
    assert ix.search("ABC", 1, mode="exact")["matches"] == [{"name": "ABC", "index": 0}]
    assert ix.search("nope", 1, mode="exact")["matches"] == []


def test_truncated_means_more_exist():
    ix = NameIndex(["a1", "a2", "b"])
    assert ix.search("a", 2)["truncated"] is False   # exactly two match
    assert ix.search("a", 1)["truncated"] is True
    assert ix.search("", 3)["truncated"] is False
    assert ix.search("", 2)["truncated"] is True


def test_indices_survive_unicode_lowering_and_newlines():
    # 'İ'.lower() is two characters long; a name with a newline must not split
    names = ["İstanbul", "line\nbreak", "plain"]
    ix = NameIndex(names)
    assert ix.search("plain", 5)["matches"] == [{"name": "plain", "index": 2}]
    assert ix.search("break", 5)["matches"] == [{"name": "line\nbreak", "index": 1}]


def test_regex_mode():
    ix = NameIndex(["cell_1", "cell_22", "gene"])
    assert [m["index"] for m in ix.search(r"_\d{2}$", 5, mode="regex")["matches"]] == [1]


def test_endpoint_searches_cells_and_genes(client_and_store):
    client, store = client_and_store
    cells = _names(client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "entity": "cells", "q": "cell_001", "limit": 5}))
    assert cells == ["cell_0010", "cell_0011", "cell_0012", "cell_0013", "cell_0014"]
    genes = client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "entity": "genes", "q": "gene007"}).get_json()
    assert genes["matches"] == [{"name": "GENE007", "index": 7, "row": 7}]
    assert genes["total"] == 20 and genes["truncated"] is False


def test_endpoint_limit_is_capped(client_and_store):
    client, store = client_and_store
    body = client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "entity": "cells", "q": "", "limit": 100000}).get_json()
    assert len(body["matches"]) == min(200, name_index.MAX_LIMIT)
    assert body["total"] == 200


def test_endpoint_reads_names_once_per_dataset(client_and_store):
    client, store = client_and_store
    from annzarro.core import zarr_reader
    real = zarr_reader.get_cell_gene_names
    real_chunks = zarr_reader.iter_cell_gene_name_chunks
    with patch.object(zarr_reader, "get_cell_gene_names", side_effect=real) as read, \
            patch.object(zarr_reader, "iter_cell_gene_name_chunks", side_effect=real_chunks) as chunks:
        for q in ("c", "ce", "cel", "cell_0"):
            client.get("/api/v1/data/names", query_string={
                "dataset_path": store, "entity": "cells", "q": q})
        # a zarr store's names are read a chunk at a time, never as one list
        assert chunks.call_count == 1, "the names were re-read per keystroke"
        assert read.call_count == 0, "the whole name list was read"


def test_endpoint_rejects_bad_input(client_and_store):
    client, store = client_and_store
    assert client.get("/api/v1/data/names").status_code == 400
    assert client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "entity": "obs"}).status_code == 400
    bad_rx = client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "q": "(", "mode": "regex"})
    assert bad_rx.status_code == 400
    assert "regular expression" in bad_rx.get_json()["error"]
    missing = client.get("/api/v1/data/names", query_string={
        "dataset_path": store + "_missing", "q": "x"})
    assert missing.status_code == 404


def test_one_build_at_a_time_and_its_state_is_reported(tmp_path):
    """The first search of a large dataset builds its index (about 30 s at
    95.6M cells). Searches that arrive meanwhile wait for that build instead
    of each starting their own, and index_state says 'building' so the
    picker can say so instead of "no match"."""
    import threading
    store = str(tmp_path / "s.zarr")
    os.makedirs(store)
    started, release = threading.Event(), threading.Event()
    builds = []

    def load():
        builds.append(1)
        started.set()
        release.wait(10)
        return ["cell_a", "cell_b"]

    name_index.clear()
    assert name_index.index_state(store, "cells") == "absent"
    results = []
    threads = [threading.Thread(target=lambda: results.append(name_index.get_index(store, "cells", load)))
               for _ in range(4)]
    threads[0].start()
    assert started.wait(5)
    for t in threads[1:]:
        t.start()
    assert name_index.index_state(store, "cells") == "building"
    release.set()
    for t in threads:
        t.join(10)
    assert len(builds) == 1, "every waiting search got the one build"
    assert len(results) == 4 and all(r is results[0] for r in results)
    assert name_index.index_state(store, "cells") == "ready"
    name_index.clear()


def test_a_failed_build_lets_the_next_search_build_again(tmp_path):
    store = str(tmp_path / "f.zarr")
    os.makedirs(store)
    name_index.clear()
    with pytest.raises(RuntimeError):
        name_index.get_index(store, "cells", lambda: (_ for _ in ()).throw(RuntimeError("read failed")))
    assert name_index.index_state(store, "cells") == "absent"
    assert len(name_index.get_index(store, "cells", lambda: ["x"])) == 1


def test_status_route_says_absent_then_ready(client_and_store):
    client, store = client_and_store
    q = {"dataset_path": store, "entity": "cells"}
    assert client.get("/api/v1/data/names/status", query_string=q).get_json() == {"state": "absent"}
    assert client.get("/api/v1/data/names", query_string={**q, "q": "cell"}).status_code == 200
    assert client.get("/api/v1/data/names/status", query_string=q).get_json() == {"state": "ready"}
    assert client.get("/api/v1/data/names/status", query_string={**q, "entity": "x"}).status_code == 400
