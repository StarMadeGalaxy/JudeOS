# Месячные рекомендации S2-02 — wire-проект #39

Версия 0.1, 10 октября 2026. **Предложено для согласования до реализации**.
Ни одна операция этого документа пока не зарегистрирована в HTTP router.
Самостоятельный машиночитаемый проект — [recommendations/openapi.json](recommendations/openapi.json).
Он не включён в основной OpenAPI, runtime bundle или TS-клиент.

Issue: [#39](https://github.com/StarMadeGalaxy/JudeOS/issues/39).
Принятые зависимости: [#27/PR111](https://github.com/StarMadeGalaxy/JudeOS/pull/111),
[#38/PR112](https://github.com/StarMadeGalaxy/JudeOS/pull/112).
Исходные правила: [финансовый контракт](../docs/finance/CONTRACT.md),
[границы его согласования](../docs/reports/APPROVAL.md),
[ADR0014](../planning/adr/0014-s2-financial-contract.md).
Проект касается только добровольной рекомендации, без Receipt, Allocation,
поступлений, импорта, возвратов, финансового экспорта, UI или Telegram.

## Подтверждённые правила и открытые решения

- Деньги — целые копейки BYN. Месячные суммы по сохранённому порядку:
  11000 / 8800 / 7700 / 0; четвёртый и последующие получают 0.
- Рекомендация не является долгом, поступлением или распределением и не
  проверяется при допуске к тренировке. Семья сама не даёт прав доступа.
- Состав и условия имеют месячные версии; сохранённое прошлое не пересчитывается
  по сегодняшней семье. Изменение прошлого явно и с историей.
- [Владелец подтвердил первый приоритет](https://github.com/StarMadeGalaxy/JudeOS/issues/38#issuecomment-6085728153):
  110/88/77 минус60 BYN → 50/88/77.
- [F39-01–03](https://github.com/StarMadeGalaxy/JudeOS/issues/39#issuecomment-6095906412)
  подтверждены пользователем этого чата10 октября2026 отдельными ответами:
  каскад150/300 BYN и отсутствие переноса превышения; ручная сумма/месяц,
  добавление повторного уменьшения, исправление новой версией с причиной и
  явное подтверждение прошлого; месячный состав без дневной пропорции,
  новые рекомендации только действующим спортсменам клуба, одиночный110 BYN.
  Точные вопросы/ответы и границы сохранены в Issue39.

Следующие DTO, HTTP paths, ограничения, проверка членства, политика архивных
ссылок и транзакции — технические предложения. Подтверждение отдельных
бизнес-правил не означает согласования всего wire или всех будущих условий.

## Область и общие правила

Корень: `/api/v1/tenants/{tenant_id}/households/{household_id}`.
Идентификаторы — UUID; Person, Athlete, Household и Account не взаимозаменяемы.
Одна рекомендация принадлежит семье одного клуба и локальному календарному
месяцу `YYYY-MM` (Europe/Minsk), а не времени платежа.

Право — текущая серверная capability `finance` принятого Access.Within:
administrator/manager выбранного клуба и их действующие эквивалентные grants
из access/network контракта. Coach-only запрещён; GuardianLink/Household не
дают вход или финансовое чтение. Platform/owner не подменяются произвольным
полем клиента. Здесь нет нового права экспорта и нового access DTO.

Все запросы — HTTPS, session cookie, `Cache-Control: no-store`, серверный
`X-Request-ID`. Команды требуют exact Origin и непустой верный `X-CSRF-Token`.
Текущие права проверяются после общей club lock до выдачи сохранённого ответа.
История доступна по текущему праву, без контактов, диагнозов и payer data.

Каждая команда имеет UUID `operation_id`, ожидаемую `base_version`, `reason`
(1–500 символов без управляющих символов, без медицинских/контактных сведений)
и обязательный boolean `acknowledge_past`. У terms base_version — последняя
версия условий семьи; у месячной команды — последняя версия именно этого
месяца; 0 означает отсутствие записи. Версии — JSON-safe integer.
Создание первой записи и исправление существующей используют разные значения
base_version; существующая рекомендация не заменяется неявным повтором.

`acknowledge_past=false` запрещает команду для месяца раньше текущего
Europe/Minsk. `true` разрешает только явно указанный месяц и не переписывает
другие снимки. Смена месяца при выполнении проверяется по серверным часам.
Причина обязательна и для первой версии. Новая версия получает серверное
recorded_at и actor_account_id; прошлые строки неизменяемы.

Неизвестные поля, null вместо обязательного значения, дробные числа, иной
формат месяца, повтор Athlete, пустой/слишком большой список отвергаются.
Технические пределы проекта: месяц2000–2099, 1–100 детей в terms, страница
1–100 записей, сумма0…9007199254740991 копеек. Это ограничения реализации,
не договорные ограничения семьи или подтверждённые новые суммы клуба.

## Операции

Все ниже **planned #39**, не implemented.

| Method / suffix | operationId | Назначение / ответ200 |
|---|---|---|
| GET `/recommendation-terms` | listRecommendationTerms | История условий по возрастающей версии; `after_version`, `limit`; TermsPage |
| POST `/recommendation-terms` | saveRecommendationTerms | Новая неизменяемая версия условий с effective_from; TermsVersion |
| GET `/recommendations/{support_month}` | getMonthlyRecommendation | Последний сохранённый Snapshot; отсутствие —404, не вычисление на лету |
| POST `/recommendations/{support_month}` | saveMonthlyRecommendation | Явный расчёт/замена из действующих условий, без сброса корректировки; Snapshot |
| POST `/recommendations/{support_month}/adjustments` | adjustMonthlyRecommendation | Добавить уменьшение или явно исправить общий размер; новый Snapshot |
| GET `/recommendations/{support_month}/versions` | listRecommendationVersions | История снимков по возрастающей версии; after_version/limit; SnapshotPage |
| GET `/recommendations/{support_month}/versions/{version}` | getRecommendationVersion | Конкретная неизменяемая версия Snapshot |

GET не создаёт условий/снимков, не пишет OperationResult и не рассчитывает
прошлое. Отсутствие —404; пустая история существующей семьи —items[]/next_cursor=null.
Неизвестный query parameter или повтор параметра —400. `after_version` —
последняя полученная версия, не offset; `next_cursor` null в конце выборки.

Успешные команды возвращают200 и `Operation-Replayed: true|false`.
Точный повтор возвращает прежнюю версию, даже если после неё появились новые;
последнее состояние получают отдельным GET.

Ошибки:400 invalid,401 session,403 scope/CSRF/Origin,404 неизвестный/чужой
объект,405/Allow,409 конфликт,413 body limit,415 media type,429 limiter,
500 нейтральная ошибка,503 недоступность по общей HTTP политике.
413/415 применимы только к командам. Нет придуманного422.
409 содержит безопасные code/message/request_id/operation_id/current_version
(null, когда версия неприменима); коды перечислены в standalone OpenAPI.

## Версии порядка и условий

SaveTerms: operation_id/base_version/effective_from/athlete_ids/reason/
acknowledge_past. Порядок массива значим. `effective_from` — первый месяц
действия, без дневной пропорции. Для одного месяца можно явно исправить условия:
новая версия сохраняет прежнюю; версия не UPDATE старой записи.

TermsVersion: terms_id/household_id/version/effective_from/athlete_ids/policy/
reason/actor_account_id/recorded_at. Policy — сохранённые policy_version,
currency=BYN и rates_kopecks[11000,8800,7700,0]. Базовая версия политики хранится
в SQL; изменения ставок не входят в этот API и требуют нового согласования.
Так сумма не дублируется в UI и runtime-константах и может быть объяснена из снимка.

Действующая версия для M: максимальный effective_from ≤ M, затем самая поздняя
version при одинаковом effective_from. Поздняя запись более раннего периода
не отменяет явно заведённый будущий период. Сохранённые рекомендации остаются
с прежними terms_id и policy; один POST terms не переписывает снимки.

Предлагаемые reference checks для новой версии: семья существует в tenant;
спортсмены и их Person действующие; каждый связан с семьёй через сохранённый
период HouseholdMember, действующий на начало выбранного месяца в Europe/Minsk.
Новая версия может ссылаться на заранее заведённый будущий период. Точный
порядок membership в середине месяца требует согласования до реализации;
здесь предложен единый cutoff первого дня. Семейные/people таблицы не меняются.

Семья из одного ребёнка использует те же операции. Автоматическое заведение
семьи одиночному спортсмену не предлагается; рекомендация без Household
потребует отдельно согласованного wire, если она нужна в этой поставке.

## Сохранённый расчёт

SaveMonth: operation_id/base_version/terms_version/reason/acknowledge_past.
terms_version должен быть действующим для выбранного месяца; при несовпадении
—409 TERMS_CHANGED. Новая команда с устаревшей month base_version —409.
Создание версии1 фиксирует выбранные IDs/порядок, период и суммы без дальнейшего
чтения сегодняшнего состава при GET. Для новой рекомендации проверяются
действующие Athlete/Person; чтение старой и корректировка старой суммы
не скрывают историю после архива.

При явной замене состава прежний requested_reduction_kopecks сохраняется,
уменьшение заново раскладывается по новому явно выбранному порядку. Это
техническое предложение требует согласования; сброс уменьшения не автоматический.
Один Athlete не получает две текущие рекомендации за месяц в разных семьях:
предлагается409 ATHLETE_MONTH_CONFLICT. Для перехода между семьями сначала
нужно явно скорректировать конфликтующий текущий снимок; прошлые версии
остаются историей. Как исключить последнего ребёнка/прекратить рекомендацию
семьи и поддержать одиночного спортсмена — открытый wire-вопрос; не имитировать
его пустой семьёй или нулевым платежом.

Snapshot: snapshot_id/household_id/support_month/version/terms_id/terms_version/
policy/entries/base_total_kopecks/requested_reduction_kopecks/
applied_reduction_kopecks/unused_reduction_kopecks/final_total_kopecks/
change_kind/reason/actor_account_id/recorded_at.
Entry: athlete_id/position/base_kopecks/reduction_kopecks/final_kopecks.
Снимок содержит минимум стабильных IDs; имена/контакты не копируются.

Для каждого ребёнка по сохранённому порядку:
applied_i=min(remaining,base_i); final_i=base_i−applied_i;
remaining уменьшается на applied_i. Ни одна строка/итог не отрицательны.
requested=applied_total+unused, base_total=applied_total+final_total.
Четвёртая/последующая base_i=0. Float/округление/конверсия не применяются.
unused показывается, не переносится автоматически и не является остатком денег.

## Точная корректировка

AdjustMonth: operation_id/base_version/kind/amount_kopecks/reason/acknowledge_past.
kind=`add_reduction`: положительная сумма добавляется к прежнему requested;
при переполнении JSON-safe integer —400 без записи.
kind=`set_reduction`: неотрицательная сумма заменяет размер уменьшения,
включая0 для исправления ошибочной корректировки. Возможность исправления
подтверждена F39-02; форма команды остаётся техническим предложением.

Результат — новая неизменяемая месячная версия на прежнем составе/политике;
корректировка не импортирует сегодняшние условия. Change_kind различает
calculate/replace_terms/add_reduction/set_reduction. OperationResult, эффект,
новая версия и metadata audit атомарны. Ни увеличение, ни уменьшение
рекомендации не создают Receipt/Allocation/списание или возврат.

## Повторы, конкуренция и SQL-проект

1. Access.Within повторно проверяет текущую session/finance после общей club lock.
2. Найти ключ tenant/actor/operation_id в собственном recommendation OperationResult.
   Hash включает имя команды, household/month, полный DTO и wire version.
3. Тот же hash возвращает сохранённый эффект без повторного сравнения старой
   base_version и без нового audit. Иной hash —409 IDEMPOTENCY_CONFLICT.
4. Только новая команда проверяет текущую base_version, выбранные terms,
   references, прошлый месяц, уникальность athlete/month и точную арифметику.
5. Атомарно сохранить неизменяемый эффект, ключ/ответ и audit; ответ после commit.
   При rollback ключ не остаётся; unknown повторяется с исходными ID/DTO.

Ошибки не сохраняются как успешный финансовый эффект. Новая команда после
version conflict требует явного решения/нового operation_id; автоматического
retry с новым ID нет. Повтор не обходит отзыв финансового права и не выдаёт
исторические данные coach-only/представителю.

Проект отдельных таблиц: recommendation policy versions, family terms versions,
monthly snapshot versions/entries, operation results. Composite tenant FK к
Household/Athlete, FORCE RLS, narrow INSERT/SELECT grants, immutable versions,
SQL guards/invariants и metadata audit. Никаких изменений people/access DTO
или прежнего SQL. Конкретная SQL-модель ещё не записана.

Номер00012 принадлежит #29 и интегрирован через принятый PR114 в
main7219d0d9703de08fb9779ba1c215cf7a60cd16db. Approve финального head и
CLOSED/completed29 проверены. Для #39 предложены00013 и ADR0016,
**согласование номеров/границы ещё не получено**. SQL не записан.
Применение новой миграции будет только после00012; main/SQL12 не переписываются.

## Незавершённая приёмка и проверки будущей реализации

До общего wire/runtime ожидаются: явное согласование
владельцев29/34/46; уточнение одиночного спортсмена/завершения семьи/сохранения
корректировки при смене состава; конкретная membership-семантика. Точные
границы/вопросы — [документ реализации](../docs/finance/RECOMMENDATIONS.md).

На настоящем HTTP/PostgreSQL должны проверяться семьи1–5, перестановка,
новый/ушедший ребёнок с месяца, выбор версии условий, отсутствие авторасчёта
GET, прошлое с/без acknowledge, история после архива, 60/150/300 BYN,
копейка/нулевой предел/overflow, исправление и add/set, current capability,
два tenant/FK/RLS, отзыв перед replay, same-ID/same-hash и hash conflict,
две команды одной версии, rollback effect/result/audit, schema upgrade/repeat,
реальные request/response по OpenAPI, chi coverage, TS-клиент и Swagger.
Эти runtime-проверки пока не выполнены. В этом проекте только синтетические DTO.
