"""The entity cards (aggregation-unify-080.md 11.2, ui/entity-card.js): the Cell Grouping's factors and the Cell-Gene Plot's
sections are one component, so they look and behave alike: `[≡] [n] [title] [summary] [preview]  [controls] [⋯]`.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    GA, GENES, P, S1, S2, TP, _config, _drawn, _open, _plot, _sig, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

TG = f'.tile[data-tile-id="{GA}"]'
OBS = {"type": "obs", "key": "cell_type"}
MENU = "[data-popover='card-menu']"
LOOK = """(sel) => { const c = document.querySelector(sel); const t = c.querySelector('.az-card__title');
  const s = getComputedStyle(c); const ts = getComputedStyle(t);
  return [s.borderTopWidth, s.borderTopColor, s.borderTopLeftRadius, s.backgroundColor, ts.fontWeight, ts.fontSize]; }"""


def _grouping(**fields):
    return {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": OBS}, {"source": {"type": "obs", "key": "condition"}}], **fields}


def _both(page, served, sections=None):
    sections = sections or [{"source": S1, "rows": "genes"}, {"source": S2, "rows": "set"}]
    plot = _plot(cellAxis=OBS, sections=sections)
    _open(page, served, {P: plot, GA: _grouping(), S1: _sig(S1, "Markers", GENES[0:3]), S2: _sig(S2, "Pathway", GENES[3:12])}, open_ids=(P, GA))
    _drawn(page)
    page.wait_for_selector(f"{TG} .az-card", timeout=30000)


def _titles(page, root):
    return page.eval_on_selector_all(f"{root} .az-card .az-card__title", "os => os.map(o => o.textContent)")


def test_sections_and_factors_share_the_card(page, served):
    _both(page, served)
    for root in (TP, TG):
        assert page.evaluate("(r) => !!document.querySelector(r + ' ul.az-cards > li.az-card')", root), root
    assert page.evaluate(LOOK, f"{TP} .az-card") == page.evaluate(LOOK, f"{TG} .az-card")


def test_section_card_shows_position_summary_preview(page, served):
    _both(page, served)
    card = page.locator(f"{TP} .az-card").nth(1)
    assert card.locator(".az-card__pos").inner_text() == "2"
    assert card.locator(".az-card__title").inner_text() == "Pathway"
    assert card.locator(".az-card__summary").inner_text() == "signature · 9 genes"
    assert card.locator(".az-card__preview").inner_text() == ", ".join(GENES[3:9]) + ", …"
    assert card.locator("select.az-card__select").input_value() == "set"
    assert page.locator(f"{TP} .cgene-section__title").count() == 0, "no text field: the title is the card's text"


def test_rename_from_menu_uses_inline_rename(page, served):
    _both(page, served)
    card = f"{TP} .cgene-section[data-index='0']"

    def rename(text, how):
        page.click(f"{card} .az-card__more")
        page.click(f"{MENU} .az-card__op[data-op='rename']")
        box = page.locator(f"{card} .az-card__rename-input")
        box.fill(text)
        if how == "enter":
            box.press("Enter")
        elif how == "check":
            page.click(f"{card} .az-card__rename-ok")
        else:
            box.press("Escape")

    before = page.evaluate("(id) => window.PanelManager.getPanel(id)._debugState().undo", P)
    rename("Mine", "check")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].title === 'Mine'", P)
    assert page.evaluate("(id) => window.PanelManager.getPanel(id)._debugState().undo", P) == before + 1, "one undo step"
    rename("Other", "escape")
    page.locator(f"{card} .az-card__rename-input").wait_for(state="detached")
    assert _config(page)["sections"][0]["title"] == "Mine" and _titles(page, TP)[0] == "Mine"
    rename("", "enter")
    until(page, "(id) => !('title' in window.PanelManager.getPanel(id).getConfig().sections[0])", P)
    assert _titles(page, TP)[0] == "Markers", "empty restores the source's title"
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].title === 'Mine'", P)


def test_preview_gives_way_first_at_700px(page, served):
    _both(page, served)
    page.set_viewport_size({"width": 1500, "height": 1000})
    assert page.locator(f"{TP} .az-card__preview").first.is_visible()
    page.set_viewport_size({"width": 420, "height": 1000})
    page.wait_for_function("(s) => !document.querySelector(s + ' .az-card__preview') || getComputedStyle(document.querySelector(s + ' .az-card__preview')).display === 'none'", arg=TP)
    assert page.locator(f"{TP} .az-card__title").first.is_visible()


def test_card_head_opens_the_source(page, served):
    _both(page, served)
    assert page.locator(f'.tile[data-tile-id="{S1}"]').count() == 0
    page.click(f"{TP} .cgene-section[data-index='0'] .az-card__head")
    page.wait_for_selector(f'.tile[data-tile-id="{S1}"]', timeout=15000)


@pytest.mark.parametrize("panel", ["sections", "factors"])
def test_reorder_by_drag_and_alt_arrows(page, served, panel):
    _both(page, served)
    root = TP if panel == "sections" else TG
    first = _titles(page, root)
    assert len(first) == 2
    # Alt+Down on the first card's head
    page.focus(f"{root} .az-card[data-index='0'] .az-card__head")
    page.keyboard.press("Alt+ArrowDown")
    until(page, "([r, t]) => document.querySelector(r + ' .az-card .az-card__title').textContent === t", [root, first[1]])
    assert _titles(page, root) == [first[1], first[0]]
    # and dragging the first onto the second puts it back
    page.locator(f"{root} .az-card[data-index='0']").drag_to(page.locator(f"{root} .az-card[data-index='1']"))
    until(page, "([r, t]) => document.querySelector(r + ' .az-card .az-card__title').textContent === t", [root, first[0]])
    assert _titles(page, root) == first


def test_a_twelve_character_title_shows_in_full_at_700px(page, served):
    """The title is the last thing to give way: the summary and the preview shrink first, so a 12-character title is whole
    in a tile of a 700 px page with another tile beside it (it used to show as `Pathw…`)."""
    _both(page, served, sections=[{"source": S1, "rows": "genes", "title": "Twelve Chars"}, {"source": S2, "rows": "set", "title": "Twelve Words"}])
    page.set_viewport_size({"width": 700, "height": 1000})
    page.wait_for_function("() => window.innerWidth === 700")
    got = page.evaluate("""(s) => [...document.querySelectorAll(s + ' .az-card .az-card__title')].map(t => [t.textContent, t.scrollWidth, t.clientWidth])""", TP)
    assert [g[0] for g in got] == ["Twelve Chars", "Twelve Words"]
    assert all(sw <= cw for _, sw, cw in got), got


def _start_rename(page, index=0):
    card = f"{TP} .cgene-section[data-index='{index}']"
    page.click(f"{card} .az-card__more")
    page.click(f"{MENU} .az-card__op[data-op='rename']")
    return card, page.locator(f"{card} .az-card__rename-input")


def test_the_rename_editor_stays_open_and_keeps_the_focus_until_it_is_left(page, served):
    """Operator: 'renaming only makes the title editable briefly.' Choosing Rename closes the menu, which gives the focus
    back to ⋯; the editor must start after that, or the focus leaving it counts as a click away and saves and closes it."""
    _both(page, served)
    card, box = _start_rename(page)
    box.wait_for(state="visible")
    # nothing is typed: a click-away timer (350 ms) would have closed the editor by now
    page.wait_for_function("(c) => new Promise(r => setTimeout(() => r(true), 700))", arg=card)
    assert box.count() == 1, "the editor is still open"
    assert page.evaluate("(c) => document.activeElement === document.querySelector(c + ' .az-card__rename-input')", card), "and has the focus"
    box.type("Typed after a pause")
    box.press("Enter")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].title === 'Typed after a pause'", P)


def test_a_rename_in_progress_survives_a_redraw_of_the_list(page, served):
    """A signature that changes while the title is being edited (a gene added: its count changes, the list is drawn again)
    must not take the editor, or the text typed so far, away."""
    _both(page, served)
    card, box = _start_rename(page)
    box.fill("Half a na")
    page.evaluate("(id) => window.PanelManager.getPanel(id).addGenes(['GENE020'])", S1)
    until(page, "(s) => /4 genes/.test(document.querySelector(s + ' .az-card .az-card__summary').textContent)", TP)
    assert page.locator(f"{card} .az-card__rename-input").input_value() == "Half a na"
    page.locator(f"{card} .az-card__rename-input").press("Enter")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].title === 'Half a na'", P)


def test_double_click_on_the_title_renames_without_the_menu(page, served):
    _both(page, served)
    card = f"{TP} .cgene-section[data-index='1']"
    page.dblclick(f"{card} .az-card__title")
    box = page.locator(f"{card} .az-card__rename-input")
    box.wait_for(state="visible")
    assert box.input_value() == "Pathway"
    box.fill("Renamed")
    box.press("Enter")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[1].title === 'Renamed'", P)
    assert page.locator(f'.tile[data-tile-id="{S2}"]').count() == 0, "a double click does not also open the source"


def test_every_action_of_a_section_card_works_from_its_menu(page, served):
    """What the section rows had before they were restyled: rename, duplicate, remove, open source, move up and down, and
    Genes / One row; each one undo step."""
    _both(page, served)

    def op(index, name):
        page.click(f"{TP} .cgene-section[data-index='{index}'] .az-card__more")
        page.click(f"{MENU} .az-card__op[data-op='{name}']")

    n = lambda: page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().sections.length", P)
    titles = lambda: page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().sections.map(s => s.source)", P)
    first = titles()
    op(1, "up")
    until(page, "([id, s]) => window.PanelManager.getPanel(id).getConfig().sections[0].source === s", [P, first[1]])
    op(0, "down")
    until(page, "([id, s]) => window.PanelManager.getPanel(id).getConfig().sections[0].source === s", [P, first[0]])
    op(0, "duplicate")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections.length === 3", P)
    op(1, "remove")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections.length === 2", P)
    assert page.locator(f'.tile[data-tile-id="{S1}"]').count() == 0
    op(0, "open")
    page.wait_for_selector(f'.tile[data-tile-id="{S1}"]', timeout=15000)
    page.select_option(f"{TP} .cgene-section[data-index='0'] select.cgene-section__rows", "set")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].rows === 'set'", P)
    assert n() == 2
