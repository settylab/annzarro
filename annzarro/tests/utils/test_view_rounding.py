"""The test helper that states how a kept view is rounded agrees with the app's rule
(static/js/utils/view-rounding.js, annzarro/tests/js/view-rounding.test.mjs: the same cases)."""
from annzarro.tests.browser.view_rounding import round_camera, round_range


def test_ranges():
    assert round_range([-1.5534503, 0.8878132]) == [-1.553, 0.888]
    assert round_range([0.8878132, -1.5534503]) == [0.888, -1.553]
    assert round_range([1000.123456, 1000.223456]) == [1000.1235, 1000.2235]
    once = round_range([-1.5534503, 0.8878132])
    assert round_range(once) == once


def test_cameras():
    zero = {"x": 0, "y": 0, "z": 0}
    far = round_camera({"eye": {"x": 7.653378975652401, "y": 1.00004, "z": -0.24748}, "center": zero, "up": {"x": 0, "y": 0, "z": 1}})
    assert far["eye"] == {"x": 7.653, "y": 1.0, "z": -0.247}
    near = round_camera({"eye": {"x": 0.123456, "y": 0.05, "z": 0.0123456}, "center": zero, "up": {"x": 0, "y": 0, "z": 1.00004}})
    assert near["eye"] == {"x": 0.1235, "y": 0.05, "z": 0.0123}
    assert near["up"] == {"x": 0, "y": 0, "z": 1}
    assert round_camera(far) == far
