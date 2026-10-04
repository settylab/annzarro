"""The tutorials' "Start here" links and panel set files, and a check that every one opens.

Writes
  docs/_static/panelsets/protocol/*.json     the paper's five protocol views (A-E) as panel set
                                             files, from annzarro-paper/data_prep/demo_panelsets
  docs/_static/panelsets/*/<name>.url.txt    one link per panel set file: the default local server
                                             (127.0.0.1:8000) and the store's file name, which the
                                             server finds in its data directory

Run:
  .venv-docs/bin/python docs/_tools/start_links.py protocol   # import A-E from the paper repository
  .venv-docs/bin/python docs/_tools/start_links.py write      # every .url.txt from its .json
  .venv-docs/bin/python docs/_tools/start_links.py check      # open each link headless

`check` serves bm_aging.zarr and bm_aging_showcase.zarr from ANNZARRO_DOCS_DATA (default
~/gits/annzarro-paper/data) through a temporary data directory of symlinks, opens every link with
its host:port swapped for the test server, and fails on a page error or a panel that does not
draw. It also reports panel settings the app dropped while loading (renamed or retired keys).
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import DATA_DIR, START_BASE, panelset_file, start_link  # noqa: E402

REPO = HERE.parent.parent
PANELSETS = REPO / "docs" / "_static" / "panelsets"
PAPER = Path(os.environ.get("ANNZARRO_PAPER", Path.home() / "gits" / "annzarro-paper"))
PROTOCOL = {  # paper view file -> docs name
    "A_kernel_walk": "protocol-A-kernel-walk",
    "B_volcano_spearman": "protocol-B-volcano-spearman",
    "C_foldchange_umap": "protocol-C-foldchange-umap",
    "D_locked_vs_focused_cell": "protocol-D-locked-vs-focused-cell",
    "E_table_filter": "protocol-E-table-filter",
}
PROTOCOL_DATASET = "bm_aging.zarr"


def panel_set_files() -> list[Path]:
    return sorted(p for p in PANELSETS.glob("*/*.json") if not p.name.startswith("links-"))


def import_protocol() -> None:
    out = PANELSETS / "protocol"
    out.mkdir(parents=True, exist_ok=True)
    for src, name in PROTOCOL.items():
        view = json.loads((PAPER / "data_prep" / "demo_panelsets" / f"{src}.view.json").read_text())
        (out / f"{name}.json").write_text(
            json.dumps(panelset_file(name, view, PROTOCOL_DATASET), indent=2) + "\n")
        print("wrote", out / f"{name}.json")


def write_links() -> None:
    for path in panel_set_files():
        ps = json.loads(path.read_text())
        path.with_suffix(".url.txt").write_text(start_link(ps["dataset"], ps["view"]) + "\n")
        print("wrote", path.with_suffix(".url.txt").relative_to(REPO))


# --------------------------------------------------------------------------- check
PANEL_STATE = """(ids) => ids.map(id => {
  const tile = document.querySelector(`.tile[data-tile-id="${id}"]`);
  if (!tile) return {id, state: 'missing'};
  const gd = tile.querySelector('.js-plotly-plot');
  if (gd) {
    const points = (gd.data || []).reduce((n, t) => n + ((t.x && t.x.length) || 0), 0);
    return {id, state: points > 0 ? 'drawn' : 'empty', points};
  }
  // DataTables with scrollY draws the header and the body as two tables
  const rows = [...tile.querySelectorAll('table tbody tr')].filter(r => !r.querySelector('.dt-empty')).length;
  return {id, state: rows > 0 ? 'drawn' : 'empty', rows};
})"""

DROPPED = """(input) => {
  const out = {};
  for (const p of (window.PanelManager ? PanelManager.getActivePanels() : [])) {
    const id = p.getId(), given = input[id];
    if (!given || !p.getConfig) continue;
    const kept = p.getConfig() || {};
    const lost = Object.keys(given).filter(k => !(k in kept));
    if (lost.length) out[id] = lost;
  }
  return out;
}"""


def _serve(data_dir: Path) -> tuple[subprocess.Popen, str]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = dict(os.environ, ANNZARRO_HOME=tempfile.mkdtemp(), ANNZARRO_HEADLESS="1",
               PYTHONPATH=str(REPO) + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data_dir), "--no-browser",
                             "--auth-disabled"], env=env, cwd=REPO,
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(240):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            return proc, root
        except OSError:
            time.sleep(0.25)
    proc.kill()
    raise SystemExit("server did not start")


def check() -> int:
    from playwright.sync_api import sync_playwright

    data_dir = Path(tempfile.mkdtemp(prefix="start-links-"))
    for store in ("bm_aging.zarr", "bm_aging_showcase.zarr"):
        os.symlink(DATA_DIR / store, data_dir / store)
    proc, root = _serve(data_dir)
    failures = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for path in panel_set_files():
                ps = json.loads(path.read_text())
                link = path.with_suffix(".url.txt").read_text().strip()
                assert link.startswith(START_BASE + "/?dataset_path="), link
                configs = ps["view"]["layout"]["panelConfigs"]
                page = browser.new_page(viewport={"width": 1600, "height": 1000})
                errors = []
                page.on("pageerror", lambda e, errors=errors: errors.append(str(e)))
                page.on("console", lambda m, errors=errors: errors.append(m.text)
                        if m.type == "error" else None)
                page.goto(root + link[len(START_BASE):])
                states = []
                for _ in range(120):
                    states = page.evaluate(PANEL_STATE, list(configs))
                    if all(s["state"] == "drawn" for s in states):
                        break
                    page.wait_for_timeout(500)
                page.wait_for_timeout(1000)
                errors += [f"{s['id']}: {s['state']}" for s in states if s["state"] != "drawn"]
                dropped = page.evaluate(DROPPED, configs)
                cells = page.inner_text("#cell-count")
                status = "ok" if not errors else "FAIL"
                failures += bool(errors)
                print(f"{status:4} {path.parent.name}/{path.stem}: {len(link)} chars, {cells}, "
                      + ", ".join(f"{s['id']} {s.get('points', s.get('rows'))}" for s in states)
                      + (f"; dropped settings {dropped}" if dropped else "")
                      + (f"; errors {errors}" if errors else ""))
                page.close()
            browser.close()
    finally:
        proc.terminate()
        proc.wait(10)
    return 1 if failures else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("what", choices=["protocol", "write", "check"])
    what = ap.parse_args().what
    if what == "protocol":
        import_protocol()
    elif what == "write":
        write_links()
    else:
        return check()
    return 0


if __name__ == "__main__":
    sys.exit(main())
