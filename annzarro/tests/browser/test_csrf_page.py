"""The page works with the CSRF token (server/csrf.py, static/js/utils/csrf.js).

A login server and one headless Chromium: the user signs in through the form (its
double-submit token), saves a panel set, exports and imports it (multipart), deletes
it, asks for a refresh and a cache reset, and signs out through the header badge.
Each call is made by the app's own modules, so it carries the token the way the page
does; a fetch without the header from the same page is refused, and the sets and the
login stay as they were.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import urllib.parse

import pytest

from annzarro.tests.browser.test_session_expiry import (  # noqa: F401  (server is a fixture)
    STORE, _link, _settle, _sign_in, playwright, server)

CALLS = """async () => {
  const { SessionManager } = await import('./static/js/session-manager.js');
  const { DataManager } = await import('./static/js/data-manager.js');
  const out = {};
  out.save = await SessionManager.saveSession('csrf_set');
  const names = async () => (await SessionManager.listSessions(false)).map(s => s.name);
  out.afterSave = await names();
  const file = new File([JSON.stringify({name: 'x', panels: {}, layout: {}})], 'csrf_import.json', {type: 'application/json'});
  out.import = await SessionManager.importSession(file);
  out.refresh = await DataManager.revalidateDataset();
  out.reset = await DataManager.resetBackendCache();
  out.afterImport = await names();
  out.delete = await SessionManager.deleteSession('csrf_set');
  await SessionManager.deleteSession(out.import.name);   // the server's data dir is the repository's
  out.afterDelete = await names();
  return out;
}"""

BARE = """async () => {
  const post = (url, init = {}) => fetch(url, { method: 'POST', ...init }).then(r => r.status);
  return {
    save: await post('api/v1/sessions/save', { headers: {'Content-Type': 'application/json'}, body: '{"name":"forged"}' }),
    reset: await post('api/v1/cache/reset'),
    refresh: await post('api/v1/data/refresh'),
    del: await fetch('api/v1/sessions/delete?name=csrf_set', { method: 'DELETE' }).then(r => r.status),
    logout: await post('logout'),
    me: await fetch('api/v1/auth/me').then(r => r.status),
  };
}"""


def test_the_page_saves_imports_refreshes_and_signs_out(server):
    root, _cli = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(_link(root))
            _sign_in(page, "pw-one")
            _settle(page, lambda s: s["colour"] == "cell_type")
            assert page.evaluate("document.querySelector('meta[name=annzarro-csrf]').content")

            forged = page.evaluate(BARE)
            assert forged == {"save": 403, "reset": 403, "refresh": 403, "del": 403, "logout": 403, "me": 200}, forged

            done = page.evaluate(CALLS)
            assert done["save"]["status"] == "success", done
            assert "csrf_set" in done["afterSave"]
            assert done["import"].get("status") != "error", done["import"]
            assert done["refresh"] is not None, "data/refresh answered"
            # alice is no admin: the refusal is the permission one, so the token got the call through
            assert done["reset"] == {"status": "forbidden", "reason": "admin_only"}, done["reset"]
            assert "csrf_set" not in done["afterDelete"] and done["delete"]["status"] == "success", done

            # the header badge signs out with a POST
            page.click("#auth-indicator")
            page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path.endswith("/login"), timeout=15000)
            assert page.evaluate("fetch('api/v1/auth/me').then(r => r.status)") == 401
            assert not errors, errors
        finally:
            browser.close()


@pytest.fixture
def open_server(tmp_path):
    """A server with login off, as the desktop app runs it."""
    import socket
    import subprocess
    import sys
    import time
    import urllib.request
    from annzarro.tests.browser.test_session_expiry import DATA_DIR, REPO
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = dict(os.environ, ANNZARRO_HOME=str(tmp_path), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(tmp_path), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root
    proc.terminate()
    proc.wait(10)


def test_without_login_the_page_changes_state_with_no_token(open_server):
    """The desktop app: no token, the same-origin headers the browser adds are enough."""
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
            page.goto(_link(open_server))
            _settle(page, lambda s: s["colour"] == "cell_type")
            assert page.evaluate("document.querySelector('meta[name=annzarro-csrf]').content") == ""
            done = page.evaluate(CALLS)
            assert done["save"]["status"] == "success", done
            assert done["refresh"] is not None
            assert done["reset"].get("status") != "error", done["reset"]
            assert "csrf_set" not in done["afterDelete"] and done["delete"]["status"] == "success", done
        finally:
            browser.close()
