#!/usr/bin/env python3
"""Release authorization and fixed adapter tests; no public network or real data."""
import copy
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import types
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
from test_access import module, HERE, DIGEST, installer

gate = module("release-gate")
public = module("public-check")
enable = module("enable-release")
spec = importlib.util.spec_from_loader("adapter", importlib.machinery.SourceFileLoader("adapter", str(HERE / "apply-release")))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def manifest(sha="a" * 40):
    return {"dirty": False, "rebuild_verified": True, "platform": "linux/amd64", "source_commit": sha,
            "release_tag": "v0.1.0", "registry_digest": gate.IMAGE + "@" + DIGEST,
            "local_image_id": "sha256:" + "b" * 64, "schema_version": 3,
            "migrations": {"00001.sql": hashlib.sha256(b"synthetic SQL").hexdigest()}}


class ReleaseGate(unittest.TestCase):
    def setUp(self):
        self.data = manifest()
        self.run = {"id": 7, "workflow_id": 1, "event": "push", "head_sha": "a" * 40,
                    "head_branch": "v0.1.0", "conclusion": "success", "run_attempt": 1,
                    "head_repository": {"full_name": gate.REPO}}
        self.jobs = [{"name": n, "conclusion": "success"} for n in gate.REQUIRED]
        self.ref = {"type": "commit", "sha": "a" * 40}
        self.integrated = "ahead"

    def get(self, path):
        if path == "releases/tags/v0.1.0":
            return {"draft": False, "tag_name": "v0.1.0", "assets": [{"name": "release.json", "state": "uploaded"}]}
        if path == "git/ref/tags/v0.1.0":return {"object": self.ref}
        if path == "compare/" + "a" * 40 + "...main":return {"status": self.integrated}
        if path == "actions/workflows/ci.yml":return {"id": 1, "path": ".github/workflows/ci.yml"}
        if path == "actions/runs/7":return self.run
        if path.startswith("actions/workflows/1/runs?"):return {"workflow_runs": [self.run]}
        if path == "actions/runs/7/attempts/1/jobs?per_page=100":return {"jobs": self.jobs}
        raise AssertionError(path)

    def verify(self):
        return gate.verify("v0.1.0", DIGEST, get=self.get, download=lambda _: self.data)

    def test_valid_published_tag_ci(self):
        self.assertEqual(self.verify(), self.data)
        self.assertEqual(gate.verify("v0.1.0", DIGEST, 7, get=self.get, download=lambda _: self.data), self.data)

    def test_fork_pr_wrong_tag_or_failed_ci_cannot_authorize(self):
        for change in [{"event": "pull_request"}, {"head_branch": "main"}, {"conclusion": "failure"},
                       {"head_repository": {"full_name": "fork/JudeOS"}}, {"workflow_id": 2}]:
            old = copy.deepcopy(self.run)
            self.run.update(change)
            with self.assertRaisesRegex(gate.Rejected, "verified_tag_ci_missing"):self.verify()
            self.run = old

    def test_skipped_publish_and_replaced_tag_rejected(self):
        self.jobs = [j for j in self.jobs if j["name"] != "Publish tagged release"]
        with self.assertRaises(gate.Rejected):self.verify()
        self.ref["sha"] = "c" * 40
        with self.assertRaisesRegex(gate.Rejected, "tag_manifest_mismatch"):self.verify()

    def test_source_outside_main_and_tampered_manifest(self):
        self.integrated = "behind"
        with self.assertRaisesRegex(gate.Rejected, "source_not_integrated"):self.verify()
        self.integrated = "ahead"
        for change in [{"dirty": True}, {"rebuild_verified": False}, {"platform": "linux/arm64"},
                       {"registry_digest": "other.invalid/app@" + DIGEST}, {"schema_version": True}]:
            old = copy.deepcopy(self.data)
            self.data.update(change)
            with self.assertRaises(gate.Rejected):self.verify()
            self.data = old

    def test_redirect_does_not_forward_token_or_downgrade_tls(self):
        request = urllib.request.Request("https://api.github.com/asset", headers={"Authorization": "Bearer synthetic"})
        handler = gate.HTTPSRedirect()
        redirected = handler.redirect_request(request, None, 302, "", {}, "https://release-assets.githubusercontent.com/file")
        self.assertIsNone(redirected.get_header("Authorization"))
        for url in ["http://github.com/file", "https://other.invalid/file"]:
            with self.assertRaises(gate.Rejected):handler.redirect_request(request, None, 302, "", {}, url)


