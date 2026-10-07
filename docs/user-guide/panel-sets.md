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
   :alt: The Load Panel Set dialog: a search field (1), a card for HSC_walk_and_H2-Q7_fold_change with dataset name, two panel icons and date (2), an Export button (3), Upload file (4), Load (5), Load and open layout (6) and Add to closed panels (7).

   The Load Panel Set dialog.
   ```

   - The search field (1) filters the list by name.
   - Each card (2) shows the name, the dataset, one icon per panel and the date; on a server with
     login it also shows the owner. The red bin deletes the panel set after a confirmation.
   - **Export** (3) downloads the panel set as a JSON file.
   - **Upload file** (4) adds a panel set from such a JSON file (also the panel-set files offered
     for download in these docs).
   - **Load and open layout** (6) loads the panel set and opens, in the saved layout, the panels
     that were open when it was saved (the others are listed closed). A large set opened at once
     takes as much memory as all those panels together. A set saved with no panel open opens
     none, and the notice says so.
   - **Add to closed panels** (7) adds the set's panels to the closed ones and changes nothing
     else ({ref}`below <panelsets-add>`).
2. Click a card to select it and click **Load** (5). If panels are open or closed already,
   AnnZarro asks first ({ref}`below <panelsets-add>`); **Replace** goes on as described here.
3. AnnZarro opens the panel set's dataset with the cell subset and the focused cell and gene it
   was saved with. Its panels are **not opened**: each is listed closed, with its settings, under
   **Duplicate or Reopen Panel** (1). A large panel set opened all at once could overload the
   computer, so you choose:

   - **Open saved layout (N panels)** (2), in the notice, opens the N panels that were open when
     the set was saved, in their saved layout, exactly as the set's
     {doc}`share link <share-links>` would; panels that were closed then stay closed. The same
     button, **Open saved layout (N)**, stays above the closed panels when you dismiss the
     notice. The notice says how many panels are listed and how many were open ("5 panels listed
     closed … 2 were open when the set was saved"). A set saved with no panel open offers no
     layout.
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
   open layout**, opens them); **Add to closed panels** stays on the open dataset and only adds
   the set's panels ({ref}`below <panelsets-add>`); **Keep current** leaves everything as it
   is. This is the only question asked: a set from another dataset is not asked about twice.

   ```{figure} ../_static/screens/user-guide/panelsets-switch.png
   :class: screenshot
   :width: 50%
   :alt: A yellow notice "Switch dataset?" naming the dataset the panel set was saved on and the open dataset, with the buttons "Switch and load", "Add to closed panels" and "Keep current".

   Loading a panel set made on `bm_aging.zarr` while `spatial_demo.zarr` is open.
   ```

A panel set names its dataset relative to the server's data directory (`bm_aging.zarr`), with the
store's fingerprint, so its file opens on any other server or desktop app that has the store, even
under another name: {doc}`reproducing` says how the store is found, and what happens when it is
missing or differs.

Panel sets saved by older versions of AnnZarro hold the panels, the dataset and the focus, but
no layout. They load the same way: dataset and focus, every panel listed closed. **Open saved
layout** opens the panels that were open when the set was saved, laid out in rows of two, from
left to right and top to bottom.

(panelsets-add)=
## Add a panel set to the closed panels

Loading a panel set while panels exist (open or closed) asks first (a set saved on another
dataset asks in the "Switch dataset?" notice above instead, with the same three choices):

```{figure} ../_static/screens/user-guide/panelsets-replace-or-add.png
:class: screenshot
:width: 50%
:alt: A notice "Load panel set?" saying how many panels the set holds, with the buttons Replace, Add to closed panels and Cancel.

Loading a panel set while panels are open.
```

**Replace** loads it as described above. **Add to closed panels** keeps everything as it is (the
open panels, the dataset, the cell subset, the focused cell and gene) and only adds the set's
panels to **Duplicate or Reopen Panel**, each with its settings and a small "from *set name*"
tag; a notice says how many were added. A panel whose title is in use already gets the set's name
after it, for example "Cell Plot 1 (walk_three_panels)". A panel whose id is in use already gets a
new one, and a
plot filtered by a table of the same set stays filtered by that table. A panel set saved on
another dataset is added without switching datasets; its panels are tagged "other dataset" and
may need other columns than the open dataset has. The same action is a button on each card of the
Load Panel Set dialog and of the "Load Saved Panel Set" list, so it works without the question.
Nothing is replaced, so no saved layout is offered.

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

(close-all-panels)=

## Close all panels and start over

Because the browser autosaves the layout, the next visit brings it back. **Close all** in the
header (next to Share Link; icon only on narrower windows, tooltip "Close all panels") starts over.
It asks "Close all panels?" and offers **Close all** or **Cancel**. Close all closes every open
panel; each goes to the closed list under Duplicate or Reopen Panel, exactly as with the panel's
own X, so nothing is lost until you clear that list.

The dialog has one tick box, off by default: **Also clear everything this site stored in this
browser and reload as a first visit**. Ticked, Close all also clears this site's local storage
(which holds the autosave), session storage, IndexedDB databases, Cache Storage and service-worker
registrations, then reloads the bare address, without `#view` or `?dataset_path`. The app starts
as on a first visit: nothing is restored from the autosave, and the closed list is gone too.

Not affected, whichever way you answer: panel sets saved on the server, and your login. The login
is a server cookie; cookies are left alone, and AnnZarro keeps no sign-in or CSRF state in the
browser's storage. Other sites' data is never touched; the clear covers this address only.
