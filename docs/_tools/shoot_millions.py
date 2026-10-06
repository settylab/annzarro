"""Screenshots for docs/tutorials/millions.md (the paper's Worked example 6, Steps 32-36).

Every capture follows real user input: the badge dialog is opened and set, parts are stepped
with the part buttons and a typed part number, a cell outside the part is typed into Focused
Cell, and the subset is switched off for large-plot mode.

Run (needs a Tahoe-100M store, docs/paper/scale.md; heavy, so hold the shared bench lock):

    ANNZARRO_TAHOE_STORE=/path/to/tahoe_panel_95.6M_plot.zarr \\
    /usr/bin/lockf -k ~/.annzarro-bench.lock .venv-docs/bin/python docs/_tools/shoot_millions.py

Writes docs/_static/screens/tutorials/millions-*.png and prints what each step showed (status
lines, badge, preview), which the tutorial quotes.
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from PIL import Image  # noqa: E402
from shots import DSF, Session, tile  # noqa: E402

OUT = HERE.parent / "_static" / "screens" / "tutorials"
T = "cell-plot-W6"
VIEW = {"v": 1, "constants": {"focusedGene": "FN1"},
        "layout": {"v": 1, "hierarchy": [tile(T)], "controlState": {T: False},
                   "panelConfigs": {T: {"id": T, "title": "UMAP by cell line",
                                        "x": {"type": "obsm", "key": "X_umap", "column": "0"},
                                        "y": {"type": "obsm", "key": "X_umap", "column": "1"},
                                        "z": None,
                                        "color": {"type": "obs", "key": "cell_line_id", "column": ""}}}}}


def status(page) -> str:
    return page.evaluate("(() => { const s = document.querySelector('.tile .plot-status');"
                         " return s ? s.innerText.replace(/\\n/g, ' | ') : ''; })()")


def wait_status(page, text: str, timeout=600) -> float:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if text in status(page):
            time.sleep(2)
            return time.time() - t0
        time.sleep(0.25)
    raise SystemExit(f"status never read {text!r}; last: {status(page)!r}")


def crop(name: str, page, selectors, pad=8):
    """Crop a viewport screenshot to the union of `selectors`."""
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path))
    boxes = [b for b in (page.locator(s).first.bounding_box() for s in selectors) if b]
    x0 = max(0, min(b["x"] for b in boxes) - pad)
    y0 = max(0, min(b["y"] for b in boxes) - pad)
    x1 = max(b["x"] + b["width"] for b in boxes) + pad
    y1 = max(b["y"] + b["height"] for b in boxes) + pad
    im = Image.open(path)
    im.crop((int(x0 * DSF), int(y0 * DSF), int(min(x1 * DSF, im.width)),
             int(min(y1 * DSF, im.height)))).save(path)
    shrink(path)


def save(page, name: str, locator=None):
    path = OUT / f"{name}.png"
    if locator:
        page.locator(locator).first.screenshot(path=str(path))
    else:
        page.screenshot(path=str(path))
    shrink(path)


def shrink(path: Path):
    """Keep every PNG under ~400 KB: optimise, then quantise if it is still too big."""
    im = Image.open(path).convert("RGB")
    im.save(path, optimize=True)
    if path.stat().st_size > 400_000:
        im.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)
    if path.stat().st_size > 400_000:
        w, h = im.size
        im = im.resize((int(w * 0.8), int(h * 0.8)), Image.LANCZOS)
        im.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8870)
    a = ap.parse_args()
    store = Path(os.environ.get("ANNZARRO_TAHOE_STORE", ""))
    if not store.is_dir():
        raise SystemExit("set ANNZARRO_TAHOE_STORE to a Tahoe-100M store (docs/paper/scale.md)")
    data = Path(tempfile.mkdtemp(prefix="annzarro-millions-"))
    (data / store.name).symlink_to(store)
    OUT.mkdir(parents=True, exist_ok=True)
    with Session(a.port, OUT, data_dir=data) as sh:
        # Step 32: the dataset opens on the default subset
        page = sh.open(VIEW, dataset=str(data / store.name))
        wait_status(page, "cells shown")
        sh.log.append("step 32: header = " + page.evaluate(
            "document.getElementById('cell-count').textContent + ' | '"
            " + document.getElementById('subset-button').textContent"))
        sh.log.append("step 32: status = " + status(page))
        save(page, "millions-open")
        crop("millions-badge", page, ["#cell-count", "#subset-button", "#subset-part-next"])

        # Step 33: the badge dialog, balanced across the cell line
        page.click("#subset-button")
        page.wait_for_selector("#subset-modal.show", timeout=30000)
        time.sleep(1)
        page.select_option("#subset-balance", label="Balanced across cell_line_id")
        time.sleep(1)
        page.wait_for_function("(() => { const t = document.getElementById('subset-preview').textContent;"
                               " return t.includes('will be shown') && !t.includes('Checking'); })()",
                               timeout=180000)
        time.sleep(1)
        sh.log.append("step 33: preview = " + page.locator("#subset-preview").inner_text().replace("\n", " | "))
        save(page, "millions-dialog", "#subset-modal .modal-content")
        page.click("#subset-apply")
        page.wait_for_function("document.getElementById('subset-button').title.includes('balanced by cell_line_id')",
                               timeout=120000)
        wait_status(page, "part 1 of 957")
        sh.log.append("step 33: badge title = " + page.evaluate(
            "document.getElementById('subset-button').title").replace("\n", " | "))

        # Step 34: step through parts, by button and by typed number
        page.click("#subset-part-next")
        sh.log.append(f"step 34: next part, status after {wait_status(page, 'part 2 of 957'):.1f} s")
        page.fill("#subset-part-input", "250")
        page.press("#subset-part-input", "Enter")
        sh.log.append(f"step 34: part 250, status after {wait_status(page, 'part 250 of 957'):.1f} s")
        sh.log.append("step 34: status = " + status(page))
        crop("millions-part-controls", page, ["#cell-count", "#subset-part-next", ".tile .plot-status"])

        # Step 35: focus a cell outside the part by typing its name (a cell of part 1)
        page.fill("#subset-part-input", "1")
        page.press("#subset-part-input", "Enter")
        wait_status(page, "part 1 of 957")
        name = page.evaluate("""() => { const g = document.querySelector('.tile .js-plotly-plot');
            const t = g._fullData.find(t => t.customdata && t.customdata.length > 1000);
            return t.customdata[500]; }""")
        page.fill("#subset-part-input", "250")
        page.press("#subset-part-input", "Enter")
        wait_status(page, "part 250 of 957")
        # The first name search on a server builds its name index (several seconds at tens of
        # millions of cells); until it is built the picker answers "No cell matches", so retype.
        page.click("#focused-cell")
        for attempt in range(20):
            page.keyboard.press("Meta+A")
            page.keyboard.type(name, delay=20)
            time.sleep(3)
            menu = page.evaluate("[...document.querySelectorAll('.name-picker-menu')].filter(m => !m.hidden)"
                                 ".map(m => m.innerText).join('')")
            if name in menu:
                break
            sh.log.append(f"step 35: attempt {attempt + 1}: {menu.splitlines()[0] if menu else 'no menu'}")
        else:
            raise SystemExit("the picker never found the typed cell")
        sh.log.append("step 35: picker = " + page.evaluate(
            "[...document.querySelectorAll('.name-picker-menu')].filter(m => !m.hidden)"
            ".map(m => m.innerText).join('').replace(/\\n/g, ' | ')"))
        crop("millions-picker", page, ["#focused-cell", ".name-picker-menu:not([hidden])"], pad=12)
        page.keyboard.press("Enter")
        page.wait_for_selector(".focus-outside-badge", timeout=60000)
        page.locator("body").click(position={"x": 5, "y": 600})
        time.sleep(2)
        sh.log.append("step 35: focused = " + page.evaluate(
            "document.getElementById('focused-cell').value + ' | '"
            " + document.querySelector('.focus-outside-badge').innerText + ' | '"
            " + document.querySelector('.focus-outside-badge').title"))
        crop("millions-outside", page, ["#cell-history-back", "#focused-cell", ".focus-outside-badge"], pad=10)

        # Step 36: every cell, large-plot mode
        page.click("#subset-button")
        page.wait_for_selector("#subset-modal.show", timeout=30000)
        time.sleep(1)
        page.uncheck("#subset-enabled")
        time.sleep(2)
        sh.log.append("step 36: preview = " + page.locator("#subset-preview").inner_text().replace("\n", " | "))
        page.click("#subset-apply")
        wait_status(page, "Large plot", timeout=900)
        time.sleep(3)
        sh.log.append("step 36: header = " + page.evaluate(
            "document.getElementById('cell-count').textContent + ' | '"
            " + document.getElementById('subset-button').textContent"))
        sh.log.append("step 36: status = " + status(page))
        save(page, "millions-large")
        page.context.close()


if __name__ == "__main__":
    main()
