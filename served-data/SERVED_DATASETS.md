# AnnZarro served-dataset coverage (DoLiMap corpus)

**Coverage: 18/18 dataset entities served (100%)** · generated 2026-06-07

This is the single source of truth for which DoLiMap dataset entities are served on AnnZarro (`:8766`). One row per served store. An entity is *covered* when it has at least one row with status `served` or `served-spatial`. Regenerate with `.venv-pilot/bin/python3 served-data/build_manifest.py`; gate drift in CI with `--check` (exits nonzero on any gap). The deep-link registry (`_ANNZARRO_REGISTRY` in the DoLiMap website `build.py`) must list the same bindings.

**Status vocabulary:** `served` = primary harmonized sc/sn store · `served-spatial` = spatial/Visium/LCM store that is the entity's store · `variant` = supplementary store for an already-served entity (extra modality/embedding) · `missing` = referenced entity with no live zarr (a gap).

| entity | accession | served zarr | status | n_cells | layers | cell_type | umap | title |
|---|---|---|---|--:|---|---|---|---|
| A1 | GSE178318 | `GSE178318_harmonized.zarr` | served | 126,314 | counts,logcounts,normalized_counts | cell_type | yes | Che 2021 CRLM atlas — paired CRC + liver met + blood |
| A2 | GSE164522 | `GSE164522_harmonized.zarr` | served | 257,843 | logcounts | cell_type | yes | Liu 2022 CRLM immune atlas — CD45+ 5' scRNA + scTCR, 6-site |
| A3 | GSE225857 | `GSE225857_harmonized.zarr` | served | 222,728 | counts,logcounts,normalized_counts | cell_type | yes | Wang 2023 CRLM scRNA + matched Visium (spatial keystone) |
| A3 | GSE225857 | `GSE225857_spatial_mapped_harmonized.zarr` | variant | 21,739 | counts | - | no | Wang 2023 CRLM Visium (cell2location mapped) |
| A4 | GSE146409 | `GSE146409_spatial_lcm_harmonized.zarr` | served-spatial | 63 | counts,lognorm | - | no | Massalha 2020 LCM mini-bulk, cross-disease zonation |
| A5 | GSE206552 | `GSE206552_spatial_mapped_harmonized.zarr` | served-spatial | 9,712 | counts | - | no | Garbarino 2023 CRLM Visium (independent replicate) |
| B1 | GSE115469 | `GSE115469_harmonized.zarr` | served | 8,444 | logcounts,normalized_counts | cell_type | yes | MacParland 2018 healthy-liver reference |
| B2 | GSE192741 | `GSE192741_harmonized.zarr` | served | 159,141 | counts,logcounts,normalized_counts | cell_type | yes | Guilliams 2022 Liver Cell Atlas |
| B3 | GSE136103 | `GSE136103_harmonized.zarr` | served | 85,942 | counts,logcounts,normalized_counts | cell_type | yes | Ramachandran 2019 cirrhotic-liver reference |
| B4 | GSE124395 | `GSE124395_harmonized.zarr` | served | 11,947 | counts,logcounts,normalized_counts | cell_type | yes | Aizarani 2019 epithelial/progenitor reference |
| C1 | GSE125449 | `GSE125449_harmonized.zarr` | served | 8,966 | counts,logcounts,normalized_counts | cell_type | yes | Ma 2019 primary liver cancer (HCC + iCCA) |
| C2 | GSE149614 | `GSE149614_harmonized.zarr` | served | 68,175 | counts,logcounts,normalized_counts | cell_type | yes | Lu 2022 multi-site HCC ecosystem |
| C3 | GSE138709 | `GSE138709_harmonized.zarr` | served | 31,195 | counts,logcounts,normalized_counts | cell_type | yes | Zhang 2020 iCCA architecture |
| C4 | GSE140228 | `GSE140228_harmonized.zarr` | served | 62,765 | counts,logcounts,normalized_counts | cell_type | yes | Zhang 2019 HCC CD45+ immune landscape |
| D1 | GSE197177 | `GSE197177_harmonized.zarr` | served | 57,747 | counts,logcounts,normalized_counts | cell_type | yes | Zhou 2023 PDAC primary <-> hepatic metastasis |
| D2 | GSE263733 | `GSE263733_harmonized.zarr` | served | 65,537 | counts,logcounts,normalized_counts | cell_type | yes | Kim 2024 PDAC primary <-> liver met, clonal evolution |
| D3 | scPLM(DOI:10.34133/research.1208) | `scPLM_harmonized.zarr` | served | 460,337 | logcounts | cell_type | yes | Tong/Wang 2024 pan-cancer liver-met atlas (validation backbone) |
| F1 | GSE235863 | `GSE235863_harmonized.zarr` | served | 181,770 | counts,logcounts,normalized_counts | cell_type | yes | Guo 2025 anti-PD-1+lenvatinib HBV+ HCC, CD45+ immune |
| integrated-meta-atlas | integrated_scvi | `integrated_scvi.zarr` | served | 1,165,934 | counts,lognorm | cell_type | yes | Integrated cross-dataset liver meta-atlas (scVI embedding, 1.17M cells) |
| integrated-meta-atlas | integrated_raw | `integrated_raw.zarr` | variant | 1,165,934 | counts,lognorm | cell_type | no | Integrated meta-atlas (raw, no joint embedding) |
