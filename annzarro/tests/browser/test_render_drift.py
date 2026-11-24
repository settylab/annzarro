"""Render drift: a plot edited step by step draws what a plot made from its final config draws (0.8.0).

A run of edits must never leave a plot drawn differently from the same plot opened fresh. Each case here opens a
panel, applies a sequence of real edits to it (its controls, its Undo, the focus, or its public ``updateConfig``, the
path Back and Forward take), then records what Plotly resolved: every trace of ``gd._fullData`` (type, visibility,
marker, line, colour scale, colour bar, the x/y/z data by length and hash) and ``gd._fullLayout`` (axes, ranges,
legend, annotations, shapes, scenes, colour axes), and, for a 2D WebGL plot, the marker options in the regl scene
(utils/gl-markers.js writes size and opacity there). The same panels are then carried to a fresh page by the share
link (``encodeViewPayload`` of ``saveLayout()``, with the focused gene and cell) and recorded again. The two records
must be equal: whatever the edits did, the drawing is a function of the final config.

Volatile fields are left out: ``uid``, the ``*revision`` keys, the figure's pixel size and template, and Plotly's
private ``_`` fields. Axis ranges and the 3D camera are compared within a small tolerance (the autorange pads by the
marker size in pixels).

Sequences are seeded random walks over each panel's options (``SEEDS`` x ``STEPS``) and a few hand-written ones that
have broken before: dots and heatmap, a section removed and undone, 3D on and off, Color by on and off, the 2D
density's layers, and the Cell Plot's large-plot mode. ``ANNZARRO_DRIFT_EACH=1`` compares after every step and stops
at the first that drifts (for diagnosis; slow). ``ANNZARRO_DRIFT_SEEDS`` / ``ANNZARRO_DRIFT_STEPS`` change the walk.

Panels: Cell Plot (regular and large-plot mode), Gene Plot, Cell-Gene Plot and Count Plot. The Cell-Gene and Count
Plots draw the whole figure from their config (Plotly.react through panel-surface.js `drawPlot`) and must not drift.
The Cell and Gene Plots update incrementally on purpose (restyle, relayout, the regl scene); a case of theirs that
drifts is marked xfail with its cause (design-next/render-drift-080.md) until it is fixed.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json
import os
import random
import re
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_focus_outside_subset as _focus  # noqa: E402
from annzarro.tests.browser.test_names_dataset_scope import _serve  # noqa: E402
from annzarro.tests.core import grouping_store as gstore  # noqa: E402

SEEDS = int(os.environ.get("ANNZARRO_DRIFT_SEEDS", "5"))
STEPS = int(os.environ.get("ANNZARRO_DRIFT_STEPS", "12"))
EACH = os.environ.get("ANNZARRO_DRIFT_EACH") == "1"
DATA = gstore.make_data()
GENES = [gstore.gene(i) for i in range(gstore.N_VAR)]
CELLS = [gstore.cell(i) for i in range(0, gstore.N_OBS, 97)]

CP, GP, CG, CC = "cell-plot-D", "gene-plot-D", "cell-gene-D", "cell-count-D"
S1, S2 = "gene-signature-D1", "gene-signature-D2"
TILE = '.tile[data-tile-id="{}"]'


def _make_store(path):
    gstore.make_store(str(path), "csc", "zarr", data=DATA)
    return str(path)


def _server(tmp_path_factory, config=None):
    original = _focus._make_store
    _focus._make_store = _make_store
    try:
        return _serve(tmp_path_factory, config)
    finally:
        _focus._make_store = original


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    proc, root, store = _server(tmp_path_factory)
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def served_large(tmp_path_factory):
    """Large-plot mode above 10 points: the 1,200 cells are drawn large."""
    proc, root, store = _server(tmp_path_factory, "ui:\n  defaults:\n    large_plot_points: 10\n")
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        try:
            yield b
        finally:
            b.close()


# ------------------------------------------------------------------ in the page

# every request in flight (fetch and XHR): a plot is not settled while it still loads
INSTRUMENT = """(() => {
  window.__azInflight = 0;
  const f = window.fetch;
  window.fetch = function (...a) { window.__azInflight++;
    return f.apply(this, a).finally(() => { window.__azInflight--; }); };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) { window.__azInflight++;
    this.addEventListener('loadend', () => { window.__azInflight--; }, { once: true });
    return send.apply(this, a); };
  // one size for every plot, in both pages: a figure is laid out in pixels, and the lines above a plot (an Undo
  // label, a message) are not the same after edits as on a fresh page; what is compared is the drawing, not the chrome
  const pin = () => { const st = document.createElement('style');
    st.textContent = '.js-plotly-plot { width: 900px !important; height: 560px !important; min-height: 560px !important;'
      + ' max-height: 560px !important; flex: 0 0 560px !important; }';
    document.head.appendChild(st); };
  if (document.head) pin(); else document.addEventListener('DOMContentLoaded', pin);
})();"""

# what Plotly resolved, as plain data: numbers to 6 significant digits, long series by length and hash
SNAP = """(sel) => {
  const tile = document.querySelector(sel);
  const gd = tile && tile.querySelector('.js-plotly-plot');
  if (!gd || !gd._fullLayout || !gd._fullData) return { drawn: false };
  const R = (v) => typeof v === 'number' ? (Number.isFinite(v) ? Number(v.toPrecision(6)) : String(v)) : v;
  const isArr = (v) => Array.isArray(v) || ArrayBuffer.isView(v);
  const hash = (arr) => {
    let h = 2166136261;
    const put = (s) => { for (let j = 0; j < s.length; j++) { h ^= s.charCodeAt(j); h = Math.imul(h, 16777619); } h ^= 44; h = Math.imul(h, 16777619); };
    const walk = (a) => { for (let i = 0; i < a.length; i++) { const v = a[i]; if (isArr(v)) { put('['); walk(v); put(']'); } else put(String(R(v))); } };
    walk(arr);
    return (h >>> 0).toString(16);
  };
  const SKIP = new Set(['uid', 'uirevision', 'datarevision', 'editrevision', 'selectionrevision', 'meta', 'template', 'index']);
  const TOP = new Set(['width', 'height', 'autosize', 'computed']);
  const plain = (v, depth) => {
    if (v === null || v === undefined) return v;
    if (typeof v === 'function') return undefined;
    if (typeof v !== 'object') return R(v);
    if (typeof Node !== 'undefined' && v instanceof Node) return undefined;
    if (isArr(v)) {
      const deep = v.length && isArr(v[0]);
      const objects = !deep && Array.prototype.some.call(v, (x) => x !== null && typeof x === 'object');
      if (deep || (!objects && v.length > 24)) return { n: v.length, h: hash(v) };
      return Array.prototype.map.call(v, (x) => plain(x, depth + 1));
    }
    if (depth > 7) return '<deep>';
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (k.startsWith('_') || SKIP.has(k)) continue;
      const p = plain(v[k], depth + 1);
      if (p !== undefined) out[k] = p;
    }
    // automatic ticks: dtick and tick0 are what the last tick pass computed, kept or not by the path that drew;
    // the ticks drawn are compared from the page (ticks, below)
    if (v.tickmode === 'auto') { delete out.dtick; delete out.tick0; }
    // a 3D scene's autoranged axis: gl3d writes the range it computed back only on some paths (a relayout); the
    // scene drawn is the same (checked on screenshots), and an explicit range is still compared
    if (v.spikesides !== undefined && v.autorange === true) delete out.range;   // spikesides: only 3D axes have it
    return out;
  };
  const layout = {};
  for (const k of Object.keys(gd._fullLayout).sort()) {
    if (k.startsWith('_') || SKIP.has(k) || TOP.has(k)) continue;
    const p = plain(gd._fullLayout[k], 1);
    if (p !== undefined) layout[k] = p;
  }
  const traces = gd._fullData.map((t) => plain(t, 1));
  // the regl scene of a 2D WebGL plot: size and opacity set there (gl-markers.js) are what is seen
  const scene = gd._fullLayout._plots && gd._fullLayout._plots.xy && gd._fullLayout._plots.xy._scene;
  const regl = scene && Array.isArray(scene.markerOptions)
    ? scene.markerOptions.map((o) => o ? { size: plain(o.size, 1), opacity: plain(o.opacity, 1), color: plain(o.color, 1),
        colors: plain(o.colors, 1), borderSize: plain(o.borderSize, 1), borderColor: plain(o.borderColor, 1),
        positions: plain(o.positions, 1) } : null)
    : null;
  const said = [...tile.querySelectorAll('.plot-status .ps-summary, .coverage-notice, .score-notice, .filter-notice, .coverage-placeholder')]
    .filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim().replace(/\\s+/g, ' ')).filter(Boolean);
  const ticks = {};
  for (const t of gd.querySelectorAll('g[class$="tick"] > text, g[class$="tick2"] > text')) {
    const k = t.parentNode.getAttribute('class');
    (ticks[k] = ticks[k] || []).push(t.textContent);
  }
  // the labels drawn, in value order: a reversed axis lists its tick nodes in either order depending on the path
  for (const k of Object.keys(ticks)) ticks[k].sort();
  return { drawn: true, said, ticks, size: [Math.round(gd._fullLayout.width), Math.round(gd._fullLayout.height)], traces, layout, regl };
}"""

# settled: the panel says it is done, nothing loads, and the record has not changed for 800 ms
STABLE = """([sel, ready]) => {
  const tile = document.querySelector(sel);
  if (!tile) return false;
  const ok = (%s)(tile);
  const snap = (%s)(sel);
  const fp = JSON.stringify(snap) + '|' + ok;
  const now = performance.now();
  const S = (window.__azStable = window.__azStable || {});
  const was = S[sel];
  if (!was || was.fp !== fp) { S[sel] = { fp, since: now }; return false; }
  return ok && window.__azInflight === 0 && now - was.since >= 800;
}"""

READY = {
    # the Cell and Gene Plots: drawn, no loading overlay or spinner in the tile
    "plot": """(t) => { const gd = t.querySelector('.js-plotly-plot');
        const busy = [...t.querySelectorAll('.loading-overlay, .spinner-border')].some((e) => e.offsetParent !== null);
        return !!gd && !!gd._fullLayout && !busy; }""",
    "cell-gene": """(t) => { const r = t.querySelector('.cgene-panel');
        return !!r && !['loading', 'computing', 'working'].includes(r.dataset.state); }""",
    "cell-count": """(t) => { const r = t.querySelector('.ccnt-panel'); if (!r) return false;
        const c = window.PanelManager.getPanel(r.dataset.panelId).getConfig();
        return r.dataset.state !== 'loading' && r.dataset.state !== 'computing' && (r.dataset.state !== 'ready' || r.dataset.drawn === c.mode); }""",
}


def _settle(page, pid, kind, timeout=60000):
    sel = TILE.format(pid)
    page.evaluate("(s) => { if (window.__azStable) delete window.__azStable[s]; }", sel)
    page.wait_for_function(STABLE % (READY[kind], SNAP), arg=[sel, kind], timeout=timeout, polling=100)


def _snap(page, pid):
    return page.evaluate(SNAP, TILE.format(pid))


# ------------------------------------------------------------------ links

def _link(served, view_payload):
    root, store = served
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={view_payload}"


def _encode(view):
    return base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")


def _view(configs, open_ids, constants=None):
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in open_ids]

    def tree(nodes):
        if len(nodes) == 1:
            return nodes[0]
        return {"type": "split", "direction": "horizontal", "panes": [{"percentage": 100 // len(nodes)}, {"percentage": 100 - 100 // len(nodes)}],
                "children": [nodes[0], tree(nodes[1:])]}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [tree(tiles)], "controlState": {i: True for i in open_ids}, "panelConfigs": configs}}
    if constants:
        view["constants"] = constants
    return view


SHARE = """async () => {
  const d = await import('/static/js/utils/deeplink.js');
  const { DataManager } = await import('/static/js/data-manager.js');
  const constants = {};
  const g = DataManager.getFocusedGene && DataManager.getFocusedGene();
  const c = DataManager.getFocusedCell && DataManager.getFocusedCell();
  if (g) constants.focusedGene = g;
  if (c) constants.focusedCell = typeof c === 'string' ? c : c.name;
  return d.encodeViewPayload({ v: 1, subset: null, constants, layout: window.PanelManager.saveLayout() });
}"""


def _new_page(browser):
    ctx = browser.new_context(viewport={"width": 1500, "height": 1000}, color_scheme="light")
    ctx.set_default_timeout(60000)
    ctx.add_init_script(INSTRUMENT)
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    return ctx, page


# ------------------------------------------------------------------ comparing

def _tolerant(path):
    return path.endswith(".range") or ".camera." in path or path.endswith(".range[0]") or path.endswith(".range[1]")


def _diff(a, b, path=""):
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            out += _diff(a.get(k, "<missing>"), b.get(k, "<missing>"), f"{path}.{k}")
        return out
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return [f"{path}: {len(a)} items != {len(b)} items"]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out += _diff(x, y, f"{path}[{i}]")
        return out
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and _tolerant(path):
        return [] if abs(a - b) <= 0.02 * max(1.0, abs(a), abs(b)) else [f"{path}: {a!r} != {b!r}"]
    return [] if a == b else [f"{path}: {_short(a)} != {_short(b)}"]


def _short(v):
    s = json.dumps(v, sort_keys=True) if not isinstance(v, str) else repr(v)
    return s if len(s) < 160 else s[:157] + "..."


def _grouped(diffs):
    """One line per field, trace and list indices folded: 'traces[*].marker.size (x6): 3 != 8'."""
    seen = {}
    for d in diffs:
        path, _, rest = d.partition(": ")
        key = re.sub(r"\[\d+\]", "[*]", path)
        if key not in seen:
            seen[key] = [0, rest]
        seen[key][0] += 1
    return [f"{k} (x{n}): {rest}" if n > 1 else f"{k}: {rest}" for k, (n, rest) in seen.items()]


# Drift found in the Cell and Gene Plots (plot-utilities), not fixed yet: the field, when it is this drift, and the
# cause. A case whose only differences are these is xfail with the reason; any other difference fails. A fix makes the
# difference go and the case pass; its entry is then removed. The Cell-Gene and Count Plots have none.
KNOWN = {
    "plot": [
        (r"^traces\[\d+\]\.(un)?selected\.marker\.opacity$", lambda c, f: True,
         "gl-markers: a point opacity set in the regl scene (setGlMarkers) leaves Plotly's selected/unselected opacity "
         "derived from the old one"),
        (r"^(layout\.[xy]axis\.range\[\d\]|ticks\.[xy]tick.*)$", lambda c, f: bool(c.get("hideNaN") or c.get("hideOutliers")),
         "Hide NaN/outliers: the incremental path pins its own 5% extent (stableAxisRanges), a fresh draw autoranges"),
        (r"^traces\[\d+\]\.marker\.colorbar\.title\.side$", lambda c, f: c.get("legendPosition") in ("bottom", "top"),
         "colour bar title side: Legend position's placement (titleside) outlives a colour change; a fresh draw's "
         "colourBar() places it at the right"),
    ],
}


def _classify(kind, diffs, config, fresh):
    unknown, known = [], set()
    for d in diffs:
        path = d.partition(": ")[0]
        hit = next((why for pat, when, why in KNOWN.get(kind, ()) if re.match(pat, path) and when(config, fresh)), None)
        if hit:
            known.add(hit)
        else:
            unknown.append(d)
    return unknown, known


def _diff_records(edited, fresh):
    out = []
    for key in ("drawn", "said", "ticks", "size", "traces", "layout", "regl"):
        out += _diff(edited.get(key), fresh.get(key), key)
    return out


# ------------------------------------------------------------------ the harness

class Harness:
    """One panel under edit in one page; `fresh()` opens its final config in a new page and diffs the drawings."""

    def __init__(self, browser, served, pid, kind, configs, open_ids, constants=None):
        self.browser, self.served, self.pid, self.kind = browser, served, pid, kind
        self.steps = []
        self.ctx, self.page = _new_page(browser)
        self.page.goto(_link(served, _encode(_view(configs, open_ids, constants))))
        self.settle()

    def settle(self):
        _settle(self.page, self.pid, self.kind)

    def step(self, name, act):
        """Apply one edit (`act(page)` returns False when it does not apply now) and wait for the plot to settle."""
        if act(self.page) is False:
            return False
        self.steps.append(name)
        self.settle()
        return True

    def fresh(self):
        payload = self.page.evaluate(SHARE)
        ctx, page = _new_page(self.browser)
        try:
            page.goto(_link(self.served, payload))
            _settle(page, self.pid, self.kind)
            edited, opened = _snap(self.page, self.pid), _snap(page, self.pid)
            errors = list(page.errors)
        finally:
            ctx.close()
        return _diff_records(edited, opened), errors, opened

    def check(self, label):
        """(unknown differences, known ones by reason, page errors, message)."""
        diffs, errors, opened = self.fresh()
        errors += self.page.errors
        config = self.page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig()", self.pid)
        unknown, known = _classify(self.kind, diffs, config, opened)
        msg = (f"{label}: the edited plot and the plot opened from its final config differ\n"
               f"edits ({len(self.steps)}):\n  " + "\n  ".join(self.steps) + "\n"
               f"differences ({len(unknown)}, one per field):\n  " + "\n  ".join(_grouped(unknown)))
        return unknown, known, errors, msg

    def close(self):
        self.ctx.close()


def _verdict(h, label, final):
    unknown, known, errors, msg = h.check(label)
    if final or unknown:
        assert not errors, errors
        assert not unknown, msg
    if final and known:
        pytest.xfail("known drift, not fixed yet (design-next/render-drift-080.md): " + "; ".join(sorted(known)))


def _run(h, edits, label):
    """Apply `edits` ([(name, act)]); compare at the end (or after every step with ANNZARRO_DRIFT_EACH)."""
    try:
        for name, act in edits:
            if h.step(name, act) and EACH:
                _verdict(h, label, False)
        _verdict(h, label, True)
    finally:
        h.close()


def _walk(h, rng, vocabulary, steps, label):
    """A seeded random walk: `steps` edits drawn from `vocabulary` ([(name, factory(rng) -> (name, act))])."""
    edits = []
    tries = 0
    while len(h.steps) < steps and tries < steps * 6:
        tries += 1
        name, act = rng.choice(vocabulary)(rng)
        if h.step(name, act) and EACH:
            _verdict(h, label, False)
        edits.append(name)
    try:
        _verdict(h, label, True)
    finally:
        h.close()


# ------------------------------------------------------------------ editing helpers

def _update(pid, patch):
    """The panel's public updateConfig with a whole config (the path Back and Forward take): one edit."""
    def act(page):
        page.evaluate("""([id, patch]) => { const p = window.PanelManager.getPanel(id);
            const c = JSON.parse(JSON.stringify(p.getConfig()));
            for (const [k, v] of Object.entries(patch)) { if (v === null) delete c[k]; else c[k] = v; }
            p.updateConfig(c); }""", [pid, patch])
    return act


