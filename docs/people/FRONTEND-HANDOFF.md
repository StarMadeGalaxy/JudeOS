# Граница #27 / #28 и контракт для синтетического UI

Источник запроса — [комментарий исполнителя #28](https://github.com/StarMadeGalaxy/JudeOS/issues/27#issuecomment-6083256762). Со стороны исполнителя #27 согласован изолированный mobile-first модуль `apps/web/src/people-manager/` с адаптером синтетических данных. Это согласование разделения работы и использование опубликованного wire для fixtures; оно не объявляет [PR #111](https://github.com/StarMadeGalaxy/JudeOS/pull/111) принятым/merged runtime и не заменяет техническое review ADR0013. #28 остаётся у @NikishGum, существующий claim/In progress не меняется.

## Файлы и подключение

| Область | #27 / PR111 | Допустимая работа #28 |
|---|---|---|
| Реестр и доступ на сервере | `internal/people/`, `internal/access/`, HTTP handlers и новые миграции | Использовать wire для fixtures; не менять сервер, auth и миграции |
| Общие схемы | `api/openapi/openapi.yaml`, `api/ENDPOINTS.md`, `api/S1-CONTRACT.md`, примеры/проверки | Использовать опубликованный snapshot; необходимые изменения сначала согласовать в Issue27 |
| Нынешний рабочий UI | `apps/web/src/main.tsx`, `api.ts`, `RegistryPanel.tsx`, `NetworkPanel.tsx`, `style.css` | Сохранить access, сеть/платформу и рабочий реестр; не менять эти файлы параллельно без согласованного patch |
| Новый UI менеджера | Не занят #27 | `apps/web/src/people-manager/`: компоненты, локальные стили, адаптер и синтетические fixtures/проверки |
| Документы | Этот handoff и `docs/people/README.md` | Документы нового модуля; APP-FLOWS/STATUS править с сохранением переданных разделов, без общего переформатирования |

Разработку изолированного модуля и fixture-adapter можно продолжать после прочтения этого среза. Минимальное подключение в `main.tsx`/навигацию согласовывается отдельным небольшим diff на актуальной базе после интеграции PR111; это ожидание не запрещает работу внутри нового модуля. Замена `RegistryPanel.tsx`, изменений общего API-клиента, стилей/токенов, конфигурации сборки или зависимостей пакета этим handoff не разрешена.

Synthetic — отдельный явно обозначенный режим. Ошибка/401/403/503 live API не переключает интерфейс на fixtures. Fixture-adapter работает в памяти; его проверки не доказывают PostgreSQL/RLS/CSRF/отзыв/права сервера. Интеграционная приёмка #27 + #28 остаётся [#36](https://github.com/StarMadeGalaxy/JudeOS/issues/36).

При использовании новых общих схем/подключения к приложению PR по #28 зависит от PR111: до его merge указывается `Merge after: #111`; после фактического merge декларация пересматривается. Начать изолированную работу на согласованных fixtures можно раньше. Открытый PR111 не является принятой runtime-зависимостью.

## Опубликованный wire

Фиксированный snapshot схем и примеров — head **`880e1f2bcffaa4101d00fa1ccc65734b3f55bd76`** PR111. Данный handoff добавляет описание координации, wire snapshot не меняет. Источники:

- [OpenAPI на фиксированном head](https://github.com/StarMadeGalaxy/JudeOS/blob/880e1f2bcffaa4101d00fa1ccc65734b3f55bd76/api/openapi/openapi.yaml): точные параметры, required/nullable, enum, request/response, security, ошибки и примеры каждой операции.
- [Синтетические fixtures](https://github.com/StarMadeGalaxy/JudeOS/blob/880e1f2bcffaa4101d00fa1ccc65734b3f55bd76/api/examples/registry-network.json); примеры каждого ответа/команды также в OpenAPI.
- [Реестр маршрутов](../../api/ENDPOINTS.md), [правила/ограничения](README.md), [принятый минимум #26](../../api/S1-CONTRACT.md). TS генерируется из OpenAPI командой `npm --prefix api run generate`; произвольных параллельных DTO не вводим.

В принятой main128456e действительно не было поиска/keyset/архива/семей. Эти схемы теперь опубликованы в PR111 как технический срез #27. Со стороны #27 подтверждается их использование для согласования и fixture UI; финальная приёмка backend/ADR и merge ещё ожидаются. Если fixture-adapter находит расхождение или недостающую семантику, вопрос фиксируется в Issue27 до изменения общего wire.

### Поиск и страницы

`GET /api/v1/tenants/{tenant_id}/people`, `/athletes`, `/households`:

| Параметр | Значение |
|---|---|
| `q` | Необязательная буквальная подстрока отображаемого имени/названия, без учёта регистра, до 200 символов; пустое значение не фильтрует |
| `limit` | Целое 1–100, по умолчанию 30 |
| `cursor` | Необязательный UUID последней полученной строки; keyset по UUID по возрастанию, следующий запрос возвращает ключи больше cursor |
| `state` | Люди/спортсмены: `active` (по умолчанию), `archived`, `all`; семьи: только `active` или `all`, архивирования семьи в этом срезе нет |

Ответ200 всегда `{items: [...], next_cursor: UUID | null}`. Пустой список — `items: []`, последняя страница — `next_cursor: null`. Не обещаются total/offset/номер страницы или снимок списка между запросами. При смене поиска/состояния cursor сбрасывается. UI сохраняет следующие страницы, не заменяет их первой страницей после загрузки.

Списки используют `PersonSummary`, `AthleteSummary`, `HouseholdSummary`: ID/имя/версия, необходимые признаки архива/участия; телефоны, представители, основания проверки и полные карточки в списках отсутствуют. Полная карточка загружается отдельным GET. Имя/телефон не уникальны, совпадение не объединяет записи.

### Карточки, команды, архив и семьи

Все пути ниже относятся к `/api/v1/tenants/{tenant_id}/`. Точные схемы тел/ответов находятся в OpenAPI snapshot; таблица — указатель, не второй источник схем.

| Method / путь | operationId | Тело | Успех |
|---|---|---|---|
| `POST people` | `createPerson` | CreatePersonRequest | 201 PersonProfile |
| `GET people` | `listPersons` | — | 200 PersonPage |
| `POST athletes` | `createAthlete` | CreateAthleteRequest | 201 AthleteProfile |
| `GET athletes` | `listAthletes` | — | 200 AthletePage |
| `GET athletes/{athlete_id}` | `getAthleteProfile` | — | 200 AthleteProfile |
| `PUT athletes/{athlete_id}` | `updateAthlete` | UpdateAthleteRequest | 200 AthleteProfile |
| `POST athletes/{athlete_id}/guardian-links` | `verifyGuardianLink` | VerifyGuardianLinkRequest | 201 GuardianLink |
| `PUT athletes/{athlete_id}/primary-contact` | `setPrimaryContact` | SetPrimaryContactRequest | 200 AthleteProfile |
| `GET households` | `listHouseholds` | — | 200 HouseholdPage |
| `POST households` | `createHousehold` | CreateHouseholdRequest | 201 HouseholdProfile |
| `GET people/{person_id}` | `getPersonProfile` | — | 200 PersonProfile |
| `PUT people/{person_id}` | `updatePerson` | UpdatePersonRequest | 200 PersonProfile |
| `POST people/{person_id}/archive` | `archivePerson` | VersionedRegistryCommand | 200 PersonProfile |
| `POST athletes/{athlete_id}/archive` | `archiveAthlete` | VersionedRegistryCommand | 200 AthleteProfile |
| `POST athletes/{athlete_id}/guardian-links/{guardian_link_id}/revoke` | `revokeGuardianLink` | VersionedRegistryCommand | 200 AthleteProfile |
| `GET households/{household_id}` | `getHouseholdProfile` | — | 200 HouseholdProfile |
| `PUT households/{household_id}` | `updateHousehold` | UpdateHouseholdRequest | 200 HouseholdProfile |
| `POST households/{household_id}/members` | `addHouseholdMember` | AddHouseholdMemberRequest | 201 HouseholdProfile |
| `POST households/{household_id}/members/{household_member_id}/end` | `endHouseholdMember` | EndHouseholdMemberRequest | 200 HouseholdProfile |

`PersonProfile`: `person_id`, `tenant_id`, `display_name`, nullable `phone`, `archived`, `version`. `AthleteProfile`: стабильный `athlete_id`, вложенный Person, `participation=regular|guest`, `archived`, `version`, история `guardian_links`, nullable `primary_guardian_link_id` и `primary_contact`; `admission` в этом runtime null. Person/Athlete не требуют Account/семьи/представителя/телефона. В guest нет автоматического зачисления в группу или занятия.

Архив Person возвращает PersonProfile200, очищает телефон, архивирует его Athlete, отзывает связи представителя/его спортсмена и снимает выбранные контакты. Архив Athlete возвращает AthleteProfile200, отзывает его связи/контакт, но сохраняет Person. ID, имя и разрешённая история остаются. DELETE, unarchive и глобальный отзыв независимой рабочей учётной записи по совпавшему имени отсутствуют; parent/athlete кабинеты не реализованы.

`HouseholdProfile`: `household_id`, `name`, `version`, `members[]`; каждый HouseholdMember имеет `household_member_id`, `person_id`, текущее `display_name`, `valid_from`, nullable `valid_until`. Членство — период `[from, until)`, не представительство/доступ. Create/rename/add/end возвращают актуальный профиль семьи; add повышает версию семьи, end задаёт окончание открытого периода и тоже повышает её версию. Для end `valid_until` строго позже `valid_from`; уже заданный `valid_until` (включая будущую дату) даёт409 `MEMBERSHIP_ENDED`, редактирование такого периода отсутствует. Даты wire — UTC с `Z`; имя, телефон или семья не создают GuardianLink.

Проверка представителя — отдельная команда с Person выбранного клуба, `basis_kind` без документов/диагнозов и периодом. `verified_by_account_id` задаёт сервер. Verify возвращает GuardianLink201 и увеличивает Athlete.version; UI перечитывает AthleteProfile перед следующей командой. Revoke возвращает AthleteProfile200. Основной контакт один, выбирается только из действующей проверенной связи этого спортсмена; `guardian_link_id: null` снимает выбор. Отзыв/истечение/архив не подставляет другого представителя автоматически.

### Версии, ошибки и повтор

Все команды требуют `operation_id` UUID. Изменение существующего профиля/архив/семья/связь/контакт также требует `base_version`. Для guardian/primary/revoke это **версия Athlete**, для members/add/end — **версия Household**, не самостоятельная версия ссылки/члена семьи. Необязательный phone и null эквивалентны в canonical payload; остальные required/nullable определяет OpenAPI.

Успех возвращает `Operation-Replayed: true|false`. После неизвестного сетевого ответа повторяется тот же ID/путь/payload/base_version; автоматическая новая команда недопустима. Разрешение сохранённого конфликта версии требует перечитать карточку и выдать новый operation_id. Старый результат проверяет текущие права/версии/связи/периоды; при утрате актуальности возвращается409 `RESULT_NOT_CURRENT`, старые контакты не выдаются.

409 — `S1CommandConflict` с обязательными `code`, `message`, `request_id`, `operation_id`, `current_version` (nullable). В текущем runtime реестра используются `ENTITY_VERSION_CONFLICT`, `OPERATION_ID_REUSED`, `RESULT_NOT_CURRENT`, `PERSON_ARCHIVED`, `ATHLETE_ALREADY_EXISTS`, `GUARDIAN_LINK_INACTIVE`, `MEMBERSHIP_ENDED`; для архивированного Athlete также возвращается `PERSON_ARCHIVED`. Fixture не должен придумывать новые коды или менять nullable. Полный enum содержит также коды planned-журнала; допустимые HTTP-ответы каждой команды — в OpenAPI.

400 — неверные поля/формат/параметры, 401 — недействующая сессия, 403 — нет права, 404 — нейтральный чужой/неизвестный объект, 413/415 — ограничения JSON, 429/503 — ограничение/недоступность с Retry-After; общий Error сохраняется. Чужой объект проверяется раньше версии/operation_id. JSON UTF-8 до16KiB, лишние/повторяющиеся поля запрещены; ответы no-store и X-Request-ID.

Реестр доступен administrator/manager выбранного клуба и по явным owner/platform правам; coach-only административный реестр не читает. Live команды требуют серверной сессии, CSRF и точного HTTPS Origin. Семья/телефон/поступление прав не дают. Ни fixture-роль, ни administrator другого клуба не подтверждают live полномочия. Только синтетические данные до отдельных решений #18/#24.
