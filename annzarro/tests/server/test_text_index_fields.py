"""Field names in the text index (T1): what a crawl reads of every store, how a name ranks, what a hit says
of them, and who may be told.

The reply of ``GET /datasets/text-search`` is checked against ``tests/data/text_search_fields_reply.json``,
which the browser's tests read too.
"""
import json
import os
import shutil
import threading
import time

import numpy as np
import pytest
import zarr

from annzarro.core import store_details
from annzarro.server import access, text_index
from annzarro.server.core import create_app
from annzarro.server.routes import data_routes
from annzarro.tests.server.rich_store import FIXTURE, N_OBS, N_VAR
from annzarro.tests.server.test_text_index import annotate, config_for, crawl, entries, make_world
from annzarro.tests.server.test_text_search import SEARCH, client, make_app

REPLY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "text_search_fields_reply.json")


@pytest.fixture(autouse=True)
def fresh_caches():
    data_routes._LISTING_PROBE_CACHE.clear()
    text_index._loaded.clear()
    yield
    data_routes._LISTING_PROBE_CACHE.clear()
    text_index._loaded.clear()


def add_names(path, obs=(), var=(), obsm=(), layers=(), obsp=(), varm=(), varp=(), uns=()):
    """Add fields of the given names to the zarr store at ``path`` (arrays of zeros; ``uns`` entries may be paths)."""
    root = zarr.open_group(str(path), mode="a")
    for axis, names, n in (("obs", obs, N_OBS), ("var", var, N_VAR)):
        if names:
            order = [str(c) for c in root[axis].attrs["column-order"]]
            for name in names:
                root[axis].create_array(name, data=np.zeros(n, dtype="float32"))
                order.append(name)
            root[axis].attrs["column-order"] = order
    for slot, names in (("obsm", obsm), ("layers", layers), ("obsp", obsp), ("varm", varm), ("varp", varp)):
        for name in names:
            root.require_group(slot).create_array(name, data=np.zeros((2, 2), dtype="float32"))
    for name in uns:
        parts = name.split("/")
        group = root.require_group("uns")
        for part in parts[:-1]:
            group = group.require_group(part)
        group.create_array(parts[-1], data=np.zeros(1))
    zarr.consolidate_metadata(str(path))


def new_store(data, name, **names):
    path = data / name
    shutil.copytree(FIXTURE, path)
    add_names(path, **names)
    return path


@pytest.fixture
def bare_app(tmp_path):
    """An empty data folder: each test puts in the stores it needs."""
    (tmp_path / "data").mkdir()
    app = create_app(config_for(tmp_path))
    app.data = tmp_path / "data"
    return app


def search(app, query, **kw):
    terms = text_index.parse_query(query)
    hits, more, partial = text_index.search(text_index.load(app.config), terms, lambda entry: True, **kw)
    return hits


def found(app, query):
    return [h["entry"]["name"] for h in search(app, query)]


# --- what the crawl reads ---------------------------------------------------------------------------------

def test_the_index_version_rose(tmp_path):
    assert text_index.INDEX_VERSION == 4


def test_an_index_of_the_old_version_is_not_read(bare_app):
    crawl(bare_app)
    path = text_index._file(bare_app.config, "index.json.gz")
    import gzip
    with gzip.open(path, "rt") as fh:
        lines = fh.read().splitlines()
    header = json.loads(lines[0])
    header["version"] = 3
    with gzip.open(path, "wt") as fh:
        fh.write("\n".join([json.dumps(header), *lines[1:]]) + "\n")
    text_index._loaded.clear()
    assert text_index.load(bare_app.config) is None


def test_donor_counts_finds_a_store_by_an_obs_column_and_a_layer(bare_app):
    """Fails on the base: a store with neither README nor attribution was indexed by its name alone."""
    new_store(bare_app.data, "cohort.zarr", obs=["donor_id"], layers=["logged"])
    new_store(bare_app.data, "other.zarr", obs=["batch"])
    new_store(bare_app.data, "half.zarr", obs=["donor_id"])
    crawl(bare_app)
    hits = search(bare_app, "donor logged")
    assert [h["entry"]["name"] for h in hits] == ["cohort.zarr"]
    assert hits[0]["matched"] == ["obs", "layers"]


