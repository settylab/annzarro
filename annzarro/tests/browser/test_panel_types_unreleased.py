"""F7: the new panel types are registered and unreleased, in a real browser.

The chooser does not offer them, a reserved id is skipped without an error (PER-7), and a link that names an
unreleased type keeps it as a placeholder with the settings it carried and its default title.
"""
import json
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_disabled_panels import browser, env, menu, server  # noqa: E402,F401
from annzarro.tests.browser.test_gene_set_panel import TABLE, _link  # noqa: E402

RELEASED = ["cell-plot", "gene-plot", "cell-table", "gene-table", "gene-set", "gene-signature"]
READY = "() => !!window.PanelManager && !!window.PanelManager.getPanel('gene-table-A')"


def _open(page, root):
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(_link(root))
    page.wait_for_selector(f"{TABLE} .dataTables_scrollBody tbody tr", timeout=30000)
    page.wait_for_function(READY)
    return errors


def test_the_chooser_offers_the_released_types_only(env):
    page, services, policy, root = env
    _open(page, root)
    assert menu(page) == RELEASED


def test_a_reserved_type_is_skipped_without_an_error(env):
    page, services, policy, root = env
    errors = _open(page, root)
    for reserved in ("gene-count", "group-stat"):
        assert page.evaluate("(t) => window.PanelManager.createPanelInLayout(t, {}) === null", reserved)
        assert page.evaluate("(t) => window.PanelManager.registerClosedPanel(t, {}) === null", reserved)
        assert not page.evaluate("(t) => window.PanelManager.canRestoreClosed(t)", reserved)
    assert not [e for e in errors if "gene-count" in e or "group-stat" in e], errors
    # an id nobody registered still reports itself
    assert page.evaluate("() => window.PanelManager.createPanelInLayout('no-such-type', {}) === null")
    assert any("no-such-type" in e for e in errors), errors


def test_an_unreleased_type_is_a_placeholder_titled_by_its_label(env):
    page, services, policy, root = env
    _open(page, root)
    title = page.evaluate("() => window.PanelManager.createPanelInLayout('cell-gene', {version: 1, future: {a: 1}}).getTitle()")
    assert title == "Cell-Gene Plot 1"
    page.wait_for_selector('.panel-no-data[data-panel-type="cell-gene"]')
    saved = page.evaluate("() => Object.values(window.PanelManager.saveLayout().panelConfigs).find(c => c.id.startsWith('cell-gene'))")
    assert saved["future"] == {"a": 1} and saved["version"] == 1, json.dumps(saved)
    assert menu(page) == RELEASED


WIDTHS = """() => [...document.querySelectorAll('.tile[data-tile-id^="cell-plot"] .axis-type-select:is([data-axis="x"], [data-axis="y"], [data-axis="color"])')]
    .map(s => Math.round(s.getBoundingClientRect().width))"""


def test_one_long_type_widens_the_type_select_of_every_row(env):
    page, services, policy, root = env
    _open(page, root)
    page.evaluate("() => window.PanelManager.createPanelInLayout('cell-plot', {})")
    page.wait_for_function("() => document.querySelectorAll('.tile[data-tile-id^=\"cell-plot\"] .axis-type-select').length >= 2")
    try:
        page.wait_for_function(f"() => {{ const w = ({WIDTHS})(); return w.length >= 2 && w.every(x => x > 0); }}", timeout=8000)
    except Exception:
        raise AssertionError(page.evaluate("""() => [...document.querySelectorAll('.tile[data-tile-id^="cell-plot"] .axis-type-select')].map(s => [s.dataset.axis, s.value, s.getBoundingClientRect().width])"""))
    before = page.evaluate(WIDTHS)
    assert len(set(before)) == 1, before
    # one row takes a long type (here a stand-in option: no grouping exists yet): every row's select widens, together
    page.evaluate("""() => {
        const select = document.querySelector('.tile[data-tile-id^="cell-plot"] .axis-type-select[data-axis="x"]');
        select.add(new Option('cell-group', 'cell-group'));
        select.value = 'cell-group';
    }""")
    page.wait_for_function(f"() => ({WIDTHS})().every(w => w > {before[0]})")
    after = page.evaluate(WIDTHS)
    assert len(set(after)) == 1 and after[0] > before[0], (before, after)
