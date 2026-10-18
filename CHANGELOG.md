# Changelog

What changed for the people who use AnnZarro and run its servers, newest release first. Each
release says what you can now do, what behaves differently, and what to change when you upgrade.
The [AnnZarro paper](https://doi.org/10.64898/2026.10.10.758158) describes v0.4.1; this log starts
with the release after it. Older releases are listed on
[GitHub](https://github.com/settylab/annzarro/releases).

## Unreleased

### Changed
- The focused cell or gene is drawn as an open circle five times the point size by default (no fill, a 2 px edge, opaque). Switch **No fill** off in the Focused group of Plot Options to fill it; plots saved before this draw the new default unless they set the fill.

### Fixed
- The arrow keys of the opacity boxes in Plot Options (Focused, Not in table) step from the opaque default (1, 0.95, 0.9) instead of jumping to the minimum when the box is empty.

### Docs
- The README and the licence page cite v0.6.0 by its DOI,
  [10.5281/zenodo.23447624](https://doi.org/10.5281/zenodo.23447624).

## 0.6.0 (2026-10-17)

An About dialog and what a public site needs (imprint, privacy notice, a footer), set from the admin
page; a Dataset information dialog with attribution, README and structure; last sessions listed instead of
redrawn, and plots of a set too large for the browser refused one by one instead of crashing the
tab; plot options that survive links and Duplicate; and a Publication preset for figures.

### Added
- **Last sessions.** The welcome screen and the Load Panel Set dialog list up to three last sessions first ("Last session (autosaved 14:32)", the dataset and the panel count), each with **Restore**. A session whose tab ran out of memory while it was drawn is marked "did not finish loading" and offers **Restore with the default subset**; it is never restored by itself again.
- **No fill** in the Focused cell group (Plot Options) draws the focused marker as an open circle, its edge only, in 2D, 3D, gene and large plots, in exports and in links, panel sets and Apply to other panels. An edge width under 1 px is raised to 1 px when it is switched on, so the circle always shows.
- The **Structure** tab of the Dataset information dialog has a **search box**: it filters column names, keys, `uns` paths, types and category labels as you type, marks the matches, opens the sections that hold them and counts them. A `.*` switch reads the query as a regular expression, `Aa` matches case (both remembered); an invalid or too slow pattern is said in words and the last result stays. Escape clears it, `/` and Ctrl/Cmd+F focus it.
- `uns["annzarro"]` is a versioned format (`schema` `annzarro.dataset-info`, `schema_version` `1.0`; a dictionary without them is version 1). The reader ignores keys it does not know, reads a newer minor version in full and a newer major version for the fields that did not change (the dialog says so), and every field accepts a simple form and a richer one: a licence as `{id, url, text}`, authors with ORCID iDs, several contacts, funding and provenance. `annzarro store annotate` writes the marker, takes `--from-json` for the richer forms, and refuses a value the reader would ignore. The field table and the compatibility rules are in the deployment guide.
- A **Dataset information** button beside the open dataset's name shows the dataset's attribution (title, licence, authors, citation with a copy button, DOI, source, contact), its README rendered as safe Markdown (raw HTML is shown as text, links only http, https and mailto, no images) and its AnnData structure (cells and genes, obs and var columns with types, flags, category labels and colours with a warning when the colour count differs from the category count, obsm, layers and the other slots with shapes and, for sparse matrices, density, raw, unknown groups, the `uns` tree). Each tab loads when first opened, with a loading state and a retry on failure; the dataset browser's details pane shows the same for a dataset that records it. Dataset owners write it into `uns["annzarro"]` and `uns["README"]`, with `annzarro store annotate` for a zarr store that is already written; CELLxGENE's `uns["title"]` and `uns["citation"]` are shown too. See "Dataset information and attribution" in the deployment guide.
- Click the app name at the top left to see which version you are running, how to cite AnnZarro, and who develops and funds it (the Setty Lab at Fred Hutch Cancer Center, with the NIH award numbers), with links to the documentation, the repository and the changelog.
- A server can show who runs it and what it owes its visitors. Under `site:` in the configuration, set an imprint, privacy notice, accessibility statement and terms of use, each as a link, a Markdown text or a Markdown file, plus an operator, a contact and the link labels (`Impressum`, `Datenschutz` for German sites). A small footer line on every page, including the sign-in, account and admin pages, links them; the About dialog gets a "This site" block, and a click on the imprint opens it in place. The texts are also served at `/site/imprint`, `/site/privacy`, `/site/accessibility` and `/site/terms`, which need no sign-in. Nothing appears until you configure it.
- `site.robots` tells search engines to stay away (by default on a server with login), `site.security_contact` serves `/.well-known/security.txt`, and `site.storage.persistent_convenience: false` keeps the layout autosave and recent datasets only until the tab closes.
- The Gene Set panel's question before it sends gene lists now says that each service also receives your IP address, and links the service's privacy policy.
- `site.software_credits: false` reduces the About dialog's credit for AnnZarro (lab logo, funding, citation) to its name, version, licence and links; it stays by default everywhere, below the site's own block.
- The About dialog of the desktop app states what the app sends and where.
- The server warns at start when `integrations.external_requests` is `"on"` on a shared server, and when `branding.contact_info.custom_html` contains a script, an iframe or an address on another server.
- **Public site** on the admin page: every `site:` setting (imprint, privacy notice, accessibility statement, terms, operator, contact, labels, footer, search engines, security contact, language, the AnnZarro credit, browser storage) can be set while the server runs, and the footer, About and the `/site/` pages show it at once. Each field explains itself on hover and links the public-site guide, a Markdown text has a live preview, a value the server would refuse at start is refused under its field, and a checklist says which of imprint, privacy notice, contact and accessibility statement are missing. Each text shows what is in effect and where it comes from, a text the configuration file reads from a `file` with its path and as the pages show it. A save sends only what you changed: looking at another option, or a link or text left empty, changes nothing, and **Not shown** over the configuration file's text says that it hides it. An admin's value wins over the configuration file until **Reset to config file**; `policy.locked: [site.imprint]` keeps a key in the file's hands. A text's `file` can only be set in the configuration file.
- **Data & privacy** (`/site/data`), generated from the running configuration: what the browser keeps, the cookies, what the Gene Set panel may send to which services and when, and that there are no analytics. Without a configured privacy notice it says plainly that it is not one. `/site/about` shows the About dialog as a page.

### Changed
- **Every setting on the admin pages has an info mark and a Guide link.** Hover or tab to the mark for what the setting does, its default and what it affects; Guide opens the explanation in the docs. This covers the Settings tab and the per-user settings, the Public site, the fields of the Users and Access panels, and Data sources. The admin page's introduction now states the real rule between the config file and the admin: an admin value overrides the file unless the key is in `policy.locked`, and a restrict key can only be narrowed.
- **A new visit no longer redraws the last session by itself**; a reload of the tab still does. A panel set kept on "All cells" and moved to a very large dataset could run the tab out of memory, and every reload drew it again. `ui.autosave.auto_restore` now takes `reload` (the default), `always` (the old behaviour, also `true`) or `never` (also `false`); `ui.autosave.show_in_list` lists the last sessions and is on by default. Upgrade: set `auto_restore: always` to keep the old behaviour.
- **The address names the open dataset.** Every way of opening one (the dataset browser, the back button beside its name, a panel set, **Restore**, the desktop app, the dataset opened at start) writes `?dataset_path=` (its path in the data directory, such as `?dataset_path=bm_aging.zarr`), with no panel open too, so a reload opens the dataset on screen. The address is replaced, not added to the history.
- **The bare address opens no dataset.** A fresh visit to it no longer opens the dataset opened last; the welcome screen lists the last sessions and the recent datasets, with **Browse datasets…**. A data directory with only one dataset still opens it, and the desktop app still reopens the dataset opened last.
- **The subset size you choose is kept for the tab.** It still follows you from dataset to dataset and through a reload of the tab, but a fresh visit (a new tab, the address typed, a bookmark) starts on the server's default subset. Upgrade: a size kept by 0.5.5 is removed at the first load, not carried; choose it again once in each tab.
- **Plots drawn at once are drawn in turn** (a restored session, a dataset switch or a larger subset with plots open): each is checked against what the plots before it hold, the browser's allocation check included, so the later ones of a set too large for the browser are not drawn instead of running the tab out of memory. Each says what ran short ("Not drawn: not enough browser buffers", "... JS memory", "... browser memory", or "too many WebGL canvases") with **Half the cells**, **Subset…**, **Close other plots** and **Draw anyway** (with what it risks). A Cell or Gene Table of more rows than fit is not loaded, with the same choices.
- The **Publication** preset sets the font to Arial and draws a shorter colour bar with fewer ticks (40 % long, three ticks); **Default** puts the font back.
- The panel's text font now reaches the legend (title and items) and the colour bar (title and tick labels) as well as the axes, when you change it in **Plot Options**, press a preset, and in exports.
- Plot images are exported at twice the size set in **Plot Options** by default (2400 × 1600 pixels for the default 1200 × 800), so a figure stays sharp in print; the modebar camera follows the panel's export size. Untick **Export at 2x** for files of exactly the pixels set. A panel or link saved with the scale switched off keeps it off; one that never recorded it exports at 2x. SVG files keep the size set.
- A plot's toolbar (zoom, pan, reset, camera) sits in the top right corner of the plotting area
  instead of the figure's, so a legend or colour bar placed on the right, the default, no longer
  runs into it.
- A colour bar placed on top of or below a plot lies wholly outside the axes, with the margin it needs
  made for it, instead of over the top or bottom of the plot. It sits below the x-axis title at the
  bottom. A legend above or below a plot does the same, clear of the axes and the x-axis title, in short
  panels too.
- The About dialog says that the Setty Lab develops and funds AnnZarro (the software), so that a site that runs it is not mistaken for the lab's own.
- A server other people reach (login on, a network address, `server.hosted` or a proxy) shows a footer line even with nothing configured: "About · Data & privacy", plus the configured texts and contact. The desktop app and a personal server show none until you configure something.
- Such a server logs a warning at start when it publishes neither an imprint nor a privacy notice, naming the admin page's Public site section and the guide.

### Fixes
- A dataset README longer than the 200,000 characters the dialog renders says that it was cut ("Showing the first 200,000 characters of … KB"); its end used to be left out without a note.
- The dataset browser's path field opens with **/** or **~** (the first character of the path, as in the macOS and GTK file dialogs), from the list or from an empty search box; a search box that holds text keeps the character. The hint reads "Type a path or URL: /" on every platform. It advertised Cmd+L, which Safari keeps for its address bar and never passes to the page; Ctrl+L and Cmd+L still work where the web browser passes them on. In the list, `/` no longer moves to the search box.
- Choosing "All cells" on a dataset the server shows in full anyway (up to its subsampling
  threshold) no longer carries every cell to the next, larger dataset: the kept size is forgotten
  and large datasets open on the server's default subset. Every cell chosen on a larger dataset is
  still carried.
- **The subset dialog counts the array buffers of every open plot together.** With six Cell Plots open on a 95.6-million-cell dataset, a computer with 128 GB let every cell through: its memory holds six large plots of 8 to 9 GB, but one browser tab holds about 16.6 GB of array buffers in Chrome and about 15 GB in Safari, and the tab ran out. Such a size is now refused with "Needs ~60 GB of browser buffers", and the dialog says up to which size the plots fit (about 26 million cells for six plots in Chrome, 23.6 million in Safari). A new or redrawn large plot is checked the same way beside the plots already open. `ui.memory.buffers_gb` sets the limit; by default it is the browser's own.
- After the tab ended while drawing large plots, the next page keeps the buffers it held as this browser's limit, so the same plots at the same size are not offered as fitting again. Before, a large-plot draw never left the crash marker that makes the guard more careful.
- **The margin learned from a crash no longer applies to everything, forever.** It grew by 0.25 with every crash, for every action of any size, and was never forgotten. It now applies only to actions of at least half the size of the one that crashed, is forgotten after a week or once an action that large succeeds, and a refusal that only it causes says so and offers **Reset the margin** (in the panel and the subset dialog). A margin kept by an earlier version is dropped.
- **A new Cell Plot was refused although the browser had the memory**, and allowed when it did not: the allocation check's answer was inverted (since 0.4.2) for a new or duplicated large plot, a full-resolution export, a recolour and hover labels of more than 256 MB. After closing a plot of every cell of a 95.6-million-cell dataset, or on a fresh page that opened it on every cell, the create tile said "Not enough browser memory" with nothing open, and kept saying it after the subset was reduced to 100,000 cells.
- The create and duplicate tiles are checked again when the number of cells shown changes (a smaller subset, another dataset), and a few seconds after a plot is closed, once its memory is freed. A tile refused at every cell stayed refused at 100,000 cells until another panel was opened or closed; a click on a refused tile also checks again.
- Every memory refusal names the limit that binds: the create tile's note, the panel's headline and its status tag say "JS memory", "browser buffers", "browser memory" or "WebGL canvases" instead of "browser memory" for all of them.
- The dataset information dialog shows the dataset's name on one line, cutting the start with an ellipsis (the full path is its tooltip), and tables and code in a README use the dialog's full width.
- A dataset's README, and the texts of a public site, render bare web addresses as links, and pipe tables, fenced and indented code blocks, horizontal rules, underlined headings and block quotes instead of showing their markup. Tables scroll sideways inside their own box when they are wider than the dialog, and show at most 500 rows and 30 columns.
- A category hidden with a click on the legend stays hidden when a Cell Plot linked to a filtered Cell Table removes or greys out the cells not in the table. Hiding moved to another category, so other cells disappeared and came back, and a category the table filter emptied came back shown. The hidden entries now follow their category, or colour group, through every redraw, in regular and large plots, until you colour by another column.
- A plot opened from a share link, a panel set, the autosave or **Duplicate** now looks as it did where it was made. Its axis lines, which the first draw took from the Grid switch, were missing whenever Grid was off, which is what the Publication preset does; so were the colours of the legend title and the toolbar, the tick colour, and Show Legend (the legend and the colour bar came back). Changing an axis, text or grid colour, or the font, in Plot Options now redraws every element that uses it, as opening the same plot does. Links made by earlier versions need no repair: the settings they carry were right, only the first draw ignored them.
- A new focus shows sooner in big Cell Plots. At 1M cells a click showed the cell's name after about 0.2 s and its marker after about 0.4 s, and kept the page busy for about 0.2 s; now both show within about 60 ms. Moving the marker no longer redraws every point through Plotly, and an open Cell Table no longer lists all its filtered rows each time the focus changes or the layout is autosaved; the periodic autosave also waits for a quiet moment, and leaving the page still saves at once.
- A categorical colour whose `uns["<column>_colors"]` has fewer colours than the column has categories no longer repeats them, which gave different categories the same colour. As in scanpy, the stored colours are then set aside and the default palette is used, in regular and large plots, and the panel's status strip says so ("Default colours: see why").
- Clicking a cell in a Cell Plot focuses it every time. In plots of hundreds of thousands of cells, a click soon after the plot was drawn or resized, or while the previous focus change was still being shown, often did nothing. In large plots, a click made while the plot is still preparing click selection (which can take a while at tens of millions of cells) shows a busy cursor and "Preparing click selection…" in the status strip, and focuses the cell once it is ready, instead of doing nothing.
- A Cell Table or plot too large for any browser page (95.6 million rows against about 4 GB of JavaScript memory) now says "Too many rows for this browser" with the numbers, and offers "Show N cells" for the largest subset that fits (a table at most 1,000,000) and "Subset…". It no longer offers "Close other plots" when no other plot is open or closing them cannot help, nor "Draw anyway" above the browser's ceiling.

### Docs
- New page [Running a public site](https://annzarro.readthedocs.io/en/latest/deployment/public-site.html): who is responsible, what a public site owes its visitors (imprint, privacy notice, accessibility), what AnnZarro stores and sends, the `site` settings, and privacy-notice templates in English and German.
- The README and the licence page cite v0.5.5 by its DOI,
  [10.5281/zenodo.23440020](https://doi.org/10.5281/zenodo.23440020).

## 0.5.5 (2026-10-17)

Fewer pop-ups, with messages shown where you are looking; automatic point size and opacity that
follow the panel's size; a subset size that follows you from dataset to dataset; and Plot Options
for the focused cell's marker.

### Added
- Plot Options has a **Focused cell** group (**Focused gene** in gene plots) that sets the size
  (a multiple of the point size), opacity, fill colour, edge colour and edge width of the marker on
  the focused cell, in 2D, 3D and large plots. The colours follow the app theme until you set them
  (the edge is black on a light plot and white on a dark one); the values are kept in panel sets
  and share links, and a link without them draws the usual red dot.

### Changed
- Automatic point size and opacity follow the plot area as well as the number of points: a large
  plot (a full window, a big export) draws larger, more opaque points and a small split pane
  smaller, fainter ones, so points look about as dense at any panel size. They update when the
  window is resized, a split is dragged, the controls are shown or hidden, or a panel is
  maximised; a size or opacity you set stays as set.
- The cell subset size you choose follows you to other datasets. A dataset you switch to opens
  on that many cells when it has more, and with every cell when it has as many or fewer; its badge
  then reads, for example, "All cells (≤ 10,000)", and the next larger dataset is subsampled to the
  size again. The size is kept per browser and user, so a reload keeps it, and the dataset AnnZarro
  opens when it starts uses it too. "Close all" with the tick box for clearing everything forgets
  it. Share links, panel sets and the restored session still open on the subset they saved.
- A plot or table whose data the browser ran out of memory for says so in plain words ("the
  browser ran out of memory -- Close a plot, or show fewer cells (a smaller subset), and try
  again") instead of "failed to read -- Array buffer allocation failed", and offers **Half the
  cells** and **Subset…** where it says it.
- Fewer pop-ups: AnnZarro now pops a notice up only for what you did not cause or cannot see (an
  error, data that changed under you, a partial outcome). Messages about what you just did appear
  where you are looking. A panel set that cannot be saved, loaded, imported or deleted says why
  on its card or under the name box in the dialog, and saving over an existing name turns Save into
  Overwrite and deleting asks on the card, in place of the browser's own confirmation windows
  (also for Clear closed panels). A plot export or copy that the memory check refuses, or that
  fails, says so in the plot's status line, with the advice, until the next one succeeds. What the Log
  colour scale does to a Min or Max you typed is shown under the boxes. Share Link is off, with a
  tooltip, until a dataset is open. No notice any more for a restored autosave, an imported panel
  set, a plot source missing from the dataset (the menu and the plot already say it), or a
  dataset that became unavailable (the dataset browser says it). Several columns removed from
  tables in one restore, or two notes about one store, come as one notice, and notices that stay
  up are held while the pointer or keyboard focus is on them and last longer when they are longer.

### Fixes
- The Save Panel Set dialog now closes when a save finishes while it is still fading in (a quick
  save, or Overwrite pressed at once); it used to stay open.
- A plot coloured by nothing, or by a column the dataset does not have (after switching datasets),
  no longer shows a grey "trace 0" in a legend after an axis change; such a plot has no legend.
- An error notice is no longer wiped by the notices that follow it from the same action (a shared
  link that could not be read, a cell subset that could not be applied): a notice is replaced only
  by one at least as severe, and a lower one waits below it.
- The first notice after the page loads is announced by screen readers, and a dataset that fails to
  open is announced once, not twice.
- A release build no longer fails when Apple's ticket service drops the connection while the
  notarization ticket of the macOS app or its dmg is being checked (`stapler validate`); the check
  is retried up to five times, and a missing ticket still fails at once.

### Docs
- The README and the licence page cite v0.5.4 by its DOI,
  [10.5281/zenodo.23426323](https://doi.org/10.5281/zenodo.23426323).

## 0.5.4 (2026-10-16)

A filtered Cell Table opens about twice as fast on large datasets, and switching datasets no longer
shows a notice: a back button beside the dataset name returns to the previous one. The first release
the desktop app can install over 0.5.3 by itself.

### Changed
- Switching datasets no longer shows a notice. A back button beside the dataset name returns to the
  previous dataset, and then offers the one you left, so the two toggle. The notice's button used to
  spread across the page when a dataset name was long.

### Fixes
- A release build no longer fails when Apple's ticket service drops the connection while the macOS
  app or its dmg is being stapled: stapling is retried up to five times.
- A Cell Table with a filter opens about twice as fast on large datasets, from a share link, a
  panel set or a reload: the filter goes over the rows once instead of twice, and each row costs
  less. Landing on a link with a filtered table of 484,125 cells held the page for two stretches of
  over 6 s each (long enough for the browser to report the page unresponsive); the longest is now
  about 2 s.

### Docs
- The README and the licence page cite v0.5.3 by its DOI,
  [10.5281/zenodo.23423797](https://doi.org/10.5281/zenodo.23423797).

## 0.5.3 (2026-10-16)

The desktop apps of 0.5.2 with a fix for Windows. 0.5.2 was published on PyPI only; its desktop
apps were not released, because the Windows build found this bug. Everything in 0.5.2 below is in
0.5.3.

### Fixes
- Windows: the dataset browser's details, the folder listing and the recent datasets work for a
  store on another drive than the data directory (for example the data directory on `C:` and the
  store on `D:`); the details answered with a server error.

## 0.5.2 (2026-10-16)

A dataset browser replaces the dataset dropdown, AnnZarro has a dark theme that follows your system,
and the desktop app updates itself, installs with Homebrew, opens files from the File menu, Finder and
drag and drop, and uses the AnnZarro header as its title bar. Admins control remote datasets in the
admin interface.

### Dataset browser
- The dataset is a button at the left of the bar under the header, in place of the dropdown, and
  **Ctrl+O** (**Cmd+O**) opens the **dataset browser** from anywhere, also in a text field. The
  header keeps only the focus boxes and the panel set buttons, so a long dataset name does not
  squeeze them. The button names the open dataset (its path relative to the data directory, cut in
  the middle to fit, the whole path as its tooltip) and shows when a dataset is opening, when a view
  has no data ("No data: *name*", **Choose...**) and when the open dataset became unreadable ("Not
  available"). The bar shows the dataset's format beside its cells and genes, and names it once.
- The browser lists **Recent**, **Pinned**, the data directory (and the directories an admin added, or
  a restricted user's grants) and, when the server allows remote datasets, **Remote**, which says what
  can be opened and takes a URL. The path above the table turns into a path or URL field with
  **Ctrl+L**. The table is sortable (names ignore case and read numbers by value: `liver_2` before
  `liver_10`), filters by format, number of cells and date, tags the datasets that match a view you are
  choosing for, and a **Show more** button pages it. Clicking a name opens the dataset; clicking
  elsewhere in the row selects it. The search (substring or regular expression) stays inside the
  folder shown.
- A details pane (a sheet below 1100 px) shows a dataset's counts, format, size, columns, obsm keys
  and layers, and runs the store check for a local store within its time budget; a remote store has a
  **Check chunking** button. **Open**, **Pin** and **Copy path** sit at its top and do not move while
  the details load. When panels are open, it names the keys they use that the selected dataset lacks.
- A click on the dataset button, or Ctrl+O, while the page is still starting is kept: the button
  shows it is busy and the dataset browser opens once the page is ready.
- After a switch a message, "Opened *name*", has a **Back to** *old name* button. Opening a dataset
  needs no confirmation.
- Opening with nothing asked for: the dataset you opened last, if the server still lets you read it,
  else the only dataset there is, else none, with the welcome screen offering **Open a dataset** (your
  recent ones and **Browse datasets...**). A server with several datasets does not open the first one
  alphabetically any more, which on a shared server could be a very large store.
- **Recently opened** keeps stores in subfolders and remote stores (`s3://`, `https://`), shows one you
  can no longer open greyed in place, and is kept per server **and per user**: two people who sign in
  to one server from one browser do not see each other's list. The list kept before moves to the first
  user who signs in afterwards, once.
- The browser tab and the window are titled with the open dataset, `bm_aging_annzarro.zarr ·
  AnnZarro` (with your `app_name`), and with the app name alone when none is open.
- New optional setting `branding.admin_contact` (a name or an email address): a user who sees only
  some datasets is told "Ask *contact* for access." when a link or panel set names a dataset they
  cannot read.
- Keyboard and screen readers: the table is a native table with a caption and sortable header
  buttons, one tab stop with arrow keys, Home, End, type-ahead, **/** for the search field and
  **Escape** back to the dataset button; counts and openings are announced; the focus ring is a 2 px
  outline in the link colour in both themes; forced colours, reduced motion and touch targets
  (44 px) are respected; below 768 px the dialog fills the screen.
- Select2 (the dropdown's library) is removed from the page and the licence notices.

### Dark theme
- AnnZarro follows your system's light or dark setting, live: switch the system while the page is
  open and the app switches. The **System / Light / Dark** buttons at the right end of the dataset bar
  override it for this browser and are remembered there. The login page, the admin pages, the account
  page and the desktop app are themed too, and there is no flash of the wrong theme on load.
- Plots follow the theme for every colour you have not set (background, grid, axes, text, legend,
  colour bar, the toolbar, the grey Not in table points and the scale bar). A colour you set, or a
  plot theme button, is kept when the theme changes. Plot Options > Appearance has **Follow app
  theme** (and **Light colours** / **Dark colours**); a colour's **Reset** follows the theme again.
  The **Default** preset follows the theme, **Publication** stays white.
- Share links and panel sets store only the colours you set. A link from an earlier version opens
  with its colours equal to the old light defaults following the theme; the colours you chose, and
  the old Dark Theme button's, stay.
- Exports use the colours on screen: export in the Light theme (or with **Publication**) for a paper.
- Grid and axis colours apply from the first draw, and several grey-on-white text and control
  colours are slightly darker for WCAG AA contrast.

### Desktop app
- **Updates itself.** It looks for a newer release on launch and then once a day, asks before it
  downloads (Download, Later, Skip this version) and again before it restarts, and does nothing without
  your say-so. **Check for Updates...** is in the AnnZarro menu (macOS) or Help menu (Windows, Linux),
  next to an option that turns the automatic checks off; `ANNZARRO_DISABLE_UPDATES=1` turns updates off
  entirely. macOS, the Windows installer and the Linux AppImage update in place; a `.deb` and the
  Windows portable zip show a link to the new release. Checks contact only `github.com`. Updating
  starts with 0.5.3: users of 0.5.2 and older update by hand once
  ([details](https://annzarro.readthedocs.io/en/latest/getting-started/desktop-app.html#updates)).
- **Homebrew** on macOS: `brew install --cask settylab/annzarro/annzarro`; the app then updates itself.
  The tap follows each release.
- **No title bar** on macOS and Windows: the AnnZarro header is the title bar, at the same height as
  in the browser. On macOS the three window buttons sit at the top left and the AnnZarro title moves
  down below them. On Windows the minimise, maximise and close buttons, in the header's colours in the
  light and the dark theme, sit at the top right, above the panel set buttons. Drag the empty part of
  the header to move the window and double-click it to zoom it. Linux keeps its normal window frame.
- A **File** menu on every platform: **Open Dataset...** (`Cmd/Ctrl+O`, the dataset browser), **Open
  File or Folder...** (`Cmd+Shift+O` on macOS; **Open .h5ad File...** and **Open .zarr Folder...** on
  Windows and Linux), **Open Recent** and **Refresh Dataset**. The same buttons are in the dataset
  browser and on the welcome screen.
- Drag a `.zarr` folder or an `.h5ad` file onto the window to open it. Several items open the first and
  say so; anything else is refused with a message.
- `.h5ad` files open by double click and **Open With**, and `.zarr` folders through **Open With** or a
  drop on the Dock icon (on macOS they stay folders in Finder). A path on the command line opens in the
  running window. Opened datasets go to the Dock's and jump list's recent items, and the macOS window
  shows the file.

### Admin: remote datasets
- Whether the server may read `s3://`, `gs://`, `gcs://` and `http(s)://` datasets is set in the admin
  interface: **Data sources > Remote datasets** (the section was called Data directories) offers Off,
  Only these locations (a validated list of URL prefixes) and Any location (with a warning that the
  server then fetches any URL, internal addresses included). It takes effect at once in every worker,
  is audited, and the dataset browser's **Remote** place follows it. `server.remote_stores`,
  `server.remote_allowlist` and their environment variables stay the upper limit: an admin narrows
  them, never widens them, and the card shows what set the value.
- The Settings switch "No external hosts" is renamed "Gene Set Analysis: no external services" and says
  it does not affect remote datasets. Its key and API name are unchanged.
- The refusal "Remote datasets are disabled on this server" names Admin > Data sources > Remote
  datasets as well as `server.remote_stores`.

### Changed
- **Plot Options** opens with only the **Export** group unfolded; the groups you open or close are
  still remembered per panel.
- The Save / Load / Close all / Share buttons in the header line up with the focus boxes instead of
  the middle of their labels.
- **Load Panel Set** moved from Ctrl+O to **Ctrl+Shift+L** (**Cmd+Shift+L**); Ctrl+O opens the dataset
  browser. In the browser Ctrl+R reloads the page as the browser does and does not refresh the dataset
  (the **Refresh dataset** button does); the desktop app keeps Ctrl+R/Cmd+R for it.
- The header wraps the panel set buttons below the focus boxes only when the focus boxes and the
  icon-only buttons do not fit one row; a dataset name never changes the header.

### API
- `GET /api/v1/datasets/details?path=`: a store's counts, format, columns, obsm keys, layers and
  store-check findings, read from metadata only and stopped after
  `server.dataset_details_check_budget_s` (1.5 s by default).
- `sort=` and `order=` on `GET /api/v1/datasets/folder` (name or modified, applied before paging), and
  `folder=` on `GET /api/v1/datasets/search` to search below one folder.
- `POST /api/v1/datasets/lookup` answers which of a list of paths you may open, with the counts of
  each, and the same answer for a store that is not there and one you may not read.
  ([HTTP API reference](https://annzarro.readthedocs.io/en/latest/reference/http-api.html))

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
