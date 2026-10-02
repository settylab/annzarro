"""`annzarro start` as a user runs it: a real process, a real port, flags only.

The reported failure: from any directory but the checkout,

    annzarro start --data-dir D --port P --no-browser --auth-disabled

exited with "Missing required configuration: server.host / server.port /
server.data_dir". This starts the CLI in a subprocess from an EMPTY temporary
working directory with no configuration file anywhere (HOME, XDG_CONFIG_HOME
and ANNZARRO_HOME all point into tmp), waits for the port, and checks:

* /api/v1/datasets lists the dataset in --data-dir,
* / and every /static/ asset it references (vendored bundles included) are 200,
* the log went to $ANNZARRO_HOME/logs, and nothing was written to the CWD.

The server binds 127.0.0.1 on a free port and is killed (whole process group:
the production defaults run Werkzeug's reloader, which forks) at the end.
"""
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
FIXTURE = os.path.join(REPO_ROOT, "annzarro", "tests", "data", "fixture_small.zarr")

pytestmark = pytest.mark.integration


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get(url, timeout=10):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


@pytest.fixture
def started_server(tmp_path):
    if not os.path.isdir(FIXTURE):
        pytest.skip("fixture_small.zarr missing")
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    home = tmp_path / "home"
    data = tmp_path / "datasets"
    data.mkdir()
    shutil.copytree(FIXTURE, data / "fixture_small.zarr")
    port = _free_port()

    env = {k: v for k, v in os.environ.items() if not k.startswith("ANNZARRO_")}
    env.update(
        HOME=str(home),
        XDG_CONFIG_HOME=str(home / ".config"),
        ANNZARRO_HOME=str(home / ".annzarro"),
        ANNZARRO_HEADLESS="1",
        # Import this checkout's annzarro from the unrelated CWD (a pip install
        # would have it on sys.path already).
        PYTHONPATH=REPO_ROOT + os.pathsep + env.get("PYTHONPATH", ""),
    )
    cmd = [sys.executable, "-m", "annzarro.cli", "start",
           "--host", "127.0.0.1", "--port", str(port), "--data-dir", str(data),
           "--no-browser", "--auth-disabled"]
    log = open(tmp_path / "server.out", "wb")
    proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.time() + 60
        while time.time() < deadline:
            if proc.poll() is not None:
                break
            try:
                if _get(base + "/api/v1/status", timeout=2)[0] == 200:
                    break
            except OSError:
                pass
            time.sleep(0.3)
        else:
            pytest.fail("server did not come up within 60 s")
        if proc.poll() is not None:
            pytest.fail(f"server exited with {proc.returncode}:\n"
                        + (tmp_path / "server.out").read_text()[-3000:])
        yield {"base": base, "cwd": cwd, "home": home, "proc": proc}
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=10)
        log.close()


def test_start_with_flags_only_from_an_unrelated_cwd(started_server):
    status, body = _get(started_server["base"] + "/api/v1/datasets")
    assert status == 200, body[:500]
    payload = json.loads(body)
    datasets = payload["datasets"] if isinstance(payload, dict) else payload
    paths = [d.get("path", "") for d in datasets]
    assert any(p.endswith("fixture_small.zarr") for p in paths), paths

    status, html = _get(started_server["base"] + "/")
    assert status == 200
    html = html.decode()
    refs = sorted(set(re.findall(r'(?:href|src)="(/static/[^"]+)"', html)))
    assert any("/vendor/" in r for r in refs), "index.html references no vendored bundle"
    bad = [(r, _get(started_server["base"] + r)[0]) for r in refs]
    bad = [(r, s) for r, s in bad if s != 200]
    assert not bad, f"UI assets not served: {bad}"

    assert (started_server["home"] / ".annzarro" / "logs" / "annzarro_server.log").is_file()
    assert list(started_server["cwd"].iterdir()) == [], "the server wrote into its CWD"
