"""A regular-expression name search cannot hold a worker.

``re`` cannot be interrupted and holds the GIL while it matches, so one
pattern like ``(\\w+\\w*)+-x`` against cell names such as AAACCTGAGAAACCAT-1
(a quarter of a second for ONE name, twice as long per extra character)
stopped every thread of the worker it landed on, for any user, or anonymously
when login is off. Such patterns are refused before anything is read, and a
scan that is merely long answers with what it found when its time is up.
"""
import os
import shutil
import time

import pytest

from annzarro.core import name_index
from annzarro.core.name_index import NameIndex, RegexRefusedError, check_regex
from annzarro.server.core import create_app

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr")

EVIL = [r"(a+)+$", r"(\w+\w*)+-x", r"(a|ab)*c", r"((a*)*)b", r"(.*a){2,}x", r"(?:\d+|x)+y"]
FINE = [r"^MT-", r"_\d{2}$", r"ab+c", r"^(MT-|RP[SL])", r"(?:CD)\d+", r"[A-Z]{3}\d+-1$",
        r"(\d{2}-){2}", r"^.*foo.*bar$", r"GAPDH|ACTB"]


@pytest.fixture(autouse=True)
def _defaults():
    name_index.configure()
    yield
    name_index.configure()


@pytest.mark.parametrize("pattern", EVIL)
def test_a_pattern_with_a_nested_repeat_is_refused(pattern):
    with pytest.raises(RegexRefusedError) as exc:
        check_regex(pattern)
    assert exc.value.reason == "regex_too_complex"


@pytest.mark.parametrize("pattern", FINE)
def test_ordinary_patterns_pass(pattern):
    check_regex(pattern)


def test_too_many_open_ended_repeats_and_too_long_a_pattern_are_refused():
    with pytest.raises(RegexRefusedError) as exc:
        check_regex(".*a.*b.*c.*d.*e")
    assert exc.value.reason == "regex_too_complex"
    with pytest.raises(RegexRefusedError) as exc:
        check_regex("a" * 201)
    assert exc.value.reason == "regex_too_long"
    name_index.configure(max_regex_chars=300)
    check_regex("a" * 201)


def test_a_pattern_that_does_not_compile_is_left_to_re():
    check_regex("(")
    with pytest.raises(Exception, match="missing"):
        NameIndex(["a"]).search("(", mode="regex")


def test_the_index_does_not_run_a_refused_pattern():
    ix = NameIndex(["AAACCTGAGAAACCAT-1"] * 3)
    started = time.monotonic()
    with pytest.raises(RegexRefusedError):
        ix.search(r"(\w+\w*)+-x", mode="regex")
    assert time.monotonic() - started < 0.5


def test_a_scan_out_of_time_answers_with_what_it_found():
    names = [f"cell_{i:07d}" for i in range(400_000)]
    ix = NameIndex(names)
    name_index.configure(timeout_s=0.02)
    out = ix.search(r"^cell_\d+_nomatch$", mode="regex", limit=500)
    assert out["partial"] and out["timed_out"]
    assert out["scanned"] < len(names)
    assert "name_search_timeout_s" in out["note"]
    assert out["matches"] == []
    name_index.configure(timeout_s=0)
    full = ix.search(r"^cell_\d+_nomatch$", mode="regex", limit=500)
    assert "timed_out" not in full


def test_a_streamed_scan_out_of_time_says_so():
    chunks = [[f"cell_{i:07d}" for i in range(a, a + 50_000)] for a in range(0, 400_000, 50_000)]

    def factory():
        return iter(chunks)

    src = name_index.NameChunks(chunks, n=400_000, factory=factory)
    name_index.configure(timeout_s=0.02)
    out = name_index.stream_search(src, r"^cell_\d+_nomatch$", limit=500, mode="regex")
    assert out["partial"] and out["timed_out"] and out["scanned"] < 400_000


@pytest.fixture
def client_and_store(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    store = data_dir / "a.zarr"
    shutil.copytree(FIXTURE, store)
    name_index.clear()
    app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False,
                      "data_dir": str(data_dir), "cache_enabled": False})
    return app.test_client(), str(store)


def test_the_route_refuses_a_pattern_before_reading_anything(client_and_store):
    client, store = client_and_store
    for pattern, reason in ((r"(\w+\w*)+-x", "regex_too_complex"), ("a" * 300, "regex_too_long")):
        reply = client.get("/api/v1/data/names", query_string={
            "dataset_path": store, "entity": "cells", "q": pattern, "mode": "regex"})
        assert reply.status_code == 400, reply.get_json()
        assert reply.get_json()["reason"] == reason
        assert reply.get_json()["error"]
    reply = client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "entity": "cells", "q": "(", "mode": "regex"})
    assert reply.status_code == 400 and reply.get_json()["reason"] == "bad_regex"


def test_the_route_still_answers_an_ordinary_pattern(client_and_store):
    client, store = client_and_store
    reply = client.get("/api/v1/data/names", query_string={
        "dataset_path": store, "entity": "cells", "q": r"^cell_\d+$", "mode": "regex"})
    assert reply.status_code == 200 and reply.get_json()["matches"]
