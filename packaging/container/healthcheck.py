"""Container health check: does the server answer on its own port?

/api/v1/health answers 200 {"status": "ok"} without login, login on or off. Only a 200 is healthy.
"""
import os
import sys
import urllib.request

url = f"http://127.0.0.1:{os.environ.get('ANNZARRO_SERVER_PORT', '8000')}/api/v1/health"
try:
    with urllib.request.urlopen(url, timeout=4) as reply:
        sys.exit(0 if reply.status == 200 else 1)
except Exception:
    sys.exit(1)
