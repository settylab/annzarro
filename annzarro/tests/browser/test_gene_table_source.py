"""A Gene Table as a source of a gene score, in a real browser.

A gene table is a gene-score source like a signature: it differs only in how the genes are chosen. A signature's are
handpicked; a table's are the rows that pass its filter, read through the selection every reader of a table uses
(an open table's rows, a closed table's frozen or background-built selection). Everything else is the signature's code:
the source menus, the score store and its cost tiers, the notices, "Scores offered" and Inspect.

The store is the one of test_gene_score_plots.py: 60 cells and 3,000 genes (ACTB, CD3D, CD3E, CD3G, Cd3d, GAPDH, KLF1
and GENE0000 to GENE2992), whose `var.mean` is the gene's position, so "mean < 5" passes the first five genes.

1.  A plot coloured by an open table's score asks for exactly the genes that pass its filter.
2.  A filter change moves the plot as a signature edit does: at once when the score is cheap, behind Update score when
    it is slow; an unchanged filter asks for nothing.
3.  A closed table restored from a link builds in the background, then scores; the table stays closed.
4.  A cycle (a table filtered by a table that reads its score) shows the cycle state and asks for nothing.
5.  Scores offered on the table: collapsed with its summary, stored as configuration only, and carried by a link and
    a panel set.
6.  Menus: tables are told apart from signatures; labels name the table.
7.  A signature of 5,000 genes opens from a link, and the route takes more than 2,000 genes.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing
Playwright is an error.
"""
import base64
import json
import os
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_gene_score_plots import (  # noqa: E402,F401
    C, INIT, SCORE, UMAP_X, UMAP_Y, _box, _calls, _cell, _colours, _drawn, _fake, _new_page, _notice, _numbers, _open,
    _placeholder, _save_set, _served, _tag, _url, _wait_coloured, _slow, _finish, _action, GENES,
)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

G = '.tile[data-tile-id="gene-table-G"]'
TAB = "gene-table-G"
TABLE_SCORE = {"type": "gene-score", "key": TAB, "label": "Gene Table 1", "column": ""}
MEAN = {"type": "var", "key": "mean", "column": ""}


def mean_below(n):
    """A table filter: the genes whose `mean` (their position in the dataset) is below n."""
    return {"logic": "AND", "criteria": [
        {"condition": "<", "data": "mean", "origData": "var_mean_main", "type": "num", "value": [str(n)]}]}


def _table(below=5, **extra):
    return {"id": TAB, "title": "Gene Table 1", "columns": [MEAN], "searchBuilderConfig": mean_below(below), **extra}


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    proc, root, store = _served(tmp_path_factory)
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = _new_page(browser)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _open_table_link(page, served, table=None, table_open=True, plots=None, **view):
    """A link: a Cell Plot coloured by the table's score, and the table open or closed."""
    plot = _cell(color=TABLE_SCORE)
    open_ids = ["cell-plot-C"] + ([TAB] if table_open else [])
    page.goto(_url(served, open_ids, {"cell-plot-C": plot, TAB: table or _table(), **(plots or {})}, **view))
    page.wait_for_selector(f"{C} .js-plotly-plot, {C} .coverage-placeholder", timeout=30000)


def _asked(page):
    """The genes of each compute request so far, sorted."""
    return [sorted(c["genes"]) for c in _calls(page, "compute")]


FIRST_FIVE = ["ACTB", "CD3D", "CD3E", "CD3G", "Cd3d"]


# ------------------------------------------------------------------ 1. a plot coloured by an open table's score