def test_every_kind_of_name_is_matched(bare_app):
    new_store(bare_app.data, "all.zarr", obs=["o_col"], var=["v_col"], obsm=["X_o"], layers=["l_layer"], obsp=["p_graph"],
              varm=["v_embed"], varp=["v_graph"], uns=["u_key/nested"])
    crawl(bare_app)
    kinds = {"o_col": "obs", "v_col": "var", "X_o": "obsm", "l_layer": "layers", "p_graph": "obsp", "v_embed": "varm",
             "v_graph": "varp", "u_key": "uns", "nested": "uns"}
    for term, kind in kinds.items():
        hits = search(bare_app, term)
        assert [h["entry"]["name"] for h in hits] == ["all.zarr"] and kind in hits[0]["matched"], term


def test_a_name_matches_as_a_substring_and_without_case(bare_app):
    new_store(bare_app.data, "a.zarr", obs=["Donor_ID"])
    crawl(bare_app)
    assert found(bare_app, "or_i") == ["a.zarr"] and found(bare_app, "DONOR") == ["a.zarr"]


def test_terms_may_be_met_by_different_kinds_and_a_missing_one_fails(bare_app):
    new_store(bare_app.data, "a.zarr", obs=["donor_id"], var=["symbol"])
    crawl(bare_app)
    assert found(bare_app, "donor symbol") == ["a.zarr"] and found(bare_app, "donor missing") == []


def test_a_name_of_a_store_without_text_is_read_by_a_crawl_and_a_changed_slot_is_read_again(bare_app):
    path = new_store(bare_app.data, "a.zarr", obs=["donor_id"])
    status = crawl(bare_app)
    assert status["total"] == 1 and found(bare_app, "donor_id") == ["a.zarr"]
    assert crawl(bare_app)["reused"] == 1
    time.sleep(0.02)
    add_names(path, layers=["fresh_layer"])       # nothing at the top of the store moved: only the slot did
    status = crawl(bare_app)
    assert status["reused"] == 0 and found(bare_app, "fresh_layer") == ["a.zarr"]


def test_h5ad_files_are_read_for_names_too(bare_app):
    from annzarro.tests.core.h5ad_twin import h5ad_twin
    h5ad_twin(FIXTURE, bare_app.data / "twin.h5ad")
    crawl(bare_app)
    assert found(bare_app, "cell_type") == ["twin.h5ad"]


def test_a_store_that_is_no_anndata_has_no_names_and_the_others_are_unharmed(bare_app):
    new_store(bare_app.data, "good.zarr", obs=["donor_id"])
    (bare_app.data / "bad.zarr" / "uns" / "README").mkdir(parents=True)
    crawl(bare_app)
    assert found(bare_app, "donor_id") == ["good.zarr"]
    assert entries(bare_app)["bad.zarr"].get("names", {}) == {}


# --- ranking -----------------------------------------------------------------------------------------------

def test_the_kinds_weigh_three_and_two_and_a_description_outweighs_a_name(bare_app):
    new_store(bare_app.data, "in_obs.zarr", obs=["zebra_a"])
    new_store(bare_app.data, "in_layers.zarr", layers=["zebra_b"])
    new_store(bare_app.data, "in_var.zarr", var=["zebra_c"])
    new_store(bare_app.data, "in_uns.zarr", uns=["zebra_d"])
    described = new_store(bare_app.data, "described.zarr")
    annotate(described, {"description": "A zebra study"})
    crawl(bare_app)
    scores = {h["entry"]["name"]: h["score"] for h in search(bare_app, "zebra")}
    assert scores["in_obs.zarr"] == scores["in_layers.zarr"] > scores["in_var.zarr"] == scores["in_uns.zarr"]
    assert scores["described.zarr"] > scores["in_obs.zarr"]
    assert text_index.WEIGHTS["obs"] == text_index.WEIGHTS["obsm"] == text_index.WEIGHTS["layers"] == 3
    assert all(text_index.WEIGHTS[k] == 2 for k in ("var", "varm", "obsp", "varp", "uns"))
    assert text_index.WEIGHTS["description"] > 3 > 2 > text_index.WEIGHTS["readme"]


def test_a_whole_name_scores_double(bare_app):
    new_store(bare_app.data, "whole.zarr", obs=["donor"])
    new_store(bare_app.data, "part.zarr", obs=["donor_id"])
    crawl(bare_app)
    scores = {h["entry"]["name"]: h["score"] for h in search(bare_app, "donor")}
    assert scores["whole.zarr"] == 2 * scores["part.zarr"]
    assert found(bare_app, "donor")[0] == "whole.zarr"