def _focus_cell(name):
    def act(page):
        page.evaluate("async (n) => (await import('/static/js/data-manager.js')).DataManager.setFocusedCell(n)", name)
    return act


def _focus_gene(name):
    def act(page):
        page.evaluate("async (n) => (await import('/static/js/data-manager.js')).DataManager.setFocusedGene(n)", name)
    return act


def _usable(page, sel):
    return page.evaluate("""(s) => { const e = document.querySelector(s);
        return !!e && !e.disabled && e.offsetParent !== null && !e.closest('[hidden]'); }""", sel)


def _select(sel, value):
    def act(page):
        if not _usable(page, sel):
            return False
        ok = page.evaluate("""([s, v]) => { const e = document.querySelector(s);
            const o = [...e.options].find((o) => o.value === v && !o.disabled); return !!o && e.value !== v; }""", [sel, value])
        if not ok:
            return False
        page.select_option(sel, value)
    return act


def _click(sel):
    def act(page):
        if not _usable(page, sel):
            return False
        page.click(sel)
    return act


def _fill(sel, value):
    def act(page):
        if not _usable(page, sel):
            return False
        page.fill(sel, str(value))
        page.press(sel, "Tab")
    return act


# ================================================================== Count Plot

CT = {"source": {"type": "obs", "key": "cell_type"}}
COND = {"source": {"type": "obs", "key": "condition"}}
SCORE = {"source": {"type": "obs", "key": "score"}}
DEPTH = {"source": {"type": "obs", "key": "depth"}}
PSEUDO = {"source": {"type": "obs", "key": "pseudotime"}}
C_TILE = TILE.format(CC)


