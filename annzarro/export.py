"""``annzarro export``: a saved view's plots as image files, without a browser window.

    annzarro export view.json --store data/bm_aging.zarr --out fig.svg
    annzarro export 'https://host/?dataset_path=bm.zarr#view=z1....' --store bm.zarr --out fig.png
    annzarro export --from fig.png --store bm.zarr --out again.png

It starts a local AnnZarro server on the store, opens the view in headless
Chromium (Playwright's, as the browser tests use), waits until every plot is
drawn, and writes each plot exactly as its Export button would: the size and
scale from the panel's settings, the coverage notice when not every point is
shown, and the recipe (the view as a panel set, the store's fingerprint, the
AnnZarro version) in the file. ``--from`` reads that recipe back from a PNG or
SVG and makes the figure again.

The same store and the same AnnZarro version give the same figure: an SVG
identical byte for byte, a PNG identical pixel for pixel (WebGL is drawn by
SwiftShader, Chromium's software renderer, so the GPU does not matter).
Another version opens the view, but may draw it differently; the command
then names the version that made the figure.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zlib
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

RECIPE_KEY = "annzarro-recipe"

#: Chromium flags for a deterministic render: WebGL in SwiftShader (no GPU),
#: sRGB, no LCD text, no font hinting.
CHROMIUM_ARGS = [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--ignore-gpu-blocklist",
    "--force-color-profile=srgb",
    "--disable-lcd-text",
    "--font-render-hinting=none",
    "--force-device-scale-factor=1",
]
VIEWPORT = {"width": 1600, "height": 1000}


class ExportError(RuntimeError):
    """A failure the user can act on; the message says what to do."""


# --- reading a view --------------------------------------------------------

def _b64url_decode(text: str) -> bytes:
    text = text.replace("-", "+").replace("_", "/")
    return base64.b64decode(text + "=" * (-len(text) % 4))


def decode_view_payload(payload: str) -> Dict[str, Any]:
    """A ``#view=`` payload: ``z1.<base64url(deflate-raw(JSON))>`` or legacy base64url JSON."""
    if payload.startswith("z1."):
        raw = zlib.decompress(_b64url_decode(payload[3:]), -15)
    else:
        raw = _b64url_decode(payload)
    return json.loads(raw.decode("utf-8"))


def encode_view_payload(view: Dict[str, Any]) -> str:
    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
    raw = compressor.compress(json.dumps(view, separators=(",", ":")).encode("utf-8")) + compressor.flush()
    return "z1." + base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def view_from_link(link: str) -> Tuple[Optional[str], Dict[str, Any]]:
    """``(dataset_path, view)`` of a share link."""
    parsed = urllib.parse.urlsplit(link)
    query = urllib.parse.parse_qs(parsed.query)
    fragment = urllib.parse.parse_qs(parsed.fragment)
    dataset = (query.get("dataset_path") or [None])[0]
    payload = (fragment.get("view") or query.get("view") or [None])[0]
    if not payload:
        raise ExportError("The link has no #view= part: it opens a dataset, not a view.")
    return dataset, decode_view_payload(payload)