def test_the_open_dataset_still_ranks_first(bare_app):
    new_store(bare_app.data, "whole.zarr", obs=["donor"])
    path = new_store(bare_app.data, "part.zarr", obs=["donor_id"])
    crawl(bare_app)
    hits = search(bare_app, "donor", current=str(path))
    assert [h["entry"]["name"] for h in hits] == ["part.zarr", "whole.zarr"]


# --- what a hit says of its names ------------------------------------------------------------------------------

def test_a_hit_lists_its_matching_names_by_kind_heaviest_first(bare_app):
    new_store(bare_app.data, "a.zarr", obs=["donor_id", "donor_sex", "batch"], uns=["donor_metadata/age"], var=["donor_gene"])
    crawl(bare_app)
    hit, = search(bare_app, "donor")
    assert hit["matched"] == ["obs", "var", "uns"]
    assert [f["kind"] for f in hit["fields"]] == ["obs", "var", "uns"]
    obs = hit["fields"][0]
    assert sorted(obs["names"]) == ["donor_id", "donor_sex"] and obs["more"] == 0 and obs["cut"] is False
    assert hit["fields"][2]["names"] == ["donor_metadata", "donor_metadata/age"] and hit["fields"][2]["more"] == 0


def test_five_names_are_listed_best_first_and_the_rest_counted(bare_app):
    names = ["xdonor", "a_donor", "donor_b", "donor", "mydonor_1", "donor_zz", "zz_donor_zz", "donor_x"]
    new_store(bare_app.data, "a.zarr", obs=names + ["unrelated"])
    crawl(bare_app)
    field, = search(bare_app, "donor")[0]["fields"]
    assert len(field["names"]) == 5 and field["more"] == 3
    assert field["names"][0] == "donor"                       # the whole name first
    assert field["names"][1:3] == ["donor_b", "donor_x"] or field["names"][1] == "donor_b"
    assert "unrelated" not in field["names"]


def test_a_hit_without_a_name_match_has_no_fields(bare_app):
    path = new_store(bare_app.data, "a.zarr", obs=["batch"])
    annotate(path, {"description": "About lymphocytes"})
    crawl(bare_app)
    hit, = search(bare_app, "lymphocytes")
    assert hit["fields"] == [] and hit["matched"] == ["description"]


def test_a_name_only_hit_has_a_snippet_of_the_names(bare_app):
    new_store(bare_app.data, "a.zarr", obs=["donor_id"])
    crawl(bare_app)
    hit, = search(bare_app, "donor")
    assert hit["snippet"]["field"] == "obs" and hit["snippet"]["text"] == "donor_id" and hit["snippet"]["highlights"] == [[0, 5]]


# --- caps ------------------------------------------------------------------------------------------------------------

def test_names_cut_by_the_store_listing_are_marked(bare_app, monkeypatch):
    monkeypatch.setattr(store_details, "MAX_NAMES", 5)      # the fixture's three columns, then g_1 and g_2
    new_store(bare_app.data, "a.zarr", obs=["g_1", "g_2", "g_3", "g_4"], layers=["g_layer"])
    crawl(bare_app)
    entry = entries(bare_app)["a.zarr"]
    assert "obs" in entry["names_cut"] and "layers" not in entry["names_cut"]
    fields = {f["kind"]: f for f in search(bare_app, "g_")[0]["fields"]}
    assert fields["obs"]["cut"] is True and fields["layers"]["cut"] is False


def test_names_are_cut_at_sixteen_kilobytes_in_all_with_the_heavy_kinds_first(bare_app, monkeypatch):
    assert text_index.MAX_NAME_BYTES == 16 * 1024
    monkeypatch.setattr(text_index, "MAX_NAME_BYTES", 70)        # the fixture's obs columns take 30, "o" * 30 the next 31
    new_store(bare_app.data, "a.zarr", obs=["o" * 30, "p" * 30], var=["v_name"])
    crawl(bare_app)
    entry = entries(bare_app)["a.zarr"]
    kept = [n for text in entry["names"].values() for n in text.split("\n") if n]
    assert sum(len(n.encode()) + 1 for n in kept) <= 70
    assert "o" * 30 in entry["names"]["obs"] and "p" * 30 not in entry["names"]["obs"]
    assert "var" not in entry["names"]                                                           # the lighter kinds are left out
    assert "obs" in entry["names_cut"] and "var" in entry["names_cut"]


