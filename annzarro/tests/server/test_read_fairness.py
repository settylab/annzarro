"""One user cannot take the whole read budget, nor every subset place.

admit() gave the pairwise-read budget to whoever asked first, so one user's
parallel row reads of a big matrix made every other user's focused-cell read
answer 503 read_busy. Each requester (user, else client address) now holds at
most read_user_share_percent of it. /data/subset computations are limited per
worker too (subset_budget_mb), with the same share of the places
(test_subset_fairness.py).
"""
import threading
import time

import pytest

from annzarro.core import read_guard, subset as cell_subset
from annzarro.core.read_guard import ReadBusyError

MB = 2 ** 20


@pytest.fixture(autouse=True)
def _reset():
    yield
    read_guard.requester(None)
    read_guard.configure()
    cell_subset.configure()


def _as(owner):
    """Run the rest of this thread's reads as ``owner``."""
    read_guard.requester(owner)


def test_one_requester_cannot_hold_more_than_its_share():
    read_guard.configure(max_mb=100, budget_mb=200, wait_s=0.05)        # share 50% = 100 MB
    assert read_guard.share_bytes() == 100 * MB
    _as("alice")
    with read_guard.admit(60 * MB):
        with pytest.raises(ReadBusyError) as busy:
            with read_guard.admit(60 * MB):
                pass
        assert "most one user may hold" in str(busy.value)
        # the rest of the budget is bob's
        _as("bob")
        with read_guard.admit(90 * MB):
            pass
    _as("alice")
    with read_guard.admit(100 * MB):                    # idle again: a whole read is fine
        pass


def test_other_users_are_not_starved_by_one():
    read_guard.configure(max_mb=100, budget_mb=200, wait_s=0.05)
    _as("alice")
    with read_guard.admit(100 * MB):
        _as("bob")
        with read_guard.admit(100 * MB):                # alice cannot take the other half
            pass


def test_the_share_is_never_less_than_one_read():
    read_guard.configure(max_mb=100, budget_mb=120, wait_s=0.05, share_pct=10)
    assert read_guard.share_bytes() == 100 * MB
    _as("alice")
    with read_guard.admit(100 * MB):
        pass


def test_share_zero_gives_the_whole_budget_to_one_requester():
    read_guard.configure(max_mb=100, budget_mb=200, wait_s=0.05, share_pct=0)
    _as("alice")
    with read_guard.admit(100 * MB):
        with read_guard.admit(100 * MB):
            pass


def test_reads_outside_a_request_have_no_share():
    read_guard.configure(max_mb=100, budget_mb=200, wait_s=0.05)
    read_guard.requester(None)
    with read_guard.admit(100 * MB):
        with read_guard.admit(100 * MB):
            pass


def test_a_waiting_read_gets_in_when_its_own_earlier_read_ends():
    read_guard.configure(max_mb=100, budget_mb=200, wait_s=5)
    _as("alice")
    first = read_guard.admit(80 * MB)
    first.__enter__()
    got = []

    def second():
        _as("alice")
        with read_guard.admit(80 * MB):
            got.append(True)

    t = threading.Thread(target=second)
    t.start()
    t.join(0.2)
    assert not got
    first.__exit__(None, None, None)
    t.join(5)
    assert got == [True]


def _seen_owner(tmp_path, address="203.0.113.9", **config):
    from annzarro.server import access
    from annzarro.server.core import create_app
    app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False, "cache_enabled": False,
                      "data_dir": str(tmp_path), **config})
    seen = []

    @app.route("/whoami")
    @access.gate("public")   # a route with no declared gate is refused (access.py)
    def whoami():
        seen.append(read_guard._owner.get())
        return "ok"

    app.test_client().get("/whoami", environ_overrides={"REMOTE_ADDR": address})
    return seen[0], cell_subset._places.total


def test_a_shared_server_names_the_requester(tmp_path):
    owner, places = _seen_owner(tmp_path, hosted=True)
    assert owner == "203.0.113.9" and places == cell_subset.default_budget_bytes()


@pytest.mark.parametrize("address,owner", [
    ("2001:db8:1:2:aaaa::1", "2001:db8:1:2::/64"),
    ("2001:db8:1:2:ffff:ffff:ffff:fffe", "2001:db8:1:2::/64"),
    ("2001:db8:1:3::1", "2001:db8:1:3::/64"),
    ("::ffff:203.0.113.9", "203.0.113.9"),
])
def test_an_ipv6_host_is_one_requester_per_64(tmp_path, address, owner):
    """One host holds a whole /64: per address, it could name itself anew
    for every request and never meet its share."""
    assert _seen_owner(tmp_path, address=address, hosted=True)[0] == owner


