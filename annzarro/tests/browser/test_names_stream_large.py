"""Loading every cell name of a store above the packed-names threshold.

A zarr store's /data/cells reply is written as it is read, so it has no
Content-Length. The client used to size its choice of the packed path by that
header alone, and read a chunked reply with response.text() into an array of
JS strings. Now the server's X-Annzarro-Names and
X-Annzarro-Names-Bytes-Estimate headers decide: 12 million cells of 22
characters are a 300 MB reply (the client packs above 256 MB), and what
arrives is a PackedNames that gives back every name.

The store is generated: the 200-cell fixture whose cell index is replaced by
12 million names (nothing else about the cells is read) and whose X says it
has that many rows. Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import numpy as np
import pytest
import zarr

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_focus_outside_subset as _focus  # noqa: E402
from annzarro.tests.browser.test_names_dataset_scope import _serve  # noqa: E402
from annzarro.tests.server import test_names_stream as names_store  # noqa: E402

N_CELLS = 12_000_000
CHUNK = 1 << 20


def _name(i):
    return f"AAACCCAAGTT-{i:09d}-1"


def _big_store(path):
    store = names_store.make_store(path, ["x"], chunk=CHUNK)
    group = zarr.open_group(store, mode="a")
    del group["obs"]["_index"]
    index = group["obs"].create_array("_index", shape=(N_CELLS,), chunks=(CHUNK,), dtype=str)
    for lo in range(0, N_CELLS, CHUNK):
        hi = min(lo + CHUNK, N_CELLS)
        index[lo:hi] = np.array([_name(i) for i in range(lo, hi)], dtype=object)
    group["X"].attrs["shape"] = [N_CELLS, 20]
    zarr.consolidate_metadata(store)
    return store


@pytest.fixture(scope="module")
def big_server(tmp_path_factory):
    original = _focus._make_store
    _focus._make_store = _big_store
    try:
        proc, root, store = _serve(tmp_path_factory)
    finally:
        _focus._make_store = original
    yield root, store
    proc.terminate()
    proc.wait(10)


LOAD = """async (store) => {
    const { DataManager } = await import('/static/js/data-manager.js');
    const { PackedNames } = await import('/static/js/utils/packed-names.js');
    const cells = await DataManager.loadCells(store);
    const at = [0, 1, 1048575, 1048576, 6000000, cells.length - 1];
    return { packed: cells instanceof PackedNames, isArray: Array.isArray(cells), length: cells.length,
             names: at.map(i => cells[i]) };
}"""


@pytest.mark.slow
def test_every_name_of_a_store_above_the_threshold_arrives_packed(big_server):
    root, store = big_server
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page()
            page.goto(root + "/")
            with page.expect_response(lambda r: "/data/cells" in r.url, timeout=300_000) as seen:
                got = page.evaluate(LOAD, store)
            headers = {k.lower(): v for k, v in seen.value.headers.items()}
        finally:
            browser.close()
    assert "content-length" not in headers, "the reply is a stream"
    assert headers["x-annzarro-names"] == str(N_CELLS)
    assert int(headers["x-annzarro-names-bytes-estimate"]) > 256 * 1024 * 1024
    assert got["packed"] and not got["isArray"]
    assert got["length"] == N_CELLS
    assert got["names"] == [_name(i) for i in (0, 1, 1048575, 1048576, 6000000, N_CELLS - 1)]
