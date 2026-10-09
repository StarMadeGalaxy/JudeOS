# Синтетический запуск и сопровождение основы S0

Только синтетическая среда. Два клуба и объекты вымышлены; вход сотрудников реализован #21, журнал остаётся planned с отдельным [прототипом](../docs/prototypes/online-journal/README.md). Полный контракт — [api](../api/README.md), инструменты — [ADR 0007](../planning/adr/0007-synthetic-scaffold.md), роли/RLS/FK/аудит — [ADR 0008, предложено](../planning/adr/0008-tenant-isolation-and-audit.md), [access/HTTPS](../docs/access/README.md). CI/test #22 интегрированы; production и реальные данные ждут #18/#24.

## Чистый запуск через Docker

Нужны Docker Engine и Compose v2, Python 3 и Make. Проверено с Engine 28.4.0 / Compose 2.40.3 на Linux. Из корня:

```sh
make up
```

`make env` (часть up) создаёт игнорируемый `.env` с тремя разными случайными локальными паролями, mode 0600. Существующие пароли и пользовательские DSN сохраняются; известный DATABASE_URL с пользователем judeos_dev из #19 заменяется runtime DSN с тем же host/port/db, добавляются bootstrap/migration DSN и пароли новых ролей. Значения не передаются через чат/Git/Issue. [Пример](../.env.example) предназначен для ручной настройки, не production. Сборка → PostgreSQL health → явный bootstrap-local → миграции → синтетический seed → API. Bootstrap/migrate/seed — отдельные завершающиеся контейнеры; ошибка не позволяет стартовать API. Административный пароль передаётся только db/bootstrap, миграционный — migrate/seed, runtime — API. Технический bootstrap работает только в отдельном локальном синтетическом кластере. По умолчанию открыты только loopback-порты 8080 и 54329; таблицы живут в именованном томе. Для другого порта измените HTTP_PORT/POSTGRES_PORT; для host-команд также обновите все три DATABASE_URL/BOOTSTRAP_DATABASE_URL/MIGRATION_DATABASE_URL.

- Web: http://127.0.0.1:8080/
- Swagger: http://127.0.0.1:8080/docs (13 реализованных access/служебных операций; вход требует HTTPS)
- Проверки: `/healthz`, `/readyz`; контракт: `/openapi.json`.

Повторный `make up` сохраняет том, миграции пропускают применённые версии, seed не добавляет дубликатов и не перезаписывает существующие записи. Изменение паролей `.env` не меняет пароли уже созданной БД/ролей; при сохранении тома используйте прежние значения. Bootstrap не сбрасывает пароль существующей роли. Ротация — отдельная явная административная операция, не повторный make env.

`make down` останавливает контейнеры и сохраняет данные. Удаление тома — только явный сброс disposable synthetic среды: `docker compose --env-file .env -f ops/compose.yaml down --volumes`. Не выполнять против БД с нужными данными. Для повторного чистого запуска после такого сброса — `make up`.

## Прокси и CA в облачной среде

Обычный `make up` использует CA stores внутри Docker images и не требует сертификата или Linux-пути на host. Это режим для стандартного Docker Desktop/macOS/Windows/Linux без отдельного TLS-intercepting proxy.

Если окружение использует HTTPS-прокси с дополнительным CA, подключите существующий **публичный** bundle явно:

```sh
make up BUILD_CA_PATH="/absolute/path/to/public-ca-bundle.pem"
```

В управляемом Linux-окружении Codex используется уже настроенный combined system bundle:

```sh
make up BUILD_CA_PATH=/etc/ssl/certs/ca-certificates.crt
```

BUILD_CA_PATH передаётся как параметр Make или переменная процесса (`export BUILD_CA_PATH=...`), а не как настройка активации в `.env`. Make добавляет [compose.ca.yaml](compose.ca.yaml) к базовому Compose только при непустом параметре. При прямом вызове Docker Compose добавьте `-f ops/compose.ca.yaml` после `-f ops/compose.yaml` и передайте BUILD_CA_PATH в environment. Если выбранный файл отсутствует, явный CA-режим завершится ошибкой; обычный режим его не читает.

Docker сохраняет существующие proxy defaults/registry credentials. BuildKit монтирует дополнительный bundle как optional secret `build_ca` только в CA-режиме; npm задаёт NODE_EXTRA_CA_CERTS, Go — SSL_CERT_FILE только при наличии mount. Без mount используются штатные trust stores образов. TLS verification всегда включена; bundle не копируется в image. Proxy credentials не являются build secrets приложения и не должны попадать в `.env`/Dockerfile; унаследованный proxy не отключается.

