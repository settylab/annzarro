"""Admin and ordinary user, end to end, through the real login page.

A hosted server as deployed: gunicorn with the bundled configuration
(gthread), login on, two accounts made with `annzarro user add`
(one --admin). Each signs in through the login form, then:

* user: the header Refresh and Ctrl+R re-check the dataset (POST
  /data/refresh) and never POST /cache/reset; the button says only an admin
  can clear the server's cache; a path outside the data directory is
  refused (403);
* admin: the same presses also POST /cache/reset. A chunk rewritten on disk
  is served stale by BOTH workers before (their caches hold it) and fresh
  by both after the admin's Refresh (each reply's worker is read from the
  gunicorn access log); a path outside the data directory opens
  (server.arbitrary_paths: admins, the default) and the app log names the
  admin;
* `annzarro user set-admin --no-admin` takes effect on the admin's next
  request, without signing in again;
* /api/v1/auth/me reports is_admin and may_open_any_path for each.

Two gunicorn masters (one worker each) share one ANNZARRO_HOME and data
directory, standing in for two workers: the shared generation file must carry
a reset from one process to the other, and the kernel does not promise to
spread new connections over the workers of ONE master, so the test addresses
each process by its own port instead of hoping accept() balances.

Needs Playwright with Chromium and a gunicorn executable (next to this
Python, or ANNZARRO_TEST_GUNICORN); skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where either missing is an error.
"""
import base64
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import pytest

REQUIRED = os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1"
if REQUIRED:
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
TILE = '.tile[data-tile-id="cell-plot-K"] '


