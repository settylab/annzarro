"""Container health check: does the server answer on its own port?

/api/v1/status answers 200 without login only when login is off; with login on an anonymous
client gets 401, which still proves gunicorn and the app are up. Anything below 500 is healthy.
"""
import os
import sys
import urllib.error
import urllib.request

url = f"http://127.0.0.1:{os.environ.get('ANNZARRO_SERVER_PORT', '8000')}/api/v1/status"
try:
    urllib.request.urlopen(url, timeout=4)
except urllib.error.HTTPError as e:
    sys.exit(0 if e.code < 500 else 1)
except Exception:
    sys.exit(1)
