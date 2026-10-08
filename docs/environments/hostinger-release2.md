# Продолжение первой установки: v0.1.0-test.2

Оператор — NikishGum. PR #95/#96 приняты; source нового synthetic release —
`0c224452ef4f060613b6838d8f787ce997043337`. [Передача #22](https://github.com/StarMadeGalaxy/JudeOS/issues/91#issuecomment-6056635669),
[пути и порядок #91](https://github.com/StarMadeGalaxy/JudeOS/issues/91#issuecomment-6057114004).
Это получение и проверка, **не enable/bootstrap/deploy**. Старые
`/srv/judeos-test`, `/var/lib/judeos-test-release/release.json` и
`/root/judeos-deploy-setup` сохраняются. Новый checkout одновременно служит
проверенным источником adapter code; config/secrets/volumes пока не создаются.

| Значение | Проверенный идентификатор |
|---|---|
| Tag | `v0.1.0-test.2` |
| Source | `0c224452ef4f060613b6838d8f787ce997043337` |
| Manifest SHA256 | `c9067f38b4aa7f0b8d709c8c74cc473a1181d7c73c62adadb442edd892ef85d6` |
| Registry image | `ghcr.io/starmadegalaxy/judeos@sha256:f60e513f0ae5a8aaf15835763f26600cc4371ac56a62c690e90564326bf4a373` |
| Config digest | `sha256:feb6a42b457c474473c07aa49914484c458ecd3f86e6e2aa0770b57cf0046bf0` |
| Новый checkout/adapter source | `/srv/judeos-test-v0.1.0-test.2` |
| Новый manifest | `/var/lib/judeos-test-release-v0.1.0-test.2/release.json` |

Gate #91, exact manifest SHA256/source/schema3/SQL и все пять
[tag CI jobs](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37754148019)
проверены. #22 проверила anonymous pull/full checker на реальном Docker29 в
облаке; оператор повторяет identity check на VPS. Proxy/CA/TLS сохраняются.

## 1. Причина failed Apply и безопасное состояние

[Auto run37754469953](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37754469953):
selection success, Apply failure, public check skipped. Raw logs среде #91
недоступны (Forbidden), точный server error пока неизвестен. Если установлен
первоначальный transport5368010, tagged request отвергается entry с
`command_denied` ещё до controller. Если transport обновлён, но policy отсутствует,
controller возвращает `release_adapter_unconfigured` **до lock/adapter/up**.
Нельзя заменять tagged request legacy-командой для обхода этой остановки.

На **Mac**, где работает gh, получить только нейтральный код из уже завершённого
run (не запускает workflow и не печатает остальные logs):

```bash
set -euo pipefail
gh run view 37754469953 -R StarMadeGalaxy/JudeOS --log-failed |
python3 -c 'import json, sys
allowed = {"command_denied", "release_adapter_unconfigured", "deployment_busy", "unsafe_adapter", "unsafe_lock", "release_failed", "controller_failed", "controller_unavailable", "ssh_connection_or_response_failed", "root_controller_required", "invalid_release_policy"}
found = False
for line in sys.stdin:
    start = line.find("{")
    if start < 0: continue
    try: data = json.loads(line[start:])
    except ValueError: continue
    if isinstance(data, dict) and isinstance(data.get("ok"), bool) and data.get("code") in allowed:
        print(json.dumps({"ok": data["ok"], "code": data["code"]})); found = True
if not found: print("No allowlisted server result found; do not retry deploy.")'
```

В **Bash root-консоли VPS** выполнить read-only блок и передать вывод #91:

```bash
set -euo pipefail
test "$(id -u)" -eq 0
python3 -I - <<'PY'
import hashlib, stat
from pathlib import Path
expected = {
    ('f81535e535190c0044f36883d498c19dbf4556feca4460bb3b680492d84da6c2',
     '6049ac1ae1bf289daf60da870867316afd0d95da0259fee422bd0bb4192e0244'): 'initial transport (no tagged requests)',
    ('85a9dd8c570d315e563b0b83e71caf698916388efa0320193e17e58946f21af3',
     '9019773bf7e360b0ec34e85fa005d36554356948f656f60473b6e9f5358be952'): 'accepted tagged transport',
}
hashes = []
for name in ['ssh-entry.py', 'controller.py']:
    p = Path('/usr/local/lib/judeos-deploy') / name
    for part in [*reversed(p.parents), p]:
        s = part.lstat()
        regular = stat.S_ISREG(s.st_mode) if part == p else stat.S_ISDIR(s.st_mode)
        if not regular or s.st_uid != 0 or s.st_mode & 0o022:
            raise SystemExit('untrusted transport path; stop')
    hashes.append(hashlib.sha256(p.read_bytes()).hexdigest())
if tuple(hashes) not in expected: raise SystemExit('unknown transport hashes; stop')
print(expected[tuple(hashes)])
PY
python3 -I /usr/local/lib/judeos-deploy/controller.py check
sha256sum /usr/local/lib/judeos-deploy/ssh-entry.py \
  /usr/local/lib/judeos-deploy/controller.py
git -C /srv/judeos-test rev-parse HEAD
git -C /srv/judeos-test status --short
sha256sum /var/lib/judeos-test-release/release.json
for task_path in /etc/judeos-deploy/release.json \
  /var/lib/judeos-deploy/status.json /srv/judeos-test-config; do
  if test -e "$task_path" || test -L "$task_path"; then
    printf 'exists: %s\n' "$task_path"
  else
    printf 'absent: %s\n' "$task_path"
  fi
done
python3 -I - <<'PY'
import fcntl, json, os, stat
from pathlib import Path
lock = Path('/run/judeos-deploy/deploy.lock')
for p in [Path('/run/judeos-deploy'), lock]:
    if p.exists() or p.is_symlink():
        s = p.lstat()
        if s.st_uid != 0 or s.st_mode & 0o077 or p.is_symlink():
            raise SystemExit('unsafe lock path; stop')
if lock.exists():
    fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
    if not stat.S_ISREG(os.fstat(fd).st_mode): raise SystemExit('unsafe lock file; stop')
    try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: raise SystemExit('deployment lock busy; stop')
    print('deployment lock: free')
else:
    print('deployment lock: absent')
pids = []
for p in Path('/proc').glob('[0-9]*/cmdline'):
    try: args = p.read_bytes().split(b'\0')
    except (OSError, ProcessLookupError): continue
    if (b'/usr/local/lib/judeos-deploy/apply-release' in args
        or (b'/usr/local/lib/judeos-deploy/controller.py' in args and b'deploy' in args)
        or any(a.startswith(b'/srv/judeos-test') and a.endswith(b'/ops/test-stack.py') for a in args)):
        pids.append(int(p.parent.name))
print(json.dumps({'judeos_operation_pids': pids}))
if pids: raise SystemExit('existing JudeOS operation; stop')
PY
docker ps -a --filter label=com.docker.compose.project=judeos-hostinger-test \
  --format '{{.Names}} {{.Image}} {{.Status}}'
docker volume ls --filter label=com.docker.compose.project=judeos-hostinger-test \
  --format '{{.Name}}'
ss -lntp '( sport = :80 or sport = :443 or sport = :5432 or sport = :8080 )'
```

Ожидается: HEAD a546194 и пустой status; old manifest SHA256
`80796ff33f9abafd4c5cc015969d3b78d768563fac9d0dcd30342e58f4b27fb9`;
policy/state/config absent; lock absent/free; operation pids=[], containers/volumes
пусты, названные порты без listeners. Даже stopped container/существующий volume
требует разбора, а не удаления. При busy lock, неизвестном transport или любом
отличии остановиться, ничего не убивать/удалять/откатывать. Просмотр processes
читает argv только для поиска фиксированных путей и выводит **только PID**.

| Transport | SHA256 ssh-entry.py | SHA256 controller.py |
|---|---|---|
| Первоначальный5368010 | `f81535e535190c0044f36883d498c19dbf4556feca4460bb3b680492d84da6c2` | `6049ac1ae1bf289daf60da870867316afd0d95da0259fee422bd0bb4192e0244` |
| Принятый source0c224452 | `85a9dd8c570d315e563b0b83e71caf698916388efa0320193e17e58946f21af3` | `9019773bf7e360b0ec34e85fa005d36554356948f656f60473b6e9f5358be952` |

## 2. Получить и проверить новый релиз

**Выполнять после разбора вывода шага1 владельцем #91.** Ниже повторяются guards
policy/state/config/lock/resources/старого source. Новые пути должны отсутствовать;
при частичном результате повтор отказывает без очистки. Сначала сообщить #91
последний успешный шаг; не удалять каталог для обхода guard.

```bash
set -euo pipefail
test "$(id -u)" -eq 0
umask 077
JUDEOS_CHECKOUT=/srv/judeos-test-v0.1.0-test.2
JUDEOS_RELEASE_DIR=/var/lib/judeos-test-release-v0.1.0-test.2
for task_path in "$JUDEOS_CHECKOUT" "$JUDEOS_RELEASE_DIR" \
  /etc/judeos-deploy/release.json /var/lib/judeos-deploy/status.json \
  /srv/judeos-test-config; do
  if test -e "$task_path" || test -L "$task_path"; then
    printf 'Путь уже существует; остановка без перезаписи: %s\n' "$task_path" >&2
    exit 1
  fi
done
python3 -I - <<'PY'
import os, stat
from pathlib import Path
for name in ['/srv', '/var/lib']:
    p = Path(name)
    for part in [*reversed(p.parents), p]:
        s = part.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            raise SystemExit('unsafe release parent; stop')
PY
test "$(git -C /srv/judeos-test rev-parse HEAD)" = a54619410aeb1d397bb65b73459785978973c667
test -z "$(git -C /srv/judeos-test status --porcelain)"
printf '%s  %s\n' \
  80796ff33f9abafd4c5cc015969d3b78d768563fac9d0dcd30342e58f4b27fb9 \
  /var/lib/judeos-test-release/release.json | sha256sum --check -
test -z "$(docker ps -aq --filter label=com.docker.compose.project=judeos-hostinger-test)"
test -z "$(docker volume ls -q --filter label=com.docker.compose.project=judeos-hostinger-test)"
if test -e /run/judeos-deploy/deploy.lock || test -L /run/judeos-deploy/deploy.lock; then
  test ! -L /run/judeos-deploy/deploy.lock
  exec 9< /run/judeos-deploy/deploy.lock
  flock --nonblock 9
fi
install -d -m 0700 "$JUDEOS_RELEASE_DIR"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  https://github.com/StarMadeGalaxy/JudeOS/releases/download/v0.1.0-test.2/release.json \
  --output "$JUDEOS_RELEASE_DIR/release.json"
printf '%s  %s\n' \
  c9067f38b4aa7f0b8d709c8c74cc473a1181d7c73c62adadb442edd892ef85d6 \
  "$JUDEOS_RELEASE_DIR/release.json" | sha256sum --check -
git clone https://github.com/StarMadeGalaxy/JudeOS.git "$JUDEOS_CHECKOUT"
git -C "$JUDEOS_CHECKOUT" fetch origin main --tags
test "$(git -C "$JUDEOS_CHECKOUT" rev-parse 'v0.1.0-test.2^{commit}')" = \
  0c224452ef4f060613b6838d8f787ce997043337
git -C "$JUDEOS_CHECKOUT" merge-base --is-ancestor \
  0c224452ef4f060613b6838d8f787ce997043337 origin/main
git -C "$JUDEOS_CHECKOUT" checkout --detach 0c224452ef4f060613b6838d8f787ce997043337
test -z "$(git -C "$JUDEOS_CHECKOUT" status --porcelain)"
python3 -I "$JUDEOS_CHECKOUT/ops/deploy-access/release-gate.py" \
  --tag v0.1.0-test.2 --run-id 37754148019
python3 -I "$JUDEOS_CHECKOUT/ops/test-release-check.py" \
  --manifest "$JUDEOS_RELEASE_DIR/release.json" --pull
test "$(git -C "$JUDEOS_CHECKOUT" rev-parse HEAD)" = 0c224452ef4f060613b6838d8f787ce997043337
test -z "$(git -C "$JUDEOS_CHECKOUT" status --porcelain)"
```

Ожидается old/new manifest OK, gate verified=true и checker verified=true с
source0c224452, tag2, schema3, registry digest из таблицы. Проверяются config hash
Docker classic/containerd, platform/OCI labels и **полный** SQL hash set. Git source,
tag/main ancestry, registry/config metadata не заменяются более слабыми проверками.
Pull/save не стартуют приложение. Сборки, registry login и секретов в этих блоках нет.

## 3. Operator enable и единственный запуск

После успешного шага2 оператор передаёт безопасный вывод #91. Только затем #91
выдаёт отдельную команду `enable-release.py` **из нового pinned checkout** с новым
manifest и config `/srv/judeos-test-config`. Старый setup checkout не обновляется;
SSH entry/controller будут обновлены принятым enable вместе с adapter. Enable
создаёт config/policy, сам не запускает приложение, reload SSH не требуется.
Если policy уже существует, нельзя удалять/переписывать её для повторного enable.

После **явного пользовательского подтверждения operator enable** только run91
делает один manual dispatch vps-deploy.yml/tag2. До него #91 проверяет отсутствие
незавершённого процесса/lock, actual preflight и отсутствие другого active workflow.
Повторный deploy/ручной test-env/up/bootstrap до этого запрещены. #22 сохраняет
проверки HTTPS/private ports/protection/эксплуатации/restore; production и реальные
данные не согласованы. Проверки state/релиза не доказывают успешный первый запуск.
