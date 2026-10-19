"""`annzarro start` serves with server.threads request threads when it is set, else WAITRESS_THREADS."""
from unittest.mock import patch

import pytest

from annzarro.server import server


@pytest.mark.parametrize("configured, expected", [(None, server.WAITRESS_THREADS), (0, server.WAITRESS_THREADS),
                                                  (8, 8), ("64", 64)])
def test_threads_follow_the_configuration(configured, expected):
    with patch("waitress.serve") as serve:
        server._serve_with_waitress(object(), "127.0.0.1", 0, threads=configured)
    assert serve.call_args.kwargs["threads"] == expected
