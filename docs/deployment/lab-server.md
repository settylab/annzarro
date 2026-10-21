# Lab server

A lab server hosts processed datasets for many people: gunicorn runs AnnZarro on the loopback
interface, and a reverse proxy in front terminates TLS. Users log in, browse the datasets in one
data directory and share panel sets. They cannot write to datasets, run code or open files
outside the directories you allow. This is the "Lab server" arrangement of {doc}`modes`.

```text
browser ──HTTPS──▶ nginx :443 ──HTTP──▶ gunicorn 127.0.0.1:8000 ──▶ annzarro.server.wsgi:create_wsgi_app()
                                                                     reads /srv/annzarro/data (read-only)
                                                                     writes /var/lib/annzarro (state, panel sets)
```

The rest of this page sets that up on a Linux host; {doc}`containers` runs the same arrangement from a Docker image or an Apptainer image. Read {doc}`authentication` for users and
admins, and go through the {doc}`hosting-checklist` before you give out the address.

## 1. Install

Use a dedicated service account and virtual environment. gunicorn is not a core dependency of
AnnZarro; the `server` extra installs it (it does not run on Windows).

```bash
sudo useradd --system --home /var/lib/annzarro --create-home annzarro
sudo python3 -m venv /opt/annzarro/venv
sudo /opt/annzarro/venv/bin/pip install 'annzarro[server]'     # 'annzarro[server,remote]' for remote stores
```

(lab-server-data-dir)=
## 2. Lay out the data directory

```bash
sudo mkdir -p /srv/annzarro/data
sudo ln -s /lab/atlases/bm_aging_annzarro.zarr /srv/annzarro/data/     # one link per dataset
```

Keep the stores themselves, and the whole data directory, read-only for the `annzarro` account.
The server only reads them, and file permissions make that a property of the host rather than of
the code. Panel sets are JSON files in `<state_dir>/panel-sets/` (here `/var/lib/annzarro/panel-sets/`,
created on the first save), so nothing is written under the data directory. An install that
saved panel sets in `<data_dir>/sessions/` with an older release keeps using that folder, which
must then stay writable, until you copy them with `annzarro panel-sets migrate`
({ref}`panel-sets-location`).

A dataset linked into the data directory from elsewhere is refused on a shared server unless its
target's directory is listed in `server.allowed_dirs`. The server names every such link in a
warning at startup.

## 3. Configure

`/etc/annzarro/site.yaml`, a minimal configuration. The package ships a commented template,
`annzarro/server/site.example.yaml`, to start from.

```yaml
server:
  host: 127.0.0.1             # gunicorn binds here
  port: 8000
  data_dir: /srv/annzarro/data
  allowed_dirs:
    - /lab/atlases            # targets of the links above
  proxy_count: 1              # one reverse proxy in front: trust its X-Forwarded-* headers
  workers: 4                  # gunicorn worker processes
  threads: 4                  # threads per worker (gthread)
  cache_memory_mb: 1000       # per worker, see below
  log_file: /var/lib/annzarro/logs/annzarro_server.log
auth:
  user_file: /var/lib/annzarro/auth/users.json   # the login key is generated beside it
branding:
  app_name: AnnZarro
  project_description: Datasets of the Example Lab
  contact_info:
    lab_name: Example Lab
    lab_url: https://example.org
    email: annzarro-admin@example.org
```

Every `annzarro` command reads the file named by `ANNZARRO_CONFIG` (unless `--config` is
given), as gunicorn does. Check what the server will run with, as the service user:

```bash
sudo -u annzarro env ANNZARRO_HOME=/var/lib/annzarro ANNZARRO_CONFIG=/etc/annzarro/site.yaml \
  /opt/annzarro/venv/bin/annzarro config show
```

Every key is listed in {doc}`../reference/configuration`. Login does not need to be switched
on: the WSGI entry point enables it unless the configuration says `auth.enabled: false`.

The contact block on the login page appears only when `branding.contact_info` is set; set it
to the people who answer questions about accounts.

## 4. Add users

```bash
sudo -u annzarro env ANNZARRO_HOME=/var/lib/annzarro ANNZARRO_CONFIG=/etc/annzarro/site.yaml \
  /opt/annzarro/venv/bin/annzarro user add --username alice --admin
```

The command prompts for the password twice. `user passwd` and `user set-admin` change a user
later. Details, including admins and what they may do, are in {doc}`authentication`.

