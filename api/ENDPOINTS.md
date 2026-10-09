# Реестр первого онлайн-сценария

Контракт #16 принят пользователем: [DECISIONS U2026-10-07-S0-01](../planning/DECISIONS.md), [PR #78 merged](https://github.com/StarMadeGalaxy/JudeOS/pull/78), [ADR 0006, принят](../planning/adr/0006-first-online-contract.md). Три операции журнала остаются запланированными; #21 реализует staff access. [#19](https://github.com/StarMadeGalaxy/JudeOS/issues/19) реализует только четыре служебные операции. Источник схем — [OpenAPI](openapi/openapi.yaml). Ответственный за каркас — NikishGum; модуль не задаёт постоянное назначение человека.

| Method | Path | operationId | Модуль | Аудитория | Авторизация/scope | Статус |
|---|---|---|---|---|---|---|
| GET | `/api/v1/access/csrf` | `getCsrfToken` | access | REST сотрудника | Public, same-origin; preauth/session CSRF | реализован #21 |
| POST | `/api/v1/access/login` | `loginStaff` | access | REST сотрудника | Public; preauth CSRF + Origin + credentials | реализован #21 |
| GET | `/api/v1/access/session` | `getAccessSession` | access | REST сотрудника | Активная серверная сессия | реализован #21 |
| POST | `/api/v1/access/logout` | `logoutStaff` | access | REST сотрудника | Сессия + CSRF + Origin | реализован #21 |
| GET | `/api/v1/tenants/{tenant_id}/sessions` | `listAssignedSessions` | training | REST тренера | Активный coach, membership и текущие назначения | запланирован |
| GET | `/api/v1/tenants/{tenant_id}/sessions/{session_id}` | `getSessionJournal` | training | REST тренера | Активный coach, назначение конкретного занятия | запланирован |
| PUT | `/api/v1/tenants/{tenant_id}/sessions/{session_id}/attendance/{athlete_id}` | `setAttendance` | attendance | REST тренера | Coach/назначение/roster/состояние + CSRF + Origin | запланирован |

| GET | `/healthz` | `getHealth` | platform | служебный | Public, dev/synthetic | реализован #19 |
| GET | `/readyz` | `getReadiness` | platform | служебный | Public, dev/synthetic; проверка runtime роли | реализован #19, усилен #20 |
| GET | `/openapi.json` | `getRuntimeOpenAPI` | platform | служебный | Public, dev/synthetic | реализован #19 |
| GET | `/docs` | `getSwaggerUI` | platform | служебный | Public, dev/synthetic | реализован #19 |

Входящие iPay/Telegram, метрики, предметные команды появляются в своих задачах. Статические исключения chi.Walk заданы в [static-routes.json](static-routes.json): web `/` и `/assets/*`, два локальных файла Swagger UI. [Общая политика](README.md#http-политика-основы-s0) описывает HEAD/OPTIONS/404/405, слеши и отсутствие SPA catch-all. Runtime `/openapi.json` и Swagger UI показывают только реализованные операции.

#20 усиливает readiness проверкой безопасной runtime роли и схемы основы (исторически 3), не добавляя предметных endpoint'ов. Серверный request_id связывает HTTP/context/логи и будущий tenant-аудит; права сотрудников/auth реализованы #21; текущий runtime требует schema 4.

| POST | `/api/v1/access/redeem` | `redeemAccessLink` | access | REST сотрудника | Public; preauth CSRF/Origin | реализован #21 |
| GET | `/api/v1/tenants/{tenant_id}/staff` | `listStaff` | access | REST сотрудника | Administrator club; session/CSRF/Origin для команд | реализован #21 |
| POST | `/api/v1/tenants/{tenant_id}/staff/invitations` | `inviteStaff` | access | REST сотрудника | Administrator club; session/CSRF/Origin для команд | реализован #21 |
| POST | `/api/v1/tenants/{tenant_id}/staff/{membership_id}/reset` | `issueStaffReset` | access | REST сотрудника | Administrator club; session/CSRF/Origin для команд | реализован #21 |
| PUT | `/api/v1/tenants/{tenant_id}/staff/{membership_id}` | `changeStaffAccess` | access | REST сотрудника | Administrator club; session/CSRF/Origin для команд | реализован #21 |
