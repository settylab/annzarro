"""The grouping fixture (0.8.0): 1,200 cells x 40 genes in every layout and backend, and brute-force references.

One source of truth for the engine tests (E1 to E6), the browser tests and the JS tests. The store is
written like ``gene_score_store`` (zarr, or .h5ad through ``h5ad_twin``; X as csc, csr or dense); the data
themselves come from ``make_data()``, which is deterministic, so a reference computed from it is the
expected value for every layout.

obs (SHR terms in brackets):
  cell_type    6 levels of 500, 300, 200, 150, 45 and 5 cells (the 5 is under the small-group threshold)
  condition    2 levels
  sample       30 levels of 40 cells, ONE of them called "other" (typed ids: ``c:other`` is not ``@other``)
  many         2,001 declared levels, one per cell for the first 1,200 (over the 2,000 limit, SHR-6)
  pseudotime   float64, 25 distinct values (heavy ties) and 20 missing
  depth        float64, 60% exact zeros (zero bin, SHR-15)
  constant     float64, every cell 2.5 (degenerate data, SHR-46)
  signed       float64, both signs (no zero bin, SHR-15)
  is_doublet   boolean
  batch        int64, 12 distinct values (the ``categories`` method)
  score        float64, continuous
layers: X (scaled, signed), ``logged`` (log1p, non-negative), ``counts`` (integers).
obsm: ``X_umap`` (2 wide) and ``X_wide`` (50 wide). obsp: ``connectivities`` (1,200 x 1,200 csr).

``reference_groups`` and ``reference_grid`` are the brute-force references for the two request shapes of the
plan (section 1.2), written with pandas and numpy only and without ``core/binning.py`` or ``core/cell_groups.py``.
``build_expected`` writes the numbers of the named recipes to ``tests/data/grouping_expected.json`` (and the
columns to ``tests/js/fixtures/grouping_columns.json`` for the browser tests); a test fails when either file is
stale. Regenerate both with ``python -m annzarro.tests.core.grouping_store``.

Conventions the references fix, where the plan leaves a choice to the engine:
  * ids follow plan 1.6: ``c:<canonical text>``, ``bin:<i>``, ``@zero``, ``@in``, ``@out``, ``@other``, ``@na``;
  * groups are the occupied combinations in SHR-10 order; a grid lists the whole product of its axes, whose
    categorical and binned levels are all of them (kept or not) and whose ``@other``, ``@na``, ``@zero`` levels
    exist only when a cell is in them;
  * a small group is one with fewer cells than the threshold; ``collect`` puts them in ``["@small"]``, last;
  * moments per group are ``n`` (finite values), ``sum``, ``sumsq``, ``n_above`` (> detect_above) and ``sum_above``.
"""
import json
import math
import os
import shutil
from functools import lru_cache

import numpy as np
import pandas as pd
import scipy.sparse as sp

from annzarro.tests import zarr_compat
from annzarro.tests.core.gene_score_store import FIXTURE, LAYOUTS, BACKENDS, _write_matrix  # noqa: F401
from annzarro.tests.core.h5ad_twin import h5ad_twin

TESTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPECTED_PATH = os.path.join(TESTS, "data", "grouping_expected.json")
COLUMNS_PATH = os.path.join(TESTS, "js", "fixtures", "grouping_columns.json")

N_OBS, N_VAR = 1200, 40
CELL_TYPES = [("B cell", 500), ("T cell", 300), ("NK cell", 200), ("Monocyte", 150), ("Dendritic", 45), ("Platelet", 5)]
CONDITIONS = ["ctrl", "treated"]
N_SAMPLES = 30
OTHER_SAMPLE = 7                      # the sample (index) that is called "other"
N_MANY = 2001
GROUP_LIMIT = 2000
SMALL_THRESHOLD = 10


def gene(i):
    return f"GENE{i:03d}"


def cell(i):
    return f"CELL{i:04d}"


# --- the data ----------------------------------------------------------------------------------------------

