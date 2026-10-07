#!/usr/bin/env python3
"""Operate the standalone synthetic stack using an explicit external config."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('test_probe', ROOT / 'ops/test-probe.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config', type=Path, required=True, help='External test.env')
    p.add_argument('--url', help='HTTPS origin reachable by probe; default https://domain:port')
    p.add_argument('--ca', type=Path, help='CA bundle for local HTTPS; omit for public CA')
    p.add_argument('command', choices=['up', 'down', 'status', 'export-ca', 'check', 'exercise'])
    a = p.parse_args()
    config = a.config.resolve()
    if config == ROOT or ROOT in config.parents:
        p.error('Use config outside checkout')
    values = dict(line.split('=', 1) for line in config.read_text().splitlines() if line and not line.startswith('#'))
    if values['COMPOSE_PROJECT_NAME'] == 'judeos-synthetic':
        p.error('Test project must differ from development project')
    # Ignore unrelated caller interpolation variables; preserve proxy, TLS and credentials.
    env = {k: v for k, v in os.environ.items() if not k.startswith('TEST_') and k != 'COMPOSE_PROJECT_NAME'}
    compose = ['docker', 'compose', '--project-name', values['COMPOSE_PROJECT_NAME'],
               '--env-file', str(config), '-f', str(ROOT / 'ops/test-compose.yaml')]
    def command(args, capture=False):
        if capture:
            return subprocess.check_output(compose + args, cwd=ROOT, env=env, text=True).strip()
        subprocess.run(compose + args, cwd=ROOT, env=env, check=True)
    if a.command in ('up', 'down', 'status'):
        command({'up': ['up', '-d', '--wait', '--wait-timeout', '90'],
                 'down': ['down'], 'status': ['ps', '-a']}[a.command])
        return
    if a.command == 'export-ca':
        dest = config.parent / 'local-root.crt'
        deadline = time.monotonic() + 30
        while True:
            result = subprocess.run(compose + ['cp', 'edge:/data/caddy/pki/authorities/local/root.crt', str(dest)],
                                    cwd=ROOT, env=env, capture_output=True)
            if result.returncode == 0:
                print('Exported public local-root.crt; trust only for this synthetic local test.')
                return
            if time.monotonic() >= deadline:
                raise SystemExit('Local CA not ready; check edge startup')
            time.sleep(1)
    # Verify actual Docker bindings and network, not just YAML declarations.
    db_id = command(['ps', '-q', 'db'], capture=True)
    db = json.loads(subprocess.check_output(['docker', 'inspect', db_id], text=True))[0]
    if db['HostConfig']['PortBindings']:
        raise SystemExit('Database has published ports')
    for network in db['NetworkSettings']['Networks']:
        info = json.loads(subprocess.check_output(['docker', 'network', 'inspect', network], text=True))[0]
        if not info['Internal']:
            raise SystemExit('Database network is not internal')
    url = a.url or f'https://{values["TEST_DOMAIN"]}:{values["TEST_HTTPS_PORT"]}'
    def wait_ready(expected):
        deadline = time.monotonic() + 60
        while True:
            results = module.probe(url, a.ca, expected)
            if all(r['status'] == r['expected_status'] for r in results):
                print(json.dumps({'db_ports': 'none', 'db_network': 'internal', 'http': results}))
                return
            if time.monotonic() >= deadline:
                raise SystemExit('HTTPS/readiness checks failed: ' + json.dumps(results))
            time.sleep(1)
    wait_ready(200)
    if a.command == 'exercise':
        # Never use this failure exercise on a shared or production environment.
        command(['stop', 'db'])
        try:
            wait_ready(503)
        finally:
            command(['start', 'db'])
        wait_ready(200)

if __name__ == '__main__':
    main()
