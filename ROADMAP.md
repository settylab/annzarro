# Roadmap

What we are building next, what comes after it, and what we have decided not to build. For what has already
shipped, see the [changelog](CHANGELOG.md). Plans change. This page is updated with every release, and an
item is only promised once it is in a release.

## Released: 0.8.0

0.8.0 shipped five features together.

| Feature | What it does |
|---|---|
| **Search by field names** | The dataset browser also finds datasets by the names of their fields: obs and var columns, layers, embeddings and uns keys. Only names are searched, never values. |
| **Gene Signature** | A panel for a named list of genes that gives every cell a score from it (z-score mean, mean, sum, control-adjusted, fraction of genes, % of total, with down genes if you want). The score colours or splits a Cell Plot, is a column of a Cell Table, and comes from a Gene Table too. Paste or upload a list from a file. |
| **Cell Grouping** | A panel that splits cells into groups by one or more columns, binned numbers, gene scores, cell tables or other groupings, each group with its own cell count. Groups can colour and split plots and tables, and follow when a renamed category is still the same group. |
| **Cell-Gene Plot** | Dot plots and heatmaps of genes by group, in sections. A section shows its genes, or one row standing for a gene list or score. Clustering is optional and works on the colours as drawn. |
| **Cell Count Plot** | Counts of cells by one or two inputs: bar, histogram, 2D histogram, heatmap, pie, density, Venn and UpSet. Heights and colours can be shares or statistics instead of counts. |

Every computation runs on the server, over all cells of a dataset, up to the scale AnnZarro already handles
(about 100 million cells). Work that would take long asks first, and work that will not fit in memory is refused
with the reason.

Also in 0.8.0:

- A group's statistic for each gene (the mean, the fraction of cells expressing, the z-score mean) is a Gene Plot's
  colour or axis, and a column of a Gene Table. A gene list chosen from those columns can be kept as a Gene
  Signature, so a score built from it no longer depends on the grouping it came from.
- References between panels can form a loop, for example a grouping built from a table that filters on that
  grouping. The menus mark choices that would close a loop. A loop that arrives in a link computes nothing and
  names the panels involved, and one made by your last edit offers Undo.

## After 0.8.0

| Item | Status | Notes |
|---|---|---|
| **An interface for browser agents** | Planned | AI agents in the browser should be able to operate AnnZarro and learn about it. First, accessibility as a tested standard: every control has a name and a role. Then, page-provided tools through the emerging [WebMCP](https://github.com/webmachinelearning/webmcp) standard: describe the app and the dataset, list and open panels, change a panel, undo. These tools go through the same checks as your own clicks, and costly actions still wait for you. A small activity line shows what an agent did, with Undo. |
| **Gene Count Plot** | Planned | A Count Plot over genes instead of cells. The panel type name is reserved. |
| **Fixed cell sets** | Deferred | Keeping a cell selection as a set that depends on nothing. Today a link stores how a selection is defined, never its cells. A stored set needs its own design for where the cells live and how they are shared. |
| **Grouping in the browser** | Deferred | Only if measurements show a gain. It would apply when every input is already loaded in the browser, and it would have to give the same result as the server. |

## Not planned

These were considered and left out on purpose:

- Hand-picking cells into a group with a lasso. A cell table's line filter covers this.
- Groups that overlap. A grouping is a partition, and overlaps are what the Venn and UpSet views are for.
- Merging groups by hand, and writing a grouping back into the dataset's store.
- Ranking marker genes.
- Stacked violin and track plots, and box and violin plots in the Count Plot.
- Searching the values inside columns. Search covers field names, titles, descriptions and READMEs.

Ideas and requests are welcome as [GitHub issues](https://github.com/settylab/annzarro/issues).
