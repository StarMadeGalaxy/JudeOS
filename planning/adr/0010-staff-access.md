# ADR 0010: Серверный доступ сотрудников

Дата: 8 октября 2026. Статус: **предложено для ревью** в #21; не новая подтверждённая политика пользователя. Baseline — ARCHITECTURE §6 и MVP-DEVELOPMENT-PLAN S0.4, принятый access-контракт #16/PR #78, tenant-основа #20/PR #85.

## Выбор

Сохранить Go/chi/PostgreSQL. `golang.org/x/crypto/argon2` Argon2id (64 MiB, t=2,p=1) с ограниченным форматом и двумя одновременно работающими hashes на процесс. Серверная DB сессия 8h, preauth 10m, invite 24h, reset 30m. Crypto/rand bearer secret 32 bytes, только SHA-256 hash в БД; Secure/HttpOnly/host-only cookie, synchronizer CSRF, exact configured HTTPS Origin/Fetch Metadata. CSRF/password/link только память вкладки; нет localStorage/IndexedDB. DB rate limits переживают рестарт/несколько API; peer IP без доверия forwarded headers.

Account/session/preauth/лимиты глобальны, без профилей детей. Membership/grants/links — tenant FORCE RLS + составные FK, explicit runtime grants, metadata-only audit. Узкие SECURITY DEFINER discovery функции принадлежат migrator, фиксируют search_path и возвращают только metadata membership или tenant hash-токена. Их отдельные SELECT policies только migrator обходят отсутствие tenant при аутентификации; runtime получает только EXECUTE и обычный tenant RLS для прямых запросов. Это не защита от произвольного SQL с runtime credential; доверенная граница — application service и закрытая БД.

Administrator считается владельцем, дополнительных динамических ролей нет. Club lock + повторная авторизация в транзакции и SQL last-owner trigger сериализуют изменения. Password reset/смена roles/revocation завершают все сессии Account. Existing configured login нельзя приглашением присоединить к другому клубу/перезаписать пароль; такой flow требует доказательства владельца Account. Operator-only migrator CLI выдаёт bootstrap link первого pending владельца, не runs-on-start и не общий seed password. Ручная передача invite/reset вместо интеграции с email/Telegram.

## Альтернативы и последствия

JWT усложняет немедленный отзыв; cookie-only signed cache может сохранить отозванные права. Внешний IdP/TS auth меняет утверждённый стек и добавляет сервис; bcrypt менее удобен для выбранного memory-hard hashing. Redis не нужен для этого synthetic DB-backed среза.

HTTPS обязателен для рабочего входа, пустой PUBLIC_ORIGIN fail-closed. За proxy общий IP bucket консервативен; масштабирование требует отдельного согласованного trusted proxy/edge rate-limit. Argon2 memory/CPU ограничены локально, параметры/TTL/лимиты документированы для ревью и могут меняться отдельным проверяемым изменением. Реальные данные/retention/production restore/security review не принимаются этим PR. Документы запуска и ограничения — [access](../../docs/access/README.md).
