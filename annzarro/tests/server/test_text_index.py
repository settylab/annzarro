"""The text index (annzarro/server/text_index.py): the crawl, its lock, the file, and the matcher.

A crawl reads the attribution and the start of the README of every local store the server lists,
reads again only what changed, gives up on a store that does not answer, and writes one gzipped
file atomically that every worker loads when its stamp moves.
"""
import gzip
import json
import multiprocessing
import os
import shutil
import threading
import time

import pytest

from annzarro.core import dataset_annotate
from annzarro.server import atomic_store, text_index
from annzarro.server.core import create_app
from annzarro.server.routes import data_routes

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
FIXTURE = os.path.join(DATA, "fixture_small.zarr")

LIVER = {"title": "Liver atlas", "description": "Cells of the adult liver.", "authors": ["Jane Doe", "Zoë Müller"],
         "license": "CC-BY-4.0", "funding": ["NIH R01 grant"], "contact": "jane@example.org"}
LIVER_README = "# Liver atlas\n\nSee [the paper](https://example.org/secret-target) and **hepatocytes**.\n"


def config_for(tmp_path, **extra):
    config = {"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"), "log_file": str(tmp_path / "t.log"),
              "user_file": str(tmp_path / "users.json"), "secret_key": "test-only-secret", "text_index_min_interval_s": 0}
    config.update(extra)
    return config


def annotate(store, fields, readme=None):
    dataset_annotate.annotate_store(str(store), fields, readme)


def make_world(tmp_path):
    """data/{plain.zarr, liver.zarr, out.zarr, sub/heart.zarr, broken.zarr (empty)}."""
    data = tmp_path / "data"
    (data / "sub").mkdir(parents=True)
    for rel in ("plain.zarr", "liver.zarr", "out.zarr", "sub/heart.zarr"):
        shutil.copytree(FIXTURE, data / rel)
    (data / "broken.zarr").mkdir()
    annotate(data / "liver.zarr", LIVER, LIVER_README)
    annotate(data / "out.zarr", {"title": "Secret kidney"}, "kidneysecret lives here")
    annotate(data / "sub" / "heart.zarr", {"title": "Heart", "description": "Cardiomyocytes of the heart."},
             "# Heart\n\nA cardiomyocyte atlas.\n")
    return data


@pytest.fixture(autouse=True)
def fresh_caches():
    data_routes._LISTING_PROBE_CACHE.clear()
    text_index._loaded.clear()
    yield
    data_routes._LISTING_PROBE_CACHE.clear()
    text_index._loaded.clear()


@pytest.fixture
def world(tmp_path):
    make_world(tmp_path)
    app = create_app(config_for(tmp_path))
    app.data = str(tmp_path / "data")
    return app


def crawl(app):
    with app.test_request_context("/"):
        return text_index.crawl(app.config)


def entries(app):
    return {e["name"]: e for e in text_index.load(app.config).entries}


def wait_idle(app, seconds=30):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if text_index.describe(app.config)["state"] != "running":
            return
        time.sleep(0.05)
    raise AssertionError("the crawl did not finish")


# --- what a crawl reads --------------------------------------------------------------------------------

def test_the_crawl_reads_attribution_and_readme_of_every_local_store(world):
    status = crawl(world)
    assert status["state"] == "done" and status["total"] == 5 and status["errors"] == 1
    found = entries(world)
    assert sorted(found) == ["broken.zarr", "heart.zarr", "liver.zarr", "out.zarr", "plain.zarr"]
    liver = found["liver.zarr"]
    assert liver["about"]["title"] == "Liver atlas" and liver["about"]["authors"] == "Jane Doe; Zoë Müller"
    assert liver["about"]["funding"] == "NIH R01 grant" and liver["about"]["contacts"] == "jane@example.org"
    assert "license" in liver["about"] and "doi_url" not in liver["about"]
    assert found["heart.zarr"]["rel_path"] == os.path.join("sub", "heart.zarr")
    assert found["plain.zarr"]["about"] == {} and found["plain.zarr"]["readme"] == "" and found["plain.zarr"]["error"] is None


def test_the_readme_is_stored_as_prose_without_link_targets_or_markup(world):
    crawl(world)
    readme = entries(world)["liver.zarr"]["readme"]
    assert readme == "Liver atlas See the paper and hepatocytes."
    assert "secret-target" not in readme and readme_cut(world, "liver.zarr") is False


