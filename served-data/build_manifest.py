#!/usr/bin/env python
"""Single source of truth for AnnZarro dataset coverage of the DoLiMap corpus.

Every dataset *entity* in DoLiMap (work/liver-data-research/entities/dataset/*.md)
must be served as a harmonized .zarr under served-data/datasets/. This script is
the kept-updated ledger: it binds each entity to its served store(s), enriches
each row with live facts read straight from the zarr (cell count, layers,
cell_type, embedding), and emits both a machine table (SERVED_DATASETS.tsv) and a
human page (SERVED_DATASETS.md).

USAGE
  # regenerate the manifest from the live served tree + entity files:
  .venv-pilot/bin/python3 served-data/build_manifest.py

  # CI / drift gate — exit nonzero on ANY coverage gap, no rewrite:
  .venv-pilot/bin/python3 served-data/build_manifest.py --check

HOW TO KEEP IT UPDATED
  Re-run this script whenever a served zarr is added/removed or a new dataset
  entity lands in DoLiMap. The volatile columns (status, n_cells, layers) are
  computed live, so a stale store or a new entity surfaces immediately. The one
  human-curated part is SEED below: the explicit entity -> accession -> zarr
  binding. Add a row to SEED when a new entity is served; the script fails loud
  (--check exits nonzero) if an entity file exists with no SEED row (drift), or
  if a SEED-declared zarr is absent on disk (a gap).

RECONCILIATION
  SEED must agree with the DoLiMap deep-link registry (_ANNZARRO_REGISTRY in the
  website build.py). Both enumerate the same entity->zarr bindings; if you add a
  dataset here, add the matching [[annzarro:..]] registry entry there too.
"""
import os
import sys
import zarr

HERE = os.path.dirname(os.path.abspath(__file__))
DATASETS_DIR = os.path.join(HERE, "datasets")
ENTITIES_DIR = os.path.normpath(os.path.join(
    HERE, "..", "..", "liver-data-research", "entities", "dataset"))
TSV_PATH = os.path.join(HERE, "SERVED_DATASETS.tsv")
MD_PATH = os.path.join(HERE, "SERVED_DATASETS.md")

# --- The human-curated binding: entity -> accession -> served zarr -----------
# role: served = primary harmonized store (counts toward coverage)
#       served-spatial = spatial/Visium/LCM store that IS the entity's store
#       variant = supplementary store for an already-served entity
# (entity_id, accession, title, zarr_filename, role)
SEED = [
    ("A1", "GSE178318", "Che 2021 CRLM atlas — paired CRC + liver met + blood",        "GSE178318_harmonized.zarr",                 "served"),
    ("A2", "GSE164522", "Liu 2022 CRLM immune atlas — CD45+ 5' scRNA + scTCR, 6-site",  "GSE164522_harmonized.zarr",                 "served"),
    ("A3", "GSE225857", "Wang 2023 CRLM scRNA + matched Visium (spatial keystone)",      "GSE225857_harmonized.zarr",                 "served"),
    ("A3", "GSE225857", "Wang 2023 CRLM Visium (cell2location mapped)",                   "GSE225857_spatial_mapped_harmonized.zarr",  "variant"),
    ("A4", "GSE146409", "Massalha 2020 LCM mini-bulk, cross-disease zonation",           "GSE146409_spatial_lcm_harmonized.zarr",     "served-spatial"),
    ("A5", "GSE206552", "Garbarino 2023 CRLM Visium (independent replicate)",            "GSE206552_spatial_mapped_harmonized.zarr",  "served-spatial"),
    ("B1", "GSE115469", "MacParland 2018 healthy-liver reference",                       "GSE115469_harmonized.zarr",                 "served"),
    ("B2", "GSE192741", "Guilliams 2022 Liver Cell Atlas",                               "GSE192741_harmonized.zarr",                 "served"),
    ("B3", "GSE136103", "Ramachandran 2019 cirrhotic-liver reference",                   "GSE136103_harmonized.zarr",                 "served"),
    ("B4", "GSE124395", "Aizarani 2019 epithelial/progenitor reference",                 "GSE124395_harmonized.zarr",                 "served"),
    ("C1", "GSE125449", "Ma 2019 primary liver cancer (HCC + iCCA)",                     "GSE125449_harmonized.zarr",                 "served"),
    ("C2", "GSE149614", "Lu 2022 multi-site HCC ecosystem",                              "GSE149614_harmonized.zarr",                 "served"),
    ("C3", "GSE138709", "Zhang 2020 iCCA architecture",                                  "GSE138709_harmonized.zarr",                 "served"),
    ("C4", "GSE140228", "Zhang 2019 HCC CD45+ immune landscape",                         "GSE140228_harmonized.zarr",                 "served"),
    ("D1", "GSE197177", "Zhou 2023 PDAC primary <-> hepatic metastasis",                 "GSE197177_harmonized.zarr",                 "served"),
    ("D2", "GSE263733", "Kim 2024 PDAC primary <-> liver met, clonal evolution",         "GSE263733_harmonized.zarr",                 "served"),
    ("D3", "scPLM(DOI:10.34133/research.1208)", "Tong/Wang 2024 pan-cancer liver-met atlas (validation backbone)", "scPLM_harmonized.zarr", "served"),
    ("F1", "GSE235863", "Guo 2025 anti-PD-1+lenvatinib HBV+ HCC, CD45+ immune",          "GSE235863_harmonized.zarr",                 "served"),
    ("integrated-meta-atlas", "integrated_scvi", "Integrated cross-dataset liver meta-atlas (scVI embedding, 1.17M cells)", "integrated_scvi.zarr", "served"),
    ("integrated-meta-atlas", "integrated_raw",  "Integrated meta-atlas (raw, no joint embedding)",                        "integrated_raw.zarr",  "variant"),
]

