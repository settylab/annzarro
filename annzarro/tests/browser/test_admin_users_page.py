"""The Users and Audit sections of /admin and the change-password page, in a browser.

A hosted server as deployed (gunicorn, gthread, login on). An admin signs in
through the login form and uses the page: adds a user and sees the generated
password once, signs that user in from a second context, resets another
user's password (their open tab loses its login), grants and revokes admin,
unlocks a locked account, removes a user, finds all of it in the Audit
section, and cannot remove or demote itself. A user changes their own
password on /account/password. No console errors or CSP violations anywhere.

Needs Playwright with Chromium and a gunicorn executable; skipped otherwise,
unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where either missing is an error.
"""
import http.cookiejar
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

REQUIRED = os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1"
if REQUIRED:
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))


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
    def __init__(self, url, env, tmp):
        self.url, self.env, self.tmp = url, env, tmp

    def cli(self, *args):
        subprocess.run([sys.executable, "-m", "annzarro.cli", "user", *args], env=self.env, cwd=REPO,
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


@pytest.fixture
def server(tmp_path):
    gunicorn = _gunicorn()
    data = tmp_path / "data"
    data.mkdir()
    port = _free_port()
    site = tmp_path / "site.yaml"
    site.write_text(f"""server:
  host: 127.0.0.1
  port: {port}
  data_dir: "{data}"
  log_file: "{tmp_path / 'app.log'}"
  workers: 1
  threads: 4
auth:
  user_file: "{tmp_path / 'users.json'}"
""")
    env = dict(os.environ, ANNZARRO_CONFIG=str(site), ANNZARRO_HOME=str(tmp_path / "home"),
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""), PYTHONUNBUFFERED="1")
    srv = Server(f"http://127.0.0.1:{port}", env, tmp_path)
    srv.cli("add", "--username", "root", "--password", "root-password-1", "--admin")
    srv.cli("add", "--username", "alice", "--password", "alice-password-1")
    srv.cli("add", "--username", "bob", "--password", "bob-password-12")
    log = open(tmp_path / "gunicorn.log", "w")
    proc = subprocess.Popen([gunicorn, "-c", "python:annzarro.server.gunicorn_config", "--bind", f"127.0.0.1:{port}",
                             "--workers", "1", "annzarro.server.wsgi:create_wsgi_app()"],
                            env=env, cwd=str(tmp_path), stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(160):
            try:
                urllib.request.urlopen(srv.url + "/login", timeout=1)
                break
            except OSError:
                if proc.poll() is not None:
                    pytest.fail("gunicorn exited: " + (tmp_path / "gunicorn.log").read_text()[-2000:])
                time.sleep(0.25)
        else:
            pytest.fail("gunicorn did not start")
        yield srv
    finally:
        proc.terminate()                          # this test's own master, by PID
        proc.wait(15)
        log.close()


class Tab:
    """A browser context with one page that records console errors and failed requests."""

    def __init__(self, browser, srv):
        self.srv = srv
        self.context = browser.new_context(viewport={"width": 1400, "height": 900})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else None)

    def sign_in(self, username, password, to="/"):
        self.page.goto(self.srv.url + "/login")
        self.page.fill("#username", username)
        self.page.fill("#password", password)
        with self.page.expect_navigation():
            self.page.click("button[type=submit]")
        if to != "/":
            self.page.goto(self.srv.url + to)
        return self

    def status(self, path):
        # the context's request API shares the cookies but not the page, which navigates away
        # to the login page when one of its own requests meets a revoked login
        return self.context.request.get(self.srv.url + "/" + path.lstrip("/")).status


def _wrong_password(url, username):
    """One wrong sign-in as the form sends it: the form's token and cookie come back with the
    password (csrf.py), else the server refuses the post before it counts as a guess."""
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    page = opener.open(url + "/login", timeout=20).read().decode()
    token = re.search(r'name="login_csrf" value="([^"]+)"', page).group(1)
    data = f"username={username}&password=wrong&login_csrf={token}".encode()
    try:
        opener.open(urllib.request.Request(url + "/login", data=data), timeout=20).read()
    except urllib.error.HTTPError:
        pass


def _row(page, name):
    return page.locator("#admin-main tbody tr").filter(has=page.locator("td", has_text=name)).first


def _action(page, name, action):
    return _row(page, name).locator(f'button[data-action="{action}"]')


def _wait_table(page):
    page.wait_for_selector("#admin-main tbody tr")


