# Monitoring a server

Three things tell you how a server is doing: a health check for the process manager and the load
balancer, an opt-in `/metrics` endpoint for Prometheus, and, if you ship logs, JSON log lines.
Metrics and JSON logs are off by default.

## Health check

`GET /api/v1/status` answers without login. Anybody gets `{"server": {"status": "running", "version": ...}}`;
an admin also gets the host, the process, memory and the data directory. Use it for a load balancer's
probe or a `systemd` watchdog: a `200` means the process is serving. The admin page's Health section
({doc}`admin`) shows each worker's caches, read budget and refusals, and {doc}`lab-server` shows where
the server's logs go.

## Metrics

Set `server.metrics_enabled: true` (or `ANNZARRO_SERVER_METRICS_ENABLED=true`) and restart. The server then
answers `GET /metrics` in the Prometheus text format.

```yaml
server:
  metrics_enabled: true
  # who may read it; loopback when unset
  metrics_allow: [127.0.0.0/8, "::1/128"]
```

### Who can read it

Only a client whose address lies in `server.metrics_allow` (loopback by default; also
`ANNZARRO_SERVER_METRICS_ALLOW=10.0.0.0/8,192.0.2.7`). Anybody else gets exactly the reply a URL that does not exist
gets, so the endpoint is not even visible to the public. Login does not apply to it, because a scraper
cannot sign in; the address list is the whole control.

A request that came through a reverse proxy is refused too, from whatever address, unless
`server.proxy_count` says you trust the proxy: a proxy on the same host reaches the server from
`127.0.0.1`, and without this rule everyone on the internet would look like loopback. So `/metrics` is
not reachable through the nginx of {doc}`lab-server` (which sends `X-Forwarded-For`), by design. Two ways to scrape:

- Run the scraper on the server's host and point it at the application port (`127.0.0.1:8000`), for
  example Prometheus itself, Grafana Alloy or the OpenTelemetry collector.
- To scrape from another machine, give nginx a second listener on a private address that passes `/metrics`
  and nothing else, and name that machine in the proxy:

  ```nginx
  server {
      listen 10.0.0.5:9101;                      # the private interface only
      allow 10.0.0.9;  deny all;                 # the Prometheus host
      location = /metrics {
          proxy_pass http://127.0.0.1:8000/metrics;
          proxy_set_header X-Forwarded-For "";   # appear as the local client
          proxy_set_header X-Forwarded-Host "";
          proxy_set_header X-Forwarded-Proto "";
      }
  }
  ```

Also keep the public listener from forwarding it: nginx's `location = /metrics { return 404; }` in the public
server block makes the refusal independent of the application. Put `0.0.0.0/0` in `metrics_allow` only
behind a firewall; the server logs a warning at startup when you do.

### Several gunicorn workers

Every gunicorn worker is its own process and counts its own requests, and a scrape reaches one of them
at random. Prometheus' multiprocess mode would need an environment variable set before the server
imports, a gunicorn hook that retires dead workers and a client library. AnnZarro instead has each worker
write a small snapshot file every two seconds (under `annzarro_admin/metrics`, beside the
users file; the same mechanism as the admin Health section) and whichever worker is scraped answers with
all of them. No library is needed: the exposition is written by AnnZarro itself.

Each series carries a `worker` label with the process id. Sum over it in the query
(`sum by (group) (rate(annzarro_http_requests_total[5m]))`). A worker that is recycled
(`server.max_requests`) disappears and a new one appears; because the numbers are never added together
on the server, a recycled worker cannot make a total go backwards, and `rate()` treats it as an ordinary
counter reset. A snapshot of a process that has died is deleted by the next scrape.

`annzarro start` is a single process, with one `worker` label.

### What it reports

Requests are grouped by route, never by URL. The group is the matched route with its parameters cut:
`data/obs`, `data/names`, `datasets/folder`, `status`, `static`, `page` (the page shell and its deep links),
`admin` (every admin endpoint), `unmatched`. About eighty values exist. A dataset path, a cell or gene name, a
user name or a query string never becomes a label.

