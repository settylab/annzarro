"""The store fingerprint a saved view records (core/fingerprint.py).

Two tiers: ``data`` (the cells and genes: counts and a content digest of
each index) and ``meta`` (every metadata document, with a per-group digest
and the field names). What must hold:

* a copy of a store at another path, with or without consolidated
  metadata, has the same fingerprint;
* the same names stored another way (other chunks, no compression, zarr
  format 3, h5ad) keep the data tier;
* one obs column more changes the meta tier only, and ``fields`` names it;
* one cell renamed changes the data tier;
* opening and using the store (structure, a column, name search, which
  builds the name index) does not change it;
* it is persisted, so another process does not recompute it.
"""
import json
import os
import shutil

import numpy as np
import pytest

from annzarro.core import fingerprint, get_reader
from annzarro.tests.zarr_compat import ZARR_V3, open_group, write_strings

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")
FIXTURE = os.path.join(DATA, "fixture_small.zarr")
FIXTURE_V3 = os.path.join(DATA, "fixture_small_v3.zarr")


@pytest.fixture(autouse=True)
def _fresh_cache():
    fingerprint.forget()
    yield
    fingerprint.forget()


def fp(path):
    return fingerprint.compute(get_reader(str(path)), str(path))


def _copy(tmp_path, name="copy.zarr"):
    dst = tmp_path / name
    shutil.copytree(FIXTURE, dst)
    return dst


def _consolidate(store):
    """Rewrite .zmetadata from the documents on disk (zarr 2 layout)."""
    docs = fingerprint._zarr_local_metadata(str(store))
    with open(store / ".zmetadata", "w") as fh:
        json.dump({"zarr_consolidated_format": 1, "metadata": docs}, fh)


def test_shape_of_the_fingerprint():
    out = fp(FIXTURE)
    assert out["v"] == fingerprint.FINGERPRINT_VERSION
    assert (out["n_obs"], out["n_var"]) == (200, 20)
    for key in ("cells", "genes", "data", "meta"):
        assert isinstance(out[key], str) and len(out[key]) == 32
    assert out["fields"]["obs"] == ["_index", "cell_type", "leiden", "total_counts"]
    assert out["fields"]["obsm"] == ["X_umap"]
    assert set(out["groups"]) >= {"obs", "var", "obsm", "X"}


def test_a_copy_elsewhere_is_the_same_store(tmp_path):
    assert fp(_copy(tmp_path)) == fp(FIXTURE)


def test_consolidated_metadata_does_not_count(tmp_path):
    store = _copy(tmp_path)
    os.remove(store / ".zmetadata")
    # the metadata tier only: the names are read through zarr, which is not
    # what this is about
    assert fingerprint.metadata_part(str(store)) == fingerprint.metadata_part(FIXTURE)


def test_files_beside_and_inside_that_are_not_metadata_do_not_count(tmp_path):
    store = _copy(tmp_path)
    (tmp_path / "copy.zarr.annzarro-cache").write_text("x")
    (store / ".DS_Store").write_text("x")
    (store / "notes.txt").write_text("x")
    assert fp(store) == fp(FIXTURE)


# The fingerprint of the committed fixture, as every server computes it: the
# same under zarr 2 (Python 3.9 in CI) and zarr 3, on every platform. A change
# here breaks every saved view's store check: bump FINGERPRINT_VERSION instead.
FIXTURE_FINGERPRINT = {
    "cells": "af717cf4052702e921b5895d70ec7a15",
    "genes": "0282218ce5c7e2e273b119224799aabd",
    "data": "0cfa34b3b4a952c627fe2b45a6d45912",
    # v0.4.3: an (empty) ``consolidated_metadata`` entry in a ``.zgroup`` is no
    # longer part of the document (zarr 3 writes it into some .zgroup files and
    # every .zmetadata entry; the metadata tier now comes from .zmetadata, so
    # both must read the same). Only the fixture's var group had one: the
    # meta digest moved, v and the data tier did not.
    "meta": "a789db82f8fc2b36ff0f6b99ab213398",
}


