(tut-gene-set-analysis)=
# Analyse a gene set

You have a group of genes and want to know what they have in common: shared pathways, known
interactions, what each gene is. This tutorial defines a set in a gene table, hands it to a
**Gene Set Analysis** panel, and reads what comes back. Then it changes one threshold and asks
again.

The panel does not compute the enrichment or the network itself. It sends the set's gene ids to
external services (STRING, g:Profiler, MyGene.info) and shows what they return. Nothing is sent
until you press **Run** and agree to the services the panel names. The reference for every
option is {doc}`../user-guide/gene-set`.

```{note}
The services' answers can change as they update their databases. The screenshots and numbers on
this page were taken on **2026-10-06**, with STRING 12.5 and the g:Profiler version current that
day.
```

## What you need

- AnnZarro running locally ({doc}`../getting-started/quickstart`) with `bm_aging.zarr` in its
  data directory.
- Network access from your browser to `mygene.info`, `version-12-5.string-db.org` and
  `biit.cs.ut.ee` (g:Profiler).
- These fields:

| Slot | Key | Used for |
|---|---|---|
| `var` | `kompot_de_Young_to_Old_mahalanobis`, `kompot_de_Young_to_Old_mean_lfc` | the volcano, and two thresholds on it |
| `var` | `kompot_de_Young_to_Old_is_de` | Kompot's call: differentially expressed at 5% FDR (Yes or No) |
| `layers` | `kompot_de_Young_to_Old_fold_change` | each gene's fold change in one chosen HSC |
| `var` | `gene_ids` | the Ensembl ids the panel sends |

::::{dropdown} Start here: a gene table of two var columns beside a volcano linked to it
```{literalinclude} ../_static/panelsets/tutorials/gene-set-analysis-start.url.txt
:language: text
```
Panel set file: {download}`gene-set-analysis-start.json <../_static/panelsets/tutorials/gene-set-analysis-start.json>`.
The link is ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

(tut-gsa-define)=
## 1. Define the set in a gene table

The set: genes that go up with age in the volcano's upper right corner, that Kompot calls
differentially expressed, and that also rise in one chosen haematopoietic stem cell.

1. Open `bm_aging.zarr`. Set **Focused Gene** to `H2-Q7` and **Focused Cell** to
   `HSPC_Old_1#GAAGCCCGTGGCTCTG-1` (type `GAAGCCCGTGGCTCTG` and pick it).
2. Add a **Gene Table** with the `var` columns `kompot_de_Young_to_Old_mahalanobis` and
   `kompot_de_Young_to_Old_mean_lfc`, and a **Gene Plot** volcano (**X** the mean log fold
   change, **Y** the Mahalanobis distance) whose **Table** is the gene table
   ({doc}`../user-guide/tables-and-filters`). The start link has both.
3. Open the table's controls. On the `var` tab tick `kompot_de_Young_to_Old_is_de`. On the
   `layers` tab tick `kompot_de_Young_to_Old_fold_change: HSPC_Old_1#GAAGCCCGTGGCTCTG-1 (focused)`.
   Press **Apply Changes**. The new column is named after the cell and keeps it when you focus
   another one ({doc}`gene-groups`).
4. In **Advanced Search**, add four conditions, one with each **Add Condition**:

| Column | Condition | Value | Genes left |
|---|---|---|---|
| `kompot_de_Young_to_Old_mahalanobis` | Greater Than | `5` | 369 |
| `kompot_de_Young_to_Old_mean_lfc` | Greater Than | `0.05` | 109 |
| `kompot_de_Young_to_Old_is_de` | Equals | `Yes` | 62 |
| `kompot_de_Young_to_Old_fold_change: HSPC_Old_1#…` | Greater Than | `0` | 52 |

The first two are the volcano corner of {doc}`../user-guide/tables-and-filters` (109 genes); the
label and the cell's column narrow it to 52.

```{figure} ../_static/screens/tutorials/gene-set-analysis-set.png
:class: screenshot
:alt: The gene table with five columns and four conditions, 52 entries, beside the volcano with the 52 genes coloured by their fold change in the HSC and the rest grey.

The set: 52 genes, in the table and on the volcano.
```

