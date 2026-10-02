# Lab server

A lab server hosts processed datasets for many people: gunicorn runs AnnZarro on the loopback
interface, and a reverse proxy in front terminates TLS. Users log in, browse the datasets in one
data directory and share panel sets. They cannot write to datasets, run code or open files
outside the directories you allow. This is the "Lab server" arrangement of {doc}`modes`.

```text
browser ──HTTPS──▶ nginx :443 ──HTTP──▶ gunicorn 127.0.0.1:8000 ──▶ annzarro.server.wsgi:create_wsgi_app()
                                                                     reads /srv/annzarro/data (read-only)
                                                                     writes /srv/annzarro/data/sessions
```

The rest of this page sets that up on a Linux host. Read {doc}`authentication` for users and
admins, and go through the {doc}`hosting-checklist` before you give out the address.

## 1. Install

Use a dedicated service account and virtual environment. gunicorn is not a dependency of
AnnZarro; install it alongside.

```bash
sudo useradd --system --home /var/lib/annzarro --create-home annzarro
sudo python3 -m venv /opt/annzarro/venv
sudo /opt/annzarro/venv/bin/pip install annzarro gunicorn     # 'annzarro[remote]' for remote stores
```

## 2. Lay out the data directory

```bash
sudo mkdir -p /srv/annzarro/data/sessions
sudo ln -s /lab/atlases/bm_aging.zarr /srv/annzarro/data/     # one link per dataset
sudo chown annzarro: /srv/annzarro/data/sessions              # the only place the server writes
```

Keep the stores themselves read-only for the `annzarro` account. The server only reads them,
and file permissions make that a property of the host rather than of the code. Panel sets are
JSON files in `<data_dir>/sessions/`, which must be writable.

A dataset linked into the data directory from elsewhere is refused on a shared server unless its
target's directory is listed in `server.allowed_dirs`. The server names every such link in a
warning at startup.

## 3. Configure

`/etc/annzarro/site.yaml`, a minimal configuration:

```yaml
server:
  data_dir: /srv/annzarro/data
  allowed_dirs:
    - /lab/atlases            # targets of the links above
  proxy_count: 1              # one reverse proxy in front: trust its X-Forwarded-* headers
  cache_memory_mb: 1000       # per gunicorn worker, see below
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

Check what the server will run with, as the service user:

```bash
sudo -u annzarro ANNZARRO_HOME=/var/lib/annzarro \
  /opt/annzarro/venv/bin/annzarro config show --config /etc/annzarro/site.yaml
```

Every key is listed in {doc}`../reference/configuration`. Login does not need to be switched
on: the WSGI entry point enables it unless the configuration says `auth.enabled: false`.

```{important}
Set `branding.contact_info`. The built-in defaults name the Setty Lab and a Setty Lab email
address on the login page of every server that does not override them.
```

## 4. Add users

```bash
sudo -u annzarro ANNZARRO_HOME=/var/lib/annzarro \
  /opt/annzarro/venv/bin/annzarro --config /etc/annzarro/site.yaml user add --username alice --admin
```

The command prompts for the password twice. Details, including admins and what they may do, are
in {doc}`authentication`.

## 5. Run gunicorn

```bash
sudo -u annzarro env ANNZARRO_HOME=/var/lib/annzarro ANNZARRO_CONFIG=/etc/annzarro/site.yaml \
  /opt/annzarro/venv/bin/gunicorn -w 4 --timeout 60 --limit-request-line 8190 \
  -b 127.0.0.1:8000 "annzarro.server.wsgi:create_wsgi_app()"
```

`create_wsgi_app()` loads the same layered configuration as `annzarro start` (built-in
defaults, `/etc/annzarro/config.yaml`, the user and project files, then the file named by
`ANNZARRO_CONFIG` and `ANNZARRO_*` variables). Because gunicorn, not AnnZarro, owns the listening
socket, the factory always treats the server as shared: login on, paths confined to the data
directory, remote stores only from `remote_allowlist`. Do not point gunicorn at
`annzarro.server.core:create_app()`: without a configuration it runs with laptop defaults (no
login, no confinement).

```{warning}
The repository's `annzarro/server/gunicorn_config.py`, `run_gunicorn.sh` and
`annzarro.service` do not start in their current form: gunicorn reads the module-level
variable `config` in `gunicorn_config.py` as its own setting and exits with "Error: Not a
string". Use the command line above or the unit below until that is fixed.
```

**Workers and memory.** Each gunicorn worker is a separate process with its own result cache,
so memory grows with `workers x cache_memory_mb`. The production default for
`cache_memory_mb` is 4,000 MB; with four workers that allows 16 GB of cache, which is why the
example sets 1,000. On the paper's lab deployment, three server processes used 0.58 to 0.92 GB
resident each while serving 33 datasets (2.2 TiB on disk). Logins work across workers because
the session cookie is signed with one key stored beside the users file.

**Timeouts.** gunicorn kills a worker whose request takes longer than `--timeout` (30 s by
default). A remote store that stalls fails after `remote_read_timeout_s` (30 s) with HTTP 504; a
`--timeout` above that lets the 504 reach the user instead of a dropped connection.

### As a systemd service

`/etc/systemd/system/annzarro.service`:

```ini
[Unit]
Description=AnnZarro
After=network.target