def test_the_same_on_every_server():
    out = fp(FIXTURE)
    assert {k: out[k] for k in FIXTURE_FINGERPRINT} == FIXTURE_FINGERPRINT


@pytest.mark.skipif(not ZARR_V3, reason="zarr 2 cannot read a zarr format 3 store")
def test_zarr_format_3_copy_keeps_the_cells_and_genes():
    a, b = fp(FIXTURE), fp(FIXTURE_V3)
    assert a["data"] == b["data"]
    assert a["meta"] != b["meta"]


def test_h5ad_twin_keeps_the_cells_and_genes(tmp_path):
    from annzarro.tests.core.h5ad_twin import h5ad_twin
    twin = h5ad_twin(FIXTURE, tmp_path / "twin.h5ad")
    a, b = fp(FIXTURE), fp(twin)
    assert (b["n_obs"], b["n_var"], b["cells"], b["genes"], b["data"]) == \
        (a["n_obs"], a["n_var"], a["cells"], a["genes"], a["data"])
    assert b["fields"]["obs"] == a["fields"]["obs"]
    assert b["fields"]["obsm"] == a["fields"]["obsm"]


def _rewrite_index(store, names, **kw):
    group = open_group(store / "obs", mode="a")
    attrs = dict(group["_index"].attrs)
    if ZARR_V3:
        del group["_index"]
    else:
        del group["_index"]
    arr = write_strings(group, "_index", names, **kw)
    arr.attrs.update(attrs)
    _consolidate(store)


def _names():
    return [f"cell_{i:04d}" for i in range(200)]


def test_other_chunks_and_compression_keep_the_cells(tmp_path):
    store = _copy(tmp_path)
    _rewrite_index(store, _names(), chunks=(7,), compressor=None)
    a, b = fp(FIXTURE), fp(store)
    assert a["cells"] == b["cells"] and a["data"] == b["data"]
    # the arrays' metadata did change
    assert a["groups"]["obs"] != b["groups"]["obs"]


def test_one_cell_renamed_is_other_cells(tmp_path):
    store = _copy(tmp_path)
    names = _names()
    names[17] = "cell_x"
    _rewrite_index(store, names, chunks=(7,), compressor=None)
    a, b = fp(FIXTURE), fp(store)
    assert a["cells"] != b["cells"] and a["data"] != b["data"]
    assert a["genes"] == b["genes"]


def test_one_obs_column_more_changes_only_the_fields(tmp_path):
    store = _copy(tmp_path)
    shutil.copytree(store / "obs" / "total_counts", store / "obs" / "total_counts_2")
    attrs = json.loads((store / "obs" / ".zattrs").read_text())
    attrs["column-order"] = list(attrs.get("column-order", [])) + ["total_counts_2"]
    (store / "obs" / ".zattrs").write_text(json.dumps(attrs))
    _consolidate(store)
    a, b = fp(FIXTURE), fp(store)
    assert a["data"] == b["data"]
    assert a["meta"] != b["meta"]
    assert b["fields"]["obs"] == a["fields"]["obs"] + ["total_counts_2"]
    changed = {g for g in a["groups"] if a["groups"][g] != b["groups"].get(g)}
    assert changed == {"obs"}


