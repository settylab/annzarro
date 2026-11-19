"""Pasted Ensembl ids in the Gene Signature panel, matched through a var column.

The store is the panel test's (3,000 genes) with a `gene_ids` var column of Ensembl ids
(ENSG + 11 digits, the gene's position), served as one dataset; a second server holds the plain store with no id column.

1. Ensembl ids are matched through the column, reported as "matched by id", and the recipe gets the gene names.
2. A version suffix (.7) is stripped.
3. With no id column the old message stays and nothing is added.
4. The column is requested only for ids: not on panel open, not for a symbol list.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import pytest

from annzarro.tests.browser import test_focus_outside_subset as _focus  # noqa: E402
from annzarro.tests.browser import test_gene_signature_paste as _paste_tests  # noqa: E402
from annzarro.tests.browser.test_gene_signature_panel import (  # noqa: F401
    GENES, S, _genes, _make_store as _plain_store, _message, _open_signature, page, playwright, served)
from annzarro.tests.browser.test_names_dataset_scope import _serve  # noqa: E402
from annzarro.tests.zarr_compat import open_group, write_strings  # noqa: E402

BTN, TXT = _paste_tests.BTN, _paste_tests.TXT
_paste, _add_btn, _open_flow = _paste_tests._paste, _paste_tests._add_btn, _paste_tests._open_flow


def ens(i, version=""):
    return f"ENSG{i:011d}{version}"


def _store_with_ids(path):
    _plain_store(path)
    root = open_group(str(path), mode="r+") if _supports_mode() else open_group(str(path))
    var = root["var"]
    z = write_strings(var, "gene_ids", [ens(i) for i in range(len(GENES))])
    z.attrs.update({"encoding-type": "string-array", "encoding-version": "0.2.0"})
    var.attrs["column-order"] = list(var.attrs["column-order"]) + ["gene_ids"]
    return str(path)


def _supports_mode():
    import inspect
    return "mode" in inspect.signature(open_group).parameters


@pytest.fixture(scope="module")
def served_ids(tmp_path_factory):
    original = _focus._make_store
    _focus._make_store = _store_with_ids
    try:
        proc, root, store = _serve(tmp_path_factory)
    finally:
        _focus._make_store = original
    yield root, store
    proc.terminate()
    proc.wait(10)


def _var_requests(requests):
    return [u for m, u in requests if "/data/var" in u]


def _track(page):
    seen = []
    page.on("request", lambda r: seen.append((r.method, r.url)))
    return seen


def test_ensembl_ids_match_through_the_var_column_and_the_recipe_gets_names(page, served_ids):
    seen = _track(page)
    _open_signature(page, served_ids, ["GENE0001"])
    _open_flow(page)
    assert not any("gene_ids" in u for u in _var_requests(seen)), "never on panel open"
    ids = [ens(GENES.index(g)) for g in ("CD3D", "KLF1", "GAPDH")] + [ens(5000)]
    _paste(page, "\n".join(ids) + "\nCD3E")
    page.locator(f"{S} [data-testid=gp-c-id]").wait_for()
    assert page.inner_text(f"{S} [data-testid=gp-c-id]").split()[0] == "3"
    assert "matched by id" in page.inner_text(f"{S} [data-testid=gp-c-id]")
    assert page.inner_text(f"{S} [data-testid=gp-c-add]").split()[0] == "4"          # 3 by id + CD3E by name
    assert page.inner_text(f"{S} [data-testid=gp-c-unmatched]").split()[0] == "1"
    assert page.locator(f"{S} .gp-note[data-code=ensembl]").count() == 0
    assert any("gene_ids" in u for u in _var_requests(seen)), "the id column was read when needed"
    assert _genes(page) == ["GENE0001"]
    _add_btn(page).click()
    assert _genes(page) == sorted(["GENE0001", "CD3D", "KLF1", "GAPDH", "CD3E"]), "names, never ids"
    assert not any(g.startswith("ENSG") for g in _genes(page))
    assert _message(page).startswith("Added 4 genes from pasted list.")
    page.keyboard.press("Control+z")
    assert _genes(page) == ["GENE0001"], "one undo step"


def test_version_suffixes_are_stripped(page, served_ids):
    _open_signature(page, served_ids)
    _open_flow(page)
    _paste(page, f"{ens(3, '.7')}, {ens(4, '.12')};{ens(5)}")
    page.locator(f"{S} [data-testid=gp-c-id]").wait_for()
    assert page.inner_text(f"{S} [data-testid=gp-c-id]").split()[0] == "3"
    _add_btn(page).click()
    assert _genes(page) == sorted(GENES[3:6])


def test_no_id_column_keeps_the_warning(page, served):
    seen = _track(page)
    _open_signature(page, served)
    _open_flow(page)
    _paste(page, "\n".join(ens(i) for i in range(8)))
    note = page.locator(f"{S} .gp-note[data-code=ensembl]")
    note.wait_for()
    assert "look like Ensembl ids" in note.inner_text()
    assert page.locator(f"{S} [data-testid=gp-loading]").count() == 0
    assert _add_btn(page).is_disabled()
    assert _genes(page) == []
    assert _var_requests(seen) == [] or not any("column" in u and "mean" not in u for u in _var_requests(seen))


def test_a_symbol_list_requests_no_column(page, served_ids):
    seen = _track(page)
    _open_signature(page, served_ids)
    _open_flow(page)
    before = len(seen)
    _paste(page, "CD3D, CD3E KLF1 cd3d NOPE1")
    page.locator(f"{S} [data-testid=gp-counts]").wait_for()
    page.wait_for_timeout(500)
    after = seen[before:]
    assert [u for m, u in after if "/data/var" in u or "/data/structure" in u or "structure" in u] == []
    assert after == [] or all(m == "GET" for m, _ in after)
