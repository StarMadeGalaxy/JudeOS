#!/usr/bin/env python3
"""Convert an untrusted keyscan into known_hosts only after fingerprint match."""
import argparse
import base64
import hashlib
from pathlib import Path
import re


def key_fingerprint(blob):
    raw = base64.b64decode(blob, validate=True)
    # Exact SSH wire encoding of an Ed25519 key: string type + string 32 bytes.
    if len(raw) != 51 or raw[:19] != b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20":
        raise ValueError("invalid_ed25519_key")
    return "SHA256:" + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("=")


def host_valid(host):
    return bool(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}", host))


def pin(scan, fingerprint, host, port):
    if not host_valid(host) or not 1 <= port <= 65535:
        raise ValueError("invalid_destination")
    keys = set()
    for row in scan.splitlines():
        parts = row.split()
        if row.startswith("#") or not row.strip():
            continue
        if len(parts) not in {2, 3}:
            raise ValueError("invalid_host_key_input")
        key = parts[-2:]
        if key[0] != "ssh-ed25519" or key_fingerprint(key[1]) != fingerprint:
            raise ValueError("host_fingerprint_mismatch")
        keys.add(key[1])
    if len(keys) != 1:
        raise ValueError("host_key_missing_or_ambiguous")
    name = host if port == 22 else f"[{host}]:{port}"
    return f"{name} ssh-ed25519 {keys.pop()}\n"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--scan", type=Path, required=True)
    p.add_argument("--fingerprint", required=True)
    p.add_argument("--host", required=True)
    p.add_argument("--port", type=int, default=22)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    try:
        result = pin(a.scan.read_text(), a.fingerprint, a.host, a.port)
    except (OSError, ValueError):
        p.exit(2, "Host key verification failed; known_hosts not written.\n")
    # Never overwrite an existing pin silently. Rotation is an explicit operation.
    with a.output.open("x") as f:
        f.write(result)
    a.output.chmod(0o600)


if __name__ == "__main__":
    main()