def test_using_the_store_does_not_change_it(tmp_path):
    """Open the store through the server and use it as a user would
    (structure, a column, focus lookups, name search, which builds the
    name index), then fingerprint it again from scratch."""
    from annzarro.server.core import create_app
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    store = data_dir / "fixture_small.zarr"
    shutil.copytree(FIXTURE, store)
    before_files = sorted(str(p.relative_to(store)) for p in store.rglob("*"))
    before = fp(store)

    app = create_app({"TESTING": True, "auth_enabled": False, "data_dir": str(data_dir)})
    client = app.test_client()
    q = f"dataset_path={store}"
    for url in (f"/api/v1/data/info?{q}", f"/api/v1/data/dataset_structure?{q}",
                f"/api/v1/data/obs?{q}&columns=cell_type", f"/api/v1/data/X?{q}&cols=3",
                f"/api/v1/data/names?{q}&entity=cells&q=cell_00", f"/api/v1/data/names?{q}&entity=genes&q=GENE",
                f"/api/v1/data/fingerprint?{q}&wait=5"):
        assert client.get(url).status_code == 200, url
    assert sorted(str(p.relative_to(store)) for p in store.rglob("*")) == before_files
    fingerprint.forget()
    shutil.rmtree(fingerprint._cache_file(str(store)).parent, ignore_errors=True)
    assert fp(store) == before


def test_persisted_and_not_recomputed(tmp_path, monkeypatch):
    store = _copy(tmp_path)
    reader = get_reader(str(store))
    first = fingerprint.get(reader, str(store), wait=10)
    assert first["status"] == "ready"
    assert fingerprint._cache_file(str(store)).is_file()
    fingerprint.forget()

    def boom(*a, **k):
        raise AssertionError("recomputed")
    monkeypatch.setattr(fingerprint, "compute", boom)
    again = fingerprint.get(reader, str(store), wait=0)
    assert again == first


def test_a_rewritten_store_is_recomputed(tmp_path):
    store = _copy(tmp_path)
    reader = get_reader(str(store))
    first = fingerprint.get(reader, str(store), wait=10)["fingerprint"]
    names = _names()
    names[0] = "renamed"
    _rewrite_index(store, names)
    # the rewrite moved the obs group's mtime; make sure it registers on
    # file systems with coarse timestamps
    os.utime(store / "obs", ns=(1, 1))
    second = fingerprint.get(reader, str(store), wait=10)["fingerprint"]
    assert second["cells"] != first["cells"]


def test_pending_never_blocks_and_has_the_metadata_tier(tmp_path, monkeypatch):
    import threading
    store = _copy(tmp_path)
    gate = threading.Event()
    real = fingerprint.data_part

    def slow(reader, path):
        gate.wait(10)
        return real(reader, path)
    monkeypatch.setattr(fingerprint, "data_part", slow)
    try:
        out = fingerprint.get(get_reader(str(store)), str(store), wait=0)
        assert out["status"] == "pending"
        assert out["fingerprint"]["meta"] == fp(FIXTURE)["meta"]
        assert "data" not in out["fingerprint"]
    finally:
        gate.set()


