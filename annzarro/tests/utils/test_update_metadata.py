"""
The desktop app updates itself from the latest*.yml files of its GitHub release
(electron-updater). annzarro/desktop/scripts/update_metadata.py prepares them in
.github/workflows/build.yml; these tests run it on sample files shaped like
electron-builder's, and pin the workflow wiring that cannot run outside a tag build.
"""
import base64
import hashlib
import importlib.util
import json
import os

import pytest
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ELECTRON = os.path.join(ROOT, "annzarro", "desktop", "electron")
WORKFLOW = os.path.join(ROOT, ".github", "workflows", "build.yml")

_spec = importlib.util.spec_from_file_location(
    "update_metadata", os.path.join(ROOT, "annzarro", "desktop", "scripts", "update_metadata.py"))
um = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(um)

V = "0.5.2"


def sha(data):
    return base64.b64encode(hashlib.sha512(data).digest()).decode()


def write_release(directory, names):
    """Files with distinct content; returns {name: bytes}."""
    content = {n: (n * 3).encode() for n in names}
    for n, b in content.items():
        (directory / n).write_bytes(b)
    return content


def mac_yml(arch, content, stale=False):
    zip_, dmg = f"AnnZarro-{V}-macos-{arch}.zip", f"AnnZarro-{V}-macos-{arch}.dmg"
    entries = []
    for name in (zip_, dmg):
        entries.append({"url": name, "sha512": "stale" if stale else sha(content[name]),
                        "size": len(content[name])})
    entries[0]["blockMapSize"] = 1234
    return {"version": V, "files": entries, "path": zip_, "sha512": entries[0]["sha512"],
            "releaseDate": "2026-10-14T10:00:00.000Z"}


def mac_release(tmp_path, stale=False):
    names = [f"AnnZarro-{V}-macos-{a}.{e}" for a in ("arm64", "x64") for e in ("zip", "dmg")]
    content = write_release(tmp_path, names)
    for a in ("arm64", "x64"):
        (tmp_path / f"AnnZarro-{V}-macos-{a}.zip.blockmap").write_bytes(b"bm")
        um.dump(mac_yml(a, content, stale), tmp_path / f"latest-mac-{a}.yml")
    return content


def test_merge_lists_both_macos_architectures(tmp_path):
    mac_release(tmp_path)
    assert um.main(["merge-mac", str(tmp_path)]) == 0
    merged = um.load(tmp_path / "latest-mac.yml")
    urls = [e["url"] for e in merged["files"]]
    assert urls == [f"AnnZarro-{V}-macos-{a}.{e}" for a in ("arm64", "x64") for e in ("zip", "dmg")]
    # The updater picks the arm64 entries on Apple silicon by "arm64" in the name, the rest on Intel.
    assert [u for u in urls if "arm64" in u] == urls[:2]
    # Versioned names only, never a versionless copy.
    assert all(V in u for u in urls)
    assert merged["version"] == V
    assert merged["releaseDate"] == "2026-10-14T10:00:00.000Z"
    assert merged["path"] == f"AnnZarro-{V}-macos-x64.zip"
    assert merged["sha512"] == next(e["sha512"] for e in merged["files"] if e["url"] == merged["path"])
    # the per-architecture files are gone, so the release does not carry them
    assert not list(tmp_path.glob("latest-mac-*.yml"))
    assert um.verify_dir(tmp_path) == []


def test_merge_refuses_mixed_versions_and_a_missing_architecture(tmp_path):
    mac_release(tmp_path)
    other = um.load(tmp_path / "latest-mac-x64.yml")
    other["version"] = "0.5.3"
    um.dump(other, tmp_path / "latest-mac-x64.yml")
    with pytest.raises(SystemExit, match="different versions"):
        um.main(["merge-mac", str(tmp_path)])
    (tmp_path / "latest-mac-x64.yml").unlink()
    with pytest.raises(SystemExit, match="expected"):
        um.main(["merge-mac", str(tmp_path)])


def test_merge_keeps_each_entrys_blockmap_size(tmp_path):
    mac_release(tmp_path)
    um.main(["merge-mac", str(tmp_path)])
    merged = um.load(tmp_path / "latest-mac.yml")
    assert [e.get("blockMapSize") for e in merged["files"]] == [1234, None, 1234, None]


def test_refresh_recomputes_hashes_of_files_changed_after_the_build(tmp_path):
    """The AppImage is repacked and the dmg notarized after electron-builder wrote the yml."""
    name = f"AnnZarro-{V}-linux-x86_64.AppImage"
    old = b"before the repack"
    um.dump({"version": V, "files": [{"url": name, "sha512": sha(old), "size": len(old),
                                      "blockMapSize": 99}],
             "path": name, "sha512": sha(old), "releaseDate": "2026-10-14T10:00:00.000Z"},
            tmp_path / "latest-linux.yml")
    new = b"after the repack, a little smaller"
    (tmp_path / name).write_bytes(new)
    assert um.verify_dir(tmp_path) != []
    um.main(["refresh", str(tmp_path)])
    data = um.load(tmp_path / "latest-linux.yml")
    assert data["files"][0]["sha512"] == sha(new) == data["sha512"]
    assert data["files"][0]["size"] == len(new)
    assert "blockMapSize" not in data["files"][0]  # no blockmap file: a full download
    assert data["releaseDate"] == "2026-10-14T10:00:00.000Z"  # stays a string
    assert um.verify_dir(tmp_path) == []


