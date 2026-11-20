"""The grouping shape (annzarro/core/cell_groups.py): partitionings resolved into groups (SHR-1 to SHR-13, SHR-28).

Checked against F0's brute-force pandas reference (``grouping_store.reference_groups``) on the named recipes of
``tests/data/grouping_expected.json`` in every layout and backend, and on a seeded sweep of 200 recipes; by hand
for what the reference does not cover (tables, members, a grouping used as a factor, scores, text, cell names,
ambiguous categories, the limits); and with the slab size and the code widths swept, so every path of the
intersection is taken on the same data.
"""
import base64
import itertools
import json
import os
import shutil

import numpy as np
import pytest

from annzarro.core import cell_groups as cg
from annzarro.core import gene_score as gsc
from annzarro.core import get_reader
from annzarro.tests import zarr_compat
from annzarro.tests.core import grouping_store as gs
from annzarro.tests.core.cell_sources_store import make_cell_store

VECTORS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "level_id_vectors.json")
EXPECTED = json.load(open(gs.EXPECTED_PATH, encoding="utf-8"))
LAYOUT_BACKEND = list(itertools.product(gs.LAYOUTS, gs.BACKENDS))


@pytest.fixture(scope="module")
def data():
    return gs.make_data()


@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    base = tmp_path_factory.mktemp("cg")
    return {(lay, be): gs.make_store(base / f"{lay}_{be}.{'zarr' if be == 'zarr' else 'h5ad'}", lay, be)
            for lay, be in LAYOUT_BACKEND}


@pytest.fixture(scope="module")
def store(stores):
    return stores["csc", "zarr"]


def body(parts, **kw):
    out = {"shape": "grouping", "partitionings": parts}
    out.update(kw)
    return out


def run(path, parts, rows=None, codes=None, should_stop=None, **kw):
    req = cg.parse_request(body(parts, **kw))
    p = cg.plan(get_reader(path), path, req)
    events = list(cg.compute(p, rows, codes=codes, should_stop=should_stop))
    kinds = [e for e, _ in events]
    assert kinds[-1] == "result" and set(kinds[:-1]) <= {"progress"}
    return events[-1][1]


def cell_groups(res):
    """Per cell shown: the group's key, or None."""
    none = 0xFF if res.codes.dtype == np.uint8 else 0xFFFF
    keys = [tuple(g["key"]) for g in res.groups]
    return [None if c == none else keys[c] for c in res.codes.tolist()]


def same_as_reference(res, ref, rows, n_obs=gs.N_OBS, check_edges_n=True):
    if "refused" in ref:
        assert res.refused is not None and res.refused["reason"] == ref["refused"]["reason"]
        for k in ("count", "limit"):
            if k in ref["refused"]:
                assert res.refused[k] == ref["refused"][k]
        return
    assert res.refused is None, res.refused
    assert res.n_shown == ref["n_shown"]
    assert res.n_grouped == ref["n_grouped"]
    assert [g["key"] for g in res.groups] == [g["key"] for g in ref["groups"]]
    assert [g["n"] for g in res.groups] == [g["n"] for g in ref["groups"]]
    for mine, theirs in zip(res.partitionings, ref["partitionings"]):
        assert [lv["id"] for lv in mine["levels"]] == theirs["levels"]
        if "edges" in theirs:
            np.testing.assert_allclose(mine["edges"], theirs["edges"], rtol=1e-12)
            assert mine["bins_made"] == theirs["bins_made"]
            if check_edges_n:
                assert mine["edges_n"] == theirs["edges_n"]
    if "codes" in ref:
        shown = np.arange(n_obs) if rows is None else np.asarray(rows)
        want = [None if c < 0 else tuple(ref["groups"][c]["key"]) for c in ref["codes"][shown]]
        assert cell_groups(res) == want


# --------------------------------------------------------------------------------------------- ids

def test_group_key_json_matches_the_vector_file():
    doc = json.load(open(VECTORS, encoding="utf-8"))
    assert doc["group_keys"]
    for v in doc["group_keys"]:
        assert cg.group_key_json(v["key"]) == v["json"]


@pytest.mark.parametrize("value,want", [
    (np.float64(3.0), "c:3"), (np.int16(-7), "c:-7"), (np.bool_(True), "c:true"), (np.float32(1e21), "c:1e+21"),
    (np.float32(16777216.0), "c:16777216"), (np.float32(-2.5e-8), "c:-2.5e-8"), (float("nan"), "@na"),
    (b"bytes", "c:bytes"), (123456789.125, "c:123456789.125"), (-1.5e300, "c:-1.5e+300"), (1e-6 * 1.5, "c:0.0000015"),
])
def test_canonical_label_of_numpy_and_edge_values(value, want):
    assert cg.canonical_label(value) == want


def test_canonical_label_agrees_with_the_independent_reference_over_a_sweep():
    rng = np.random.default_rng(5)
    values = np.concatenate([rng.standard_normal(500) * 10.0 ** rng.integers(-30, 30, 500),
                             np.round(rng.standard_normal(200) * 1e6), [1e21, 9.999999999999999e20, 1e-6, 9.9e-7]])
    for v in values:
        assert cg.canonical_label(float(v)) == gs.ref_label(float(v))
        assert cg.canonical_label(np.float32(v)) == gs.ref_label(np.float32(v))


