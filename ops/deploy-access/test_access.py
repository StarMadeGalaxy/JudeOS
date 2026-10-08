#!/usr/bin/env python3
"""Run in the disposable Ubuntu test image; includes real OpenSSH sessions."""
import base64
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / (name + ".py"))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


entry, controller, installer, pin, client = [module(n) for n in
                                          ["ssh-entry", "controller", "install", "pin-host", "client"]]
KEY = base64.b64encode(b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20" + bytes(range(32))).decode()
DIGEST = "sha256:" + "a" * 64


class Validation(unittest.TestCase):
    def test_command_boundary(self):
        self.assertEqual(entry.arguments("check"), ["check"])
        self.assertEqual(entry.arguments("deploy " + DIGEST), ["deploy", DIGEST])
        self.assertEqual(entry.arguments("deploy v0.1.0-test " + DIGEST), ["deploy", "v0.1.0-test", DIGEST])
        for value in ["", "sh", "check; id", "check\nid", "check ", "sftp", "scp -t /tmp",
                      "deploy latest", "deploy " + DIGEST.upper(), "deploy " + DIGEST + " x",
                      "deploy $(id)", "deploy '" + DIGEST + "'", "deploy v0.1.0;id " + DIGEST,
                      "deploy v0.1.0 " + DIGEST + "\ncheck"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                entry.arguments(value)

    def test_pin_rejects_key_substitution(self):
        fingerprint = pin.key_fingerprint(KEY)
        scan = "untrusted.example ssh-ed25519 " + KEY
        self.assertEqual(pin.pin(scan, fingerprint, "187.7.69.230", 22),
                         "187.7.69.230 ssh-ed25519 " + KEY + "\n")
        self.assertTrue(pin.pin(scan, fingerprint, "host.example", 2222).startswith("[host.example]:2222 "))
        for text, fp, host in [(scan, "SHA256:wrong", "host.example"), ("", fingerprint, "host.example"),
                               (scan, fingerprint, "-oProxyCommand=evil"),
                               ("ssh-rsa " + KEY, fingerprint, "host.example")]:
            with self.assertRaises(ValueError):
                pin.pin(text, fp, host, 22)

    def test_installer_does_not_accept_authorized_key_options_or_private_keys(self):
        self.assertEqual(installer.key_line("ssh-ed25519 " + KEY + " comment"), "ssh-ed25519 " + KEY)
        for key in ['command="id" ssh-ed25519 ' + KEY, "-----BEGIN OPENSSH PRIVATE KEY-----",
                    "ssh-ed25519 " + KEY + "\nssh-ed25519 " + KEY, "ssh-ed25519 invalid"]:
            with self.assertRaises(ValueError):
                installer.key_line(key)

    def test_client_has_no_interactive_or_unpinned_fallback(self):
        args = client.command("host.example", 22, Path("key"), Path("pins"), "check")
        for setting in ["BatchMode=yes", "StrictHostKeyChecking=yes", "IdentityAgent=none",
                        "GlobalKnownHostsFile=/dev/null", "HostKeyAlgorithms=ssh-ed25519"]:
            self.assertIn(setting, args)
        with self.assertRaises(ValueError):
            client.command("-oProxyCommand=evil", 22, Path("key"), Path("pins"), "check")
        with self.assertRaises(ValueError):
            client.command("host.example", 22, Path("key"), Path("pins"), "deploy", "latest")


@unittest.skipUnless(os.geteuid() == 0, "privileged policy tests need disposable root container")
class Policy(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir="/root")
        self.base = Path(self.directory.name)
        self.policy = self.base / "release.json"
        self.adapter = self.base / "apply-release"
        self.patches = [patch.object(controller, "POLICY", self.policy),
                        patch.object(controller, "ADAPTER", self.adapter),
                        patch.object(controller, "LOCK", self.base / "run/deploy.lock")]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.directory.cleanup()

    def configure(self, script="#!/bin/sh\nexit 0\n"):
        self.policy.write_text(json.dumps({"repository": "registry.example.invalid/synthetic/app"}))
        self.policy.chmod(0o600)
        self.adapter.write_text(script)
        self.adapter.chmod(0o700)

    def test_no_adapter_fails_closed(self):
        with self.assertRaisesRegex(controller.Denied, "release_adapter_unconfigured"):
            controller.apply(DIGEST)

    def test_writable_or_symlinked_adapter_rejected(self):
        self.configure()
        self.adapter.chmod(0o722)
        with self.assertRaisesRegex(controller.Denied, "unsafe_adapter"):
            controller.apply(DIGEST)
        self.adapter.unlink()
        self.adapter.symlink_to("/bin/true")
        with self.assertRaisesRegex(controller.Denied, "unsafe_adapter"):
            controller.apply(DIGEST)

    def test_valid_adapter_gets_fixed_repository_and_clean_environment(self):
        out = self.base / "received"
        self.configure(f'#!/bin/sh\nprintf "%s\\n" "$#" "$1" "${{ATTACK-secret_absent}}" > {out}\n')
        with patch.dict(os.environ, {"ATTACK": "synthetic-secret"}):
            self.assertEqual(controller.apply(DIGEST), {"digest": DIGEST})
        self.assertEqual(out.read_text().splitlines(),
                         ["1", "registry.example.invalid/synthetic/app@" + DIGEST, "secret_absent"])

    def test_deployments_serialize_and_raw_errors_are_hidden(self):
        self.configure('#!/bin/sh\necho synthetic-secret-error >&2\nexit 9\n')
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = controller.main(["deploy", DIGEST])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue()), {"ok": False, "code": "release_failed"})
        controller.LOCK.parent.mkdir(exist_ok=True, mode=0o700)
        import fcntl
        with controller.LOCK.open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(controller.Denied, "deployment_busy"):
                controller.apply(DIGEST)

    def test_direct_controller_arguments_rejected(self):
        for args in [["check", "extra"], ["sh"], ["deploy", "latest"]]:
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(controller.main(args), 2)
            self.assertFalse(json.loads(output.getvalue())["ok"])

    def test_adapter_keeps_lock_after_controller_is_killed(self):
        ready, done = self.base / "ready", self.base / "done"
        self.configure(f'#!/bin/sh\ntouch {ready}\nsleep 2\ntouch {done}\n')
        harness = self.base / "harness.py"
        harness.write_text(f'''import sys
sys.path.insert(0, {str(HERE)!r})
import controller
from pathlib import Path
controller.POLICY = Path({str(self.policy)!r})
controller.ADAPTER = Path({str(self.adapter)!r})
controller.LOCK = Path({str(controller.LOCK)!r})
controller.main(["deploy", {DIGEST!r}])
''')
        process = subprocess.Popen(["python3", str(harness)], stdout=subprocess.DEVNULL)
        try:
            for _ in range(100):
                if ready.exists():
                    break
                time.sleep(0.02)
            self.assertTrue(ready.exists())
            process.kill()
            process.wait(timeout=5)
            with self.assertRaisesRegex(controller.Denied, "deployment_busy"):
                controller.apply(DIGEST)
            for _ in range(150):
                if done.exists():
                    break
                time.sleep(0.02)
            self.assertTrue(done.exists())
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)


