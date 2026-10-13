# Desktop app or server

AnnZarro runs as a standalone desktop app on one computer, or as a server that many people reach
from a browser. The interface, the panels and the dataset format are the same in both
({doc}`../deployment/modes` has the full table including the personal server).

```{include} ../_snippets/modes.md
```

## Side by side

| | Desktop app | Server mode (lab server) |
|---|---|---|
| For | one person, data on their computer | a lab or institute sharing datasets |
| Install | download for macOS, Windows or Linux; no Python needed | `pip install annzarro gunicorn` on a Linux host, behind a reverse proxy |
| Reached through | the app window | a browser, over HTTPS |
| Login | none | users and passwords, admins |
| Datasets | local `.zarr` stores | stores in the server's data directory and in `allowed_dirs`; remote stores from `remote_allowlist` |
| Panel sets | yours | shared by all users, with owners |
| Network | works offline | needs the network |
| Set-up | {doc}`desktop-app` | {doc}`../deployment/lab-server` |

## Advantages of server mode

- **Multi-user access.** Users sign in through a browser with a username and password; nothing is
  installed on their side ({doc}`../deployment/authentication`).
- **Panel set exchange.** Panel sets are saved on the server and listed for every user, with the
  owner shown. Only the owner or an admin can overwrite, rename or delete one
  ({doc}`../user-guide/panel-sets`).
- **Large server-hosted datasets.** The server reads the chunks a view needs and sends the
  browser only those vectors, so a dataset never has to be copied to each computer
  ({doc}`../deployment/modes`).
- **User access control.** An admin can restrict a user to chosen datasets and grant folders,
  stores or remote prefixes. Admins manage users, access and the rest of the server on the admin
  page ({doc}`../deployment/authentication`, {doc}`../deployment/admin`).
- **Less memory on the user's computer.** The data are read on the server; the browser holds only
  what is displayed.
- **Read-only by design.** The server never writes to datasets and never runs user code
  ({doc}`../deployment/lab-server`).

## Advantages of the desktop app

- **No Python installation.** The app contains its own server and interface.
- **Offline.** Nothing is fetched at install, at launch or later.
- **Private.** The server listens on `127.0.0.1` only and the data stay on your computer.
- **Local files.** Open a `.zarr` folder anywhere on disk with the folder button, or put stores
  in `~/annzarro-data/datasets`.

## Which one

- Only you, data on your computer: the desktop app.
- Only you, data on a cluster or workstation: a personal server over SSH
  ({doc}`../deployment/personal-server`).
- Several people, shared datasets, shared panel sets or per-user access: a lab server.