# --------------------------------------------------------------------------------------------- named recipes

@pytest.mark.parametrize("layout,backend", LAYOUT_BACKEND)
@pytest.mark.parametrize("name", sorted(EXPECTED["grouping"]))
def test_named_recipes_match_the_expected_file(stores, layout, backend, name):
    exp = EXPECTED["grouping"][name]
    r = exp["recipe"]
    rows = gs.recipe_rows(r)
    kw = {"small": r["small"]} if "small" in r else {}
    res = run(stores[layout, backend], r["partitionings"], rows, **kw)
    zero_bin = any((p.get("binning") or {}).get("zero_bin") for p in r["partitionings"])
    # F0 counts edges_n without the exact zeros under the zero bin; core/binning.py (E1) counts every finite value
    same_as_reference(res, exp, rows, check_edges_n=not zero_bin)


def test_edges_n_under_the_zero_bin_counts_every_finite_value(store, data):
    res = run(store, [{"source": {"type": "obs", "key": "depth"},
                       "binning": {"method": "equal_width", "bins": 3, "zero_bin": True}}])
    assert res.partitionings[0]["edges_n"] == int(np.isfinite(data.obs["depth"]).sum())


# --------------------------------------------------------------------------------------------- the sweep

CAT_KEYS = ["cell_type", "condition", "sample", "is_doublet"]
NUM_KEYS = ["pseudotime", "depth", "signed", "score", "constant"]


def _ids(data, key):
    col = data.obs[key]
    cats = [False, True] if col.dtype == bool else list(col.cat.categories)
    return [gs.ref_label(c) for c in cats]


def random_part(rng, data):
    r = rng.random()
    if r < 0.3:
        key = CAT_KEYS[rng.integers(len(CAT_KEYS))]
        part = {"source": {"type": "obs", "key": key}}
        if rng.random() < 0.5:
            ids = _ids(data, key)
            part["levels"] = [ids[i] for i in rng.permutation(len(ids))[:rng.integers(1, len(ids) + 1)]]
        if rng.random() < 0.4:
            part["rest"] = "exclude"
        return part
    if r < 0.38:
        part = {"source": {"type": "obs", "key": "batch"}, "binning": {"method": "categories"}}
        if rng.random() < 0.5:
            part["levels"] = [f"c:{i}" for i in rng.permutation(12)[:rng.integers(1, 12)]]
            if rng.random() < 0.5:
                part["rest"] = "exclude"
        return part
    if r < 0.48:
        key = NUM_KEYS[rng.integers(len(NUM_KEYS))]
        op = [">", ">=", "<", "<="][rng.integers(4)]
        value = float(np.nanquantile(data.obs[key], rng.random()))
        return {"source": {"type": "obs", "key": key}, "member": {"op": op, "value": value}}
    if r < 0.85:
        key = NUM_KEYS[rng.integers(len(NUM_KEYS))]
        source = {"type": "obs", "key": key}
    elif r < 0.93:
        source = {"type": "layer", "key": ["X", "logged", "counts"][rng.integers(3)], "column": gs.gene(int(rng.integers(40)))}
    else:
        source = {"type": "obsm", "key": "X_umap", "column": str(rng.integers(2))}
    values = gs._source_values(data, source).to_numpy(dtype=np.float64)
    b = {"method": ["equal_width", "equal_count"][rng.integers(2)], "bins": int(rng.integers(2, 9)),
         "edges_from": ["shown", "all"][rng.integers(2)]}
    if rng.random() < 0.5 and not (values[np.isfinite(values)] < 0).any():
        b["zero_bin"] = True
    part = {"source": source, "binning": b}
    if rng.random() < 0.3:
        part["rest"] = "exclude"
    return part


def random_recipe(seed, data):
    rng = np.random.default_rng(seed)
    parts = [random_part(rng, data) for _ in range(rng.integers(1, 4))]
    rows = [None, gs.SHOWN_THIRD, None][rng.integers(3)]
    if rng.random() < 0.3:
        rows = sorted(rng.choice(gs.N_OBS, int(rng.integers(150, gs.N_OBS)), replace=False).tolist())
    small = None
    if rng.random() < 0.5:
        small = {"threshold": int(rng.integers(1, 60)), "mode": list(cg.SMALL_MODES)[rng.integers(3)]}
    return parts, rows, small


def _bins_with_values(data, parts, rows):
    """The reference needs a finite value in each binned population (the engine makes one empty level)."""
    shown = np.arange(gs.N_OBS) if rows is None else np.asarray(rows)
    for p in parts:
        b = p.get("binning")
        if not b or b["method"] == "categories":
            continue
        v = gs._source_values(data, p["source"]).to_numpy(dtype=np.float64)
        pop = v if b.get("edges_from") == "all" else v[shown]
        pop = pop[np.isfinite(pop)]
        if b.get("zero_bin"):
            pop = pop[pop != 0]
        if pop.size == 0:
            return False
    return True


