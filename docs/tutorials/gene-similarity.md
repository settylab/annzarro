(tut-gene-similarity)=
# Which genes respond together?

A differential expression test gives a list: here, 190 genes that change between young and old
mouse bone marrow. The next question is which of them change *together*. The usual answer is to
cluster the genes into modules and read each module as a programme. Modules force every gene into
one group and hide how strongly it belongs there.

This tutorial answers the question without clustering. A gene x gene correlation matrix is stored
with the data; you focus one gene, and its row of the matrix colours every gene of an ordinary
volcano plot. Click another gene and the colour follows. At the end you compare the graded row
with discrete modules, and you separate genes that share an *age response* from genes that only
share an *expression pattern*.

The results are panels of Fig. 4 of the AnnZarro paper ({doc}`../paper/fig4-gene-by-gene`).

## What you need

- AnnZarro running locally ({doc}`../getting-started/quickstart`), with
  `bm_aging_showcase.zarr` in its data directory ({doc}`../data/showcase-store`). Everything
  except the module comparison also works on `bm_aging.zarr`.
- These fields:

| Slot | Key | Used for | Live or precomputed |
|---|---|---|---|
| `var` | `kompot_de_Young_to_Old_mean_lfc` | volcano x axis | stored Kompot result |
| `var` | `kompot_de_Young_to_Old_mahalanobis` | volcano y axis; DE genes have a value above 5.82 | stored Kompot result |
| `var` | `kompot_de_Young_to_Old_is_de` | the 190 DE genes (5% FDR) | stored Kompot result |
| `varp` | `spearman_fold_change` | colour of the volcano, y axis of the last plot | **live**: the focused gene's row is read on every focus change |
| `varp` | `spearman_smoothed` | x axis of the last plot | **live** |
| `var` (showcase) | `fig4_module_k3`, `fig4c_rank_H2-Q7`, `fig4c_rank_S100a9`, `rho_fc_H2-Q7`, `rho_fc_S100a9` | module comparison | precomputed for H2-Q7 and S100a9 only |
| `var` (showcase) | `fig4d_class` | colour of the last plot | precomputed for H2-Q7 only |

`spearman_fold_change` is the Spearman correlation, across cells, of two genes' Kompot fold
changes {cite:p}`otto2025kompot`: high when two genes gain or lose expression with age in the
same cells. `spearman_smoothed` correlates the smoothed expression itself, so it is high for genes
expressed in the same cell states whether or not they change. Both are dense
16,285 x 16,285 float32 arrays in 1024 x 1024 chunks. A focus change requests one row of each,
16,285 values; the browser never receives the whole matrix ({doc}`../data/pairwise-matrices`).

(tut-gene-volcano-row)=
## 1. Colour a volcano by the focused gene's row

1. Open `bm_aging_showcase.zarr` from **Dataset**.
2. In the bottom selector, add a gene plot. Open its controls (the chevron in the tile header).
3. Set **X-Axis** to `var`, `kompot_de_Young_to_Old_mean_lfc` and **Y-Axis** to `var`,
   `kompot_de_Young_to_Old_mahalanobis`. You now have the Kompot volcano.
4. Set **Color** to `varp`, `spearman_fold_change`. The third box reads "Focused gene …"; leave it
   there, so the colour follows the focus. Leave the lock next to it open
   ({doc}`../user-guide/focus-and-lock`).
5. Under the colour options, choose **Color Map** `RdBu`, type `-1` in **Min** and `1` in **Max**,
   and press **Lock Range**. Correlations then keep one scale for every focused gene
   ({doc}`../user-guide/colour-scales`).
