"""Entry point of the frozen ``annzarro-server`` the desktop app ships.

It is the ``annzarro`` command; the app runs ``annzarro-server start``.
"""
import multiprocessing
import sys

if __name__ == "__main__":
    multiprocessing.freeze_support()
    from annzarro.cli import main
    sys.exit(main())