[Service]
User=annzarro
Group=annzarro
Environment=ANNZARRO_HOME=/var/lib/annzarro
Environment=ANNZARRO_CONFIG=/etc/annzarro/site.yaml
ExecStart=/opt/annzarro/venv/bin/gunicorn -w 4 --timeout 60 --limit-request-line 8190 \
    -b 127.0.0.1:8000 --access-logfile - "annzarro.server.wsgi:create_wsgi_app()"
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now annzarro
journalctl -u annzarro -f
```

## 6. Put nginx in front

TLS belongs in the proxy. Without it, passwords and session cookies cross the network in clear
text.

```nginx
server {
    listen 443 ssl;
    server_name annzarro.example.org;

    ssl_certificate     /etc/letsencrypt/live/annzarro.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/annzarro.example.org/privkey.pem;

    # Long legacy deep links carry the view in the query string (see below).
    large_client_header_buffers 4 32k;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_read_timeout 90s;
        # AnnZarro does not mark its session cookie Secure or SameSite; add both here.
        proxy_cookie_flags ~ secure samesite=lax;    # nginx 1.19.3 or later
    }
}

server {
    listen 80;
    server_name annzarro.example.org;
    return 301 https://$host$request_uri;
}
```

`proxy_count: 1` in the configuration tells AnnZarro to trust exactly one `X-Forwarded-*` hop.
It is required: the built-in default is 0, because a plain `annzarro start` has no proxy in front
and trusting the headers there would let any client set its own address. Set it in the
configuration file as above or with `ANNZARRO_SERVER_PROXY_COUNT=1` in the service environment.
(The repository's flat `annzarro/server/production_config.json`, used by the shipped
systemd/gunicorn files, keeps `proxy_count: 1`.)
With two proxies in a row (say a load balancer and nginx) set it to 2; never set it higher than
the number of proxies you run, or clients can forge their address. AnnZarro already compresses
JSON replies on a shared server; if nginx compresses `application/json` too, set
`server.compress_responses: false`.

Any other proxy (Apache, Caddy, Traefik, an institutional gateway) works the same way: forward
to `127.0.0.1:8000`, pass the `X-Forwarded-For`, `-Proto` and `-Host` headers, and allow long
request lines.

## Deep links and URL length

**Share Link** puts the view in the URL *fragment*
(`https://annzarro.example.org/?dataset_path=/srv/annzarro/data/bm_aging.zarr#view=z1.…`).
Browsers never send the fragment to the server, so the request is short whatever the layout,
and only `dataset_path` appears in access logs.

Older links, and links built by other tools such as DoLiMap, carry an uncompressed view in the
*query string* (`?dataset_path=…&view=…`). That whole URL is part of the HTTP request line,
and two fully configured panels are already about 4.7 KB ({doc}`../reference/deep-links`). The
limits on the way:

| Component | Default limit on the request line | Over the limit | Raise with |
|---|---|---|---|
| gunicorn | 4,094 bytes | 400 "Request Line is too large" | `--limit-request-line 8190` (its maximum), or `0` for no limit |
| nginx | one buffer of `large_client_header_buffers` (8 KB) | 414 Request-URI Too Large | `large_client_header_buffers 4 32k;` |
| `annzarro start` (Werkzeug) | 65,536 bytes | 414 | not needed |

We measured the gunicorn and Werkzeug rows against gunicorn 26.2 and Werkzeug 3.1: a 4.5 KB
request line returned 400 under the gunicorn default and 200 with `--limit-request-line 8190`;
9 KB returned 400 with 8190; 60 KB returned 200 with `0`. Werkzeug answered 200 at 20 KB and
414 at 70 KB. If people bring legacy links, raise both
limits; otherwise ask them to re-share with the current **Share Link**.

## Updating datasets

The server caches store metadata and results and assumes a store does not change while it
runs. After rewriting or replacing a store, restart the service
(`sudo systemctl restart annzarro`). `POST /api/v1/cache/reset` clears only the worker that
happens to answer it, so with several workers a restart is the reliable way. Adding a new
dataset (a new link in the data directory) needs no restart; it appears after the Dataset
picker's refresh button is clicked.

## Logs

- The AnnZarro log goes to `server.log_file` (and to standard error, which systemd collects).
- `--access-logfile -` sends gunicorn's access log to the journal. It records each request's
  path and query string, so it shows which datasets people open; view state in the fragment
  never reaches it.
- A refused path is logged as `Refused path outside the data directory`. Failed logins and
  account lockouts are logged with the username.
