"""Split test files into balanced shards: ``pytest --shard I/N`` runs shard I of N.

CI runs the browser tests (annzarro/tests/browser) in parallel jobs, one shard each. A file
is never split: its server and fixtures stay in one process. Files are dealt out longest
first, each to the shard with the least time so far, by the seconds recorded in
``browser/durations.json``; a file not recorded counts as the median. Every shard job
collects the same files and computes the same split, so each file runs in exactly one.

After adding or growing browser tests, refresh the durations (any machine: only the
proportions matter)::

    pytest -n 6 --dist loadfile --durations=0 annzarro/tests/browser > durations.log
    python -m annzarro.tests.shards durations.log
"""
import json
import os
import re
import sys
from statistics import median

DURATIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "browser", "durations.json")


def parse_shard(text):
    """``"I/N"`` as ``(I, N)``, 1 <= I <= N."""
    match = re.fullmatch(r"\s*(\d+)\s*/\s*(\d+)\s*", text or "")
    if not match or not 1 <= int(match.group(1)) <= int(match.group(2)):
        raise ValueError(f"--shard takes I/N with 1 <= I <= N, not {text!r}")
    return int(match.group(1)), int(match.group(2))


def load_durations(path=DURATIONS):
    try:
        with open(path) as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {}


def split(files, n, durations):
    """``files`` (repo-relative paths) as ``n`` lists, every file in exactly one."""
    known = [durations[f] for f in files if f in durations]
    default = median(known) if known else 1.0
    shards = [[] for _ in range(n)]
    load = [0.0] * n
    for f in sorted(set(files), key=lambda f: (-durations.get(f, default), f)):
        i = load.index(min(load))
        shards[i].append(f)
        load[i] += durations.get(f, default)
    return shards


def _write_durations(log):
    """Sum pytest's ``--durations=0`` lines per browser file into ``DURATIONS``."""
    total = {}
    with open(log) as fh:
        for line in fh:
            m = re.match(r"([\d.]+)s (?:call|setup|teardown)\s+(annzarro/tests/browser/[^:\s]+\.py)", line)
            if m:
                total[m.group(2)] = total.get(m.group(2), 0.0) + float(m.group(1))
    if not total:
        sys.exit(f"no --durations=0 lines for annzarro/tests/browser in {log}")
    with open(DURATIONS, "w") as fh:
        json.dump({f: round(s, 1) for f, s in sorted(total.items())}, fh, indent=1)
        fh.write("\n")
    print(f"{len(total)} files, {sum(total.values()):.0f} s, written to {DURATIONS}")


if __name__ == "__main__":
    _write_durations(sys.argv[1])