## 5. Run the server

```bash
sudo -u annzarro env ANNZARRO_HOME=/var/lib/annzarro ANNZARRO_CONFIG=/etc/annzarro/site.yaml \
  /opt/annzarro/venv/bin/annzarro serve
```

`annzarro serve` prints what it will run (URL, workers and threads, whether login is on, the
configuration file) and then becomes gunicorn. Host, port, workers and threads come from the
configuration; `--host`, `--port`, `--workers` and `--threads` override them, `--config FILE`
names the site file (default `$ANNZARRO_CONFIG`) and everything after `--` goes to gunicorn
({doc}`../reference/cli`). It is the hosted mode: login is on unless the configuration says
`auth.enabled: false`.

The command is shorthand for the explicit gunicorn command, which you can run instead:

```bash
sudo -u annzarro env ANNZARRO_HOME=/var/lib/annzarro ANNZARRO_CONFIG=/etc/annzarro/site.yaml \
  /opt/annzarro/venv/bin/gunicorn -c python:annzarro.server.gunicorn_config \
  "annzarro.server.wsgi:create_wsgi_app()"
```

The bundled gunicorn configuration `annzarro.server.gunicorn_config` reads the same AnnZarro
configuration as the app: it binds to `server.host:server.port`, starts `server.workers`
workers (default: twice the CPUs plus one, at most 4) of the `gthread` class with `server.threads`
threads each (default 4), so a slow request (a large read, a remote store) does not hold a whole
worker, sets a 60 s worker timeout and sends
gunicorn's own logs, including the access log, to standard error. It leaves the request line
unlimited (`server.limit_request_line: 0`), because the web client names the cells and genes it
asks for in the URL. Options given on the command line (after `--` for `annzarro serve`)
override it; do not pass `--limit-request-line`, which caps the line at 8,190 bytes at most. In a
source checkout, `annzarro/server/run_gunicorn.sh` runs this command, with `ANNZARRO_CONFIG`
defaulting to `/etc/annzarro/site.yaml`, and stops if that file is missing.

`create_wsgi_app()` loads the same layered configuration as `annzarro start` (built-in
defaults, `/etc/annzarro/config.yaml`, the user and project files, then the file named by
`ANNZARRO_CONFIG` and `ANNZARRO_*` variables). Because gunicorn, not AnnZarro, owns the listening
socket, the factory always treats the server as shared: login on, paths confined to the data
directory, remote stores only from `remote_allowlist`. Do not point gunicorn at
`annzarro.server.core:create_app()`: without a configuration it runs with laptop defaults (no
login, no confinement).

**Workers and memory.** Each gunicorn worker is a separate process with its own result cache,
so memory grows with `workers x cache_memory_mb`. The production default for
`cache_memory_mb` is 4,000 MB; with four workers that allows 16 GB of cache, which is why the
example sets 1,000. `server.workers` also sets the count; `ANNZARRO_SERVER_WORKERS` overrides it. Logins work across workers because
the session cookie is signed with one key stored beside the users file.

**Timeouts.** The gunicorn `timeout` (60 s in the bundled configuration) is the worker's heartbeat
under the threaded worker class: a long request in a worker thread is not cut at that time. A remote
store that stalls is cut off by `remote_read_timeout_s` (30 s) between bytes with HTTP 504. A host that
sends data too slowly to trip that is cut off by `remote_request_timeout_s` (120 s on a hosted server),
the total one request may spend on
remote reads; keep the proxy's `proxy_read_timeout` at or above it.

### As a systemd service

`/etc/systemd/system/annzarro.service` (the repository's `annzarro/server/annzarro.service` is
the same idea with `User=www-data` and paths under `/opt/annzarro`):

```ini
[Unit]
Description=AnnZarro
After=network.target

[Service]
User=annzarro
Group=annzarro
Environment=ANNZARRO_HOME=/var/lib/annzarro
Environment=ANNZARRO_CONFIG=/etc/annzarro/site.yaml
ExecStart=/opt/annzarro/venv/bin/annzarro serve
# the start counts as failed unless the server answers (see "Health check")
ExecStartPost=/usr/bin/curl --silent --fail --retry 15 --retry-connrefused --retry-delay 1 --max-time 5 \
    --output /dev/null http://127.0.0.1:8000/api/v1/health
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`annzarro serve` replaces itself with gunicorn, so systemd's signals (stop, reload) reach
gunicorn's master directly and `MainPID` is gunicorn's.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now annzarro
journalctl -u annzarro -f
```