class TestRoute:
    @pytest.fixture
    def setup(self, tmp_path):
        from annzarro.server.core import create_app
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        store = data_dir / "fixture_small.zarr"
        shutil.copytree(FIXTURE, store)
        app = create_app({"TESTING": True, "auth_enabled": False, "data_dir": str(data_dir)})
        return app.test_client(), data_dir, store

    def test_ready_with_rel_path_and_version(self, setup):
        from annzarro import __version__
        client, _, store = setup
        body = client.get(f"/api/v1/data/fingerprint?dataset_path={store}&wait=5").get_json()
        assert body["status"] == "ready"
        assert body["rel_path"] == "fixture_small.zarr"
        assert body["annzarro_version"] == __version__
        assert body["fingerprint"]["data"] == fp(FIXTURE)["data"]

    def test_a_relative_name_resolves_in_the_data_directory(self, setup):
        client, _, _ = setup
        body = client.get("/api/v1/data/fingerprint?dataset_path=fixture_small.zarr&wait=5").get_json()
        assert body["status"] == "ready" and body["rel_path"] == "fixture_small.zarr"

    def test_outside_the_data_directory_has_no_rel_path(self, setup, tmp_path):
        client, _, _ = setup
        other = _copy(tmp_path, "elsewhere.zarr")
        body = client.get(f"/api/v1/data/fingerprint?dataset_path={other}&wait=5").get_json()
        assert body["rel_path"] is None
        assert body["fingerprint"]["data"] == fp(FIXTURE)["data"]

    def test_missing_store_is_not_found(self, setup, tmp_path):
        client, _, _ = setup
        r = client.get(f"/api/v1/data/fingerprint?dataset_path={tmp_path / 'nope.zarr'}")
        assert r.status_code == 404
        assert r.get_json()["reason"] == "not_found"

    def test_opening_a_dataset_does_not_hash_the_names(self, setup, monkeypatch):
        client, _, store = setup

        def boom(*a, **k):
            raise AssertionError("the name hash was started")
        monkeypatch.setattr(fingerprint, "data_part", boom)
        body = client.get(f"/api/v1/data/fingerprint?dataset_path={store}&wait=0").get_json()
        assert body["status"] == "pending"
        assert body["fingerprint"]["n_obs"] == 200
        monkeypatch.undo()
        # saving or sharing (wait>0) hashes them, to the digests v0.4.1 gave
        body = client.get(f"/api/v1/data/fingerprint?dataset_path={store}&wait=5").get_json()
        assert body["status"] == "ready"
        assert (body["fingerprint"]["cells"], body["fingerprint"]["genes"]) == (GOLDEN_CELLS, GOLDEN_GENES)

    def test_bad_wait(self, setup):
        client, _, store = setup
        assert client.get(f"/api/v1/data/fingerprint?dataset_path={store}&wait=x").status_code == 400

    def test_pending_reports_the_counts(self, setup, monkeypatch):
        import threading
        client, _, store = setup
        gate = threading.Event()
        real = fingerprint.data_part
        monkeypatch.setattr(fingerprint, "data_part", lambda r, p: (gate.wait(10), real(r, p))[1])
        try:
            body = client.get(f"/api/v1/data/fingerprint?dataset_path={store}").get_json()
            assert body["status"] == "pending"
            assert (body["fingerprint"]["n_obs"], body["fingerprint"]["n_var"]) == (200, 20)
        finally:
            gate.set()

    def test_a_hosted_server_refuses_a_path_outside_its_roots(self, tmp_path):
        from annzarro.server.core import create_app
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        other = _copy(tmp_path, "elsewhere.zarr")
        app = create_app({"TESTING": True, "auth_enabled": False, "data_dir": str(data_dir),
                          "hosted": True})
        r = app.test_client().get(f"/api/v1/data/fingerprint?dataset_path={other}")
        assert r.status_code == 403


# --- when the names are hashed ---------------------------------------------

# Digests computed by github/main (v0.4.1) on the fixture: the identity must
# not change with when it is computed. Except GOLDEN_META, which moved once in
# v0.4.3 (see FIXTURE_FINGERPRINT).
GOLDEN_CELLS = "af717cf4052702e921b5895d70ec7a15"
GOLDEN_GENES = "0282218ce5c7e2e273b119224799aabd"
GOLDEN_DATA = "0cfa34b3b4a952c627fe2b45a6d45912"
GOLDEN_META = "a789db82f8fc2b36ff0f6b99ab213398"


def test_opening_does_not_start_the_hash(tmp_path, monkeypatch):
    store = _copy(tmp_path)
    reader = get_reader(str(store))

    def boom(*a, **k):
        raise AssertionError("the name hash was started")
    monkeypatch.setattr(fingerprint, "data_part", boom)
    monkeypatch.setattr(fingerprint, "index_digest", boom)
    for _ in range(3):
        out = fingerprint.get(reader, str(store), wait=0)
        assert out["status"] == "pending"
        assert out["fingerprint"]["meta"] == GOLDEN_META
    assert fingerprint._pending == {}


def test_saving_or_sharing_still_gets_the_same_fingerprint(tmp_path):
    store = _copy(tmp_path)
    reader = get_reader(str(store))
    assert fingerprint.get(reader, str(store), wait=0)["status"] == "pending"
    out = fingerprint.get(reader, str(store), wait=10)
    assert out["status"] == "ready"
    got = out["fingerprint"]
    assert (got["cells"], got["genes"], got["data"], got["meta"]) == (
        GOLDEN_CELLS, GOLDEN_GENES, GOLDEN_DATA, GOLDEN_META)
    # once known, a wait=0 call (a later open) gets it too
    assert fingerprint.get(reader, str(store), wait=0)["fingerprint"] == got


