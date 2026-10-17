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

The Structure tab has a search box at its top. It filters column names, keys, `uns` paths, types and
category labels as you type, marks the matched text, opens the sections that hold matches, counts them
per section and in total, and keeps the path to a nested `uns` key. The `.*` button reads the query as
a regular expression and `Aa` matches case. Both choices are remembered by the browser. An invalid
expression is named below the box and the last result stays; a pattern that repeats a repeat, such as
`(a+)+`, or one that takes too long is refused. **Escape** clears the search (a second press closes the
dialog), and `/` or **Ctrl/Cmd+F** moves to the box. Only the items the tab lists are searched; a
section cut at its limit says so. The dataset browser's details pane has no search.

Everything is read from metadata: AnnZarro never reads the expression matrix for this, so it is fast
on a store of any size, local or remote, and it needs no network access beyond the AnnZarro server
itself. The desktop app shows the same for the files it opens; links in the information open in the
system browser.

## Where to write it: `uns["annzarro"]`

Put the attribution in `adata.uns["annzarro"]`, a dictionary, and the description in
`adata.uns["README"]`, a single Markdown string. All fields are optional; write what you have.

(dataset-info-schema)=
### The schema, version 1.0

The dictionary is a versioned format, `annzarro.dataset-info`. Two plain text keys mark it:

```python
adata.uns["annzarro"] = {
    "schema": "annzarro.dataset-info",
    "schema_version": "1.0",
    # ... the fields below
}
```

The marker is two ordinary values, not attributes, because anndata writes a nested `uns` dictionary
as plain values in zarr format 2, zarr format 3 and h5ad and keeps them; the `encoding-type` and
`encoding-version` attributes are anndata's own (it sets them on every group it writes), so a dictionary
you assign cannot carry them. `annzarro store annotate` writes the marker at the version it
knows. **A dictionary without the marker is version 1**, which is everything written before the marker
existed.

Every field takes its **simple form** (text) and, where it says so, a **richer form** (an object, or a list
of objects). The reader turns both into one shape, so you can start simple and grow, and a dataset
written with a richer form still shows its simple fields in an older AnnZarro.

