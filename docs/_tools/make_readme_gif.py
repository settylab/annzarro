"""Animated README hero: the focus model in three panels of the demonstration data.

Two clicks on cells in the UMAP move the diffusion-walk colouring; a click on a gene in the
volcano recolours its Spearman correlations and the per-cell fold change of that gene. Every
click is real mouse input on a live server (a drawn cursor makes it visible in the recording).

Run: .venv-docs/bin/python docs/_tools/make_readme_gif.py [--port 8890]
Writes docs/_static/readme/focus.gif (kept under 3 MB so GitHub and PyPI show it inline) and
docs/_static/readme/features.png, a 2 x 2 grid of existing documentation screenshots
(`--grid-only` rebuilds just the grid, without a server).
"""
import argparse
import io
import json
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import Session, split, tile  # noqa: E402

OUT = HERE.parent / "_static" / "readme"
VIEWPORT = {"width": 1500, "height": 640}
WIDTH = 1000  # px of the final GIF

MONO = "Mature_Young_1#CAACCAAGTATACCCA-1"     # monocyte that a click lands on (fig2 sequence)
ERY = "HSPC_Mid_1#CATAAGCCAGTTTCGA-1"          # erythroid progenitor near its cluster centre
GENE = "S100a9"                                # neutrophil granule gene, down with age

# The landing-page overview without its table: walk | volcano | fold change of the focused gene.
_overview = json.loads((HERE / "views" / "overview.json").read_text())
_cfgs = {k: v for k, v in _overview["layout"]["panelConfigs"].items() if k != "cell-table-O4"}
_cfgs["cell-plot-O1"]["title"] = "Cell x cell: diffusion walk"
_cfgs["gene-plot-O2"]["title"] = "Gene x gene: Spearman"
_cfgs["cell-plot-O3"]["title"] = "Cells x genes: fold change"
VIEW = {
    "v": 1,
    "constants": _overview["constants"],
    "layout": {
        "v": 1,
        "hierarchy": [split("horizontal", tile("cell-plot-O1"),
                            split("horizontal", tile("gene-plot-O2"), tile("cell-plot-O3")), 34)],
        "controlState": {k: False for k in _cfgs},
        "panelConfigs": _cfgs,
    },
}

# A drawn arrow cursor plus a ring on each press; headless Chromium draws no pointer.
CURSOR_JS = """() => {
  const c = document.createElement('div');
  c.id = 'gif-cursor';
  c.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M1 1 L1 22 L6.5 16.5 L10.5 26 L14 24.5 L10 15.5 L18 15.5 Z" fill="#111" stroke="#fff" stroke-width="1.6"/></svg>';
  Object.assign(c.style, {position: 'fixed', left: '-50px', top: '-50px', zIndex: 99999,
                          pointerEvents: 'none'});
  document.body.appendChild(c);
  document.addEventListener('mousemove', e => {
    c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  document.addEventListener('mousedown', e => {
    const r = document.createElement('div');
    Object.assign(r.style, {position: 'fixed', left: (e.clientX - 14) + 'px',
      top: (e.clientY - 14) + 'px', width: '28px', height: '28px', borderRadius: '50%',
      border: '3px solid #e8590c', zIndex: 99998, pointerEvents: 'none'});
    r.className = 'gif-ring';
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 900);
  }, true);
}"""

POINT_JS = """([tid, name]) => {
  const g = document.querySelector(`.tile[data-tile-id="${tid}"] .js-plotly-plot`);
  const tr = g._fullData[0], i = tr.customdata.indexOf(name);
  if (i < 0) return null;
  const L = g._fullLayout, xa = L.xaxis, ya = L.yaxis, r = g.getBoundingClientRect();
  return {x: r.left + xa._offset + xa.l2p(tr.x[i]), y: r.top + ya._offset + ya.l2p(tr.y[i])};
}"""


def font(size: int):
    for f in ("/System/Library/Fonts/HelveticaNeue.ttc", "/System/Library/Fonts/Helvetica.ttc",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


class Recorder:
    def __init__(self, page):
        self.page, self.frames, self.caption = page, [], ""
        self.pos = (VIEWPORT["width"] * 0.5, VIEWPORT["height"] - 40)
        page.mouse.move(*self.pos)

    def grab(self, ms: int) -> None:
        img = Image.open(io.BytesIO(self.page.screenshot())).convert("RGB")
        img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)
        bar = Image.new("RGB", (img.width, 40), "#1f2937")
        ImageDraw.Draw(bar).text((14, 20), self.caption, font=font(19), fill="#f9fafb", anchor="lm")
        out = Image.new("RGB", (img.width, img.height + bar.height))
        out.paste(img, (0, 0))
        out.paste(bar, (0, img.height))
        self.frames.append((out, ms))

    def glide(self, x: float, y: float, steps: int = 7) -> None:
        x0, y0 = self.pos
        for k in range(1, steps + 1):
            t = k / steps
            t = t * t * (3 - 2 * t)
            self.page.mouse.move(x0 + (x - x0) * t, y0 + (y - y0) * t)
            self.grab(60)
        self.pos = (x, y)


