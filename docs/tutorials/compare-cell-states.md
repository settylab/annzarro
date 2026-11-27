(tut-compare-cell-states)=
# Compare the age response of two cell states by clicking

Every cell has its own row of the stored fold-change layer: how each gene's expression changes from young to old mice
in that cell's state, from Kompot {cite:p}`otto2025kompot`. A Gene Plot can put one cell's row on x and another's on y.
Lock one, click the other, and colour the genes by how closely they follow the gene you click: the same plot becomes a
search for genes that respond to age together.

Nothing on this page is aggregated. Over whole cell types, the same questions are answered by
{doc}`group-statistics`.

## What you need

- AnnZarro 0.8.0 or later, running locally ({doc}`../getting-started/quickstart`), with `bm_aging_annzarro.zarr` in its
  data directory ({doc}`../data/demo-data`).
- About 15 minutes.
- These fields:

| Slot | Key | Used for |
|---|---|---|
| `layers` | `kompot_de_Young_to_Old_fold_change` | the two axes: one cell's row each |
| `varp` | `spearman_fold_change` | the colour: how closely two genes' fold changes follow each other across cells |
| `varp` | `spearman_smoothed` | the same for their expression, in section 6 |
| `obs` | `midres_celltype` | the UMAP you click cells in |

::::{dropdown} Start here: the locked HSC against a monocyte, coloured by S100a9's partners
```{literalinclude} ../_static/panelsets/tutorials/tut-compare-start.url.txt
:language: text
```
Panel set file: {download}`tut-compare-start.json <../_static/panelsets/tutorials/tut-compare-start.json>`.
The link is ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

(tut-compare-lock)=
## 1. Lock one cell, follow the other

1. Add a **Cell Plot** on the UMAP (**X** `obsm` `X_umap` 0, **Y** `X_umap` 1), coloured by `obs` `midres_celltype`.
   This is where you click cells.
2. Set **Focused Cell** to the old HSC `HSPC_Old_1#GAAGCCCGTGGCTCTG-1` (type it, or click it in the UMAP).
3. Add a **Gene Plot**. Set **X** to `layer`, `kompot_de_Young_to_Old_fold_change`, "Focused cell …", and press the
   lock to the right of the row (title "Lock (keep current selection)"). It turns blue: x stays on this HSC.
4. Set **Y** the same way, and leave its lock open. With the same cell on both axes, every gene lies on the
   diagonal.
5. Click another HSC in the UMAP, for example `HSPC_Old_1#AAAGGATTCCTACCAC-1`. **Y** reloads with that cell's row;
   **X** stays.

```{figure} ../_static/screens/tutorials/compare-diagonal.png
:class: screenshot
:alt: Three panels. Left top, a UMAP coloured by cell type with the focused cell circled among the HSCs; left bottom, a UMAP coloured by S100a9's fold change; right, a Gene Plot whose genes lie on a thin diagonal from about -1.35 to 1.1.

A second old HSC (y) against the locked one (x): the points lie on the diagonal.
```

The two HSCs agree almost exactly (over the 16,285 genes, r = 0.999; S100a9 is −1.35 in the locked cell and −1.31 in
the other). The fold change is smooth across similar cells, so a click on a neighbour gives nearly the same picture.

Once the focus has moved, the third box of **X** reads "Locked cell HSPC_Old_1#…", and a crosshair button appears
beside the lock: it focuses the locked cell again.

(tut-compare-lineage)=
## 2. Step away from the HSC

Click cells further along the lineage: an LMPP (`HSPC_Old_2#ACTCTCGCAAACCGGA-1`), a GMP
(`HSPC_Old_3#ATTTCACTCGTAGTGT-1`) and a monocyte (`Mature_Young_2#TCAATTCAGTGAGGCT-1`).

```{figure} ../_static/screens/tutorials/compare-lineage.png
:class: screenshot
:alt: Four Gene Plots on equal axes, each with the locked HSC on x: against another HSC a diagonal line; against an LMPP, a GMP and a monocyte a flat cloud between about -0.4 and 0.6 on y, spread from -1.35 to 1.1 on x.

The locked HSC (x) against another HSC, an LMPP, a GMP and a monocyte (y), with **Equal aspect** on. Colour: the 190
genes the store calls (cyan).
```

