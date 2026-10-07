#!/usr/bin/env python3
"""Non-destructive checks from the external runner, only for the provided VPS."""
import argparse
import json
import socket
import urllib.error
import urllib.request

ORIGIN = "https://judopride.tech"


class StopRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check(host):
    if host != "187.7.69.230":
        raise ValueError("unexpected_vps")
    addresses = {r[4][0] for r in socket.getaddrinfo("judopride.tech", 443, type=socket.SOCK_STREAM)}
    if addresses != {host}:
        raise ValueError("dns_mismatch")
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
        raise ValueError("port_check_failed")
    return {"ok": True, "code": "public_checks_completed", "origin": ORIGIN, "tcp_connected": ports}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", required=True)
    a = p.parse_args()
    try:
        result = check(a.host)
    except (OSError, ValueError):
        p.exit(2, "Public check failed: inspect DNS/TLS/redirect/readiness/firewall via trusted operator channel.\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