def test_refresh_fixes_stale_mac_files_and_keeps_present_blockmaps(tmp_path):
    mac_release(tmp_path, stale=True)
    um.main(["refresh", str(tmp_path)])
    assert um.load(tmp_path / "latest-mac-arm64.yml")["files"][0]["blockMapSize"] == 1234
    um.main(["merge-mac", str(tmp_path)])
    assert um.verify_dir(tmp_path) == []


def test_refresh_and_verify_name_a_missing_file(tmp_path):
    mac_release(tmp_path)
    (tmp_path / f"AnnZarro-{V}-macos-x64.dmg").unlink()
    with pytest.raises(SystemExit, match="not in"):
        um.main(["refresh", str(tmp_path)])
    um.main(["merge-mac", str(tmp_path)])
    assert any("macos-x64.dmg is not among" in p for p in um.verify_dir(tmp_path))


def test_verify_catches_a_changed_file_and_an_orphan_blockmap_size(tmp_path):
    mac_release(tmp_path)
    um.main(["merge-mac", str(tmp_path)])
    (tmp_path / f"AnnZarro-{V}-macos-arm64.zip").write_bytes(b"x" * 10)
    (tmp_path / f"AnnZarro-{V}-macos-x64.zip.blockmap").unlink()
    problems = um.verify_dir(tmp_path)
    assert any("macos-arm64.zip has size" in p for p in problems)
    assert any("macos-x64.zip has blockMapSize but no blockmap" in p for p in problems)


def test_versionless_copies_do_not_disturb_the_files(tmp_path):
    """The release job copies the installers to versionless names; the yml names the versioned files."""
    content = mac_release(tmp_path)
    um.main(["merge-mac", str(tmp_path)])
    (tmp_path / "AnnZarro-macos-arm64.dmg").write_bytes(content[f"AnnZarro-{V}-macos-arm64.dmg"])
    assert um.verify_dir(tmp_path) == []
    assert all(V in e["url"] for e in um.load(tmp_path / "latest-mac.yml")["files"])


def test_a_yml_that_is_not_an_update_file_is_refused(tmp_path):
    (tmp_path / "latest.yml").write_text("hello: world\n")
    with pytest.raises(SystemExit, match="not an electron-builder"):
        um.main(["refresh", str(tmp_path)])


def test_builder_publishes_nothing_but_writes_the_update_files():
    with open(os.path.join(ELECTRON, "package.json")) as f:
        pkg = json.load(f)
    assert pkg["build"]["publish"] == [
        {"provider": "github", "owner": "settylab", "repo": "annzarro", "releaseType": "release"}]
    assert "electron-updater" in pkg["dependencies"]
    assert {"updates.js", "update-logic.js"} <= set(pkg["build"]["files"])
    # macOS needs the zip target; Windows and Linux self-update from nsis and AppImage
    assert "zip" in pkg["build"]["mac"]["target"]
    assert "nsis" in pkg["build"]["win"]["target"] and "AppImage" in pkg["build"]["linux"]["target"]
    # Unsigned Windows updates: electron-updater verifies the signature only when a publisher is named
    assert "publisherName" not in pkg["build"]["win"]
    with open(WORKFLOW) as f:
        workflow = f.read()
    # electron-builder never uploads by itself: the draft step does
    assert "--publish never" in workflow
    assert "--publish always" not in workflow and "onTagOrDraft" not in workflow
    with open(os.path.join(ELECTRON, "..", "scripts", "electron_build.js")) as f:
        assert '"--publish", "never"' in f.read()


def test_workflow_ships_the_update_files():
    with open(WORKFLOW) as f:
        text = f.read()
    wf = yaml.safe_load(text)
    build = "\n".join(s.get("run", "") for s in wf["jobs"]["build"]["steps"])
    release = "\n".join(s.get("run", "") for s in wf["jobs"]["release"]["steps"])
    # each job copies the yml files out of dist, refreshes their hashes after the last change to the
    # release files, and names the macOS ones per architecture so the artifacts do not overwrite each other
    assert "cp annzarro/desktop/electron/dist/latest*.yml out/" in build
    assert "update_metadata.py refresh out" in build
    assert "latest-mac-" in build
    steps = [s.get("name", "") for s in wf["jobs"]["build"]["steps"]]
    assert steps.index("Remove GPL/LGPL libraries from the AppImage") < steps.index("Collect release files")
    assert steps.index("Notarize the dmg and check the macOS signature") < steps.index("Collect release files")
    # the release job merges, verifies before creating the draft, and publishes the yml files
    assert release.index("merge-mac assets") < release.index("verify assets") < release.index("gh release create")
    assert "latest.yml latest-mac.yml latest-linux.yml" in release
    assert "assets/*" in release
    # The signing steps are untouched
    for secret in ("MAC_CSC_LINK", "MAC_CSC_KEY_PASSWORD", "APPLE_API_KEY_P8", "WIN_CSC_LINK"):
        assert secret in text


def test_refresh_accepts_a_blockmap_the_yml_does_not_size(tmp_path):
    """electron-builder writes the macOS zip's blockmap file but no blockMapSize for it."""
    name = f"AnnZarro-{V}-macos-arm64.zip"
    (tmp_path / name).write_bytes(b"zip")
    (tmp_path / (name + ".blockmap")).write_bytes(b"bm")
    um.dump({"version": V, "files": [{"url": name, "sha512": "old", "size": 1}], "path": name,
             "sha512": "old", "releaseDate": "2026-10-14T10:00:00.000Z"}, tmp_path / "latest-mac-arm64.yml")
    um.main(["refresh", str(tmp_path)])
    assert "blockMapSize" not in um.load(tmp_path / "latest-mac-arm64.yml")["files"][0]
    assert um.verify_dir(tmp_path) == []