def _entry(readme, names):
    return {"path": "/x", "real": "/x", "readme": readme, "about": {}, "names": names}


def test_names_are_dropped_only_after_every_readme():
    big = [_entry("r" * 5000, {"obs": "a" * 3000}), _entry("r" * 4000, {"obs": "b" * 3000})]
    limit_mb = 8000 / (1024 * 1024)                        # the READMEs go (9000 chars), the names (6000) fit
    assert text_index._cap_size(big, limit_mb) is True
    assert [e["readme"] for e in big] == ["", ""] and all(e["names"] for e in big)
    big = [_entry("r" * 5000, {"obs": "a" * 3000}), _entry("r" * 4000, {"obs": "b" * 3000})]
    assert text_index._cap_size(big, 4000 / (1024 * 1024)) is True
    assert [e["readme"] for e in big] == ["", ""]
    assert sorted(bool(e["names"]) for e in big) == [False, True]       # the larger names go first, only as far as needed
    assert [e["names_cut"] for e in big if not e["names"]] == [["obs"]]


# --- who is told -----------------------------------------------------------------------------------------------------

@pytest.fixture
def granted(tmp_path):
    app = make_app(tmp_path)
    add_names(tmp_path / "data" / "out.zarr", obs=["secretcolumn"], layers=["secretlayer"])
    add_names(tmp_path / "data" / "liver.zarr", obs=["hepatocyte_marker"])
    access.add_grant(app.config, "bob", "store", f"{app.data}/liver.zarr", actor="alice")
    access.set_restricted(app.config, "bob", True)
    crawl(app)
    return app


def test_a_name_of_a_store_the_user_may_not_open_never_appears(granted):
    bob, carol = client(granted, "bob"), client(granted, "carol")
    for query in ("secretcolumn", "secretlayer", "secret"):
        reply = bob.get(SEARCH, query_string={"q": query})
        assert reply.get_json()["results"] == [], query
        assert "secretcolumn" not in reply.get_data(as_text=True) and "secretlayer" not in reply.get_data(as_text=True)
    assert [r["name"] for r in carol.get(SEARCH, query_string={"q": "secretcolumn"}).get_json()["results"]] == ["out.zarr"]
    mine = bob.get(SEARCH, query_string={"q": "hepatocyte_marker"}).get_json()["results"]
    assert [r["name"] for r in mine] == ["liver.zarr"] and mine[0]["fields"][0]["names"] == ["hepatocyte_marker"]


def test_the_reply_of_a_search_is_not_changed_for_a_complete_index(granted):
    body = client(granted, "carol").get(SEARCH, query_string={"q": "secretcolumn"}).get_json()
    assert body["index"] == {"complete": True}
    assert set(body["results"][0]) >= {"matched", "fields", "snippet", "title", "score"}


# --- "still being indexed" ---------------------------------------------------------------------------------------------

def running(app, done, total):
    now = time.time()
    text_index._write_status(app.config, {"state": "running", "started": now, "heartbeat": now, "done": done, "total": total,
                                          "read": done, "reused": 0, "errors": 0, "built_at": None})


def test_while_the_crawl_runs_the_reply_says_the_names_are_being_indexed(tmp_path):
    app = make_app(tmp_path)
    running(app, 0, 5)
    carol, bob = client(app, "carol"), client(app, "bob")
    body = carol.get(SEARCH, query_string={"q": "donor_id"}).get_json()
    assert body["results"] == [] and body["index"]["names"] == {"state": "building", "read": 0, "total": 5}
    access.add_grant(app.config, "bob", "store", f"{app.data}/liver.zarr", actor="alice")
    access.set_restricted(app.config, "bob", True)
    assert bob.get(SEARCH, query_string={"q": "donor_id"}).get_json()["index"]["names"] == {"state": "building"}


def test_a_finished_crawl_has_no_building_marker(tmp_path):
    app = make_app(tmp_path)
    crawl(app)
    assert "names" not in client(app, "carol").get(SEARCH, query_string={"q": "liver"}).get_json()["index"]


