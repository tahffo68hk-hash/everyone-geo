import time
import urllib.request
import sys

urls = ['http://127.0.0.1:3001/health', 'http://127.0.0.1:18765/api/health']

for url in urls:
    ready = False
    for attempt in range(40):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "GeoLens-HealthCheck"})
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status == 200:
                    print(f"[HEALTH] Ready: {url}")
                    ready = True
                    break
        except Exception:
            time.sleep(1)
    if not ready:
        print(f"[HEALTH-ERROR] Timed out waiting for: {url}")
        sys.exit(1)

print("[HEALTH] All services verified healthy!")
