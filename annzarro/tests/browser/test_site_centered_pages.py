"""The sign-in and sign-out cards keep their own width when the site footer is on.

A hosted server always has a footer (About · Data & privacy), and its pages get
``body.site-centered`` (theme.css). That rule must centre the card above the footer and leave
its width to the page: the sign-in card is at most 400 px (login.html), the sign-out card as
wide as its text. At 1440 and 390 px, in Chromium and WebKit.

Screenshots go to ANNZARRO_SHOTS when it is set (taken before the checks, so a failing run
leaves its picture too).

Needs Playwright; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SHOTS = os.environ.get("ANNZARRO_SHOTS")
LOGIN_MAX = 400       # .login-container { max-width: 400px } in login.html

SERVE = """
import sys
from pathlib import Path
from werkzeug.serving import run_simple
from annzarro.tests.server.admin_helpers import make_app
run_simple("127.0.0.1", int(sys.argv[2]), make_app(Path(sys.argv[1]), auth=True), threaded=True)
"""


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def hosted(tmp_path_factory):
    root = tmp_path_factory.mktemp("centered")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(root / "home"), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
    proc = subprocess.Popen([sys.executable, "-c", SERVE, str(root), str(port)], env=env, cwd=REPO,
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    for _ in range(160):
        try:
            urllib.request.urlopen(url + "/site/data", timeout=1)
            break
        except OSError:
            if proc.poll() is not None:
                break
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield url
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module", params=["chromium", "webkit"])
def browser(request):
    with playwright.sync_playwright() as p:
        b = getattr(p, request.param).launch()
        yield request.param, b
        b.close()


BOXES = """(selector) => {
  const box = (el) => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; };
  const card = document.querySelector(selector);
  return {card: box(card), footer: box(document.getElementById('site-footer')), vw: innerWidth,
          widest: Math.max(...[...card.querySelectorAll('input, button')].map((e) => e.getBoundingClientRect().width)),
          overflow: document.documentElement.scrollWidth - innerWidth};
}"""


def _measure(browser, url, path, selector, width, height):
    engine, b = browser
    context = b.new_context(viewport={"width": width, "height": height})
    page = context.new_page()
    page.goto(url + path)
    page.wait_for_selector("#site-footer")
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, f"{path.strip('/')}-{engine}-{width}.png"))
    boxes = page.evaluate(BOXES, selector)
    context.close()
    return boxes


@pytest.mark.parametrize("width, height", [(1440, 900), (390, 844)])
def test_the_sign_in_card_keeps_its_width_above_the_footer(browser, hosted, width, height):
    b = _measure(browser, hosted, "/login", ".login-container", width, height)
    card = b["card"]
    assert card["w"] <= LOGIN_MAX + 0.5, f"the card is {card['w']} px wide"
    assert card["w"] <= width and b["overflow"] <= 0
    if width >= LOGIN_MAX:
        assert card["w"] >= min(LOGIN_MAX, width) - 0.5, "and fills its 400 px where there is room"
    assert abs(card["x"] + card["w"] / 2 - width / 2) < 2, "centred"
    assert b["widest"] <= card["w"], "the inputs and the button stay inside the card"
    assert card["y"] + card["h"] <= b["footer"]["y"] + 0.5, "above the footer"


@pytest.mark.parametrize("width, height", [(1440, 900), (390, 844)])
def test_the_sign_out_card_is_as_wide_as_its_text(browser, hosted, width, height):
    b = _measure(browser, hosted, "/logout", "main", width, height)
    card = b["card"]
    assert card["w"] <= min(width, 520), f"the card is {card['w']} px wide"
    assert b["overflow"] <= 0
    assert abs(card["x"] + card["w"] / 2 - width / 2) < 2, "centred"
    assert card["y"] + card["h"] <= b["footer"]["y"] + 0.5, "above the footer"
