# Panel sets

A **panel set** is a named, stored collection of panels: each panel's type, title and settings,
plus the focused cell and gene and the dataset. Panel sets are stored **on the server**, in the
`sessions` folder of its data directory, so every user of the same server sees the same list.
They are the way to keep a set of views for later and to hand them to colleagues on a shared
server. To send a view to someone as a URL, use a {doc}`share link <share-links>` instead; the
differences are summarised at the end of this page.

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
   :alt: The Load Panel Set dialog: a search field (1), a card for HSC_walk_and_H2-Q7_fold_change with dataset name, two panel icons and date (2), an Export button (3), Upload file (4) and Load (5).

   The Load Panel Set dialog.
   ```

   - The search field (1) filters the list by name.
   - Each card (2) shows the name, the dataset, one icon per panel and the date; on a server with
     login it also shows the owner. The red bin deletes the panel set after a confirmation.
   - **Export** (3) downloads the panel set as a JSON file.
   - **Upload file** (4) adds a panel set from such a JSON file (also the panel-set files offered
     for download in these docs).
2. Click a card to select it and click **Load** (5).
3. AnnZarro opens the panel set's dataset if it is not open yet. The panels are added under
   **Duplicate or Reopen Panel** at the bottom of the canvas, marked **Closed**; nothing on the
   canvas is replaced.

   ```{figure} ../_static/screens/user-guide/panelsets-loaded-closed.png
   :class: screenshot
   :alt: The Welcome canvas after loading: under Duplicate or Reopen Panel, two cards "Fold change (Young to Old) of the focused gene" and "5-step diffusion walk from the focused cell", both marked Closed.

   After Load: the panel set's panels wait under Duplicate or Reopen Panel.
   ```

4. Hover over a **Closed** badge and click **Reopen** to place that panel on the canvas, or click
   the card to open a copy. Repeat for each panel you want.

   ```{figure} ../_static/screens/user-guide/panelsets-reopened.png
   :class: screenshot
   :alt: The fold-change panel reopened full width, coloured by the fold change of 0610005C13Rik, the focused gene of this window, instead of H2-Q7.

   One panel reopened. It follows this window's focused gene, not the one saved in the panel set.
   ```

```{important}
Panel sets store the panels, not their arrangement: reopened panels are placed one below the
other, and you split and resize them again. When the panel set's dataset is already open, the
saved focused cell and gene are not applied either, so unlocked panels follow the current focus
(above: the first gene in the list, 0610005C13Rik, instead of H2-Q7). Pick the focus in the header
after loading, or lock the panels before saving. A {doc}`share link <share-links>` keeps the
layout and the focus.
```

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
| Split layout and sizes | no | yes | no |
| Focused cell and gene | stored, applied only when the dataset changes | yes | yes |
| Reopens as | closed panels to reopen | the full layout | closed panels to reopen, on your next visit |

```{admonition} What happens on the server
:class: note
Saving writes one JSON file to `<data_dir>/sessions/`; the file holds the panel settings, not
data. Loading reads it back. Each reopened panel then requests its vectors like any new panel. The
server never writes to the dataset itself.
```
