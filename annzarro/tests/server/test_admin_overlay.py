"""The overlay: bounded by the YAML, fails closed, and reaches every worker."""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

from annzarro.server.admin import overlay
from annzarro.tests.server.admin_helpers import make_app

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))


def _config(tmp_path, parents=()):
    users = tmp_path / "users"
    users.mkdir(exist_ok=True)
    return {"user_file": str(users / "users.json"), "admin_data_roots": [str(p) for p in parents]}


def _add(config, path, by="alice"):
    overlay.update(config, lambda o: o.setdefault("data_roots", []).append(
        {"path": str(path), "added_by": by, "added_at": "2026-10-11T00:00:00+00:00"}))


def test_roots_inside_a_parent_are_active(tmp_path):
    parent = tmp_path / "atlases"
    (parent / "lab2").mkdir(parents=True)
    config = _config(tmp_path, [parent])
    _add(config, parent / "lab2")
    assert overlay.active_data_roots(config) == [os.path.realpath(parent / "lab2")]
    state = overlay.resolve_roots(config)[0]
    assert state["active"] and state["added_by"] == "alice"


def test_roots_outside_every_parent_or_not_absolute_or_missing_are_inactive(tmp_path):
    parent, other = tmp_path / "atlases", tmp_path / "other"
    (parent / "ok").mkdir(parents=True)
    other.mkdir()
    config = _config(tmp_path, [parent])
    for path in (other, "relative/dir", parent / "gone", str(parent) + "/../other"):
        _add(config, path)
    reasons = [r["inactive_reason"] for r in overlay.resolve_roots(config)]
    assert reasons == ["outside_parents", "not_absolute", "missing", "outside_parents"]
    assert overlay.active_data_roots(config) == []


def test_empty_parents_deactivate_everything(tmp_path):
    (tmp_path / "d").mkdir()
    config = _config(tmp_path, [])
    _add(config, tmp_path / "d")
    assert overlay.active_data_roots(config) == []


def test_a_symlink_swapped_after_the_add_deactivates_the_root(tmp_path):
    parent, outside = tmp_path / "atlases", tmp_path / "secret"
    (parent / "real").mkdir(parents=True)
    outside.mkdir()
    link = parent / "link"
    link.symlink_to(parent / "real")
    config = _config(tmp_path, [parent])
    _add(config, link)
    assert overlay.active_data_roots(config) == [os.path.realpath(parent / "real")]
    link.unlink()
    link.symlink_to(outside)                                # no overlay write happens
    assert overlay.active_data_roots(config) == []
    assert overlay.resolve_roots(config)[0]["inactive_reason"] == "outside_parents"


def test_a_parent_dropped_from_the_yaml_deactivates_its_roots(tmp_path):
    parent = tmp_path / "atlases"
    (parent / "lab2").mkdir(parents=True)
    config = _config(tmp_path, [parent])
    _add(config, parent / "lab2")
    config["admin_data_roots"] = []
    assert overlay.active_data_roots(config) == []


def test_a_corrupt_overlay_fails_closed_and_is_not_overwritten(tmp_path):
    parent = tmp_path / "atlases"
    (parent / "lab2").mkdir(parents=True)
    config = _config(tmp_path, [parent])
    _add(config, parent / "lab2")
    with open(overlay.path(config), "w") as f:
        f.write("{corrupt")
    assert overlay.active_data_roots(config) == [] and overlay.policy(config) == {}
    assert overlay.status(config)["ok"] is False
    with pytest.raises(ValueError):
        _add(config, parent / "lab2")
    assert open(overlay.path(config)).read() == "{corrupt"
    os.unlink(overlay.path(config))
    assert overlay.status(config)["ok"] is True


def test_the_policy_layer_is_passed_through_untouched(tmp_path):
    config = _config(tmp_path)
    layer = {"outbound.allow_external": False, "panel.gene-set.enabled": True, "weird": {"nested": [1, 2, {"x": None}]},
             "unknown.key": "kept"}
    overlay.update(config, lambda o: o.__setitem__("policy", layer))
    assert overlay.policy(config) == layer
    assert json.load(open(overlay.path(config)))["policy"] == layer
    overlay.update(config, lambda o: o.setdefault("data_roots", []))
    assert overlay.policy(config) == layer, "a roots change keeps the policy layer"


def test_only_allowlisted_keys_can_be_written_and_others_survive(tmp_path):
    config = _config(tmp_path)
    overlay.update(config, lambda o: o.__setitem__("data_roots", []))
    with open(overlay.path(config)) as f:
        data = json.load(f)
    data["future_key"] = 7                                  # written by a newer version
    json.dump(data, open(overlay.path(config), "w"))
    with pytest.raises(ValueError):
        overlay.update(config, lambda o: o.__setitem__("limits", {"max_sessions": 1}))
    with pytest.raises(ValueError):
        overlay.update(config, lambda o: o.pop("future_key"))
    overlay.update(config, lambda o: o.__setitem__("data_roots", [{"path": "/x"}]))
    assert json.load(open(overlay.path(config)))["future_key"] == 7


def test_the_state_directory_is_private_and_beside_the_users_file(tmp_path):
    config = _config(tmp_path)
    overlay.update(config, lambda o: o.__setitem__("data_roots", []))
    directory = os.path.dirname(overlay.path(config))
    assert directory == str(tmp_path / "users" / "annzarro_admin")
    assert os.stat(directory).st_mode & 0o777 == 0o700
    assert os.stat(overlay.path(config)).st_mode & 0o777 == 0o600


