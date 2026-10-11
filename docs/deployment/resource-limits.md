# Running a shared server: resource limits

A server that other people can reach has to stay up when one of them asks for too much, by
mistake or on purpose. Every limit below is a `server.*` setting with a default that suits a
lab server on one machine and the datasets in this documentation (1 to 95 million cells). A
refused request gets a 4xx or 503 reply with a `reason` field ({doc}`../reference/http-api`),
and the web client shows its message. `annzarro config validate` rejects a value that is not a
number of the right kind. Raise a limit only when the host has what it protects: memory, CPU
time, disk or threads.

What a limit cannot do: AnnZarro does not rate-limit requests, and gunicorn cannot defend
itself against clients that send a request slowly. Put a reverse proxy in front
({doc}`lab-server`); it buffers slow clients and can cap connections per address.

| Setting | Default | Protects | Refusal | Raise it when |
|---|---|---|---|---|
| `name_search_max_regex_chars` | 200 | CPU: a regular-expression name search is a pattern run against every name | `400 regex_too_long` | users paste long patterns |
| `name_search_timeout_s` | 10 | CPU: a regex name search over millions of names answers with the matches found so far when it runs out of time (`partial: true`, `timed_out: true`) | partial `200` | the host is slow and the dataset has more than about 10 million names; 0 turns it off |
| `max_request_mb` | 16 | Memory and disk: a request body is read whole, and panel sets are written to the sessions directory | `413 request_too_large` | a panel set or an import legitimately exceeds 16 MB (typical ones are under 1 MB) |
| `max_sessions_per_user` | 500 | Disk: panel sets are files, written by any user (anyone, with login off) | `409 session_quota_user` | one person legitimately keeps more than 500 sets |
| `max_sessions` | 5,000 | Disk and CPU: the panel-set list reads the files | `409 session_quota_total` | many users each keep many sets |
| `max_sessions_mb` | 256 | Disk | `409 session_quota_total` | sets are large and the disk is |
| `dataset_scan_max_entries` | 200,000 | Disk and threads: the legacy dataset listing and the store count in `/status` walk the data directory on every call, for any client | partial `200`, `truncated: true` | the data directory holds more than that many directory entries outside the stores |

A regular expression that repeats a repeat (`(a+)+`) or branches inside a repeat (`(a|b)+` with
overlapping branches) is always refused with `400 regex_too_complex`: matching one 18-character
cell name takes a quarter of a second and the time doubles with every character, and the regex
engine cannot be interrupted. The same applies to more than four open-ended repeats in one
pattern. Plain text search, the default, is not affected.
