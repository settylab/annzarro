(tut-gene-groups)=
# Group genes by several measures at once

A volcano sorts genes by one test. The question here needs several measures side by side: which
genes change with age *together with* H2-Q7, and also rise in one particular stem cell? The first
measure is gene by gene (a row of a gene x gene correlation matrix), the second is cell by gene
(a row of a cells x genes layer). Neither is a stored column of `var`.

A gene table can hold both. You focus a gene and a cell, add a column from each, and put a
threshold on each column. The genes that pass form the group: a volcano linked to the table shows
them, and a Gene Set Analysis panel asks external services what they have in common. Change a
threshold and everything follows. Change the focus and nothing does: a column added from the
focused cell keeps that cell, and its header names it.

## What you need

- AnnZarro running locally ({doc}`../getting-started/quickstart`) with `bm_aging.zarr` in its
  data directory.
- Network access for step 4: the Gene Set Analysis panel fetches its results from STRING,
  g:Profiler and MyGene.info.
- These fields:

| Slot | Key | Used for |
|---|---|---|
| `varp` | `spearman_fold_change` | a column: each gene's Spearman ρ with H2-Q7, across cells, of the Kompot fold changes |
| `layers` | `kompot_de_Young_to_Old_fold_change` | a column: each gene's fold change (Old minus Young, log2) in one HSC |
| `var` | `kompot_de_Young_to_Old_mahalanobis`, `kompot_de_Young_to_Old_mean_lfc` | the volcano, and two plain columns |

`spearman_fold_change` is introduced in {doc}`gene-similarity`, the fold-change layer in
{doc}`cells-and-genes`. The cell is the HSC used there, `HSPC_Old_1#GAAGCCCGTGGCTCTG-1`.

::::{dropdown} Start here: the table with two var columns, the linked volcano and the Gene Set Analysis panel
```{literalinclude} ../_static/panelsets/tutorials/gene-groups-start.url.txt
:language: text
```
Panel set file: {download}`gene-groups-start.json <../_static/panelsets/tutorials/gene-groups-start.json>`.
The link is ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

(tut-gg-setup)=
## 1. Focus a gene and a cell, and lay out the panels

1. Open `bm_aging.zarr` from **Dataset**.
2. Set **Focused Gene** to `H2-Q7`. Set **Focused Cell** to `HSPC_Old_1#GAAGCCCGTGGCTCTG-1`
   (type `GAAGCCCGTGGCTCTG` and pick it).
3. Add a **Gene Table**. Open its controls (the chevron in the tile header) and, on the `var`
   tab, tick `kompot_de_Young_to_Old_mahalanobis` and `kompot_de_Young_to_Old_mean_lfc`. Press
   **Apply Changes**.
4. Add a **Gene Plot**: **X** `var`, `kompot_de_Young_to_Old_mean_lfc`; **Y** `var`,
   `kompot_de_Young_to_Old_mahalanobis`. In **Table**, choose the gene table and leave the remove
   toggle (the eye) off, so the genes outside the table stay as grey points
   ({doc}`../user-guide/tables-and-filters`). The start link colours the volcano by H2-Q7's row
   of `spearman_fold_change`, locked to H2-Q7, on a fixed −1 to 1 scale.
5. Add a **Gene Set Analysis** panel. It follows the gene table by itself (**Source**).

(tut-gg-columns)=
## 2. Add a column from the focused gene and one from the focused cell

1. In the gene table's controls, open the `varp` tab. It lists one entry per matrix for the
   focused gene, marked `(focused)`, and one for every gene a plot is locked to. Tick
   `spearman_fold_change: H2-Q7 (focused)`.

   ```{figure} ../_static/screens/tutorials/gene-groups-chooser-varp.png
   :class: screenshot
   :alt: The gene table's column chooser on the varp tab, with spearman_fold_change: H2-Q7 (focused) ticked.

   The focused gene's row of each `varp` matrix, offered as a column.
   ```

2. Open the `layers` tab. It lists every layer for the focused cell. Tick
   `kompot_de_Young_to_Old_fold_change: HSPC_Old_1#GAAGCCCGTGGCTCTG-1 (focused)`.

   ```{figure} ../_static/screens/tutorials/gene-groups-chooser-layer.png
   :class: screenshot
   :alt: The layers tab with the fold change of the focused HSC ticked; Selected Columns lists four columns.

   The focused cell's row of each layer. **Selected Columns** now lists four columns.
   ```

