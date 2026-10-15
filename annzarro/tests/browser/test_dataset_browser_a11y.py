"""The dataset button and dataset browser: keyboard, screen reader semantics, contrast in both themes, narrow and touch layouts.

Everything here is checked headless: dialog semantics (role, labels, focus kept inside, focus back on the
button), a native table (caption, `aria-sort` header buttons, one tab stop with roving focus, type-ahead),
live regions, Playwright's accessibility snapshot of the dialog, the contrast of the new colour pairs in
light and dark (WCAG: 4.5:1 text, 3:1 controls and indicators), the 2 px focus ring, forced colours and
reduced motion, and the layouts below 1100 px, below 768 px and for a coarse pointer.

Needs Playwright with Chromium; skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

from annzarro.tests.browser.test_dark_theme import _ratio
from annzarro.tests.e2e.dsb_servers import Session, server  # noqa: F401  (fixture)
from annzarro.tests.ui_helpers import BROWSER, ROW, browser_row, close_browser, open_browser, open_dataset, wait_for_open

COLOURS = """(sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const alpha = (c) => { const m = c.match(/rgba?\\(([^)]*)\\)/); if (!m) return 1; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
    let bg = 'rgb(255, 255, 255)', n = el;
    while (n && n.nodeType === 1) { const c = getComputedStyle(n).backgroundColor; if (alpha(c) > 0.5) { bg = c; break; } n = n.parentElement; }
    const cs = getComputedStyle(el);
    return { color: cs.color, bg, outline: cs.outlineColor, outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, visible: !!(el.offsetWidth || el.offsetHeight) };
}"""


def _quiet_focus_ring_probe(page):
    return page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--az-link').trim()")


# ---- the dialog ---------------------------------------------------------------------------------

def test_dialog_semantics_focus_is_kept_inside_and_returns_to_the_button(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        assert page.get_attribute(BROWSER, "role") == "dialog" and page.get_attribute(BROWSER, "aria-modal") == "true"
        labelled = page.get_attribute(BROWSER, "aria-labelledby")
        assert page.inner_text(f"#{labelled}") == "Open a dataset"
        assert page.get_attribute(BROWSER, "aria-describedby") == "dataset-browser-banner"
        # Tab and Shift+Tab never put the focus on anything behind the dialog: past its last (or first) control the focus
        # leaves the page (here: the body, in a browser: its own toolbar) and the next press brings it back inside
        inside = "document.querySelector('#dataset-browser').contains(document.activeElement)"
        for i, key in enumerate(["Tab"] * 40 + ["Shift+Tab"] * 40):
            page.keyboard.press(key)
            if page.evaluate("document.activeElement === document.body"):
                page.keyboard.press(key)
            assert page.evaluate(inside), (i, key, page.evaluate("document.activeElement.outerHTML.slice(0, 160)"))
        close_browser(page)
        page.wait_for_function("document.activeElement && document.activeElement.id === 'dataset-button'", timeout=5_000)
        assert not s.errors, s.errors
    finally:
        s.close()


def test_every_control_in_the_dialog_has_a_name_and_ids_are_unique(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        browser_row(page, "short.zarr").locator("td").first.click()
        page.wait_for_selector("#dsb-details-pin")
        unnamed = page.evaluate("""() => [...document.querySelectorAll('#dataset-browser :is(button, input, select, a[href])')]
            .filter(e => !e.hidden && e.offsetParent !== null)
            .filter(e => {
                const label = e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].textContent) || e.textContent || e.title || '';
                return !label.trim();
            }).map(e => e.outerHTML.slice(0, 120))""")
        assert not unnamed, unnamed
        ids = page.evaluate("[...document.querySelectorAll('[id]')].map(e => e.id)")
        assert len(ids) == len(set(ids)), sorted({i for i in ids if ids.count(i) > 1})
        # nothing aria-hidden can take focus
        hidden_focusable = page.evaluate("""() => [...document.querySelectorAll('#dataset-browser [aria-hidden=true] :is(button, input, select, a[href], [tabindex]:not([tabindex="-1"]))')].length""")
        assert hidden_focusable == 0
    finally:
        s.close()


def test_the_accessibility_snapshot_reads_as_a_dialog_with_a_table(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        snapshot = page.locator(BROWSER).aria_snapshot()
        for expected in ('dialog "Open a dataset"', "navigation \"Places\"", "table", "columnheader \"Name", "columnheader \"Cells",
                         "rowheader \"short.zarr", "button \"Regular expression search\"", "searchbox \"Search datasets by name or path\""):
            assert expected in snapshot, f"{expected!r} not in\n{snapshot}"
        # a row reads as its name, counts and format
        assert "200 cells, 20 genes, zarr v" in snapshot or "200 cells" in snapshot, snapshot
    finally:
        s.close()


# ---- the table ----------------------------------------------------------------------------------

def test_the_table_is_native_with_a_caption_sortable_headers_and_a_row_per_store(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        assert page.evaluate("document.querySelector('#dsb-table').tagName") == "TABLE"
        assert page.evaluate("document.querySelector('#dsb-table').getAttribute('role')") is None, "a native table, not role=grid"
        assert page.inner_text("#dsb-table caption") == "Datasets in Data directory, sorted by name ascending"
        headers = page.eval_on_selector_all("#dsb-table thead th", "els => els.map(e => [e.scope, e.getAttribute('aria-sort'), !!e.querySelector('button')])")
        assert all(h[0] == "col" and h[2] for h in headers), headers
        assert [h[1] for h in headers] == ["ascending", "none", "none", "none", "none", "none"]
        assert page.evaluate("[...document.querySelectorAll('#dsb-table tbody th')].every(th => th.scope === 'row')")
        # a name button points at what a row says
        described = page.eval_on_selector(f"{ROW}[data-path$='/short.zarr'] .dsb-name",
                                          "b => document.getElementById(b.getAttribute('aria-describedby')).textContent")
        assert described.startswith("200 cells, 20 genes, zarr v"), described
        broken = page.eval_on_selector(f"{ROW}[data-path$='broken.zarr'] .dsb-name", "b => [b.getAttribute('aria-disabled'), document.getElementById(b.getAttribute('aria-describedby')).textContent]")
        assert broken[0] == "true" and "cannot be opened: Not readable" in broken[1], broken
    finally:
        s.close()


def test_the_table_is_one_tab_stop_with_roving_focus_and_type_ahead(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        stops = page.eval_on_selector_all("#dsb-table tbody .dsb-name", "els => els.filter(e => e.tabIndex === 0).length")
        assert stops == 1
        page.keyboard.press("ArrowDown")                       # from the search field into the table
        first = page.evaluate("document.activeElement.closest('tr').dataset.path")
        assert page.evaluate("document.activeElement.classList.contains('dsb-name')")
        for key, expect in (("ArrowDown", "next"), ("End", "last"), ("Home", "first"), ("PageDown", "later"), ("ArrowUp", "earlier")):
            before = page.evaluate("[...document.querySelectorAll('#dsb-table tbody .dsb-name')].indexOf(document.activeElement)")
            page.keyboard.press(key)
            after = page.evaluate("[...document.querySelectorAll('#dsb-table tbody .dsb-name')].indexOf(document.activeElement)")
            total = page.locator("#dsb-table tbody .dsb-name").count()
            assert {"next": after == before + 1, "last": after == total - 1, "first": after == 0,
                    "later": after > before or after == total - 1, "earlier": after == before - 1}[expect], (key, before, after)
            # exactly one name button is tabbable, the focused one, and its row is the selected one (details follow)
            assert page.eval_on_selector_all("#dsb-table tbody .dsb-name", "els => els.filter(e => e.tabIndex === 0).length") == 1
        # Tab leaves the table (one stop), '/' returns to search
        page.keyboard.press("Home")
        page.keyboard.press("Tab")
        assert not page.evaluate("document.activeElement.classList.contains('dsb-name')")
        page.focus(f"{ROW}[data-kind='store'] .dsb-name")
        page.keyboard.press("/")
        assert page.evaluate("document.activeElement.id") == "dsb-search"
        # type-ahead: letters jump to the name that starts with them (Finder style)
        page.keyboard.press("ArrowDown")
        page.keyboard.type("oth")
        assert page.evaluate("document.activeElement.closest('tr').dataset.path").endswith("other_small.zarr")
        assert first
        assert not s.errors, s.errors
    finally:
        s.close()


def test_live_regions_say_the_count_and_the_opening_and_errors_are_assertive(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        assert page.get_attribute("#dataset-status", "role") == "status" and page.get_attribute("#dataset-status", "aria-live") == "polite"
        assert page.get_attribute("#dataset-alert", "role") == "alert"
        open_browser(page)
        assert page.get_attribute("#dsb-status", "role") == "status" and page.get_attribute("#dsb-status", "aria-live") == "polite"
        page.wait_for_function("/\\d+ datasets? and 1 folder/.test(document.querySelector('#dsb-status').textContent)", timeout=5_000)
        page.fill("#dsb-search", "short")
        page.wait_for_function("/match 'short'/.test(document.querySelector('#dsb-status').textContent)", timeout=5_000)
        close_browser(page)
        open_dataset(page, os.path.join(data, "short.zarr"))
        page.wait_for_function("document.getElementById('dataset-status').textContent === 'Opened short.zarr'", timeout=10_000)
    finally:
        s.close()


# ---- colour -------------------------------------------------------------------------------------

#: (what, selector) text pairs of the browser and the button, each at least 4.5:1 in both themes
TEXT_PAIRS = [
    ("row name", ".dsb-row:not(.dsb-unreadable) .dsb-name"), ("unreadable name", ".dsb-row.dsb-unreadable .dsb-name"),
    ("unreadable reason", ".dsb-row.dsb-unreadable .dsb-reason"), ("folder line", ".dsb-probe-rel"),
    ("match badge", ".dsb-probe .dsb-badge-match"), ("open badge", ".dsb-probe .dsb-badge-open"), ("link badge", ".dsb-probe .dsb-badge-quiet"),
    ("column header", ".dsb-sort"), ("place", ".dsb-place:not([aria-current])"), ("current place", ".dsb-place[aria-current='true']"),
    ("breadcrumb", ".dsb-crumb:not([aria-current])"), ("current crumb", ".dsb-crumb[aria-current='location']"),
    ("empty state", ".dsb-probe-state"), ("banner", ".dsb-banner"), ("details field name", ".dsb-fields dt"),
    ("details value", ".dsb-fields dd"), ("details key", ".dsb-key"), ("details note", ".dsb-note-warn"), ("details check ok", ".dsb-note-ok"),
    ("selected row name", ".dsb-row.selected .dsb-name"), ("button, none", "#dataset-button[data-state=none]"),
    ("button, open", "#dataset-button[data-state=open]"), ("button hint", ".dataset-button-hint"),
]


def _probe(page):
    """Rows and notes the page does not always show, added so every pair can be measured."""
    page.evaluate("""() => {
        const line = document.querySelector('#dsb-table tbody tr .dsb-nameline');
        const probe = document.createElement('div'); probe.className = 'dsb-probe dsb-nameline';
        probe.innerHTML = '<span class="dsb-badge dsb-badge-match">same cells and genes</span><span class="dsb-badge dsb-badge-open">open</span><span class="dsb-badge dsb-badge-quiet">link</span>';
        line.parentElement.appendChild(probe);
        const rel = document.createElement('div'); rel.className = 'dsb-rel dsb-probe-rel'; rel.textContent = 'projects/liver/'; line.parentElement.appendChild(rel);
        const crumb = document.createElement('li'); crumb.innerHTML = '<button class="dsb-crumb" type="button">projects</button>'; document.querySelector('.dsb-crumb-list').prepend(crumb);
        const state = document.createElement('div'); state.className = 'dsb-state dsb-probe-state'; state.textContent = 'Nothing pinned.'; document.querySelector('#dsb-table-wrap').appendChild(state);
        const banner = document.getElementById('dataset-browser-banner'); banner.hidden = false; banner.textContent = 'This view was saved on x.zarr'; banner.classList.add('dsb-banner-warn');
        const body = document.querySelector('#dsb-details .dsb-details-body') || document.getElementById('dsb-details');
        const warn = document.createElement('div'); warn.className = 'dsb-note dsb-note-warn'; warn.textContent = 'Store check: warning'; body.appendChild(warn);
        const ok = document.createElement('div'); ok.className = 'dsb-note dsb-note-ok'; ok.textContent = 'Store check: ok'; body.appendChild(ok);
    }""")


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_the_new_colour_pairs_meet_wcag_in_both_themes(server, scheme):
    base, data = server
    s = Session(base, scheme=scheme)
    page = s.page
    try:
        # the button, as an open dataset says it, and with none
        none_colours = page.evaluate(COLOURS, "#dataset-button")
        hint = page.evaluate(COLOURS, "#dataset-button-hint")
        open_dataset(page, os.path.join(data, "short.zarr"))
        open_browser(page)
        page.click("#dsb-places [data-place='root']")                   # Recent has no unreadable store
        browser_row(page, "short.zarr").first.locator("td").first.click()
        page.wait_for_selector("#dsb-details .dsb-key", timeout=10_000)
        _probe(page)
        bad = []
        for what, sel in TEXT_PAIRS:
            if what in ("button, none", "button hint"):
                c = none_colours if what == "button, none" else hint
                if c is None or not c["visible"]:
                    c = None
            elif what == "button, open":
                c = page.evaluate(COLOURS, "#dataset-button")
            else:
                c = page.evaluate(COLOURS, sel)
            if what in ("button, none", "button hint") and c is None:
                continue
            assert c is not None, f"{what}: no element for {sel}"
            ratio = _ratio(c["color"], c["bg"])
            if ratio < 4.5:
                bad.append((what, c["color"], c["bg"], round(ratio, 2)))
        assert not bad, (scheme, bad)
    finally:
        s.close()


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_the_focus_ring_and_the_selection_mark_are_visible_in_both_themes(server, scheme):
    """A 2 px outline in the link colour (3:1 against what is behind it); selection is a background and a bar, focus an outline."""
    base, data = server
    s = Session(base, scheme=scheme)
    page = s.page
    try:
        open_browser(page)
        page.keyboard.press("ArrowDown")                              # focus a row's name by keyboard
        ring = page.evaluate(COLOURS, ".dsb-name:focus-visible")
        assert ring and ring["outlineStyle"] == "solid" and ring["outlineWidth"] == "2px", ring
        link = page.evaluate("""() => { const p = document.createElement('i'); p.style.color = 'var(--az-link)'; document.body.appendChild(p);
            const c = getComputedStyle(p).color; p.remove(); return c; }""")
        assert _ratio(ring["outline"], ring["bg"]) >= 3, ring
        assert ring["outline"] == link, (ring["outline"], link)
        # the selected row: a background of its own and a 3 px bar (selection differs from focus)
        row = browser_row(page, "short.zarr").first
        row.locator("td").first.click()
        marks = page.evaluate("""() => { const tr = document.querySelector('#dsb-table tbody tr.selected');
            const cell = tr.firstElementChild, other = document.querySelector('#dsb-table tbody tr:not(.selected) > :first-child');
            return {bg: getComputedStyle(cell).backgroundColor, plain: getComputedStyle(other).backgroundColor,
                    bar: getComputedStyle(cell).boxShadow}; }""")
        assert marks["bg"] != marks["plain"] and "3px" in marks["bar"], marks
        assert _ratio(link, marks["bg"]) >= 3, (link, marks)
        assert marks["bar"].startswith(link), marks
        close_browser(page)
        page.wait_for_function("document.activeElement && document.activeElement.id === 'dataset-button'", timeout=5_000)
        for sel in ("#dataset-button", "#refresh-dataset"):
            page.focus(sel)
            page.keyboard.press("Shift+Tab")
            page.keyboard.press("Tab")
            ring = page.evaluate(COLOURS, f"{sel}:focus-visible")
            assert ring and ring["outlineWidth"] == "2px" and ring["outlineStyle"] == "solid", (sel, ring)
    finally:
        s.close()


def test_forced_colours_use_the_system_selection_and_keep_the_outline(server):
    base, data = server
    s = Session(base, forced_colors="active")
    page = s.page
    try:
        open_browser(page)
        browser_row(page, "short.zarr").first.locator("td").first.click()
        res = page.evaluate("""() => { const cell = document.querySelector('#dsb-table tbody tr.selected > :first-child');
            const probe = document.createElement('div'); probe.style.backgroundColor = 'Highlight'; document.body.appendChild(probe);
            const r = {adjust: getComputedStyle(cell).forcedColorAdjust, bg: getComputedStyle(cell).backgroundColor, highlight: getComputedStyle(probe).backgroundColor,
                       color: getComputedStyle(cell).color}; probe.remove(); return r; }""")
        assert res["adjust"] == "none" and res["bg"] == res["highlight"], res
        page.focus("#dsb-search")
        page.keyboard.press("ArrowDown")
        ring = page.evaluate(COLOURS, ".dsb-name:focus-visible")
        assert ring and ring["outlineStyle"] == "solid" and ring["outlineWidth"] != "0px", ring
    finally:
        s.close()


def test_reduced_motion_stops_the_spinner_and_the_dialog_fade(server):
    base, data = server
    s = Session(base, reduced_motion="reduce")
    page = s.page
    try:
        page.route("**/api/v1/data/dataset_structure*", lambda route: (page.wait_for_timeout(1500), route.continue_()))
        page.evaluate("(p) => { window.annzarro.openDataset(p); }", os.path.join(data, "short.zarr"))
        page.wait_for_function("document.querySelector('#dataset-button').dataset.state === 'opening'", timeout=10_000)
        spin = page.evaluate("""() => { const i = document.querySelector('#dataset-button .dataset-spin');
            return i ? [getComputedStyle(i).animationName, getComputedStyle(i, '::before').content] : null; }""")
        assert spin and spin[0] == "none", spin               # nothing turns ...
        assert "\uf254" in spin[1], spin                      # ... a static hourglass and the text say "opening"
        wait_for_open(page, "short.zarr")
        open_browser(page)
        assert page.evaluate("getComputedStyle(document.getElementById('dataset-browser')).transitionDuration") in ("0s", "0s, 0s")
        assert page.evaluate("getComputedStyle(document.querySelector('#dataset-browser .modal-dialog')).transitionDuration") in ("0s", "0s, 0s")
    finally:
        s.close()


# ---- narrow and touch layouts ---------------------------------------------------------------------

def test_the_details_pane_is_a_pane_above_1100_px_a_sheet_below_and_hidden_on_a_phone_until_asked_for(server):
    base, data = server
    s = Session(base, width=1280)
    page = s.page
    try:
        open_browser(page)
        shown = lambda sel: page.evaluate(f"(() => {{ const e = document.querySelector({sel!r}); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; }})()")
        assert shown("#dsb-details") and shown("#dsb-places") and not shown(".dsb-info")
        assert not page.evaluate("getComputedStyle(document.querySelector('#dsb-places-select')).display !== 'none'")
        page.set_viewport_size({"width": 900, "height": 800})
        page.wait_for_timeout(200)
        assert not shown("#dsb-details") and shown("#dsb-places") and shown(".dsb-info")
        # the (i) button of a row opens the details as a sheet, with a way to close it
        browser_row(page, "short.zarr").first.locator(".dsb-info").click()
        page.wait_for_selector("#dataset-browser.dsb-sheet #dsb-details .dsb-details-name")
        assert shown("#dsb-details") and "short.zarr" in page.inner_text("#dsb-details")
        page.click("#dsb-details .dsb-sheet-close")
        assert not shown("#dsb-details")
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    finally:
        s.close()


def test_on_a_phone_the_dialog_fills_the_screen_places_are_a_select_and_columns_shrink(server):
    base, data = server
    s = Session(base, width=700, height=800)
    page = s.page
    try:
        open_browser(page)
        box = page.locator(f"{BROWSER} .modal-content").bounding_box()
        assert box["width"] >= 699 and box["height"] >= 790, box
        assert page.evaluate("getComputedStyle(document.querySelector('#dsb-places')).display") == "none"
        assert page.is_visible("#dsb-places-select")
        options = page.eval_on_selector_all("#dsb-places-select option", "els => els.map(o => o.textContent)")
        assert options[:3] == ["Recent", "Pinned", "Data directory"], options
        visible_cols = page.eval_on_selector_all("#dsb-table thead th", "els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.textContent.trim().replace(/[\\u25b2\\u25bc]/g, ''))")
        assert visible_cols == ["Name", "Cells", "Modified"], visible_cols
        page.select_option("#dsb-places-select", "pinned")
        assert "Nothing pinned" in page.inner_text("#dsb-table-wrap")
        page.select_option("#dsb-places-select", "root")
        browser_row(page, "short.zarr").wait_for()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        # a tap on the name opens
        browser_row(page, "short.zarr").locator(".dsb-name").click()
        wait_for_open(page, "short.zarr")
    finally:
        s.close()


def test_a_coarse_pointer_gets_targets_of_at_least_44_px(server):
    base, data = server
    s = Session(base, width=800, height=900, has_touch=True, is_mobile=True)
    page = s.page
    try:
        assert page.evaluate("window.matchMedia('(pointer: coarse)').matches")
        open_browser(page)
        small = page.evaluate("""() => [...document.querySelectorAll('#dataset-browser :is(.dsb-name, .dsb-place, .dsb-crumb, .dsb-sort)')]
            .filter(e => e.offsetParent !== null && e.getBoundingClientRect().width > 0)
            .filter(e => e.getBoundingClientRect().height < 43.5).map(e => e.className + ' ' + e.getBoundingClientRect().height)""")
        assert not small, small
    finally:
        s.close()


def test_the_dataset_button_and_refresh_are_at_least_24_px(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        for sel in ("#dataset-button", "#refresh-dataset"):
            box = page.locator(sel).bounding_box()
            assert box["width"] >= 24 and box["height"] >= 24, (sel, box)
    finally:
        s.close()
