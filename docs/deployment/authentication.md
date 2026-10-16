# Login, users and permissions

AnnZarro never writes datasets. The only thing users create on a server is **panel sets**,
saved as JSON in `<data_dir>/sessions/` and listed for every user of that server. Login decides
who can reach the server at all and who may change which panel set.

## When login is on

| How the server is started | Login |
|---|---|
| `annzarro start` on `127.0.0.1`, `localhost` or `::1` | off, unless `auth.enabled: true` is configured |
| `annzarro start --host <anything else>` | **on**, unless `--auth-disabled` or `ANNZARRO_AUTH_DISABLED=true` (only `true`, `yes`, `1` or `on` count) |
| gunicorn with `annzarro.server.wsgi:create_wsgi_app()` | **on**, unless `auth.enabled: false` or `ANNZARRO_AUTH_DISABLED=true` |
| desktop app | off |

With login on, every page and API route except `/login`, `/logout` and static files requires a
signed-in session. A browser without one is redirected to `/login`; an API client gets
`401 {"error": "Authentication required"}`.

```{figure} ../_static/screens/deployment/login.png
:class: screenshot
:alt: The AnnZarro sign-in page with lab name and contact address

The sign-in page. The title, the line under the form and the contact block come from
`branding.app_name`, `branding.project_description` and `branding.contact_info`.
```

After signing in, the browser returns to the address that was asked for. A share link opened
while signed out keeps its dataset and its view (the `#view=` fragment) through the login page.

Once signed in, the header shows the username under the app name; it reads "alice (admin)" for
an admin. Click it to log out.

```{figure} ../_static/screens/deployment/header-signed-in.png
:class: screenshot
:alt: Header badge showing the signed-in user alice as admin

The signed-in badge. Its tooltip says what this user may change.
```

## Managing users

