"""The dataset dropdown in a real (headless) browser.

With long dataset names the open list is wider than the closed box, stays
inside the viewport (also at a narrow width), and every entry and the closed
box carry the full name and path as a ``title``.

Needs Playwright with Chromium; skipped without it, or failed when
ANNZARRO_REQUIRE_BROWSER=1. Starts the server on a free 127.0.0.1 port.
"""
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

REQUIRE = os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1"


def _skip_or_fail(reason):
    if REQUIRE:
        pytest.fail(f"{reason} (ANNZARRO_REQUIRE_BROWSER=1)")
    pytest.skip(reason)


try:
    from playwright import sync_api
except ImportError:  # pragma: no cover - depends on the environment
    sync_api = None

SHOTS_DIR = os.environ.get('DATASET_SHOTS')
HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
NAMES = ["short.zarr", "a_rather_long_dataset_name_" + "x" * 60 + "_final_v12.zarr",
         "BR_2453_v3layout_PILOT_not_for_annotation.zarr",
         "tahoe_panel_95.6M_plot_" + "liver-met_v3_sharded_csc_float32_" * 3 + "final.zarr",
         "x" * 130 + ".zarr"]  # over 120 characters; the last has no break point at all


SUBSTORE = "projects/liver/2026-10_batch3/HSPC_Young_1_sharded_csc_float32.zarr"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    if sync_api is None:
        _skip_or_fail("Playwright is not installed")
    if not os.path.isdir(os.path.join(os.path.dirname(os.path.dirname(HERE)), "..", "static", "vendor")):
        _skip_or_fail("static/vendor is not provisioned")
    tmp = tmp_path_factory.mktemp("dropdown")
    data = tmp / "data"
    data.mkdir()
    for name in NAMES:
        shutil.copytree(FIXTURE, data / name)
    # a store in a subfolder (not in the top-level listing) and one outside the data directory
    (data / SUBSTORE).parent.mkdir(parents=True)
    shutil.copytree(FIXTURE, data / SUBSTORE)
    shutil.copytree(FIXTURE, tmp / "outside_store.zarr")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(tmp / "home"), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, cwd=tmp)
    base = f"http://127.0.0.1:{port}"
    for _ in range(300):
        try:
            urllib.request.urlopen(base + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield base, str(data)
    proc.terminate()
    proc.wait(20)


@pytest.mark.parametrize("width", [1280, 480])
def test_open_list_is_wider_than_the_box_inside_the_viewport_with_titles(server, width):
    base, data = server
    with sync_api.sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as exc:  # no browser binary
            _skip_or_fail(f"Chromium cannot start: {exc}")
        try:
            page = browser.new_page(viewport={"width": width, "height": 800})
            page.goto(base + "/")
            box_sel = "#dataset-selector + .select2-container"
            page.wait_for_selector(box_sel, timeout=60_000)
            page.wait_for_function("document.querySelectorAll('#dataset-selector option').length >= 2")
            box = page.locator(box_sel).bounding_box()
            page.click(box_sel)
            page.wait_for_selector(".dataset-select-dropdown .select2-results__option")
            drop = page.locator(".select2-dropdown.dataset-select-dropdown").bounding_box()
            assert drop["width"] >= box["width"]
            assert drop["x"] >= 0 and drop["x"] + drop["width"] <= width + 0.5, "inside the viewport"
            if width >= 1000:
                assert drop["width"] > box["width"] + 20, "wider than the closed box"
            titles = page.eval_on_selector_all(".dataset-select-dropdown .select2-results__option",
                                               "els => els.map(e => e.title)")
            assert sorted(titles) == sorted(f"{n}\n{os.path.join(data, n)}" for n in NAMES), titles
            page.click(".dataset-select-dropdown .select2-results__option")
            page.wait_for_selector(".select2-dropdown", state="detached", timeout=10_000)
            selected = page.get_attribute(box_sel + " .select2-selection__rendered", "title")
            assert selected in titles, "the closed box shows the same title"
        finally:
            browser.close()


@pytest.mark.parametrize("width", [1024, 1280, 1440, 1600, 1920])
@pytest.mark.parametrize("badge", [False, True])
def test_refresh_button_stays_beside_the_box_with_long_names(server, width, badge):
    """Refresh sits level with the dataset box (not wrapped under it), however long the
    selected name, with the auth badge shown; the open list is still wider than the box."""
    base, _ = server
    with sync_api.sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as exc:  # no browser binary
            _skip_or_fail(f"Chromium cannot start: {exc}")
        try:
            page = browser.new_page(viewport={"width": width, "height": 1000})
            page.goto(base + "/")
            box_sel = "#dataset-selector + .select2-container"
            page.wait_for_selector(box_sel, timeout=60_000)
            page.wait_for_function("document.querySelectorAll('#dataset-selector option').length >= 5")
            page.select_option("#dataset-selector", label=NAMES[1])  # a long name
            page.wait_for_timeout(1000)
            if badge:
                page.evaluate("""() => { const a = document.getElementById('auth-indicator');
                    a.textContent = 'Signed in: a.long.username@example.org'; a.hidden = false; }""")
                page.wait_for_timeout(500)   # the header refits on the next frame
            box = page.locator(box_sel).bounding_box()
            btn = page.locator("#refresh-dataset").bounding_box()
            assert abs(btn["y"] - box["y"]) < 6, f"Refresh wrapped: box {box}, button {btn}"
            assert btn["x"] >= box["x"] + box["width"] - 1, "button beside the box, not over it"
            hdr = page.locator("#app-header").bounding_box()
            assert box["height"] <= TWO_LINES, f"the name takes more than two lines: {box}"
            assert hdr["height"] < 200, hdr   # at most two header rows
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "page scrolls sideways"
            page.click(box_sel)
            page.wait_for_selector(".dataset-select-dropdown .select2-results__option")
            drop = page.locator(".select2-dropdown.dataset-select-dropdown").bounding_box()
            assert drop["width"] > box["width"] + 20
        finally:
            browser.close()


# the box with a name on two lines: 2 x 1.3 x 16 px of text, 2 x 8 px padding, the border
TWO_LINES = 66

CLIPPED = """els => els.map(e => ({text: e.textContent.trim(), sw: e.scrollWidth, cw: e.clientWidth,
    sh: e.scrollHeight, ch: e.clientHeight, to: getComputedStyle(e).textOverflow,
    ov: getComputedStyle(e).overflow}))"""


def _assert_whole(rows, names):
    assert rows, "nothing rendered"
    for r in rows:
        assert r["to"] != "ellipsis", r
        assert r["sw"] <= r["cw"], f"clipped horizontally: {r}"
        assert r["sh"] <= r["ch"] + 1, f"clipped vertically: {r}"
        assert r["text"].removesuffix(" (Custom)") in names, f"text is not a whole name: {r}"


@pytest.mark.parametrize("width", [1024, 1280, 1920])
@pytest.mark.parametrize("badge", [False, True])
def test_long_names_are_shown_whole_in_the_box_and_the_list(server, width, badge, tmp_path):
    """Neither the selected name nor any open-list entry is cut: no ellipsis, nothing
    clipped, the whole name rendered; Refresh stays level with the top of a taller box."""
    base, _ = server
    long_names = [n for n in NAMES if len(n) > 120]
    with sync_api.sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as exc:  # no browser binary
            _skip_or_fail(f"Chromium cannot start: {exc}")
        try:
            page = browser.new_page(viewport={"width": width, "height": 1000})
            page.goto(base + "/")
            box_sel = "#dataset-selector + .select2-container"
            page.wait_for_selector(box_sel, timeout=60_000)
            page.wait_for_function("document.querySelectorAll('#dataset-selector option').length >= 5")
            if badge:
                page.evaluate("""() => { const a = document.getElementById('auth-indicator');
                    a.textContent = 'Signed in: a.long.username@example.org'; a.hidden = false; }""")
            page.select_option("#dataset-selector", label="short.zarr")
            page.wait_for_timeout(800)
            stacked = "dataset-stacked" in page.get_attribute("#app-header", "class")
            if badge and width == 1024:
                # the badge leaves no room for the focus pickers to show a whole gene and cell name
                assert stacked and page.locator("#app-header").bounding_box()["height"] < 200
            else:
                assert page.locator("#app-header").bounding_box()["height"] < 100, "a short name keeps the header's height"
                assert not stacked
            for name in long_names:
                page.select_option("#dataset-selector", label=name)
                page.wait_for_timeout(800)
                rows = page.eval_on_selector_all(box_sel + " .select2-selection__rendered", CLIPPED)
                _assert_whole(rows, NAMES)
                assert rows[0]["text"] == name
                box_now = page.locator(box_sel).bounding_box()
                assert box_now["height"] <= TWO_LINES, f"{name[:30]}... takes more than two lines: {box_now}"
                sel = page.locator(box_sel + " .select2-selection--single").bounding_box()
                box = page.locator(box_sel).bounding_box()
                btn = page.locator("#refresh-dataset").bounding_box()
                assert btn["x"] >= box["x"] + box["width"] - 1, "Refresh beside the box"
                assert btn["y"] < box["y"] + 6, f"Refresh dropped below the box: {box} {btn}"
                assert btn["y"] + btn["height"] <= box["y"] + box["height"] + 1
                assert sel["height"] >= 38
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "page scrolls sideways"
            page.click(box_sel)
            page.wait_for_selector(".dataset-select-dropdown .select2-results__option")
            opts = page.eval_on_selector_all(".dataset-select-dropdown .select2-results__option", CLIPPED)
            assert len(opts) == len(NAMES)
            _assert_whole(opts, NAMES)
            assert sorted(o["text"] for o in opts) == sorted(NAMES)
            # the search field still filters
            page.fill(".select2-search__field", "tahoe_panel")
            page.wait_for_function("""() => { const o = [...document.querySelectorAll('.dataset-select-dropdown .select2-results__option')];
                return o.length >= 1 && o.every(e => e.textContent.includes('tahoe_panel')); }""")
            # the keyboard highlight covers the whole (wrapped) entry
            page.keyboard.press("ArrowDown")
            hi = page.eval_on_selector(".select2-results__option--highlighted",
                                       "e => { const r = e.getBoundingClientRect(); const t = e.querySelector('.dataset-name').getBoundingClientRect();"
                                       " return {top: r.top, bottom: r.bottom, ttop: t.top, tbottom: t.bottom}; }")
            assert hi["top"] <= hi["ttop"] and hi["bottom"] >= hi["tbottom"], hi
            page.fill(".select2-search__field", "")
            page.wait_for_function("document.querySelectorAll('.dataset-select-dropdown .select2-results__option').length == 5")
            shots = os.environ.get("DATASET_SHOTS")
            if shots:
                os.makedirs(shots, exist_ok=True)
                page.keyboard.press("Escape")
                page.select_option("#dataset-selector", label=long_names[0])
                page.wait_for_timeout(800)
                page.click(box_sel)
                page.wait_for_timeout(500)
                page.screenshot(path=os.path.join(shots, f"open-{width}-{'badge' if badge else 'plain'}.png"))
                page.keyboard.press("Escape")
                page.screenshot(path=os.path.join(shots, f"closed-{width}-{'badge' if badge else 'plain'}.png"))
                page.select_option("#dataset-selector", label="short.zarr")
                page.wait_for_timeout(800)
                page.screenshot(path=os.path.join(shots, f"closed-short-{width}-{'badge' if badge else 'plain'}.png"))
        finally:
            browser.close()


ENSG = "ENSG00000141510"           # 15 characters: the Ensembl ID of TP53
BARCODE = "AAACCTGAGAAACCAT-1"     # a 10x cell barcode


@pytest.mark.parametrize("width", [1024, 1280, 1920])
@pytest.mark.parametrize("badge", [False, True])
@pytest.mark.parametrize("which", ["short.zarr", "long"])
def test_focus_inputs_show_a_whole_gene_and_cell_name(server, width, badge, which):
    """The header gives the focused gene and cell inputs room for an Ensembl ID and a
    barcode (stacking rather than squeezing them), whatever the dataset name."""
    base, _ = server
    with sync_api.sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as exc:  # no browser binary
            _skip_or_fail(f"Chromium cannot start: {exc}")
        try:
            page = browser.new_page(viewport={"width": width, "height": 1000})
            page.goto(base + "/")
            page.wait_for_selector("#dataset-selector + .select2-container", timeout=60_000)
            page.wait_for_function("document.querySelectorAll('#dataset-selector option').length >= 5")
            page.select_option("#dataset-selector", label=NAMES[1] if which == "long" else which)
            if badge:
                page.evaluate("""() => { const a = document.getElementById('auth-indicator');
                    a.textContent = 'Signed in: a.long.username@example.org'; a.hidden = false; }""")
            page.evaluate("""([g, c]) => { document.getElementById('focused-gene').value = g;
                document.getElementById('focused-cell').value = c; }""", [ENSG, BARCODE])
            page.wait_for_timeout(800)
            for sel, value, least in (("#focused-gene", ENSG, 168), ("#focused-cell", BARCODE, 190)):
                size = page.eval_on_selector(sel, "e => ({w: e.getBoundingClientRect().width, sw: e.scrollWidth, cw: e.clientWidth})")
                assert size["w"] >= least, f"{sel} is {size['w']:.0f}px wide"
                assert size["sw"] <= size["cw"], f"{sel} cuts {value}: {size}"
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "page scrolls sideways"
            btn = page.locator("#refresh-dataset").bounding_box()
            box = page.locator("#dataset-selector + .select2-container").bounding_box()
            assert btn["x"] >= box["x"] + box["width"] - 1 and abs(btn["y"] - box["y"]) < 6
        finally:
            browser.close()


def _open_by_link(base, path, width):
    """A page opened on a share link for ``path``; returns (browser context pieces, page)."""
    pw = sync_api.sync_playwright().start()
    try:
        browser = pw.chromium.launch()
    except Exception as exc:  # no browser binary
        pw.stop()
        _skip_or_fail(f"Chromium cannot start: {exc}")
    page = browser.new_page(viewport={"width": width, "height": 1000})
    page.goto(f"{base}/?dataset_path={path}")
    page.wait_for_selector("#dataset-selector + .select2-container", timeout=60_000)
    page.wait_for_function("document.querySelectorAll('#dataset-selector option').length >= 5")
    return pw, browser, page


def test_a_store_outside_the_listing_is_labelled_relative_to_the_data_directory(server):
    base, data = server
    absolute = os.path.join(data, SUBSTORE)
    pw, browser, page = _open_by_link(base, absolute, 1440)
    try:
        rendered = "#dataset-selector + .select2-container .select2-selection__rendered"
        page.wait_for_function(f"document.querySelector('{rendered}').textContent.trim() === {SUBSTORE!r}", timeout=30_000)
        assert page.get_attribute(rendered, "title") == absolute, "the absolute path is the tooltip"
        box = page.locator("#dataset-selector + .select2-container").bounding_box()
        assert box["height"] <= TWO_LINES, f"the label takes more than two lines: {box}"
        assert absolute not in page.inner_text(rendered)
        # the open list uses the same label
        page.click("#dataset-selector + .select2-container")
        page.wait_for_selector(".dataset-select-dropdown .select2-results__option")
        entries = page.eval_on_selector_all(".dataset-select-dropdown .select2-results__option", "els => els.map(e => e.textContent.trim())")
        assert SUBSTORE in entries and absolute not in entries
    finally:
        browser.close()
        pw.stop()


def test_a_store_outside_the_data_directory_stays_absolute(server):
    base, data = server
    outside = os.path.join(os.path.dirname(data), "outside_store.zarr")
    pw, browser, page = _open_by_link(base, outside, 1440)
    try:
        rendered = "#dataset-selector + .select2-container .select2-selection__rendered"
        page.wait_for_function(f"document.querySelector('{rendered}').textContent.trim() === {outside!r}", timeout=30_000)
        assert page.get_attribute(rendered, "title") == outside
    finally:
        browser.close()
        pw.stop()


@pytest.mark.parametrize("width", [1024, 1440, 1920])
def test_a_real_cell_name_is_shown_whole_and_a_too_long_one_ends_visibly(server, width):
    """HSPC_Young_1#AAAGATGGTCCGAAGA-1 fits whole (the input grows, the header stacks if it must); a
    60-character name, over the 420px maximum, is whole in the tooltip and shows its end."""
    base, _ = server
    real = "HSPC_Young_1#AAAGATGGTCCGAAGA-1"
    long = "HSPC_Young_replicate_3_lane_2_sorted#AAAGATGGTCCGAAGA-1_doublet_checked"
    with sync_api.sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as exc:  # no browser binary
            _skip_or_fail(f"Chromium cannot start: {exc}")
        try:
            page = browser.new_page(viewport={"width": width, "height": 1000})
            page.goto(base + "/")
            page.wait_for_selector("#dataset-selector + .select2-container", timeout=60_000)
            page.wait_for_function("document.querySelectorAll('#dataset-selector option').length >= 5")
            page.evaluate("v => { document.getElementById('focused-cell').value = v; }", real)
            page.wait_for_timeout(600)
            size = page.eval_on_selector("#focused-cell", "e => ({w: e.getBoundingClientRect().width, sw: e.scrollWidth, cw: e.clientWidth})")
            assert size["sw"] <= size["cw"], f"the cell name is cut: {size}"
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "page scrolls sideways"
            page.evaluate("v => { document.getElementById('focused-cell').value = v; }", long)
            page.wait_for_timeout(600)
            info = page.eval_on_selector("#focused-cell", "e => ({w: e.getBoundingClientRect().width, title: e.title, left: e.scrollLeft, sw: e.scrollWidth, cw: e.clientWidth})")
            assert info["w"] <= 421, info
            assert info["title"] == long, "the whole value is in the tooltip"
            assert info["left"] > 0 and info["left"] + info["cw"] >= info["sw"] - 1, f"the end is visible: {info}"
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "page scrolls sideways"
            if SHOTS_DIR:
                os.makedirs(SHOTS_DIR, exist_ok=True)
                page.evaluate("v => { document.getElementById('focused-cell').value = v; }", real)
                page.wait_for_timeout(500)
                page.screenshot(path=os.path.join(SHOTS_DIR, f"cell-name-{width}.png"))
        finally:
            browser.close()
