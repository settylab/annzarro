"""`annzarro serve` as an operator runs it: a real gunicorn on a real port.

Starts the command from an empty working directory with a tiny site file (login
off, one fixture dataset), waits for /api/v1/status, then stops it by PID with
SIGTERM, as systemd does. `serve` execs gunicorn, so the PID it was started
with is gunicorn's master; the test checks that it exits (cleanly) and frees
the port.
"""
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(sys.platform == "win32", reason="gunicorn does not run on Windows"),
]
pytest.importorskip("gunicorn")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
FIXTURE = os.path.join(REPO_ROOT, "annzarro", "tests", "data", "fixture_small.zarr")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get(url, timeout=2):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_serve_starts_answers_and_stops_on_sigterm(tmp_path):
    if not os.path.isdir(FIXTURE):
        pytest.skip("fixture_small.zarr missing")
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    data = tmp_path / "data"
    data.mkdir()
    shutil.copytree(FIXTURE, data / "fixture_small.zarr")
    site = tmp_path / "site.yaml"
    site.write_text(
        "server:\n"
        f"  data_dir: \"{data}\"\n"
        f"  log_file: \"{tmp_path / 'server.log'}\"\n"
        "auth:\n"
        "  enabled: false\n"
        f"  user_file: \"{tmp_path / 'users.json'}\"\n"
    )
    port = _free_port()
    home = tmp_path / "home"
    env = {k: v for k, v in os.environ.items() if not k.startswith("ANNZARRO_")}
    env.update(
        HOME=str(home),
        XDG_CONFIG_HOME=str(home / ".config"),
        ANNZARRO_HOME=str(home / ".annzarro"),
        PYTHONPATH=REPO_ROOT + os.pathsep + env.get("PYTHONPATH", ""),
    )
    cmd = [sys.executable, "-m", "annzarro.cli", "serve", "--config", str(site),
           "--port", str(port), "--workers", "1", "--threads", "2"]
    out = open(tmp_path / "serve.out", "wb")
    proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=out, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.time() + 60
        while time.time() < deadline and proc.poll() is None:
            try:
                status, body = _get(base + "/api/v1/status")
            except OSError:
                time.sleep(0.3)
                continue
            if status == 200:
                break
            time.sleep(0.3)
        else:
            pytest.fail("server not up:\n" + (tmp_path / "serve.out").read_text()[-3000:])
        assert status == 200, body[:300]
        assert "login:    OFF" in (tmp_path / "serve.out").read_text()
        _, datasets = _get(base + "/api/v1/datasets")
        assert "fixture_small.zarr" in json.dumps(json.loads(datasets))

        proc.send_signal(signal.SIGTERM)
        assert proc.wait(timeout=30) == 0, (tmp_path / "serve.out").read_text()[-2000:]
        with pytest.raises(OSError):
            _get(base + "/api/v1/status")
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
        out.close()
