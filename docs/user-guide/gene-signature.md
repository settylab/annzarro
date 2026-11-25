# Gene signatures

A **Gene Signature** is a named list of genes, kept as a recipe: the genes, and how a score would be
worked out from them. The **Gene Signature** panel builds the list. It opens on every gene of the
dataset, ready to tick, and it needs no setup. The default way of scoring is stated in the panel
("Z-score mean of X, clipped at ±10": each gene is turned into a z-score over all cells, then the genes
are averaged). A plot or table that uses the score chooses the method and the layer; the settings of each method
are under **Methods ▾** in the panel ({ref}`gene-signature-scoring`).

A signature outlives its panel. Close the panel and the signature is still there, listed in the
panel chooser as **Closed**, and still usable wherever a gene table is: it can filter a Gene Plot and
it can be the source of a Gene Set Analysis panel.

```{figure} ../_static/screens/user-guide/signature-panel.png
:class: screenshot
:alt: The Gene Signature panel with eight genes selected: Methods and Distribution (1, 2) at the top right, the search box (3), the add row with Paste or upload, Add from and Up/Down (4 to 6), Undo (7), the list of ticked genes and the status banner "8 of 16,285 genes selected" at the foot.

A Gene Signature panel. **Methods ▾** (1) and **Distribution** (2) in the status row; the search box (3); **Paste or upload** (4), **Add from ▾** (5) and **Up/Down** (6) in the add row; **Undo** (7) in the list bar. The status banner under the list counts the selected genes.
```

## Build a list

1. Add a **Gene Signature** panel (**Create New Panel** → **Gene Signature**, or split a tile).
2. Tick genes in the list, or type part of a name in **Search genes**.
3. Choose the signature where you choose any source: a Gene Plot's **Table** menu, a Gene Set Analysis
   panel's **Source** menu, or **Gene score** in a Cell Plot or Cell Table (see below).

The panel states how many genes it holds in the status banner at its bottom ("5 of 3,000 genes selected"), the same
strip a plot has for "n of N cells shown": it stays in place as the list changes, and **details** opens how many genes
are not selected. Nothing in the panel moves while you tick, add or clear: the line that says what an edit did and the
score's line each keep one line, a long sentence cut short with its whole text as a tooltip. **There is no limit** on the length of the list: a score takes no
more memory than a gene table, which has none. What guards a large list is the cost estimate, which asks
before a slow score and refuses one that would take too long (see *When a score is slow*). A signature of
every gene of a dataset is allowed; a link or panel set that holds thousands of genes is long, see
*Close, reopen, share*.

### Ticking genes

- **All genes** shows every gene of the dataset, in alphabetical order, as a list that stays quick
  at any length. **Selected** shows only the genes in the signature. A signature opened from a link
  or a saved panel set starts on **Selected**.
- Untick a gene in **Selected** and its row is struck through but stays where it is, so the list
  does not move under the pointer. It is gone when you change the view.
- A gene that is in the signature but not in the dataset stays in the recipe, greyed and marked
  "not in this dataset", and is counted in the status banner at the bottom ("2 selected genes: not in this dataset").

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

**Add from** lists (the focused gene has its button, so it is not repeated here):

- genes locked in a plot, each with its source ("Klf1 · fixed in Cell Plot 2");
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

A pasted list can be any length; the preview counts the genes that will be added and **Add** adds them all.

**Add** adds the genes as one step: **Undo** (or Ctrl+Z, Cmd+Z on a Mac) takes the whole paste back.
**Cancel**, **Esc** and **Add** return you to the list and put the cursor back on **Paste or upload**.

```{figure} ../_static/screens/user-guide/signature-paste.png
:class: screenshot
:alt: The paste preview of a Gene Signature: a pasted two-column list with the gene column chosen, "7 will be added", "1 matched ignoring case (CD3E > Cd3e)", "1 not in this dataset" with its name listed, and the buttons Back and Add 7 genes.

The preview of a pasted list, before anything is added: how many genes will be added, those matched ignoring case, and the names the dataset does not have.
```

## Use a signature

There is no menu in the signature's panel for this. A signature is chosen from the place that uses it:

