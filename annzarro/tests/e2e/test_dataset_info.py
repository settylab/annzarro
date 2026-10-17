"""The dataset information button, its dialog (About, README, Structure) and the dataset browser's details pane.

Each part is requested only when it is shown, with a loading state and an error state that can be retried; the
README is rendered by the safe Markdown renderer, and a hostile README or hostile attribution fields execute nothing.

Needs Playwright with Chromium; skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import shutil

import numpy as np
import pytest
import zarr

from annzarro.core import dataset_annotate
from annzarro.tests import zarr_compat
from annzarro.tests.rich_info_store import MARKER, build_rich_store
from annzarro.tests.ui_helpers import BROWSER, browser_row, close_browser, open_browser, open_dataset

from .dsb_servers import FIXTURE, SHOTS, Session, _require, start

ATTRIBUTION = {
    "title": "Liver atlas", "description": "Cells of the adult liver, 200 of them.", "license": "CC-BY-4.0",
    "citation": "Doe J, Roe J. A liver atlas. Nature 2026.", "doi": "10.1234/abcd.5",
    "authors": ["Jane Doe", "John Roe"], "source_url": "https://example.org/liver", "contact": "jane@example.org",
    "attribution": "Liver Consortium, 2026",
}
README = """# Liver atlas

Single cells of the **adult liver**, sequenced in 2026.

- 200 cells
- 20 genes

