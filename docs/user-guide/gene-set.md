# Gene set analysis

A **Gene Set Analysis** panel follows a gene table. It takes the genes passing the table's search
and filter (the same genes a plot linked to the table shows) and the focused gene, and asks
external services about them: functional enrichment, the protein network, what each gene is, and
links to the pages that describe them. Each service is one **section** of the panel and fails on
its own. The **Links** section is made in the browser and works offline.

Nothing is sent until you press **Run**. Opening AnnZarro, a share link, a panel set or a saved
session sends nothing, unless the panel's auto-update is on and every service it needs is already
agreed to (see [Consent](#gene-set-consent)).

This page uses the volcano filter of {doc}`tables-and-filters` on `bm_aging.zarr` (mouse): the
109 genes with Mahalanobis distance above 5 and a mean log fold change above 0.05.

## Run it on a table's genes

1. Filter a **Gene Table** to the genes you want.
2. Add a **Gene Set Analysis** panel. It follows the first open gene table by itself; pick
   another under **Source** if you have several (a closed table is listed as "(closed)"). With
   no gene table at all, the panel says "No gene table yet": add one with **Create New Panel** →
   **Gene Table**, and the panel follows it as soon as it is made.
3. Check **IDs** and **Species** (below), then press **Run · *n* genes**.

```{figure} ../_static/screens/user-guide/geneset-not-run.png
:class: screenshot
:alt: The panel's controls: Source "Up in old, Mahalanobis > 5", IDs "Auto: gene_ids" read as "Auto: Ensembl ids", Species "Mus musculus (mouse) · 10090", Run · 109 genes, Auto-update, Sections; the bar "Not run yet"; the Links section and the sections, not run.

Before the first Run: the source table, the ids found in it, and what Run will send.
```

4. The first time, the panel lists every service it is about to contact and what it sends ("109
   gene ids and taxon 10090, plus the dataset's 16,285 genes as the background"). **Send** sends
   it for this page, **Always send to these services** also remembers the answer in this
   browser, **Never** remembers a no, **Cancel** sends nothing.

```{figure} ../_static/screens/user-guide/geneset-consent.png
:class: screenshot
:alt: The consent bar listing mygene.info, version-12-5.string-db.org and biit.cs.ut.ee with what each would receive, and the buttons Send, Always send to these services, Never and Cancel.

The question before anything is sent.
```

5. Each visible section loads on its own; the bar reads "Results for *n* genes from *table* ·
   *species* · *time*".

```{figure} ../_static/screens/user-guide/geneset-overview.png
:class: screenshot
:alt: The gene table filtered to 109 genes beside the Gene Set Analysis panel with its Links, the focused gene's card and STRING's enrichment.

The table's 109 genes, and what the services say about them.
```

What leaves the browser is the gene ids, the species, the section's settings and, for the
enrichments, the dataset's genes as the background. Never the dataset's name or path, cell data,
or the address of the page: requests carry no referrer and no cookies, and gene lists travel in
the body of a request, not in its URL.

## Gene identifiers

**IDs** is the `var` column whose values are sent and linked. **Auto** looks for one, in this
order and in any capitalisation: `gene_id`; `gene_ensembl_id`, `ensembl_id`, `gene_ids`;
`gene_name`; `gene_symbol`, `symbol` (and common variants such as `feature_name`), else the var
index. `bm_aging.zarr` has `gene_ids`, so Auto takes its Ensembl ids rather than the symbols of
the index.

The second list says how the values are read: **gene names (symbols)**, **Ensembl ids** or
**Entrez ids**. **Auto** decides from the values (`ENS…`, `FBgn…` and `WBGene…` are Ensembl
ids, digits are Entrez ids, the rest are names). Each service is asked the way it understands:
STRING and g:Profiler map the ids themselves (g:Profiler is told that bare numbers are Entrez
ids), MyGene.info looks them up in the matching field, and Enrichr, which takes only symbols,
says so when the column holds ids. Ensembl ids are sent without their version (`ENSG….16`).
Both choices are saved with the panel and in share links; changing either makes the results
stale.

## Sections

Click a section's header, or use **Sections**, to show or hide it. Only visible sections are
fetched; a section shown after a Run is fetched then, for that Run's genes. Each header has the
section's settings (gear), **⟳** (fetch again), **↗** (the service's own page for the same
genes) and **⤓** (the result as CSV).

| Section | Service | Shows | Default |
|---|---|---|---|
| Focused gene | MyGene.info | name, type, location, aliases, summary and the gene's ids in other databases | on |
| Enrichment | STRING 12.5 | enriched GO, KEGG, Reactome, WikiPathways, ... terms, with FDR | on |
| Enrichment | g:Profiler | g:GOSt enrichment over the chosen sources, with g:SCS (or FDR, Bonferroni) | on |
| Network | STRING 12.5 | the protein network as an image, and its PPI enrichment (edges against those expected at random) | on |
| Gene lookup | MyGene.info | every gene's symbol, name, Entrez and Ensembl id | on |
| Interaction partners | STRING 12.5 | the focused gene's partners, with scores per evidence channel | off |
| Expression and location | Human Protein Atlas | the focused human gene's tissue and single-cell type specificity, subcellular location | off |
| Enrichment | Enrichr | enrichment against an Enrichr library (CellMarker, PanglaoDB, MSigDB Hallmark, ...) | off |
| Pathways | Reactome | pathway over-representation; other species are projected to human pathways | off |

```{figure} ../_static/screens/user-guide/geneset-string-enrichment.png
:class: screenshot
:alt: STRING's enrichment section: the number of enriched terms, a category filter, a table of category, term, genes and FDR, the genes STRING did not know, and the status line "of 109 genes shown".

STRING's enrichment against the dataset's genes. The line under the result says how many of the
genes STRING knew; **details** lists every gene it did not know, with **Copy** (one per line) and,
for a long list, a search.
```

**FDR within each category.** STRING corrects its p-values (Benjamini-Hochberg) within each
category, not across them, and returns only the terms that pass. With **All categories**, the
table pools several categories and the panel says so: expect more false positives than the FDR
column suggests, and pick a category for a corrected list. The column is labelled "FDR (within
category)", in the CSV too. g:Profiler likewise corrects within each source; its table carries
the same note when it shows several. Nothing is recomputed in the browser: a pooled correction of
only the terms that passed would be wrong.

```{figure} ../_static/screens/user-guide/geneset-network.png
:class: screenshot
:alt: STRING's network of the genes it knew, with the number of interactions, the number expected at random and the PPI enrichment p-value above it.

The network, and whether its genes interact more than a random set of the same size would.
```

Every section says how many of the genes the service knew, once, in the line under its result.
When a service knows none of them, the section says so and names the species it was asked for:
"STRING knows none of these 165 genes for Homo sapiens (taxon 9606). Is the species right? The
dataset's genes look like Caenorhabditis elegans (taxon 6239)." That is almost always the
species, or ids the service does not read (check **IDs**). MyGene.info's gene lookup tries the
symbols it does not find again as aliases and marks those matches **alias**: an alias can be
another gene's symbol, so they are never mixed in silently.

```{figure} ../_static/screens/user-guide/geneset-card.png
:class: screenshot
:alt: The Focused gene section: H2-Q7, its name, type, location, aliases, summary and its Entrez, Ensembl, UniProt and MGI ids.

The focused gene's card. Its ids turn the focused gene's links into direct ones.
```

### Enrichment background

The STRING and g:Profiler enrichments compare the genes with **this dataset's genes** by
default: every gene of `var`, through the same ID column and type. For a single-cell dataset that
is the right comparison (a gene that was not measured cannot be enriched). **Whole genome** is
the other choice, in each enrichment section's settings. The background can be large (30,000
genes): STRING maps it to its own ids once per page for a dataset and species (about 40 s for
30,000 genes), and the section says so while it maps. Enrichr compares with its library's genes
and Reactome with the genome; neither takes a dataset background, and their sections say so.