def _count_config(**extra):
    return {"id": CC, "title": "Count 1", "version": 1, "mode": "bar", "x": CT, "split": COND, **extra}


def _count(browser, served, **extra):
    return Harness(browser, served, CC, "cell-count", {CC: _count_config(**extra)}, [CC])


def _count_mode(mode):
    return _select(f"{C_TILE} .ccnt-mode", mode)


COUNT_MODES = ["bar", "histogram", "hist2d", "density", "density2d", "pie", "heatmap"]
COUNT_VOCABULARY = [
    lambda r: (lambda m: (f"mode {m} (control)", _count_mode(m)))(r.choice(COUNT_MODES)),
    lambda r: (lambda m: (f"mode {m} (control)", _count_mode(m)))(r.choice(COUNT_MODES)),
    lambda r: ("undo (control)", _click(f"{C_TILE} .ccnt-undo")),
    lambda r: (lambda x: (f"x {x['source']['key']}", _update(CC, {"x": x})))(r.choice([CT, COND, SCORE, DEPTH])),
    lambda r: (lambda y: (f"y {y['source']['key']}", _update(CC, {"y": y})))(r.choice([SCORE, DEPTH, PSEUDO, CT])),
    lambda r: (lambda s: (f"split {s and s['source']['key']}", _update(CC, {"split": s})))(r.choice([None, COND, CT])),
    lambda r: (lambda a: (f"arrangement {a}", _update(CC, {"arrangement": a})))(r.choice(["stack", "dodge", "overlay", "fill"])),
    lambda r: (lambda v: (f"labels {v}", _update(CC, {"labels": v})))(r.choice(["none", "count", "share"])),
    lambda r: (lambda k, v: (f"{k} {v}", _update(CC, {k: v})))(r.choice(["reverse", "horizontal", "log", "ring", "fade"]), r.choice([True, None])),
    lambda r: (lambda v: (f"sort {v}", _update(CC, {"sort": v})))(r.choice(["height", None])),
    lambda r: (lambda v: (f"adjust {v}", _update(CC, {"adjust": v})))(r.choice([0.5, 1, 2])),
    lambda r: (lambda v: (f"scale {v}", _update(CC, {"scale": v})))(r.choice(["level", "size"])),
    lambda r: (lambda v: (f"layers {v}", _update(CC, {"layers": v})))(
        r.choice([{"image": True}, {"lines": True}, {"fill": True}, {"fill": True, "lines": True}, {"image": True, "points": True},
                  {"lines": True, "points": True}])),
    lambda r: (lambda v: (f"pointSize {v}", _update(CC, {"pointSize": v})))(r.choice([2, 6])),
    lambda r: (lambda v: (f"color {v}", _update(CC, {"color": v})))(
        r.choice([None, {"map": "Reds"}, {"map": "RdBu", "reverse": True}, {"min": 0, "max": 50}, {"palette": "tab10"}])),
]


