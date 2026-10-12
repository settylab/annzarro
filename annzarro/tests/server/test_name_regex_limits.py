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


def test_a_slow_pattern_that_passes_the_check_stops_at_the_limit_on_a_big_index():
    """Four open-ended repeats pass the complexity check and cost a polynomial
    of the name's length per name; over a million names that is tens of seconds.
    The clock is read every 256 names, so the scan ends within the limit plus
    256 names' work."""
    import random
    import time
    rng = random.Random(1)
    names = ["".join(rng.choice("ACGT") for _ in range(16)) + "-1" for _ in range(300_000)]
    ix = NameIndex(names)
    name_index.configure(timeout_s=0.5)
    started = time.monotonic()
    out = ix.search(r".*.*.*.*Z", mode="regex")
    elapsed = time.monotonic() - started
    assert out["timed_out"] and out["scanned"] < len(names)
    assert elapsed < 1.5, elapsed


# --- the guarantee: a single match is bounded, whatever the pattern -------------------------------
#
# check_regex is a cheap first filter and a list of refused shapes is never complete (an independent
# review found `.?` x33 + `!`, which it accepted and which hung the stdlib `re` for more than 200 s on
# ONE 18-character name). Every match now runs under the scan's deadline with the `regex` package,
# which stops inside the match.

REVIEW_PATTERNS = [".?" * 28 + "!", ".?" * 33 + "!", ".{0,99}" * 14 + "!", "(?:|.)" * 28 + "!"]
BARCODE = "AAACCTGAGAAACCAT-1"


@pytest.mark.parametrize("pattern", REVIEW_PATTERNS)
def test_the_reviewed_patterns_return_within_the_limit(pattern):
    import time
    ix = NameIndex([BARCODE] * 200)
    name_index.configure(timeout_s=2)
    started = time.monotonic()
    out = ix.search(pattern, mode="regex")
    assert time.monotonic() - started < 4, "a pattern held the search past its limit"
    assert out["matches"] == []


def test_a_match_is_interrupted_inside_even_when_the_filter_lets_the_pattern_through(monkeypatch):
    """Take the filter away: (a|a)*b is exponential on 'a' x35 + 'cb'. The per-match
    timeout still ends the scan at its limit, and other threads keep running meanwhile."""
    import threading
    import time
    monkeypatch.setattr(name_index, "check_regex", lambda pattern: None)
    ix = NameIndex(["a" * 35 + "cb"] * 3)
    name_index.configure(timeout_s=0.5)
    latencies, stop = [], threading.Event()

    def probe():
        while not stop.is_set():
            t = time.perf_counter()
            time.sleep(0.01)
            latencies.append(time.perf_counter() - t)

    thread = threading.Thread(target=probe)
    thread.start()
    started = time.monotonic()
    try:
        out = ix.search(r"(a|a)*b", mode="regex")
    finally:
        stop.set()
        thread.join()
    elapsed = time.monotonic() - started
    assert out["timed_out"] and out["partial"] and out["matches"] == []
    assert 0.4 < elapsed < 1.5, elapsed
    assert max(latencies) < 0.25, f"the match held the GIL for {max(latencies):.2f} s"


def test_the_streamed_scan_is_interrupted_inside_a_match_too(monkeypatch):
    monkeypatch.setattr(name_index, "check_regex", lambda pattern: None)
    chunks = [["a" * 35 + "cb"] * 2]
    src = name_index.NameChunks(chunks, n=2, factory=lambda: iter(chunks))
    name_index.configure(timeout_s=0.5)
    out = name_index.stream_search(src, r"(a|a)*b", limit=5, mode="regex")
    assert out["timed_out"] and out["partial"]


def test_without_the_regex_package_regex_search_is_refused_not_unguarded(monkeypatch):
    monkeypatch.setattr(name_index, "_regex", None)
    with pytest.raises(RegexRefusedError) as exc:
        NameIndex(["a"]).search(".?.?.?!", mode="regex")
    assert exc.value.reason == "regex_unavailable"
    assert NameIndex(["a", "b"]).search("^a$", mode="regex")["matches"][0]["name"] == "a", \
        "a pattern the quick engine proves cheap needs no regex package"


# --- two engines: re for patterns proven cheap, regex (timeout inside the match) for the rest -------

NORMAL = [r"^MT-", r"_\d{2}$", r"ab+c", r"^(MT-|RP[SL])", r"^[ACGT]{6}-\d+$", r"ENSG\d+", r"^A.*B.*C$",
          r"zzz$", r"gapdh|actb"]
NOT_SIMPLE = [".?" * 4 + "!", r"(?:a?){40}a{40}", r".*a.*b.*c", r"(\w)\1", r"(?=a)a.*", r"(ab|cd)(ef|gh)(ij|kl)"]


@pytest.mark.parametrize("pattern", NORMAL)
def test_a_normal_pattern_runs_on_the_fast_engine(pattern):
    assert name_index.is_simple(pattern)
    assert name_index.compile_regex(pattern)._fast is not None


@pytest.mark.parametrize("pattern", NOT_SIMPLE + REVIEW_PATTERNS)
def test_anything_else_runs_under_the_timeout(pattern):
    assert not name_index.is_simple(pattern)
    rx = name_index.compile_regex(pattern)
    assert rx._fast is None and rx._slow is not None


def test_both_engines_give_the_same_matches():
    import random
    rng = random.Random(3)
    names = ["".join(rng.choice("ACGTabc_-0123456789") for _ in range(rng.randint(1, 30))) for _ in range(3000)]
    names += ["MT-ND1", "RP-S3", "gapdh", "ACTB", "x" * 400 + "zzz", "ENSG00000187634"]
    for pattern in NORMAL:
        rx = name_index.compile_regex(pattern)
        fast = rx.scan(iter(names), None, 10 ** 9)[0]
        rx._fast, rx._slow = None, rx._compile_slow()
        slow = rx.scan(iter(names), None, 10 ** 9)[0]
        assert fast == slow, pattern


def test_a_long_name_goes_to_the_timeout_engine():
    rx = name_index.compile_regex(r"zzz$")
    long_name = "x" * (name_index.FAST_MAX_NAME + 50) + "ZZZ"
    assert rx.scan(iter(["short", long_name]), None, 5)[0] == [(1, long_name)]
    assert rx._slow is not None, "the long name was matched by the timeout engine"


def test_the_fast_engine_reads_the_clock_often_enough(monkeypatch):
    """The clock is read every FAST_CLOCK_EVERY names, so a scan overruns its deadline by at most that many."""
    ticks = iter(range(10 ** 6))

    class Clock:
        @staticmethod
        def monotonic():
            return float(next(ticks))        # one second per look at the clock

    monkeypatch.setattr(name_index, "time", Clock)
    rx = name_index.compile_regex(r"^cell_\d+x.*y")
    assert rx._fast is not None
    names = ("cell_%07d" % i for i in range(10 ** 6))
    hits, status, read = rx.scan(names, 3.0, 10)
    assert status == "timeout"
    assert read <= 4 * name_index.FAST_CLOCK_EVERY, read