def png_text(data: bytes, keyword: str = RECIPE_KEY) -> Optional[str]:
    """The text of a PNG's tEXt chunk ``keyword``, or None."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ExportError("Not a PNG file.")
    at = 8
    while at + 12 <= len(data):
        length = int.from_bytes(data[at:at + 4], "big")
        kind = data[at + 4:at + 8]
        body = data[at + 8:at + 8 + length]
        if kind == b"tEXt":
            name, _, text = body.partition(b"\0")
            if name.decode("latin-1") == keyword:
                return text.decode("latin-1")
        if kind == b"IEND":
            break
        at += 12 + length
    return None


def svg_recipe_text(svg: str) -> Optional[str]:
    match = re.search(r'<metadata id="annzarro-recipe"><annzarro:recipe[^>]*>(.*?)</annzarro:recipe></metadata>',
                      svg, re.S)
    if not match:
        return None
    return match.group(1).replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")


def read_recipe(path: str) -> Dict[str, Any]:
    """The recipe an exported PNG or SVG carries."""
    data = Path(path).read_bytes()
    text = png_text(data) if data[:8] == b"\x89PNG\r\n\x1a\n" else svg_recipe_text(data.decode("utf-8", "replace"))
    if text is None:
        raise ExportError(f"{path} carries no AnnZarro recipe (exported before v0.4.1, or by another tool).")
    recipe = json.loads(text)
    if not isinstance(recipe, dict) or "panel_set" not in recipe:
        raise ExportError(f"{path}: the recipe is not one this version reads.")
    return recipe


def load_source(source: Optional[str], from_figure: Optional[str]) -> Dict[str, Any]:
    """``{dataset, view, panel, version, export}`` from a panel set file, a
    share link, or an exported figure's recipe."""
    if from_figure:
        recipe = read_recipe(from_figure)
        panel_set = recipe["panel_set"]
        return {"dataset": panel_set.get("dataset"), "view": panel_set.get("view") or {},
                "panel": recipe.get("panel"), "version": recipe.get("annzarro_version"),
                "export": recipe.get("export") or {}}
    if not source:
        raise ExportError("Give a panel set file, a share link, or --from <figure>.")
    if re.match(r"^[a-z]+://", source) or source.startswith("?") or "#view=" in source:
        dataset, view = view_from_link(source if "://" in source else "http://x/" + source.lstrip("/"))
        return {"dataset": dataset, "view": view, "panel": None, "version": view.get("annzarro"), "export": {}}
    try:
        panel_set = json.loads(Path(source).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ExportError(f"{source}: no such file")
    except ValueError as exc:
        raise ExportError(f"{source} is not a panel set (JSON): {exc}")
    if isinstance(panel_set, dict) and "panel_set" in panel_set:      # a recipe saved as JSON
        panel_set = panel_set["panel_set"]
    if not isinstance(panel_set, dict) or not isinstance(panel_set.get("view"), dict):
        raise ExportError(f"{source} has no view to export (a panel set saved before v0.4.0?). "
                          "Load it in AnnZarro and save it again.")
    view = panel_set["view"]
    return {"dataset": panel_set.get("dataset"), "view": view, "panel": None,
            "version": view.get("annzarro"), "export": {}}


# --- the server ------------------------------------------------------------

def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serving_dir(store: Path) -> Path:
    """A data directory holding only a link to the store, at a path that is
    the same on every run for this store (the recipe records the path)."""
    real = store.resolve()
    key = hashlib.sha1(str(real).encode("utf-8")).hexdigest()[:12]
    base = Path(tempfile.gettempdir()) / "annzarro-export" / key
    base.mkdir(parents=True, exist_ok=True)
    link = base / store.name
    if link.is_symlink() and Path(os.readlink(link)) != real:
        link.unlink()
    if not link.exists():
        try:
            link.symlink_to(real, target_is_directory=real.is_dir())
        except OSError:
            # no symlinks (Windows without the privilege): serve the store's own directory
            return real.parent
    return base


class LocalServer:
    """``annzarro start`` on a free port, in its own state directory."""

    def __init__(self, data_dir: Path, verbose: bool = False):
        self.data_dir = data_dir
        self.home = Path(tempfile.mkdtemp(prefix="annzarro-export-home-"))
        self.port = _free_port()
        self.root = f"http://127.0.0.1:{self.port}"
        env = dict(os.environ, ANNZARRO_HOME=str(self.home), ANNZARRO_HEADLESS="1")
        out = None if verbose else subprocess.DEVNULL
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1", "--port", str(self.port),
             "--data-dir", str(data_dir), "--no-browser", "--auth-disabled"],
            env=env, stdout=out, stderr=subprocess.STDOUT if out is not None else None)

    def __enter__(self):
        deadline = time.time() + 60
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise ExportError("The local AnnZarro server did not start (rerun with --verbose to see why).")
            try:
                urllib.request.urlopen(self.root + "/api/v1/config", timeout=1)
                return self
            except OSError:
                time.sleep(0.25)
        self.close()
        raise ExportError("The local AnnZarro server did not answer within 60 s.")

    def get(self, path: str, timeout: float = 30):
        with urllib.request.urlopen(self.root + path, timeout=timeout) as r:
            return json.loads(r.read())

    def close(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(15)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        shutil.rmtree(self.home, ignore_errors=True)

    def __exit__(self, *exc):
        self.close()


def store_fingerprint(server: LocalServer, dataset_path: str, budget_s: float = 600) -> Dict[str, Any]:
    """The store's full fingerprint (waits for the names to be hashed)."""
    q = urllib.parse.quote(dataset_path, safe="")
    deadline = time.time() + budget_s
    while True:
        body = server.get(f"/api/v1/data/fingerprint?dataset_path={q}&wait=10", timeout=40)
        if body.get("status") == "ready" or time.time() > deadline:
            return body


def compare(saved: Optional[Dict[str, Any]], current: Optional[Dict[str, Any]]) -> str:
    """'unknown', 'same', 'fields' or 'different' (as static/js/utils/view-store.js)."""
    if not saved or not current or saved.get("v") != current.get("v"):
        return "unknown"
    if (saved.get("n_obs"), saved.get("n_var")) != (current.get("n_obs"), current.get("n_var")):
        return "different"
    if saved.get("data") and current.get("data") and saved["data"] != current["data"]:
        return "different"
    if saved.get("meta") and current.get("meta") and saved["meta"] != current["meta"]:
        return "fields"
    return "same"


# --- the browser -----------------------------------------------------------

def _wait_until_drawn(page, timeout_s: float, settle_s: float = 1.5) -> None:
    page.wait_for_function("() => typeof window.annzarroPlots === 'function'", timeout=timeout_s * 1000)
    deadline = time.time() + timeout_s
    last, since = None, time.time()
    while time.time() < deadline:
        state = json.loads(page.evaluate("() => window.annzarroPlotState()"))
        sig = json.dumps(state)
        ready = (not state["loading"] and not state["noData"] and state["plots"]
                 and all(p[1] for p in state["plots"]))
        if sig != last:
            last, since = sig, time.time()
        elif ready and time.time() - since >= settle_s:
            return
        time.sleep(0.25)
    raise ExportError(f"The view did not finish drawing within {timeout_s:.0f} s.")


def _write(image: str, fmt: str, out: Path) -> None:
    if fmt == "svg":
        out.write_text(image, encoding="utf-8")
    else:
        out.write_bytes(base64.b64decode(image.split(",", 1)[1]))


def run_export(source: Optional[str], store: str, out: str, panel: Optional[str] = None,
               from_figure: Optional[str] = None, allow_other_store: bool = False,
               timeout_s: float = 600, verbose: bool = False, log=print) -> List[Path]:
    """Export a view's plots; returns the files written."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise ExportError("annzarro export needs Playwright and its Chromium: "
                          "pip install 'annzarro[export]' && python -m playwright install chromium")
    from annzarro import __version__

    spec = load_source(source, from_figure)
    out_path = Path(out)
    fmt = out_path.suffix.lower().lstrip(".")
    if fmt not in ("png", "svg"):
        raise ExportError(f"--out must end in .png or .svg, not {out_path.suffix or '(none)'}")
    store_path = Path(store).expanduser()
    if not store_path.exists():
        raise ExportError(f"--store {store}: no such store")
    if spec["version"] and spec["version"] != __version__:
        log(f"Note: this view was saved with AnnZarro {spec['version']}; this is {__version__}. "
            f"It is drawn again, but may look different. For the exact figure use AnnZarro "
            f"{spec['version']} (pip install annzarro=={spec['version']}).")

    data_dir = _serving_dir(store_path)
    dataset_path = str(data_dir / store_path.name) if data_dir != store_path.resolve().parent \
        else str(store_path.resolve())
    view = dict(spec["view"])
    saved_store = view.get("store") or {}

    written: List[Path] = []
    with LocalServer(data_dir, verbose=verbose) as server:
        identity = store_fingerprint(server, dataset_path)
        level = compare(saved_store.get("fp"), identity.get("fingerprint"))
        if level == "different" and not allow_other_store:
            raise ExportError(f"{store} is not the store this view was saved on (other cells or genes). "
                              "Pass --allow-other-store to export it anyway.")
        if level == "fields":
            log("Note: the store has the same cells and genes as when the view was saved, but other fields.")
        if level == "unknown":
            log("Note: this view records no store fingerprint (saved before v0.4.1); the store is not checked.")
        link = f"{server.root}/?dataset_path={urllib.parse.quote(dataset_path, safe='/')}#view={encode_view_payload(view)}"
        with sync_playwright() as p:
            browser = p.chromium.launch(args=CHROMIUM_ARGS)
            try:
                context = browser.new_context(viewport=VIEWPORT, device_scale_factor=1)
                page = context.new_page()
                errors: List[str] = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(link)
                if level == "different":
                    page.wait_for_selector('.notification-ask button[data-action="open"]', timeout=60000)
                    page.click('.notification-ask button[data-action="open"]')
                _wait_until_drawn(page, timeout_s)
                plots = page.evaluate("() => window.annzarroPlots()")
                wanted = [panel or spec.get("panel")] if (panel or spec.get("panel")) else plots
                missing = [w for w in wanted if w not in plots]
                if missing:
                    raise ExportError(f"No plot panel {missing[0]!r} in this view; its plots: {', '.join(plots) or 'none'}")
                for pid in wanted:
                    image = page.evaluate("([id, f]) => window.annzarroExport(id, f)", [pid, fmt])
                    target = out_path if len(wanted) == 1 else out_path.with_name(f"{out_path.stem}-{pid}{out_path.suffix}")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    _write(image, fmt, target)
                    written.append(target)
                    log(f"wrote {target}")
                if errors and verbose:
                    log("page errors: " + "; ".join(errors))
            finally:
                browser.close()
    return written


def add_parser(subparsers) -> None:
    parser = subparsers.add_parser(
        "export", help="Write a saved view's plots as PNG or SVG, as the Export button does",
        description=__doc__, formatter_class=__import__("argparse").RawDescriptionHelpFormatter)
    parser.add_argument("source", nargs="?", help="A panel set file (.json) or a share link")
    parser.add_argument("--from", dest="from_figure", metavar="FIGURE",
                        help="Make a figure again from the recipe in an exported PNG or SVG")
    parser.add_argument("--store", required=True, help="The store (.zarr or .h5ad) to draw the view from")
    parser.add_argument("--out", required=True,
                        help="Output file, .png or .svg; with several plots, <stem>-<panel id>.<ext>")
    parser.add_argument("--panel", help="Only this plot panel (its tile id, e.g. cell-plot-1)")
    parser.add_argument("--allow-other-store", action="store_true",
                        help="Export even if the store has other cells or genes than the view was saved on")
    parser.add_argument("--timeout", type=float, default=600, help="Seconds to wait for the plots (default 600)")
    parser.add_argument("--verbose", action="store_true", help="Show the server's log and page errors")
    parser.set_defaults(func=export_command)


def export_command(args) -> int:
    try:
        run_export(args.source, args.store, args.out, panel=args.panel, from_figure=args.from_figure,
                   allow_other_store=args.allow_other_store, timeout_s=args.timeout, verbose=args.verbose)
    except ExportError as exc:
        print(f"annzarro export: {exc}", file=sys.stderr)
        return 2
    return 0
