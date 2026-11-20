(search-datasets)=
# Searching datasets

The dataset browser ({ref}`dataset-browser`) has one search box. Typed into it, a word finds datasets by
their name, and with **Descriptions** on (the default) also by what they say about themselves and by what
they contain: the names of their fields. A search for `donor counts` finds the datasets that have something
named like `donor` and something named like `counts`, in any field.

## What is searched

| Kind | What it matches | Label in a hit |
|---|---|---|
| Name | The dataset's name and folder path | |
| Description | The attribution (title, authors, description, citation and the rest of {doc}`../deployment/dataset-attribution`) | The field's own name |
| README | The first 64 KB of the dataset's README | `README` |
| Cell column | Column names in `obs` | `obs column` |
| Gene column | Column names in `var` | `var column` |
| Embedding | Keys of `obsm` | `embedding (obsm)` |
| Layer | Keys of `layers` | `layer` |
| Other slots | Keys of `varm`, `obsp` and `varp` | `varm`, `obsp`, `varp` |
| `uns` | The paths below `uns`, to three levels (`donor_metadata/age`), without the dataset's own attribution and README | `uns` |

Only names are searched, never the values: a cell type is not found by `T cell`, only a column called
`cell_type` is found by `cell_type`.

Every word of the query must occur somewhere in the dataset, in any of these places, ignoring case. A word
matches inside a name, so `umap` finds `X_umap`. A phrase in double quotes must occur as written. A query holds at most
8 words and 200 characters. The **Descriptions** toggle (**Alt+D**) switches the search of descriptions, READMEs and field
names on and off; with it off, the box matches names only. The datasets whose name matches stay at the top; the rest are
listed below them under **Found in titles, attribution and READMEs**.

## Reading a hit

Each hit is a row of the list, with one line under its name for every kind that matched. The line starts with the
kind's label and then the matching names, with the matched part marked. A line lists at most five
names and then says how many more match (`+12 more`). A dataset whose names were many enough to be capped (see below) ends the line with
`(field list shortened)`.

A dataset matched by a field name and by its README shows both lines, the field names first. Names count
for more than the README and less than the title and the description; among names, columns of cells, embeddings and layers count for more than
the rest. A word that is a whole name, as `leiden` is for a column called `leiden`, counts double. The dataset
you have open comes first when it matches.

On a field-name hit, **Show field** opens the dataset's information dialog on **Structure**
with the word already in its filter, so you see the field in place, with its type and shape. It is a button in the row's tab
order. On a narrow screen it is a link at the end of the line. **Enter** on a row opens the dataset, as without a search.

A search that finds nothing says "No dataset has a name, description or field matching 'donr'."

The dataset that is open is always searched for its field names from the structure the page already holds, so it
matches at once, before the server has read it, and also when it is a remote dataset.

## What to expect

- **A name appears a little after it is written.** The server reads the names of every dataset it can list in the
  background, once after it starts and again for what has changed. While it still does that, the browser says
  "Field names are still being indexed: 41 of 212 datasets read. Results may be incomplete." A query with no
  hit then says "No dataset matches yet: field names are still being indexed", and not that nothing matches.
- **After an upgrade to 0.8.0 every dataset is read once more**, because the index now holds names. The line above
  shows while it runs; the search itself works throughout.
- **Remote datasets are not read** by the server, so they are not found by their fields, except while they are open.
- **A dataset edited without writing its listing again can show old names.** The server reads the names from
  the store's consolidated listing (`.zmetadata`) and does not check it against every file. A column added with `zarr`
  directly is not in it until you run `zarr.consolidate_metadata` on the store; writing the store with AnnData
  rewrites it. A dataset is read again when its listing or one of its slot
  folders (`layers`, `obsm` and the others) changes.
- **Very wide datasets are cut.** The index keeps at most 500 names of each kind and 16 KB of names for a
  dataset, the lightest kinds first to go. A hit says so with `(field list shortened)`.
- **You find only what you may open.** The names of a dataset are told to people who can open that dataset and
  to nobody else, as for its title and README.

An administrator can turn the search off and sets its limits: see {ref}`admin-text-search`. For searching the
fields of the dataset that is open, with its own filter, see the Structure tab in {doc}`../deployment/dataset-attribution`.
