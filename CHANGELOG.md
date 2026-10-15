# Changelog

What changed for the people who use AnnZarro and run its servers, newest release first. Each
release says what you can now do, what behaves differently, and what to change when you upgrade.
The [AnnZarro paper](https://doi.org/10.64898/2026.10.10.758158) describes v0.4.1; this log starts
with the release after it. Older releases are listed on
[GitHub](https://github.com/settylab/annzarro/releases).

## Unreleased

### Dark theme
- AnnZarro follows your system's light or dark setting, live: switch the system while the page is
  open and the app switches. The new **System / Light / Dark** buttons at the right end of the statistics bar override it for
  this browser and are remembered there. The login page, the admin pages, the account page and the
  desktop app are themed too, and there is no flash of the wrong theme on load.
- Plots follow the theme for every colour you have not set (background, grid, axes, text, legend,
  colour bar, the toolbar, the grey Not in table points and the scale bar). A colour you set, or a
  plot theme button, is kept when the theme changes. Plot Options > Appearance has **Follow app
  theme** (and **Light colours** / **Dark colours**); a colour's **Reset** follows the theme again.
  The **Default** preset follows the theme, **Publication** stays white.
- Share links and panel sets store only the colours you set. A link from an earlier version opens
  with its colours equal to the old light defaults following the theme; the colours you chose, and
  the old Dark Theme button's, stay.
- Exports use the colours on screen: export in the Light theme (or with **Publication**) for a paper.
- Grid and axis colours now apply from the first draw, and several grey-on-white text and control
  colours are slightly darker for WCAG AA contrast.

### Added
- Three dataset endpoints for the dataset browser: `GET /api/v1/datasets/details?path=` (a store's
  counts, format, columns, obsm keys, layers and store-check findings, read from metadata only and
  stopped after `server.dataset_details_check_budget_s`, 1.5 s by default), `sort=` and `order=` on
  `GET /api/v1/datasets/folder` (name or modified, applied before paging), and `folder=` on
  `GET /api/v1/datasets/search` to search below one folder
  ([details](https://annzarro.readthedocs.io/en/latest/reference/http-api.html)).
- The desktop app has no title bar on macOS and Windows: the AnnZarro header is the title bar, at
  the same height as before. On macOS the three window buttons sit at the top left and the
  AnnZarro title moves down below them. On Windows the minimise, maximise and close buttons, in the
  header's colours in the light and the dark theme, sit at the top right, above the Save / Load /
  Close all / Share buttons. Drag the empty part of the header to move the
  window and double-click it to zoom it. Linux keeps its normal window frame, and the browser
  version is unchanged.
- The desktop app can update itself. It looks for a newer release on launch and then once a day,
  asks before it downloads (Download, Later, Skip this version) and again before it restarts, and
  does nothing without your say-so. **Check for Updates...** is in the AnnZarro menu (macOS) or Help
  menu (Windows, Linux), next to an option that turns the automatic checks off;
  `ANNZARRO_DISABLE_UPDATES=1` turns updates off entirely. macOS, the Windows installer and the
  Linux AppImage update in place; a `.deb` and the Windows portable zip show a link to the new
  release. Checks contact only `github.com`. Updating starts with the first release that contains
  this; users of 0.5.1 and older update by hand once
  ([details](https://annzarro.readthedocs.io/en/latest/getting-started/desktop-app.html#updates)).
- The macOS desktop app installs with Homebrew: `brew install --cask settylab/annzarro/annzarro`,
  and the app then updates itself. The tap follows each release.

### Changed
- The Save / Load / Close all / Share buttons in the header line up with the dataset and focus
  boxes instead of the middle of their labels.

### Docs
- The README and the licence page cite v0.5.1 by its DOI,
  [10.5281/zenodo.23386903](https://doi.org/10.5281/zenodo.23386903).

## 0.5.1 (2026-10-14)

A reworked Plot Options menu, with tick, margin, colour bar and scale bar controls, presets, and
copying a plot's look to other panels. The grey "Not in table" points follow their own count and
have their own controls. Equal aspect plots keep their cells and zoom, and changing an axis on a
large subset no longer freezes the page.

### Plot Options
- Plot Options is grouped into nine folding sections (Presets, Appearance, Axes and ticks, Points,
  Legend and colour bar, Text, Margins, Export, Apply to other panels). The menu opens again as
  you left it.
- **Publication** preset: white background, no grid, five ticks per axis, larger text, a tighter
  margin. **Default** returns the look to a new plot's; the font, the scale bar's size and
  unit, the Points group and the export size stay.
- Tick marks and tick labels switch separately, and **Ticks per axis** asks for about N ticks
  (2 to 30; empty is automatic).
- Margins: one slider sets all four sides; **Set each side separately** shows a box for each.
- Colour bar: its own position (right, left, top, bottom or with the legend), a length from 10 to
  100 % and a tick count.
- **Scale bar** (off by default) for embeddings and spatial coordinates: a bar of a round length in
  coordinate units, about a fifth of the width in view, redrawn as you zoom or resize, with a
  Size slider (length, line and label together), an optional unit text such as µm and a corner.
  It needs Equal aspect on a 2D plot: greyed out otherwise, and turning Equal aspect off switches
  it off. It is part of an export and not part of the Publication preset.
- **Apply to other panels** copies a plot's look (not what it shows) to every other cell plot or
  gene plot, after a confirm in the menu. All of it is kept in links and panel sets; links from
  before use the defaults.

### Changed
- **Not in table:** the grey points have no legend entry, like the highlighted cell. Plot
  Options has a "Not in table" group with their size (relative to the automatic size, 1x by
  default), opacity and colour; links, copies and saved panel sets keep them.
- Without Equal aspect, switching the x field also resets a zoom on y, as reloading the page or
  opening a link already did.
- Stable download links that always fetch the newest desktop app, for example
  `https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-macos-arm64.dmg`. The
  README and the docs link their platform badges to them.

### Fixes
- With the grid off, tick labels no longer disappear on a plot's first draw and reappear after the
  next edit: they follow **Show Tick Labels** alone.
- **Not in table:** the grey points a table filter leaves in a plot are sized from their own
  count, the way the plot's points are, instead of keeping the size they had before they were
  excluded. Setting the point size by hand after the table is active, switching the table on in
  the panel and opening a plot that names it now give the same grey points, and a different
  table or subset readjusts them.
- **Equal aspect:** switching a 2D plot's coordinates refits both axes together and keeps every
  cell in view. A zoom saved in a link from before v0.5.0 is kept only if it shows the data.
- **Equal aspect:** a zoom is kept when the panel is resized, for example when a neighbouring
  panel is closed and the panel is split again.
- Double-click (Reset axes) fits all the data again, also on a plot opened from a link with a
  saved zoom.
- Changing a plot axis on a large subset coloured by a category no longer freezes the page. On a
  100,000-cell subset of a 1.06 million cell dataset coloured by 60 categories, one axis change
  blocked the page for about 4 s and two in quick succession made the browser report "Page
  Unresponsive"; both now take 0.1 to 0.15 s.
- Decoding a categorical column whose labels contain quotes or escaped characters takes 0.1 s
  instead of 3.8 s for 200,000 values with 20,000 such labels.
- A slow reply to the page's settings request no longer makes a large dataset download every cell
  name: the first dataset load waits for the settings (at most 10 s) before it decides whether
  names stay on the server.

### Docs
- The README and the licence page cite v0.5.0 by its DOI,
  [10.5281/zenodo.23353417](https://doi.org/10.5281/zenodo.23353417).

## 0.5.0 (2026-10-13)

An admin web interface for shared servers: an administrator adds data directories, manages
users, gives an external collaborator only some of the datasets, switches panels and external
hosts off, and reads the server's health and an audit log, all in the browser. Every request that
changes something is protected against forged requests, the server resists requests that would
hold a worker, and very large datasets are cheaper to open and read.

### Admin interface
- **`/admin`** (login on) has six sections: Users, Data directories, Server health, Panel sets,
  Settings and Audit log. A change needs the admin's password entered within the last 30
  minutes, and every change is written to the audit log.
- **Users:** add and remove users, reset passwords (a generated password is shown once), grant
  or revoke admin, and clear a lockout. The last admin cannot be removed or demoted. Everyone can
  change their own password at **Change password** in the header.
- **Data directories:** with `server.admin_data_roots` set, an admin adds directories in the
  browser, below the parents the operator allows. They appear in the dataset picker at once.
- **Dataset access for external collaborators:** restrict a user to the folders, stores and
  remote prefixes you grant; everyone else keeps seeing everything. A restricted user gets the
  same "not found" for a dataset they may not read as for one that does not exist. Manage it in
  Users (Access) or with `annzarro user access`.
- **Settings:** switch panel types off for everyone or for one user, and control what Gene Set
  Analysis may contact (all external hosts, individual services, the species lookup, the links).
  The browser refuses any host the settings do not allow.
- **Server health:** each worker's read budget in use, cache size, requests and refusals by
  reason, and who was seen recently. **Panel sets:** list by owner, reassign or delete.
- **Audit log:** each record carries the hash of the one before it, so an edit in the middle is
  found (`annzarro admin audit verify`). The log also goes to the `annzarro.audit` logger.
- A change made in the browser or with `annzarro user ...` reaches every gunicorn worker on its
  next request, without a restart.

### Security
- Every request that changes something needs the session's token and a same-origin `Origin`.
  Sign-in has its own one-time token, and signing out is a `POST`.
- Pages carry a `Content-Security-Policy` that lists the external hosts the user's settings
  allow.
- A request body over `server.max_request_mb` (64) is refused with `413`.

### Performance and limits
- **Cell and gene names** are streamed. For a 95.6 million cell store the server holds 0.42 GiB
  and answers in 0.14 s, where it held 15.2 GiB and took 14.4 s.
- **Sharded stores:** a 1,000-row subset of a 5M x 50 store in one 850 MB shard peaks at 47 MiB
  instead of 757 MiB.
- **Colouring by a gene on a subset of a CSR `X`** reads each chunk once: 10,000 cells of a
  1 million cell store take 0.4 s instead of 57 s, at about 200 MB more peak memory (#108).
- **Subsets** share the cache and the compute fairly between users. A subset that cannot start
  within `server.subset_wait_s` (30 s) is answered `503 read_busy`.
- **Numeric subset filters:** six at once on a 95.6 million cell store take 1.8 s and 10.8 GB
  instead of 18.8 s and 30.5 GB.
- **Name search with a regular expression:** a pattern that could hold a worker is refused, and
  every search stops after `server.name_search_timeout_s` (10 s). The picker says when a search
  ran out of time.
- **Remote stores:** one request may spend at most `server.remote_request_timeout_s` on remote
  reads (120 s on a shared server, 600 s for one user), then fails with `504 remote_deadline`.
- **Other limits:** panel-set quotas per user and per server, a cap on the entries a directory
  listing scans, `uns` members sized before they are read, and gunicorn workers replaced after
  20,000 requests. See Resource limits in the docs.
- **`annzarro store check`** reports, from metadata only, what in a store's layout makes AnnZarro
  slow, with the cost in clicks and a fix for each.
- In large-plot mode, hovering finds the nearest point in 1 ms instead of 43 ms at 95.6 million
  points and skips categories hidden in the legend.

### Fixes
- Switching a plot axis between a text field and a number field draws and refits the axis for
  the new field. In large-plot mode the x and y pickers grey out categorical columns, with the
  reason, until a subset is made.
- A table column named like `orig.ident` shows its values instead of N/A.
- A 3D plot keeps its wheel zoom when the focused cell changes or the plot is redrawn.
- The open dataset list follows the window height, with one scrollbar.
- **Center at 0** with **Lock Range** centres the colour scale on the locked range, and **Log**
  with Lock Range keeps the typed limits; turning either off restores them.
- A panel opened from the welcome page before the first dataset loaded no longer keeps its "No
  dataset loaded" screen.
- Splitting a panel, choosing a panel type and closing a section ease to the new sizes instead
  of jumping (not with the system's reduced-motion setting).
- A missing store is answered `404 not_found` on every data route.

### Desktop app
- The macOS app is signed with a Developer ID and notarized by Apple. Open the `.dmg` and drag
  AnnZarro to Applications.

### Docs
- A Python API reference; pages on choosing the desktop app or a server, the admin interface,
  the Admin API, the policy registry and resource limits; `CONTRIBUTING.md` and a code of conduct.
- The README and `CITATION.cff` cite the bioRxiv preprint.

### Upgrade notes
- **Scripts that sign in with a cookie** and send `POST`, `PUT` or `DELETE` must send the
  session's token in `X-AnnZarro-CSRF` (the page has it in `<meta name="annzarro-csrf">`).
  `curl` and `annzarro export` against a server with login off are not affected.
- **Behind a proxy that terminates TLS** or rewrites `Host`, set `server.proxy_count`, or every
  change is refused with `403 csrf_failed` and the admin page refuses changes.
- **Sign-in and sign-out:** a script that posts to `/login` must fetch the form first for its
  one-time `login_csrf` field. `/logout` is `POST` only.
- **Content-Security-Policy:** a customised page or an embedding that contacts hosts the policy
  does not list is refused by the browser.
- **External hosts:** Enrichr and Reactome are off by default on a shared server; switch them on
  in Settings or with `integrations.gene_set.services`. `integrations.external_requests` accepts
  `none`.
- **`/status` and `/cache/info`** answer admins only on a shared server.
- **Remote deadline:** keep the proxy's `proxy_read_timeout` at or above
  `server.remote_request_timeout_s` (120 s); `0` turns the deadline off.
- **Subsets:** raise `server.subset_budget_mb` and `server.subset_wait_s` if users see `503
  read_busy`.
- **Names streaming behind nginx:** use `proxy_http_version 1.1`.
- **Admin state** lives in `annzarro_admin/` beside the users file; back it up with the users
  file. `annzarro user` commands must run as the account that owns that directory.

## 0.4.3 (2026-10-11)

Zarr format 3 stores, sharded ones included, are read correctly. A new dataset picker browses
folders and searches, dataset names are never cut where you need them whole, large pairwise
matrices are read safely, and stores on network filesystems open faster.

### Zarr format 3
- Sharded stores are read correctly, and the read limits size a sharded array by its inner
  chunk, not by the whole shard. With anndata 0.13's default 1 GB shards, one row of a pairwise
  matrix used to count as 950 MB when the real read is about 10 MB.
- A server running zarr 2 answers a format 3 store with a clear `400 unsupported_type` instead
  of server errors or empty answers.
- The remote chunk cache works for sharded stores. A remote server that ignores `Range` requests
  gets an error that names the cause.
- zarr 3.0.0 to 3.0.8 are excluded: they read sharded arrays wrongly or lose members of
  consolidated format 2 stores. Use zarr 3.0.9 or newer, or zarr 2.
- The docs say which server reads which format, list the measured costs, and give sharding
  guidance. Format 2 stays fully supported.

### Opening datasets
- A dataset picker opens from **Browse...** in the dataset list. Search by name and path (with a
  regex toggle), browse folders, see cells x genes, format and date for each store, find recently
  opened datasets at the top, and see why an unreadable store can't be opened.
- The dataset list shows full names; the dataset box cuts long names in the middle, keeping the
  end, and its tooltip holds the path.
- The header stays on one row as long as it can: button labels collapse to icons first, then the
  focus boxes and the dataset box narrow.
- The focused gene and cell boxes grow to show their whole value.
- The typed-path field says what you can open there.

### Large data
- Pairwise matrices (obsp, varp) are read by rows, at most 1,000 per request, under a
  per-request memory limit (`server.max_read_mb`) and a server-wide read budget. A request that
  would decompress an n x n block is refused with a reason.
- The first open on a network filesystem takes about 12 filesystem calls instead of about 15,000.
- Stepping through the parts of a subset reloads only the panels that read cells.
- On a plot over the cell limit, the notice says what is unavailable and how to get it back.

### Plots
- A colour column the dataset lacks draws grey with a "not in this dataset" notice, also on plots
  over the cell limit, which showed an error.
- A gene plot with text coordinates (for example Ensembl IDs) counts every drawn gene as shown.
- A default colour from one dataset is not carried over to a dataset that lacks it.
- After a part step on a large plot, the strip no longer says "Plot went blank".

### Docs and data
- One demo store for every doc, tutorial and panel set, `bm_aging_annzarro.zarr`, on Zenodo:
  [10.5281/zenodo.23277103](https://doi.org/10.5281/zenodo.23277103).

### Upgrade notes
- zarr 3.0.0 to 3.0.8 are no longer accepted; upgrade to zarr 3.0.9 or newer.
- obsp and varp reads are limited by `server.max_read_mb`; raise it if a request you need is
  refused.

## 0.4.2 (2026-10-08)

Very large datasets on shared servers: a billion-cell store steps through its parts and searches
its cells without the server's memory growing, plus fixes to clicks, point size, subsets and
links.

### Very large datasets
- A subset with parts steps to the next part without closing the panel. A newer step replaces
  the one still loading, a "Loading part N..." pill shows progress, and the next part is read
  ahead. On a 1 billion cell store a step went from 58 to 72 s to about 23 s.
- Above 5 million cells, cell names are loaded only when a view needs them
  (`ui.defaults.names_on_demand_above`).
- Name search is bounded by memory (`server.name_index_max_mb`). Clicking the Focused Cell box
  on a 1 billion cell store grew the server by about 32 GB; it now stays near 1 GB.
- The first plot of a 95.6 million cell store, and subsets of a 1 billion cell one, no longer
  wait for every name to be hashed.
- A large plot that would not fit in the browser's memory is declined with a suggested subset
  size instead of crashing the tab.
- Large-plot mode has hover, click and the focused-cell highlight.
- A **Cancel** button appears on a panel whose load takes longer than 1.5 s, and changing what a
  panel shows cancels its earlier load.

### Plots
- A cell is selected only by a short, still click, not at the start of a drag or a 3D rotation.
- Automatic point size follows the points left after filters and subsets.
- Boolean obs columns are coloured in the order False, True, as scanpy does, so stored
  `uns/<col>_colors` apply to the right values.
- Applying a subset updates every affected panel.

### Links and interface
- The address bar follows the view: a reload keeps your changes, and copying the address shares
  what you see. The address is replaced, not added to the browser history.
- The AnnZarro version is shown in the title tooltip and the login badge.
- A cut-off dataset name shows in full on hover.
- A partial re-check of a very large dataset says so (#91).
- Admin help and docs say that admins may open any path by default (#90).

### Docs and data
- The spatial demo ships a 5-step expression walk on the kNN graph (`obsp/expression_walk_t5`).

### Upgrade notes
- On Linux systems older than glibc 2.28 (for example Ubuntu 18.04), install with
  `pip install "h5py<3.16" annzarro`.