def click(s, rec: Recorder, tid: str, name: str, which: str) -> None:
    pos = rec.page.evaluate(POINT_JS, [tid, name])
    if pos is None:
        raise RuntimeError(f"{name} not in {tid}")
    rec.glide(pos["x"], pos["y"])
    rec.grab(350)
    rec.page.mouse.click(pos["x"], pos["y"])
    time.sleep(0.15)
    rec.grab(150)  # ring visible, plots not yet redrawn
    s.ready(rec.page, settle=0.8)
    got = rec.page.evaluate(f"document.getElementById('focused-{which}').value")
    if got != name:  # a dense cloud can put a neighbour on top
        s.log.append(f"click on {name} focused {got}")
    rec.page.mouse.move(pos["x"] + 1, pos["y"] + 1)  # drop the hover label
    rec.grab(2200)


# (screenshot, label, pixels to cut from the top: the app header on full-page captures)
GRID = [
    ("paper/fig3-bc.png", "Cell x cell: UMAP distance vs diffusion distance to one cell", 200),
    ("paper/fig4b-volcano-h2aa.png", "Gene x gene: volcano coloured by correlation to H2-Aa", 0),
    ("paper/fig5d-plot.png", "Cells x genes: fold change in one cell vs another", 0),
    ("paper/fig2-c-filter.png", "Tables: AND/OR filters that mask the plots", 200),
]


def make_grid(path: Path, cell=(720, 420)) -> None:
    screens = HERE.parent / "_static" / "screens"
    w, h = cell
    bar = 40
    grid = Image.new("RGB", (2 * w + 12, 2 * (h + bar) + 12), "white")
    for k, (src, label, top) in enumerate(GRID):
        im = Image.open(screens / src).convert("RGB")
        im = im.crop((0, top, im.width, im.height))
        im.thumbnail((w, h), Image.LANCZOS)
        x0, y0 = (k % 2) * (w + 12), (k // 2) * (h + bar + 12)
        ImageDraw.Draw(grid).rectangle((x0, y0, x0 + w - 1, y0 + bar - 1), fill="#1f2937")
        ImageDraw.Draw(grid).text((x0 + 12, y0 + bar // 2), label, font=font(18), fill="#f9fafb",
                                  anchor="lm")
        grid.paste(im, (x0 + (w - im.width) // 2, y0 + bar + (h - im.height) // 2))
    grid.quantize(256).save(path, optimize=True)
    print(f"{path}: {path.stat().st_size / 1e3:.0f} KB")


def save_gif(frames, path: Path) -> None:
    # One palette for all frames, so unchanged pixels stay identical and Pillow stores only
    # the changed rectangle of each frame.
    sample = Image.new("RGB", (frames[0][0].width, frames[0][0].height * 3))
    for k, i in enumerate((0, len(frames) // 2, len(frames) - 1)):
        sample.paste(frames[i][0], (0, frames[0][0].height * k))
    pal = sample.quantize(colors=255, method=Image.MEDIANCUT)
    imgs = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f, _ in frames]
    imgs[0].save(path, save_all=True, append_images=imgs[1:], duration=[d for _, d in frames],
                 loop=0, optimize=True, disposal=1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8890)
    ap.add_argument("--grid-only", action="store_true")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    make_grid(OUT / "features.png")
    if a.grid_only:
        sys.exit()
    (HERE / "views" / "readme-focus.json").write_text(json.dumps(VIEW, indent=1) + "\n")
    with Session(a.port, OUT) as s:
        page = s.open(VIEW, viewport=VIEWPORT)
        page.add_style_tag(content=".modebar-container { display: none !important; }"
                                   "#notification-container, .notification { display: none !important; }"
                                   ".hoverlayer { display: none !important; }")
        page.evaluate(CURSOR_JS)
        rec = Recorder(page)
        rec.caption = "Each panel follows the focused cell or the focused gene"
        rec.grab(2200)
        rec.caption = "Click a monocyte: the colour becomes its row of the diffusion walk"
        click(s, rec, "cell-plot-O1", MONO, "cell")
        rec.caption = "Click an erythroid progenitor: the walk follows the erythroid branch"
        click(s, rec, "cell-plot-O1", ERY, "cell")
        rec.caption = f"Click {GENE} in the volcano: its correlations and per-cell fold change recolour"
        click(s, rec, "gene-plot-O2", GENE, "gene")
        rec.grab(1200)
    path = OUT / "focus.gif"
    save_gif(rec.frames, path)
    print(f"{path}: {len(rec.frames)} frames, {path.stat().st_size / 1e6:.2f} MB")