(tut-gsa-panel)=
## 2. Add the Gene Set Analysis panel, and check IDs and Species

1. In the bottom selector, click **Gene Set Analysis**. The new panel follows the gene table by
   itself: **Source** names the table, and the button reads **Run · 52 genes**.
2. Check **IDs**. **Auto** found the `var` column `gene_ids` and reads its values as Ensembl
   ids. The panel sends these rather than the gene symbols of the index, because ids are
   unambiguous across services.
3. Check **Species**. It reads "Auto: Mus musculus (from Ensembl IDs)": the `ENSMUSG` prefix of
   the ids says mouse. For a dataset whose ids do not say, type the species or its taxonomy id
   here.

```{figure} ../_static/screens/tutorials/gene-set-analysis-controls.png
:class: screenshot
:alt: The panel's controls: Source "Up in old, DE, rising in the HSC", IDs "Auto: gene_ids" read as "Auto: Ensembl ids", Species "Auto: Mus musculus (from Ensembl IDs)", and Run · 52 genes.

What the panel will send, before anything is sent.
```

(tut-gsa-consent)=
## 3. Agree to what is sent

1. Press **Run · 52 genes**. Before the first request, the panel lists every service and exactly
   what it would receive:
   - `mygene.info` (MyGene.info): the focused gene, `ENSMUSG00000060550`, and taxon 10090;
   - `version-12-5.string-db.org` (STRING): 52 gene ids and taxon 10090, plus the dataset's
     16,285 genes as the background;
   - `biit.cs.ut.ee` (g:Profiler): 52 gene ids and the species, plus the dataset's 16,285 genes
     as the background.

   Nothing else leaves the browser: no dataset name, no cell data, no address of the page.

```{figure} ../_static/screens/tutorials/gene-set-analysis-consent.png
:class: screenshot
:alt: The consent bar with the three services and what each receives, and the buttons Send, Always send to these services, Never and Cancel.

The consent bar.
```

2. Press **Send**. It agrees for this page; **Always send to these services** would also remember
   the answer in this browser, **Never** remembers a no, and **Cancel** sends nothing.

(tut-gsa-results)=
## 4. Read the results

Each section loads on its own and shows its time; the bar then reads "Results for 52 genes from
"Up in old, DE, rising in the HSC" · Mus musculus".

**Enrichment, STRING.** STRING tests the 52 genes against the dataset's 16,285 genes (the
background the consent bar named) and returns 382 enriched terms in 15 categories. Pick
**GO Process** in the category list. Its top terms are antigen processing and presentation (11
of the 90 genes in the term, FDR 3.0e-10), presentation of peptide antigen, and presentation of
endogenous peptide antigen via MHC class I, followed by the response to type II interferon.

```{figure} ../_static/screens/tutorials/gene-set-analysis-string.png
:class: screenshot
:alt: STRING's enrichment section filtered to GO Process (84 terms), led by antigen processing and presentation, with Genes and FDR (within category) columns.

STRING's GO Process terms for the 52 genes.
```

The FDR column is labelled "FDR (within category)" for a reason: STRING corrects its p-values
within each category, not across them. With **All categories** the table pools 15 corrected
lists, and the panel warns that the pooled list has more false positives than the column
suggests. Pick one category to read a corrected list.

**Enrichment, g:Profiler.** g:Profiler's g:GOSt finds 81 terms below its g:SCS threshold of
0.05, also corrected within each source. Its top terms are KEGG's antigen processing and
presentation (10 of 64) and the MHC protein complex in GO:CC.

```{figure} ../_static/screens/tutorials/gene-set-analysis-gprofiler.png
:class: screenshot
:alt: g:Profiler's enrichment section: 81 significant terms, led by KEGG antigen processing and presentation.

g:Profiler's answer for the same 52 genes.
```

**Network, STRING.** STRING draws the 50 genes it knows (2 are not in STRING; **details** lists
them) with their known and predicted interactions at a score of at least 0.40. It finds 120
interactions where 18 would be expected among 50 random genes, a PPI enrichment p below 1e-16:
the set is far more connected than chance. The MHC genes (H2-Q7, H2-Q6, H2-Q4, H2-T22, H2-K1,
H2-Aa, H2-Ab1, H2-Eb1) form the dense cluster with Cd74, Tap1 and Psmb9; Fos, Jun and Junb form a
second one. **Open the interactive network on STRING** opens the same network on STRING's site.