@unittest.skipUnless(os.geteuid() == 0 and Path("/usr/sbin/sshd").exists(), "real SSH needs test image")
class OpenSSH(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(dir="/root")
        cls.base = Path(cls.directory.name)
        cls.key = cls.base / "key"
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(cls.key)], check=True)
        subprocess.run(["ssh-keygen", "-A"], check=True, stdout=subprocess.DEVNULL)
        Path("/run/sshd").mkdir(exist_ok=True)
        installer.install(Path(str(cls.key) + ".pub"))
        # Repeat proves managed key rotation/update works without resetting the VPS.
        installer.install(Path(str(cls.key) + ".pub"))
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cls.port = sock.getsockname()[1]
        cls.log = (cls.base / "sshd.log").open("w")
        cls.daemon = subprocess.Popen(["/usr/sbin/sshd", "-D", "-e", "-p", str(cls.port)],
                                      stdout=cls.log, stderr=cls.log)
        for _ in range(50):
            try:
                with socket.create_connection(("127.0.0.1", cls.port), timeout=0.1):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("isolated sshd failed to start")
        hostkey = Path("/etc/ssh/ssh_host_ed25519_key.pub").read_text().split()[:2]
        cls.pins = cls.base / "known_hosts"
        cls.pins.write_text(pin.pin(" ".join(hostkey), pin.key_fingerprint(hostkey[1]), "127.0.0.1", cls.port))

    @classmethod
    def tearDownClass(cls):
        cls.daemon.terminate()
        cls.daemon.wait(timeout=10)
        cls.log.close()
        cls.directory.cleanup()

    def ssh(self, command="check", extra=None, pins=None):
        args = client.command("127.0.0.1", self.port, self.key, pins or self.pins, "check")
        if extra:
            args[1:1] = extra
            if "-tt" in extra:
                args.remove("-T")
        args[-1] = command
        return subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15)

    def test_real_login_check_and_no_docker_group(self):
        p = self.ssh()
        self.assertEqual(p.returncode, 0, p.stderr)
        result = json.loads(p.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["os"], {"ID": "ubuntu", "VERSION_ID": "24.04"})
        self.assertFalse(result["release_adapter_installed"])
        self.assertNotIn("docker", subprocess.check_output(["id", "-nG", "judeos-deploy"], text=True).split())

    def test_operator_activation_preserves_real_ssh_and_private_state(self):
        self.assertEqual(self.ssh().returncode, 0)
        # Use the actual activation and home permissions with synthetic release
        # boundaries; restore subprocess mocks before the real SSH connection.
        fixture = module("test_release").Adapter("test_operator_activation_preserves_config_and_writes_policy_last")
        fixture.setUp()
        try:
            fixture.activate(fixture.config_dir, state_dir=installer.HOME_DIR)
        finally:
            fixture.tearDown()
        result = self.ssh()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["ok"])
        self.assertEqual(installer.HOME_DIR.stat().st_mode & 0o777, 0o755)
        self.assertEqual(subprocess.run(["runuser", "-u", "judeos-deploy", "--", "test", "-r",
                                       str(installer.HOME_DIR / ".ssh/authorized_keys")]).returncode, 0)
        self.assertNotEqual(subprocess.run(["runuser", "-u", "judeos-deploy", "--", "test", "-w",
                                          str(installer.HOME_DIR)]).returncode, 0)
        state = installer.HOME_DIR / ".synthetic-activation-state"
        try:
            installer.write(state, "synthetic private state\n", 0o600)
            self.assertNotEqual(subprocess.run(["runuser", "-u", "judeos-deploy", "--", "test", "-r",
                                               str(state)]).returncode, 0)
        finally:
            state.unlink(missing_ok=True)

    def test_shell_sftp_and_injection_denied(self):
        for command in ["", "id", "check; id", "internal-sftp", "scp -t /tmp/x", "check\nid"]:
            p = self.ssh(command)
            self.assertNotEqual(p.returncode, 0)
            self.assertEqual(json.loads(p.stdout)["code"], "command_denied")

    def test_deploy_disabled_and_sudo_not_general(self):
        p = self.ssh("deploy " + DIGEST)
        self.assertEqual(json.loads(p.stdout)["code"], "release_adapter_unconfigured")
        p = subprocess.run(["runuser", "-u", "judeos-deploy", "--", "sudo", "-n", "/usr/bin/id"],
                           capture_output=True)
        self.assertNotEqual(p.returncode, 0)
        p = subprocess.run(["runuser", "-u", "judeos-deploy", "--", "/bin/sh", "-c",
                            "echo replaced >> /var/lib/judeos-deploy/.ssh/authorized_keys"], capture_output=True)
        self.assertNotEqual(p.returncode, 0)

    def test_tagged_request_reaches_root_adapter_without_shell_expansion(self):
        policy, adapter = controller.POLICY, controller.ADAPTER
        self.assertFalse(policy.exists())
        self.assertFalse(adapter.exists())
        output = self.base / "tagged-arguments"
        try:
            policy.write_text(json.dumps({"repository": "registry.example.invalid/synthetic/app"}))
            policy.chmod(0o600)
            adapter.write_text(f'#!/bin/sh\nprintf "%s\\n" "$#" "$1" "$2" > {output}\n')
            adapter.chmod(0o755)
            result = self.ssh("deploy v0.1.0-test " + DIGEST)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output.read_text().splitlines(),
                             ["2", "registry.example.invalid/synthetic/app@" + DIGEST, "v0.1.0-test"])
        finally:
            policy.unlink(missing_ok=True)
            adapter.unlink(missing_ok=True)

    def test_key_revocation_blocks_new_connections(self):
        path = Path("/var/lib/judeos-deploy/.ssh/authorized_keys")
        original = path.read_text()
        try:
            path.write_text("")
            self.assertNotEqual(self.ssh().returncode, 0)
        finally:
            path.write_text(original)
        self.assertEqual(self.ssh().returncode, 0)

    def test_conflicting_server_match_is_detected_without_replacing_own_rule(self):
        own = Path("/etc/ssh/sshd_config.d/60-judeos-deploy.conf")
        original = own.read_text()
        conflict = Path("/etc/ssh/sshd_config.d/00-conflict.conf")
        try:
            conflict.write_text("Match User judeos-deploy\n    ForceCommand /bin/true\nMatch all\n")
            with self.assertRaisesRegex(ValueError, "SSH Include/Match"):
                installer.install(Path(str(self.key) + ".pub"))
            self.assertEqual(own.read_text(), original)
        finally:
            conflict.unlink(missing_ok=True)

    def test_tty_and_remote_forwarding_denied(self):
        p = self.ssh(extra=["-tt"])
        self.assertIn("PTY allocation request failed", p.stderr)
        p = self.ssh(extra=["-o", "ExitOnForwardFailure=yes", "-R", "0:127.0.0.1:22"])
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("remote port forwarding failed", p.stderr)

    def test_untrusted_host_key_cannot_authenticate(self):
        wrong = self.base / "wrong_hosts"
        wrong.write_text(f"[127.0.0.1]:{self.port} ssh-ed25519 {KEY}\n")
        p = self.ssh(pins=wrong)
        self.assertNotEqual(p.returncode, 0)
        self.assertEqual(p.stdout, "")
        self.assertIn("Host key verification failed", p.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