@pytest.mark.parametrize("seed", range(SEEDS))
def test_count_plot_random_walk(browser, served, seed):
    _walk(_count(browser, served), random.Random(1000 + seed), COUNT_VOCABULARY, STEPS, f"count plot, seed {seed}")


COUNT_RISKY = {
    "color-by-off-and-on": [("split none", _update(CC, {"split": None})), ("split condition", _update(CC, {"split": COND})),
                            ("split none", _update(CC, {"split": None}))],
    "density-layers": [("x score", _update(CC, {"x": SCORE})), ("y depth", _update(CC, {"y": DEPTH})),
                       ("mode density2d (control)", _count_mode("density2d")),
                       ("layers image", _update(CC, {"layers": {"image": True}})),
                       ("layers lines+points", _update(CC, {"layers": {"lines": True, "points": True}})),
                       ("layers fill", _update(CC, {"layers": {"fill": True}})),
                       ("split none", _update(CC, {"split": None})),
                       ("layers image+lines", _update(CC, {"layers": {"image": True, "lines": True}}))],
    "modes-round-trip": [("mode pie (control)", _count_mode("pie")), ("mode heatmap (control)", _count_mode("heatmap")),
                         ("mode histogram (control)", _count_mode("histogram")), ("mode bar (control)", _count_mode("bar"))],
    "mode-and-undo": [("x score", _update(CC, {"x": SCORE})), ("y depth", _update(CC, {"y": DEPTH})),
                      ("mode hist2d (control)", _count_mode("hist2d")), ("mode density (control)", _count_mode("density")),
                      ("undo (control)", _click(f"{C_TILE} .ccnt-undo")), ("undo (control)", _click(f"{C_TILE} .ccnt-undo"))],
}


