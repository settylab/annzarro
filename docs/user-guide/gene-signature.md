# Gene signatures

A **Gene Signature** is a named list of genes, kept as a recipe: the genes, and how a score would be
worked out from them. The **Gene Signature** panel builds the list. It opens on every gene of the
dataset, ready to tick, and it needs no setup. The default way of scoring is stated in the panel
("Z-score mean of X, clipped at ±10": each gene is turned into a z-score over all cells, then the genes
are averaged). Other ways to score are offered under **Score options** ({ref}`gene-signature-scoring`) and
chosen where a score is used.

A signature outlives its panel. Close the panel and the signature is still there, listed in the
panel chooser as **Closed**, and still usable wherever a gene table is: it can filter a Gene Plot and
it can be the source of a Gene Set Analysis panel.

## Build a list

1. Add a **Gene Signature** panel (**Create New Panel** → **Gene Signature**, or split a tile).
2. Tick genes in the list, or type part of a name in **Search genes**.
3. Choose the signature where you choose any source: a Gene Plot's **Table** menu, a Gene Set Analysis
   panel's **Source** menu, or **gene-score** in a Cell Plot or Cell Table (see below).

The panel states how many genes it holds. **There is no limit** on the length of the list: a score takes no
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
the **aggregation** (z-score mean, the default, or any other the signature offers). Each axis, the colour and the hover can use a
different signature or a different aggregation of the same one; the same choice on two axes is computed once.
The third menu is one list of what the signature offers, method and layer together ("Z-score mean", or "Mean · counts" when several layers are offered). A cell table's **gene-score** tab lists the same options. The same signature over two layers is two scores; a layer the dataset does not have, or an option the signature stopped offering, is stated over the plot.
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

(gene-signature-scoring)=
### Scores offered: what the signature offers

Under **Scores offered** in the signature's panel you decide what plots and tables are offered and how each
option is computed. A plot or table only picks from what is offered: choose **gene-score** as the source,
then the signature, then the option. Plots and tables pick from these, and nothing is computed until a plot or
table shows one. The collapsed row always states what is offered ("z-score mean, mean, sum · X"), so a link
opened with other settings is never hidden.

An option is a **method** read from a **layer**. Each method has an **Offer** box and a one-line definition, and
its parameters appear under it while it is offered, with **Reset** for that method when one is changed:

| Method | What it gives | Parameters |
|---|---|---|
| **Z-score mean** (default) | each gene scaled to mean 0 and SD 1 over all cells, then averaged, so every gene counts equally | **Clip at ±** (default 10, any number above 0, or off) |
| **Mean** | the average of the genes' values, in the layer's units | none |
| **Sum** | the total of the genes' values, in the layer's units; it grows with the number of genes | none |
| **Control-adjusted** | the mean of the genes minus the mean of control genes with similar detection, like scanpy's `score_genes` (genes are binned by detection, not by mean) | **Bins** (25), **Controls per bin** (50), **Seed** (0) |
| **Fraction detected** | the share of the signature's genes detected in the cell, from 0 to 1 | **Detected above** (0): a gene is detected when its value is above this |
| **% of total** | the genes' share of the cell's total over all genes, in percent, as for % mitochondrial | none |

Z-score mean, mean and sum are offered at first; switch the others on with one click. At least one option stays
offered. The clip stops one rare gene dominating the average (its z-score can reach the hundreds when a gene is
detected in a handful of cells). A number that is not valid is refused ("Enter a number above 0.") and the last good
value stays; Esc puts the last good value back.

**Fraction detected** is a share, not a count, so it means the same when a gene is missing from the dataset and
compares between signatures of different sizes. **% of total** divides by the cell's total over every gene of the
matrix, the signature's own included, which needs one pass over the whole matrix: it takes longer than the others and
asks first on a large dataset. **Control-adjusted** removes differences in depth and quality between cells that move
every gene together; the same seed always gives the same controls, so a link keeps its meaning.

**Layers** lists X and the dataset's layers, each with an **Offer** box and a word for what it looks like (counts,
normalised, log-normalised, scaled). At least one layer stays offered. There is no default method or layer to
choose: a new plot or table starts on the first entry of the menu, the first offered method on the first offered
layer, and keeps whatever it is given. Scores are meant for normalised, log-transformed
values. If a layer looks like raw counts, a warning says so under it ("X looks like raw counts (whole numbers up to
557). Scores should be computed on normalised, log-transformed data, or they follow sequencing depth.") and, when
another layer looks log-normalised and is named that way, offers **Offer logged_counts instead**: it offers that layer
and stops offering the raw one, unless a plot or table reads the raw layer, which then stays. The same goes
for values that are normalised but not log-transformed. It is a warning, not a block.

Some combinations are meaningless and are left out of every menu, with the reason in the panel: fraction detected
and % of total on a scaled layer (almost every value is non-zero; the values are negative). Others are allowed with
a warning under the method, said once: the mean, sum, z-score mean and control-adjusted on raw counts follow
sequencing depth, and % of total on log values is compressed.

Each option and layer says who uses it ("1 plot", "2 plots, 1 table"). Switching an option off never breaks a
plot or table that uses it: it keeps its setting, is marked "(no longer offered)" in its menu and keeps drawing, and the panel says who
keeps it, with **Undo**. Links and panel sets keep the options, the layers and every parameter.

