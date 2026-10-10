"""Screenshots for the Gene Set Analysis page of the user guide (docs/user-guide/gene-set.md).

The panel asks external services, so this script does too: STRING, g:Profiler and
MyGene.info answer for real (it clicks Send in the panel's consent bar, as a user would),
and the pictures show what they answered on the day. Nothing else is sent: the genes of
bm_aging_annzarro.zarr's volcano filter (mouse), the species, and the dataset's genes as the
enrichment background.

Writes
  docs/_static/screens/user-guide/geneset-*.png
  docs/_tools/views/userguide-geneset*.json     deep-link `view` objects used below

Run (it starts its own server on --port):
  python docs/_tools/shoot_geneset.py [--port 8818]

Data: bm_aging_annzarro.zarr in ANNZARRO_DOCS_DATA (default ~/gits/annzarro-paper/data), served from a
temporary data directory of symlinks.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import DATA_DIR, Session, split, tile  # noqa: E402

DOCS = HERE.parent
OUT = DOCS / "_static" / "screens" / "user-guide"
VIEWS = HERE / "views"

GS = '.tile[data-tile-id="gene-set-1"]'
TABLE = '.tile[data-tile-id="gene-table-1"]'
CONST = {"focusedGene": "H2-Q7", "taxonomyId": "10090"}
MAHAL = "kompot_de_Young_to_Old_mahalanobis"
LFC = "kompot_de_Young_to_Old_mean_lfc"


def volcano_filter() -> dict:
    """The table filter of tables-and-filters.md: mahalanobis > 5 AND mean lfc > 0.05 (109 genes)."""
    return {"criteria": [
        {"condition": ">", "data": MAHAL, "origData": f"var_{MAHAL}_main", "type": "num", "value": ["5"]},
        {"condition": ">", "data": LFC, "origData": f"var_{LFC}_main", "type": "num", "value": ["0.05"]}],
        "logic": "AND"}


def view(filtered: bool = True, **gs) -> dict:
    table = {"id": "gene-table-1", "title": "Up in old, Mahalanobis > 5" if filtered else "All genes",
             "columns": [{"type": "var", "key": "gene_ids", "column": ""},
                         {"type": "var", "key": MAHAL, "column": ""}, {"type": "var", "key": LFC, "column": ""}]}
    if filtered:
        table["searchBuilderConfig"] = volcano_filter()
    cfgs = {"gene-table-1": table,
            "gene-set-1": {"id": "gene-set-1", "title": "Gene Set Analysis", "tableFilter": "gene-table-1", **gs}}
    layout = split("horizontal", tile("gene-table-1"), tile("gene-set-1"), 38)
    layout["height"] = 1500
    for p in layout["panes"]:
        p["controlsVisible"] = True
    return {"v": 1, "constants": CONST,
            "layout": {"v": 1, "hierarchy": [layout], "controlState": {"gene-table-1": False, "gene-set-1": True},
                       "panelConfigs": cfgs}}


def state(page):
    return page.evaluate("() => window.PanelManager.getPanel('gene-set-1')._debugState()")


def until(page, js, timeout=240):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if page.evaluate(js):
            return True
        page.wait_for_timeout(250)
    raise SystemExit(f"timed out: {js[:120]}")


SETTLED = """() => { const s = window.PanelManager.getPanel('gene-set-1')._debugState();
  return Object.values(s.runs).filter(r => r.visible).every(r => r.status === 'ok' || r.status === 'error'); }"""


def panel_shot(page, path):
    """The panel from its title to its last section, without the empty tile below."""
    box = page.evaluate(f"""() => {{
        const t = document.querySelector('{GS}').getBoundingClientRect();
        const s = [...document.querySelectorAll('{GS} .gs-section')].pop().getBoundingClientRect();
        return {{x: t.x, y: t.y, width: t.width, height: s.bottom - t.y + 8}}; }}""")
    page.screenshot(path=str(path), clip=box)


def section(page, sid, name, out):
    page.locator(f'{GS} .gs-section[data-section="{sid}"]').screenshot(path=str(out / f"{name}.png"))


def save_view(name, v):
    VIEWS.mkdir(parents=True, exist_ok=True)
    (VIEWS / f"userguide-{name}.json").write_text(json.dumps(v, indent=1) + "\n")


def shoot(sh, out: Path, store: str) -> None:
    v = view()
    save_view("geneset", v)
    page = sh.open(v, dataset=store, viewport={"width": 1600, "height": 1000})
    until(page, "() => { const p = window.PanelManager.getPanel('gene-set-1'); return p && p._debugState().source.count > 0; }")
    s = state(page)
    sh.log.append(f"geneset: {s['source']['count']} genes, ids {s['idColumn']} as {s['idType']}")
    panel_shot(page, out / "geneset-not-run.png")
    page.click(f"{GS} .gs-run")
    page.wait_for_selector(f"{GS} .gs-consent:not([hidden])")
    page.locator(f"{GS} .gs-consent").screenshot(path=str(out / "geneset-consent.png"))
    page.click(f"{GS} .gs-consent button:has-text('Send')")
    until(page, SETTLED)
    page.wait_for_timeout(1500)
    sh.shot(page, "geneset-overview")
    for sid, name in [("string-enrichment", "geneset-string-enrichment"), ("gprofiler-gost", "geneset-gprofiler"),
                      ("string-network", "geneset-network"), ("mygene-card", "geneset-card"),
                      ("mygene-mapping", "geneset-lookup")]:
        section(page, sid, name, out)
    page.click(f'{GS} .gs-links__list button:has-text("Show list")')
    page.wait_for_selector(f"{GS} .gs-links__table tbody tr")
    section(page, "links", "geneset-links", out)
    # the table filtered differently: the results are stale, and say so
    page.fill(f'{TABLE} input[type="search"]', "H2-")
    until(page, f"() => /Selection changed/.test(document.querySelector('{GS} .gs-bar__text').textContent)", 60)
    page.wait_for_timeout(800)
    page.locator(f"{GS} .gs-bar").screenshot(path=str(out / "geneset-stale-bar.png"))
    page.context.close()

    # every gene of the dataset (16,285): over the services' limits, nothing is sent for them
    v = view(filtered=False)
    save_view("geneset-all", v)
    page = sh.open(v, dataset=store, viewport={"width": 1600, "height": 1000})
    until(page, "() => { const p = window.PanelManager.getPanel('gene-set-1'); return p && p._debugState().source.count > 16000; }")
    page.click(f"{GS} .gs-run")
    page.wait_for_selector(f"{GS} .gs-consent:not([hidden])", timeout=15000)
    page.click(f"{GS} .gs-consent button:has-text('Send')")
    until(page, SETTLED)
    page.wait_for_timeout(800)
    section(page, "string-enrichment", "geneset-limit", out)
    page.context.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8818)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    data_dir = Path(tempfile.mkdtemp(prefix="annzarro-geneset-"))
    (data_dir / "bm_aging_annzarro.zarr").symlink_to(DATA_DIR / "bm_aging_annzarro.zarr")
    with Session(a.port, OUT, data_dir=data_dir) as sh:
        # the store as served (from the temporary data directory), so the header shows its name
        shoot(sh, OUT, str(data_dir / "bm_aging_annzarro.zarr"))