(lab-server-several)=
**Several services on one host** (two ports, or a public and an internal instance): give each
its own `ANNZARRO_HOME` (for example `/var/lib/annzarro-public` and `/var/lib/annzarro-lab`).
`$ANNZARRO_HOME/freshness` holds the datasets' generations, which every ETag includes
({ref}`revalidation`). A service's start begins a new generation of every dataset, and an admin's
cache clear one of its dataset; with a shared `ANNZARRO_HOME` that invalidates the other
services' ETags too. Nothing breaks, but their browsers fetch everything again.

## 6. Put nginx in front

TLS belongs in the proxy. Without it, passwords and session cookies cross the network in clear
text.

```nginx
# nginx keeps these connections to gunicorn open and reuses them
upstream annzarro {
    server 127.0.0.1:8000;
    keepalive 128;            # idle connections kept per nginx worker process
    keepalive_timeout 4s;     # shorter than gunicorn's 5 s (nginx 1.15.3 and later)
}

server {
    listen 443 ssl;
    http2 on;                 # nginx 1.25.1 and later; before that: listen 443 ssl http2;
    server_name annzarro.example.org;

    ssl_certificate     /etc/letsencrypt/live/annzarro.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/annzarro.example.org/privkey.pem;

    # The web client puts the cells or genes it asks for in the URL: 12 KB for 2,000 genes,
    # over the default 8 KB (see below).
    large_client_header_buffers 4 32k;

    location / {
        proxy_pass http://annzarro;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Prefix "";   # see "Serving under a path"
        proxy_read_timeout 120s;
        # the full cell and gene name lists are streamed (chunked, no length);
        # nginx speaks HTTP/1.0 to an upstream unless told otherwise, and then
        # cannot tell a reply that failed half way from one that ended
        proxy_http_version 1.1;
        # no "Connection: close" to gunicorn, so that nginx may keep the connection
        proxy_set_header Connection "";
    }
}

server {
    listen 80;
    server_name annzarro.example.org;
    return 301 https://$host$request_uri;
}
```

**Connections to gunicorn.** A plot loads through many small requests, and the page's scripts and
styles come with them: the 4-panel view we loaded for this page made 185. Before nginx 1.29.7, a
`proxy_pass` to an address sends `Connection: close` and opens a new connection to gunicorn for every
one of them: 184 for that page load, and about 360 sockets left in TIME_WAIT on the nginx host after
each load, every one holding a port for a minute. The `upstream` block with `keepalive`, `proxy_http_version
1.1` and the empty `Connection` header make nginx keep its connections to gunicorn and reuse them; nginx 1.29.7 and later do so by default, and the lines
still set the sizes below.

- `keepalive` is the number of idle connections each nginx worker process keeps. A browser on
  HTTP/2 sends all of a view's requests at once (up to `http2_max_concurrent_streams`, 128), and
  each one in flight needs a connection to gunicorn; connections beyond the idle ones kept are closed
  after the burst and opened again for the next. The 4-panel view opened 78 new connections to
  gunicorn per load with `keepalive 16`, 53 with 32, 21 with 64 and none with 128 or 256. An idle
  connection holds no gunicorn thread; keep nginx's worker processes times `keepalive` well below
  gunicorn's workers times 1,000 (its `worker_connections`).
- `keepalive_timeout` is how long nginx keeps an idle connection, and it must be shorter than
  gunicorn's `keepalive`, which the bundled configuration sets to 5 s. gunicorn closes a connection that
  has been idle that long; if nginx still thought it open, a request sent at that moment is lost
  to `upstream prematurely closed connection`, and nginx's own default of 60 s makes that possible.
  The block sets 4 s. If you raise gunicorn's `keepalive` in your own configuration, raise
  `keepalive_timeout` but keep it below.

**HTTP/2 to the browsers.** Over HTTP/1.1 a tab opens about six connections to the server and
queues every other request behind them, which a view of several panels soon fills. Over HTTP/2 the
tab sends all of them on one connection. `http2 on;` (or `http2` on the `listen` line before nginx
1.25.1; it still works afterwards but is deprecated) is all it takes. gunicorn still sees HTTP/1.1
from nginx. The 4-panel view loaded in headless Chromium against nginx 1.30 with a latency of 50 ms
added to every request took 3.7 s to draw over HTTP/1.1 and 2.5 s over HTTP/2 (median of 15 loads
each); with no added latency, on one machine, both took 1.9 s.

