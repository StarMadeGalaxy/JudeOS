# Первый запуск synthetic test на Hostinger

Площадка: `187.7.69.230`, `judopride.tech`, Ubuntu 24.04 LTS, 1 CPU / 4 GB RAM / 50 GB disk, Docker 29.8.2 и Compose v5.6.0. Оператор **[@NikishGum](https://github.com/NikishGum)** назначен пользователем 7 октября 2026. **Первый запуск уже выполнен**: [release2/Apply/public evidence](second-synthetic-release.md) подтверждают работающий HTTPS, redirect и закрытые DB/API ports. Ранний preflight без слушателей из [inventory #88](../environments/hostinger-vps.md) — исторический. Для существующей VPS перейти к [эксплуатационной приёмке](hostinger-operations.md); блоки первого получения/enable не повторять.

Доступ/SSH/автоматизация принадлежат [#91](https://github.com/StarMadeGalaxy/JudeOS/issues/91), run `vps-access-20261007T183906Z`. Эта инструкция готовит контейнерный запуск #22; она не устанавливает SSH-права и не подтверждает доступ агента. В облачной среде #22 домен/IP отсутствуют в разрешённой сети, SSH credentials не подключены. Не отключать proxy/TLS/SSH host-key verification; сеть и credentials подключаются поддерживаемым способом через #91, без ключей в чате.

Пользователь [подтвердил](https://github.com/StarMadeGalaxy/JudeOS/issues/22#issuecomment-6045143872) подготовительный PR #89 с `Refs #22` и Caddy с публичным ACME после повторного preflight. Порядок: ручное ревью/merge подготовительного PR без закрытия #22 → реальный tag/release на интегрированной main → VPS bootstrap/внешние проверки и main protection → завершающий PR с `Closes #22` после фактических критериев.

## Условия перед первым запуском

- #95/#96 вручную merged; [v0.1.0-test.2](second-synthetic-release.md) опубликован из принятой main `0c22445`, получен/проверен на VPS, enable подтверждён, первый Apply выполнен. Старый release1/source `a546194` и новый release2 checkout/manifest сохраняются. Для нового host следующие preflight-условия остаются обязательными; для текущего нет повторного bootstrap/dispatch.
- PR artifact/local image ID не заменяют опубликованный registry digest. Новый manifest проверяется полным SHA256 из передачи release2; доступность GHCR в облаке не заменяет pull/check с целевой VPS.
- Пользователь разрешил Caddy из test-compose с публичным ACME после preflight; оператор повторно проверяет владельцев портов 80/443 и существующий TLS service. Сообщение «SSL выпущен автоматически, вероятно Hostinger» не устанавливает issuer, termination или renewal. Проверить существующие сервисы и hPanel до включения Caddy; сертификаты/ключи и чужую конфигурацию не удалять. Если уже существует другой TLS proxy, сначала согласовать интеграцию в #22 вместо запуска второго.
- Реальные DNS A/AAAA соответствуют VPS. Не оставлять AAAA, указывающий на другой/неподготовленный сервер; не удалять чужую DNS запись автоматически. Провайдерский и host firewall разрешают inbound TCP 80/443, ограничивают управление по правилам #91 и не открывают 5432/8080. Docker published ports требуют проверки Docker/nftables, одного вывода UFW недостаточно. Outbound DNS, registry/GitHub и ACME доступны.
- Оператор имеет доверенный административный канал с правом Docker и создания `/srv`/`/var/lib` файлов. Команды ниже выполняются в **root-консоли VPS** (или эквивалентном согласованном административном канале), не в ограниченном SSH transport. Docker administrator обладает полномочиями host; инструкция не объявляет их ограниченной продуктовой ролью.

## Read-only preflight на VPS

```sh
cat /etc/os-release
uname -m
docker version --format '{{.Server.Version}}'
docker compose version
python3 --version
git --version
curl --version
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
ss -lntp '( sport = :80 or sport = :443 or sport = :5432 or sport = :8080 )'
systemctl is-active nginx apache2 caddy || true
ufw status verbose
nft list ruleset
df -h / /var/lib/docker
free -h
```

Ожидаем `x86_64` для выпуска `linux/amd64`; другую архитектуру сначала согласовать. Нужны Git, Python 3 и curl; при их отсутствии оператор отдельно устанавливает `git python3 curl ca-certificates` штатным apt с проверкой TLS. Docker уже установлен по данным пользователя; повторная установка здесь не нужна. Preflight может показывать адреса/правила управления: не публиковать полный вывод без проверки. Нельзя считать порты свободными по старому `ss`; выполнить повторно непосредственно перед запуском. Сборка на VPS с 1 CPU не выполняется; место/память и достаточность ресурсов оцениваются по факту, без выдуманного порога.

## Получение именно опубликованного релиза

**На существующей VPS этот блок не выполнять:** release1 checkout/manifest уже созданы. Для [release2](second-synthetic-release.md) #91 сначала сверяет безопасный server state и согласует новые отдельные пути, сохраняя старые. Следующий общий блок относится только к ещё не настроенному host с отсутствующими каталогами.

Выбрать **фактический принятый tag** из GitHub Releases. Блок выполняется в Bash root-консоли; `RELEASE_TAG` — публичное имя версии, не секрет. Существующие каталоги не перезаписываются. Для первого запуска нужны новые `/srv/judeos-test`, `/var/lib/judeos-test-release` и `/srv/judeos-test-config`.

```bash
set -euo pipefail
read -r -p 'Принятый опубликованный tag (vMAJOR.MINOR.PATCH[-prerelease]): ' RELEASE_TAG
[[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]
test ! -e /srv/judeos-test
test ! -e /var/lib/judeos-test-release
test ! -e /srv/judeos-test-config
install -d -m 0700 /var/lib/judeos-test-release
curl --fail --location --proto '=https' --proto-redir '=https' \
  "https://github.com/StarMadeGalaxy/JudeOS/releases/download/$RELEASE_TAG/release.json" \
  --output /var/lib/judeos-test-release/release.json
RELEASE_TAG="$RELEASE_TAG" python3 - <<'PY'
import json, os, re
from pathlib import Path
d = json.loads(Path('/var/lib/judeos-test-release/release.json').read_text())
assert d['release_tag'] == os.environ['RELEASE_TAG']
assert re.fullmatch(r'[0-9a-f]{40}', d['source_commit'])
assert re.fullmatch(r'ghcr.io/starmadegalaxy/judeos@sha256:[0-9a-f]{64}', d['registry_digest'])
assert d['dirty'] is False and d['rebuild_verified'] is True and d['platform'] == 'linux/amd64'
PY
DEPLOY_COMMIT=$(python3 -c 'import json; print(json.load(open("/var/lib/judeos-test-release/release.json"))["source_commit"])')
JUDEOS_IMAGE=$(python3 -c 'import json; print(json.load(open("/var/lib/judeos-test-release/release.json"))["registry_digest"])')
git clone https://github.com/StarMadeGalaxy/JudeOS.git /srv/judeos-test
git -C /srv/judeos-test fetch origin main --tags
git -C /srv/judeos-test merge-base --is-ancestor "$DEPLOY_COMMIT" origin/main
git -C /srv/judeos-test checkout --detach "$DEPLOY_COMMIT"
cd /srv/judeos-test
python3 ops/test-release-check.py --manifest /var/lib/judeos-test-release/release.json --pull
```

Проверка требует clean checkout с commit в полученной main, совпадения schema/SQL hashes, digest, config ID и OCI source/version/platform загруженного образа. Она не проверяет подпись (подпись/provenance пока не внедрены), приёмку человеком или доступность приложения. При ошибке pull/auth остановиться: публичная доступность GHCR ещё требует фактической проверки; приватный registry доступ подключается защищённо через #91, без токена в командах/чатах/PR. Не заменять digest mutable tag и не собирать другую версию на VPS.

## Первый bootstrap через адаптер #91

Для первого фактического размещения пользователь 8 октября поручил единственный порядок, [переданный #91](https://github.com/StarMadeGalaxy/JudeOS/issues/91#issuecomment-6053570291): [получить и проверить новый pinned release/checkout](second-synthetic-release.md) → оператор устанавливает enable-release.py по принятой инструкции #91 → после явного подтверждения enable владелец #91 запускает vps-deploy.yml с настоящим tag. #22 не запускает test-env/up или второй dispatch. Прежний самостоятельный manual bootstrap здесь заменён adapter-порядком, чтобы не стартовать его параллельно.

Enable генерирует новые bootstrap/migrator/runtime credentials локально (0700/0600) и фиксирует policy без старта приложения. Adapter выполняет bootstrap → migrate → synthetic seed → API → edge и HTTPS check под lock; DB/API/edge имеют restart unless-stopped. Public конфигурация публикует только Caddy 80/443; API/DB без host bindings, DB network internal, Caddy ACME материал остаётся в своём volume. Existing secrets/volumes не перегенерируются и не удаляются. Readiness/ACME/reboot/recovery и внешний результат требуют фактической проверки на VPS.

Первый manual Apply теперь success, независимая внешняя проверка после удаления ошибочной AAAA success; [точные runs/ограничения](second-synthetic-release.md). Исторические tag Apply failure и manual workflow DNS failure сохраняются. Не повторять Apply ради зелёного старого workflow. После ошибки/timeout сначала проверить состояние, lock и root status; любое up/rollout требует нового согласования с оператором. Release1 и release2 сохраняются.

## Независимая внешняя проверка

Независимая проверка уже прошла в hosted runner #91, см. [evidence](second-synthetic-release.md). Для повторного read-only check доступен принятый после #98 workflow `Public VPS checks`, ref main, без Apply/SSH/secrets. Примеры ниже выполнять на внешнем доверенном клиенте с разрешённой сетью; среда #22 origin/IP не разрешает. Сохранять proxy и штатный CA trust.

```sh
python3 - <<'PY'
import socket
print(sorted({x[4][0] for x in socket.getaddrinfo('judopride.tech', 443, type=socket.SOCK_STREAM)}))
PY
curl --fail --silent --show-error --head http://judopride.tech/
python3 ops/test-probe.py --url https://judopride.tech
curl --fail --silent --show-error https://judopride.tech/docs --output /dev/null
```

Сверить DNS с `187.7.69.230` и согласованным AAAA; HTTP должен вернуть redirect на `https://judopride.tech/`. Probe требует 200 `/`, `/healthz`, `/readyz`, `/openapi.json`, проверяет цепочку CA/hostname и не принимает redirects за успех. Открыть web и Swagger `/docs` в браузере. Успешный HTTPS из одного клиента не исключает неверный AAAA или другую конфигурацию маршрута.

Для TCP проверки использовать внешний клиент, чья сеть разрешает соединения на эти четыре порта (ограничение egress клиента не доказывает закрытый DB порт). Следующий блок подключается только к предоставленному VPS, ничего не меняет, возвращает ошибку при открытых 5432/8080 или недоступных контрольных 80/443:

```sh
python3 - <<'PY'
import json, socket
results = {}
for port in (80, 443, 5432, 8080):
    try:
        with socket.create_connection(('187.7.69.230', port), timeout=5):
            results[port] = 'connected'
    except OSError:
        results[port] = 'no connection from this client'
print(json.dumps(results))
raise SystemExit(0 if all(results[p] == 'connected' for p in (80, 443))
                 and all(results[p] != 'connected' for p in (5432, 8080)) else 1)
PY
```

Результат сверить с firewall и Docker check на VPS; блок не различает фильтрацию, отказ и timeout, не доказывает всех сетевых маршрутов. Зафиксировать UTC дату, release tag/commit/digest/schema, внешний клиент/маршрут, DNS/TLS/redirect/HTTP и closed-port результаты в #22/PR. Приватные ключи, env/inspect Environment, dumps и TLS private material не публиковать.

## Копия и остановка

На существующей VPS backup/restore выполняется оператором только после согласования: [guarded блок с deploy lock и pinned release2](hostinger-operations.md#backup-и-изолированный-restore--после-согласования). Следующие общие примеры не заменяют его и не являются разрешением действий:

```bash
install -d -m 0700 /var/lib/judeos-test-backups
python3 ops/test-backup.py --config /srv/judeos-test-config/test.env \
  --output "/var/lib/judeos-test-backups/first-check-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Если нужна остановка:

```sh
python3 ops/test-stack.py --config /srv/judeos-test-config/test.env down
```

`down` он сохраняет volumes. Restore check проверяет synthetic schema/counts под test admin, не права production/полное восстановление ownership/RLS. Off-host storage, scheduler, пороги диска/свежести и обслуживание копий оператор ещё должен согласовать; инструкция их не выдумывает. Не запускать `exercise`, restore или `down --volumes` автоматизированно на общем test.

## Интерфейс для #91

[Владелец #91 подтвердил технический интерфейс](https://github.com/StarMadeGalaxy/JudeOS/issues/22#issuecomment-6044771911); adapter/helper/transport приняты через #89/#92/#95/#96/#98. Первый bootstrap выполнен только adapter после operator enable. Root-owned adapter фиксирует source/config/manifest; transport не принимает paths/commands/refs, не загружает server-side code и не разрешает произвольный digest. Серверный lock удерживается до foreground completion; implementation/tests и live SSH/Apply результаты переданы в #91. #22 эти файлы не меняет.

| Команда в принятом checkout | Вход/результат |
|---|---|
| `test-release-check.py --manifest /var/lib/judeos-test-release/release.json --pull` | Одобренный manifest, accepted clean main checkout; stdout JSON identity, exit 0 success / 1 mismatch or unavailable / 2 invalid CLI; pull logs stderr |
| `test-stack.py --config /srv/judeos-test-config/test.env up` | Фиксированный root-owned config; Compose stdout, exit 0 success / nonzero failure, ожидание до 90 s |
| `test-stack.py --config /srv/judeos-test-config/test.env --url https://judopride.tech check` | Фактические Docker ports/network и HTTPS; stdout JSON результата при успехе, exit 0 / nonzero failure, ожидание до 60 s |
| `test-probe.py --url https://judopride.tech` | Независимый разрешённый клиент, proxy/CA verification; stdout JSON HTTP timings/local client disk, exit 0 success / 1 failed check / 2 invalid input |

`test-probe.py` disk result относится к host, где запущен probe: внешний probe не измеряет VPS диск. Manifest проверка не сверяет существующий test.env: adapter отдельно подтверждает его image/config с одобренным manifest. Генератор создаёт только новый config; смена образа/миграций существующего test — отдельно согласуемая операция. SSH transport/adapter установлены и первый Apply подтверждён #91; это не предоставление SSH-доступа среде #22. Для действующего release2 пути из таблицы старого интерфейса заменяются на frozen `/var/lib/judeos-test-release-v0.1.0-test.2/release.json`, checkout `/srv/judeos-test-v0.1.0-test.2`; config остаётся `/srv/judeos-test-config/test.env`.

## Осталось подтвердить фактически

Release2/pinned VPS checker/enable/единственный Apply/trusted HTTPS/redirect/health/readiness/OpenAPI/docs/закрытые5432/8080 подтверждены в #91. [Оставшаяся эксплуатация](hostinger-operations.md): VPS disk/backup/restore, отдельно согласованный reboot и runtime compatibility кандидата release1; future ACME renewal, off-host storage/расписание/пороги не проверены и не выдумываются. Защиту main пользователь включил по [четырём реальным checks](releases.md#защита-main-после-появления-checks); branch API protected=true, остальные параметры подтверждены ответом пользователя при детальном API403. #22 open до фактических критериев, завершающий Closes PR позже; auto merge нет.
