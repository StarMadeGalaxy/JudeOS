#!/usr/bin/python3 -I
"""OpenSSH forced command. No shell evaluation, forwarding, or stdin protocol."""
import json
import os
import re
import sys

CONTROLLER = "/usr/local/lib/judeos-deploy/controller.py"


def arguments(command):
    if command == "check":
        return ["check"]
    if re.fullmatch(r"deploy sha256:[0-9a-f]{64}", command):
        return command.split(" ")
    if re.fullmatch(r"deploy v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)? sha256:[0-9a-f]{64}", command):
        return command.split(" ")
    raise ValueError("command_denied")


def main():
    try:
        args = arguments(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    except ValueError:
        print(json.dumps({"ok": False, "code": "command_denied"}))
        return 2
    # sudo policy authorizes only this root-owned controller. No user environment
    # or SSH_ORIGINAL_COMMAND reaches the privileged process.
    try:
        os.execve("/usr/bin/sudo", ["sudo", "-n", "--", CONTROLLER, *args],
                  {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"})
    except OSError:
        print(json.dumps({"ok": False, "code": "controller_unavailable"}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