The streamed name lists (below) behave the same over HTTP/2: a 1.5 million cell list (22.5 MB) came
back byte for byte the same over both protocols, and read at 2 MB/s nginx held the upstream
connection for the whole 7.5 s that the client took, so `X-Accel-Buffering: no` is honoured and
`proxy_buffering off` is not needed. A request line of 20 KB passed with `large_client_header_buffers
4 32k;` over HTTP/2 as over HTTP/1.1.

(lab-server-health)=
## Health check

`GET /api/v1/health` answers `200` with `{"status": "ok"}` and `Cache-Control: no-store`. Use it
for every probe: a service manager's start check, a container health check, a load balancer or
a monitor.

```bash
curl -fsS --max-time 5 http://127.0.0.1:8000/api/v1/health
```

- It needs no login, also on a server with login on: a probe has no account. It reads no
  dataset, no user file and no directory and names nothing of the server (no version, path or
  host), so a slow disk or a busy dataset cannot fail it, and it costs a few microseconds.
- `/api/v1/status` is not a probe. With login on it answers `401` to anyone not signed in,
  signed-in users get only `running` and the version, and an admin gets the host, the process and the
  data directory.
- The reply comes from a gunicorn worker that has loaded the application, so `200` means the
  server is up and can answer, and it is the readiness check too. While gunicorn starts its
  workers a connection waits and is not refused: give every probe a timeout (the `--max-time 5`
  above).
- `200` says nothing about a dataset. To see that a store opens, check the datasets themselves
  after a change ({doc}`hosting-checklist`).
- With `server.url_prefix` set, the path is `<prefix>/api/v1/health`.

```nginx
location = /healthz {
    access_log off;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_pass http://annzarro/api/v1/health;
}
```

| Probe | How |
|---|---|
| systemd | `ExecStartPost=` with `curl --fail --retry 15 --retry-connrefused`, as in the unit above: the start counts as failed when the server does not answer |
| Container health check | call `http://127.0.0.1:8000/api/v1/health` and expect `200` |
| nginx | open source nginx makes no active checks. A `location = /healthz` that passes on to the health route (the block above) lets a load balancer in front of nginx check nginx and gunicorn together |
| Kubernetes | `readinessProbe` and `livenessProbe` of `httpGet` on `/api/v1/health`, port 8000, with `timeoutSeconds: 5` and a `failureThreshold` of 3 or more for liveness |

## Serving under a path

To serve AnnZarro at `https://host.example.org/explore/` next to other applications on the same
host, give it the path in one of two ways. Both were tested end to end (login, share links and
logout stay under the path) in the pull request that added them.

**Option 1: AnnZarro knows the path, the proxy passes it through.** Simplest; it does not depend
on proxy headers.

```yaml
# site.yaml
server:
  url_prefix: /explore        # or ANNZARRO_SERVER_URL_PREFIX=/explore
  proxy_count: 1
```

These locations go in the `server` block above and use its `upstream annzarro`.

```nginx
location = /explore { return 301 /explore/; }
location /explore/ {
    proxy_pass http://annzarro;                 # no trailing slash: path passed as is
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host               $host;
    proxy_set_header X-Forwarded-For    $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto  $scheme;
    proxy_set_header X-Forwarded-Prefix "";      # never pass a client's value on
}
```

**Option 2: the proxy strips the path and says where it mounted the app.** No AnnZarro setting
beyond `proxy_count: 1`.

```nginx
location = /explore { return 301 /explore/; }
location /explore/ {
    proxy_pass http://annzarro/;                # trailing slash: /explore/x -> /x
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host               $host;
    proxy_set_header X-Forwarded-For    $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto  $scheme;
    proxy_set_header X-Forwarded-Prefix /explore;
}
```

- A configured `url_prefix` wins over `X-Forwarded-Prefix`. The header is only trusted when
  `proxy_count` is above 0.
- nginx forwards a client's own `X-Forwarded-Prefix` unless the configuration sets it. Always
  set it (option 2) or blank it (option 1 and the root configuration above).
- The login cookie's `Path` becomes the mount point (`/explore`), so two AnnZarro servers under
  different paths on one host keep separate logins. After moving an existing server under a
  path, everyone signs in once again.
