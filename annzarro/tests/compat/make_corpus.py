"""Write the compatibility corpus: share links and panel sets made by a release.

Run it against a checkout of the release, never against the working tree:

    git worktree add /tmp/az-v0.4.0 v0.4.0
    (cd /tmp/az-v0.4.0 && python scripts/vendor_assets.py)
    python annzarro/tests/compat/make_corpus.py /tmp/az-v0.4.0 v0.4.0

It starts that checkout's server on a copy of the committed fixture store,
opens each view below in Chromium, and records what that release itself
writes: the link from its Share Link button and the panel set file from its
Save Panel Set (as the Export download gives it). Next to them it records
the state the release restored (tile tree, panel configs, focus), which
test_compat_corpus.py compares later releases against.

Later releases must open every entry without error and restore its layout
and panels. Same pixels across versions are not promised.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

import base64

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")

# The DOM tile tree, as test_nested_split_links.py reads it
TREE_JS = r"""
() => {
  const kids = (el, cls) => [...el.children].filter(c => cls.some(k => c.classList.contains(k)));
  const walk = (el) => {
    if (el.classList.contains('panel-wrapper')) {
      const c = kids(el, ['split-container', 'tile', 'tile-selector'])[0];
      return c ? {content: walk(c)} : null;
    }
    if (el.classList.contains('tile-selector')) return 'selector';
    if (el.classList.contains('tile')) return {id: el.dataset.tileId};
    if (el.classList.contains('split-container')) {
      const panes = kids(el, ['split-pane']);
      return {split: el.dataset.splitDirection,
              sizes: panes.map(p => Math.round(parseFloat(p.dataset.flexPercentage || '50'))),
              panes: panes.map(p => (p.children[0] ? walk(p.children[0]) : null))};
    }
    return null;
  };
  return [...document.querySelector('.tile-container').children].map(walk).filter(Boolean);
}
"""

STATE_JS = """() => ({
  focusedGene: sessionManager.captureView().constants.focusedGene || null,
  focusedCell: sessionManager.captureView().constants.focusedCell || null,
  panels: PanelManager.getActivePanels().map(p => ({id: p.getId(), type: p.getType()}))
            .sort((a, b) => a.id < b.id ? -1 : 1)
})"""


def tile(i):
    return {"type": "tile", "id": i}


def split(direction, a, b, pa=50):
    return {"type": "split", "direction": direction,
            "panes": [{"percentage": pa}, {"percentage": 100 - pa}], "children": [a, b]}


UMAP = {"x": {"type": "obsm", "key": "X_umap", "column": "0"},
        "y": {"type": "obsm", "key": "X_umap", "column": "1"}}

# What each entry asks the release to open; the release fills in the rest.
VIEWS = {
    "umap-by-cell-type": {
        "constants": {"focusedGene": "GENE003", "focusedCell": "cell_0007"},
        "layout": {"v": 1, "hierarchy": [tile("cell-plot-1")], "controlState": {},
                   "panelConfigs": {"cell-plot-1": {**UMAP, "color": {"type": "obs", "key": "cell_type", "column": ""},
                                                    "pointSize": 7, "autoPointSize": False}}},
    },
    "four-panels": {
        "constants": {"focusedGene": "GENE005"},
        "layout": {"v": 1, "hierarchy": [split("vertical",
                                               split("horizontal", tile("cell-plot-1"), tile("cell-table-1"), 60),
                                               split("horizontal", tile("gene-plot-1"), tile("gene-table-1")), 55)],
                   "controlState": {},
                   "panelConfigs": {"cell-plot-1": {**UMAP, "color": {"type": "X", "key": "GENE005", "column": ""}},
                                    "cell-table-1": {}, "gene-plot-1": {}, "gene-table-1": {}}},
    },
    "subset-by-leiden": {
        "subset": {"n": 120, "seed": 7},
        "layout": {"v": 1, "hierarchy": [tile("cell-plot-1")], "controlState": {},
                   "panelConfigs": {"cell-plot-1": {**UMAP, "color": {"type": "obs", "key": "leiden", "column": ""},
                                                    "exportWidth": 900, "exportHeight": 700, "scaleExport": True}}},
    },
}


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _payload(view):
    raw = json.dumps({"v": 1, **view}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def main(checkout, version, out_dir=None):
    from playwright.sync_api import sync_playwright

    out_dir = out_dir or os.path.join(HERE, version)
    os.makedirs(out_dir, exist_ok=True)
    work = tempfile.mkdtemp(prefix="az-corpus-")
    data_dir = os.path.join(work, "data")
    os.makedirs(data_dir)
    store = os.path.join(data_dir, "fixture_small.zarr")
    shutil.copytree(FIXTURE, store)
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=os.path.join(work, "home"), ANNZARRO_HEADLESS="1",
               PYTHONPATH=checkout)
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", data_dir, "--no-browser", "--auth-disabled"],
                            env=env, cwd=checkout, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(root + "/api/v1/config", timeout=1)
                break
            except OSError:
                time.sleep(0.25)
        else:
            raise SystemExit("server did not start")
        manifest = {"version": version, "made_with": f"git tag {version}",
                    "store": "fixture_small.zarr", "saved_path": store, "entries": {}}
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for name, view in VIEWS.items():
                ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
                page = ctx.new_page()
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={_payload(view)}")
                page.wait_for_function("() => window.PanelManager && PanelManager.getActivePanels().length > 0",
                                       timeout=30000)
                page.wait_for_timeout(3000)
                # the release's own Share Link
                page.click("#btn-share-link")
                page.wait_for_selector("#share-link-fallback:not([hidden])", timeout=10000)
                link = page.input_value("#share-link-field")
                # the release's own Save Panel Set, then its Export download
                page.click("#share-link-close")
                page.click("#btn-save-session")
                page.fill("#session-name", name)
                page.click("#btn-confirm-session")
                page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null")
                panel_set = None
                for _ in range(40):
                    try:
                        panel_set = json.loads(urllib.request.urlopen(
                            f"{root}/api/v1/sessions/export?name={urllib.parse.quote(name)}").read())
                        break
                    except urllib.error.HTTPError:
                        time.sleep(0.25)
                if panel_set is None:
                    raise SystemExit(f"{name}: the panel set was not saved")
                state = page.evaluate(STATE_JS)
                state["tree"] = page.evaluate(TREE_JS)
                if errors:
                    raise SystemExit(f"{name}: page errors on {version}: {errors}")
                with open(os.path.join(out_dir, f"{name}.panelset.json"), "w") as fh:
                    json.dump(panel_set, fh, indent=2, sort_keys=True)
                manifest["entries"][name] = {
                    "link": link.replace(root, "{root}"),
                    "panel_set": f"{name}.panelset.json",
                    "restored": state,
                }
                ctx.close()
            browser.close()
        with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
            json.dump(manifest, fh, indent=2, sort_keys=True)
        print(f"wrote {len(manifest['entries'])} entries to {out_dir}")
    finally:
        proc.terminate()
        proc.wait(10)
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    main(os.path.abspath(sys.argv[1]), sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
