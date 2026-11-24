"""Tab in a name editor saves the name, opens the next editor, and that editor STAYS open until the user leaves it
(operator, 0.8.0: "one switches to the edit of the next item briefly but then the edit quickly closes, interrupting the
edit and leaving an unfinished name"). The same for the group editor and the level editor, and Shift+Tab.
"""
from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_cell_grouping_panel import (  # noqa: E402,F401
    A, CELL_TYPE, GA, _grouping, _open, _ready, page, served)
from annzarro.tests.browser.test_cell_grouping_rename import EDIT, P as LP, B_ROW  # noqa: E402
from annzarro.tests.browser.test_grouping_group_names import FIELD as GFIELD, ROW, _grid, _names  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

LFIELD = f"{LP} input.cgrp-level__name"


def _config(page):
    return page.evaluate("() => window.PanelManager.getPanel('cell-grouping-A').getConfig()")


def _type_slowly(page, field, text):
    """Several keystrokes over at least 500 ms; the editor must stay open and focused throughout."""
    for ch in text:
        waits.expect_stays(lambda: page.locator(field).count() == 1 and page.evaluate("(s) => document.activeElement === document.querySelector(s)", field),
                           "the editor must stay open and focused while the user types into it", page=page, seconds=0.12, interval=0.04)
        page.keyboard.type(ch)


def test_tab_in_the_group_editor_keeps_the_next_editor_open_while_typing(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])}, (GA,))
    names = _names(page)
    page.dblclick(f"{ROW} .cgg-name")
    page.fill(GFIELD, "first")
    page.keyboard.press("Tab")
    until(page, "() => document.activeElement.matches('input.cgg-edit__name')")
    assert page.input_value(GFIELD) == names[1]
    _type_slowly(page, GFIELD, "second")
    assert page.input_value(GFIELD) == "second"
    page.keyboard.press("Enter")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().groupOverrides || []).length === 2")
    assert [o["label"] for o in _config(page)["groupOverrides"]] == ["first", "second"]


def test_shift_tab_in_the_group_editor_goes_back_and_stays_open(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])}, (GA,))
    names = _names(page)
    row = f"{A} .cgg-row:has(.cgg-name:text-is('{names[1]}'))"
    page.dblclick(f"{row} .cgg-name")
    page.fill(GFIELD, "later")
    page.keyboard.press("Shift+Tab")
    until(page, "() => document.activeElement.matches('input.cgg-edit__name')")
    assert page.input_value(GFIELD) == names[0]
    _type_slowly(page, GFIELD, "earlier")
    page.keyboard.press("Enter")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().groupOverrides || []).length === 2")
    labels = {o["name"]: o["label"] for o in _config(page)["groupOverrides"]}
    assert labels == {names[1]: "later", names[0]: "earlier"}


def test_tab_in_the_level_editor_keeps_the_next_editor_open_while_typing(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])})
    _ready(page)
    page.click(EDIT)
    page.click(f"{B_ROW} .cgrp-level__rename")
    page.wait_for_selector(LFIELD)
    page.fill(LFIELD, "first")
    page.keyboard.press("Tab")
    until(page, "() => document.activeElement.matches('input.cgrp-level__name') && !document.activeElement.closest(\".cgrp-level[data-id='c:B cell']\")")
    _type_slowly(page, LFIELD, "second")
    assert page.input_value(LFIELD) == "second"
    page.keyboard.press("Enter")
    until(page, "() => Object.keys(window.PanelManager.getPanel('cell-grouping-A').getRecipe().partitionings[0].labels || {}).length === 2")
    labels = page.evaluate("() => window.PanelManager.getPanel('cell-grouping-A').getRecipe().partitionings[0].labels")
    assert sorted(labels.values()) == ["first", "second"]


def test_the_shared_editor_module_keeps_a_moved_editor_open_and_leaves_once(page, served):
    """ui/inline-rename.js on its own: Tab saves and the caller moves the one editor to the next row; it stays open."""
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])}, (GA,))
    page.evaluate("""async () => {
        const { inlineRename } = await import('/static/js/ui/inline-rename.js');
        const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag);
            for (const [k, v] of Object.entries(props)) { if (k === 'class') n.className = v; else if (k === 'data') Object.assign(n.dataset, v); else if (k === 'aria') { for (const [a, b] of Object.entries(v)) n.setAttribute('aria-' + a, b); } else if (k === 'value') n.value = v; else n.setAttribute(k, v); }
            n.append(...kids); return n; };
        const host = el('div', { id: 'ir-host', style: 'position:fixed;top:0;left:0;z-index:99999;background:white' });
        const rows = ['one', 'two', 'three'].map((t) => { const r = el('div', { class: 'ir-row', data: { name: t } }, el('span', {}, t)); host.append(r); return r; });
        document.body.append(host);
        window.__saved = []; window.__cancelled = 0; let at = 0;
        const ed = inlineRename({ el, value: 'one', classes: { input: 'ir-input', ok: 'ir-ok', cancel: 'ir-cancel' },
            labels: { field: 'f', ok: 'o', cancel: 'c', hint: 'h' },
            onSave: (text, move) => { window.__saved.push([rows[at].dataset.name, text, move]);
                if (move && rows[at + move]) { at += move; ed.rearm(); rows[at].append(box); setTimeout(() => { ed.input.value = rows[at].dataset.name; ed.input.focus(); ed.input.select(); }, 0); } },
            onCancel: () => { window.__cancelled++; } });
        const box = el('span', { class: 'ir-box' }, ed.input, ed.ok, ed.cancel);
        ed.attach(box);
        rows[0].append(box);
        ed.input.focus();
    }""")
    field = "#ir-host input.ir-input"
    page.fill(field, "uno")
    page.keyboard.press("Tab")
    until(page, "() => document.querySelector('#ir-host .ir-row:nth-child(2) input.ir-input') === document.activeElement")
    _type_slowly(page, field, "dos")
    assert page.input_value(field) == "dos"
    page.keyboard.press("Enter")
    until(page, "() => window.__saved.length === 2")
    assert page.evaluate("() => window.__saved") == [["one", "uno", 1], ["two", "dos", 0]]
    page.keyboard.press("Enter")
    waits.expect_stays(lambda: page.evaluate("() => window.__saved.length") == 2, "a second Enter after leaving must not save again", page=page, seconds=0.5)
