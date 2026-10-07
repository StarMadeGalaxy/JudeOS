#!/usr/bin/env python3
"""Test migrations on a new disposable database in the local synthetic Compose DB."""
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

url = urlsplit(values['DATABASE_URL'])
env = os.environ.copy()
env['JUDEOS_TEST_DATABASE_URL'] = urlunsplit(url._replace(path='/' + name))
sql(f'CREATE DATABASE {name}')
try:
    subprocess.run([os.environ.get('JUDEOS_GO', 'go'), 'test', '-race', '-count=1',
                    './internal/platform/database'], cwd=root, env=env, check=True)
finally:
    sql(f'DROP DATABASE {name} WITH (FORCE)')