COVERAGE_ROLES = {"served", "served-spatial"}
CELLTYPE_CANDIDATES = ("cell_type", "cell_type_fine", "celltype", "author_celltype")


def entity_ids_on_disk():
    """The canonical set of DoLiMap dataset entity ids (from the .md filenames)."""
    ids = set()
    if not os.path.isdir(ENTITIES_DIR):
        return ids
    for fn in os.listdir(ENTITIES_DIR):
        if fn.endswith(".md"):
            ids.add(fn[:-3])
    return ids


def probe_zarr(path):
    """Read live facts from a zarr store (no matrix materialization)."""
    g = zarr.open(path, mode="r")
    try:
        n = int(g["obs/_index"].shape[0])
    except Exception:
        try:
            n = int(g["X"].attrs.get("shape", [0])[0])
        except Exception:
            n = 0
    layers = sorted(g["layers"].keys()) if "layers" in g else []
    obsm = sorted(g["obsm"].keys()) if "obsm" in g else []
    obscols = sorted(g["obs"].keys()) if "obs" in g else []
    celltype = next((c for c in CELLTYPE_CANDIDATES if c in obscols), "")
    has_umap = "X_umap" in obsm
    return {"n_cells": n, "layers": layers, "celltype": celltype, "has_umap": has_umap}


def build_rows():
    rows = []
    for entity, accession, title, zarr_fn, role in SEED:
        path = os.path.join(DATASETS_DIR, zarr_fn)
        # resolve symlink target existence (served zarrs are symlinks)
        exists = os.path.exists(path)
        if exists:
            try:
                facts = probe_zarr(path)
                status = role
            except Exception as e:
                facts = {"n_cells": 0, "layers": [], "celltype": "", "has_umap": False}
                status = "error:" + type(e).__name__
        else:
            facts = {"n_cells": 0, "layers": [], "celltype": "", "has_umap": False}
            status = "missing"
        rows.append({
            "entity_id": entity, "accession": accession, "title": title,
            "served_zarr": zarr_fn, "status": status,
            "n_cells": facts["n_cells"], "layers": ",".join(facts["layers"]) or "-",
            "celltype": facts["celltype"] or "-",
            "umap": "yes" if facts["has_umap"] else "no",
        })
    return rows


def coverage_report(rows):
    """Returns (covered_entities, all_entities, missing_zarrs, drift_entities)."""
    all_entities = entity_ids_on_disk()
    seed_entities = {r["entity_id"] for r in rows}
    covered = {r["entity_id"] for r in rows if r["status"] in COVERAGE_ROLES}
    missing_zarrs = [r for r in rows if r["status"] == "missing"]
    error_rows = [r for r in rows if r["status"].startswith("error:")]
    # entities present in DoLiMap but absent from SEED == undocumented drift
    drift = sorted(all_entities - seed_entities)
    uncovered = sorted(all_entities - covered)
    return covered, all_entities, missing_zarrs, error_rows, drift, uncovered


