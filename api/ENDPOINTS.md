# Реестр первого онлайн-сценария

Статус всех строк: **запланирован**, контракт на ревью в [#16](https://github.com/StarMadeGalaxy/JudeOS/issues/16). Ни одна операция не реализована. Источник схем/примеров — [OpenAPI](openapi/openapi.yaml), правила — [README](README.md), решение — [ADR 0006, предложено](../planning/adr/0006-first-online-contract.md). Ответственный за этот контракт — NikishGum; владельцы модулей ниже обозначают владение кодом/данными, а не постоянное назначение разработчиков.

| Method | Path | operationId | Модуль | Аудитория | Авторизация/scope | Статус |
|---|---|---|---|---|---|---|
| GET | `/api/v1/access/csrf` | `getCsrfToken` | access | REST сотрудника | Public, same-origin; preauth/session CSRF | запланирован |
| POST | `/api/v1/access/login` | `loginStaff` | access | REST сотрудника | Public; preauth CSRF + Origin + credentials | запланирован |
| GET | `/api/v1/access/session` | `getAccessSession` | access | REST сотрудника | Активная серверная сессия | запланирован |
| POST | `/api/v1/access/logout` | `logoutStaff` | access | REST сотрудника | Сессия + CSRF + Origin | запланирован |
| GET | `/api/v1/tenants/{tenant_id}/sessions` | `listAssignedSessions` | training | REST тренера | Активный coach, membership и текущие назначения | запланирован |
| GET | `/api/v1/tenants/{tenant_id}/sessions/{session_id}` | `getSessionJournal` | training | REST тренера | Активный coach, назначение конкретного занятия | запланирован |
| PUT | `/api/v1/tenants/{tenant_id}/sessions/{session_id}/attendance/{athlete_id}` | `setAttendance` | attendance | REST тренера | Coach/назначение/roster/состояние + CSRF + Origin | запланирован |

Входящие iPay/Telegram, health/readiness, метрики, выдача документации, приглашения/восстановление и остальные предметные команды добавляются со своими задачами. Их отсутствие здесь не разрешает создавать недокументированные маршруты. HEAD/OPTIONS/статические файлы — общая политика [README](README.md); будущие исключения chi.Walk перечисляются при реализации #19, сейчас реальных маршрутов нет.