### Limits

A list over a service's limit is not sent, and not cut to fit either: an enrichment of the first
3,000 of 16,285 genes would be a different statistic. The section shows the limit and **Try
anyway**, which sends the whole list; if the service refuses it, its own message is shown in that
section. STRING draws networks of up to 2,000 genes, the enrichments take up to 3,000, the gene
lookup 5,000.

```{figure} ../_static/screens/user-guide/geneset-limit.png
:class: screenshot
:alt: STRING's enrichment section with every gene of the dataset selected: "16,285 genes; STRING enrichment accepts at most 3,000. Filter the table to fewer genes, or try anyway." and a Try anyway button.

Every gene of the dataset selected: nothing is sent until you choose to.
```

**Enrichr and Reactome keep what they are sent.** Enrichr stores every list under a number that
anyone can read; Reactome keeps the result under a token that can be guessed. Both are off by
default, and the panel asks before every page's first request to them, with that warning.

## When the table changes

**Auto-update** is off by default. A changed selection, species or IDs then turns the bar into a
warning, and every section keeps its result, dimmed and marked **stale**. **⟳ Refresh** in the
bar takes the table's genes again and fetches every visible section whose input changed.

```{figure} ../_static/screens/user-guide/geneset-stale-bar.png
:class: screenshot
:alt: The bar: Selection changed, the table now has a different number of genes; results are for 109; and a Refresh button.

The table was filtered differently after the Run.
```

