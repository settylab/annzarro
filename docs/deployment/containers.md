# Containers

AnnZarro ships recipes for running the lab server (see {doc}`lab-server`) as a container: a
`Dockerfile`, a Compose example with nginx and TLS, and an Apptainer definition for clusters. They
live in `packaging/container/` of the repository. The image runs `annzarro serve` (gunicorn with the bundled
configuration), as a non-root user, with login on.

```{note}
AnnZarro does not publish images. Build one from a checkout of the version you want, as below.
```

## The image

Build it from the repository root:

```bash
docker build -f packaging/container/Dockerfile \
  --build-arg VERSION=0.7.1 --build-arg REVISION=$(git rev-parse --short HEAD) \
  -t annzarro:local .
```

The build is multi-stage. The first stage downloads the pinned frontend files (jQuery, Plotly, ...)
and checks every one against the SHA-256 in `scripts/vendor-assets.json`, builds the wheel and installs
it with the `server` extra (gunicorn) into a virtual environment; the final stage copies only that environment onto
`python:3.12-slim` (pinned by digest). The image is about 590 MB on disk, 127 MB compressed.

| Build argument | Default | Meaning |
|---|---|---|
| `EXTRAS` | empty | `remote` adds the `annzarro[remote]` extra to `annzarro[server]`: `s3://`, `gs://` and `http(s)://` stores |
| `VERSION`, `REVISION` | `unknown` | written to the `org.opencontainers.image.version` and `.revision` labels |

The image also carries the labels `title`, `description`, `source`, `url`, `documentation` and
`licenses` (MIT).

| Path in the container | What it holds |
|---|---|
| `/data` | the datasets. Mount it **read-only**; AnnZarro never writes datasets |
| `/state` | everything the server writes: the users file and login key (`/state/auth`), the admin settings, saved panel sets (`/state/panel-sets`) and logs (`/state/logs`). A volume that survives restarts |
| `/etc/annzarro/container.yaml` | the configuration the image starts with (`ANNZARRO_CONFIG`); mount your own file over it, or change single values with `ANNZARRO_<SECTION>_<KEY>` variables |

The server listens on `0.0.0.0:8000` inside the container. The datasets under `/data` show up in the
dataset browser as the folder `data`. The container runs as uid and gid 10001; a bind-mounted
`/state` must be writable for that account (`chown -R 10001:10001 state`). A named volume needs
nothing.

The health check asks `/api/v1/health` every 30 seconds ({ref}`lab-server-health`). It answers `200`
without login, login on or off; any other answer, or none, is unhealthy.

## Docker

```bash
mkdir -p state && sudo chown 10001:10001 state
docker run -d --name annzarro -p 8000:8000 \
  --read-only --tmpfs /tmp \
  -v /srv/atlases:/data:ro \
  -v "$PWD/state:/state" \
  annzarro:local

docker exec -it annzarro annzarro user add --username alice --admin   # prompts for the password
docker ps --filter name=annzarro                                      # STATUS shows (healthy)
```

This publishes plain HTTP on port 8000, so put TLS in front before anyone logs in
({doc}`lab-server`, "Put nginx in front"), or use the Compose example below. Behind a proxy
add `-e ANNZARRO_SERVER_PROXY_COUNT=1`. Further settings (`ANNZARRO_SERVER_WORKERS`,
`ANNZARRO_SERVER_CACHE_MEMORY_MB`, ...) work the same way; every worker keeps its own cache of up to
`cache_memory_mb`. Your own configuration file replaces the built-in one:

```bash
docker run -d ... -v "$PWD/site.yaml:/etc/annzarro/container.yaml:ro" annzarro:local
```

Keep `data_dir: /data` and `state_dir: /state` in that file, as in
`packaging/container/container.yaml`. `/data` is only read; users, grants and panel sets
(`/state/panel-sets`) survive `docker restart` and `docker rm` as long as `/state` does.

A `/state` volume from before 0.7.2 holds its panel sets in `/state/data/sessions`, which the
server no longer reads. The container says so when it starts. Copy them once, and delete nothing
until you have looked at the result:

```bash
docker exec annzarro annzarro panel-sets migrate --data-dir /state/data
```

## Compose with nginx and TLS

`packaging/container/docker-compose.yml` runs AnnZarro behind nginx. Only nginx publishes ports;
the root filesystem of the AnnZarro container is read-only and it keeps no capabilities.

```bash
cd packaging/container
mkdir -p certs
cp /etc/letsencrypt/live/annzarro.example.org/fullchain.pem certs/
cp /etc/letsencrypt/live/annzarro.example.org/privkey.pem certs/
ANNZARRO_DATA=/srv/atlases docker compose up -d --build
docker compose exec annzarro annzarro user add --username alice --admin
```

Open `https://<host>/`. Port 80 redirects to HTTPS. `HTTP_PORT` and `HTTPS_PORT` change the published
ports (the redirect assumes the standard ones). The state lives in the named volume
`annzarro-state`; `docker compose down` keeps it and `docker compose down -v` deletes it. The
Compose file sets `ANNZARRO_SERVER_PROXY_COUNT=1`, so the login cookie is marked `Secure` and failed
logins are counted per client address; see {doc}`authentication`.

## Apptainer on a cluster

`packaging/container/annzarro.def` builds a SIF image from the Docker image, so build that first
(above). Apptainer runs the container as **you**, not as root, on the host's network, with the image
read-only. No daemon and no root are needed to run it.

```bash
apptainer build annzarro.sif packaging/container/annzarro.def      # needs the local Docker daemon
# or, on a machine that has Apptainer but not Docker, from a saved image:
docker save annzarro:local -o annzarro.tar
apptainer build annzarro.sif docker-archive://annzarro.tar
```

Copy `annzarro.sif` to the cluster, then on a compute or interactive node:

```bash
mkdir -p "$HOME/annzarro-state"
export APPTAINERENV_ANNZARRO_SERVER_PORT=$((20000 + UID % 10000))   # your own port; 8000 is probably taken
apptainer exec --bind "$HOME/annzarro-state:/state" annzarro.sif \
  annzarro user add --username me --admin
apptainer run --bind /path/to/datasets:/data:ro --bind "$HOME/annzarro-state:/state" annzarro.sif
```

Notes for a shared node:

- **Address.** The SIF listens on `127.0.0.1` only, so it is not reachable from the network; other
  users logged in to the same node can still connect, and login keeps them out. From your laptop,
  tunnel through the login host to the node's loopback:
  `ssh -N -J <login host> -L 8765:127.0.0.1:8765 <node>` (with your port), then open
  `http://localhost:8765` ({doc}`personal-server`). If the cluster allows no SSH to compute nodes,
  set `APPTAINERENV_ANNZARRO_SERVER_HOST=0.0.0.0` to listen on the node's network and tunnel to
  the node from the login host instead (`ssh -N -L 8765:<node>:8765 <login host>`); login stays
  on, but the traffic between the nodes is not encrypted.
- **Port.** Apptainer shares the host's network, so a port taken by another user's server makes
  gunicorn fail with "Address already in use". Pick one per user as above.
- **State.** `/state` must be a directory you can write; the run script refuses to start without one.
  Users, panel sets and logs are written there as your account.
- **Workers.** gunicorn starts up to four worker processes, each with its own dataset cache. Ask for
  the CPUs and memory you intend to use and set `APPTAINERENV_ANNZARRO_SERVER_WORKERS=2` (and
  `APPTAINERENV_ANNZARRO_SERVER_CACHE_MEMORY_MB`) to match.
- **Settings.** Any `ANNZARRO_<SECTION>_<KEY>` variable given with the `APPTAINERENV_` prefix applies;
  `APPTAINERENV_ANNZARRO_CONFIG=/state/site.yaml` selects a file of your own.
- **Stopping.** The server is an ordinary process of your job or terminal; end it with Ctrl-C or by
  ending the job.

`apptainer run-help annzarro.sif` prints the same short guide from the image.
