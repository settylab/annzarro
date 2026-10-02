"""
`annzarro stop` signals only an AnnZarro server of the current user, found
through the per-user state directory.

It used to fall back to $TMPDIR/annzarro/server.pid, a path any user on a
shared host can create, and SIGTERM/SIGKILL whatever PID it named.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import psutil
import pytest

from annzarro import cli


@pytest.fixture
def state(tmp_path, monkeypatch):
    monkeypatch.setenv("ANNZARRO_HOME", str(tmp_path / "state"))
    (tmp_path / "state").mkdir()
    procs = []

    def spawn(*extra):
        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)", *extra])
        procs.append(proc)
        return proc
    yield tmp_path / "state" / "server.pid", spawn
    for proc in procs:
        proc.kill()
        proc.wait()


def _stop():
    return cli.main(["stop"])


def test_refuses_a_pid_that_is_not_annzarro(state):
    pid_file, spawn = state
    victim = spawn()
    pid_file.write_text(str(victim.pid))
    assert _stop() == 1
    assert victim.poll() is None, "an unrelated process must not be signalled"
    assert not pid_file.exists()


def test_stops_an_annzarro_process(state):
    pid_file, spawn = state
    server = spawn("annzarro.cli", "start")
    pid_file.write_text(str(server.pid))
    assert _stop() == 0
    server.wait(timeout=10)
    assert not pid_file.exists()


def test_ignores_the_shared_temp_directory(state):
    pid_file, spawn = state
    victim = spawn("annzarro.cli", "start")
    planted = Path(tempfile.gettempdir()) / "annzarro" / "server.pid"
    planted.parent.mkdir(exist_ok=True)
    previous = planted.read_text() if planted.exists() else None
    planted.write_text(str(victim.pid))
    try:
        assert _stop() == 1
        assert victim.poll() is None
    finally:
        if previous is None:
            planted.unlink()
        else:
            planted.write_text(previous)


def test_stale_pid_file_is_removed(state):
    pid_file, spawn = state
    gone = spawn()
    gone.kill()
    gone.wait()
    pid_file.write_text(str(gone.pid))
    assert _stop() == 0
    assert not pid_file.exists()
