(long-computations)=
# Long computations, refusals and ways out

AnnZarro shows what a store holds and computes a fixed set of summaries on request: a gene score for every cell, the
groups of a {doc}`cell-grouping`, statistics per group and counts. It never runs code of yours, and each of these is
bounded by the server's limits. This page is the one place that explains what a panel does when such a computation is
slow, too large, or not allowed, and what you can press next. {doc}`cell-gene-plot`, {doc}`cell-count-plot`,
{doc}`gene-signature` and {doc}`cell-grouping` link here.

Everything below applies in the same way to a **Gene Signature** or **Gene Table** score, a **Cell Grouping**, a
**Cell-Gene Plot**, a **Cell Count Plot**, and a Cell Plot, Gene Plot or Cell Table that takes a score or a group as a
source. The sentences differ a little in each panel, because each names its own things; the states are the same.

## The cost tiers

Before it reads anything, the server estimates how long a request will take from the stored values it must read (the
store's index gives them), and the panel follows the estimate:

| Estimated time | What happens |
|---|---|
| Up to **5 seconds** | Edits are applied as you make them, and the plot updates live |
| Up to **1 minute** | The panel computes without asking. Edits that would take 5 seconds or more are collected behind an **Update** button |
| **1 to 10 minutes** | The panel asks first, with **Compute** |
| Above **10 minutes** | The panel refuses, and says why. Where the server allows it, the notice has **Try anyway** |
| A progress bar | Shown for a computation that is estimated, or has waited, longer than **10 seconds** |

The limits are the server's (`ask_first_s`, `refuse_s`, `live_update_s`, `progress_bar_s` and `try_max_s`, see
{doc}`../deployment/resource-limits`); an administrator can set them lower. While a new computation waits or runs, the
previous drawing stays: the plot keeps showing what it showed.

The estimate counts the stored values to read, so it is an upper bound: measured on a 95.6-million-cell dataset stored by
gene, 200 well-expressed genes read 10.5 billion stored values in about 3 minutes, against an estimate of about 6. Time
left is taken from the values read, not from the genes done, because one well-expressed gene can hold a hundred times the
values of a sparse one.

## What the panel says

The notice lies over the plot, and a short tag appears in the status strip at the same time, so the plot never moves. On
an axis, where nothing can be drawn without the value, the plot area shows the same sentence instead.

| State | What it says | Buttons |
|---|---|---|
| Computing | "Reading 200 genes: 120 of 200" (a grouping: "Grouping 95.6M cells…"; a count: "Counting 8,090 cells…"). After 10% of the work and 5 seconds, the time left ("about 3 minutes left") | **Cancel** (for every plot that shares it: "Cancel for 3 plots") |
| Queued | "Waiting for Cell-Gene Plot 2 to finish." when the job ahead is one of this page's, else "Waiting for the server: 1 computation ahead.", or "Sharing the server with 1 other computation." while two long jobs take turns | **Cancel** |
| Out of date | "Showing the previous plot. 2 changes not applied." | **Update** (a signature: **Update score**; a grouping: **Update groups**) |
| Asks first | "Reading 200 genes over 95.6M cells: up to about 6 minutes (10.5 billion stored values)." | **Compute**, **Fewer genes**, and the box **Don't ask again for this panel** |
| Refused for time | "Not run: it is estimated at about 25 minutes (runs over 10 minutes are not started by themselves)." and the way out | **Try anyway** where the server allows it |
| Stopped | "'T cell score' was stopped after 30 minutes, the server's limit for a tried run." | **Try again** |
| Cancelled | "'T cell score' was cancelled." | **Compute** |
| Failed | "Could not be computed: the server stopped responding." | **Retry** |
| Refused for size | The limit, the count and the cap (next section) | Ways out (below) |

The pictures on this page were taken with the limits lowered on a scratch server (`ask_first_s` 0.4 s, `refuse_s` 0.9 s, `try_max_s` 120 s), so that the notices appear on a store of 8,090 cells. A real store reaches them at the sizes in the table above.

```{figure} ../_static/screens/user-guide/longcomp-asks.png
:class: screenshot
:width: 60%
:alt: The notice of a Cell-Gene Plot that asks first: "Reading 16 genes over 8,090 cells: up to about 1 second (25.8 million stored values)." with the buttons Compute and Fewer genes and the box Don't ask again for this panel.

A panel that asks first, with **Compute**, **Fewer genes** and **Don't ask again for this panel**.
```

```{figure} ../_static/screens/user-guide/longcomp-refused.png
:class: screenshot
:width: 60%
:alt: The notice of a Cell-Gene Plot refused for time: "logged_counts is stored by cell (CSR), so 16 genes on 2 layers mean reading the whole matrix: about 1 second." with the way out, the button Try anyway and the box Don't ask again for this panel.

Refused for time, with **Try anyway**.
```

## A refusal for time and a refusal for size

A refusal always names the limit that refused it. There are two kinds, and they are different in what you can do:

- **A refusal for time** is a guess. The estimate is above 10 minutes, so the panel does not start the run by itself,
  but nothing says it cannot finish. It has a way out for time (below) and, where the server allows it, **Try anyway**.
- **A refusal for size** is a limit the server or the browser cannot lift for you: too many groups or levels, too many
  values, too many cells of a grid, a table over a million cells. The panel says what is too large, how large it is and the
  limit. **Try anyway** never appears on one.

A size refusal never quotes a time. For example, a grouping over the groups limit says "'Grouping 1' has 19,000 groups: a
grouping holds up to 2,000", not how long it would have taken, and a Cell Count Plot that colours a 2D histogram by a
grouping of 30 groups says "Color by Grouping 1 has 30 levels; 2D histogram colors up to 8." The sentences you may meet:

| Where | Says |
|---|---|
| Cell-Gene Plot, too many cells of the matrix | "28 groups × 15,000 rows = 420,000 cells of the matrix; the limit is 400,000. Remove a section or use fewer groups." |
| Cell-Gene Plot, too many values | "12 groups × 40,000 values per group = 480,000 values; the limit is 400,000." When Color and Size read different layers it adds that each gene is read twice |
| Cell Grouping, too many groups | "6,840 groups: a grouping holds up to 2,000. Nothing was computed." |
| Cell Grouping, too many levels | "cell_type has 8,090 levels; a factor holds up to 2,000. Nothing was computed." |
| A grouping that uses groupings too deep | "'Grouping 1' nests groupings 5 deep; a grouping can use groupings at most 4 deep, so it was not computed." |
| A grouping from a table of too many cells | "'Grouping 1' reads a cell table of 12,000,000 cells; a cell table lists up to 1,000,000, so it was not computed." |
| Cell Count Plot, an input over the mode's cap | "Color by Grouping 1 has 30 levels; 2D histogram colors up to 8." |
| A matrix stored by cell | "logged_counts is stored by cell (CSR), so 200 genes mean reading the whole matrix: about 40 minutes." with the way out "A copy of the layer stored by gene (CSC) makes this fast" |

## Try anyway

An estimate above 10 minutes is a guess, so you may still start the run. When the server allows it, the notice has **Try
anyway**. The run goes through the same heavy lane as any other, shows its progress bar and **Cancel** at once, and says
"Stops by itself after 30 minutes": the server ends a tried run at that limit (`try_max_s`, set by an administrator; 30
minutes by default), and then the plot says it was stopped, with **Try again**. Nothing partial is drawn.

- Only one tried run per user goes at a time.
- A run estimated at more than ten times the limit, or on a server where tried runs are off (`try_max_s` of 0), keeps the
  refusal with the reason and no button.
- Refusals for size never have the button.

## Don't ask again for this panel

**Don't ask again for this panel**, in the notice and in the pop-over of the strip's tag, starts what the panel asks for
without the question. Ticked on the question of a slow computation, it skips that question. Ticked on a **Try anyway**
notice, it also starts refused runs that the server allows. A panel with the box ticked shows the tag **Runs without
asking** at the left of its status strip; its pop-over has **Ask again**, which clears the box.

The setting belongs to the panel, for this page only: it is cleared by a reload, by opening another dataset, and by closing
the panel, and it is never saved in a link, a session or a panel set. A shared link therefore cannot start long runs on your
server unasked.

```{figure} ../_static/screens/user-guide/longcomp-runs-without-asking.png
:class: screenshot
:alt: The status strip of a Cell-Gene Plot with the tag Runs without asking and its pop-over: "Long computations in this panel start without asking. Each can be cancelled and stops by itself after 2 minutes." with the link Ask again.

A panel with the box ticked: the tag **Runs without asking**, and its pop-over with **Ask again**.
```

## Ways out, panel by panel

A way out is a button that does the change for you. Each is one step of **Undo**.

| Panel | The state | The buttons |
|---|---|---|
| Cell-Gene Plot | Too many cells or values | **Show <section> as one row**, **Remove <section>**, **Open grouping** |
| Cell-Gene Plot | One cell per group | **Show as Heatmap** |
| Cell-Gene Plot | Refused or asks first for time | **Fewer genes**, **Try anyway**, **Compute** |
| Cell Count Plot | An input with too many levels or bins | **Bin it** (a number), **Choose levels** (a category), **Remove Color by**, **Split by another column ▾**, **Switch to <mode>**, **Fewer bins** |
| Cell Grouping | Too many groups | A button to choose the levels of the largest factor |
| A source that is gone or refused | | **Open <source>**, **Choose another** |

## What makes a computation cheap

Most waits and refusals come from one of two things.

1. **The layout of the matrix.** A matrix stored by gene (CSC) is read by gene: 200 genes cost 200 columns. A matrix stored
   by cell (CSR) has to be read in whole to find a gene, so the same request costs the whole matrix, and a score, a
   Cell-Gene Plot or a Gene Plot's cell-group statistic that is quick on CSC may be asked first or refused on CSR. Z-score
   mean of a cell group is offered only on a layer stored by gene: it needs every gene's mean and SD over all cells, which
   the pass that reads the group provides on CSC. How to store a layer by gene: {doc}`../data/preparing-a-store`.
2. **The number of cells.** Counts, scores and group statistics read the cells shown. A **subset** ({doc}`subsets`) reads
   fewer, so it is cheaper.

A computation that has already been done is not done again: a signature's score, a grouping's groups and a group's
statistics are held for the page while they are used, so changing the statistic, the scaling, the colour, the order or the
style asks the server for nothing.

## Limits in one table

| Limit | Value | Where it is set |
|---|---|---|
| Live update | 5 s | `live_update_s` |
| Asks first above | 60 s | `ask_first_s` |
| Refused above | 600 s | `refuse_s` |
| A tried run stops at | 1,800 s | `try_max_s` |
| Progress bar after | 10 s | `progress_bar_s` |
| Cells of a Cell-Gene matrix (groups × rows), values the server gathers | 400,000 | `matrix_values` |
| Groups per grouping, levels per factor | 2,000 | `groups` |

The full list, with what each does and how an administrator changes it, is in {doc}`../deployment/resource-limits`.
