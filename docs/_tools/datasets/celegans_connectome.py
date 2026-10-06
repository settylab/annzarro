#!/usr/bin/env python
# Copyright (c) 2025-2026 Dominik J. Otto, Siddharth Baasri, Manu Setty
# SPDX-License-Identifier: MIT  (this script; see LICENSE in the annzarro repository)
"""Download the public C. elegans connectome and CeNGEN data and build an AnnZarro store.

The store links neuron-class transcriptomes (CeNGEN, Taylor et al. 2021) to the hermaphrodite
connectome (Varshney et al. 2011): one obs per neuron class, CeNGEN expression in X, and the
class-by-class synapse counts in obsp. It is the store of the connectome panel of the AnnZarro
paper's cell-by-cell figure (docs/paper/cell-by-cell.md).

    python celegans_connectome.py [--raw DIR] [--out PATH.zarr]

Defaults: ./celegans_connectome/raw and ./celegans_connectome/celegans_connectome_cengen.zarr.
Requires anndata (>= 0.12), zarr, scanpy, pandas, pyreadr, openpyxl and xlrd, and curl or a
Python whose TLS accepts wormatlas.org. Tested with Python 3.12, anndata 0.13.4, zarr 3.4.0,
scanpy 1.11.5 and umap-learn 0.5.12.

Licences. This script is MIT licensed and contains no data. It downloads every input from its
original public source at run time and checks each file's sha256; you obtain each input under
its own licence:

- WormAtlas NeuronConnect.xls, Varshney et al. 2011, PLoS Comput Biol 7:e1001066 (CC BY);
- cengenDataSC (github.com/AlexWeinreb/cengenDataSC, commit 32d20a2), CeNGEN tables of Taylor et
  al. 2021, Cell 184:4329 (GPL-3.0);
- Wang et al. 2024, eLife 13:RP95402, Supplementary File 2 (CC BY 4.0);
- NCBI gene_info for C. elegans (public domain; gene symbols only).

The store you build contains data derived from the GPL-3.0 CeNGEN tables. If you share it, share
it under GPL-3.0. The connectome of Cook et al. 2019 is not used: its files carry no licence
that allows redistribution.

Choices (as in the paper):
- obs unit = neuron class. Expression is measured per class; synapse counts are summed over the
  individual neurons of each class, so left/right and segmental differences are summed away.
- AWC_ON and AWC_OFF are merged (mean TPM) into AWC; which of AWCL/AWCR is ON is not known for
  the animal of the connectome.
- Motor neurons map to CeNGEN's split types (DA vs DA9, DB vs DB01, VA vs VA12, VB vs VB01/VB02,
  VC vs VC_4_5, VD_DD). CeNGEN types without neurons in the connectome are dropped.
- X = log1p(TPM) of the CeNGEN "medium" (threshold 2) table; layers['TPM_threshold2'] = TPM.
- obsp['chemical_synapses']: row = presynaptic class (S + Sp records); chemical_synapses_in is
  its transpose; gap_junctions is symmetric, each junction counted once.
- UMAP: 2,000 HVGs (seurat flavour), scale (max 10), PCA 20, neighbours k = 8, min_dist 0.4,
  seed 0.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import urllib.request
from pathlib import Path

import anndata as ad
import numpy as np
import pandas as pd
import pyreadr
import scanpy as sc

SEED = 0
CENGEN_SHA = "32d20a26381897134fc255e8502f04f9cbd85771"   # AlexWeinreb/cengenDataSC, 2021-09-27
_CENGEN = f"https://raw.githubusercontent.com/AlexWeinreb/cengenDataSC/{CENGEN_SHA}"
SOURCES = {  # file: (url, sha256, or None where the source is updated in place)
    "NeuronConnect.xls": (
        "https://www.wormatlas.org/images/NeuronConnect.xls",
        "120c2c6332050a2d1494c19c687f447ed65620ad0db5f8b732189aa10e5162f1"),
    "cengen_TPM.rda": (
        f"{_CENGEN}/data/cengen_TPM.rda",
        "b0ba599492b7079c542751d8d7e968dff0d6e78b23de4dabc353243078cc79d5"),
    "cengen_sc_2.rda": (
        f"{_CENGEN}/data/cengen_sc_2.rda",
        "78ecf3cec9dc9bec15544e421d09360e34e7542c83abf5e921b543dfa16b7615"),
    "cengenDataSC_LICENSE.md": (
        f"{_CENGEN}/LICENSE.md",
        "585e25ef8f5946a52bf2aed68d5becfc38be94a8663aa01c1b31d88aa57f1de3"),
    "elife-95402-supp2-v1.xlsx": (
        "https://cdn.elifesciences.org/articles/95402/elife-95402-supp2-v1.xlsx",
        "ad5175b5e53748acf77c6dfff1b5efcf15ed4364091239bd2def0095544eb18c"),
    # NCBI regenerates gene_info daily; only gene symbols (var names) come from it.
    "Caenorhabditis_elegans.gene_info.gz": (
        "https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO/Invertebrates/Caenorhabditis_elegans.gene_info.gz",
        None),
}
SPECIAL = {  # connectome neuron -> CeNGEN type, where the name does not say it
    "IL2DL": "IL2_DV", "IL2DR": "IL2_DV", "IL2VL": "IL2_DV", "IL2VR": "IL2_DV",
    "IL2L": "IL2_LR", "IL2R": "IL2_LR",
    "RMDDL": "RMD_DV", "RMDDR": "RMD_DV", "RMDVL": "RMD_DV", "RMDVR": "RMD_DV",
    "RMDL": "RMD_LR", "RMDR": "RMD_LR",
    "RMED": "RME_DV", "RMEV": "RME_DV", "RMEL": "RME_LR", "RMER": "RME_LR",
    "AWCL": "AWC", "AWCR": "AWC",
}
PALETTE = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2",
           "#7f7f7f", "#bcbd22", "#17becf", "#393b79", "#637939", "#8c6d31", "#843c39"]


def sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def download(raw: Path) -> None:
    """Fetch every input into `raw` (kept if already there) and check its sha256."""
    raw.mkdir(parents=True, exist_ok=True)
    for name, (url, want) in SOURCES.items():
        f = raw / name
        if not f.exists():
            print("downloading", url)
            try:   # curl first: wormatlas.org serves an incomplete TLS chain that Python's ssl rejects
                subprocess.run(["curl", "-fsSL", "-o", str(f), url], check=True)
            except (FileNotFoundError, subprocess.CalledProcessError):
                urllib.request.urlretrieve(url, f)
        got = sha256(f)
        if want and got != want:
            raise SystemExit(f"checksum mismatch for {name}: {got} != {want}")
        if not want:
            print(f"note: {name} sha256 {got} (not pinned)")


def expression(raw: Path) -> pd.DataFrame:
    """CeNGEN TPM masked by threshold 2 (the cengen.org "medium" table), genes x types."""
    tpm = list(pyreadr.read_r(raw / "cengen_TPM.rda").values())[0]
    thr = list(pyreadr.read_r(raw / "cengen_sc_2.rda").values())[0]   # binary mask
    tpm = tpm.loc[thr.index, thr.columns]          # drops the two "*_stressed" columns
    expr = tpm * thr
    expr["AWC"] = expr[["AWC_ON", "AWC_OFF"]].mean(axis=1)
    return expr.drop(columns=["AWC_ON", "AWC_OFF"])


def neuron_to_class(n: str, classes: list[str]) -> str | None:
    """Map a connectome neuron name (White et al. 1986 convention) to a CeNGEN type."""
    m = re.fullmatch(r"(DA|DB|VA|VB|VC|VD|DD|AS)(\d\d)", n)
    if m:
        fam, i = m.group(1), int(m.group(2))
        if fam == "DA":
            return "DA9" if i == 9 else "DA"
        if fam == "DB":
            return "DB01" if i == 1 else "DB"
        if fam == "VA":
            return "VA12" if i == 12 else "VA"
        if fam == "VB":
            return {1: "VB01", 2: "VB02"}.get(i, "VB")
        if fam == "VC":
            return "VC_4_5" if i in (4, 5) else "VC"
        if fam in ("VD", "DD"):
            return "VD_DD"
        return "AS"
    if n in SPECIAL:
        return SPECIAL[n]
    if n in classes:                      # e.g. ASEL, ASER, AVG, DVA, PVT
        return n
    for suf in ("DL", "DR", "VL", "VR", "L", "R", "D", "V"):
        if n.endswith(suf) and n[: -len(suf)] in classes:
            return n[: -len(suf)]
    return None


def connectome(raw: Path, classes: list[str]):
    """Class-level chemical and gap-junction matrices, plus what the mapping did."""
    con = pd.read_excel(raw / "NeuronConnect.xls")
    con.columns = ["n1", "n2", "type", "nbr"]
    con["n1"] = con["n1"].str.upper()   # one record spells AVFL/AVFR in lower case
    con["n2"] = con["n2"].str.upper()
    con = con[(con.n1 != "NMJ") & (con.n2 != "NMJ")]

    neurons = sorted(set(con.n1) | set(con.n2))
    n2c = {n: neuron_to_class(n, classes) for n in neurons}
    unmapped = sorted(n for n, c in n2c.items() if c is None)
    print("connectome neurons:", len(neurons), "unmapped:", unmapped)

    idx = {n: i for i, n in enumerate(neurons)}
    N = len(neurons)
    chem_n, chem_recv_n, gap_n = np.zeros((N, N)), np.zeros((N, N)), np.zeros((N, N))
    for r in con.itertuples():
        i, j = idx[r.n1], idx[r.n2]
        if r.type in ("S", "Sp"):        # n1 presynaptic to n2
            chem_n[i, j] += r.nbr
        elif r.type in ("R", "Rp"):      # n1 postsynaptic to n2
            chem_recv_n[j, i] += r.nbr
        elif r.type == "EJ":
            gap_n[i, j] += r.nbr
    checks = {
        "neuron_level_chemical_total_S_plus_Sp": float(chem_n.sum()),
        "neuron_level_chemical_total_R_plus_Rp": float(chem_recv_n.sum()),
        "neuron_level_send_vs_receive_max_abs_diff": float(np.abs(chem_n - chem_recv_n).max()),
        "neuron_level_gap_junction_entries_sum": float(gap_n.sum()),
        "neuron_level_gap_asymmetric_pairs": int((np.triu(gap_n != gap_n.T)).sum()),
    }
    # each junction is listed from both sides; where the two records disagree, take the larger
    gap_n = np.maximum(gap_n, gap_n.T)
    checks["neuron_level_gap_junctions_after_symmetrising"] = float(np.triu(gap_n).sum())

    keep = [c for c in classes if c in set(n2c.values())]
    dropped = [c for c in classes if c not in keep]
    print("classes with expression but no connectome neurons (dropped):", dropped)
    A = np.zeros((N, len(keep)))   # neuron -> class membership
    for n, c in n2c.items():
        if c in keep:
            A[idx[n], keep.index(c)] = 1
    chem = A.T @ chem_n @ A
    # a junction between two members of one class (e.g. AVAL-AVAR) lands twice on the class
    # diagonal; count it once. The file's three neuron-level self-junctions are kept as listed.
    gap_self = np.diag(np.diag(gap_n))
    gap_cross = A.T @ (gap_n - gap_self) @ A
    gap_cross[np.diag_indices_from(gap_cross)] *= 0.5
    gap = gap_cross + A.T @ gap_self @ A
    checks["class_level_chemical_total"] = float(chem.sum())
    checks["class_level_gap_junctions_total_upper_incl_diag"] = float(np.triu(gap).sum())
    return keep, n2c, chem, gap, checks, unmapped, dropped


def neurotransmitters(raw: Path) -> dict[str, str]:
    """Neuron -> primary neurotransmitter, from Wang et al. 2024, Supplementary File 2."""
    nt = pd.read_excel(raw / "elife-95402-supp2-v1.xlsx", header=None).iloc[4:, [2, 20]]
    nt.columns = ["neuron", "nt"]
    nt = nt.dropna()
    nt["neuron"] = nt.neuron.astype(str).str.strip()

    def clean(v: str) -> str:
        v = v.replace("*", "").replace(" - NEW", "").strip()
        return "unknown" if v.lower().startswith("unknown") else v

    nt_map: dict[str, str] = {}
    for name, v in zip(nt.neuron, nt.nt.astype(str).map(clean)):
        # Wang et al. write motor neurons as DA1, DB1/3, VC4; the connectome uses DA01, DB01
        for part in name.split("/"):
            m = re.fullmatch(r"([A-Z]+)(\d+)", part) if "/" in name else re.fullmatch(r"([A-Z]+)(\d+)", name)
            key = f"{m.group(1)}{int(m.group(2)):02d}" if m else name
            if "/" in name and not m:
                continue
            nt_map.setdefault(key, v)
            if "/" not in name:
                break
    return nt_map


def build(raw: Path, out: Path) -> None:
    download(raw)
    expr = expression(raw)
    classes = list(expr.columns)
    keep, n2c, chem, gap, checks, unmapped, dropped = connectome(raw, classes)

    genes = pd.read_csv(raw / "Caenorhabditis_elegans.gene_info.gz", sep="\t")
    genes["wb"] = genes.dbXrefs.str.extract(r"WormBase:(WBGene\d+)")
    sym = genes.dropna(subset=["wb"]).drop_duplicates("wb").set_index("wb").Symbol

    E = expr[keep].T                                   # classes x genes, TPM (thresholded)
    var = pd.DataFrame(index=E.columns)
    var["gene_symbol"] = [sym.get(g, g) for g in var.index]
    var["wbgene"] = var.index

    nt_map = neurotransmitters(raw)
    obs = pd.DataFrame(index=pd.Index(keep, name="neuron_class"))
    obs["neuron_class"] = keep
    members = {c: sorted(n for n, cc in n2c.items() if cc == c) for c in keep}
    obs["neurons"] = [",".join(members[c]) for c in keep]
    obs["n_neurons"] = [len(members[c]) for c in keep]

    def class_nt(c):
        vals = sorted({nt_map[n] for n in members[c] if n in nt_map})
        return "/".join(vals) if vals else "unknown"

    obs["neurotransmitter"] = pd.Categorical([class_nt(c) for c in keep])
    obs["chemical_out_total"] = chem.sum(1)
    obs["chemical_in_total"] = chem.sum(0)
    obs["gap_junction_total"] = gap.sum(1)

    adata = ad.AnnData(X=np.log1p(E.values).astype(np.float32), obs=obs, var=var)
    adata.layers["TPM_threshold2"] = E.values.astype(np.float32)
    adata.var_names = [f"{s}" for s in adata.var.gene_symbol]
    adata.var_names_make_unique()

    sc.pp.highly_variable_genes(adata, n_top_genes=2000, flavor="seurat")
    tmp = adata[:, adata.var.highly_variable].copy()
    sc.pp.scale(tmp, max_value=10)
    sc.tl.pca(tmp, n_comps=20, random_state=SEED)
    sc.pp.neighbors(tmp, n_neighbors=8, n_pcs=20, random_state=SEED)
    sc.tl.umap(tmp, min_dist=0.4, random_state=SEED)
    adata.obsm["X_pca"] = tmp.obsm["X_pca"].astype(np.float32)
    adata.obsm["X_umap"] = tmp.obsm["X_umap"].astype(np.float32)

    adata.obsp["chemical_synapses"] = chem.astype(np.float32)              # row = outputs
    adata.obsp["chemical_synapses_in"] = chem.T.copy().astype(np.float32)  # row = inputs
    adata.obsp["gap_junctions"] = gap.astype(np.float32)                   # symmetric

    cats = adata.obs.neurotransmitter.cat.categories
    adata.uns["neurotransmitter_colors"] = [("#bbbbbb" if c == "unknown" else PALETTE[i % len(PALETTE)])
                                            for i, c in enumerate(cats)]
    adata.uns["provenance"] = {
        "expression": "CeNGEN (Taylor et al. 2021, doi:10.1016/j.cell.2021.06.023); cengenDataSC "
                      "commit 32d20a2, GPL-3.0; TPM per neuron type masked by threshold 2; X = log1p(TPM)",
        "connectome": "Varshney et al. 2011 (doi:10.1371/journal.pcbi.1001066, CC BY); WormAtlas "
                      "NeuronConnect.xls (2006-02-02 version); counts of synapses summed over class members",
        "neurotransmitter": "Wang et al. 2024 eLife (doi:10.7554/eLife.95402, CC BY), Supplementary File 2",
        "embedding": f"2000 HVG (seurat), scale(max 10), PCA 20, neighbors k=8, UMAP min_dist 0.4, seed {SEED}",
        "sha256": json.dumps({n: sha256(raw / n) for n in SOURCES}),
    }
    adata.uns["sanity_checks"] = json.dumps(checks)
    adata.uns["unmapped_connectome_neurons"] = json.dumps(unmapped)
    adata.uns["classes_dropped_no_connectome"] = json.dumps(dropped)

    ad.settings.zarr_write_format = 2
    if out.exists():
        shutil.rmtree(out)
    adata.write_zarr(out)

    b = ad.read_zarr(out)
    g = b.obsp["gap_junctions"]
    print(b)
    print("gap symmetric:", bool(np.allclose(g, g.T)))
    print("chem_in == chem.T:", bool(np.allclose(b.obsp["chemical_synapses_in"], b.obsp["chemical_synapses"].T)))
    print("checks:", json.dumps(checks, indent=1))
    ava = list(b.obs_names).index("AVA")
    row = b.obsp["chemical_synapses"][ava]
    print("AVA outputs, top partners:", [(b.obs_names[i], int(row[i])) for i in np.argsort(-row)[:8]])
    print("wrote", out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--raw", type=Path, default=Path("celegans_connectome") / "raw",
                    help="where the downloads go (kept for reruns)")
    ap.add_argument("--out", type=Path,
                    default=Path("celegans_connectome") / "celegans_connectome_cengen.zarr")
    a = ap.parse_args()
    build(a.raw, a.out)


if __name__ == "__main__":
    main()
