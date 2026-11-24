"""The header Refresh always drops what the server remembered of a dataset (operator decision 44).

A chunk file overwritten in place keeps its name, and on a store too large to walk, or on a network file system
whose mtimes lie, nothing a walk can stat tells. Refresh exists so that a user can say "read it again", so it starts
a new generation whatever the walk found, and every derived value (a gene's values, a signature score, a Cell-Gene
group mean) is read again, in every worker.

Each test serves the three reads, overwrites one chunk of the layer in place (same key; the mtimes of the chunk and
of every folder above it are put back, as a file system that does not report them would leave them), asks for a
refresh through the route the header button calls, and reads the three again.
"""
import json
import os
import subprocess
import sys

import numpy as np
import pytest
import zarr

from annzarro.core import freshness
from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.server.routes import cell_groups as groups_route
from annzarro.tests.core import grouping_store as gstore
from annzarro.tests.server.test_cell_groups_route import CELL_TYPE, grouping, parse

LAYER = "logged"
GENE = 1


@pytest.fixture
def store(tmp_path):
    (tmp_path / "data").mkdir()
    path = gstore.make_store(tmp_path / "data" / "in.zarr", "dense", "zarr")
    zarr_reader.clear_cache()
    cell_subset.clear()
    groups_route.CODES.clear()
    yield path
    zarr_reader.clear_cache()
    cell_subset.clear()
    groups_route.CODES.clear()


@pytest.fixture
def client(store, tmp_path):
    app = create_app({"TESTING": True, "data_dir": os.path.dirname(store), "log_file": str(tmp_path / "t.log"),
                      "refresh_min_interval_s": 0})
    return app.test_client()


def gene_values(client, path):
    r = client.get(f"/api/v1/data/layer/{LAYER}", query_string={"dataset_path": path, "cols": str(GENE),
                                                                "rows": ",".join(str(i) for i in range(20))})
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()


def score(client, path):
    body = {"recipe": {"genes": [gstore.gene(GENE)], "input": LAYER}}
    r = client.post("/api/v1/data/gene_score", query_string={"dataset_path": path}, data=json.dumps(body),
                    content_type="application/json")
    assert r.status_code == 200, r.get_data(as_text=True)
    frames, blocks = r.get_data(), None
    pos, vector = 0, None
    while pos < len(frames):
        end = frames.index(b"\n", pos)
        frame = json.loads(frames[pos:end])
        pos = end + 1
        if frame["type"] == "result":
            vector = np.frombuffer(frames[pos:pos + frame["byte_length"]], dtype="<f4").copy()
            break
    assert vector is not None
    return vector


def group_sums(client, path):
    feature = {"id": "f0", "kind": "gene", "name": gstore.gene(GENE), "layer": LAYER, "detect_above": 0}
    r = client.post("/api/v1/data/cell_groups", query_string={"dataset_path": path},
                    data=json.dumps(grouping([{"source": CELL_TYPE}], features=[feature])),
                    content_type="application/json")
    assert r.status_code == 200, r.get_data(as_text=True)
    frames, blocks = parse(r.get_data())
    return blocks["feature_moments"].copy()


def everything(client, path):
    return gene_values(client, path), score(client, path), group_sums(client, path)


def changed(before, after):
    """True for each of the three reads that moved."""
    return [not (np.array_equal(np.asarray(b), np.asarray(a)) if not isinstance(b, dict) else b == a)
            for b, a in zip(before, after)]


def overwrite_chunk_in_place(path):
    """Overwrite the first chunk of the layer with other values, as ``g[layer][0:n] = v`` does, then put back
    the modification time of every file and folder of the layer and above it, so no stat() of the time moves."""
    layer = os.path.join(path, "layers", LAYER)
    places = [layer, os.path.join(path, "layers"), path]
    places += [os.path.join(layer, name) for name in os.listdir(layer)]
    stamps = [(p, os.stat(p)) for p in places]
    arr = zarr.open_group(path, mode="r+", use_consolidated=False)[f"layers/{LAYER}"]
    rows = arr.chunks[0]
    arr[0:rows, :] = arr[0:rows, :] + 7.0
    for p, st in stamps:
        if os.path.exists(p):
            os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns))


def refresh(client, path):
    r = client.post("/api/v1/data/refresh", query_string={"dataset_path": path})
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()