```{figure} ../_static/screens/tutorials/gene-set-analysis-network.png
:class: screenshot
:alt: STRING's network of 50 genes, with 120 interactions, 18 expected at random and PPI enrichment p below 1e-16.

The set's protein network and its PPI enrichment.
```

**Focused gene, MyGene.info.** The card describes the focused gene, not the set: H2-Q7,
histocompatibility 2, Q region locus 7, protein-coding on chromosome 17, with its Entrez,
Ensembl, UniProt and MGI ids. Focus another gene and the card follows it.

```{figure} ../_static/screens/tutorials/gene-set-analysis-card.png
:class: screenshot
:alt: The focused gene card for H2-Q7 from MyGene.info.

The focused gene's card.
```

**Export and links.** Each section's header has **⤓**, which saves its result as CSV. STRING's
`string-enrichment.csv` holds all 382 terms with the columns `category`, `term`, `description`,
`genes_in_input`, `genes_in_background`, `p_value`, `fdr_within_category` and `genes` (the
set's genes in the term), whichever category the table shows. **↗** opens the service's own
page for the same genes. The **Links** section is made in the browser and sends nothing: links
for the focused gene, and **Show list** for one row of links per gene of the set.

```{figure} ../_static/screens/tutorials/gene-set-analysis-links.png
:class: screenshot
:alt: The Links section with the focused gene's links, the whole set's links, and the per-gene table shown.

Links for the focused gene, the whole set, and each gene.
```

(tut-gsa-rerun)=
## 5. Change a threshold and run again

1. In the fourth condition (the HSC's fold change), change `0` to `0.3` and press Tab. The table
   keeps 38 genes.
2. The panel does not send anything on its own. Its bar turns amber: the selection changed, the
   table now has 38 genes, and the results shown are for 52. The run button now reads
   **Refresh · 38 genes**.

```{figure} ../_static/screens/tutorials/gene-set-analysis-stale.png
:class: screenshot
:alt: The amber bar: Selection changed, the table now has 38 genes; results are for 52; a Refresh 38 genes button.

Stale results say so.
```

3. Press **Refresh · 38 genes**. The services agreed to in step 3 are asked again without a new
   question, for this page. The bar reads "Results for 38 genes".

```{figure} ../_static/screens/tutorials/gene-set-analysis-rerun-bar.png
:class: screenshot
:alt: The bar after the rerun: Results for 38 genes.

The results for the new set.
```

After a rerun the category list starts again at **All categories**; pick **GO Process** again.
Antigen processing and presentation stays at the top (9 of 90, FDR 3.1e-8), and the network has
59 interactions among the 36 genes STRING knows, against 9 expected (p below 1e-16).

```{figure} ../_static/screens/tutorials/gene-set-analysis-string-rerun.png
:class: screenshot
:alt: STRING's GO Process terms for the 38 genes.

GO Process for the 38 genes.
```

To have the panel follow the table without pressing Refresh, turn on **Auto-update**
({doc}`gene-groups` uses it).

(tut-gsa-views)=
## Open the views

::::{dropdown} The set with its Gene Set Analysis panel (steps 1 to 4)
```{literalinclude} ../_static/panelsets/tutorials/gene-set-analysis-results.url.txt
:language: text
```
Panel set file: {download}`gene-set-analysis-results.json <../_static/panelsets/tutorials/gene-set-analysis-results.json>`.
::::

Opening the link restores the table, its conditions and the panel, and sends nothing: press
**Run** and agree to the services again.

The screenshots are made by `docs/_tools/shoot_gene_set_tutorial.py`, which performs each step in
a headless browser against the live services and checks the counts on the way.

## What you learned

- A gene set is whatever passes a gene table's filter: `var` thresholds, a stored label, and a
  column taken from a chosen cell.
- The Gene Set Analysis panel sends the set's ids, the species and the background to external
  services only after you agree, and lists exactly what goes where.
- STRING's and g:Profiler's FDRs are corrected within each category or source; read one at a
  time.
- A changed set makes the results stale, visibly; Refresh (or Auto-update) asks again.
