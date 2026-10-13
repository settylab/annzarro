"""CI's browser shards (``pytest --shard I/N``) run every browser test exactly once."""
import glob
import os
import subprocess
import sys

import pytest

from annzarro.tests.shards import load_durations, parse_shard, split

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BROWSER = sorted(os.path.relpath(p, REPO).replace(os.sep, "/")
                 for p in glob.glob(os.path.join(REPO, "annzarro", "tests", "browser", "test_*.py")))
SHARDS = 4      # .github/workflows/tests.yml: matrix shard


@pytest.mark.parametrize("n", [1, 2, 3, SHARDS, 7, len(BROWSER) + 3])
def test_every_browser_file_is_in_exactly_one_shard(n):
    shards = split(BROWSER, n, load_durations())
    flat = [f for s in shards for f in s]
    assert len(shards) == n
    assert sorted(flat) == BROWSER


def test_a_file_without_a_recorded_duration_still_runs():
    files = BROWSER + ["annzarro/tests/browser/test_not_recorded_yet.py"]
    assert sorted(f for s in split(files, SHARDS, load_durations()) for f in s) == sorted(files)


def test_the_recorded_durations_balance_the_shards():
    durations = load_durations()
    loads = [sum(durations.get(f, 0) for f in s) for s in split(BROWSER, SHARDS, durations)]
    assert max(loads) < 1.25 * sum(loads) / SHARDS, loads


@pytest.mark.parametrize("text", ["0/4", "5/4", "1", "a/b", ""])
def test_a_malformed_shard_is_refused(text):
    with pytest.raises(ValueError):
        parse_shard(text)


def _collected(*args):
    out = subprocess.run([sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider",
                          "-p", "no:xdist", *args, "annzarro/tests/browser"],
                         cwd=REPO, capture_output=True, text=True, timeout=300)
    assert out.returncode == 0, out.stdout[-2000:] + out.stderr[-2000:]
    return [line for line in out.stdout.splitlines() if "::" in line]


def test_the_shards_collect_every_browser_test_once():
    """Through pytest itself: the --shard hook in conftest.py, on the real collection."""
    if os.environ.get("ANNZARRO_REQUIRE_BROWSER") != "1":
        pytest.importorskip("playwright.sync_api")
    every = _collected()
    assert every
    parts = [_collected("--shard", f"{i}/{SHARDS}") for i in range(1, SHARDS + 1)]
    assert all(parts)
    assert sorted(t for p in parts for t in p) == sorted(every)
