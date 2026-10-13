"""A hosted gunicorn server with several workers, and a signed-in HTTP client for it.

The admin tests of slice 6 change things through the real admin API and then
ask every worker. The client signs in through the login page and reads the CSRF
token from the admin page, as the browser does, so it keeps working when the
login form grows a token of its own.
"""
import http.cookiejar
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import pytest

from annzarro.server.auth import AuthManager

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
PASSWORD = "correct horse battery"


def gunicorn_executable():
    exe = os.environ.get("ANNZARRO_TEST_GUNICORN") or os.path.join(os.path.dirname(sys.executable), "gunicorn")
    if os.path.exists(exe):
        return exe
    if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
        pytest.fail(f"gunicorn not found at {exe} (set ANNZARRO_TEST_GUNICORN)")
    pytest.skip("gunicorn not installed")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Reply:
    def __init__(self, status, headers, body):
        self.status = status
        self.headers = headers
        self.body = body

    def json(self):
        return json.loads(self.body)


class Client:
    """A cookie jar and the admin CSRF token, over urllib (no keep-alive: each
    request is a new connection, which the kernel spreads over the workers)."""

    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = None

    def request(self, method, path, body=None, headers=None, form=None):
        data, head = None, dict(headers or {})
        if body is not None:
            data = json.dumps(body).encode()
            head["Content-Type"] = "application/json"
        elif form is not None:
            data = urllib.parse.urlencode(form).encode()
        if method != "GET":
            head.setdefault("Origin", self.base)
            if self.csrf:
                head.setdefault("X-AnnZarro-CSRF", self.csrf)
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=head)
        try:
            with self.opener.open(req, timeout=30) as response:
                return Reply(response.status, response.headers, response.read())
        except urllib.error.HTTPError as error:
            return Reply(error.code, error.headers, error.read())

    def get(self, path):
        return self.request("GET", path)

    def post(self, path, body):
        return self.request("POST", path, body)

    def put(self, path, body):
        return self.request("PUT", path, body)

    def delete(self, path, body):
        return self.request("DELETE", path, body)

    def sign_in(self, username, admin_page=False):
        """Sign in through the login form (its hidden fields are sent back as
        they are). ``admin_page`` also reads the CSRF token the admin API needs."""
        page = self.get("/login").body.decode()
        form = {name: value for name, value in re.findall(
            r'<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', page)}
        form.update(username=username, password=PASSWORD)
        self.request("POST", "/login", form=form)
        me = self.get("/api/v1/auth/me").json()
        assert me.get("username") == username, f"login of {username} failed: {me}"
        if admin_page:
            html = self.get("/admin").body.decode()
            token = re.search(r'name="annzarro-csrf"\s+content="([^"]+)"', html)
            assert token, "the admin page has no CSRF token"
            self.csrf = token.group(1)
        return self


class Cluster:
    """The pieces a test needs of a running server."""

    def __init__(self, url, tmp_path, parent, users_file, env=None):
        self.env = env
        self.url = url
        self.tmp_path = tmp_path
        self.parent = parent
        self.users_file = users_file
        self.admin_dir = os.path.join(os.path.dirname(users_file), "annzarro_admin")

    def cli(self, *args):
        """Run ``annzarro <args>`` as the server's account, on the server's configuration."""
        done = subprocess.run([sys.executable, "-m", "annzarro.cli", *args], env=self.env, cwd=REPO,
                              capture_output=True, text=True, timeout=120)
        assert done.returncode == 0, (args, done.stdout[-500:], done.stderr[-1500:])
        return done

    def client(self, username, admin_page=False):
        return Client(self.url).sign_in(username, admin_page=admin_page)


def start_cluster(tmp_path, workers=2, extra_server="", users=(("root", True), ("alice", False)), procs=None):
    """Start gunicorn with ``workers`` workers on a fresh data directory, an
    ``atlases`` parent holding ``lab2/cells.zarr``, and the given users."""
    gunicorn = gunicorn_executable()
    data, parent = tmp_path / "data", tmp_path / "atlases"
    data.mkdir()
    shutil.copytree(FIXTURE, data / "home.zarr")
    (parent / "lab2").mkdir(parents=True)
    shutil.copytree(FIXTURE, parent / "lab2" / "cells.zarr")
    users_dir = tmp_path / "users"
    users_dir.mkdir()
    users_file = str(users_dir / "users.json")
    manager = AuthManager(user_file=users_file)
    for name, is_admin in users:
        manager.create_user(name, PASSWORD, is_admin=is_admin)
    site = tmp_path / "site.yaml"
    site.write_text(f"""server:
  host: 127.0.0.1
  data_dir: "{data}"
  log_file: "{tmp_path / 'app.log'}"
  workers: {workers}
  threads: 2
  admin_rate_per_minute: 1000
  admin_data_roots: ["{parent}"]
{extra_server}auth:
  user_file: "{users_file}"
""")
    env = dict(os.environ, ANNZARRO_CONFIG=str(site), ANNZARRO_HOME=str(tmp_path / "home"),
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""), PYTHONUNBUFFERED="1")
    port = free_port()
    log = open(tmp_path / "gunicorn.log", "w")
    proc = subprocess.Popen(
        [gunicorn, "-c", "python:annzarro.server.gunicorn_config", "--bind", f"127.0.0.1:{port}",
         "--workers", str(workers), "annzarro.tests.server.admin_wsgi:create_wsgi_app()"],
        env=env, cwd=str(tmp_path), stdout=log, stderr=subprocess.STDOUT)
    if procs is not None:
        procs.append((proc, log))
    url = f"http://127.0.0.1:{port}"
    for _ in range(160):
        try:
            urllib.request.urlopen(url + "/login", timeout=1)
            break
        except OSError:
            if proc.poll() is not None:
                pytest.fail("gunicorn exited: " + (tmp_path / "gunicorn.log").read_text()[-2000:])
            time.sleep(0.25)
    else:
        pytest.fail("gunicorn did not start")
    return Cluster(url, tmp_path, parent, users_file, env)


def stop_all(procs):
    """Stop this test's own masters, by PID."""
    for proc, _ in procs:
        proc.terminate()
    for proc, log in procs:
        proc.wait(15)
        log.close()
