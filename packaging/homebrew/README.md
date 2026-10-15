# Homebrew tap for AnnZarro

```bash
brew install --cask settylab/annzarro/annzarro
```

This installs the notarized AnnZarro desktop app for macOS 13 (Ventura) or later, Apple silicon
or Intel, from the GitHub release of the same version. The app updates itself; `brew upgrade --cask --greedy annzarro` also upgrades it. Remove
with `brew uninstall --cask annzarro` (add `--zap` to also delete the app's settings, logs and
caches; your datasets in `~/annzarro-data` are never touched).

The Python package is a separate install (`pip install annzarro`); see the
[documentation](https://annzarro.readthedocs.io).

The cask is updated automatically when a release of
[settylab/annzarro](https://github.com/settylab/annzarro) is published; its template lives there in
`packaging/homebrew/`. Please report problems in that repository.

## Maintainers

This directory is the content of the tap repository `settylab/homebrew-annzarro`. It lives in
`settylab/annzarro` under `packaging/homebrew/`:

| File | Purpose |
|---|---|
| `annzarro.rb.template` | the cask with `@@VERSION@@`, `@@SHA256_ARM64@@`, `@@SHA256_X64@@` placeholders |
| `Casks/annzarro.rb` | the template rendered for 0.5.1; the tap's first commit (a test keeps it equal to the rendering) |
| `README.md` | this file; copy it to the tap's `README.md` |

`scripts/homebrew_cask.py` renders the template from a release's `SHA256SUMS.txt`, and
`.github/workflows/homebrew.yml` does that on every published release and pushes the result to the tap.

### The tap

The tap `settylab/homebrew-annzarro` exists and holds `Casks/annzarro.rb` plus the user part of this
README (everything above "Maintainers"). The repository secret `HOMEBREW_TAP_TOKEN` in
`settylab/annzarro` is a fine-grained token with "Contents: Read and write" on that one repository;
it expires, so renew it before then (the workflow skips with a notice while the secret is missing or
the push fails). To re-render by hand, run the workflow "Homebrew cask" with a published version;
the tap gets a commit only if the cask changed.

`auto_updates` is `true`: the app updates itself, so `brew upgrade` leaves it to the app (use
`brew upgrade --cask --greedy annzarro` to force it).

### Official homebrew/cask

Submitting to `homebrew/homebrew-cask` instead of this tap is a later option. `brew audit --cask --new`
currently fails only on notability: the repository needs at least 75 stars, or 30 forks, or 30
watchers. Other requirements: a stable versioned download URL (met), a `livecheck` (met), a
notarized app (met), and no self-updating without `auto_updates true`.
