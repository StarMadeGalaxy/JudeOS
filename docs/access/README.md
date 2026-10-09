# Доступ сотрудников (#21)

Go/chi + PostgreSQL, только синтетический контур. HTTP-контракт — [OpenAPI](../../api/openapi/openapi.yaml), реестр — [ENDPOINTS](../../api/ENDPOINTS.md), технический выбор — [ADR 0010](../../planning/adr/0010-staff-access.md). Сотрудник получает приглашение от администратора, устанавливает пароль, входит в клуб; администратор выдаёт ссылки восстановления, меняет роли и отзывает доступ. Родительские/детские кабинеты выключены на сервере.

## Запуск и первый владелец

1. `make install build db-up bootstrap migrate seed` с Go из `.go-version` (команды bootstrap/migrate/seed используют локальный ignored `.env`). Исторический access #21 добавлен миграцией00004; текущий runtime требует schema11 с расширением #27. Старые API после upgrade не готовы. При rollout согласовать образ и миграции, не разворачивать этот PR автоматически на существующий VPS.
2. Настроить точный `PUBLIC_ORIGIN=https://...` без пути/trailing slash, query, fragment, credentials. Пустое значение закрывает access API кодом 403; health/docs остаются доступны. Cookie всегда Secure, HttpOnly, SameSite=Lax, Path=/, host-only с `__Host-` prefix. HTTP не является рабочим контуром входа. TLS можно завершать Caddy в том же доверенном стеке, внешний API закрыт. Origin сравнивается с конфигурацией, а не Host/X-Forwarded-* клиента.
3. Для disposable HTTPS stack: `python3 ops/test-env.py --directory /tmp/judeos-access-test --image judeos-scaffold:local`, затем `python3 ops/test-stack.py --config /tmp/judeos-access-test/test.env up` и `export-ca`. Генератор кладёт правильный HTTPS origin в закрытый `api-secrets.env`. Existing config не переписывается: при обновлении оператор добавляет PUBLIC_ORIGIN в свой runtime env. Адрес локального контура — `https://localhost:8443`; доверить exported CA согласно runbook. Не отключать проверку TLS.
4. После seed оператор явно создаёт первое приглашение под migrator credential. Runtime не может bootstrap владельца. Пример только для local disposable БД, вывод — одноразовый секрет:

```sh
set -a
. ./.env
set +a
./bin/access-bootstrap -tenant 00000000-0000-4000-8000-000000000101 -login synthetic.owner
```

В контейнере — `/app/access-bootstrap`, с **migration-secrets.env**, без передачи migrator credential API. Команда не запускается при старте приложения, не задаёт общий пароль. Повтор с тем же pending логином до активации выдаёт замену и отзывает старую ссылку; другой логин/активный владелец запрещают bootstrap. Не публиковать вывод в Issue/CI/логи/репозиторий. Сформировать `https://<origin>/#token=<token>`, передать через проверенный канал. Получатель открывает ссылку или вводит код, устанавливает пароль и входит с переданным логином. Fragment удаляется из history при загрузке, не уходит в HTTP URL/referrer; токен/password/CSRF остаются только в памяти формы. Для локального HTTPS Docker bootstrap запускается оператором с migration env; сам HTTP сервер этих прав не имеет.

## Пароль, сессии и ссылки

Логин — ASCII, trim/lowercase, 1–254 символа; первый `[a-z0-9]`, остальные `[a-z0-9._@+-]`. Это технический идентификатор, не подтверждение телефона/email. Пароль при установке — минимум 12 **Unicode code points**, максимум 1024 **UTF-8 bytes**, без trim/normalization; библиотека `golang.org/x/crypto/argon2`, Argon2id v19, 64 MiB, t=2,p=1, salt 16 bytes/key 32 bytes. Параметры фиксированы и проверяются перед выделением памяти; максимум два password-work одновременно на API процесс, перегрузка 429. Неизвестный/pending/отозванный вход и неверный пароль дают одинаковый LOGIN_FAILED; отсутствующий hash проходит dummy Argon2.

