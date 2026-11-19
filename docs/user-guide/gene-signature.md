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
3. Choose the signature where you choose any source: a Gene Plot's **Table** menu, a Gene Set Analysis
   panel's **Source** menu, or **gene-score** in a Cell Plot or Cell Table (see below).

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

The focused gene is one click away: when a gene is focused, **+ CD3D (focused)** sits in the add row and
adds it as one step. It is greyed, with the reason as its tooltip, when the gene is already in the list or
not in the dataset, and follows the focus.

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

There is no menu in the signature's panel for this. A signature is chosen from the place that uses it:

- A *Gene Plot*'s **Table** menu lists it beside the gene tables, so the plot shows only the
  signature's genes.
- A *Gene Set Analysis* panel's **Source** menu lists it by name, with no "(closed)" mark, because a
  signature needs no rows of its own.
- A *Cell Plot* or *Cell Table* takes its score through **gene-score** (see below). Each of those menus
  ends with **New signature…**, which opens a new signature beside the panel.

Both of the first two follow the list as you edit it. They go on working after you close the signature's panel. The
line under the title says what uses it ("Used by 1 plot, 1 Gene Set Analysis").

## Colour or position a Cell Plot by a score

A signature gives every cell one number. A Cell Plot can take it as its **x**, **y**, **colour** or
**hover**: choose **gene-score** among the sources (beside obs, obsm, obsp and layer), then pick the
signature by name. Every signature is listed, open or closed.
The score works in large-plot mode too (colour and axes; the tooltip shows the
colour's score).

A score is chosen in three steps, as an embedding is: the source (**gene-score**), the signature, and
the **aggregation** (z-score mean, the default, or mean). Each axis, the colour and the hover can use a
different signature or a different aggregation of the same one; the same choice on two axes is computed once.
A fourth menu, under the three, chooses the **layer** the score is computed over: "of X", or any layer of the dataset (the default is the signature's own input). A cell table's score columns have the same choice at the top of the **gene-score** tab. The same signature over two layers is two scores; a layer the dataset does not have is stated over the plot.
The score can be on any axis, x, y and z (3D) included, against another score, an obs column or a gene.
In large-plot mode x, y and colour take a score; 3D and extra hover columns are not available there.

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

## Inspect a score

**Inspect**, under the gene list, shows what a score is made of. It is closed when the panel opens,
and nothing is computed until you open it. It then reads the score through the same store the plots
use, so a score that a plot already shows is not asked for again; a score nothing shows is computed
under the same limits and states as any other (progress with **Cancel**, a question first when it
is slow, a refusal with the reason, a failure with **Retry**, and edits held behind **Update
score**).

- **Aggregation.** Choose the z-score mean or the mean expression. Each is a separate score, kept
  once however many places use it.
- **Distribution.** A histogram of the score over the cells shown. Point at a bar, or focus the
  chart and use the arrow keys, to read its range, its cell count and its share. Cells with no score
  (every gene is missing there) are counted and stated under the chart and are not in it.
- **Genes.** For each gene: the share of all cells where it is detected, its mean and SD, and the
  share of cells where its z-score is clipped. These use every cell of the dataset, not only the
  cells shown. Genes that dominate the score (clipped in at least 1% of cells in a z-score mean), are
  barely detected (non-zero in under 1% of cells) or were left out (constant, or without a value) are
  flagged in words. Click a heading to sort and a gene to focus it.
- **Export.** **Export gene figures** and **Export scores per cell** save CSV files built in the
  browser from the score it holds: the gene figures (as fractions, not percentages), and one row per
  cell shown with its name and score, empty where a cell has no score. A name that begins with `=`,
  `+`, `-` or `@` is saved with a leading apostrophe, so a spreadsheet shows it as text rather than
  running it as a formula.

In a narrow panel (under 360 px) the table keeps only the gene and its detection rate; under 280 px
the chart is replaced by its figures.

## Rank cells in a Cell Table

A Cell Table can show a signature's score as a column, so you can sort the cells by it, filter on it and
export it. Open the table's
column chooser, choose the **gene-score** tab, and tick a signature and then the aggregation under it
(z-score mean or mean). Tick as many as you like: several signatures, and several aggregations of one, are
several columns, and each is computed once however many plots and tables use it.

The table appears at once. A score that is not there yet shows as `T cell score (computing)`, with
`computing…` in its cells, and the column fills in where it is when the score arrives: the table is not
built again, so your sort order, page, search and scroll stay as they were. Every state says what it is,
in the words a plot uses and with the same buttons (**Compute**, **Cancel**, **Retry**, **Update score**,
**Open signature**), over the table and as a tag in its status strip:

| The score is | The column says | Sort | Filter | Export |
|---|---|---|---|---|
| ready | `T cell score` | on | on | on |
| being updated after an edit | `T cell score (updating)`, the previous values | on, on the previous values | on, on the previous values | off until it is updated |
| computing or waiting its turn | `T cell score (computing)`, `computing…` | off | holds the rows (below) | off, "Available when 'T cell score' is ready" |
| waiting for **Compute** | `T cell score (not computed)` | off | holds the rows | off |
| cancelled, refused, failed or with no genes in this dataset | `T cell score (no score)`, `no score` | off | holds the rows | off, naming the column |
| its signature was deleted | `T cell score (deleted)`, `no score` | off | holds the rows | off |

The states with no score add **Remove column**. A column whose signature is deleted stays in the table, and
in the chooser's selected list, until you remove it.

**Sorting and filtering** run in the browser, on the numbers the table holds, as for any numeric column:
use the column header, the **Filter** conditions (a score is a number, so it offers greater than, less than,
between and the rest), or the search box. The CSV has the score at the precision a score has (about seven
digits), as a number.

**A filter on a score that is not ready holds the table.** The rows are not shown and not counted:
"Filter on 'T cell score' not applied yet. Rows appear when the score is ready." The table does not pass
unfiltered rows to anything that reads it. A plot filtered by the table says "Filtering by 'Cell Table 1'
needs 'T cell score', which is not ready yet. No cells are drawn until it is." and draws no cells. If the score cannot be computed, they say why and offer **Retry**,
**Open table** or **Stop filtering**. This also holds for a table you have closed, or one that came from a link:
the page computes the score first, then builds the table's filter in the background as it does for any closed
table, and the plot draws when both are done. A table that depends on another that depends on it, through a
hand-edited link, is named in the plot and asks for no score.

A link, a panel set and the history keep the column's reference (the signature and the aggregation) and the
filter conditions, never the numbers; the column is computed again when the table opens. A signature that
changes id when a panel set is added beside open panels takes the table's columns and conditions with it.

The score stays in the browser as one list of numbers shared by every plot and table that uses it. A column
adds no property to the table's rows, so on a table of a million cells it costs about 34 bytes a cell of
the browser's memory, against about 71 for an ordinary numeric column. The table's usual memory check
still decides whether a table of that size opens.

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
