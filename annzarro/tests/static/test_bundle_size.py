"""Guard (0.8.0): the Plotly bundle stays within plan 1.7.

Today 1,937,293 bytes (609,385 gzip). F6 adds heatmap, bar, pie and contour (measured 2,042,146 and 646,531); the
budget is 2,060,000 bytes and 655,000 gzip. Nothing else may grow the file the page loads.
"""
import glob
import gzip
import os

MAX_BYTES = 2_060_000
MAX_GZIP = 655_000
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def sizes(data):
    return len(data), len(gzip.compress(data, 9))


def over(data, max_bytes=MAX_BYTES, max_gzip=MAX_GZIP):
    raw, packed = sizes(data)
    out = []
    if raw > max_bytes:
        out.append(f"{raw:,} bytes, budget {max_bytes:,}")
    if packed > max_gzip:
        out.append(f"{packed:,} gzip, budget {max_gzip:,}")
    return out


def test_bundle_within_budget():
    paths = glob.glob(os.path.join(REPO, "scripts", "plotly", "plotly-*-annzarro.min.js"))
    assert len(paths) == 1, f"expected one built bundle in scripts/plotly, found {paths}"
    with open(paths[0], "rb") as fh:
        bad = over(fh.read())
    assert not bad, os.path.basename(paths[0]) + ": " + "; ".join(bad)


def test_planted_oversize_is_found():
    big = os.urandom(MAX_BYTES + 1)                       # random bytes do not compress
    assert len(over(big)) == 2
    assert over(b"x" * 1000) == []
    assert over(b"x" * 1000, max_bytes=10) == ["1,000 bytes, budget 10"]
