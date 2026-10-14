"""CHANGELOG.md keeps a section the release can be drafted from.

The tag's build drafts the GitHub release from the version's section, and
bump_version.py turns Unreleased into it. A malformed heading or a missing
section stops the release, so they are caught here first.
"""
import importlib.util
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


def _script():
    spec = importlib.util.spec_from_file_location("changelog", REPO / "scripts" / "changelog.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_changelog_opens_with_unreleased_and_has_the_current_version():
    changelog = _script()
    found = changelog.sections((REPO / "CHANGELOG.md").read_text())
    names = [name for name, _, _ in found]
    assert names[0] == "Unreleased"
    import annzarro
    assert changelog.notes(annzarro.__version__, REPO)
    assert all(date for name, date, _ in found[1:]), "every released section has a date"


def test_release_moves_unreleased_under_the_version(tmp_path):
    changelog = _script()
    (tmp_path / "CHANGELOG.md").write_text(
        "# Changelog\n\nIntro.\n\n## Unreleased\n\n### Fixes\n- A fix.\n\n## 1.0.0 (2026-01-01)\n\n- Old.\n")
    assert changelog.release("1.0.1", tmp_path, date="2026-02-02")
    text = (tmp_path / "CHANGELOG.md").read_text()
    assert [(n, d) for n, d, _ in changelog.sections(text)] == \
        [("Unreleased", None), ("1.0.1", "2026-02-02"), ("1.0.0", "2026-01-01")]
    assert changelog.notes("1.0.1", tmp_path) == "### Fixes\n- A fix."
    assert not changelog.release("1.0.1", tmp_path)          # a rerun changes nothing
    assert (tmp_path / "CHANGELOG.md").read_text() == text


def test_release_refuses_an_empty_unreleased_section(tmp_path):
    changelog = _script()
    (tmp_path / "CHANGELOG.md").write_text("# Changelog\n\n## Unreleased\n\n## 1.0.0 (2026-01-01)\n\n- Old.\n")
    with pytest.raises(ValueError, match="empty"):
        changelog.release("1.0.1", tmp_path)


def test_a_malformed_heading_is_refused():
    with pytest.raises(ValueError, match="heading"):
        _script().sections("## Unreleased\n\n- x\n\n## v1.0.0\n")


def test_notes_unwrap_paragraphs_and_list_items():
    body = "Intro line one\nline two.\n\n### Fixes\n- A fix that\n  wraps.\n- Another."
    assert _script().unwrap(body) == "Intro line one line two.\n\n### Fixes\n- A fix that wraps.\n- Another."
