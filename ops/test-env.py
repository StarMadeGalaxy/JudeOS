#!/usr/bin/env python3
"""Create a separate synthetic test configuration outside the Git checkout."""
import argparse
import ipaddress
from pathlib import Path
import re
import secrets

ROOT = Path(__file__).resolve().parents[1]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory', type=Path, required=True)
    p.add_argument('--domain', default='localhost')
    p.add_argument('--image', default='judeos-release:local')
    p.add_argument('--public', action='store_true', help='Public ACME; requires real DNS and digest')
    p.add_argument('--project', default='judeos-test')
    p.add_argument('--https-port', type=int, default=8443)
    p.add_argument('--http-port', type=int, default=8088)
    a = p.parse_args()
    directory = a.directory.resolve()
    if directory == ROOT or ROOT in directory.parents:
        p.error('Configuration/secrets must be outside checkout')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,50}', a.project):
        p.error('Use a unique lowercase Compose project name')
    if len(a.domain) > 253 or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', part) for part in a.domain.split('.')):
        p.error('Domain must be a hostname without URL, port or wildcard')
    if not re.fullmatch(r'[a-zA-Z0-9./:_@-]+', a.image):
        p.error('Invalid image reference')
    if not all(1 <= port <= 65535 for port in (a.https_port, a.http_port)) or a.https_port == a.http_port:
        p.error('Choose distinct valid ports')
    try:
        ipaddress.ip_address(a.domain)
        is_ip = True
    except ValueError:
        is_ip = False
    if a.public and (is_ip or '.' not in a.domain or a.domain.endswith(('.localhost', '.invalid', '.test'))
                     or not re.fullmatch(r'.+@sha256:[0-9a-f]{64}', a.image)
                     or (a.http_port, a.https_port) != (80, 443)):
        p.error('Public mode requires real DNS, an immutable image digest and ports 80/443')
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    password = secrets.token_hex(24)
    migration_password = secrets.token_hex(24)
    runtime_password = secrets.token_hex(24)
    files = {
        'db-password': password + '\n',
        'bootstrap-secrets.env': f'BOOTSTRAP_DATABASE_URL=postgres://judeos_test:{password}@db:5432/judeos_test?sslmode=disable\n'
                                 f'MIGRATION_PASSWORD={migration_password}\nRUNTIME_PASSWORD={runtime_password}\n',
        'migration-secrets.env': f'MIGRATION_DATABASE_URL=postgres://judeos_migrator:{migration_password}@db:5432/judeos_test?sslmode=disable\n',
        'api-secrets.env': f'PUBLIC_ORIGIN=https://{a.domain}{":" + str(a.https_port) if a.https_port != 443 else ""}\n'
                           f'DATABASE_URL=postgres://judeos_runtime:{runtime_password}@db:5432/judeos_test?sslmode=disable\n',
        'test.env': f'COMPOSE_PROJECT_NAME={a.project}\nTEST_CONFIG_DIR={directory}\n'
                    f'TEST_IMAGE={a.image}\nTEST_DOMAIN={a.domain}\n'
                    f'TEST_BIND_ADDR={"0.0.0.0" if a.public else "127.0.0.1"}\n'
                    f'TEST_HTTP_PORT={a.http_port}\nTEST_HTTPS_PORT={a.https_port}\n'
                    f'TEST_CADDYFILE={ROOT / "ops" / ("test-public.Caddyfile" if a.public else "test-local.Caddyfile")}\n'
    }
    # Compose env-file syntax: reject paths that require shell/Compose expansion.
    if any(c in str(directory) + str(ROOT) for c in '\n\r$#"\' \\'):
        directory.rmdir()
        p.error('Use configuration/checkout paths without spaces or expansion characters')
    for name, content in files.items():
        with (directory / name).open('x') as f:
            (directory / name).chmod(0o600)
            f.write(content)
    print('Created isolated synthetic test config (directory 0700, files 0600); existing config is never overwritten.')

if __name__ == '__main__':
    main()
