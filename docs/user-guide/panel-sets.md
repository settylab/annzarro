# Panel sets

A **panel set** is a named, stored view: the dataset, the focused cell and gene, the cell subset,
the split layout with its sizes, and every panel with its settings, the same things a
{doc}`share link <share-links>` carries. Panel sets are stored **on the server**, in the
`sessions` folder of its data directory, so every user of the same server sees the same list.
They are the way to keep views for later and to hand them to colleagues on a shared server; a
share link sends one view as a URL instead. **Load** opens a panel set exactly as its share link
would: its dataset, subset and focus, and the panels that were open when it was saved, in their
saved layout. Two small icon buttons beside it do less of that: load on the dataset that is open, or
only add the panels to the closed list. The differences are summarised at
the end of this page.

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
turns **Save** into **Overwrite** and says so under the name box; press it to replace the set, or
type another name. On a server with login, if the existing panel set belongs to someone else, the
name box says so and the dialog stays open. A save, load, import or delete that the server refuses
is reported in the dialog, on the card it concerns.

## Load a panel set

Click **Load Panel Set**. The dialog lists every panel set on the server, newest first.

```{figure} ../_static/screens/user-guide/panelsets-load.png
:class: screenshot
:alt: The Load Panel Set dialog with numbered marks: the search field (1), a card (2), its badge "available here" (3), the blue Load button (4), two small icon buttons (5), the question mark in the header (6) and Upload file (7).

The Load Panel Set dialog.
```

- The search field (1) filters the list by name or dataset.
- Each card (2) shows the name, the dataset, one icon per panel and the date; on a server with
  login it also shows the owner. The download button exports the panel set as a JSON file; the
  red bin asks "Delete panel set …?" on the card, with **Delete** and **Cancel**.
- The badge (3) says whether the set's dataset is on this server: **available here**, or **not
  found here** ({ref}`below <panelsets-missing>`). It is found by the store's path or, failing
  that, by a store with the same cells and genes, as for a {doc}`share link <share-links>`.
- **Load** (4), the one blue button, does the whole job: it switches to the set's dataset and
  opens the panels that were open when the set was saved, in their saved layout, exactly as the
  set's share link would. The panels that were open before are closed, but stay in the list under
  **Duplicate or Reopen Panel**, so nothing is lost and nothing asks first.
- The two icon buttons (5) each do less than Load. Hover one for its tooltip:
  - **Load on the current dataset** (pin) keeps the dataset that is open and opens the set's panels
    in their layout there. It is disabled, with the reason in its tooltip, when no dataset is open.
  - **Add panels closed** (folder with a plus) keeps the dataset and the open panels and only adds
    the set's panels to the closed list ({ref}`below <panelsets-add>`).
- The **?** in the header (6) lists the three ways to load with their icons, on hover or click.
- **Upload file** (7) adds a panel set from a JSON file (also the panel-set files offered for
  download in these docs). The chosen file gets a card with the same Load button, icons and badge;
  using one of them imports the file as a saved panel set on the server and loads it.

```{figure} ../_static/screens/user-guide/panelsets-help.png
:class: screenshot
:width: 80%
:alt: The Load Panel Set dialog with the help popover open: a list of the three ways to load (Load, the pin and the folder-plus icon) and a line about "not found here".

The help popover.
```

Which panels count as "open": the panels that were open when the set was saved. A set saved with
none open shows **Load (no panels were open)**: it loads the dataset and lists the panels closed,
and the notice says so. A set saved by an older version of AnnZarro holds the panels, the dataset
and the focus but no layout; Load opens the panels that were open when it was saved, laid out in
rows of two, from left to right and top to bottom.

The welcome list, **Load Saved Panel Set**, offers the same Load button, icons and badge on each
item, in a compact form.

```{figure} ../_static/screens/user-guide/panelsets-opened.png
:class: screenshot
:alt: After Load: the two panels side by side as saved, the diffusion walk from the HSC on the left and the H2-Q7 fold change on the right, with H2-Q7 and the HSC in the header.

After **Load**: layout, panels and focus as saved.
```

A panel set names its dataset relative to the server's data directory (`bm_aging_annzarro.zarr`), with the
store's fingerprint, so its file opens on any other server or desktop app that has the store, even
under another name: {doc}`reproducing` says how the store is found, and what happens when it is
missing or differs. A set that names the open store by another path (`bm_aging_annzarro.zarr` for
`/data/bm_aging_annzarro.zarr`) counts as the same dataset. Fields the chosen dataset lacks are marked on
each panel, and a notice names them.

(panelsets-missing)=
### When the set's dataset is not on this server

```{figure} ../_static/screens/user-guide/panelsets-load-missing.png
:class: screenshot
:width: 50%
:alt: A card with the badge "not found here" (1), the blue button "Load on the current dataset" (2), a folder-plus icon and a database icon (3).

A card whose dataset is not here.
```

The badge reads **not found here** (1; its tooltip says why: not on this server, outside the data
directory this server shares, or unreadable). Switching to that dataset is impossible, so the card
changes:

- the blue button becomes **Load on the current dataset** (2): the set's panels open in their
  layout on the dataset that is open. Panels whose fields it lacks say so. With no dataset open,
  the blue button reads **Choose dataset...** and opens the dataset browser;
