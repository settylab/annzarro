"""Shared fixtures for the deep-link smoke tests.

These tests exercise the DoLiMap -> AnnZarro deep-link path in-process via Flask's
test client (no live server / no bound port needed), against the tiny committed
``fixture_small.zarr`` so they run anywhere ``pytest`` runs -- no real dataset and
no ``anndata`` required at test time. Regenerate the fixture with
``annzarro/tests/utils/make_fixture_zarr.py`` (needs an env with anndata).
"""
import os

import pytest

# Repo root = .../annzarro (package) -> parent of the package dir.
_THIS = os.path.abspath(__file__)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(_THIS))))
TEST_DATA_DIR = os.path.join(REPO_ROOT, "annzarro", "tests", "data")
FIXTURE_PATH = os.path.join(TEST_DATA_DIR, "fixture_small.zarr")


@pytest.fixture(scope="session")
def fixture_path():
    """Absolute path to the committed toy zarr dataset."""
    if not os.path.isdir(FIXTURE_PATH):
        pytest.skip(
            f"fixture missing: {FIXTURE_PATH} -- regenerate via "
            "annzarro/tests/utils/make_fixture_zarr.py"
        )
    return FIXTURE_PATH


@pytest.fixture(scope="session")
def app():
    """A Flask app wired to the test data dir, auth disabled."""
    from annzarro.server.core import create_app

    return create_app(
        {
            "TESTING": True,
            "DEBUG": False,
            "auth_enabled": False,
            "data_dir": TEST_DATA_DIR,
        }
    )


@pytest.fixture()
def client(app):
    return app.test_client()
