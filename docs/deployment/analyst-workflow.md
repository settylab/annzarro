# Working on the data while collaborators view it

On a {doc}`lab server <lab-server>`, the people who explore a dataset in AnnZarro and the person
who computes on it can share one store. A computational researcher opens a Jupyter or VS Code
session on the server, adds a field to the store, and clicks **Refresh dataset**; from then on
everyone who views the dataset sees the new field, without a copy, an upload or a restart.

This page walks through one round. It needs:

- **Write access to the store, through your own account.** AnnZarro never writes to a store, and
  its service account should only read it ({ref}`lab-server-data-dir`). You write
  with your login on the server, in the store the data directory links to.
- **An AnnZarro admin account** (`annzarro user add --username alice --admin`,
  {doc}`authentication`), for the cache clear in step 3. Everyone else can still refresh; see
  {ref}`analyst-limits`.

## 1. Compute a field

Open the store with anndata and zarr, compute, and write only the new element with
`ad.io.write_elem`. The example adds a per-cell MHC class I score, the mean log expression of
six genes, to `bm_aging_annzarro.zarr` ({doc}`../data/demo-data`):

```python
import anndata as ad
import numpy as np
import zarr

path = "/lab/atlases/bm_aging_annzarro.zarr"            # the store the data directory links to
g = zarr.open_group(path, mode="r+", use_consolidated=False)
obs = ad.io.read_elem(g["obs"])
var = ad.io.read_elem(g["var"])
counts = ad.io.read_elem(g["layers/logged_counts"])

genes = ["H2-K1", "H2-D1", "H2-Q4", "H2-Q6", "H2-Q7", "B2m"]
cols = [var.index.get_loc(x) for x in genes]
obs["mhc1_score"] = np.asarray(counts[:, cols].mean(axis=1)).ravel().astype(np.float32)
ad.io.write_elem(g, "obs", obs)                # rewrites obs with the new column

zarr.consolidate_metadata(path)                # list the new element in .zmetadata
```

On a copy of the demonstration store this took 0.9 s; the score ranges from 0 to 2.43 (median
1.33). The same pattern writes a layer (`ad.io.write_elem(g["layers"], "name", array)`), an obsm
matrix or an obsp or varp matrix; give large dense arrays chunks as in {doc}`../data/chunking`.

`use_consolidated=False` matters: zarr refuses to edit a store opened through its consolidated
metadata. Prefer `write_elem` for the one element you changed over `adata.write_zarr(path)`,
which rewrites every element of a store others are viewing.

### If you skip `consolidate_metadata`

AnnZarro opens a store through its consolidated metadata (`.zmetadata`). An element written
afterwards is not listed there. **Refresh dataset** notices this, reads the store without the
stale listing from then on, so the new element still shows, and says so in a notice:

> Consolidated metadata out of date. This store's consolidated metadata is out of date:
> obs/mhc1_score is on disk but not in it. AnnZarro now reads the store without it, which is
> slower to open. Run zarr.consolidate_metadata(path) on the store, then Refresh dataset.

Run `zarr.consolidate_metadata(path)` and refresh again to clear it. A request for an array that
was rewritten with another shape or dtype while `.zmetadata` still describes the old one answers
`500 stale_metadata` until then ({doc}`../reference/http-api`).

## 2. Refresh in AnnZarro

In the AnnZarro tab, click **Refresh dataset**, the button right of the **Dataset** menu, or
press **Ctrl+R** (**Cmd+R** on a Mac), which the app takes over from the browser's reload
({doc}`../user-guide/interface`). It:

1. asks the server to check the store against the disk (`POST /api/v1/data/refresh`). If any file
   changed, the server starts a new generation of the dataset: every server process (each
   gunicorn worker) reads it afresh, and every browser's cached replies stop matching;
2. for an admin, also clears the server's cache for the dataset (`POST /api/v1/cache/reset`);
3. reloads the dataset list and reopens the dataset in your tab. `mhc1_score` now appears in
   every obs picker, for example as the colour of a Cell Plot.

Collaborators who already have the dataset open get the new values once their panels read the
dataset again; a **Refresh dataset** in their own tab does that at once and adds the new column
to their pickers.

## 3. Share the view

Build the view that shows the result (say, a UMAP coloured by `mhc1_score` next to a cell table
sorted by it) and give it to collaborators who only read:

- **Save Panel Set** stores it on the server, where every user of this server can load it
  ({doc}`../user-guide/panel-sets`);
- **Share Link** copies a link to it ({doc}`../user-guide/share-links`).

Both name the dataset by its path and the new column by its name, so they keep working as long as
the store keeps the column.

(analyst-limits)=
## Limits

- **A plain browser reload is not enough.** The browser's reload button (or F5) reopens the page,
  but the server answers each read from its tags for the dataset's current generation
  ({ref}`revalidation`). Writing an element with `write_elem` changes the store's directory
  times, which changes those tags; overwriting chunk files in place
  (`g["obs/x"][:] = values`) does not, and both the browser and the server keep serving the old
  values until a **Refresh dataset** finds the change. Use **Refresh dataset** (or Ctrl+R inside
  the app) after every write.
- **A non-admin's refresh re-checks the disk but does not clear the shared cache.** On a hosted
  server, clearing the server's cache is for admins (`POST /api/v1/cache/reset` answers
  `403 admin_only` otherwise); the button's tooltip says so. A non-admin's refresh still starts a
  new generation when files changed, which is enough for a store of normal size. It is not
  enough for a store too large to check within 3 s (the 95.6-million-cell Tahoe-100M store): there
  the check answers `status: "partial"` and changes nothing, and an in-place chunk write needs an
  admin's refresh (or a server restart). The app tells a user whose refresh got this answer
  ("Refresh may not show every change"), once per press, and an admin's **Refresh dataset**
  says the server's cache was cleared instead.
- **With login off, anyone who can reach the server can refresh.** A server without login
  treats every visitor alike, so any of them can ask for the re-check (and, on your own machine,
  the cache clear). That is harmless: a refresh only reads the store, and it is rate-limited as
  below. On a lab server, turn login on ({doc}`authentication`).
- **One check every 10 seconds per dataset.** The server walks a dataset's files at most once per
  `server.refresh_min_interval_s` (default 10 s), across all workers. A refresh sooner waits for
  the next walk, at most that long, and shares it with everyone waiting; it is never answered by a
  walk that started before it ({doc}`../reference/configuration`). On a copy of the
  demonstration store, a refresh 9.5 s after the previous one waited 9.5 s and then found the
  change.

Replacing a whole store (a new directory under the same link) is a different operation; see
{ref}`lab-server-updating`.
