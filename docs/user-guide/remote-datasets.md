# Remote datasets

AnnZarro can open a Zarr store that is not on the server's disk: in an S3 bucket (`s3://`), in
Google Cloud Storage (`gs://`) or on any web server (`http://`, `https://`). The **server** reads the
remote store, chunk by chunk, exactly as it reads a local one; the browser talks only to the
AnnZarro server. Because a remote path makes the server fetch a URL that a user typed, remote
stores are switched on and limited in the server's configuration.

## Open a remote store

1. Click the **Dataset** picker in the header.
2. Type the store's URL into its search field, for example
   `https://data.example.org/zarr/atlas.zarr` or `s3://my-lab-bucket/atlases/atlas.zarr`. The list
   offers it as "*URL* (Custom)".

   ```{figure} ../_static/screens/user-guide/remote-typed.png
   :class: screenshot
   :width: 60%
   :alt: The Dataset picker open, with a URL typed into its search field and offered as the only entry.

   A URL typed into the Dataset picker.
   ```

3. Press **Enter**. The statistics bar shows the store's cells and genes, and new panels read from
   it.

   ```{figure} ../_static/screens/user-guide/remote-plot.png
   :class: screenshot
   :alt: A fold-change UMAP of H2-Q7, read from bm_aging.zarr served over HTTP.

   `bm_aging.zarr` read over HTTP: the fold-change UMAP of H2-Q7.
   ```

Remote paths work everywhere a local path does: in panel sets (the dataset is stored as the URL)
and in {doc}`share links <share-links>` (`?dataset_path=https%3A%2F%2F…`).

```{note}
When a share link opens a remote store, the **Dataset** picker shows "Select or enter a dataset
path" instead of the URL, although the store is open (the statistics bar shows it). This is a
display problem only.
```

## What the server must allow

Remote stores need the optional readers: `pip install 'annzarro[remote]'` (fsspec with s3fs,
gcsfs and aiohttp). Without them, opening a remote URL fails with a message that names this
command.

The `server` section of the configuration decides which URLs may be opened
({doc}`../reference/configuration`):

| Key | Default | Meaning |
|---|---|---|
| `remote_stores` | `auto` | `auto`: allowed on a local single-user server (loopback host, login off, `proxy_count` 0); on any other server only URLs under `remote_allowlist`. `allow`: always allowed (limited to the allowlist if one is set). `deny`: never. |
| `remote_allowlist` | `[]` | URL prefixes a remote store must start with, e.g. `["s3://my-lab-bucket/atlases/", "https://data.example.org/zarr/"]`. With an allowlist, HTTP redirects are refused, so an allowed host cannot send the server elsewhere. |
| `remote_credentials` | `anonymous` | `anonymous`: unsigned requests (public buckets, plain HTTP). `environment`: the standard credential chain of the backend (`AWS_*` variables, `AWS_PROFILE` or `~/.aws`, instance roles; Google application default credentials). |
| `remote_connect_timeout_s` | `10` | seconds to establish a connection |
| `remote_read_timeout_s` | `30` | seconds to wait between bytes; a store that stops answering fails the request with HTTP 504 instead of holding it |
| `remote_chunk_cache_mb` | `256` | in-memory cache of raw chunk bytes per open remote store (Zarr v3 stores; 0 switches it off) |

The environment variables `ANNZARRO_REMOTE_STORES`, `ANNZARRO_REMOTE_ALLOWLIST`,
`ANNZARRO_REMOTE_CREDENTIALS`, `ANNZARRO_REMOTE_CONNECT_TIMEOUT`, `ANNZARRO_REMOTE_READ_TIMEOUT`
and `ANNZARRO_REMOTE_CHUNK_CACHE_MB` override these keys.

The server logs its decision at startup, for example:

```text
Remote store policy: remote stores allowed for http://127.0.0.1:8827; credentials=anonymous;
timeouts connect=10s read=30s; chunk cache 256 MB/store [remote_stores: auto (server is behind a
proxy; allowlist only)]
```

A URL outside the allowlist is refused with "Remote dataset URL is not under an allowed prefix
(remote_allowlist: …)".

```{important}
In this build, `annzarro start` without `--development` loads the production defaults, which set
`proxy_count: 1`. `auto` then treats even a laptop server as hosted and refuses remote URLs unless
they are in `remote_allowlist`; the startup log says "remote stores disabled [remote_stores: auto
(server is behind a proxy; …)]". Set `remote_allowlist` (or `remote_stores: allow` on a
single-user machine) to open remote stores.
```

```{warning}
On a server other people can reach, `remote_stores: allow` without an allowlist lets every user make
the server fetch any URL, including addresses on your internal network. Always set
`remote_allowlist` on a shared server; the server logs a warning when login is on and remote
stores are open to any URL.
```

## What was tested for this page

There was no public HTTPS AnnData Zarr store at hand, so this page was checked with a local web
server: `python -m http.server 8827` serving the folder that holds `bm_aging.zarr` (Zarr v2,
consolidated metadata), and AnnZarro started with
`ANNZARRO_REMOTE_ALLOWLIST=http://127.0.0.1:8827/`. Typing
`http://127.0.0.1:8827/bm_aging.zarr` into the Dataset picker opened the store (8,090 cells,
16,285 genes) and the plots on this page were drawn from it. A URL outside the allowlist
(`https://example.org/x.zarr`) was refused with the message above. S3 and GCS stores go through
the same code path with a different fsspec backend but were not tested here.

```{admonition} What happens on the server
:class: note
Opening the store read its consolidated metadata (`.zgroup`, `.zattrs`, `.zmetadata`). Colouring the
UMAP by one gene's column of `layers/kompot_de_Young_to_Old_fold_change` (8,090 × 16,285, chunks of
1,024 × 1,024) made 8 HTTP requests to the web server: one per chunk of 1,024 cells that holds the
gene's column. The plot appeared 1.3 s after the page started loading, with the UMAP coordinates
already in the server's cache. The server's result cache answers a repeated request for the same
vector without going back to the store. For Zarr v3 stores, the chunk cache
(`remote_chunk_cache_mb`) also keeps the raw chunks, so another gene from chunks already fetched
is read locally; `bm_aging.zarr` is Zarr v2, so this was not exercised here.
```
