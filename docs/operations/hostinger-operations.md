# Эксплуатационная приёмка существующего Hostinger test

Оператор — [NikishGum](https://github.com/NikishGum). Только synthetic; production не развёрнут. Эта инструкция продолжает уже работающий test и не выполняет enable, bootstrap, rollout, смену образа или обновление frozen checkout. Backup/restore и reboot на VPS выполняются оператором **после отдельного согласования действия** в #22. Ограниченный SSH transport #91 не даёт произвольного root shell/backup-доступа; используйте существующую административную консоль. Ключи, конфигурация, SQL/dump, inspect Environment и private state в чат не передаются.

## Критерии #22 и проверенные результаты

Проверено 8 октября 2026 по [передаче #91](https://github.com/StarMadeGalaxy/JudeOS/issues/22#issuecomment-6058402573), Actions и live API. [PR #98](https://github.com/StarMadeGalaxy/JudeOS/pull/98) уже merged; main `16a5c9d3be99950a46573d46ec3687cd3ab01fde`, [CI main](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37767893694) success. Main новее source опубликованного образа; это не причина менять runtime.

| Критерий | Доказательство и ограничение |
|---|---|
| CI сборки/существенных проверок/миграций, test по инструкции | Четыре обязательных jobs main CI success. [Единственный первый Apply](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37764403714) success. Независимые [public checks](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37765696629), повторно [на final head #98](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37766878813), success: DNS, HTTP→HTTPS, trusted TLS, root/health/readiness/OpenAPI/docs, TCP 80/443. Исторический deploy workflow остаётся failure из-за первоначального AAAA, его не перезапускали. |
| Раздельные секреты/config, БД закрыта | Test config вне Git: `/srv/judeos-test-config`, directory 0700/files 0600 по передаче #91; bootstrap/migrator/runtime раздельны. Adapter проверил внутреннюю DB network/host bindings; public checker подтвердил 5432/8080 closed с внешнего runner. Production отсутствует, production secrets не создавались и не копировались в test. |
| Определимые образ/предыдущий release, требования защиты main | [Release2 identifiers](second-synthetic-release.md) проверены в GHCR/на VPS. Release1 сохраняется как кандидат с той же schema/SQL; runtime compatibility ещё не проверена, `previous_compatible_release=null` не переписывается. Пользователь применил [защиту main](releases.md#защита-main-после-появления-checks) и явно ответил «Сделал»; повторный branch API подтвердил `protected=true`, четыре требуемых contexts/Actions app15368/enforcement everyone. Детальные reviews/strict/conversations/bypass API403, их применение подтверждено ответом пользователя, не независимым read-back. |
| Документация и результаты в Issue/PR | [PR #97](https://github.com/StarMadeGalaxy/JudeOS/pull/97), Refs #22; приёмка и закрытие #22 после оставшихся фактических результатов. API/SQL/runtime/adapter #91 не меняются. |

Health/readiness и изоляция проверены на VPS, но backup/restore, измерение VPS disk/копии и recovery после reboot автоматически этим не доказаны. CI `Image and HTTPS` уже выполняет минимальный synthetic dump/restore и отказ/возврат readiness на своей disposable БД; это не копия данных работающей VPS. Reboot отсутствует отдельным checkbox в #22, но передан как незавершённая эксплуатационная проверка; сначала согласовать с оператором, не выдавать restart policy за фактический результат. Production recovery §10 архитектуры, off-host storage, расписание, retention, RPO/RTO и алерты требуют отдельных условий до реального пилота.

## Read-only проверка оператором

Из Bash root-консоли VPS. Публиковать только exit codes, neutral identity/check JSON, диск/время HTTP; перед публикацией просмотреть вывод. Команды не делают pull, fetch, up, seed или изменения конфигурации. Release checker использует временное место под экспорт образа для проверки config hash Docker29.

```bash
set -euo pipefail
test "$(id -u)" = 0
JUDEOS_CHECKOUT=/srv/judeos-test-v0.1.0-test.2
JUDEOS_MANIFEST=/var/lib/judeos-test-release-v0.1.0-test.2/release.json
JUDEOS_CONFIG=/srv/judeos-test-config/test.env
test "$(git -C "$JUDEOS_CHECKOUT" rev-parse HEAD)" = 0c224452ef4f060613b6838d8f787ce997043337
test -z "$(git -C "$JUDEOS_CHECKOUT" status --porcelain)"
printf '%s  %s\n' c9067f38b4aa7f0b8d709c8c74cc473a1181d7c73c62adadb442edd892ef85d6 "$JUDEOS_MANIFEST" | sha256sum --check
cd "$JUDEOS_CHECKOUT"
python3 -B ops/test-release-check.py --manifest "$JUDEOS_MANIFEST"
python3 -B ops/test-stack.py --config "$JUDEOS_CONFIG" --url https://judopride.tech check
JUDEOS_DOCKER_ROOT=$(docker info --format '{{.DockerRootDir}}')
test -d "$JUDEOS_DOCKER_ROOT"
python3 -B ops/test-probe.py --url https://judopride.tech --disk-path "$JUDEOS_DOCKER_ROOT"
systemctl is-enabled docker
systemctl is-active docker
```

Не задавать выдуманный порог disk/latency. Для будущего контроля оператор отдельно выбирает `--min-free-bytes`, freshness threshold, расписание и получателя уведомлений. Внешний runner не измеряет filesystem VPS. Для независимого публичного результата доступен принятый `Actions → Public VPS checks → Run workflow → main`; он не вызывает Apply/deploy/SSH. Права transport/secrets при этом не меняются.

## Backup и изолированный restore — после согласования

Одноразовая проверка сохранённым `ops/test-backup.py` из release2. Он читает основную synthetic DB, создаёт новую случайную DB `restore_check_*` в этом же test-кластере, восстанавливает dump, сверяет schema и числа fixtures/clubs/objects/audit, удаляет только собственную временную DB. Он не проверяет восстановление всех ролей/ownership/RLS/продуктовых прав и не создаёт off-host копию. Основную БД не заменяет. На время сравнения оператор согласует отсутствие synthetic записей и других административных действий; при параллельных writes сверка может отказать. Не останавливать API/DB или менять роли ради этого автоматически.

Блок ниже держит **существующий** deploy lock #91, не создаёт/меняет его права. Это сериализация с возможным Apply, не расширение интерфейса transport. Вывод дочерних команд подавлен, чтобы при ошибке не публиковать logs/credentials. При отказе остановиться, сохранить непроверенный dump для локального разбора оператором; не объявлять его годной копией.

```bash
python3 -B - <<'PY'
import datetime, fcntl, hashlib, json, os, pathlib, stat, subprocess, time, uuid

root = pathlib.Path('/srv/judeos-test-v0.1.0-test.2')
manifest = pathlib.Path('/var/lib/judeos-test-release-v0.1.0-test.2/release.json')
config = pathlib.Path('/srv/judeos-test-config/test.env')
directory = pathlib.Path('/var/lib/judeos-test-backups')
def require(condition):
    if not condition:
        raise SystemExit('Stopped: baseline/path/permissions check failed.')
def private(path, is_directory):
    info = path.lstat()
    require(info.st_uid == 0 and not info.st_mode & 0o077
            and (stat.S_ISDIR(info.st_mode) if is_directory else stat.S_ISREG(info.st_mode)))
def command(args, capture=False):
    result = subprocess.run(args, cwd=root, capture_output=True, pass_fds=(lock.fileno(),))
    if result.returncode:
        print(json.dumps({'ok': False, 'code': 'operations_check_failed', 'exit_code': result.returncode}))
        raise SystemExit(1)
    return result.stdout if capture else None
require(os.geteuid() == 0)
private(pathlib.Path('/run/judeos-deploy'), True)
fd = os.open('/run/judeos-deploy/deploy.lock', os.O_RDWR | os.O_NOFOLLOW)
with os.fdopen(fd, 'rb') as lock:
    info = os.fstat(lock.fileno())
    require(info.st_uid == 0 and stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit('Stopped: deployment busy; do not remove the lock.')
    require(command(['git', 'rev-parse', 'HEAD'], True).strip() == b'0c224452ef4f060613b6838d8f787ce997043337')
    require(not command(['git', 'status', '--porcelain'], True))
    require(hashlib.sha256(manifest.read_bytes()).hexdigest() == 'c9067f38b4aa7f0b8d709c8c74cc473a1181d7c73c62adadb442edd892ef85d6')
    private(config.parent, True)
    private(config, False)
    values = dict(line.split('=', 1) for line in config.read_text().splitlines() if line and not line.startswith('#'))
    require(values['COMPOSE_PROJECT_NAME'] == 'judeos-hostinger-test'
            and values['TEST_CONFIG_DIR'] == str(config.parent)
            and values['TEST_IMAGE'] == json.loads(manifest.read_text())['registry_digest'])
    command(['python3', '-B', 'ops/test-release-check.py', '--manifest', str(manifest)])
    check = ['python3', '-B', 'ops/test-stack.py', '--config', str(config), '--url', 'https://judopride.tech', 'check']
    command(check)
    directory.mkdir(mode=0o700, exist_ok=True)
    private(directory, True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    dump = directory / ('restore-check-' + stamp + '-' + uuid.uuid4().hex + '.dump')
    start = time.monotonic()
    command(['python3', '-B', 'ops/test-backup.py', '--config', str(config), '--output', str(dump)])
    command(check)
    private(dump, False)
    digest = hashlib.sha256()
    with dump.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    print(json.dumps({'ok': True, 'code': 'synthetic_backup_restore_checked',
                      'dump': str(dump), 'mode': oct(stat.S_IMODE(dump.stat().st_mode)),
                      'bytes': dump.stat().st_size, 'sha256': digest.hexdigest(),
                      'created_at_utc': stamp, 'check_elapsed_seconds': round(time.monotonic() - start, 2)}))
PY
```

Результат и exit 0 записать в #22. Измеренное время этого check не является RTO. Dump остаётся mode 0600, политика хранения/удаления не назначена. Подтверждение restore требуется отдельно от файла/SHA/свежести; повтор после ошибки — только после диагностики. Для измерения freshness использовать реальный путь `dump` из JSON и **согласованный** `--max-backup-age-seconds`; CI 300 секунд не переносить на эксплуатацию.

## Recovery после reboot — отдельное согласование

План подготовлен; reboot **не выполнен**. Он прерывает доступность VM. Не запускать его вместе с backup/Apply и не считать разрешение первого deploy разрешением reboot. Оператор выбирает момент, подтверждает доступность Hostinger console, отсутствие активных runs/lock и проверенную копию, согласует отсутствие writes. До reboot сохранить нейтральную запись: UTC время, boot ID, status/check, container/volume IDs, restart policy, manifest SHA и schema/fixture counts. Секретные файлы сохраняются на host, не копируются в чат.

Дополнение к read-only блоку выше (из pinned checkout):

```bash
cat /proc/sys/kernel/random/boot_id
docker ps -a --filter label=com.docker.compose.project=judeos-hostinger-test --format '{{.ID}} {{.Label "com.docker.compose.service"}} {{.Status}}'
docker volume ls --filter label=com.docker.compose.project=judeos-hostinger-test --format '{{.Name}}'
for JUDEOS_SERVICE in db api edge; do
  JUDEOS_CONTAINER=$(docker compose --project-name judeos-hostinger-test --env-file /srv/judeos-test-config/test.env -f ops/test-compose.yaml ps -q "$JUDEOS_SERVICE")
  test -n "$JUDEOS_CONTAINER"
  docker inspect --format '{{.Id}} {{.HostConfig.RestartPolicy.Name}} {{.Image}}' "$JUDEOS_CONTAINER"
done
docker compose --project-name judeos-hostinger-test --env-file /srv/judeos-test-config/test.env -f ops/test-compose.yaml exec -T db psql -U judeos_test -d judeos_test -At -v ON_ERROR_STOP=1 -c 'SELECT version_id FROM goose_db_version WHERE is_applied ORDER BY id DESC LIMIT 1; SELECT count(*) FROM development.sample_clubs; SELECT count(*) FROM core.clubs; SELECT count(*) FROM development.sample_objects; SELECT count(*) FROM core.audit_events;'
```

Ожидаются schema 3 и `unless-stopped` для db/api/edge; bootstrap/migrate/seed — уже завершённые одноразовые контейнеры, не службы запуска после reboot. Docker должен быть enabled/active; **не включать/перезапускать его автоматически** при другом результате, сначала согласовать исправление.

Только после явного согласования оператор выполняет в отдельной root-консоли:

```sh
systemctl reboot
```

После восстановления административного доступа повторить read-only блок и снимок. Требовать новый boot ID, тот же source/manifest/image/schema/volumes/counts/config, running db/api/edge, readiness 200 и повторный независимый `Public VPS checks` на main без Apply. Caddy использует сохранённый `/data` volume; trusted TLS после reboot проверяется, не выдаётся за проверку будущего ACME renewal. Зафиксировать фактическую длительность и результат без обещания RTO. Если автоматический старт не произошёл — записать отказ, безопасно диагностировать Docker/status; не делать up/bootstrap/reset/rerun deploy ради зелёного результата. Frozen checkout/manifest/tag/credentials/volumes сохраняются.

## Runtime compatibility release1 — согласуемый облачный exercise

Этот блок подготовлен для **собственного изолированного облачного окружения #22**, не VPS. Из-за пользовательского запрета нового bootstrap он пока не выполняется: сначала отдельно согласовать disposable cloud exercise. Он не выпускает tag, не меняет manifests и не переключает рабочий test. Текущая схема/данные создаются release2, затем только API заменяется отдельным контейнером release1 с `--no-deps`; старый bootstrap/migrator/seed не вызываются. Совпадение schema/SQL является предварительным guard, readiness и действующий HTTP contract checker — runtime proof. После проверки удаляются только созданные здесь одноразовые контейнеры/тома, временный config сохраняется для локального разбора, ветка возвращается.

Публичные manifests обоих tag уже сохранены в `/tmp/judeos-release2-20261008` с проверенными SHA; они не перезаписываются. Запускать из чистого собственного checkout на ветке PR97, без другой локальной работы. Proxy/CA verification сохраняются; для local CA доверие только этому клиенту. Нужны свободные loopback9443/9088, Docker/Compose/Node и установленные `api/node_modules`. При другой текущей ветке/нечистом checkout остановиться.

```bash
set -euo pipefail
test "$(git branch --show-current)" = docs/22-release2-handoff
test -z "$(git status --porcelain)"
test -d api/node_modules
printf '%s  %s\n' c9067f38b4aa7f0b8d709c8c74cc473a1181d7c73c62adadb442edd892ef85d6 /tmp/judeos-release2-20261008/release.json | sha256sum --check
printf '%s  %s\n' 80796ff33f9abafd4c5cc015969d3b78d768563fac9d0dcd30342e58f4b27fb9 /tmp/judeos-release2-20261008/release1-after.json | sha256sum --check
JUDEOS_COMPAT_DIR=$(mktemp -d /tmp/judeos-22-compat.XXXXXXXX)
JUDEOS_COMPAT_PROJECT=judeos-compat22-$(python3 -c 'import uuid; print(uuid.uuid4().hex[:12])')
JUDEOS_PREVIOUS_CONTAINER=$JUDEOS_COMPAT_PROJECT-previous
cleanup_compat() {
  if test -f "$JUDEOS_COMPAT_DIR/config/test.env"; then
    docker rm -f "$JUDEOS_PREVIOUS_CONTAINER" >/dev/null 2>&1 || true
    docker compose --project-name "$JUDEOS_COMPAT_PROJECT" --env-file "$JUDEOS_COMPAT_DIR/config/test.env" -f ops/test-compose.yaml down --volumes
  fi
  git switch docs/22-release2-handoff
}
trap cleanup_compat EXIT
git checkout --detach 0c224452ef4f060613b6838d8f787ce997043337
python3 -B ops/release-compare.py /tmp/judeos-release2-20261008/release.json /tmp/judeos-release2-20261008/release1-after.json
python3 -B ops/test-release-check.py --manifest /tmp/judeos-release2-20261008/release.json --pull
JUDEOS_CURRENT_IMAGE=ghcr.io/starmadegalaxy/judeos@sha256:f60e513f0ae5a8aaf15835763f26600cc4371ac56a62c690e90564326bf4a373
JUDEOS_PREVIOUS_IMAGE=ghcr.io/starmadegalaxy/judeos@sha256:8beb9d63541b2ddc4bffe60ad339f2392540af3d209fb5ee2590299faed0d456
docker pull "$JUDEOS_PREVIOUS_IMAGE"
python3 -B - <<'PY'
import importlib.util, json, pathlib, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('release_check', 'ops/test-release-check.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)
check.verify_image_identity(json.loads(pathlib.Path('/tmp/judeos-release2-20261008/release1-after.json').read_text()))
print('Previous image/config/platform/OCI identity verified; runtime exercise follows.')
PY
python3 -B ops/test-env.py --directory "$JUDEOS_COMPAT_DIR/config" --project "$JUDEOS_COMPAT_PROJECT" --image "$JUDEOS_CURRENT_IMAGE" --https-port 9443 --http-port 9088
python3 -B ops/test-stack.py --config "$JUDEOS_COMPAT_DIR/config/test.env" up
python3 -B ops/test-stack.py --config "$JUDEOS_COMPAT_DIR/config/test.env" export-ca
python3 -B ops/test-stack.py --config "$JUDEOS_COMPAT_DIR/config/test.env" --url https://localhost:9443 --ca "$JUDEOS_COMPAT_DIR/config/local-root.crt" check
JUDEOS_DB_BEFORE=$(docker compose --project-name "$JUDEOS_COMPAT_PROJECT" --env-file "$JUDEOS_COMPAT_DIR/config/test.env" -f ops/test-compose.yaml exec -T db psql -U judeos_test -d judeos_test -At -v ON_ERROR_STOP=1 -c 'SELECT version_id FROM goose_db_version WHERE is_applied ORDER BY id DESC LIMIT 1; SELECT count(*) FROM development.sample_clubs; SELECT count(*) FROM core.clubs; SELECT count(*) FROM development.sample_objects; SELECT count(*) FROM core.audit_events;')
docker compose --project-name "$JUDEOS_COMPAT_PROJECT" --env-file "$JUDEOS_COMPAT_DIR/config/test.env" -f ops/test-compose.yaml stop api
TEST_IMAGE="$JUDEOS_PREVIOUS_IMAGE" docker compose --project-name "$JUDEOS_COMPAT_PROJECT" --env-file "$JUDEOS_COMPAT_DIR/config/test.env" -f ops/test-compose.yaml run --detach --no-deps --use-aliases --name "$JUDEOS_PREVIOUS_CONTAINER" api
test "$(docker inspect --format '{{.Config.Image}}' "$JUDEOS_PREVIOUS_CONTAINER")" = "$JUDEOS_PREVIOUS_IMAGE"
python3 -B ops/test-stack.py --config "$JUDEOS_COMPAT_DIR/config/test.env" --url https://localhost:9443 --ca "$JUDEOS_COMPAT_DIR/config/local-root.crt" check
JUDEOS_BASE_URL=https://localhost:9443 NODE_EXTRA_CA_CERTS="$JUDEOS_COMPAT_DIR/config/local-root.crt" npm --prefix api run check:runtime
JUDEOS_DB_AFTER=$(docker compose --project-name "$JUDEOS_COMPAT_PROJECT" --env-file "$JUDEOS_COMPAT_DIR/config/test.env" -f ops/test-compose.yaml exec -T db psql -U judeos_test -d judeos_test -At -v ON_ERROR_STOP=1 -c 'SELECT version_id FROM goose_db_version WHERE is_applied ORDER BY id DESC LIMIT 1; SELECT count(*) FROM development.sample_clubs; SELECT count(*) FROM core.clubs; SELECT count(*) FROM development.sample_objects; SELECT count(*) FROM core.audit_events;')
test "$JUDEOS_DB_BEFORE" = "$JUDEOS_DB_AFTER"
printf '%s\n' 'Previous API on release2 synthetic schema/fixtures: HTTPS/readiness/HTTP contract passed; DB signature unchanged.'
```

Trap не удаляет config/secrets/логи из temporary directory: они остаются mode0700/0600 для локального разбора, не публикуются. После успеха оператор/агент записывает точные оба tag/source/digest/schema/SQL и runtime результат в #22; immutable published previous=null остаётся прежним, эксплуатационная запись определяет проверенного кандидата. Это проверка минимального каркаса, не production rollback и не доказательство будущей совместимости новой схемы.

## Оставшаяся передача

Main protection применена пользователем и частично прочитана через branch API; границы read-back выше. Оператор передаёт neutral disk/HTTP результаты и backup/restore exit 0; затем отдельно решает reboot-check. Совместимость release1 остаётся отдельным **disposable** runtime exercise по [releases.md](releases.md#предыдущий-совместимый-релиз), без переключения работающей VPS и без нового tag. Если нет согласования/результата, пункт отмечается pending; ни deploy proof, ни новый документ его не закрывают. Off-host backup/расписание/пороги ещё не согласованы, реальные данные запрещены до #18/#24.
