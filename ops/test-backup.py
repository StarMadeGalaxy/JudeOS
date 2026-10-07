#!/usr/bin/env python3
"""Back up and restore-check only this synthetic test stack, never production."""
import argparse
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True, help='New dump file outside checkout')
    a = p.parse_args()
    output, config = a.output.resolve(), a.config.resolve()
    if any(f == ROOT or ROOT in f.parents for f in (output, config)):
        p.error('Use config and backup outside checkout')
    values = dict(line.split('=', 1) for line in config.read_text().splitlines() if line and not line.startswith('#'))
    if values['COMPOSE_PROJECT_NAME'] == 'judeos-synthetic':
        p.error('Requires an isolated test project')
    compose = ['docker', 'compose', '--project-name', values['COMPOSE_PROJECT_NAME'],
               '--env-file', str(config), '-f', str(ROOT / 'ops/test-compose.yaml'), 'exec', '-T', 'db']
    with output.open('xb') as f:
        output.chmod(0o600)
        subprocess.run(compose + ['pg_dump', '-U', 'judeos_test', '-d', 'judeos_test', '-Fc'], stdout=f, check=True)
    name = 'restore_check_' + uuid.uuid4().hex
    subprocess.run(compose + ['createdb', '-U', 'judeos_test', name], check=True)
    try:
        with output.open('rb') as f:
            subprocess.run(compose + ['pg_restore', '-U', 'judeos_test', '-d', name, '--exit-on-error', '--no-owner'], stdin=f, check=True)
        # Compare schema and synthetic fixture count, then remove only our random test DB.
        sql = 'SELECT version_id FROM goose_db_version WHERE is_applied ORDER BY id DESC LIMIT 1; SELECT count(*) FROM development.sample_clubs; SELECT count(*) FROM core.clubs; SELECT count(*) FROM development.sample_objects; SELECT count(*) FROM core.audit_events;'
        original = subprocess.check_output(compose + ['psql', '-U', 'judeos_test', '-d', 'judeos_test', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql])
        restored = subprocess.check_output(compose + ['psql', '-U', 'judeos_test', '-d', name, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql])
        if original != restored:
            raise SystemExit('Restored schema/fixture count differs')
    finally:
        subprocess.run(compose + ['dropdb', '-U', 'judeos_test', name], check=True)
    print('Synthetic backup saved mode 0600; isolated restore schema/fixture check passed. No production/RPO/RTO assertion.')

if __name__ == '__main__':
    main()
