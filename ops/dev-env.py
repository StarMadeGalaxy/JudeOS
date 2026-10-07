#!/usr/bin/env python3
"""Create/upgrade ignored synthetic local config without changing stored passwords."""
from pathlib import Path
import secrets
from urllib.parse import urlsplit, urlunsplit, quote

root = Path(__file__).resolve().parents[1]
path = root / '.env'
text = path.read_text() if path.exists() else ''
values = dict(line.split('=', 1) for line in text.splitlines()
              if line and not line.startswith('#') and '=' in line)
def add(key, value):
    global text
    if key not in values:
        if text and not text.endswith('\n'):
            text += '\n'
        text += f'{key}={value}\n'
        values[key] = value

add('POSTGRES_PASSWORD', secrets.token_hex(24))
add('MIGRATION_PASSWORD', secrets.token_hex(24))
add('RUNTIME_PASSWORD', secrets.token_hex(24))
add('POSTGRES_PORT', '54329')
add('HTTP_PORT', '8080')
base = values.get('DATABASE_URL', f"postgres://judeos_dev@127.0.0.1:{values['POSTGRES_PORT']}/judeos_dev?sslmode=disable")
url = urlsplit(base)
def dsn(user, password):
    host = url.hostname or '127.0.0.1'
    if ':' in host:
        host = '[' + host + ']'
    return urlunsplit(url._replace(netloc=f'{user}:{quote(password, safe="")}@{host}:{url.port or 54329}'))
add('BOOTSTRAP_DATABASE_URL', dsn('judeos_dev', values['POSTGRES_PASSWORD']))
add('MIGRATION_DATABASE_URL', dsn('judeos_migrator', values['MIGRATION_PASSWORD']))
if 'DATABASE_URL' not in values:
    add('DATABASE_URL', dsn('judeos_runtime', values['RUNTIME_PASSWORD']))
elif url.username == 'judeos_dev':
    # Known #19 default only; preserve customized DSNs, ports and admin password.
    text = '\n'.join('DATABASE_URL=' + dsn('judeos_runtime', values['RUNTIME_PASSWORD'])
                     if line.startswith('DATABASE_URL=') else line for line in text.splitlines()) + '\n'
if not path.exists() or path.read_text() != text:
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    path.write_text(text)
    print('Created/upgraded ignored synthetic .env (mode 0600); existing passwords preserved.')
else:
    print('Existing .env preserved.')
