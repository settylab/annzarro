"""Layout size changes ease over about 180 ms, and end where they ended before.

A split opening, its chooser growing the row, the chosen panel shrinking it
back and a pane closing are animated by layout-motion.js. Per direction, one
headless Chromium session with motion and one with prefers-reduced-motion
(where nothing animates, i.e. the layout as it was) run split -> choose a cell
plot -> close. Checks:

* every row, pane and tile ends at the same size in both (+- 1 px), with the
  same scroll position, and no inline style is left behind;
* with motion the row passes through intermediate heights and settles within
  half a second; with reduced motion it jumps straight to the new height;
* Plotly relayouts stay at most two per step (the new plot's first fit and the
  neighbour's), however many frames the transition has: the plots fit once
  at the end, not per frame.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import os
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import STORE, _serve  # noqa: E402


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


# Count relayouts, and sample the first row's height and first tile's width on every frame
WATCH = """() => {
  window.__relayouts = 0;
  const r = Plotly.relayout;
  Plotly.relayout = function (...a) { window.__relayouts++; return r.apply(this, a); };
  window.__frames = [];
  const tick = () => {
    const w = document.querySelector('.tile-container > .panel-wrapper');
    const t = document.querySelector('.tile[data-tile-id]');
    window.__frames.push([performance.now(), w ? w.getBoundingClientRect().height : 0,
                          t ? t.getBoundingClientRect().width : 0]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}"""

SIZES = """() => ({
  boxes: [...document.querySelectorAll('.tile-container > .panel-wrapper, .split-pane, .tile[data-tile-id], .tile-selector')]
    .map(e => { const r = e.getBoundingClientRect(); return [e.className.split(' ')[0], r.width, r.height]; }),
  scroll: document.querySelector('.tile-container').scrollTop,
  inline: [...document.querySelectorAll('.panel-wrapper, .split-pane, .split-pane > *')]
    .filter(e => e.style.transition || e.style.maxWidth || e.style.minWidth || e.style.maxHeight
                 || (e.classList.contains('panel-wrapper') && e.style.height)).length,
})"""


def run(browser, root, direction, reduced):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900},
                              reduced_motion="reduce" if reduced else "no-preference")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}")
        page.locator(".tile-selector .panel-type-option[data-type='cell-plot']").first.click(timeout=30000)
        page.wait_for_selector(".tile[data-tile-id] .js-plotly-plot", timeout=30000)
        page.wait_for_timeout(1500)
        page.evaluate(WATCH)
        steps = {}

        def step(name, action, ready=None):
            page.evaluate("() => { window.__relayouts = 0; window.__frames.length = 0; }")
            t0 = page.evaluate("() => performance.now()")
            action()
            if ready:
                page.wait_for_function(ready, timeout=30000)
            page.wait_for_timeout(1500)
            frames = [(t - t0, h, w) for t, h, w in page.evaluate("() => window.__frames")]
            steps[name] = {"relayouts": page.evaluate("() => window.__relayouts"), "frames": frames,
                           **page.evaluate(SIZES)}

        step("split", lambda: page.locator(f".tile[data-tile-id] .tile-split-{direction}").first.click())
        step("choose", lambda: page.locator(
            ".split-pane > .tile-selector .panel-type-option[data-type='cell-plot']").first.click(),
            "document.querySelectorAll('.tile[data-tile-id] .js-plotly-plot').length >= 2")
        step("close", lambda: page.locator(".tile[data-tile-id] .tile-close").last.click())
        assert not errors, errors
        return steps
    finally:
        ctx.close()


def between(frames, a, b, i=1):
    """Times of the frames whose height (i=1) or width (i=2) is strictly between a and b"""
    lo, hi = min(a, b), max(a, b)
    return [f[0] for f in frames if lo + 2 < f[i] < hi - 2]


@pytest.mark.parametrize("direction", ["h", "v"])
def test_split_motion_ends_where_layout_did(server, browser, direction):
    moving = run(browser, server, direction, reduced=False)
    still = run(browser, server, direction, reduced=True)
    start = moving["split"]["frames"][0][1]
    assert abs(start - still["split"]["frames"][0][1]) <= 1
    for name in ("split", "choose", "close"):
        m, s = moving[name], still[name]
        assert [b[0] for b in m["boxes"]] == [b[0] for b in s["boxes"]], name
        for bm, bs in zip(m["boxes"], s["boxes"]):
            assert abs(bm[1] - bs[1]) <= 1 and abs(bm[2] - bs[2]) <= 1, (name, bm, bs)
        assert abs(m["scroll"] - s["scroll"]) <= 2, (name, m["scroll"], s["scroll"])
        assert m["inline"] == 0 and s["inline"] == 0, name
        # the plots fit once when the transition ends, not on every frame
        assert m["relayouts"] <= 2, (name, m["relayouts"])
        assert m["relayouts"] <= s["relayouts"] + 1, (name, m["relayouts"], s["relayouts"])

    # the row's height before and after each step, from the run without motion
    before = {"split": start, "choose": still["split"]["boxes"][0][2], "close": still["choose"]["boxes"][0][2]}
    for name in ("split", "choose", "close"):
        a, b = before[name], still[name]["boxes"][0][2]
        if abs(a - b) < 20:
            continue  # (a horizontal close keeps the row's height; its sibling widens)
        eased = between(moving[name]["frames"], a, b)
        assert eased and max(eased) < 500, (name, a, b, eased)
        assert not between(still[name]["frames"], a, b), (name, a, b)
    if direction == "h":
        # the closing pane's sibling widens into the space
        a, b = still["choose"]["boxes"][2][1], still["close"]["boxes"][1][1]
        eased = between(moving["close"]["frames"], a, b, i=2)
        assert eased and max(eased) < 500, (a, b, eased)
        assert not between(still["close"]["frames"], a, b, i=2), (a, b)