def _gunicorn():
    exe = os.environ.get("ANNZARRO_TEST_GUNICORN") or os.path.join(os.path.dirname(sys.executable), "gunicorn")
    if os.path.exists(exe):
        return exe
    if REQUIRED:
        pytest.fail(f"gunicorn not found at {exe} (set ANNZARRO_TEST_GUNICORN)")
    pytest.skip("gunicorn not installed")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    def __init__(self, root, env, urls, access_logs, app_log, store, outside):
        self.root, self.env, self.urls = root, env, urls
        self.url = urls[0]                        # the browser talks to the first
        self.access_logs, self.app_log = access_logs, app_log
        self.store, self.outside = store, outside

    def cli(self, *args):
        subprocess.run([sys.executable, "-m", "annzarro.cli", "user", *args], env=self.env, cwd=REPO,
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def read(self, path, cookie, instance=0, **query):
        """GET on a fresh connection to one gunicorn instance; returns
        (worker pid, status, JSON body)."""
        access_log = self.access_logs[instance]
        mark = os.path.getsize(access_log)
        req = urllib.request.Request(f"{self.urls[instance]}{path}?{urllib.parse.urlencode(query)}",
                                     headers={"Cookie": cookie, "Connection": "close"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                status, body = resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as err:
            status, body = err.code, json.loads(err.read() or b"{}")
        for _ in range(50):                       # the access line follows the reply
            with open(access_log, encoding="utf-8", errors="replace") as f:
                f.seek(mark)
                lines = [ln for ln in f.read().splitlines() if f" {path} " in ln]
            if lines:
                return int(lines[-1].split()[0].strip("<>")), status, body
            time.sleep(0.05)
        raise AssertionError(f"no access-log line for {path}")


@pytest.fixture
def server(tmp_path):
    gunicorn = _gunicorn()
    data, outside = tmp_path / "data", tmp_path / "outside"
    data.mkdir()
    outside.mkdir()
    store = data / "store.zarr"
    shutil.copytree(FIXTURE, store)
    shutil.copytree(FIXTURE, outside / "secret.zarr")
    port, port2 = _free_port(), _free_port()
    site = tmp_path / "site.yaml"
    site.write_text(f"""server:
  host: 127.0.0.1
  port: {port}
  data_dir: "{data}"
  log_file: "{tmp_path / 'app.log'}"
  workers: 1
  threads: 2
  refresh_min_interval_s: 0
auth:
  user_file: "{tmp_path / 'users.json'}"
""")
    env = dict(os.environ, ANNZARRO_CONFIG=str(site), ANNZARRO_HOME=str(tmp_path / "home"),
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""), PYTHONUNBUFFERED="1")
    ports = [port, port2]
    srv = Server(tmp_path, env, [f"http://127.0.0.1:{p}" for p in ports],
                 [tmp_path / "access.log", tmp_path / "access2.log"], tmp_path / "app.log",
                 str(store), str(outside / "secret.zarr"))
    srv.cli("add", "--username", "alice", "--password", "alice-pw")
    srv.cli("add", "--username", "root", "--password", "root-pw", "--admin")
    procs, logs = [], []
    try:
        for p, log in zip(ports, srv.access_logs):
            access = open(log, "w")
            logs.append(access)
            procs.append(subprocess.Popen([gunicorn, "-c", "python:annzarro.server.gunicorn_config",
                                           "--bind", f"127.0.0.1:{p}", "--workers", "1",
                                           "--access-logformat", "%(p)s %(m)s %(U)s %(s)s",
                                           "annzarro.server.wsgi:create_wsgi_app()"],
                                          env=env, cwd=str(tmp_path), stdout=access, stderr=subprocess.STDOUT))
        for url, proc, log in zip(srv.urls, procs, srv.access_logs):
            for _ in range(160):
                try:
                    urllib.request.urlopen(url + "/login", timeout=1)
                    break
                except OSError:
                    if proc.poll() is not None:
                        pytest.fail("gunicorn exited: " + log.read_text()[-2000:])
                    time.sleep(0.25)
            else:
                pytest.fail("gunicorn did not start")
        yield srv
    finally:
        for proc in procs:                        # this test's own masters, by PID
            proc.terminate()
        for proc in procs:
            proc.wait(15)
        for access in logs:
            access.close()


def _link(srv):
    plot = {"id": "cell-plot-K",
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "z": None,
            "color": {"type": "obs", "key": "cell_type", "column": ""}}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-K", "controlsVisible": True}],
                               "controlState": {"cell-plot-K": True}, "panelConfigs": {"cell-plot-K": plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{srv.url}/?dataset_path={urllib.parse.quote(srv.store, safe='/')}#view={payload}"


DRAWN = """() => {
  const g = document.querySelector('.tile[data-tile-id="cell-plot-K"] .js-plotly-plot');
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')]
      .filter(e => e.offsetParent !== null).length;
  return !!(g && g.data && g.data.length) && !busy;
}"""


def _settle(page, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        if page.evaluate(DRAWN):
            page.wait_for_timeout(500)
            return
        page.wait_for_timeout(200)
    pytest.fail("plot did not settle")


def _sign_in(browser, srv, username, password):
    context = browser.new_context(viewport={"width": 1400, "height": 900})
    page = context.new_page()
    errors, posts = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: posts.append(urllib.parse.urlsplit(r.url).path) if r.method == "POST" else None)
    page.goto(_link(srv))
    page.wait_for_selector("#username")
    page.fill("#username", username)
    page.fill("#password", password)
    page.click("button[type=submit]")
    _settle(page)
    cookie = "; ".join(f"{c['name']}={c['value']}" for c in context.cookies())
    return context, page, posts, errors, cookie


def _fetch(page, path, **query):
    return page.evaluate("""async ([path, query]) => {
        const r = await fetch(path + '?' + new URLSearchParams(query));
        return {status: r.status, body: await r.json().catch(() => null)};
    }""", [path.lstrip("/"), query])


def _refresh(page, how):
    """Press the header Refresh (or Ctrl+R) and wait for its re-check."""
    with page.expect_response(lambda r: r.request.method == "POST" and "/api/v1/data/refresh" in r.url,
                              timeout=30000):
        if how == "button":
            page.click("#refresh-dataset")
        else:
            page.locator("body").click(position={"x": 5, "y": 5})
            page.keyboard.press("Control+r")
    page.wait_for_timeout(1500)                   # the reset (admin) and the reload follow
    _settle(page)


def _per_worker(srv, cookie):
    """total_counts[0] as each gunicorn process serves it, {pid: {values}}:
    one fresh connection to each instance's own port, so every process is
    reached deterministically."""
    seen = {}
    for instance in range(len(srv.urls)):
        pid, status, body = srv.read("/api/v1/data/obs", cookie, instance, dataset_path=srv.store,
                                     rows="0", columns="total_counts")
        assert status == 200, body
        seen.setdefault(pid, set()).add(body["data"]["total_counts"][0])
    assert len(seen) == len(srv.urls), f"replies came from {sorted(seen)} only"
    return seen


def test_admin_and_user_through_the_login_page(server):
    srv = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            # --- the user -------------------------------------------------
            ctx, page, posts, errors, _ = _sign_in(browser, srv, "alice", "alice-pw")
            me = _fetch(page, "api/v1/auth/me")["body"]
            assert (me["username"], me["is_admin"], me["may_open_any_path"]) == ("alice", False, False)
            assert "only an admin" in page.get_attribute("#refresh-dataset", "title")
            for how in ("button", "ctrl+r"):
                _refresh(page, how)
            assert posts.count("/api/v1/data/refresh") >= 2
            assert "/api/v1/cache/reset" not in posts, posts
            refused = _fetch(page, "api/v1/data/info", dataset_path=srv.outside)
            assert refused["status"] == 403 and refused["body"]["reason"] == "outside_data_dir"
            assert not errors, errors
            ctx.close()

            # --- the admin ------------------------------------------------
            ctx, page, posts, errors, cookie = _sign_in(browser, srv, "root", "root-pw")
            me = _fetch(page, "api/v1/auth/me")["body"]
            assert (me["username"], me["is_admin"], me["may_open_any_path"]) == ("root", True, True)
            assert "clear the server's cache" in page.get_attribute("#refresh-dataset", "title")

            before = _per_worker(srv, cookie)                  # warms both workers' caches
            (old,) = {v for values in before.values() for v in values}
            import zarr
            zarr.open_group(srv.store, mode="r+", use_consolidated=False)["obs/total_counts"][0] = old + 1000
            stale = _per_worker(srv, cookie)
            assert all(values == {old} for values in stale.values()), \
                f"a chunk write is served from each worker's cache until a refresh: {stale}"

            _refresh(page, "button")
            assert "/api/v1/cache/reset" in posts, posts
            fresh = _per_worker(srv, cookie)
            assert all(values == {old + 1000} for values in fresh.values()), \
                f"after the admin's Refresh every worker serves the new chunk: {fresh}"

            posts.clear()
            _refresh(page, "ctrl+r")
            assert "/api/v1/data/refresh" in posts and "/api/v1/cache/reset" in posts, posts

            opened = _fetch(page, "api/v1/data/info", dataset_path=srv.outside)
            assert opened["status"] == 200, opened
            log = srv.app_log.read_text(errors="replace")
            assert re.search(r"Admin 'root' opened a path outside the data directory: '.*secret\.zarr'", log)

            # --- admin revoked: the next request, no new login ------------
            srv.cli("set-admin", "--username", "root", "--no-admin")
            me = _fetch(page, "api/v1/auth/me")["body"]
            assert (me["username"], me["is_admin"], me["may_open_any_path"]) == ("root", False, False)
            refused = _fetch(page, "api/v1/data/info", dataset_path=srv.outside)
            assert refused["status"] == 403 and refused["body"]["reason"] == "outside_data_dir"
            assert _fetch(page, "api/v1/data/info", dataset_path=srv.store)["status"] == 200
            assert not errors, errors
            ctx.close()
        finally:
            browser.close()