3. Press **Apply Changes**. The table gains two columns, headed
   `spearman_fold_change: H2-Q7` and
   `kompot_de_Young_to_Old_fold_change: HSPC_Old_1#GAAGCCCGTGGCTCTG-1`.

The headers name the gene and the cell, not "focused". The focus only helped you pick them: each
column holds that one gene's row or that one cell's row from now on ({ref}`tut-gg-refocus`).
Any other layer works the same way; `logged_counts` gives the HSC's expression instead of its
fold change.

(tut-gg-filter)=
## 3. Put a threshold on each column

1. In **Advanced Search** above the table, press **Add Condition**. Pick the column
   `spearman_fold_change: H2-Q7`, the condition **Greater Than**, and type `0.4`.
2. **Add Condition** again: `kompot_de_Young_to_Old_fold_change: HSPC_Old_1#…`,
   **Greater Than**, `0.2`. The two conditions combine with AND.

The table reads "Showing 1 to 25 of 56 entries (filtered from 16,285 total entries)": 56 genes
correlate with H2-Q7 at ρ > 0.4 and rise by more than 0.2 (log2) in this HSC. The volcano draws
exactly these 56 in colour and every other gene grey.

```{figure} ../_static/screens/tutorials/gene-groups-filtered.png
:class: screenshot
:alt: The gene table with four columns and two conditions, 56 entries; below, the volcano with 56 genes coloured and the rest grey, and the Gene Set Analysis panel ready to run on 56 genes.

Two thresholds on two columns from two different matrices. The volcano and the Gene Set
Analysis panel both take the table's 56 genes.
```

Only 11 of the 56 are differentially expressed on their own (Mahalanobis above 5.82). The other
45 sit in the dense core of the volcano. They are in the group because they share H2-Q7's
response and rise in this HSC, not because each passes a test.

(tut-gg-geneset)=
## 4. Ask what the group has in common

The Gene Set Analysis panel does not compute enrichment itself. It sends the group's gene ids
to external services and shows what they return ({doc}`../user-guide/gene-set`;
{doc}`gene-set-analysis` walks through every step).

1. The panel's button reads **Run · 56 genes**. Press it.
2. The first time, a bar lists each service and what it would receive: the 56 gene ids, the
   species, and the dataset's 16,285 genes as the background for the enrichments. Press **Send**.

   ```{figure} ../_static/screens/tutorials/gene-groups-consent.png
   :class: screenshot
   :alt: The consent bar listing MyGene.info, STRING and g:Profiler with what each receives, and the buttons Send, Always send to these services, Never and Cancel.

   Nothing leaves the browser before this.
   ```

3. Each section fills in on its own. STRING's enrichment for the 56 genes leads with the MHC
   class I protein complex (7 of its 11 genes, FDR 4.4e-10). Its network finds 141 interactions
   among the 54 genes it knows, where 29 would be expected at random.

```{figure} ../_static/screens/tutorials/gene-groups-geneset.png
:class: screenshot
:alt: The Gene Set Analysis panel with results for 56 genes: Links, the focused gene's card for H2-Q7 and STRING's enrichment table, led by MHC class I protein complex.

What the services returned for the 56 genes.
```

```{figure} ../_static/screens/tutorials/gene-groups-network.png
:class: screenshot
:alt: STRING's network of the 56 genes, with the number of interactions, the number expected at random and the PPI enrichment p-value.

STRING's network of the group.
```

(tut-gg-live)=
## 5. Change a threshold and watch the group follow

1. In the first condition, change `0.4` to `0.5` and press Tab.

The table drops to 19 entries and the volcano colours 19 genes, among them H2-Q6, H2-Q4, H2-T22,
H2-T23, B2m and Tapbpl; no button needed. The Gene Set
Analysis panel does not send anything by itself: it marks its results stale and says why.

```{figure} ../_static/screens/tutorials/gene-groups-stale.png
:class: screenshot
:alt: The panel's bar, in amber: Selection changed, the table now has 19 genes, results are for 56; a Refresh 19 genes button.

The results still describe the 56 genes, and the bar says so.
```