@pytest.mark.parametrize("name", sorted(COUNT_RISKY))
def test_count_plot_risky_sequence(browser, served, name):
    _run(_count(browser, served), COUNT_RISKY[name], f"count plot, {name}")


# the views follow the X axis type (0.8.0): a link stored as a Histogram of categories opens as a Bar; edited from there,
# through a number (a Histogram), its arrangements and back, it draws what the fresh link of its final config draws
COUNT_VIEWS = [("arrangement overlay", _update(CC, {"arrangement": "overlay"})), ("x score", _update(CC, {"x": SCORE})),
               ("mode histogram (control)", _count_mode("histogram")), ("arrangement dodge", _update(CC, {"arrangement": "dodge"})),
               ("arrangement fill", _update(CC, {"arrangement": "fill"})), ("undo (control)", _click(f"{C_TILE} .ccnt-undo")),
               ("x cell_type", _update(CC, {"x": CT}))]


def test_count_plot_histogram_link_of_categories_and_the_views(browser, served):
    _run(_count(browser, served, mode="histogram", arrangement="dodge"), COUNT_VIEWS, "count plot, views by X")


# ================================================================== Cell-Gene Plot

G_TILE = TILE.format(CG)


def _gene_config(**extra):
    return {"id": CG, "title": "Cell-Gene 1", "version": 1, "mode": "dots", "cellAxis": {"type": "obs", "key": "cell_type"},
            "sections": [{"source": S1, "rows": "genes"}], "color": {"stat": "mean", "layer": "logged"},
            "size": {"stat": "pct_expressing", "layer": "logged"}, **extra}


def _cell_gene(browser, served, **extra):
    configs = {CG: _gene_config(**extra), S1: {"id": S1, "title": "Markers A", "genes": GENES[0:5]},
               S2: {"id": S2, "title": "Markers B", "genes": GENES[10:13]}}
    return Harness(browser, served, CG, "cell-gene", configs, [CG, S1, S2])


def _cg_mode(mode):
    return _click(f"{G_TILE} .cgene-mode input[value='{mode}']")


def _cg_remove(index):
    def act(page):
        sec = page.locator(f"{G_TILE} .cgene-section")
        if sec.count() <= index:
            return False
        sec.nth(index).locator(".cgene-section__menu-btn").click()
        page.locator(f"{G_TILE} .cgene-section__menu:not([hidden]) .cgene-section__menu-item[data-op='remove']").click()
    return act


def _cg_add_section(rows):
    return _update(CG, {"sections": [{"source": S1, "rows": "genes"}, {"source": S2, "rows": rows}]})


