#!/usr/bin/env python3
"""Prepare electron-builder's updater metadata (latest*.yml) for the GitHub release.

    update_metadata.py refresh DIR     # in each build job, after the files are final
    update_metadata.py merge-mac DIR   # in the release job, once
    update_metadata.py verify DIR      # in the release job, last

The app updates itself from the latest*.yml files of its release (electron-updater,
GitHub provider): every `files:` entry names a file of the release and carries its
sha512 and size, which the app checks after downloading.

- refresh: electron-builder wrote the yml before the workflow changed some of the
  files (the AppImage is repacked, the dmg is notarized and stapled afterwards), so
  sha512 and size are recomputed from the files in DIR. A `blockMapSize` is kept only
  if `<file>.blockmap` is in DIR (a stale or absent blockmap makes the app download the
  whole file, which is always correct). Fails if a listed file is missing.
- merge-mac: the two macOS jobs each produce a yml for their own architecture, named
  latest-mac-arm64.yml and latest-mac-x64.yml here. They become one latest-mac.yml listing
  the zips and dmgs of both; the updater picks the entry with "arm64" in its name on
  Apple silicon and the others on Intel.
- verify: every file every latest*.yml names is in DIR with the stated sha512 and size.
"""

import argparse
import base64
import hashlib
import sys
from pathlib import Path

import yaml


class _Loader(yaml.SafeLoader):
    """SafeLoader that leaves `releaseDate: 2026-10-14T...Z` a string, as electron-builder writes it."""


_Loader.yaml_implicit_resolvers = {
    k: [(tag, rx) for tag, rx in v if tag != "tag:yaml.org,2002:timestamp"]
    for k, v in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


def load(path):
    with open(path, encoding="utf-8") as f:
        data = yaml.load(f, Loader=_Loader)
    if not isinstance(data, dict) or not isinstance(data.get("files"), list) or not data.get("version"):
        raise SystemExit(f"{path}: not an electron-builder update file (needs version and files)")
    return data


def dump(data, path):
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, default_flow_style=False, width=1000)


def sha512_b64(path):
    h = hashlib.sha512()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return base64.b64encode(h.digest()).decode()


def refresh_file(yml, directory):
    """Recompute sha512, size and blockMapSize of every entry of `yml` from `directory`."""
    data = load(yml)
    for entry in data["files"]:
        name = entry["url"]
        f = directory / name
        if not f.is_file():
            raise SystemExit(f"{yml.name}: lists {name}, which is not in {directory}")
        entry["sha512"] = sha512_b64(f)
        entry["size"] = f.stat().st_size
        # electron-builder writes no blockMapSize for the macOS zip; the updater then finds
        # the blockmap next to the file by name.
        if not (directory / (name + ".blockmap")).is_file():
            entry.pop("blockMapSize", None)
    # The legacy top-level fields describe the first file.
    first = data["files"][0]
    data["path"] = first["url"]
    data["sha512"] = first["sha512"]
    dump(data, yml)


def merge_mac(parts):
    """One update file from the per-architecture ones (list of loaded dicts)."""
    versions = {p["version"] for p in parts}
    if len(versions) != 1:
        raise SystemExit(f"the macOS update files are for different versions: {sorted(versions)}")
    merged = dict(parts[0])
    seen = set()
    files = []
    for p in parts:
        for entry in p["files"]:
            if entry["url"] not in seen:
                seen.add(entry["url"])
                files.append(entry)
    merged["files"] = files
    merged["releaseDate"] = max(str(p.get("releaseDate", "")) for p in parts)
    # The top-level path is what clients too old to read `files` use: a zip, the Intel one.
    zips = [e for e in files if e["url"].endswith(".zip")]
    legacy = next((e for e in zips if "arm64" not in e["url"]), zips[0] if zips else files[0])
    merged["path"] = legacy["url"]
    merged["sha512"] = legacy["sha512"]
    return merged


def verify_dir(directory):
    problems = []
    ymls = sorted(directory.glob("latest*.yml"))
    if not ymls:
        problems.append(f"no latest*.yml in {directory}")
    for yml in ymls:
        data = load(yml)
        for entry in data["files"]:
            f = directory / entry["url"]
            if not f.is_file():
                problems.append(f"{yml.name}: {entry['url']} is not among the release files")
            elif f.stat().st_size != entry["size"]:
                problems.append(f"{yml.name}: {entry['url']} has size {f.stat().st_size}, not {entry['size']}")
            elif sha512_b64(f) != entry["sha512"]:
                problems.append(f"{yml.name}: sha512 of {entry['url']} differs")
            if "blockMapSize" in entry and not (directory / (entry["url"] + ".blockmap")).is_file():
                problems.append(f"{yml.name}: {entry['url']} has blockMapSize but no blockmap file")
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["refresh", "merge-mac", "verify"])
    ap.add_argument("directory", type=Path)
    args = ap.parse_args(argv)
    d = args.directory
    if args.command == "refresh":
        ymls = sorted(d.glob("latest*.yml"))
        if not ymls:
            raise SystemExit(f"no latest*.yml in {d}: electron-builder wrote no update file")
        for yml in ymls:
            refresh_file(yml, d)
            print(f"refreshed {yml.name}")
    elif args.command == "merge-mac":
        sources = sorted(d.glob("latest-mac-*.yml"))
        if len(sources) != 2:
            raise SystemExit(f"expected latest-mac-arm64.yml and latest-mac-x64.yml in {d}, found "
                             f"{[s.name for s in sources]}")
        merged = merge_mac([load(s) for s in sources])
        dump(merged, d / "latest-mac.yml")
        for s in sources:
            s.unlink()
        print(f"latest-mac.yml lists {', '.join(e['url'] for e in merged['files'])}")
    else:
        problems = verify_dir(d)
        for p in problems:
            print(f"::error::{p}")
        if problems:
            return 1
        print("update files match the release files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