2. Press **Auto-update** in the panel. It now fetches again whenever the table's genes change,
   and it starts with the 19 genes at once (the services were agreed to in step 4, for this
   page).

```{figure} ../_static/screens/tutorials/gene-groups-rerun-bar.png
:class: screenshot
:alt: The bar after the automatic refresh: Results for 19 genes.

With Auto-update on, the panel follows the table.
```

```{figure} ../_static/screens/tutorials/gene-groups-tightened.png
:class: screenshot
:alt: The page with the threshold at 0.5: the table shows 19 entries, the volcano 19 coloured genes, and the Gene Set Analysis panel results for 19 genes.

ρ > 0.5: 19 genes in the table, on the volcano and in the panel.
```

(tut-gg-refocus)=
## 6. Focus another cell: the column stays

1. Set **Focused Cell** to the monocyte `Mature_Young_2#TCAATTCAGTGAGGCT-1` (type
   `TCAATTCAGTGAGGCT` and pick it).

Nothing in the table changes. The column is still
`kompot_de_Young_to_Old_fold_change: HSPC_Old_1#GAAGCCCGTGGCTCTG-1`, its condition still reads
`> 0.2`, the table still shows 19 entries, and the Gene Set Analysis panel is not marked stale.

```{figure} ../_static/screens/tutorials/gene-groups-refocused-header.png
:class: screenshot
:alt: Focused Cell now reads Mature_Young_2#TCAA…; the table header still names HSPC_Old_1#GAAGCCCGTGGCTCTG-1 and the table shows 19 of 16,285 entries.

The focused cell is the monocyte; the column header still names the HSC.
```

A table column depends on its cell or gene, never on the fact that it was focused when you
picked it. The group you built stays the group you built; the focus is free for exploring. To
compare with the monocyte, open the `layers` tab: it now offers the monocyte's row, marked
`(focused)`, next to the HSC's, marked `(in this table)`. Tick it to add a second column.

```{figure} ../_static/screens/tutorials/gene-groups-chooser-after.png
:class: screenshot
:alt: The layers tab after the focus change: the HSC's fold change marked (in this table), the monocyte's marked (focused).

The chooser offers the new focus; the table keeps what it has.
```

Plot axes and colours behave differently: an unlocked one follows the focus, and its padlock
fixes it ({doc}`../user-guide/focus-and-lock`). Links and panel sets keep the table's columns as
they are, named.

(tut-gg-views)=
## Open the views

::::{dropdown} The table filtered to 56 genes, with the Gene Set Analysis panel (steps 3 and 4)
```{literalinclude} ../_static/panelsets/tutorials/gene-groups-filtered.url.txt
:language: text
```
Panel set file: {download}`gene-groups-filtered.json <../_static/panelsets/tutorials/gene-groups-filtered.json>`.
::::

::::{dropdown} The threshold at 0.5, Auto-update on (step 5)
```{literalinclude} ../_static/panelsets/tutorials/gene-groups-tightened.url.txt
:language: text
```
Panel set file: {download}`gene-groups-tightened.json <../_static/panelsets/tutorials/gene-groups-tightened.json>`.
::::

Opening a link sends nothing to the services: the panel runs when you press Run, or by itself
only when Auto-update is on and you have already agreed to every service it needs
({ref}`gene-set-consent`).

The screenshots are made by `docs/_tools/shoot_gene_groups.py`, which performs each step above
in a headless browser and checks the counts: 56 genes at ρ > 0.4, 19 at ρ > 0.5, the same in
the table, on the volcano and in the panel, and no change when the cell focus moves.

## What you learned

- A gene table takes columns from a `varp` row of a gene and a layer row of a cell, picked
  through the focus, next to ordinary `var` columns.
- Thresholds on those columns define a group of genes across several measures at once.
- A plot linked to the table and a Gene Set Analysis panel take the same group, and follow it
  when a threshold changes.
- A column keeps the gene or cell it was added for; focusing another one changes nothing in the
  table.

Next: {doc}`gene-set-analysis` takes a group like this one through the Gene Set Analysis panel
step by step.