CELL_GENE_VOCABULARY = [
    lambda r: (lambda m: (f"mode {m} (control)", _cg_mode(m)))(r.choice(["dots", "heatmap"])),
    lambda r: (lambda m: (f"mode {m} (control)", _cg_mode(m)))(r.choice(["dots", "heatmap"])),
    lambda r: (lambda s: (f"scale {s} (control)", _select(f"{G_TILE} .cgene-scale", s)))(r.choice(["none", "var", "group", "z_groups", "z_pooled"])),
    lambda r: (lambda s: (f"color {s} (control)", _select(f"{G_TILE} .cgene-color", s)))(r.choice(["mean", "pct_expressing", "sum", "sd"])),
    lambda r: ("3D (control)", _click(f"{G_TILE} .cgene-3d-btn")),
    lambda r: ("undo (control)", _click(f"{G_TILE} .cgene-undo")),
    lambda r: ("remove section 2 (control)", _cg_remove(1)),
    lambda r: (lambda rows: (f"add section ({rows})", _cg_add_section(rows)))(r.choice(["genes", "set"])),
    lambda r: (lambda v: (f"swap {v}", _update(CG, {"swap": v})))(r.choice([True, None])),
    lambda r: (lambda v: (f"cellAxis {v}", _update(CG, {"cellAxis": {"type": "obs", "key": v}})))(r.choice(["cell_type", "condition"])),
    lambda r: (lambda v: (f"colorScale {v}", _update(CG, {"colorScale": v})))(r.choice([None, "Viridis", "RdBu"])),
    lambda r: (lambda v: (f"reverse {v}", _update(CG, {"reverse": v})))(r.choice([True, None])),
    lambda r: (lambda v: (f"limits {v}", _update(CG, {"limits": v})))(r.choice([None, [0, 1], [None, 2]])),
    lambda r: (lambda v: (f"printValues {v}", _update(CG, {"printValues": v})))(r.choice([True, None])),
    lambda r: (lambda v: (f"dotSizes {v}", _update(CG, {"dotSizes": v})))(r.choice([None, [5, 30]])),
    lambda r: (lambda v: (f"gap {v}", _update(CG, {"gap": v})))(r.choice([None, 0, 3])),
    lambda r: (lambda v: (f"totals {v}", _update(CG, {"totals": v})))(r.choice([True, None])),
    lambda r: (lambda v: (f"legend {v}", _update(CG, {"legend": v})))(r.choice([None, {"colorBar": False}, {"sizeLegend": False, "strips": False}])),
    lambda r: (lambda v: (f"cluster {v}", _update(CG, {"cluster": v})))(r.choice([None, {"genes": "sections"}, {"groups": "all"}, {"genes": "sections", "groups": "all"}])),
]


@pytest.mark.parametrize("seed", range(SEEDS))
def test_cell_gene_plot_random_walk(browser, served, seed):
    _walk(_cell_gene(browser, served), random.Random(2000 + seed), CELL_GENE_VOCABULARY, STEPS, f"cell-gene plot, seed {seed}")


CELL_GENE_RISKY = {
    "dots-heatmap-dots": [("mode heatmap (control)", _cg_mode("heatmap")), ("mode dots (control)", _cg_mode("dots")),
                          ("mode heatmap (control)", _cg_mode("heatmap")), ("mode dots (control)", _cg_mode("dots"))],
    "remove-section-and-undo": [("add section (set)", _cg_add_section("set")), ("remove section 2 (control)", _cg_remove(1)),
                                ("undo (control)", _click(f"{G_TILE} .cgene-undo"))],
    "3d-on-and-off": [("3D (control)", _click(f"{G_TILE} .cgene-3d-btn")), ("mode heatmap (control)", _cg_mode("heatmap")),
                      ("3D (control)", _click(f"{G_TILE} .cgene-3d-btn")), ("mode dots (control)", _cg_mode("dots"))],
    # the plot kept drawing the old column's groups (its own 'axis:' source was never told): fixed in cell-gene.js
    "groups-column-change-and-undo": [("groups condition (control)", _select(f"{G_TILE} .cgene-axis-key", "condition")),
                                      ("undo (control)", _click(f"{G_TILE} .cgene-undo")),
                                      ("groups condition, as Back or Forward", _update(CG, {"cellAxis": {"type": "obs", "key": "condition"}}))],
    "clustered-heatmap-back-to-dots": [("cluster genes and groups", _update(CG, {"cluster": {"genes": "sections", "groups": "all"}})),
                                       ("mode heatmap (control)", _cg_mode("heatmap")), ("cluster none", _update(CG, {"cluster": None})),
                                       ("mode dots (control)", _cg_mode("dots"))],
}


@pytest.mark.parametrize("name", sorted(CELL_GENE_RISKY))
def test_cell_gene_plot_risky_sequence(browser, served, name):
    _run(_cell_gene(browser, served), CELL_GENE_RISKY[name], f"cell-gene plot, {name}")


# ================================================================== Cell Plot and Gene Plot (plot-utilities)

def _axis(pid, axis, field):
    """Choose a field in the axis's type, key and column selects, as a user does; False when one is not offered."""
    base = f'{TILE.format(pid)} '

    def act(page):
        t = base + f'.axis-type-select[data-axis="{axis}"]'
        if not _usable(page, t):
            return False
        cur = page.evaluate("""([b, a]) => ['type', 'key', 'column'].map((k) => {
            const e = document.querySelector(b + `.axis-${k}-select[data-axis="${a}"]`); return e ? e.value : ''; })""", [base, axis])
        if cur == [field["type"], field.get("key", ""), field.get("column", "")]:
            return False
        offered = page.evaluate("([s, v]) => [...document.querySelector(s).options].some((o) => o.value === v && !o.disabled)", [t, field["type"]])
        if not offered:
            return False
        if cur[0] != field["type"]:
            page.select_option(t, field["type"])
        if field["type"] == "none":
            return None
        key = base + f'.axis-key-select[data-axis="{axis}"]'
        page.wait_for_function("([s, v]) => [...document.querySelector(s).options].some((o) => o.value === v)", arg=[key, field["key"]])
        if page.input_value(key) != field["key"]:
            page.select_option(key, field["key"])
        if field.get("column"):
            col = base + f'.axis-column-select[data-axis="{axis}"]'
            page.wait_for_function("([s, v]) => [...document.querySelector(s).options].some((o) => o.value === v)", arg=[col, field["column"]])
            if page.input_value(col) != field["column"]:
                page.select_option(col, field["column"])
    return act


