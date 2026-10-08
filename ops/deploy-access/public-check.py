#!/usr/bin/env python3
"""Non-destructive checks from the external runner, only for the provided VPS."""
import argparse
import json
import socket
import ssl
import sys
import urllib.error
import urllib.request

ORIGIN = "https://judopride.tech"


class PublicCheckFailure(ValueError):
    def __init__(self, code, details=None):
        super().__init__(code)
        self.details = details or {}


class StopRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check(host):
    if host != "187.7.69.230":
        raise ValueError("unexpected_vps")
    addresses = {r[4][0] for r in socket.getaddrinfo("judopride.tech", 443, type=socket.SOCK_STREAM)}
    if addresses != {host}:
        raise PublicCheckFailure("dns_mismatch", {"resolved_addresses": sorted(addresses)})
    opener = urllib.request.build_opener(StopRedirect())
    try:
        with opener.open("http://judopride.tech/", timeout=15):
            raise ValueError("http_redirect_missing")
    except urllib.error.HTTPError as e:
        if e.code not in {301, 302, 307, 308} or e.headers.get("Location") != ORIGIN + "/":
            raise ValueError("http_redirect_mismatch") from None
    for path in ["/", "/healthz", "/readyz", "/openapi.json", "/docs"]:
        with opener.open(ORIGIN + path, timeout=15) as response:
            if response.status != 200:
                raise ValueError("https_check_failed")
            if path in {"/healthz", "/readyz"}:
                expected = "ok" if path == "/healthz" else "ready"
                if json.loads(response.read(4096)).get("status") != expected:
                    raise ValueError("https_body_mismatch")
    ports = {}
    for port in [80, 443, 5432, 8080]:
        try:
            with socket.create_connection((host, port), timeout=5):
                ports[port] = True
        except OSError:
            ports[port] = False
    if not (ports[80] and ports[443] and not ports[5432] and not ports[8080]):
        raise PublicCheckFailure("port_check_failed", {"tcp_connected": ports})
    return {"ok": True, "code": "public_checks_completed", "origin": ORIGIN, "tcp_connected": ports}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", required=True)
    a = p.parse_args()
    try:
        result = check(a.host)
    except (OSError, ValueError) as error:
        # Fixed neutral codes only: no raw URLs, headers, bodies, proxy errors
        # or exception messages, even when a remote response is unexpected.
        known = {"unexpected_vps", "dns_mismatch", "http_redirect_missing", "http_redirect_mismatch",
                 "https_check_failed", "https_body_mismatch", "port_check_failed"}
        code, details = "public_connection_failed", {}
        if isinstance(error, PublicCheckFailure):
            code, details = str(error), error.details
        elif isinstance(error, ValueError):
            code = str(error) if str(error) in known else "invalid_public_response"
        elif isinstance(error, urllib.error.HTTPError):
            code, details = "public_http_error", {"http_status": error.code}
        else:
            reason = error.reason if isinstance(error, urllib.error.URLError) else error
            if isinstance(reason, socket.gaierror):
                code = "dns_lookup_failed"
            elif isinstance(reason, ssl.SSLError):
                code = "public_tls_failed"
            elif isinstance(reason, TimeoutError):
                code = "public_timeout"
        print(json.dumps({"ok": False, "code": code, **details}))
        return 2
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