def test_the_overwrite_is_served_from_the_caches_until_a_refresh(client, store):
    """The premise: the result cache keeps serving a gene's values until a refresh. (The signature score and the
    group moments are streamed with no-store and read the chunks on each request, so they see an overwrite at
    once; the grouping codes they use are cached under the token, which a refresh moves.)"""
    before = everything(client, store)
    overwrite_chunk_in_place(store)
    assert changed(before, everything(client, store))[0] is False


def test_a_refresh_after_a_walk_that_sees_nothing_serves_the_new_values(client, store, monkeypatch):
    """A complete walk whose files all look as they did (an NFS that keeps mtimes): the old answer was
    ``changed: false``, no new generation, the old values."""
    before = everything(client, store)
    monkeypatch.setattr(freshness, "deep_fingerprint", lambda p, budget_s=3.0: ("same", True))
    refresh(client, store)                       # the first walk records the digest
    overwrite_chunk_in_place(store)
    answer = refresh(client, store)
    assert answer["status"] == "full" and answer["changed"] is False, "the walk sees nothing"
    assert answer["refreshed"] is True
    assert changed(before, everything(client, store)) == [True, True, True]


def test_a_refresh_of_a_store_over_the_walk_budget_serves_the_new_values(client, store, monkeypatch):
    """The real walk with its budget shrunk to nothing, as a store of millions of chunk files would run it."""
    real = freshness.deep_fingerprint
    monkeypatch.setattr(freshness, "deep_fingerprint", lambda p, budget_s=3.0: real(p, 0.0))
    before = everything(client, store)
    overwrite_chunk_in_place(store)
    answer = refresh(client, store)
    assert answer["status"] == "partial" and answer["checked"] is False and answer["refreshed"] is True
    assert "read again" in answer["message"], "the message does not claim the data is unchanged"
    assert changed(before, everything(client, store)) == [True, True, True]


def test_a_refresh_of_an_untouched_store_still_starts_a_generation(client, store):
    """Unconditional: nothing changed, and the generation (so every ETag and cache) still moves."""
    everything(client, store)
    refresh(client, store)                       # the first walk of a store always differs from nothing
    first = freshness.generation(store)
    answer = refresh(client, store)
    assert answer["changed"] is False and answer["status"] == "full" and answer["refreshed"] is True
    assert freshness.generation(store) != first


def test_a_refresh_by_another_worker_reaches_this_one(client, store, tmp_path):
    """Two gunicorn workers share the generation file. The refresh is made by a second process (the other
    worker) and the first, which holds every cache, serves the new values on its next request."""
    before = everything(client, store)
    overwrite_chunk_in_place(store)
    assert changed(before, everything(client, store))[0] is False
    code = ("import sys\nfrom annzarro.core import freshness\n"
            "r = freshness.revalidate(sys.argv[1], min_interval_s=0, budget_s=0.0)\n"
            "print(r['status'], r['refreshed'])\n")
    env = {**os.environ, "ANNZARRO_HOME": str(freshness._generation_dir().parent)}
    done = subprocess.run([sys.executable, "-c", code, store], env={**env, "PYTHONPATH": os.pathsep.join(sys.path)},
                          capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stderr
    assert done.stdout.split() == ["partial", "True"]
    assert changed(before, everything(client, store)) == [True, True, True]


def test_a_refresh_inside_the_interval_starts_nothing_yet(store, tmp_path):
    """The rate limit stands: a second refresh inside ``refresh_min_interval_s`` is answered ``scheduled`` and
    bumps nothing now, so a user cannot make every other user re-read more often than once an interval."""
    app = create_app({"TESTING": True, "data_dir": os.path.dirname(store), "log_file": str(tmp_path / "t.log"),
                      "refresh_min_interval_s": 300})
    c = app.test_client()
    assert refresh(c, store)["status"] == "full"
    gen = freshness.generation(store)
    again = refresh(c, store)
    assert again["status"] == "scheduled"
    assert freshness.generation(store) == gen


def test_the_name_index_and_the_details_caches_follow_the_generation(store):
    """Per-process memos keyed on stat() signatures alone ignored a refresh."""
    from annzarro.core import name_index
    from annzarro.server.routes import dataset_details, dataset_info
    sig = (name_index._signature(store), dataset_details._signature(store, False),
           dataset_info.etag_for(store, ["info"]))
    freshness.bump(store, reason="refresh")
    assert name_index._signature(store) != sig[0]
    assert dataset_details._signature(store, False) != sig[1]
    assert dataset_info.etag_for(store, ["info"]) != sig[2]