| Series | Type | Labels | Meaning |
|---|---|---|---|
| `annzarro_http_requests_total` | counter | `worker`, `group`, `method`, `code` | requests answered |
| `annzarro_http_request_duration_seconds` | histogram | `worker`, `group` | seconds from the request to the last byte sent; a streamed list of names counts until the client has read it |
| `annzarro_http_requests_in_flight` | gauge | `worker` | requests being answered now |
| `annzarro_http_response_bytes_total` | counter | `worker`, `group` | body bytes before compression |
| `annzarro_cache_hits_total`, `annzarro_cache_misses_total` | counter | `worker`, `cache` | lookups the dataset cache (`zarr`, `h5ad`) answered or could not |
| `annzarro_cache_size_bytes`, `annzarro_cache_max_size_bytes` | gauge | `worker`, `cache` | memory the cache holds, and may hold (`server.cache_memory_mb`) |
| `annzarro_open_datasets` | gauge | `worker`, `cache` | datasets the cache holds |
| `annzarro_name_index_size_bytes` | gauge | `worker` | memory of the cell and gene name search indices |
| `annzarro_process_resident_memory_bytes` | gauge | `worker` | the worker's resident memory (RSS) |
| `annzarro_worker_start_time_seconds` | gauge | `worker` | when the worker started |
| `annzarro_worker_snapshot_age_seconds` | gauge | `worker` | seconds since the worker last wrote its numbers; large for a hung worker |
| `annzarro_build_info` | gauge | `version` | always 1 |

The latency buckets run from 5 ms to 300 s. The cache hit and miss counts start again when a worker does.
Counting adds a lock and a few dictionary updates to each request, which is not measurable next to a read of a store.

### A scrape configuration

```yaml
scrape_configs:
  - job_name: annzarro
    static_configs:
      - targets: ["127.0.0.1:8000"]
```

## JSON logs

`server.log_format: json` (or `ANNZARRO_SERVER_LOG_FORMAT=json`) writes every log line on standard error
as one JSON object, which journald, Loki or Elasticsearch ingest without a parser:

```json
{"ts": "2026-10-19T08:15:02.113Z", "level": "INFO", "logger": "annzarro.access", "message": "GET data/obs 200",
 "request_id": "3f1c9a0b5d2e4a67", "method": "GET", "route_group": "data/obs", "status": 200, "duration_ms": 41.7}
```

- Every line has `ts` (UTC), `level`, `logger` and `message`; an exception is one `exception` field.
- A line written while a request is being served also has `request_id`, `method` and `route_group`.
- Each request gets one access line (logger `annzarro.access`) with `status` and `duration_ms`. It has no
  client address, path or query string, so it says less than gunicorn's access log, which shows which
  datasets people open. In this mode gunicorn's access log is off and its own messages are JSON too.
- The request id is the caller's `X-Request-Id` when it is up to 64 letters, digits, `.`, `_` or `-`
  (a proxy can set one), else a fresh one. It is sent back in the `X-Request-Id` response header, so a user can quote it.
- `server.log_file` stays in the text format. `log_level` applies to both.

The default is `text`.

## What to alert on

| Alert | Query | Why |
|---|---|---|
| Server errors | `sum(rate(annzarro_http_requests_total{code=~"5.."}[5m])) > 0` for 10 minutes | a bug or a failing store |
| Busy refusals | `sum(rate(annzarro_http_requests_total{code="503"}[5m])) > 0.1` | read budgets, name streams or subsets are full ({doc}`resource-limits`) |
| Slow plots | `histogram_quantile(0.95, sum by (le) (rate(annzarro_http_request_duration_seconds_bucket{group=~"data/(X\|obs\|obsm\|layer)"}[5m]))) > 10` | reads are slow: cold storage, a remote store, too few workers |
| Threads exhausted | `sum(annzarro_http_requests_in_flight) >= 0.9 * <workers x threads>` for 5 minutes | requests queue behind long ones (slow readers of the name lists); add workers or threads |
| Memory | `max(annzarro_process_resident_memory_bytes) / <machine RAM> > 0.7` | before the kernel kills a worker |
| Cache churn | `rate(annzarro_cache_misses_total[15m]) / (rate(annzarro_cache_hits_total[15m]) + rate(annzarro_cache_misses_total[15m])) > 0.8` | the cache is too small for what people open (`server.cache_memory_mb`) |
| Worker hung | `annzarro_worker_snapshot_age_seconds > 60` | a worker stopped writing its numbers |
| Down | the health check, or `up == 0` | the process is gone |
