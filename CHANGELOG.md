# Changelog

What changed for the people who use AnnZarro and run its servers, newest release first. Each
release says what you can now do, what behaves differently, and what to change when you upgrade.
The [AnnZarro paper](https://doi.org/10.64898/2026.10.10.758158) describes v0.4.1; this log starts
with the release after it. Older releases are listed on
[GitHub](https://github.com/settylab/annzarro/releases).

## Unreleased

### Added
- **Wording.** The Distribution buttons say "Cell Count Plot" (not "Count Plot"), the threshold box in the Cell-Gene Plot's statistic menu is labelled "Expressed above" like the Methods pop-overs, and the two messages for Z-score mean that could not be offered now say what to do ("Z-score mean of a cell group needs this layer stored by gene (CSC).").
- **The Venn / UpSet condition picks like the Count Plot's rows.** "Condition on a number" lists obs, obsm, obsp and layer in its first select; a gene signature or gene table is picked under **layer** with its score-method button. A cell grouping is not a number, so it is no longer listed there (use **Group of a grouping**), and the obs list lost the "Groupings" entry that did not work in this editor.
- **A Cell Count Plot picks gene signatures, gene tables and cell groupings under layer.** The first select of X, Y, Color by and the measure's source lists only obs, obsm, obsp and layer; under **layer** the item list has the focused gene, **Gene signatures**, **Gene tables** and **Cell groupings** (the measure takes no grouping, as a group label is not a number). A signature or gene table shows its score method as an aggregation button after it; a measure of one has two buttons, the statistic at the start of the line and the score method after the source, each titled with its step. A grouping has none, and its layer select is disabled. **Distribution** now opens a plot whose X row reads like the same pick, on the signature's own input layer. The score method appears in the axis title when it is not the default. Earlier links open to the same plot.
- **A Cell Plot picks a Cell Grouping under layer.** The first select no longer has **Cell Grouping**: choose **layer**, then the grouping in the item list under **Cell groupings** (last, after the gene-side sets; **New grouping…** ends it). A grouping has no aggregation button, and the layer select stays on its layer, disabled, with "A cell grouping reads no layer.". Above the large-plot threshold the groupings are listed greyed on x, y and z. The obs column list of a Cell Plot no longer ends with a **Groupings** group. Links and panel sets made before open to the same plot.
- **Try anyway for runs the server would not start by itself.** A score, grouping or count refused only for its estimated time (over 10 minutes) now has a **Try anyway** button when the administrator allows it: the run goes through the heavy lane with its progress bar and **Cancel**, stops by itself after `try_max_s` (30 minutes by default; `0` turns tried runs off), and says so if it is stopped. A box **Don't ask again for this panel** skips the question for that panel until the page is reloaded; the tag **Runs without asking** in the panel's status strip shows it and has **Ask again**. Size limits are never skipped. Administrators: new limit `try_max_s` (see the resource limits page); one tried run per user at a time (`429 try_busy`).
- **Fractions are fractions, and every share says what it is.** The Cell-Gene and Gene Plots' and the tables' "% expressing" is now **Fraction of cells**, from 0 to 1 (symbol c⁺), the same number as scanpy's dot size; a gene score's "Fraction detected" is **Fraction of genes** (symbol g⁺, values unchanged); **% of total** stays a percentage; and "Detected above" is **Expressed above** everywhere. Size legends and hover read `0.25`, `0.342`. The **Cell Count Plot** follows: its shares are **Fraction of cells shown** and **Fraction within each …**, from 0 to 1 (ticks, labels, hover and the CSV column **Fraction** read `0.25`), the **100%** arrangement is **Filled**, its measure's statistic is chosen with the same button and list as the other plots (adding **Mean of expressing cells** and **% of total**, and today's z-score becomes **Mean, as z-score against all counted cells**), and a gene measure over a Cell Grouping's groups follows the grouping's **Expressed above**. Links, sessions and panel sets made before open as they were: the old names are read as the new ones, a size, colour or height range that was stored in percent is dropped (the plot draws on its defaults), and the dots look as before.
- **The tabs of the table column choosers are named and ordered alike.** A cell table: obs, obsm, obsp, layers, Gene score, Cell groupings; a gene table: var, varm, varp, layers, Cell groupings. The Cell Grouping tab of a cell table is now called **Cell groupings**. The tables page of the user guide describes the three kinds of tab, the add rows and their symbols, and the gene table's Cell groupings columns.
- **Table column chooser: the search field is gone from the Layers, obsp, varp, Gene score and Cell groupings tabs** (they list only ticked columns and one add row), and stays on obs, obsm, var and varm. An add row keeps its choices (group, layer, aggregation, item) when the chooser is rebuilt, for example when a panel is renamed or the focus moves.
- **A Gene Table can show a group's statistic as a column.** The column chooser has a new **Cell groupings** tab, listing every Cell Grouping, open or closed, by its title. Under each are the table's columns of that grouping, then one row to add another: pick a group (by the name shown, or its generated name; the tab's search field narrows the list), a layer and a statistic (the same list and symbols as a Gene Plot's colour), then **Add column**. Each gene gets the statistic over the group's cells, the same number the Gene Plot colours it with. A second statistic of the same group and layer asks the server for nothing (z-score mean is its own request, as in the Gene Plot, and is greyed out with the reason on a store that does not keep the layer by columns). The column follows the cell subset, shows "(computing)" in its header and fills in place, can be sorted and exported (the export header names the grouping), follows a rename of the grouping, and says so when its group has changed (**Keep**), is gone or its grouping was deleted (**Remove column**). A grouping built from the table can be shown in it but not filtered on.
- **Z-score mean is a statistic of the Cell-Gene Plot's Color (and Height).** Each gene is scaled to mean 0 and SD 1 over all cells of the dataset (clipped at ±10), then averaged over each group's cells, so a gene row is the same number as the row of a one-gene signature on z-score mean. The colour bar is RdBu, centred on 0, unless you picked a map; a gene with no spread over the dataset has no value, and its hover says so. The server's `features` of a grouping request take `{"kind": "gene", "transform": "zscore", "clip": 10}` for this (`clip` null for none), and a gene with no spread has the status `constant`. A one-row section under it is always the set's z-score mean score, the same number and name as choosing z-score mean for that row under a Mean colour, so its other gene steps are greyed out with the reason. Size cannot show it (it is signed), and the Gene Plot's cell-group statistic offers it on a store that keeps the layer by columns (CSC), where each gene's mean and SD over all cells come from the pass that reads the group (`transform: "zscore"` in the `genes` shape); on other layouts it is listed greyed out with the reason. The two z-score choices of Scale are greyed out under it, and a link or a change of Color that holds both moves Scale to None, said once. "Mean of the gene rows, as z-scores" is now "Mean of the gene rows, z-scored across groups", so the three z-scores are told apart.
- **The Cell-Gene Plot's Mode is a dropdown** (Dots, Heatmap) beside Groups, in the same size as the other selects. Heatmap still hides Size. Each change is one undo step and the choice is kept by Refresh.
- **A Gene Plot can take a statistic of a cell group** for its colour or its x, y or z axis. Choose **layer** as the source, then the layer, pick a grouping in the item list under **Cell groupings**, then one of its groups in the select that follows; a button after them holds the statistic (mean, **Fraction of cells**, mean of expressing cells, sum or SD) as a symbol. A grouping with many groups lists them all in its select, by the names shown (a label you gave a group), and changing the grouping keeps the group of the same name. Nothing is asked until a group is chosen, switching between statistics asks for nothing, two axes on the same group and layer share one request, and editing the grouping's **Expressed above** asks once. A group that has changed or gone is said on the plot, with **Keep** and **Choose another**. The server gains the `genes` shape of `POST /data/cell_groups`.
- **A Gene Plot can take a statistic of a Cell Table's cells** for its colour or its x, y or z axis. Pick a table under **Cell tables** in the item list of a layer; each gene gets one statistic over the cells that pass the table's filter, with the table's **Expressed above** as the threshold, and the same aggregation button as a grouping. The axis follows the table's rows: a filter change asks once and the plot keeps what it shows until the new values come; a table with no rows or one that was deleted is said over the plot.
- A **Gene Signature** panel builds a named list of genes and gives every cell a score from it. It opens on every gene of the dataset, ready to tick, in a list that stays quick at any length. Search by name, with Match case and regular expression buttons; **Enter** ticks the gene you typed and keeps the cursor in the box; **Tick all** ticks every match. When a gene is focused, **+ CD3D (focused)** adds it in one click (greyed, with the reason, when it is already in the list or not in the dataset). The **Add from** menu opens above every panel and brings in genes locked in a plot, or every gene of a gene table, and **Undo** (Ctrl+Z, Cmd+Z on a Mac) takes back each change of the list. A signature holds any number of genes: the cost estimate of its score is the only guard. How many are selected is the status banner at the bottom of the panel ("5 of 3,000 genes selected"), the same strip a plot has for "n of N cells shown", with **details** on how many are not selected and which selected genes the dataset lacks. Nothing in the panel moves while you tick, add or clear. A signature outlives its panel: closed, it is still listed and still usable wherever a gene table is, as a Gene Plot's table filter and as the source of a Gene Set Analysis panel, and its score is still there for plots and tables. Share links, panel sets and Back and Forward carry it as its genes and settings only, never a computed number. An administrator can switch it off with `panel.gene-signature.enabled`.
- **Paste or upload** in the Gene Signature panel adds genes from text or a file. Paste a list with any separator (new line, comma, semicolon, tab, space, pipe, or a mix), or choose a file or drop one on the panel: a plain list, a CSV or TSV (you pick the gene column), a GMT (you pick one set) or a GRP file. A preview comes first and nothing is added before you press **Add**: it counts the genes that will be added, those already selected, duplicates, names matched ignoring case and names not in the dataset (listed, and copyable), and says when the names look like another species. A list of Ensembl or Entrez ids is matched through the dataset's id column (such as `gene_ids`, read only when needed, versions like `.7` ignored), and the signature keeps the gene names; when the dataset has no such column, the preview says so and adds nothing. The file is read in your browser and is never sent to the server. Adding is one step that **Undo** takes back. Excel files are refused with a note to save the sheet as CSV.
- **Gene scores in Cell Plots.** A Cell Plot can take its x, y, z or colour from a signature or a gene table: choose **layer** as the source, then the layer, and pick the set in the item list, under **Gene signatures** or **Gene tables**, open or closed (the signatures end with **New signature…**, which opens a Gene Signature beside the plot and uses it). A button after the list holds the **aggregation** as a symbol (z̄, x̄, Σ...) and opens every method, each as a symbol and a name; the row stays one line, and leaving the layer source or picking a single gene clears the set from it. A new plot starts on z-score mean over X. A combination that cannot be computed is greyed out in the other select with the reason when you point at it (% of total on a scaled layer: "Has negative values"); when one control leaves the other on such a combination, the other moves to the first that works and a line under the row says so once. Control-adjusted and % of total say that they read the whole matrix once. A score is not a hover column: the hover shows the colour's score as `c`, and a link that lists a score among the hover columns opens without it. Two scores can be plotted against each other, or a score against an obs column or a gene. It works in the regular plot and in large-plot mode. The score is worked out on the server, over all cells of the dataset, when a plot needs it and with no panel open, so a closed signature or one from a share link colours its plot by itself; one choice used in several places is computed once. A score that would take over a minute asks first (**Compute**), and one over ten minutes is refused with the reason. While a score is on its way the plot keeps what it shows, with the usual loading indicator; a score that will not come by itself (it asks first, was refused, failed, was cancelled, was deleted, or does not fit the cells shown) is stated over the plot without moving it, with the button that helps. Edits to a signature update its plots, or collect behind **Update score** when the new score would take 5 seconds or more. A score names its method and layer wherever it leaves the app: a two-line colour bar ("T cell score" over "z-score mean · X"), axis titles, and the header of a table's CSV. The Log colour scale says how many cells sit at or below its floor ("36 of 60 cells have a score at or below 1 and are all drawn in the lowest colour"), since a z-score is mostly negative and a log scale cannot show zero or below. A Gene Plot whose link names a gene score says "Gene scores are a cell source; not available in a Gene Plot." and the rest of the link works.
- **Gene scores in Cell Tables.** A Cell Table can show a **score as a column**. Add it in the table's column chooser, on the new **Gene score** tab: under each source are the score columns the table has, then a row **[method] on [layer] Add column** with the same two selects a plot has, so the tab never lists every combination; add as many as you like (the tab can also make a new signature). The table appears at once with `T cell score (computing)` in the column, and the column fills in place when the score arrives; the table is not built again, so its sort order, page, search and scroll stay. Computing, waiting for **Compute**, updating, cancelled, refused, failed and deleted scores each say so in the header, the cells and a notice over the table, in the words and with the buttons a plot has, plus **Remove column**. You can sort by a score, filter on it (conditions and the search box) and export it as a CSV column; export waits until the score is ready. A filter on a score that is not ready holds the table's rows and says so, and a plot filtered by that table waits with it and draws no cells, whether the table is open or a closed one restored from a link; the page computes the score, then builds the table's filter. The numbers are shared with every plot that uses the score, and a column adds about 34 bytes a cell to the browser's memory on a table of a million cells.
- **Methods ▾** in the Gene Signature panel holds the settings of each score method; a plot or table chooses the method and the layer where it uses the score, from every method and every layer, and nothing has to be switched on first. The pop-over opens over the panel without moving it and closes with Escape or a click outside. It lists every method with a one-line definition and its parameters, each with a **Reset**: **z-score mean** (each gene scaled over all cells, then averaged, with a **clip** of ±10 by default, any number above 0, or off), **mean**, **sum**, **control-adjusted** (the mean minus the mean of control genes with similar detection, like scanpy's `score_genes`, with **bins**, **controls per bin** and **seed**), **Fraction of genes** (the share of the genes detected in a cell, 0 to 1, with the **Expressed above** value a gene must exceed) and **% of total** (the genes' share of the cell's total over all genes, in percent, as for % mitochondrial; it needs one pass over the whole matrix). A parameter holds for its method on every layer. While one is not at its default the button carries a dot and its tooltip names it ("z-score mean: not clipped; control-adjusted: seed 3"). The pop-over says which methods and layers plots and tables read, and **Reset to defaults** puts the parameters back, asking first only when a score a plot or table shows would change. A clip edit asks the server for nothing when no plot shows a z-score mean, and a seed edit only recomputes control-adjusted scores. A new plot or table starts on the z-score mean of X.
- **Distribution**, beside **Methods ▾** in the Gene Signature panel, opens a Count Plot beside the panel with a histogram of the score (the z-score mean of X) over the cells shown, where the method, the layer and a split by groups can be changed and the cells with no score are counted. Each gene's figures by group are a Cell-Gene Plot of the signature, and scores per cell are exported by a Cell Table.
- A **Gene Table is a source of a gene score**, like a Gene Signature. Its genes are the rows that pass its filter; everything else is shared with the signature: choose **Gene score** in a Cell Plot or a Cell Table and the source list shows Gene signatures and Gene tables under their own headings. Change the table's filter and the plots follow (a quick score at once, a slow one behind **Update score**); a filter that passes the same genes asks the server for nothing. A closed table, or one restored from a link or panel set, is built in the background first and then scored, and the plot says which step it is waiting for. Each Gene Table has **Score methods ▾** (the signature's Methods pop-over, without down genes) and **Distribution** beside the column chooser's buttons; the table keeps the parameters in its links and panel sets, and stores nothing at the defaults.
- **Up/Down** in the Gene Signature panel's list toolbar, beside **Add from**, scores some genes as down. Press it and every selected gene gets an **↑ Up** or **↓ Down** button; the score is the up genes minus the down genes. For the z-score mean and the mean, **Down genes** under the method in **Methods ▾** chooses how they weigh: **each gene weighs equally** (the default: the signs of the down genes are flipped and every gene is averaged) or **each side weighs equally** (the mean of the up genes minus the mean of the down genes, as two scanpy `score_genes` calls). Control-adjusted always takes each side minus its own control genes. The Selected list can be filtered by direction and changed in bulk (**Set N shown to Down**), and an **Add as: Up | Down** control applies to Add from, the focused gene and Paste or upload (whose button reads "Add 12 as down"); a gene added again keeps its side unless you choose **Change them too**, and a pasted table can take a sign column (positive up, negative down) with the split previewed. Every change can be undone, the panel states the formula in force and says when a side has no usable gene, and the **Selected** view reads "Selected 50: 42 up, 8 down". Sum, **Fraction of genes** and % of total have no meaningful signed version, so they cannot be chosen while a signature has down genes (the menus say why, and a plot that uses one says so). Nothing about direction shows until **Up/Down** is pressed, and a gene table has no direction: every gene passing its filter is up.
- For these scores the server gains `POST /data/gene_score` (the recipe in the body, an estimate before any work, a progress stream, then one float32 per cell shown; the body may be up to 16 MB) and `GET /data/matrix_kind` (what the numbers of a layer look like, from a sample).
- **Cell Grouping**, a new panel, sorts cells into groups by one or more factors: obs columns, and numbers binned into ranges. A binned factor has a control for the method, the number of bins, a zero bin, the range and the thresholds, with a preview of the distribution, thresholds you can drag, **Freeze thresholds**, and a choice of edges that follow the cells shown or all cells. The groups are listed in a grid: colour, name, cells and share, with small groups marked. A factor's levels or bins and the Settings open in pop-overs, so editing never resizes the panel or moves the tiles beside it. A level is renamed in place: Enter or ✓ saves, Escape or ✕ cancels, Tab saves and moves to the next level, and a click elsewhere saves. Two factors can be shown as a cross-table. The list stays fast with 2,000 groups. **Export CSV** saves the groups, and **Export cells** saves every cell with its group as a CSV (up to 1,000,000 cells). **Methods ▾** in the grouping's toolbar sets how the statistics over a group's cells are computed, for every plot on the grouping and on every layer: it lists each statistic with its definition and holds **Expressed above** (0 by default), the value above which a cell counts as expressing for **Fraction of cells** and mean of expressing cells. Each change is one step that **Undo** takes back, the plots on the grouping read their genes again at the new threshold, and plots still choose any statistic and layer. A Cell Table has the same **Methods ▾**, kept with the table in links and panel sets. A grouping is used elsewhere by name: A group is renamed in the list (double-click, ✎ or F2) with its colour beside the field, and a group's name and colour are kept under its generated name: when no group has that name any more they are listed below the list with **Drop**, and apply again if it returns. **Reset group names (n)** under Settings, and **Reset names** in a factor's Edit pop-over, take back the names you gave without touching colours. Tab in a name editor saves the name and opens the next one, which stays open.
  - a Cell Plot can colour, split (x, y, z) and hover by it, with the groups in order and in the grouping's colours, and cells in no group shown as "Not in any group". A large plot can be coloured by it too; when its codes would not fit in the browser's memory, the plot is refused before anything is requested and says so;
  - a Cell Table can show it as a column, on the column chooser's **Cell Grouping** tab, and filter on it with an Equals list;
  - the Cell-Gene Plot and the Cell Count Plot take their groups from it.
  A choice that would make a panel depend on itself is marked in every menu with the reason, and a loop made by the last edit offers **Undo**.
- **Cell-Gene Plot**, a new panel, shows genes against groups of cells as a dot plot or a heatmap. Its groups come from a Cell Grouping or an obs column, and its genes come in sections: a gene list, or one row for a whole set. Colour and size each show a per-group statistic, such as the mean or **Fraction of cells**, each on its own layer; the threshold of **Fraction of cells** follows the grouping's **Expressed above**, and the box beside each measure, empty and reading "auto (grouping: 0)", overrides it for that plot alone, so the colour can be the mean of the log-normalised layer and the size the share of cells expressing in the raw counts (how a new plot starts when the dataset has both kinds of layer, whatever the groups). Every statistic and every layer is listed, whether the groups are a grouping or an obs column; a statistic a layer cannot give is greyed out with the reason, and choosing one moves the layer and says so. A one-row section uses the plot's colour and size statistic, layer and threshold, so its row compares with its genes' rows, and chooses only how the genes are combined: the mean of the gene rows (the default, on their colour bar and size legend), their sum (under **Fraction of cells**, **Genes detected per cell**, on its own scale), the mean of their z-scores, or the set's score of each cell by any of its methods, on the plot's layer, with the plot's statistic taken over the cells (under **Fraction of cells**, the share of cells whose score is above a threshold of its own). Choices with no honest meaning are greyed out with the reason, and a gene signature with down genes is shown as its score, never as an average that would count its down genes as up genes. **Cluster** orders genes within their sections, and groups either across all groups or within the first factor, with complete, average or Ward linkage; Ward switches the distance to Euclidean and offers **Undo**. The plot draws section brackets, colour strips for each factor with their legend, totals, dendrograms and small-group marks, and **Color strips** in Plot Options shows one strip per factor (the default), one **Group** band with each group in its own colour (the swatch colour of the group grid), or none. **Cluster**, **Color** and **Plot Options** open as pop-overs that leave the panel's layout as it is and close with Escape or a click outside. The panel keeps the height the layout gives it while it computes and draws, so the tiles beside it do not move; rows or groups the clustering leaves out are named in a **Partly clustered** tag on the status line. **Cluster** also holds the linkage, the distance, sorting groups by size, and the gene and group dendrograms, each shown or hidden on its own. **Color** sets the colour scale (Reds, or RdBu centred at 0 under a z-score), reverse, min, max, centre and printed values, and in a dot plot the dot sizes: the largest dot fills its cell by default, so dots follow the panel's size and the number of genes and groups, and **Plot Options** sets the largest dot as a share of the cell (up to 200% on its slider, and up to 1000% typed, where dots overlap their neighbours) and the smallest in px; a view saved earlier keeps its sizes in px, and says so. Dots are opaque by default, with a dot opacity setting in **Plot Options**, and the plot draws no grid lines. The colour strips stand in the order of their legend. **Swap axes** sits in the toolbar beside **3D**. A section's **⋯** menu (Duplicate, Remove, Open source, Move up, Move down) opens above the plot, and **Duplicate** adds a copy titled "<name> (copy)" that is drawn as its own section. **Plot Options** sets the dot outline (black, 0.5 px), the gap between sections and their titles, labels, legends and the totals bar (cells per group), and its **Download CSV** gives the numbers drawn, beside PNG, JPEG, WEBP and SVG images. **3D** draws the matrix as bars whose height is a third measure: by default the colour's own numbers, or a statistic of its own on any layer; in a dot plot each bar's footprint is its size. The camera is kept with the plot, and up to 40,000 bars are drawn. Clicking a gene's dot, heatmap cell or label focuses that gene in every panel, with the focused gene in bold; clicking a group's label offers **Open grouping**. The plot says what it is doing and why:
  - when empty, a checklist of what it needs;
  - while working, a progress bar with the time left, and while waiting, its place in the queue (naming your own plot ahead);
  - before a long read, a question;
  - for a read that would take too long, a refusal that names a layer stored by cell (CSR) and the way out;
  - for a matrix of over 400,000 cells, a refusal before the server is asked;
  - **Show as Heatmap** when every group is a single cell, where **Fraction of cells** can only be 0 or 1.
  In a narrow tile the matrix keeps readable columns: the totals, the groups' dendrogram and then the legend's width give way first, the status strip names what was hidden, the toolbar no longer covers the gene labels, and legend titles wrap and keep their full text in hover. The user guide lists where it differs from scanpy's dot plot and matrix plot.
- **Cell Count Plot**, a new panel, counts cells per group of a Cell Grouping or obs column, as bars (with labels, sorting, reversal, horizontal bars and a log scale; a Color by **Stacked**, **Side by side** or **Filled**, and in a histogram **Overlaid** and **Filled**, with an arrangement that does not apply greyed out and its reason; a number as X makes the plot a **Histogram**, **Bar** stays available for its bins as categories, Histogram is greyed out for a categorical X with "Histogram needs a numeric axis.", and a link saved as a Histogram of categories opens as a Bar and says so; a pie's printed numbers sit at one distance from the centre, the middle of a ring's band, so **Ring** moves none, and a slice under 3% shows its number in its hover only; a pie's slices can show their names, with the numbers or alone, with **Names** beside **Ring**; its legend now draws, following Plot Options; and bins of a number are coloured by their value on a continuous colour map with a colour bar and Min and Max boxes, by default, while **Slice colors** in **Display ▾** keeps the level palette) or as densities: a curve for each level, or a 2D density drawn in layers you combine in Plot Options: **Density as opacity** (an image; **Density as color scale** for one group), **Isolines** and **Filled isolines**, with the bandwidth and range stated. With a **Color by** (up to 8 levels) the default is filled isolines with lines, each level's color in bands of steady opacity that step up with the density, on one set of levels shared by all groups; a 2D histogram draws each level as its color made more opaque where it has more cells, on one scale. A 2D density of one group is drawn with a color map you choose (map, direction and range) and a color bar. A fourth layer, **Cell points**, draws each cell as a point at its place, in its level's color (or on the color map for one group) with the density there as its opacity; it combines with the others, takes its size and opacity (1 by default, with or without a Color by) from the **Display ▾** pop-over, which replaces **Color ▾** and also holds the density range (**Min** and **Max**, mapping the opacity, the isoline levels and the points alike), takes a Cell Grouping, an obs column or a binned number as its Color by, and draws a seeded sample of 1,000,000 cells above that, which the strip says with the number of points actually drawn; with more than 25,000,000 cells it asks for a subset. A link saved with the earlier *As an image* or *contours* setting opens with the matching layers. **Venn** and **UpSet** compare sets taken from a cell table, a boolean column, levels of a column, a condition on a number, or a group of a grouping. They show exclusive intersections, the top 40 and a minimum size, and say "Group changed", with **Keep**, when a grouping's bins move. Each set is one compact line, as in Cell Grouping: a colour swatch (the Venn, the UpSet's set-size bars and the list share it), the letter (which opens the set's definition), the name (renamed in place), its cells, its share and **Remove**. The Venn labels each circle with its set's name, with **Labels** (count and share, count, share or none), **Names** and **Area reflects counts** beside the set list: the last draws each circle's area in proportion to its set and each overlap's to the cells in both (exact for two sets, an approximation for three, with its largest error stated under the plot when it is large), and a link made before them draws as it did; and an UpSet's bars are one colour until **Count** colours them by count (**None** is the default). Every limit is explained before counting, with the button that fixes it (**Bin it**, **Choose levels**, **Remove Color by**, **Show as Bar**). Long counts show a progress bar, and the plot states how many cells were counted and why any were left out. **Save as grouping** on the toolbar turns the plot's bars into a Cell Grouping, and **Download CSV** gives the numbers plotted. **Choose levels**, the binning line and a new **Color ▾** (colour map, Reverse, Min, Max, Center and the palette of a Color by's levels) open in pop-overs that never resize the panel, and **Escape** closes them. **Log count axis**, **Ring** and the density row sit in the control grid. In a histogram and a 2D histogram, **Bins drawn** in the binning control draws each bin at the same width (**Evenly**, with the ticks at the bin borders labelled by the edge values) or at its values; log, equal-count and manual bins start on Evenly, equal-width bins on At their values. **Escape** closes the binning control. **3D** on the toolbar draws a 2D histogram, a heatmap or a bar plot with a Color by as 3D bars, coloured as in 2D, with a **3D height** of its own (**Same as Color**, or a count, a share or a statistic), a camera that is kept in links without an undo step and reset in the toolbar, a **3D** section in Plot Options, and the same bar limit as the Cell-Gene Plot's (the cost limit `bars_3d_max`); SVG export is greyed out in 3D.
- The Cell-Gene Plot and the Cell Count Plot share one **Plot Options** pop-over and one toolbar row under their controls, the plot's own buttons first and **Undo** and **Plot Options** at its right end, each with its own defaults: **Presets** (Default, Publication, Bare), **Text** (font, size, colour, plot title and its size), **Background**, **Axes** (grid lines, off by default in the Cell-Gene Plot and on in the Cell Count Plot, their colour and width, axis lines and tick marks, and in a Cell Count Plot axis titles, tick labels, zero lines and the number of ticks), **Legend**, **Margins**, **Export** (PNG, SVG, JPEG and WEBP at the size on screen or one you set, at twice the pixels unless **2x resolution** is off, and **Download CSV**) and **Apply** (**Apply to other** Cell-Gene or Cell Count **plots**, and the session default), with the plot's own sections between them. The legend gets a **Space**, **Columns** and **Entries, at most** (20 in the Cell-Gene Plot's strip legends, 25 in a Cell Count Plot): past it, the legend lists the first entries and "+ 12 more", while every level is still drawn. A Cell Count Plot's legend can also sit at the bottom, top or left, without its title, and with a gap of your choice between columns. Each section has a **Reset**, and only the options that apply to the plot are shown. A plot made from the panel chooser follows the session default until its look is changed.
- Search in the dataset browser now also finds datasets by their field names: obs and var columns, layers, embeddings and uns keys. The index is rebuilt once after upgrading, and remote datasets are not crawled.
- For these panels the server gains `POST /data/cell_groups`. It computes groupings, counts and per-group statistics in one request. It refuses an oversized request up front, for example a grouping certain to pass the group limit, a range too wide for a number, or too many thresholds or measures. It queues behind long jobs and tells the page its place in line. A grouping is computed once per server worker and reused by every panel that uses it, so later plots on the same grouping skip the roughly 3.4 s it takes to group 100 million cells. Two settings bound its memory: `compute_budget_mb` (default 4608) and `group_code_cache_mb` (default 512).
- **Colours of a grouping.** A factor's **Edit ▾** pop-over and the grouping's **Settings** have a **Colors** section: choose a palette, set the colour of a level or a group from its swatch (a group's colour is kept under its name, and applies whenever a group of that name exists), colour the groups of several factors by one of them, and reset. A grouping's colours are now the same in the group list, a Cell Plot, the Cell-Gene strips and a Cell Count Plot split by it, and a colour change asks nothing of the server. Dataset colours in `uns` are used when there are at least as many as categories, as scanpy does (before, only exactly as many).
- **Min and Max boxes for every scale of the Cell-Gene and Cell Count Plots.** In **Color ▾**, the colour (Min, Max, Center), the size (**Size min** and **Size max**, named by the size statistic, such as "Size min (Fraction of cells)", since it need not be a percentage) and, in 3D, the **Height** (Min and Max, new) each have boxes in one style. A box that is not set says "auto" with the value the plot draws, such as "auto (0.12)", instead of being empty, and each scale has a **↺** button that returns its boxes to auto in one undo step. In 3D, a bar taller than the Height max is drawn at the max, a shorter one at the min, and a bar of 0 stays undrawn. Links keep working: the colour and size limits are stored as before, and a height range is stored as `heightLimits`.
- **Undo for the Cell Table and the Gene Table**, the same button the Cell-Gene, Count and Cell Grouping panels have. Every change to a table's settings is one step (columns, filter, search, rows per page, Methods ▾, Score methods ▾); the table is built again from the settings it had. Browser Back and Forward keep working and start the steps afresh.

- **Every cost limit is a setting**, in the configuration file and on the admin **Settings** page. A new `limits:` section holds when a computation (a gene score, a grouping, a Cell-Gene or Cell Count Plot) asks first (`ask_first_s`, 60 s) and when it is refused (`refuse_s`, 600 s), when edits update live (`live_update_s`, 5 s), when a progress bar appears (`progress_bar_s`, 10 s), the Cell-Gene matrix (`matrix_values`, 400,000) and its genes per section (2,000), the groups of a grouping (`groups`, 2,000), its factors, measures and thresholds, the count plot's grid and axes, the cells for an obsp source, the cells of a grouping's export (1,000,000), the bars of a 3D view (40,000), the rows clustered for a dendrogram (2,000), and the cells a Count Plot's Cell points layer draws (1,000,000, a sample above it) and loads (25,000,000). An admin can change each on the Settings page, under **Limits**, without a restart, and **Reset all** puts them back; a value in the configuration file is a ceiling the admin can lower but not raise. The browser reads the values the server enforces, so a check it makes before asking always uses the server's number, and every refusal names the limit in force. The server limits read per request (panel set quotas, folder listing and search sizes, the description index, the name search's time limit) can now also be changed on the Settings page. The time tiers must keep their order (`live_update_s` ≤ `ask_first_s` ≤ `refuse_s`): the server does not start with a file that breaks it, and the Settings page refuses such a change.

### Changed
- **The Cell-Gene Plot's sections and the Cell Grouping's factors look and behave alike.** Both are cards: position, title, a summary (a section's source and gene count, a factor's kind and levels), a preview (the first genes or levels) and a **⋯** menu. A section's title is no longer a text field: **Rename** in **⋯** edits it in place (✓ saves, Escape cancels, empty restores the source's name), and clicking the card opens its source. Drag a card or use Alt+Up and Alt+Down to reorder, in both panels. In a narrow plot the preview gives way first.
- **A one-row section of the Cell-Gene Plot is the set treated as one gene, with no setting of its own.** Color and Size each show it by a fixed rule for their statistic (the mean of the genes' means, the set's z-score mean score, the sum of the genes' sums, and so on), on the plot's own layer and threshold, and the section's tooltip says the rule. Under **Fraction of cells** the row is the share of cells expressing at least one gene of the set. Genes / One row is a dropdown. The other score methods (control-adjusted, **Fraction of genes**, % of total) are not drawn as Cell-Gene rows. Plots saved with a separate Color or Size choice for a row open on these rules without a notice.
- **Fraction of cells is `c⁺` on the aggregation buttons**, so it is no longer mistaken for `%`, a signature's share of the total.
- **The Cell-Gene Plot's controls are compact.** Color and Size are each a layer and one symbol button that opens the list of statistics (Height the same, in 3D), replacing the statistic dropdown, the word "of" and the threshold box. The **Expressed above** value is in that list and shows on the button when the measure has its own (`>1`). Groups, Mode, Color, Size, Scale and **Add genes** share the first line, so the control area is about 10% shorter at a wide window and 25% at a narrow one. Stored settings are unchanged.
- **The Layers, obsp and varp tabs of the Cell Table and the Gene Table list only the columns you ticked, with one add row.** The row is an item (the focused gene or cell, one fixed in a plot, or one the table holds) and a layer or matrix, then **Add column**; it starts on the focused item and X. The ticked columns are grouped under their layer. The search field filters the ticked rows and the item list. The old tab listed every layer for every item, so it grew by a block per layer. Stored columns and old links are unchanged.
- **A Cell Table's Gene score tab adds a column with a layer and an aggregation button.** The method dropdown and the word "on" are replaced by the same symbol button the plot axes use, listing each method as a symbol and a name (a method a layer cannot give is greyed, with the reason). A ticked column shows its method's symbol before its name. Columns are stored and shown as before.
- **Cell Plot and Gene Plot: Plot Options, toolbar and Undo as in the new panels.** Their buttons are one row under the controls, as in the Cell-Gene and Cell Count Plots: **3D** (it read *3D Plot*), **Equal aspect**, the focused-entity highlight and **Refresh** first, then a new **Undo** and **Plot Options** at the right end. **Undo** (also Ctrl+Z, Cmd+Z on a Mac) takes back the plot's last change (axes, colour, filters, point size, an option, 3D) and draws it as a link of that state would; zooming is not a change. **Plot Options** opens over the plot without moving the panel and closes with Escape or a click outside. Its groups are in the same order as the new panels' (Text now second), each with a **Reset** for its own options, and it has **Copy** beside the image formats, as do the Cell-Gene and Cell Count Plots. The **point size** moved from the controls into **Plot Options ▸ Points**. Links keep every setting they had. A long Plot Options pop-over now scrolls (it jumped back to its top), and an image or CSV download no longer closes it. Every pop-over shares one look: the same section headings, rows, help text and one **Reset** per section. **Open Sans** is now the default font of every plot (it ships with the app, so it looks the same on every machine, and is inside exported SVG and PNG images), with the same list of fonts on every plot; **Publication** still sets Arial, and a Cell, Gene or Cell-Gene plot saved with no font keeps drawing in Arial.
- The **Add New Panel** tile takes the height its pane gives it and scrolls its choices inside, so opening one no longer grows or pushes the layout.
- Scripts, styles, fonts and images carry the version in their URL, so after an upgrade the browser asks for the new files even behind a caching proxy or CDN. Module scripts are revalidated on every load instead.
- **Deleting a closed panel that is in use asks first.** In the panel menu, the × of a closed panel that another panel uses (a signature coloring a plot, a table filtering one) turns into **Delete?** with the question under it, such as "Delete 'T cell score'? 1 plot uses it."; press it again to delete. Escape, moving away or a few seconds put it back. A closed panel nothing uses is deleted on the first press, as before.
- **Share Link** now says so when the link it copied is long (over 8,000 characters, about 1,200 gene symbols in a signature): a note under the button gives its length and suggests saving a panel set to share a large gene list. The link is copied either way. A link that holds thousands of genes is long (about 29,000 characters at 5,000 gene symbols, 106,000 at 20,000).
- The automatic dot size in 3D plots is 60% of what it was, so a 3D scatter is no longer a solid mass at moderate cell counts. Only the automatic size changes: a size you set, or one in a link or panel set, stays, and 2D plots and opacity are as before. The greyed-out points of a table link in 3D follow it.
- A new Cell Plot opens with **Equal aspect** on when its axes are the automatic default, both taken from one embedding (UMAP, t-SNE, PCA or spatial coordinates), so the embedding keeps its shape at any window size. Switch it off with the button; your choice is kept in the plot's links, panel sets and sessions. A plot whose axes you or a link chose, a link made before this change, and a plot whose axes come from obs columns open as they did, and changing the axes later never flips the button.
- Closed panels of every type now come back when you open a share link or load a panel set, and when you step Back or Forward. Before, a link listed them but opened none, so a plot filtered by a closed table quietly lost its filter. Only the configuration is saved (a table's columns, filter conditions, search text and search toggles), never its rows. A plot filtered by a restored closed table keeps the table selected, draws no points until the filter is built, and says "Filter not applied yet" in a notice over the plot and a tag in its strip. Large plots still draw every cell, as they never apply table filters.
- A table's regular expression, smart search and case-sensitive buttons are now saved with the panel, so a link, a panel set or a reopened table selects the same rows. Older links and panel sets open as before.
- Opening a share link or loading a panel set now says what is loading from the first moment. Each panel of the view appears at once as a named tile ("Cell plot · UMAP · coloured by cell_type") with a status line, and the dataset bar shows one line such as "Opening link: pbmc.zarr, 4 panels (2 ready)" that goes away when everything is drawn. Before, the page showed the generic welcome tile until the dataset had opened, which on a slow disk could be many seconds. The line is announced politely to screen readers, and a panel is marked busy until it is drawn.
- The Load Panel Set dialog now closes as soon as you press Load, so the page, the header and the dataset browser stay usable while the set loads; the load is shown in the page. A refusal after that is a notice instead of a line in the dialog.
- While you switch dataset, the panels that are open are dimmed with a "Switching to …" note and stay usable; the loading box on a panel names the step ("Reading coordinates…", "Drawing…", "Recolouring…") instead of always saying "Loading axis data…".
- A plot filtered by a closed table now gets that table's filter by itself. When the table was restored from a link, a panel set or a step Back or Forward, or the cells changed (a subset, another part), the page builds the filter in the background, one table at a time and only for a plot that is on the page, and the plot draws the moment it is ready; nothing needs to be opened. The build uses only the columns the filter needs, runs the same filter as the open table, and keeps just the names that pass. Up to 200,000 rows it starts at once; from there to 1,000,000 rows the plot offers a "Build filter" button, because building holds the page for a few seconds; above that it says the table is too large and offers Open table. If the browser is short of memory nothing is loaded and the plot says why. Opening the table while it builds ends the build, and the plot waits for the opened table and updates once. A table that depends on itself, through a hand-edited link, is named in the plot instead of waiting for ever. Large plots still apply no table filter and build nothing.
- While a closed table's filter is building, the plot offers Cancel, which stops the loading and returns to "Build filter"; the last short step, which filters and releases the rows, cannot be stopped and the notice says so. Gene Set Analysis now builds a restored closed source table in the same way and says the same things, instead of asking you to reopen it.
- **A long computation shows a progress bar.** When a gene score (in a plot or a table column) is estimated to take more than 10 seconds, or has been running for 10 seconds, its notice gets a bar under the sentence, which fills as the server reads the stored values, with the time left once it is known ("Computing 'T cell score': 61 of 200 genes · about 3 minutes left"). A score waiting for other computations on the server says its place in line ("Waiting for the server: 1 computation ahead.") with a moving bar instead, never a made-up percentage. Shorter computations keep the line of text as before. The bar is announced to screen readers with its sentence, follows the light and dark themes, and stands still when your system asks for reduced motion. A score that could not start because the server stayed busy now says so in plain words, with **Retry**.
- **Refresh dataset keeps each plot's zoom**, and Cell and Gene Plots no longer have a Refresh button of their own. A plot now always draws what a plot opened from the same settings draws, whatever you changed before (a test holds every plot to that), so there is nothing to refresh; to read values written to the store since, use **Refresh dataset**, which re-reads the dataset and keeps every plot's zoom and 3D camera, also in the link and the autosave.
- **Refresh always reads the dataset again.** The header **Refresh** now makes the server drop everything it remembered of the dataset (a gene's values, scores, group results, name search, dataset details), in every worker, whether or not it found a change. Before, a chunk file overwritten in place, with the same name, on a large store or on a network file system, kept being served from memory until an admin cleared the server cache. A store too large to check file by file now says "Large dataset refreshed": AnnZarro cannot tell whether it changed, so it read it again. Refresh is still limited to one check per dataset every `server.refresh_min_interval_s` seconds, and still open to every user who can read the dataset; clearing the whole server cache stays an admin action. On a shared server, a user who is not an admin can refresh a dataset of more than 10 million cells (`limits.refresh_large_cells`) once a minute (`limits.refresh_min_interval_large_s`, 60 s): a Refresh sooner waits for the end of the minute and the app says when it runs. Both limits are on the admin Settings page.
- **A Cell Count Plot refused for a size limit offers ways out.** When a plot has more Color by levels or bins than its view takes, its notice now has buttons that each make one ordinary, undoable edit and only appear when the result would draw (at most three): **Split by another column ▾** opens the Color by column list with the columns that are over the limit greyed and showing their number of levels ("sample: 30 levels, at most 8"), **Switch to Bar** for a 2D histogram, 2D density, histogram or density whose Color by a Bar can take, and **Fewer bins**, which sets the bins to the most the view takes. The status line says what each did. A limit the page could not know beforehand (the Color by's levels were not counted until the server answered) is now a refusal that names its count and limit and offers the same buttons, instead of "could not be computed" with Retry. Nothing changes by itself, and there is no Try anyway on these notices: a size limit cannot be tried.
- **A Cell-Gene Plot over its matrix limit offers ways out.** A plot of more than 400,000 matrix cells (`limits.matrix_values`) now has buttons for the edits that would make it draw: **Show <section> as one row** and **Remove <section>**, each one undoable step and offered only when the plot would then fit, and **Open grouping** when its groups are a grouping. A section over the genes a section draws (`limits.genes_per_section`) has **Show as one row** on its card when its Color and Size read it as a score (z-score mean, **Fraction of cells**, count). A Cell Count Plot whose grid the server refused for its number of cells offers **Fewer bins** when the bins can make it fit, and otherwise says how many cells it would count and what the limit is. Also fixed: Undo of a removed Cell-Gene section, when the sections share their genes, could draw the larger plot the matrix limit had refused.

### Fixed
- **A Cell-Gene Plot refused for time no longer offers a layout it already has.** On a layer already stored by gene (CSC) the notice says "Use fewer genes or a smaller subset.", not "…or a layer stored by gene (CSC)". When a plot's drawing is replaced by a notice, the strip under it no longer keeps the old drawing's cell count: it shows no count, only its state tag, until the new drawing arrives.
- **No blank band above a Cell or Gene Plot's plot box.** The default top margin is 30 px, not 80: the 80 was room for the modebar, which now sits over the plot area. The plot is 50 px taller, a legend beside it starts higher, and with Equal aspect the x range is a little narrower. A plot saved with the old default margins follows the new default; margins you chose stay. A title, a legend above the plot and the coverage note of an export add the room they need.
- **The plot toolbar no longer covers data.** It sits in the strip above the axes (right-aligned) when the top margin has room for it, and in the axes' corner only when the margin is thinner than the toolbar or a legend or colour bar placed on top takes the strip.
- **Small fixes from the tutorials.** In a Cell-Gene Plot on an obs axis, **Expressed above** set to 0 is the default: the button loses its `>0` suffix (on a grouping axis 0 stays an override of the grouping's threshold). In a narrow control column, the grouping and group selects of a Gene Plot row wrap and keep a readable width instead of shrinking to their arrows. A Cell Grouping's cross-table columns are as wide as their names (up to a limit), so default bin names are no longer cut to the same text. A filter that waits for a group statistic says "the group statistic '…' is not ready", not "the score". A superseded layer, obsm, varm, obsp or varp request no longer logs an AbortError as a console error.
- **A grouping that nests too deep, or reads a table of too many cells, says so.** The plot's notice called both "too large to compute here". It now says "'Grouping 1' nests groupings 5 deep; a grouping can use groupings at most 4 deep" or "reads a cell table of 12,000,000 cells; a cell table lists up to 1,000,000", with the way out.
- **A Cell Count Plot refused for too many categories says which input and which cap.** Color by a large Cell Grouping in a 2D histogram or a 2D density now reads "Color by Grouping 1 has 30 levels; 2D histogram colors up to 8." (the same sentence the plot gives for a column), where it said "'Count 1' has a factor with 30 levels: a factor holds up to 8".
- **A refusal names the limit that refused it.** A plot whose grouping had more groups or levels than the limit allows said "would take about 1 second, so it was not run": the notice quoted the cheap estimate made before the refusal. It now says what the server said, for example "'Grouping 1' has a factor with 2,001 levels: a factor holds up to 2,000, so it was not computed". A duration is given only for a refusal by cost, and only when the estimate is over the refuse limit.
- **Renaming a Cell-Gene section works again.** **⋯ ▸ Rename** (or a double click on the title) opens the editor and keeps it open until you save or cancel; it used to close at once, and a redraw of the list (a signature gaining a gene) used to take it away with the text typed so far. Clicking a section still opens its source, after the double-click interval.
- **The Cell-Gene Plot redraws when a change leaves everything it needs already loaded.** Switching a one-row section to genes under a statistic list that changed could leave the old rows on screen. A card's title is now the last thing to be cut in a narrow plot: the genes and the summary give way first.
- **The Cell-Gene Plot's legend shows every level its Entries, at most allows.** A colour strip's legend was also cut by the height of the legend column, so a 17-level category with the limit at 100 listed 7 and said "+ 10 more". The legend now takes the legend column's height first and then wraps into more columns where the width allows; only what the limit or the room cannot hold is counted in the last "+ n more" line. A label cut to fit a column shows in full on hover.
- A Gene Plot no longer ignores changes made after you change the subset of cells: point size, colour range, flipped axes and the like apply again.
- Cell and Gene Plots now look the same after a run of changes as when opened from their link: no colour bar left behind when colour goes back to none, the log colour scale's labels kept when you colour by a gene score, the plot's points and names back to normal when a table filter is turned off, the same margins after Hide NaN, a point size change or a moved focus, and a legend below the plot in the same place.
- **Refresh after a column was added on disk without re-consolidating** no longer loses the gene names. The store was read without its stale `.zmetadata`, but only its top group was; `var` and the other groups still read their own empty listing, so `/data/genes` answered `[]` and a Gene Plot said the dataset reported no gene names. Every group is read from its own files now, the new column shows, and nothing is written to your store.
- A filter from a link or panel set that names a value the cells shown don't have now keeps that value and shows no rows, instead of being dropped and showing every row.
- A panel set loaded while the page was still starting could open as closed, undrawn panels; loading now waits until the page is ready.
- `annzarro export` no longer captures a plot while its automatic point size or opacity is still being applied, so exporting the same view twice gives the same figure. Before, an export could be taken a moment early, with the dots a little smaller or larger than in the finished plot (for example 4.7 instead of 5.1).
- Closing a Cell Table or Gene Table, or loading it again for other cells, now gives its memory back. Before, each close left about 65 MB behind per 100,000 rows, so opening and closing tables over a session slowly filled the browser. After many opens and closes the page now returns to within a few megabytes of where it started.
- A plot filtered by a table that no cell passes now shows "No cells pass 'Table 1'." with Open table and Stop filtering, whether the other cells are greyed or removed, and draws again by itself when the table passes cells. Before, after narrowing a table from some rows to none, the plot kept drawing the excluded cells in the colour of cells that pass.
- Opening another dataset while a link or panel set was still opening no longer builds that link's panels on the dataset you just chose. Your choice wins and the other load stops.
- A large plot (more cells than the large-plot limit) with a flipped axis no longer loses its zoom when you change the colour map or any other setting, or when you open a link made from the zoomed view: it keeps the view you chose, as the regular plot does. Double-clicking still returns to the fitted view.
- Turning the legend off in a legend of two or more columns hides every column, not only the first, together with the title above them and the room kept for them, so the plot takes the width back; turning it on again brings the same columns, gap, title and position back. A saved panel or link with the legend off and several columns opens with no legend, and a large plot (more cells than the large-plot limit) now honours Show Legend off, colour bar included, which it ignored.

### Upgrade notes
- A server whose configuration sets its own `ui.enabled_panel_types` list does not offer the four new panels until you add `gene-signature`, `cell-grouping`, `cell-gene` and `cell-count` to it (the list only shapes the "Create New Panel" chooser; it does not switch a type off). With the default list they are offered at once, and an administrator can switch each off with `panel.gene-signature.enabled`, `panel.cell-grouping.enabled`, `panel.cell-gene.enabled` and `panel.cell-count.enabled`.
- No setting moves. A configuration file that sets nothing under `limits:` keeps every limit as before. `server.read_user_share_percent` and `server.subset_wait_s` are now shown as read when the server starts (as they always were) and stay settings of the configuration file; so does `server.name_search_max_regex_chars`, a bound on what a search parses rather than a cost; the other `server.*` limits that are read per request can now be changed by an admin, and an admin value wins over the file until it is reset.

### Docs
- User-guide pages for Cell Grouping, the Cell-Gene Plot (with its differences from scanpy) and the Cell Count Plot; the full HTTP reference of `POST /data/cell_groups`; and the memory a server worker holds for these computations.
- The README and the licence page cite v0.7.6 by its DOI,
  [10.5281/zenodo.23753517](https://doi.org/10.5281/zenodo.23753517).

## 0.7.6 (2026-10-28)

### Added
- Zoom, pan and a turned 3D camera are part of the view: each gesture (a box zoom, a modebar zoom or reset, a drag pan, a run of scroll-wheel zooms, a rotation) is one step of Back and Forward, which move the plot with one relayout, without redrawing it or asking for its data again. Ranges are rounded to four digits of the axis span, so the address does not change by float noise; a plot that is not zoomed stores nothing, and links without a zoom open as before.
- **C** over a plot now copies its view, with or without a point under the pointer: the range of each axis and, in 3D, the camera. Over a point it also copies the hover text as before; elsewhere on the plot (its area, axes, modebar or legend) it copies a one-line description of the view and says "View copied". Paste with Ctrl+V (Cmd+V on a Mac) over another panel of the same dataset, also in another tab, and that panel takes the same view where it shows the same coordinates (an x axis showing UMAP 1 lands on whichever axis shows UMAP 1; other axes keep their range). Pasting elsewhere only focuses the copied cell or gene as before (a view copied with no point has none, and says so), and pasting into another application gives only the text.

### Changed
- Back and Forward over a single panel opening or closing, or a split moving, animate as those actions do by hand (any other step switches straight to the recorded view), and quick actions are separate steps: each Back lands exactly on the view it recorded, or, if a smooth step is not safe, on a hard rebuild of it.

### Fixed
- A 2D plot uses one WebGL context, not two. Safari allows about 16 at once and keeps a released one in its count until it is cleaned up, so after a few panels were opened and closed the plots already on screen went blank or the page restarted. Plots draw and behave as before.
- Back and Forward no longer reload the page when AnnZarro is busy drawing large plots. A step that took more than a second to be handled reloaded the page, which could leave the panels closed with "Did not finish loading".

### Docs
- The README and the licence page cite v0.7.5 by its DOI,
  [10.5281/zenodo.23587867](https://doi.org/10.5281/zenodo.23587867).

## 0.7.5 (2026-10-23)

### Fixed
- The Windows desktop app builds again, and a Git checkout on Windows installs again. Git turned the line endings of the bundled Plotly file into Windows ones, so its checksum no longer matched and the build refused it. 0.7.4 was therefore released on PyPI only, with no desktop apps; 0.7.5 is 0.7.4 with this fix.

## 0.7.4 (2026-10-22)

### Added
- The browser's Back and Forward buttons undo and redo what you changed, as in a map, instead of leaving AnnZarro: each change (closing a panel, a setting, the focused cell or gene, another dataset) is a step, changes made in one go (a slider drag, clicking a number box's arrows, typing) are one step, and only the panels a step changes are redrawn (opening or closing a panel, or moving a split, leaves the other plots as they are). Back from the first view still goes to the page before AnnZarro.
- Paste a cell or gene name: press Ctrl+V (Cmd+V on a Mac) on the page, outside a text box, and the copied name becomes the focused cell or gene in the open dataset. An administrator can add rules that read other text, such as a table row copied from another platform that also names the dataset (AnnZarro asks before it opens another dataset). The rules are the settings `ui.paste_focus.enabled` and `ui.paste_focus.rules`, edited on the admin Settings page with a test box; see the admin guide.
- The desktop app's About dialog shows the Fred Hutch Cancer Center logo with the AnnZarro sign post, as Fred Hutch's brand team supplied it; the Setty Lab logo moves lower, beside the funding statement. In the dark theme the logo sits on a white plate. Every other copy of AnnZarro keeps the text credit, because the logo is Fred Hutch's trademark. The new `site.fred_hutch_logo` setting (default `false`, on the admin Public site page, `ANNZARRO_SITE_FRED_HUTCH_LOGO`) shows it. The Fred Hutch name and logo are trademarks of Fred Hutchinson Cancer Center and are not covered by the MIT license; see `TRADEMARKS.md`.
- Plot Options > Legend and colour bar: **Title size** and **Title gap** set the size of the legend title and its distance to the first entry. They are saved with the panel, in links and in panel sets, and copied by Apply to other panels.

### Changed
- The plots use Plotly.js 2.35.3 (was 2.20.0), trimmed to the plot types AnnZarro uses, so the bundled file is about half the size of the full 2.35 file and smaller than 2.20's. Plots look and behave as they did; the upstream release notes list fixes for scattergl zooming, legends and hover.
- Plot Options > Legend: **Title align** sets where the legend title sits: at the markers, at the labels, centred or at the right, across all the columns of a legend in columns. Auto (the default) centres the title over a legend above or below the plot and puts it at the markers beside it; the title used to start at the labels. It is saved with the panel and in links, and copied by Apply to other panels.

### Fixed
- A large plot whose data could not be loaded, for example because the browser ran out of memory (Safari reported only "Load failed"), now says so, names how many other plots are open and offers Try again, Half the cells, Subset and Close other plots.
- Legend columns (Plot Options > Legend) are real columns: side by side next to the plot, in order, each as wide as its labels, whatever their length. Two columns of long labels used to stay one column. The columns take at most 60 % of the width of the graph (longer labels are cut short with an ellipsis), keep working with click and double click to hide and isolate a category, and are whole in exported images. The new **Column gap** sets the space between them (default 24 px).
- The legend title is no longer cut off at the top at a small **Title gap** (1 to 20 px or so); every gap from 0 up shows the whole title, and is that many pixels.
- Going back to the app from the admin or account pages, by their "Back to" link or the browser's Back button, shows the panels you left. The link used to open a blank start page, and Back could do the same when you left while panels were still drawing (large datasets).
- Plot Options: the arrows of an empty number box (legend title size and gap, dot size, columns, tick counts) step from the default the box shows, by one, instead of jumping to the lowest value. The legend **Title gap** is a true pixel distance (0 to 80 px, every value different) instead of a blank line.
- An exported image (SVG or PNG) holds the whole legend. A legend longer than the plot was cut off in the image; the image is now taller where the legend needs it.
- The first click on an arrow of a number box in Plot Options (legend columns, dot size, text size) no longer moves the menu instead of stepping the value. The menu now keeps its place when a group opens, and a click in a box no longer re-applies its option.
- Copying text works on a server reached over plain `http://` (a cluster node, for example): **C** over a point, **Share Link**, **Copy citation**, copying gene ids and names, and the admin password copy no longer need `https` or `localhost`. Only copying a plot as an image still does, and its message says so and points to Download. "Not copied" now appears only when the browser refused both ways.

## 0.7.3 (2026-10-22)

### Added
- `annzarro --version` prints the installed version (`annzarro 0.7.3`) and exits.
- The Server health page shows the version the server runs and, when PyPI lists a newer release, one line to say so with the upgrade command (`pip install -U annzarro`) and a link to the release notes. The server asks PyPI (`GET /api/v1/admin/version-check`) only when an administrator opens the page, at most once in six hours per process, and ignores pre-releases and any failure. Set `server.update_check: false` for a server that must not make outbound requests. The desktop app never asks; it has its own updater.
- The Server health page has a **Description search** block: whether the search is on, the state of its index (building, up to date, not complete, failed), how many datasets are searchable, not searched yet and unreadable, when it was last built, and **Rebuild now**, which crawls at once (audited as `text_index.rebuild`). The refresh interval stays a setting, `server.text_index_ttl_s`.
- `GET /api/v1/datasets/text-search` takes `offset` and `current`, and answers `more`: how many matches follow the page.

### Changed
- The server builds the description index by itself and keeps it fresh. A few seconds after it starts (15 s) it crawls the datasets in the background, continues a crawl that stopped partway (for time, or because datasets did not answer) until every dataset is read, and reads again for changes once the index is older than `server.text_index_ttl_s`, now 30 minutes (was 10). One crawl runs at a time across all workers; none runs while the search is off. A search never starts a crawl. Nothing needs to be set up, on a server or in the desktop app.
- The line under the dataset browser's search appears only while datasets are not searched yet: **Descriptions of 120 of 3,400 datasets searched so far** (a user limited to some folders is told that some datasets are not searched yet, without counts), and is gone once all are. It is not polled: the next search shows the newer state. The progress bar is gone.
- A dataset with neither a README nor an attribution is no longer opened by the crawl: a few `stat` calls tell there is nothing to read, and it is found by its name only. A dataset that has not changed costs the same few calls on every round.
- A crawl writes one line to the server log at INFO when it starts and one when it ends: how many datasets it found, read, kept unchanged and could not read (and how many timed out), how long it took, and why it stopped when it is partial.
- A dataset that takes longer than `server.text_index_store_timeout_s` no longer costs the crawl a reader thread: a spare thread reads the next dataset, and the late dataset's text is kept if it arrives before the crawl ends. Late reads that have not answered count against the spare threads of the whole server process, across crawls, so a dataset that never answers cannot make each new crawl leave more threads behind. The default limit per dataset is now 15 s (was 5 s).

### Removed
- The description index can no longer be started by users. **Refresh** in the dataset browser leaves it alone, and `POST /api/v1/datasets/text-index/refresh` and `GET /api/v1/datasets/text-index/status` are gone (404). An administrator rebuilds it on the Server health page.
- Three `server.*` settings of 0.7.2: `text_index_background` (the server always keeps the index fresh; turn the search off with `server.text_index_enabled` or the Settings page), `text_index_crawl_timeout_s` (a long crawl is continued) and `text_index_min_interval_s` (a search no longer starts a crawl). A configuration file that still sets one keeps working: the server and `annzarro config validate` warn that it is no longer used, and ignore the value.

### Fixed
- In the dataset browser, the description hit for the dataset you have open now comes first, and when there are more matches than the server returns, **N more** under the hits loads the next ones. Before, a dataset past the server's limit of 50 could not be reached.
- The description search indexes datasets on a networked filesystem. Each dataset's attribution and README are now read from the files under `uns`, not through its consolidated metadata. Before, a read first checked that listing against every metadata file of the dataset, which was about 94% of the read time: 13 to 15 s for a dataset with about 2,500 metadata files, measured over a network filesystem. Those datasets passed the 5 s limit per dataset, so the crawl marked them timed out and stopped after the first few. A dataset is read again when `uns`, `uns/annzarro` or `uns/README` changes on disk: `annzarro annotate`, re-consolidating, or adding an attribution field (even without consolidating) is picked up. A value rewritten in place under an existing field is not, until the dataset is annotated or re-consolidated; that limit predates this release.
- In the dataset browser, the **Matches this view** button (now **Like this view's dataset**) no longer hides the results of a description search. The button narrows the table to datasets with the same cells and genes, the same size or the same name as the dataset the view was made on. It is on at first when you choose a dataset for a view that has none. Description hits never carried that match, so while the button was on every hit was hidden, the matching ones too. Hits now carry their **same cells and genes** (or **same size**, **same name**) tag and are shown whether or not the button is on; the other filters still apply to them. The button's tooltip says what it keeps.

### Docs
- The README and the licence page cite v0.7.2 by its DOI,
  [10.5281/zenodo.23547580](https://doi.org/10.5281/zenodo.23547580).

## 0.7.2 (2026-10-21)

### Added
- The dataset browser searches what datasets say about themselves. A **Descriptions** button beside the regular-expression switch (on by default, **Alt+D** toggles it) adds a section, **Found in titles, attribution and READMEs**, below the name matches: each dataset whose title, attribution or README holds your words, with its title and the words in context, marked. A hit opens like any row and its README opens on the first match. A line under the field says how fresh the search is and shows progress while the server builds it; **Refresh** asks for a rebuild. Administrators can turn it off (hidden then), and users see only datasets they can open.
- Administrators can switch the description search off. The server can now search the attribution and README of the datasets it holds (`GET /api/v1/datasets/text-search`). The policy key `datasets.text-search.enabled` is on by default and can be turned off for everyone or for one user in the Settings page, and `server.text_index_enabled: false` in the configuration file turns it off and stops the crawl. The server reads each local dataset's attribution and the first 64 KB of its README into one shared index in the cache directory, one crawl at a time, refreshed after 10 minutes; remote datasets are not indexed. Users see only datasets they can open. New `server.text_index_*` limits are in the resource-limits guide.
- Where annzarro keeps its state is now one setting. `server.state_dir` (`--state-dir`, `ANNZARRO_SERVER_STATE_DIR`, or the older `ANNZARRO_HOME`) holds the log, PID file, users file and caches; `server.cache_dir` and `server.panel_sets_dir` default to folders inside it. `annzarro stop` also takes `--state-dir` and `--config`. When one of these folders lies inside a data directory the server still starts, logs a warning naming it, shows it on the admin Health page and in `annzarro paths`, and leaves it out of dataset listings. The new `annzarro paths` command prints every location and why it is there (flag, environment variable, configuration key or default). The default stays `~/.annzarro`.
- Press **C** while a point's hover label shows to copy it as plain text: the name and each `label: value` line, including the Hover columns. Works in 2D, 3D and large-plot plots; with no label showing, **C** does nothing.

### Changed
- Toggle a panel's controls with **T** (was **C**, which now only copies the hover label).
- Panel sets are saved in `<state_dir>/panel-sets` (or `server.panel_sets_dir`) instead of `<data_dir>/sessions`, so a data directory can be read-only. Nothing moves by itself: a server that already has panel sets in `<data_dir>/sessions`, and has not set `server.panel_sets_dir`, keeps using that folder and says so in its log, on the admin Health page and in `annzarro paths`. `annzarro panel-sets migrate [--dry-run]` copies them to the new folder, checks every copy byte for byte, overwrites nothing and deletes nothing; from then on the server uses the new folder. The admin Health page shows where panel sets are kept, and flags a legacy location with the hint to migrate.
- The desktop app no longer creates `datasets/` and `sessions/` in `~/annzarro-data`: the data folder is the datasets folder itself, and the app only reads it. The app writes its state (saved panel sets, server log, caches) to a `state` folder in its own profile (macOS `~/Library/Application Support/AnnZarro/state`), passed to the server as `--state-dir`. An install whose panel sets are in `~/annzarro-data/sessions` keeps using them; once per launch the app offers to copy them (**Copy now**, **Not now**, **Don't ask again**), which deletes nothing. A `datasets` folder from an earlier version is still listed.
- Hosted installs: the shipped `site.example.yaml`, `setup_production.sh` and `annzarro.service` keep state in `/var/lib/annzarro` (systemd `StateDirectory=`, `CacheDirectory=` and `LogsDirectory=`) and no longer make the data directory writable. When `server.state_dir` or `server.cache_dir` is not set by a flag, an environment variable or a configuration file, AnnZarro uses `$STATE_DIRECTORY` and `$CACHE_DIRECTORY`. The container image reads `/data` directly and keeps everything it writes under `/state`; a `/state` volume from an earlier version keeps its layout (the container goes on serving `/state/data`, so nothing it shows changes) and `annzarro panel-sets migrate` copies its panel sets when you choose.
- Dataset information is ready when you open it: a moment after a dataset opens, once its first plot has been asked for, the About, README and Structure tabs are read in one request while the page is idle, so the dialog shows them without a spinner (a remote store's Structure still loads when you open the tab). The information of a local dataset now carries an `ETag`, so a reload revalidates it with a `304`.
- A `config.yaml` picked up from the directory annzarro is started from is still read, but now logs a warning naming the file: this stops working in 0.8. Name the file with `--config` or `ANNZARRO_CONFIG` instead.
- The dataset browser opens at once on the listings it read before (the data directory and each folder you opened) and reads fresh ones behind them, updating the list in place without losing your search, selection or scroll. A new **Refresh** button reads the folder, the places and Recent again; it shows that it is busy and cannot be clicked meanwhile, and a failed refresh keeps the list with a note. The listings are kept in the browser per server and user (a convenience item, forgotten with the tab on a session-only site).

### Fixed
- The keys **W** (close), **H**, **V** (split) and **T** (toggle controls) act on the panel under the mouse pointer, or else the panel with the keyboard focus. They used to pick the panel nearest the vertical centre of the window, which in a row of panels was always the first.

### Docs
- The README and the licence page cite v0.7.1 by its DOI,
  [10.5281/zenodo.23490614](https://doi.org/10.5281/zenodo.23490614).

## 0.7.1 (2026-10-19)

### Added
- Plot Options, Axes and ticks: **Flip y** and **Flip x** run an axis the other way, for example so y grows downwards as it does in the image of spatial data. The flip is per plot, stays through zoom, Reset axes and double click, works with Equal aspect, the scale bar, large-plot mode and exports, and is kept in sessions, links and panel sets. Apply to other panels, presets and the session default leave it alone. 2D plots only.

### Changed
- Tables no longer print a note under the Advanced Search box listing every column with more than 10,000 distinct values. Equals and Not on such a column still take a typed value instead of a list.

## 0.7.0 (2026-10-19)

### Added
- Plot Options, Apply to other panels: **Make this the session default** makes a plot's look what **Default** means for the session, per plot kind (cell or gene). Plots on Default (made from the chooser, or put back with the Default preset) take it now and follow it when you change or reset it (**Reset to built-in default**); plots with a look of their own, and plots saved before this, keep theirs. A plot saved on Default opens on Default in whatever session it opens in. The default travels with the session: a reload of the tab, the autosave, share links and saved panel sets carry it, and opening a link or a panel set with its panels open makes it yours (Add panels closed does not); Close all with the cache-clearing tick ends it.
- Panel sets: a set with a default style says so on its card (**Style**). A set with no panels can be saved when a session default is set, and is only a style (**Style only**, one **Apply style** button, no dataset): a way to share a house style.
- Line selection in the table panel: the **Line filter** button before a table's search box lets you draw a line on a plot of cells (a cell table) or of genes (a gene table). The side to the right of the line (from the mouse press to the release) is filtered out: the table gets the plot's axis columns, a derived column `y − m·x` and one condition on it, joined to the filter by an outer AND. The line and the shaded side are previewed while you drag, Shift snaps to 45°, Esc stops, 3D and large plots are left alone, and a 2D plot with a text axis shows a small tooltip saying why. While the tool is on, the table has a red frame and a badge in the dataset bar (click it, or press Esc, to stop); closing the table, Close all, loading a panel set or switching dataset also stop it. A derived column leaves the table when no condition uses it any more. Several lines make an area. New tutorial: Cut away part of a plot with a line.

### Changed
- A plot with a table filter set no longer refuses to draw when it goes into large-plot mode: it is drawn whole and the filter is ignored, and the **Large plot** tag says so. The plot keeps its table setting, so the filter applies again when a subset takes it out of large-plot mode.
- Plot Options, Presets: **Default** now resets the whole look that Apply to other panels copies, including Not in table, Focused cell and the export size. It used to leave those three as they were.

### Fixed
- A cell table that showed "not available in large-plot mode" and was then given a subset to list (all cells, then a subset, then all cells, then a subset again) kept the note until you pressed Apply Changes: its previous DataTable, detached from the page by the note, received the new rows. The table now lets that table go when the note replaces it, so it lists the subset's cells by itself.
- In a table's search row, the help of **Regex**, **Smart** and **Case Sensitive** shows just above its own button; it was drawn above the Advanced Search box, out of sight. The row's buttons no longer touch the panel's edges.
- A plot coloured by a number and linked to a table drew the wrong points when the table's filter matched nothing: the cells that had just left the table vanished instead of turning grey, and only a reload corrected it. Every cell now turns grey, and removing the condition brings the colours back.

## 0.6.2 (2026-10-19)

### Added
- Container recipes for hosting a lab server, in `packaging/container/`: a `Dockerfile` (multi-stage, non-root, gunicorn, health check, `remote` extra by build argument), a Compose example with nginx and TLS, and an `annzarro.def` for Apptainer on a cluster. The new page Deployment, Containers gives the commands. A CI job builds the image on pull requests that touch these files.
- `annzarro serve` starts the production server in one command: gunicorn with the bundled configuration, reading the same site file and `ANNZARRO_*` variables as `annzarro start`, with `--config`, `--host`, `--port`, `--workers`, `--threads` and extra gunicorn options after `--`. It prints the URL, workers, threads, whether login is on and the configuration file, and login stays on unless the configuration turns it off. The new `server` extra installs gunicorn: `pip install 'annzarro[server]'`. The explicit gunicorn command still works.
- An optional Prometheus `/metrics` endpoint (`server.metrics_enabled`, off by default): requests and latency by route group, requests in flight, response bytes, dataset cache hits, misses and size, open datasets, memory and the worker's process id, merged across gunicorn workers. Only addresses in `server.metrics_allow` (loopback unless you list others) can read it; everyone else gets the reply of a URL that does not exist.
- `server.log_format: json` (or `ANNZARRO_SERVER_LOG_FORMAT=json`) writes log lines on standard error as JSON, with a request id (also sent as `X-Request-Id`), method, route group, status and duration on each request's access line. The default text format is unchanged. New page: Deployment, Monitoring a server.
- `GET /api/v1/health` answers `{"status": "ok"}` without a login, for a service manager's, container's or load balancer's probe; `/api/v1/status` still asks for one.
- With JSON logs or metrics on, an admin change's audit record carries the `request_id` of its request, the id on its log lines; the Audit log section shows it as the time's tooltip. Older records verify as before.
- Plot Options, Presets: **Bare** draws only the points (no margins, legend, colour bar, scale bar, axes,
  grid or zero lines; in 3D no axes or background planes), for figures and overlays. **Default** undoes it.

### Changed
- A numeric column of 8 MB or more is sent from its array in 1 MiB pieces instead of being copied into one bytes object first, so the server holds less while it sends: at 95.6 million cells the server's peak memory in the first plot is 4.4 GB (v0.6.1: 4.8 GB). `annzarro start` also hands any large reply to its server in pieces. The bytes sent are the same.
- A plot with the colour None draws its points blue (a lighter blue on the dark theme) in the regular
  mode too, as large-plot mode already did. Grey now means only "not in the table" (or a colour that
  could not be read, which the status line says).
- The legend title sits above the entries at every legend position, starts where the labels start and has
  a clear gap below it; before it was flush left, a few pixels off the symbols, 2 px above the first entry
  (and beside the entries in a legend on top or at the bottom).
- Admin page, Server health: each worker's memory, and the total. Every worker now reports every 2 seconds whether or not it is serving, so a quiet worker is no longer shown as idle, and one that has not reported for a minute (not ten) is shown as stale: it is stuck. Server health and `/metrics` share one snapshot file and one writer per worker.
- `annzarro start` serves through waitress (a new dependency, pure Python, also on Windows) instead of Flask's development server. Debug mode and HTTPS still use the development server. A request line and headers over 262,144 bytes are refused with 431. It serves 32 request threads; `server.threads` (`ANNZARRO_SERVER_THREADS`) sets the number.
- The lab-server guide's nginx block keeps its connections to gunicorn open (`upstream` with `keepalive`, an empty `Connection` header) and speaks HTTP/2 to browsers. A plot loads through many small requests: a 4-panel view opened 184 connections to gunicorn per load on nginx before 1.29.7 and none with the block. With HTTP/2 and 150 ms of added latency the view drew in 4.1 s instead of 7.7 s. Its `keepalive_timeout` is set below gunicorn's 5 s so nginx never sends into a closed connection.
- The guide and the hosting checklist no longer tell you to start gunicorn with `--limit-request-line 8190`: it overrode the bundled configuration's unlimited request line and refused the long URLs the web client builds. nginx's `large_client_header_buffers` bounds the line.

### Fixed
- The search box in Load Panel Set had no right edge and a darker left edge, which showed most in Safari. The box now has one even border, and its focus ring follows the same outline.
- A stream of every cell or gene name built the JSON of a whole stored chunk at once, which held about 35 MB more per reader than the chunk itself needs (a store with 2-million-name chunks). It is built 65,536 names at a time now; the bytes sent are unchanged.
- Changing the subset while an earlier change is still loading shows the new choice at once: the header
  names the cells asked for, and only the last request's cells are drawn.
- The tooltip of Plot Options, Presets, **Publication** no longer says it sets the scale bar: it leaves the scale bar as it is.
- Close all writes the autosave and the address at once, so a reload right after it no longer finds the panels just closed.
- Switching Show Legend off or on in Plot Options redrew the graph once per legend entry: about a second
  on a 1M-point plot with 35 categories. It is now a single layout change (about 50 ms).
- Every request a plot made opened a new TCP connection that the server closed after the reply, so a few servers loading plots side by side used up the machine's ephemeral ports ("Can't assign requested address" for other programs). Connections are kept open now.

### Docs
- The lab server page and the hosting checklist no longer tell you to pass `--limit-request-line 8190` to
  gunicorn: it capped the request line that the bundled configuration leaves unlimited, so a plot that
  names many genes in its URL (about 12 KB for 2,000) is refused with 400 under it.
- The README and the licence page cite v0.6.1 by its DOI,
  [10.5281/zenodo.23461950](https://doi.org/10.5281/zenodo.23461950).

## 0.6.1 (2026-10-18)

Legend columns, dot size and title for categorical colours; the focused cell drawn as an open circle by
default; a Background group in Plot Options in place of the colour theme buttons; a double-click that zooms
without moving the focus; and fixes to the Plot Options menu, its opacity boxes, the site footer and the
Structure search.

### Added
- Plot Options, Legend and colour bar: the legend of a categorical colour can have its title switched
  off, its dots set to a size of their own (2 to 16 px, independent of the points' size) and be laid
  out in 2 to 8 columns. Unset, the legend looks as before. The options travel with links, panel sets
  and Apply to other panels.

### Changed
- The focused cell or gene is drawn as an open circle five times the point size by default (no fill, a 2 px edge, opaque). Switch **No fill** off in the Focused group of Plot Options to fill it; plots saved before this draw the new default unless they set the fill.
- The **Appearance** group of Plot Options is now **Background** (background colour and 3D backdrop). The **Plot colours** buttons (Follow app theme, Light colours, Dark colours) are gone: plot colours follow the app theme until you set one, and each colour's **Reset** hands it back. Saved links, panel sets and autosaves that pinned a palette open and draw as saved.
- Double-clicking a plot to reset its zoom no longer changes the focused cell or gene. A single click now focuses after Plotly's double-click window (0.3 s).
- The site's footer line on the main page is at the bottom of the page, under the panels, instead
  of pinned to the bottom of the window: scroll down to reach it.

### Fixed
- The arrow keys of the opacity boxes in Plot Options (Focused, Not in table) step from the opaque default (1, 0.95, 0.9) instead of jumping to the minimum; the boxes show the opacity in use (the Not in table one shows the automatic value, and stores nothing until you change it).
- The Plot Options menu no longer closes when you press inside it (to select text in a box, drag a slider or a colour) and let go outside it. It closes on a click that starts outside.
- When the server does not send the libraries the page needs (an installation missing files in
  static/vendor), AnnZarro says which ones and what to do, instead of "Can't find variable: bootstrap".
- The Structure tab of Dataset information: the tree no longer shows through the strip above the
  search box while scrolling.

### Docs
- The README and the licence page cite v0.6.0 by its DOI,
  [10.5281/zenodo.23447624](https://doi.org/10.5281/zenodo.23447624).

## 0.6.0 (2026-10-17)

An About dialog and what a public site needs (imprint, privacy notice, a footer), set from the admin
page; a Dataset information dialog with attribution, README and structure; last sessions listed instead of
redrawn, and plots of a set too large for the browser refused one by one instead of crashing the
tab; plot options that survive links and Duplicate; and a Publication preset for figures.

### Added
- **Last sessions.** The welcome screen and the Load Panel Set dialog list up to three last sessions first ("Last session (autosaved 14:32)", the dataset and the panel count), each with **Restore**. A session whose tab ran out of memory while it was drawn is marked "did not finish loading" and offers **Restore with the default subset**; it is never restored by itself again.
- **No fill** in the Focused cell group (Plot Options) draws the focused marker as an open circle, its edge only, in 2D, 3D, gene and large plots, in exports and in links, panel sets and Apply to other panels. An edge width under 1 px is raised to 1 px when it is switched on, so the circle always shows.
- The **Structure** tab of the Dataset information dialog has a **search box**: it filters column names, keys, `uns` paths, types and category labels as you type, marks the matches, opens the sections that hold them and counts them. A `.*` switch reads the query as a regular expression, `Aa` matches case (both remembered); an invalid or too slow pattern is said in words and the last result stays. Escape clears it, `/` and Ctrl/Cmd+F focus it.
- `uns["annzarro"]` is a versioned format (`schema` `annzarro.dataset-info`, `schema_version` `1.0`; a dictionary without them is version 1). The reader ignores keys it does not know, reads a newer minor version in full and a newer major version for the fields that did not change (the dialog says so), and every field accepts a simple form and a richer one: a licence as `{id, url, text}`, authors with ORCID iDs, several contacts, funding and provenance. `annzarro store annotate` writes the marker, takes `--from-json` for the richer forms, and refuses a value the reader would ignore. The field table and the compatibility rules are in the deployment guide.
- A **Dataset information** button beside the open dataset's name shows the dataset's attribution (title, licence, authors, citation with a copy button, DOI, source, contact), its README rendered as safe Markdown (raw HTML is shown as text, links only http, https and mailto, no images) and its AnnData structure (cells and genes, obs and var columns with types, flags, category labels and colours with a warning when the colour count differs from the category count, obsm, layers and the other slots with shapes and, for sparse matrices, density, raw, unknown groups, the `uns` tree). Each tab loads when first opened, with a loading state and a retry on failure; the dataset browser's details pane shows the same for a dataset that records it. Dataset owners write it into `uns["annzarro"]` and `uns["README"]`, with `annzarro store annotate` for a zarr store that is already written; CELLxGENE's `uns["title"]` and `uns["citation"]` are shown too. See "Dataset information and attribution" in the deployment guide.
- Click the app name at the top left to see which version you are running, how to cite AnnZarro, and who develops and funds it (the Setty Lab at Fred Hutch Cancer Center, with the NIH award numbers), with links to the documentation, the repository and the changelog.
- A server can show who runs it and what it owes its visitors. Under `site:` in the configuration, set an imprint, privacy notice, accessibility statement and terms of use, each as a link, a Markdown text or a Markdown file, plus an operator, a contact and the link labels (`Impressum`, `Datenschutz` for German sites). A small footer line on every page, including the sign-in, account and admin pages, links them; the About dialog gets a "This site" block, and a click on the imprint opens it in place. The texts are also served at `/site/imprint`, `/site/privacy`, `/site/accessibility` and `/site/terms`, which need no sign-in. Nothing appears until you configure it.
- `site.robots` tells search engines to stay away (by default on a server with login), `site.security_contact` serves `/.well-known/security.txt`, and `site.storage.persistent_convenience: false` keeps the layout autosave and recent datasets only until the tab closes.
- The Gene Set panel's question before it sends gene lists now says that each service also receives your IP address, and links the service's privacy policy.
- `site.software_credits: false` reduces the About dialog's credit for AnnZarro (lab logo, funding, citation) to its name, version, licence and links; it stays by default everywhere, below the site's own block.
- The About dialog of the desktop app states what the app sends and where.
- The server warns at start when `integrations.external_requests` is `"on"` on a shared server, and when `branding.contact_info.custom_html` contains a script, an iframe or an address on another server.
- **Public site** on the admin page: every `site:` setting (imprint, privacy notice, accessibility statement, terms, operator, contact, labels, footer, search engines, security contact, language, the AnnZarro credit, browser storage) can be set while the server runs, and the footer, About and the `/site/` pages show it at once. Each field explains itself on hover and links the public-site guide, a Markdown text has a live preview, a value the server would refuse at start is refused under its field, and a checklist says which of imprint, privacy notice, contact and accessibility statement are missing. Each text shows what is in effect and where it comes from, a text the configuration file reads from a `file` with its path and as the pages show it. A save sends only what you changed: looking at another option, or a link or text left empty, changes nothing, and **Not shown** over the configuration file's text says that it hides it. An admin's value wins over the configuration file until **Reset to config file**; `policy.locked: [site.imprint]` keeps a key in the file's hands. A text's `file` can only be set in the configuration file.
- **Data & privacy** (`/site/data`), generated from the running configuration: what the browser keeps, the cookies, what the Gene Set panel may send to which services and when, and that there are no analytics. Without a configured privacy notice it says plainly that it is not one. `/site/about` shows the About dialog as a page.

### Changed
- **Every setting on the admin pages has an info mark and a Guide link.** Hover or tab to the mark for what the setting does, its default and what it affects; Guide opens the explanation in the docs. This covers the Settings tab and the per-user settings, the Public site, the fields of the Users and Access panels, and Data sources. The admin page's introduction now states the real rule between the config file and the admin: an admin value overrides the file unless the key is in `policy.locked`, and a restrict key can only be narrowed.
- **A new visit no longer redraws the last session by itself**; a reload of the tab still does. A panel set kept on "All cells" and moved to a very large dataset could run the tab out of memory, and every reload drew it again. `ui.autosave.auto_restore` now takes `reload` (the default), `always` (the old behaviour, also `true`) or `never` (also `false`); `ui.autosave.show_in_list` lists the last sessions and is on by default. Upgrade: set `auto_restore: always` to keep the old behaviour.
- **The address names the open dataset.** Every way of opening one (the dataset browser, the back button beside its name, a panel set, **Restore**, the desktop app, the dataset opened at start) writes `?dataset_path=` (its path in the data directory, such as `?dataset_path=bm_aging.zarr`), with no panel open too, so a reload opens the dataset on screen. The address is replaced, not added to the history.
- **The bare address opens no dataset.** A fresh visit to it no longer opens the dataset opened last; the welcome screen lists the last sessions and the recent datasets, with **Browse datasets…**. A data directory with only one dataset still opens it, and the desktop app still reopens the dataset opened last.
- **The subset size you choose is kept for the tab.** It still follows you from dataset to dataset and through a reload of the tab, but a fresh visit (a new tab, the address typed, a bookmark) starts on the server's default subset. Upgrade: a size kept by 0.5.5 is removed at the first load, not carried; choose it again once in each tab.
- **Plots drawn at once are drawn in turn** (a restored session, a dataset switch or a larger subset with plots open): each is checked against what the plots before it hold, the browser's allocation check included, so the later ones of a set too large for the browser are not drawn instead of running the tab out of memory. Each says what ran short ("Not drawn: not enough browser buffers", "... JS memory", "... browser memory", or "too many WebGL canvases") with **Half the cells**, **Subset…**, **Close other plots** and **Draw anyway** (with what it risks). A Cell or Gene Table of more rows than fit is not loaded, with the same choices.
- The **Publication** preset sets the font to Arial and draws a shorter colour bar with fewer ticks (40 % long, three ticks); **Default** puts the font back.
- The panel's text font now reaches the legend (title and items) and the colour bar (title and tick labels) as well as the axes, when you change it in **Plot Options**, press a preset, and in exports.
- Plot images are exported at twice the size set in **Plot Options** by default (2400 × 1600 pixels for the default 1200 × 800), so a figure stays sharp in print; the modebar camera follows the panel's export size. Untick **Export at 2x** for files of exactly the pixels set. A panel or link saved with the scale switched off keeps it off; one that never recorded it exports at 2x. SVG files keep the size set.
- A plot's toolbar (zoom, pan, reset, camera) sits in the top right corner of the plotting area
  instead of the figure's, so a legend or colour bar placed on the right, the default, no longer
  runs into it.
- A colour bar placed on top of or below a plot lies wholly outside the axes, with the margin it needs
  made for it, instead of over the top or bottom of the plot. It sits below the x-axis title at the
  bottom. A legend above or below a plot does the same, clear of the axes and the x-axis title, in short
  panels too.
- The About dialog says that the Setty Lab develops and funds AnnZarro (the software), so that a site that runs it is not mistaken for the lab's own.
- A server other people reach (login on, a network address, `server.hosted` or a proxy) shows a footer line even with nothing configured: "About · Data & privacy", plus the configured texts and contact. The desktop app and a personal server show none until you configure something.
- Such a server logs a warning at start when it publishes neither an imprint nor a privacy notice, naming the admin page's Public site section and the guide.

### Fixes
- A dataset README longer than the 200,000 characters the dialog renders says that it was cut ("Showing the first 200,000 characters of … KB"); its end used to be left out without a note.
- The dataset browser's path field opens with **/** or **~** (the first character of the path, as in the macOS and GTK file dialogs), from the list or from an empty search box; a search box that holds text keeps the character. The hint reads "Type a path or URL: /" on every platform. It advertised Cmd+L, which Safari keeps for its address bar and never passes to the page; Ctrl+L and Cmd+L still work where the web browser passes them on. In the list, `/` no longer moves to the search box.
- Choosing "All cells" on a dataset the server shows in full anyway (up to its subsampling
  threshold) no longer carries every cell to the next, larger dataset: the kept size is forgotten
  and large datasets open on the server's default subset. Every cell chosen on a larger dataset is
  still carried.
- **The subset dialog counts the array buffers of every open plot together.** With six Cell Plots open on a 95.6-million-cell dataset, a computer with 128 GB let every cell through: its memory holds six large plots of 8 to 9 GB, but one browser tab holds about 16.6 GB of array buffers in Chrome and about 15 GB in Safari, and the tab ran out. Such a size is now refused with "Needs ~60 GB of browser buffers", and the dialog says up to which size the plots fit (about 26 million cells for six plots in Chrome, 23.6 million in Safari). A new or redrawn large plot is checked the same way beside the plots already open. `ui.memory.buffers_gb` sets the limit; by default it is the browser's own.
- After the tab ended while drawing large plots, the next page keeps the buffers it held as this browser's limit, so the same plots at the same size are not offered as fitting again. Before, a large-plot draw never left the crash marker that makes the guard more careful.
- **The margin learned from a crash no longer applies to everything, forever.** It grew by 0.25 with every crash, for every action of any size, and was never forgotten. It now applies only to actions of at least half the size of the one that crashed, is forgotten after a week or once an action that large succeeds, and a refusal that only it causes says so and offers **Reset the margin** (in the panel and the subset dialog). A margin kept by an earlier version is dropped.
- **A new Cell Plot was refused although the browser had the memory**, and allowed when it did not: the allocation check's answer was inverted (since 0.4.2) for a new or duplicated large plot, a full-resolution export, a recolour and hover labels of more than 256 MB. After closing a plot of every cell of a 95.6-million-cell dataset, or on a fresh page that opened it on every cell, the create tile said "Not enough browser memory" with nothing open, and kept saying it after the subset was reduced to 100,000 cells.
- The create and duplicate tiles are checked again when the number of cells shown changes (a smaller subset, another dataset), and a few seconds after a plot is closed, once its memory is freed. A tile refused at every cell stayed refused at 100,000 cells until another panel was opened or closed; a click on a refused tile also checks again.
- Every memory refusal names the limit that binds: the create tile's note, the panel's headline and its status tag say "JS memory", "browser buffers", "browser memory" or "WebGL canvases" instead of "browser memory" for all of them.
- The dataset information dialog shows the dataset's name on one line, cutting the start with an ellipsis (the full path is its tooltip), and tables and code in a README use the dialog's full width.
- A dataset's README, and the texts of a public site, render bare web addresses as links, and pipe tables, fenced and indented code blocks, horizontal rules, underlined headings and block quotes instead of showing their markup. Tables scroll sideways inside their own box when they are wider than the dialog, and show at most 500 rows and 30 columns.
- A category hidden with a click on the legend stays hidden when a Cell Plot linked to a filtered Cell Table removes or greys out the cells not in the table. Hiding moved to another category, so other cells disappeared and came back, and a category the table filter emptied came back shown. The hidden entries now follow their category, or colour group, through every redraw, in regular and large plots, until you colour by another column.
- A plot opened from a share link, a panel set, the autosave or **Duplicate** now looks as it did where it was made. Its axis lines, which the first draw took from the Grid switch, were missing whenever Grid was off, which is what the Publication preset does; so were the colours of the legend title and the toolbar, the tick colour, and Show Legend (the legend and the colour bar came back). Changing an axis, text or grid colour, or the font, in Plot Options now redraws every element that uses it, as opening the same plot does. Links made by earlier versions need no repair: the settings they carry were right, only the first draw ignored them.
- A new focus shows sooner in big Cell Plots. At 1M cells a click showed the cell's name after about 0.2 s and its marker after about 0.4 s, and kept the page busy for about 0.2 s; now both show within about 60 ms. Moving the marker no longer redraws every point through Plotly, and an open Cell Table no longer lists all its filtered rows each time the focus changes or the layout is autosaved; the periodic autosave also waits for a quiet moment, and leaving the page still saves at once.
- A categorical colour whose `uns["<column>_colors"]` has fewer colours than the column has categories no longer repeats them, which gave different categories the same colour. As in scanpy, the stored colours are then set aside and the default palette is used, in regular and large plots, and the panel's status strip says so ("Default colours: see why").
- Clicking a cell in a Cell Plot focuses it every time. In plots of hundreds of thousands of cells, a click soon after the plot was drawn or resized, or while the previous focus change was still being shown, often did nothing. In large plots, a click made while the plot is still preparing click selection (which can take a while at tens of millions of cells) shows a busy cursor and "Preparing click selection…" in the status strip, and focuses the cell once it is ready, instead of doing nothing.
- A Cell Table or plot too large for any browser page (95.6 million rows against about 4 GB of JavaScript memory) now says "Too many rows for this browser" with the numbers, and offers "Show N cells" for the largest subset that fits (a table at most 1,000,000) and "Subset…". It no longer offers "Close other plots" when no other plot is open or closing them cannot help, nor "Draw anyway" above the browser's ceiling.

### Docs
- New page [Running a public site](https://annzarro.readthedocs.io/en/latest/deployment/public-site.html): who is responsible, what a public site owes its visitors (imprint, privacy notice, accessibility), what AnnZarro stores and sends, the `site` settings, and privacy-notice templates in English and German.
- The README and the licence page cite v0.5.5 by its DOI,
  [10.5281/zenodo.23440020](https://doi.org/10.5281/zenodo.23440020).

## 0.5.5 (2026-10-17)

Fewer pop-ups, with messages shown where you are looking; automatic point size and opacity that
follow the panel's size; a subset size that follows you from dataset to dataset; and Plot Options
for the focused cell's marker.

### Added
- Plot Options has a **Focused cell** group (**Focused gene** in gene plots) that sets the size
  (a multiple of the point size), opacity, fill colour, edge colour and edge width of the marker on
  the focused cell, in 2D, 3D and large plots. The colours follow the app theme until you set them
  (the edge is black on a light plot and white on a dark one); the values are kept in panel sets
  and share links, and a link without them draws the usual red dot.

### Changed
- Automatic point size and opacity follow the plot area as well as the number of points: a large
  plot (a full window, a big export) draws larger, more opaque points and a small split pane
  smaller, fainter ones, so points look about as dense at any panel size. They update when the
  window is resized, a split is dragged, the controls are shown or hidden, or a panel is
  maximised; a size or opacity you set stays as set.
- The cell subset size you choose follows you to other datasets. A dataset you switch to opens
  on that many cells when it has more, and with every cell when it has as many or fewer; its badge
  then reads, for example, "All cells (≤ 10,000)", and the next larger dataset is subsampled to the
  size again. The size is kept per browser and user, so a reload keeps it, and the dataset AnnZarro
  opens when it starts uses it too. "Close all" with the tick box for clearing everything forgets
  it. Share links, panel sets and the restored session still open on the subset they saved.
- A plot or table whose data the browser ran out of memory for says so in plain words ("the
  browser ran out of memory -- Close a plot, or show fewer cells (a smaller subset), and try
  again") instead of "failed to read -- Array buffer allocation failed", and offers **Half the
  cells** and **Subset…** where it says it.
- Fewer pop-ups: AnnZarro now pops a notice up only for what you did not cause or cannot see (an
  error, data that changed under you, a partial outcome). Messages about what you just did appear
  where you are looking. A panel set that cannot be saved, loaded, imported or deleted says why
  on its card or under the name box in the dialog, and saving over an existing name turns Save into
  Overwrite and deleting asks on the card, in place of the browser's own confirmation windows
  (also for Clear closed panels). A plot export or copy that the memory check refuses, or that
  fails, says so in the plot's status line, with the advice, until the next one succeeds. What the Log
  colour scale does to a Min or Max you typed is shown under the boxes. Share Link is off, with a
  tooltip, until a dataset is open. No notice any more for a restored autosave, an imported panel
  set, a plot source missing from the dataset (the menu and the plot already say it), or a
  dataset that became unavailable (the dataset browser says it). Several columns removed from
  tables in one restore, or two notes about one store, come as one notice, and notices that stay
  up are held while the pointer or keyboard focus is on them and last longer when they are longer.

### Fixes
- The Save Panel Set dialog now closes when a save finishes while it is still fading in (a quick
  save, or Overwrite pressed at once); it used to stay open.
- A plot coloured by nothing, or by a column the dataset does not have (after switching datasets),
  no longer shows a grey "trace 0" in a legend after an axis change; such a plot has no legend.
- An error notice is no longer wiped by the notices that follow it from the same action (a shared
  link that could not be read, a cell subset that could not be applied): a notice is replaced only
  by one at least as severe, and a lower one waits below it.
- The first notice after the page loads is announced by screen readers, and a dataset that fails to
  open is announced once, not twice.
- A release build no longer fails when Apple's ticket service drops the connection while the
  notarization ticket of the macOS app or its dmg is being checked (`stapler validate`); the check
  is retried up to five times, and a missing ticket still fails at once.

### Docs
- The README and the licence page cite v0.5.4 by its DOI,
  [10.5281/zenodo.23426323](https://doi.org/10.5281/zenodo.23426323).

## 0.5.4 (2026-10-16)

A filtered Cell Table opens about twice as fast on large datasets, and switching datasets no longer
shows a notice: a back button beside the dataset name returns to the previous one. The first release
the desktop app can install over 0.5.3 by itself.

### Changed
- Switching datasets no longer shows a notice. A back button beside the dataset name returns to the
  previous dataset, and then offers the one you left, so the two toggle. The notice's button used to
  spread across the page when a dataset name was long.

### Fixes
- A release build no longer fails when Apple's ticket service drops the connection while the macOS
  app or its dmg is being stapled: stapling is retried up to five times.
- A Cell Table with a filter opens about twice as fast on large datasets, from a share link, a
  panel set or a reload: the filter goes over the rows once instead of twice, and each row costs
  less. Landing on a link with a filtered table of 484,125 cells held the page for two stretches of
  over 6 s each (long enough for the browser to report the page unresponsive); the longest is now
  about 2 s.

### Docs
- The README and the licence page cite v0.5.3 by its DOI,
  [10.5281/zenodo.23423797](https://doi.org/10.5281/zenodo.23423797).

## 0.5.3 (2026-10-16)

The desktop apps of 0.5.2 with a fix for Windows. 0.5.2 was published on PyPI only; its desktop
apps were not released, because the Windows build found this bug. Everything in 0.5.2 below is in
0.5.3.

### Fixes
- Windows: the dataset browser's details, the folder listing and the recent datasets work for a
  store on another drive than the data directory (for example the data directory on `C:` and the
  store on `D:`); the details answered with a server error.

## 0.5.2 (2026-10-16)

A dataset browser replaces the dataset dropdown, AnnZarro has a dark theme that follows your system,
and the desktop app updates itself, installs with Homebrew, opens files from the File menu, Finder and
drag and drop, and uses the AnnZarro header as its title bar. Admins control remote datasets in the
admin interface.

### Dataset browser
- The dataset is a button at the left of the bar under the header, in place of the dropdown, and
  **Ctrl+O** (**Cmd+O**) opens the **dataset browser** from anywhere, also in a text field. The
  header keeps only the focus boxes and the panel set buttons, so a long dataset name does not
  squeeze them. The button names the open dataset (its path relative to the data directory, cut in
  the middle to fit, the whole path as its tooltip) and shows when a dataset is opening, when a view
  has no data ("No data: *name*", **Choose...**) and when the open dataset became unreadable ("Not
  available"). The bar shows the dataset's format beside its cells and genes, and names it once.
- The browser lists **Recent**, **Pinned**, the data directory (and the directories an admin added, or
  a restricted user's grants) and, when the server allows remote datasets, **Remote**, which says what
  can be opened and takes a URL. The path above the table turns into a path or URL field with
  **Ctrl+L**. The table is sortable (names ignore case and read numbers by value: `liver_2` before
  `liver_10`), filters by format, number of cells and date, tags the datasets that match a view you are
  choosing for, and a **Show more** button pages it. Clicking a name opens the dataset; clicking
  elsewhere in the row selects it. The search (substring or regular expression) stays inside the
  folder shown.
- A details pane (a sheet below 1100 px) shows a dataset's counts, format, size, columns, obsm keys
  and layers, and runs the store check for a local store within its time budget; a remote store has a
  **Check chunking** button. **Open**, **Pin** and **Copy path** sit at its top and do not move while
  the details load. When panels are open, it names the keys they use that the selected dataset lacks.
- A click on the dataset button, or Ctrl+O, while the page is still starting is kept: the button
  shows it is busy and the dataset browser opens once the page is ready.
- After a switch a message, "Opened *name*", has a **Back to** *old name* button. Opening a dataset
  needs no confirmation.
- Opening with nothing asked for: the dataset you opened last, if the server still lets you read it,
  else the only dataset there is, else none, with the welcome screen offering **Open a dataset** (your
  recent ones and **Browse datasets...**). A server with several datasets does not open the first one
  alphabetically any more, which on a shared server could be a very large store.
- **Recently opened** keeps stores in subfolders and remote stores (`s3://`, `https://`), shows one you
  can no longer open greyed in place, and is kept per server **and per user**: two people who sign in
  to one server from one browser do not see each other's list. The list kept before moves to the first
  user who signs in afterwards, once.
- The browser tab and the window are titled with the open dataset, `bm_aging_annzarro.zarr ·
  AnnZarro` (with your `app_name`), and with the app name alone when none is open.
- New optional setting `branding.admin_contact` (a name or an email address): a user who sees only
  some datasets is told "Ask *contact* for access." when a link or panel set names a dataset they
  cannot read.
- Keyboard and screen readers: the table is a native table with a caption and sortable header
  buttons, one tab stop with arrow keys, Home, End, type-ahead, **/** for the search field and
  **Escape** back to the dataset button; counts and openings are announced; the focus ring is a 2 px
  outline in the link colour in both themes; forced colours, reduced motion and touch targets
  (44 px) are respected; below 768 px the dialog fills the screen.
- Select2 (the dropdown's library) is removed from the page and the licence notices.

### Dark theme
- AnnZarro follows your system's light or dark setting, live: switch the system while the page is
  open and the app switches. The **System / Light / Dark** buttons at the right end of the dataset bar
  override it for this browser and are remembered there. The login page, the admin pages, the account
  page and the desktop app are themed too, and there is no flash of the wrong theme on load.
- Plots follow the theme for every colour you have not set (background, grid, axes, text, legend,
  colour bar, the toolbar, the grey Not in table points and the scale bar). A colour you set, or a
  plot theme button, is kept when the theme changes. Plot Options > Appearance has **Follow app
  theme** (and **Light colours** / **Dark colours**); a colour's **Reset** follows the theme again.
  The **Default** preset follows the theme, **Publication** stays white.
- Share links and panel sets store only the colours you set. A link from an earlier version opens
  with its colours equal to the old light defaults following the theme; the colours you chose, and
  the old Dark Theme button's, stay.
- Exports use the colours on screen: export in the Light theme (or with **Publication**) for a paper.
- Grid and axis colours apply from the first draw, and several grey-on-white text and control
  colours are slightly darker for WCAG AA contrast.

### Desktop app
- **Updates itself.** It looks for a newer release on launch and then once a day, asks before it
  downloads (Download, Later, Skip this version) and again before it restarts, and does nothing without
  your say-so. **Check for Updates...** is in the AnnZarro menu (macOS) or Help menu (Windows, Linux),
  next to an option that turns the automatic checks off; `ANNZARRO_DISABLE_UPDATES=1` turns updates off
  entirely. macOS, the Windows installer and the Linux AppImage update in place; a `.deb` and the
  Windows portable zip show a link to the new release. Checks contact only `github.com`. Updating
  starts with 0.5.3: users of 0.5.2 and older update by hand once
  ([details](https://annzarro.readthedocs.io/en/latest/getting-started/desktop-app.html#updates)).
- **Homebrew** on macOS: `brew install --cask settylab/annzarro/annzarro`; the app then updates itself.
  The tap follows each release.
- **No title bar** on macOS and Windows: the AnnZarro header is the title bar, at the same height as
  in the browser. On macOS the three window buttons sit at the top left and the AnnZarro title moves
  down below them. On Windows the minimise, maximise and close buttons, in the header's colours in the
  light and the dark theme, sit at the top right, above the panel set buttons. Drag the empty part of
  the header to move the window and double-click it to zoom it. Linux keeps its normal window frame.
- A **File** menu on every platform: **Open Dataset...** (`Cmd/Ctrl+O`, the dataset browser), **Open
  File or Folder...** (`Cmd+Shift+O` on macOS; **Open .h5ad File...** and **Open .zarr Folder...** on
  Windows and Linux), **Open Recent** and **Refresh Dataset**. The same buttons are in the dataset
  browser and on the welcome screen.
- Drag a `.zarr` folder or an `.h5ad` file onto the window to open it. Several items open the first and
  say so; anything else is refused with a message.
- `.h5ad` files open by double click and **Open With**, and `.zarr` folders through **Open With** or a
  drop on the Dock icon (on macOS they stay folders in Finder). A path on the command line opens in the
  running window. Opened datasets go to the Dock's and jump list's recent items, and the macOS window
  shows the file.

### Admin: remote datasets
- Whether the server may read `s3://`, `gs://`, `gcs://` and `http(s)://` datasets is set in the admin
  interface: **Data sources > Remote datasets** (the section was called Data directories) offers Off,
  Only these locations (a validated list of URL prefixes) and Any location (with a warning that the
  server then fetches any URL, internal addresses included). It takes effect at once in every worker,
  is audited, and the dataset browser's **Remote** place follows it. `server.remote_stores`,
  `server.remote_allowlist` and their environment variables stay the upper limit: an admin narrows
  them, never widens them, and the card shows what set the value.
- The Settings switch "No external hosts" is renamed "Gene Set Analysis: no external services" and says
  it does not affect remote datasets. Its key and API name are unchanged.
- The refusal "Remote datasets are disabled on this server" names Admin > Data sources > Remote
  datasets as well as `server.remote_stores`.

### Changed
- **Plot Options** opens with only the **Export** group unfolded; the groups you open or close are
  still remembered per panel.
- The Save / Load / Close all / Share buttons in the header line up with the focus boxes instead of
  the middle of their labels.
- **Load Panel Set** moved from Ctrl+O to **Ctrl+Shift+L** (**Cmd+Shift+L**); Ctrl+O opens the dataset
  browser. In the browser Ctrl+R reloads the page as the browser does and does not refresh the dataset
  (the **Refresh dataset** button does); the desktop app keeps Ctrl+R/Cmd+R for it.
- The header wraps the panel set buttons below the focus boxes only when the focus boxes and the
  icon-only buttons do not fit one row; a dataset name never changes the header.

### API
- `GET /api/v1/datasets/details?path=`: a store's counts, format, columns, obsm keys, layers and
  store-check findings, read from metadata only and stopped after
  `server.dataset_details_check_budget_s` (1.5 s by default).
- `sort=` and `order=` on `GET /api/v1/datasets/folder` (name or modified, applied before paging), and
  `folder=` on `GET /api/v1/datasets/search` to search below one folder.
- `POST /api/v1/datasets/lookup` answers which of a list of paths you may open, with the counts of
  each, and the same answer for a store that is not there and one you may not read.
  ([HTTP API reference](https://annzarro.readthedocs.io/en/latest/reference/http-api.html))

### Docs
- The README and the licence page cite v0.5.1 by its DOI,
  [10.5281/zenodo.23386903](https://doi.org/10.5281/zenodo.23386903).

## 0.5.1 (2026-10-14)

A reworked Plot Options menu, with tick, margin, colour bar and scale bar controls, presets, and
copying a plot's look to other panels. The grey "Not in table" points follow their own count and
have their own controls. Equal aspect plots keep their cells and zoom, and changing an axis on a
large subset no longer freezes the page.

### Plot Options
- Plot Options is grouped into nine folding sections (Presets, Appearance, Axes and ticks, Points,
  Legend and colour bar, Text, Margins, Export, Apply to other panels). The menu opens again as
  you left it.
- **Publication** preset: white background, no grid, five ticks per axis, larger text, a tighter
  margin. **Default** returns the look to a new plot's; the font, the scale bar's size and
  unit, the Points group and the export size stay.
- Tick marks and tick labels switch separately, and **Ticks per axis** asks for about N ticks
  (2 to 30; empty is automatic).
- Margins: one slider sets all four sides; **Set each side separately** shows a box for each.
- Colour bar: its own position (right, left, top, bottom or with the legend), a length from 10 to
  100 % and a tick count.
- **Scale bar** (off by default) for embeddings and spatial coordinates: a bar of a round length in
  coordinate units, about a fifth of the width in view, redrawn as you zoom or resize, with a
  Size slider (length, line and label together), an optional unit text such as µm and a corner.
  It needs Equal aspect on a 2D plot: greyed out otherwise, and turning Equal aspect off switches
  it off. It is part of an export and not part of the Publication preset.
- **Apply to other panels** copies a plot's look (not what it shows) to every other cell plot or
  gene plot, after a confirm in the menu. All of it is kept in links and panel sets; links from
  before use the defaults.

### Changed
- **Not in table:** the grey points have no legend entry, like the highlighted cell. Plot
  Options has a "Not in table" group with their size (relative to the automatic size, 1x by
  default), opacity and colour; links, copies and saved panel sets keep them.
- Without Equal aspect, switching the x field also resets a zoom on y, as reloading the page or
  opening a link already did.
- Stable download links that always fetch the newest desktop app, for example
  `https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-macos-arm64.dmg`. The
  README and the docs link their platform badges to them.

### Fixes
- With the grid off, tick labels no longer disappear on a plot's first draw and reappear after the
  next edit: they follow **Show Tick Labels** alone.
- **Not in table:** the grey points a table filter leaves in a plot are sized from their own
  count, the way the plot's points are, instead of keeping the size they had before they were
  excluded. Setting the point size by hand after the table is active, switching the table on in
  the panel and opening a plot that names it now give the same grey points, and a different
  table or subset readjusts them.
- **Equal aspect:** switching a 2D plot's coordinates refits both axes together and keeps every
  cell in view. A zoom saved in a link from before v0.5.0 is kept only if it shows the data.
- **Equal aspect:** a zoom is kept when the panel is resized, for example when a neighbouring
  panel is closed and the panel is split again.
- Double-click (Reset axes) fits all the data again, also on a plot opened from a link with a
  saved zoom.
- Changing a plot axis on a large subset coloured by a category no longer freezes the page. On a
  100,000-cell subset of a 1.06 million cell dataset coloured by 60 categories, one axis change
  blocked the page for about 4 s and two in quick succession made the browser report "Page
  Unresponsive"; both now take 0.1 to 0.15 s.
- Decoding a categorical column whose labels contain quotes or escaped characters takes 0.1 s
  instead of 3.8 s for 200,000 values with 20,000 such labels.
- A slow reply to the page's settings request no longer makes a large dataset download every cell
  name: the first dataset load waits for the settings (at most 10 s) before it decides whether
  names stay on the server.

### Docs
- The README and the licence page cite v0.5.0 by its DOI,
  [10.5281/zenodo.23353417](https://doi.org/10.5281/zenodo.23353417).

## 0.5.0 (2026-10-13)

An admin web interface for shared servers: an administrator adds data directories, manages
users, gives an external collaborator only some of the datasets, switches panels and external
hosts off, and reads the server's health and an audit log, all in the browser. Every request that
changes something is protected against forged requests, the server resists requests that would
hold a worker, and very large datasets are cheaper to open and read.

### Admin interface
- **`/admin`** (login on) has six sections: Users, Data directories, Server health, Panel sets,
  Settings and Audit log. A change needs the admin's password entered within the last 30
  minutes, and every change is written to the audit log.
- **Users:** add and remove users, reset passwords (a generated password is shown once), grant
  or revoke admin, and clear a lockout. The last admin cannot be removed or demoted. Everyone can
  change their own password at **Change password** in the header.
- **Data directories:** with `server.admin_data_roots` set, an admin adds directories in the
  browser, below the parents the operator allows. They appear in the dataset picker at once.
- **Dataset access for external collaborators:** restrict a user to the folders, stores and
  remote prefixes you grant; everyone else keeps seeing everything. A restricted user gets the
  same "not found" for a dataset they may not read as for one that does not exist. Manage it in
  Users (Access) or with `annzarro user access`.
- **Settings:** switch panel types off for everyone or for one user, and control what Gene Set
  Analysis may contact (all external hosts, individual services, the species lookup, the links).
  The browser refuses any host the settings do not allow.
- **Server health:** each worker's read budget in use, cache size, requests and refusals by
  reason, and who was seen recently. **Panel sets:** list by owner, reassign or delete.
- **Audit log:** each record carries the hash of the one before it, so an edit in the middle is
  found (`annzarro admin audit verify`). The log also goes to the `annzarro.audit` logger.
- A change made in the browser or with `annzarro user ...` reaches every gunicorn worker on its
  next request, without a restart.

### Security
- Every request that changes something needs the session's token and a same-origin `Origin`.
  Sign-in has its own one-time token, and signing out is a `POST`.
- Pages carry a `Content-Security-Policy` that lists the external hosts the user's settings
  allow.
- A request body over `server.max_request_mb` (64) is refused with `413`.

### Performance and limits
- **Cell and gene names** are streamed. For a 95.6 million cell store the server holds 0.42 GiB
  and answers in 0.14 s, where it held 15.2 GiB and took 14.4 s.
- **Sharded stores:** a 1,000-row subset of a 5M x 50 store in one 850 MB shard peaks at 47 MiB
  instead of 757 MiB.
- **Colouring by a gene on a subset of a CSR `X`** reads each chunk once: 10,000 cells of a
  1 million cell store take 0.4 s instead of 57 s, at about 200 MB more peak memory (#108).
- **Subsets** share the cache and the compute fairly between users. A subset that cannot start
  within `server.subset_wait_s` (30 s) is answered `503 read_busy`.
- **Numeric subset filters:** six at once on a 95.6 million cell store take 1.8 s and 10.8 GB
  instead of 18.8 s and 30.5 GB.
- **Name search with a regular expression:** a pattern that could hold a worker is refused, and
  every search stops after `server.name_search_timeout_s` (10 s). The picker says when a search
  ran out of time.
- **Remote stores:** one request may spend at most `server.remote_request_timeout_s` on remote
  reads (120 s on a shared server, 600 s for one user), then fails with `504 remote_deadline`.
- **Other limits:** panel-set quotas per user and per server, a cap on the entries a directory
  listing scans, `uns` members sized before they are read, and gunicorn workers replaced after
  20,000 requests. See Resource limits in the docs.
- **`annzarro store check`** reports, from metadata only, what in a store's layout makes AnnZarro
  slow, with the cost in clicks and a fix for each.
- In large-plot mode, hovering finds the nearest point in 1 ms instead of 43 ms at 95.6 million
  points and skips categories hidden in the legend.

### Fixes
- Switching a plot axis between a text field and a number field draws and refits the axis for
  the new field. In large-plot mode the x and y pickers grey out categorical columns, with the
  reason, until a subset is made.
- A table column named like `orig.ident` shows its values instead of N/A.
- A 3D plot keeps its wheel zoom when the focused cell changes or the plot is redrawn.
- The open dataset list follows the window height, with one scrollbar.
- **Center at 0** with **Lock Range** centres the colour scale on the locked range, and **Log**
  with Lock Range keeps the typed limits; turning either off restores them.
- A panel opened from the welcome page before the first dataset loaded no longer keeps its "No
  dataset loaded" screen.
- Splitting a panel, choosing a panel type and closing a section ease to the new sizes instead
  of jumping (not with the system's reduced-motion setting).
- A missing store is answered `404 not_found` on every data route.

### Desktop app
- The macOS app is signed with a Developer ID and notarized by Apple. Open the `.dmg` and drag
  AnnZarro to Applications.

### Docs
- A Python API reference; pages on choosing the desktop app or a server, the admin interface,
  the Admin API, the policy registry and resource limits; `CONTRIBUTING.md` and a code of conduct.
- The README and `CITATION.cff` cite the bioRxiv preprint.

### Upgrade notes
- **Scripts that sign in with a cookie** and send `POST`, `PUT` or `DELETE` must send the
  session's token in `X-AnnZarro-CSRF` (the page has it in `<meta name="annzarro-csrf">`).
  `curl` and `annzarro export` against a server with login off are not affected.
- **Behind a proxy that terminates TLS** or rewrites `Host`, set `server.proxy_count`, or every
  change is refused with `403 csrf_failed` and the admin page refuses changes.
- **Sign-in and sign-out:** a script that posts to `/login` must fetch the form first for its
  one-time `login_csrf` field. `/logout` is `POST` only.
- **Content-Security-Policy:** a customised page or an embedding that contacts hosts the policy
  does not list is refused by the browser.
- **External hosts:** Enrichr and Reactome are off by default on a shared server; switch them on
  in Settings or with `integrations.gene_set.services`. `integrations.external_requests` accepts
  `none`.
- **`/status` and `/cache/info`** answer admins only on a shared server.
- **Remote deadline:** keep the proxy's `proxy_read_timeout` at or above
  `server.remote_request_timeout_s` (120 s); `0` turns the deadline off.
- **Subsets:** raise `server.subset_budget_mb` and `server.subset_wait_s` if users see `503
  read_busy`.
- **Names streaming behind nginx:** use `proxy_http_version 1.1`.
- **Admin state** lives in `annzarro_admin/` beside the users file; back it up with the users
  file. `annzarro user` commands must run as the account that owns that directory.

## 0.4.3 (2026-10-11)

Zarr format 3 stores, sharded ones included, are read correctly. A new dataset picker browses
folders and searches, dataset names are never cut where you need them whole, large pairwise
matrices are read safely, and stores on network filesystems open faster.

### Zarr format 3
- Sharded stores are read correctly, and the read limits size a sharded array by its inner
  chunk, not by the whole shard. With anndata 0.13's default 1 GB shards, one row of a pairwise
  matrix used to count as 950 MB when the real read is about 10 MB.
- A server running zarr 2 answers a format 3 store with a clear `400 unsupported_type` instead
  of server errors or empty answers.
- The remote chunk cache works for sharded stores. A remote server that ignores `Range` requests
  gets an error that names the cause.
- zarr 3.0.0 to 3.0.8 are excluded: they read sharded arrays wrongly or lose members of
  consolidated format 2 stores. Use zarr 3.0.9 or newer, or zarr 2.
- The docs say which server reads which format, list the measured costs, and give sharding
  guidance. Format 2 stays fully supported.

### Opening datasets
- A dataset picker opens from **Browse...** in the dataset list. Search by name and path (with a
  regex toggle), browse folders, see cells x genes, format and date for each store, find recently
  opened datasets at the top, and see why an unreadable store can't be opened.
- The dataset list shows full names; the dataset box cuts long names in the middle, keeping the
  end, and its tooltip holds the path.
- The header stays on one row as long as it can: button labels collapse to icons first, then the
  focus boxes and the dataset box narrow.
- The focused gene and cell boxes grow to show their whole value.
- The typed-path field says what you can open there.

### Large data
- Pairwise matrices (obsp, varp) are read by rows, at most 1,000 per request, under a
  per-request memory limit (`server.max_read_mb`) and a server-wide read budget. A request that
  would decompress an n x n block is refused with a reason.
- The first open on a network filesystem takes about 12 filesystem calls instead of about 15,000.
- Stepping through the parts of a subset reloads only the panels that read cells.
- On a plot over the cell limit, the notice says what is unavailable and how to get it back.

### Plots
- A colour column the dataset lacks draws grey with a "not in this dataset" notice, also on plots
  over the cell limit, which showed an error.
- A gene plot with text coordinates (for example Ensembl IDs) counts every drawn gene as shown.
- A default colour from one dataset is not carried over to a dataset that lacks it.
- After a part step on a large plot, the strip no longer says "Plot went blank".

### Docs and data
- One demo store for every doc, tutorial and panel set, `bm_aging_annzarro.zarr`, on Zenodo:
  [10.5281/zenodo.23277103](https://doi.org/10.5281/zenodo.23277103).

### Upgrade notes
- zarr 3.0.0 to 3.0.8 are no longer accepted; upgrade to zarr 3.0.9 or newer.
- obsp and varp reads are limited by `server.max_read_mb`; raise it if a request you need is
  refused.

## 0.4.2 (2026-10-08)

Very large datasets on shared servers: a billion-cell store steps through its parts and searches
its cells without the server's memory growing, plus fixes to clicks, point size, subsets and
links.

### Very large datasets
- A subset with parts steps to the next part without closing the panel. A newer step replaces
  the one still loading, a "Loading part N..." pill shows progress, and the next part is read
  ahead. On a 1 billion cell store a step went from 58 to 72 s to about 23 s.
- Above 5 million cells, cell names are loaded only when a view needs them
  (`ui.defaults.names_on_demand_above`).
- Name search is bounded by memory (`server.name_index_max_mb`). Clicking the Focused Cell box
  on a 1 billion cell store grew the server by about 32 GB; it now stays near 1 GB.
- The first plot of a 95.6 million cell store, and subsets of a 1 billion cell one, no longer
  wait for every name to be hashed.
- A large plot that would not fit in the browser's memory is declined with a suggested subset
  size instead of crashing the tab.
- Large-plot mode has hover, click and the focused-cell highlight.
- A **Cancel** button appears on a panel whose load takes longer than 1.5 s, and changing what a
  panel shows cancels its earlier load.

### Plots
- A cell is selected only by a short, still click, not at the start of a drag or a 3D rotation.
- Automatic point size follows the points left after filters and subsets.
- Boolean obs columns are coloured in the order False, True, as scanpy does, so stored
  `uns/<col>_colors` apply to the right values.
- Applying a subset updates every affected panel.

### Links and interface
- The address bar follows the view: a reload keeps your changes, and copying the address shares
  what you see. The address is replaced, not added to the browser history.
- The AnnZarro version is shown in the title tooltip and the login badge.
- A cut-off dataset name shows in full on hover.
- A partial re-check of a very large dataset says so (#91).
- Admin help and docs say that admins may open any path by default (#90).

### Docs and data
- The spatial demo ships a 5-step expression walk on the kNN graph (`obsp/expression_walk_t5`).

### Upgrade notes
- On Linux systems older than glibc 2.28 (for example Ubuntu 18.04), install with
  `pip install "h5py<3.16" annzarro`.
