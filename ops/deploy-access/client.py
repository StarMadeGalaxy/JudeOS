#!/usr/bin/env python3
"""Non-interactive SSH transport using an explicit host pin and key file."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys


def command(host, port, identity, known_hosts, action, digest=None, tag=None):
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}", host) or not 1 <= port <= 65535:
        raise ValueError("invalid_destination")
    remote = "check"
    if action == "deploy" and digest and re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        remote = "deploy " + digest
        if tag:
            if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", tag):
                raise ValueError("invalid_tag")
            remote = "deploy " + tag + " " + digest
    elif action != "check" or digest or tag:
        raise ValueError("invalid_command")
    return ["/usr/bin/ssh", "-F", "/dev/null", "-T", "-p", str(port),
            "-i", str(identity.resolve()), "-o", "IdentitiesOnly=yes",
            "-o", "IdentityAgent=none", "-o", "BatchMode=yes",
            "-o", "PasswordAuthentication=no", "-o", "KbdInteractiveAuthentication=no",
            "-o", "StrictHostKeyChecking=yes", "-o", "UpdateHostKeys=no",
            "-o", "HostKeyAlgorithms=ssh-ed25519",
            "-o", "GlobalKnownHostsFile=/dev/null",
            "-o", f"UserKnownHostsFile={known_hosts.resolve()}",
            "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=3", "--", "judeos-deploy@" + host, remote]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", required=True)
    p.add_argument("--port", type=int, default=22)
    p.add_argument("--identity", type=Path, required=True)
    p.add_argument("--known-hosts", type=Path, required=True)
    p.add_argument("--tag")
    p.add_argument("action", choices=["check", "deploy"])
    p.add_argument("digest", nargs="?")
    a = p.parse_args()
    try:
        if not a.identity.is_file() or not a.known_hosts.is_file():
            raise ValueError("credential_files_missing")
        args = command(a.host, a.port, a.identity, a.known_hosts, a.action, a.digest, a.tag)
        result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, text=True, check=False)
        output = json.loads(result.stdout)
        if not isinstance(output, dict) or not isinstance(output.get("ok"), bool):
            raise ValueError("invalid_server_response")
    except (OSError, ValueError):
        print(json.dumps({"ok": False, "code": "ssh_connection_or_response_failed"}))
        return 2
    print(json.dumps(output))
    return 0 if result.returncode == 0 and output["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
