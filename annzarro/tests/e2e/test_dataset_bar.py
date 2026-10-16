"""The dataset bar and its dataset button, and the header beside it, in a real (headless) browser.

The dataset is a button at the left of the dataset bar under the header: five states, one line whatever
the name (cut in the middle, the whole path its tooltip), the refresh icon beside it. Moving the dataset
out of the header leaves the header one row of the focus inputs and the panel set buttons, which give way
in measured steps (buttons to icons, inputs tighten, wrap) and never because of a dataset name.

Needs Playwright with Chromium; skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

from annzarro.tests.ui_helpers import (
    BUTTON, button_state, button_text, dataset_path, open_dataset, start_open_dataset, wait_for_open)

from .dsb_servers import (  # noqa: F401  (fixtures)
    NAMES, SHOTS, SUBSTORE, SUBSTORE_LONG, Session, empty_server, server, single_server, sync_api)

# the bar is one line: a 26 px button between 2 px paddings, a 1 px border and a little slack
BAR_MAX = 36
ENSG = "ENSG00000141510"           # 15 characters: the Ensembl ID of TP53
BARCODE = "AAACCTGAGAAACCAT-1"     # a 10x cell barcode
DEMO_TITLE = "AnnZarro 0.4.3 demo (multi-user)"


def _badge(page):
    page.evaluate("""() => { const a = document.getElementById('auth-indicator');
        a.textContent = 'Signed in: a.long.username@example.org'; a.hidden = false; }""")


def _shot(page, name, **kw):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name), **kw)


def _geometry(page):
    return page.evaluate("""() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return {x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom}; };
        const label = document.querySelector('#btn-save-session .btn-label');
        const h = document.getElementById('app-header');
        return {header: r('#app-header'), bar: r('#dataset-stats'), button: r('#dataset-button'), refresh: r('#refresh-dataset'),
                name: r('#dataset-button-name'), cls: h.className, labels: getComputedStyle(label).display !== 'none',
                sideways: document.documentElement.scrollWidth > window.innerWidth}; }""")


def test_the_button_has_five_states(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        # none: dashed, "Open a dataset..." and the shortcut (no dataset is opened of several)
        assert button_state(page) == "none"
        assert button_text(page) == "Open a dataset…"
        assert page.evaluate("getComputedStyle(document.querySelector('#dataset-button')).borderTopStyle") == "dashed"
        assert page.is_visible("#dataset-button-hint") and page.inner_text("#dataset-button-hint") in ("Ctrl+O", "⌘O")
        assert page.get_attribute(BUTTON, "aria-label") == "Open a dataset"
        assert page.get_attribute(BUTTON, "aria-haspopup") == "dialog"
        # opening: while the dataset loads, busy, naming it
        page.route("**/api/v1/data/dataset_structure*", lambda route: (page.wait_for_timeout(1500), route.continue_()))
        start_open_dataset(page, os.path.join(data, "short.zarr"))
        page.wait_for_function("document.querySelector('#dataset-button').dataset.state === 'opening'", timeout=10_000)
        assert button_text(page).startswith("Opening short.zarr")
        assert page.get_attribute(BUTTON, "aria-busy") == "true"
        # open: the name and a caret, the whole path as the tooltip
        wait_for_open(page, "short.zarr")
        page.unroute("**/api/v1/data/dataset_structure*")
        assert button_state(page) == "open" and button_text(page) == "short.zarr"
        assert page.get_attribute(BUTTON, "aria-busy") == "false"
        assert page.get_attribute(BUTTON, "aria-label") == "Dataset: short.zarr. Change dataset"
        assert page.get_attribute(BUTTON, "title").splitlines()[0] == os.path.join(data, "short.zarr")
        assert page.is_visible(f"{BUTTON} .dataset-button-caret") and not page.is_visible("#dataset-button-hint")
        # a view without data: warning colours, "No data: <name>", "Choose..."
        page.evaluate("""async () => { const m = await import('/static/js/utils/dataset-state.js');
            m.DatasetState.set({path: 'gone.zarr', label: 'gone.zarr', status: 'nodata'}); }""")
        assert button_state(page) == "nodata"
        assert page.inner_text(f"{BUTTON} .dataset-button-name") == "No data: gone.zarr"
        assert page.inner_text(f"{BUTTON} .dataset-button-action") == "Choose…"
        assert page.get_attribute(BUTTON, "aria-label") == "No data: gone.zarr. Choose a dataset"
        # unavailable: the open dataset turned unreadable
        page.evaluate("""async () => { const m = await import('/static/js/utils/dataset-state.js');
            m.DatasetState.set({path: 'gone.zarr', label: 'gone.zarr', status: 'unavailable'}); }""")
        assert button_state(page) == "unavailable" and button_text(page) == "Not available: gone.zarr"
        assert page.inner_text(f"{BUTTON} .dataset-button-action") == "Choose…"
        assert not s.errors, s.errors
    finally:
        s.close()


def test_the_bar_says_the_dataset_once_and_drops_the_old_label(single_server):
    """One name everywhere: the button (relative path), the tab, the bar: no "Dataset:" label, no title-cased copy."""
    base, data = single_server
    s = Session(base)
    page = s.page
    try:
        wait_for_open(page, "only_one.zarr")                     # the only dataset opens at start
        page.wait_for_timeout(1000)
        bar = page.inner_text("#dataset-stats")
        assert "Dataset:" not in bar and "Only One" not in bar, bar
        assert button_text(page) == "only_one.zarr"
        assert page.title() == "only_one.zarr · AnnZarro"
        assert "Cells:" in bar and "Genes:" in bar
        assert page.locator("#dataset-format-fact").is_visible()
        assert page.inner_text("#dataset-format") in ("zarr v2", "zarr v3", "zarr v3 sharded")
        for gone in ("#dataset-selector", "#select-directory", "#btn-change-dataset", "#change-dataset-modal", ".select2-container"):
            assert page.locator(gone).count() == 0, gone
        assert not s.errors, s.errors
    finally:
        s.close()


@pytest.mark.parametrize("width", [1024, 1280, 1440, 1600, 1920])
@pytest.mark.parametrize("badge", [False, True])
def test_refresh_stays_beside_the_button_with_long_names(server, width, badge):
    base, data = server
    s = Session(base, width=width, height=1000)
    page = s.page
    try:
        open_dataset(page, os.path.join(data, NAMES[1]))
        if badge:
            _badge(page)
        page.wait_for_timeout(800)
        g = _geometry(page)
        assert abs(g["refresh"]["y"] - g["button"]["y"]) < 5, g
        assert g["refresh"]["x"] >= g["button"]["r"] - 1, "the refresh icon is beside the button, not over it"
        assert g["refresh"]["x"] - g["button"]["r"] < 12, "and close to it"
        assert g["button"]["h"] <= 28 and g["bar"]["h"] <= BAR_MAX, g
        assert not g["sideways"], "the page scrolls sideways"
        assert not s.errors, s.errors
    finally:
        s.close()


@pytest.mark.parametrize("width", [800, 1024, 1280, 1920])
def test_a_long_name_never_changes_the_header_and_the_bar_stays_one_line(server, width):
    """The headline: the header is as tall for a 130-character dataset name as for a short one, and the bar is one line."""
    base, data = server
    s = Session(base, width=width, height=1000)
    page = s.page
    try:
        open_dataset(page, os.path.join(data, "short.zarr"))
        page.wait_for_timeout(800)
        short = _geometry(page)
        for name in (NAMES[3], NAMES[4], SUBSTORE_LONG):
            open_dataset(page, os.path.join(data, name))
            page.wait_for_timeout(800)
            g = _geometry(page)
            assert g["header"]["h"] == short["header"]["h"] and g["cls"] == short["cls"], (name[:30], g["header"], short["header"], g["cls"], short["cls"])
            assert g["bar"]["h"] == short["bar"]["h"] <= BAR_MAX, "the bar is one line, whatever the name"
            assert g["button"]["h"] == short["button"]["h"]
            assert not g["sideways"]
            assert g["button"]["r"] <= width
        assert not s.errors, s.errors
    finally:
        s.close()


@pytest.mark.parametrize("width", [800, 1024, 1280, 1920])
@pytest.mark.parametrize("name", [NAMES[3], NAMES[4], SUBSTORE_LONG])
def test_the_button_cuts_a_long_name_in_the_middle_and_keeps_its_end(server, width, name):
    base, data = server
    s = Session(base, width=width, height=1000)
    page = s.page
    try:
        open_dataset(page, os.path.join(data, name))
        page.wait_for_timeout(800)
        shown = page.eval_on_selector("#dataset-button-name", "e => ({text: e.textContent.trim(), sw: e.scrollWidth, cw: e.clientWidth})")
        assert shown["sw"] <= shown["cw"], f"cut again by the CSS: {shown}"
        assert "…" in shown["text"], f"a name this long is cut at {width}px: {shown}"
        assert shown["text"][:5] == name[:5] or "/" in name, shown
        assert shown["text"].endswith(name[-12:]), f"its end is kept: {shown}"
        title = page.get_attribute(BUTTON, "title").splitlines()[0]
        assert title.endswith(name), "the whole path is the tooltip"
        label = page.get_attribute(BUTTON, "aria-label")
        assert name in label or name.split("/")[-1] in label or "…" not in label, label
        _shot(page, f"button-long-{width}.png", clip={"x": 0, "y": 0, "width": width, "height": 130})
        assert not s.errors, s.errors
    finally:
        s.close()


def test_a_store_in_a_subfolder_is_named_by_its_relative_path_and_one_outside_stays_absolute(server):
    base, data = server
    s = Session(base, width=1440)
    page = s.page
    try:
        open_dataset(page, os.path.join(data, SUBSTORE))
        page.wait_for_function("document.querySelector('#dataset-button').dataset.state === 'open'")
        # relative to the data directory (the path is cut to the button's width, folders first; the label is whole for a reader)
        assert page.get_attribute(BUTTON, "aria-label") == f"Dataset: {SUBSTORE}. Change dataset"
        assert button_text(page).startswith("projects/") and button_text(page).endswith("csc_float32.zarr"), button_text(page)
        assert os.path.join(data, SUBSTORE) not in page.inner_text("#dataset-stats")
        outside = os.path.join(os.path.dirname(data), "outside_store.zarr")
        open_dataset(page, outside)
        assert page.get_attribute(BUTTON, "aria-label") == f"Dataset: {outside}. Change dataset", "no relative form outside the data directory"
        assert button_text(page).endswith("outside_store.zarr")
        assert page.get_attribute(BUTTON, "title").splitlines()[0] == outside
        assert not s.errors, s.errors
    finally:
        s.close()


@pytest.mark.parametrize("width", [1024, 1280, 1920])
@pytest.mark.parametrize("badge", [False, True])
@pytest.mark.parametrize("which", ["short.zarr", "long"])
def test_focus_inputs_show_a_whole_gene_and_cell_name(server, width, badge, which):
    """The header gives the focused gene and cell inputs room for an Ensembl ID and a barcode (wrapping
    rather than squeezing them), whatever the dataset name."""
    base, data = server
    s = Session(base, width=width, height=1000)
    page = s.page
    try:
        open_dataset(page, os.path.join(data, NAMES[1] if which == "long" else which))
        if badge:
            _badge(page)
        page.evaluate("""([g, c]) => { document.getElementById('focused-gene').value = g;
            document.getElementById('focused-cell').value = c; }""", [ENSG, BARCODE])
        page.wait_for_timeout(800)
        for sel, value, least in (("#focused-gene", ENSG, 168), ("#focused-cell", BARCODE, 190)):
            size = page.eval_on_selector(sel, "e => ({w: e.getBoundingClientRect().width, sw: e.scrollWidth, cw: e.clientWidth})")
            assert size["w"] >= least, f"{sel} is {size['w']:.0f}px wide"
            assert size["sw"] <= size["cw"], f"{sel} cuts {value}: {size}"
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "page scrolls sideways"
        assert not s.errors, s.errors
    finally:
        s.close()


@pytest.mark.parametrize("width", [1024, 1440, 1920])
def test_a_real_cell_name_is_shown_whole_and_a_too_long_one_ends_visibly(server, width):
    """HSPC_Young_1#AAAGATGGTCCGAAGA-1 fits whole (the input grows); a 60-character name, over the 420px
    maximum, is whole in the tooltip and shows its end."""
    base, data = server
    real = "HSPC_Young_1#AAAGATGGTCCGAAGA-1"
    long = "HSPC_Young_replicate_3_lane_2_sorted#AAAGATGGTCCGAAGA-1_doublet_checked"
    s = Session(base, width=width, height=1000)
    page = s.page
    try:
        open_dataset(page, os.path.join(data, "short.zarr"))
        # the dataset focuses its first cell once loaded: set ours after it, or that one replaces it
        page.wait_for_function("document.getElementById('focused-cell').value !== ''", timeout=60_000)
        page.evaluate("v => { document.getElementById('focused-cell').value = v; }", real)
        page.wait_for_timeout(600)
        assert page.eval_on_selector("#focused-cell", "e => e.value") == real
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
        assert not s.errors, s.errors
    finally:
        s.close()


def test_the_header_gives_way_in_steps_and_the_focus_inputs_last(server):
    """Swept over widths, so it holds for any font: the focused gene and cell inputs give up width (focus-tight)
    only once the buttons are icons (actions-compact), the Ensembl ID is never cut, the header wraps only when the
    tightest one-row layout still does not fit, and the page never scrolls sideways."""
    base, data = server
    real = "HSPC_Young_1#AAAGATGGTCCGAAGA-1"
    s = Session(base, width=1920, height=1000)
    page = s.page
    try:
        open_dataset(page, os.path.join(data, NAMES[2]))
        page.wait_for_function("document.getElementById('focused-cell').value !== ''", timeout=60_000)
        page.evaluate("""([g, c]) => { document.getElementById('focused-gene').value = g;
            document.getElementById('focused-cell').value = c; }""", [ENSG, real])
        seen = set()
        for width in range(1920, 799, -24):
            page.set_viewport_size({"width": width, "height": 1000})
            page.wait_for_timeout(150)
            st = page.evaluate("""() => { const h = document.getElementById('app-header');
                const cell = document.getElementById('focused-cell'), gene = document.getElementById('focused-gene');
                return {cls: h.className.split(' '), value: cell.value, geneCut: gene.scrollWidth > gene.clientWidth + 1,
                        height: h.getBoundingClientRect().height, sideways: document.documentElement.scrollWidth > window.innerWidth,
                        gene: gene.getBoundingClientRect().width, geneMin: parseFloat(getComputedStyle(gene).minWidth)}; }""")
            st["width"] = width
            assert st["value"] == real, st
            assert not st["geneCut"], f"an Ensembl ID always fits: {st}"
            assert not st["sideways"], st
            classes = set(st["cls"])
            seen.add(" ".join(sorted(classes - {"app-header"})))
            if "focus-tight" in classes:
                assert "actions-compact" in classes, f"the inputs give way before the buttons: {st}"
                assert st["gene"] <= st["geneMin"] + 1 or "header-wrapped" in classes, f"a tight gene input does not take the cell's width: {st}"
            if "header-wrapped" not in classes:
                assert st["height"] < 100, f"one row is one row: {st}"
            assert not any(c in classes for c in ("dataset-tight", "dataset-stacked")), "the dataset is not a step of the header"
        # the sweep reached every step, whatever the font
        assert any("actions-compact" in x and "focus-tight" not in x for x in seen), seen
        assert any("focus-tight" in x and "header-wrapped" not in x for x in seen), seen
        assert any("header-wrapped" in x for x in seen), seen
        assert not s.errors, s.errors
    finally:
        s.close()


@pytest.mark.parametrize("width", [1280, 1440, 1512, 1728, 1920])
def test_a_short_name_with_a_badge_and_a_long_title_keeps_one_row(server, width):
    """From 1280px up a short name never wraps or stacks the header; the labels stay while they fit (1920) and go to icons otherwise."""
    base, data = server
    s = Session(base, width=width, height=1000)
    page = s.page
    try:
        page.evaluate("""([title]) => { document.querySelector('.app-title').textContent = title;
            const a = document.getElementById('auth-indicator'); a.textContent = 'Signed in: alice (user)'; a.hidden = false; }""", [DEMO_TITLE])
        open_dataset(page, os.path.join(data, "short.zarr"))
        page.wait_for_timeout(900)
        g = _geometry(page)
        assert g["header"]["h"] < 100 and "header-wrapped" not in g["cls"], g
        assert g["bar"]["h"] <= BAR_MAX and not g["sideways"]
        if width >= 1920:
            assert g["labels"], f"the labels fit at {width}px: {g}"
        _shot(page, f"matrix-short-{width}.png", clip={"x": 0, "y": 0, "width": width, "height": 200})
        assert not s.errors, s.errors
    finally:
        s.close()


@pytest.mark.parametrize("letter_spacing", ["0.6px", "1.2px"])
@pytest.mark.parametrize("width", [1024, 1440])
def test_the_focus_inputs_follow_the_font_they_are_drawn_in(server, width, letter_spacing):
    """A system whose font is wider needs wider inputs for the same Ensembl ID and barcode: the minimums are measured from the rendered font."""
    base, data = server
    s = Session(base, width=width, height=1000)
    page = s.page
    try:
        page.add_style_tag(content=f"#focused-gene, #focused-cell {{ letter-spacing: {letter_spacing}; }}")
        open_dataset(page, os.path.join(data, "short.zarr"))
        page.evaluate("""([g, c]) => { document.getElementById('focused-gene').value = g;
            document.getElementById('focused-cell').value = c; }""", [ENSG, BARCODE])
        page.wait_for_timeout(1000)
        for sel, value in (("#focused-gene", ENSG), ("#focused-cell", BARCODE)):
            size = page.eval_on_selector(sel, "e => ({sw: e.scrollWidth, cw: e.clientWidth})")
            assert size["sw"] <= size["cw"], f"{sel} cuts {value}: {size}"
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "page scrolls sideways"
    finally:
        s.close()


def test_the_focus_inputs_are_off_with_no_dataset_and_say_so(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        for sel in ("#focused-gene", "#focused-cell"):
            assert page.is_disabled(sel) and page.get_attribute(sel, "placeholder") == "Open a dataset first"
        open_dataset(page, os.path.join(data, "short.zarr"))
        page.wait_for_function("!document.getElementById('focused-gene').disabled", timeout=30_000)
        assert page.get_attribute("#focused-gene", "placeholder") == "Search genes"
        assert page.get_attribute("#focused-cell", "placeholder") == "Search cells"
        assert not s.errors, s.errors
    finally:
        s.close()


def test_ctrl_r_reloads_the_page_in_the_browser_build_instead_of_refreshing_the_dataset(server):
    """Ctrl+R is the browser's reload: no dataset refresh is bound to it (the desktop app's menu owns it), also in a text field."""
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_dataset(page, os.path.join(data, "short.zarr"))
        page.wait_for_timeout(1000)
        posts = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and "/data/refresh" in r.url else None)
        page.locator("body").click(position={"x": 5, "y": 400})
        page.keyboard.press("Control+r")
        page.focus("#focused-gene")
        page.keyboard.press("Control+r")
        page.wait_for_timeout(1500)
        assert posts == [], posts
        page.click("#refresh-dataset")                  # the button is what refreshes
        page.wait_for_timeout(1500)
        assert len(posts) == 1, posts
        page.keyboard.press("F1")
        page.wait_for_selector("#keyboard-shortcuts-modal.show")
        help_text = page.inner_text("#keyboard-shortcuts-modal")
        assert "Open a dataset" in help_text and "Load panel set" in help_text
        assert "Refresh" not in help_text, "Ctrl+R is not listed in the browser build"
        assert not s.errors, s.errors
    finally:
        s.close()


def test_a_second_refresh_press_while_one_runs_does_not_reopen_anything_else(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_dataset(page, os.path.join(data, "short.zarr"))
        page.click("#refresh-dataset")
        page.click("#refresh-dataset")
        page.wait_for_timeout(2500)
        assert dataset_path(page) == os.path.join(data, "short.zarr")
        assert button_text(page) == "short.zarr"
    finally:
        s.close()
