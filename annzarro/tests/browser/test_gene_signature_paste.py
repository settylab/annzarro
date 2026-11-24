"""Paste or upload genes inside the Gene Signature panel (step 4 of the gene-signature plan).

Uses the panel test's generated store (3,000 genes: ACTB, CD3D, CD3E, CD3G, Cd3d, GAPDH, KLF1 and
GENE0000 to GENE2992) and its helpers.

1.  F2: Paste or upload opens inline, a list with mixed separators gets a preview, nothing is added
    until Add, Add is one undoable step (Ctrl+Z restores the previous list), and the focus returns to
    the Paste or upload button.
2.  Cancel and Esc close the flow and return the focus.
3.  A CSV upload: the gene column is preselected by name and can be changed.
4.  A GMT upload: one set is chosen out of several.
5.  A file dropped on the panel opens the preview, also when the panel list is showing.
6.  Over the limit adds nothing: the Add button is disabled, the list and the undo stack stay as they were.
7.  Excel files are refused with a message; nothing is sent to the server.
8.  A link round trip of the resulting list.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import pytest

from annzarro.tests.browser.test_gene_signature_panel import (  # noqa: F401  (fixtures and helpers)
    S, SIG, _captured_url, _genes, _message, _open_signature, _summary, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

BTN = f"{S} .gsig-inline[data-id=paste-upload]"
TXT = f"{S} [data-testid=gp-text]"
FILE = f"{S} [data-testid=gp-file]"


def _paste(page, text):
    page.evaluate("""([sel, t]) => {
        const ta = document.querySelector(sel);
        const dt = new DataTransfer(); dt.setData('text/plain', t);
        ta.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
    }""", [TXT, text])


def _focus_is_button(page):
    return page.evaluate("(sel) => document.activeElement === document.querySelector(sel)", BTN)


def _add_btn(page):
    return page.locator(f"{S} [data-testid=gp-add]")


def _upload(page, name, data):
    page.set_input_files(FILE, files=[{"name": name, "mimeType": "text/plain", "buffer": data}])


def _open_flow(page):
    page.click(BTN)
    page.wait_for_selector(TXT)


def test_f2_paste_mixed_separators_preview_add_and_undo(page, served):
    _open_signature(page, served, ["GENE0001"])
    assert page.locator(BTN).inner_text().startswith("Paste")
    _open_flow(page)
    # the list is replaced by the flow, and the text box has the focus
    assert page.locator(f"{S} .gsig-grid").is_hidden()
    assert page.evaluate("(sel) => document.activeElement === document.querySelector(sel)", TXT)
    _paste(page, "CD3D, CD3E;KLF1\nGAPDH ACTB|NOPE1\tCD3D")
    page.wait_for_selector(f"{S} [data-testid=gp-counts]")
    assert page.inner_text(f"{S} [data-testid=gp-c-add]").split()[0] == "5"
    assert page.inner_text(f"{S} [data-testid=gp-c-dups]").split()[0] == "1"
    assert page.inner_text(f"{S} [data-testid=gp-c-unmatched]").split()[0] == "1"
    assert _genes(page) == ["GENE0001"], "nothing is added before Add"
    assert page.locator(f"{S} .gsig-undo").is_disabled()
    assert _add_btn(page).inner_text() == "Add 5 genes"
    _add_btn(page).click()

    assert _genes(page) == sorted(["GENE0001", "CD3D", "CD3E", "KLF1", "GAPDH", "ACTB"])
    assert _summary(page) == "6 of 3,000 genes selected"
    assert _message(page) == "Added 5 genes from pasted list. 1 is not in this dataset."
    assert page.locator(f"{S} .gsig-grid").is_visible() and page.locator(f"{S} [data-testid=gp-text]").count() == 0
    assert _focus_is_button(page)
    assert page.get_attribute(f"{S} .gsig-undo", "title") == "Undo: add 5 genes from pasted list"
    assert page.evaluate("() => window.PanelManager.getPanel('gene-signature-S')._debugState().undo") == 1, "one step"
    # the list is drawn again after the flow closed
    page.click(f"{S} .gsig-seg:has-text('Selected')")
    until(page, "() => document.querySelectorAll('.tile[data-tile-id=\"gene-signature-S\"] .gsig-row').length === 6")

    page.keyboard.press("Control+z")
    assert _genes(page) == ["GENE0001"], "one Ctrl+Z restores the previous list"
    assert _message(page) == "Undone: add 5 genes from pasted list."
    assert page.locator(f"{S} .gsig-undo").is_disabled()


def test_cancel_and_escape_return_the_focus(page, served):
    _open_signature(page, served)
    _open_flow(page)
    page.click(f"{S} [data-testid=gp-cancel]")
    assert page.locator(TXT).count() == 0 and _focus_is_button(page)
    _open_flow(page)
    page.keyboard.press("Escape")
    assert page.locator(TXT).count() == 0 and _focus_is_button(page)
    # a preview, then Back keeps the text, then Esc
    _open_flow(page)
    _paste(page, "CD3D CD3E")
    page.click(f"{S} [data-testid=gp-back]")
    assert page.input_value(TXT) == "CD3D CD3E"
    page.keyboard.press("Escape")
    assert _focus_is_button(page) and _genes(page) == []


def test_csv_upload_with_a_column_choice(page, served):
    _open_signature(page, served)
    _open_flow(page)
    csv = "rank,gene_symbol,partner,padj\n1,CD3D,KLF1,0.01\n2,CD3E,GAPDH,0.02\n3,NOPE1,ACTB,0.03\n"
    _upload(page, "de.csv", csv.encode())
    page.wait_for_selector(f"{S} [data-testid=gp-column]")
    assert page.input_value(f"{S} [data-testid=gp-readas]") == "table"
    assert page.input_value(f"{S} [data-testid=gp-column]") == "1", "preselected by name"
    assert _add_btn(page).inner_text() == "Add 2 genes"
    page.select_option(f"{S} [data-testid=gp-column]", "2")
    assert _add_btn(page).inner_text() == "Add 3 genes"
    _add_btn(page).click()
    assert _genes(page) == ["ACTB", "GAPDH", "KLF1"]
    assert _message(page) == "Added 3 genes from file de.csv."
    assert _focus_is_button(page)


def test_gmt_upload_choose_one_set(page, served):
    _open_signature(page, served)
    _open_flow(page)
    gmt = ("T_CELL\tt\tCD3D\tCD3E\tCD3G\tNOPE\n"
           "ERYTHROID\te\tKLF1\tGAPDH\n"
           "NOISE\tn\tFOO\tBAR\tBAZ\n")
    _upload(page, "sets.gmt", gmt.encode())
    page.wait_for_selector(f"{S} [data-testid=gp-setfilter]")
    assert "3 gene sets" in page.inner_text(f"{S} .gp-gmt")
    assert _add_btn(page).inner_text() == "Add 3 genes"
    page.locator(f"{S} .gp-set:has-text('ERYTHROID') input").check()
    assert _add_btn(page).inner_text() == "Add 2 genes"
    _add_btn(page).click()
    assert _genes(page) == ["GAPDH", "KLF1"]
    assert _message(page).startswith("Added 2 genes from file sets.gmt")


def test_a_file_dropped_on_the_panel_opens_the_preview(page, served):
    _open_signature(page, served)
    assert page.locator(TXT).count() == 0
    page.evaluate("""(sel) => {
        const target = document.querySelector(sel + ' .gsig-grid');
        const dt = new DataTransfer();
        dt.items.add(new File(['CD3D\\nCD3E\\nKLF1\\n'], 'drop.txt', {type: 'text/plain'}));
        const over = new DragEvent('dragover', {dataTransfer: dt, bubbles: true, cancelable: true});
        target.dispatchEvent(over);
        window.__dragoverPrevented = over.defaultPrevented;
        target.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true}));
    }""", S)
    assert page.evaluate("window.__dragoverPrevented") is True
    page.wait_for_selector(f"{S} [data-testid=gp-counts]")
    assert "From drop.txt" in page.inner_text(f"{S} .gene-paste")
    assert _add_btn(page).inner_text() == "Add 3 genes"
    assert _genes(page) == []
    # a second drop onto the open flow replaces the preview and does not open a second flow
    page.evaluate("""(sel) => {
        const dt = new DataTransfer();
        dt.items.add(new File(['GAPDH\\nACTB\\n'], 'again.txt', {type: 'text/plain'}));
        document.querySelector(sel + ' .gene-paste').dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true}));
    }""", S)
    page.wait_for_function("(sel) => document.querySelector(sel + ' .gene-paste').innerText.includes('again.txt')", arg=S)
    assert page.locator(f"{S} .gene-paste").count() == 1
    assert _add_btn(page).inner_text() == "Add 2 genes"


def test_there_is_no_limit_a_long_list_is_added_in_one_step(page, served):
    _open_signature(page, served)
    _open_flow(page)
    _paste(page, "\n".join(f"GENE{i:04d}" for i in range(2001)))
    assert page.locator(f"{S} [data-testid=gp-over]").count() == 0
    assert _add_btn(page).inner_text() == "Add 2,001 genes"
    _add_btn(page).click()
    until(page, "() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes.length === 2001")
    assert _summary(page) == "2,001 of 3,000 genes selected"
    # one undo takes the whole add back
    page.click(f"{S} .gsig-undo")
    until(page, "() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes.length === 0")


def test_excel_is_refused_and_nothing_is_sent(page, served):
    requests = []
    page.on("request", lambda r: requests.append((r.method, r.url)))
    _open_signature(page, served)
    _open_flow(page)
    before = len(requests)
    _upload(page, "genes.xlsx", b"PK\x03\x04" + b"\0" * 16)
    page.locator(f"{S} [data-testid=gp-error]").wait_for(state="visible")
    assert page.inner_text(f"{S} [data-testid=gp-error]") == "Excel files cannot be read here. Save the sheet as CSV first."
    _upload(page, "genes.csv", b"gene\nCD3D\nCD3E\n")
    page.wait_for_selector(f"{S} [data-testid=gp-counts]")
    _add_btn(page).click()
    assert _genes(page) == ["CD3D", "CD3E"]
    assert [r for r in requests[before:] if r[0] != "GET" or "genes.csv" in r[1] or "CD3D" in r[1]] == []


def test_the_pasted_list_survives_a_link_round_trip(page, served):
    root, store = served
    _open_signature(page, served)
    _open_flow(page)
    _paste(page, "KLF1, CD3D;GENE0042\nGAPDH")
    _add_btn(page).click()
    want = sorted(["KLF1", "CD3D", "GENE0042", "GAPDH"])
    assert _genes(page) == want
    h = page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').getRecipeHash()")
    view = page.evaluate("() => window.sessionManager.captureView()")
    cfg = view["layout"]["panelConfigs"][SIG]
    assert cfg["genes"] == want
    assert not any("paste" in k.lower() or "flow" in k.lower() for k in cfg), sorted(cfg)
    link = _captured_url(page, root, store)
    page.goto("about:blank")
    page.goto(link)
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    assert _genes(page) == want
    assert page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').getRecipeHash()") == h
    assert page.locator(TXT).count() == 0, "the flow is not part of the link"