def readme_cut(app, name):
    return entries(app)[name]["readme_cut"]


def test_the_readme_is_cut_at_the_configured_size(tmp_path):
    data = make_world(tmp_path)
    annotate(data / "plain.zarr", {"title": "Long"}, "word " * 2000 + "tail")
    app = create_app(config_for(tmp_path, text_index_readme_kb=1))
    crawl(app)
    found = entries(app)["plain.zarr"]
    assert len(found["readme"].encode()) <= 1024 and found["readme_cut"] is True
    assert "tail" not in found["readme"]


def test_a_store_that_cannot_be_read_is_listed_by_name_with_an_error(world):
    crawl(world)
    broken = entries(world)["broken.zarr"]
    assert broken["error"] == "unreadable" and broken["about"] == {} and broken["readme"] == ""


def test_remote_stores_are_not_enumerated(world, monkeypatch):
    seen = []
    monkeypatch.setattr(text_index, "read_text", lambda path, n: seen.append(path) or ({}, "", False))
    crawl(world)
    assert seen and not any("://" in path for path in seen)


def test_a_store_below_a_link_into_a_denied_place_is_not_followed_out(tmp_path):
    data = make_world(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    shutil.copytree(FIXTURE, outside / "far.zarr")
    os.symlink(outside, data / "linkdir")
    app = create_app(config_for(tmp_path, host="0.0.0.0"))      # a shared server refuses links leading out
    crawl(app)
    assert "far.zarr" not in entries(app)


# --- incremental ------------------------------------------------------------------------------------------

def test_an_unchanged_store_is_not_read_again_and_a_changed_one_is(world, monkeypatch):
    crawl(world)
    reads = []
    real = text_index.read_text
    monkeypatch.setattr(text_index, "read_text", lambda path, n: reads.append(os.path.basename(path)) or real(path, n))
    status = crawl(world)
    assert reads == [] and status["reused"] == 5 and status["read"] == 0
    time.sleep(0.01)
    annotate(f"{world.data}/liver.zarr", {**LIVER, "title": "Liver atlas v2"}, "new readme")
    status = crawl(world)
    assert reads == ["liver.zarr"] and status["read"] == 1
    assert entries(world)["liver.zarr"]["about"]["title"] == "Liver atlas v2"
    assert entries(world)["liver.zarr"]["readme"] == "new readme"


def test_a_vanished_store_is_dropped(world):
    crawl(world)
    shutil.rmtree(f"{world.data}/out.zarr")
    crawl(world)
    assert "out.zarr" not in entries(world)


def test_a_store_that_sleeps_past_the_timeout_is_marked_and_the_crawl_finishes(world, monkeypatch):
    world.config["text_index_store_timeout_s"] = 0.3
    release = threading.Event()
    real = text_index.read_text

    def slow(path, n):
        if path.endswith("heart.zarr"):
            release.wait(10)
        return real(path, n)
    monkeypatch.setattr(text_index, "read_text", slow)
    try:
        started = time.monotonic()
        status = crawl(world)
        assert time.monotonic() - started < 5
    finally:
        release.set()
    assert status["state"] == "done" and entries(world)["heart.zarr"]["error"] == "timeout"
    assert entries(world)["liver.zarr"]["about"]["title"] == "Liver atlas"


def test_the_crawl_stops_as_partial_when_every_thread_is_stuck(world, monkeypatch):
    world.config.update(text_index_store_timeout_s=0.2, text_index_workers=1)
    release = threading.Event()
    real = text_index.read_text

    def stuck(path, n):
        if path.endswith("liver.zarr"):
            release.wait(10)
        return real(path, n)
    monkeypatch.setattr(text_index, "read_text", stuck)
    try:
        status = crawl(world)
    finally:
        release.set()
    assert status["state"] == "partial"
    assert entries(world)["liver.zarr"]["error"] == "timeout"


def test_a_crawl_past_its_time_is_partial_and_keeps_what_it_has(world):
    crawl(world)
    world.config["text_index_crawl_timeout_s"] = 0.0001
    shutil.rmtree(f"{world.data}/out.zarr")                    # a change the cut-off crawl cannot have processed
    os.utime(f"{world.data}/liver.zarr/uns/annzarro", None)
    status = crawl(world)
    assert status["state"] == "partial"
    assert "liver.zarr" in entries(world)


def test_more_stores_than_the_limit_are_capped_and_the_index_is_kept_and_served(world):
    world.config["text_index_max_stores"] = 2
    status = crawl(world)
    assert status["state"] == "done" and status["capped"] is True and len(entries(world)) == 2
    loaded = text_index.load(world.config)
    assert loaded.stores_capped is True and loaded.partial is False and loaded.capped is False
    assert text_index.describe(world.config)["stale"] is False        # a cap is not a reason to crawl again
    assert find(loaded, "zarr")[0], "the capped index answers"
    crawl(world)                                                    # again: still two, no growth past the cap
    assert len(entries(world)) == 2


def test_the_size_cap_is_a_flag_never_an_error(world):
    world.config["text_index_max_mb"] = 0.0001
    status = crawl(world)
    assert status["state"] == "done" and status["capped"] is True and status["errors"] == 1      # only the broken store
    loaded = text_index.load(world.config)
    assert loaded.capped is True and loaded.stores_capped is False and len(loaded) == 5
    assert all(e["readme"] == "" for e in loaded.entries)
    assert find(loaded, "liver")[0] == ["liver.zarr"]               # attribution is still searched


def test_a_crawl_cut_by_its_time_is_kept_and_the_next_one_continues_from_it(world, monkeypatch):
    reads = []
    real = text_index.read_text
    clock = {"slow": True}

    def read(path, n):
        reads.append(os.path.basename(path))
        if clock["slow"]:
            time.sleep(0.4)
        return real(path, n)
    monkeypatch.setattr(text_index, "read_text", read)
    world.config.update(text_index_workers=1, text_index_crawl_timeout_s=1.0)
    first = crawl(world)
    assert first["state"] == "partial"
    done = len(entries(world))
    assert 0 < done < 5
    loaded = text_index.load(world.config)
    assert loaded.partial is True and text_index.describe(world.config)["stale"] is True      # a search continues it
    clock["slow"] = False
    reads.clear()
    second = crawl(world)
    assert second["state"] == "done" and second["reused"] == done and len(reads) == 5 - done
    assert len(entries(world)) == 5 and text_index.load(world.config).partial is False


def test_the_index_size_cap_drops_the_largest_readmes(tmp_path):
    data = make_world(tmp_path)
    annotate(data / "plain.zarr", {"title": "Big"}, "lorem " * 30000)
    app = create_app(config_for(tmp_path, text_index_readme_kb=64))
    app.config["text_index_max_mb"] = 0.01          # below the validated minimum, to make the cap bite on a small store
    status = crawl(app)
    assert status["capped"] is True
    found = entries(app)
    assert found["plain.zarr"]["readme"] == "" and found["plain.zarr"]["readme_cut"] is True
    assert found["plain.zarr"]["about"]["title"] == "Big"
    assert text_index.load(app.config).capped is True


# --- the lock, the status, the file ----------------------------------------------------------------------

def test_a_second_crawler_does_not_start_while_the_first_holds_the_lock(world):
    release = text_index._try_lock(world.config)
    assert release is not None
    assert text_index._try_lock(world.config) is None
    assert text_index.start_crawl(world, force=True) is False
    release()
    again = text_index._try_lock(world.config)
    assert again is not None
    again()


def _child_tries_lock(settings, queue):
    app = create_app(settings)
    queue.put(text_index._try_lock(app.config) is not None)


@pytest.mark.skipif(text_index.fcntl is None, reason="the cross-process lock needs flock")
def test_a_crawler_in_another_process_does_not_start_either(tmp_path):
    make_world(tmp_path)
    settings = config_for(tmp_path)
    app = create_app(settings)
    release = text_index._try_lock(app.config)
    try:
        context = multiprocessing.get_context("spawn")
        queue = context.Queue()
        child = context.Process(target=_child_tries_lock, args=(settings, queue))
        child.start()
        got = queue.get(timeout=60)
        child.join(10)
        assert got is False
    finally:
        release()


def test_start_crawl_runs_in_the_background_and_finishes(world):
    assert text_index.start_crawl(world) is True
    wait_idle(world)
    view = text_index.describe(world.config)
    assert view["state"] == "done" and view["stale"] is False and view["built_at"] and len(view["index"]) == 5
    assert text_index.start_crawl(world) is False        # fresh: nothing to do
    assert text_index._try_lock(world.config) is not None


def test_a_crawl_whose_crawler_died_is_failed_and_may_be_started_again(world, monkeypatch):
    text_index._write_status(world.config, {"state": "running", "started": time.time() - 100, "heartbeat": time.time() - 100,
                                            "done": 1, "total": 5})
    assert text_index.read_status(world.config)["state"] == "failed"
    assert text_index.start_crawl(world) is True
    wait_idle(world)
    assert text_index.describe(world.config)["state"] == "done"


def test_a_running_crawl_with_a_fresh_heartbeat_is_left_alone(world):
    text_index._write_status(world.config, {"state": "running", "started": time.time(), "heartbeat": time.time(),
                                            "done": 1, "total": 5})
    assert text_index.start_crawl(world, force=True) is False


def test_a_crawl_starts_at_most_once_per_interval(tmp_path):
    make_world(tmp_path)
    app = create_app(config_for(tmp_path, text_index_min_interval_s=60))
    assert text_index.start_crawl(app, force=True) is True
    wait_idle(app)
    assert text_index.start_crawl(app, force=True) is False


def test_the_index_file_is_gzipped_json_and_leaves_no_temporary_file(world):
    crawl(world)
    directory = text_index.index_dir(world.config)
    with gzip.open(directory / "index.json.gz", "rb") as fh:
        body = json.loads(fh.read())
    assert body["version"] == 1 and body["complete"] is True and len(body["entries"]) == 5
    assert sorted(p.name for p in directory.iterdir() if p.name.endswith(".tmp")) == []
    from annzarro.utils import paths
    assert str(directory).startswith(str(paths.cache_dir()))


def test_a_worker_loads_the_new_file_when_its_stamp_moves(world):
    crawl(world)
    first = text_index.load(world.config)
    assert text_index.load(world.config) is first              # same stamp: no re-read
    shutil.rmtree(f"{world.data}/out.zarr")
    crawl(world)
    second = text_index.load(world.config)
    assert second is not first and len(second) == 4


def test_a_reader_never_sees_a_half_written_index(world):
    crawl(world)
    config = world.config
    body = entries(world)
    stop = threading.Event()
    problems = []

    def writer():
        while not stop.is_set():
            text_index.write_index(config, list(text_index.load(config).entries), time.time(), True)

    thread = threading.Thread(target=writer)
    thread.start()
    try:
        for _ in range(200):
            loaded = text_index.load(config)
            if loaded is None or len(loaded) != len(body):
                problems.append(loaded)
    finally:
        stop.set()
        thread.join()
    assert problems == []


def test_a_corrupt_index_file_is_no_index_and_is_rebuilt(world):
    crawl(world)
    path = text_index.index_dir(world.config) / "index.json.gz"
    path.write_bytes(b"not gzip")
    text_index._loaded.clear()
    assert text_index.load(world.config) is None
    assert text_index.start_crawl(world, force=True) is True
    wait_idle(world)
    assert len(text_index.load(world.config)) == 5


def test_another_data_directory_never_meets_this_ones_index(tmp_path):
    make_world(tmp_path)
    first = create_app(config_for(tmp_path))
    crawl(first)
    other = tmp_path / "other"
    other.mkdir()
    second = create_app(config_for(tmp_path, data_dir=str(other)))
    assert text_index.index_dir(first.config) != text_index.index_dir(second.config)
    assert text_index.load(second.config) is None


def test_clear_cache_marks_the_index_stale_without_deleting_it(world):
    crawl(world)
    assert text_index.describe(world.config)["stale"] is False
    time.sleep(0.02)
    with world.app_context():
        from annzarro.server import cache_reset
        cache_reset.reset_all()
    view = text_index.describe(world.config)
    assert view["stale"] is True and len(view["index"]) == 5


def test_an_old_index_is_stale_and_a_search_refreshes_it(world, monkeypatch):
    crawl(world)
    real = time.time
    monkeypatch.setattr(text_index, "_now", lambda: real() + 700)
    assert text_index.describe(world.config)["stale"] is True
    assert text_index.start_crawl(world) is True
    wait_idle(world)


# --- the matcher -----------------------------------------------------------------------------------------

@pytest.fixture
def loaded(world):
    crawl(world)
    return text_index.load(world.config)


def find(loaded, query, readable=lambda e: True, **kw):
    hits, partial = text_index.search(loaded, text_index.parse_query(query), readable, **kw)
    return [h["entry"]["name"] for h in hits], hits, partial


def test_every_term_must_match_in_some_field(loaded):
    assert find(loaded, "liver jane")[0] == ["liver.zarr"]
    assert find(loaded, "liver kidney")[0] == []
    assert find(loaded, "atlas")[0] == ["liver.zarr", "heart.zarr"] or set(find(loaded, "atlas")[0]) == {"liver.zarr", "heart.zarr"}


def test_a_quoted_phrase_keeps_its_words_together(loaded):
    assert find(loaded, '"adult liver"')[0] == ["liver.zarr"]
    assert find(loaded, '"liver adult"')[0] == []


def test_case_and_accents_do_not_matter(loaded):
    assert find(loaded, "ZOE muller")[0] == ["liver.zarr"]
    assert find(loaded, "Zoë MÜLLER")[0] == ["liver.zarr"]


def test_a_title_outweighs_a_readme_and_a_word_start_outweighs_the_middle(loaded):
    names, hits, _ = find(loaded, "heart")
    assert names[0] == "heart.zarr"                     # name, title, description and README
    names, hits, _ = find(loaded, "cardio")
    assert names == ["heart.zarr"] and hits[0]["matched"] == ["description", "readme"]
    start = text_index._score({"title": "heart rate"}, ["heart"])[0]
    middle = text_index._score({"title": "the apheartic"}, ["heart"])[0]
    assert start == 12 and middle == 8


def test_the_snippet_comes_from_the_best_text_field_with_highlight_offsets(loaded):
    _, hits, _ = find(loaded, "hepatocytes")
    snippet = hits[0]["snippet"]
    assert snippet["field"] == "readme" and snippet["text"] == "Liver atlas See the paper and hepatocytes."
    start, end = snippet["highlights"][0]
    assert snippet["text"][start:end] == "hepatocytes"


def test_offsets_count_utf16_units_so_javascript_can_slice_with_them():
    text = "\U0001f9ec genomes of Zoë Müller ß-cells"
    snippet = text_index._snippet(text, text_index.fold(text), ["muller"], "authors")
    (start, end), = snippet["highlights"]
    utf16 = snippet["text"].encode("utf-16-le")
    assert utf16[start * 2:end * 2].decode("utf-16-le") == "Müller"
    snippet = text_index._snippet(text, text_index.fold(text), ["cells"], "authors")
    (start, end), = snippet["highlights"]
    assert snippet["text"].encode("utf-16-le")[start * 2:end * 2].decode("utf-16-le") == "cells"


def test_a_long_text_is_cut_to_a_window_around_the_hit_with_ellipses():
    text = ("filler " * 300) + "needle" + (" more" * 300)
    snippet = text_index._snippet(text, text_index.fold(text), ["needle"], "readme")
    assert len(snippet["text"]) <= text_index.SNIPPET_CHARS + 2
    assert snippet["text"].startswith("…") and snippet["text"].endswith("…")
    (start, end), = snippet["highlights"]
    assert snippet["text"][start:end] == "needle"


def test_a_hit_where_folding_changes_the_length_is_still_found():
    text = ("Straße " * 400) + "needle here"
    snippet = text_index._snippet(text, text_index.fold(text), ["needle"], "readme")
    (start, end), = snippet["highlights"]
    assert snippet["text"][start:end] == "needle"


def test_the_query_has_caps_and_no_regex():
    with pytest.raises(text_index.SearchRefused) as caught:
        text_index.parse_query("x" * 201)
    assert caught.value.reason == "query_too_long"
    with pytest.raises(text_index.SearchRefused) as caught:
        text_index.parse_query("a b c d e f g h i")
    assert caught.value.reason == "too_many_terms"
    assert text_index.parse_query('  "Two  Words"  Café ') == ["two words", "cafe"]
    assert text_index.parse_query('""  ') == []


def test_a_search_past_its_time_is_partial(loaded):
    names, _, partial = find(loaded, "liver", seconds=-1)
    assert partial is True and names == []


def test_the_limit_and_the_readable_filter_apply_after_the_lookup(loaded):
    assert find(loaded, "zarr", limit=2)[0] == find(loaded, "zarr")[0][:2]
    names, _, _ = find(loaded, "atlas", readable=lambda e: e["name"] != "liver.zarr")
    assert "liver.zarr" not in names and "heart.zarr" in names


def test_the_folder_limits_the_search_to_the_stores_below_it(loaded, world):
    names, _, _ = find(loaded, "heart", folder=os.path.realpath(f"{world.data}/sub"))
    assert names == ["heart.zarr"]
    assert find(loaded, "heart", folder=os.path.realpath(f"{world.data}/nodir"))[0] == []
