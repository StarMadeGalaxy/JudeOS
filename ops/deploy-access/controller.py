#!/usr/bin/python3 -I
"""Privileged, fixed-command deployment boundary; release adapter installed later."""
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

POLICY = Path("/etc/judeos-deploy/release.json")
ADAPTER = Path("/usr/local/lib/judeos-deploy/apply-release")
LOCK = Path("/run/judeos-deploy/deploy.lock")
BASE_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/root", "LANG": "C.UTF-8"}


class Denied(Exception):
    pass


def trusted(path, executable=False):
    """Protect policy/adapter and every parent from deploy-user substitution."""
    for part in [*reversed(path.parents), path]:
        info = part.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise Denied("unsafe_adapter")
        if part == path:
            if not stat.S_ISREG(info.st_mode):
                raise Denied("unsafe_adapter")
            if executable and not info.st_mode & 0o100:
                raise Denied("unsafe_adapter")
        elif not stat.S_ISDIR(info.st_mode):
            raise Denied("unsafe_adapter")


def capture(command):
    try:
        p = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True,
                           text=True, timeout=10, env=BASE_ENV, cwd="/")
        return p.stdout.strip() if p.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def preflight():
    # Only allowlisted fields; never docker inspect/logs, env, server config,
    # process arguments, certificates/private keys, or raw command errors.
    os_fields = {}
    for line in Path("/etc/os-release").read_text().splitlines():
        key, _, value = line.partition("=")
        if key in {"ID", "VERSION_ID"}:
            os_fields[key] = value.strip('"')
    listeners = capture(["/usr/bin/ss", "-H", "-lnt"])
    ports = set()
    if listeners is not None:
        for row in listeners.splitlines():
            parts = row.split()
            if len(parts) >= 4:
                port = parts[3].rsplit(":", 1)[-1]
                if port in {"22", "80", "443", "5432", "8080"}:
                    ports.add(int(port))
    return {"os": os_fields, "architecture": capture(["/usr/bin/uname", "-m"]),
            "docker": capture(["/usr/bin/docker", "--version"]),
            "compose": capture(["/usr/bin/docker", "compose", "version"]),
            "tcp_listen_ports": sorted(ports) if listeners is not None else None,
            "release_adapter_installed": POLICY.exists() and ADAPTER.exists()}


def apply(digest):
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise Denied("command_denied")
    if not POLICY.exists() or not ADAPTER.exists():
        raise Denied("release_adapter_unconfigured")
    trusted(POLICY)
    trusted(ADAPTER, executable=True)
    policy = json.loads(POLICY.read_text())
    if not isinstance(policy, dict):
        raise Denied("invalid_release_policy")
    repository = policy.get("repository", "")
    if not isinstance(repository, str) or not re.fullmatch(
            r"[a-z0-9][a-z0-9.-]*(?::[1-9][0-9]{0,4})?/[a-z0-9][a-z0-9._/-]*", repository):
        raise Denied("invalid_release_policy")
    # Lock is root-owned and no symlink may redirect it. All callers serialize
    # here, even if they bypass the GitHub workflow concurrency setting.
    LOCK.parent.mkdir(mode=0o700, exist_ok=True)
    directory = LOCK.parent.lstat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != 0 or directory.st_mode & 0o077:
        raise Denied("unsafe_lock")
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as lock:
        info = os.fstat(lock.fileno())
        if info.st_uid != 0 or info.st_mode & 0o077 or not stat.S_ISREG(info.st_mode):
            raise Denied("unsafe_lock")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Denied("deployment_busy") from None
        # Adapter is an administrator-reviewed integration of accepted #22,
        # never uploaded/selected by the SSH caller. Suppress its logs, which
        # could contain DB credentials. No automatic rollback or DB downgrade.
        try:
            subprocess.run([str(ADAPTER), repository + "@" + digest],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, env=BASE_ENV, cwd="/", check=True,
                           pass_fds=(lock.fileno(),))
        except (OSError, subprocess.CalledProcessError):
            raise Denied("release_failed") from None
    return {"digest": digest}


def main(args):
    try:
        if os.geteuid() != 0:
            raise Denied("root_controller_required")
        if args == ["check"]:
            result = preflight()
        elif len(args) == 2 and args[0] == "deploy":
            result = apply(args[1])
        else:
            raise Denied("command_denied")
        print(json.dumps({"ok": True, "code": "completed", **result}))
        return 0
    except Denied as e:
        print(json.dumps({"ok": False, "code": str(e)}))
        return 2
    except (OSError, ValueError, TypeError):
        print(json.dumps({"ok": False, "code": "controller_failed"}))
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