| Key | Forms | Since | Meaning |
|---|---|---|---|
| `title` | text | 1.0 | A short title. |
| `description` | text | 1.0 | One or two sentences about the data. Shown as plain text. |
| `license` | text, or `{id, name, url, text}` | 1.0 | An [SPDX identifier](https://spdx.org/licenses/) such as `CC-BY-4.0`, `CC0-1.0` or `MIT`, or the licence in words. A known identifier is linked to its text. `licence` is accepted too. |
| `license_url` | http(s) URL | 1.0 | A link to the licence, for a licence of your own or one that has no identifier (`licence_url` too). |
| `citation` | text, or `{text}` | 1.0 | How to cite the data, as you want it cited. |
| `doi` | text, or `{id}` | 1.0 | The DOI of the data or its paper: `10.1234/abcd`, `doi:10.1234/abcd` or the `https://doi.org/` link. Shown as a link. |
| `authors` | text, a list of text, or a list of `{name, orcid, affiliation}` | 1.0 | Who made the data. An ORCID iD becomes a link. `author` is accepted too. |
| `source_url` | http(s) URL | 1.0 | Where the data came from. |
| `contact` | text, or `{name, email, url, role}` | 1.0 | An email address, a web address or a name. |
| `contacts` | a list of text, or of `{name, email, url, role}` | 1.0 | Several contacts; `contact` comes first. |
| `attribution` | text | 1.0 | The credit the licence asks for, for example "Liver Consortium, 2026". |
| `funding` | text, a list of text, or a list of `{funder, award, url}` | 1.0 | Who paid for the data. |
| `provenance` | object of text values | 1.0 | How the data came to be: `source`, `processing`, `software`, `date`, `notes` or any other short entries. |

Keys named `views` and `panels` are reserved for curated default views and are not read yet.

A list of objects (`authors`, `contacts`, `funding`) cannot be written by anndata as a list. Write
it as an object keyed `"0"`, `"1"`, ...: AnnZarro reads that as the same list, in numeric order.
`annzarro store annotate` does this for you.

Only `http://`, `https://` and `mailto:` addresses become links; anything else (a `javascript:`
address, for instance) is dropped and listed as ignored. A text longer than 16 KB is cut, a list
at 500 items. A value of the wrong kind (a number where text goes) is ignored, never an error.

For datasets that other tools wrote, AnnZarro falls back on keys they already use: `uns["title"]`,
`uns["citation"]`, `uns["license"]`, `uns["doi"]` and `uns["description"]`. A dataset from CZ
CELLxGENE Discover shows its title and citation this way. `uns["annzarro"]` wins where both exist,
and the dialog says when a field was taken from the fallback.

### Compatibility rules

These hold for every version of the schema, so a dataset written today keeps working.

- **Additive changes raise the minor version** (1.0 to 1.1): a new optional key, or a new accepted
  form of a key. **Renames, removals and changes of meaning raise the major version** (1.x to 2.0).
- **A reader ignores keys it does not know.** They stay in the dataset, are never an error, and are
  listed as `unknown` in the reply of `GET /datasets/info`.
- **A newer minor is read in full:** the reader takes everything it knows and ignores the rest.
- **A newer major is read for the fields that did not change.** The reader of the newest major it has
  is used, whatever fields are still there are shown, and the dialog says that the dataset was written
  for a newer AnnZarro.
- **There is one reader per major version** (`READERS` in `annzarro/core/dataset_schema.py`), so a
  version 2 reader sits beside the version 1 one, and a version 1 dataset is always read by the version 1 reader.
- **The writer and the reader agree:** `annzarro store annotate` writes the current version and refuses
  a value the reader would ignore.

The schema has no separate JSON Schema file: `jsonschema` is not a dependency of AnnZarro, so the
field table above and the tests (`annzarro/tests/core/test_dataset_schema.py`, which checks this table
against the code) are the specification.

### With Python

```python
import anndata as ad

adata = ad.read_h5ad("liver.h5ad")          # or ad.read_zarr("liver.zarr")
adata.uns["annzarro"] = {
    "schema": "annzarro.dataset-info",           # the version marker; without it the dictionary is read as version 1
    "schema_version": "1.0",
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

The richer forms go in a JSON file (`--from-json info.json`, the options override it):

```json
{"license": {"id": "CC-BY-4.0"},
 "authors": [{"name": "Jane Doe", "orcid": "0000-0002-1825-0097"}],
 "funding": [{"funder": "NIH", "award": "R35GM147125"}]}
```

Only the fields you give are written; run it again to change one. It works on a local zarr store
(format 2 or 3), re-consolidates the store's metadata when it had been consolidated, and refuses a
README over 256 KB. An `.h5ad` file is annotated with anndata as above. See
{doc}`../reference/cli`.

## The README

`uns["README"]` is rendered as Markdown by a renderer that cannot produce active content: the text
is escaped first, and only a small set of constructs is turned back into markup.

Supported: paragraphs, headings (`#` to `######`, or a line underlined with `===` or `---`), bullet and
numbered lists (one level), `**bold**`, `*italic*` and `_italic_`, `` `code` ``, links
`[text](address)` with an `http://`, `https://` or `mailto:` address, bare web addresses (`https://...` and `<https://...>`, without the full stop or comma that ends the sentence), pipe tables, code blocks,
horizontal rules and block quotes. Links open in a new tab (in the desktop app, in the system browser).

- **Tables** are GitHub's pipe tables: a header row, a delimiter row (`|---|:---:|---:|` sets left,
  centred and right alignment) and body rows. Cells take bold, italic, code and links; write a
  pipe inside a cell as `\|`. Rows with too few cells are padded and rows with too many are cut. A
  table shows at most 500 rows and 30 columns and says how many rows it left out. A table wider than
  the dialog scrolls sideways inside its own box.
- **Code blocks** are fenced with three backticks or tildes (a language word after them is ignored) or
  indented by four spaces or a tab. They are shown as plain text with no highlighting, at most 2,000
  lines. An indented line starts a code block even right under a line of prose, where Markdown
  would continue the paragraph; right under a list item it continues the item.
- **Rules** are a line of three or more `-`, `*` or `_`. A block quote starts each line with `>`.

Not supported, and shown as the text you wrote: raw HTML (`<b>`, `<img>`, `<script>` and the
rest appear literally), images (`![alt](url)`), nested lists, and links with any other
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
