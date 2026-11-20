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