def test_a_single_user_server_has_no_share_and_no_subset_limit(tmp_path):
    """The desktop app and `annzarro start` on loopback without login: one user
    is everyone, and must not be held to half the budget or two subsets."""
    owner, places = _seen_owner(tmp_path, hosted=False, host="127.0.0.1")
    assert owner is None and places > 100
    read_guard.configure(max_mb=100, budget_mb=200, wait_s=0.05)
    with read_guard.admit(100 * MB):
        with read_guard.admit(100 * MB):          # the whole budget, from one requester
            pass


class _Reader:
    """Just enough of a reader for the subset gate: the dataset's cell count."""

    def __init__(self, n_obs):
        self.n_obs = n_obs

    def get_metadata(self, path):
        return {"shape": (self.n_obs, 10)}


def _slow_compute(started, release):
    def slow(*args, **kwargs):
        started.release()
        release.wait(5)
        return "subset"
    return slow


def test_subset_computations_are_charged_by_their_cells_and_limited_per_worker(monkeypatch):
    """Two subsets of 1M cells fit a 120 MB budget (55 MB each); the third waits and is
    refused after subset_wait_s, naming the setting; a freed place lets the next one in."""
    cell_subset.configure(budget_mb=120, wait_s=0.2)
    started, release = threading.Semaphore(0), threading.Event()
    monkeypatch.setattr(cell_subset, "_compute_subset_unbounded", _slow_compute(started, release))
    reader = _Reader(1_000_000)
    threads = [threading.Thread(target=lambda: cell_subset._compute_subset(reader, "d", None, None, None))
               for _ in range(2)]
    for t in threads:
        t.start()
    assert started.acquire(timeout=5) and started.acquire(timeout=5)       # both hold the budget
    assert cell_subset._places.held() == 2 * 1_000_000 * cell_subset.SUBSET_BYTES_PER_CELL
    began = time.monotonic()
    with pytest.raises(ReadBusyError) as busy:
        cell_subset._compute_subset(reader, "d", None, None, None)
    assert 0.15 < time.monotonic() - began < 2 and busy.value.retry_after_s >= 1
    assert "subset_budget_mb" in str(busy.value) and "subset_wait_s" in str(busy.value)
    release.set()
    for t in threads:
        t.join(5)
    assert cell_subset._places.held() == 0
    assert cell_subset._compute_subset(reader, "d", None, None, None) == "subset"


def test_a_small_dataset_is_not_held_to_the_count_a_big_one_is(monkeypatch):
    cell_subset.configure(budget_mb=120, wait_s=0.05)
    started, release = threading.Semaphore(0), threading.Event()
    monkeypatch.setattr(cell_subset, "_compute_subset_unbounded", _slow_compute(started, release))
    small = _Reader(10_000)                                  # 0.55 MB each
    threads = [threading.Thread(target=lambda: cell_subset._compute_subset(small, "d", None, None, None))
               for _ in range(20)]
    for t in threads:
        t.start()
    for _ in range(20):
        assert started.acquire(timeout=5)
    release.set()
    for t in threads:
        t.join(5)


def test_a_subset_larger_than_the_whole_budget_runs_alone_and_says_so(monkeypatch, caplog):
    cell_subset.configure(budget_mb=100, wait_s=0.1)         # 100 MB; a 95.6M-cell subset needs 5 GB
    started, release = threading.Semaphore(0), threading.Event()
    monkeypatch.setattr(cell_subset, "_compute_subset_unbounded", _slow_compute(started, release))
    big, small = _Reader(95_600_000), _Reader(1_000)
    with caplog.at_level("WARNING", logger="annzarro.core.subset"):
        runner = threading.Thread(target=lambda: cell_subset._compute_subset(big, "d", None, None, None))
        runner.start()
        assert started.acquire(timeout=5)                    # not refused, not deadlocked
        assert any("runs alone" in r.getMessage() for r in caplog.records)
        with pytest.raises(ReadBusyError):                   # nothing else gets in beside it
            cell_subset._compute_subset(small, "d", None, None, None)
        release.set()
        runner.join(5)
    assert cell_subset._places.held() == 0
    assert cell_subset._compute_subset(big, "d", None, None, None) == "subset"     # alone again: runs


def test_a_waiting_subset_gets_in_when_the_budget_frees_before_the_wait_ends(monkeypatch):
    cell_subset.configure(budget_mb=60, wait_s=5)            # one 1M-cell subset at a time
    started, release = threading.Semaphore(0), threading.Event()
    monkeypatch.setattr(cell_subset, "_compute_subset_unbounded", _slow_compute(started, release))
    reader = _Reader(1_000_000)
    results = []
    first = threading.Thread(target=lambda: results.append(cell_subset._compute_subset(reader, "d", None, None, None)))
    first.start()
    assert started.acquire(timeout=5)
    second = threading.Thread(target=lambda: results.append(cell_subset._compute_subset(reader, "d", None, None, None)))
    second.start()
    time.sleep(0.2)
    assert results == []                                     # waiting, not refused
    release.set()
    first.join(5)
    second.join(5)
    assert results == ["subset", "subset"]