6. Make sure **Highlight Focused Gene** is on (blue).
7. In the header's **Focused Gene** box, type `H2-Q7` and press Enter.

   ```{figure} ../_static/screens/paper/fig4a-header.png
   :class: screenshot
   :alt: The header with Focused Gene set to H2-Q7.

   The header after step 7.
   ```

   H2-Q7, a non-classical MHC class I gene, has the largest Mahalanobis distance of all genes
   (15.2, mean log2 fold change 0.37). The red dot at the top right marks it. Every other gene now
   shows its correlation with H2-Q7:

   ```{figure} ../_static/screens/paper/fig4a-volcano-h2q7.png
   :class: screenshot
   :alt: Volcano coloured by H2-Q7's row of spearman_fold_change; H2-Q7 marked in red at the top right.

   Every gene coloured by its Spearman ρ with H2-Q7.
   ```

8. Hover over the dark red point at mean log2 fold change 0.24, Mahalanobis 9.8. The label reads
   `H2-Q6`, and `c: 0.817…` is its ρ with H2-Q7.

   ```{figure} ../_static/screens/paper/fig4a-hover-h2q6.png
   :class: screenshot
   :alt: Hover label on H2-Q6 showing c 0.817.

   The hover label gives the gene name and the colour value, here ρ = 0.82.
   ```

H2-Q7's strongest partners are H2-Q6 (0.82), Tapbpl (0.73), H2-D1 (0.66) and B2m (0.60): MHC
class I antigen presentation. Only H2-Q6 is itself called differentially expressed. Tapbpl, H2-D1
and B2m sit in the dense lower part of the volcano (Mahalanobis 3.6, 5.3 and 5.2); zoom with the
mouse wheel and hover to find them, or sort a table ({ref}`tut-gene-check`). A module built from
DE genes alone could not contain them.

:::{note}
**Paper Fig. 4a.** This view is panel a of the paper figure.
:::

(tut-gene-refocus)=
## 2. Click a gene to follow another row

1. Click the point at mean log2 fold change 0.14, Mahalanobis 12.6. That is H2-Aa, an MHC class II
   gene. The header's **Focused Gene** changes to `H2-Aa`, the red marker moves to it, and the
   plot recolours with H2-Aa's row.

   ```{figure} ../_static/screens/paper/fig4b-volcano-h2aa.png
   :class: screenshot
   :alt: The same volcano after clicking H2-Aa; the marker is on H2-Aa and the colours changed.

   The same plot after one click. H2-Q7 (top right) is now pale: ρ = 0.20 with H2-Aa.
   ```

2. Hover over the dark red neighbours of H2-Aa. H2-Ab1 reads `c: 0.884…`; H2-Eb1 (0.124, 11.4)
   reads 0.933 and Cd74 (0.106, 12.8) reads 0.811. Ciita (0.84) is not DE and sits in the core.

   ```{figure} ../_static/screens/paper/fig4b-hover-h2ab1.png
   :class: screenshot
   :alt: Hover label on H2-Ab1 showing c 0.884, next to the focused H2-Aa.

   H2-Ab1, ρ = 0.88 with the focused H2-Aa.
   ```

:::{note}
**Paper Fig. 4b.** This view is panel b of the paper figure.
:::

The two top genes of the volcano, H2-Q7 and H2-Aa, belong to different responses: class I and
class II antigen presentation, correlated with each other at only 0.20. Use the arrows next to
**Focused Gene** to step back and forth; every click reads one new row.

(tut-gene-modules)=
## 3. Compare the graded row with discrete modules

The conventional route clusters the 190 DE genes by average linkage on 1 − ρ and cuts the tree
at the silhouette maximum, k = 3. AnnZarro does not cluster. The showcase store holds the
paper's result as `var/fig4_module_k3` (87, 68 and 35 genes) together with each DE gene's rank by
ρ with H2-Q7 and with S100a9. This step uses those precomputed columns; it works for these two
genes only.

1. Add a gene plot. Set **X-Axis** to `var`, `fig4c_rank_H2-Q7`, **Y-Axis** to `var`,
   `rho_fc_H2-Q7` and **Color** to `var`, `fig4_module_k3`. **Color Palette** stays at "As
   stored in adata.uns if available", which gives the paper's purple, green and amber.
2. Non-DE genes have no rank, so 16,096 genes have no x value and are not drawn. The tile says so
   in a blue notice ("189 of 16,285 genes shown").
