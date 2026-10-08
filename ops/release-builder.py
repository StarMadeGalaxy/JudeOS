#!/usr/bin/env python3
"""Create a dedicated BuildKit builder, keeping Docker's configured proxy/trust."""
import argparse
import csv
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

BUILDKIT = 'moby/buildkit:v0.24.0@sha256:6eceb8971ce4fceb3daca562832642706238b7eea72941fcf9896c93c3c4a53e'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--name', default='judeos-release')
    a = p.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,50}', a.name):
        p.error('Use a distinct lowercase builder name')
    if subprocess.run(['docker', 'buildx', 'inspect', a.name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        p.error('Builder already exists; inspect/reuse explicitly, never replace it')
    args = ['docker', 'buildx', 'create', '--name', a.name, '--driver', 'docker-container',
            '--driver-opt', 'image=' + BUILDKIT]
    config = Path(os.environ.get('DOCKER_CONFIG', str(Path.home() / '.docker'))) / 'config.json'
    # Select only proxy bindings. Never print the config or credential fields.
    proxies = json.loads(config.read_text()).get('proxies', {}) if config.exists() else {}
    proxy = proxies.get('unix:///var/run/docker.sock', proxies.get('default', {}))
    for key, name in [('httpProxy', 'HTTP_PROXY'), ('httpsProxy', 'HTTPS_PROXY'), ('noProxy', 'NO_PROXY')]:
        value = proxy.get(key, os.environ.get(name))
        if value:
            field = io.StringIO()
            csv.writer(field).writerow(['env.' + name + '=' + value])
            args += ['--driver-opt', field.getvalue().strip()]

    ca = os.environ.get('BUILD_CA_PATH')
    if ca and not Path(ca).is_file():
        p.error('BUILD_CA_PATH must name an existing public CA bundle')
    with tempfile.TemporaryDirectory(prefix='judeos-buildkit-') as tmp:
        cfg = Path(tmp) / 'buildkitd.toml'
        text = '[worker.oci]\n  max-parallelism = 2\n'
        if ca:
            # Buildx copies these public CA files into the dedicated builder.
            for registry in ['docker.io', 'registry-1.docker.io', 'auth.docker.io', 'ghcr.io']:
                text += f'[registry.{json.dumps(registry)}]\n  ca = [{json.dumps(str(Path(ca).resolve()))}]\n'
        cfg.write_text(text)
        args += ['--buildkitd-config', str(cfg)]
        result = subprocess.run(args, capture_output=True)
        if result.returncode:
            raise SystemExit('Builder creation failed; configured proxy values were not printed')
    result = subprocess.run(['docker', 'buildx', 'inspect', '--bootstrap', a.name], capture_output=True)
    if result.returncode:
        raise SystemExit('Builder bootstrap failed; inspect supported Docker/network readiness without dumping driver credentials')
    print('Dedicated builder ready; pass --builder explicitly. Existing Docker context was preserved.')

if __name__ == '__main__':
    main()
