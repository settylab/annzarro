# Command-line interface

The package installs one command, `annzarro`. All output below is from `annzarro <command> --help`.

```text
annzarro [-h] [--config CONFIG] [--debug] {start,stop,user,admin,install,config,desktop,export,store,serve} ...
```

| Global option | Meaning |
|---|---|
| `--config FILE` | Configuration file, layered over the built-in defaults and the system, user and project files ({doc}`configuration`). Must exist. `start`, `serve`, `user`, `admin` and the `config` subcommands also accept it after the subcommand (`annzarro user --config FILE add ...`). |
| `--debug` | Debug logging; a failing command also prints its traceback. |

## `annzarro start`

Start the server in the foreground, served by waitress with HTTP keep-alive (a plot's many requests share a few connections). Debug mode (`server.debug`) and HTTPS use Flask's development server (Werkzeug).

```text
annzarro start [--config CONFIG] [--host HOST] [--port PORT] [--data-dir DATA_DIR]
               [--auth-disabled] [--detach] [--development] [--venv-path VENV_PATH]
               [--no-browser]
```

| Option | Meaning |
|---|---|
| `--host HOST` | Address to bind (`server.host`, default `127.0.0.1`). Any address other than `127.0.0.1`, `localhost` or `::1` turns login on and confines paths to the data directory. |
| `--port PORT` | Port (`server.port`, default 8000). |
| `--data-dir DIR` | Data directory (`server.data_dir`, default `~/annzarro-data`, created if missing). `~` is expanded; a relative path is taken from the current directory. |
| `--auth-disabled` | Login off, even on a network address. There a `SECURITY` warning is logged and the header shows "No login". |
| `--no-browser` | Do not open a browser. Also implied by the environment variable `ANNZARRO_HEADLESS`. |
| `--detach` | Start the server in the background and write its PID to `~/.annzarro/server.pid` (`$ANNZARRO_HOME/server.pid`), mode 0600. |
| `--development` | Use the `development` defaults (Flask debug mode with the reloader and interactive debugger, CORS on, login off, DEBUG logging). Never on a reachable host. |
| `--config FILE` | As the global option. |
| `--venv-path PATH` | Accepted for the desktop app's launcher; has no effect. |

Without `--development` the server uses the `production` defaults. Examples:

```bash
annzarro start --data-dir ~/annzarro-data                      # laptop
annzarro start --no-browser --port 8765 --data-dir /data/stores  # behind an SSH tunnel
annzarro start --config site.yaml --detach
```

For a lab server use `annzarro serve` instead.

## `annzarro serve`

Start the production server: gunicorn with the bundled configuration
(`annzarro.server.gunicorn_config`) on the hosted WSGI factory, for a {doc}`lab server
<../deployment/lab-server>`. It needs the `server` extra (`pip install 'annzarro[server]'`) and
does not run on Windows; use `annzarro start` there.

```text
annzarro serve [--config CONFIG] [--host HOST] [--port PORT] [--workers N] [--threads N]
               [-- GUNICORN_ARGS]
```

| Option | Meaning |
|---|---|
| `--config FILE` | Site configuration file; default `$ANNZARRO_CONFIG`. Must exist. |
| `--host HOST`, `--port PORT` | Address to bind (`server.host`, default `127.0.0.1`; `server.port`, default 8000). |
| `--workers N` | Worker processes (`server.workers`; default twice the CPUs plus one, at most 4). |
| `--threads N` | Threads per worker (`server.threads`, default 4). |
| `-- ARGS` | Everything after `--` is passed to gunicorn, e.g. `-- --timeout 120`. |

The flags override the configuration files and `ANNZARRO_*` variables. Unlike `annzarro start`,
the server is hosted whatever the host: login is on unless the configuration says
`auth.enabled: false` (or `ANNZARRO_AUTH_DISABLED` is true), and dataset paths are confined to
the data directory. Before it starts, the command prints the URL, workers and threads, whether
login is on and the configuration file in use, then replaces itself with gunicorn, so the process
you started is gunicorn's master: SIGTERM stops it, SIGHUP reloads it, and systemd or a pid file
see the right process. It is shorthand for

```bash
gunicorn -c python:annzarro.server.gunicorn_config "annzarro.server.wsgi:create_wsgi_app()"
```

which keeps working.

## `annzarro stop`

Stop a server started with `--detach`. It reads `~/.annzarro/server.pid` (`$ANNZARRO_HOME/server.pid`)
and signals that process only if the file is yours and the process is your own `annzarro start`;
otherwise it refuses and removes the stale file. It sends SIGTERM, waits 5 s, then SIGKILL. A
server started in the foreground has no PID file; stop it with Ctrl+C. Exit status 1 when there
is nothing to stop.

## `annzarro user`

Manage the users file named by `auth.user_file` ({doc}`../deployment/authentication`). The
`user` commands read the same configuration as `annzarro start` (the `production` defaults plus
your files, including `ANNZARRO_CONFIG`). With `ANNZARRO_CONFIG` set as for the server they edit
its users file directly; otherwise pass the file: `annzarro user --config site.yaml add ...` or
`annzarro --config site.yaml user add ...`.

| Command | Meaning |
|---|---|
| `user add [--username NAME] [--password PW] [--admin]` | Add a user. Prompts for missing values; the password twice. `--admin` lets the user change any shared panel set, reassign its owner, clear the server's dataset cache and, with the default `server.arbitrary_paths: admins`, open any dataset path the server account can read. No dataset writes. Admins can also manage users in the admin interface ({doc}`/deployment/admin`). To confine admins, set `server.arbitrary_paths: local-only`. Exit 1 if the user exists. |
| `user list` | Print each username and whether it is an admin. |
| `user passwd [--username NAME] [--password PW]` | Change a password (prompted for if omitted). Ends the user's existing logins. |
| `user set-admin [--username NAME] [--no-admin] [--force]` | Grant admin, or revoke it with `--no-admin`. Revoking the last admin is refused unless `--force`. |
| `user remove [--username NAME] [--force]` | Remove a user. Exit 1 if there is no such user, or if it is the last admin (`--force` allows it; the server is then left without an admin). |
| `user unlock [--username NAME] [--address ADDR]` | Clear a user's failed-login lockouts, for one client address or all of them. |
| `user access NAME [--restrict\|--unrestrict] [--grant PATH] [--grant-stores-in DIR] [--revoke PATH] [--show]` | Restrict a user to the folders, stores and remote prefixes granted to them, or show what they see ({doc}`/deployment/authentication`). A running server applies it at once; each change is audited. Admins are never restricted. Exit 1 for an unknown user, a path outside every data directory, or a grant that is not there to revoke. |

A running server sees every change without a restart. The rule that at least one admin remains is
checked on the stored users file under its lock, the same one the admin page uses, so it holds
even when the command line and the web run at the same time; `--force` skips only that rule.
Every change is also recorded in the admin audit log with `via: cli:<account>`. Run the commands as
the account that owns the users file's directory (`sudo -u <server account> annzarro user ...`); as
another account they refuse (except `list`), because the files they would create could not be
written by the server.

## `annzarro admin audit verify`

Check the hash chain of the admin audit log ({doc}`../deployment/admin`). Prints the range of
sequence numbers and the number of records and exits 0 when the chain holds; otherwise names the
first record that no longer fits and the problem (`tampered`, `truncated` or `head_unreadable`) and
exits 1. It reads the same configuration as `annzarro user`.

## `annzarro config`

| Command | Meaning |
|---|---|
| `config show [--format yaml\|json] [--env production\|development] [override flags]` | Print the merged configuration, every source considered (loaded, not found, ignored) and, at the end, each value not taken from the built-in defaults with its origin. Keys the schema marks sensitive (`auth.secret_key`, `server.cert_file`, `server.key_file`) are masked ({doc}`configuration`). Exit 1 if the result is invalid, but it is printed anyway. The YAML output can be saved and used with `--config`. |
| `config validate [--file FILE] [--env ...] [override flags]` | Validate the merged configuration, or with `--file` one file layered over the built-in defaults. Exit 1 on errors. |
| `config info [--env ...] [override flags]` | Print the loaded sources, the `ANNZARRO_*` environment variables and the command line. Secret values (variables setting a sensitive key or naming a secret, password, token or credential; `--password` arguments) are masked. |
| `config init [--output FILE] [--force]` | Write a copy of the built-in `base.yaml` (default `./config.yaml`; refuses to overwrite without `--force`). Comments are not kept. |

The override flags are those of `start`: `--config`, `--host`, `--port`, `--data-dir` and
`--auth-disabled`, so `annzarro config show --host 0.0.0.0` shows what `annzarro start --host
0.0.0.0` would run with (including `auth.enabled: true  <- derived:non-loopback host`).
`--env` defaults to `production`, like `start`.

## `annzarro install`

Create a virtual environment and install AnnZarro's server requirements and an editable
install of the source checkout into it. Meant for a source checkout (`./annzarro-cli install`
uses it); with pip or uv you do not need it.

| Option | Meaning |
|---|---|
| `--venv` / `--no-venv` | Create and use a virtual environment (default) or install into the current interpreter. |
| `--venv-path PATH` | Where to create it (default `venv`). |
| `--no-uv` | Use pip even if `uv` is found. |
| `--upgrade` | Upgrade packages that are already installed. |

## `annzarro desktop`

Build and run the Electron desktop app. Works only from a source checkout with Node.js and npm
(from a pip installation the command stops with an error saying so)
({doc}`../getting-started/desktop-app`).

| Command | Meaning |
|---|---|
| `desktop run [--icon PNG]` | Run the app in development mode. |
| `desktop build [--platform windows\|win\|mac\|macos\|linux\|all] [--rebuild] [--no-build-server] [--icon PNG]` | Freeze the server with PyInstaller, then build installers into `annzarro/desktop/electron/dist/` (default: current platform). `--no-build-server` reuses the frozen server in `annzarro/desktop/electron/server/`. |
| `desktop icons --icon PNG [--desktop-icons] [--web-icons] [--all]` | Generate app icons and web favicons from one high-resolution PNG (needs Pillow). |

## `annzarro export`

Write a saved view's plots as PNG or SVG files, as each plot's **Export** button would, from a
headless browser ({doc}`../user-guide/reproducing`). Needs `pip install 'annzarro[export]'` and
`python -m playwright install chromium`.

| Option | Meaning |
|---|---|
| `SOURCE` | A panel set file (`.json`) or a share link. |
| `--from FIGURE` | Instead of `SOURCE`: an exported PNG or SVG, made again from the recipe it carries. |
| `--store PATH` | The store to draw from (required). A store with other cells or genes than the view was saved on stops the command. |
| `--out FILE` | `.png` or `.svg`. Several plots: one file per plot, `<stem>-<panel id>.<ext>`. |
| `--panel ID` | Only this plot (its tile id, e.g. `cell-plot-1`). |
| `--allow-other-store` | Export even from a store with other cells or genes. |
| `--timeout S` | Seconds to wait for the plots to be drawn (default 600). |
| `--verbose` | Show the local server's log and page errors. |

Exit status 0 on success, 2 when the view, store or output cannot be used (the message says why).

## `annzarro store check`

Report what in a store's layout makes AnnZarro slow, before you serve it. It reads metadata only
(shapes, dtypes, chunks, attributes, the consolidated metadata) and no chunk, so it takes about a
second even on a store of 95.6 million cells. It works on local directories and on `s3://`,
`gs://` and `http(s)://` URLs (read-only; `pip install 'annzarro[remote]'`), and on zarr format 2
and 3, sharded or not.

```text
annzarro store check STORE [--json] [--fail-on {info,warning,slow,never}] [--config FILE] [--max-read-mb MB]
```

| Option | Meaning |
|---|---|
| `STORE` | A zarr store: a directory or a URL. An `.h5ad` file is refused. |
| `--json` | Print the report as JSON (schema `annzarro-store-check/1`, below) instead of text. |
| `--fail-on SEVERITY` | Exit 1 when a finding is at or above this severity: `info`, `warning`, `slow` (default) or `never`. |
| `--config FILE` | Configuration file (or `ANNZARRO_CONFIG`): its `server.max_read_mb` is the read limit to judge `obsp`/`varp` rows against. |
| `--max-read-mb MB` | The same limit, given directly; overrides the configuration. Default: the server's own default for this machine (5% of memory, 256 MB to 4 GB). |

The text report lists every 2-D array (encoding, shape, dtype, chunks and shards, the bytes one
gene column and one cell row read), then each finding with its severity, **what it costs in
AnnZarro terms** and **how to fix it** with anndata or zarr. For example:

```text
[SLOW] sparse_wrong_direction: X
  X is CSR (1,000,000 x 5,000, 101,000,000 non-zeros) and is read by gene column.
  Cost: Each gene click reads every non-zero value of X: ~771 MB (about 101 ms warm and local,
        longer over a network), against ~16 MB from CSC.
  Fix: sp.csc_matrix(adata.X) ... adata.write_zarr(path + ".new")
```

Severities: `slow` is a layout that makes a click take seconds, or that the server refuses (a
CSR `X` at atlas size, whole-gene chunks of a dense layer, `obsp` rows over `max_read_mb`,
metadata that is out of date or missing on a remote store); `warning` costs noticeably;
`info` is worth knowing. The numbers that decide them are in one module
(`annzarro/core/layout_thresholds.py`), and the `obsp`/`varp` test is the server's own function,
so the command and the server's open-time notice do not disagree. Findings (`code`):

| Code | What it finds |
|---|---|
| `sparse_wrong_direction` | A gene column read from CSR (`X`, layers) or a row read from CSC (`obsp`, `varp`): every stored index is scanned, about 1 ns per non-zero. |
| `sparse_cell_direction` | `X` or a layer in CSC: gene columns are cheap, but a Gene Plot coloured by it and a table column of a named cell's expression read a cell row, which scans every non-zero (`info`; `warning` from 1 GB). |
| `dense_chunk_shape` | A dense `X` or layer whose chunks make a gene column or cell row decompress 8 times (`warning`) or 16 times (`slow`) what chunks following the matrix's aspect ratio would ({doc}`../data/chunking`). |
| `pairwise_row_read` | A dense `obsp`/`varp` whose row read holds more than the read limit: focusing a cell is refused. The same test as the server's `pairwise_chunking` notice. |
| `float64` | A float64 array of 16 MB or more (`warning` from 256 MB). |
| `chunk_too_large`, `chunk_too_small` | Chunks over 32 MB uncompressed, or under 64 KB in an array of 1,000 chunks or more (guidance: about 2 MB). |
| `obs_string_column`, `categorical_wide_codes`, `categorical_unique` | `obs`/`var` columns that are plain strings (100,000 rows or more), categoricals with 32- or 64-bit codes where 8 or 16 bits do, or with nearly as many categories as rows: each use reads and decodes all of it. |
| `index_full_read` | A name index of 10 million names or more, or one chunk of over 5 million: the first name search decodes all of it. |
| `unconsolidated`, `stale_consolidated` | No `.zmetadata` (every node is a separate read: slow on NFS, `slow` on a remote store), or one that no longer matches the store. |
| `unsharded_many_chunks`, `many_files` | A zarr format 3 store without shards and with 50,000 chunks or more, or any store with 100,000 chunk files or more. |
| `not_anndata` | No `X`, `obs` or `var` (an interrupted write). |

`--json` prints one object:

| Key | Content |
|---|---|
| `schema`, `annzarro_version` | `"annzarro-store-check/1"` and the version that ran. |
| `store`, `remote`, `zarr_format`, `consolidated`, `nodes`, `files`, `max_read_mb` | The store as opened, its format, whether it has consolidated metadata, how many groups and arrays and chunk files (shards when sharded) it has, and the limit used. |
| `arrays` | One object per 2-D array: `element`, `encoding` (`dense`, `csr`, `csc`), `shape`, `dtype`, `chunks`, `shards`, `gene_column_bytes`, `cell_row_bytes`, `gene_column_seconds`, `cell_row_seconds` (sparse only), `severity` (`ok` or the worst finding). |
| `findings` | Most severe first; each has `code`, `severity`, `element`, `summary`, `cost`, `fix` and a `details` object with the numbers. |
| `counts`, `worst` | Findings per severity, and the worst severity (`ok` when none). |
| `fail_on`, `failed` | The `--fail-on` given and whether it was met. |

Exit status 0 when no finding is at or above `--fail-on`, 1 when one is (so
`annzarro store check atlas.zarr && deploy` is a gate), 2 when the store cannot be opened.
`store rewrite` does not exist yet: the fixes are snippets to run yourself.

## `annzarro store annotate`

Record a dataset's attribution and README in a local zarr store, without loading its matrices.
AnnZarro shows them behind the dataset's information button and in the dataset browser
({doc}`../deployment/dataset-attribution`).

```text
annzarro store annotate STORE [--title T] [--description D] [--license L] [--license-url U]
                        [--citation C] [--doi DOI] [--author NAME]... [--source-url U]
                        [--contact C] [--attribution A] [--from-json FILE] [--readme FILE]
```

| Option | Meaning |
|---|---|
| `STORE` | A local zarr store (format 2 or 3). A remote store is refused; an `.h5ad` file is annotated with anndata (`adata.uns["annzarro"] = {...}`). |
| `--title`, `--description`, `--license`, `--license-url`, `--citation`, `--doi`, `--source-url`, `--contact`, `--attribution` | The fields of `uns["annzarro"]`. `--license` takes an SPDX identifier (`CC-BY-4.0`) or text. |
| `--author NAME` | An author; repeat for several. |
| `--from-json FILE` | A JSON object of fields with the richer forms (`funding`, `contacts`, an object for `license` ...); the options above override it. The command writes the schema marker (`schema_version` 1.0) and refuses a value the reader would not use ({ref}`dataset-info-schema`). |
| `--readme FILE` | A Markdown file (UTF-8, at most 256 KB), stored as `uns["README"]`. |

Only the fields you give are written, and the other `uns` entries stay; run it again to change
one. A consolidated store is consolidated again afterwards. It prints what it wrote; exit status 0
on success, 2 when the store or the README file cannot be used (the message says why).

## Environment variables

| Variable | Effect |
|---|---|
| `ANNZARRO_<SECTION>_<KEY>` | Sets any configuration key, e.g. `ANNZARRO_SERVER_PORT=9000`, `ANNZARRO_SERVER_CACHE_MEMORY_MB=1000`, `ANNZARRO_AUTH_ENABLED=true`, `ANNZARRO_AUTH_SECRET_KEY=...`, `ANNZARRO_SERVER_HOSTED=true`, `ANNZARRO_SERVER_WORKERS=2`, `ANNZARRO_SERVER_ALLOWED_DIRS=/a,/b` (comma-separated list). Variables that name no key are listed as "ignored" by `config show`. |
| `ANNZARRO_REMOTE_STORES`, `_ALLOWLIST`, `_CREDENTIALS`, `_CONNECT_TIMEOUT`, `_READ_TIMEOUT`, `_REQUEST_TIMEOUT`, `_CHUNK_CACHE_MB` | Override the `server.remote_*` keys ({ref}`config-environment`). |
| `ANNZARRO_AUTH_DISABLED` | `true`, `yes`, `1` or `on`: login off, as `--auth-disabled`, for `annzarro start` and gunicorn alike. Any other value leaves login as configured. |
| `ANNZARRO_HOME` | State directory instead of `~/.annzarro` (log, PID file, default users file and login key, and `freshness/`, the datasets' generations behind every ETag). Give each server on a host its own: one server's start invalidates the ETags of every server sharing the directory, so their browsers fetch everything again ({ref}`several services on one host <lab-server-several>`). |
| `ANNZARRO_HEADLESS` | Any value: never open a browser. |
| `ANNZARRO_EXTERNAL_REQUESTS` | `off`, `ask`, `on` or `none`: overrides `integrations.external_requests`, whether the Gene Set Analysis panel may contact external services. Any other value is ignored. |
| `ANNZARRO_CONFIG` | Configuration file used when `--config` is not given, by every `annzarro` command and by the WSGI entry point (gunicorn). `--config` wins if both are set. |
| `ANNZARRO_ENV` | `production` (default) or `development`, for the WSGI entry point. |
| `XDG_CONFIG_HOME` | Moves the user configuration file `~/.config/annzarro/config.yaml`. |
