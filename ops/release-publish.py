#!/usr/bin/env python3
"""Publish an already checked image in a GitHub Actions tag run (no deployment)."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory', type=Path, required=True)
    p.add_argument('--tag', required=True)
    a = p.parse_args()
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?', a.tag):
        p.error('Use a SemVer release tag vMAJOR.MINOR.PATCH[-prerelease]')
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REF') != 'refs/tags/' + a.tag:
        p.error('Publishing is only allowed in the checked GitHub Actions tag run')
    # Artifact config IDs must remain addressable; do not load/login/push on
    # a containerd store whose .Id has different semantics.
    store = json.loads(subprocess.check_output(
        ['docker', 'info', '--format', '{{json .DriverStatus}}'], text=True)) or []
    if ['driver-type', 'io.containerd.snapshotter.v1'] in store:
        p.error('Release publish requires the classic Docker image store (config image IDs)')
    manifest = a.directory / 'release.json'
    data = json.loads(manifest.read_text())
    subprocess.run(['git', 'merge-base', '--is-ancestor', os.environ['GITHUB_SHA'], 'origin/main'], check=True)
    if data['dirty'] or not data['rebuild_verified'] or data['source_commit'] != os.environ['GITHUB_SHA']:
        p.error('Artifact must be a verified clean build of this exact commit')
    repo = os.environ['GITHUB_REPOSITORY']
    image = 'ghcr.io/' + repo.lower()
    sha_tag = image + ':sha-' + data['source_commit']
    subprocess.run(['docker', 'load', '--input', str(a.directory / 'image.tar')], check=True)
    # Fail rather than guessing if artifact load did not produce the declared image ID.
    subprocess.run(['docker', 'image', 'inspect', data['local_image_id']], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['docker', 'login', 'ghcr.io', '--username', os.environ['GITHUB_ACTOR'], '--password-stdin'],
                   input=os.environ['GH_TOKEN'].encode(), check=True)
    try:
        # Release tags are immutable by convention; fail if a tag already exists.
        releases = json.loads(subprocess.check_output(['gh', 'api', '--paginate', '--slurp', f'repos/{repo}/releases'], text=True))
        if any(r['tag_name'] == a.tag for page in releases for r in page):
            raise SystemExit('Release already exists; do not overwrite')
        tags = (sha_tag, image + ':' + a.tag)
        for tag in tags:
            existing = subprocess.run(['docker', 'manifest', 'inspect', tag], capture_output=True, text=True)
            if existing.returncode == 0:
                remote = json.loads(existing.stdout)
                if remote.get('config', {}).get('digest') != data['local_image_id']:
                    raise SystemExit('Registry tag exists with different image; do not overwrite')
            elif not any(marker in existing.stderr.lower() for marker in ('manifest unknown', 'no such manifest', 'not found')):
                raise SystemExit('Cannot establish registry tag state; stop publishing')
        for tag in tags:
            subprocess.run(['docker', 'tag', data['local_image_id'], tag], check=True)
            subprocess.run(['docker', 'push', tag], check=True)
        digests = json.loads(subprocess.check_output(['docker', 'image', 'inspect', sha_tag, '--format', '{{json .RepoDigests}}'], text=True))
        digest = next(d for d in digests if d.startswith(image + '@sha256:'))
        data.update({'release_tag': a.tag, 'registry_digest': digest})
        manifest.write_text(json.dumps(data, indent=2) + '\n')
        notes = a.directory / 'notes.md'
        notes.write_text(f'Commit: `{data["source_commit"]}`\n\nImage: `{digest}`\n\n'
                         f'Schema: `{data["schema_version"]}`. Previous compatible release: **not established**. '
                         'Compare migration hashes and exercise candidate readiness before rollback; see docs/operations/releases.md.\n')
        subprocess.run(['gh', 'release', 'create', a.tag, str(manifest), '--repo', repo,
                        '--verify-tag', '--title', a.tag, '--notes-file', str(notes)], check=True)
    finally:
        subprocess.run(['docker', 'logout', 'ghcr.io'], check=False)

if __name__ == '__main__':
    main()