Секреты сессий/preauth/invite/reset — crypto/rand 32 bytes, hex; БД хранит SHA-256 хеш bearer secret. CSRF synchronizer хранится на сервере отдельно и выдаётся только same-origin вкладке. Сессия живёт 8 часов, preauth 10 минут; GET не продлевает срок. Login атомарно потребляет preauth, отзывает прежнюю переданную сессию и выдаёт новую cookie; CSRF после login получить заново. Logout отзывает только текущую сессию, повтор возвращает 401. Пароль/reset/смена ролей/отзыв membership завершают все глобальные сессии аккаунта; права не кешируются в cookie/меню.

Invite живёт 24 часа, reset 30 минут. Новый link заменяет старые links membership. Проверка срока/used, смена hash, активация pending membership и отзыв сессий/ссылок атомарны; replay/expiry/revocation/unknown дают нейтральный LINK_INVALID. Reset выдаёт администратор после проверки человека, только для активного входа, ограниченного текущим клубом, без сетевых/платформенных полномочий. Выдача и redeem повторно проверяют текущую область под account lock; старый reset после расширения прав не принимается. Pending нового входа получает invite, готового — join. Общий recovery без email выполняет platform после ручной проверки; аварийное восстановление самого platform выполняет оператор. [Правила и команда](RECOVERY.md). Отозванный membership не восстанавливается reset/PUT; повторное назначение ready-account требует signed-in согласия по join. Общедоступного поиска входа/отправки сообщений нет. Приглашение по совпавшему логину не меняет пароль готового Account.

## Права и защита владельца