class GroupingData:
    """The fixture in memory. ``obs`` is a DataFrame (categoricals as ``category`` dtype, the missing as NaN);
    ``x``, ``logged`` and ``counts`` are float32 (N_OBS, N_VAR)."""

    def __init__(self, obs, x, logged, counts, obsm, obsp):
        self.obs, self.x, self.logged, self.counts, self.obsm, self.obsp = obs, x, logged, counts, obsm, obsp
        self.var_names = [gene(i) for i in range(N_VAR)]
        self.obs_names = [cell(i) for i in range(N_OBS)]

    def layer(self, name):
        return {"X": self.x, "logged": self.logged, "counts": self.counts}[name]


def sample_names():
    return [f"S{i:02d}" if i != OTHER_SAMPLE else "other" for i in range(N_SAMPLES)]


@lru_cache(maxsize=1)
def make_data(seed=11):
    rng = np.random.default_rng(seed)
    cell_type = np.repeat([n for n, _ in CELL_TYPES], [k for _, k in CELL_TYPES])
    assert len(cell_type) == N_OBS
    perm = rng.permutation(N_OBS)
    cell_type = cell_type[perm]
    condition = np.array(CONDITIONS)[(rng.random(N_OBS) < 0.45).astype(int)]
    sample = np.array(sample_names())[rng.permutation(np.repeat(np.arange(N_SAMPLES), N_OBS // N_SAMPLES))]
    many = np.array([f"m{i:04d}" for i in range(N_MANY)])
    pseudotime = np.round(rng.random(N_OBS) * 24) / 24
    pseudotime[rng.choice(N_OBS, 20, replace=False)] = np.nan
    depth = rng.gamma(2.0, 1.5, N_OBS) * (rng.random(N_OBS) >= 0.6)
    obs = pd.DataFrame({
        "cell_type": pd.Categorical(cell_type, categories=[n for n, _ in CELL_TYPES]),
        "condition": pd.Categorical(condition, categories=CONDITIONS),
        "sample": pd.Categorical(sample, categories=sample_names()),
        "many": pd.Categorical(many[np.arange(N_OBS)], categories=many),
        "pseudotime": pseudotime,
        "depth": depth,
        "constant": np.full(N_OBS, 2.5),
        "signed": rng.normal(0.0, 1.0, N_OBS),
        "is_doublet": rng.random(N_OBS) < 0.05,
        "batch": rng.integers(0, 12, N_OBS).astype(np.int64),
        "score": rng.normal(5.0, 2.0, N_OBS),
    }, index=[cell(i) for i in range(N_OBS)])
    obs.loc[obs.index[:12], "batch"] = np.arange(12)          # all 12 values occur whatever the seed
    # expression: cell types differ in a block of genes, so groups differ
    type_code = obs["cell_type"].cat.codes.to_numpy()
    rate = rng.uniform(0.2, 3.0, N_VAR)[None, :] * (1.0 + 0.8 * (np.arange(N_VAR)[None, :] % 6 == type_code[:, None]))
    dropout = rng.random((N_OBS, N_VAR)) < 0.35
    counts = np.where(dropout, 0, rng.poisson(rate)).astype(np.float32)
    counts[:, 3] = 0                                         # a gene nobody expresses
    logged = np.log1p(counts / np.maximum(counts.sum(axis=1, keepdims=True), 1) * 1e4).astype(np.float32)
    sd = logged.std(axis=0)
    x = ((logged - logged.mean(axis=0)) / np.where(sd > 0, sd, 1.0)).astype(np.float32)
    x = np.clip(x, -10, 10)
    umap = rng.normal(0, 1, (N_OBS, 2)).astype(np.float32)
    wide = rng.normal(0, 1, (N_OBS, 50)).astype(np.float32)
    conn = np.zeros((N_OBS, N_OBS), dtype=np.float32)
    for i in range(N_OBS):
        nbrs = rng.choice(N_OBS, 12, replace=False)
        conn[i, nbrs] = rng.random(12).astype(np.float32) + 0.1
    return GroupingData(obs, x, logged, counts, {"X_umap": umap, "X_wide": wide}, conn)


# --- gene sets ---------------------------------------------------------------------------------------------

GENE_SETS = {
    "b_markers": [gene(i) for i in range(0, 12)],
    "t_markers": [gene(i) for i in range(12, 24)],
    "with_missing": [gene(i) for i in range(24, 33)] + ["NOGENE1", "NOGENE2", "NOGENE3"],     # 9 present, 3 absent
    "all": [gene(i) for i in range(N_VAR)],
}
SIGNATURES = {
    "up_only": {"up": GENE_SETS["b_markers"], "down": []},
    "up_and_down": {"up": GENE_SETS["b_markers"][:8], "down": GENE_SETS["t_markers"][:4]},
}


# --- the store ---------------------------------------------------------------------------------------------

def _enc(node, kind, version):
    node.attrs.update({"encoding-type": kind, "encoding-version": version})
    return node


def _write_obs(root, obs):
    obs_g = _enc(root.create_group("obs"), "dataframe", "0.2.0")
    obs_g.attrs["_index"] = "_index"
    obs_g.attrs["column-order"] = list(obs.columns)
    _enc(zarr_compat.write_strings(obs_g, "_index", list(obs.index)), "string-array", "0.2.0")
    for name in obs.columns:
        col = obs[name]
        if isinstance(col.dtype, pd.CategoricalDtype):
            g = _enc(obs_g.create_group(name), "categorical", "0.2.0")
            g.attrs["ordered"] = False
            dtype = np.int8 if len(col.cat.categories) < 127 else np.int16
            zarr_compat.write_array(g, "codes", col.cat.codes.to_numpy().astype(dtype), chunks=(512,))
            _enc(zarr_compat.write_strings(g, "categories", list(col.cat.categories)), "string-array", "0.2.0")
        else:
            _enc(zarr_compat.write_array(obs_g, name, col.to_numpy(), chunks=(512,)), "array", "0.2.0")


def make_store(path, layout="csc", backend="zarr", data=None):
    """Write the fixture at ``path`` (a .zarr or .h5ad path), X and the layers stored as ``layout``; return it."""
    data = data or make_data()
    path = str(path)
    zpath = path if backend == "zarr" else path + ".src.zarr"
    shutil.rmtree(zpath, ignore_errors=True)
    shutil.copytree(FIXTURE, zpath)
    root = zarr_compat.open_group(zpath, mode="r+")
    for name in ("X", "obs", "var", "obsm"):
        del root[name]
    _write_matrix(root, "X", data.x, layout)
    layers = root["layers"]
    _write_matrix(layers, "logged", data.logged, layout)
    _write_matrix(layers, "counts", data.counts, layout)
    _write_obs(root, data.obs)
    var = _enc(root.create_group("var"), "dataframe", "0.2.0")
    var.attrs["_index"] = "_index"
    var.attrs["column-order"] = ["gene_name"]
    _enc(zarr_compat.write_strings(var, "_index", data.var_names), "string-array", "0.2.0")
    _enc(zarr_compat.write_strings(var, "gene_name", data.var_names), "string-array", "0.2.0")
    obsm = _enc(root.create_group("obsm"), "dict", "0.1.0")
    for key, arr in data.obsm.items():
        _write_matrix(obsm, key, arr, "dense")
    _write_matrix(root["obsp"], "connectivities", data.obsp, "csr")
    zarr_compat.consolidate(zpath)
    if backend == "zarr":
        return path
    h5ad_twin(zpath, path)
    shutil.rmtree(zpath, ignore_errors=True)
    return path


# --- ids ---------------------------------------------------------------------------------------------------

def ecma_number_text(v):
    """``Number.prototype.toString`` of a finite float: shortest round-trip digits, plain decimals for
    1e-6 <= |v| < 1e21, otherwise d.ddde+x with no padding in the exponent."""
    v = float(v)
    if v == 0:
        return "0"
    sign = "-" if v < 0 else ""
    digits, exp = repr(abs(v)), 0
    if "e" in digits:
        digits, e = digits.split("e")
        exp = int(e)
    mant, _, frac = digits.partition(".")
    frac = "" if frac == "0" else frac
    ds = (mant + frac).lstrip("0")
    point = len(mant) + exp                      # decimal point position relative to ds start (before stripping)
    point -= len(mant + frac) - len((mant + frac).lstrip("0"))
    ds = ds.rstrip("0") or "0"
    k, n = len(ds), point
    if k <= n <= 21:
        return sign + ds + "0" * (n - k)
    if 0 < n <= 21:
        return sign + ds[:n] + "." + ds[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + ds
    e = n - 1
    body = ds[0] + ("." + ds[1:] if k > 1 else "")
    return f"{sign}{body}e{'+' if e >= 0 else '-'}{abs(e)}"


def ref_label(v):
    """The id of one category by plan 1.6 (an independent brute-force implementation)."""
    if v is None or (isinstance(v, (float, np.floating)) and math.isnan(v)) or v is pd.NA:
        return "@na"
    if isinstance(v, (bool, np.bool_)):
        return "c:true" if v else "c:false"
    if isinstance(v, (int, np.integer)):
        return f"c:{int(v)}"
    if isinstance(v, np.float32):
        v = float(str(v)) if math.isfinite(v) else float(v)         # shortest digits as float32
    if isinstance(v, (float, np.floating)):
        if math.isinf(v):
            return "c:Infinity" if v > 0 else "c:-Infinity"
        return "c:" + ecma_number_text(v)
    return f"c:{v}"


# --- partitionings -----------------------------------------------------------------------------------------

def _source_values(data, source):
    t = source["type"]
    if t == "obs":
        return data.obs[source["key"]]
    if t == "layer":
        j = data.var_names.index(source["column"])
        return pd.Series(data.layer(source.get("key", "X"))[:, j].astype(np.float64), index=data.obs.index)
    if t == "obsm":
        return pd.Series(data.obsm[source["key"]][:, int(source["column"])].astype(np.float64), index=data.obs.index)
    raise ValueError(f"the reference reads obs, layer and obsm sources, not {t!r}")


def _edges(values, binning):
    """Edges over the finite ``values`` (already without the zeros when the zero bin is on)."""
    method, k = binning["method"], int(binning.get("bins", 4))
    if method == "manual":
        return sorted(set(float(t) for t in binning["thresholds"]))
    lo, hi = float(values.min()), float(values.max())
    if lo == hi:
        return [lo, hi]
    if method == "equal_width":
        e = [lo + i * (hi - lo) / k for i in range(k + 1)]
    elif method == "equal_count":
        e = [float(q) for q in np.quantile(values.astype(np.float64), [i / k for i in range(k + 1)])]
    else:
        raise ValueError(f"the reference does not make {method!r} bins")
    return sorted(set(e))                              # equal edges are merged


def ref_partition(data, part, shown):
    """``(levels, codes, info)``: the partitioning's level ids in SHR-10 order (``@other`` and ``@na`` only when
    occupied), and for each cell of the dataset its index into ``levels`` (-1: in no group, or not shown)."""
    values = _source_values(data, part["source"])
    n = len(values)
    in_shown = np.zeros(n, dtype=bool)
    in_shown[shown] = True
    rest = part.get("rest")
    info = {}
    if "member" in part:
        m = part["member"]
        v = values.to_numpy(dtype=np.float64)
        ok = np.isfinite(v)
        op = {">": np.greater, ">=": np.greater_equal, "<": np.less, "<=": np.less_equal}[m["op"]]
        inside = np.zeros(n, dtype=bool)
        inside[ok] = op(v[ok], m["value"])
        return ["@in", "@out"], np.where(in_shown, np.where(inside, 0, 1), -1), info
    if isinstance(values.dtype, pd.CategoricalDtype) or values.dtype == object or values.dtype == bool \
            or part.get("binning", {}).get("method") == "categories":
        if isinstance(values.dtype, pd.CategoricalDtype):
            cats = list(values.cat.categories)
            raw = [cats[c] if c >= 0 else None for c in values.cat.codes]
        else:
            cats = sorted(set(values.dropna().tolist()), key=lambda c: (isinstance(c, str), c))
            if values.dtype == bool:
                cats = [False, True]
            raw = [None if pd.isna(c) else c for c in values.tolist()]
        ids = [ref_label(c) for c in cats]
        if len(set(ids)) != len(ids):
            return None, None, {"refused": "ambiguous_categories"}
        if part.get("levels") is not None:
            kept = list(part["levels"])
            unknown = [i for i in kept if i not in ids]
            if unknown:
                raise ValueError(f"levels not in the column: {unknown}")
        else:
            kept = ids
        info["n_levels"] = len(kept)                     # kept levels are what count for the limit (SHR-6)
        pos = {i: k for k, i in enumerate(kept)}
        other_at, na_at = len(kept), len(kept) + 1
        codes = np.full(n, -1)
        for r, c in enumerate(raw):
            if not in_shown[r]:
                continue
            cid = ref_label(c)
            if cid == "@na":
                codes[r] = -1 if rest == "exclude" else na_at
            elif cid in pos:
                codes[r] = pos[cid]
            else:
                codes[r] = -1 if rest == "exclude" else other_at
        levels = list(kept) + ["@other", "@na"]
        return _compact(levels, codes, range(len(kept)), info)
    # numeric binning
    b = part["binning"]
    v = values.to_numpy(dtype=np.float64)
    finite = np.isfinite(v)
    pop = in_shown if b.get("edges_from", "shown") == "shown" else np.ones(n, dtype=bool)
    zero_on = bool(b.get("zero_bin"))
    base = finite & ~(zero_on & (v == 0))
    manual = b["method"] == "manual"
    edge_vals = v[pop & base]
    if len(edge_vals) == 0 and not manual:
        raise ValueError("no finite value to bin")
    edges = _edges(edge_vals, b)
    # manual: thresholds t1 < ... < tm give m + 1 bins, the first and last open (SHR, section 2.4), read from nothing
    n_bins = len(edges) + 1 if manual else max(1, len(edges) - 1)
    # edges_n: the finite values of the population the edges came from, zeros included (core/binning.py's to_reply)
    info.update(edges=edges, bins_made=n_bins, edges_n=0 if manual else int((pop & finite).sum()))
    zero_at = 0 if zero_on else None
    first = 1 if zero_on else 0
    na_at = first + n_bins
    levels = (["@zero"] if zero_on else []) + [f"bin:{i}" for i in range(n_bins)] + ["@na"]
    codes = np.full(n, -1)
    interior = np.array(edges if manual else edges[1:-1])
    flat_data = not manual and edges[0] == edges[-1]
    for r in np.flatnonzero(in_shown):
        if not finite[r]:
            codes[r] = -1 if rest == "exclude" else na_at
        elif zero_on and v[r] == 0:
            codes[r] = zero_at
        elif flat_data:
            codes[r] = first
        else:
            codes[r] = first + int(np.searchsorted(interior, v[r], side="right"))
    return _compact(levels, codes, range(first, first + n_bins), info)


def _compact(levels, codes, declared, info):
    """Drop the synthetic levels (``@other``, ``@na``, ``@zero``) nobody is in; keep the ``declared`` ones."""
    used = set(np.unique(codes[codes >= 0]).tolist())
    keep = [k for k in range(len(levels)) if k in set(declared) or k in used]
    remap = {old: new for new, old in enumerate(keep)}
    new_codes = np.array([remap[c] if c >= 0 else -1 for c in codes])
    return [levels[k] for k in keep], new_codes, info


# --- the grouping shape ------------------------------------------------------------------------------------

def _shown_rows(shown, n):
    return np.arange(n) if shown is None else np.asarray(shown, dtype=np.int64)


def reference_groups(data, partitionings, shown=None, small=None, features=()):
    """The ``grouping`` shape by brute force.

    Returns ``{"n_shown", "n_grouped", "partitionings": [{"levels", "edges"?, ...}], "groups": [{"key", "n"}],
    "codes": per-cell group index (-1: in none; not part of the JSON), "moments": {feature id: [[n, sum, sumsq,
    n_above, sum_above] per group]}}`` or ``{"refused": {...}}``. ``features`` are ``{"id", "layer", "name",
    "detect_above"}``.
    """
    n = len(data.obs)
    rows = _shown_rows(shown, n)
    parts, codes_by = [], []
    for part in partitionings:
        levels, codes, info = ref_partition(data, part, rows)
        if levels is None:
            return {"refused": {"reason": info["refused"]}}
        if info.get("n_levels", len(levels)) > GROUP_LIMIT:
            return {"refused": {"reason": "too_many_levels", "count": info["n_levels"], "limit": GROUP_LIMIT}}
        parts.append((levels, info))
        codes_by.append(codes)
    keep_all = np.all([c >= 0 for c in codes_by], axis=0) if codes_by else np.zeros(n, dtype=bool)
    combos = {}
    for r in np.flatnonzero(keep_all):
        combos.setdefault(tuple(int(c[r]) for c in codes_by), []).append(int(r))
    order = sorted(combos)                                            # first partitioning slowest, SHR-10
    keys = [[parts[p][0][c] for p, c in enumerate(k)] for k in order]
    members = [combos[k] for k in order]
    if small:
        thr, mode = small.get("threshold", SMALL_THRESHOLD), small["mode"]
        if mode in ("collect", "hide"):
            under = [i for i, m in enumerate(members) if len(m) < thr]
            if mode == "collect" and under:
                collected = sorted(r for i in under for r in members[i])
                keys = [k for i, k in enumerate(keys) if i not in under] + [["@small"]]
                members = [m for i, m in enumerate(members) if i not in under] + [collected]
            elif mode == "hide":
                keys = [k for i, k in enumerate(keys) if i not in under]
                members = [m for i, m in enumerate(members) if i not in under]
    cell_group = np.full(n, -1)
    for g, m in enumerate(members):
        cell_group[m] = g
    out = {
        "n_shown": int(len(rows)),
        "n_grouped": int((cell_group >= 0).sum()),
        "partitionings": [{"levels": lv, **{k: v for k, v in info.items() if k in ("edges", "bins_made", "edges_n")}}
                          for lv, info in parts],
        "groups": [{"key": k, "n": len(m)} for k, m in zip(keys, members)],
        "codes": cell_group,
        "moments": {},
    }
    for f in features:
        col = data.layer(f.get("layer", "X"))[:, data.var_names.index(f["name"])].astype(np.float64)
        out["moments"][f["id"]] = [moments(col[m], f.get("detect_above", 0)) for m in members]
    return out


def moments(values, above=0.0):
    """``[n, sum, sumsq, n_above, sum_above]`` of the finite values, in float64."""
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    hi = v[v > above]
    return [int(len(v)), float(v.sum()), float((v * v).sum()), int(len(hi)), float(hi.sum())]


# --- the grid shape ----------------------------------------------------------------------------------------

def reference_grid(data, partitionings, shown=None, measure=None):
    """The ``grid`` shape by brute force: ``{"axes": [{"levels", "n_outside"}], "counts": flat, mixed radix, first
    axis slowest, "n_shown", "measure": [[n, sum, sumsq, n_above, sum_above] per grid cell] (when ``measure`` =
    ``{"source", "above"}``), "n_counted"}``. Unlike a grouping the grid holds empty combinations."""
    n = len(data.obs)
    rows = _shown_rows(shown, n)
    axes, codes_by = [], []
    for part in partitionings:
        levels, codes, _ = ref_partition(data, part, rows)
        if levels is None:
            return {"refused": {"reason": "ambiguous_categories"}}
        axes.append({"levels": levels, "n_outside": [0, 0]})          # the reference recipes store no range
        codes_by.append(codes)
    dims = [len(a["levels"]) for a in axes]
    cells = int(np.prod(dims))
    ok = np.all([c >= 0 for c in codes_by], axis=0)
    flat = np.zeros(n, dtype=np.int64)
    for c, d in zip(codes_by, dims):
        flat = flat * d + np.where(c >= 0, c, 0)
    counts = np.bincount(flat[ok], minlength=cells)
    out = {"axes": axes, "counts": counts.astype(int).tolist(), "n_shown": int(len(rows)), "n_counted": int(ok.sum())}
    if measure:
        col = _source_values(data, measure["source"]).to_numpy(dtype=np.float64)
        out["measure"] = [moments(col[ok & (flat == g)], measure.get("above", 0)) for g in range(cells)]
    return out


# --- named recipes and the expected numbers ----------------------------------------------------------------

def _obs(key, **kw):
    return {"source": {"type": "obs", "key": key}, **kw}


def _binned(key, method, bins, **kw):
    zero = kw.pop("zero_bin", None)
    b = {"method": method, "bins": bins, "edges_from": kw.pop("edges_from", "shown")}
    if zero is not None:
        b["zero_bin"] = zero
    return _obs(key, binning=b, **kw)


SHOWN_THIRD = list(range(0, N_OBS, 3))                  # every third cell: 400 of 1,200

GROUPING_RECIPES = {
    "cell_type": {"partitionings": [_obs("cell_type")]},
    "cell_type_keep2_other": {"partitionings": [_obs("cell_type", levels=["c:B cell", "c:T cell"], rest="other")]},
    "cell_type_keep2_exclude": {"partitionings": [_obs("cell_type", levels=["c:B cell", "c:T cell"], rest="exclude")]},
    "sample_other_vs_at_other": {"partitionings": [_obs("sample", levels=["c:other", "c:S00"], rest="other")]},
    "cell_type_x_condition": {"partitionings": [_obs("cell_type"), _obs("condition")]},
    "is_doublet": {"partitionings": [_obs("is_doublet")]},
    "batch_categories": {"partitionings": [_obs("batch", binning={"method": "categories"})]},
    "pseudotime_width4": {"partitionings": [_binned("pseudotime", "equal_width", 4)]},
    "pseudotime_width4_exclude": {"partitionings": [_binned("pseudotime", "equal_width", 4, rest="exclude")]},
    "pseudotime_count4_ties": {"partitionings": [_binned("pseudotime", "equal_count", 4)]},
    "depth_width3_zero_bin": {"partitionings": [_binned("depth", "equal_width", 3, zero_bin=True)]},
    "constant_degenerate": {"partitionings": [_binned("constant", "equal_width", 4)]},
    "signed_count4": {"partitionings": [_binned("signed", "equal_count", 4)]},
    "depth_above_2": {"partitionings": [_obs("depth", member={"op": ">", "value": 2.0})]},
    "cell_type_x_binned_gene": {"partitionings": [
        _obs("cell_type"), {"source": {"type": "layer", "key": "logged", "column": gene(5)},
                            "binning": {"method": "equal_count", "bins": 3, "zero_bin": True, "edges_from": "shown"}}]},
    "small_keep": {"partitionings": [_obs("cell_type")], "small": {"threshold": 10, "mode": "keep"}},
    "small_collect": {"partitionings": [_obs("cell_type")], "small": {"threshold": 10, "mode": "collect"}},
    "small_hide": {"partitionings": [_obs("cell_type")], "small": {"threshold": 10, "mode": "hide"}},
    "pseudotime_width4_shown_third_edges_shown": {"partitionings": [_binned("pseudotime", "equal_width", 4)],
                                                  "shown": "third"},
    "pseudotime_width4_shown_third_edges_all": {"partitionings": [_binned("pseudotime", "equal_width", 4, edges_from="all")],
                                                "shown": "third"},
    "many_over_limit": {"partitionings": [_obs("many")]},
    "many_kept_under_limit": {"partitionings": [_obs("many", levels=["c:m0005", "c:m0000"], rest="other")]},
    "score_manual_3_thresholds": {"partitionings": [_obs("score", binning={"method": "manual", "thresholds": [7.0, 3.0, 5.0]})]},
}
FEATURES = [
    {"id": "f0", "name": gene(0), "layer": "logged", "detect_above": 0},
    {"id": "f1", "name": gene(5), "layer": "counts", "detect_above": 1},
    {"id": "f2", "name": gene(3), "layer": "X", "detect_above": 0},
]
GRID_RECIPES = {
    "cell_type_x_condition": {"partitionings": [_obs("cell_type"), _obs("condition")],
                              "measure": {"source": {"type": "obs", "key": "score"}, "above": 5.0}},
    "three_axes": {"partitionings": [_obs("cell_type"), _obs("condition"), _obs("is_doublet")]},
    "pseudotime_x_cell_type": {"partitionings": [_binned("pseudotime", "equal_width", 5), _obs("cell_type")]},
    "sample_x_cell_type": {"partitionings": [_obs("sample"), _obs("cell_type")]},
    "kept_other_x_condition": {"partitionings": [_obs("cell_type", levels=["c:T cell"], rest="other"), _obs("condition")]},
    "depth_zero_bin_x_condition": {"partitionings": [_binned("depth", "equal_width", 3, zero_bin=True), _obs("condition")]},
}


def recipe_rows(recipe):
    return SHOWN_THIRD if recipe.get("shown") == "third" else None


def build_expected():
    data = make_data()
    expected = {"n_obs": N_OBS, "n_var": N_VAR, "features": FEATURES, "grouping": {}, "grid": {}}
    for name, r in GROUPING_RECIPES.items():
        res = reference_groups(data, r["partitionings"], recipe_rows(r), r.get("small"), FEATURES)
        res = {k: v for k, v in res.items() if k != "codes"}
        expected["grouping"][name] = {"recipe": r, **res}
    for name, r in GRID_RECIPES.items():
        expected["grid"][name] = {"recipe": r, **reference_grid(data, r["partitionings"], recipe_rows(r), r.get("measure"))}
    return json.loads(json.dumps(expected))                         # exactly what a reader of the file sees


def build_columns():
    """The obs columns and gene sets, for the JS fixtures (the missing values are null)."""
    data = make_data()
    obs = {}
    for name in data.obs.columns:
        col = data.obs[name]
        if isinstance(col.dtype, pd.CategoricalDtype):
            obs[name] = {"categories": list(col.cat.categories) if len(col.cat.categories) <= 40 else None,
                         "codes": col.cat.codes.tolist()}
        else:
            obs[name] = {"values": [None if (isinstance(v, float) and math.isnan(v)) else (v.item() if hasattr(v, "item") else v)
                                    for v in col.tolist()]}
    return json.loads(json.dumps({"n_obs": N_OBS, "obs": obs, "gene_sets": GENE_SETS, "signatures": SIGNATURES,
                                  "var_names": data.var_names, "shown_third": SHOWN_THIRD}))


def write_expected():
    for path, doc in ((EXPECTED_PATH, build_expected()), (COLUMNS_PATH, build_columns())):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            json.dump(doc, fh, indent=1, sort_keys=False)
            fh.write("\n")


def same(a, b, rtol=1e-12):
    """Deep equality of two JSON documents, floats within ``rtol``."""
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k], rtol) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y, rtol) for x, y in zip(a, b))
    if isinstance(a, float) or isinstance(b, float):
        if a is None or b is None:
            return a is b
        return math.isclose(a, b, rel_tol=rtol, abs_tol=1e-12)
    return a == b


if __name__ == "__main__":
    write_expected()
    print("wrote", EXPECTED_PATH, COLUMNS_PATH)
