#!/usr/bin/env python3
"""Ubuntu 24.04 operator bootstrap. Does not install Docker/proxy or an adapter."""
import argparse
import base64
import os
from pathlib import Path
import pwd
import stat
import subprocess
import tempfile

USER = "judeos-deploy"
HOME_DIR = Path("/var/lib/judeos-deploy")
LIB = Path("/usr/local/lib/judeos-deploy")
CONFIG = Path("/etc/judeos-deploy")
SSH_CONF = Path("/etc/ssh/sshd_config.d/60-judeos-deploy.conf")
SUDO_CONF = Path("/etc/sudoers.d/judeos-deploy")
ENTRY = str(LIB / "ssh-entry.py")


def key_line(text):
    rows = text.strip().splitlines()
    if len(rows) != 1:
        raise ValueError("Provide exactly one plain Ed25519 public key")
    fields = rows[0].split()
    if len(fields) < 2 or fields[0] != "ssh-ed25519":
        raise ValueError("Expected plain Ed25519 public key; no authorized_keys options/private key")
    raw = base64.b64decode(fields[1], validate=True)
    if len(raw) != 51 or raw[:19] != b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20":
        raise ValueError("Invalid Ed25519 key")
    return "ssh-ed25519 " + fields[1]


def safe_dir(path, mode=0o755, preserve_mode=False):
    # Do not follow symlinks or normalize permissions on unrelated parents.
    for parent in reversed(path.parents):
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError("Unsafe parent directory: " + str(parent))
    path.mkdir(exist_ok=True, mode=mode)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError("Unsafe managed directory: " + str(path))
    if not preserve_mode:
        path.chmod(mode)


def write(path, content, mode):
    fd, name = tempfile.mkstemp(prefix=".judeos-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
            os.fchmod(f.fileno(), mode)
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def run(args):
    subprocess.run(args, check=True, stdin=subprocess.DEVNULL,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def install(public_key):
    if os.geteuid() != 0:
        raise ValueError("Run installer as root")
    os_info = Path("/etc/os-release").read_text()
    if 'ID=ubuntu\n' not in os_info or 'VERSION_ID="24.04"' not in os_info:
        raise ValueError("This installer supports Ubuntu 24.04 only")
    for program in ["/usr/bin/python3", "/usr/bin/sudo", "/usr/sbin/visudo",
                    "/usr/sbin/sshd", "/usr/sbin/useradd", "/usr/sbin/usermod"]:
        if not Path(program).is_file():
            raise ValueError("Missing prerequisite: " + program)
    key = key_line(public_key.read_text())
    marker = CONFIG / "managed"
    if marker.exists():
        info = marker.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError("Unsafe managed marker")
        if marker.read_text() != "JudeOS restricted deploy access v1\n":
            raise ValueError("Unrecognized managed marker")
    try:
        account = pwd.getpwnam(USER)
    except KeyError:
        account = None
    if account and not marker.exists():
        raise ValueError("Existing unmanaged account; refusing takeover")
    if account and (account.pw_uid == 0 or account.pw_dir != str(HOME_DIR)
                    or account.pw_shell != "/bin/sh"
                    or os.getgrouplist(USER, account.pw_gid) != [account.pw_gid]):
        raise ValueError("Existing account has unexpected home/shell/groups")
    if not marker.exists() and (CONFIG.exists() or LIB.exists() or HOME_DIR.exists()):
        raise ValueError("Existing unmanaged directories; refusing takeover")
    for path in [SSH_CONF, SUDO_CONF]:
        if path.exists() and not marker.exists():
            raise ValueError("Existing unmanaged configuration: " + str(path))
    # Pre-validate dependencies/source before account/config mutations.
    source = Path(__file__).resolve().parent
    scripts = {name: (source / name).read_text() for name in ["controller.py", "ssh-entry.py"]}
    for path, mode in [(CONFIG, 0o700), (LIB, 0o755)]:
        safe_dir(path, mode)
    if not account:
        run(["/usr/sbin/useradd", "--system", "--user-group", "--no-create-home",
             "--home-dir", str(HOME_DIR), "--shell", "/bin/sh", USER])
        # Unusable password '*' permits public key login even with UsePAM=no;
        # the SSH Match block below additionally disables password auth.
        run(["/usr/sbin/usermod", "--password", "*", USER])
    safe_dir(HOME_DIR, 0o755)
    safe_dir(HOME_DIR / ".ssh", 0o755)
    safe_dir(SSH_CONF.parent, preserve_mode=True)
    safe_dir(SUDO_CONF.parent, preserve_mode=True)
    for name, content in scripts.items():
        write(LIB / name, content, 0o755)
    # Managed marker means this bootstrap owns the partial setup, not that
    # authentication succeeded. Allows retry after SSH validation fails.
    write(marker, "JudeOS restricted deploy access v1\n", 0o600)
    sudo_rule = f"{USER} ALL=(root) NOPASSWD: {LIB}/controller.py\n"
    fd, temporary = tempfile.mkstemp(dir=SUDO_CONF.parent)
    os.close(fd)
    try:
        write(Path(temporary), sudo_rule, 0o440)
        run(["/usr/sbin/visudo", "-cf", temporary])
    finally:
        Path(temporary).unlink(missing_ok=True)
    ssh_rule = f"""# Managed by JudeOS ops/deploy-access/install.py
Match User {USER}
    AuthenticationMethods publickey
    PubkeyAcceptedAlgorithms ssh-ed25519
    AuthorizedKeysFile {HOME_DIR}/.ssh/authorized_keys
    AuthorizedKeysCommand none
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitTTY no
    DisableForwarding yes
    PermitUserRC no
    ForceCommand {ENTRY}
Match all
"""
    previous = SSH_CONF.read_text() if SSH_CONF.exists() else None
    write(SSH_CONF, ssh_rule, 0o644)
    try:
        run(["/usr/sbin/sshd", "-t"])
        effective = subprocess.check_output(
            ["/usr/sbin/sshd", "-T", "-C", f"user={USER},host=localhost,addr=127.0.0.1"], text=True)
        required = [f"forcecommand {ENTRY}", "authenticationmethods publickey",
                    "pubkeyacceptedalgorithms ssh-ed25519",
                    f"authorizedkeysfile {HOME_DIR}/.ssh/authorized_keys", "authorizedkeyscommand none",
                    "passwordauthentication no", "kbdinteractiveauthentication no",
                    "permittty no", "disableforwarding yes", "permituserrc no"]
        if not all(value in effective.splitlines() for value in required):
            raise ValueError("SSH Include/Match overrides restrictions; correct server config first")
    except (subprocess.CalledProcessError, ValueError):
        if previous is None:
            SSH_CONF.unlink()
        else:
            write(SSH_CONF, previous, 0o644)
        raise
    write(SUDO_CONF, sudo_rule, 0o440)
    write(HOME_DIR / ".ssh/authorized_keys", f'restrict,command="{ENTRY}" {key}\n', 0o644)
    print("Installed restricted SSH access; release adapter remains unconfigured.")
    print("Validate and reload: /usr/sbin/sshd -t && systemctl reload ssh")
    print("Keep this administrator console open until key login has been checked.")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--public-key", type=Path, required=True)
    a = p.parse_args()
    try:
        install(a.public_key)
    except (OSError, ValueError, subprocess.CalledProcessError):
        p.exit(2, "Installation failed; check prerequisites/key and administrator config. No SSH reload performed.\n")


if __name__ == "__main__":
    main()
