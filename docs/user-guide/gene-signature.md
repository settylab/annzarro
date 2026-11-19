# Gene signatures

A **Gene Signature** is a named list of genes, kept as a recipe: the genes, and how a score would be
worked out from them. The **Gene Signature** panel builds the list. It opens on every gene of the
dataset, ready to tick, and it needs no setup. The default way of scoring is stated in the panel
("Z-score mean of X, clipped at ±10": each gene is turned into a z-score over all cells, then the genes
are averaged), and it is the only one for now.

A signature outlives its panel. Close the panel and the signature is still there, listed in the
panel chooser as **Closed**, and still usable wherever a gene table is: it can filter a Gene Plot and
it can be the source of a Gene Set Analysis panel.

## Build a list

1. Add a **Gene Signature** panel (**Create New Panel** → **Gene Signature**, or split a tile).
2. Tick genes in the list, or type part of a name in **Search genes**.
3. Press **Use in** to filter a Gene Plot by the signature, or to analyse it in a Gene Set Analysis
   panel.

The panel states how many genes it holds, always against its limit: **a signature holds up to 2,000
genes**. Adding more than that adds nothing at all, and the panel says how many it would have made.

### Ticking genes

- **All genes** shows every gene of the dataset, in alphabetical order, as a list that stays quick
  at any length. **Selected** shows only the genes in the signature. A signature opened from a link
  or a saved panel set starts on **Selected**.
- Untick a gene in **Selected** and its row is struck through but stays where it is, so the list
  does not move under the pointer. It is gone when you change the view.
- A gene that is in the signature but not in the dataset stays in the recipe, greyed and marked
  "not in this dataset", and is counted in the line under the title.

### Searching

Type in **Search genes**. The list narrows to the names that contain what you typed, ignoring case.

- **Aa** (Match case) makes the search care about capitals: `Cd3` finds `Cd3d`, not `CD3D`.
- **.\*** (Regular expression) reads the text as a pattern: `^CD3[DE]$` finds `CD3D` and `CD3E`.
  A pattern that is not valid says "Not a valid pattern" and the list keeps the last results.
- **Enter** ticks the gene whose name equals what you typed (or the only gene that matches), clears
  the box and keeps the cursor there, so you can type a list of genes one after another.
- **Tick all 40** appears while a search matches genes in **All genes**, and ticks them all as one step.
- **Esc** clears the box. **Down** moves into the list.

### Adding genes from elsewhere

**Add from** lists:

- the gene in focus, and genes locked in a plot, each with its source ("Klf1 · fixed in Cell Plot 2");
- every gene table, with the number of genes passing its filter ("DE genes · 42 genes"). The genes
  are copied: later changes to the table do not change the signature.

Adding says what happened ("Added 30 genes from DE genes. 12 were already selected.") and every
change of the list, a tick batch, **Tick all**, an add or **Clear**, can be undone with **Undo**
(or Ctrl+Z, Cmd+Z on a Mac, outside the search box). Ticks made in quick succession undo together.

### Paste or upload genes

**Paste or upload** (**Paste** in a narrow panel) is beside **Add from**. It opens a box in place of the
list. Paste genes into it, or choose a file with **Choose file**, or drop a file anywhere on the panel.
Nothing is added until you have seen a preview.

- **Any separator.** A new line, comma, semicolon, tab, space or pipe, or a mix of them. Quotes, stray
  spaces, Windows line endings and byte-order marks are dealt with. Lines starting with `#` are ignored.
- **Files.** A plain list; a CSV or TSV, with or without a header row (the gene column is chosen by its
  name, such as `gene_symbol`, or by how many of its values are genes of the dataset, and you can pick
  another one, and tick or untick **Header row**); a GMT, which holds several gene sets, so you pick one
  (each shows how many of its genes matched); or a GRP, one gene per line. **Read as** changes how the
  text is read when the guess is wrong. Excel files are refused: save the sheet as CSV first. A file can
  be up to 10 MB.
- **Private.** The text or file is read in your browser and is never sent to the server. Only the genes
  you add become part of the signature.

The preview says how many genes **will be added**, how many were **already selected**, how many were
**duplicates in the list**, how many matched **ignoring case** (**Show** lists them, such as
`cd3d > CD3D`; **Match case** turns this off) and how many are **not in this dataset**. Those names are
listed, and **Copy** puts them on the clipboard. It also warns when:

- the names look like Ensembl or Entrez ids and the dataset has no id column to translate them;
- most matches differ only in case, so the list may come from another species (names are matched,
  not orthologs);
- a name looks like a gene that Excel turned into a date, such as `1-Mar`.

**Ids.** A list of Ensembl ids (`ENSG00000167286`, with or without a version such as `.7`) or Entrez ids
is matched through the dataset's id column, for example `gene_ids` or `ensembl_id`. The column is read
only when your list turns out to be ids, and the preview says "Matching ids…" for a moment. Those names
are counted separately as **matched by id**, and the signature keeps the dataset's gene names, not the
ids. If the dataset has no such column, or it cannot be read, the preview says so and nothing is added.

