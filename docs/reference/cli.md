# Command-line interface

The package installs one command, `annzarro`. All output below is from `annzarro <command> --help`.

```text
annzarro [-h] [--config CONFIG] [--debug] {start,stop,user,install,config,desktop} ...
```

| Global option | Meaning |
|---|---|
| `--config FILE` | Configuration file, layered over the built-in defaults and the system, user and project files ({doc}`configuration`). Must exist. `start`, `user` and the `config` subcommands also accept it after the subcommand (`annzarro user --config FILE add ...`). |
| `--debug` | Debug logging; a failing command also prints its traceback. |

## `annzarro start`

Start the server in the foreground (Flask's threaded server, Werkzeug).

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

For a lab server use gunicorn instead ({doc}`../deployment/lab-server`).

## `annzarro stop`

Stop a server started with `--detach`. It reads `~/.annzarro/server.pid` (`$ANNZARRO_HOME/server.pid`)
and signals that process only if the file is yours and the process is your own `annzarro start`;
otherwise it refuses and removes the stale file. It sends SIGTERM, waits 5 s, then SIGKILL. A
server started in the foreground has no PID file; stop it with Ctrl+C. Exit status 1 when there
is nothing to stop.

## `annzarro user`

Manage the users file named by `auth.user_file` ({doc}`../deployment/authentication`). The
`user` commands read the same configuration as `annzarro start` (the `production` defaults plus
your files), so pass the server's configuration file to edit the same users file:
`annzarro user --config site.yaml add ...` or `annzarro --config site.yaml user add ...`.

| Command | Meaning |
|---|---|
| `user add [--username NAME] [--password PW] [--admin]` | Add a user. Prompts for missing values; the password twice. `--admin` lets the user delete, rename or overwrite any shared panel set and grants nothing else. Exit 1 if the user exists. |
| `user list` | Print each username and whether it is an admin. |
| `user passwd [--username NAME] [--password PW]` | Change a password (prompted for if omitted). Ends the user's existing logins. |
| `user set-admin [--username NAME] [--no-admin]` | Grant admin, or revoke it with `--no-admin`. |
| `user remove [--username NAME]` | Remove a user. Exit 1 if there is no such user. |

A running server sees every change without a restart.

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
| `desktop build [--platform windows\|win\|mac\|macos\|linux\|all] [--rebuild] [--bundle-venv \| --no-bundle-venv] [--venv-path PATH] [--icon PNG]` | Build installers into `annzarro/desktop/electron/dist/` (default: current platform, with a bundled Python environment). |
| `desktop icons --icon PNG [--desktop-icons] [--web-icons] [--all]` | Generate app icons and web favicons from one high-resolution PNG (needs Pillow). |

## Environment variables

| Variable | Effect |
|---|---|
| `ANNZARRO_<SECTION>_<KEY>` | Sets any configuration key, e.g. `ANNZARRO_SERVER_PORT=9000`, `ANNZARRO_SERVER_CACHE_MEMORY_MB=1000`, `ANNZARRO_AUTH_ENABLED=true`, `ANNZARRO_AUTH_SECRET_KEY=...`, `ANNZARRO_SERVER_HOSTED=true`, `ANNZARRO_SERVER_WORKERS=2`, `ANNZARRO_SERVER_ALLOWED_DIRS=/a,/b` (comma-separated list). Variables that name no key are listed as "ignored" by `config show`. |
| `ANNZARRO_REMOTE_STORES`, `_ALLOWLIST`, `_CREDENTIALS`, `_CONNECT_TIMEOUT`, `_READ_TIMEOUT`, `_CHUNK_CACHE_MB` | Override the `server.remote_*` keys. |
| `ANNZARRO_AUTH_DISABLED` | `true`, `yes`, `1` or `on`: login off, as `--auth-disabled`, for `annzarro start` and gunicorn alike. Any other value leaves login as configured. |
| `ANNZARRO_HOME` | State directory instead of `~/.annzarro` (log, PID file, default users file and login key). |
| `ANNZARRO_HEADLESS` | Any value: never open a browser. |
| `ANNZARRO_CONFIG` | Configuration file used when `--config` is not given, by every `annzarro` command and by the WSGI entry point (gunicorn). `--config` wins if both are set. |
| `ANNZARRO_ENV` | `production` (default) or `development`, for the WSGI entry point. |
| `XDG_CONFIG_HOME` | Moves the user configuration file `~/.config/annzarro/config.yaml`. |