def _menu_control(pid, prefix, how, value=None):
    """A control of the plot's toolbar or of its Plot Options menu (opened, every group unfolded, when needed)."""
    sel = f"#{prefix}-{pid}"

    def act(page):
        if not page.query_selector(sel) or not _usable(page, sel):
            if page.query_selector(f"#aesthetics-menu-btn-{pid}") and not page.query_selector(f"details[data-panel='{pid}']"):
                page.click(f"#aesthetics-menu-btn-{pid}")
                page.wait_for_selector(f"details[data-panel='{pid}']", state="visible")
            for d in page.query_selector_all(f"details[data-panel='{pid}']"):
                if not d.evaluate("e => e.open"):
                    d.query_selector("summary").click()
        if not page.query_selector(sel) or not _usable(page, sel):
            return False
        if how == "toggle":
            if page.evaluate("(s) => document.querySelector(s).type === 'checkbox'", sel):
                page.set_checked(sel, not page.is_checked(sel))
            else:
                page.click(sel)
        elif how == "select":
            ok = page.evaluate("""([s, v]) => { const e = document.querySelector(s);
                return [...e.options].some((o) => o.value === v && !o.disabled) && e.value !== v; }""", [sel, value])
            if not ok:
                return False
            page.select_option(sel, value)
        elif how == "fill":
            if page.input_value(sel) == str(value):
                return False
            page.fill(sel, str(value))
            page.press(sel, "Tab")
    return act


def _plot_options_vocabulary(pid):
    """The options the Cell and Gene Plots share: colour map, range, points, axes, legend, grid."""
    return [
        lambda r: (lambda v: (f"colour map {v}", _menu_control(pid, "color-scale", "select", v)))(r.choice(["Viridis", "Reds", "RdBu", "Portland"])),
        lambda r: ("reverse colour map", _menu_control(pid, "reverse-colormap", "toggle")),
        lambda r: ("log colour", _menu_control(pid, "log-color", "toggle")),
        lambda r: ("lock colour range", _menu_control(pid, "lock-range", "toggle")),
        lambda r: (lambda v: (f"colour min {v}", _menu_control(pid, "color-min", "fill", v)))(r.choice(["0", "0.5", ""])),
        lambda r: (lambda v: (f"colour max {v}", _menu_control(pid, "color-max", "fill", v)))(r.choice(["1", "3", ""])),
        lambda r: (lambda v: (f"palette {v}", _menu_control(pid, "category-palette", "select", v)))(r.choice(["uns", "tab10", "Set1", "Dark2"])),
        lambda r: ("hide NaN", _menu_control(pid, "hide-nan", "toggle")),
        lambda r: ("sort by colour", _menu_control(pid, "sort-by-color", "toggle")),
        lambda r: (lambda v: (f"point size {v}", _menu_control(pid, "point-size-input", "fill", v)))(r.choice([3, 8])),
        lambda r: (lambda v: (f"point opacity {v}", _menu_control(pid, "point-opacity-input", "fill", v)))(r.choice([0.4, 1])),
        lambda r: ("flip x", _menu_control(pid, "flip-x", "toggle")),
        lambda r: ("flip y", _menu_control(pid, "flip-y", "toggle")),
        lambda r: ("equal aspect", _menu_control(pid, "equal-aspect", "toggle")),
        lambda r: ("grid", _menu_control(pid, "grid-toggle", "toggle")),
        lambda r: ("legend", _menu_control(pid, "show-legend", "toggle")),
        lambda r: (lambda v: (f"legend position {v}", _menu_control(pid, "legend-position", "select", v)))(r.choice(["right", "bottom", "top-left"])),
        lambda r: ("highlight focused", _menu_control(pid, "highlight-focused-cell", "toggle")),
        lambda r: ("3D (toolbar)", _menu_control(pid, "z-axis-toggle", "toggle")),
    ]


UMAP = lambda c: {"type": "obsm", "key": "X_umap", "column": str(c)}  # noqa: E731
WIDE = lambda c: {"type": "obsm", "key": "X_wide", "column": str(c)}  # noqa: E731
OBS = lambda k: {"type": "obs", "key": k, "column": ""}  # noqa: E731
NONE = {"type": "none", "key": "", "column": ""}


def _cell_plot_config(**extra):
    return {"id": CP, "title": "Cell Plot 1", "x": UMAP(0), "y": UMAP(1), "z": None, "color": OBS("cell_type"), **extra}


def _cell_plot(browser, served, **extra):
    return Harness(browser, served, CP, "plot", {CP: _cell_plot_config(**extra)}, [CP], constants={"focusedGene": GENES[3]})


CELL_PLOT_VOCABULARY = [
    lambda r: (lambda f: (f"colour {f['type']} {f['key']}", _axis(CP, "color", f)))(
        r.choice([NONE, OBS("cell_type"), OBS("score"), OBS("condition"), OBS("pseudotime"), {"type": "layer", "key": "logged", "column": ""}])),
    lambda r: (lambda f: (f"colour {f['type']} {f['key']}", _axis(CP, "color", f)))(r.choice([NONE, OBS("cell_type"), OBS("score")])),
    lambda r: (lambda f: (f"x {f['type']} {f['key']} {f['column']}", _axis(CP, "x", f)))(r.choice([UMAP(0), UMAP(1), WIDE(2), OBS("score")])),
    lambda r: (lambda f: (f"y {f['type']} {f['key']} {f['column']}", _axis(CP, "y", f)))(r.choice([UMAP(1), UMAP(0), WIDE(3), OBS("depth")])),
    lambda r: (lambda g: (f"focus gene {g}", _focus_gene(g)))(r.choice(GENES[:8])),
    lambda r: (lambda c: (f"focus cell {c}", _focus_cell(c)))(r.choice(CELLS)),
] + _plot_options_vocabulary(CP)


@pytest.mark.parametrize("seed", range(SEEDS))
def test_cell_plot_random_walk(browser, served, seed):
    _walk(_cell_plot(browser, served), random.Random(3000 + seed), CELL_PLOT_VOCABULARY, STEPS, f"cell plot, seed {seed}")


