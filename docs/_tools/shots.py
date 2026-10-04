"""Shared screenshot helper for the AnnZarro documentation.

Every screenshot in docs/_static/screens/ is produced by a script under docs/_tools/ that
imports this module, so the whole set can be regenerated after a UI change:

    .venv-docs/bin/python docs/_tools/<script>.py

Usage:

    from shots import Session, tile, split
    with Session(port=8811, out="docs/_static/screens/user-guide") as s:
        page = s.open(view, dataset="bm_aging.zarr")   # view = deep-link `view` object
        s.shot(page, "focus-a", tiles={"cell-plot-1": "focus-a-umap"})

Adapted from figures/screenshots.py in settylab/annzarro-paper. The server is started from
the annzarro CLI next to this interpreter with --no-browser --auth-disabled on 127.0.0.1.
"""
from __future__ import annotations

import base64
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zlib
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

DATA_DIR = Path(os.environ.get("ANNZARRO_DOCS_DATA", Path.home() / "gits/annzarro-paper/data"))
VIEWPORT = {"width": 1600, "height": 1000}
DSF = 1.5

# Hides transient UI (toasts) and the hover label; injected before every capture.
CLEAN_CSS = """
#notification-container, .notification { display: none !important; }
.hoverlayer { display: none !important; }
"""
NO_MODEBAR_CSS = ".modebar-container, .modebar { display: none !important; }"



def encode_view(view: dict) -> str:
    """Uncompressed base64url(JSON) payload; every AnnZarro build decodes it."""
    raw = json.dumps(view, separators=(",", ":"), ensure_ascii=False).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def z1(view: dict) -> str:
    """The app's compressed fragment: z1.<base64url(deflate-raw(JSON))>."""
    raw = json.dumps(view, separators=(",", ":"), ensure_ascii=False).encode()
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return "z1." + base64.urlsafe_b64encode(c.compress(raw) + c.flush()).decode().rstrip("=")


# The server a reader starts with `annzarro start --data-dir <dir>` (default port).
START_BASE = "http://127.0.0.1:8000"


def start_link(dataset: str, view: dict) -> str:
    """The link the docs print: the default local server and the store's file name.

    A relative dataset_path names a store in the server's data directory
    (server/confinement.py resolve_relative_dataset_paths), so the link works as
    is when the reader's store sits there; only the host:port, or an absolute path
    for a store elsewhere, ever needs replacing.
    """
    return f"{START_BASE}/?dataset_path={urllib.parse.quote(Path(dataset).name, safe='')}#view={z1(view)}"


def panelset_file(name: str, view: dict, dataset: str) -> dict:
    """A panel set file as Save Panel Set writes it: the panel configs plus `view`, the
    object a share link encodes. Load Panel Set > Upload file restores dataset, focus and
    layout from it; the dataset is the store's file name, found in the data directory."""
    cfgs = view["layout"]["panelConfigs"]
    return {"name": name, "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "dataset": dataset, "datasetName": Path(dataset).stem, "constants": view["constants"],
            "panelConfigs": {k: {"id": k, "type": k.rsplit("-", 1)[0], "title": c.get("title", k),
                                 "config": c, "isSelectionTile": False} for k, c in cfgs.items()},
            "view": view}


def deep_link(base: str, view: dict | None, dataset: str | Path) -> str:
    target = str(dataset)
    if "://" not in target:  # local store: relative names live in DATA_DIR
        path = Path(target)
        target = str(path if path.is_absolute() else DATA_DIR / path)
    url = f"{base}/?dataset_path={urllib.parse.quote(target, safe='/:')}"
    return url + (f"#view={encode_view(view)}" if view else "")


def tile(tid: str) -> dict:
    return {"type": "tile", "id": tid, "controlsVisible": False}


def split(direction: str, a: dict, b: dict, pa: int = 50) -> dict:
    return {
        "type": "split",
        "direction": direction,
        "panes": [{"percentage": pa, "controlsVisible": False},
                  {"percentage": 100 - pa, "controlsVisible": False}],
        "children": [a, b],
    }


# --------------------------------------------------------------------------- server
def start_server(annzarro: str, port: int, log: Path, data_dir: Path = DATA_DIR,
                 config: Path | None = None) -> subprocess.Popen:
    cmd = [annzarro, "start", "--host", "127.0.0.1", "--port", str(port),
           "--data-dir", str(data_dir), "--no-browser", "--auth-disabled"]
    if config is not None:
        cmd += ["--config", str(config)]
    proc = subprocess.Popen(cmd, stdout=log.open("w"), stderr=subprocess.STDOUT,
                            start_new_session=True)
    for _ in range(120):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2)
            return proc
        except Exception:
            if proc.poll() is not None:
                sys.exit(f"server exited, see {log}")
            time.sleep(0.5)
    stop_server(proc)
    sys.exit("server did not come up")


def stop_server(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=15)
    except Exception:
        os.killpg(proc.pid, signal.SIGKILL)


