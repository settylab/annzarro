# Panel sets

A **panel set** is a named, stored view: the dataset, the focused cell and gene, the cell subset,
the split layout with its sizes, and every panel with its settings, the same things a
{doc}`share link <share-links>` carries. Panel sets are stored **on the server**, in the
`sessions` folder of its data directory, so every user of the same server sees the same list.
They are the way to keep views for later and to hand them to colleagues on a shared server; a
share link sends one view as a URL instead. Loading a panel set opens its dataset with its subset
and focus and lists its panels closed; one click (**Open saved layout**) then opens them all in
their saved layout, which a share link does directly. The differences are summarised at the end of
this page.

## Save a panel set

1. Arrange the panels you want to keep.
2. Click **Save Panel Set** in the header.
3. Type a name, for example `HSC walk and H2-Q7 fold change`. If panel sets exist already, their
   names are listed under the field as you type.

   ```{figure} ../_static/screens/user-guide/panelsets-save.png
   :class: screenshot
   :width: 70%
   :alt: The Save Panel Set dialog with the name "HSC walk and H2-Q7 fold change" typed in.

   Saving the two panels of {doc}`focus-and-lock`.
   ```

4. Click **Save**.

The name is stored with spaces replaced by underscores (`HSC_walk_and_H2-Q7_fold_change`); the
server keeps only letters, digits, spaces, `_` and `-`. Saving under a name that exists already
asks "A panel set with the name … already exists. Do you want to overwrite it?" first. On a server
with login, if the existing panel set belongs to someone else, AnnZarro says so ("Choose another
name") and keeps the dialog open.

## Load a panel set

1. Click **Load Panel Set**. The dialog lists every panel set on the server, newest first.

   ```{figure} ../_static/screens/user-guide/panelsets-load.png
   :class: screenshot
   :alt: The Load Panel Set dialog: a search field (1), a card for HSC_walk_and_H2-Q7_fold_change with dataset name, two panel icons and date (2), an Export button (3), Upload file (4), Load (5) and Load and open layout (6).

   The Load Panel Set dialog.
   ```

   - The search field (1) filters the list by name.
   - Each card (2) shows the name, the dataset, one icon per panel and the date; on a server with
     login it also shows the owner. The red bin deletes the panel set after a confirmation.
   - **Export** (3) downloads the panel set as a JSON file.
   - **Upload file** (4) adds a panel set from such a JSON file (also the panel-set files offered
     for download in these docs).
   - **Load and open layout** (6) loads the panel set and opens all its panels at once, in the
     saved layout. A large set opened at once takes as much memory as all its panels together.
2. Click a card to select it and click **Load** (5).
3. AnnZarro opens the panel set's dataset with the cell subset and the focused cell and gene it
   was saved with. Its panels are **not opened**: each is listed closed, with its settings, under
   **Duplicate or Reopen Panel** (1). A large panel set opened all at once could overload the
   computer, so you choose:

   - **Open saved layout (N panels)** (2), in the notice, opens every panel of the set in its
     saved layout, exactly as the set's {doc}`share link <share-links>` would. The same button,
     **Open saved layout (N)**, stays above the closed panels when you dismiss the notice.
   - **Closed** (it reads **Reopen** under the pointer) on a panel in the list opens that panel
     alone, below the others; split and resize it as usual ({doc}`interface`).

   The offer lasts until you load another panel set, switch datasets or open a share link. The
   panels that were open before are closed too and stay in the same list.

   ```{figure} ../_static/screens/user-guide/panelsets-loaded.png
   :class: screenshot
   :alt: After loading: no panel open; the Create New Panel chooser lists the two panels of the set as closed under Duplicate or Reopen Panel (1), and a notice offers Open saved layout (2 panels) (2), with H2-Q7 and the HSC in the header.

   After **Load**: the dataset and focus as saved, the set's panels listed closed (1), and the
   offer to open its saved layout (2).
   ```

   ```{figure} ../_static/screens/user-guide/panelsets-opened.png
   :class: screenshot
   :alt: After Open saved layout: the two panels side by side as saved, the diffusion walk from the HSC on the left and the H2-Q7 fold change on the right, with H2-Q7 and the HSC in the header.

   After **Open saved layout**: layout, panels and focus as saved.
   ```

4. If the panel set was saved on another dataset than the one open, AnnZarro asks first. A
   panel set that names the open store by another path (`bm_aging.zarr` for
   `/data/bm_aging.zarr`) counts as the same dataset and loads without asking.
   **Switch and load** opens the panel set's dataset and lists its panels (or, from **Load and
   open layout**, opens them); **Keep current** leaves everything as it is.

   ```{figure} ../_static/screens/user-guide/panelsets-switch.png
   :class: screenshot
   :width: 50%
   :alt: A yellow notice "Switch dataset?" naming the dataset the panel set was saved on and the open dataset, with the buttons "Switch and load" and "Keep current".

   Loading a panel set made on `bm_aging.zarr` while `spatial_demo.zarr` is open.
   ```

A panel set names its dataset relative to the server's data directory (`bm_aging.zarr`), with the
store's fingerprint, so its file opens on any other server or desktop app that has the store, even
under another name: {doc}`reproducing` says how the store is found, and what happens when it is
missing or differs.

Panel sets saved by older versions of AnnZarro hold the panels, the dataset and the focus, but
no layout. They load the same way: dataset and focus, every panel listed closed. **Open saved
layout** lays their panels out in rows of two, from left to right and top to bottom.

## Who can change a panel set

On a local server (`annzarro start` on your own machine, login off) there is one anonymous user
and every panel set can be loaded, overwritten and deleted.

On a server with login ({doc}`../deployment/authentication`):

- Every logged-in user can list, load and export every panel set.
- Saving over, deleting or renaming a panel set is allowed to its **owner** (the user who first
  saved it) and to **admins** (users created with `annzarro user add --admin`). Anyone else gets
  "Panel set '…' belongs to *owner*; only *owner* or an admin can … it. Save your changes under a
  new name instead."
- Panel sets saved before owners were recorded have no owner and can only be changed by an admin.
  An admin can assign them to a user.
- Ownership is written by the server; an uploaded file cannot claim it.

These rules are checked by the server's test suite (`annzarro/tests/server/test_session_permissions.py`,
19 tests passing on this build). Renaming, duplicating and assigning an owner are server endpoints
(`/api/v1/sessions/rename`, `/duplicate`, `/owner`, {doc}`../reference/http-api`) without a button in
the interface yet.

```{warning}
On a server that other people can reach with login switched off, everyone is the same anonymous
user: anyone can overwrite or delete every panel set. The server logs a warning at startup in that
case ({doc}`../deployment/hosting-checklist`).
```

## Panel set, share link or autosave?

| | Panel set | Share link | Autosave |
|---|---|---|---|
| Stored | on the server, `<data_dir>/sessions/*.json` | in the URL fragment, nowhere on the server | in your browser's local storage |
| Visible to | every user of the server | whoever has the URL | you, in this browser |
| Panels and settings | yes | yes | yes |
| Split layout and sizes | yes, opened by **Open saved layout** | yes | yes |
| Focused cell and gene, cell subset | yes | yes | yes |
| Reopens as | its dataset and focus, panels listed closed; one click opens the full layout | the full layout, panels open | the full layout, panels open, on your next visit |

```{admonition} What happens on the server
:class: note
Saving writes one JSON file to `<data_dir>/sessions/`; the file holds the panel settings, not
data. Loading reads it back. Each panel then requests its vectors like any new panel. The
server never writes to the dataset itself.
```