class PublicChecks(unittest.TestCase):
    def setUp(self):
        self.wrong_body = self.open_db = self.wrong_redirect = False
        self.requests = []
        class Response:
            status = 200
            def __enter__(s):return s
            def __exit__(s, *_):pass
            def read(s, _):return json.dumps({"status": s.status_body}).encode()
        def open_url(url, **_):
            self.requests.append(url)
            if url.startswith("http:"):
                raise urllib.error.HTTPError(url, 308, "", {"Location": "https://other.invalid/" if self.wrong_redirect else public.ORIGIN + "/"}, None)
            response = Response()
            response.status_body = "bad" if self.wrong_body else ("ready" if url.endswith("/readyz") else "ok")
            return response
        def connection(destination, **_):
            if destination[1] in {80, 443} or (self.open_db and destination[1] == 5432):return Response()
            raise ConnectionRefusedError()
        self.patches = [patch.object(public.socket, "getaddrinfo", return_value=[(None,None,None,None,("187.7.69.230",443))]),
                        patch.object(public.socket, "create_connection", side_effect=connection),
                        patch.object(public.urllib.request, "build_opener", return_value=types.SimpleNamespace(open=open_url))]
        for p in self.patches:p.start()

    def tearDown(self):
        for p in reversed(self.patches):p.stop()

    def test_external_checks_cover_runtime_docs_redirect_and_ports(self):
        self.assertTrue(public.check("187.7.69.230")["ok"])
        self.assertIn(public.ORIGIN + "/docs", self.requests)

    def test_wrong_redirect_status_body_or_open_database_rejected(self):
        for flag in ["wrong_redirect", "wrong_body", "open_db"]:
            setattr(self, flag, True)
            with self.assertRaises(ValueError):public.check("187.7.69.230")
            setattr(self, flag, False)

    def test_unexpected_dns_address_rejected(self):
        with patch.object(public.socket, "getaddrinfo", return_value=[(None,None,None,None,("::1",443))]):
            with self.assertRaisesRegex(ValueError,"dns_mismatch"):public.check("187.7.69.230")
        self.assertEqual(self.requests,[])