def test_a_hash_already_running_is_reported_pending_not_restarted(tmp_path, monkeypatch):
    import threading
    store = _copy(tmp_path)
    reader = get_reader(str(store))
    gate, calls = threading.Event(), []
    real = fingerprint.data_part

    def slow(r, p):
        calls.append(1)
        gate.wait(10)
        return real(r, p)
    monkeypatch.setattr(fingerprint, "data_part", slow)
    try:
        assert fingerprint.get(reader, str(store), wait=0.05)["status"] == "pending"
        assert fingerprint.get(reader, str(store), wait=0)["status"] == "pending"
    finally:
        gate.set()
    assert fingerprint.get(reader, str(store), wait=10)["status"] == "ready"
    assert len(calls) == 1


# --- the metadata tier from consolidated metadata (one read, not a walk) ----

def _add_obs_column(store, consolidate):
    shutil.copytree(store / "obs" / "total_counts", store / "obs" / "total_counts_2")
    attrs = json.loads((store / "obs" / ".zattrs").read_text())
    attrs["column-order"] = list(attrs.get("column-order", [])) + ["total_counts_2"]
    (store / "obs" / ".zattrs").write_text(json.dumps(attrs))
    if consolidate:
        _consolidate(store)


def _set_uns_attr(store, value, consolidate):
    """Rewrite a nested attribute (uns/note), no new member."""
    os.makedirs(store / "uns" / "note", exist_ok=True)
    (store / "uns" / ".zgroup").write_text('{"zarr_format": 2}')
    (store / "uns" / "note" / ".zgroup").write_text('{"zarr_format": 2}')
    (store / "uns" / "note" / ".zattrs").write_text(json.dumps({"v": value}))
    if consolidate:
        _consolidate(store)


class _Calls:
    """Count the file-system calls a function makes (what an NFS mount pays for)."""
    NAMES = (("os", "stat"), ("os", "listdir"), ("os", "scandir"), ("os.path", "isfile"),
             ("os.path", "isdir"), ("os.path", "exists"), ("builtins", "open"))

    def __init__(self, monkeypatch):
        import builtins
        self.n = 0
        mods = {"os": os, "os.path": os.path, "builtins": builtins}
        for mod, name in self.NAMES:
            real = getattr(mods[mod], name)

            def counted(*a, _real=real, **k):
                self.n += 1
                return _real(*a, **k)
            monkeypatch.setattr(mods[mod], name, counted)


def _many_uns(store, n):
    for i in range(n):
        d = store / "uns" / f"k{i}"
        os.makedirs(d, exist_ok=True)
        (d / ".zgroup").write_text('{"zarr_format": 2}')
        (d / ".zattrs").write_text(json.dumps({"i": i}))
    (store / "uns" / ".zgroup").write_text('{"zarr_format": 2}')
    _consolidate(store)


def test_consolidated_and_walk_agree(tmp_path):
    store = _copy(tmp_path)
    _many_uns(store, 5)
    via_file = fingerprint._zarr_local_consolidated(str(store))
    assert via_file is not None
    assert via_file == fingerprint._zarr_local_metadata(str(store))


def test_consolidated_metadata_change_changes_the_meta_tier(tmp_path):
    store = _copy(tmp_path)
    before = fingerprint.metadata_part(str(store))
    _add_obs_column(store, consolidate=True)
    assert fingerprint._zarr_local_consolidated(str(store)) is not None   # not the walk
    after = fingerprint.metadata_part(str(store))
    assert after["meta"] != before["meta"]
    assert after["fields"]["obs"] == before["fields"]["obs"] + ["total_counts_2"]
    # a rewritten nested attribute, re-consolidated
    _set_uns_attr(store, 1, consolidate=True)
    one = fingerprint.metadata_part(str(store))["meta"]
    _set_uns_attr(store, 2, consolidate=True)
    assert fingerprint.metadata_part(str(store))["meta"] != one


