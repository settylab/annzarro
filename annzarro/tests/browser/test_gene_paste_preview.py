"""Paste or upload genes: the preview component (static/js/utils/gene-paste-preview.js).

Mounted on a minimal page, with no panel and no app server: a stdlib file server on the
repository root, started and stopped inside the fixture. Covers the input stage (paste, typing, file by button,
drag and drop, refusals), every preview state (list, table, GMT, over the limit, identifier mismatch,
nothing found), the copy buttons, the add callback (one call, the whole batch) and that no request leaves the page.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import functools
import http.server
import json
import os
import threading

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
PAGE = "/annzarro/tests/browser/pages/gene-paste-preview.html"
GENES = ["CD3D", "CD4", "CD8A", "IL7R", "GATA1", "KLF1", "MS4A1", "CD19", "LYZ", "S100A8"]


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


@pytest.fixture(scope="module")
def root():
    handler = functools.partial(_Quiet, directory=REPO)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}"
    finally:
        srv.shutdown()
        srv.server_close()
        t.join(5)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        try:
            yield b
        finally:
            b.close()


@pytest.fixture
def page(browser, root):
    ctx = browser.new_context(viewport={"width": 480, "height": 900})
    pg = ctx.new_page()
    pg.requests = []
    pg.on("request", lambda r: pg.requests.append((r.method, r.url)))
    pg.goto(root + PAGE)
    pg.wait_for_function("() => window.ready === true", timeout=15000)
    yield pg
    ctx.close()


def mount(page, current=(), limit=2000, genes=GENES, id_to_name=None):
    page.evaluate("""([g, c, l, ids]) => window.mountPaste({geneNames: g, currentGenes: c, limit: l,
        idToName: ids ? new Map(Object.entries(ids)) : undefined})""", [genes, list(current), limit, id_to_name])


def paste(page, text):
    page.evaluate("""(t) => {
        const ta = document.querySelector('[data-testid=gp-text]');
        const dt = new DataTransfer(); dt.setData('text/plain', t);
        ta.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
    }""", text)


def tid(page, name):
    return page.locator(f"[data-testid={name}]")


def added(page):
    return page.evaluate("window.added")


def preview_visible(page):
    return tid(page, "gp-counts").is_visible()


def test_input_stage_and_cancel(page):
    mount(page)
    assert tid(page, "gp-text").is_visible()
    assert tid(page, "gp-text").get_attribute("aria-label") == "Genes to paste"
    body = page.locator(".gene-paste").inner_text()
    assert "never uploaded to the server" in body
    assert "CSV, TSV, TXT, GMT, GRP" in body
    assert tid(page, "gp-choose").is_visible()
    assert tid(page, "gp-preview-btn").is_disabled()
    tid(page, "gp-cancel").click()
    assert page.evaluate("window.cancelled") == 1
    tid(page, "gp-text").focus()
    page.keyboard.press("Escape")
    assert page.evaluate("window.cancelled") == 2


def test_paste_gives_a_preview_and_adds_nothing_until_add(page):
    mount(page, current=["IL7R"])
    paste(page, "CD3D, cd4;CD8A\nIL7R CD3D FOO1|1-Mar")
    assert preview_visible(page)
    assert tid(page, "gp-c-add").inner_text().split()[0] == "3"           # CD3D, CD4 (ignoring case), CD8A
    assert tid(page, "gp-c-already").inner_text().split()[0] == "1"
    assert tid(page, "gp-c-dups").inner_text().split()[0] == "1"
    assert "cd4 > CD4" in tid(page, "gp-c-case").inner_text()
    assert tid(page, "gp-c-unmatched").inner_text().split()[0] == "2"
    assert tid(page, "gp-unmatched-names").inner_text().split() == ["FOO1", "1-Mar"]
    assert "changed by Excel" in page.locator(".gp-note").first.inner_text()
    assert added(page) == []
    assert tid(page, "gp-add").inner_text() == "Add 3 genes"
    # focus moved to the preview heading
    assert page.evaluate("document.activeElement.textContent") == "Preview"
    tid(page, "gp-add").click()
    got = added(page)
    assert len(got) == 1, "one call for the whole batch"
    assert got[0]["genes"] == ["CD3D", "CD4", "CD8A"]
    assert got[0]["info"]["alreadySelected"] == 1 and got[0]["info"]["unmatched"] == 2
    assert tid(page, "gp-text").is_visible() and tid(page, "gp-text").input_value() == ""   # ready for the next paste


def test_typed_text_needs_preview_button_or_ctrl_enter_and_back_keeps_it(page):
    mount(page)
    tid(page, "gp-text").fill("CD3D CD4")
    assert not preview_visible(page)
    tid(page, "gp-preview-btn").click()
    assert tid(page, "gp-c-add").inner_text().split()[0] == "2"
    tid(page, "gp-back").click()
    assert tid(page, "gp-text").input_value() == "CD3D CD4"
    assert page.evaluate("document.activeElement.dataset.testid") == "gp-text"
    tid(page, "gp-text").fill("CD3D\nCD4\nCD8A")
    page.keyboard.press("Control+Enter")
    assert tid(page, "gp-c-add").inner_text().split()[0] == "3"
    assert added(page) == []


def test_nothing_to_preview_and_nothing_found(page):
    mount(page)
    tid(page, "gp-text").fill("  \n ")
    assert tid(page, "gp-preview-btn").is_disabled()
    paste(page, "  \n  ")
    assert tid(page, "gp-error").is_visible() and "Nothing to preview" in tid(page, "gp-error").inner_text()
    paste(page, "   ,  ;")
    assert tid(page, "gp-none").is_visible() and "No gene names found" in tid(page, "gp-none").inner_text()
    assert tid(page, "gp-add").is_disabled() and tid(page, "gp-add").inner_text() == "Add genes"


def test_case_matches_show_hide_and_match_case_switch(page):
    mount(page)
    paste(page, "cd3d Cd4 CD8A")
    show = tid(page, "gp-showcase")
    assert show.get_attribute("aria-expanded") == "false"
    show.click()
    assert tid(page, "gp-showcase").get_attribute("aria-expanded") == "true"
    assert tid(page, "gp-casemap").inner_text().splitlines() == ["cd3d > CD3D", "Cd4 > CD4"]
    assert page.evaluate("document.activeElement.dataset.testid") == "gp-showcase", "focus survives the redraw"
    tid(page, "gp-matchcase").check()
    assert tid(page, "gp-c-add").inner_text().split()[0] == "1"
    assert tid(page, "gp-c-unmatched").inner_text().split()[0] == "2"
    assert page.locator("[data-testid=gp-c-case]").count() == 0
    tid(page, "gp-add").click()
    assert added(page)[0]["genes"] == ["CD8A"]


def test_species_message_and_no_message_for_symbols(page):
    mount(page)
    paste(page, "Cd3d Cd4 Cd8a Il7r")
    assert "may come from another species" in page.locator(".gene-paste").inner_text()
    assert "Names were matched, not orthologs" in page.locator(".gene-paste").inner_text()
    mount(page)
    paste(page, "CD3D CD4")
    assert page.locator(".gp-note").count() == 0


def test_copy_unmatched_copies_every_name(page):
    mount(page)
    page.evaluate("""() => { window.copied = null; Object.defineProperty(navigator, 'clipboard',
        {value: {writeText: (t) => { window.copied = t; return Promise.resolve(); }}, configurable: true}); }""")
    names = [f"NOPE{i}" for i in range(400)]
    paste(page, "CD3D " + " ".join(names))
    assert tid(page, "gp-copy-unmatched").inner_text() == "Copy 400 names"
    assert "and 100 more" in tid(page, "gp-unmatched").inner_text()
    tid(page, "gp-copy-unmatched").click()
    page.wait_for_function("() => window.copied !== null")
    assert page.evaluate("window.copied").split("\n") == names
    assert tid(page, "gp-copy-unmatched").inner_text() == "Copied"


def test_names_are_text_not_markup(page):
    mount(page)
    paste(page, '<img src=x onerror="window.pwned=1"> CD3D')
    page.wait_for_timeout(200)
    assert page.evaluate("window.pwned") is None
    assert page.locator(".gene-paste img").count() == 0
    assert "<img" in tid(page, "gp-unmatched-names").inner_text()


def test_file_by_button_csv_with_header_and_column_choice(page):
    mount(page)
    csv = "score,gene_symbol,padj\n2.4,CD3D,0.01\n1.1,CD4,0.2\n0.5,FOO1,0.3\n0.2,CD8A,0.4\n"
    tid(page, "gp-file").set_input_files(files=[{"name": "de.csv", "mimeType": "text/csv", "buffer": csv.encode()}])
    tid(page, "gp-column").wait_for()
    assert tid(page, "gp-readas").input_value() == "table"
    assert tid(page, "gp-column").input_value() == "1"
    assert tid(page, "gp-header").is_checked()
    assert "From de.csv" in page.locator(".gene-paste").inner_text()
    assert tid(page, "gp-c-add").inner_text().split()[0] == "3"
    assert tid(page, "gp-c-unmatched").inner_text().split()[0] == "1"
    assert page.locator(".gp-sample-table th").all_inner_texts() == ["score", "gene_symbol", "padj"]
    # picking the score column: numbers are unmatched
    tid(page, "gp-column").select_option("0")
    assert tid(page, "gp-c-add").count() == 1 and tid(page, "gp-add").is_disabled()
    tid(page, "gp-column").select_option("1")
    # header row off turns the header into a name
    tid(page, "gp-header").uncheck()
    assert tid(page, "gp-c-unmatched").inner_text().split()[0] == "2"
    tid(page, "gp-header").check()
    tid(page, "gp-add").click()
    assert added(page)[0]["genes"] == ["CD3D", "CD4", "CD8A"]
    assert added(page)[0]["info"]["fileName"] == "de.csv"


def test_read_as_override(page):
    mount(page)
    paste(page, "gene,score\nCD3D,1\nCD4,2\nCD8A,3")
    assert tid(page, "gp-readas").input_value() == "table"
    tid(page, "gp-readas").focus()
    tid(page, "gp-readas").select_option("list")
    assert tid(page, "gp-column").count() == 0
    assert tid(page, "gp-c-add").inner_text().split()[0] == "3"
    assert tid(page, "gp-c-unmatched").inner_text().split()[0] == "5"      # gene, score, 1, 2, 3
    assert page.evaluate("document.activeElement.dataset.key") == "readas"


def test_gmt_pick_a_set(page):
    mount(page)
    gmt = ("HALLMARK_T\tt cells\tCD3D\tCD4\tCD8A\tIL7R\n"
           "HALLMARK_B\tb cells\tMS4A1\tCD19\tNOPE1\n"
           "HALLMARK_MYELOID\tm\tLYZ\tS100A8\tFOO\tBAR\tBAZ\n")
    tid(page, "gp-file").set_input_files(files=[{"name": "sets.gmt", "mimeType": "text/plain", "buffer": gmt.encode()}])
    tid(page, "gp-setfilter").wait_for()
    assert tid(page, "gp-readas").input_value() == "gmt"
    assert "3 gene sets" in page.locator(".gp-gmt").inner_text()
    rows = page.locator(".gp-set").all_inner_texts()
    assert [" ".join(r.split()) for r in rows] == [
        "HALLMARK_T 4 genes, 4 matched", "HALLMARK_B 3 genes, 2 matched", "HALLMARK_MYELOID 5 genes, 2 matched"]
    assert tid(page, "gp-add").inner_text() == "Add 4 genes"
    tid(page, "gp-setfilter").fill("b")
    assert page.locator(".gp-set").count() == 1
    page.locator(".gp-set input").check()
    assert tid(page, "gp-add").inner_text() == "Add 2 genes"
    assert tid(page, "gp-c-unmatched").inner_text().split()[0] == "1"
    tid(page, "gp-add").click()
    assert added(page)[0]["genes"] == ["MS4A1", "CD19"]
    assert added(page)[0]["info"]["format"] == "gmt"


def test_grp_file(page):
    mount(page)
    tid(page, "gp-file").set_input_files(files=[{"name": "s.grp", "mimeType": "text/plain", "buffer": b"# set\r\nCD3D\r\nCD4\r\n"}])
    tid(page, "gp-c-add").wait_for()
    assert tid(page, "gp-readas").input_value() == "grp"
    assert tid(page, "gp-add").inner_text() == "Add 2 genes"


def test_over_the_limit_adds_nothing(page):
    genes = [f"G{i}" for i in range(2431)]
    mount(page, genes=genes)
    paste(page, "\n".join(genes))
    assert "2,431 genes matched" in tid(page, "gp-over").inner_text()
    assert "A signature holds up to 2,000 genes. Nothing was added." in tid(page, "gp-over").inner_text()
    assert tid(page, "gp-add").is_disabled() and tid(page, "gp-add").inner_text() == "Add genes"
    tid(page, "gp-add").click(force=True)
    assert added(page) == []
    assert tid(page, "gp-copy-matched").inner_text() == "Copy matched names"
    # the selection counts against the limit
    mount(page, genes=genes, current=genes[:1995], limit=2000)
    paste(page, "\n".join(genes[1995:2006]))
    assert tid(page, "gp-over").is_visible()
    assert "2,000" in tid(page, "gp-over").inner_text() and "would make 2,006" in tid(page, "gp-over").inner_text()
    # at the limit exactly is fine
    mount(page, genes=genes, current=genes[:1995], limit=2000)
    paste(page, "\n".join(genes[1995:2000]))
    assert tid(page, "gp-add").inner_text() == "Add 5 genes"


def test_identifier_mismatch_messages(page):
    mount(page)
    ids = [f"ENSG{100000000 + i:011d}" for i in range(12)]
    paste(page, "\n".join(ids))
    assert "These look like Ensembl ids, but this dataset uses gene symbols and has no id column to translate them." in page.locator(".gp-note").first.inner_text()
    assert tid(page, "gp-c-add").inner_text().split()[0] == "0"
    assert tid(page, "gp-copy-unmatched").inner_text() == "Copy 12 names"
    assert tid(page, "gp-add").is_disabled()
    # with an id column the same ids match by id
    mount(page, id_to_name={ids[0]: "CD3D", ids[1]: "CD4"})
    paste(page, "\n".join(ids[:2]))
    assert tid(page, "gp-c-id").inner_text().split()[0] == "2"
    assert tid(page, "gp-add").inner_text() == "Add 2 genes"
    # all already selected
    mount(page, current=["CD3D"])
    paste(page, "CD3D")
    assert "already selected" in page.locator(".gene-paste").inner_text()
    assert tid(page, "gp-add").is_disabled()


def test_refusals_excel_too_big_binary_empty(page):
    mount(page)
    tid(page, "gp-file").set_input_files(files=[{"name": "genes.xlsx", "mimeType": "application/octet-stream", "buffer": b"PK\x03\x04" + b"\0" * 20}])
    assert tid(page, "gp-error").inner_text() == "Excel files cannot be read here. Save the sheet as CSV first."
    assert tid(page, "gp-text").is_visible()
    tid(page, "gp-file").set_input_files(files=[{"name": "genes.txt", "mimeType": "text/plain", "buffer": b"A" * (10 * 1024 * 1024 + 1)}])
    assert "10 MB" in tid(page, "gp-error").inner_text()
    tid(page, "gp-file").set_input_files(files=[{"name": "genes.txt", "mimeType": "text/plain", "buffer": b"\x01\x02\x00\x00"}])
    assert "does not look like a text file" in tid(page, "gp-error").inner_text()
    tid(page, "gp-file").set_input_files(files=[{"name": "e.txt", "mimeType": "text/plain", "buffer": b""}])
    assert tid(page, "gp-error").inner_text() == "That file is empty."
    # an old xls by signature, under a text name
    tid(page, "gp-file").set_input_files(files=[{"name": "genes.txt", "mimeType": "text/plain", "buffer": b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"}])
    assert "Excel files" in tid(page, "gp-error").inner_text()
    assert added(page) == []
    # the same file can be chosen again after a refusal, and a good file clears the error
    tid(page, "gp-file").set_input_files(files=[{"name": "ok.txt", "mimeType": "text/plain", "buffer": b"CD3D\nCD4"}])
    tid(page, "gp-c-add").wait_for()
    assert tid(page, "gp-error").is_hidden()


def test_utf16_bom_and_crlf_file(page):
    mount(page)
    data = b"\xff\xfe" + "CD3D\r\nCD4\r\n".encode("utf-16-le")
    tid(page, "gp-file").set_input_files(files=[{"name": "u16.txt", "mimeType": "text/plain", "buffer": data}])
    tid(page, "gp-c-add").wait_for()
    assert tid(page, "gp-add").inner_text() == "Add 2 genes"


def test_drag_and_drop(page):
    mount(page)
    page.evaluate("""() => {
        const root = document.querySelector('.gene-paste');
        const dt = new DataTransfer();
        dt.items.add(new File(['CD3D\\tCD4\\nCD8A'.replace('\\\\t', '\\t')], 'drop.txt', {type: 'text/plain'}));
        root.dispatchEvent(new DragEvent('dragenter', {dataTransfer: dt, bubbles: true, cancelable: true}));
        window.dragging = root.classList.contains('gp-dragging');
        root.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true}));
    }""")
    assert page.evaluate("window.dragging") is True
    tid(page, "gp-c-add").wait_for()
    assert tid(page, "gp-add").inner_text() == "Add 3 genes"
    assert page.evaluate("document.querySelector('.gene-paste').classList.contains('gp-dragging')") is False


def test_nothing_is_sent_anywhere(page):
    mount(page)
    paste(page, "CD3D CD4")
    tid(page, "gp-file").set_input_files(files=[{"name": "a.csv", "mimeType": "text/csv", "buffer": b"gene,x\nCD3D,1\nCD4,2\n"}])
    tid(page, "gp-column").wait_for()
    tid(page, "gp-add").click()
    stray = [r for r in page.requests if r[0] != "GET" or "/api" in r[1]]
    assert stray == []
    assert all("/static/" in u or u.endswith(PAGE) for _, u in page.requests)


def test_narrow_screen_and_dark_theme_do_not_overflow(page):
    page.set_viewport_size({"width": 360, "height": 800})
    mount(page, genes=[f"G{i}" for i in range(50)])
    paste(page, "\n".join(f"G{i}" for i in range(40)) + "\n" + "\n".join(f"LONGUNMATCHEDNAME_{i}" for i in range(30)))
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    page.evaluate("document.documentElement.setAttribute('data-theme', 'dark')")
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
