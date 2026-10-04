"""Nothing the app logs to the console carries a data series.

A browser keeps every object passed to console.log (so DevTools can show it
when opened later). data-manager.js logged each obsm reply whole, so every
embedding column loaded stayed in memory for good: a 4M <-> 100k subset swap
on the 5M Tahoe store left the V8 heap 66 MB higher each time, without
bound (v0.2.0: 131 MB; annzarro-paper benchmark/scale/results/
memguard_swap.jsonl). A heap snapshot traced the retained 1M-value arrays to
"DevTools console" global handles, as {data: [...]} replies.

On the 200-cell fixture, this opens a Cell Plot, swaps the subset back and
forth, recolours and opens a table, and fails when any console message
carries an array (or an object's array) of 100 or more elements.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import _drawn, _link, _serve  # noqa: E402

BIG = 100

# the largest array a console argument carries, itself or one property deep
SIZE_OF = """v => {
    const len = x => (Array.isArray(x) || ArrayBuffer.isView(x)) ? x.length : 0;
    if (!v || typeof v !== 'object') return 0;
    let m = len(v);
    if (!m) for (const k of Object.keys(v).slice(0, 50)) m = Math.max(m, len(v[k]));
    return m;
}"""


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


def test_no_logged_series(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 1000})
            messages = []
            page.on("console", lambda m: messages.append(m))
            page.goto(_link(server))
            _drawn(page, "cell-plot-a")
            for n in (150, 50, 200, 100):
                page.click("#subset-button")
                page.wait_for_selector("#subset-apply", state="visible")
                if n == 200:
                    page.click("#subset-preset-all")
                else:
                    if not page.is_checked("#subset-enabled"):
                        page.click("#subset-enabled")
                    page.fill("#subset-n", str(n))
                page.wait_for_function("() => !document.getElementById('subset-apply').disabled")
                page.click("#subset-apply")
                page.wait_for_selector("#subset-modal", state="hidden")
                page.wait_for_timeout(1500)
            offenders = []
            for m in messages:
                for arg in m.args:
                    try:
                        size = arg.evaluate(SIZE_OF)
                    except Exception:      # noqa: BLE001 - a handle gone with its context
                        continue
                    if size >= BIG:
                        offenders.append(f"{m.text[:80]!r} carries {size} elements")
            assert not offenders, offenders
        finally:
            browser.close()
