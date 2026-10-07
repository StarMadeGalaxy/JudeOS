#!/usr/bin/env python3
"""Synthetic tampering tests; no registry publication or VPS access."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('release_check', Path(__file__).with_name('test-release-check.py'))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)
COMMIT = 'a' * 40
CONFIG_ID = 'sha256:' + 'b' * 64
IMAGE = 'ghcr.io/starmadegalaxy/judeos@sha256:' + 'c' * 64


class ReleaseCheckTests(unittest.TestCase):
    def setUp(self):
        import re
        self.manifest = {'dirty': False, 'rebuild_verified': True, 'platform': 'linux/amd64',
                         'source_commit': COMMIT, 'registry_digest': IMAGE, 'local_image_id': CONFIG_ID,
                         'release_tag': 'v0.0.0-synthetic-test',
                         'schema_version': int(re.search(r'const Version int64 = (\d+)',
                             (check.ROOT / 'db/migrations/migrations.go').read_text())[1]),
                         'migrations': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                             for p in (check.ROOT / 'db/migrations').glob('*.sql')}}

    def test_valid_manifest_identity(self):
        self.assertEqual(check.validate_manifest(self.manifest, COMMIT, check.ROOT), IMAGE)

    def test_artifact_and_tampered_manifest_rejected(self):
        bad_values = {'dirty': True, 'rebuild_verified': False, 'source_commit': 'd' * 40,
                      'platform': 'linux/arm64', 'registry_digest': CONFIG_ID,
                      'release_tag': '', 'local_image_id': 'latest', 'schema_version': -1}
        for field, value in bad_values.items():
            with self.subTest(field=field):
                data = dict(self.manifest, **{field: value})
                with self.assertRaises(ValueError):
                    check.validate_manifest(data, COMMIT, check.ROOT)
        for value in (None, 'ghcr.io/starmadegalaxy/judeos:latest',
                      'ghcr.io/another/image@sha256:' + 'c' * 64):
            with self.subTest(digest=value), self.assertRaises(ValueError):
                check.validate_manifest(dict(self.manifest, registry_digest=value), COMMIT, check.ROOT)

    def test_sql_tampering_with_same_schema_rejected(self):
        data = copy.deepcopy(self.manifest)
        name = next(iter(data['migrations']))
        data['migrations'][name] = '0' * 64
        with self.assertRaises(ValueError):
            check.validate_manifest(data, COMMIT, check.ROOT)

    def run_check(self, dirty=False, image_identity=None, accepted=True):
        with tempfile.TemporaryDirectory(prefix='judeos-release-check-test-') as directory:
            manifest = Path(directory) / 'release.json'
            manifest.write_text(json.dumps(self.manifest))
            def output(args, **kwargs):
                if args[0] == 'git':
                    return (' M ops/test-compose.yaml\n' if dirty else '') if 'status' in args else COMMIT + '\n'
                return image_identity or f'{CONFIG_ID}\nlinux/amd64\n{COMMIT}\nsha-{COMMIT}\n'
            def run(args, **kwargs):
                if 'merge-base' in args and not accepted:
                    raise subprocess.CalledProcessError(1, args)
            with patch.object(sys, 'argv', ['test-release-check.py', '--manifest', str(manifest), '--pull']), \
                    patch.object(check.subprocess, 'check_output', side_effect=output), \
                    patch.object(check.subprocess, 'run', side_effect=run) as calls, \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                try:
                    check.main()
                    status = 0
                except SystemExit as e:
                    status = e.code
                return status, [call.args[0] for call in calls.call_args_list]

    def test_pull_only_after_accepted_clean_source(self):
        status, calls = self.run_check()
        self.assertEqual(status, 0)
        self.assertIn(['docker', 'pull', IMAGE], calls)
        for options in ({'dirty': True}, {'accepted': False}):
            status, calls = self.run_check(**options)
            self.assertEqual(status, 1)
            self.assertFalse(any(call[0] == 'docker' for call in calls))

    def test_loaded_image_identity_mismatch_rejected(self):
        for identity in ('sha256:' + 'd' * 64, CONFIG_ID + '\nlinux/arm64\n' + COMMIT,
                         f'{CONFIG_ID}\nlinux/amd64\n' + 'e' * 40 + '\nsha-' + COMMIT):
            with self.subTest(identity=identity):
                status, _ = self.run_check(image_identity=identity)
                self.assertEqual(status, 1)


if __name__ == '__main__':
    unittest.main()