@pytest.mark.parametrize("seed", range(200))
def test_seeded_recipes_match_the_brute_force_reference(stores, data, seed):
    parts, rows, small = random_recipe(seed, data)
    if not _bins_with_values(data, parts, rows):
        pytest.skip("a population with no finite value: the reference has no edges (covered by hand below)")
    ref = gs.reference_groups(data, parts, rows, small)
    lay, be = LAYOUT_BACKEND[seed % len(LAYOUT_BACKEND)]
    res = run(stores[lay, be], parts, rows, **({"small": small} if small else {}))
    zero_bin = any((p.get("binning") or {}).get("zero_bin") for p in parts)
    same_as_reference(res, ref, rows, check_edges_n=not zero_bin)


@pytest.mark.parametrize("slab", [1, 7, 64, 400, 1199, 1200, 5000])
@pytest.mark.parametrize("narrow,table", [(cg._NARROW_MAX, cg._TABLE_MAX), (40, cg._TABLE_MAX), (2, 3), (300, 1)])
def test_slab_size_and_code_widths_do_not_change_the_groups(store, data, monkeypatch, slab, narrow, table):
    """Every path of the intersection (in place, compacted, wide through a table, wide through sorting) and every
    slab boundary gives the reference's groups and codes."""
    monkeypatch.setattr(cg.cs, "SLAB_ROWS", slab)
    monkeypatch.setattr(cg, "_NARROW_MAX", narrow)
    monkeypatch.setattr(cg, "_TABLE_MAX", table)
    parts = [{"source": {"type": "obs", "key": "sample"}},
             {"source": {"type": "obs", "key": "pseudotime"}, "binning": {"method": "equal_count", "bins": 5}},
             {"source": {"type": "obs", "key": "cell_type"}, "levels": ["c:NK cell", "c:B cell"], "rest": "exclude"}]
    for rows in (None, gs.SHOWN_THIRD):
        ref = gs.reference_groups(data, parts, rows, {"threshold": 3, "mode": "collect"})
        res = run(store, parts, rows, small={"threshold": 3, "mode": "collect"})
        same_as_reference(res, ref, rows)


# --------------------------------------------------------------------------------------------- by hand

def test_a_category_called_other_is_not_the_other_level(store):
    res = run(store, [{"source": {"type": "obs", "key": "sample"}, "levels": ["c:other", "c:S01"]}])
    ids = [lv["id"] for lv in res.partitionings[0]["levels"]]
    assert ids == ["c:other", "c:S01", "@other"]
    assert [g["key"] for g in res.groups] == [["c:other"], ["c:S01"], ["@other"]]
    assert [g["n"] for g in res.groups] == [40, 40, 1120]


def test_kept_levels_keep_the_users_order_and_list_every_category(store):
    res = run(store, [{"source": {"type": "obs", "key": "cell_type"}, "levels": ["c:T cell", "c:B cell", "c:Gone"]}])
    p = res.partitionings[0]
    assert [lv["id"] for lv in p["levels"]] == ["c:T cell", "c:B cell", "c:Gone", "@other"]
    assert [lv["n"] for lv in p["levels"]] == [300, 500, 0, 400]
    assert p["absent"] == ["c:Gone"]
    assert p["categories"] == ["c:" + n for n, _ in gs.CELL_TYPES]
    assert p["kind"] == "categorical"


def test_a_missing_category_is_no_value_and_rest_exclude_leaves_it_in_no_group(stores):
    path, e = make_cell_store(stores["csc", "zarr"] + "-cells.zarr")
    res = run(path, [{"source": {"type": "obs", "key": "ctype"}}])
    assert [lv["id"] for lv in res.partitionings[0]["levels"]][-1] == "@na"
    assert res.partitionings[0]["n_no_value"] == 2 and res.n_grouped == 200
    res = run(path, [{"source": {"type": "obs", "key": "ctype"}, "rest": "exclude"}])
    assert res.n_grouped == 198 and "@na" not in [lv["id"] for lv in res.partitionings[0]["levels"]]
    assert [g["key"] for g in res.groups] == [["c:B"], ["c:T"], ["c:NK"], ["c:other"]]


def test_text_and_boolean_columns(stores):
    path, e = make_cell_store(stores["csc", "zarr"] + "-text.zarr")
    res = run(path, [{"source": {"type": "obs", "key": "note"}}, {"source": {"type": "obs", "key": "flag"}}])
    notes, counts = np.unique(e["note"].astype(str), return_counts=True)
    assert res.partitionings[0]["categories"] == ["c:" + n for n in notes]
    assert [lv["n"] for lv in res.partitionings[0]["levels"]] == counts.tolist()
    assert [lv["id"] for lv in res.partitionings[1]["levels"]] == ["c:false", "c:true"]
    want = {}
    for note, flag in zip(e["note"], e["flag"]):
        want[("c:" + note, "c:true" if flag else "c:false")] = want.get(("c:" + note, "c:true" if flag else "c:false"), 0) + 1
    assert {tuple(g["key"]): g["n"] for g in res.groups} == want
    assert [tuple(g["key"]) for g in res.groups] == sorted(want, key=lambda k: (notes.tolist().index(k[0][2:]), k[1] == "c:true"))


