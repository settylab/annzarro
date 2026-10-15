#!/usr/bin/env python3
"""Render the Homebrew cask for a release from its SHA256SUMS.txt.

The template is packaging/homebrew/annzarro.rb.template; the rendered file is the
tap's Casks/annzarro.rb (settylab/homebrew-annzarro, see packaging/homebrew/README.md).
.github/workflows/homebrew.yml runs this on every published release.

    python scripts/homebrew_cask.py 0.5.2 SHA256SUMS.txt > Casks/annzarro.rb
    python scripts/homebrew_cask.py 0.5.2 SHA256SUMS.txt -o Casks/annzarro.rb
"""

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TEMPLATE = REPO / "packaging" / "homebrew" / "annzarro.rb.template"
VERSION = re.compile(r"^\d+\.\d+\.\d+$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def checksums(text):
    """File name -> sha256 for the lines of a SHA256SUMS.txt (``<hash>  <name>``)."""
    found = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2:
            found[parts[1].lstrip("*")] = parts[0].lower()
    return found


def render(version, sums_text, template=None):
    """The cask for ``version`` with the macOS dmg checksums from ``sums_text``."""
    if not VERSION.match(version):
        raise ValueError(f"version must look like 0.5.1, got {version!r}")
    sums = checksums(sums_text)
    values = {"@@VERSION@@": version}
    for placeholder, arch in (("@@SHA256_ARM64@@", "arm64"), ("@@SHA256_X64@@", "x64")):
        name = f"AnnZarro-{version}-macos-{arch}.dmg"
        digest = sums.get(name)
        if digest is None:
            raise ValueError(f"{name} is not in SHA256SUMS.txt")
        if not SHA256.match(digest):
            raise ValueError(f"{name}: {digest!r} is not a sha256")
        values[placeholder] = digest
    text = Path(template or TEMPLATE).read_text()
    for placeholder, value in values.items():
        text = text.replace(placeholder, value)
    return text


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("version", help="release number without the v, e.g. 0.5.1")
    parser.add_argument("sums", help="path to the release's SHA256SUMS.txt")
    parser.add_argument("-o", "--output", help="write here instead of stdout")
    args = parser.parse_args(argv)
    try:
        cask = render(args.version, Path(args.sums).read_text())
    except (ValueError, OSError) as err:
        print(f"homebrew_cask: {err}", file=sys.stderr)
        return 1
    if args.output:
        Path(args.output).write_text(cask)
    else:
        sys.stdout.write(cask)
    return 0


if __name__ == "__main__":
    sys.exit(main())
