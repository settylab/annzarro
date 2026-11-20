"""Clustering (utils/hclust.js) runs in a real module Worker and keeps the page responsive.

1. the worker's answer for a small matrix is the one clusterRows gives on the main thread, and a second ask for the
   same input is answered from the memo;
2. a 2,000 x 200 block is clustered while the page's own timer keeps ticking (the work is off the main thread);
3. Ward with correlation distance is an error from the worker, not a hang.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import _serve  # noqa: E402


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{server}/")
            yield page
            assert not errors, errors
        finally:
            browser.close()


SMALL = """async () => {
  const { clusterRows, createHclustClient } = await import('/static/js/utils/hclust.js');
  const rows = 30, cols = 8;
  const values = Float64Array.from({ length: rows * cols }, (_, i) => Math.sin(i * 12.9898) * 43758.5453 % 1);
  const client = createHclustClient();
  const viaWorker = await client.cluster(values, rows, cols, { linkage: 'average' });
  const again = await client.cluster(values, rows, cols, { linkage: 'average' });
  const direct = clusterRows(values, rows, cols, { linkage: 'average' });
  client.terminate();
  return { same: JSON.stringify(Array.from(viaWorker.order)) === JSON.stringify(Array.from(direct.order)),
           memo: again === viaWorker, n: viaWorker.order.length };
}"""

BIG = """async () => {
  const { createHclustClient } = await import('/static/js/utils/hclust.js');
  const rows = 2000, cols = 200;
  let s = 1;
  const values = Float64Array.from({ length: rows * cols }, () => (s = (s * 16807) % 2147483647) / 2147483647);
  const client = createHclustClient();
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 10);
  const t0 = performance.now();
  const r = await client.cluster(values, rows, cols);
  const ms = performance.now() - t0;
  clearInterval(timer);
  client.terminate();
  return { n: r.order.length, merges: r.merges.length, ticks, ms };
}"""

WARD = """async () => {
  const { createHclustClient } = await import('/static/js/utils/hclust.js');
  const client = createHclustClient();
  try {
    await client.cluster(Float64Array.of(1, 2, 3, 4, 3, 1, 2, 5, 9, 1), 5, 2, { linkage: 'ward', distance: 'correlation' });
    return 'resolved';
  } catch (e) { return e.message; } finally { client.terminate(); }
}"""


def test_the_worker_gives_the_same_answer_and_the_memo_answers_twice(page):
    assert page.evaluate(SMALL) == {"same": True, "memo": True, "n": 30}


def test_a_large_block_is_clustered_off_the_main_thread(page):
    r = page.evaluate(BIG)
    assert r["n"] == 2000 and r["merges"] == 1999 * 4
    assert r["ticks"] >= r["ms"] / 10 * 0.25, f"the page's timer ticked {r['ticks']} times in {r['ms']:.0f} ms"


def test_ward_with_correlation_is_an_error_from_the_worker(page):
    assert "Ward needs Euclidean" in page.evaluate(WARD)