3. Add a second gene plot with `fig4c_rank_S100a9`, `rho_fc_S100a9` and the same colour.
4. Add a gene table with the columns `fig4_module_k3`, `rho_fc_H2-Q7`, `rho_fc_S100a9` and
   `kompot_de_Young_to_Old_mahalanobis` (tab `var`). In **Advanced Search**, **Add Condition**
   `fig4_module_k3` **Equals** `module 1`, then **Add Condition** `rho_fc_H2-Q7` **Less Than**
   `0.2` ({doc}`../user-guide/tables-and-filters`).

```{figure} ../_static/screens/paper/fig4c-page.png
:class: screenshot
:alt: Two rank strips coloured by module and a gene table filtered to module 1 and rho below 0.2, showing 52 entries.

The two rank strips and the table. The red marker in the lower strip is H2-Q7 (the focused gene),
not S100a9.
```

What the strips show:

- **H2-Q7 (top).** Its strongest partner, H2-Q6 (0.82, rank 1), is in its module, but module 1
  (purple) runs the length of the strip. The table reads 52 entries: 52 of H2-Q7's 86
  module-mates correlate with it at ρ < 0.2. Its module lumps MHC class I with class II.
- **S100a9 (bottom).** Its strongest partner, S100a8, is in its module 3 (amber), but the next
  two, Camp (0.72) and Ngp (0.61), are green: outside its module.

```{figure} ../_static/screens/paper/fig4c-hover-camp.png
:class: screenshot
:alt: Hover label on Camp, rank 2, rho 0.72, module 2.

Camp: rank 2 by ρ with S100a9, ρ = 0.72, module 2.
```

:::{note}
**Paper Fig. 4c.** The two strips are panel c. The module labels, ranks and silhouette scores are
offline results of the paper's figure script, stored as columns.
:::

The graded row in steps 1 and 2 needs no cut and works for any gene. The modules are a summary
of it, and at this data size a weak one: the silhouette is flat (0.23 to 0.25 for k = 2 to 6).

(tut-gene-two-rows)=
## 4. Separate a shared age response from a shared expression pattern

Two genes can correlate because they change together with age, or merely because they are
expressed in the same cells. Plot the two rows of the focused gene against each other. Both axes
are live `varp` rows: one click redraws the whole scatter.

1. Add a gene plot. Set **X-Axis** to `varp`, `spearman_smoothed`, "Focused gene …", and
   **Y-Axis** to `varp`, `spearman_fold_change`, "Focused gene …". Leave both locks open.
2. Set **Color** to `var`, `fig4d_class` (showcase store, precomputed for H2-Q7), or to `var`,
   `kompot_de_Young_to_Old_is_de` on `bm_aging.zarr`.
3. Focus `H2-Q7`. It sits at (1, 1), marked red.

```{figure} ../_static/screens/paper/fig4d-controls.png
:class: screenshot
:alt: Gene plot controls with both axes set to varp rows of the focused gene and colour set to fig4d_class.

The controls: two `varp` rows of the focused gene as axes.
```

```{figure} ../_static/screens/paper/fig4d-plot.png
:class: screenshot
:alt: Scatter of H2-Q7's spearman_smoothed row against its spearman_fold_change row, coloured by class.

Purple: fold-change ρ > 0.5 (35 genes). Amber: smoothed ρ > 0.7 and fold-change ρ < 0.5
(192 genes).
```

4. Hover over the amber point at (0.90, 0.21). It is H2-K1, a classical MHC class I gene: it
   follows H2-Q7's expression pattern across cell states but not its change with age.

```{figure} ../_static/screens/paper/fig4d-hover-h2k1.png
:class: screenshot
:alt: Hover label on H2-K1 at smoothed rho 0.90 and fold-change rho 0.21.

H2-K1: ρ = 0.90 on smoothed expression, 0.21 on fold change.
```