# --------------------------------------------------------------------------- page
class Shooter:
    def __init__(self, browser, base: str, log: list[str], out: Path):
        self.browser, self.base, self.log, self.out = browser, base, log, Path(out)
        self.out.mkdir(parents=True, exist_ok=True)

    def open(self, view: dict | None, dataset="bm_aging.zarr", viewport=VIEWPORT,
             clipboard_denied=False) -> Page:
        ctx = self.browser.new_context(viewport=viewport, device_scale_factor=DSF,
                                       color_scheme="light")
        if clipboard_denied:
            # The plain-http cluster case: writeText rejects, the app shows the field.
            ctx.add_init_script("""
              Object.defineProperty(navigator, 'clipboard', {value: {
                writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError'))
              }});""")
        page = ctx.new_page()
        page._inflight = set()
        page.on("request", lambda r: page._inflight.add(r))
        page.on("requestfinished", lambda r: page._inflight.discard(r))
        page.on("requestfailed", lambda r: page._inflight.discard(r))
        page.on("console", lambda m: self.log.append(f"console.{m.type}: {m.text[:300]}")
                if m.type == "error" else None)
        page.on("pageerror", lambda e: self.log.append(f"pageerror: {e}"))
        # A view's controlState is applied on restore (tiles open with their controls
        # collapsed as saved), so the page is shot as the link opens it.
        page.goto(deep_link(self.base, view, dataset))
        self.ready(page)
        # The page grows with its content (body is min-height 100vh, not height), so a
        # tall tile such as a table with its SearchBuilder pushes the layout below the
        # fold. Grow the window to the document so the whole layout is in frame.
        for _ in range(4):
            h = page.evaluate("document.documentElement.scrollHeight")
            if h <= page.viewport_size["height"]:
                break
            page.set_viewport_size({"width": viewport["width"], "height": h})
            self.ready(page)
        return page

    def ready(self, page: Page, timeout=90, settle=1.5) -> None:
        js = """() => {
          const vis = e => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
          const busy = [...document.querySelectorAll(
              '.loading-screen, .loading-overlay, .spinner-border, .fa-spinner, .dataTables_processing, .dt-processing')]
              .filter(vis).length;
          const plots = [...document.querySelectorAll('.tile .js-plotly-plot')];
          const drawn = plots.every(g => g._fullData && g._fullData.length > 0 &&
                                         g._fullData[0].x && g._fullData[0].x.length > 0);
          const tiles = document.querySelectorAll('.tile').length;
          return {busy, drawn, plots: plots.length, tiles};
        }"""
        t0, stable_since = time.time(), None
        while time.time() - t0 < timeout:
            s = page.evaluate(js)
            ok = s["tiles"] > 0 and s["busy"] == 0 and s["drawn"] and not page._inflight
            if ok:
                stable_since = stable_since or time.time()
                if time.time() - stable_since >= settle:
                    page.evaluate("document.fonts.ready")
                    return
            else:
                stable_since = None
            time.sleep(0.25)
        urls = [r.url[:160] for r in page._inflight]
        self.log.append(f"WARNING: not ready after {timeout}s: {s}, inflight={urls}")

    def hide_controls(self, page: Page) -> None:
        """Collapse every tile's open controls with its own toggle button, as a user
        would (for panels created interactively, which open with controls shown)."""
        n = page.evaluate("""() => {
          let n = 0;
          for (const t of document.querySelectorAll('.tile')) {
            const c = t.querySelector('.tile-content .plot-controls, .tile-content .table-controls');
            if (c && c.style.display !== 'none') { t.querySelector('.tile-toggle-controls').click(); n++; }
          }
          return n; }""")
        if n:
            self.ready(page)
        return n

    def toasts(self, page: Page, tag: str) -> None:
        for t in page.evaluate("""() => [...document.querySelectorAll('.notification')]
                                   .map(n => n.className + ' | ' + n.textContent.trim())"""):
            self.log.append(f"{tag}: toast {t}")

    def shot(self, page: Page, name: str, tiles: dict[str, str] | None = None) -> None:
        self.toasts(page, name)
        page.mouse.move(2, VIEWPORT["height"] - 2)
        page.add_style_tag(content=CLEAN_CSS)
        time.sleep(0.3)
        page.screenshot(path=str(self.out / f"{name}.png"))
        if tiles:
            style = page.add_style_tag(content=NO_MODEBAR_CSS)
            for tid, tname in tiles.items():
                page.locator(f'.tile[data-tile-id="{tid}"] .tile-content').screenshot(
                    path=str(self.out / f"{tname}.png"))
            style.evaluate("e => e.remove()")
        self.log.append(f"wrote {name}.png" + (f" + {len(tiles)} tile(s)" if tiles else ""))


class Session:
    """Context manager: server + headless Chromium + Shooter. Prints the log on exit."""

    def __init__(self, port: int, out: str | Path, url: str | None = None,
                 data_dir: Path = DATA_DIR, config: Path | None = None):
        self.port, self.out, self.url, self.data_dir = port, Path(out), url, data_dir
        self.config = config
        self.log: list[str] = []

    def __enter__(self) -> "Shooter":
        self.proc = None
        base = self.url
        if base is None:
            exe = str(Path(sys.executable).with_name("annzarro"))
            logf = Path(tempfile.gettempdir()) / f".server-{self.port}.log"
            self.out.mkdir(parents=True, exist_ok=True)
            self.proc = start_server(exe, self.port, logf, self.data_dir, self.config)
            base = f"http://127.0.0.1:{self.port}"
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch()
        return Shooter(self.browser, base, self.log, self.out)

    def __exit__(self, *exc):
        self.browser.close()
        self.pw.stop()
        if self.proc is not None:
            stop_server(self.proc)
        print("\n".join(self.log))
