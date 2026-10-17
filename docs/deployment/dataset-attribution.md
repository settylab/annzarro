(dataset-attribution)=
# Dataset information and attribution

A dataset can carry its own licence, citation and description. AnnZarro shows them behind the
**Dataset information** button next to the open dataset's name and in the details pane of the dataset
browser, so a visitor of a public site sees who made the data and on what terms they may use it. The
information lives in the dataset, not in the server's configuration: it travels with the store.

This page is for the people who publish datasets and the people who host them. It covers what to
write into a dataset, what AnnZarro shows, and who is responsible for what.

## What a visitor sees

The **Dataset information** button (an "i" icon) appears in the dataset bar while a dataset is open.
It opens a dialog with three tabs.

| Tab | Content |
|---|---|
| **About** | Title, description, licence (linked), authors, attribution, citation with a **Copy citation** button, DOI, source and contact. |
| **README** | The dataset's `uns["README"]`, rendered as Markdown (see "The README" below). |
| **Structure** | The AnnData layout: number of cells and genes, the `obs` and `var` columns with their types, the keys of `obsm`, `varm`, `obsp`, `varp` and `layers` with their shapes, encodings and, for sparse matrices, the number of stored values and density, `raw` (marked as not shown in plots), the tree of `uns` (a dataframe or categorical there is one line, not its parts), groups AnnZarro does not know, and the limits applied. Categoricals show their first ten labels with the colours from `uns["<column>_colors"]` and warn when the colour count differs from the category count. |

Each tab is read from the server when it is first shown, with a loading indication; a failure is
said in words and offers **Try again**. Nothing is read before someone opens the dialog. The
dataset browser's details pane shows the same attribution under the facts of a store, with the
README and the structure as sections that load when you open them. A dataset that records no
attribution and has no README adds nothing to the pane.

Everything is read from metadata: AnnZarro never reads the expression matrix for this, so it is fast
on a store of any size, local or remote, and it needs no network access beyond the AnnZarro server
itself. The desktop app shows the same for the files it opens; links in the information open in the
system browser.

## Where to write it: `uns["annzarro"]`

Put the attribution in `adata.uns["annzarro"]`, a dictionary of text values, and the description in
`adata.uns["README"]`, a single Markdown string. All fields are optional; write what you have.

