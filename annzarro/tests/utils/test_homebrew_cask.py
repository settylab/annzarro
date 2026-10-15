"""The Homebrew cask is rendered from a template and a release's SHA256SUMS.txt.

packaging/homebrew/Casks/annzarro.rb is the 0.5.1 rendering, kept in the repository
as the content of the tap settylab/homebrew-annzarro. .github/workflows/homebrew.yml
renders the same template for each published release.
"""
import importlib.util
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
CASK = REPO / "packaging" / "homebrew" / "Casks" / "annzarro.rb"

# The macOS lines of the v0.5.1 release's SHA256SUMS.txt (two spaces, as sha256sum writes them).
SUMS_051 = """\
7eda86cdbd177584313209cd04ee00a4d4a82f1b4e548d1d2adcd8879e7be30a  AnnZarro-0.5.1-linux-amd64.deb
e4bfa0e94c8990b859984c0fd7103a8ccc809c7f7bfbb805074a022b2cc18291  AnnZarro-0.5.1-macos-arm64.dmg
22a143d128493a63740e8d3cbe9bc55b809e2a62648a5e85cb83e9e66a5a23c0  AnnZarro-0.5.1-macos-arm64.zip
91bfcb9a6c5c62fb5ebf035bf72a5f30229c94647c4667203fc260a22f4d41aa  AnnZarro-0.5.1-macos-x64.dmg
4fd07d6b7b600c7b7a5425f2a7550d5f7daae91d3b79162671ba0a33099c70cf  AnnZarro-0.5.1-macos-x64.zip
e4bfa0e94c8990b859984c0fd7103a8ccc809c7f7bfbb805074a022b2cc18291  AnnZarro-macos-arm64.dmg
"""


def _script():
    spec = importlib.util.spec_from_file_location("homebrew_cask", REPO / "scripts" / "homebrew_cask.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_rendering_0_5_1_gives_the_committed_cask():
    assert _script().render("0.5.1", SUMS_051) == CASK.read_text()


def test_each_architecture_gets_its_own_dmg_checksum():
    cask = _script().render("0.5.1", SUMS_051)
    assert 'arm:   "e4bfa0e9' in cask and 'intel: "91bfcb9a' in cask
    assert "@@" not in cask


def test_a_missing_dmg_or_bad_version_is_refused():
    brew = _script()
    with pytest.raises(ValueError, match="macos-x64.dmg"):
        brew.render("0.5.1", "\n".join(SUMS_051.splitlines()[:3]))
    with pytest.raises(ValueError, match="version"):
        brew.render("v0.5.1", SUMS_051)
    with pytest.raises(ValueError, match="macos-arm64.dmg"):
        brew.render("0.5.2", SUMS_051)


def test_the_cask_declares_the_things_a_user_relies_on():
    text = CASK.read_text()
    assert 'app "AnnZarro.app"' in text
    assert "strategy :github_latest" in text
    assert "verified:" not in text  # deprecated; the url host matches the homepage
    assert "~/annzarro-data" in text.split("zap trash")[0]  # the datasets are documented as kept
    assert "annzarro-data\"" not in text.split("zap trash")[1]