- Redirects to and from the login page, the `next` target and share links all stay under the
  path; a `next` that points outside it falls back to the start page.
- `annzarro start` with a `url_prefix` opens the browser at `http://127.0.0.1:<port>/explore/`.

We checked this branch with `ANNZARRO_SERVER_URL_PREFIX=/explore`: `/explore/?dataset_path=…`
signed out redirects to `/explore/login?next=/explore/%3Fdataset_path%3D…`, the login form posts
to `/explore/login`, and the cookie is `Path=/explore; HttpOnly; SameSite=Lax`. In the strip mode
(`proxy_count: 1`, header `X-Forwarded-Prefix: /explore`) the redirects and the cookie path are
the same. `url_prefix: /a/../b` stops the server with "server.url_prefix must be a path such as
/explore".

## Deep links and URL length

**Share Link** puts the view in the URL *fragment*
(`https://annzarro.example.org/?dataset_path=/srv/annzarro/data/bm_aging_annzarro.zarr#view=z1.…`).
Browsers never send the fragment to the server, so the request is short whatever the layout,
and only `dataset_path` appears in access logs.

The web client's own requests are long too: it sends the cells or genes it asks for in the URL,
about 12 KB for 2,000 genes. Older links, and links built by other tools such as DoLiMap, carry an uncompressed view in the
*query string* (`?dataset_path=…&view=…`). That whole URL is part of the HTTP request line,
and two fully configured panels are already about 4.7 KB ({doc}`../reference/deep-links`). The
limits on the way:

| Component | Default limit on the request line | Over the limit | Raise with |
|---|---|---|---|
| gunicorn with the bundled configuration | none (`server.limit_request_line: 0`) | (no limit) | not needed |
| gunicorn with its own defaults | 4,094 bytes | 400 "Request Line is too large" | `--limit-request-line 0` for no limit (8,190 is the most it allows otherwise) |
| nginx | one buffer of `large_client_header_buffers` (8 KB) | 414 Request-URI Too Large | `large_client_header_buffers 4 32k;` |
| `annzarro start` (waitress) | 262,144 bytes of request line and headers together | 431 | not needed |

The bundled gunicorn configuration sets no limit on the request line, because the line is
what bounds a long link and the reverse proxy in front is the place to bound it: with the nginx
block above (`large_client_header_buffers 4 32k;`) a line over 32 KB never reaches gunicorn. The
web client sends the cells or genes it asks for in the URL (12 KB for 2,000 genes), so a gunicorn
cap of 4,094 or 8,190 would refuse ordinary requests, not only legacy links. The other limits of
the bundled configuration stay: 100 header fields, each up to 8,190 bytes.

We measured gunicorn and waitress against gunicorn 26.2 and waitress 3.0: a 4.5 KB
request line returned 400 under the gunicorn default and 200 with `0` or with 8190;
9 KB returned 400 with 8190; 60 KB returned 200 with `0`. waitress answered 200 at 262,000
bytes and 431 at 300,000. nginx always needs the larger buffers, for the web client's own requests;
legacy links need them as well, or people must re-share with the current **Share Link**.

(lab-server-updating)=
## Updating datasets

**Refresh dataset** (the button right of the Dataset menu) asks the server to check the store
against the disk; when files changed, every worker serves the change from then on. For an admin
it also clears the server's cache for the dataset. Use it after adding or rewriting elements of
a store; {doc}`analyst-workflow` walks through one round. After replacing a whole store (a new
directory behind the same link), restart the service (`sudo systemctl restart annzarro`) to be
sure no worker keeps the old one open. Adding a new dataset (a new link in the data directory)
needs no restart; it appears after the dataset bar's refresh button is clicked.

(lab-server-logs)=
## Logs

- The AnnZarro log goes to `server.log_file` (and to standard error, which systemd collects).
- The bundled gunicorn configuration sends gunicorn's access log to standard error, so to the
  journal under systemd. It records each request's
  path and query string, so it shows which datasets people open; view state in the fragment
  never reaches it.
- A refused path is logged as `Refused path outside the data directory`. Failed logins and
  account lockouts are logged with the username.
- Every admin change is also written to the audit log ({ref}`admin-audit`), and a copy of each record
  to the `annzarro.audit` logger.
- `server.log_format: json` writes the lines as JSON for a log shipper, and `server.metrics_enabled` serves
  Prometheus metrics; {doc}`monitoring` says which endpoint, log or admin page to use for what.
