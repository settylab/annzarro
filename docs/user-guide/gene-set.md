# Gene set analysis

A **Gene Set Analysis** panel follows a gene table: it takes the genes passing the table's search
and filter (the same genes a plot linked to the table shows) and the focused gene, and asks
external services about them: functional enrichment, the protein network, what each gene is,
and links to the pages that describe them. Each service is one **section** of the panel and
fails on its own; the **Links** section is made in the browser and works offline.

Nothing is sent until you press **Run**. Opening AnnZarro, a share link, a panel set or a saved
session never contacts a service, whatever the panel's settings.

## Run it on a table's genes

1. Filter a **Gene Table** to the genes you want ({doc}`tables-and-filters`).
2. Add a **Gene Set Analysis** panel. Its **Source** is the first open gene table; pick another
   in the list if you have several. A closed table is listed as "(closed)".
3. Check **IDs** (the column whose values are sent and linked: the var index, or any `var`
   column such as `gene_symbols` when the index holds Ensembl ids; the panel says what kind of
   ids it finds) and **Species**.
4. Press **Run · *n* genes**. The first time, the panel lists every service it is about to
   contact, with what it sends ("6 gene ids and taxon 9606"); **Send** sends it once, **Always
   send to these services** also remembers the answer in this browser, **Cancel** sends nothing.
5. Each visible section loads on its own. The bar above the sections reads "Results for *n*
   genes from *table* · *species* · *time*".

What leaves the browser is the gene ids, the species and the section's settings. Never the
dataset's name or path, cell data, or the address of the page (requests carry no referrer and no
cookies). Gene lists are sent in the body of the request, not in its URL.

## When the table changes

**Auto-update** is off by default. A changed selection, species or ID column then turns the bar
into a warning, "Selection changed: "Gene Table 1" now has 57 genes; results are for 412", and
every section keeps its result, dimmed and marked **stale**. **⟳ Refresh** in the bar (or the
Run button) takes the table's genes again and fetches every visible section whose input changed.

With **Auto-update** on, the panel refreshes after each change of the table; a burst of changes
(typing in the table's search) makes one refresh. Auto-update starts with the first Run after
opening a link or a panel set: a restored panel does not fetch by itself.

Sections about the focused gene follow the focus in the same way: stale until refreshed, or
refreshed at once with auto-update.

## Sections

Click a section's header, or use **Sections**, to show or hide it. Only visible sections are
fetched; a section shown after a Run is fetched then, for that Run's genes. Each header has the
section's settings (gear), **⟳** (fetch again), **↗** (the service's own page for the same genes)
and **⤓** (the result as CSV).

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

Every section says how many of the genes the service knew, in the line under its result ("5 of
10 genes shown · 5 not found in STRING", with the genes under **details**). MyGene.info's gene
lookup tries symbols it does not find again as aliases and marks those matches **alias**: an
alias can be another gene's symbol, so they are never mixed in silently.

**Enrichr and Reactome keep what they are sent.** Enrichr stores every list under a number that
anyone can read; Reactome keeps the result under a token that can be guessed. Both are off by
default, and the panel asks before every page's first request to them, with that warning, and
never remembers the answer.

**Background.** The STRING and g:Profiler enrichments compare the genes with the whole genome by
default. Their settings offer **This dataset's genes** instead: the statistically right
comparison for a single-cell dataset, which also sends every gene of the dataset to the service.

**Limits.** A list over a service's limit is not cut to fit (an enrichment of the first 2,000
of 2,412 genes is a different statistic): the section says how many genes it accepts, and you
filter the table. STRING draws networks of up to 2,000 genes; the enrichments take up to 3,000;
the gene lookup 5,000.

## Links

The **Links** section is made in the browser: it sends nothing until you click a link, and it
works on a server with external services turned off, offline, and in the desktop app (links open
in the system browser).

- **Focused gene:** every resource that covers the species: NCBI Gene, Ensembl, UniProt, STRING,
  GeneCards, the Human Protein Atlas, GTEx, Open Targets, OMIM, ClinVar, KEGG, Reactome,
  WikiPathways, the Alliance of Genome Resources, MGI, RGD, ZFIN, FlyBase, WormBase, SGD,
  Harmonizome, ARCHS4, PubMed and Google Scholar. Once the **Focused gene** section has the
  gene's ids, the links go to the gene's own pages instead of searches.
- **Selected genes:** links for the whole selection (a STRING network, g:Profiler, NCBI Gene,
  UniProt, GeneMANIA, PubMed for up to 5 genes). A list too long for a link is offered greyed
  out, with the reason. **Show list** lists every gene with one link per resource (choose them
  under **Columns**), 50 per page; click a gene to focus it. **Copy ids** and **Download links
  CSV** take the whole list.

The list always describes the table as it is now, also while the results are stale.

## Species

The species belongs to the dataset, not to the panel: picking one in the panel changes it for
the app, and share links and panel sets keep it. Type a name, a common name or a taxonomy id:
twelve species are listed without asking anyone (human, mouse, rat, zebrafish, fly, worm,
yeast, Arabidopsis, Xenopus, pig, macaque, chicken), a number is taken as a taxonomy id, and
**Search NCBI Taxonomy for "..."** asks NCBI (only the text typed) for anything else. Sections
whose service does not cover the species say so instead of fetching.

## When a service fails

A section that cannot get its result says why, in its place, and the others are not affected:
"timed out after 20 s (2 attempts)", "could not reach *host* (offline, blocked, or the service
does not allow this site)", "the service rejected the request (HTTP 400): unknown organism",
"HTTP 503". A timeout, no connection, an error of the service (5xx) or a request to slow down
(429) is tried once more automatically; then **Retry** tries again. A browser that is offline
says so, and the Links still work.

## Settings kept with the panel

Share links and panel sets keep the panel's source table, ID column, auto-update, which sections
are shown and their settings, and the Links list's columns (see {doc}`../reference/deep-links`).
They never keep the genes, the results or your answers to the consent question. An administrator
can turn external requests off for a server, or narrow the services offered
({doc}`../reference/configuration`).
