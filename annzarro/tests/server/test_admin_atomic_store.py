"""The atomic JSON store, and the users file on top of it, under writers in several processes."""
import json
import multiprocessing
import os
import threading

import pytest

from annzarro.server import atomic_store
from annzarro.server.auth import AuthManager, LastAdminError, ensure_admin_remains


def _count_worker(path, n, start):
    start.wait()
    for _ in range(n):
        atomic_store.update_json(path, lambda d: d.__setitem__("n", d.get("n", 0) + 1), {})


def _add_user_worker(user_file, name, start):
    manager = AuthManager(user_file=user_file)
    start.wait()
    manager.update_users(lambda table: table.__setitem__(name, type(next(iter(table.values())))(name, "x")))


def _demote_worker(user_file, name, start, out):
    manager = AuthManager(user_file=user_file)

    def demote(table):
        table[name].is_admin = False
        ensure_admin_remains(table)

    start.wait()
    try:
        manager.update_users(demote)
        out.put((name, "ok"))
    except LastAdminError:
        out.put((name, "last_admin"))


def _run(ctx, target, argsets):
    procs = [ctx.Process(target=target, args=args) for args in argsets]
    for p in procs:
        p.start()
    return procs


def _join(procs):
    for p in procs:
        p.join(60)
        assert p.exitcode == 0


def test_write_is_atomic_and_private(tmp_path):
    path = str(tmp_path / "x.json")
    atomic_store.write_json(path, {"a": 1})
    assert json.load(open(path)) == {"a": 1}
    assert os.stat(path).st_mode & 0o777 == 0o600
    os.chmod(path, 0o640)
    atomic_store.write_json(path, {"a": 2})
    assert os.stat(path).st_mode & 0o777 == 0o640, "an existing file keeps its mode"
    assert [f for f in os.listdir(tmp_path) if f.endswith(".tmp")] == []


def test_a_failed_write_leaves_the_old_file_and_no_temp(tmp_path):
    path = str(tmp_path / "x.json")
    atomic_store.write_json(path, {"a": 1})
    with pytest.raises(TypeError):
        atomic_store.write_json(path, {"a": object()})
    assert json.load(open(path)) == {"a": 1}
    assert [f for f in os.listdir(tmp_path) if f.endswith(".tmp")] == []


def test_a_corrupt_file_raises_instead_of_reading_as_empty(tmp_path):
    path = str(tmp_path / "x.json")
    for content in ("", "{not json"):
        open(path, "w").write(content)
        with pytest.raises(ValueError):
            atomic_store.read_json(path, {})
        with pytest.raises(ValueError):
            atomic_store.update_json(path, lambda d: d.update(a=1), {})
        assert open(path).read() == content, "a corrupt file is never overwritten"
    assert atomic_store.read_json(str(tmp_path / "missing.json"), {"d": 1}) == {"d": 1}


def test_a_refusing_mutator_writes_nothing(tmp_path):
    path = str(tmp_path / "x.json")
    atomic_store.write_json(path, {"a": 1})
    before = atomic_store.stamp(path)

    def refuse(data):
        data["a"] = 99
        raise PermissionError("no")

    with pytest.raises(PermissionError):
        atomic_store.update_json(path, refuse, {})
    assert json.load(open(path)) == {"a": 1} and atomic_store.stamp(path) == before


def test_the_lock_is_not_reentrant(tmp_path):
    path = str(tmp_path / "x.json")
    with atomic_store.locked(path):
        with pytest.raises(RuntimeError):
            with atomic_store.locked(path):
                pass
    with atomic_store.locked(path):
        pass


