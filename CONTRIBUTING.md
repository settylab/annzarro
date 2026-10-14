# Contributing to AnnZarro

Bug reports, questions and pull requests are welcome at
[github.com/settylab/annzarro](https://github.com/settylab/annzarro/issues). Please read the
[code of conduct](CODE_OF_CONDUCT.md) first.

## Report a problem

Open an issue with the AnnZarro version (`python -c "import annzarro; print(annzarro.__version__)"`), how you started it
(`annzarro start`, gunicorn, the desktop app), what you did and what you expected. For a slow or
refused dataset, attach the output of `annzarro store check <store>`; for a server problem,
the relevant lines of the log.

## Set up

```bash
git clone https://github.com/settylab/annzarro && cd annzarro
pip install -e ".[test]"        # add ,remote for s3://, gs:// and http(s):// stores
npm ci                          # once; Node.js 22 or later, for the JS tests and ESLint
python -m pytest                # Python, every JS suite and ESLint; CI runs exactly this
```

The browser tests need Playwright (`pip install playwright && python -m playwright install
chromium`) and, for the multi-worker ones, `gunicorn`; without them they are skipped locally and
fail in CI. More ways to run the tests, including on zarr format 3, are in the
[installation guide](docs/getting-started/installation.md#running-the-tests).

## Make a change

- Branch from `main` and open a pull request against it.
- Write the test first when you fix a bug: it should fail on `main` and pass on your branch. A
  test that pins old behaviour you change on purpose is updated in the same commit, with the
  reason in the message. Do not loosen a test to make it pass.
- Keep the code in the style of the file you change. Python docstrings are Google style
  (`Args:`, `Returns:`, `Raises:`). The public Python API is `annzarro.__all__`; a name you add
  there needs an entry in `docs/reference/python-api.md` (a test checks it).
- Document what a user can see. Docs are Markdown in `docs/`; build them with
  `pip install -r docs/requirements.txt && sphinx-build -W -b html docs docs/_build/html`. The
  build fails on a warning. A page that is not in a table of contents needs `orphan: true`.
- A change to an HTTP route, a configuration key or a limit changes `docs/reference/http-api.md`
  or `docs/reference/configuration.md` too, and the tests that hold them to the code.
- A change a user can notice (a feature, a fix, a new limit or default, anything they must
  change when they upgrade) adds a line under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md),
  in the section it belongs to (Added, Changed, Fixes, Upgrade notes, ...). Say what the user
  sees, not what the code does, and give a measured number where there is one. Tests, CI and
  refactors need no line.
- Commit messages are one sentence in the imperative that says what the change does; the body says why.

## Review

A pull request is merged when the tests and ESLint pass in CI and a maintainer has read it. Large
changes are easier to review when you open an issue or a draft pull request first.

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