def test_a_float32_column_split_by_its_values_uses_float32_digits(stores):
    path, e = make_cell_store(stores["csc", "zarr"] + "-f32.zarr")
    res = run(path, [{"source": {"type": "obs", "key": "pseudotime"}, "binning": {"method": "categories"}}],
              rows=np.arange(0, 20))
    vals = np.unique(e["pseudotime"][:20][np.isfinite(e["pseudotime"][:20])])
    assert res.partitionings[0]["categories"] == [gs.ref_label(np.float32(v)) for v in vals]
    assert all(len(c) < 14 for c in res.partitionings[0]["categories"])          # 0.1f, not 0.10000000149011612


def _ambiguous_store(src, path):
    shutil.copytree(src, path)
    root = zarr_compat.open_group(path, mode="r+")
    obs = root["obs"]
    g = obs.create_group("zeros")
    g.attrs.update({"encoding-type": "categorical", "encoding-version": "0.2.0", "ordered": False})
    zarr_compat.write_array(g, "codes", (np.arange(gs.N_OBS) % 2).astype(np.int8), chunks=(512,))
    zarr_compat.write_array(g, "categories", np.array([-0.0, 0.0]), chunks=(2,))
    del obs["_index"]
    zarr_compat.write_strings(obs, "_index", [gs.cell(i % 1100) for i in range(gs.N_OBS)])
    zarr_compat.consolidate(path)
    return path


def test_two_categories_with_one_text_are_refused_as_ambiguous(store, tmp_path):
    path = _ambiguous_store(store, str(tmp_path / "amb.zarr"))
    res = run(path, [{"source": {"type": "obs", "key": "cell_type"}}, {"source": {"type": "obs", "key": "zeros"}}])
    assert res.refused["reason"] == "ambiguous_categories" and res.refused["partitioning"] == 1
    assert res.refused["ids"] == ["c:0"] and res.codes is None
    head, blocks = res.to_reply(True)
    assert head["refused"]["reason"] == "ambiguous_categories" and blocks == []
    # duplicated cell names, too
    res = run(path, [{"source": {"type": "obs", "key": "_index"}}], rows=np.array([3, 5, 1105]))   # 5 and 1105 share a name
    assert res.refused["reason"] == "ambiguous_categories"


def test_one_group_per_cell_up_to_the_limit(store, monkeypatch):
    res = run(store, [{"source": {"type": "obs", "key": "_index"}}])
    assert len(res.groups) == gs.N_OBS and res.codes.dtype == np.uint16
    assert res.groups[17] == {"key": ["c:" + gs.cell(17)], "n": 1}
    np.testing.assert_array_equal(res.codes, np.arange(gs.N_OBS))
    monkeypatch.setitem(cg.GROUPING_LIMITS, "levels", 999)
    monkeypatch.setitem(cg.GROUPING_LIMITS, "groups", 999)
    res = run(store, [{"source": {"type": "obs", "key": "_index"}}], rows=np.arange(999))
    assert len(res.groups) == 999
    res = run(store, [{"source": {"type": "obs", "key": "_index"}}], rows=np.arange(1000))
    assert res.refused == {"reason": "too_many_levels", "count": 1000, "limit": 999, "partitioning": 0, "levels": []}


@pytest.mark.parametrize("narrow", [cg._NARROW_MAX, 20], ids=["in-place", "wide"])
def test_too_many_groups_is_refused_with_the_count(store, monkeypatch, narrow):
    """In place, and through the wide fold, which on the last partitioning counts the groups and writes no code."""
    monkeypatch.setattr(cg, "_NARROW_MAX", narrow)
    monkeypatch.setitem(cg.GROUPING_LIMITS, "groups", 100)
    res = run(store, [{"source": {"type": "obs", "key": "sample"}}, {"source": {"type": "obs", "key": "cell_type"}}])
    want = len({(s, c) for s, c in zip(gs.make_data().obs["sample"], gs.make_data().obs["cell_type"])})
    assert res.refused["reason"] == "too_many_groups" and res.refused["count"] == want and res.refused["limit"] == 100
    assert res.refused["levels"] == [30, 6]


def test_the_group_limit_is_one_constant():
    assert cg.GROUP_LIMIT == 2000
    assert cg.GROUPING_LIMITS == {"partitionings": 8, "levels": 2000, "groups": 2000}


@pytest.mark.parametrize("mode", cg.SMALL_MODES)
def test_small_groups_keep_collect_hide(store, data, mode):
    parts = [{"source": {"type": "obs", "key": "cell_type"}}, {"source": {"type": "obs", "key": "condition"}}]
    small = {"threshold": 30, "mode": mode}
    res = run(store, parts, small=small)
    ref = gs.reference_groups(data, parts, None, small)
    same_as_reference(res, ref, None)
    assert res.small["n_small"] == sum(1 for g in gs.reference_groups(data, parts)["groups"] if g["n"] < 30)
    if mode == "collect":
        assert res.groups[-1]["key"] == ["@small"]
    if mode == "hide":
        assert res.n_grouped < gs.N_OBS


