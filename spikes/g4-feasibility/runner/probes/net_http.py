# G4 spike probe — outbound HTTP attempt (original synthetic).
import urllib.request

for url in ("http://example.com/", "https://example.com/"):
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            body = resp.read(64)
            print(f"CHECK|http_{url}|NOT_DENIED|{body!r}", flush=True)
    except Exception as exc:
        print(f"CHECK|http_{url}|DENIED|{type(exc).__name__}: {exc}", flush=True)
print("PROBE|net_http|done", flush=True)
