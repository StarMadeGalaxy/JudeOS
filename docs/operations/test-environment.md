# Синтетический HTTPS test

## Предпосылки и границы

Docker Engine/Buildx и Compose v2, Python 3, Git; сборка использует закреплённые образы, lockfiles и Go из [ops/Dockerfile](../../ops/Dockerfile). Для CI/host-проверок Go 1.27.1, Node 24.19.0/npm 11.9.0. Test — самостоятельный [Compose](../../ops/test-compose.yaml), не overlay dev-среды. Свой уникальный Compose project, тома и config; API и БД не имеют опубликованных портов. БД подключена только к Docker network `internal: true`; снаружи доступен edge. Host/Docker administrator всё равно имеет доступ: это не граница прав администратора или tenant/RLS.

Каркас #19 использует одну синтетическую роль PostgreSQL для API/миграций/seed. Это временное ограничение принятой main, не готовая политика production. Отдельные runtime/migration роли принадлежат #20 и подключаются после её приёмки/merge с повторной проверкой CI. Нельзя выдавать отсутствие DB-порта за выполнение #20.

## Локальная проверка

Из корня checkout, конфигурация и результаты **вне Git**. Пример путей подходит Linux; выберите собственные абсолютные пути без пробелов/`$`/кавычек. Существующий каталог config не перезаписывается.

```sh
python3 ops/release-builder.py --name judeos-release
python3 ops/release-build.py --builder judeos-release --output /tmp/judeos-release --verify-rebuild
python3 ops/test-env.py --directory /tmp/judeos-test --project judeos-test-local
python3 ops/test-stack.py --config /tmp/judeos-test/test.env up
python3 ops/test-stack.py --config /tmp/judeos-test/test.env export-ca
python3 ops/test-stack.py --config /tmp/judeos-test/test.env --ca /tmp/judeos-test/local-root.crt check
python3 ops/test-probe.py --url https://localhost:8443 --ca /tmp/judeos-test/local-root.crt
```

Builder создаётся отдельно, существующий не заменяется; `--builder` всегда явный, Docker context не переключается. Для normal trust без HTTPS-intercepting proxy параметр CA не нужен. Docker driver отклоняется: он не обеспечивает применяемый здесь экспорт с нормализацией timestamp-ов; используется закреплённый BuildKit docker-container. Удалять builder после работы можно явным `docker buildx rm judeos-release`; это удаляет его cache, не test volumes.

Чистый checkout обязателен для релизной сборки. Во время локальной разработки `--allow-dirty` разрешает лишь проверку и помечает manifest `dirty: true`; такой артефакт нельзя выпускать. Для HTTPS-intercepting proxy добавить `BUILD_CA_PATH=/absolute/path/to/public-combined-ca.pem` к **процессу сборки**. В управляемом Codex CA также требуется при создании dedicated builder: `BUILD_CA_PATH=/etc/ssl/certs/ca-certificates.crt python3 ops/release-builder.py --name judeos-release`; для сборки: `BUILD_CA_PATH=/etc/ssl/certs/ca-certificates.crt python3 ops/release-build.py ...`. Без параметра используется штатный trust store образов. Внешние запросы сохраняют proxy и TLS verification; локальный probe проверяет literal loopback напрямую, Caddy добавляет только внутренние api/db/loopback в NO_PROXY; build CA не попадает в image.

Открыть `https://localhost:8443/`, `/docs`, `/healthz`, `/readyz`. Локальный Caddy выпускает сертификат от своего CA; `local-root.crt` — публичный корень только этого синтетического test. `curl --cacert /tmp/judeos-test/local-root.crt https://localhost:8443/readyz` проверяет цепочку и hostname. Для просмотра в браузере импортировать этот корень в отдельный тестовый профиль; без доверия браузер предупредит. Не использовать `-k`, отключение TLS verification или глобальное доверие неизвестному CA. Это локальная HTTPS-проверка, не публичный сертификат. В локальном режиме HTTP redirect отключён, чтобы нестандартный host-порт 8443 не подменялся 443.