def shape(value):
    if isinstance(value, dict):
        return {k: shape(v) for k, v in value.items()}
    if isinstance(value, list):
        return [shape(value[0])] if value else []
    return "bool" if isinstance(value, bool) else "number" if isinstance(value, (int, float)) else type(value).__name__


def test_the_reply_has_exactly_the_shape_of_the_fixture(tmp_path):
    app = make_app(tmp_path)
    path = f"{app.data}/liver.zarr"
    add_names(path, obs=["donor_id", "donor_sex"], uns=["donor_metadata/age"])
    annotate(path, {"title": "Liver atlas", "description": "Cells from twelve donors."})
    crawl(app)
    index = text_index.load(app.config)
    text_index.write_index(app.config, index.entries, index.built_at, complete=False)   # a crawl under way: not complete
    running(app, 3, 5)
    text_index._loaded.clear()
    body = client(app, "carol").get(SEARCH, query_string={"q": "donor"}).get_json()
    with open(REPLY) as fh:
        fixture = json.load(fh)
    assert shape(body) == shape(fixture)
    assert shape(body["results"][0]["fields"]) == shape(fixture["results"][0]["fields"])
    assert body["results"][0]["fields"][0]["kind"] == "obs" and body["results"][0]["matched"][0] == "description"
    assert body["index"]["names"]["state"] == "building" == fixture["index"]["names"]["state"]


def test_the_fixture_follows_the_contract_of_the_plan():
    with open(REPLY) as fh:
        fixture = json.load(fh)
    row = fixture["results"][0]
    kinds = {"obs", "var", "obsm", "varm", "layers", "obsp", "varp", "uns"}
    assert set(row["matched"]) - kinds <= {"description"} and all(f["kind"] in kinds for f in row["fields"])
    assert all(set(f) == {"kind", "names", "more", "cut"} and len(f["names"]) <= 5 for f in row["fields"])


# --- budgets and their scaling tests -------------------------------------------------------------------------------------

def synthetic_index(n):
    """``n`` entries as a crawl would leave them: a title, a short README and names of every kind."""
    loaded = text_index.Loaded({"complete": True})
    for i in range(n):
        names = {"obs": "\n".join(f"col_{i}_{j}" for j in range(20)), "var": "gene_symbol\nhighly_variable",
                 "layers": "counts\nlogged", "obsm": "X_umap\nX_pca", "uns": "\n".join(f"key{j}/sub" for j in range(10))}
        loaded.add({"path": f"/d/s{i}.zarr", "real": f"/d/s{i}.zarr", "name": f"s{i}.zarr", "rel_path": f"s{i}.zarr",
                    "h5ad": False, "about": {"title": f"Atlas {i}", "description": "Cells of a tissue"},
                    "readme": "word " * 50, "names": names, "names_cut": [], "error": None})
    return loaded


def best_of(fn, runs=5):
    times = []
    for _ in range(runs):
        began = time.process_time()          # CPU time: a busy machine does not move it
        fn()
        times.append(time.process_time() - began)
    return min(times)


def test_a_search_over_twenty_thousand_entries_ends_inside_its_time_limit():
    # The limit is SEARCH_SECONDS of work. Whether a search "ends inside" it cannot be read off one wall-clock run
    # with the limit itself as the cutoff: a busy machine stops the search midway and reports it partial for
    # reasons that are its own. So the searches run with room to finish (they must find what they find), and the
    # time they take is the CPU seconds of the quickest of five runs, which load does not move, against the limit.
    loaded = synthetic_index(20_000)
    first = lambda: text_index.search(loaded, ["donor", "counts"], lambda e: True, seconds=60)
    second = lambda: text_index.search(loaded, ["highly_variable"], lambda e: True, seconds=60)
    hits, more, partial = first()
    assert partial is False and hits == []
    hits, more, partial = second()
    assert partial is False and len(hits) == 50 and more == 20_000 - 50
    assert best_of(first, 5) < text_index.SEARCH_SECONDS
    assert best_of(second, 5) < text_index.SEARCH_SECONDS


def test_a_search_grows_with_the_size_of_the_index_and_no_faster_than_fifteen_to_one_for_ten_times_the_entries():
    small, big = synthetic_index(3_000), synthetic_index(30_000)
    run = lambda loaded: text_index.search(loaded, ["donor", "counts"], lambda e: True, seconds=60)
    assert best_of(lambda: run(big), 7) <= 15 * best_of(lambda: run(small), 7)


