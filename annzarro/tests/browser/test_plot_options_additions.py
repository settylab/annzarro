"""The renderer additions of the pop-over unification (U2), in a real browser: the shared Plot Options renderer
(plot-utilities/options-popover.js) mounted on a synthetic kind, so nothing of the Cell Plot or Gene Plot is needed.

placeholder + stepFrom, shown, disabled with its reason, a select's null choice, a percent range, the margins composite,
the memory guard of the export buttons, a kind's own presets, and the panel's own Apply and session default.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import served, page, _url  # noqa: E402,F401 (the fixtures)

POP = "[data-popover='plot-options']"

HARNESS = """async () => {
  const S = await import('/static/js/panels/plot-utilities/options-schema.js');
  const R = await import('/static/js/panels/plot-utilities/options-popover.js');
  const M0 = { l: 80, r: 80, t: 80, b: 60, pad: 4 };
  const f = (id, section, type, label, dflt, extra = {}) => ({ id, section, type, path: id, label, dflt, ...extra });
  S.registerKind('unify-test', { order: ['presets', 'axes', 'legend', 'margins', 'export', 'apply'], common: false,
    preset: (config, name) => (name === 'bare' ? { ...config, bare: true } : (({ bare, ...rest }) => rest)(config)) });
  S.registerPanelFields('unify-test', [
    f('bare', 'presets', 'check', 'Bare', false),
    f('tickCount', 'axes', 'number', 'Ticks per axis', null, { min: 2, max: 30, step: 1, placeholder: 'auto', stepFrom: 6, domId: 'tick-count' }),
    f('titleSize', 'legend', 'number', 'Title size (px)', null, { min: 6, max: 40, step: 1, placeholder: (c) => (c.fontSize || 12) + 2, stepFrom: true }),
    f('showTickMarks', 'axes', 'check', 'Tick marks', null, { shown: (c) => c.showAxisLabels !== false }),
    f('showScaleBar', 'axes', 'check', 'Scale bar', false, { disabled: (c) => (c.equalAspect ? '' : 'Needs Equal aspect.') }),
    f('flipX', 'axes', 'check', 'Flip x', false, { copy: false, look: false }),
    f('align', 'legend', 'select', 'Title align', null, { choices: [[null, 'Auto'], ['markers', 'Markers'], ['right', 'Right']] }),
    f('barSize', 'axes', 'range', 'Size', 1, { min: 0.25, max: 4, step: 0.05, percent: true }),
    f('margins', 'margins', 'margins', 'Margins', M0, { unlinkedPath: 'marginsUnlinked', min: 0, max: 200 }),
  ]);
  const state = { config: {}, commits: [], guard: null, others: 2, applied: 0, session: false };
  const btn = document.createElement('button');
  btn.id = 'unify-anchor'; btn.textContent = 'Options'; document.body.append(btn);
  window.__unify = state;
  let po = null;
  po = R.mountPlotOptions({
    anchor: btn, kind: 'unify-test', panelId: 'u1', ids: true, config: () => state.config,
    commit: (next, label) => { state.config = next; state.commits.push(label); po.update(); },
    replace: (next) => { state.config = next; },
    exportImage: (format, settings, how) => { state.exported = [format, how]; },
    exportGuard: () => state.guard,
    others: { count: () => state.others, run: () => { state.applied += 1; return state.others; } },
    session: { set: () => { state.session = true; }, clear: () => { state.session = false; }, has: () => state.session, onDefault: () => false },
  });
  btn.click();
  return true;
}"""


@pytest.fixture
def opened(page, served):
    page.goto(_url(served, [], {}))
    page.wait_for_function("() => !!window.PanelManager", timeout=60000)
    page.evaluate(HARNESS)
    page.wait_for_selector(POP)
    _unfold(page)
    return page


def _unfold(page):
    """Every section open (only some start open)."""
    page.evaluate("() => document.querySelectorAll(\"[data-popover='plot-options'] details\").forEach((d) => { d.open = true; })")


def _reopen(page):
    page.click("#unify-anchor")
    page.click("#unify-anchor")
    page.wait_for_selector(POP)
    _unfold(page)


def _state(page, key):
    return page.evaluate("(k) => window.__unify[k]", key)


def test_an_empty_number_box_shows_its_default_and_its_arrows_step_from_it(opened):
    page = opened
    box = f"{POP} #tick-count-u1"
    assert page.get_attribute(box, "placeholder") == "auto"
    assert page.get_attribute(box, "data-step-from") == "6"
    page.focus(box)
    page.keyboard.press("ArrowUp")
    assert _state(page, "config")["tickCount"] == 7, "from 6, not from the minimum 2"
    page.fill(box, "")
    page.press(box, "Enter")
    assert "tickCount" not in _state(page, "config")
    # a placeholder that is a function of the configuration
    title = f"{POP} [data-option='titleSize']"
    assert page.get_attribute(title, "placeholder") == "14"
    page.evaluate("() => { window.__unify.config = { fontSize: 20 }; }")
    _reopen(page)
    assert page.get_attribute(title, "placeholder") == "22"
    assert page.get_attribute(title, "data-step-from") == "22"


def test_a_control_shows_what_it_stands_for_while_nothing_is_stored(opened):
    page = opened
    assert page.is_checked(f"{POP} [data-option='showTickMarks']"), "no tick labels rule: shown on"
    page.evaluate("() => { window.__unify.config = { showAxisLabels: false }; }")
    _reopen(page)
    assert not page.is_checked(f"{POP} [data-option='showTickMarks']")


def test_a_disabled_field_says_why_in_its_help(opened):
    page = opened
    box = f"{POP} [data-option='showScaleBar']"
    assert page.is_disabled(box)
    assert "Needs Equal aspect." in page.inner_text(f"{POP} .az-pop-field--check:has([data-option='showScaleBar']) .az-pop-help")
    assert page.get_attribute(box, "title") == "Needs Equal aspect."


def test_a_select_with_a_null_choice_writes_absent(opened):
    page = opened
    sel = f"{POP} [data-option='align']"
    page.select_option(sel, "right")
    assert _state(page, "config")["align"] == "right"
    page.select_option(sel, "")
    assert "align" not in _state(page, "config")
    assert page.input_value(sel) == ""


def test_a_percent_range_shows_percent_and_stores_a_fraction(opened):
    page = opened
    box = f"{POP} [data-option='barSizeNumber']"
    assert page.input_value(box) == "100"
    page.fill(box, "250")
    page.press(box, "Enter")
    assert _state(page, "config")["barSize"] == 2.5
    assert page.input_value(box) == "250"
    assert page.get_attribute(f"{POP} [data-option='barSize']", "max") == "400"


def test_flips_are_views_not_reset_by_their_section(opened):
    page = opened
    page.check(f"{POP} [data-option='flipX']")
    page.fill(f"{POP} #tick-count-u1", "9")
    page.press(f"{POP} #tick-count-u1", "Enter")
    page.click(f"{POP} [data-reset='axes']")
    cfg = _state(page, "config")
    assert cfg.get("flipX") is True and "tickCount" not in cfg


def test_the_margins_composite_links_and_unlinks(opened):
    page = opened
    assert page.is_hidden(f"{POP} #margin-sides-u1")
    page.fill(f"{POP} #margin-all-input-u1", "20")
    page.press(f"{POP} #margin-all-input-u1", "Enter")
    assert _state(page, "config")["margins"] == {"l": 20, "r": 20, "t": 20, "b": 20, "pad": 4}
    page.check(f"{POP} #margins-unlink-u1")
    assert page.is_visible(f"{POP} #margin-sides-u1")
    assert page.is_disabled(f"{POP} #margin-all-input-u1")
    page.fill(f"{POP} #margin-top-u1", "5")
    page.press(f"{POP} #margin-top-u1", "Enter")
    cfg = _state(page, "config")
    assert cfg["marginsUnlinked"] is True and cfg["margins"]["t"] == 5 and cfg["margins"]["l"] == 20
    page.uncheck(f"{POP} #margins-unlink-u1")
    assert _state(page, "config")["margins"]["l"] == 5, "linked again: the top value on every side"
    page.click(f"{POP} [data-reset='margins']")
    cfg = _state(page, "config")
    assert "margins" not in cfg and "marginsUnlinked" not in cfg


def test_the_memory_guard_greys_the_full_export_and_offers_the_plot_as_shown(opened):
    page = opened
    assert page.locator(f"{POP} .export-shown-row").count() == 0
    page.evaluate("""() => { window.__unify.guard = { blocked: true, why: 'Needs 3 GB; 1 GB is free.', note: 'Full resolution: Needs 3 GB; 1 GB is free.',
        shown: ['png', 'svg'], size: '900 \\u00d7 600 px' }; }""")
    _reopen(page)
    assert page.is_disabled(f"{POP} #download-png-u1")
    assert page.get_attribute(f"{POP} #download-svg-u1", "title") == "Needs 3 GB; 1 GB is free."
    assert "Full resolution: Needs 3 GB" in page.inner_text(f"{POP} .export-memory-note")
    assert "As shown (900 × 600 px)" in page.inner_text(f"{POP} .export-shown-row")
    page.click(f"{POP} #download-shown-svg-u1")
    assert _state(page, "exported") == ["svg", "shown"]


def test_a_kinds_own_presets_and_the_panels_own_apply_and_session_default(opened):
    page = opened
    page.click(f"{POP} [data-preset='bare']")
    assert _state(page, "config")["bare"] is True
    page.click(f"{POP} [data-preset='default']")
    assert "bare" not in _state(page, "config")
    page.click(f"{POP} .az-pop-apply-others")
    assert page.inner_text(f"{POP} .az-pop-ask .az-pop-help").startswith("Replace the look of 2 other plots")
    page.click(f"{POP} .az-pop-apply-yes")
    assert page.inner_text(f"{POP} .az-pop-apply-done") == "Applied to 2 plots."
    assert _state(page, "applied") == 1
    page.click(f"{POP} .az-pop-session-set")
    assert _state(page, "session") is True
    assert page.is_visible(f"{POP} .az-pop-session-reset")
