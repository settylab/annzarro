"""Suite-wide fixtures."""
import pytest


@pytest.fixture(autouse=True, scope="session")
def _private_state_dir(tmp_path_factory):
    """Keep logs, PID files and generated secrets out of the real ~/.annzarro.

    Any test that builds an app writes its log to the state directory
    (``annzarro.utils.paths.user_state_dir``); point it at a throwaway one.
    """
    mp = pytest.MonkeyPatch()
    mp.setenv("ANNZARRO_HOME", str(tmp_path_factory.mktemp("annzarro_home")))
    yield
    mp.undo()
