# Homebrew tap for AnnZarro

```bash
brew install --cask settylab/annzarro/annzarro
```

This installs the notarized AnnZarro desktop app for macOS 13 (Ventura) or later, Apple silicon
or Intel, from the GitHub release of the same version. Upgrade with `brew upgrade --cask annzarro`,
remove with `brew uninstall --cask annzarro` (add `--zap` to also delete the app's settings, logs and
caches; your datasets in `~/annzarro-data` are never touched).

The Python package is a separate install (`pip install annzarro`); see the
[documentation](https://annzarro.readthedocs.io).

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

### One-time setup (needs an organisation owner)

1. Create the public repository `settylab/homebrew-annzarro` (the `homebrew-` prefix is what lets
   `brew tap settylab/annzarro` find it). Initial commit: `Casks/annzarro.rb` and this README as `README.md`.
2. Create a fine-grained personal access token (resource owner `settylab`, repository access
   "Only select repositories": `settylab/homebrew-annzarro`, permission "Contents: Read and write",
   nothing else; set an expiry and note it).
3. Add it to `settylab/annzarro` as the Actions repository secret `HOMEBREW_TAP_TOKEN`.
4. Check: run the workflow "Homebrew cask" by hand with the current version; the tap gets a commit
   only if the cask changed.

Until the secret exists the workflow skips with a notice. After the in-app updater ships, set
`auto_updates true` in the template (one line, marked in the file).

### Official homebrew/cask

Submitting to `homebrew/homebrew-cask` instead of this tap is a later option. `brew audit --cask --new`
currently fails only on notability: the repository needs at least 75 stars, or 30 forks, or 30
watchers. Other requirements: a stable versioned download URL (met), a `livecheck` (met), a
notarized app (met), and no self-updating without `auto_updates true`.
