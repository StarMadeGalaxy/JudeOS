#!/usr/bin/env python3
"""Operator-only first activation; no app start and no overwrite of credentials."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
STATE_DIR = Path("/var/lib/judeos-deploy")


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def enable(checkout, manifest, config_dir):
    if os.geteuid() != 0:
        raise ValueError("root_required")
    install = load("install", HERE / "install.py")
    boundary = load("boundary", HERE / "controller.py")
    gate = load("gate", HERE / "release-gate.py")
    boundary.trusted(install.CONFIG / "managed")
    if (install.CONFIG / "release.json").exists():
        raise ValueError("already_enabled")
    checkout, manifest, config_dir = [p.absolute() for p in [checkout, manifest, config_dir]]
    boundary.trusted_tree(checkout)
    boundary.trusted(manifest)
    for name in ["test-env.py", "test-stack.py", "test-probe.py", "test-release-check.py",
                 "test-compose.yaml", "test-public.Caddyfile"]:
        boundary.trusted(checkout / "ops" / name)
    data = json.loads(manifest.read_text())
    if data != gate.verify(data["release_tag"], data["registry_digest"].split("@", 1)[1]):
        raise ValueError("manifest_mismatch")
    def git(*args):
        return subprocess.check_output(["/usr/bin/git", "-C", str(checkout), *args],
                                       text=True, stderr=subprocess.DEVNULL).strip()
    if git("rev-parse", "HEAD") != data["source_commit"] or git("status", "--porcelain"):
        raise ValueError("checkout_mismatch")
    subprocess.run(["/usr/bin/git", "-C", str(checkout), "merge-base", "--is-ancestor",
                    data["source_commit"], "origin/main"], check=True, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)
    verifier = load("release_check", checkout / "ops/test-release-check.py")
    verifier.validate_manifest(data, data["source_commit"], checkout)
    for file in (checkout / "db/migrations").glob("*.sql"):
        boundary.trusted(file)
    if config_dir.exists():
        # Never regenerate passwords. Existing #22 config will be checked by
        # the adapter before any application operation.
        boundary.trusted(config_dir / "test.env")
    else:
        for parent in [config_dir.parent, *config_dir.parent.parents]:
            info = parent.lstat()
            if not parent.is_dir() or parent.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError("unsafe_config_parent")
        subprocess.run(["/usr/bin/python3", "-I", str(checkout / "ops/test-env.py"),
                        "--directory", str(config_dir), "--project", "judeos-hostinger-test",
                        "--public", "--domain", "judopride.tech", "--http-port", "80",
                        "--https-port", "443", "--image", data["registry_digest"]], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    install.safe_dir(STATE_DIR, 0o700)
    for name in ["controller.py", "ssh-entry.py", "release-gate.py", "apply-release"]:
        install.write(install.LIB / name, (HERE / name).read_text(), 0o755)
    policy = {"repository": gate.IMAGE, "release_tag": data["release_tag"],
              "checkout": str(checkout), "config": str(config_dir / "test.env"),
              "source_commit": data["source_commit"], "schema_version": data["schema_version"],
              "migrations": data["migrations"], "registry_digest": data["registry_digest"]}
    # Activation happens last. No container is started by this command.
    install.write(install.CONFIG / "release.json", json.dumps(policy, indent=2) + "\n", 0o600)
    print("Enabled checked release adapter; configuration preserved, app not started.")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--checkout", type=Path, required=True)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--config-directory", type=Path, default=Path("/srv/judeos-test-config"))
    a = p.parse_args()
    try:
        enable(a.checkout, a.manifest, a.config_directory)
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError):
        p.exit(2, "Activation failed: require root-owned accepted checkout and published CI-verified manifest.\n")


if __name__ == "__main__":
    main()