def test_a_grouping_as_a_factor_has_g_levels(store, data):
    inner = {"partitionings": [{"source": {"type": "obs", "key": "cell_type"}},
                               {"source": {"type": "obs", "key": "condition"}}],
             "small": {"threshold": 40, "mode": "collect"}}
    res = run(store, [{"source": {"type": "cell-group", "key": "panel-3", "recipe": inner}},
                      {"source": {"type": "obs", "key": "is_doublet"}}])
    sub = gs.reference_groups(data, inner["partitionings"], None, inner["small"])
    want_ids = ["g:" + json.dumps(g["key"], separators=(",", ":"), ensure_ascii=False) for g in sub["groups"]]
    assert res.partitionings[0]["kind"] == "grouping"
    assert res.partitionings[0]["categories"] == want_ids and want_ids[-1] == 'g:["@small"]'
    assert [lv["n"] for lv in res.partitionings[0]["levels"]] == [g["n"] for g in sub["groups"]]
    ref = gs.reference_groups(data, [{"source": {"type": "obs", "key": "is_doublet"}}])
    assert res.n_grouped == gs.N_OBS
    inner_of = [want_ids[c] for c in sub["codes"]]
    flag = ["c:true" if v else "c:false" for v in data.obs["is_doublet"]]
    want = {}
    for a, b in zip(inner_of, flag):
        want[(a, b)] = want.get((a, b), 0) + 1
    assert {tuple(g["key"]): g["n"] for g in res.groups} == want
    assert ref["n_grouped"] == gs.N_OBS
    # one group of it as a member, and kept levels of it
    res = run(store, [{"source": {"type": "cell-group", "recipe": inner},
                       "member": {"group": ["c:B cell", "c:ctrl"], "groupWas": ["B cell", "ctrl"]}}])
    n_in = int(((data.obs["cell_type"] == "B cell") & (data.obs["condition"] == "ctrl")).sum())
    assert [g["n"] for g in res.groups] == [n_in, gs.N_OBS - n_in]
    res = run(store, [{"source": {"type": "cell-group", "recipe": inner}, "levels": [want_ids[1]], "rest": "exclude"}])
    assert res.groups == [{"key": [want_ids[1]], "n": sub["groups"][1]["n"]}]


def test_a_cell_in_no_group_upstream_has_no_value(store, data):
    inner = {"partitionings": [{"source": {"type": "obs", "key": "cell_type"}, "levels": ["c:B cell"], "rest": "exclude"}]}
    res = run(store, [{"source": {"type": "cell-group", "recipe": inner}}])
    assert [g["key"] for g in res.groups] == [['g:["c:B cell"]'], ["@na"]]
    assert res.partitionings[0]["n_no_value"] == gs.N_OBS - 500


def _bitset(mask):
    return {"encoding": "bitset-base64", "length": int(mask.size),
            "data": base64.b64encode(np.packbits(mask, bitorder="little").tobytes()).decode()}


@pytest.mark.parametrize("rows", [None, gs.SHOWN_THIRD], ids=["all", "third"])
def test_a_table_is_in_or_out_and_rest_exclude_keeps_in_only(store, rows):
    n = gs.N_OBS if rows is None else len(rows)
    mask = np.random.default_rng(3).random(n) < 0.3
    res = run(store, [{"source": {"type": "table", "ref": "s0", "key": "table-1"}}], rows, sets={"s0": _bitset(mask)})
    assert [g["key"] for g in res.groups] == [["@in"], ["@out"]]
    assert [g["n"] for g in res.groups] == [int(mask.sum()), int((~mask).sum())]
    assert res.partitionings[0]["kind"] == "table"
    res = run(store, [{"source": {"type": "table", "ref": "s0"}, "rest": "exclude"}], rows, sets={"s0": _bitset(mask)})
    assert [g["key"] for g in res.groups] == [["@in"]] and res.n_grouped == int(mask.sum())
    assert cell_groups(res) == [("@in",) if m else None for m in mask]


def test_a_bitset_of_the_wrong_length_or_with_trailing_bits_is_refused(store):
    mask = np.ones(gs.N_OBS - 1, dtype=bool)
    with pytest.raises(cg.cs.CellSourceError) as e:
        run(store, [{"source": {"type": "table", "ref": "s0"}}], sets={"s0": _bitset(mask)})
    assert e.value.reason == "set_length"
    bad = _bitset(np.ones(5, dtype=bool))
    bad["data"] = base64.b64encode(bytes([0xFF])).decode()
    with pytest.raises(cg.GroupError) as e:
        cg.parse_request(body([{"source": {"type": "table", "ref": "s0"}}], sets={"s0": bad}))
    assert e.value.reason == "bad_set"
    with pytest.raises(cg.GroupError) as e:
        cg.parse_request(body([{"source": {"type": "table", "ref": "s9"}}]))
    assert e.value.reason == "set_missing"


def test_members_by_comparison_and_by_levels_count_cells_without_a_value_as_out(store, data):
    res = run(store, [{"source": {"type": "obs", "key": "pseudotime"}, "member": {"op": ">", "value": 0.5}}])
    v = data.obs["pseudotime"].to_numpy()
    n_in = int(np.nansum(v > 0.5))
    assert [g["key"] for g in res.groups] == [["@in"], ["@out"]] and [g["n"] for g in res.groups] == [n_in, gs.N_OBS - n_in]
    assert res.partitionings[0]["n_no_value"] == 20 and res.partitionings[0]["kind"] == "member"
    res = run(store, [{"source": {"type": "obs", "key": "cell_type"}, "member": {"levels": ["c:NK cell", "c:Platelet"]}}])
    assert [g["n"] for g in res.groups] == [205, 995]