Runtime scratch-образ не делает внешних HTTPS-вызовов; он работает только с внутренней синтетической БД (sslmode=disable). CA/HTTPS для будущих интеграций и размещения добавятся по их задачам. Ошибка запрета домена требует настройки политики окружения, не обхода прокси.

## Запуск с инструментами на host

Go **1.27.1**, Node **24.19.0**, npm **11.9.0**, PostgreSQL **18.3** закреплены в версии/manifest/Compose. Из корня:

```sh
make install
make build
make db-up
make bootstrap
make migrate
make seed
make run
```

Для выбранного бинарника Go: `make GO=/absolute/path/to/go build`. `DATABASE_URL` API обязателен и должен использовать judeos_runtime. CLI migrate/seed использует только MIGRATION_DATABASE_URL; bootstrap-local — BOOTSTRAP_DATABASE_URL и MIGRATION_PASSWORD/RUNTIME_PASSWORD. Административная DSN не является fallback. Ошибка конфигурации не выводит DSN/пароль. HTTP_ADDR по умолчанию 127.0.0.1:8080; WEB_DIR — apps/web/dist; API_DIR — api/dist. Для локальной разработки UI: запустить Go и `npm --prefix apps/web run dev`, открыть Vite на 127.0.0.1:5173. `/api`, служебные маршруты и Swagger проксируются на 8080 без CORS. Изменение схемы не выполняется при старте API; до миграций readiness возвращает 503, liveness остаётся 200.

## Роли, миграции и seed

`./bin/db bootstrap-local` — явное provisioning отдельного локального кластера. Создаёт judeos_migrator/runtime LOGIN и judeos_audit_reader NOLOGIN, без SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE/INHERIT и членств. Проверяет существующие роли и отклоняет привилегированные/связанные; пароли сохраняет. Отзывает PUBLIC CREATE БД/public, выдаёт migrator CREATE, runtime только CONNECT/USAGE; переносит ownership известных schema development/sample_clubs/goose_db_version из #19 migrator для upgrade. Не запускается автоматически API и не является инструкцией production provision; роль backup здесь не создаётся. Роли кластерные, не используйте этот bootstrap в общем кластере с нужными данными.

[db/migrations](../db/migrations) встроены в Go binary: №1 development/sample_clubs, №2 timezone; применённые файлы не менялись. №3 создаёт core.clubs и сохраняет все старые строки, синтетическую sample_objects с составным FK и core.audit_events. Все три защищены ENABLE/FORCE RLS; runtime не владеет ими. Старая sample_clubs сохранена для upgrade и закрыта runtime. Новые предметные таблицы добавляются в своих задачах, явными миграциями с RLS/FK/grants/audit. Миграции транзакционны, одна активная миграция на БД; версия 3 требует именно judeos_migrator. CLI предоставляет только up, автоматического down/reset нет.

Миграция №4 добавляет account/session/preauth/rate buckets и tenant membership/grant/token с RLS/FK/аудитом; [модель](../planning/DATA-MODEL.md) и [access](../docs/access/README.md) описывают права. Применённые SQL 00001–00004 не переписываются.

`./bin/db migrate` доводит до версии 4. `./bin/db -to 1 migrate` — первый шаг для проверки пустой БД, не откат. API принимает ровно версию 4 и безопасную роль runtime; неправильная роль, пустая/старая/слишком новая схема дают 503 readiness, health остаётся 200. После ошибки исправьте причину и повторите up, не меняя применённые SQL и не очищая нужный том. Старый schema3 API после upgrade не готов; это не совместимый rollback. Политика релиза/backup/совместимого отката — [release runbook](../docs/operations/releases.md)/#24; действующий VPS release2/schema3 этой локальной командой не обновляется.

`./bin/db seed-synthetic` требует текущую схему, повторяет две старые fixtures, затем по одной транзакции на tenant добавляет Club и синтетический объект через ON CONFLICT DO NOTHING. UUID фиксированы; actor/request явно синтетические. Повтор не перезаписывает существующие строки и не дублирует аудит; при частичном сбое следующий запуск завершает остальные клубы. Перенос старых строк миграцией не создаёт выдуманный исторический аудит.

