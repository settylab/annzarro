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
| `compute_budget_mb`{#limit-compute-budget-mb}, `group_code_cache_mb`{#limit-group-code-cache-mb} | 4608, 512 | Memory: gene scores and cell groupings read whole matrices, up to 2.3 GB for one job at 100 million cells; every job in flight in one worker is charged its estimate against `compute_budget_mb` (4.5 GB a worker, so 18 GB for 4 workers), and the code cache of `group_code_cache_mb` is emptied first to make room | the job waits; its progress shows its place in the queue | the host has more RAM and jobs queue behind each other, or less and a worker is killed; a value below the largest single job makes every job run alone ({ref}`compute-memory`) |
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
| `text_index_workers`{#limit-text-index-workers}, `text_index_store_timeout_s`{#limit-text-index-store-timeout-s}, `text_index_max_stores`{#limit-text-index-max-stores} | 2, 15, 20,000 | Disk, threads and file system reads: the crawl behind the description search (`GET /datasets/text-search`) opens the attribution and README of each local store that has either. One crawl runs at a time on the whole server, in a daemon thread of one worker, with 2 reader threads (they share the worker's CPU: opening a dataset in that worker was 34 ms idle and 62 ms during a crawl of 20,000 stores). The server starts it by itself and continues it until every store is read. A store with neither `uns/README` nor `uns/annzarro` has only the names of its fields read, from its consolidated listing; its stat signature, which includes the slot folders and the listing, says when it changed. A store that has not changed costs only its signature, a few `stat` calls. Each store with text is read from the files under its `uns`, not through its consolidated metadata. A store that does not answer in 15 s keeps its thread (a read cannot be stopped) and a spare thread reads the next store; its answer is kept if it comes before the crawl ends, otherwise it is marked timed out and read again an hour later. Late reads that have not answered count against the spare threads of the server process across crawls: when there are as many as reader threads, the crawl stops (and a crawl that finds none left reads nothing until they answer), so a store that never answers cannot make the threads grow. A store is read again when `uns`, `uns/annzarro` or `uns/README` changes on disk; a value rewritten in place under an existing attribution field is picked up once the store is annotated or re-consolidated. 15 s is a chosen margin, not a measured need: over a network file system on a heavily loaded host one store took up to 5.6 s, and 0.8 s at most from a less loaded node. A crawl stops after 5 minutes (not a setting): the index it has built is kept, marked partial, and the keeper starts the next crawl, which reads only what is missing. At 20,000 stores the index is kept and marked `capped`: stores past the cap are not searched, name search is unaffected. On 20,000 stores the first crawl took 4 minutes (2 or 4 threads alike: the reads are CPU-bound) and a crawl with nothing changed 23 s | the dataset browser's line says some datasets are not searched yet | the datasets are on a slow network file system, or there are more than 20,000 stores |
| `text_index_readme_kb`{#limit-text-index-readme-kb}, `text_index_max_mb`{#limit-text-index-max-mb} | 64, 64 | Memory: every worker holds the whole index in memory. Each README is cut at 64 KB, and the index at 64 MB of text (READMEs are dropped from the largest down, `capped: true`). A worker holds the text once, as it is, plus the entries' names and paths: 64 MB of text (20,000 stores, the cap) took 98 MB per worker, and loading never holds more than that (the file is read one entry at a time), so four workers hold about 400 MB. A query on 20,000 stores took 70 to 140 ms (p95 up to 160 ms) | the longest READMEs are not searched past their first 64 KB | the READMEs are long and the memory is there |
| `text_index_ttl_s`{#limit-text-index-ttl-s} | 1800 | Disk and CPU: every 30 minutes the keeper stats every store and reads only those that changed. No user can start a crawl: a search never does, and **Rebuild now** on the Server health page is for administrators | the index is up to 30 minutes behind a change | the datasets change more often than every 30 minutes |

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

(compute-memory)=
## Memory for scores, groupings and counts

Gene scores, Cell Groupings, the Cell-Gene Plot and the Cell Count Plot all compute on the server, over every cell of
a dataset. Each worker process keeps one ledger of what its computations hold, bounded by `compute_budget_mb`, and a
computation is charged its estimate before it starts. One that does not fit waits, after the cache of group codes has
been emptied to make room, and the panel that asked shows its place in the queue. The bound is enforced, not
estimated: a worker never holds more than its ledger for these computations.

What one worker holds at once at 100 million cells, with the default bound:

| Held by one worker | Memory |
|---|---|
| The heavy slot: one gene job's read-ahead and the segments it works on, **or** one gene score (500 genes) | up to 2.3 GB |
| One grouping being resolved: its codes, one source column and its working space. A second runs beside it only if both fit | up to 1.5 GB |
| The cache of group codes (`group_code_cache_mb`), emptied first when room is needed | up to 0.5 GB |
| Jobs that have given the heavy slot to another: their running sums only, their read-ahead freed | under 0.1 GB |
| **The bound, `compute_budget_mb`** | **4.5 GB** |

That is **4.5 GB per worker, so 18 GB for the 4 workers a server may run**, at 100 million cells. At 10 million cells
the same work holds under 1 GB per worker. Size the host for the bound times the workers, plus what the rest of the
server holds (the name index and the readers' caches, {doc}`../reference/configuration`). A lower `compute_budget_mb`
is valid down to the largest single computation; requests then run one after another instead of side by side, which
is slower but safe.

Light requests, those estimated under 5 seconds that read no whole matrix (most groupings and counts), run two at a
time per worker beside the heavy slot and never wait for it. A long heavy job gives the slot back between read batches
when another job waits, so it delays a later one by one batch at most.

Measured on a 95.6-million-cell dataset stored by gene, with one worker and the defaults: opening a panel set with one
grouping and three plots that use it took 9.8 s with an empty cache and 5.0 s with the grouping's codes cached. One plot of genes over that grouping reserved 2.7 GB and used at most 1.4 GB. With 4
workers the same panel set resolved the grouping once in each worker that served it (4 copies of 96 MB of codes).

(cost-limits)=
## Cost limits

What one computation may cost is set under `limits:` in the configuration file
({doc}`../reference/configuration`), and an administrator can change each value on the **Settings** page of the
admin interface, under **Limits**, without a restart ({doc}`admin`). The server resolves them once per request, and
the web client reads the same values from `GET /api/v1/policy/effective`, so a limit it checks before it asks (the
Cell-Gene matrix, the groups of a grouping, the cells of a count grid) is the server's, never a copy of its own. A
refusal names the limit in force in its `limit` field.

A value set in the configuration file is a ceiling: the admin may lower it on the Settings page, never raise it. The one limit where higher is stricter, `refresh_min_interval_large_s`, has the file's value as a floor instead: the admin may raise it, never lower it.
Leave a key out of the file and the admin may set anything within its bounds. `policy.locked` fixes a key to the
file's value altogether. The time tiers keep their order, `live_update_s` ≤ `ask_first_s` ≤ `refuse_s` (and
`partitionings` ≤ `request_partitionings`): a configuration file that breaks it does not start, the Settings page
refuses such a change, and a value that comes out of order between the two layers is lowered to the next tier.

The seconds are the server's estimates, from read rates measured on each matrix layout; the estimate itself is not a
setting. The upper bounds are ten times the defaults for now, until each is measured at its maximum; the group,
level and grid limits also stay below the 16-bit group codes, and `grid_sets` cannot rise above 16 (the sets of a
cell are a 16-bit mask). A safety limit protects the server or the browser tab; raise one only when the host (or the
users' computers) has the memory and time it protects.

| Setting | Default | Bounds | Enforced by | Kind | Refusal |
|---|---|---|---|---|---|
| `ask_first_s`{#cost-ask-first-s} | 60 | 0 to 600 | server and browser | when to ask | `409 confirmation_required` until the request carries `confirm: true` (the panel asks) |
| `refuse_s`{#cost-refuse-s} | 600 | 0 to 6000 | server | safety | `413 score_too_expensive`, `413 groups_too_expensive` |
| `live_update_s`{#cost-live-update-s} | 5 | 0 to 50 | server and browser | safety | edits wait for **Update**; the job runs in the heavy lane |
| `progress_bar_s`{#cost-progress-bar-s} | 10 | 0 to 100 | browser | when to ask | (a progress bar is shown) |
| `refresh_min_interval_large_s`{#cost-refresh-min-interval-large-s} | 60 | 0 to 600 | server | safety | a non-admin's **Refresh** of a dataset above `refresh_large_cells` on a shared server is answered `scheduled` and runs at the end of the interval; the app says when |
| `refresh_large_cells`{#cost-refresh-large-cells} | 10,000,000 | 1 to 100,000,000 | server | safety | (the cell count above which the interval above applies) |
| `matrix_values`{#cost-matrix-values} | 400,000 | 1 to 4,000,000 | server and browser | safety | `too_many_values` in the result; the browser does not ask (`matrix_too_large`) |
| `genes_per_section`{#cost-genes-per-section} | 2,000 | 1 to 20,000 | browser | when to ask | the browser does not ask (`too_many_genes`) |
| `groups`{#cost-groups} | 2,000 | 2 to 20,000 | server and browser | safety | `too_many_groups`, `too_many_levels` in the result |
| `partitionings`{#cost-partitionings} | 8 | 1 to 64 | server and browser | safety | `422 too_many_partitionings` |
| `request_partitionings`{#cost-request-partitionings} | 64 | 1 to 640 | server | safety | `422 too_many_partitionings` |
| `measures`{#cost-measures} | 16 | 1 to 160 | server | safety | `400 too_many_measures` |
| `thresholds`{#cost-thresholds} | 4 | 1 to 40 | server | safety | `422 too_many_thresholds` |
| `grid_cells`{#cost-grid-cells} | 2,097,152 | 1 to 20,971,520 | server and browser | safety | `422 grid_too_large` |
| `grid_2d_bins`{#cost-grid-2d-bins} | 512 | 2 to 5,120 | server | safety | `422 too_many_bins` |
| `grid_2d_split`{#cost-grid-2d-split} | 8 | 1 to 80 | server | safety | `422 too_many_levels` |
| `grid_1d_bins`{#cost-grid-1d-bins} | 2,000 | 2 to 20,000 | server | safety | `422 too_many_bins` |
| `grid_1d_split`{#cost-grid-1d-split} | 200 | 1 to 2,000 | server | safety | `422 too_many_levels` |
| `grid_categorical_levels`{#cost-grid-categorical-levels} | 200 | 1 to 2,000 | server | safety | `422 too_many_levels` |
| `grid_sets`{#cost-grid-sets} | 16 | 2 to 16 | server | safety | `422 too_many_sets` |
| `obsp_source_max_cells`{#cost-obsp-source-max-cells} | 1,000,000 | 1 to 10,000,000 | server | safety | `422 obsp_too_large` |
| `cell_export_max`{#cost-cell-export-max} | 1,000,000 | 1 to 10,000,000 | browser | safety | the export is disabled, with the reason |
| `bars_3d_max`{#cost-bars-3d-max} | 40,000 | 1 to 400,000 | browser | safety | the 3D view is not drawn, with the reason |
| `density_points_draw`{#cost-density-points-draw} | 1,000,000 | 1 to 10,000,000 | browser | safety | a seeded sample of this many cells is drawn, and the plot says so |
| `density_points_load`{#cost-density-points-load} | 25,000,000 | 1 to 250,000,000 | browser | safety | the Cell points layer is refused, with the count and the limit |
| `dendrogram_rows`{#cost-dendrogram-rows} | 2,000 | 2 to 20,000 | browser | safety | no dendrogram, with the reason |

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