def test_a_score_is_binned_from_the_score_engine(store, data):
    recipe = {"genes": gs.SIGNATURES["up_only"]["up"], "method": "mean", "input": "logged"}
    res = run(store, [{"source": {"type": "gene-score", "key": "sig-1", "column": "mean", "layer": "logged",
                                  "recipe": recipe}, "binning": {"method": "equal_count", "bins": 3}}])
    p = gsc.plan(get_reader(store), store, gsc.parse_recipe(recipe))
    values = [r for e, r in gsc.compute(p) if e == "result"][0].values.astype(np.float64)
    edges = np.quantile(values, [0, 1 / 3, 2 / 3, 1])
    np.testing.assert_allclose(res.partitionings[0]["edges"], edges, rtol=1e-12)
    want = np.bincount(np.searchsorted(edges[1:-1], values, side="right"), minlength=3)
    assert [g["n"] for g in res.groups] == want.tolist()


def test_codes_are_uint8_up_to_255_groups_and_mark_no_group(store, data):
    res = run(store, [{"source": {"type": "obs", "key": "cell_type"}, "levels": ["c:B cell"], "rest": "exclude"}])
    assert res.codes.dtype == np.uint8
    np.testing.assert_array_equal(res.codes == 0xFF, (data.obs["cell_type"] != "B cell").to_numpy())
    res = run(store, [{"source": {"type": "obs", "key": "sample"}}, {"source": {"type": "obs", "key": "batch"},
                                                                     "binning": {"method": "categories"}}])
    assert len(res.groups) > 255 and res.codes.dtype == np.uint16 and not (res.codes == 0xFFFF).any()


def test_degenerate_data_and_no_finite_value_make_one_level(store):
    res = run(store, [{"source": {"type": "obs", "key": "constant"}}])
    p = res.partitionings[0]
    assert p["degenerate"] and p["value"] == 2.5 and [lv["id"] for lv in p["levels"]] == ["bin:0"]
    assert p["levels"][0]["lo"] == p["levels"][0]["hi"] == 2.5
    res = run(store, [{"source": {"type": "obs", "key": "pseudotime"}}], rows=np.flatnonzero(gs.make_data().obs["pseudotime"].isna()))
    assert [lv["id"] for lv in res.partitionings[0]["levels"]] == ["bin:0", "@na"]
    assert res.groups == [{"key": ["@na"], "n": 20}]


def test_the_reply_of_a_binned_partitioning(store):
    req_parts = [{"source": {"type": "obs", "key": "depth"},
                  "binning": {"method": "equal_count", "bins": 4, "zero_bin": True}}]
    res = run(store, req_parts, want={"codes": True, "histograms": [0]})
    p = res.partitionings[0]
    assert p["kind"] == "binned" and p["levels"][0] == {"id": "@zero", "n": p["levels"][0]["n"]}
    assert [lv["id"] for lv in p["levels"]] == ["@zero", "bin:0", "bin:1", "bin:2", "bin:3"]
    assert p["levels"][1]["lo"] == p["edges"][0] and p["levels"][-1]["hi"] == p["edges"][-1]
    for key in ("edges_from", "edges_n", "bins_asked", "bins_made", "n_no_value", "n_outside", "outside", "degenerate"):
        assert key in p
    assert p["histogram"]["zero_bin_default"] is True and len(p["histogram"]["counts"]) == 100
    head, blocks = res.to_reply(True)
    assert head["shape"] == "grouping" and head["version"] == cg.ALGORITHM_VERSION
    assert head["blocks"] == [{"name": "codes", "dtype": "uint8", "length": gs.N_OBS}]
    assert blocks[0][1] is res.codes
    json.dumps(head)                                      # the frame is plain JSON
    assert res.to_reply(False)[1] == []


def test_a_stored_range_clamps_and_counts(store, data):
    res = run(store, [{"source": {"type": "obs", "key": "score"},
                       "binning": {"method": "equal_width", "bins": 4, "range": [3.0, 7.0]}}])
    v = data.obs["score"].to_numpy()
    p = res.partitionings[0]
    assert p["n_outside"] == [int((v < 3).sum()), int((v > 7).sum())] and res.n_grouped == gs.N_OBS
    with pytest.raises(cg.GroupError) as e:
        run(store, [{"source": {"type": "obs", "key": "score"},
                     "binning": {"method": "equal_width", "range": [3.0, 7.0], "outside": "exclude"}}])
    assert e.value.reason == "outside_exclude"


def test_manual_thresholds_make_one_more_bin_than_thresholds(store, data):
    res = run(store, [{"source": {"type": "obs", "key": "score"}, "binning": {"method": "manual", "thresholds": [6, 4]}}])
    v = data.obs["score"].to_numpy()
    assert [lv["id"] for lv in res.partitionings[0]["levels"]] == ["bin:0", "bin:1", "bin:2"]
    assert [g["n"] for g in res.groups] == [int((v < 4).sum()), int(((v >= 4) & (v < 6)).sum()), int((v >= 6).sum())]
    assert res.partitionings[0]["levels"][0]["lo"] is None


