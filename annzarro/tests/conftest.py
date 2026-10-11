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


def _allow_create_array_data():
    """zarr 3.0 has no ``data=`` on Group.create_array (3.1 added it); many fixtures here use it."""
    try:
        import zarr
        import numpy as np
        if int(zarr.__version__.split(".")[0]) < 3 or "data" in zarr.Group.create_array.__code__.co_varnames:
            return
    except Exception:
        return
    original = zarr.Group.create_array

    def create_array(self, name, *args, data=None, **kwargs):
        if data is None:
            return original(self, name, *args, **kwargs)
        data = np.asarray(data)
        kwargs.setdefault("shape", data.shape)
        kwargs.setdefault("dtype", data.dtype)
        array = original(self, name, *args, **kwargs)
        if data.ndim:
            array[...] = data
        else:
            array[()] = data
        return array

    zarr.Group.create_array = create_array


_allow_create_array_data()
