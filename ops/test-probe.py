#!/usr/bin/env python3
"""Probe HTTPS health/readiness, elapsed time, disk and optional backup age."""
import argparse
import json
from pathlib import Path
import shutil
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def probe(url, ca=None, expected_ready=200):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('Use an HTTPS origin without credentials/query/fragment')
    context = ssl.create_default_context(cafile=str(ca) if ca else None)
    # Loopback is this host, never an outbound destination for the cloud proxy.
    # All external origins retain the inherited proxy configuration.
    handlers = [urllib.request.HTTPSHandler(context=context), NoRedirect()]
    if parsed.hostname in ('localhost', '127.0.0.1', '::1'):
        handlers.append(urllib.request.ProxyHandler({}))
    opener = urllib.request.build_opener(*handlers)
    results = []
    for path, expected in [('/healthz', 200), ('/readyz', expected_ready), ('/', 200), ('/openapi.json', 200)]:
        start = time.monotonic()
        try:
            with opener.open(url.rstrip('/') + path, timeout=10) as response:
                status = response.status
                body = response.read(2_000_000)
                if path in ('/healthz', '/readyz'):
                    expected_body = 'ok' if path == '/healthz' else 'ready'
                    if json.loads(body).get('status') != expected_body:
                        status = 0
        except urllib.error.HTTPError as e:
            status = e.code
        except (OSError, ValueError):
            status = 0
        results.append({'path': path, 'status': status, 'expected_status': expected,
                        'elapsed_ms': round((time.monotonic() - start) * 1000, 2)})
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url', required=True)
    p.add_argument('--ca', type=Path)
    p.add_argument('--disk-path', type=Path, default=Path('/'))
    p.add_argument('--min-free-bytes', type=int, default=0, help='Operator chooses alert threshold')
    p.add_argument('--backup', type=Path)
    p.add_argument('--max-backup-age-seconds', type=int, help='Operator chooses freshness threshold; not RPO')
    a = p.parse_args()
    if bool(a.backup) != (a.max_backup_age_seconds is not None) or (a.max_backup_age_seconds is not None and a.max_backup_age_seconds < 0) or a.min_free_bytes < 0:
        p.error('Specify backup and nonnegative freshness threshold together; disk threshold must be nonnegative')
    try:
        results = probe(a.url, a.ca)
        disk = shutil.disk_usage(a.disk_path)
    except (OSError, ValueError):
        p.error('Invalid HTTPS origin, CA bundle or disk path')
    report = {'http': results, 'disk_free_bytes': disk.free, 'disk_total_bytes': disk.total}
    ok = all(x['status'] == x['expected_status'] for x in results) and disk.free >= a.min_free_bytes
    if a.backup:
        age = time.time() - a.backup.stat().st_mtime if a.backup.is_file() else None
        report['backup_age_seconds'] = round(age, 2) if age is not None else None
        ok = ok and age is not None and 0 <= age <= a.max_backup_age_seconds
    print(json.dumps(report))
    raise SystemExit(0 if ok else 1)

if __name__ == '__main__':
    main()
