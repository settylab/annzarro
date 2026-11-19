"""No tracked text file holds a merge conflict marker.

A merge once left a literal `|||||||` line in CHANGELOG.md on a feature branch and every test passed.
Checked over `git ls-files` (ignored files are skipped); binaries are left out.

A marker is a line that begins with the seven-character marker and a space (`<<<<<<<`, `|||||||`,
`>>>>>>>` followed by a space), or a line that is exactly seven equals signs, unless that line is a
heading underline: the line above is text no longer than seven characters (RST needs an underline at
least as long as its title) and the line below is blank.
"""
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
# built from pieces, so this file does not hold a marker itself
OPENERS = tuple(c * 7 + " " for c in "<|>")
SEPARATOR = "=" * 7


def markers(text):
    """The 1-based numbers of the lines of `text` that are conflict markers."""
    lines = text.split("\n")
    found = []
    for i, line in enumerate(lines):
        if line.startswith(OPENERS):
            found.append(i + 1)
        elif line.rstrip("\r") == SEPARATOR:
            above = lines[i - 1].strip() if i else ""
            below = lines[i + 1].strip() if i + 1 < len(lines) else ""
            underline = bool(above) and len(above) <= len(SEPARATOR) and not below
            if not underline:
                found.append(i + 1)
    return found


def _tracked_text_files():
    out = subprocess.run(["git", "ls-files", "-z"], cwd=REPO, capture_output=True, check=True).stdout
    for name in filter(None, out.split(b"\0")):
        path = REPO / name.decode()
        if not path.is_file():
            continue
        data = path.read_bytes()
        if b"\0" in data[:8192]:
            continue                      # binary
        try:
            yield path, data.decode("utf-8")
        except UnicodeDecodeError:
            continue


def test_the_detector_finds_markers_and_spares_headings():
    ours, theirs = "<" * 7 + " HEAD", ">" * 7 + " branch"
    base = "|" * 7 + " abc1234"
    assert markers("\n".join(["a", ours, "b", base, "c", SEPARATOR, "d", theirs, ""])) == [2, 4, 6, 8]
    assert markers("Title\n" + SEPARATOR + "\n\ntext\n") == []                 # a heading underline
    assert markers("Changes\n" + SEPARATOR + "\n") == []                       # at the end of the file
    assert markers("a conflict\n" + SEPARATOR + "\nnext line\n") == [2]        # content below: a separator
    assert markers("Longer than seven\n" + SEPARATOR + "\n\n") == [2]
    assert markers("x " + ours + "\n" + "<" * 8 + "\n") == []                  # not at the start of a line


def test_no_tracked_text_file_has_a_conflict_marker():
    bad = []
    for path, text in _tracked_text_files():
        bad += [f"{path.relative_to(REPO)}:{n}" for n in markers(text)]
    assert not bad, "conflict markers left in: " + ", ".join(bad)