- A *Gene Plot*'s **Table** menu lists it beside the gene tables, so the plot shows only the
  signature's genes.
- A *Gene Set Analysis* panel's **Source** menu lists it by name, with no "(closed)" mark, because a
  signature needs no rows of its own.
- A *Cell Plot* or *Cell Table* takes its score through **Gene score** (see below). Each of those menus
  ends with **New signature…**, which opens a new signature beside the panel.

Both of the first two follow the list as you edit it. They go on working after you close the signature's panel. The
line under the title says what uses it ("Used by 1 plot, 1 Gene Set Analysis").

## Colour or position a Cell Plot by a score

A signature gives every cell one number. A Cell Plot can take it as its **x**, **y**, **z** or **colour**: choose
**layer** as the source, then the layer (X or any layer), and pick the signature in the item list that follows. That list
has the focused gene first and then **Gene signatures** and **Gene tables** under their own headings; every signature is
listed, open or closed. A score is not a hover column: colour the plot by it and the hover shows its value as `c`.
A link or panel set that lists a score among the hover columns opens without that column and says nothing about it.
The score works in large-plot mode too (colour and axes; the tooltip shows the
colour's score).

A signature picked there shows a small button after the list, with the symbol of its aggregation (z̄ for the
z-score mean, x̄ for the mean, Σ for the sum). It opens the aggregations, each as a symbol and a name, and its
tooltip names the one in force ("Aggregation: Z-score mean"). A single gene has no button. A row is always one line:
source, layer, item, aggregation. The menu lists all six methods and the layer list X and every layer of the dataset, so a
menu never grows with the number of combinations. A new plot starts on z-score mean over X. A combination that cannot be
computed is greyed out in the other control, with the reason when you point at it: under **% of total**, a scaled layer such as
X is greyed out ("Has negative values"). Choose the layer first to reach a method that needs it. When one control
leaves the other on a combination that cannot be computed, the other moves to the first one that can, and a line under
the row says so once ("Layer changed to logged: % of total is not available on X."). Leaving the layer source, or picking
a single gene, clears the signature from the row completely. A link that holds such a
combination keeps it, marked "(not available)", and the plot says why.

**Control-adjusted** and **% of total** read the whole matrix once besides the signature's genes; their entries say
so when you point at them, and the usual cost tiers apply: a slow score asks first, and one that would take more than
10 minutes is refused.

Each axis and the colour can use a different signature or a different method or layer of the same one; the same
choice on two axes is computed once. The same signature over two layers is two scores. A layer the dataset does not
have stays in the layer select, marked "(not in this dataset)", and is stated over the plot.
The score can be on any axis, x, y and z (3D) included, against another score, an obs column or a gene.
In large-plot mode x, y and colour take a score; 3D is not available there.

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
- **Longer**: it is not started by itself, and the plot says why and what to do ("Use fewer genes"). Where the server
  allows it the notice has **Try anyway**, which runs it with a time limit of its own; see
  {doc}`long-computations` (Try anyway, and not asking again).

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

(gene-signature-scoring)=
### Methods: the settings of each method

A plot or table chooses how a score is worked out where it uses it: a **method**, read from a **layer**. Every method
and every layer of the dataset can be chosen there; nothing has to be switched on in the signature first. The
signature's panel holds only what defines each method, behind **Methods ▾** in its toolbar. The button opens a
pop-over over the panel, so nothing in the panel moves; **Esc** or a click elsewhere closes it.

The pop-over lists every method with a one-line definition and its parameters, always, with **Reset** for that method
when one is changed:

| Method | What it gives | Parameters |
|---|---|---|
| **Z-score mean** (default) | each gene scaled to mean 0 and SD 1 over all cells, then averaged, so every gene counts equally | **Clip at ±** (default 10, any number above 0, or off) |
| **Mean** | the average of the genes' values, in the layer's units | none |
| **Sum** | the total of the genes' values, in the layer's units; it grows with the number of genes | none |
| **Control-adjusted** | the mean of the genes minus the mean of control genes expressed in a similar share of cells, like scanpy's `score_genes` (genes are binned by the share of cells expressing them, not by mean) | **Bins** (25), **Controls per bin** (50), **Seed** (0) |
| **Fraction of genes** | the share of the set's genes that are above **Expressed above** in the cell, from 0 to 1 | **Expressed above** (0): a gene counts when its value is above this |
| **% of total** | the genes' share of the cell's total over all genes, in percent, as for % mitochondrial | none |

A parameter holds for its method on every layer. The clip stops one rare gene dominating the average (its z-score can
reach the hundreds when a gene is expressed in a handful of cells). A number that is not valid is refused ("Enter a
number above 0.") and the last good value stays. While a parameter is not at its default, the **Methods** button
carries a dot and its tooltip names each one ("z-score mean: not clipped; control-adjusted: seed 3"), so a link opened
with other settings hides nothing.

**Fraction of genes** is a share, not a count, so it means the same when a gene is missing from the dataset and
compares between signatures of different sizes. **% of total** divides by the cell's total over every gene of the
matrix, the signature's own included, which needs one pass over the whole matrix: it takes longer than the others and
asks first on a large dataset. **Control-adjusted** removes differences in depth and quality between cells that move
every gene together; the same seed always gives the same controls, so a link keeps its meaning.

Whether a method suits a layer is said where the pair is chosen, not in the pop-over: a pair that cannot be computed
(% of total on a scaled layer, whose values are negative; fraction of genes where the threshold makes it constant) is
greyed out in the plot's or table's menu with the reason, and one that misleads (a sum on raw counts follows
sequencing depth) carries the reason as a note. A new plot or table starts on the z-score mean of X.

The pop-over says which methods and layers plots and tables read ("Used by 2 plots, 1 table: z-score mean, mean ·
X, counts"), so you can see what an edit recomputes. **Reset to defaults** puts every parameter back; it never
changes a method or a layer a plot uses, and it asks first only when a score a plot or table shows would change.

A change to a parameter is an edit of the signature, like a tick: a quick score updates after a short pause, and one
that would take 5 seconds or more waits behind **Update score**. A clip edit asks the server for nothing when no
plot shows a z-score mean, and a seed edit recomputes only control-adjusted scores. Links and panel sets keep every
parameter. A link made before this release, which listed the methods and layers a signature offered, opens with
every plot and table on the method and layer it showed.

```{figure} ../_static/screens/user-guide/signature-methods.png
:class: screenshot
:width: 50%
:alt: The Methods pop-over of a Gene Signature, one section for each score method: Z-score mean with its clip, Mean, Sum, Control-adjusted with Bins, Controls per bin and Seed, Fraction of genes with Expressed above, and % of total.

The **Methods ▾** pop-over: one section for each method, with its definition and its parameters.
```

### Up and down genes

Some signatures have genes that should count against the score, such as an exhaustion marker in an activation
signature. Press **Up/Down** in the gene list's toolbar, beside **Add from**, and every selected gene gets a direction
button, **↑ Up** or **↓ Down**; one press flips it. Until you press it nothing about direction appears. Direction is a
property of the gene list; how down genes weigh is a setting of the methods, under **Methods ▾**.

- **The score** is the up genes minus the down genes. By default every gene weighs equally: the signs of the down
  genes are flipped and all genes are averaged. For **control-adjusted**, each side subtracts the mean of its own
  control genes, as two calls of scanpy's `score_genes` would, and the two are subtracted.
  The panel states the formula with your numbers ("Score = the 42 up genes minus the 8 down genes, averaged over all
  50 genes: each gene weighs equally"), and the **Selected** view says "Selected 50: 42 up, 8 down".
- **How down genes weigh.** For the z-score mean and the mean, **Down genes** under the method in **Methods ▾** chooses between **each
  gene weighs equally** (the default) and **each side weighs equally**. By gene, the signs of the down genes are
  flipped and every usable gene is averaged: (sum of up - sum of down) / (number of up + number of down), so 40 up
  genes and 4 down genes count 40 to 4. By side, it is the mean of the up genes minus the mean of the down genes, as two
  scanpy `score_genes` calls subtracted, so the 4 down genes weigh as much as the 40 up. With equal sides the by-side
  score is exactly twice the by-gene score. With one side empty both are the same score. A gene with no value in a cell
  is left out of that cell's count. **Control-adjusted** has no choice: each side always subtracts its own controls.
  The method's definition line states the formula in force, and a colour bar or CSV header says "each side weighs
  equally" when you chose that.
- **Only down genes** give the negative of their average, and the panel says so. A side with no usable gene (not in
  this dataset, constant, or no values) is left out, and the panel names it ("None of the 8 down genes are in this
  dataset, so only up genes are scored"). With no usable gene on either side there is no score.
- **Sum, fraction of genes and % of total** cannot be chosen while a signature has down genes, and the menus say why:
  a signed sum depends on how many genes each side has, the difference of two fractions is not a fraction, and the
  difference of two shares is not a share of anything. A plot or table that already uses one says so and asks the
  server for nothing; remove the down genes, or choose another option, and it comes back.
- **Changing many at once.** In the Selected list, **Show** All, Up or Down, and **Set N shown to Up** or **Down** change
  the rows the search and the filter show, in one step.
- **Add as.** With **Up/Down** pressed, an **Add as: Up | Down** control sits in the add row, set to Up. Whatever you add next
  follows it: **Add from** (fixed genes and gene tables), the focused gene (**+ GAPDH as down (focused)**) and
  **Paste or upload**, whose Add button then reads "Add 12 as down". It goes back to Up when **Up/Down** is
  turned off. Ticks and **Tick all** add as up. A gene already in the signature keeps its side when it is added again;
  the paste preview says how many would change and offers **Change them too**, which makes the change part of the same
  single step.
- **A sign column.** When a pasted or uploaded table has a column such as a log fold change, choose it as **Sign
  column** in the preview: positive values go up, negative values go down, and the Add button shows the split ("Add 3
  genes (1 up, 2 down)"). Genes with a zero, blank or non-numeric sign are left out, and the preview counts them. The
  choice is made for that file only; nothing is guessed.
- **Undo** takes back every direction change, one step each; flipping several genes quickly is one step.
- **Turning it off.** With down genes present **Up/Down** asks first: "8 down genes will count as up. **Count as up**
  **Keep**". Count as up is one step that Undo takes back.
- **Links.** The down genes are part of the recipe and of the score's key, so flipping a gene asks the server again and
  Undo does not (the earlier score is still held). A link made before this has no down genes.
- **Gene tables** have no direction: every gene passing the filter is up. To get a table's genes into a signature as
  down, use **Add from** with Add as set to Down. A table has no per-gene sign column here because guessing the sign
  convention of a fold change wrong would flip a score silently.

### Opening several at once

A link can name many scores. At most two are computed at a time, those on screen first; a plot that is
off screen starts when it comes into view. Plots that show the same score share one request, and a score
is kept in the browser (up to 1 GiB, least recently used first) so it is not asked for twice.

## See a score's distribution

**Distribution**, beside **Methods ▾** in the panel's toolbar, opens a Cell Count Plot beside the panel with a histogram of
the score (the z-score mean of X) over the cells shown. Everything a Cell Count Plot does applies: change the method or the
layer on its x axis, split it by a grouping, and read the cells with no score (every gene missing there) in its count
of cells left out. Genes left out of the score (absent from the dataset, constant, or without a value) are named in
the panel's status line.

For each gene's figures by group, add the signature as a section of a Cell-Gene Plot, which shows the mean and the
share of cells expressing each gene and downloads them as CSV. To export scores per cell, add them as columns to a
Cell Table, one for each method and layer you want; its CSV heads each with its full label ("T cell score · z-score
mean · X").

(gene-table-score)=
## Score the genes of a gene table

A **Gene Table** is a source of a gene score exactly as a signature is. The one difference is how the genes
are chosen: a signature's are ticked by hand, a table's are the rows that pass its filter. Everything else is
the same: the score, the cost estimate and its three tiers, the methods and layers, the notices over a plot,
**Update score**, and **Distribution**.

Pick a gene table (in a plot's item list under a layer, or on a Cell Table's **Gene score** tab) from the **Gene tables**
section, then an aggregation and a layer, as for a signature. The label names the table ("Gene Table 1 · mean").

**What the genes are.** The rows that pass the table's filter now: its conditions and its search box, the same
rows that a Gene Plot filtered by the table or a Gene Set Analysis panel reads. Change the filter and the
score follows, as it does when a signature is edited: a quick score updates a moment after you stop, and one
that would take 5 seconds or more collects behind **Update score**. A filter that passes the same genes as
before asks the server for nothing, and a score computed for a set of genes is kept, so going back to a filter you
had used is instant.

**A table that is closed or came from a link.** A closed table keeps the genes that passed when it closed. One
restored from a link, a panel set or Back and Forward has only its configuration, so the page builds its filter in
the background first, then asks for the score. A plot that is waiting says which: "Building 'Gene Table 1' to find its
genes, then scoring them", a **Build filter** button for a table of 200,000 rows or more (the build pauses the page
for a few seconds), or why a table is too large or cannot be built. A table whose filter depends on a table that
reads its score, through a hand-edited link, is named as a circle and nothing is computed.

**Score methods, in the table.** Beside the column chooser's buttons, in the table's controls, a Gene Table has
**Score methods ▾**, the same pop-over as a signature's **Methods ▾** (without down genes, which a table does not have),
and **Distribution**. The table is still a table first: nothing folds open in the panel, and both buttons go with the
controls when these are hidden. The table stores the parameters, and nothing else about the score, in its
configuration, so links, panel sets and Back and Forward keep them; a table at the defaults stores nothing. Gene Set
Analysis and Gene Plot filters read the table as before.

## Rank cells in a Cell Table

A Cell Table can show a signature's score as a column, so you can sort the cells by it, filter on it and
export it. Open the table's
column chooser and choose the **Gene score** tab. Under each signature are the score columns the table has
("mean · counts"), each with its tick box, then one row: **[layer ▾] [aggregation button] [Add column]**. Choose a layer and, with the symbol button, a method
(the symbols are explained under {ref}`interface-symbols`), graded as a plot's selects are, and press **Add column**: the column is ticked, and **Apply Changes** puts it
in the table (the row says "Added …. Apply Changes to show it in the table."). The tab never lists every combination of method and layer. Add as many as you like: several
signatures, and several methods or layers of one, are several columns, and each is computed once however many plots
and tables use it.

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

A link, a panel set and the history keep the column's reference (the signature, the method and the layer) and the
filter conditions, never the numbers; the column is computed again when the table opens. A signature that
changes id when a panel set is added beside open panels takes the table's columns and conditions with it.

The score stays in the browser as one list of numbers shared by every plot and table that uses it. A column
adds no property to the table's rows, so on a table of a million cells it costs about 34 bytes a cell of
the browser's memory, against about 71 for an ordinary numeric column. The table's usual memory check
still decides whether a table of that size opens.

```{figure} ../_static/screens/user-guide/signature-table-score.png
:class: screenshot
:alt: The column chooser of a Cell Table on its Gene score tab: for each signature a row with a layer select, the aggregation button showing the z-score mean symbol and an Add column button.

The **Gene score** tab of a Cell Table: for each signature, a layer, the aggregation button and **Add column**.
```

## Close, reopen, share

A signature is saved as configuration only: its title, its genes (sorted, so equal lists make equal
links), its scoring settings and nothing computed. Share links, saved panel sets and Back and
Forward all carry it, closed or open. The panel chooser lists a closed signature with its name; pick
**Reopen** to open it again under the same name, so the plots and analyses that use it keep using it.

**Long lists make long links.** Share Link says so when the link passes 8,000 characters, gives its length and suggests a panel set; it still copies the link. A share link carries the whole view in the part after `#`, deflated, so it is
never sent to the server and has no server-side limit. A list of genes compresses by about half: a link holding
one signature is about 3,400 characters at 500 gene symbols, 12,000 at 2,000, 29,000 at 5,000 and 106,000 at 20,000
(Ensembl ids compress better: 2,100, 7,300, 18,000 and 71,000). The browser's address bar holds links of this size, but chat and
email programs cut long links. For a list of thousands of genes, save a **panel set** and share that: it
carries the same configuration with no limit on its length.

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