The cloud flattens onto the x axis. The largest change in either direction is 1.35 in the HSC, 0.47 in the LMPP, 0.40
in the GMP and 0.39 in the monocyte. Of the 190 called genes, 189 change in the same direction in the two HSCs, 116 in
the HSC and the LMPP, 115 with the GMP and 129 with the monocyte.

Click across lineages too. A neutrophil's row is flat (at most 0.40): what changes in the HSC does not change there.
A memory B cell (up to 0.93) and the plasma cell `Mature_Mid_1#GCCATGGAGTATGATG-1` (up to 1.19) draw tall clouds:
large changes of their own, unrelated to the HSC's. To compare from another cell, open the lock of **X**, focus that
cell and lock it again.

(tut-compare-colour)=
## 3. Colour by the genes that follow the focused gene

Now each gene's colour says how closely its fold change follows that of the focused gene, across all cells.

1. Set **Color** to `varp`, `spearman_fold_change`, "Focused gene …", and leave its lock open.
2. **Map**: `Blues (dark → light)`, then **Reverse**: pale for low, dark blue for high.
3. **Min** `0.5`, **Max** `1`, then **Lock Range**. Every focused gene is now drawn on the same scale, and every gene
   at or below 0.5 is the palest colour.

**Strong on top** is on by default, so the few dark genes are drawn last and are never buried in the pale cloud.

```{figure} ../_static/screens/tutorials/compare-controls.png
:class: screenshot
:alt: The Gene Plot's controls. X reads layer, kompot..., Locked cell HSPC_Old_1#GAAGCCCGTGGCTCT... with a crosshair and a blue lock; Y reads Focused cell Mature_Young_2#TCAATTCAGTGAGGC... with an open lock; Color reads varp, spearman_fold_change, Focused gene S100a9 with an open lock. Map Blues (dark → light); Min 0.5; Max 1; Reverse, Lock Range and Strong on top are on.

The controls: x locked to the HSC, y following the focused cell, the colour following the focused gene on a fixed
range from 0.5 to 1.
```

4. Focus the monocyte again and set **Focused Gene** to `S100a9` (or click its point, far left at x = −1.35).

```{figure} ../_static/screens/tutorials/compare-s100a9.png
:class: screenshot
:alt: The Gene Plot of the locked HSC (x) against the monocyte (y), almost all genes pale grey; S100a9 is circled at the far left, at x -1.35 and y -0.02, with two dark blue genes beside it and a few lighter blue ones between x -0.8 and 0; the colour bar runs from 0.5 to 1.

S100a9 focused: the genes whose fold change follows S100a9's turn blue.
```

S100a9 sits at −1.35 in the HSC and −0.02 in the monocyte. Its darkest partner, S100a8 at 0.95, sits right beside it
(−1.30, +0.03); then Tmsb4x (0.78), Actb (0.75) and Camp (0.72). Eleven genes are above 0.6. Most sit to the left of
zero on x and near zero on y: they fall in the HSC and do little in the monocyte, as S100a9 does.

(tut-compare-click)=
## 4. Click around

::::{dropdown} Start here: the same plot with Cd74 focused
```{literalinclude} ../_static/panelsets/tutorials/tut-compare-partners.url.txt
:language: text
```
Panel set file: {download}`tut-compare-partners.json <../_static/panelsets/tutorials/tut-compare-partners.json>`.
::::

Each click on a gene recolours the plot with that gene's partners. The axes do not move.

- **Cd74.** H2-Aa (0.81), H2-Eb1 (0.81), H2-Ab1 (0.78), Ly6e (0.70) and Ciita (0.69) turn dark; 16 genes are above
  0.6. The MHC class II genes find each other without a list.
- **Cd79a.** Ebf1 (0.91), Pax5 (0.88), Ly6d (0.84) and Cd19 (0.83); 58 genes are above 0.6: B cell genes that respond
  together.
- **Apoe.** Almost nothing turns dark: no gene is above 0.7, two are above 0.6. Apoe changes on its own. An empty
  result is a result.

