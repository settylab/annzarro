# Kompot outputs

Kompot {cite:p}`otto2025kompot` computes differential abundance (DA) and differential
expression (DE) between conditions as smooth functions over cell states, and writes its results
into the AnnData object. AnnZarro shows those results without recomputing anything, so a
Kompot run is the most direct way to fill every slot in the {doc}`slot-map` with something worth
clicking on.

## What Kompot writes, and where it appears

Field names below are from the demonstration data (kompot 0.8.0, conditions Young and Old).
Kompot builds them as `kompot_{da,de}_<condition 1>_to_<condition 2>_<field>`; they differ
between Kompot versions and runs, so read them from the run record (next section) rather than
typing them.

| Slot | Field (demonstration data) | Type | Use in AnnZarro |
|---|---|---|---|
| `obs` | `kompot_da_Young_to_Old_lfc_zscore` | float64 | colour cells by age-related abundance change; filter tables (`> 2`) |
| `obs` | `kompot_da_Young_to_Old_lfc`, `..._neg_log10_lfc_ptp` | float64 | same, unscaled; significance |
| `obs` | `kompot_da_Young_to_Old_lfc_direction` | categorical | colour or filter by direction |
| `obs` | `kompot_da_{Young,Old}_log_density` | float64 | per-condition cell density |
| `obs` | `kompot_de_{Young,Old}_std` | float64 | per-cell uncertainty of the expression fit |
| `var` | `kompot_de_Young_to_Old_mean_lfc` | float64 | Gene Plot X of the volcano |
| `var` | `kompot_de_Young_to_Old_mahalanobis` | float64 | Gene Plot Y of the volcano |
| `var` | `kompot_de_Young_to_Old_mahalanobis_local_fdr` | float64 | Gene Table filter |
| `var` | `kompot_de_Young_to_Old_is_de` | bool | colour or filter called genes |
| `layers` | `kompot_de_Young_to_Old_fold_change` | dense, cells × genes | **focused gene's column on the embedding**: where in cell-state space the gene changes; **focused cell's row in a Gene Plot**: that cell's age effect over all genes |
| `layers` | `kompot_de_Young_smoothed`, `kompot_de_Old_smoothed` | dense, cells × genes | imputed expression in each condition, same two directions |
| `uns` | `kompot_de`, `kompot_da` | groups | run records (`last_run_info`, `run_history`) |

With `groups` set, Kompot also writes per-group statistics to `varm`
(`mean_lfc_varm_key`, `mahalanobis_varm_key`), which become Gene Plot axes. The demonstration
run did not use groups.

The dense layers are the expensive part: three float32 arrays of 8,090 × 16,285 values here,
about 0.5 GB each on disk. Their chunking decides click latency at scale ({doc}`chunking`).

:::{warning}
**Do not call `kompot.cleanup(adata)` before saving.** The Kompot tutorial ends with it, and it
deletes the `*_smoothed` and `*_fold_change` layers. Without them the cells × genes views (paper
{doc}`Fig. 5 <../paper/fig5-cells-and-genes>`) and the fold-change correlation in varp cannot be
built. If you already ran it, re-run `kompot.de`.
:::

## Reading the field names from the run record

`uns["kompot_de"]["last_run_info"]` holds a `field_names` dictionary. In kompot 0.8 the run
record is stored as a **JSON string**, and it stays a string after an h5ad or zarr round trip.
Indexing it directly fails with `TypeError: string indices must be integers`. Decode it first:

```python
import json

def kompot_fields(adata, kind):            # kind: "kompot_de" or "kompot_da"
    info = adata.uns[kind]["last_run_info"]
    if isinstance(info, (str, bytes)):     # stored as a JSON string
        info = json.loads(info)
    return info["field_names"]

de, da = kompot_fields(adata, "kompot_de"), kompot_fields(adata, "kompot_da")
FC_KEY      = de["fold_change_key"]
SMOOTH_KEYS = [de["smoothed_key_1"], de["smoothed_key_2"]]
LFC_KEY, MAHAL_KEY = de["mean_lfc_key"], de["mahalanobis_key"]
DA_Z_KEY    = da["zscore_key"]
assert FC_KEY in adata.layers              # fails if kompot.cleanup() was run
```

The same record can be read from a finished store without loading the matrices:

```python
import json, zarr

def kompot_fields_from_store(path, kind):
    info = zarr.open_group(path, mode="r")["uns"][kind]["last_run_info"][()]
    return json.loads(str(info))["field_names"]

de = kompot_fields_from_store("bm_aging.zarr", "kompot_de")
for k in ("fold_change_key", "smoothed_key_1", "smoothed_key_2", "mean_lfc_key", "mahalanobis_key", "is_de_key"):
    print(f"{k:16s} {de[k]}")
```

```text
fold_change_key  kompot_de_Young_to_Old_fold_change
smoothed_key_1   kompot_de_Young_smoothed
smoothed_key_2   kompot_de_Old_smoothed
mean_lfc_key     kompot_de_Young_to_Old_mean_lfc
mahalanobis_key  kompot_de_Young_to_Old_mahalanobis
is_de_key        kompot_de_Young_to_Old_is_de
```

```{important}
`field_names` also lists keys that were **not stored**. In the demonstration run it names
`kompot_de_Young_to_Old_neg_log10_ptp` (var), `kompot_de_Young_to_Old_fold_change_zscores`
(layers) and `kompot_de_Young_to_Old_posterior_covariance` (obsp), and none of the three is in
the store. Check membership before using a key.
```

AnnZarro's own `uns` route does not decode string scalars: `GET /api/v1/data/uns/kompot_de/last_run_info`
answers `{"data": null}` ({doc}`../reference/troubleshooting`). Read run records in Python.

## Views to set up

These are the paper's Options B-D; {doc}`../paper/index` has the full walk-throughs.

- **Volcano.** Gene Plot, X = var `..._mean_lfc`, Y = var `..._mahalanobis`. The Gene Plot's
  default source is varm; switch both axes to var.
- **Where a gene changes.** Cell Plot on `X_umap`, colour = layer `..._fold_change`, column =
  focused gene, with a diverging colour scale centred on 0. Clicking a gene in the volcano
  recolours the embedding.
- **A cell's age effect over genes.** Gene Plot on the volcano axes, colour = layer
  `..._fold_change`, row = focused cell. Clicking a cell recolours the genes.
- **Two cells against each other.** Gene Plot, X = fold-change layer of the locked cell,
  Y = of the focused cell ({doc}`../user-guide/focus-and-lock`).
- **Abundance.** Cell Plot coloured by obs `kompot_da_..._lfc_zscore`; Cell Table filtered on it.

Gene-module views need a genes × genes matrix Kompot does not write; {doc}`pairwise-matrices`
adds Spearman correlations of the fold-change and smoothed layers.