Разрешены только administrator/manager/coach, роли объединяются. Administrator/manager — scope `club`, coach — `assigned_sessions`; прочие комбинации и parent/athlete отклоняются. Владелец в этом срезе — активный administrator; отдельной четвертой роли нет. Только administrator управляет сотрудниками. Manager имеет клубный предметный scope, coach — текущие серверные назначения занятия, не заявленный ID/меню. Общий `access.Allows` проверяет фиксированные действия и объединение, а будущие training/attendance repositories должны получить актуальное назначение/roster в своей транзакции; эти маршруты остаются запланированными (#29–#34). #21 не реализует журнал и не выдаёт назначение тренеру через запрос клиента.

Клуб берётся из действующего membership, затем `WithinTenant` задаёт trusted tenant/account/request в транзакции. Membership/RoleGrant/AccessToken имеют FORCE RLS, составные FK и явные grants. Две узкие migrator-owned SECURITY DEFINER функции находят memberships глобального Account и tenant hash-токена; фиксированный search_path, EXECUTE только runtime, без профилей/паролей/секретов в результате. Runtime прямое чтение клубных таблиц без tenant запрещено. Discovery — внутренний мост authentication → RLS, не HTTP endpoint; произвольный SQL с runtime credential не входит в гарантию object authorization, как в #20.

Изменения доступа сериализуются advisory lock клуба, после lock сессия/права проверяются повторно. SQL trigger защищает последний active administrator при DELETE роли/отзыве membership, включая конкуренцию; API возвращает 409. Сохраняется metadata-only audit membership/grant/token: actor/request/action/type/id/time, без login/password/hash/token/before/after. Runtime не может менять account disabled/id/login, membership account/tenant/id, token expiry/hash, роль через UPDATE или аудит. Изменения в одном PR не означают production-политику retention.

## Защита HTTP и эксплуатация

GET CSRF/session отвергает сторонний Origin и cross-site/same-site Fetch Metadata; мутации требуют точный Origin и X-CSRF-Token текущей preauth/сессии. Нет CORS. Тело JSON до 16 KiB, лишние поля/нужные null/второй JSON отклоняются. Ошибки нейтральны, request_id серверный; логируется route pattern/status/duration/code, не URL/query/header/body/SQL.

PostgreSQL атомарный rate bucket общий для процессов и рестартов: 120 access requests/мин на peer IP; login 10/15 минут одновременно на peer IP и нормализованный login; redeem 10/15 минут peer IP. Успешные попытки тоже считаются, Retry-After указан. IP/login хранятся как digest bucket key; forwarded headers не используются. За reverse proxy IP bucket общий для соединений прокси: это консервативный synthetic лимит, до увеличения нагрузки нужен согласованный trusted-proxy механизм/edge limit, а не доверие произвольному X-Forwarded-For. Exact HTTPS same-origin — обязательная предпосылка.

Каждую минуту API удаляет expired preauth/rate buckets/сессии. Pending accounts, hash-токены tenant и metadata audit сохраняются до явного сброса disposable БД; реальные сроки/backup/retention по #18/#24 не установлены. Архивирование не удаляет историю. После восстановления старой БД сначала остановить API, под migration credential отозвать все восстановленные access.sessions, удалить preauth, по каждому tenant отозвать access_tokens и проверить актуальные grants независимо; только затем возобновлять доступ. [Общий runbook](../operations/runbook.md) и архитектура §10 остаются обязательными; старый backup не доказывает текущие полномочия.

## Проверки

`make check-db` создаёт отдельную БД и проверяет upgrade #19→#20→#21 под разными LOGIN, RLS/составные FK/аудит/закрытый runtime; затем TLS HTTP flow: bootstrap, install password/login/logout, cookie flags, Origin/CSRF, чужой tenant/manager, union roles, last-owner race, reset replacement/expiry/replay, session expiry/revocation и нейтральный login/rate limit. `make check` — race/vet/OpenAPI/примеры/TS/chi.Walk. Browser access smoke использует только synthetic owner; Текущий Swagger показывает46 реально реализованных операций, полный контракт —53 (журнал ещё planned). Секреты тестового запуска не записывать в screenshots или Playwright traces.

Browser smoke: `JUDEOS_BOOTSTRAP_LINK_FILE=/private/owner-link.json JUDEOS_BASE_URL=https://localhost:8443 JUDEOS_CHROMIUM_PATH=/usr/bin/chromium npm --prefix api run check:access-browser`. Private JSON содержит только вывод synthetic CLI; свежий pending owner `synthetic.browser.owner` в fixture tenant 101. После одного прохода нужен новый disposable fixture (env JUDEOS_BROWSER_TENANT/OWNER/COACH), не использовать реальных сотрудников. Локальный CA доверить тестовому Chromium/NSS на время проверки и убрать после; `ignoreHTTPSErrors=false`, traces выключены. Другие browser команды — `check:browser` и `check:swagger`.

### Проверка интерфейса приглашений

Карточка приглашения появляется перед списком сотрудников: логин, роли, срок действия, одноразовая ссылка и порядок действий получателя. Кнопка копирования подтверждает результат; при запрете clipboard ссылку можно выделить вручную. Скрытие карточки не отзывает приглашение. Новый код заменяет предыдущий.

Список различает `pending` (неактивная membership, пароль ещё не установлен), `active` и `revoked` (неактивная membership с установленным паролем). `active` остаётся совместимым флагом API. При открытии ссылки в уже авторизованном браузере пользователь явно выбирает выход для установки пароля или возврат в своё пространство; чужое приглашение не применяется к текущей сессии. Fragment обрабатывается и при навигации без перезагрузки и сразу удаляется из адреса; код остаётся только в памяти. После установки пароля нужен отдельный вход с логином получателя. Техническая проверка `/readyz` остаётся доступной оператору, но не кнопкой в пользовательском интерфейсе.

`npm --prefix apps/web run build && npm --prefix api run check:access-ui` проверяет эти сценарии в Chromium с синтетическим mocked API, включая явный выход и мобильные размеры. Это дополнение к проверке реального HTTPS/БД, а не её замена.

Расширенный `check:access-browser` использует реальный API/БД и clipboard Chromium (не подменённый clipboard): pending→active→revoked, same-document fragment и новая загрузка ссылки при active session, выбор остаться/явный logout, установка пароля получателю без изменения владельца, reset, union roles, server-side revoke и last-owner refusal. AJAX responses проверяются AJV по runtime OpenAPI, тела диагностических fetch читаются до навигации. Скриншоты сохраняются только после скрытия bearer-ссылок, trace выключен. На свежем disposable fixture успешно пройден 8 октября 2026; локальная интеграция Codex Browser не участвует в этом тесте.

## Дополнение #27: единый вход и сеть

Новые schema 5/6 добавляют [реестр и явные сетевые/платформенные права](../people/README.md); runtime теперь требует schema 11. Прежние login/install/reset/revoke endpoints и TTL сохраняются. Готовый вход присоединяется через отдельный signed-in join endpoint без смены пароля. Manager имеет только отдельные назначения/отзыв coach своего клуба; club administrator сам не становится владельцем других клубов. Первый отдельный platform administrator создаётся operator-only cmd/platform-bootstrap, последующие полномочия — через явно разрешённую панель. Последние authority grants защищены; старый last-local-administrator guard сохранён.