A signature holds up to 2,000 genes, counting the ones already selected. Over that, the preview says so,
**Add** is off and nothing is added; shorten the list and try again.

**Add** adds the genes as one step: **Undo** (or Ctrl+Z, Cmd+Z on a Mac) takes the whole paste back.
**Cancel**, **Esc** and **Add** return you to the list and put the cursor back on **Paste or upload**.

## Use a signature

**Use in** lists what the signature can feed now:

- **Filter** *a Gene Plot*: the plot shows only the signature's genes, as it does for a gene table.
- **Analyse in** *a Gene Set Analysis panel*: the panel takes the signature's genes as its source,
  with no "(closed)" mark, because a signature needs no rows of its own.

Both follow the list as you edit it. They go on working after you close the signature's panel. The
line under the title says what uses it ("Used by 1 plot, 1 Gene Set Analysis").

## Colour or position a Cell Plot by a score

A signature gives every cell one number. A Cell Plot can take it as its **x**, **y**, **colour** or
**hover**: choose **gene-score** among the sources (beside obs, obsm, obsp and layer), then pick the
signature by name. Every signature is listed, open or closed. Or press **Use in** → **Colour Cell Plot 1**
in the signature's panel. The score works in large-plot mode too (colour and axes; the tooltip shows the
colour's score).

A score is chosen in three steps, as an embedding is: the source (**gene-score**), the signature, and
the **aggregation** (z-score mean, the default, or mean). Each axis, the colour and the hover can use a
different signature or a different aggregation of the same one; the same choice on two axes is computed once.
The score can be on any axis, x, y and z (3D) included, against another score, an obs column or a gene.
In large-plot mode x, y and colour take a score; 3D and extra hover columns are not available there.
**Use in** offers **Colour**, **Use as X** and **Use as Y** for each Cell Plot.

The score is worked out on the server, over all the cells of the dataset, and the plot gets the value
for the cells it shows. It is worked out when a plot needs it, with no panel open: a closed signature, or
one restored from a link, colours its plot by itself. Nothing computed goes into a link, a panel set or the
history; they hold the recipe only, so a link stays short and the plot is coloured again when it opens.
Going Back to a view whose signature has not changed asks the server for nothing.

### When a score is slow

The server estimates the time before it reads anything, and the plot follows what the estimate says:

- **Up to a minute**: it is computed at once. The points are drawn in a neutral colour with
  "Computing 'T cell score': 31 of 50 genes" over the plot, and **Cancel** stops it for every plot that
  shares it ("Cancel for 3 plots").
- **From a minute to ten minutes**: the plot asks first ("'T cell score' will take about 2 minutes.") and
  you press **Compute**.
- **Longer**: it is not run, and the plot says why and what to do ("Use fewer genes").

The notice lies over the plot and a short tag appears in the status strip, so the plot never moves.
On an axis, where nothing can be drawn without the score, the plot area shows the same sentence instead.
Other states say what they are: cancelled (with **Compute**), failed (with **Retry**), no genes yet, none of the
genes in this dataset, and "Signature 'T cell score' was deleted" (with **Choose another**).

### When you edit the signature

Plots and tables that use it follow your edits. A quick score updates a moment after you stop editing, and
the plot shows the previous score ("Showing the previous 'T cell score'. Updating.") until the new one is
there. When the new score would take 5 seconds or more, edits collect instead: the plot keeps the previous
score and says "3 changes are not applied. About 40 seconds." The signature's panel says so as well, with
**Update score** to apply them.

### Opening several at once

A link can name many scores. At most two are computed at a time, those on screen first; a plot that is
off screen starts when it comes into view. Plots that show the same score share one request, and a score
is kept in the browser (up to 1 GiB, least recently used first) so it is not asked for twice.

## Close, reopen, share

A signature is saved as configuration only: its title, its genes (sorted, so equal lists make equal
links), its scoring settings and nothing computed. Share links, saved panel sets and Back and
Forward all carry it, closed or open. The panel chooser lists a closed signature with its name; pick
**Reopen** to open it again under the same name, so the plots and analyses that use it keep using it.

## Keyboard

| Where | Keys |
| --- | --- |
| Search | **Enter** ticks the match; **Down** goes into the list; **Esc** clears |
| List | **Up**, **Down**, **Home**, **End**, **Page Up**, **Page Down** move; **Space** ticks |
| Panel, outside a text field | **Ctrl+Z** (**Cmd+Z**) undoes the last change |
| Menus | **Down** and **Up** move; **Esc** closes and returns to the button |

The list is a grid for screen readers: it says how many rows there are in all and the place of each
row, though only the rows in view are on the page.

## Turn it off

An administrator can switch the panel type off. It then leaves the panel menu, and a link or panel
set that holds a signature shows a placeholder that keeps its settings (the key is `panel.gene-signature.enabled`; see the {doc}`administrator guide <../deployment/admin>`).