def test_the_code_cache_answers_without_reading(store, monkeypatch):
    parts = [{"source": {"type": "obs", "key": "cell_type"}}]
    first = run(store, parts)

    def no_read(*a, **k):
        raise AssertionError("read")
    monkeypatch.setattr(cg.cs, "column", no_read)
    again = run(store, parts, codes=first)
    assert again is first


def test_should_stop_cancels(store):
    calls = []

    def stop():
        calls.append(1)
        return len(calls) > 2
    with pytest.raises(gsc.ScoreCancelled):
        run(store, [{"source": {"type": "obs", "key": "cell_type"}}, {"source": {"type": "obs", "key": "pseudotime"}}],
            should_stop=stop)


def test_a_pause_is_waited_on_between_slabs(store, monkeypatch):
    monkeypatch.setattr(cg.cs, "SLAB_ROWS", 100)

    class Pause:
        asked = waited = 0

        def wanted(self):
            self.asked += 1
            return self.asked % 5 == 0

        def wait(self):
            self.waited += 1
    pause = Pause()
    req = cg.parse_request(body([{"source": {"type": "obs", "key": "cell_type"}}]))
    p = cg.plan(get_reader(store), store, req)
    res = [r for e, r in cg.compute(p, None, pause=pause) if e == "result"][0]
    assert pause.waited >= 2 and len(res.groups) == 6


def test_progress_counts_partitionings(store):
    req = cg.parse_request(body([{"source": {"type": "obs", "key": "cell_type"}},
                                 {"source": {"type": "obs", "key": "condition"}}]))
    p = cg.plan(get_reader(store), store, req)
    events = list(cg.compute(p))
    assert [e[1]["done"] for e in events if e[0] == "progress"] == [0, 1, 2]
    assert all(e[1]["total"] == 2 for e in events if e[0] == "progress")


# --------------------------------------------------------------------------------------------- the request

@pytest.mark.parametrize("bad,reason", [
    ({"partitionings": [{"source": {"type": "obs", "key": "a"}, "labels": {"c:a": "A"}}]}, "unknown_field"),
    ({"partitionings": [{"source": {"type": "obs", "key": "a"}}], "separator": " | "}, "unknown_field"),
    ({"partitionings": [{"source": {"type": "obs", "key": "a", "colour": 1}}]}, "unknown_field"),
    ({"partitionings": []}, "bad_request"),
    ({"partitionings": [{"source": {"type": "nope", "key": "a"}}]}, "unknown_source_type"),
    ({"partitionings": [{"source": {"type": "obs", "key": "a"}, "levels": ["B cell"]}]}, "bad_levels"),
    ({"partitionings": [{"source": {"type": "obs", "key": "a"}, "levels": ["c:x", "c:x"]}]}, "bad_request"),
    ({"partitionings": [{"source": {"type": "obs", "key": "a"}, "rest": "drop"}]}, "bad_request"),
    ({"partitionings": [{"source": {"type": "obs", "key": "a"}}], "small": {"mode": "merge"}}, "bad_request"),
    ({"partitionings": [{"source": {"type": "obs", "key": "a"}}], "small": {"threshold": 0}}, "bad_request"),
    ({"partitionings": [{"source": {"type": "obs", "key": "a"}}], "want": {"histograms": [1]}}, "bad_request"),
    ({"partitionings": [{"source": {"type": "obs", "key": "a"}}], "want": {"edges": True}}, "unknown_field"),
    ({"partitionings": [{"source": {"type": "obs", "key": "a"}, "member": {"op": "!=", "value": 1}}]}, "bad_request"),
    ({"partitionings": [{"source": {"type": "obs", "key": "a"}, "member": {"op": ">", "value": 1}, "rest": "exclude"}]},
     "bad_request"),
    ({"partitionings": [{"source": {"type": "obs", "key": "a"}}], "shape": "grid"}, "bad_shape"),
    ({"partitionings": [{"source": {"type": "obs", "key": "a"}}], "confirm": "yes"}, "bad_request"),
])
def test_bad_requests_are_refused_with_a_reason(bad, reason):
    with pytest.raises(cg.GroupError) as e:
        cg.parse_request({"shape": "grouping", **bad})
    assert e.value.status == 400 and e.value.reason == reason


def test_more_than_eight_partitionings_and_nesting_too_deep_are_refused():
    with pytest.raises(cg.GroupError) as e:
        cg.parse_request(body([{"source": {"type": "obs", "key": "a"}}] * 9))
    assert (e.value.status, e.value.reason, e.value.extra) == (422, "too_many_partitionings", {"count": 9, "limit": 8})
    recipe = {"partitionings": [{"source": {"type": "obs", "key": "a"}}]}
    for _ in range(cg.MAX_NESTING):
        recipe = {"partitionings": [{"source": {"type": "cell-group", "recipe": recipe}}]}
    cg.parse_request(body(recipe["partitionings"]))                       # MAX_NESTING deep is allowed
    recipe = {"partitionings": [{"source": {"type": "cell-group", "recipe": recipe}}]}
    with pytest.raises(cg.GroupError) as e:
        cg.parse_request(body(recipe["partitionings"]))
    assert e.value.reason == "nested_too_deep"