Users live in one JSON file, `auth.user_file` (default `~/.annzarro/auth/users.json` of the
account running the server). Passwords are stored as salted hashes: scrypt, or `pbkdf2:sha256`
on a Python whose `hashlib` has no scrypt (Apple's Xcode Python 3.9, built against LibreSSL). The
file is created with mode 0600. Run the `user` commands as the account
that runs the server, with the same configuration, so they edit the same file. The `user`
commands read the same `production` configuration as `annzarro start`, including the file named
by `ANNZARRO_CONFIG`; on a lab server set it once as for gunicorn:

```bash
export ANNZARRO_CONFIG=/etc/annzarro/site.yaml
annzarro user add --username alice --admin   # prompts for the password
annzarro user add --username bob
annzarro user list
annzarro user remove --username bob
```

Without `ANNZARRO_CONFIG`, pass the file with `--config` (`annzarro --config site.yaml user ...`
or `annzarro user --config site.yaml ...`). `--password` exists, but it puts the password into
your shell history and the process list; leave it out and type the password at the prompt.

Change a user later without removing them:

```bash
annzarro user passwd --username bob             # prompts for the new password
annzarro user set-admin --username bob          # grant admin
annzarro user set-admin --username bob --no-admin
```

A running server re-reads the users file when it changes: added and removed users and changed
admin rights take effect without a restart, including for sessions that are already signed in
(admin status is looked up on every request, not trusted from the cookie). Changing a password
or removing a user ends that user's existing logins. Panel sets keep their owner, which is
stored by username.

**A hash this Python cannot check.** A scrypt hash written on one Python cannot be verified on a
Python without scrypt (for example after moving the users file, or switching the server to
Apple's Xcode Python). Login then fails with "This server cannot check your password on its
current Python installation. Please tell the administrator (the server log says why)." and is
not counted as a failed attempt. Fix it by running `annzarro user passwd --username <name>` with
the server's own Python (the new hash is then `pbkdf2:sha256`), or by running the server on a
Python built against OpenSSL.

**Lockout.** After 5 failed sign-ins from one client address, that username is locked for that
address for 15 minutes, even for the correct password. The count is kept in the users file, so
every gunicorn worker sees it. Behind a reverse proxy, `server.proxy_count` must match the number
of proxies so that the address is the client's; with 0 every user appears to come from the proxy
and one person's typos lock the username for everyone.

**How long a login lasts.** A login expires after `auth.session_timeout` seconds without a
request (28,800, i.e. 8 hours, by default; `0` means never). The session cookie is `HttpOnly`
and `SameSite=Lax`; with `auth.cookie_secure: auto` (the default) it is also marked `Secure`
whenever the request arrived over HTTPS, directly or as reported by `X-Forwarded-Proto` from the
`server.proxy_count` trusted proxies. `true` forces the flag (login over plain `http://` then
stops working), `false` never sets it.

## Restricting a user to chosen datasets

By default every signed-in user can open every dataset in the data directories. To give an
external collaborator only some of them, restrict that user and grant what they may see:

```bash
annzarro user access carol --restrict
annzarro user access carol --grant /srv/atlases/pbmc            # a folder: its whole subtree
annzarro user access carol --grant /srv/annzarro-data/bm.zarr   # one store
annzarro user access carol --grant-stores-in /srv/annzarro-data/curated   # every store directly in a folder of links
annzarro user access carol --grant s3://lab-public/pbmc/         # a remote prefix inside server.remote_allowlist
annzarro user access carol --revoke /srv/atlases/pbmc
annzarro user access carol --show                                # restriction, grants and which are active
annzarro user access carol --unrestrict                          # back to everything (the grants are kept)
```

The grants live in `annzarro_admin/access.json` beside the users file and take effect on the
running server at the next request of every worker. Each change is written to the admin audit
log. Admins are never restricted. Removing a user drops their grants.

A restricted user with no grant sees nothing. For them:

- Every dataset route, folder listing and search answers a path outside their grants exactly as
  it answers a dataset that does not exist (404 `not_found`, naming the path as they wrote it),
  whether the path is in a data directory, outside every one, or missing. The dataset
  browser (its root is the list of their grants), its search and the legacy listing show the
  grants and nothing else, and no reply names the data directory or the folders above a grant.
- Grants are matched on real paths: a symlink inside a granted folder that leads out of it is not
  covered (grant the link's target store, or use `--grant-stores-in` for a folder of links),
  `/data/a` does not cover `/data/ab`, and on a case-insensitive filesystem (the macOS default) a
  case or Unicode-form variant of a granted path is allowed when it names the same file on disk,
  while a variant of anything not granted, or one that is a different directory, is refused.
- A grant is active only while its real path is inside a data directory of the server. A
  data directory removed, or a link re-pointed outside, deactivates it (`--show` says so).
- Panel sets: they see their own, and those whose datasets they can all read. Others answer as
  missing. A set saved over a hidden one's name answers 409 `name_taken` without naming the owner.
- A link or panel set naming a dataset outside their grants opens the layout with a "Dataset not
  available" notice. A grant revoked while a dataset is open turns the next read into the same
  notice. What the browser already holds cannot be recalled.
- `/status` and `/cache/info` (they name the data directory and every cached dataset) answer
  403 `admin_only`.

If `access.json` cannot be read or parsed, the server cannot tell who is restricted, so every
non-admin gets 503 `access_unavailable` on the data routes until an administrator repairs or
removes the file; admins keep working.

Limits: the check resolves the path with `realpath` before it refuses, so the time a refusal
takes can tell whether a directory component of a path exists (never what is in it); and a
store whose link is swapped between the check and the open is read through the new link, which
only someone who can write to the data directory can arrange.

**Forged requests.** `SameSite=Lax` is not the only protection. With login on, every request that
changes something (saving, renaming, importing or deleting a panel set, refreshing a dataset,
clearing the cache, signing out) must carry the token the page was given at login, in the
`X-AnnZarro-CSRF` header, and a browser's `Origin` and `Sec-Fetch-Site` must say the request comes
from the page itself. The sign-in form has its own one-time token, held in a short-lived
`SameSite=Strict` cookie and a hidden field. Signing out is a button (`POST /logout`); opening
`/logout` in the address bar shows that button. Without login there is no token to hold, so only
the `Origin` and `Sec-Fetch-Site` checks apply, and requests without them (`curl`, `annzarro export`)
pass. Behind a reverse proxy that terminates TLS, set `server.proxy_count` (above), or the `Origin`
the browser sends will not match the address the server sees and every change is answered 403.

## Who may change a panel set

| Action | Without login | With login: any user | With login: owner | With login: admin |
|---|---|---|---|---|
| List, load, export, duplicate | yes | yes | yes | yes |
| Save a new panel set | yes | yes | | |
| Save over, import over, rename, delete | yes | no | yes | yes |
| Reassign the owner | | no | no | yes |

- The **owner** is the user who first saved the panel set. The server records `owner`,
  `created_at`, `modified_at` and `modified_by` itself and discards any values a client sends
  for them, so ownership cannot be claimed by editing a JSON file and importing it.
- A refused change is answered with HTTP 403 naming the owner, and the app shows it as a
  permission notice, suggesting to save under a new name instead.
- **Admins** (`user add --admin`) may change any panel set, reassign its owner, clear the
  server's dataset cache and, with the default `server.arbitrary_paths: admins`, open any dataset
  path the server account can read, not only the data directories (each open is logged). They
  cannot write to datasets. Users are managed with `annzarro user` or in the admin interface
  ({doc}`admin`), not in the viewer.
  To confine admins to the data directories, set `server.arbitrary_paths: local-only` (or
  `none`); see below.
- Panel sets saved **before owners were recorded** have no owner and can only be changed by an
  admin. An admin can hand one to a user:

  ```bash
  curl -b cookies.txt -H 'Content-Type: application/json' \
       -d '{"name": "<panel set>", "owner": "<username>"}' \
       https://annzarro.example.org/api/v1/sessions/owner
  ```

  where `cookies.txt` holds an admin's signed-in session. The new owner must be an existing user.

See {doc}`../user-guide/panel-sets` for the panel-set dialogs themselves.

## The login key

Flask keeps the signed-in username in a cookie signed with `auth.secret_key`. Anyone who knows
that key can forge a cookie for any user, admins included.

- **Leave `auth.secret_key` unset.** On first start with login on, AnnZarro generates a random
  64-character key and stores it as `annzarro_secret_key`, mode 0600, in the same directory as the
  users file. Every later start and every gunicorn worker that uses the same users file reads it,
  so logins survive restarts and work across workers.
- Deleting that file signs everyone out (a new key is generated at the next start).
- The placeholder values that earlier versions shipped (`change-this-in-production` and
  similar) are ignored with a `SECURITY` warning.
- If the directory is not writable, the server falls back to a random in-memory key and warns:
  logins then end at every restart and fail across workers.
- To set a key yourself (for example to share one across hosts), put a long random value in
  `auth.secret_key` in a configuration file readable only by the service account, or in the
  environment variable `ANNZARRO_AUTH_SECRET_KEY`.

## Paths: what a signed-in user can open

On a shared server (login on, a network address, or the WSGI entry point) every local path a
request names (`dataset_path`, the directory browser, the dataset routes) must resolve, after
following symlinks and `..`, inside `server.data_dir` or one of `server.allowed_dirs`. Anything
else is refused with HTTP 403 and the reason `outside_data_dir`; the message names no server
directories. Login is checked first, so a client without a session gets 401 (or the login page)
before any path is looked at.

- `allowed_dirs` grants a whole directory tree, not single datasets. Listing `/lab/atlases`
  lets every user open any store under `/lab/atlases` by typing its path, whether or not it is
  linked into the data directory. To share single datasets, list the stores themselves
  (`/lab/atlases/bm_aging_annzarro.zarr`).
- A symlink in the data directory whose target is outside every allowed root is left out of the
  dataset browser and refused if opened by path. The startup log names every such link.
- Who may open a path outside those directories is `server.arbitrary_paths`:

  | `arbitrary_paths` | shared server (login on, or a network host) | local single-user server (loopback, no login) |
  |---|---|---|
  | `admins` (default) | admins only; each such open is logged with the admin's name | its one user: any path the account can read |
  | `local-only` | nobody, admins included | its one user |
  | `none` | nobody | nobody |

  **An admin login can read any file the server process can read.** With the default, the
  server opens whatever path an admin types, so treat an admin password like access to the
  service account's files. To confine admins as well, set:

  ```yaml
  server:
    arbitrary_paths: none     # or local-only, which leaves a laptop's own user free
  ```

  (`ANNZARRO_SERVER_ARBITRARY_PATHS=none` does the same.) Other users are always confined.
  Admin status is read from the users file on every request, so `annzarro user set-admin
  --no-admin` takes effect at once. `GET /api/v1/auth/me` reports `may_open_any_path` for the
  current user.
- Only `s3://`, `gs://`, `gcs://`, `http://` and `https://` count as remote stores; they skip
  this check and follow the remote-store policy below. Any other `scheme://` path (`file://`,
  `ftp://`) is checked as a local path, so on a shared server it is refused.

## Remote stores

Opening `s3://`, `gs://` or `http(s)://` stores makes the *server* fetch a URL the *user* chose.
On a shared server that would let any user point it at internal services, so the policy
`server.remote_stores` (`auto`, `allow`, `deny`) and `server.remote_allowlist` decide:

- `auto` (default) allows any URL only on a local single-user server: loopback host, login off
  and `proxy_count` 0. Otherwise remote stores are off unless `remote_allowlist` is set, and then
  only URLs under those prefixes open (matched on scheme, host and whole path segments; HTTP
  redirects are not followed).
- `allow` turns them on regardless; with an allowlist it still restricts. `allow` without an
  allowlist on a server with login logs a warning.
- `deny` turns them off.

An administrator can set the same decision in the browser under **Admin > Data sources > Remote
datasets** (off, only a list of locations, or any location), without a restart
({ref}`admin-remote-datasets`). The YAML or environment value is the upper limit: the admin
can narrow it, never widen it, and `deny` leaves the card locked. A restricted user still opens
only the remote prefixes they were granted.

A refused URL gets HTTP 403 and is never fetched. Credentials are never accepted inside the URL,
and query strings (pre-signed URLs) are refused. Each connection is bounded by
`remote_connect_timeout_s` (10 s) and `remote_read_timeout_s` (30 s); a store that stops answering
fails the request with 504. Details and credential options are in
{doc}`../user-guide/remote-datasets` and {doc}`../reference/configuration`.
