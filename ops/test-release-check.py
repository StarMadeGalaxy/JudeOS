#!/usr/bin/env python3
"""Verify a published synthetic-test image against an accepted clean checkout."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def validate_manifest(data, commit, root):
    if (data.get('dirty') is not False or data.get('rebuild_verified') is not True
            or data.get('platform') != 'linux/amd64'
            or not re.fullmatch(r'[0-9a-f]{40}', data.get('source_commit', ''))
            or data['source_commit'] != commit):
        raise ValueError('Release must be clean, rebuild-verified linux/amd64 from this checkout')
    image = data.get('registry_digest', '')
    if not isinstance(image, str) or not re.fullmatch(r'ghcr.io/starmadegalaxy/judeos@sha256:[0-9a-f]{64}', image):
        raise ValueError('Use the published JudeOS registry digest, not an artifact ID or mutable tag')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', data.get('local_image_id', '')):
        raise ValueError('Release image config ID is missing')
    if not re.fullmatch(r'v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', data.get('release_tag', '')):
        raise ValueError('Published release tag is missing')
    version = re.search(r'const Version int64 = (\d+)', (root / 'db/migrations/migrations.go').read_text())
    migrations = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in sorted((root / 'db/migrations').glob('*.sql'))}
    if not version or data.get('schema_version') != int(version[1]) or data.get('migrations') != migrations:
        raise ValueError('Release migration version/hashes do not match checkout')
    return image


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest', type=Path, required=True)
    p.add_argument('--pull', action='store_true', help='Pull the validated digest before checking local image')
    a = p.parse_args()
    try:
        data = json.loads(a.manifest.read_text())
        if not isinstance(data, dict):
            raise ValueError('Manifest must be a JSON object')
        def git(*args):
            return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True, stderr=subprocess.DEVNULL).strip()
        commit = git('rev-parse', 'HEAD')
        if git('status', '--porcelain'):
            raise ValueError('Use a clean accepted checkout; keep manifests/config outside Git')
        subprocess.run(['git', '-C', str(ROOT), 'merge-base', '--is-ancestor', commit,
                        'refs/remotes/origin/main'], check=True, stderr=subprocess.DEVNULL)
        image = validate_manifest(data, commit, ROOT)
        if a.pull:
            subprocess.run(['docker', 'pull', image], check=True, stdout=sys.stderr)
        # Inspect only identity fields. Never emit container/image environment or credentials.
        fmt = '{{.Id}}\n{{.Os}}/{{.Architecture}}\n{{index .Config.Labels "org.opencontainers.image.revision"}}\n{{index .Config.Labels "org.opencontainers.image.version"}}'
        identity = subprocess.check_output(['docker', 'image', 'inspect', image, '--format', fmt],
                                           text=True, stderr=subprocess.DEVNULL).splitlines()
        if identity != [data['local_image_id'], 'linux/amd64', commit, 'sha-' + commit]:
            raise ValueError('Pulled image ID/platform/source labels do not match release')
        if git('rev-parse', 'HEAD') != commit or git('status', '--porcelain'):
            raise ValueError('Checkout changed during verification')
        print(json.dumps({'image': image, 'source_commit': commit, 'schema_version': data['schema_version'],
                          'release_tag': data['release_tag'], 'verified': True}))
    except (OSError, ValueError, TypeError, subprocess.CalledProcessError):
        print('Release check failed: require published manifest, accepted clean main checkout and matching image/schema.', file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