@pytest.mark.parametrize("part,reason", [
    ({"source": {"type": "obs", "key": "cell_type"}, "binning": {"method": "equal_count"}}, "not_numeric"),
    ({"source": {"type": "obs", "key": "pseudotime"}, "levels": ["c:1"]}, "levels_not_categorical"),
    ({"source": {"type": "obs", "key": "cell_type"}, "member": {"op": ">", "value": 1}}, "member_not_numeric"),
    ({"source": {"type": "obs", "key": "pseudotime"}, "binning": {"method": "equal_count", "bins": 1}}, "bad_bins"),
    ({"source": {"type": "obs", "key": "nope"}}, "key_not_found"),
    ({"source": {"type": "layer", "key": "logged", "column": "NOGENE"}}, "key_not_found"),
])
def test_what_the_store_rules_out_is_refused_before_reading(store, part, reason):
    req = cg.parse_request(body([part]))
    with pytest.raises(gsc.ScoreError) as e:
        cg.plan(get_reader(store), store, req)
    assert e.value.reason == reason and e.value.status in (400, 404)


def test_a_zero_bin_on_a_signed_source_is_refused(store):
    req = cg.parse_request(body([{"source": {"type": "obs", "key": "signed"}, "binning": {"method": "equal_count",
                                                                                         "zero_bin": True}}]))
    p = cg.plan(get_reader(store), store, req)
    with pytest.raises(cg.GroupError) as e:
        list(cg.compute(p))
    assert (e.value.status, e.value.reason) == (422, "zero_bin_negative")


# --------------------------------------------------------------------------------------------- the estimate

def _plan(path, parts, **kw):
    return cg.plan(get_reader(path), path, cg.parse_request(body(parts, **kw)))


def test_the_estimate_of_columns_is_per_million_cells_and_partitioning(store):
    p = _plan(store, [{"source": {"type": "obs", "key": "cell_type"}}, {"source": {"type": "obs", "key": "depth"}}])
    assert p.seconds == pytest.approx(gsc.BASE_SECONDS + 2 * cg.RESOLVE_SECONDS_PER_MCELL * gs.N_OBS / 1e6)
    est = p.estimate()
    assert est["tier"] == "auto" and est["lane"] == "light" and est["n_cells"] == gs.N_OBS
    for k in ("seconds", "live_max_s", "auto_max_s", "max_s", "entries", "layout", "parts"):
        assert k in est
    assert len(est["parts"]) == 2


@pytest.mark.parametrize("layout,lane", [("csc", "light"), ("csr", "heavy"), ("dense", "heavy")])
def test_a_gene_of_a_layer_stored_against_the_read_takes_the_heavy_lane(stores, layout, lane):
    p = _plan(stores[layout, "zarr"], [{"source": {"type": "layer", "key": "logged", "column": gs.gene(5)}}])
    assert p.lane == lane
    assert p.entries > 0 and p.estimate()["layout"] == layout


def test_a_score_partitioning_costs_its_score_first(store):
    recipe = {"genes": gs.GENE_SETS["b_markers"], "method": "mean", "input": "logged"}
    p = _plan(store, [{"source": {"type": "gene-score", "column": "mean", "layer": "logged", "recipe": recipe}}])
    sp = gsc.plan(get_reader(store), store, gsc.parse_recipe(recipe))
    assert p.lane == "heavy" and p.entries == sp.entries
    assert p.seconds == pytest.approx(sp.seconds + cg.RESOLVE_SECONDS_PER_MCELL * gs.N_OBS / 1e6)


def test_an_obsm_column_is_charged_its_whole_matrix(store):
    p = _plan(store, [{"source": {"type": "obsm", "key": "X_wide", "column": "3"}}])
    assert p.entries == gs.N_OBS * 50
    assert p.seconds == pytest.approx(gsc.BASE_SECONDS + gs.N_OBS * 50 / gsc.RATES["dense"]
                                      + cg.RESOLVE_SECONDS_PER_MCELL * gs.N_OBS / 1e6)


def test_the_cache_key_follows_what_changes_the_codes(store):
    base = [{"source": {"type": "obs", "key": "pseudotime"}, "binning": {"method": "equal_count", "bins": 4}}]
    k = _plan(store, base).cache_key
    assert _plan(store, json.loads(json.dumps(base))).cache_key == k
    alt = json.loads(json.dumps(base))
    alt[0]["binning"]["edges_from"] = "all"
    assert _plan(store, alt).cache_key != k
    assert _plan(store, base, small={"threshold": 10, "mode": "hide"}).cache_key != k
    assert _plan(store, base, subset={"obs": "x"}).cache_key != k
    inner = {"partitionings": base}
    a = _plan(store, [{"source": {"type": "cell-group", "key": "p1", "recipe": inner}}]).cache_key
    b = _plan(store, [{"source": {"type": "cell-group", "key": "p2", "recipe": inner}}]).cache_key
    assert a == b and a != k
    m1, m2 = np.zeros(gs.N_OBS, bool), np.zeros(gs.N_OBS, bool)
    m2[5] = True
    t = [{"source": {"type": "table", "ref": "s0"}}]
    assert _plan(store, t, sets={"s0": _bitset(m1)}).cache_key != _plan(store, t, sets={"s0": _bitset(m2)}).cache_key
