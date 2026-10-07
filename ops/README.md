# Синтетический запуск и сопровождение каркаса #19

Только локальная тестовая среда. Две записи `development.sample_clubs` вымышлены; предметный вход/журнал ещё не реализованы. Полный принятый контракт — [api](../api/README.md), выбранные инструменты/границы — [ADR 0007](../planning/adr/0007-synthetic-scaffold.md). Изоляция/RLS/роли БД — #20, auth — #21, CI/HTTPS/production — #22; эти критерии каркас не закрывает.

## Чистый запуск через Docker

Нужны Docker Engine и Compose v2, Python 3 и Make. Проверено с Engine 28.4.0 / Compose 2.40.3 на Linux. Из корня:

```sh
make up
```

`make env` (часть up) создаёт игнорируемый `.env` с отдельным случайным локальным паролем, mode 0600. Существующий файл сохраняется. Значения не передаются через чат/Git/Issue. [Пример](../.env.example) предназначен для ручной настройки, не production. Сборка → PostgreSQL health → миграции → явный синтетический seed → API; миграции и seed — отдельные завершающиеся контейнеры, ошибка не позволяет стартовать API. По умолчанию открыты только loopback-порты 8080 и 54329; таблицы живут в именованном томе. Для другого порта измените HTTP_PORT/POSTGRES_PORT; для host-команд также обновите DATABASE_URL.

- Web: http://127.0.0.1:8080/
- Swagger: http://127.0.0.1:8080/docs (четыре реализованные служебные операции)
- Проверки: `/healthz`, `/readyz`; контракт: `/openapi.json`.

Повторный `make up` сохраняет том, миграции пропускают применённые версии, seed не добавляет дубликатов и не перезаписывает существующие записи. Изменение пароля `.env` не меняет пароль уже созданной БД; при сохранении тома используйте прежний локальный пароль.

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
make migrate
make seed
make run
```

Для выбранного бинарника Go: `make GO=/absolute/path/to/go build`. `DATABASE_URL` обязателен; ошибка конфигурации не выводит DSN/пароль. HTTP_ADDR по умолчанию 127.0.0.1:8080; WEB_DIR — apps/web/dist; API_DIR — api/dist. Для локальной разработки UI: запустить Go и `npm --prefix apps/web run dev`, открыть Vite на 127.0.0.1:5173. `/api`, служебные маршруты и Swagger проксируются на 8080 без CORS. Изменение схемы не выполняется при старте API; до миграций readiness возвращает 503, liveness остаётся 200.

## Миграции и seed

[db/migrations](../db/migrations) содержит SQL с goose Up/Down; файлы встроены в Go binary. №1 создаёт schema development и sample_clubs, №2 добавляет timezone со значением Europe/Minsk для существующих строк. Это ограниченные fixtures, не таблицы предметной модели Club/Account/Athlete. Миграции транзакционны; применённые файлы не изменять, расширения добавлять следующим номером. В одной БД запускать один migrator; автоматического down/reset нет. Политика совместимого релиза/восстановления — #22/#24. Разрушительные Down существуют для понимания обратимости, CLI намеренно предоставляет только up.

`./bin/db migrate` доводит до текущей версии 2. `./bin/db -to 1 migrate` применяет первый шаг на пустой БД для теста upgrade; это не откат более новой схемы. API принимает ровно версию 2; старый binary перед новой схемой не объявит готовность. После неудачной миграции исправьте причину и повторите up, не редактируя применённые файлы и не очищая том. `./bin/db seed-synthetic` требует текущую схему и создаёт две фиксированные UUID-записи атомарно с ON CONFLICT DO NOTHING.

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

`check-db` создаёт только собственную случайно названную БД в synthetic Compose PostgreSQL, проверяет upgrade с уже существующей строкой, повтор up/seed, отказ readiness на пустой/старой/новой схеме и удаляет свою тестовую БД. Обычный `go test` пропускает PostgreSQL-тест, пока не задан JUDEOS_TEST_DATABASE_URL: это должна быть отдельная пустая disposable БД, никогда production DATABASE_URL. Checks не проверяют RLS, auth, отметки или восстановление production.

Для диагностики — `docker compose --env-file .env -f ops/compose.yaml ps` и logs выбранного сервиса. Логи приложения не содержат DSN, входящих тел или secrets; API выдаёт безопасную Error с request_id. Не публикуйте `.env`, `docker compose config` или dump окружения. SIGINT/SIGTERM даёт HTTP до 5 секунд на завершение; сервер ограничивает заголовки 16 KiB и HTTP timeout'ы 5/10/10/60 секунд (read-header/read/write/idle). Worker не создаётся до реального потребителя.

`go mod tidy` в текущем облачном окружении затрагивает тестовую SQLite-зависимость goose; её архив перенаправляется на запрещённый storage.googleapis.com. Для сборки используются проверяемые go.mod/go.sum и `go build -mod=readonly` с зависимостями реально импортируемых пакетов. Ограничение не обходилось; production SQLite-драйвер не используется. При изменении Go-зависимостей выполнять tidy в окружении с разрешёнными адресами и проверять diff.
