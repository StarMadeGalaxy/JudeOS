# ADR 0010: ограниченный SSH transport для синтетической VPS

Статус: предложено для ревью. Дата: 7 октября 2026. Задача: [#91](https://github.com/StarMadeGalaxy/JudeOS/issues/91). Не утверждает готовое внешнее размещение или production. CI/test/release — отдельная #22 и её ADR 0009.

## Контекст

Пользователь предоставил Hostinger VPS/домен и Ubuntu 24.04, поручил дать код доступа и автоматизации. Текущая среда агента не имеет SSH credential/TCP доступа. Автоматически выпущенный SSL не доказывает текущий listener или подключение к приложению. Доступ к Docker или произвольный sudo фактически даёт административные полномочия; его нельзя назвать ограниченным деплоем. См. [источник и инструкции](../../docs/environments/hostinger-deploy-access.md).

## Предложение

Отдельный `judeos-deploy` без Docker-группы, интерактивной оболочки, TTY, SFTP/SCP/forwarding и права записи в собственные keys/контроллер. Root-owned OpenSSH ForceCommand и authorized_keys restrict направляют запрос в валидатор точных `check` / `deploy vMAJOR.MINOR.PATCH[-prerelease] sha256:<64 hex>` (legacy digest использует baseline tag); единственное NOPASSWD sudo-разрешение ведёт в фиксированный root-owned Python controller с isolated interpreter. Произвольные аргументы и raw logs не проходят эту границу. Администратор сохраняет отдельный канал установки и восстановления.

Host key закрепляется только после сравнения с fingerprint из консоли VPS. Private key хранится в Environment Secret Actions либо в защищённой конфигурации агента; публичный ключ — на VPS. Клиент запрещает интерактивный fallback, сторонний ssh config, смену host keys и незакреплённую host identity. Ограничения сети настраиваются поддерживаемым способом; ключ сам по себе не предоставляет TCP-связность.

Независимый preflight позволяет проверить доступ до принятия #22. Применение релиза закрыто до установки отдельной root-owned release policy/adapter. Transport передаёт immutable image reference с digest и проверяемое имя релизного тега; policy, adapter и родители не могут быть symlink или writable не-root. Root lock сериализует выполнение. Adapter получает чистую среду; серверные секреты/proxy загружает из проверенной конфигурации. Его raw stdout/stderr не выходят через SSH.

Подготовлен release adapter по технически согласованному контракту #22: root-owned baseline checkout/config/SQL, published manifest/tag/CI/image identity, foreground up/check и внешний HTTPS probe. Пользователь отдельно выбрал автоматический synthetic deploy после успешного CI и публикации release с неизменными миграциями (DECISIONS U2026-10-07-VPS-AUTO). Эти пользовательские требования подтверждены; описание конкретной реализации ADR остаётся предложением для PR-ревью. #89 — подготовительный Refs #22, его merge не означает завершённый VPS test.

Workflow запускается после successful CI tag push через workflow_run, поскольку GITHUB_TOKEN release event обычно не создаёт новый workflow. Код/credentials job только из main, не из PR artifacts. Gate требует published release.json, source/tag в main, current-attempt jobs CI включая publish; server повторяет gate, проверяет schema version и полный набор SQL-хешей с baseline до pull. Сверка GitHub/OCI metadata не является подписанной provenance. Изменение схемы или ops baseline не обновляет root policy автоматически.

Adapter меняет только проверенный TEST_IMAGE и выполняет frozen accepted test-stack.py; server credentials, Caddy material и volumes сохраняются. Runtime/migrator credentials остаются разделёнными по #20/#22. Clean root-owned checkout включает Git config/hooks и helpers, чтобы deploy key не мог подменить root execution. Монотонная ancestry исключает более старый/diverged rollout; отсутствие SQL-изменений не доказывает всей runtime compatibility, обязательны readiness/public checks.

Root lock fd остаётся у adapter в отдельной session при потере SSH/controller, workflow cancel-in-progress=false. Raw root logs скрыты; allowlisted state хранит attempted/successful image/source/tag. При неполном rollout нет автоматического downgrade/rollback или удаления volumes, состояние требует диагностики оператора. Включение capability выполняет root enable-release.py после опубликованного CI release, фиксируя policy последней и сохраняя secrets; команда сама не запускает приложение. Реальная серверная установка adapter и GitHub credentials ещё не подтверждены.

## Альтернативы и последствия

Обычный SSH/root или Docker group проще, но даёт произвольные административные команды ключу автоматизации. Docker Manager может управлять Compose, но не даёт этому агенту отдельный проверенный транспорт и не заменяет версионированный release-контракт. Self-hosted runner непосредственно на VPS выполнял бы доверенный workflow с её полномочиями; при одном CPU/4 GB предпочтение пока не установлено и PR-код на нём недопустим. Предложен GitHub-hosted runner + SSH, без сборки приложения на VPS; test-оператор @NikishGum назначен в чате #22; пользователь проверил SSH с Mac. Канал Actions/VPS, credentials и прямой TCP облачной среды ещё требуют настройки/проверки.

Установщик поддерживает Ubuntu 24.04 и отказывает при конфликтующей SSH-конфигурации/существующем unmanaged аккаунте. Не изменяет firewall/Docker/proxy/БД. Отзыв authorized_keys прекращает новые logins, но не уже выполняющийся deploy. Negative checks выполняются через настоящий OpenSSH/sudo в одноразовом Ubuntu, не вместо проверки Hostinger. #91 остаётся незавершённой до интеграции и внешней проверки; #18/#24 продолжают ограничивать реальные данные.
