"""
A change to access.json or users.json reaches every worker on its next request.

Two gunicorn masters of two workers each share one users directory, as a
deployment with several processes does. The test changes the files from a
third process (this one, through the same atomic store the CLI and the admin
interface use) and asks every worker, with no pause, over real HTTP.
"""
import http.cookiejar
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import pytest

from annzarro.server import access, atomic_store
from annzarro.server.admin import settings
from annzarro.server.auth import AuthManager
from annzarro.tests.server.rich_store import make_rich_store

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
PASSWORD = "pw-for-tests"
WORKERS_PER_MASTER = 2


def _gunicorn():
    exe = os.environ.get("ANNZARRO_TEST_GUNICORN") or os.path.join(os.path.dirname(sys.executable), "gunicorn")
    if not os.path.exists(exe):
        pytest.skip("gunicorn not installed")
    return exe


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Browser:
    """One logged-in user of one server, with a cookie jar."""

    def __init__(self, base, username):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        body = urllib.parse.urlencode({"username": username, "password": PASSWORD}).encode()
        self.opener.open(urllib.request.Request(base + "/login", data=body), timeout=15).read()

    def status(self, path, **query):
        url = self.base + path + ("?" + urllib.parse.urlencode(query) if query else "")
        try:
            with self.opener.open(url, timeout=15) as reply:
                reply.read()
                return reply.status
        except urllib.error.HTTPError as exc:
            exc.read()
            return exc.code


@pytest.fixture
def site(tmp_path):
    gunicorn = _gunicorn()
    data = tmp_path / "data"
    make_rich_store(data / "in.zarr")
    make_rich_store(data / "out.zarr")
    (tmp_path / "users").mkdir()
    users = tmp_path / "users" / "users.json"
    manager = AuthManager(user_file=str(users))
    manager.create_user("root", PASSWORD, is_admin=True)
    manager.create_user("bob", PASSWORD)
    manager.create_user("carol", PASSWORD)
    config_file = tmp_path / "site.yaml"
    config_file.write_text(f"""server:
  host: 127.0.0.1
  data_dir: "{data}"
  log_file: "{tmp_path / 'app.log'}"
  threads: 2
auth:
  user_file: "{users}"
""")
    env = dict(os.environ, ANNZARRO_CONFIG=str(config_file), ANNZARRO_HOME=str(tmp_path / "home"),
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""), PYTHONUNBUFFERED="1")
    procs = []

    def start():
        port = _free_port()
        log = open(tmp_path / f"gunicorn{port}.log", "w")
        proc = subprocess.Popen(
            [gunicorn, "-c", "python:annzarro.server.gunicorn_config", "--bind", f"127.0.0.1:{port}",
             "--workers", str(WORKERS_PER_MASTER), "annzarro.server.wsgi:create_wsgi_app()"],
            env=env, cwd=str(tmp_path), stdout=log, stderr=subprocess.STDOUT)
        procs.append(proc)
        url = f"http://127.0.0.1:{port}"
        for _ in range(160):
            try:
                with urllib.request.urlopen(url + "/login", timeout=5):
                    return url
            except urllib.error.HTTPError:
                return url      # it answered
            except OSError:
                if proc.poll() is not None:
                    pytest.fail("gunicorn exited: " + (tmp_path / f"gunicorn{port}.log").read_text()[-2000:])
                time.sleep(0.25)
        pytest.fail("gunicorn did not start")

    config = {"user_file": str(users), "data_dir": str(data)}
    try:
        yield start, config, data, manager
    finally:
        for proc in procs:                              # this test's own masters, by PID
            proc.terminate()
        for proc in procs:
            proc.wait(15)


def read(browser, store, n=24):
    """Statuses of ``n`` reads of ``store``: enough to reach every worker of the server."""
    return {browser.status("/api/v1/data/info", dataset_path=store) for _ in range(n)}


def test_a_revoke_a_restriction_and_a_repair_reach_every_worker_at_once(site):
    start, config, data, manager = site
    servers = [start(), start()]
    bobs = [Browser(url, "bob") for url in servers]
    carols = [Browser(url, "carol") for url in servers]
    roots = [Browser(url, "root") for url in servers]
    store, other = str(data / "in.zarr"), str(data / "out.zarr")
    allowed = lambda browsers, path, expected: all(read(b, path) == {expected} for b in browsers)

    assert allowed(bobs, other, 200)                               # the default: everything
    access.add_grant(config, "bob", "store", store, actor="root")
    assert allowed(bobs, other, 200)                               # a grant alone does not restrict
    access.set_restricted(config, "bob", True)
    assert allowed(bobs, store, 200) and allowed(bobs, other, 404)
    assert allowed(carols, other, 200) and allowed(roots, other, 200)

    for _ in range(3):                                             # revoke and grant again, with no pause
        access.remove_grant(config, "bob", store)
        assert allowed(bobs, store, 404), "a worker still served a revoked grant"
        access.add_grant(config, "bob", "store", store, actor="root")
        assert allowed(bobs, store, 200), "a worker still refused a restored grant"

    access.set_restricted(config, "bob", False)
    assert allowed(bobs, other, 200), "a worker still held the restriction"
    access.set_restricted(config, "bob", True)
    assert allowed(bobs, other, 404)

    # a corrupt file: every non-admin gets 503, admins keep working, and the repair is seen at once
    path = settings.access_path(config)
    saved = open(path).read()
    open(path, "w").write("{broken")
    assert allowed(bobs, store, 503) and allowed(carols, store, 503), "a worker guessed who is restricted"
    assert allowed(roots, other, 200)
    open(path, "w").write(saved)
    assert allowed(bobs, store, 200) and allowed(bobs, other, 404) and allowed(carols, other, 200)


def test_promoting_and_removing_a_user_reach_every_worker_at_once(site):
    start, config, data, manager = site
    url = start()
    bob = Browser(url, "bob")
    access.add_grant(config, "bob", "store", str(data / "in.zarr"), actor="root")
    access.set_restricted(config, "bob", True)
    other = str(data / "out.zarr")
    assert read(bob, other) == {404}
    manager.set_admin("bob", True)                                 # admins are never restricted
    assert read(bob, other) == {200}
    manager.set_admin("bob", False)
    assert read(bob, other) == {404}
    manager.remove_user("bob")                                     # their session ends; the entry goes with them
    assert read(bob, other) == {401}
    assert "user:bob" not in atomic_store.read_json(settings.access_path(config))["principals"]
