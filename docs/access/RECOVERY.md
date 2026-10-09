# Восстановление общего входа без email

В #27 по [поручению владельца](https://github.com/StarMadeGalaxy/JudeOS/issues/27#issuecomment-6084409663) добавлен базовый сценарий: администратор платформы проверяет получателя вне программы и выдаёт одноразовую ссылку. Совпадение имени, телефона, семьи или логина не доказывает личность. Программа фиксирует утверждение `identity_verified:true`, но не хранит материалы проверки. Процедура для реальных пользователей остаётся условием эксплуатации #18/#24; здесь только synthetic.

В панели платформы укажите точный логин, подтвердите проверку и нажмите «Выдать ссылку восстановления». Получатель открывает fragment-ссылку `/#token=…`, сам задаёт новый пароль и затем входит с прежним логином. Email/Telegram не отправляются. UI держит ссылку только в памяти, позволяет скопировать/скрыть, очищает при смене получателя/выходе. Администратор клуба и владелец сети глобальную ссылку не выдают; прежний клубный reset сохраняет ограниченную область #21/#27.

`POST /api/v1/platform/password-recovery` требует актуальной platform-сессии, CSRF/Origin и `{login,identity_verified:true}`. Ответ201 — `{kind:"recovery",token,expires_at}`; unknown/pending/disabled получатель даёт нейтральный400 LINK_INVALID. Shared PostgreSQL rate limit120/minute, JSON16KiB, `no-store`. Точный контракт — [OpenAPI](../../api/openapi/openapi.yaml), [реестр](../../api/ENDPOINTS.md).

Ссылка живёт30 минут; в БД только hash256-bit случайного секрета. Повтор выдачи гасит предыдущую. При потере ответа явно выдайте новую, автоматического повторения нет. Redeem заново проверяет ready/disabled получателя, TTL/used и действующие platform-права выдавшего. Отзыв platform-роли навсегда погашает её неиспользованные ссылки; повторное назначение не возрождает их. Операторская ссылка также требует действующих platform-прав получателя.

Проверка preauth CSRF, использование токена, смена Argon2id hash, отзыв всех сессий и прежних access/install/join/recovery ссылок атомарны с metadata audit. `access/redeem` не создаёт сессию. Рабочие назначения/роли не меняются: отозванные права не активируются; pending join потребуется выдать заново. Редкая глобальная команда держит platform lock, упорядоченные network/club locks и затем account row lock; hashing выполняется до транзакции. Это coarse serialization для S1, не обещание масштабируемости при большом числе клубов.

## Аварийное восстановление администратора платформы

После проверки получателя оператор использует migration connection отдельно от HTTP runtime:

```sh
go run ./cmd/platform-recovery --login synthetic.platform --operator-ref synthetic-procedure-27 --identity-verified
```

`MIGRATION_DATABASE_URL` передаётся через среду. Только `judeos_migrator`, уже настроенный не disabled действующий platform administrator и явное подтверждение проверки. `operator-ref` — символический ID процедуры, ASCII letters/digits/`._:-`,1–80 знаков; без персональных данных. Команда не создаёт вход, не повышает club/network account и не возвращает отозванную platform-роль. Если действующих администраторов нет, нужно отдельное решение восстановления полномочий.

На stdout один раз выводится JSON `kind/token/expires_at`; не направлять его в logs/CI artifacts/общий чат. Получатель использует тот же fragment/`access/redeem`. Ошибка CLI нейтральна. Token не является паролем; старый пароль из хеша не извлекается, ручная правка хеша не требуется.

Новые миграции00010/00011 не меняют00001–00009.00011 добавляет DB-guard: любая успешная смена password_hash, включая прежний клубный reset, погашает старые recovery-ссылки в той же транзакции. Guard не берёт новые advisory locks под уже удержанным account lock; сохраняется аудит enclosing reset/redeem. Выдача повторно проверяет issuer session после ожидания recipient account lock. `access.password_recoveries` хранит ID получателя/выдавшего либо operator-ref, hash, срок/used. FORCE RLS; runtime не читает/пишет новые таблицы напрямую и не выполняет операторскую/internal функцию. Узкие capabilities имеют fixed `search_path`, PUBLIC EXECUTE отозван. Append-only `access.recovery_audit` читает audit_reader: recovery/recipient/actor ID, ISSUE_PLATFORM/ISSUE_OPERATOR/REDEEM/REVOKE, operator-ref/request/time, без login/password/raw token/контактов. Реальные сроки/очистка/rollout отдельно. Команда проверяется только в собственной временной базе; VPS/production/рабочие тома не меняются.

Резервные коды, self-service email/Telegram, автоматическая доставка и проверка личности остаются будущими решениями. Независимое техническое review — [ADR0013](../../planning/adr/0013-network-and-registry.md).
