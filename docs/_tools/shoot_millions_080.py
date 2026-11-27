"""Screenshots for section 6 of docs/tutorials/millions.md: groups, counts and a dot plot over every cell of the Tahoe store.

The store is read-only here: it is linked into a scratch data folder, never written to, and the server's state folder is the
caller's ANNZARRO_HOME (point it at a scratch folder).

Run (needs the 95.6M-cell store of docs/paper/scale.md; heavy, so through run-test, one server at a time):

    ANNZARRO_TAHOE_STORE=/path/to/tahoe_panel_95.6M_plot.zarr \\
    ANNZARRO_HOME=/path/to/scratch/state \\
    .venv-docs/bin/python docs/_tools/shoot_millions_080.py [--port 8870] [--only count grouping progress asks size refused]

Writes docs/_static/screens/tutorials/millions-080-*.png and prints the sentences each step showed and the seconds it took,
which the tutorial quotes. The `refused` step runs on a second server whose refuse_s is lowered to 300 s, because no request
the store can answer is estimated over the default 600 s (its X holds values for 200 genes only): the page says so.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import Session  # noqa: E402
import shoot_userguide as ug  # noqa: E402

ug.OUT = HERE.parent / "_static" / "screens" / "tutorials"
OUT = ug.OUT
OBS = lambda k: {"type": "obs", "key": k}  # noqa: E731
CC, GR, CG = "cell-count-1", "cell-grouping-1", "cell-gene-1"
T = ug.T
FIVE = ["FN1", "VIM", "ACTB", "GAPDH", "B2M"]
LOWERED = "limits:\n  refuse_s: 300\n"


def panel_genes(store: Path) -> list[str]:
    """The 200 genes the store holds values for (X is a gene panel; the other columns are empty). Read-only."""
    import zarr
    return [str(g) for g in zarr.open_group(str(store), mode="r")["X"].attrs["gene_panel_symbols"]]


def view(tid, cfg, extra=None):
    cfgs = {tid: cfg}
    cfgs.update(extra or {})
    return {"v": 1, "constants": {"focusedGene": "FN1"},
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": tid, "controlsVisible": False}],
                       "controlState": {tid: False}, "panelConfigs": cfgs}}


def sig(i, genes, title=None):
    return {"id": f"gene-signature-{i}", "title": title or f"{len(genes)} genes", "genes": genes}


def cell_gene(genes, extra_sigs=None, sections=None):
    cfg = {"id": CG, "title": "Cell-Gene Plot 1", "version": 1, "mode": "dots", "cellAxis": OBS("cell_line_id"),
           "sections": sections or [{"source": "gene-signature-1", "rows": "genes"}],
           "color": {"stat": "mean", "layer": "X"}, "size": {"stat": "fraction_of_cells", "layer": "X"}}
    return view(CG, cfg, {"gene-signature-1": sig(1, genes), **(extra_sigs or {})})


def open_all_cells(sh, v, D):
    """Open a view and switch the subset off with the badge dialog, as section 5 does: every cell."""
    page = sh.open(v, dataset=D, viewport={"width": 1400, "height": 800})
    page.click("#subset-button")
    page.wait_for_selector("#subset-modal.show", timeout=30000)
    time.sleep(1)
    page.uncheck("#subset-enabled")
    time.sleep(2)
    page.click("#subset-apply")
    t0 = time.time()
    page.wait_for_function("document.getElementById('cell-count').textContent.trim() === '95,624,334'", timeout=120000)
    return page, t0


def strip(page, tid):
    return page.evaluate("(t) => { const s = document.querySelector(`.tile[data-tile-id=\"${t}\"] .plot-status`);"
                         " return s ? s.innerText.replace(/\\n+/g, ' | ') : ''; }", tid)


def notice(page):
    return page.eval_on_selector(f"{T(CG)} .score-notice", "e => e.innerText.replace(/\\n+/g, ' | ')")


def shoot_count(sh, D, panel):
    page, t0 = open_all_cells(sh, view(CC, {"id": CC, "title": "Cells of each cell line", "version": 1, "mode": "bar",
                                           "x": {"source": OBS("cell_line_id")}}), D)
    page.wait_for_function("(() => { const s = document.querySelector('.tile .plot-status');"
                           " return s && s.innerText.includes('95.6M cells'); })()", timeout=120000)
    sh.log.append(f"count: ready {time.time() - t0:.1f} s after the subset was switched off; strip = {strip(page, CC)}")
    time.sleep(1.5)
    ug.capture_union(sh, page, "millions-080-count", ["#cell-count", "#subset-button", T(CC)], pad=2, hide_modebar=True)
    page.context.close()


def shoot_grouping(sh, D, panel):
    page, t0 = open_all_cells(sh, view(GR, {"id": GR, "title": "Cell lines and plates", "version": 1,
                                           "partitionings": [{"source": OBS("cell_line_id")}, {"source": OBS("plate")}]}), D)
    page.wait_for_function("document.querySelector('.tile').innerText.includes('in a group')", timeout=180000)
    sh.log.append(f"grouping: ready {time.time() - t0:.1f} s after the subset was switched off")
    time.sleep(1.5)
    sh.log.append("grouping: summary = " + page.evaluate("document.querySelector('.tile').innerText.split('\\n')[0]"))
    ug.capture_union(sh, page, "millions-080-grouping", ["#cell-count", T(GR)], pad=2, hide_modebar=True)
    page.context.close()


def shoot_progress(sh, D, panel):
    """20 genes over every cell: the bar, its sentence and Cancel. Five genes are read in about two seconds, too fast for a bar."""
    page, t0 = open_all_cells(sh, cell_gene(panel[:20]), D)
    t1 = time.time()
    seen = ""
    while time.time() - t1 < 120:
        s = page.evaluate("(t) => { const n = document.querySelector(`.tile[data-tile-id=\"${t}\"] .score-notice`);"
                          " return n ? n.innerText.replace(/\\n+/g, ' | ') : ''; }", CG)
        if "of 20" in s and "left" in s:
            seen = s
            if "10 of 20" in s or "11 of 20" in s:
                break
        time.sleep(0.2)
    sh.log.append(f"progress: strip = {seen}")
    ug.capture_union(sh, page, "millions-080-progress", [f"{T(CG)} .score-notice .filter-notice__card"], pad=18, hide_modebar=True)
    page.wait_for_function("(() => { const s = document.querySelector('.tile .plot-status');"
                           " return s && s.innerText.includes('95.6M cells'); })()", timeout=180000)
    sh.log.append(f"progress: done {time.time() - t1:.1f} s after the first bar; strip = {strip(page, CG)}")
    page.context.close()


def shoot_asks(sh, D, panel):
    page, t0 = open_all_cells(sh, cell_gene(panel), D)
    page.wait_for_selector(f"{T(CG)} .score-notice", timeout=120000)
    time.sleep(1.5)
    sh.log.append("asks: " + notice(page))
    ug.capture_union(sh, page, "millions-080-asks-first", [f"{T(CG)} .score-notice .filter-notice__card"], pad=18, hide_modebar=True)
    page.context.close()


def shoot_size(sh, D, panel):
    """A matrix over its size limit: 40 sections of 200 genes and one of 100, over 50 cell lines (405,000 cells of the matrix)."""
    extra = {f"gene-signature-{i}": sig(i, panel if i < 41 else panel[:100], title=f"Panel block {i - 1}" if i < 41 else "Panel tail")
             for i in range(2, 42)}
    extra["gene-signature-1"] = sig(1, panel, title="Panel block 0")
    cfg = cell_gene(panel, sections=[{"source": f"gene-signature-{i}", "rows": "genes"} for i in range(1, 42)])
    cfg["layout"]["panelConfigs"].update(extra)
    page, t0 = open_all_cells(sh, cfg, D)
    page.wait_for_selector(f"{T(CG)} .score-notice", timeout=120000)
    time.sleep(1.5)
    sh.log.append("size: " + notice(page))
    ug.capture_union(sh, page, "millions-080-too-large", [f"{T(CG)} .score-notice .filter-notice__card"], pad=18, hide_modebar=True)
    page.context.close()


def shoot_refused(sh, D, panel):
    """The server runs with refuse_s = 300 s (see the module docstring), so the 200 genes, estimated at about 6 minutes, are refused."""
    page, t0 = open_all_cells(sh, cell_gene(panel), D)
    page.wait_for_selector(f"{T(CG)} .score-notice", timeout=120000)
    time.sleep(1.5)
    sh.log.append("refused: " + notice(page))
    ug.capture_union(sh, page, "millions-080-refused", [f"{T(CG)} .score-notice .filter-notice__card"], pad=18, hide_modebar=True)
    # Don't ask again starts the run the server allows (Try anyway, for this panel, always)
    page.get_by_label("Don't ask again for this panel").first.check()
    tag = page.locator(f"{T(CG)} .ps-tag[data-tag='unasked']").first
    tick = time.time()
    try:
        tag.wait_for(timeout=900000)      # the strip (and its tag) comes back when the read is done
        sh.log.append(f"refused: the run took {time.time() - tick:.0f} s after the tick (estimated at about 6 minutes)")
    except Exception:
        sh.log.append("refused: no tag; strip html = " + page.evaluate(
            "(t) => { const s = document.querySelector(`.tile[data-tile-id=\"${t}\"] .plot-status`); return s ? s.outerHTML.slice(0, 1500) : 'no strip'; }", CG))
        sh.log.append("refused: notice = " + page.evaluate("(t) => { const n = document.querySelector(`.tile[data-tile-id=\"${t}\"] .score-notice`); return n ? n.innerText : 'no notice'; }", CG))
        raise
    time.sleep(2.0)
    sh.log.append("refused: strip after the tick = " + strip(page, CG))
    tag.click()
    time.sleep(0.8)
    ug.capture_union(sh, page, "millions-080-runs-without-asking",
                     [f"{T(CG)} .plot-status .ps-tags", "[role=dialog]:visible, .ps-popover:visible, .popover:visible"], pad=14, hide_modebar=True)
    sh.log.append("refused: popover = " + page.evaluate(
        "[...document.querySelectorAll('[role=dialog], .ps-popover, .popover')].filter(e => e.offsetParent).map(e => e.innerText.replace(/\\n+/g,' | ')).join(' ## ')"))
    page.context.close()          # leaving the page cancels the read


STEPS = {"count": shoot_count, "grouping": shoot_grouping, "progress": shoot_progress, "asks": shoot_asks, "size": shoot_size}

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8870)
    ap.add_argument("--only", nargs="*", default=None)
    a = ap.parse_args()
    store = Path(os.environ.get("ANNZARRO_TAHOE_STORE", ""))
    if not store.is_dir():
        raise SystemExit("set ANNZARRO_TAHOE_STORE to the 95.6M-cell Tahoe store (docs/paper/scale.md)")
    panel = panel_genes(store)
    data = Path(tempfile.mkdtemp(prefix="annzarro-millions080-"))
    (data / store.name).symlink_to(store)
    D = str(data / store.name)
    OUT.mkdir(parents=True, exist_ok=True)
    wanted = a.only or list(STEPS) + ["refused"]
    normal = [n for n in wanted if n in STEPS]
    if normal:
        with Session(a.port, OUT, data_dir=data) as sh:
            for name in normal:
                STEPS[name](sh, D, panel)
    if "refused" in wanted:
        cfg = Path(tempfile.mkdtemp(prefix="annzarro-lowered-refuse-")) / "site.yaml"
        cfg.write_text(LOWERED)
        with Session(a.port, OUT, data_dir=data, config=cfg) as sh:
            shoot_refused(sh, D, panel)
