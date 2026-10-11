"""The numbers that decide when a store's layout is called slow, in one place.

``annzarro store check`` (store_check.py) and the server's open-time notices
(read_guard.chunking_notice) both read their limits from here, so the command
line and the running server never disagree about a store. The values come from
the measurements on the documentation's chunking and performance pages
(docs/data/chunking.md, docs/reference/performance.md).
"""
import math

#: Severities, mildest first. ``slow`` is a layout that makes a click take
#: seconds, or that the server refuses outright.
SEVERITIES = ("info", "warning", "slow")

#: Wrong-direction sparse read (a gene column of a CSR matrix, a cell row of a
#: CSC one): every stored index is scanned, about one nanosecond per non-zero
#: (Tahoe 1M prefix, 101M non-zeros: 99 to 108 ms from CSR against 3 to 6 ms
#: from CSC, page cache warm; the cell row of the CSC copy took 159 to 196 ms).
SCAN_NS_PER_NONZERO = 1.0
#: Estimated seconds of one such read from which it is reported / a ``warning`` / ``slow``.
SPARSE_INFO_S = 0.005
SPARSE_WARNING_S = 0.02
SPARSE_SLOW_S = 0.1

#: Chunk shape: the documented rule aims at this many values per chunk (2 MB
#: of float32). A dense read is judged against the same read from chunks
#: that follow the rule (layer_chunks).
TARGET_CHUNK_VALUES = 5e5
#: A dense read that decompresses this many times the bytes the rule's chunks
#: would, and at least this much, is a ``warning`` / ``slow``. Measured at
#: 200,000 x 2,000: 1.6 GB decompressed per click took 125 to 170 ms, 50 MB 15 ms;
#: whole-gene chunks at 1M x 5,000 needed 2.9 s for one cell row.
DENSE_WARNING_FACTOR, DENSE_WARNING_BYTES = 8, 64 * 2 ** 20
DENSE_SLOW_FACTOR, DENSE_SLOW_BYTES = 16, 256 * 2 ** 20

#: One chunk's uncompressed bytes: 32 times below / 16 times above the
#: guidance of about 2 MB. Too small only counts once there are this many chunks.
CHUNK_MIN_BYTES = 64 * 2 ** 10
CHUNK_MAX_BYTES = 32 * 2 ** 20
CHUNK_MIN_COUNT = 1000

#: A float64 array is reported from 16 MB, a ``warning`` from this size.
FLOAT64_INFO_BYTES = 16 * 2 ** 20
FLOAT64_WARNING_BYTES = 256 * 2 ** 20

#: Files (chunks, or shards when sharded) in the whole store.
MANY_FILES = 100_000
#: Chunks of an unsharded zarr format 3 store from which sharding is advised.
MANY_CHUNKS_V3 = 50_000

#: obs/var: rows from which a plain string column or the name index is a
#: ``warning`` (every use reads and decodes all of them; zarr decodes about
#: 10 million strings per 1.1 s), and a categorical with int64 codes costs
#: eight times the bytes of int8 ones.
STRING_COLUMN_ROWS = 100_000
INDEX_INFO_ROWS = 10_000_000
INDEX_WARNING_ROWS = 50_000_000
#: An index chunk holding more entries than this is decoded whole in memory.
INDEX_MAX_CHUNK_ROWS = 5_000_000
CODES_WARNING_BYTES = 64 * 2 ** 20

#: Without consolidated metadata every group and array is a read of its own:
#: from this many nodes it is a ``warning`` (``slow`` on a remote store).
UNCONSOLIDATED_NODES = 50


def layer_chunks(n_obs: int, n_vars: int, target: float = TARGET_CHUNK_VALUES):
    """Chunks for a dense cells x genes layer that follow the matrix's aspect
    ratio (docs/data/chunking.md)."""
    rows = 2 ** round(math.log2(math.sqrt(target * n_obs / n_vars)))
    cols = 2 ** round(math.log2(target / rows))
    return max(1, min(rows, n_obs)), max(1, min(cols, n_vars))


def dense_gene_column_bytes(shape, chunks, itemsize: int) -> int:
    """Bytes decompressed to read one gene column: every chunk of one chunk column."""
    n_obs, n_vars = shape
    return -(-n_obs // chunks[0]) * chunks[0] * min(chunks[1], n_vars) * itemsize


def dense_cell_row_bytes(shape, chunks, itemsize: int) -> int:
    """Bytes decompressed to read one cell row: every chunk of one chunk row."""
    n_obs, n_vars = shape
    return -(-n_vars // chunks[1]) * min(chunks[0], n_obs) * chunks[1] * itemsize