def test_walk_fallback_without_consolidated_metadata(tmp_path):
    store = _copy(tmp_path)
    os.remove(store / ".zmetadata")
    assert fingerprint._zarr_local_consolidated(str(store)) is None
    before = fingerprint.metadata_part(str(store))
    _add_obs_column(store, consolidate=False)
    after = fingerprint.metadata_part(str(store))
    assert after["meta"] != before["meta"]
    assert after["fields"]["obs"] == before["fields"]["obs"] + ["total_counts_2"]
    _set_uns_attr(store, 1, consolidate=False)
    one = fingerprint.metadata_part(str(store))["meta"]
    _set_uns_attr(store, 2, consolidate=False)
    assert fingerprint.metadata_part(str(store))["meta"] != one


def test_stale_consolidated_metadata_falls_back_to_the_walk(tmp_path):
    """A column added after consolidating: .zmetadata does not list it, the
    disk has it; the fingerprint must see it (the walk), not the old file."""
    store = _copy(tmp_path)
    before = fingerprint.metadata_part(str(store))
    _add_obs_column(store, consolidate=False)
    assert fingerprint._zarr_local_consolidated(str(store)) is None
    after = fingerprint.metadata_part(str(store))
    assert after["meta"] != before["meta"]
    assert "total_counts_2" in after["fields"]["obs"]
    # and a removed column, likewise
    shutil.rmtree(store / "obs" / "leiden")
    assert fingerprint._zarr_local_consolidated(str(store)) is None
    assert "leiden" not in fingerprint.metadata_part(str(store))["fields"]["obs"]


def test_consolidated_metadata_a_refresh_found_stale_is_not_used(tmp_path):
    """A refresh records ``consolidated_stale`` (a rewrite in place that
    changes no member name): the walk then answers."""
    from annzarro.core import freshness
    store = _copy(tmp_path)
    _many_uns(store, 3)
    (store / "uns" / "k1" / ".zattrs").write_text(json.dumps({"i": "rewritten"}))   # .zmetadata not updated
    stale = fingerprint.metadata_part(str(store))["meta"]
    assert fingerprint._zarr_local_consolidated(str(store)) is not None
    freshness.bump(str(store), consolidated_stale="uns/k1 differs")
    try:
        assert fingerprint._zarr_local_consolidated(str(store)) is None
        assert fingerprint.metadata_part(str(store))["meta"] != stale
    finally:
        freshness.bump(str(store), consolidated_stale=None)


def test_a_consolidated_store_costs_a_fixed_number_of_calls(tmp_path, monkeypatch):
    small, big = _copy(tmp_path, "small.zarr"), _copy(tmp_path, "big.zarr")
    _many_uns(small, 2)
    _many_uns(big, 150)
    counts = {}
    for name, store in (("small", small), ("big", big)):
        calls = _Calls(monkeypatch)
        fingerprint.metadata_part(str(store))
        counts[name] = calls.n
        monkeypatch.undo()
    assert counts["big"] == counts["small"]          # O(1) in the number of nodes
    assert counts["big"] <= 40
    # the walk it replaces is linear
    os.remove(big / ".zmetadata")
    calls = _Calls(monkeypatch)
    fingerprint.metadata_part(str(big))
    assert calls.n > 500


def test_zarr_3_consolidated_zarr_json(tmp_path):
    """The root zarr.json of a zarr 3 store carries the consolidated copy."""
    store = tmp_path / "v3.zarr"
    shutil.copytree(FIXTURE_V3, store)
    docs = fingerprint._zarr_local_consolidated(str(store))
    if docs is None:
        pytest.skip("the committed zarr 3 fixture is not consolidated")
    assert docs == fingerprint._zarr_local_metadata(str(store))