def test_reading_the_names_of_stores_grows_linearly(tmp_path):
    def build(n):
        folder = tmp_path / f"n{n}"
        folder.mkdir()
        for i in range(n):
            shutil.copytree(FIXTURE, folder / f"s{i}.zarr")
        return [str(p) for p in sorted(folder.iterdir())]
    small, big = build(10), build(100)
    assert best_of(lambda: [text_index.read_names(p) for p in big], 3) <= 15 * best_of(lambda: [text_index.read_names(p) for p in small], 3)
    names, cut = text_index.read_names(big[0])
    assert sorted(names["obs"].split("\n")) == ["cell_type", "leiden", "total_counts"] and cut == []


# --- the names are read under the crawl's per-store timeout, its heartbeat and its deadline (FX-T) ---------

def _slow_names(monkeypatch, pause=0.0, hang=(), release=None):
    real = text_index.read_names

    def read(path, trust_listing=False):
        if path.endswith(tuple(hang)):
            release.wait(10)
        elif pause:
            time.sleep(pause)
        return real(path, trust_listing=trust_listing)
    monkeypatch.setattr(text_index, "read_names", read)


def test_a_store_whose_names_hang_is_skipped_as_a_timeout_and_the_crawl_finishes(bare_app, monkeypatch):
    new_store(bare_app.data, "a.zarr", obs=["alpha_col"])
    new_store(bare_app.data, "b.zarr", obs=["beta_col"])
    bare_app.config["text_index_store_timeout_s"] = 0.3
    release = threading.Event()
    _slow_names(monkeypatch, hang=("a.zarr",), release=release)
    try:
        started = time.monotonic()
        status = crawl(bare_app)
        assert time.monotonic() - started < 5
    finally:
        release.set()
    assert status["state"] == "done" and status["errors"] == 1 and status["done"] == 2
    assert entries(bare_app)["a.zarr"]["error"] == "timeout"
    assert found(bare_app, "beta_col") == ["b.zarr"]


def test_a_store_with_text_whose_names_hang_is_skipped_as_a_timeout_too(bare_app, monkeypatch):
    path = new_store(bare_app.data, "a.zarr", obs=["alpha_col"])
    annotate(path, {"title": "Has text"}, "some readme")
    bare_app.config["text_index_store_timeout_s"] = 0.3
    release = threading.Event()
    _slow_names(monkeypatch, hang=("a.zarr",), release=release)
    try:
        started = time.monotonic()
        status = crawl(bare_app)
        assert time.monotonic() - started < 5
    finally:
        release.set()
    assert status["state"] == "done" and entries(bare_app)["a.zarr"]["error"] == "timeout"


def test_the_crawl_beats_while_it_reads_the_names_of_many_bare_stores(bare_app, monkeypatch):
    for i in range(6):
        new_store(bare_app.data, f"s{i}.zarr", obs=[f"col_{i}"])
    bare_app.config["text_index_workers"] = 1
    monkeypatch.setattr(text_index, "HEARTBEAT_EVERY_S", 0.1)
    _slow_names(monkeypatch, pause=0.15)
    beats = []
    real = text_index._write_status
    monkeypatch.setattr(text_index, "_write_status", lambda config, status: (beats.append(time.monotonic()), real(config, status))[1])
    started = time.monotonic()
    assert crawl(bare_app)["state"] == "done"
    ended = time.monotonic()
    assert ended - started > 0.8, "the names were read slowly"
    marks = [started, *beats[:-1], ended]            # the last write is the finished status
    assert max(b - a for a, b in zip(marks, marks[1:])) < 0.5, "no heartbeat for a long stretch of bare stores"


def test_a_crawl_that_runs_out_of_time_among_bare_stores_is_partial(bare_app, monkeypatch):
    for i in range(6):
        new_store(bare_app.data, f"s{i}.zarr", obs=[f"col_{i}"])
    bare_app.config["text_index_workers"] = 1
    monkeypatch.setattr(text_index, "CRAWL_SECONDS", 0.3)
    _slow_names(monkeypatch, pause=0.2)
    status = crawl(bare_app)
    assert status["state"] == "partial"
    assert text_index.load(bare_app.config).partial is True
