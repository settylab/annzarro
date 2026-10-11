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
            assert sorted(titles) == sorted(NAMES), titles   # the path relative to the data directory
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
            assert box["height"] <= ONE_LINE, f"the closed box is one line: {box}"
            # one header row; a long name in a 1024px window gives the box a row of its own (last resort)
            assert hdr["height"] < (200 if width < 1280 else 100), hdr
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "page scrolls sideways"
            page.click(box_sel)
            page.wait_for_selector(".dataset-select-dropdown .select2-results__option")
            drop = page.locator(".select2-dropdown.dataset-select-dropdown").bounding_box()
            assert drop["width"] > box["width"] + 20
        finally:
            browser.close()


# the closed box is one line: 38px high
ONE_LINE = 42

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
def test_the_box_is_one_line_with_the_middle_cut_and_the_list_shows_names_whole(server, width, badge, tmp_path):
    """The closed box is one line: a long name is cut in the middle (start and end kept), its
    whole relative path is the title, and Refresh stays beside it. Every open-list entry shows
    its whole name: no ellipsis, nothing clipped."""
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
                rendered = box_sel + " .select2-selection__rendered"
                assert page.inner_text(rendered).replace("\n", "").strip() != "" and \
                    page.eval_on_selector(rendered, "e => e.textContent.trim()") == name, "the whole name is in the box's text"
                assert page.get_attribute(rendered, "title") == name, "the full relative path is the tooltip"
                head, tail = (page.eval_on_selector(rendered + " .dataset-name-head", "e => ({text: e.textContent, cut: e.scrollWidth > e.clientWidth})"),
                              page.eval_on_selector(rendered + " .dataset-name-tail", "e => e.textContent"))
                assert tail == name[-16:] and name.startswith(head["text"]), "start and end are kept"
                assert head["cut"], "a long name is cut in the middle at this width"
                box_now = page.locator(box_sel).bounding_box()
                assert box_now["height"] <= ONE_LINE, f"{name[:30]}... is not one line: {box_now}"
                sel = page.locator(box_sel + " .select2-selection--single").bounding_box()
                box = page.locator(box_sel).bounding_box()
                btn = page.locator("#refresh-dataset").bounding_box()
                assert btn["x"] >= box["x"] + box["width"] - 1, "Refresh beside the box"
                assert btn["y"] < box["y"] + 6, f"Refresh dropped below the box: {box} {btn}"
                assert btn["y"] + btn["height"] <= box["y"] + box["height"] + 1
                assert 36 <= sel["height"] <= ONE_LINE
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
        assert page.get_attribute(rendered, "title") == SUBSTORE, "the relative path is the tooltip"
        box = page.locator("#dataset-selector + .select2-container").bounding_box()
        assert box["height"] <= ONE_LINE, f"the closed box is one line: {box}"
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
            size = page.eval_on_selector("#focused-cell", "e => ({w: e.getBoundingClientRect().width, sw: e.scrollWidth, cw: e.clientWidth, title: e.title})")
            if width >= 1440:
                assert size["sw"] <= size["cw"], f"the cell name is cut: {size}"
            else:   # a window this narrow shrinks the input toward its minimum: the value is then whole in the tooltip
                assert size["sw"] <= size["cw"] or size["title"] == real, size
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


# --- the header gives way in steps, measured -------------------------------------------

DEMO_TITLE = "AnnZarro 0.4.3 demo (multi-user)"


def _demo_page(pw, base, width, name="short.zarr", badge=True, cell=None):
    try:
        browser = pw.chromium.launch()
    except Exception as exc:  # no browser binary
        _skip_or_fail(f"Chromium cannot start: {exc}")
    page = browser.new_page(viewport={"width": width, "height": 1000})
    page.goto(base + "/")
    page.wait_for_selector("#dataset-selector + .select2-container", timeout=60_000)
    page.wait_for_function("document.querySelectorAll('#dataset-selector option').length >= 5")
    page.evaluate("""([title, badge]) => { document.querySelector('.app-title').textContent = title;
        if (badge) { const a = document.getElementById('auth-indicator');
            a.textContent = 'Signed in: alice (user)'; a.hidden = false; } }""", [DEMO_TITLE, badge])
    page.select_option("#dataset-selector", label=name)
    if cell:
        page.evaluate("v => { document.getElementById('focused-cell').value = v; }", cell)
    page.wait_for_timeout(900)
    return browser, page