A change to a setting that changes a score is an edit of the signature, like a tick: a quick score updates
after a short pause, and one that would take 5 seconds or more waits behind **Update score**. A clip edit asks
the server for nothing when no plot shows a z-score mean, a seed edit recomputes only control-adjusted scores, and
choosing what is offered changes no score.

### Score some genes as down

Some signatures have genes that should count against the score, such as an exhaustion marker in an activation
signature. Tick **Score some genes as down** in **Scores offered** and every selected gene gets a direction button,
**↑ Up** or **↓ Down**; one press flips it. Until you tick it nothing about direction appears.

- **The score** is the average of the up genes minus the average of the down genes, each side scored on its own.
  For the z-score mean and the mean that is the difference of two means. For **control-adjusted**, each side
  subtracts the mean of its own control genes, as two calls of scanpy's `score_genes` would, and the two are subtracted.
  The panel states the formula with your numbers ("Score = average of the 42 up genes minus average of the 8 down
  genes"), and the summary line says "50 genes selected: 42 up, 8 down".
- **Only down genes** give the negative of their average, and the panel says so. A side with no usable gene (not in
  this dataset, constant, or no values) is left out, and the panel names it ("None of the 8 down genes are in this
  dataset, so only up genes are scored"). With no usable gene on either side there is no score.
- **Sum, fraction detected and % of total** are not offered while a signature has down genes, and the panel says why under
  each: a signed sum depends on how many genes each side has, the difference of two fractions is not a fraction, and
  the difference of two shares is not a share of anything. A plot or table that already uses one says so and asks the
  server for nothing; remove the down genes, or choose another option, and it comes back.
- **Changing many at once.** In the Selected list, **Show** All, Up or Down, and **Set N shown to Up** or **Down** change
  the rows the search and the filter show, in one step.
- **Add as.** With the switch on, an **Add as: Up | Down** control sits in the add row, set to Up. Whatever you add next
  follows it: **Add from** (fixed genes and gene tables), the focused gene (**+ GAPDH as down (focused)**) and
  **Paste or upload**, whose Add button then reads "Add 12 as down". It goes back to Up when the switch is turned
  off. Ticks and **Tick all** add as up. A gene already in the signature keeps its side when it is added again;
  the paste preview says how many would change and offers **Change them too**, which makes the change part of the same
  single step.
- **A sign column.** When a pasted or uploaded table has a column such as a log fold change, choose it as **Sign
  column** in the preview: positive values go up, negative values go down, and the Add button shows the split ("Add 3
  genes (1 up, 2 down)"). Genes with a zero, blank or non-numeric sign are left out, and the preview counts them. The
  choice is made for that file only; nothing is guessed.
- **Undo** takes back every direction change, one step each; flipping several genes quickly is one step.
- **Turning it off.** With down genes present the switch asks first: "8 down genes will count as up. **Count as up**
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
- **Export.** **Export gene figures** opens a small chooser of the method · layer combinations the source offers (the
  list plots choose from), as checkboxes. The one being inspected is ticked, and any already computed. Nothing is
  computed until you press **Export**: a combination that is not computed is worked out then, under the usual cost
  tiers. The chooser states each estimate beside it; one that asks first (over a minute) is asked about before it starts
  ("will take about 2 minutes. Compute / Cancel"); one that would be refused is left out and named. Progress is shown
  with **Cancel**, and cancelling leaves no file. The figures are in the long form, one row per combination and gene with
  the combination in the first column, because each combination's figures come from its own layer (a gene can be
  constant in one layer and not in another) and a fixed header filters and pivots in any spreadsheet. A file with one
  combination is named for it; with several, for the source alone. A gene name that begins with `=`, `+`, `-` or `@` is
  saved with a leading apostrophe, so a spreadsheet shows it as text rather than running it as a formula.
  There is no per-cell export here: a signature or a gene table does not own a set of cells. Inspect says so ("To
  export scores per cell, add them as columns to a Cell Table"). A Cell Table with the score as columns, one for each
  method · layer option you want, exports them in its own CSV, each headed with its full label ("T cell score ·
  z-score mean · X").

In a narrow panel (under 360 px) the table keeps only the gene and its detection rate; under 280 px
the chart is replaced by its figures.

(gene-table-score)=
## Score the genes of a gene table

A **Gene Table** is a source of a gene score exactly as a signature is. The one difference is how the genes
are chosen: a signature's are ticked by hand, a table's are the rows that pass its filter. Everything else is
the same: the score, the cost estimate and its three tiers, the aggregations and layers, the notices over a plot,
**Update score**, and **Inspect**.

Choose **gene-score** as a plot's source (or on a Cell Table's **gene-score** tab) and the list of sources shows
**Gene signatures** and **Gene tables** under their own headings when both exist. Pick a table, then an
option, as for a signature. The label names the table ("Gene Table 1 · mean").

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

**Scores offered, in the table.** Under the column chooser, in the table's controls, a Gene Table has the same
**Scores offered** section as a signature (collapsed to one row such as "z-score mean, mean, sum · X") and an
**Inspect** section (collapsed). The table is still a table first: both stay closed until opened, and they go
with the controls when these are hidden. The table stores these settings, and nothing else about the score, in its
configuration, so links, panel sets and Back and Forward keep them; a table that offers the defaults stores
nothing. Gene Set Analysis and Gene Plot filters read the table as before.

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