def test_the_users_section_end_to_end(server):
    srv = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            admin = Tab(browser, srv).sign_in("root", "root-password-1", "/admin#users")
            page = admin.page
            _wait_table(page)
            assert page.locator("h2").first.inner_text() == "Users (3)"

            # the last admin (and the signed-in one) cannot be removed or demoted
            root_row = _row(page, "root")
            assert "(you)" in root_row.inner_text()
            for action in ("revoke-admin", "remove"):
                button = _action(page, "root", action)
                assert button.is_disabled() and "Your own account" in button.get_attribute("title")
            forced = page.evaluate("""async () => {
                const token = document.querySelector('meta[name="annzarro-csrf"]').content;
                const r = await fetch('api/v1/admin/users/root/admin', {method: 'POST',
                    headers: {'Content-Type': 'application/json', 'X-AnnZarro-CSRF': token},
                    body: JSON.stringify({is_admin: false})});
                return [r.status, (await r.json()).reason];
            }""")
            assert forced == [409, "self"]

            # add a user with a generated password: shown once
            page.click('button[data-action="add"]')
            page.fill("#add-username", "carol")
            page.click("#add-submit")
            page.wait_for_selector("#users-secret-value")
            secret = page.inner_text("#users-secret-value")
            assert len(secret) >= 16 and "Shown once" in page.inner_text("#users-secret")
            assert "carol" in page.inner_text("#users-secret")
            carol = Tab(browser, srv).sign_in("carol", secret)
            assert carol.status("api/v1/auth/me") == 200 and carol.status("api/v1/admin/users") == 403
            page.click('button[data-action="dismiss-secret"]')
            assert page.locator("#users-secret").count() == 0
            page.reload()
            _wait_table(page)
            assert secret not in page.content()
            assert page.locator("h2").first.inner_text() == "Users (4)"

            # grant admin: carol reaches the admin API on her next request
            _action(page, "carol", "make-admin").click()
            page.wait_for_selector('tr:has-text("carol") button[data-action="revoke-admin"]')
            assert carol.status("api/v1/admin/users") == 200
            _action(page, "carol", "revoke-admin").click()
            page.wait_for_selector('tr:has-text("carol") button[data-action="make-admin"]')
            assert carol.status("api/v1/admin/users") == 403

            # reset another user's password: their open tab loses its login
            alice = Tab(browser, srv).sign_in("alice", "alice-password-1")
            assert alice.status("api/v1/auth/me") == 200
            _action(page, "alice", "reset").click()
            page.click("#reset-submit")
            page.wait_for_selector("#users-secret-value")
            new_password = page.inner_text("#users-secret-value")
            assert alice.status("api/v1/auth/me") == 401
            Tab(browser, srv).sign_in("alice", new_password)
            page.click('button[data-action="dismiss-secret"]')

            # lock bob with wrong passwords, then unlock him
            for _ in range(5):
                _wrong_password(srv.url, "bob")
            page.reload()
            _wait_table(page)
            assert "1 address" in _row(page, "bob").inner_text()
            _action(page, "bob", "unlock").click()
            page.wait_for_function("() => !document.body.innerText.includes('1 address')")
            Tab(browser, srv).sign_in("bob", "bob-password-12")

            # remove carol, who has no panel sets: no hand-over choice is offered
            _action(page, "carol", "remove").click()
            assert page.locator("#remove-reassign").count() == 0
            page.click("#remove-submit")
            page.wait_for_function("() => document.querySelector('h2').innerText === 'Users (3)'")
            assert carol.status("api/v1/auth/me") == 401

            # the Audit section shows all of it, newest first, with the chain intact
            page.click('a[href="#audit"]')
            page.wait_for_selector("#admin-main tbody tr code")
            text = page.inner_text("#admin-main")
            assert "Chain verified OK" in text
            for action in ("user.add", "user.set_admin", "user.password", "user.unlock", "user.remove"):
                assert action in text, action
            assert "refused:self" in text
            assert secret not in text and new_password not in text
            # the only console error is the forced 409 above: no CSP violation, no script error
            assert [e for e in admin.errors if "409" not in e] == [], admin.errors
        finally:
            browser.close()


def test_a_plain_user_sees_the_403_page_at_admin(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            tab = Tab(browser, server)
            tab.sign_in("alice", "alice-password-1")
            response = tab.page.goto(server.url + "/admin")
            assert response.status == 403
            assert "needs an administrator" in tab.page.inner_text("body")
        finally:
            browser.close()


def test_change_password_page(server):
    srv = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            mine = Tab(browser, srv).sign_in("alice", "alice-password-1", "/account/password")
            other = Tab(browser, srv).sign_in("alice", "alice-password-1")
            page = mine.page
            assert page.inner_text("#account-user") == "alice"

            def submit(current, new, again=None):
                page.fill("#account-current", current)
                page.fill("#account-new", new)
                page.fill("#account-confirm", new if again is None else again)
                page.click("#account-submit")

            submit("alice-password-1", "short")
            assert "at least 10" in page.inner_text("#account-message")
            submit("alice-password-1", "a long enough new one", "something else entirely")
            assert "differ" in page.inner_text("#account-message")
            submit("not-my-password", "a long enough new one")
            page.wait_for_function("() => document.getElementById('account-message').innerText.includes('not your current')")
            submit("alice-password-1", "a long enough new one")
            page.wait_for_function("() => document.getElementById('account-message').innerText.includes('was changed')")
            assert mine.status("api/v1/auth/me") == 200, "this login stays"
            assert other.status("api/v1/auth/me") == 401, "the other login ends"
            Tab(browser, srv).sign_in("alice", "a long enough new one")
            # five wrong guesses lock the address out, the right password included
            for _ in range(5):
                submit("wrong-again", "yet another long one")
                page.wait_for_function("() => !document.getElementById('account-submit').disabled")
            submit("a long enough new one", "yet another long one")
            page.wait_for_function("() => document.getElementById('account-message').innerText.includes('Too many')")
            assert [e for e in mine.errors if "status of 4" not in e] == [], mine.errors   # refusals are logged by the browser
        finally:
            browser.close()