CELL_PLOT_RISKY = {
    "colour-by-off-and-on": [("colour none", _axis(CP, "color", NONE)), ("colour obs score", _axis(CP, "color", OBS("score"))),
                             ("colour none", _axis(CP, "color", NONE)), ("colour obs cell_type", _axis(CP, "color", OBS("cell_type")))],
    "3d-on-and-off": [("3D (toolbar)", _menu_control(CP, "z-axis-toggle", "toggle")), ("colour obs score", _axis(CP, "color", OBS("score"))),
                      ("3D (toolbar)", _menu_control(CP, "z-axis-toggle", "toggle"))],
    "categorical-to-numeric-and-back": [("colour obs score", _axis(CP, "color", OBS("score"))), ("colour map RdBu", _menu_control(CP, "color-scale", "select", "RdBu")),
                                        ("colour obs cell_type", _axis(CP, "color", OBS("cell_type")))],
    "axis-swap": [("x obsm X_umap 1", _axis(CP, "x", UMAP(1))), ("y obsm X_umap 0", _axis(CP, "y", UMAP(0)))],
    "point-style-then-colour": [("point size 9", _menu_control(CP, "point-size-input", "fill", 9)),
                                ("point opacity 0.3", _menu_control(CP, "point-opacity-input", "fill", 0.3)),
                                ("colour obs score", _axis(CP, "color", OBS("score")))],
}


@pytest.mark.parametrize("name", sorted(CELL_PLOT_RISKY))
def test_cell_plot_risky_sequence(browser, served, name):
    _run(_cell_plot(browser, served), CELL_PLOT_RISKY[name], f"cell plot, {name}")


@pytest.mark.parametrize("seed", range(SEEDS))
def test_cell_plot_large_mode_random_walk(browser, served_large, seed):
    _walk(_cell_plot(browser, served_large), random.Random(4000 + seed), CELL_PLOT_VOCABULARY, STEPS, f"large cell plot, seed {seed}")


@pytest.mark.parametrize("name", sorted(CELL_PLOT_RISKY))
def test_cell_plot_large_mode_risky_sequence(browser, served_large, name):
    _run(_cell_plot(browser, served_large), CELL_PLOT_RISKY[name], f"large cell plot, {name}")


# ------------------------------------------------------------------ Gene Plot

ROW = lambda layer: {"type": "layer", "key": layer, "column": ""}  # noqa: E731
VAR = lambda k: {"type": "var", "key": k, "column": ""}  # noqa: E731


def _gene_plot(browser, served, **extra):
    cell = CELLS[1]
    cfg = {"id": GP, "title": "Gene Plot 1", "x": {"type": "layer", "key": "logged", "column": cell},
           "y": {"type": "layer", "key": "X", "column": cell}, "z": None, "color": VAR("gene_name"), **extra}
    return Harness(browser, served, GP, "plot", {GP: cfg}, [GP], constants={"focusedCell": cell})


GENE_PLOT_VOCABULARY = [
    lambda r: (lambda f: (f"colour {f['type']} {f['key']}", _axis(GP, "color", f)))(r.choice([NONE, VAR("gene_name"), ROW("counts"), ROW("logged")])),
    lambda r: (lambda f: (f"x {f['type']} {f['key']}", _axis(GP, "x", f)))(r.choice([ROW("logged"), ROW("counts"), ROW("X")])),
    lambda r: (lambda f: (f"y {f['type']} {f['key']}", _axis(GP, "y", f)))(r.choice([ROW("X"), ROW("counts"), ROW("logged")])),
    lambda r: (lambda c: (f"focus cell {c}", _focus_cell(c)))(r.choice(CELLS)),
    lambda r: (lambda g: (f"focus gene {g}", _focus_gene(g)))(r.choice(GENES[:8])),
] + _plot_options_vocabulary(GP)


@pytest.mark.parametrize("seed", range(SEEDS))
def test_gene_plot_random_walk(browser, served, seed):
    _walk(_gene_plot(browser, served), random.Random(5000 + seed), GENE_PLOT_VOCABULARY, STEPS, f"gene plot, seed {seed}")


GENE_PLOT_RISKY = {
    "colour-by-off-and-on": [("colour none", _axis(GP, "color", NONE)), ("colour layer counts", _axis(GP, "color", ROW("counts"))),
                             ("colour none", _axis(GP, "color", NONE)), ("colour var gene_name", _axis(GP, "color", VAR("gene_name")))],
    "3d-on-and-off": [("3D (toolbar)", _menu_control(GP, "z-axis-toggle", "toggle")), ("3D (toolbar)", _menu_control(GP, "z-axis-toggle", "toggle"))],
    "focus-moves-the-axes": [("focus cell", _focus_cell(CELLS[5])), ("colour layer counts", _axis(GP, "color", ROW("counts"))),
                             ("focus cell", _focus_cell(CELLS[7]))],
}


@pytest.mark.parametrize("name", sorted(GENE_PLOT_RISKY))
def test_gene_plot_risky_sequence(browser, served, name):
    _run(_gene_plot(browser, served), GENE_PLOT_RISKY[name], f"gene plot, {name}")


# ================================================================== the harness itself

def _stray(pid, js):
    def act(page):
        page.evaluate("([s, js]) => { const gd = document.querySelector(s + ' .js-plotly-plot'); return (0, eval)(js)(gd); }",
                      [TILE.format(pid), js])
    return act


@pytest.mark.parametrize("case", ["count-relayout", "cell-plot-restyle"])
def test_the_harness_sees_a_stale_key(browser, served, case):
    """A key left by a stray Plotly call, as an incremental path could leave it, is a difference: the harness is not blind."""
    if case == "count-relayout":
        h, pid, js = _count(browser, served), CC, "(gd) => Plotly.relayout(gd, {'xaxis.showgrid': false, 'xaxis.title.text': 'stale'})"
    else:
        h, pid, js = _cell_plot(browser, served), CP, "(gd) => Plotly.restyle(gd, {'marker.symbol': 'square'}, [0])"
    try:
        assert h.step("stray Plotly call", _stray(pid, js))
        unknown, known, errors, msg = h.check(case)
        assert unknown, "the stray key was not seen"
    finally:
        h.close()