See the [paper](https://example.org/paper) and `adata.obs`.
"""
HOSTILE = """# <script>window.pwned = 'h1'</script>

<img src=x onerror="window.pwned = 'img'">

[click](javascript:window.pwned='link') and [mixed](JaVaScRiPt:window.pwned='case') and [data](data:text/html,<script>window.pwned='data'</script>)

![pic](https://example.org/a.png "onerror=window.pwned='alt'")

<a href="https://example.org" onclick="window.pwned='click'">raw anchor</a> <iframe src="javascript:window.pwned='frame'"></iframe>

&lt;script&gt;window.pwned='entity'&lt;/script&gt; and &#60;img src=x onerror=window.pwned='num'&#62;

**bold <b onmouseover="window.pwned='b'">x</b>** [safe](https://example.org/ok)
"""
HOSTILE_FIELDS = {
    "title": "<img src=x onerror=\"window.pwned='title'\">", "description": "<script>window.pwned='desc'</script>",
    "license": "<b>MIT</b>", "license_url": "javascript:window.pwned='lurl'", "citation": "<svg onload=\"window.pwned='cite'\">",
    "doi": "javascript:window.pwned='doi'", "authors": ["<i>A</i>", "B\"onmouseover=\"window.pwned='a'"],
    "source_url": "javascript:window.pwned='src'", "contact": "<a href=javascript:window.pwned='c'>mail</a>",
    "attribution": "<script>window.pwned='attr'</script>",
}
PWN = "() => window.pwned === undefined"
INFO_URL = "**/api/v1/datasets/info*"


def _store(data, name, fields=None, readme=None):
    shutil.copytree(FIXTURE, data / name)
    if fields or readme is not None:
        dataset_annotate.annotate_store(str(data / name), fields, readme)
    return str(data / name)


@pytest.fixture(scope="module")
def info_server(tmp_path_factory):
    _require()
    tmp = tmp_path_factory.mktemp("dsinfo")
    data = tmp / "data"
    data.mkdir()
    _store(data, "liver.zarr", ATTRIBUTION, README)
    _store(data, "plain.zarr")
    # the writer refuses a javascript: address, so the two hostile ones are written below it, as a hostile dataset would have them
    hostile = _store(data, "hostile.zarr", {k: v for k, v in HOSTILE_FIELDS.items() if k not in ("license_url", "source_url")}, HOSTILE)
    group = zarr_compat.open_group(hostile, mode="r+")["uns"]["annzarro"]
    for key in ("license_url", "source_url"):
        dataset_annotate._put_text(group, key, HOSTILE_FIELDS[key])
    zarr_compat.consolidate(hostile)
    big = _store(data, "big.zarr", {"title": "Big"})
    node = zarr_compat.open_group(big, mode="r+")["uns"].create_array("README", shape=(), dtype=str)
    node[()] = "paragraph of text\n\n" * 20_000       # 380 KB: more than the annotate command accepts
    zarr_compat.consolidate(big)
    odd = _store(data, "odd.zarr", {"title": "Odd"})
    root = zarr_compat.open_group(odd, mode="r+")
    node = root["uns"].create_array("README", shape=(), dtype="int64")
    node[()] = 7
    zarr_compat.consolidate(odd)
    build_rich_store(data / "rich.zarr", FIXTURE)
    _store(data, "richattr.zarr", {
        "title": "Rich attribution", "license": {"id": "CC-BY-4.0", "url": "https://example.org/terms"},
        "authors": [{"name": "Jane Doe", "orcid": "0000-0002-1825-0097"}, {"name": "John Roe"}],
        "contacts": [{"name": "Jane", "email": "jane@example.org", "role": "curator"}, {"name": "Lab", "url": "https://example.org"}],
        "funding": [{"funder": "NIH", "award": "R35GM147125", "url": "https://reporter.nih.gov/x"}],
        "provenance": {"source": "GEO", "software": "<b>x</b>"}})
    newer = _store(data, "newer.zarr", {"title": "Written for a newer AnnZarro"})
    group = zarr_compat.open_group(newer, mode="r+")["uns"]["annzarro"]
    dataset_annotate._put_text(group, "schema_version", "2.0")
    dataset_annotate._put_text(group, "licence_terms", "renamed in 2.0")
    zarr_compat.consolidate(newer)
    base, proc = start(tmp, data)
    yield base, str(data)
    proc.terminate()
    proc.wait(20)


@pytest.fixture
def opened(info_server):
    """Open a session and the named dataset; yields ``(session, base, data)`` after ``go(name)``."""
    base, data = info_server
    made = []

    def go(name, **kwargs):
        s = Session(base, **kwargs)
        made.append(s)
        s.requests = []
        s.page.on("request", lambda r: s.requests.append(r.url) if "/datasets/info" in r.url else None)
        s.page.on("dialog", lambda d: (s.errors.append(f"unexpected dialog: {d.message}"), d.dismiss()))
        open_dataset(s.page, os.path.join(data, name))
        return s
    yield go, data
    for s in made:
        s.close()


def _shot(page, name):
    if SHOTS:
        page.wait_for_timeout(450)           # the dialog and its tabs fade in
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name))


def _open_dialog(page):
    page.click("#dataset-info")
    page.locator("#dataset-info-modal").wait_for(state="visible")
    page.wait_for_function("() => !document.querySelector('#dsi-pane-about .dsi-loading')", timeout=10_000)


def _tab(page, part):
    page.click(f"#dsi-tab-{part}")
    page.locator(f"#dsi-pane-{part}").wait_for(state="visible")


def _parts(requests):
    return [u.split("parts=")[1].split("&")[0] for u in requests]


# ---- the button ---------------------------------------------------------------------------

def test_the_button_follows_the_dataset_and_has_an_accessible_name(opened):
    go, _data = opened
    s = go("liver.zarr")
    button = s.page.locator("#dataset-info")
    assert button.is_visible() and button.get_attribute("aria-label") == "Dataset information"
    assert button.get_attribute("title") == "Dataset information"
    box_name, box_info = s.page.locator("#dataset-button").bounding_box(), button.bounding_box()
    assert abs(box_info["y"] - box_name["y"]) < 6 and 0 < box_info["x"] - (box_name["x"] + box_name["width"]) < 60, "next to the name"
    assert not s.errors, s.errors


def test_no_button_before_a_dataset_is_open(info_server):
    s = Session(info_server[0])
    try:
        assert s.page.locator("#dataset-info").is_hidden()
    finally:
        s.close()


# ---- About ---------------------------------------------------------------------------------

def test_about_shows_the_attribution_and_copies_the_citation(opened):
    go, _data = opened
    s = go("liver.zarr")
    page = s.page
    page.evaluate("() => { window.__copied = null; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; }")
    _open_dialog(page)
    pane = page.locator("#dsi-pane-about")
    assert pane.locator(".dsi-title").inner_text() == "Liver atlas"
    assert "liver" in page.inner_text("#dataset-info-name")
    licence = pane.locator(".dsi-license a")
    assert licence.inner_text() == "CC-BY-4.0" and licence.get_attribute("href") == "https://spdx.org/licenses/CC-BY-4.0.html"
    assert licence.get_attribute("target") == "_blank" and "noopener" in licence.get_attribute("rel")
    assert pane.locator(".dsi-doi a").get_attribute("href") == "https://doi.org/10.1234/abcd.5"
    assert pane.locator(".dsi-source a").get_attribute("href") == "https://example.org/liver"
    text = pane.inner_text()
    for needle in ("Jane Doe, John Roe", "Liver Consortium, 2026", "A liver atlas. Nature 2026.", "jane@example.org"):
        assert needle in text, needle
    assert pane.locator("a[href^='mailto:jane@example.org']").count() == 1
    page.click("#dsi-pane-about .dsi-copy")
    page.wait_for_function("() => window.__copied")
    copied = page.evaluate("() => window.__copied")
    assert copied == "Doe J, Roe J. A liver atlas. Nature 2026. https://doi.org/10.1234/abcd.5"
    assert page.inner_text("#dsi-pane-about .dsi-copy") == "Copied"
    _shot(page, "dialog-about-1440-light.png")
    page.keyboard.press("Escape")
    page.locator("#dataset-info-modal").wait_for(state="hidden")
    page.wait_for_function("() => document.activeElement && document.activeElement.id === 'dataset-info'")
    assert not s.errors, s.errors


def test_a_dataset_without_attribution_says_so(opened):
    go, _data = opened
    s = go("plain.zarr")
    _open_dialog(s.page)
    assert "records no attribution" in s.page.inner_text("#dsi-pane-about")
    _tab(s.page, "readme")
    s.page.wait_for_function("() => /no README/.test(document.querySelector('#dsi-pane-readme').innerText)")
    assert not s.errors, s.errors


# ---- README, lazily ----------------------------------------------------------------------

def test_each_part_is_requested_only_when_shown(opened):
    go, _data = opened
    s = go("liver.zarr")
    page = s.page
    page.wait_for_timeout(500)
    assert _parts(s.requests) == [], "nothing is read before the button is pressed"
    _open_dialog(page)
    assert _parts(s.requests) == ["about"]
    _tab(page, "readme")
    page.wait_for_function("() => document.querySelector('#dsi-pane-readme .dsi-readme')")
    assert _parts(s.requests) == ["about", "readme"]
    _tab(page, "structure")
    page.wait_for_function("() => document.querySelector('#dsi-pane-structure .dsi-summary')")
    assert _parts(s.requests) == ["about", "readme", "structure"]
    _tab(page, "about")
    _tab(page, "readme")
    assert _parts(s.requests) == ["about", "readme", "structure"], "a part already read is not asked for again"
    assert not s.errors, s.errors


def test_the_readme_is_rendered_markdown(opened):
    go, _data = opened
    s = go("liver.zarr")
    page = s.page
    _open_dialog(page)
    _tab(page, "readme")
    page.wait_for_function("() => document.querySelector('#dsi-pane-readme .dsi-readme')")
    box = page.locator("#dsi-pane-readme .dsi-readme")
    assert box.locator("h4").inner_text() == "Liver atlas"
    assert box.locator("strong").inner_text() == "adult liver"
    assert box.locator("li").count() == 2 and box.locator("code").inner_text() == "adata.obs"
    link = box.locator("a")
    assert link.get_attribute("href") == "https://example.org/paper" and link.get_attribute("target") == "_blank"
    _shot(page, "dialog-readme-1440-light.png")


def test_a_long_readme_is_cut_and_says_so(opened):
    go, _data = opened
    s = go("big.zarr")
    _open_dialog(s.page)
    _tab(s.page, "readme")
    s.page.wait_for_function("() => document.querySelector('#dsi-pane-readme .dsi-truncated')")
    assert "first 256 KB of" in s.page.inner_text("#dsi-pane-readme .dsi-truncated")


def test_a_readme_that_is_not_text_is_explained(opened):
    go, _data = opened
    s = go("odd.zarr")
    _open_dialog(s.page)
    _tab(s.page, "readme")
    s.page.wait_for_function("() => /not a single text string/.test(document.querySelector('#dsi-pane-readme').innerText)")


# ---- loading and error ---------------------------------------------------------------------

def test_a_slow_part_shows_a_loading_state_and_a_failed_one_an_error_that_can_be_retried(opened):
    go, _data = opened
    s = go("liver.zarr")
    page = s.page
    held = []
    page.route(INFO_URL, lambda route: held.append(route) if "parts=structure" in route.request.url else route.continue_())
    _open_dialog(page)
    _tab(page, "structure")
    loading = page.locator("#dsi-pane-structure .dsi-loading")
    loading.wait_for(state="visible")
    assert loading.get_attribute("role") == "status" and "Reading the structure" in loading.inner_text()
    assert page.get_attribute("#dsi-pane-structure .dsi-body", "aria-busy") == "true"
    _shot(page, "dialog-loading-1440-light.png")
    held[0].fulfill(status=500, content_type="application/json", body='{"error": "The store went away"}')
    err = page.locator("#dsi-pane-structure .dsi-error")
    err.wait_for(state="visible")
    assert err.get_attribute("role") == "alert" and "The store went away" in err.inner_text()
    _shot(page, "dialog-error-1440-light.png")
    page.unroute(INFO_URL)
    page.click("#dsi-pane-structure .dsi-retry")
    page.wait_for_function("() => document.querySelector('#dsi-pane-structure .dsi-summary')")
    assert page.get_attribute("#dsi-pane-structure .dsi-body", "aria-busy") is None


# ---- Structure -------------------------------------------------------------------------------

def test_structure_lists_the_dataset(opened):
    go, _data = opened
    s = go("liver.zarr")
    page = s.page
    _open_dialog(page)
    _tab(page, "structure")
    page.wait_for_function("() => document.querySelector('#dsi-pane-structure .dsi-summary')")
    pane = page.locator("#dsi-pane-structure")
    assert "200 observations (cells) × 20 variables (genes)" in pane.locator(".dsi-summary").inner_text()
    obs = pane.locator("details[data-section=obs]")
    assert "cell_type" in obs.inner_text() and "categorical" in obs.inner_text()
    assert "total_counts" in obs.inner_text() and "float" in obs.inner_text()
    obsm = pane.locator("details[data-section=obsm]").inner_text()
    assert "X_umap" in obsm and "200 × 2" in obsm
    uns = pane.locator("details[data-section=uns]").inner_text()
    assert "annzarro" in uns and "README" in uns
    _shot(page, "dialog-structure-1440-light.png")
    assert not s.errors, s.errors


# ---- hostile text ------------------------------------------------------------------------------

def test_a_hostile_readme_and_hostile_fields_execute_nothing(opened):
    go, _data = opened
    s = go("hostile.zarr")
    page = s.page
    _open_dialog(page)
    about = page.locator("#dsi-pane-about")
    # the fields are text: the markup is shown, not made
    assert about.locator(".dsi-title").inner_text() == HOSTILE_FIELDS["title"]
    assert about.inner_text().count("<script>window.pwned='desc'</script>") == 1
    assert about.locator("img, script, svg, b, i, iframe").count() == 0
    hrefs = about.locator("a").evaluate_all("els => els.map(a => a.getAttribute('href'))")
    assert all(h is None or h.startswith(("http://", "https://", "mailto:")) for h in hrefs), hrefs
    assert about.locator("a[href^='javascript' i]").count() == 0
    _tab(page, "readme")
    page.wait_for_function("() => document.querySelector('#dsi-pane-readme .dsi-readme')")
    box = page.locator("#dsi-pane-readme .dsi-readme")
    # no element of the README is anything the renderer does not make
    assert box.evaluate("el => [...el.querySelectorAll('*')].map(e => e.tagName.toLowerCase()).filter(t => !['h4','h5','h6','p','strong','em','code','a','ul','ol','li','br'].includes(t))") == []
    attrs = box.evaluate("el => [...el.querySelectorAll('*')].flatMap(e => [...e.attributes].map(a => a.name))")
    assert set(attrs) <= {"href", "rel", "target"}, attrs
    assert box.locator("a[href^='javascript' i], a[href^='data' i]").count() == 0
    hrefs = box.locator("a").evaluate_all("els => els.map(a => a.getAttribute('href'))")
    assert hrefs == ["https://example.org/ok"], hrefs
    text = box.inner_text()
    assert "<script>window.pwned = 'h1'</script>" in text, "raw HTML is shown as text"
    assert "&lt;script&gt;window.pwned='entity'&lt;/script&gt;" in text, "an entity is shown as typed, not decoded into markup"
    assert "&#60;img src=x onerror=window.pwned='num'&#62;" in text
    assert "javascript:window.pwned='link'" in text, "an unsafe link is shown as text"
    _shot(page, "dialog-hostile-1440-light.png")
    # the structure's names and the uns tree are text too
    _tab(page, "structure")
    page.wait_for_function("() => document.querySelector('#dsi-pane-structure .dsi-summary')")
    page.wait_for_timeout(200)
    assert page.evaluate(PWN), f"something executed: {page.evaluate('() => window.pwned')}"
    assert not s.errors, s.errors


def test_a_hostile_readme_in_the_browser_pane_executes_nothing(opened):
    go, data = opened
    s = go("liver.zarr")
    page = s.page
    open_browser(page, query="hostile")
    browser_row(page, "hostile.zarr").first.locator("td").first.click()
    page.wait_for_function("() => document.querySelector('#dsb-details .dsb-about details[data-part=readme]')", timeout=20_000)
    page.click("#dsb-details details[data-part=readme] summary")
    page.wait_for_function("() => document.querySelector('#dsb-details .dsi-readme')")
    pane = page.locator("#dsb-details")
    assert pane.locator("script, img, iframe, b, svg").count() == 0
    assert pane.locator("a[href^='javascript' i]").count() == 0
    assert page.evaluate(PWN)
    assert not s.errors, s.errors


# ---- the browser's details pane -----------------------------------------------------------------

def test_the_details_pane_shows_the_attribution_and_reads_the_rest_when_asked(opened):
    go, _data = opened
    s = go("plain.zarr")
    page = s.page
    open_browser(page, query="liver")
    browser_row(page, "liver.zarr").first.locator("td").first.click()
    info = page.locator("#dsb-details .dsb-about")
    page.wait_for_function("() => document.querySelector('#dsb-details .dsb-about')?.dataset.state === 'ready'", timeout=20_000)
    assert "CC-BY-4.0" in info.inner_text() and "Jane Doe, John Roe" in info.inner_text()
    assert info.locator(".dsi-doi a").get_attribute("href") == "https://doi.org/10.1234/abcd.5"
    assert _parts(s.requests) == ["about"], "the README and the structure wait to be opened"
    info.locator("details[data-part=readme] summary").click()
    page.wait_for_function("() => document.querySelector('#dsb-details .dsi-readme h5')")
    assert _parts(s.requests) == ["about", "readme"]
    info.locator("details[data-part=structure] summary").click()
    page.wait_for_function("() => document.querySelector('#dsb-details .dsi-summary')")
    _shot(page, "browser-pane-1440-light.png")
    close_browser(page)
    assert not s.errors, s.errors


def test_a_dataset_that_says_nothing_adds_nothing_to_the_pane(opened):
    go, _data = opened
    s = go("liver.zarr")
    page = s.page
    open_browser(page, query="plain")
    browser_row(page, "plain.zarr").first.locator("td").first.click()
    page.wait_for_function("() => document.querySelector('#dsb-details .dsb-about')?.dataset.state === 'empty'", timeout=20_000)
    assert page.locator("#dsb-details .dsb-about").inner_text().strip() == ""


# ---- narrow screens and themes ------------------------------------------------------------------

@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_the_dialog_fits_a_phone_in_both_themes(opened, scheme):
    go, _data = opened
    s = go("liver.zarr", width=390, height=800, scheme=scheme)
    page = s.page
    _open_dialog(page)
    _shot(page, f"dialog-about-390-{scheme}.png")
    for part in ("readme", "structure"):
        _tab(page, part)
        page.wait_for_function(f"() => !document.querySelector('#dsi-pane-{part} .dsi-loading')")
        overflow = page.evaluate("() => { const b = document.querySelector('#dataset-info-modal .modal-body'); return b.scrollWidth - b.clientWidth; }")
        assert overflow <= 1, (part, overflow)
        _shot(page, f"dialog-{part}-390-{scheme}.png")
    assert not s.errors, s.errors


def test_the_dialog_in_the_dark_theme_at_desktop_width(opened):
    go, _data = opened
    s = go("liver.zarr", scheme="dark", width=1440, height=900)
    _open_dialog(s.page)
    _shot(s.page, "dialog-about-1440-dark.png")
    _tab(s.page, "structure")
    s.page.wait_for_function("() => document.querySelector('#dsi-pane-structure .dsi-summary')")
    _shot(s.page, "dialog-structure-1440-dark.png")


@pytest.mark.parametrize("width,scheme", [(1440, "dark"), (390, "light"), (390, "dark")])
def test_the_details_pane_in_the_dark_theme_and_as_a_phone_sheet(opened, width, scheme):
    go, _data = opened
    s = go("plain.zarr", width=width, height=900 if width > 400 else 800, scheme=scheme)
    page = s.page
    open_browser(page, query="liver")
    row = browser_row(page, "liver.zarr").first
    if width > 400:
        row.locator("td").first.click()
    else:
        row.locator(".dsb-info").click()          # below 1100 px the details are a sheet this button opens
    page.wait_for_function("() => document.querySelector('#dsb-details .dsb-about')?.dataset.state === 'ready'", timeout=20_000)
    page.click("#dsb-details details[data-part=readme] summary")
    page.wait_for_function("() => document.querySelector('#dsb-details .dsi-readme')")
    overflow = page.evaluate("() => { const d = document.querySelector('#dsb-details'); return d.scrollWidth - d.clientWidth; }")
    assert overflow <= 1, overflow
    _shot(page, f"browser-pane-{width}-{scheme}.png")
    assert not s.errors, s.errors


# ---- Structure: every element, and a hostile name in each place ------------------------------------------

def test_structure_shows_each_element_and_the_hostile_names_stay_text(opened):
    go, _data = opened
    s = go("rich.zarr")
    page = s.page
    _open_dialog(page)
    _tab(page, "structure")
    page.wait_for_function("() => document.querySelector('#dsi-pane-structure .dsi-summary')")
    pane = page.locator("#dsi-pane-structure")
    # nothing the dataset wrote became an element
    assert pane.locator("img, b, i, script, svg, iframe").count() == 0
    assert "MARKER" in pane.inner_text() and MARKER in pane.inner_text()
    assert pane.locator("bdi").count() > 5, "names are isolated for bidirectional text"
    # colours: a plain one is a bordered swatch with its text as the name, a hostile one is "?" and sets no style
    good = pane.locator(".dsi-swatch[aria-label='#ff0000']").first
    assert good.evaluate("e => getComputedStyle(e).backgroundColor") == "rgb(255, 0, 0)"
    bad = pane.locator(".dsi-swatch-bad").first
    assert bad.inner_text() == "?" and "url(x)" in bad.get_attribute("aria-label")
    assert bad.get_attribute("style") is None
    assert page.evaluate("() => [...document.querySelectorAll('#dsi-pane-structure [style]')].every(e => !/url|var\\(/.test(e.getAttribute('style')))")
    # colour count against categories, ordered and nullable
    obs = pane.locator("details[data-section=obs]").inner_text()
    assert "Mismatch: 2 colours for 3 categories" in obs and "5 colours" in obs
    assert "ordered" in obs and "nullable" in obs and "Index: _index, string" in obs
    # sparse, dataframe and awkward entries
    obsm = pane.locator("details[data-section=obsm]").inner_text()
    assert "4 stored values (25% dense)" in obsm and "2 columns: u, v" in obsm and "awkward-array" in obsm and "length 200" in obsm
    # an encoded uns member is one line, never a group with its parts
    uns = pane.locator("details[data-section=uns]").inner_text()
    assert "dataframe" in uns and "csr_matrix" in uns and "categorical, 2 categories" in uns
    for part in ("codes", "indptr", "indices"):
        assert part not in uns, part
    assert "= 7" in uns and pane.locator("details[data-section=uns] .dsi-value").count() >= 2
    # raw and unknown groups
    page.click("details[data-section=raw] summary")
    assert "not shown in plots" in pane.locator("details[data-section=raw]").inner_text()
    assert "obst" in pane.locator("details[data-section=other]").inner_text()
    assert "Limits:" in pane.locator(".dsi-caps").inner_text()
    _shot(page, "dialog-structure-rich-1440-light.png")
    assert page.evaluate(PWN)
    assert not s.errors, s.errors


# ---- the richer forms and a newer schema -------------------------------------------------------------

def test_richer_forms_are_shown_and_stay_text(opened):
    go, _data = opened
    s = go("richattr.zarr")
    _open_dialog(s.page)
    pane = s.page.locator("#dsi-pane-about")
    assert pane.locator(".dsi-license a").get_attribute("href") == "https://example.org/terms"
    assert pane.locator("a[href='https://orcid.org/0000-0002-1825-0097']").count() == 1
    contacts = pane.locator(".dsi-contacts").inner_text()
    assert "Jane (curator)" in contacts and "jane@example.org" in contacts and "https://example.org" in contacts
    assert pane.locator("a[href='mailto:jane@example.org']").count() == 1
    funding = pane.locator(".dsi-funding")
    assert "NIH, R35GM147125" in funding.inner_text() and funding.locator("a").get_attribute("href") == "https://reporter.nih.gov/x"
    assert "software: <b>x</b>" in pane.locator(".dsi-provenance").inner_text() and pane.locator("b").count() == 0
    _shot(s.page, "dialog-about-rich-1440-light.png")
    assert not s.errors, s.errors


def test_a_dataset_written_for_a_newer_schema_says_so_and_shows_what_it_can(opened):
    go, _data = opened
    s = go("newer.zarr")
    _open_dialog(s.page)
    pane = s.page.locator("#dsi-pane-about")
    assert "newer AnnZarro" in pane.locator(".dsi-schema-note").inner_text() and "2.0" in pane.inner_text()
    assert pane.locator(".dsi-title").inner_text() == "Written for a newer AnnZarro"
    _shot(s.page, "dialog-about-newer-schema-1440-light.png")
    assert not s.errors, s.errors


# ---- Structure: search ---------------------------------------------------------------------------------------

def _structure(opened, name, **kwargs):
    go, _data = opened
    s = go(name, **kwargs)
    _open_dialog(s.page)
    _tab(s.page, "structure")
    s.page.wait_for_function("() => document.querySelector('#dsi-pane-structure .dsi-search-input')")
    return s


def _search(page, text):
    page.fill("#dsi-pane-structure .dsi-search-input", text)
    page.wait_for_timeout(300)               # the filter waits for the typing to pause


def _visible_rows(page, section):
    return page.evaluate(
        "(k) => [...document.querySelectorAll(`#dsi-pane-structure details[data-section=${k}] tbody tr:not([hidden]):not(.dsi-extra)`)]"
        ".map(r => r.querySelector('th').innerText)", section)


def test_search_finds_a_column_a_category_label_and_a_nested_uns_key(opened):
    s = _structure(opened, "liver.zarr")
    page = s.page
    pane = page.locator("#dsi-pane-structure")
    status = pane.locator(".dsi-search-status")
    assert status.get_attribute("aria-live") == "polite"
    assert pane.locator("label.visually-hidden").inner_text() == "Search the structure"
    # a column name
    _search(page, "total_")
    assert _visible_rows(page, "obs") == ["total_counts"]
    assert pane.locator("details[data-section=obs] mark").first.inner_text() == "total_"
    assert status.inner_text() == "1 match"
    assert pane.locator("details[data-section=uns]").is_hidden(), "sections without a match are hidden"
    # a category label, found in a column whose name does not match
    _search(page, "kupffer")
    assert _visible_rows(page, "obs") == ["cell_type"]
    assert pane.locator("details[data-section=obs] .dsi-label mark").inner_text() == "Kupffer"
    # a nested uns key keeps the path to it and hides its siblings
    _search(page, "license")
    uns = pane.locator("details[data-section=uns]")
    assert uns.evaluate("e => e.open")
    names = uns.evaluate("e => [...e.querySelectorAll('li:not([hidden]) > .dsi-name')].map(n => n.innerText)")
    assert names[0] == "annzarro" and "license" in names and "title" not in names, names
    assert uns.locator("mark").first.inner_text() == "license"
    assert "match" in status.inner_text()
    _shot(page, "structure-search-1440-light.png")
    assert not s.errors, s.errors


def test_search_opens_collapsed_sections_counts_per_section_and_says_no_matches(opened):
    s = _structure(opened, "rich.zarr")
    page = s.page
    pane = page.locator("#dsi-pane-structure")
    assert not pane.locator("details[data-section=raw]").evaluate("e => e.open")
    _search(page, "var column")
    assert pane.locator("details[data-section=raw]").evaluate("e => e.open"), "a section that holds a match opens"
    assert pane.locator("details[data-section=raw] .dsi-hits").inner_text().strip(" ·") == "1 match"
    _search(page, "")
    assert not pane.locator("details[data-section=raw]").evaluate("e => e.open"), "and closes again when the search is cleared"
    _search(page, "x")
    total = pane.locator(".dsi-search-status").inner_text()
    assert total.endswith("matches")
    for section in pane.locator("details.dsi-section:not([hidden])").all():
        assert section.locator("summary .dsi-hits").inner_text().strip(" ·").endswith(("match", "matches"))
        assert section.evaluate("e => e.open")
    _search(page, "zzzzqqq")
    assert pane.locator(".dsi-search-status").inner_text() == "No matches"
    assert pane.locator("details.dsi-section:not([hidden])").count() == 0
    assert not s.errors, s.errors


def test_search_regex_and_case_switches_persist(opened):
    s = _structure(opened, "liver.zarr")
    page = s.page
    pane = page.locator("#dsi-pane-structure")
    regex = pane.locator("[data-toggle=regex]")
    assert regex.get_attribute("aria-pressed") == "false"
    _search(page, "^cell_.*e$")
    assert pane.locator(".dsi-search-status").inner_text() == "No matches", "a regex is literal while the switch is off"
    regex.click()
    assert regex.get_attribute("aria-pressed") == "true"
    assert _visible_rows(page, "obs") == ["cell_type"]
    case = pane.locator("[data-toggle=case]")
    _search(page, "^CELL_")
    assert _visible_rows(page, "obs") == ["cell_type"]
    case.click()
    assert pane.locator(".dsi-search-status").inner_text() == "No matches"
    # the switches are remembered by this browser
    page.reload()
    page.wait_for_function("() => !!document.getElementById('dataset-info')")
    assert page.evaluate("() => JSON.parse(localStorage.getItem('annzarro.structure-search'))") == {"regex": True, "matchCase": True}
    assert not s.errors, s.errors


def test_search_with_an_invalid_regex_shows_the_error_and_keeps_the_last_result(opened):
    s = _structure(opened, "liver.zarr")
    page = s.page
    pane = page.locator("#dsi-pane-structure")
    pane.locator("[data-toggle=regex]").click()
    _search(page, "^cell_")
    assert _visible_rows(page, "obs") == ["cell_type"]
    _search(page, "^cell_(")
    error = pane.locator(".dsi-search-error")
    assert error.is_visible() and error.inner_text().startswith("Invalid pattern")
    assert pane.locator(".dsi-search-input").get_attribute("aria-invalid") == "true"
    assert _visible_rows(page, "obs") == ["cell_type"], "the last valid result stays"
    _search(page, "(a+)+$")
    assert "too slow" in error.inner_text()
    _search(page, "^cell_")
    assert error.is_hidden()
    assert not s.errors, s.errors


def test_search_escape_clears_and_the_keys_focus_the_box(opened):
    s = _structure(opened, "liver.zarr")
    page = s.page
    pane = page.locator("#dsi-pane-structure")
    before = pane.locator("details.dsi-section:not([hidden])").count()
    obs_open = pane.locator("details[data-section=obs]").evaluate("e => e.open")
    box = pane.locator(".dsi-search-input")
    _search(page, "kupffer")
    assert pane.locator("details.dsi-section:not([hidden])").count() < before
    box.press("Escape")
    assert box.input_value() == ""
    assert page.locator("#dataset-info-modal").is_visible(), "the first Escape clears, it does not close"
    assert pane.locator("details.dsi-section:not([hidden])").count() == before
    assert pane.locator("mark").count() == 0
    assert pane.locator(".dsi-hits").count() == 0
    assert pane.locator("details[data-section=obs]").evaluate("e => e.open") == obs_open
    assert pane.locator(".dsi-search-status").inner_text() == ""
    page.locator("#dsi-pane-structure .dsi-summary").click()
    page.keyboard.press("/")
    assert page.evaluate("() => document.activeElement.classList.contains('dsi-search-input')")
    page.locator("#dsi-pane-structure .dsi-summary").click()
    page.keyboard.press("Control+f")
    assert page.evaluate("() => document.activeElement.classList.contains('dsi-search-input')")
    box.press("Escape")
    page.keyboard.press("Escape")
    page.locator("#dataset-info-modal").wait_for(state="hidden")
    assert not s.errors, s.errors


def test_search_marks_a_hostile_name_as_text(opened):
    s = _structure(opened, "rich.zarr")
    page = s.page
    pane = page.locator("#dsi-pane-structure")
    _search(page, "onerror=alert")
    assert pane.locator("img, b, i, script, svg, iframe").count() == 0
    marks = pane.locator("mark")
    assert marks.count() >= 2
    assert all(t == "onerror=alert" for t in marks.all_inner_texts())
    assert MARKER in pane.locator("details[data-section=obs]").inner_text()
    assert page.evaluate("() => window.pwned === undefined && !document.querySelector('#dsi-pane-structure img')")
    assert not s.errors, s.errors


@pytest.mark.parametrize("width,scheme", [(1440, "dark"), (390, "light"), (390, "dark")])
def test_search_fits_a_phone_and_both_themes(opened, width, scheme):
    s = _structure(opened, "liver.zarr", width=width, height=900 if width > 400 else 800, scheme=scheme)
    page = s.page
    _search(page, "e")
    overflow = page.evaluate("() => { const b = document.querySelector('#dataset-info-modal .modal-body'); return b.scrollWidth - b.clientWidth; }")
    assert overflow <= 1, overflow
    box = page.locator("#dsi-pane-structure .dsi-search").bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= width
    _shot(page, f"structure-search-{width}-{scheme}.png")
    assert not s.errors, s.errors
