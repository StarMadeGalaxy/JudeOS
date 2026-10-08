#!/usr/bin/env python3
"""Run real role/RLS/audit/upgrade checks in a disposable synthetic database."""
import os
from pathlib import Path
import subprocess
import uuid
from urllib.parse import urlsplit, urlunsplit

root = Path(__file__).resolve().parents[1]
values = dict(line.split('=', 1) for line in (root / '.env').read_text().splitlines()
              if line and not line.startswith('#'))
name = 'judeos_check_' + uuid.uuid4().hex
compose = ['docker', 'compose', '--env-file', '.env', '-f', 'ops/compose.yaml']

def sql(statement):
    subprocess.run(compose + ['exec', '-T', 'db', 'psql', '-U', 'judeos_dev', '-d', 'postgres',
                              '-v', 'ON_ERROR_STOP=1', '-c', statement], cwd=root, check=True)

env = os.environ.copy()
for key, source in [('JUDEOS_TEST_DATABASE_URL', 'BOOTSTRAP_DATABASE_URL'),
                    ('JUDEOS_TEST_MIGRATION_URL', 'MIGRATION_DATABASE_URL'),
                    ('JUDEOS_TEST_RUNTIME_URL', 'DATABASE_URL')]:
    url = urlsplit(values[source])
    env[key] = urlunsplit(url._replace(path='/' + name))
env['JUDEOS_TEST_MIGRATION_PASSWORD'] = values['MIGRATION_PASSWORD']
env['JUDEOS_TEST_RUNTIME_PASSWORD'] = values['RUNTIME_PASSWORD']
sql(f'CREATE DATABASE {name}')
try:
    subprocess.run([os.environ.get('JUDEOS_GO', 'go'), 'test', '-race', '-count=1', '-v',
                    './internal/platform/database'], cwd=root, env=env, check=True)
    subprocess.run([os.environ.get('JUDEOS_GO', 'go'), 'test', '-race', '-count=1', '-v',
                    './internal/platform/httpapi'], cwd=root, env=env, check=True)
finally:
    sql(f'DROP DATABASE {name} WITH (FORCE)')
