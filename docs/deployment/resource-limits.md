# Running a shared server: resource limits

The per-user share of the read budget and of the subset budget (`subset_budget_mb`) apply only to a server other people can reach (login on, or a network address); the desktop app and `annzarro start` on loopback without login have one user, who gets everything.

A server that other people can reach has to stay up when one of them asks for too much, by
mistake or on purpose. Every limit below is a `server.*` setting with a default that suits a
lab server on one machine and the datasets in this documentation (1 to 95 million cells). A
refused request gets a 4xx or 503 reply with a `reason` field ({doc}`../reference/http-api`),
and the web client shows its message. `annzarro config validate` rejects a value that is not a
number of the right kind. Raise a limit only when the host has what it protects: memory, CPU
time, disk or threads.

These limits bound what one request can cost. They do not bound how many requests arrive: AnnZarro
rate-limits only admin changes (`server.admin_rate_per_minute`) and failed sign-ins ({doc}`authentication`), and gunicorn's `gthread` worker keeps a thread on a client that sends its
request slowly. The reverse proxy in front ({doc}`lab-server`) is the defence for both; see
"What the proxy must do" below.

| Setting | Default | Protects | Refusal | Raise it when |
|---|---|---|---|---|
| `name_search_max_regex_chars`{#limit-name-search-max-regex-chars} | 200 | CPU: a regular-expression name search is a pattern run against every name | `400 regex_too_long` | users paste long patterns |
| `name_search_timeout_s`{#limit-name-search-timeout-s} | 10 | CPU: a regex name search over millions of names answers with the matches found so far when it runs out of time (`partial: true`, `timed_out: true`) | partial `200` | the host is slow and the dataset has more than about 10 million names; 0 turns it off |
| `read_user_share_percent`{#limit-read-user-share-percent} | 50 | Fairness: the pairwise-read budget (`read_budget_mb`) and the subset budget (`subset_budget_mb`) are shared; one user (one address, with login off; one /64 for IPv6) may hold this share of each | `503 read_busy` | few users and one big matrix; 0 gives a user the whole of both budgets |
| `subset_budget_mb`{#limit-subset-budget-mb}, `subset_wait_s`{#limit-subset-wait-s} | 15% of RAM, 30 | Memory and threads: a subset is a pass over a column of every cell, charged 55 bytes per cell, the worst measured at 95.6 million cells (5 GB for one subset read as a Python list; a numeric filter on the array holds about 19 bytes per cell, and six at once held 10.8 GB), and any request can name a new seed or filter. One user holds at most `read_user_share_percent` of the budget while another waits, and has at most one request waiting | `503 read_busy` after the wait | many users open the largest datasets at once and filters queue longer than 30 s; give the host more RAM or raise the budget |
| `max_read_mb`{#limit-max-read-mb}, `read_budget_mb`{#limit-read-budget-mb} | 5% of RAM (256 MB to 4 GB), twice `max_read_mb` | Memory: one read of an `obsp` or `varp` matrix is estimated from the store's metadata before any chunk is read, and all such reads in flight in one worker share the budget | `413 read_too_large`, `503 read_busy` | the host has the RAM and legitimate matrices are refused; 0 uses the default |
| `read_wait_s`{#limit-read-wait-s} | 5 | Threads: how long a pairwise read waits for the budget before it is answered | `503 read_busy` | reads queue behind each other on a busy host |
| `remote_request_timeout_s`{#limit-remote-request-timeout-s} | 120 on a shared server, 600 on a single-user one | Threads: one request's reads from a remote store (`s3://`, `gs://`, `https://`), however many chunks. A single wait is bounded by `remote_connect_timeout_s` and `remote_read_timeout_s`; this bounds the sum | `504 remote_deadline` | a store is slow and legitimate requests need longer; 0 turns it off |
| `max_requests`{#limit-max-requests}, `max_requests_jitter`{#limit-max-requests-jitter} | 20,000, 2,000 | Memory: a worker that leaks or fragments is replaced; its caches start empty | (worker restart) | every request is cheap and the dataset index takes long to rebuild: raise it, or 0 |
| `limit_request_line`{#limit-limit-request-line}, `limit_request_fields`{#limit-limit-request-fields}, `limit_request_field_size`{#limit-limit-request-field-size} | 0 (none), 100, 8,190 | Memory and CPU: one request made of many or huge headers (gunicorn only). The request line is not limited because the web client names the cells and genes it asks for in the URL (about 12 KB for 2,000 genes; gunicorn would cap any other value at 8,190), so bound it in the proxy (`large_client_header_buffers`) | `400` from gunicorn | never needed |
| `max_request_mb`{#limit-max-request-mb} | 64 | Memory and disk: a request body is read whole, and panel sets are written to the sessions directory | `413 request_too_large` | a panel set legitimately exceeds 64 MB. The largest panel set we have is 0.9 MB (13 panels); a table panel that keeps a million filtered rows is about 7 MB |
| `max_sessions_per_user`{#limit-max-sessions-per-user} | 500 | Disk: panel sets are files, written by any user (anyone, with login off) | `409 session_quota_user` | one person legitimately keeps more than 500 sets |
| `max_sessions`{#limit-max-sessions} | 5,000 | Disk and CPU: the panel-set list reads the files | `409 session_quota_total` | many users each keep many sets |
| `max_sessions_mb`{#limit-max-sessions-mb} | 256 | Disk | `409 session_quota_total` | sets are large and the disk is |
| `dataset_folder_max_entries`{#limit-dataset-folder-max-entries} | 500 | Disk and CPU: the dataset browser's folder listing opens each store on the page (counts, format), the search returns at most this many matches | partial `200` (`more`, `truncated`) | folders hold thousands of stores and users page through them |
| `dataset_search_max_depth`{#limit-dataset-search-max-depth}, `dataset_search_max_entries`{#limit-dataset-search-max-entries} | 6, 20,000 | Disk and CPU: the dataset browser's search walks the data directory tree for any user; it also stops after 3 s. A regex is refused as in the name search (`regex_too_long`, `regex_too_complex`) | partial `200` (`truncated`), `400` for a refused pattern | the tree is deeper than 6 folders or has more than 20,000 entries |
| `dataset_details_check_budget_s`{#limit-dataset-details-check-budget-s} | 1.5 | CPU and file system reads: the details request (`GET /datasets/details`) runs the store check of one zarr store, which reads metadata only, never a chunk. The check stops between steps once the budget is spent; a remote store is checked only when the client asks (`check=1`). `0` turns the check off | partial `200` (`store_check.budget_reached: true`) | a store has so many arrays that the check does not finish in 1.5 s |
| `dataset_scan_max_entries`{#limit-dataset-scan-max-entries} | 200,000 | Disk and threads: the legacy dataset listing and the store count in `/status` (and the directory browser) walk the data directory on every call, for any client | partial `200`, `truncated: true` | the data directory holds more than that many directory entries outside the stores |
| `text_index_workers`{#limit-text-index-workers}, `text_index_store_timeout_s`{#limit-text-index-store-timeout-s}, `text_index_crawl_timeout_s`{#limit-text-index-crawl-timeout-s}, `text_index_max_stores`{#limit-text-index-max-stores} | 2, 15, 300, 20,000 | Disk, threads and file system reads: the crawl behind the description search (`GET /datasets/text-search`) opens the attribution and README of each local store. One crawl runs at a time on the whole server, in a daemon thread of one worker, with 2 reader threads (they share the worker's CPU: opening a dataset in that worker was 34 ms idle and 62 ms during a crawl of 20,000 stores). Each store is read from the files under its `uns`, not through its consolidated metadata. A store that does not answer in 15 s keeps its thread (a read cannot be stopped) and a spare thread reads the next store; its answer is kept if it comes before the crawl ends, otherwise it is marked timed out and read again an hour later. Late reads that have not answered count against the spare threads of the server process across crawls: when there are as many as reader threads, the crawl stops (and a crawl that finds none left reads nothing until they answer), so a store that never answers cannot make the threads grow. A store is read again when `uns`, `uns/annzarro` or `uns/README` changes on disk; a value rewritten in place under an existing attribution field is picked up once the store is annotated or re-consolidated. 15 s is a chosen margin, not a measured need: over a network file system on a heavily loaded host one store took up to 5.6 s, and 0.8 s at most from a less loaded node. A crawl stops after 300 s (the index it has built is kept, marked `partial`, and the next crawl continues from it, re-reading only what is missing) or at 20,000 stores (the index is kept and marked `capped`; stores past the cap are not searched, name search is unaffected). On 20,000 stores the first crawl took 4 minutes (2 or 4 threads alike: the reads are CPU-bound) and a crawl with nothing changed 23 s | partial index (`index.state: "partial"`) | the datasets are on a slow network file system, or there are more than 20,000 stores |
| `text_index_readme_kb`{#limit-text-index-readme-kb}, `text_index_max_mb`{#limit-text-index-max-mb} | 64, 64 | Memory: every worker holds the whole index in memory. Each README is cut at 64 KB, and the index at 64 MB of text (READMEs are dropped from the largest down, `capped: true`). A worker holds the text once, as it is, plus the entries' names and paths: 64 MB of text (20,000 stores, the cap) took 98 MB per worker, and loading never holds more than that (the file is read one entry at a time), so four workers hold about 400 MB. A query on 20,000 stores took 70 to 140 ms (p95 up to 160 ms) | the longest READMEs are not searched past their first 64 KB | the READMEs are long and the memory is there |
| `text_index_ttl_s`{#limit-text-index-ttl-s}, `text_index_min_interval_s`{#limit-text-index-min-interval-s} | 600, 60 | Disk and CPU: an index older than 10 minutes is answered from and refreshed in the background, which stats every store and reads only those that changed. A crawl starts at most once a minute whoever asks, so the Refresh button (open to every user) cannot start crawls back to back. `0` turns the interval off | `POST /datasets/text-index/refresh` answers the current status with `started: false` | the datasets change more often than every 10 minutes |

A regular expression typed by a user runs with the `regex` package, one match at a time, under the
search's time limit (`name_search_timeout_s` for the name search, 3 s for the dataset browser's folder
search). The package stops inside a match and lets other threads run; the standard `re` cannot be
interrupted and holds the GIL, so a pattern such as `.?` repeated 33 times followed by `!` kept a
worker busy for more than 200 s on one cell name and stopped every request it served. That time
limit is the guarantee. `check_regex` stays in front as a cheap first filter and refuses the usual
shapes with `400 regex_too_complex` (a repeat inside a repeat such as `(a+)+`, an alternation inside
a repeat, more than four open-ended repeats) before any name is read. Plain text search, the
default, is not affected. `regex` is a dependency of AnnZarro; if it is missing, regex search is
refused with `400 regex_unavailable` instead of running unguarded.

## Other limits

`max_response_elements`, `name_index_max_mb`,
`name_search_scan_names`, `refresh_min_interval_s`, `remote_chunk_cache_mb` and the remote store
timeouts, `arbitrary_paths` and `remote_allowlist` ({doc}`../reference/configuration`), and the
login lockout ({doc}`authentication`).

## Gunicorn versions and the request line

gunicorn is pinned only from below (21.2, in the `server` extra: `pip install 'annzarro[server]'`). `limit_request_line` behaves the same in
the two versions whose source we read (23.0 and 26.2): any value from 8,190 up is lowered to 8,190,
and `0` is "unlimited". In 26.2 the C parser, when it is used, still stops at 1 MB for `0`. That
is why AnnZarro's default is `0` and the proxy has to bound the line (`large_client_header_buffers`
in nginx). The desktop app does not use gunicorn.

## What the proxy must do

Set `proxy_count` to the number of proxies in front. Without it every client of a server with login off
has the proxy's address, and the fair share of the read budget (`read_user_share_percent`) is then one
share for everybody.

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
    proxy_read_timeout 120s;         # a reply that sends nothing for 120 s is cut off at the proxy
}
```

`proxy_read_timeout` also answers the question of a request that outlives gunicorn's 60 s: the
thread keeps working after the proxy gave up, so a heavy request is still bounded by the limits
above, not by the timeout.

## Cell subsets

Every request for a cell subset that is not cached is a pass over a column of every cell, and a
request can name any of 2^32 seeds or any filter. Each worker process caches 16 subsets (20
million cells together). The cache is shared fairly between users, the same users as for
`read_user_share_percent`: the logged-in user, else the client address (an IPv6 /64 is one).

- **Over its budget, the cache evicts from the user who holds the most.** A subset counts as
  1/16 of the cache, or its share of the 20 million cells if that is more, and a subset several
  users look at (the default subset of a dataset) counts for each of them in part. A user
  stepping through seeds or filters, or asking for every cell of a large dataset, evicts their
  own subsets, not the other users'.
- **The subset a user looked at last is kept** for 10 minutes after they last used it, even if
  it is also held by the user who holds the most. A subset nobody used for 10 minutes can be
  evicted for anyone.
- **A subset that does not fit beside the others' current subsets** (all the cells of a 20
  million cell dataset, while others are working) is answered but not kept.
- **With one user** (the desktop app, or a server only one person uses) this is the cache's
  plain least-recently-used order.
- **Per worker process.** gunicorn hands each request to any worker, and each worker has its own
  cache and its own `subset_budget_mb`. A user's share holds in every worker, so
  across the server too; there is no server-wide quota per user. Each worker computes a subset
  the first time it is asked for it.
- **One address is one user.** People behind one NAT share one share; they lose subsets to each
  other only when the cache is full. Behind a reverse proxy set `proxy_count`, or every request
  comes from the proxy's address and the cache is one user's plain LRU again.

## What is not bounded

- **String `obs`/`var` columns as JSON.** A string column (a barcode on every cell) asked for as JSON
  builds the whole reply as Python lists, about 100 bytes a value, for any user. Numeric columns and
  categorical columns have binary encodings and are not affected. The name lists `/data/cells` and
  `/data/genes` are streamed one chunk at a time, so naming every cell of a 95-million-cell dataset
  does not build the list in memory.