def write_tsv(rows, updated):
    cols = ["entity_id", "accession", "title", "served_zarr", "status",
            "n_cells", "layers", "celltype", "umap", "updated"]
    with open(TSV_PATH, "w") as f:
        f.write("\t".join(cols) + "\n")
        for r in rows:
            r2 = dict(r); r2["updated"] = updated
            f.write("\t".join(str(r2[c]) for c in cols) + "\n")


def write_md(rows, updated, cov):
    covered, all_entities, missing_zarrs, error_rows, drift, uncovered = cov
    n_cov, n_all = len(covered), len(all_entities)
    pct = (100.0 * n_cov / n_all) if n_all else 0.0
    lines = []
    lines.append("# AnnZarro served-dataset coverage (DoLiMap corpus)\n")
    lines.append(f"**Coverage: {n_cov}/{n_all} dataset entities served "
                 f"({pct:.0f}%)** · generated {updated}\n")
    lines.append(
        "This is the single source of truth for which DoLiMap dataset entities "
        "are served on AnnZarro (`:8766`). One row per served store. An entity "
        "is *covered* when it has at least one row with status `served` or "
        "`served-spatial`. Regenerate with "
        "`.venv-pilot/bin/python3 served-data/build_manifest.py`; gate drift in "
        "CI with `--check` (exits nonzero on any gap). The deep-link registry "
        "(`_ANNZARRO_REGISTRY` in the DoLiMap website `build.py`) must list the "
        "same bindings.\n")
    lines.append("**Status vocabulary:** `served` = primary harmonized sc/sn "
                 "store · `served-spatial` = spatial/Visium/LCM store that is "
                 "the entity's store · `variant` = supplementary store for an "
                 "already-served entity (extra modality/embedding) · `missing` = "
                 "referenced entity with no live zarr (a gap).\n")
    if uncovered:
        lines.append(f"> ⚠️ **GAP: {len(uncovered)} entity(ies) uncovered:** "
                     f"{', '.join(uncovered)}\n")
    if drift:
        lines.append(f"> ⚠️ **DRIFT: entity file(s) with no manifest row:** "
                     f"{', '.join(drift)} — add to SEED in build_manifest.py.\n")
    lines.append("| entity | accession | served zarr | status | n_cells | layers | cell_type | umap | title |")
    lines.append("|---|---|---|---|--:|---|---|---|---|")
    for r in rows:
        lines.append("| {entity_id} | {accession} | `{served_zarr}` | {status} | "
                     "{n_cells:,} | {layers} | {celltype} | {umap} | {title} |".format(**r))
    lines.append("")
    with open(MD_PATH, "w") as f:
        f.write("\n".join(lines))


def main():
    check = "--check" in sys.argv[1:]
    # a fixed-ish stamp: callers pass UPDATED env for reproducibility; else 'unknown'
    updated = os.environ.get("MANIFEST_UPDATED", "see git log")
    rows = build_rows()
    cov = coverage_report(rows)
    covered, all_entities, missing_zarrs, error_rows, drift, uncovered = cov

    if check:
        ok = True
        if uncovered:
            print(f"[check] FAIL: {len(uncovered)} uncovered entity(ies): {', '.join(uncovered)}")
            ok = False
        if drift:
            print(f"[check] FAIL: {len(drift)} entity file(s) absent from SEED: {', '.join(drift)}")
            ok = False
        if missing_zarrs:
            print(f"[check] FAIL: {len(missing_zarrs)} declared zarr(s) missing on disk: "
                  f"{', '.join(r['served_zarr'] for r in missing_zarrs)}")
            ok = False
        if error_rows:
            print(f"[check] FAIL: {len(error_rows)} zarr(s) unreadable: "
                  f"{', '.join(r['served_zarr'] for r in error_rows)}")
            ok = False
        if ok:
            print(f"[check] OK: {len(covered)}/{len(all_entities)} entities covered (100%).")
            sys.exit(0)
        sys.exit(1)

    write_tsv(rows, updated)
    write_md(rows, updated, cov)
    print(f"[build] wrote {TSV_PATH}")
    print(f"[build] wrote {MD_PATH}")
    print(f"[build] coverage: {len(covered)}/{len(all_entities)} entities "
          f"({100.0*len(covered)/max(1,len(all_entities)):.0f}%)")
    if uncovered:
        print(f"[build] WARNING uncovered: {', '.join(uncovered)}")
    if drift:
        print(f"[build] WARNING drift (no SEED row): {', '.join(drift)}")


if __name__ == "__main__":
    main()