def test_two_apps_sharing_a_directory_see_each_others_changes(tmp_path):
    parent = tmp_path / "atlases"
    (parent / "lab2").mkdir(parents=True)
    a = make_app(tmp_path, admin_data_roots=[str(parent)])
    b = make_app(tmp_path, admin_data_roots=[str(parent)])
    with a.test_request_context("/"), b.test_request_context("/"):
        pass
    assert overlay.active_data_roots(b.config) == []
    _add(a.config, parent / "lab2")
    assert overlay.active_data_roots(b.config) == [os.path.realpath(parent / "lab2")]
    overlay.update(a.config, lambda o: o["data_roots"].clear())
    assert overlay.active_data_roots(b.config) == []


def test_two_writes_in_one_tick_with_equal_size_are_both_seen(tmp_path):
    parent = tmp_path / "atlases"
    for name in ("aa", "bb"):
        (parent / name).mkdir(parents=True)
    config = _config(tmp_path, [parent])
    for name in ("aa", "bb", "aa", "bb"):
        overlay.update(config, lambda o, n=name: o.__setitem__("data_roots", [{"path": str(parent / n)}]))
        assert overlay.active_data_roots(config) == [os.path.realpath(parent / name)]


def test_within_a_request_the_overlay_is_read_once(tmp_path):
    parent = tmp_path / "atlases"
    (parent / "lab2").mkdir(parents=True)
    app = make_app(tmp_path, admin_data_roots=[str(parent)])
    _add(app.config, parent / "lab2")
    with app.test_request_context("/"):
        seen = overlay.active_data_roots(app.config)
        calls = []
        real = overlay.os.path.realpath
        overlay.os.path.realpath = lambda p: calls.append(p) or real(p)
        try:
            for _ in range(50):
                overlay.active_data_roots(app.config)
        finally:
            overlay.os.path.realpath = real
        assert calls == [] and seen


# --- across gunicorn workers ------------------------------------------------

def _gunicorn():
    exe = os.environ.get("ANNZARRO_TEST_GUNICORN") or os.path.join(os.path.dirname(sys.executable), "gunicorn")
    if not os.path.exists(exe):
        pytest.skip("gunicorn not installed")
    return exe


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read())


@pytest.fixture
def servers(tmp_path):
    """Gunicorn masters sharing one users directory (and so one overlay), started by ``start``."""
    gunicorn = _gunicorn()
    parent = tmp_path / "atlases"
    (parent / "lab2").mkdir(parents=True)
    (tmp_path / "users").mkdir()
    site = tmp_path / "site.yaml"
    site.write_text(f"""server:
  host: 127.0.0.1
  data_dir: "{tmp_path / 'data'}"
  log_file: "{tmp_path / 'app.log'}"
  threads: 2
  admin_data_roots: ["{parent}"]
auth:
  user_file: "{tmp_path / 'users' / 'users.json'}"
""")
    env = dict(os.environ, ANNZARRO_CONFIG=str(site), ANNZARRO_HOME=str(tmp_path / "home"),
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""), PYTHONUNBUFFERED="1")
    procs, urls = [], []

    def start(workers):
        port = _free_port()
        log = open(tmp_path / f"gunicorn{port}.log", "w")
        proc = subprocess.Popen(
            [gunicorn, "-c", "python:annzarro.server.gunicorn_config", "--bind", f"127.0.0.1:{port}",
             "--workers", str(workers), "annzarro.tests.server.admin_wsgi:create_wsgi_app()"],
            env=env, cwd=str(tmp_path), stdout=log, stderr=subprocess.STDOUT)
        procs.append(proc)
        url = f"http://127.0.0.1:{port}"
        for _ in range(160):
            try:
                _get(url + "/_test/overlay")
                break
            except OSError:
                if proc.poll() is not None:
                    pytest.fail("gunicorn exited: " + (tmp_path / f"gunicorn{port}.log").read_text()[-2000:])
                time.sleep(0.25)
        else:
            pytest.fail("gunicorn did not start")
        urls.append(url)
        return url

    config = {"user_file": str(tmp_path / "users" / "users.json"), "admin_data_roots": [str(parent)]}
    try:
        yield start, config, parent
    finally:
        for proc in procs:                                   # this test's own masters, by PID
            proc.terminate()
        for proc in procs:
            proc.wait(15)


def test_overlay_reaches_two_servers_and_back(servers):
    start, config, parent = servers
    a, b = start(1), start(1)
    assert _get(a + "/_test/overlay")["active"] == [] == _get(b + "/_test/overlay")["active"]
    _add(config, parent / "lab2")
    real = os.path.realpath(parent / "lab2")
    assert _get(a + "/_test/overlay")["active"] == [real] == _get(b + "/_test/overlay")["active"]
    overlay.update(config, lambda o: o["data_roots"].clear())
    assert _get(a + "/_test/overlay")["active"] == [] == _get(b + "/_test/overlay")["active"]


def test_no_worker_answers_stale_right_after_a_change(servers):
    start, config, parent = servers
    url = start(2)
    real = os.path.realpath(parent / "lab2")
    for _ in range(4):
        _add(config, parent / "lab2")
        answers = [_get(url + "/_test/overlay") for _ in range(50)]
        assert all(a["active"] == [real] for a in answers), "a worker still served the old overlay"
        overlay.update(config, lambda o: o["data_roots"].clear())
        answers += [_get(url + "/_test/overlay") for _ in range(50)]
        assert all(a["active"] == [] for a in answers[50:]), "a worker still served the removed root"
