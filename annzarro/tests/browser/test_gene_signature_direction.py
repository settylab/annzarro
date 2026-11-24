"""Up and down genes in the Gene Signature panel, in a real browser (step 9 of the gene-signature plan).

Behind the **Up/Down** toggle on the gene list's toolbar, beside Add from (decision 31: direction is a property of the
gene list; how down genes weigh stays in the Methods pop-over), so the first view does not change. When it is on, every
selected gene has a direction button, a bulk change acts on the rows shown, Add from, Paste and the focused gene add as
Up or Down, and every direction change is one undoable step. A flip changes the score's key; the methods without a
signed version are graded "cannot" with the reason; a link carries the down genes and an old link has none.

1.  The first view has no direction anywhere; Up/Down is in the list toolbar and not pressed.
2.  Flip one gene: the button, the counts, the key; Undo and Ctrl+Z restore both sides.
3.  Bulk change acts on the rows the search and the filter show, and is one undo step; the filter lists a side.
4.  Paste preview: Add as Down; Add from and the focused gene follow the Add as choice; each is one undo step.
5.  Up/Down turned off with down genes asks first; Count as up is one undo step; Keep leaves it as it was.
6.  Link and panel set round trip; an old link has no down genes.
7.  The score request carries the down genes; a flip asks again, Undo does not; a gene table has no direction.
8.  Methods without a signed version are graded "cannot", with the reason, and a consumer of one says so.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import urllib.parse

from annzarro.tests.browser.test_gene_score_plots import (  # noqa: F401  (the fixtures are used by name)
    C, INIT, S, SIG, SCORE, _calls, _cell, _notice, _open, _sig, _wait_coloured, page, served,
)
from annzarro.tests.browser.test_memory_guard import until

METHODS = f"{S} [data-methods]"
POP = "[data-popover='methods']"
SWITCH = f"{S} .gsig-add-row [data-directions]"
SELECTED = f"{S} .gsig-seg:nth-child(2)"
ROWS = f"{S} .gsig-row"
DIR = f"{S} .gsig-row .gsig-dir"
FIRST = ["GENE0001", "GENE0002", "GENE0003", "GENE0004", "GENE0005", "GENE0006"]

RECORD = """
const inner = window.fetch;
window.__recipes = [];
window.fetch = async (url, init) => {
  if (String(url).includes('/data/gene_score')) {
    try { const b = JSON.parse(init.body); window.__recipes.push(Object.assign({ for: b.estimate_only ? 'estimate' : 'compute' }, b.recipe)); } catch (e) { /* not ours */ }
  }
  return inner(url, init);
};
"""


def _panel(page, served, genes=FIRST, down=(), **extra):
    extra = {**extra, **({"down": list(down)} if down else {})}
    _open(page, served, plots=(), sig=_sig(genes, **extra), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)


def _recipe(page):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getRecipe()", SIG)


def _hash(page):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getRecipeHash()", SIG)


def _sides(page):
    r = _recipe(page)
    return r["genes"], r["down"]


def _expand(page):
    """Open the Methods pop-over (where the down weighting is)."""
    if page.query_selector(POP) is None:
        page.click(METHODS)
    page.wait_for_selector(POP, state="visible")


def _pressed(page):
    return page.get_attribute(SWITCH, "aria-pressed") == "true"


def _switch_on(page):
    if not _pressed(page):
        page.click(SWITCH)
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().directions === true", SIG)


def _selected_view(page):
    page.click(SELECTED)
    until(page, "(id) => window.PanelManager.getPanel(id)._debugState().view === 'selected'", SIG)


def _summary(page):
    return page.inner_text(f"{S} .gsig-summary")


def _message(page):
    return page.inner_text(f"{S} .gsig-message")


def _dir_labels(page):
    return page.eval_on_selector_all(DIR, "els => els.filter(e => !e.hidden).map(e => e.dataset.direction)")


def _row_names(page):
    return page.eval_on_selector_all(ROWS, "els => els.map(e => e.querySelector('.gsig-name').textContent)")


def _until_sides(page, up, down):
    until(page, "([id, up, down]) => { const r = window.PanelManager.getPanel(id).getRecipe(); return JSON.stringify([r.genes, r.down]) === JSON.stringify([up, down]); }",
          [SIG, up, down])


# ------------------------------------------------------------------ 1. the first view

def test_the_first_view_has_nothing_about_direction(page, served):
    _panel(page, served)
    assert _summary(page) == "6 genes selected"
    _selected_view(page)
    assert page.locator(f"{DIR}:visible").count() == 0
    assert page.locator(f"{S} .gsig-dirbar").is_hidden() and page.locator(f"{S} .gsig-addas-wrap").is_hidden()
    assert "up" not in page.inner_text(f"{S} .gsig-seg:nth-child(2)")
    assert page.locator(SWITCH).count() == 1 and not _pressed(page)
    assert page.inner_text(SWITCH) == "Up/Down"
    assert page.get_attribute(SWITCH, "title") == "Score some genes as down: they count against the score"
    # beside Add from, in the list's toolbar
    assert page.evaluate("(s) => document.querySelector(s + ' .gsig-add-row').contains(document.querySelector(s + ' .gsig-addfrom'))", S)
    _expand(page)
    assert page.locator(f"{POP} [data-weighting]:visible").count() == 0
    assert page.locator(f"{POP} [data-direction-formula]").is_hidden()
    cfg = page.evaluate("() => window.sessionManager.captureView().layout.panelConfigs['gene-signature-S']")
    assert cfg["down"] == [] and "directions" not in cfg, "an old link is what it was"


# ------------------------------------------------------------------ 2. flip

def test_flip_a_gene_counts_it_changes_the_key_and_undo_restores_both_sides(page, served):
    _panel(page, served)
    before = _hash(page)
    _switch_on(page)
    assert _hash(page) == before, "the switch is not a score setting"
    assert _summary(page) == "6 genes selected", "no down gene yet, so nothing is said"
    _selected_view(page)
    assert _dir_labels(page) == ["up"] * 6
    assert page.inner_text(f"{S} .gsig-row:nth-child(1) .gsig-dir") == "↑ Up"
    page.click(f"{S} .gsig-row[aria-rowindex='2'] .gsig-dir")
    _until_sides(page, [g for g in FIRST if g != "GENE0002"], ["GENE0002"])
    assert _summary(page) == "6 genes selected: 5 up, 1 down"
    assert page.inner_text(SELECTED) == "Selected 6: 5 up, 1 down"
    row = page.locator(f"{S} .gsig-row[aria-rowindex='2']")
    assert row.locator(".gsig-dir").inner_text() == "↓ Down"
    assert "Press to make it up" in row.locator(".gsig-dir").get_attribute("aria-label")
    assert _message(page) == "GENE0002 is now down."
    flipped = _hash(page)
    assert flipped != before, "the key changes when a gene flips"
    assert page.get_attribute(f"{S} .gsig-undo", "title") == "Undo: make GENE0002 down"
    # the row stays where it is (like a tick), and the whole list is still there
    assert _row_names(page) == FIRST
    page.click(f"{S} .gsig-undo")
    _until_sides(page, FIRST, [])
    assert _hash(page) == before and _summary(page) == "6 genes selected"
    # Ctrl+Z outside a text field does the same
    page.click(f"{S} .gsig-row[aria-rowindex='3'] .gsig-dir")
    _until_sides(page, [g for g in FIRST if g != "GENE0003"], ["GENE0003"])
    page.focus(f"{S} .gsig-row[aria-rowindex='3'] .gsig-dir")
    page.keyboard.press("Control+z")
    _until_sides(page, FIRST, [])


def test_the_direction_button_is_in_the_keyboard_order_of_the_row(page, served):
    _panel(page, served)
    _switch_on(page)
    _selected_view(page)
    page.focus(f"{S} .gsig-row[aria-rowindex='1'] input")
    page.keyboard.press("ArrowRight")
    assert page.evaluate("() => document.activeElement.classList.contains('gsig-dir')")
    page.keyboard.press("Enter")
    _until_sides(page, FIRST[1:], ["GENE0001"])
    page.keyboard.press("ArrowLeft")
    assert page.evaluate("() => document.activeElement.type === 'checkbox'")


# ------------------------------------------------------------------ 3. bulk and filter

def test_bulk_change_acts_on_the_rows_shown_in_one_undo_step(page, served):
    _panel(page, served, genes=FIRST + ["KLF1"], down=["GAPDH"])
    _selected_view(page)
    assert _summary(page) == "8 genes selected: 7 up, 1 down"
    assert page.locator(f"{S} .gsig-dirbar").is_visible()
    # search narrows what is shown
    page.fill(f"{S} .gsig-search", "GENE000")
    until(page, "(t) => window.PanelManager.getPanel('gene-signature-S')._debugState().search.query === t", "GENE000")
    until(page, "([sel, want]) => JSON.stringify([...document.querySelectorAll(sel)].map(e => e.querySelector('.gsig-name').textContent)) === JSON.stringify(want)", [ROWS, FIRST])
    assert _row_names(page) == FIRST
    up_btn, down_btn = page.locator(f"{S} [data-set-shown='up']"), page.locator(f"{S} [data-set-shown='down']")
    assert down_btn.inner_text() == "Set 6 shown to Down" and up_btn.is_disabled(), "every gene shown is already up"
    down_btn.click()
    _until_sides(page, ["KLF1"], sorted(FIRST + ["GAPDH"]))
    assert _message(page) == "6 genes are now down."
    assert page.get_attribute(f"{S} .gsig-undo", "title") == "Undo: make 6 genes down"
    assert down_btn.is_disabled() and up_btn.inner_text() == "Set 6 shown to Up"
    page.click(f"{S} .gsig-undo")
    _until_sides(page, sorted(FIRST + ["KLF1"]), ["GAPDH"])
    assert page.locator(f"{S} .gsig-undo").is_disabled(), "one step"


def test_the_filter_lists_one_side_and_bulk_change_follows_it(page, served):
    _panel(page, served, genes=FIRST[:4], down=FIRST[4:])
    _selected_view(page)
    page.select_option(f"{S} [data-dir-filter]", "down")
    until(page, "() => window.PanelManager.getPanel('gene-signature-S')._debugState().rows === 2")
    assert _row_names(page) == FIRST[4:] and _dir_labels(page) == ["down", "down"]
    page.select_option(f"{S} [data-dir-filter]", "up")
    until(page, "() => window.PanelManager.getPanel('gene-signature-S')._debugState().rows === 4")
    assert _dir_labels(page) == ["up"] * 4
    # making a shown gene the other side takes it out of this filter
    page.click(f"{S} [data-set-shown='down']")
    _until_sides(page, [], FIRST)
    until(page, "() => window.PanelManager.getPanel('gene-signature-S')._debugState().rows === 0")
    assert _row_names(page) == []
    page.select_option(f"{S} [data-dir-filter]", "all")
    until(page, "() => window.PanelManager.getPanel('gene-signature-S')._debugState().rows === 6")


# ------------------------------------------------------------------ 4. Add as

def _add_as(page, side):
    page.click(f"{S} [data-add-as-value='{side}']")
    until(page, "([s, v]) => document.querySelector(s + ' [data-add-as-value=' + v + ']').getAttribute('aria-checked') === 'true'", [S, side])


PASTE = f"{S} .gsig-inline[data-id=paste-upload]"
TXT = f"{S} [data-testid=gp-text]"


def _paste(page, text):
    page.evaluate("""([sel, t]) => {
        const ta = document.querySelector(sel);
        const dt = new DataTransfer(); dt.setData('text/plain', t);
        ta.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
    }""", [TXT, text])


def test_paste_adds_as_down_in_one_step_and_follows_the_add_as_choice(page, served):
    _panel(page, served, genes=["GENE0001"], directions=True)
    page.click(PASTE)
    page.wait_for_selector(TXT)
    _paste(page, "CD3D CD3E NOPE")
    page.wait_for_selector(f"{S} [data-testid=gp-counts]")
    chooser = page.locator(f"{S} [data-testid=gp-addas]")
    assert chooser.input_value() == "up", "starts on Add as, which is Up"
    chooser.select_option("down")
    page.locator(f"{S} [data-testid=gp-add]").click()
    _until_sides(page, ["GENE0001"], ["CD3D", "CD3E"])
    assert _message(page) == "Added 2 genes as down from pasted list. 1 is not in this dataset."
    assert _summary(page) == "3 genes selected: 1 up, 2 down"
    assert page.get_attribute(f"{S} .gsig-undo", "title") == "Undo: add 2 genes as down from pasted list"
    page.click(f"{S} .gsig-undo")
    _until_sides(page, ["GENE0001"], [])
    # the chooser beside Add from sets what the next preview starts on
    _add_as(page, "down")
    page.click(PASTE)
    page.wait_for_selector(TXT)
    _paste(page, "KLF1")
    page.wait_for_selector(f"{S} [data-testid=gp-counts]")
    assert page.locator(f"{S} [data-testid=gp-addas]").input_value() == "down"
    page.locator(f"{S} [data-testid=gp-add]").click()
    _until_sides(page, ["GENE0001"], ["KLF1"])


def test_paste_has_no_add_as_while_the_switch_is_off(page, served):
    _panel(page, served, genes=["GENE0001"])
    page.click(PASTE)
    page.wait_for_selector(TXT)
    _paste(page, "KLF1")
    page.wait_for_selector(f"{S} [data-testid=gp-counts]")
    assert page.locator(f"{S} [data-testid=gp-addas]").count() == 0
    page.locator(f"{S} [data-testid=gp-add]").click()
    _until_sides(page, ["GENE0001", "KLF1"], [])


def test_the_focused_gene_and_add_from_a_table_add_as_the_chosen_side(page, served):
    table = {"id": "gene-table-T", "title": "DE genes", "searchText": "GENE000",
             "columns": [{"type": "var", "key": "mean", "column": ""}]}
    _open(page, served, plots=(("gene-table-T", table),), sig=_sig(["KLF1"], directions=True), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    page.wait_for_selector('.tile[data-tile-id="gene-table-T"] .dataTables_scrollBody tbody tr', timeout=30000)
    until(page, "() => window.PanelManager.getPanel('gene-table-T').getConfig().currentEntries.length === 10")
    _add_as(page, "down")
    page.evaluate("async () => { const { DataManager } = await import('/static/js/data-manager.js'); DataManager.setFocusedGene('GAPDH'); }")
    btn = f"{S} .gsig-focused"
    until(page, "(b) => { const e = document.querySelector(b); return e && !e.hidden && e.textContent === '+ GAPDH as down (focused)'; }", btn)
    page.click(btn)
    _until_sides(page, ["KLF1"], ["GAPDH"])
    assert _message(page) == "Added GAPDH as down."
    page.click(f"{S} .gsig-undo")
    _until_sides(page, ["KLF1"], [])
    page.click(f"{S} .gsig-addfrom")
    page.click(".gsig-menu:not([hidden]) [role=menuitem]:has-text('DE genes')")
    until(page, "() => window.PanelManager.getPanel('gene-signature-S').getRecipe().down.length === 10")
    assert _sides(page)[0] == ["KLF1"]
    assert _message(page) == "Added 10 genes as down from DE genes."
    page.click(f"{S} .gsig-undo")
    _until_sides(page, ["KLF1"], [])
    # up again: the same menu adds as up
    _add_as(page, "up")
    page.click(f"{S} .gsig-addfrom")
    page.click(".gsig-menu:not([hidden]) [role=menuitem]:has-text('DE genes')")
    until(page, "() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes.length === 11")
    assert _sides(page)[1] == []


# ------------------------------------------------------------------ 5. turning the switch off

def test_switching_off_with_down_genes_asks_first(page, served):
    _panel(page, served, genes=FIRST[:4], down=FIRST[4:])
    assert _pressed(page), "down genes keep it on"
    page.click(SWITCH)
    ask = page.locator(f"{S} [data-direction-ask]")
    assert ask.is_visible() and "2 down genes will count as up." in ask.inner_text()
    assert _sides(page)[1] == FIRST[4:], "nothing changed yet"
    page.click(f"{S} [data-keep-down]")
    assert page.locator(f"{S} [data-direction-ask]").is_hidden() and _pressed(page)
    assert _sides(page)[1] == FIRST[4:]
    page.click(SWITCH)
    page.click(f"{S} [data-count-as-up]")
    _until_sides(page, FIRST, [])
    assert not _pressed(page) and page.locator(f"{DIR}:visible").count() == 0
    assert _summary(page) == "6 genes selected"
    assert page.get_attribute(f"{S} .gsig-undo", "title") == "Undo: count 2 down genes as up"
    page.click(f"{S} .gsig-undo")
    _until_sides(page, FIRST[:4], FIRST[4:])
    assert _pressed(page), "undo brings the down genes and Up/Down back"


# ------------------------------------------------------------------ 6. links

def test_link_and_panel_set_round_trip_carry_the_down_genes(page, served):
    root, store = served
    _panel(page, served, genes=FIRST[:4], down=FIRST[4:])
    cfg = page.evaluate("() => window.sessionManager.captureView().layout.panelConfigs['gene-signature-S']")
    assert cfg["genes"] == FIRST[:4] and cfg["down"] == FIRST[4:] and cfg["directions"] is True
    key = _hash(page)
    payload = page.evaluate("""async () => {
        const { encodeViewPayload } = await import('/static/js/utils/deeplink.js');
        return await encodeViewPayload(window.sessionManager.captureView());
    }""")
    page.goto("about:blank")
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}")
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    assert _sides(page) == (FIRST[:4], FIRST[4:]) and _hash(page) == key
    assert _summary(page) == "6 genes selected: 4 up, 2 down"
    _selected_view(page)
    assert _dir_labels(page) == ["up"] * 4 + ["down"] * 2
    # the saved layout of a panel set holds it too
    saved = json.dumps(page.evaluate("() => PanelManager.saveLayout()"))
    assert '"down":["GENE0005","GENE0006"]' in saved.replace(" ", "")


# ------------------------------------------------------------------ 7. the score request

def test_the_request_carries_the_down_genes_a_flip_asks_again_and_undo_does_not(page, served):
    page.add_init_script(RECORD)
    _open(page, served, plots=(("cell-plot-C", _cell(color={**SCORE, "column": "mean"})),),
          sig=_sig(["GENE0001", "GENE0002"], down=["GENE0003"]), sig_open=True)
    _wait_coloured(page, C)
    sent = [r for r in page.evaluate("() => window.__recipes") if r["for"] == "compute"]
    assert sent and sent[-1]["genes"] == ["GENE0001", "GENE0002"] and sent[-1]["down"] == ["GENE0003"]
    assert sent[-1]["method"] == "mean"
    n = len(_calls(page, "compute"))
    page.evaluate("(id) => window.PanelManager.getPanel(id).setDirection(['GENE0002'], 'down')", SIG)
    until(page, "(n) => window.__scoreCalls.filter(c => c.kind === 'compute').length === n + 1", n)
    sent = [r for r in page.evaluate("() => window.__recipes") if r["for"] == "compute"]
    assert sent[-1]["genes"] == ["GENE0001"] and sent[-1]["down"] == ["GENE0002", "GENE0003"]
    # undo goes back to a recipe whose score is cached: no request
    page.evaluate("(id) => window.PanelManager.getPanel(id).undo()", SIG)
    # time for a request, were one going to; the score is cached
    page.wait_for_timeout(900)
    assert len(_calls(page, "compute")) == n + 1
    assert _sides(page) == (["GENE0001", "GENE0002"], ["GENE0003"])


def test_a_gene_table_has_no_direction(page, served):
    table = {"id": "gene-table-T", "title": "DE genes", "searchText": "GENE000",
             "columns": [{"type": "var", "key": "mean", "column": ""}]}
    _open(page, served, plots=(("gene-table-T", table),), sig=_sig(["KLF1"]), sig_open=False, wait=False)
    page.wait_for_selector('.tile[data-tile-id="gene-table-T"] .dataTables_scrollBody tbody tr', timeout=30000)
    until(page, "() => window.PanelManager.getPanel('gene-table-T').getConfig().currentEntries.length === 10")
    # time for a direction control to appear, were one going to; a gene table has none
    page.wait_for_timeout(300)
    assert page.locator('.tile[data-tile-id="gene-table-T"] [data-directions], .tile[data-tile-id="gene-table-T"] .gsig-dir').count() == 0


# ------------------------------------------------------------------ 8. graded "cannot"

def test_methods_without_a_signed_version_are_graded_cannot_with_the_reason(page, served):
    _panel(page, served, genes=["GENE0001"], down=["GENE0002"], detect_above=1)
    _expand(page)
    assert page.inner_text(f"{POP} [data-direction-formula]").startswith("Score = the 1 up gene minus the 1 down gene, averaged over both genes: each gene weighs equally.")
    # where a method is chosen (a consumer's method select), the three are disabled with the reason as the title
    choices = page.evaluate("""async (id) => { const m = await import('/static/js/utils/score-source.js');
        return m.scoreChoices(id, {}, { datasetLayers: ['X', 'counts'] }).methods; }""", SIG)
    by = {c["value"]: c for c in choices}
    for method, words in (("sum", "depends on how many genes each side has"), ("detected", "not a fraction"),
                          ("fraction_of_total", "not a share")):
        assert by[method]["disabled"], method
        assert " cannot be computed with down genes: " in by[method]["title"] and words in by[method]["title"], method
    for method in ("zscore_mean", "mean", "control_adjusted"):
        assert not by[method]["disabled"], method
    # drop the down gene: they are back
    page.evaluate("(id) => window.PanelManager.getPanel(id).setDirection(['GENE0002'], 'up')", SIG)
    choices = page.evaluate("""async (id) => { const m = await import('/static/js/utils/score-source.js');
        return m.scoreChoices(id, {}, { datasetLayers: ['X', 'counts'] }).methods; }""", SIG)
    assert not any(c["disabled"] for c in choices if c["value"] != "detected"), "only the layer can still refuse a method"


def test_a_plot_on_a_method_that_cannot_says_so_and_asks_nothing(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(color={**SCORE, "column": "sum"})),),
          sig=_sig(["GENE0001"], down=["GENE0002"]), sig_open=False, wait=False)
    page.wait_for_selector(f"{C} .score-notice, {C} .coverage-placeholder", timeout=30000)
    until(page, "(t) => !!document.querySelector(t + ' .score-notice')", C)
    note = _notice(page)
    assert note["state"] == "nodown" and "has down genes, which sum cannot score" in note["text"]
    assert _calls(page, "compute") == []


# ------------------------------------------------------------------ Add as: one control, chosen before importing

def test_add_as_is_one_segmented_control_that_shows_only_with_the_switch_and_resets_to_up(page, served):
    _panel(page, served, genes=["GENE0001"])
    assert page.locator(f"{S} .gsig-addas-wrap").is_hidden()
    _switch_on(page)
    assert page.locator(f"{S} .gsig-addas-wrap").is_visible()
    assert page.get_attribute(f"{S} [data-add-as-value='up']", "aria-checked") == "true", "defaults to Up"
    _add_as(page, "down")
    assert page.get_attribute(f"{S} [data-add-as-value='up']", "aria-checked") == "false"
    # switching off (no down genes) puts it back on Up
    page.click(SWITCH)
    page.wait_for_function("(s) => document.querySelector(s + ' .gsig-addas-wrap').hidden", arg=S)
    page.click(SWITCH)
    assert page.get_attribute(f"{S} [data-add-as-value='up']", "aria-checked") == "true"


def test_a_fixed_gene_added_from_the_menu_follows_add_as(page, served):
    cells = {"id": "cell-plot-C", "title": "Cell Plot 2", "z": None,
             "x": {"type": "obsm", "key": "X_umap", "column": "0"}, "y": {"type": "obsm", "key": "X_umap", "column": "1"},
             "color": {"type": "layer", "key": "counts", "column": "KLF1", "locked": True}}
    _open(page, served, plots=(("cell-plot-C", cells),), sig=_sig(["GENE0001"], directions=True), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    _add_as(page, "down")
    page.click(f"{S} .gsig-addfrom")
    page.click(".gsig-menu:not([hidden]) [role=menuitem]:has-text('KLF1')")
    _until_sides(page, ["GENE0001"], ["KLF1"])
    assert _message(page) == "Added KLF1 as down."


def _flow(page, text):
    page.click(PASTE)
    page.wait_for_selector(TXT)
    _paste(page, text)
    page.wait_for_selector(f"{S} [data-testid=gp-counts]")


def test_the_paste_button_says_how_many_go_down_and_each_add_is_one_undo_step(page, served):
    _panel(page, served, genes=["GENE0001"], directions=True)
    _add_as(page, "down")
    _flow(page, "CD3D CD3E KLF1")
    assert page.locator(f"{S} [data-testid=gp-add]").inner_text() == "Add 3 as down"
    page.locator(f"{S} [data-testid=gp-add]").click()
    _until_sides(page, ["GENE0001"], ["CD3D", "CD3E", "KLF1"])
    page.click(f"{S} .gsig-undo")
    _until_sides(page, ["GENE0001"], [])
    assert page.locator(f"{S} .gsig-undo").is_disabled(), "one step"


def test_adding_a_gene_again_keeps_its_direction_and_the_preview_offers_to_change_it(page, served):
    _panel(page, served, genes=["GENE0001", "CD3D"], down=["CD3E"], directions=True)
    _add_as(page, "down")
    _flow(page, "CD3D CD3E KLF1")
    # CD3E is already down; CD3D is up and would change; KLF1 is new
    assert "1 selected gene would change direction" in page.inner_text(f"{S} [data-testid=gp-move-row]")
    assert page.locator(f"{S} [data-testid=gp-add]").inner_text() == "Add 1 as down"
    page.locator(f"{S} [data-testid=gp-add]").click()
    _until_sides(page, ["CD3D", "GENE0001"], ["CD3E", "KLF1"])
    assert "already selected" in _message(page) and "changed direction" not in _message(page)
    page.click(f"{S} .gsig-undo")
    _until_sides(page, ["CD3D", "GENE0001"], ["CD3E"])
    # now apply it: CD3D moves, in the same single step as the add
    _flow(page, "CD3D KLF1")
    page.locator(f"{S} [data-testid=gp-move]").check()
    assert page.locator(f"{S} [data-testid=gp-add]").inner_text() == "Add 1 as down"
    page.locator(f"{S} [data-testid=gp-add]").click()
    _until_sides(page, ["GENE0001"], ["CD3D", "CD3E", "KLF1"])
    assert "1 gene changed direction" in _message(page)
    page.click(f"{S} .gsig-undo")
    _until_sides(page, ["CD3D", "GENE0001"], ["CD3E"])
    assert page.locator(f"{S} .gsig-undo").is_disabled(), "add and change were one step"


def test_a_move_alone_can_be_applied_when_nothing_is_new(page, served):
    _panel(page, served, genes=["GENE0001", "CD3D"], directions=True)
    _add_as(page, "down")
    _flow(page, "CD3D")
    assert page.locator(f"{S} [data-testid=gp-add]").is_disabled()
    page.locator(f"{S} [data-testid=gp-move]").check()
    page.locator(f"{S} [data-testid=gp-add]").click()
    _until_sides(page, ["GENE0001"], ["CD3D"])


def test_a_sign_column_splits_a_file_into_up_and_down(page, served):
    _panel(page, served, genes=["GENE0001"], directions=True)
    page.click(PASTE)
    page.wait_for_selector(TXT)
    csv = "gene,logfc\nCD3D,2.5\nCD3E,-1.2\nKLF1,0\nGAPDH,-0.3\nACTB,x\n"
    page.set_input_files(f"{S} [data-testid=gp-file]", files=[{"name": "de.csv", "mimeType": "text/csv", "buffer": csv.encode()}])
    page.wait_for_selector(f"{S} [data-testid=gp-signcol]")
    page.select_option(f"{S} [data-testid=gp-signcol]", label="logfc")
    page.wait_for_selector(f"{S} [data-testid=gp-unsigned]")
    assert "2 genes have no sign" in page.inner_text(f"{S} [data-testid=gp-unsigned]")
    assert page.locator(f"{S} [data-testid=gp-add]").inner_text() == "Add 3 genes (1 up, 2 down)"
    assert page.locator(f"{S} [data-testid=gp-addas]").count() == 0
    page.locator(f"{S} [data-testid=gp-add]").click()
    _until_sides(page, ["CD3D", "GENE0001"], ["CD3E", "GAPDH"])
    assert _message(page).startswith("Added 3 genes as up and down from file de.csv.")
    page.click(f"{S} .gsig-undo")
    _until_sides(page, ["GENE0001"], [])


def test_no_sign_column_without_the_switch(page, served):
    _panel(page, served, genes=["GENE0001"])
    page.click(PASTE)
    page.wait_for_selector(TXT)
    csv = "gene,logfc\nCD3D,2.5\nCD3E,-1.2\n"
    page.set_input_files(f"{S} [data-testid=gp-file]", files=[{"name": "de.csv", "mimeType": "text/csv", "buffer": csv.encode()}])
    page.wait_for_selector(f"{S} [data-testid=gp-column]")
    assert page.locator(f"{S} [data-testid=gp-signcol]").count() == 0


# ------------------------------------------------------------------ how down genes weigh

def _weight(page, method, value):
    page.click(f"{POP} [data-method='{method}'] [data-down-weight='{value}']")
    until(page, "([id, v]) => window.PanelManager.getPanel(id).getRecipe().down_weight === v", [SIG, value])


def test_the_weighting_is_offered_under_the_two_means_only_with_the_switch_on(page, served):
    _panel(page, served, genes=FIRST[:4], down=FIRST[4:])
    _expand(page)
    for method in ("zscore_mean", "mean"):
        group = page.locator(f"{POP} [data-method='{method}'] [data-weighting]")
        assert group.count() == 1, method
        assert "Down genes" in group.inner_text() and "each gene weighs equally" in group.inner_text() and "each side weighs equally" in group.inner_text()
        assert page.is_checked(f"{POP} [data-method='{method}'] [data-down-weight='gene']"), "each gene is the default"
    assert page.locator(f"{POP} [data-method='control_adjusted'] [data-weighting]").count() == 0
    assert "so each side always weighs equally" in page.inner_text(f"{POP} [data-method='control_adjusted'] [data-down-weight-why]")
    assert page.locator(f"{POP} [data-method='sum'] [data-weighting]").count() == 0
    assert "each gene weighs equally" in page.inner_text(f"{POP} [data-method='mean'] [data-signed]")


def test_no_weighting_choice_before_the_switch(page, served):
    _panel(page, served, genes=FIRST)
    _expand(page)
    assert page.locator(f"{POP} [data-weighting]:visible").count() == 0
    assert page.locator(f"{POP} [data-down-weight-why]:visible").count() == 0
    _switch_on(page)                                                    # a click outside the pop-over closes it
    _expand(page)
    page.wait_for_selector(f"{POP} [data-weighting='mean']", state="visible")


def test_choosing_by_side_changes_the_formula_the_key_the_link_and_the_request(page, served):
    page.add_init_script(RECORD)
    root, store = served
    _open(page, served, plots=(("cell-plot-C", _cell(color={**SCORE, "column": "mean"})),),
          sig=_sig(["GENE0001", "GENE0002"], down=["GENE0003"]), sig_open=True)
    _wait_coloured(page, C)
    sent = [r for r in page.evaluate("() => window.__recipes") if r["for"] == "compute"]
    assert sent[-1]["down_weight"] == "gene"
    _expand(page)
    key = _hash(page)
    n = len(_calls(page, "compute"))
    _weight(page, "mean", "side")
    assert _hash(page) != key
    # the other method's control follows: it is one setting
    assert page.is_checked(f"{POP} [data-method='zscore_mean'] [data-down-weight='side']")
    assert "each side weighs equally" in page.inner_text(f"{POP} [data-method='mean'] [data-signed]")
    until(page, "(n) => window.__scoreCalls.filter(c => c.kind === 'compute').length === n + 1", n)
    assert [r for r in page.evaluate("() => window.__recipes") if r["for"] == "compute"][-1]["down_weight"] == "side"
    # outside the app the name says so; with the default it does not
    lines = page.evaluate("""async (id) => { const m = await import('/static/js/utils/score-source.js');
        return m.scoreLabelLines({ type: 'gene-score', key: id, column: 'mean', label: 'T cell score' }); }""", SIG)
    assert lines[1].startswith("mean, each side weighs equally")
    cfg = page.evaluate("() => window.sessionManager.captureView().layout.panelConfigs['gene-signature-S']")
    assert cfg["down_weight"] == "side"
    by_side = _hash(page)
    payload = page.evaluate("""async () => { const { encodeViewPayload } = await import('/static/js/utils/deeplink.js');
        return await encodeViewPayload(window.sessionManager.captureView()); }""")
    page.goto("about:blank")
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}")
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    assert _recipe(page)["down_weight"] == "side" and _hash(page) == by_side
    # back to each gene: the key is the first one again and the label is plain
    _expand(page)
    _weight(page, "zscore_mean", "gene")
    assert _hash(page) == key
    assert "down_weight" not in page.evaluate("() => window.sessionManager.captureView().layout.panelConfigs['gene-signature-S']")
    lines = page.evaluate("""async (id) => { const m = await import('/static/js/utils/score-source.js');
        return m.scoreLabelLines({ type: 'gene-score', key: id, column: 'mean', label: 'T cell score' }); }""", SIG)
    assert "each side" not in lines[1]


def test_an_old_configuration_with_down_genes_reads_as_each_gene(page, served):
    _panel(page, served, genes=FIRST[:4], down=FIRST[4:])
    assert _recipe(page)["down_weight"] == "gene"
    cfg = page.evaluate("() => window.sessionManager.captureView().layout.panelConfigs['gene-signature-S']")
    assert "down_weight" not in cfg and cfg["down"] == FIRST[4:]


def test_reset_to_defaults_puts_each_gene_back(page, served):
    _panel(page, served, genes=FIRST[:4], down=FIRST[4:], down_weight="side")
    _expand(page)
    assert page.is_checked(f"{POP} [data-method='mean'] [data-down-weight='side']")
    page.click(f"{POP} [data-reset-all]")
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().down_weight === 'gene'", SIG)

