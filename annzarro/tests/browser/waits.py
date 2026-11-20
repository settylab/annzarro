"""Waiting in browser tests (0.8.0 rule): wait on a condition, never on the clock.

Use ``expect(...)``, ``page.wait_for_function``, ``page.expect_response`` or a ``[data-state]`` attribute to wait for
something to happen. The one place a clock is right is before a NEGATIVE assertion, where nothing is there to wait
for: "the request never goes out", "the panel does not change". ``expect_stays`` is that place, and it takes the
reason, so a reader sees why the test cannot wait on a condition. A new browser test file that calls
``page.wait_for_timeout`` or ``time.sleep`` itself fails ``tests/static/test_no_fixed_waits.py``.
"""
import time

MIN_REASON = 12


def expect_stays(check, reason, *, page=None, seconds=0.5, interval=0.05):
    """Assert that ``check()`` holds now, at every ``interval`` seconds and at the end of ``seconds``.

    ``check`` returns a truthy value or raises ``AssertionError`` (a Playwright ``expect(...)`` with a short
    timeout does). ``reason`` says why this assertion is negative and cannot wait for an event. With ``page``
    the pause is ``page.wait_for_timeout`` (route handlers and events run only while Playwright waits); without
    it, ``time.sleep``. Returns the number of times ``check`` ran.
    """
    if not isinstance(reason, str) or len(reason.strip()) < MIN_REASON:
        raise ValueError("expect_stays needs a reason of at least a few words: why can the test not wait on a condition?")
    if seconds <= 0 or interval <= 0:
        raise ValueError("seconds and interval must be positive")
    deadline = time.monotonic() + seconds
    runs = 0
    while True:
        result = check()
        runs += 1
        if result is not None and not result:
            raise AssertionError(f"expected to stay true for {seconds}s ({reason}); failed at run {runs}")
        left = deadline - time.monotonic()
        if left <= 0:
            return runs
        pause = min(interval, left)
        if page is not None:
            page.wait_for_timeout(pause * 1000)
        else:
            time.sleep(pause)