def test_threads_do_not_lose_updates(tmp_path):
    path = str(tmp_path / "x.json")
    threads = [threading.Thread(target=lambda: [atomic_store.update_json(
        path, lambda d: d.__setitem__("n", d.get("n", 0) + 1), {}) for _ in range(25)]) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert json.load(open(path))["n"] == 200


def test_processes_do_not_lose_updates(tmp_path):
    ctx = multiprocessing.get_context("spawn")
    path, start = str(tmp_path / "x.json"), ctx.Event()
    procs = _run(ctx, _count_worker, [(path, 40, start) for _ in range(4)])
    start.set()
    _join(procs)
    assert json.load(open(path))["n"] == 160


def test_stamp_sees_two_writes_in_one_mtime_tick(tmp_path, monkeypatch):
    path = str(tmp_path / "x.json")
    real_stat = os.stat

    class Frozen:
        def __init__(self, st):
            self._st = st

        def __getattr__(self, name):
            return 123456789 if name == "st_mtime_ns" else getattr(self._st, name)

    monkeypatch.setattr(atomic_store.os, "stat", lambda p, *a, **k: Frozen(real_stat(p, *a, **k)))
    atomic_store.write_json(path, {"v": 1}, indent=None)
    first = atomic_store.stamp(path)
    atomic_store.write_json(path, {"v": 2}, indent=None)
    assert atomic_store.stamp(path) != first, "same mtime, same size: the inode still moved"


def test_watched_rereads_only_when_the_stamp_moves(tmp_path):
    path = str(tmp_path / "w.json")
    watcher = atomic_store.Watched(path, {"v": 0})
    assert watcher.get() == {"v": 0}
    atomic_store.write_json(path, {"v": 1})
    first = watcher.get()
    assert first == {"v": 1} and watcher.get() is first, "unchanged file: the parsed value is reused"
    atomic_store.write_json(path, {"v": 2})
    assert watcher.get() == {"v": 2}
    os.unlink(path)
    assert watcher.get() == {"v": 0}


def test_watched_treats_a_corrupt_file_as_the_default_and_says_so(tmp_path):
    path = str(tmp_path / "w.json")
    open(path, "w").write("{oops")
    watcher = atomic_store.Watched(path, {"v": 0})
    assert watcher.get() == {"v": 0} and watcher.error
    atomic_store.write_json(path, {"v": 3})
    assert watcher.get() == {"v": 3} and watcher.error is None


def test_users_file_goes_through_the_store(tmp_path):
    path = str(tmp_path / "users.json")
    manager = AuthManager(user_file=path)
    manager.create_user("a", "pw", is_admin=True)
    assert os.stat(path).st_mode & 0o777 == 0o600
    assert not [f for f in os.listdir(tmp_path) if f.endswith(".tmp")]
    assert manager._file_stamp == atomic_store.stamp(path)
    other = AuthManager(user_file=path)
    manager.create_user("b", "pw")
    assert "b" in other.get_users(), "another process's change is picked up by the stamp"


def test_update_users_sees_the_merged_table_and_can_refuse(tmp_path):
    path = str(tmp_path / "users.json")
    ours, theirs = AuthManager(user_file=path), AuthManager(user_file=path)
    ours.create_user("a", "pw", is_admin=True)
    theirs.create_user("b", "pw", is_admin=True)           # ours has not looked yet
    seen = ours.update_users(lambda table: sorted(table))
    assert seen == ["a", "b"]

    def demote_all(table):
        for user in table.values():
            user.is_admin = False
        ensure_admin_remains(table)

    with pytest.raises(LastAdminError):
        ours.update_users(demote_all)
    assert theirs.admins() == {"a", "b"}, "a refused mutation writes nothing"


def test_update_users_in_several_processes(tmp_path):
    ctx = multiprocessing.get_context("spawn")
    path = str(tmp_path / "users.json")
    AuthManager(user_file=path).create_user("seed", "pw", is_admin=True)
    start = ctx.Event()
    names = [f"u{i}" for i in range(6)]
    procs = _run(ctx, _add_user_worker, [(path, n, start) for n in names])
    start.set()
    _join(procs)
    assert set(AuthManager(user_file=path).get_users()) == {"seed", *names}


def test_two_admins_demoting_each_other_leave_one(tmp_path):
    """The last-admin rule is checked inside the lock, on the stored table."""
    ctx = multiprocessing.get_context("spawn")
    path = str(tmp_path / "users.json")
    manager = AuthManager(user_file=path)
    manager.create_user("a", "pw", is_admin=True)
    manager.create_user("b", "pw", is_admin=True)
    for _ in range(5):
        manager.set_admin("a", True)
        manager.set_admin("b", True)
        start, out = ctx.Event(), ctx.Queue()
        procs = _run(ctx, _demote_worker, [(path, "a", start, out), (path, "b", start, out)])
        start.set()
        results = sorted(out.get(timeout=60)[1] for _ in procs)
        _join(procs)
        assert results == ["last_admin", "ok"]
        assert len(AuthManager(user_file=path).admins()) == 1
