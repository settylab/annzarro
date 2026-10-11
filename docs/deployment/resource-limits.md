# Running a shared server: resource limits

The per-user share of the read budget and the subset places apply only to a server other people can reach (login on, or a network address); the desktop app and `annzarro start` on loopback without login have one user, who gets everything.

A server that other people can reach has to stay up when one of them asks for too much, by
mistake or on purpose. Every limit below is a `server.*` setting with a default that suits a
lab server on one machine and the datasets in this documentation (1 to 95 million cells). A
refused request gets a 4xx or 503 reply with a `reason` field ({doc}`../reference/http-api`),
and the web client shows its message. `annzarro config validate` rejects a value that is not a
number of the right kind. Raise a limit only when the host has what it protects: memory, CPU
time, disk or threads.

These limits bound what one request can cost. They do not bound how many requests arrive: AnnZarro
does not rate-limit, and gunicorn's `gthread` worker keeps a thread on a client that sends its
request slowly. The reverse proxy in front ({doc}`lab-server`) is the defence for both; see
"What the proxy must do" below.

| Setting | Default | Protects | Refusal | Raise it when |
|---|---|---|---|---|
| `name_search_max_regex_chars` | 200 | CPU: a regular-expression name search is a pattern run against every name | `400 regex_too_long` | users paste long patterns |
| `name_search_timeout_s` | 10 | CPU: a regex name search over millions of names answers with the matches found so far when it runs out of time (`partial: true`, `timed_out: true`) | partial `200` | the host is slow and the dataset has more than about 10 million names; 0 turns it off |
| `read_user_share_percent` | 50 | Fairness: the pairwise-read budget (`read_budget_mb`) is shared; one user (one address, with login off) may hold this share | `503 read_busy` | few users and one big matrix; 0 gives a user the whole budget |
| `subset_max_concurrent` | 2 | Threads and CPU: a subset is a pass over a column of every cell, and any request can name a new seed or filter | `503 read_busy` | many users open the largest datasets at once; raise it with `threads` |
| `max_requests`, `max_requests_jitter` | 20,000, 2,000 | Memory: a worker that leaks or fragments is replaced; its caches start empty | (worker restart) | every request is cheap and the dataset index takes long to rebuild: raise it, or 0 |
| `limit_request_line`, `limit_request_fields`, `limit_request_field_size` | 0 (none), 100, 8,190 | Memory and CPU: one request made of many or huge headers (gunicorn only). The request line is not limited because the web client names the cells and genes it asks for in the URL (about 12 KB for 2,000 genes; gunicorn would cap any other value at 8,190), so bound it in the proxy (`large_client_header_buffers`) | `400` from gunicorn | never needed |
| `max_request_mb` | 64 | Memory and disk: a request body is read whole, and panel sets are written to the sessions directory | `413 request_too_large` | a panel set legitimately exceeds 64 MB. The largest panel set we have is 0.9 MB (13 panels); a table panel that keeps a million filtered rows is about 7 MB |
| `max_sessions_per_user` | 500 | Disk: panel sets are files, written by any user (anyone, with login off) | `409 session_quota_user` | one person legitimately keeps more than 500 sets |
| `max_sessions` | 5,000 | Disk and CPU: the panel-set list reads the files | `409 session_quota_total` | many users each keep many sets |
| `max_sessions_mb` | 256 | Disk | `409 session_quota_total` | sets are large and the disk is |
| `dataset_folder_max_entries` | 500 | Disk and CPU: the picker's folder listing opens each store on the page (counts, format), the search returns at most this many matches | partial `200` (`more`, `truncated`) | folders hold thousands of stores and users page through them |
| `dataset_search_max_depth`, `dataset_search_max_entries` | 6, 20,000 | Disk and CPU: the picker's search walks the data directory tree for any user; it also stops after 3 s. A regex is refused as in the name search (`regex_too_long`, `regex_too_complex`) | partial `200` (`truncated`), `400` for a refused pattern | the tree is deeper than 6 folders or has more than 20,000 entries |
| `dataset_scan_max_entries` | 200,000 | Disk and threads: the legacy dataset listing and the store count in `/status` (and the directory browser) walk the data directory on every call, for any client | partial `200`, `truncated: true` | the data directory holds more than that many directory entries outside the stores |

A regular expression typed by a user runs with the `regex` package, one match at a time, under the
search's time limit (`name_search_timeout_s` for the name search, 3 s for the picker's folder
search). The package stops inside a match and lets other threads run; the standard `re` cannot be
interrupted and holds the GIL, so a pattern such as `.?` repeated 33 times followed by `!` kept a
worker busy for more than 200 s on one cell name and stopped every request it served. That time
limit is the guarantee. `check_regex` stays in front as a cheap first filter and refuses the usual
shapes with `400 regex_too_complex` (a repeat inside a repeat such as `(a+)+`, an alternation inside
a repeat, more than four open-ended repeats) before any name is read. Plain text search, the
default, is not affected. `regex` is a dependency of AnnZarro; if it is missing, regex search is
refused with `400 regex_unavailable` instead of running unguarded.

## Limits that existed before and are not repeated here

`max_response_elements`, `max_read_mb`, `read_budget_mb`, `read_wait_s`, `name_index_max_mb`,
`name_search_scan_names`, `refresh_min_interval_s`, `remote_chunk_cache_mb` and the remote store
timeouts, `arbitrary_paths` and `remote_allowlist` ({doc}`../reference/configuration`), and the
login lockout ({doc}`authentication`).

## Gunicorn versions and the request line

gunicorn is not pinned (`pip install annzarro gunicorn`). `limit_request_line` behaves the same in
the two versions whose source we read (23.0 and 26.2): any value from 8,190 up is lowered to 8,190,
and `0` is "unlimited". In 26.2 the C parser, when it is used, still stops at 1 MB for `0`. That
is why AnnZarro's default is `0` and the proxy has to bound the line (`large_client_header_buffers`
in nginx). The desktop app does not use gunicorn.

## What the proxy must do

gunicorn answers a request only after it has read it, and with `gthread` a client that sends
one byte at a time holds a thread for as long as it likes: `timeout` (60 s) is a heartbeat of
the worker, not a limit on a request. So, in nginx:

```nginx
client_header_timeout 10s;
client_body_timeout   20s;
send_timeout          30s;
client_max_body_size  64m;           # as server.max_request_mb
limit_conn_zone $binary_remote_addr zone=annzarro_addr:10m;
server {
    limit_conn annzarro_addr 40;     # simultaneous connections per client address
    proxy_read_timeout 120s;         # a request that runs longer is cut off at the proxy
}
```

`proxy_read_timeout` also answers the question of a request that outlives gunicorn's 60 s: the
thread keeps working after the proxy gave up, so a heavy request is still bounded by the limits
above, not by the timeout.

## What is not bounded

- **Large JSON replies.** `/data/cells`, `/data/genes` and a string `obs`/`var` column as JSON build
  the whole reply as Python lists (about 100 bytes a value): 95 million cell names are several GB
  in one request, for any user. They are the web client's way to name every cell of a dataset of
  up to 5 million cells, and on a larger one only on request, so a default that refuses them would
  break that. They are bounded by `max_response_elements` for the matrices, not for names. A
  streamed reply is planned.
- **Remote stores** you allow are trusted not to trickle: the timeouts are per read of a socket,
  not for a whole request.
- **The number of distinct cell subsets** cached (16 per process, 20 million cells): a user who
  asks for many seeds makes the others' subsets be computed again. The computation itself is
  limited (`subset_max_concurrent`).
