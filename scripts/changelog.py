#!/usr/bin/env python3
"""Read and release sections of CHANGELOG.md.

Every pull request that changes what a user sees adds its line under
``## Unreleased``. ``bump_version.py`` turns that section into the release's
(``## 0.5.1 (2026-10-20)``) and opens a new, empty Unreleased section above
it; the tag's build drafts the GitHub release from the same section.

    python scripts/changelog.py notes 0.5.1     # print the section's body
    python scripts/changelog.py release 0.5.1   # Unreleased -> 0.5.1 (today)
"""

import datetime
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
UNRELEASED = "## Unreleased"
HEADING = re.compile(r"^## (?P<name>Unreleased|\d+\.\d+\.\d+)(?: \((?P<date>\d{4}-\d{2}-\d{2})\))?$")


def sections(text):
    """The level-2 sections in order: (name, date, body) with the body stripped."""
    found, name, date, lines = [], None, None, []
    for line in text.splitlines():
        match = HEADING.match(line)
        if match or line.startswith("## "):
            if not match:
                raise ValueError(f"CHANGELOG.md: heading {line!r} is neither '## Unreleased' nor '## X.Y.Z (YYYY-MM-DD)'")
            if name is not None:
                found.append((name, date, "\n".join(lines).strip()))
            name, date, lines = match["name"], match["date"], []
        elif name is not None:
            lines.append(line)
    if name is not None:
        found.append((name, date, "\n".join(lines).strip()))
    return found


def unwrap(body):
    """Join the lines of each wrapped paragraph and list item.

    GitHub renders every newline of a release body as a line break, so the
    100-column wrapping of CHANGELOG.md would show as ragged lines there.
    """
    out = []
    for line in body.splitlines():
        joins = out and out[-1] and not out[-1].startswith("#") and line.strip() \
            and not line.startswith(("#", "- ", "* ", "|"))
        if joins:
            out[-1] = f"{out[-1]} {line.strip()}"
        else:
            out.append(line)
    return "\n".join(out)


def notes(version, root=REPO):
    """The body of the section for ``version``, unwrapped for a GitHub release."""
    for name, _, body in sections((Path(root) / "CHANGELOG.md").read_text()):
        if name == version:
            if not body:
                raise ValueError(f"CHANGELOG.md: the {version} section is empty")
            return unwrap(body)
    raise ValueError(f"CHANGELOG.md has no section for {version}")


def release(version, root=REPO, date=None):
    """Turn the Unreleased section into ``version``'s, under a new empty Unreleased.

    Releasing the version that is already the newest is a no-op, so the bump
    can be rerun.
    """
    path = Path(root) / "CHANGELOG.md"
    text = path.read_text()
    found = sections(text)
    names = [name for name, _, _ in found]
    if version in names:
        if names[:2] in (["Unreleased", version], [version]):
            return False
        raise ValueError(f"CHANGELOG.md already has a section for {version}, below newer ones")
    if not found or found[0][0] != "Unreleased":
        raise ValueError("CHANGELOG.md: the first section must be '## Unreleased'")
    if not found[0][2]:
        raise ValueError("CHANGELOG.md: the Unreleased section is empty; say what this release changes for users")
    date = date or datetime.date.today().isoformat()
    heading = f"## {version} ({date})"
    path.write_text(text.replace(UNRELEASED, f"{UNRELEASED}\n\n{heading}", 1))
    return True


def main(argv):
    if len(argv) != 3 or argv[1] not in ("notes", "release"):
        print(__doc__)
        return 1
    try:
        if argv[1] == "notes":
            print(notes(argv[2]))
        elif release(argv[2]):
            print(f"CHANGELOG.md: Unreleased is now {argv[2]}")
    except ValueError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