- the database icon, **Choose dataset...** (3), opens the dataset browser of {doc}`reproducing` (the
  stores of this server, those with the same cells and genes tagged, and a field for a path) and
  loads the set onto the store you pick, opening its panels. Close the browser without choosing and
  nothing is loaded.

A store you chose yourself (the open one, or one from the browser) is used as asked: if its cells or
genes differ from the saved ones, a notice says so instead of asking first.

(panelsets-add)=
## Add a panel set to the closed panels

**Add panels closed** (folder with a plus; on every card, in the dialog and the welcome list) keeps
everything as it is (the open panels, the dataset, the cell subset, the focused cell and gene) and
only adds the set's panels to **Duplicate or Reopen Panel**, each with its settings and a small
"from *set name*" tag; a notice says how many were added. A panel whose title is in use already
gets the set's name after it, for example "Cell Plot 1 (walk_three_panels)". A panel whose id is in
use already gets a new one, and a plot filtered by a table of the same set stays filtered by that
table. A panel set saved on another dataset is added without switching datasets; its panels are
tagged "other dataset" and may need other columns than the open dataset has. Nothing is replaced,
so no saved layout is offered.

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
| Split layout and sizes | yes, opened by **Load** | yes | yes |
| Focused cell and gene, cell subset | yes | yes | yes |
| Reopens as | the full layout, panels open (**Load**) | the full layout, panels open | the full layout, panels open, by a reload of the tab or **Restore** |

The autosave opens the dataset it was saved on when a reload restores it. When a dataset is open
already it never switches it: its panels open on the dataset that is open.

(last-sessions)=

## Last sessions

A new visit does not redraw the last session by itself: a panel set kept on "All cells" and moved
to a very large dataset could run the browser out of memory, and a page that redrew it at every
start could never be opened again. The welcome screen's **Load Saved Panel Set** and the **Load
Panel Set** dialog list the last sessions first, before the saved panel sets:

- **Last session (autosaved 14:32)**, then up to two **Earlier session** entries: the sessions of
  earlier visits and other tabs, newest first, each view once. The date is added when it was not
  today.
- Under the label: the dataset and the number of panels, and the panels' icons.
- **Restore** opens it as it was saved, on its own dataset. The trash icon forgets it.
- A session that **did not finish loading** says so: the tab ended while it was drawn (most likely
  out of memory), or a plot ran out of browser memory. It offers **Restore with the default
  subset**, which opens it on the dataset's default subset instead of the cells it was saved with
  ("All cells", say), so fewer cells are drawn.

Nothing is drawn until you press one of them. Once restored, the session continues as the open
view and is no longer listed apart.

When a page restores the autosave by itself is set by `ui.autosave.auto_restore`
({doc}`../reference/configuration`):

| `auto_restore` | A reload of the tab, Back or Forward | A new visit (address typed, bookmark, new tab, the desktop app's start) |
|---|---|---|
| `reload` (the default) | restores the autosave | lists it first, waits for **Restore** |
| `always` | restores it | restores it |
| `never` | lists it | lists it |

Whatever the setting, a session that did not finish loading is never restored by itself, and a
reload of the tab that ended does not redraw the view in its address either. Once a session is
restored, the address names its dataset and view, so the next reload opens them from the address.
A new visit to the bare address opens no dataset and starts on the server's default subset
({ref}`subset-size-carried`). A link with a view
(`?dataset_path=...#view=...`) opens what it names; the in-app refresh button (next to the
dataset) reads the dataset again and keeps the panels open. AnnZarro tells a reload
from a new visit by the tab's own history entry, which holds a random id of the page.

```{admonition} What happens on the server
:class: note
Saving writes one JSON file to `<data_dir>/sessions/`; the file holds the panel settings, not
data. Loading reads it back. Each panel then requests its vectors like any new panel. The
server never writes to the dataset itself.
```

(close-all-panels)=

## Close all panels and start over

Because the browser autosaves the layout, a reload brings it back and the next visit offers it.
**Close all** in the
header (next to Share Link; icon only on narrower windows, tooltip "Close all panels") starts over.
It asks "Close all panels?" and offers **Close all** or **Cancel**. Close all closes every open
panel; each goes to the closed list under Duplicate or Reopen Panel, exactly as with the panel's
own X, so nothing is lost until you clear that list.

The dialog has one tick box, off by default: **Also clear everything this site stored in this
browser and reload as a first visit**. Ticked, Close all also clears this site's local storage
(which holds the autosave), session storage, IndexedDB databases, Cache Storage and service-worker
registrations, then reloads the bare address, without `#view` or `?dataset_path`. The app starts
as on a first visit: nothing is restored from the autosave, no last session is listed, and the
closed list is gone too.

The tick box is a safe way to get a full refresh. Under it the dialog says so: it is a fresh start
for this browser only, it forgets the remembered layout and settings, and nothing is deleted. Saved
panel sets (yours and other users'), datasets and files on the server are not touched. The only
panel-set-like thing it resets is the autosaved current layout, which lives in this browser.

Not affected, whichever way you answer: panel sets saved on the server, and your login. The login
is a server cookie; cookies are left alone, and AnnZarro keeps no sign-in or CSRF state in the
browser's storage. Other sites' data is never touched; the clear covers this address only.
