# Реестр первого онлайн-сценария

Контракт #16 принят пользователем: [DECISIONS U2026-10-07-S0-01](../planning/DECISIONS.md), [PR #78 merged](https://github.com/StarMadeGalaxy/JudeOS/pull/78), [ADR 0006, принят](../planning/adr/0006-first-online-contract.md). Семь бизнес-операций #16 остаются запланированными; #26 предлагает ещё девять операций S1 и расширение трёх операций журнала, ожидающие принятия. [#19](https://github.com/StarMadeGalaxy/JudeOS/issues/19) реализует только четыре служебные операции. Источник схем — [OpenAPI](openapi/openapi.yaml). Ответственный за каркас — NikishGum; модуль не задаёт постоянное назначение человека.

| Method | Path | operationId | Модуль | Аудитория | Авторизация/scope | Статус |
|---|---|---|---|---|---|---|
| GET | `/api/v1/access/csrf` | `getCsrfToken` | access | REST сотрудника | Public, same-origin; preauth/session CSRF | запланирован |
| POST | `/api/v1/access/login` | `loginStaff` | access | REST сотрудника | Public; preauth CSRF + Origin + credentials | запланирован |
| GET | `/api/v1/access/session` | `getAccessSession` | access | REST сотрудника | Активная серверная сессия | запланирован |
| POST | `/api/v1/access/logout` | `logoutStaff` | access | REST сотрудника | Сессия + CSRF + Origin | запланирован |
| GET | `/api/v1/tenants/{tenant_id}/sessions` | `listAssignedSessions` | training | REST тренера | Активный coach, membership и текущие назначения | запланирован |
| GET | `/api/v1/tenants/{tenant_id}/sessions/{session_id}` | `getSessionJournal` | training | REST тренера | Активный coach, назначение конкретного занятия | запланирован |
| PUT | `/api/v1/tenants/{tenant_id}/sessions/{session_id}/attendance/{athlete_id}` | `setAttendance` | attendance | REST тренера | Coach/назначение/roster/состояние + CSRF + Origin | запланирован |

| POST | `/api/v1/tenants/{tenant_id}/people` | `createPerson` | people | REST сотрудника | Administrator клуба своей сети / manager назначенного клуба; CSRF + Origin + версия/ID | запланирован #26, **предложено** |
| POST | `/api/v1/tenants/{tenant_id}/athletes` | `createAthlete` | people | REST сотрудника | Administrator клуба своей сети / manager назначенного клуба; CSRF + Origin + версия/ID | запланирован #26, **предложено** |
| GET | `/api/v1/tenants/{tenant_id}/athletes/{athlete_id}` | `getAthleteProfile` | people | REST сотрудника | Administrator клуба своей сети / manager назначенного клуба; минимальный scope | запланирован #26, **предложено** |
| POST | `/api/v1/tenants/{tenant_id}/athletes/{athlete_id}/guardian-links` | `verifyGuardianLink` | people | REST сотрудника | Administrator клуба своей сети / manager назначенного клуба; CSRF + Origin + версия/ID | запланирован #26, **предложено** |
| PUT | `/api/v1/tenants/{tenant_id}/athletes/{athlete_id}/primary-contact` | `setPrimaryContact` | people | REST сотрудника | Administrator клуба своей сети / manager назначенного клуба; CSRF + Origin + версия/ID | запланирован #26, **предложено** |
| POST | `/api/v1/tenants/{tenant_id}/sessions/{session_id}/close` | `closeSession` | training | REST сотрудника | Administrator клуба своей сети / manager назначенного клуба или текущий назначенный coach; CSRF + Origin + версия/ID | запланирован #26, **предложено** |
| POST | `/api/v1/tenants/{tenant_id}/sessions/{session_id}/roster` | `addKnownRosterAthlete` | training | REST сотрудника | Administrator клуба своей сети / manager назначенного клуба или текущий назначенный coach; CSRF + Origin + версия/ID | запланирован #26, **предложено** |
| POST | `/api/v1/tenants/{tenant_id}/sessions/{session_id}/guests` | `createSessionGuest` | training | REST сотрудника | Administrator клуба своей сети / manager назначенного клуба или текущий назначенный coach; CSRF + Origin + версия/ID | запланирован #26, **предложено** |
| POST | `/api/v1/tenants/{tenant_id}/sessions/{session_id}/roster/{athlete_id}/exclude` | `excludeRosterAthlete` | training | REST сотрудника | Administrator клуба своей сети / manager назначенного клуба; CSRF + Origin + версия/ID | запланирован #26, **предложено** |

| GET | `/healthz` | `getHealth` | platform | служебный | Public, dev/synthetic | реализован #19 |
| GET | `/readyz` | `getReadiness` | platform | служебный | Public, dev/synthetic; проверка runtime роли | реализован #19, усилен #20 |
| GET | `/openapi.json` | `getRuntimeOpenAPI` | platform | служебный | Public, dev/synthetic | реализован #19 |
| GET | `/docs` | `getSwaggerUI` | platform | служебный | Public, dev/synthetic | реализован #19 |

Входящие iPay/Telegram, метрики, приглашения/восстановление и предметные команды появляются в своих задачах. Статические исключения chi.Walk заданы в [static-routes.json](static-routes.json): web `/` и `/assets/*`, два локальных файла Swagger UI. [Общая политика](README.md#http-политика-каркаса-19) описывает HEAD/OPTIONS/404/405, слеши и отсутствие SPA catch-all. Runtime `/openapi.json` и Swagger UI показывают только реализованные операции.

#20 усиливает readiness проверкой безопасной runtime роли и текущей схемы (3), не добавляя предметных endpoint'ов. Серверный request_id связывает HTTP/context/логи и будущий tenant-аудит; права сотрудников/auth остаются #21.

[Матрица S1 и происхождение](S1-CONTRACT.md): область ролей и закрытие отдельно подтверждены владельцем; остальные поля/детали остаются предложением. Расширения listAssignedSessions/getSessionJournal/setAttendance помечены proposed; старый минимальный DTO сохраняется. Закрытие текущему назначенному coach разрешено по явному ответу владельца; administrator/manager закрывают в своей области без назначения тренером. Auth/implemented маршруты сохраняются. До интеграции требуется принятая merged #21 и проверка обеих частей.