def _header_state(page):
    return page.evaluate("""() => { const h = document.getElementById('app-header');
        const box = document.querySelector('#dataset-selector + .select2-container');
        const label = document.querySelector('#btn-save-session .btn-label');
        const head = document.querySelector('#dataset-selector + .select2-container .dataset-name-head');
        return {height: h.getBoundingClientRect().height, box: box.getBoundingClientRect().height,
                boxWidth: box.getBoundingClientRect().width, cls: h.className,
                labels: getComputedStyle(label).display !== 'none',
                headCut: !!head && head.scrollWidth > head.clientWidth,
                sideways: document.documentElement.scrollWidth > window.innerWidth}; }""")


@pytest.mark.parametrize("width", [1280, 1440, 1512, 1728, 1920])
def test_a_short_name_with_a_badge_and_a_long_title_keeps_one_row_and_one_line(server, width):
    """The header is one row that gives way step by step: a short name never wraps or stacks
    from 1280px up; the button labels stay while they fit (at 1920px) and go to icons otherwise."""
    base, _ = server
    with sync_api.sync_playwright() as pw:
        browser, page = _demo_page(pw, base, width)
        try:
            st = _header_state(page)
            assert st["height"] < 100, st
            assert "dataset-stacked" not in st["cls"], st
            assert st["box"] <= ONE_LINE and not st["headCut"], f"short.zarr is one whole line: {st}"
            assert not st["sideways"]
            if width >= 1920:
                assert st["labels"], f"the labels fit at {width}px: {st}"
            if SHOTS_DIR:
                os.makedirs(SHOTS_DIR, exist_ok=True)
                page.screenshot(path=os.path.join(SHOTS_DIR, f"matrix-short-{width}.png"), clip={"x": 0, "y": 0, "width": width, "height": 200})
        finally:
            browser.close()


@pytest.mark.parametrize("width", [1024, 1280, 1440, 1728, 1920])
def test_a_130_character_name_is_one_line_cut_in_the_middle_and_stacks_only_when_it_must(server, width):
    base, _ = server
    with sync_api.sync_playwright() as pw:
        browser, page = _demo_page(pw, base, width, name=NAMES[3])
        try:
            st = _header_state(page)
            assert st["box"] <= ONE_LINE, st
            assert st["headCut"], "the long name is cut"
            assert page.get_attribute("#dataset-selector + .select2-container .select2-selection__rendered", "title") == NAMES[3]
            assert not st["sideways"]
            if width >= 1440:
                assert st["height"] < 100 and "dataset-stacked" not in st["cls"], st
            else:   # a box cut to 140px is not worth a row: below this width it stacks
                assert st["height"] < 200, st
            if width >= 1728:
                assert st["boxWidth"] >= 300, f"the box takes the free width: {st}"
            if SHOTS_DIR:
                os.makedirs(SHOTS_DIR, exist_ok=True)
                page.screenshot(path=os.path.join(SHOTS_DIR, f"matrix-long-{width}.png"), clip={"x": 0, "y": 0, "width": width, "height": 200})
        finally:
            browser.close()


def test_a_long_focused_cell_name_does_not_force_stacking_while_the_labels_can_collapse(server):
    base, _ = server
    real = "HSPC_Young_1#AAAGATGGTCCGAAGA-1"
    with sync_api.sync_playwright() as pw:
        browser, page = _demo_page(pw, base, 1440, cell=real)
        try:
            st = _header_state(page)
            assert st["height"] < 100 and "dataset-stacked" not in st["cls"], st
            assert not st["labels"], "the labels gave way first"
            size = page.eval_on_selector("#focused-cell", "e => ({sw: e.scrollWidth, cw: e.clientWidth, title: e.title})")
            # the inputs give up only the width the row is short of; what they cannot show is whole in the tooltip
            assert size["sw"] <= size["cw"] or size["title"] == real, size
            if SHOTS_DIR:
                page.screenshot(path=os.path.join(SHOTS_DIR, "matrix-cell-1440.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 200})
        finally:
            browser.close()
