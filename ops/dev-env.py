#!/usr/bin/env python3
"""Create disposable local configuration; never overwrite an existing .env."""
from pathlib import Path
import secrets
root = Path(__file__).resolve().parents[1]
password = secrets.token_hex(24)
try:
    with (root / '.env').open('x') as env:
        (root / '.env').chmod(0o600)
        env.write(f'POSTGRES_PASSWORD={password}\nPOSTGRES_PORT=54329\nHTTP_PORT=8080\n'
                  f'DATABASE_URL=postgres://judeos_dev:{password}@127.0.0.1:54329/judeos_dev?sslmode=disable\n')
    print('Created ignored .env for synthetic local development (mode 0600).')
except FileExistsError:
    print('Existing .env preserved.')