@unittest.skipUnless(os.geteuid() == 0, "root-owned adapter checks need disposable container")
class Adapter(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir="/root")
        self.root = Path(self.directory.name)
        self.checkout = self.root / "checkout"
        self.checkout.mkdir()
        ops = self.checkout / "ops";ops.mkdir()
        migrations = self.checkout / "db/migrations";migrations.mkdir(parents=True)
        (migrations / "migrations.go").write_text("const Version int64 = 3\n")
        (migrations / "00001.sql").write_text("synthetic SQL")
        for name in ["test-stack.py", "test-probe.py", "test-compose.yaml", "test-public.Caddyfile"]:
            (ops / name).write_text("# synthetic command contract fixture\n")
        (ops / "test-release-check.py").write_text("def validate_manifest(data, commit, root):\n    return data['registry_digest']\n")
        def git(*args):
            return subprocess.check_output(["git", "-C", str(self.checkout), *args], stderr=subprocess.DEVNULL, text=True).strip()
        git("init");git("add", ".")
        git("-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-m", "fixture")
        self.sha = git("rev-parse", "HEAD")
        self.lib = self.root / "lib";self.lib.mkdir()
        for name in ["controller.py", "release-gate.py"]:shutil.copy(HERE / name, self.lib / name)
        self.config_dir = self.root / "config";self.config_dir.mkdir(mode=0o700)
        self.config = self.config_dir / "test.env"
        self.initial_image = gate.IMAGE + "@sha256:" + "c" * 64
        self.values = {"COMPOSE_PROJECT_NAME": "judeos-hostinger-test", "TEST_DOMAIN": "judopride.tech",
                       "TEST_CONFIG_DIR": str(self.config_dir), "TEST_BIND_ADDR": "0.0.0.0",
                       "TEST_HTTP_PORT": "80", "TEST_HTTPS_PORT": "443",
                       "TEST_CADDYFILE": str(ops / "test-public.Caddyfile"), "TEST_IMAGE": self.initial_image}
        self.config.write_text("".join(k + "=" + v + "\n" for k, v in self.values.items()));self.config.chmod(0o600)
        for name in ["db-password", "bootstrap-secrets.env", "migration-secrets.env", "api-secrets.env"]:
            p=self.config_dir/name;p.write_text("synthetic-secret\n");p.chmod(0o600)
        self.data = manifest()
        self.policy = self.root / "policy.json"
        self.policy.write_text(json.dumps({"checkout": str(self.checkout), "config": str(self.config),
                                          "source_commit": self.sha, "repository": gate.IMAGE,
                                          "registry_digest": self.initial_image,
                                          "schema_version": 3, "migrations": self.data["migrations"]}))
        self.status = self.root / "status.json"
        self.calls = []
        self.bad_image = self.fail_ready = False
        self.fake_gate = types.SimpleNamespace(IMAGE=gate.IMAGE, verify=lambda *_: self.data,
                                              api=lambda _: {"status": "ahead"})
        self.real_load = adapter.load
        self.real_run = subprocess.run
        self.patches = [patch.object(adapter, "LIB", self.lib), patch.object(adapter, "POLICY", self.policy),
                        patch.object(adapter, "STATUS", self.status),
                        patch.object(adapter, "load", side_effect=lambda name, p: self.fake_gate if name == "gate" else self.real_load(name, p)),
                        patch.object(adapter.subprocess, "run", side_effect=self.command),
                        patch.dict(os.environ, os.environ.copy(), clear=True)]
        for p in self.patches:p.start()

    def command(self, args, **kwargs):
        if args[0] == "/usr/bin/git":return self.real_run(args, **kwargs)
        self.calls.append(args)
        if args[:4] == ["/usr/bin/docker", "image", "inspect", self.data["registry_digest"]]:
            identity = [self.data["local_image_id"], "linux/amd64", self.data["source_commit"], "sha-" + self.data["source_commit"]]
            return subprocess.CompletedProcess(args, 0, "invalid" if self.bad_image else "\n".join(identity))
        if self.fail_ready and args[-1] == "check":raise subprocess.CalledProcessError(9,args)
        return subprocess.CompletedProcess(args,0,"")

    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.directory.cleanup()

    def apply(self):adapter.execute(self.data["registry_digest"], self.data["release_tag"])

    def test_success_only_changes_image_and_records_completion(self):
        self.apply()
        self.assertIn("TEST_IMAGE=" + self.data["registry_digest"],self.config.read_text())
        self.assertEqual(json.loads(self.status.read_text())["code"],"completed")
        self.assertEqual([c[-1] for c in self.calls if c[0] == "/usr/bin/python3"],["up","check"])
        self.assertEqual((self.config_dir/"api-secrets.env").read_text(),"synthetic-secret\n")

    def test_schema_change_fails_before_pull_or_config_change(self):
        before=self.config.read_text();self.data["migrations"]["00001.sql"]="e"*64
        with self.assertRaisesRegex(ValueError,"schema_changed"):self.apply()
        self.assertEqual(self.calls,[]);self.assertEqual(self.config.read_text(),before)

    def test_image_identity_rejected_before_application_update(self):
        self.bad_image=True;before=self.config.read_text()
        with self.assertRaisesRegex(ValueError,"image_identity_mismatch"):self.apply()
        self.assertEqual(self.config.read_text(),before)
        self.assertFalse(any(c[0] == "/usr/bin/python3" for c in self.calls))

    def test_failed_readiness_preserves_attempt_and_does_not_rollback(self):
        self.fail_ready=True
        with self.assertRaises(subprocess.CalledProcessError):self.apply()
        self.assertEqual(json.loads(self.status.read_text())["code"],"applying")
        self.assertIn(self.data["registry_digest"],self.config.read_text())
        self.assertFalse(any("down" in c for c in self.calls))

    def test_config_tamper_dirty_checkout_and_old_release_rejected(self):
        self.config.write_text(self.config.read_text().replace(self.initial_image,"other.invalid/app"))
        with self.assertRaisesRegex(ValueError,"unrecognized_current_image"):self.apply()
        (self.checkout/"untracked").write_text("synthetic")
        with self.assertRaisesRegex(ValueError,"baseline_checkout_changed"):self.apply()

    def test_older_release_and_unsafe_credentials_rejected_before_pull(self):
        self.fake_gate.api=lambda _: {"status":"behind"}
        with self.assertRaisesRegex(ValueError,"release_out_of_order"):self.apply()
        self.fake_gate.api=lambda _: {"status":"ahead"}
        (self.config_dir/"db-password").chmod(0o644)
        with self.assertRaisesRegex(ValueError,"unsafe_credentials"):self.apply()
        self.assertEqual(self.calls,[])

    def test_writable_git_config_rejected_before_git_or_release_checks(self):
        (self.checkout/".git/config").chmod(0o666)
        with self.assertRaisesRegex(Exception,"unsafe_adapter"):self.apply()
        self.assertEqual(self.calls,[])

    def test_operator_activation_preserves_config_and_writes_policy_last(self):
        (self.checkout/"ops/test-env.py").write_text("# synthetic fixture\n")
        self.real_run(["git","-C",str(self.checkout),"add","."], check=True, stdout=subprocess.DEVNULL)
        self.real_run(["git","-C",str(self.checkout),"-c","user.name=Synthetic","-c","user.email=synthetic@example.invalid","commit","-m","activation"],check=True,stdout=subprocess.DEVNULL)
        sha=self.real_run(["git","-C",str(self.checkout),"rev-parse","HEAD"],check=True,capture_output=True,text=True).stdout.strip()
        self.real_run(["git","-C",str(self.checkout),"update-ref","refs/remotes/origin/main",sha],check=True)
        self.data["source_commit"]=sha
        m=self.root/"release.json";m.write_text(json.dumps(self.data))
        managed=self.root/"managed-config";managed.mkdir();(managed/"managed").write_text("managed-v1\n")
        before=self.config.read_text()
        fake_install=types.SimpleNamespace(CONFIG=managed,LIB=self.lib,safe_dir=installer.safe_dir,write=installer.write)
        original_load=enable.load
        with patch.object(enable,"STATE_DIR",self.root/"state"), patch.object(enable,"load",side_effect=lambda name,p: fake_install if name=="install" else self.fake_gate if name=="gate" else original_load(name,p)):
            enable.enable(self.checkout,m,self.config_dir)
            self.assertEqual(self.config.read_text(),before)
            self.assertEqual(json.loads((managed/"release.json").read_text())["source_commit"],sha)
            self.assertEqual((managed/"release.json").stat().st_mode & 0o777,0o600)
            self.assertFalse(any(c[0]=="/usr/bin/docker" for c in self.calls))
            with self.assertRaisesRegex(ValueError,"already_enabled"):enable.enable(self.checkout,m,self.config_dir)


if __name__ == "__main__":unittest.main(verbosity=2)
