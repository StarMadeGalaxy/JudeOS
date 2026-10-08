#!/usr/bin/env python3
"""Build the current scaffold without changing its Dockerfile; never publish."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def run(args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True, help='Directory outside checkout')
    p.add_argument('--image', default='judeos-release:local')
    p.add_argument('--builder', required=True, help='Dedicated docker-container BuildKit builder')
    p.add_argument('--allow-dirty', action='store_true', help='Local verification only')
    p.add_argument('--verify-rebuild', action='store_true')
    p.add_argument('--prune-between-builds', action='store_true', help='Explicitly prune build cache on a dedicated builder only')
    a = p.parse_args()
    output = a.output.resolve()
    if output == ROOT or ROOT in output.parents:
        p.error('Output must be outside checkout')
    # Build/publish still address artifacts by config ID. Containerd's .Id is
    # a manifest digest; stop before building or writing mislabeled metadata.
    store = json.loads(run(['docker', 'info', '--format', '{{json .DriverStatus}}'])) or []
    if ['driver-type', 'io.containerd.snapshotter.v1'] in store:
        p.error('Release build requires the classic Docker image store (config image IDs)')
    builder = run(['docker', 'buildx', 'inspect', a.builder])
    if not re.search(r'^Driver:\s+docker-container\s*$', builder, re.MULTILINE):
        p.error('Use a dedicated docker-container builder; Docker driver cannot normalize layer timestamps')
    if not re.search(r'BuildKit version:\s+v0\.24\.0\s*$', builder, re.MULTILINE):
        p.error('Use the pinned BuildKit 0.24.0 builder from release-builder.py')
    dirty = bool(run(['git', 'status', '--porcelain']))
    if dirty and not a.allow_dirty:
        p.error('Commit all changes first; --allow-dirty is local verification only')
    sha = run(['git', 'rev-parse', 'HEAD'])
    epoch = run(['git', 'show', '-s', '--format=%ct', 'HEAD'])
    version_match = re.search(r'const Version int64 = (\d+)', (ROOT / 'db/migrations/migrations.go').read_text())
    if not version_match:
        p.error('Migration version interface changed; review release metadata')
    output.mkdir(parents=True, exist_ok=True)
    args = ['docker', 'buildx', 'build', '--builder', a.builder, '--output', 'type=docker,rewrite-timestamp=true', '--platform', 'linux/amd64',
            '--provenance=false', '--build-arg', 'SOURCE_DATE_EPOCH=' + epoch,
            '--label', 'org.opencontainers.image.revision=' + sha,
            '--label', 'org.opencontainers.image.version=sha-' + sha,
            '--label', 'org.opencontainers.image.source=https://github.com/StarMadeGalaxy/JudeOS',
            '--label', 'org.opencontainers.image.created=' + run(['git', 'show', '-s', '--format=%cI', 'HEAD']),
            '--tag', a.image, '--file', 'ops/Dockerfile']
    ca = os.environ.get('BUILD_CA_PATH')
    if ca:
        if not Path(ca).is_file():
            p.error('BUILD_CA_PATH must name an existing public CA bundle')
        args += ['--secret', 'id=build_ca,src=' + ca]
    subprocess.run(args + ['.'], cwd=ROOT, check=True)
    image_id = run(['docker', 'image', 'inspect', a.image, '--format', '{{.Id}}'])
    if a.verify_rebuild:
        if a.prune_between_builds:
            subprocess.run(['docker', 'buildx', 'prune', '--builder', a.builder, '--all', '--force'], check=True)
        subprocess.run(args + ['--no-cache', '.'], cwd=ROOT, check=True)
        if image_id != run(['docker', 'image', 'inspect', a.image, '--format', '{{.Id}}']):
            raise SystemExit('Clean rebuild image IDs differ; do not release')
    if run(['git', 'rev-parse', 'HEAD']) != sha or (not a.allow_dirty and run(['git', 'status', '--porcelain'])):
        raise SystemExit('Source checkout changed during build; do not release')
    metadata = {'source_commit': sha, 'source_date_epoch': int(epoch), 'dirty': dirty,
                'platform': 'linux/amd64', 'buildkit_version': '0.24.0', 'local_image_id': image_id,
                'schema_version': int(version_match[1]),
                'migrations': {f.name: hashlib.sha256(f.read_bytes()).hexdigest()
                               for f in sorted((ROOT / 'db/migrations').glob('*.sql'))},
                'rebuild_verified': a.verify_rebuild,
                'registry_digest': None, 'previous_compatible_release': None}
    (output / 'release.json').write_text(json.dumps(metadata, indent=2) + '\n')
    subprocess.run(['docker', 'save', '--output', str(output / 'image.tar'), a.image], check=True)
    print('Built image and release.json; registry digest and rollback compatibility are not asserted.')

if __name__ == '__main__':
    main()