`up` запускает БД → миграции → явный seed → API → edge. Ошибка migrator/seed не позволяет стартовать API. Два fixtures вымышлены, повторный seed не размножает записи. `check` проверяет фактическое отсутствие DB port bindings и внутреннюю сеть через Docker inspect, затем ответы через HTTPS. `exercise` останавливает DB и проверяет health 200/readiness 503, возвращает DB и ждёт readiness 200; только в собственной disposable среде.

```sh
python3 ops/test-stack.py --config /tmp/judeos-test/test.env status
python3 ops/test-stack.py --config /tmp/judeos-test/test.env down
```

`down` сохраняет данные. Удаление томов — только явный сброс собственного синтетического проекта: `docker compose --env-file /tmp/judeos-test/test.env -f ops/test-compose.yaml down --volumes`. Никогда не применять к нужной/общей БД. Генератор выдаёт directory 0700 и files 0600. Пересоздание config с новым паролем не меняет пароль существующего DB volume.

## Раздельная конфигурация и секреты

| Файл вне checkout | Содержимое | Получатель |
|---|---|---|
| `test.env` | project/image/domain/ports/пути; без пароля | Compose/operator |
| `db-password` | случайный пароль только этой synthetic БД | PostgreSQL через secret file |
| `api-secrets.env` | DATABASE_URL с тем же synthetic credential | migrator, seed, API через env_file |
| `local-root.crt` | публичный локальный CA | только клиент локальной проверки |

API main принимает DATABASE_URL через environment. Docker administrator может прочитать process/container environment; отдельный secret-file API-интерфейс не выдумывается. Не публиковать `docker compose config`, inspect Environment, config-каталог, dump или credentials в CI logs/Issue/PR. TLS защищает внешний HTTP; внутреннее DB-соединение пока `sslmode=disable` внутри изолированной сети одного host. Для разделённых host/production нужен отдельный защищённый DB-канал.

Production пока не развёрнут. Если он появится, используются отдельные host/config-каталоги, credentials, project/тома, ключи внешних сервисов и права; test не копирует production config/данные. Этот генератор создаёт только test. Ни production secrets, ни deploy credentials не требуются PR checks. Workflow не выполняет SSH/deployment. Не задавайте секреты в frontend/Vite variables: клиентская сборка публична.

## Публичный test — после предоставления параметров

Нужны: площадка и host/OS с Docker, реальный FQDN и управление DNS A/AAAA, адрес host, защищённый доступ управления, ответственный оператор, доступ к GHCR digest, правила inbound firewall и outbound ACME. Не передавать ключи/токены в чат; доступ подключается через поддерживаемые credentials окружения. Реальные роли/права доступа и production-контур не считаются согласованными.

После выпуска проверенного образа:

```sh
python3 ops/test-env.py --directory /srv/judeos-test-config \
  --project judeos-public-test --public --domain test.YOUR-DOMAIN \
  --http-port 80 --https-port 443 --image ghcr.io/starmadegalaxy/judeos@sha256:YOUR_DIGEST
python3 ops/test-stack.py --config /srv/judeos-test-config/test.env up
python3 ops/test-stack.py --config /srv/judeos-test-config/test.env --url https://test.YOUR-DOMAIN check
python3 ops/test-probe.py --url https://test.YOUR-DOMAIN
```

Placeholder-команда требует настоящие lowercase DNS имя и 64-символьный digest. `--public` отвергает localhost/test/invalid domains, mutable image tags и другие порты. Это предохранитель, не проверка собственности домена. Оператор направляет DNS на host и разрешает внешние TCP 80/443 для ACME/redirect/HTTPS; 5432 и 8080 не открывает. Public Caddy использует обычный ACME и trust clients, без `tls internal`. Caddy data volume хранит сертификаты/ключи: доступ host ограничивается отдельно; не публиковать его содержимое.

С независимого внешнего клиента подтвердить DNS/цепочку/hostname HTTPS, redirect HTTP→HTTPS, web/Swagger и 200 health/readiness; проверить недоступность TCP 5432/8080 и firewall host. Локальный Docker inspect доказывает отсутствие published DB ports у данной конфигурации, но не исключает чужой DB/listener на host. Записать host/domain/image digest/commit/schema, дату и результаты в #22/PR без credentials. До такой проверки реальное размещение/публичный HTTPS остаются открытыми.