Application service должна проверить актуальные права и передать разрешённые tenant/actor и серверный request_id в `database.WithinTenant`. Все repository-запросы внутри callback выполняются через полученный `*sql.Tx`, не через pool; set_config(..., true) локален транзакции. Обёртка валидирует наличие контекста до SQL, commit/rollback/error/panic/cancel не оставляют его следующему соединению. Политика SQL требует tenant при обращении к строкам; пустая выборка не гарантирует её вызов. Произвольные SQL/runtime credential и клиентский tenant не являются разрешением. RLS не заменяет объектные права/полевую проекцию; auth реализован #21, предметные права проверяются с соответствующими командами.

## Минимальный аудит

События INSERT/UPDATE/DELETE Club и синтетических объектов атомарны с эффектом. Неизменившийся UPDATE не добавляет событие. Поля: tenant, actor UUID, request_id, действие, тип/ID объекта и время; имена/label/контакты/секреты/SQL/payload/before-after не пишутся. Runtime не читает и не меняет события. Отдельная NOLOGIN capability judeos_audit_reader имеет SELECT и RLS выбранного tenant; она не назначена приложению и не выдаёт продуктовую роль администратора/менеджера. Проверки используют только admin SET ROLE в отдельном test-соединении. Для реального чтения/экспорта нужны явно согласованные права и отдельный контролируемый путь (#18/#21); не выдавайте членство runtime.

Хранение синтетического аудита — только жизненный цикл disposable БД/тома до явного сброса. TTL/автоматическое удаление отсутствует; check-db удаляет свою БД в finally. Согласованные числовые сроки/основания/продуктовые права/удаление копий не установлены: #18/#24 должны их определить до реального пилота. Технический владелец/администратор БД доверен; этот журнал не tamper-proof защита от него.

## Проверки и диагностика

```sh
make build
make check
make db-up
make check-db
# При работающем API:
cd api
npm run check:runtime
JUDEOS_CHROMIUM_PATH=/usr/bin/chromium npm run check:browser
JUDEOS_CHROMIUM_PATH=/usr/bin/chromium npm run check:swagger
```

`check-db` создаёт только собственную случайно названную БД в synthetic Compose PostgreSQL, проверяет upgrade старого admin ownership #19 с существующей строкой до схемы 4, повтор bootstrap/up/seed, роли и RLS/FK двух клубов, отсутствие контекста/утечки пула после commit/error/panic/cancel, конкуренцию на одном соединении, доступ и атомарность аудита и отказ readiness на пустой/старой/новой схеме или privileged role. Затем выполняет реальный TLS HTTP/PostgreSQL access flow: вход, cookie/CSRF/Origin, приглашения/reset, чужой tenant, роли, отзыв/истечение и защита последнего владельца. Удаляет только свою тестовую БД; LOGIN-роли отдельного synthetic кластера сохраняются. Обычный `go test` пропускает PostgreSQL-тесты, пока не задан JUDEOS_TEST_DATABASE_URL: это должна быть отдельная пустая disposable БД, никогда production DATABASE_URL. Предметные отметки и восстановление production эти checks не проверяют.

Для диагностики — `docker compose --env-file .env -f ops/compose.yaml ps` и logs выбранного сервиса. API генерирует request_id сам, игнорирует входящий X-Request-ID и передаёт ID в context/заголовок/ошибку. Логи запросов содержат только ID, зарегистрированный route pattern, status/duration и безопасный panic code; URL/query/header/body, произвольный method и raw error/panic value не пишутся. Транзакционный слой выдаёт нейтральные категории denied/constraint/database и cancellation без SQL/constraint/detail. API выдаёт безопасную Error с тем же request_id; предметное HTTP-отображение ошибок добавляется с endpoint'ами. Не публикуйте `.env`, `docker compose config` или dump окружения. SIGINT/SIGTERM даёт HTTP до 5 секунд на завершение; сервер ограничивает заголовки 16 KiB и HTTP timeout'ы 5/10/10/60 секунд (read-header/read/write/idle). Worker не создаётся до реального потребителя.

`go mod tidy` в текущем облачном окружении затрагивает тестовую SQLite-зависимость goose; её архив перенаправляется на запрещённый storage.googleapis.com. Для сборки используются проверяемые go.mod/go.sum и `go build -mod=readonly` с зависимостями реально импортируемых пакетов. Ограничение не обходилось; production SQLite-драйвер не используется. При изменении Go-зависимостей выполнять tidy в окружении с разрешёнными адресами и проверять diff.