With **Auto-update** on, the panel refreshes after each change of the table; a burst of changes
(typing in the table's search) makes one refresh. Sections about the focused gene follow the
focus in the same way.

(gene-set-consent)=
(gs-consent)=
## Consent

Whether gene ids may be sent to a service is decided in the browser, within what the server
allows. The first rule that applies wins:

1. **The server.** An administrator's `integrations.external_requests: off` sends nothing, ever;
   `on` sends without asking ({doc}`../reference/configuration`). The default, `ask`, leaves it
   to the rules below.
2. **Your "Never"** for a service, remembered in this browser. The section says so, with **Ask
   again**.
3. **A share link's consent, for its selection only.** When you agreed to send a selection, the
   panel's settings record the services and that selection (as a hash of its genes); a share link
   or panel set made then carries it, so whoever opens it is not asked again for exactly those
   genes. Filter the table differently, or change the species or IDs, and the link's consent no
   longer applies.
4. **Your "Send"** for this page, or **"Always"** for a service, remembered in this browser.
5. Otherwise the panel asks.

Enrichr and Reactome are never covered by a link or by "Always". Opening a link or a session
sends nothing unless auto-update is on and every service is agreed to by these rules; otherwise
the panel waits for **Run**.

**One more request, only after a failure.** When a request you agreed to fails without any
answer (fetch gives the browser's bare network error), the panel makes one plain `GET` of that
same host's root (`https://host/`, for example `https://mygene.info/`) to tell "could not connect"
from "the browser blocked the reply" ({ref}`gs-when-a-service-fails`). It carries nothing: no
genes, no query, no body, no cookie and no referrer, and its reply is not read. It goes only to a
host you already agreed to send to, once per failed attempt, and never when the browser is
offline or the server has external requests turned off.

## Links

The **Links** section sends nothing until you click a link, and works on a server with external
services turned off, offline, and in the desktop app (links open in the system browser).

- **Focused gene:** every resource that covers the species (NCBI Gene, Ensembl, UniProt, STRING,
  GeneCards, the Human Protein Atlas, GTEx, Open Targets, OMIM, ClinVar, KEGG, Reactome,
  WikiPathways, the Alliance of Genome Resources, MGI, RGD, ZFIN, FlyBase, WormBase, SGD,
  Harmonizome, ARCHS4, PubMed, Google Scholar). With the gene's card in, the links go to the
  gene's own pages instead of searches.
- **Selected genes:** links for the whole selection (a STRING network, g:Profiler, NCBI Gene,
  UniProt, GeneMANIA, PubMed for up to 5 genes); one too long for a link is greyed out, with the
  reason. **Show list** lists every gene with one link per resource (choose them under
  **Columns**), 50 per page, in a table that scrolls on its own; **Hide list** is above and below
  it. Click a gene to focus it. **Copy ids** and **Download links CSV**
  take the whole list.

```{figure} ../_static/screens/user-guide/geneset-links.png
:class: screenshot
:alt: The Links section: the focused gene's links, the whole set's links, and the list of selected genes with a link column per resource.

The focused gene's links, and the list of the selection.
```

## Species

The species belongs to the dataset: picking one in the panel changes it for the app, and share
links and panel sets keep it. When nobody chose one (not you, not the link or panel set), the
panel finds it in the dataset: an `uns` entry named `taxonomy_id`, `taxid`, `species` or
`organism`, else the prefix of the gene ids in the ID column, the var index, or another column
of ids such as `gene_ids` or `wbgene`: `ENSG` human, `ENSMUSG` mouse, `ENSRNOG` rat, `ENSDARG`
zebrafish, `FBgn` fly, `WBGene` worm, and so on. The field then reads, for example,
"Auto: Mus musculus (from Ensembl IDs)". Without either (symbols, no `uns` entry) the server's
default stays, marked "(default, not checked)" with a note to check it; such a default is not
saved in links. Your pick always wins.

Type a name, a common name or a taxonomy id. Twelve species are
listed without asking anyone (human, mouse, rat, zebrafish, fly, worm, yeast, Arabidopsis,
Xenopus, pig, macaque, chicken), a number is taken as a taxonomy id, and **Search NCBI Taxonomy
for "..."** asks NCBI (only the text typed) for anything else. Sections whose service does not
cover the species say so instead of fetching.

(gs-when-a-service-fails)=
## When a service fails

A section that cannot get its result says which of these happened, in its place, with **Retry**,
and the others are not affected:

| What happened | What the section says |
|---|---|
| The browser is offline | "this browser is offline" |
| No connection to the service: no network, the address does not resolve, the service is down | "could not connect to *host*: no network, the address did not resolve, or the service is down" |
| The service answered, but the browser kept the reply from the page: the service does not allow this site (CORS), or a browser setting or extension blocks it | "*host* answered, but the browser blocked its reply …" |
| No answer within `integrations.gene_set.timeout_ms` (20 s by default) | "timed out after 20 s: *host* did not answer in time" |
| Too many requests (HTTP 429) | "*host* is limiting how often it may be asked (HTTP 429)" |
| The service is down or overloaded (HTTP 502, 503, 504) | "*host* is down or overloaded (HTTP 503); try again later" |
| An error on the service's side (another 5xx) | "*host* failed on this request (HTTP 500, …)" |
| An address the service does not serve (HTTP 404, 410): its API moved, or the STRING version asked for is retired | "*host* has no such address (HTTP 404) …" |
| The service rejected the request (another 4xx) | "the service rejected the request (HTTP 400): …" |

A section says the service knows none of the genes only when the service answered that: STRING's
"did not find any matches", Reactome's own "not found" reply, or a reply in which every gene
failed. Any other 404 is an address that is not there, not an answer about the genes.

To tell no connection from a blocked reply, the panel asks the same host once more for its root
page, without reading the reply and without sending anything of the request (see {ref}`gs-consent`). A timeout, no connection, a 429 and a 5xx are tried once more automatically; then
**Retry** tries again. A browser that is offline before **Run** says so, and the Links still work.
In the desktop app the panel asks before anything is sent, exactly as in a browser.

## Settings kept with the panel

Share links and panel sets keep the panel's source table, IDs and how they are read, auto-update,
which sections are shown and their settings, the Links list's columns, and the consent for the
current selection (see {doc}`../reference/deep-links`). They never keep the genes or the results.

The screenshots on this page are made by `docs/_tools/shoot_geneset.py`, which asks the services
for real.
