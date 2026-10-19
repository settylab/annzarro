# Hosting checklist

Go through this list before you give a lab server's address to anyone. Each item names the
setting or command that checks it. Background is in {doc}`lab-server` and {doc}`authentication`.

## Before the first user

- **TLS in front.** The server listens on `127.0.0.1` and is reached only through an HTTPS
  proxy. Plain HTTP sends passwords and session cookies in clear text.
- **Login is on.** `curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/v1/datasets`
  returns `401`. The startup log contains no `SECURITY` banner.
- **No "No login" badge.** If the header shows it, the server is shared with login off
  (`--auth-disabled`, `ANNZARRO_AUTH_DISABLED=true` or `auth.enabled: false`). Anyone who reaches the
  port can then open every dataset under the data directory and delete every panel set.

  ```{figure} ../_static/screens/deployment/header-no-login.png
  :class: screenshot
  :alt: Header with the yellow No login badge

  The warning badge of a shared server without login.
  ```

- **Login key unset and private.** `auth.secret_key` is not in any configuration file;
  `annzarro_secret_key` beside the users file exists with mode 0600 and is not in a backup that
  others can read. Anyone holding it can sign in as any user.
- **Users file private.** `auth.user_file` points outside the data directory, mode 0600,
  owned by the service account.
- **Admins are few.** `annzarro user list` shows "Admin: Yes" only for people who should be
  manage users, data directories and settings in the admin interface ({doc}`admin`) and delete or
  overwrite anyone's panel sets.
- **Data directory and allowed directories are what you mean to share.**
  `annzarro config show --config <file>` lists `server.data_dir` and `server.allowed_dirs`. Every
  readable store under those trees can be opened by every unrestricted user, linked or not ({doc}`authentication`).
- **Admins can read any file the server process can.** By default
  (`server.arbitrary_paths: admins`) an admin may open any path the service account can read,
  and each such open is logged with the admin's name; other users stay confined to the trees
  above. Keep the admin list short, or lock admins in too with `server.arbitrary_paths: none`.
- **Threaded workers.** The bundled gunicorn configuration, which `annzarro serve` runs, uses
  `gthread` (`server.threads`, default 4); keep it if you start gunicorn with your own options.
- **Stores read-only for the service account;** only `<data_dir>/sessions/` writable.
- **Remote stores.** Either `remote_stores: deny`, or a `remote_allowlist` of the exact
  bucket or URL prefixes you serve. Never `allow` without an allowlist on a shared server (the
  server logs a warning if you do). Admins can change the state in the browser under Admin > Data
  sources > Remote datasets; what the YAML sets is the upper limit, and `policy.locked:
  [feature.remote_stores]` takes the card away from them. It is separate from the Gene Set Analysis
  switch on the Settings page. Use `remote_credentials: environment` only if the service
  account's cloud credentials may be read by every user.
- **`proxy_count` matches the number of proxies** in front (1 for nginx alone). It is 0 by
  default; without it the login cookie is not marked `Secure` behind a TLS proxy. A higher value
  lets clients forge `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`.
- **Secure login cookie.** Signed in over HTTPS, the browser's `session` cookie shows the
  `Secure`, `HttpOnly` and `SameSite=Lax` flags (developer tools, Application or Storage tab).
  Leave `auth.cookie_secure` at `auto`.
- **Session timeout.** `auth.session_timeout` (default 28,800 s, 8 hours idle) suits your users.
- **Branding.** `branding.contact_info` names your lab and a contact who answers questions
  about accounts. Without it the login page shows no contact.
- **Open to the public?** Then you also owe your visitors an imprint (Germany and Austria), a
  privacy notice, a log retention period, `site.robots: noindex` unless you want search engines,
  and a licence for every dataset you show. Set `site.imprint`, `site.privacy` and
  `site.accessibility` so the links appear on every page, and read {doc}`public-site` first.
- **Memory.** `gunicorn workers x cache_memory_mb` fits the host, with room for the chunks
  being read.
- **Long URLs.** gunicorn's request line stays unlimited (`server.limit_request_line: 0`, the
  bundled default; do not pass `--limit-request-line`), and nginx has
  `large_client_header_buffers 4 32k;` if users bring legacy query-string deep links
  ({doc}`lab-server`).

## What users can and cannot do

| A signed-in user can | A signed-in user cannot |
|---|---|
| list and open every dataset under `data_dir` and `allowed_dirs` (a restricted user: only their grants) | open files or list directories outside those trees (admins can, unless `server.arbitrary_paths` is `none` or `local-only`) |
| read every slot of those datasets (X, layers, obs/var, obsm/varm, obsp/varp, uns), one vector or a bounded slice at a time | download a whole matrix: a reply larger than `max_response_elements` is refused with 413, and a pairwise (`obsp`/`varp`) read that would hold more than `max_read_mb` (5% of RAM by default) in server memory is refused with 413 `read_too_large`, admins included |
| save, load, export, duplicate and import panel sets | change or delete another user's panel set (admins can) |
| open remote stores under `remote_allowlist` (a restricted user: only those they are granted) | make the server fetch any other URL |
| | clear the server's dataset cache (admins can) |
| | write to, convert or delete datasets |
| | run code on the server (admins can add users and change settings in the admin interface) |

Things to know:

- **Panel sets are shared.** Every unrestricted user sees every panel set's name, dataset and layout (a restricted user sees their own and those whose datasets they can read). Do not
  put anything in a panel-set name you would not show the whole server.
- **Panel sets and links name server paths.** They reproduce a view on the same server with an
  unchanged store, not on another installation.
- **Access logs show which datasets are opened** (the `dataset_path` query parameter). The view
  in a share link is in the URL fragment and never reaches the server or its logs.
- **Logs name usernames** of failed and successful sign-ins.
- **Lockout.** Five wrong passwords from one client address lock that username for that
  address for 15 minutes.

## After changes

- New dataset: add a link in the data directory (plus `allowed_dirs` for its target); no
  restart needed.
- Rewritten elements of a store: **Refresh dataset** (`POST /data/refresh`); for an admin it also clears the cache for that dataset. A whole store replaced behind the same link: restart the service ({doc}`lab-server`).
- New or removed user, changed admin rights or dataset access: `annzarro user ...` or the admin interface; no restart needed.
- Configuration change: restart the service, then check `annzarro config show` and the startup
  log (`Remote store policy: ...`, confinement warnings, `SECURITY` lines).