| Key of `uns["annzarro"]` | Content |
|---|---|
| `title` | A short title. |
| `description` | One or two sentences about the data. Shown as plain text. |
| `license` | An [SPDX identifier](https://spdx.org/licenses/) such as `CC-BY-4.0`, `CC0-1.0` or `MIT`, or the licence in words. A known identifier is linked to its text. (`licence` is accepted too.) |
| `license_url` | A link to the licence, for a licence of your own or one that has no identifier. |
| `citation` | How to cite the data, as you want it cited. |
| `doi` | The DOI of the data or its paper: `10.1234/abcd`, `doi:10.1234/abcd` or the `https://doi.org/` link. It is shown as a link. |
| `authors` | A list of names, or one string. |
| `source_url` | Where the data came from (`http://` or `https://`). |
| `contact` | An email address or a web address. |
| `attribution` | The credit the licence asks for, for example "Liver Consortium, 2026". |

Only `http://`, `https://` and `mailto:` addresses become links; anything else (a `javascript:`
address, for instance) is not shown as a link. A text longer than 16 KB is cut. A value that is not
text (a number, a nested group) is ignored.

For datasets that other tools wrote, AnnZarro falls back on keys they already use: `uns["title"]`,
`uns["citation"]`, `uns["license"]`, `uns["doi"]` and `uns["description"]`. A dataset from CZ
CELLxGENE Discover shows its title and citation this way. `uns["annzarro"]` wins where both exist,
and the dialog says when a field was taken from the fallback.

### With Python

```python
import anndata as ad

adata = ad.read_h5ad("liver.h5ad")          # or ad.read_zarr("liver.zarr")
adata.uns["annzarro"] = {
    "title": "Liver atlas",
    "description": "Single cells of the adult human liver.",
    "license": "CC-BY-4.0",
    "citation": "Doe J, Roe J. A liver atlas. Nature 2026.",
    "doi": "10.1234/abcd",
    "authors": ["Jane Doe", "John Roe"],
    "source_url": "https://example.org/liver",
    "contact": "data@example.org",
    "attribution": "Liver Consortium, 2026",
}
adata.uns["README"] = open("README.md", encoding="utf-8").read()
adata.write_zarr("liver.zarr")               # or adata.write_h5ad(...)
```

### With the command line

For a zarr store that is already written, `annzarro store annotate` writes the same fields in place,
without loading the matrices, and keeps the other `uns` entries:

```bash
annzarro store annotate liver.zarr \
    --title "Liver atlas" --license CC-BY-4.0 --doi 10.1234/abcd \
    --author "Jane Doe" --author "John Roe" \
    --citation "Doe J, Roe J. A liver atlas. Nature 2026." \
    --readme README.md
```

Only the fields you give are written; run it again to change one. It works on a local zarr store
(format 2 or 3), re-consolidates the store's metadata when it had been consolidated, and refuses a
README over 256 KB. An `.h5ad` file is annotated with anndata as above. See
{doc}`../reference/cli`.

## The README

`uns["README"]` is rendered as Markdown by a renderer that cannot produce active content: the text
is escaped first, and only a small set of constructs is turned back into markup.

Supported: paragraphs, headings (`#` to `######`), bullet and numbered lists (one level), `**bold**`,
`*italic*` and `_italic_`, `` `code` `` and links `[text](address)` with an `http://`, `https://` or
`mailto:` address. Links open in a new tab (in the desktop app, in the system browser).

Not supported, and shown as the text you wrote: raw HTML (`<b>`, `<img>`, `<script>` and the
rest appear literally), images (`![alt](url)`), tables, nested lists, and links with any other
address. This is deliberate. A dataset on a public site is content of someone else, and the page
must not run it. Entities such as `&amp;` are shown as typed.

AnnZarro shows the first 256 KB of a README and says when it cut it. A README that is not one
text string (a number, a list) is not shown; the tab says so.

## Licences and attribution are the host's duty

AnnZarro displays what the dataset records. It cannot check that the licence is true, that you may
serve the data, or that the citation is right.

If you host a public site, you are responsible for the datasets on it:

- Serve only data you have the right to serve, and honour the licence's conditions. Most open
  licences, `CC-BY-4.0` among them, require that the creator is credited; the information dialog
  and the details pane are where AnnZarro does that, so give every dataset a `license`, an
  `attribution` (or `citation`) and a `doi` or `source_url` where one exists.
- A dataset without a licence is not free to reuse: say so with `license` ("All rights reserved,
  shown with permission of the owner") rather than leaving it blank.
- Read a dataset's README before you publish it: it is shown to every visitor. The renderer keeps
  it from running anything, but it cannot judge its content.
- Where a store is read-only or remote and you cannot rewrite it, tell visitors where the terms
  are in your site's own pages; AnnZarro reads the attribution of a remote store from the store
  itself.

## How the server reads it

`GET /api/v1/datasets/info?path=&parts=about,readme,structure` ({doc}`../reference/http-api`) returns
the parts asked for. It reads group listings, attributes, shapes and the few text values above,
never `X` or any matrix, from `.h5ad` files, zarr format 2 and 3 (sharded or not) and remote stores
(through the same opener and the same remote-store policy as the dataset browser). A text value is
read only after the store has said how big it is; one stored over 8 MB is not read.

It follows the dataset browser's access rules: a user sees the information of a dataset only where
they may open it, and a dataset they may not read answers as one that does not exist. The reply
carries the store's name and never its path. Answers are cached by the store's file times, so a
store annotated while the server runs shows the change at the next request.