def test_a_plot_coloured_by_an_open_tables_score_asks_for_its_passing_genes(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    assert _asked(page) == [FIRST_FIVE]
    assert len(_numbers(page)) == 60


def _filter(page, below):
    """Edit the open table's filter as a user does: the Advanced Search builder is rebuilt and the table redrawn."""
    page.evaluate("""([box, sb]) => { const dt = $(box + ' .dataTables_scrollBody table').DataTable();
        dt.searchBuilder.rebuild(sb); dt.draw(); }""", [G, mean_below(below)])


def _rows(page):
    """The genes the open table passes now."""
    return page.evaluate("(id) => { const c = PanelManager.getPanel(id).getConfig();"
                         " const g = DataManager.getGenes(); return c.currentEntries.map(i => g[i]); }", TAB)


# ------------------------------------------------------------------ 2. a filter change moves the plot

def test_a_filter_change_updates_the_plot_at_once_when_the_score_is_cheap(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    first = _numbers(page)
    _filter(page, 8)
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 2")
    assert _asked(page)[1] == sorted(FIRST_FIVE + ["GAPDH", "KLF1", "GENE0000"])
    _wait_coloured(page)
    until(page, "(first) => JSON.stringify(window.__lastColours || null) !== JSON.stringify(first)", first)
    assert _numbers(page) != first


def test_an_unchanged_filter_asks_for_nothing_and_a_table_that_passes_the_same_genes_reuses_the_score(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    n = len(_calls(page))
    _filter(page, 5)                       # the same rows
    page.wait_for_timeout(1200)
    assert len(_calls(page)) == n
    _filter(page, 8)                       # other rows: asks
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 2")
    _filter(page, 5)                       # back: the score of those five genes is held, so it is not computed again
    page.wait_for_timeout(1500)
    assert len(_calls(page, "compute")) == 2
    assert _asked(page)[0] == FIRST_FIVE


def test_a_slow_filter_edit_collects_behind_update_score(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    shown = _numbers(page)
    page.evaluate("() => window.__slow('auto', 12)")
    _filter(page, 8)
    page.wait_for_selector(f"{C} .score-notice[data-state='held']", timeout=20000)
    notice = _notice(page)
    assert "Update score" in " ".join(notice["actions"]) and "not applied" in notice["text"]
    assert len(_calls(page, "compute")) == 1, "nothing computed while the edit is held"
    assert _numbers(page) == shown, "the plot keeps the previous score"
    before = notice["text"]
    _filter(page, 9)                        # a second edit joins the first
    page.wait_for_function("(t) => { const n = document.querySelector('%s .score-notice'); return !!n && n.dataset.state === 'held' && n.textContent !== t; }" % C, arg=before, timeout=20000)
    _action(page, "score-update")
    until(page, "() => window.__ctls.length === 1")
    assert sorted(_calls(page, "compute")[1]["genes"]) == sorted(FIRST_FIVE + ["GAPDH", "KLF1", "GENE0000", "GENE0001"])
    _finish(page, 0)
    _wait_coloured(page)


# ------------------------------------------------------------------ 3. a closed table restored from a link

def test_a_closed_table_restored_from_a_link_builds_then_scores_and_stays_closed(page, served):
    _open_table_link(page, served, table_open=False)
    _wait_coloured(page)
    assert _asked(page) == [FIRST_FIVE]
    assert page.evaluate("(id) => !PanelManager.getActivePanels().includes(PanelManager.getPanel(id))", TAB)
    assert page.evaluate("(id) => !!PanelManager.getPanel(id).getConfig().closedSelection", TAB), "the build left its selection"


def test_a_closed_table_that_asks_to_be_built_says_so_and_builds_on_the_click(page, served):
    page.add_init_script("window.__azTableLimits = { AUTO_ROWS: 0, ASK_ROWS: 1000000000 };")
    _open_table_link(page, served, table_open=False)
    page.wait_for_selector(f"{C} .coverage-placeholder, {C} .score-notice", timeout=20000)
    ph = _notice(page) or _placeholder(page)
    assert ph["state"] == "ask" and "Build filter" in " ".join(ph["actions"]), ph
    assert "Gene Table 1" in ph["text"] and not _calls(page)
    page.click(f"{C} [data-ps-action='score-compute']")
    _wait_coloured(page)
    assert _asked(page) == [FIRST_FIVE]


def test_a_closed_table_that_is_building_is_waited_for_with_the_resolvers_states(page, served):
    # the build is held back by tiny limits so its waiting state can be read, then released
    page.add_init_script("window.__azTableLimits = { AUTO_ROWS: 0, ASK_ROWS: 1000000000 };")
    _open_table_link(page, served, table_open=False)
    page.wait_for_selector(f"{C} .coverage-placeholder, {C} .score-notice", timeout=20000)
    assert not _calls(page), "no score is asked for before the genes are known"


def test_closing_the_table_keeps_its_score_and_asks_for_nothing(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    shown = _numbers(page)
    page.evaluate("(id) => PanelManager.closePanel(id)", TAB)
    page.wait_for_function("(id) => !PanelManager.getActivePanels().includes(PanelManager.getPanel(id))", arg=TAB)
    page.wait_for_timeout(1500)
    assert len(_calls(page, "compute")) == 1 and _numbers(page) == shown, "a closed table keeps the genes that passed"
    assert page.evaluate("(id) => PanelManager.getPanel(id).getConfig().closedSelection.passing.length", TAB) == 5


def test_a_deleted_table_says_so_and_the_plot_keeps_its_setting(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    page.evaluate("(id) => PanelManager.removePanel(id)", TAB)
    page.wait_for_selector(f"{C} .score-notice[data-state='deleted']", timeout=20000)
    assert "Table 'Gene Table 1' was deleted." in _notice(page)["text"]
    assert page.evaluate("() => PanelManager.getPanel('cell-plot-C').getConfig().color.key") == TAB


def test_renaming_the_table_renames_its_score(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    page.evaluate("(id) => PanelManager.getPanel(id).setTitle('Marker genes')", TAB)
    page.wait_for_function("() => PanelManager.getPanel('cell-plot-C').getConfig().color.label === 'Marker genes'", timeout=20000)
    labels = page.eval_on_selector_all(f"{C} select.axis-key-select[data-axis='color'] option", "els => els.map(e => e.textContent)")
    assert labels == ["Marker genes", "New signature…"], labels


# ------------------------------------------------------------------ 4. a cycle

def test_a_table_filtered_by_a_table_that_reads_its_score_is_a_cycle_and_asks_for_nothing(page, served):
    score_col = {"type": "gene-score", "key": TAB, "column": "", "label": "Gene Table 1"}
    sb = {"logic": "AND", "criteria": [{"condition": ">", "data": "Gene Table 1", "origData": "gene-score_gene-table-G_main",
                                        "type": "num", "value": ["0"]}]}
    cell_table = {"id": "cell-table-T", "title": "Cells", "columns": [score_col], "searchBuilderConfig": sb}
    page.goto(_url(served, ["cell-plot-C"], {"cell-plot-C": _cell(color=TABLE_SCORE), TAB: _table(tableFilter="cell-table-T"),
                                             "cell-table-T": cell_table}))
    page.wait_for_selector(f"{C} .coverage-placeholder, {C} .score-notice", timeout=30000)
    ph = _notice(page) or _placeholder(page)
    assert ph["state"] == "cycle", ph
    assert "depend on each other" in ph["text"]
    page.wait_for_timeout(1000)
    assert not _calls(page), "a cycle computes nothing"


# ------------------------------------------------------------------ 5. Scores offered on the table

OFFER = {"offered": ["zscore_mean", "mean", "detected"], "layers": ["X", "counts"], "input": "X", "method": "zscore_mean",
         "clip": 3, "bins": 25, "controls": 50, "seed": None, "detect_above": 0}


def _summary(page):
    return page.inner_text(f"{G} .gsig-scoring__summary")


def test_scores_offered_on_a_table_is_collapsed_with_its_summary_and_the_table_stays_a_table(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    assert page.get_attribute(f"{G} .gsig-scoring__toggle", "aria-expanded") == "false"
    assert page.is_hidden(f"{G} .gsig-scoring__body")
    assert _summary(page) == "z-score mean, mean, sum · X"
    assert page.get_attribute(f"{G} .gsig-inspect__toggle", "aria-expanded") == "false"
    assert page.query_selector(f"{G} .dataTables_scrollBody table"), "the table is there"
    # nothing is stored for a table that offers the defaults
    assert page.evaluate("(id) => PanelManager.getPanel(id).getConfig().scoreOptions", TAB) is None


def test_a_table_offers_what_its_section_says_and_stores_recipe_fields_only(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    page.click(f"{G} .gsig-scoring__toggle")
    page.click(f"{G} [data-offer-method='detected']")
    page.click(f"{G} [data-offer-method='sum']")
    page.fill(f"#gsig-scoring-clip-{TAB}", "3")
    page.press(f"#gsig-scoring-clip-{TAB}", "Enter")
    page.click(f"{G} [data-layer-offer='counts']")
    cfg = page.evaluate("(id) => PanelManager.getPanel(id).getConfig().scoreOptions", TAB)
    assert cfg == {**OFFER, "detect_above": 0}, cfg
    assert set(cfg) == {"input", "method", "offered", "layers", "clip", "seed", "bins", "controls", "detect_above"}
    assert _summary(page) == "z-score mean (clip ±3), mean, fraction detected · X, counts"
    # the plot's menu follows: the colour's option list is the table's offer
    labels = page.eval_on_selector_all(f"{C} select.axis-column-select[data-axis='color'] option", "els => els.map(e => e.textContent)")
    assert any(x.startswith("fraction detected") for x in labels) and not any(x.startswith("sum") for x in labels), labels
    assert "fraction detected · counts" in labels, "one combined list of method and layer"


def test_the_table_offer_round_trips_through_a_link_and_a_panel_set(page, served):
    _open_table_link(page, served, table=_table(scoreOptions=OFFER))
    _wait_coloured(page)
    assert _summary(page) == "z-score mean (clip ±3), mean, fraction detected · X, counts"
    root, store = served
    view = page.evaluate("() => (window.SessionManager || window.sessionManager).captureView()")
    cfg = view["layout"]["panelConfigs"][TAB]
    assert cfg["scoreOptions"] == OFFER and "currentEntries" not in cfg and "closedSelection" not in cfg
    assert "Float32" not in json.dumps(view) and '"values"' not in json.dumps(view)
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    other = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    other.add_init_script(INIT)
    try:
        other.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}")
        other.wait_for_selector(f"{G} .gsig-scoring", timeout=30000)
        assert other.inner_text(f"{G} .gsig-scoring__summary") == _summary(page)
        assert other.evaluate("(id) => PanelManager.getPanel(id).getScoreOptions()", TAB) == OFFER
    finally:
        other.close()
    _save_set(page, "table-offer")
    fresh = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    fresh.add_init_script(INIT)
    try:
        fresh.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}")
        fresh.wait_for_selector("#btn-load-session", state="visible", timeout=30000)
        fresh.wait_for_selector(".tile-selector", state="visible", timeout=30000)
        fresh.click("#btn-load-session")
        fresh.locator(".session-card[data-session-name='table-offer'] .session-load").first.click()
        fresh.wait_for_selector(f"{G} .gsig-scoring", timeout=30000)
        assert fresh.evaluate("(id) => PanelManager.getPanel(id).getScoreOptions()", TAB) == OFFER
    finally:
        fresh.close()


def test_inspect_on_a_table_reads_the_score_the_plot_holds_and_follows_the_filter(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    page.click(f"{G} .gsig-inspect__toggle")
    page.wait_for_selector(f"{G} .gsig-inspect__content", state="visible", timeout=20000)
    page.wait_for_function("(g) => document.querySelector(g + ' .gsig-inspect__heading').textContent.includes('60 cells shown')", arg=G)
    assert _asked(page) == [FIRST_FIVE], "the plot's score is the one inspected: nothing is asked twice"
    genes = page.eval_on_selector_all(f"{G} .gsig-inspect__table [data-gene]", "els => els.map(e => e.dataset.gene).sort()")
    assert genes == sorted(FIRST_FIVE), genes
    _filter(page, 8)
    page.wait_for_function("(g) => document.querySelectorAll(g + ' .gsig-inspect__table [data-gene]').length === 8", arg=G, timeout=20000)


def test_offer_other_scores_opens_the_table_and_expands_what_it_offers(page, served):
    _open_table_link(page, served, table_open=False)
    _wait_coloured(page)
    assert page.locator(G).count() == 0
    page.select_option(f"{C} select.axis-column-select[data-axis='color']", "__offer_more__")
    page.wait_for_selector(f"{G} .gsig-scoring__toggle[aria-expanded='true']", timeout=30000)
    assert page.evaluate("(id) => PanelManager.getActivePanels().includes(PanelManager.getPanel(id))", TAB)
    # offering another score from the table's section reaches the plot's menu at once
    page.click(f"{G} [data-offer-method='detected']")
    labels = page.eval_on_selector_all(f"{C} select.axis-column-select[data-axis='color'] option", "els => els.map(e => e.textContent)")
    assert "fraction detected" in labels, labels
    # the notice's one-click "offer again" goes through the table's own API
    page.evaluate("(id) => PanelManager.getPanel(id).setScoreOptions({offered: ['zscore_mean', 'mean']})", TAB)
    assert page.evaluate("(id) => PanelManager.getPanel(id).getScoreOptions().offered", TAB) == ["zscore_mean", "mean"]


def test_a_link_from_before_the_table_offered_scores_opens_with_the_defaults(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    o = page.evaluate("(id) => PanelManager.getPanel(id).getScoreOptions()", TAB)
    assert o["offered"] == ["zscore_mean", "mean", "sum"] and o["layers"] == ["X"] and o["input"] == "X"


# ------------------------------------------------------------------ 6. menus and labels

def test_the_source_menu_tells_tables_from_signatures_and_the_label_names_the_table(page, served):
    sig = {"id": "gene-signature-S", "title": "T cell score", "genes": ["GENE0001", "GENE0002"]}
    _open_table_link(page, served, plots={"gene-signature-S": sig})
    _wait_coloured(page)
    groups = page.eval_on_selector_all(f"{C} select.axis-key-select[data-axis='color'] optgroup",
                                       "els => els.map(g => [g.label, [...g.querySelectorAll('option')].map(o => o.textContent)])")
    assert groups == [["Gene signatures", ["T cell score"]], ["Gene tables", ["Gene Table 1"]]], groups


# ------------------------------------------------------------------ 7. no gene limit

def _names(n):
    """n gene names: every gene of the dataset first, then names the dataset does not have (kept, and counted as missing)."""
    real = [f"GENE{i:04d}" for i in range(2992)] + GENES[:7]
    return real + [f"OTHER{i:05d}" for i in range(max(0, n - len(real)))]


@pytest.mark.parametrize("n", [5000, 20000])
def test_a_signature_of_thousands_of_genes_opens_from_the_link_the_app_makes(page, served, n):
    genes = _names(n)
    sig = {"id": "gene-signature-S", "title": "Big", "genes": genes}
    score = {"type": "gene-score", "key": "gene-signature-S", "label": "Big", "column": ""}
    page.goto(_url(served, ["cell-plot-C"], {"cell-plot-C": _cell(color=score), "gene-signature-S": sig}))
    page.wait_for_selector(f"{C} .js-plotly-plot, {C} .coverage-placeholder", timeout=60000)
    _wait_coloured(page)
    assert len(page.evaluate("() => PanelManager.getPanel('gene-signature-S').getRecipe().genes")) == n
    asked = _calls(page, "compute")[0]["genes"]
    assert len(asked) == n, "the route took them all"
    # the link the app makes of this view: the view rides in the fragment, deflated (utils/deeplink.js)
    link = page.evaluate("""async () => {
        const { encodeViewPayload } = await import('/static/js/utils/deeplink.js');
        const view = (window.SessionManager || window.sessionManager).captureView();
        const payload = await encodeViewPayload(view);
        return { payload, href: location.href.split('#')[0] + '#view=' + payload };
    }""")
    assert link["payload"].startswith("z1."), "compressed"
    root, store = served
    fresh = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    fresh.add_init_script(INIT)
    try:
        fresh.goto(link["href"])
        fresh.wait_for_selector(f"{C} .js-plotly-plot, {C} .coverage-placeholder", timeout=60000)
        _wait_coloured(fresh)
        assert fresh.evaluate("() => PanelManager.getPanel('gene-signature-S').getRecipe().genes.length") == n
        assert len(_calls(fresh, "compute")[0]["genes"]) == n
        assert _numbers(fresh) == _numbers(page)
    finally:
        fresh.close()
    print(f"link of a signature of {n} genes: {len(link['href'])} characters")


def test_the_route_accepts_more_than_2000_genes(page, served):
    genes = [f"GENE{i:04d}" for i in range(2500)]
    sig = {"id": "gene-signature-S", "title": "Wide", "genes": genes}
    score = {"type": "gene-score", "key": "gene-signature-S", "label": "Wide", "column": ""}
    page.goto(_url(served, ["cell-plot-C"], {"cell-plot-C": _cell(color=score), "gene-signature-S": sig}))
    page.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)
    _wait_coloured(page)
    assert len(_numbers(page)) == 60
    assert len(_calls(page, "compute")[0]["genes"]) == 2500


# ------------------------------------------------------------------ the long-link note

def _share(page):
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    page.click("#btn-share-link")
    page.wait_for_function("() => /Copied/.test(document.querySelector('#btn-share-link .btn-share-label').textContent)", timeout=20000)


def test_a_long_link_says_so_with_its_length_and_the_copy_still_happens(page, served):
    genes = _names(5000)
    sig = {"id": "gene-signature-S", "title": "Big", "genes": genes}
    page.goto(_url(served, ["cell-plot-C"], {"cell-plot-C": _cell(color=TABLE_SCORE), "gene-signature-S": sig, TAB: _table()}))
    page.wait_for_selector(f"{C} .js-plotly-plot, {C} .coverage-placeholder", timeout=60000)
    _share(page)
    note = page.inner_text("#share-link-note")
    assert page.is_visible("#share-link-note")
    assert "This link is long (" in note and "characters" in note and "panel set" in note
    copied = page.evaluate("() => navigator.clipboard.readText()")
    assert f"({len(copied):,} characters)" in note and len(copied) > 8000, "the length shown is the link copied"
    page.click("#share-link-note-close")
    assert page.is_hidden("#share-link-note")


def test_a_short_link_has_no_note(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    _share(page)
    assert page.is_hidden("#share-link-note")
