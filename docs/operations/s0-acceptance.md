# Синтетическая основа S0: доказательства для приёмки #25

Повторные проверки выполнены 9 октября 2026 (Europe/Minsk), run `s0-25-20261009-cloud-205c9340`, ветка `feat/25-s0-acceptance`. Исходная main — `510a30a0f3dd3686184992fdb4edc034c660e758`; backend и миграции 00001–00004 в этом PR не менялись. Исправлены устаревшие описания реализованности/schema в README/ops/OpenAPI. Доказательства подготовлены для независимого review и приёмки; Issue закрывается после приёмки и merge PR.

## Источники и границы

Принятые зависимости: [#20/PR85](https://github.com/StarMadeGalaxy/JudeOS/pull/85), [#21/PR101](https://github.com/StarMadeGalaxy/JudeOS/pull/101), [#22/PR97](https://github.com/StarMadeGalaxy/JudeOS/pull/97), [#23/PR81](https://github.com/StarMadeGalaxy/JudeOS/pull/81); все действительно merged. [Завершение21](https://github.com/StarMadeGalaxy/JudeOS/issues/21#issuecomment-6077463851) подтверждает выполненные критерии, независимый Approve и merge101/105. Начальная проверка25 охватила59 open Issues, недавние closed/merged, все open PR, claim/передачи; #26/draft PR102 остаётся у NikishGum и не считается принятой зависимостью.

| Слой | Что подтверждается здесь |
|---|---|
| Реализованный runtime | Schema4; 9 access + 4 служебные операции, настоящие PostgreSQL/серверные сессии/CSRF/Origin/роли/отзыв |
| Planned API | 3 операции training/attendance из принятого16; схемы/примеры/TS, отсутствие этих обработчиков в chi/runtime |
| Мобильный прототип23 | Fixture SessionJournal и UI/четыре отметки/повтор/конфликт на адаптере в памяти; учебный вход не проверяет пароль |
| Опубликованный VPS test22 | Исторические HTTPS/изолированный restore/release2 schema3 доказательства по ссылкам; в25 VPS не проверялся повторно и не менялся |

Исторические отчёты20/21/22/23 — исходные доказательства, команды ниже — **новые повторные проверки**. [VPS baseline](second-synthetic-release.md), [операторский backup/restore](https://github.com/StarMadeGalaxy/JudeOS/issues/22#issuecomment-6059425070) и [cloud compatibility22](https://github.com/StarMadeGalaxy/JudeOS/issues/22#issuecomment-6059234802) не выдаются за повторный запуск25.

Готовность этой синтетической основы **не означает готовность реального пилота или полного MVP**. #17 (образцы/договор iPay), #18 (условия реальных данных/ответственность) и #24 (production/копии/восстановление) открыты. Реальный журнал, people/семьи/контакты, финансы, iPay, Telegram, worker/PWA/offline и полная предметная приёмка остаются своими задачами. Прототип не интегрирован с runtime auth/журналом. Физические iOS/Android, production/off-host recovery/RPO/RTO/retention/нагрузка здесь не проверялись. Числовая политика реальных данных не придумана.

## Среда и версии

Использован существующий чистый cloud checkout; дополнительных clone/worktree нет. Перед стартом локального Docker daemon не было контейнеров/томов. Dev project `judeos-synthetic` и отдельные `judeos-s0-25-clean`/`judeos-s0-25-upgrade` созданы только для25. Секреты случайные, synthetic, config вне Git (directory0700/files0600); ни действующий VPS, ни его image/tag/manifest/secrets/volumes не изменялись.

| Инструмент | Версия |
|---|---|
| Go | 1.27.1 linux/amd64; официальный archive SHA256 `63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445` проверен перед распаковкой |
| Node / npm / Python | 24.19.0 / 11.9.0 / 3.12.14 |
| Docker / Compose | 28.4.0 / 2.40.3 |
| PostgreSQL / Caddy | 18.3 / 2.11.2; pinned digests в Compose |
| Chromium / Playwright | системный Chromium151.0.7922.173 (Debian13) / 1.63.0 |
| OpenAPI / validators / TS / Swagger | 3.0.3 / Redocly2.59.0 + AJV8.17.1 / 5.9.3 / 5.33.1 |

`/usr/bin/go` в этой среде не был Go compiler; команды использовали `/tmp/judeos-25-toolchain/go/bin/go`. Изменения зависимостей/tidy не нужны; `go mod verify` passed. Сборка сохраняет inherited proxy, combined CA `/etc/ssl/certs/ca-certificates.crt` монтируется как BuildKit secret. TLS verification включена. Chromium доверял только временному local CA стенда; `ignoreHTTPSErrors=false`, traces выключены. Снимки сделаны после скрытия bearer-ссылок.

## Команды и новые результаты

Из корня checkout, только в собственной disposable synthetic среде. При другом окружении укажите свой Go binary; CA параметр нужен только при HTTPS-intercepting proxy.

```sh
make install
make GO=/tmp/judeos-25-toolchain/go/bin/go build check
/tmp/judeos-25-toolchain/go/bin/go mod verify
make up BUILD_CA_PATH=/etc/ssl/certs/ca-certificates.crt
make GO=/tmp/judeos-25-toolchain/go/bin/go check-db
make up BUILD_CA_PATH=/etc/ssl/certs/ca-certificates.crt
docker tag judeos-scaffold:local judeos-s0-25:current
```

**PASS:** network build и clean bootstrap→migrate→seed→API; схема4, health/readiness200. При пустом PUBLIC_ORIGIN access session403 (fail closed); HTTP loopback не рабочий вход. Повторный up сохраняет `.env`/том/2 clubs/2 objects/4 audit и signature; дублей нет. Build/race/vet/mod verify, web/TS, OpenAPI/$ref/operationId/реестр и chi.Walk13 implemented +4 explicit static passed. Обычный Go test не заменяет check-db: PostgreSQL suites без JUDEOS_TEST_DATABASE_URL пропускаются.

**PASS check-db:** отдельная случайная БД, реальные разные LOGIN admin/migrator/runtime. Legacy ownership19/schema1→2→4 сохраняет существующий клуб и timezone; повтор bootstrap/migrate/seed; runtime без ownership/SUPERUSER/BYPASSRLS/DDL/SET ROLE/TRUNCATE/audit access. Два tenant: чужие write/смена tenant отвергнуты, foreign read/update/delete не раскрывают/меняют строки, FK с parent другого клуба отклонён. Нет SQL/application tenant context — отказ; commit/error/panic/cancel очищают context,20 конкурентных обращений на одном connection pool не смешивают клубы. Аудит атомарен, rollback/no-op корректны, reader видит свой tenant, чувствительных label/контактов нет. Empty/old/new/privileged readiness отвергнуты.

**PASS TLS HTTP/PostgreSQL access:** bootstrap/redeem/login/logout, cookie flags, нейтральный login/429, Origin/CSRF/Fetch Metadata/ограниченный JSON, чужой tenant/manager, union roles, replacement/expiry/replay invite/reset, expiry/role change/revoke sessions и last-owner race (остаётся ровно1 active administrator). Password/invite/login отсутствуют в audit/logs; отдельные panic/driver-error tests не раскрывают URL/query/header/body/SQL/raw error. Тестовая БД удалена самим check-db в finally.

### Чистый HTTPS runtime4

```sh
python3 ops/test-env.py --directory /tmp/judeos-s0-25-clean \
  --project judeos-s0-25-clean --https-port 8543 --http-port 8188 \
  --image judeos-s0-25:current
python3 ops/test-stack.py --config /tmp/judeos-s0-25-clean/test.env up
python3 ops/test-stack.py --config /tmp/judeos-s0-25-clean/test.env export-ca
python3 ops/test-stack.py --config /tmp/judeos-s0-25-clean/test.env \
  --ca /tmp/judeos-s0-25-clean/local-root.crt check
NODE_EXTRA_CA_CERTS=/tmp/judeos-s0-25-clean/local-root.crt \
  JUDEOS_BASE_URL=https://localhost:8543 npm --prefix api run check:runtime
```

**PASS:** trusted chain/hostname, health/readiness/root/spec200, access session401, neutral404/405/Allow/slash policy, no-store/server request_id/schema. Выданный `/openapi.json` **целиком равен** checked runtime artifact (13 operations); planned операции отсутствуют. Docker inspect подтверждает DB без host-port и только internal network, API без host-port. Это локальный CA, не повторная проверка публичного сертификата VPS.

### Обновление опубликованного schema3 baseline в отдельной копии

```sh
docker pull ghcr.io/starmadegalaxy/judeos@sha256:f60e513f0ae5a8aaf15835763f26600cc4371ac56a62c690e90564326bf4a373
python3 ops/test-env.py --directory /tmp/judeos-s0-25-upgrade \
  --project judeos-s0-25-upgrade --https-port 8643 --http-port 8288 \
  --image ghcr.io/starmadegalaxy/judeos@sha256:f60e513f0ae5a8aaf15835763f26600cc4371ac56a62c690e90564326bf4a373
python3 ops/test-stack.py --config /tmp/judeos-s0-25-upgrade/test.env up
python3 ops/test-stack.py --config /tmp/judeos-s0-25-upgrade/test.env export-ca
python3 ops/test-stack.py --config /tmp/judeos-s0-25-upgrade/test.env \
  --ca /tmp/judeos-s0-25-upgrade/local-root.crt check
```

Old image — immutable release2/source `0c224452ef4f060613b6838d8f787ce997043337`, фактическая схема3/readiness200. Далее **только в этом новом config** TEST_IMAGE заменён на `judeos-s0-25:current`, секреты/том сохранены:

```sh
python3 - <<'PY'
from pathlib import Path
p = Path('/tmp/judeos-s0-25-upgrade/test.env')
p.write_text('\n'.join('TEST_IMAGE=judeos-s0-25:current' if line.startswith('TEST_IMAGE=')
                       else line for line in p.read_text().splitlines()) + '\n')
PY
docker compose --env-file /tmp/judeos-s0-25-upgrade/test.env \
  -f ops/test-compose.yaml run --rm --no-deps migrate
curl --cacert /tmp/judeos-s0-25-upgrade/local-root.crt https://localhost:8643/healthz
curl --cacert /tmp/judeos-s0-25-upgrade/local-root.crt -o /dev/null -w '%{http_code}\n' https://localhost:8643/readyz
python3 ops/test-stack.py --config /tmp/judeos-s0-25-upgrade/test.env up
python3 ops/test-stack.py --config /tmp/judeos-s0-25-upgrade/test.env \
  --ca /tmp/judeos-s0-25-upgrade/local-root.crt check
python3 ops/test-stack.py --config /tmp/judeos-s0-25-upgrade/test.env \
  --ca /tmp/judeos-s0-25-upgrade/local-root.crt exercise
NODE_EXTRA_CA_CERTS=/tmp/judeos-s0-25-upgrade/local-root.crt \
  JUDEOS_BASE_URL=https://localhost:8643 npm --prefix api run check:runtime
```

**PASS:** старый API после миграции4 health200/readiness503; после замены API readiness200 и exact runtime spec/HTTP checks passed. Exercise: DB stopped → health200/readiness503 → DB restored → readiness200. Никакого down/reset/rollback SQL нет. Старый schema3 image на4 **не совместимый rollback**; production переход/доставка auth на VPS требуют отдельной приёмки, не разрешены #25.

Контрольная сумма — MD5 канонически упорядоченных JSON-строк synthetic clubs/objects/audit, только сравнение сохранности, не криптографическая гарантия. SQL для воспроизведения через `psql -At -v ON_ERROR_STOP=1` под local admin:

```sql
SELECT json_build_object(
 'schema',(SELECT max(version_id) FROM goose_db_version WHERE is_applied),
 'clubs',(SELECT count(*) FROM core.clubs),
 'objects',(SELECT count(*) FROM development.sample_objects),
 'audit',(SELECT count(*) FROM core.audit_events),
 'seed_signature',md5(
   (SELECT coalesce(string_agg(row_to_json(c)::text,'' ORDER BY tenant_id),'') FROM core.clubs c)||
   (SELECT coalesce(string_agg(row_to_json(o)::text,'' ORDER BY tenant_id,id),'') FROM development.sample_objects o)||
   (SELECT coalesce(string_agg(row_to_json(a)::text,'' ORDER BY tenant_id,event_id),'') FROM core.audit_events a))
)::text;
```

| Проверка | Schema | Clubs/objects/audit | Signature до = после |
|---|---|---|---|
| Clean/repeat dev up | 4→4 | 2/2/4 | `6df2de92f34a72c1c6429fc026b7771f` |
| Isolated release2→current | 3→4 | 2/2/4 | `188d5813f058abb06c757eb7f560d375` |

### Контракт и браузер

```sh
npm --prefix api run check
cd api && npm run check:routes
```

**PASS:**16 operations (13 implemented/3 planned),29 positive/negative fixtures и все response examples, TS generation/client compilation; отдельно добавленная AJV-проверка fixture23 по SessionJournal/совпадения athlete IDs. Структура wire/request/response/security и SQL не изменена; OpenAPI описывает текущую ready schema4 и реализованность.

Из корня; временный CA доверен Chromium согласно [access runbook](../access/README.md). CLI-вывод — bearer secret, хранится в private файле, не публикуется:

```sh
umask 077
docker compose --env-file /tmp/judeos-s0-25-clean/test.env -f ops/test-compose.yaml \
  run --rm --no-deps --entrypoint /app/access-bootstrap seed \
  -tenant 00000000-0000-4000-8000-000000000101 -login synthetic.browser.owner \
  > /tmp/judeos-s0-25-clean/owner-link.json
JUDEOS_BASE_URL=https://localhost:8543 JUDEOS_CHROMIUM_PATH=/usr/bin/chromium \
  npm --prefix api run check:browser
JUDEOS_BOOTSTRAP_LINK_FILE=/tmp/judeos-s0-25-clean/owner-link.json \
  JUDEOS_BASE_URL=https://localhost:8543 JUDEOS_CHROMIUM_PATH=/usr/bin/chromium \
  npm --prefix api run check:access-browser
JUDEOS_CHROMIUM_PATH=/usr/bin/chromium npm --prefix api run check:access-ui
JUDEOS_CHROMIUM_PATH=/usr/bin/chromium npm --prefix api run check:swagger
JUDEOS_CHROMIUM_PATH=/usr/bin/chromium node api/node_modules/@playwright/test/cli.js \
  test -c docs/prototypes/online-journal/playwright.config.cjs
```

**PASS:** live web/runtime Swagger2; real HTTPS access1 (настоящий clipboard, fragment при active session, явный logout/redeem/login/reset, pending→active→revoked, union roles/revoke/last-owner, AJV responses, Secure/HttpOnly/SameSite cookie, пустые local/sessionStorage); mocked access UI2; полный Swagger1; prototype4 (четыре отметки/поиск, lost response/same command, network recovery/explicit conflict, empty/denied/expired/unavailable). Размеры320/390/768/1280 без overflow. Mock/prototype результаты не доказывают серверную attendance/idempotency/RLS или вход прототипа.

Дополнительная live HTTPS проверка передала synthetic contact/password marker в query/path/Authorization/Cookie/X-Request-ID: ответ нейтрален и содержит новый server request_id; API logs содержат route/status/duration/request_id, без marker, invite token, password и login тестовых сотрудников. Private logs/tokens/traces/config/screenshots не включены в Git/PR/Issue.

После проверки удаляется только временное доверие CA; остановка собственных проектов через `test-stack.py ... down`/`make down` сохраняет disposable тома и private config. Повторный access-browser требует свежего pending owner/fixture. Для удаления томов нужен явно scoped сброс собственных synthetic ресурсов; команды не предназначены для действующего VPS. Результат и CI финального PR, независимое review/приёмка/merge фиксируются в [Issue25](https://github.com/StarMadeGalaxy/JudeOS/issues/25).