```{figure} ../_static/screens/tutorials/compare-cd74.png
:class: screenshot
:alt: The three panels with Cd74 focused. Right, the Gene Plot with Cd74 circled at x 0.43, y 0.12 and about twenty blue genes around it on a grey cloud. Left bottom, the UMAP coloured by Cd74's fold change: a blue region and a red region at the upper left, orange over much of the progenitor body.

Cd74 focused. Right: its partners turn blue. Lower left: where Cd74 itself changes.
```

```{figure} ../_static/screens/tutorials/compare-apoe.png
:class: screenshot
:alt: The three panels with Apoe focused: in the Gene Plot Apoe is circled at x 0.94, y -0.35 and every other gene is pale.

Apoe focused: no gene follows it closely.
```

The lower UMAP is a **Cell Plot** coloured by `layer` `kompot_de_Young_to_Old_fold_change`, "Focused gene …", on
`RdBu` with **Center at 0**. Each gene you click also recolours it, so you see where that gene changes. With Cd74, two
neighbouring regions at the upper left take opposite colours.

(tut-compare-list)=
## 5. Keep the partners as a list

::::{dropdown} Start here: Cd74's partners as a filtered Gene Table
```{literalinclude} ../_static/panelsets/tutorials/tut-compare-table.url.txt
:language: text
```
Panel set file: {download}`tut-compare-table.json <../_static/panelsets/tutorials/tut-compare-table.json>`.
::::

The dark genes are the ones above a cut-off on the colour. A Gene Table makes that cut-off a list.

1. Add a **Gene Table**. On its `varp` tab, the add row reads `[gene] [matrix] [Add column]`: choose `Cd74` and
   `spearman_fold_change`, press **Add column**, then **Apply Changes**.
2. **Advanced Search**, **Add Condition**: `spearman_fold_change: Cd74` **Greater Than** `0.6`.

```{figure} ../_static/screens/tutorials/compare-table.png
:class: screenshot
:alt: A Gene Table with the columns kompot_de_Young_to_Old_is_de and spearman_fold_change: Cd74, the condition spearman_fold_change: Cd74 Greater Than 0.6, and the footer Showing 1 to 17 of 17 entries.

Cd74's partners above 0.6: 17 rows, Cd74 itself (1) and 16 others.
```

The table keeps 17 genes: Cd74 itself and its 16 partners. The column belongs to Cd74 and stays when the focus moves;
the cut-off is yours to move. To use the list elsewhere, **Add from** in a Gene Signature takes it
({doc}`signature-score`), and the plot's **Table** setting highlights it.

(tut-compare-smoothed)=
## 6. Respond together, or expressed together?

Set the **Color** key to `spearman_smoothed`. With Cd74 focused the dark set changes: H2-Aa (0.82) and H2-Eb1 (0.81)
stay, Ciita rises to 0.76, and Lgmn, Gbp9 and Gbp4 join (0.70 to 0.71); 37 genes are above 0.6. This matrix compares
the genes' expression across cells, not their change with age: it finds genes expressed in the same cell states,
whether or not they respond to age. {doc}`gene-similarity` section 4 sets the two side by side.

## A limit

This needs a click on a cell. In large-plot mode a Gene Plot is unaffected (it draws genes), but the cell must be drawn
in a Cell Plot to be clicked; {doc}`../user-guide/subsets` explains which cells a large plot draws. **Focused Cell**
takes a typed name in either mode.

## Check the numbers

| Statement | How to check it in AnnZarro | Result |
|---|---|---|
| S100a9 in the HSC and the monocyte | hover S100a9 in the plot of section 3 | −1.35, −0.02 |
| Apoe in the HSC and the monocyte | hover Apoe | +0.94, −0.35 |
| S100a8 follows S100a9 | S100a9 focused, hover S100a8 | 0.95 |
| H2-Aa follows Cd74 | Cd74 focused, hover H2-Aa | 0.81 |
| Cd74's partners above 0.6 | the table of section 5 | 17 entries, Cd74 included |

## What you learned

- One axis locked and one following the focus compares any two cells; a click moves the second.
- A colour that follows the focused gene, on a fixed narrow range, turns the same plot into a search for genes that
  respond together.
- A cut-off on that colour is a gene list.

Previous: {doc}`cells-and-genes`, which locks the same HSC against the monocyte with a fixed colour.