204 genes share H2-Q7's cell-state pattern (smoothed ρ > 0.7); only H2-Q6, at (0.94, 0.82), also
shares its age response. Focus another gene and the axes redraw for it; the `fig4d_class` colour
does not, because it was computed for H2-Q7.

:::{note}
**Paper Fig. 4d.** This view is panel d of the paper figure.
:::

(tut-gene-check)=
## Check the numbers

Hover labels give exact values. For counts, add a gene table and filter it. Each condition is one
row of **Advanced Search**; conditions combine with AND or OR, and a group can be nested in
another.

| Statement | How to check it in AnnZarro | Result |
|---|---|---|
| H2-Q6 ρ = 0.82, Tapbpl 0.73, H2-D1 0.66, B2m 0.60 | gene table with `rho_fc_H2-Q7`; click its header twice to sort descending | top rows H2-Q7 (1), H2-Q6, Tapbpl, H2-D1, Fxyd5, Sec62, B2m |
| only H2-Q6 of these is DE | add `kompot_de_Young_to_Old_is_de` as a column | Yes for H2-Q6 only |
| 190 DE genes | `kompot_de_Young_to_Old_mahalanobis` **Greater Than** `5.82` | 190 entries |
| 52 of 86 module-mates with ρ < 0.2 | `fig4_module_k3` = `module 1` AND `rho_fc_H2-Q7` < `0.2` | 52 entries |
| 204 genes share the cell-state pattern | `rho_smoothed_H2-Q7` **Greater Than** `0.7` | 205 entries: 204 plus H2-Q7 itself |
| 35 genes share the age response | `rho_fc_H2-Q7` **Greater Than** `0.5` | 36 entries: 35 plus H2-Q7 |

The 52 entries were read off the app (screenshot above). The other results were computed in
Python from the same stored columns and match the paper's `figures/numbers/fig3.json`.

```{note}
A **Gene table** cannot show a `varp` row as a column in this version, so the `rho_fc_*` and
`rho_smoothed_*` columns of the showcase store stand in for "H2-Q7's row of `varp/…`". For the
DE filter, use the Mahalanobis threshold, not `kompot_de_Young_to_Old_is_de`: an **Equals Yes**
condition on a boolean column matches no rows in this version. Both are known bugs.
```

(tut-gene-views)=
## Open the views

Each view is a share link with the panels configured. Replace `127.0.0.1:8000` with your server's host and port and `/ABSOLUTE/PATH/TO` with the
directory that holds the store on the server, then open
the link ({doc}`../user-guide/share-links`). `dataset_path` must be absolute.

::::{dropdown} Steps 1 and 2: volcano coloured by the focused gene's row (H2-Q7)
```{literalinclude} ../_static/panelsets/paper/fig4-ab.url.txt
:language: text
```
::::

::::{dropdown} Step 3: rank strips and module table
```{literalinclude} ../_static/panelsets/paper/fig4-c.url.txt
:language: text
```
::::

::::{dropdown} Step 4: smoothed row against fold-change row
```{literalinclude} ../_static/panelsets/paper/fig4-d.url.txt
:language: text
```
::::

The same panels as panel-set files:
{download}`fig4-ab.json <../_static/panelsets/paper/fig4-ab.json>`,
{download}`fig4-c.json <../_static/panelsets/paper/fig4-c.json>`,
{download}`fig4-d.json <../_static/panelsets/paper/fig4-d.json>`. **Load Panel Set** > upload
registers their panels as closed cards under **Add New Panel** > "Duplicate or Reopen Panel"; it
does not restore the focus or the layout, so prefer the links ({ref}`fig2-load-panel-set`, {doc}`../user-guide/panel-sets`).

## What you learned

- A `varp` matrix is read one row at a time: the focused gene picks the row, and the row can
  colour or place every gene of any gene plot.
- A click on a gene moves the focus, and every focus-following axis or colour updates.
- A graded row shows partners that a module cut misses or lumps, including genes that are not DE.
- Two rows of two matrices side by side separate a shared response from a shared pattern.

Next: {doc}`cells-and-genes` reads a cells x genes layer by columns and by rows.
