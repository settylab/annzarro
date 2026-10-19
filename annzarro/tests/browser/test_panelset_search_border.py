"""The search box in Load Panel Set draws one border, in WebKit as well as Chromium.

The icon, the input and the clear button used to carry joined borders: the right edge stayed open while the
clear button was hidden, and the left edge was darker than the top and bottom. The group now owns the single
border and its children have none.

Needs Playwright with WebKit and Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")

STYLES = """() => {
    const q = s => getComputedStyle(document.querySelector(s));
    const side = (s, k) => ['Top', 'Right', 'Bottom', 'Left'].map(e => q(s)['border' + e + k]);
    const kids = ['.session-search-container .input-group-text', '#session-search', '#session-search-clear'];
    return {
        appearance: q('#session-search').appearance,
        width: side('.session-search-container .input-group', 'Width'),
        style: side('.session-search-container .input-group', 'Style'),
        color: side('.session-search-container .input-group', 'Color'),
        radius: q('.session-search-container .input-group').borderTopLeftRadius,
        kids: kids.map(s => side(s, 'Width').join(' ')),
    };
}"""


@pytest.fixture
def server(tmp_path):
    (tmp_path / "home").mkdir()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = dict(os.environ, ANNZARRO_HOME=str(tmp_path / "home"), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--auth-disabled", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", DATA_DIR, "--no-browser"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for i in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(min(0.5, 0.1 * (i + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.mark.parametrize("engine", ["webkit", "chromium"])
@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_panel_set_search_has_one_border_on_the_group(server, engine, scheme):
    with playwright.sync_playwright() as p:
        try:
            browser = getattr(p, engine).launch()
        except Exception as exc:   # engine not installed
            if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
                raise
            pytest.skip(f"{engine} unavailable: {exc}")
        try:
            page = browser.new_context(viewport={"width": 1200, "height": 800}, color_scheme=scheme,
                                       device_scale_factor=2).new_page()
            page.goto(server)
            page.wait_for_function("() => document.querySelector('.app-title')", timeout=30000)
            page.evaluate("() => new bootstrap.Modal(document.getElementById('session-modal')).show()")
            page.wait_for_selector("#session-modal.show")
            page.wait_for_timeout(500)
            st = page.evaluate(STYLES)
            assert st["appearance"] == "none"
            assert st["width"] == ["1px"] * 4 and st["style"] == ["solid"] * 4
            assert len(set(st["color"])) == 1 and st["color"][0] != "rgba(0, 0, 0, 0)"
            assert st["radius"] == "8px"
            assert st["kids"] == ["0px 0px 0px 0px"] * 3   # no joined borders inside the group
            page.focus("#session-search")
            focus = page.evaluate("""() => {
                const g = getComputedStyle(document.querySelector('.session-search-container .input-group'));
                return [g.borderTopColor, g.borderBottomColor, g.borderLeftColor, g.borderRightColor, g.boxShadow];
            }""")
            assert len(set(focus[:4])) == 1 and focus[0] != st["color"][0]   # the whole outline changes
            assert "0.25rem" in focus[4] or "4px" in focus[4]
        finally:
            browser.close()
