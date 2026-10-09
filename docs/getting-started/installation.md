# Installation

AnnZarro is a Python package with a browser interface. The package contains the server, the
command-line tool `annzarro` and the complete web interface (all JavaScript, CSS and fonts are
bundled, so the browser fetches nothing from other hosts). If you only want to look at data on
your own computer and do not want to install Python, use the {doc}`desktop-app` instead.

**Requirements**

- Python 3.9 or later. The package has been installed and its server started on Python 3.9,
  3.10, 3.11, 3.12, 3.13 and 3.14 (macOS, arm64). Python 3.8 and older cannot import it.
  Apple's Xcode Python 3.9 (`/usr/bin/python3` on macOS) works, but its `hashlib` has no scrypt,
  so login passwords created there are stored as `pbkdf2:sha256`; a users file made with another
  Python may need `annzarro user passwd` ({doc}`../deployment/authentication`).
- A current browser (Chrome, Firefox, Safari or Edge).
- For the server: read access to the zarr stores you want to view. Memory depends on the chunks
  being read, not on dataset size; see {doc}`../reference/performance`.

Install AnnZarro on the machine that holds the data. For a cluster, that is the cluster, not
your laptop ({doc}`../deployment/personal-server`).

## With pip

```bash
python -m venv annzarro-env
source annzarro-env/bin/activate        # Windows: annzarro-env\Scripts\activate
pip install annzarro
```

To open zarr stores directly from S3, Google Cloud Storage or HTTP(S), install the `remote`
extra, which adds `fsspec`, `s3fs`, `gcsfs` and `aiohttp`:

```bash
pip install 'annzarro[remote]'
```

Without it, opening an `s3://`, `gs://` or `https://` dataset fails with a message naming this
extra. See {doc}`../user-guide/remote-datasets`.

```{note}
`pip install annzarro` is the published path. If PyPI does not have a release yet when you read
this, install from a source checkout as described below.
```

```{note}
h5py 3.16 ships Linux wheels only for glibc 2.28 and newer. On an older system (Ubuntu 18.04 has
glibc 2.27, for example) pip would try to build h5py from source; install an older h5py first:
`pip install "h5py<3.16" annzarro`.
```

## With uv

[uv](https://docs.astral.sh/uv/) installs the same package faster. Either into a virtual
environment:

```bash
uv venv annzarro-env
source annzarro-env/bin/activate
uv pip install annzarro            # or 'annzarro[remote]'
```

or as a stand-alone command-line tool in its own isolated environment, which puts `annzarro`
on your `PATH`:

```bash
uv tool install annzarro
```

## From source

```bash
git clone https://github.com/settylab/annzarro.git
cd annzarro
pip install .                     # or: pip install -e .  for development
```

A build from a git checkout first downloads the pinned third-party browser libraries listed in
`scripts/vendor-assets.json` and checks each file's SHA-256, so it needs network access once. An
editable install (`-e`) that cannot download them still installs, with a warning, and the
interface is incomplete until `python scripts/vendor_assets.py` succeeds. A wheel or sdist
already contains these files.

The repository also has a wrapper script, `./annzarro-cli`, that creates a virtual environment
in `./venv` and runs `annzarro` inside it (`./annzarro-cli install`, then
`./annzarro-cli start`). It is a convenience for working in the checkout; the `pip` route above
gives you the same command. Its installer, `annzarro-install.py` (also runnable directly with
`python annzarro-install.py`), takes options the `annzarro` command of a pip install does not:

| Option | Meaning |
|---|---|
| `--no-venv` | Install into the current interpreter instead of `./venv`. |
| `--clean` | Remove an existing `./venv` first (the wrapper adds this unless `--no-venv` is given). |
| `--no-extras` | Skip the optional dependencies, including the remote-store readers. |
| `--upgrade` | Upgrade packages that are already installed. |

### Running the tests

The test suite covers Python, every JavaScript suite (`annzarro/tests/js/*.test.mjs`) and ESLint,
so it needs Node.js 22 or later in addition to Python:

```bash
pip install -e .
npm ci              # once: installs the pinned ESLint from package-lock.json
python -m pytest    # Python, JS and lint; CI runs exactly this
npm run lint        # or the JS side alone
npm test
```

Without `node` or `npm ci`, the JS and lint tests fail rather than being skipped.
`annzarro start --development` runs the server in development mode
({doc}`../reference/configuration`).

## Check the installation

```bash
annzarro --help
```

lists the subcommands `start`, `stop`, `user`, `install`, `config` and `desktop`. Then show the
configuration the server would start with:

```bash
annzarro config show
```

The first lines name the files that were read (the built-in `base.yaml` and `production.yaml`
inside the package, then `/etc/annzarro/config.yaml`, `~/.config/annzarro/config.yaml` and
`./config.yaml` if they exist). Every option is described in {doc}`../reference/configuration`.

## Where AnnZarro writes

AnnZarro never writes to datasets. It writes only:

| What | Where |
|---|---|
| Server log | `~/.annzarro/logs/annzarro_server.log` |
| PID file of `annzarro start --detach` | `~/.annzarro/server.pid` |
| Users file and login key (only when login is enabled) | `~/.annzarro/auth/users.json`, `~/.annzarro/auth/annzarro_secret_key` |
| Saved panel sets | `<data directory>/sessions/` (by default `~/annzarro-data/sessions/`) |

Set `ANNZARRO_HOME` to move `~/.annzarro` elsewhere, for example to a project directory on a
cluster where the home directory is small.

Next: {doc}`quickstart`.
