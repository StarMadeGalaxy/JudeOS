# Issues и порядок реализации JudeOS

Актуализировано 7 октября 2026 года. Основа: [план MVP 1.1](MVP-DEVELOPMENT-PLAN.md), [архитектура 0.4](ARCHITECTURE.md), [ADR 0001](adr/0001-mvp-foundation-and-slices.md). Разбивка не меняет продуктовые границы и не доказывает готовность приложения.

[Project #1](https://github.com/users/StarMadeGalaxy/projects/1) выбран пользователем. [Issue #8](https://github.com/StarMadeGalaxy/JudeOS/issues/8) ведёт настройку планирования и оставшийся блокер. Созданы 55 задач (48 MVP, 7 отложенных) и 7 обзорных Issues; текущую занятость читать в GitHub, а не выводить из этого документа. В описаниях задач указаны 120 прямых зависимостей. Их транзитивные зависимости следуют из графа, а не дублируются вручную.

**Фактическое состояние GitHub:** Issues опубликованы. Milestones, native blocked-by/sub-issues, добавление в Project и его статусы/автоматизации ещё не применены и не проверены: CLI REST/GraphQL получает `Forbidden`, коннектор не предоставляет эти операции. Ни таблицы ниже, ни названия milestones в Issues не означают, что GitHub milestones уже созданы. [Manifest](ISSUE-BACKLOG.json) содержит точные номера Issues и предлагаемую конфигурацию; [скрипт синхронизации](../scripts/sync-github-planning.py) готов к выполнению в доступной среде.

## Как брать задачи вдвоём

Оба разработчика равноценны как разработчики и project managers. Предварительных assignees и постоянного разделения frontend/backend нет. До предметной работы по каждому запросу проверить живую Issue/обсуждение/PR/Status, определить текущий GitHub-login, назначить только себя, перевести карточку в In progress и подтвердить оба значения повторным чтением. Если это не удалось, основная работа заблокирована. Подробный обязательный протокол — [CONTRIBUTING.md](../CONTRIBUTING.md#резервирование-задачи-до-начала-работы). Второй разработчик проверяет PR. Рекомендация для старта — одна основная активная задача на человека; другую договорённость можно явно согласовать в Issue.

Сначала можно независимо взять #16 (контракт), #17 (форматы) и #18 (условия реальных данных). Например, один готовит #16, второй собирает материалы #17/#18 по очереди; они рецензируют результаты друг друга. После #16 задачи #19 (каркас) и #23 (мобильный прототип) доступны параллельно. После согласования #26 API и UI реестра/журнала идут параллельно по одному контракту; UI на fixtures не закрывает интеграционную приёмку.

S2 начинается после минимальной модели людей #27, не после всего пилота S1. Telegram переносов #49 не зависит от финансовой доставки #50. Офлайн S4 зависит от приёмки онлайн-журнала #36 и может идти параллельно S2/S3. S5 требует всех обязательных S1–S4 и реальных форматов. Расширения после MVP требуют отдельного подтверждённого триггера и не становятся Ready автоматически.

Готовность контракта означает согласованный и интегрированный PR, а не черновик коллеги. Одна задача — одна ветка/PR; реализация начинается по выбранной Issue, ревью проводит второй разработчик. Миграции и общие файлы координируются в Issue/PR; не редактировать один файл из двух задач в одном checkout. Общие правила — [CONTRIBUTING.md](../CONTRIBUTING.md).

## Статусы и условия перехода

| Статус | Условие |
|---|---|
| Backlog | Есть открытые зависимости, не согласован нужный контракт/внешний формат либо не подтверждён триггер развития |
| Ready | Все прямые зависимости завершены и интегрированы, критерии понятны; задача свободна. Задача сбора неизвестных материалов может быть Ready для начала исследования, но закрывается только после получения результата |
| In progress | Назначен один текущий GitHub-пользователь, Status подтверждён до предметной работы; при внешнем блокере сохраняет ответственность и описывает блокер, не выдаёт задачу за Ready |
| Review | Готовый PR и существенные проверки, ожидается ревью второго разработчика; draft PR остаётся In progress |
| Done | Критерии выполнены и результат принят/интегрирован; для пилота/внешней интеграции есть реальные доказательства, mock их не заменяет |

Обзорные Issues — навигация по этапам: Backlog до старта дочерней работы, In progress при работе/частичном завершении, Done только после всех обязательных задач и приёмки. Они не блокируют всё следующее направление: блокировки задаются конкретными задачами. Закрытие зависимости как not planned/duplicate не удовлетворяет зависимость автоматически — сначала изменить граф по согласованному решению.

## Milestones и задачи

Milestones соответствуют срезам плана, без календарных сроков (D24). У задачи один milestone; сквозные защита/восстановление выделены до своих контрольных точек. S0 включает подготовку эксплуатации/реальных данных, но её завершение не является общей блокировкой синтетического S1.

### S0 — Основа и тестовый запуск

Воспроизводимый синтетический запуск, контракт первого сценария, доступ и изоляция. Подготовка реальных данных и эксплуатации сопровождает первый пилот; неизвестный iPay не блокирует журнал. Обзор: [#9](https://github.com/StarMadeGalaxy/JudeOS/issues/9).

| Issue | Результат | Прямые зависимости |
|---|---|---|
| [#16](https://github.com/StarMadeGalaxy/JudeOS/issues/16) · S0-01 | Зафиксировать границы модулей и контракт первого онлайн-сценария | Нет |
| [#17](https://github.com/StarMadeGalaxy/JudeOS/issues/17) · S0-02 | Получить обезличенные образцы таблиц и договорную спецификацию iPay | Нет |
| [#18](https://github.com/StarMadeGalaxy/JudeOS/issues/18) · S0-03 | Согласовать условия реальных данных и ответственность эксплуатации | Нет |
| [#19](https://github.com/StarMadeGalaxy/JudeOS/issues/19) · S0-04 | Создать Go/PostgreSQL/web каркас, миграции и синтетический seed | [#16](https://github.com/StarMadeGalaxy/JudeOS/issues/16) |
| [#20](https://github.com/StarMadeGalaxy/JudeOS/issues/20) · S0-05 | Реализовать tenant/RLS, составные FK и минимальный аудит | [#19](https://github.com/StarMadeGalaxy/JudeOS/issues/19) |
| [#21](https://github.com/StarMadeGalaxy/JudeOS/issues/21) · S0-06 | Реализовать вход сотрудников, роли, приглашения и отзыв доступа | [#20](https://github.com/StarMadeGalaxy/JudeOS/issues/20) |
| [#22](https://github.com/StarMadeGalaxy/JudeOS/issues/22) · S0-07 | Подключить CI и синтетическое тестовое размещение | [#19](https://github.com/StarMadeGalaxy/JudeOS/issues/19) |
| [#23](https://github.com/StarMadeGalaxy/JudeOS/issues/23) · S0-08 | Подготовить мобильный прототип входа и журнала по контракту | [#16](https://github.com/StarMadeGalaxy/JudeOS/issues/16) |
| [#24](https://github.com/StarMadeGalaxy/JudeOS/issues/24) · S0-09 | Подготовить production-контур, копии и пробное восстановление | [#18](https://github.com/StarMadeGalaxy/JudeOS/issues/18), [#20](https://github.com/StarMadeGalaxy/JudeOS/issues/20), [#21](https://github.com/StarMadeGalaxy/JudeOS/issues/21), [#22](https://github.com/StarMadeGalaxy/JudeOS/issues/22) |
| [#25](https://github.com/StarMadeGalaxy/JudeOS/issues/25) · S0-10 | Принять синтетическую основу и первый контракт S0 | [#20](https://github.com/StarMadeGalaxy/JudeOS/issues/20), [#21](https://github.com/StarMadeGalaxy/JudeOS/issues/21), [#22](https://github.com/StarMadeGalaxy/JudeOS/issues/22), [#23](https://github.com/StarMadeGalaxy/JudeOS/issues/23) |

### S1 — Онлайн-журнал и узкий пилот

Люди, семьи, группы, занятия, составы, гости, допуск, четыре отметки и первый онлайн-пилот. Не является полным MVP. Обзор: [#10](https://github.com/StarMadeGalaxy/JudeOS/issues/10).

| Issue | Результат | Прямые зависимости |
|---|---|---|
| [#26](https://github.com/StarMadeGalaxy/JudeOS/issues/26) · S1-01 | Согласовать поля людей и права онлайн-журнала | [#16](https://github.com/StarMadeGalaxy/JudeOS/issues/16) |
| [#27](https://github.com/StarMadeGalaxy/JudeOS/issues/27) · S1-02 | Реализовать реестр людей, семей и проверенных представителей | [#26](https://github.com/StarMadeGalaxy/JudeOS/issues/26), [#20](https://github.com/StarMadeGalaxy/JudeOS/issues/20), [#21](https://github.com/StarMadeGalaxy/JudeOS/issues/21) |
| [#28](https://github.com/StarMadeGalaxy/JudeOS/issues/28) · S1-03 | Создать интерфейс менеджера для людей и семей | [#26](https://github.com/StarMadeGalaxy/JudeOS/issues/26), [#19](https://github.com/StarMadeGalaxy/JudeOS/issues/19), [#23](https://github.com/StarMadeGalaxy/JudeOS/issues/23) |
| [#29](https://github.com/StarMadeGalaxy/JudeOS/issues/29) · S1-04 | Реализовать группы, ручные занятия и сохранённые составы | [#27](https://github.com/StarMadeGalaxy/JudeOS/issues/27) |
| [#30](https://github.com/StarMadeGalaxy/JudeOS/issues/30) · S1-05 | Добавить шаблон расписания, переносы и отмены с историей | [#29](https://github.com/StarMadeGalaxy/JudeOS/issues/29) |
| [#31](https://github.com/StarMadeGalaxy/JudeOS/issues/31) · S1-06 | Реализовать четыре отметки, закрытие и идемпотентные исправления | [#29](https://github.com/StarMadeGalaxy/JudeOS/issues/29), [#26](https://github.com/StarMadeGalaxy/JudeOS/issues/26) |
| [#32](https://github.com/StarMadeGalaxy/JudeOS/issues/32) · S1-07 | Добавить известный визит, онлайн-гостя и ручной разбор дублей | [#27](https://github.com/StarMadeGalaxy/JudeOS/issues/27), [#29](https://github.com/StarMadeGalaxy/JudeOS/issues/29), [#31](https://github.com/StarMadeGalaxy/JudeOS/issues/31) |
| [#33](https://github.com/StarMadeGalaxy/JudeOS/issues/33) · S1-08 | Реализовать допуск, разрешённый контакт и историю посещений | [#26](https://github.com/StarMadeGalaxy/JudeOS/issues/26), [#27](https://github.com/StarMadeGalaxy/JudeOS/issues/27), [#29](https://github.com/StarMadeGalaxy/JudeOS/issues/29), [#31](https://github.com/StarMadeGalaxy/JudeOS/issues/31) |
| [#34](https://github.com/StarMadeGalaxy/JudeOS/issues/34) · S1-09 | Создать мобильный онлайн-журнал и управление занятиями | [#26](https://github.com/StarMadeGalaxy/JudeOS/issues/26), [#19](https://github.com/StarMadeGalaxy/JudeOS/issues/19), [#23](https://github.com/StarMadeGalaxy/JudeOS/issues/23) |
| [#35](https://github.com/StarMadeGalaxy/JudeOS/issues/35) · S1-10 | Импортировать и сверить минимальный состав до реального пилота | [#17](https://github.com/StarMadeGalaxy/JudeOS/issues/17), [#27](https://github.com/StarMadeGalaxy/JudeOS/issues/27), [#29](https://github.com/StarMadeGalaxy/JudeOS/issues/29) |
| [#36](https://github.com/StarMadeGalaxy/JudeOS/issues/36) · S1-11 | Принять онлайн-сценарии и негативные проверки прав | [#25](https://github.com/StarMadeGalaxy/JudeOS/issues/25), [#27](https://github.com/StarMadeGalaxy/JudeOS/issues/27), [#28](https://github.com/StarMadeGalaxy/JudeOS/issues/28), [#30](https://github.com/StarMadeGalaxy/JudeOS/issues/30), [#31](https://github.com/StarMadeGalaxy/JudeOS/issues/31), [#32](https://github.com/StarMadeGalaxy/JudeOS/issues/32), [#33](https://github.com/StarMadeGalaxy/JudeOS/issues/33), [#34](https://github.com/StarMadeGalaxy/JudeOS/issues/34) |
| [#37](https://github.com/StarMadeGalaxy/JudeOS/issues/37) · S1-12 | Провести узкий реальный пилот онлайн-журнала | [#36](https://github.com/StarMadeGalaxy/JudeOS/issues/36), [#35](https://github.com/StarMadeGalaxy/JudeOS/issues/35), [#24](https://github.com/StarMadeGalaxy/JudeOS/issues/24) |

### S2 — Поддержка, поступления и импорты

Версии семейных рекомендаций, реальный iPay, распределение/возвраты, конкретные импорты и отчёты. После минимальной модели людей, параллельно журналу. Обзор: [#11](https://github.com/StarMadeGalaxy/JudeOS/issues/11).

| Issue | Результат | Прямые зависимости |
|---|---|---|
| [#38](https://github.com/StarMadeGalaxy/JudeOS/issues/38) · S2-01 | Согласовать финансовый контракт и конкретные отчёты | [#26](https://github.com/StarMadeGalaxy/JudeOS/issues/26) |
| [#39](https://github.com/StarMadeGalaxy/JudeOS/issues/39) · S2-02 | Рассчитывать месячные семейные рекомендации и корректировки | [#27](https://github.com/StarMadeGalaxy/JudeOS/issues/27), [#38](https://github.com/StarMadeGalaxy/JudeOS/issues/38) |
| [#40](https://github.com/StarMadeGalaxy/JudeOS/issues/40) · S2-03 | Создать импорт поступлений с происхождением и синтетическим адаптером | [#27](https://github.com/StarMadeGalaxy/JudeOS/issues/27), [#38](https://github.com/StarMadeGalaxy/JudeOS/issues/38) |
| [#41](https://github.com/StarMadeGalaxy/JudeOS/issues/41) · S2-04 | Реализовать адаптер подтверждённого формата iPay | [#17](https://github.com/StarMadeGalaxy/JudeOS/issues/17), [#40](https://github.com/StarMadeGalaxy/JudeOS/issues/40) |
| [#42](https://github.com/StarMadeGalaxy/JudeOS/issues/42) · S2-05 | Реализовать распределения, нераспределённый остаток и возвраты | [#39](https://github.com/StarMadeGalaxy/JudeOS/issues/39), [#40](https://github.com/StarMadeGalaxy/JudeOS/issues/40) |
| [#43](https://github.com/StarMadeGalaxy/JudeOS/issues/43) · S2-06 | Импортировать согласованную историю и сверить связи/суммы | [#17](https://github.com/StarMadeGalaxy/JudeOS/issues/17), [#35](https://github.com/StarMadeGalaxy/JudeOS/issues/35), [#40](https://github.com/StarMadeGalaxy/JudeOS/issues/40), [#42](https://github.com/StarMadeGalaxy/JudeOS/issues/42) |
| [#44](https://github.com/StarMadeGalaxy/JudeOS/issues/44) · S2-07 | Создать финансовые экраны, отчёты и разрешённый экспорт | [#38](https://github.com/StarMadeGalaxy/JudeOS/issues/38), [#19](https://github.com/StarMadeGalaxy/JudeOS/issues/19), [#23](https://github.com/StarMadeGalaxy/JudeOS/issues/23) |
| [#45](https://github.com/StarMadeGalaxy/JudeOS/issues/45) · S2-08 | Принять финансовые сценарии на реальных форматах | [#39](https://github.com/StarMadeGalaxy/JudeOS/issues/39), [#41](https://github.com/StarMadeGalaxy/JudeOS/issues/41), [#42](https://github.com/StarMadeGalaxy/JudeOS/issues/42), [#43](https://github.com/StarMadeGalaxy/JudeOS/issues/43), [#44](https://github.com/StarMadeGalaxy/JudeOS/issues/44) |

### S3 — Telegram и надёжная доставка

Проверенная привязка и два события. Переносы после S1, финансовые сообщения после S2; атомарный outbox, worker и разбор неизвестных исходов. Обзор: [#12](https://github.com/StarMadeGalaxy/JudeOS/issues/12).

| Issue | Результат | Прямые зависимости |
|---|---|---|
| [#46](https://github.com/StarMadeGalaxy/JudeOS/issues/46) · S3-01 | Согласовать политику Telegram, получателей и активации событий | [#26](https://github.com/StarMadeGalaxy/JudeOS/issues/26) |
| [#47](https://github.com/StarMadeGalaxy/JudeOS/issues/47) · S3-02 | Реализовать проверенную привязку Telegram и отзыв | [#27](https://github.com/StarMadeGalaxy/JudeOS/issues/27), [#46](https://github.com/StarMadeGalaxy/JudeOS/issues/46) |
| [#48](https://github.com/StarMadeGalaxy/JudeOS/issues/48) · S3-03 | Создать outbox, PostgreSQL worker и Telegram adapter/webhook | [#20](https://github.com/StarMadeGalaxy/JudeOS/issues/20), [#21](https://github.com/StarMadeGalaxy/JudeOS/issues/21), [#22](https://github.com/StarMadeGalaxy/JudeOS/issues/22), [#46](https://github.com/StarMadeGalaxy/JudeOS/issues/46) |
| [#49](https://github.com/StarMadeGalaxy/JudeOS/issues/49) · S3-04 | Активировать доставку переносов и отмен без исторической рассылки | [#30](https://github.com/StarMadeGalaxy/JudeOS/issues/30), [#36](https://github.com/StarMadeGalaxy/JudeOS/issues/36), [#47](https://github.com/StarMadeGalaxy/JudeOS/issues/47), [#48](https://github.com/StarMadeGalaxy/JudeOS/issues/48) |
| [#50](https://github.com/StarMadeGalaxy/JudeOS/issues/50) · S3-05 | Активировать сообщения о распределённых поступлениях | [#45](https://github.com/StarMadeGalaxy/JudeOS/issues/45), [#38](https://github.com/StarMadeGalaxy/JudeOS/issues/38), [#47](https://github.com/StarMadeGalaxy/JudeOS/issues/47), [#48](https://github.com/StarMadeGalaxy/JudeOS/issues/48), [#46](https://github.com/StarMadeGalaxy/JudeOS/issues/46) |
| [#51](https://github.com/StarMadeGalaxy/JudeOS/issues/51) · S3-06 | Принять доставку и монитор blocked/unknown/возраста jobs | [#49](https://github.com/StarMadeGalaxy/JudeOS/issues/49), [#50](https://github.com/StarMadeGalaxy/JudeOS/issues/50), [#24](https://github.com/StarMadeGalaxy/JudeOS/issues/24) |

### S4 — PWA и офлайн текущего дня

После онлайн-журнала: текущий день Europe/Minsk, предварительный снимок, атомарная очередь, конфликты, совместимость и реальные телефоны. Обзор: [#13](https://github.com/StarMadeGalaxy/JudeOS/issues/13).

| Issue | Результат | Прямые зависимости |
|---|---|---|
| [#52](https://github.com/StarMadeGalaxy/JudeOS/issues/52) · S4-01 | Согласовать офлайн-набор, сроки команд и совместимость | [#36](https://github.com/StarMadeGalaxy/JudeOS/issues/36) |
| [#53](https://github.com/StarMadeGalaxy/JudeOS/issues/53) · S4-02 | Реализовать серверный snapshot, replay и add-known-and-mark | [#52](https://github.com/StarMadeGalaxy/JudeOS/issues/52), [#31](https://github.com/StarMadeGalaxy/JudeOS/issues/31), [#32](https://github.com/StarMadeGalaxy/JudeOS/issues/32) |
| [#54](https://github.com/StarMadeGalaxy/JudeOS/issues/54) · S4-03 | Создать PWA-оболочку, дневной снимок и атомарную IndexedDB-очередь | [#52](https://github.com/StarMadeGalaxy/JudeOS/issues/52), [#34](https://github.com/StarMadeGalaxy/JudeOS/issues/34) |
| [#55](https://github.com/StarMadeGalaxy/JudeOS/issues/55) · S4-04 | Синхронизировать очередь, конфликты и смену клиента/аккаунта | [#53](https://github.com/StarMadeGalaxy/JudeOS/issues/53), [#54](https://github.com/StarMadeGalaxy/JudeOS/issues/54) |
| [#56](https://github.com/StarMadeGalaxy/JudeOS/issues/56) · S4-05 | Принять офлайн на рабочих iOS/Android и двух вкладках | [#55](https://github.com/StarMadeGalaxy/JudeOS/issues/55) |

### S5 — Полный MVP и четыре зала

Общая приёмка S1–S4, восстановление/откат, полный пилот первого зала и отдельная сверка остальных трёх. Принятие полного MVP только после четырёх залов. Обзор: [#14](https://github.com/StarMadeGalaxy/JudeOS/issues/14).

| Issue | Результат | Прямые зависимости |
|---|---|---|
| [#57](https://github.com/StarMadeGalaxy/JudeOS/issues/57) · S5-01 | Выполнить общую мобильную, конкурентную и нагрузочную приёмку | [#36](https://github.com/StarMadeGalaxy/JudeOS/issues/36), [#35](https://github.com/StarMadeGalaxy/JudeOS/issues/35), [#45](https://github.com/StarMadeGalaxy/JudeOS/issues/45), [#51](https://github.com/StarMadeGalaxy/JudeOS/issues/51), [#56](https://github.com/StarMadeGalaxy/JudeOS/issues/56) |
| [#58](https://github.com/StarMadeGalaxy/JudeOS/issues/58) · S5-02 | Проверить полный restore, остановку модулей и совместимый откат | [#57](https://github.com/StarMadeGalaxy/JudeOS/issues/57), [#24](https://github.com/StarMadeGalaxy/JudeOS/issues/24) |
| [#59](https://github.com/StarMadeGalaxy/JudeOS/issues/59) · S5-03 | Провести полный пилот первого зала и обучить сотрудников | [#57](https://github.com/StarMadeGalaxy/JudeOS/issues/57), [#58](https://github.com/StarMadeGalaxy/JudeOS/issues/58), [#37](https://github.com/StarMadeGalaxy/JudeOS/issues/37) |
| [#60](https://github.com/StarMadeGalaxy/JudeOS/issues/60) · S5-04 | Перевести зал 2 на единый учёт с отдельной сверкой | [#59](https://github.com/StarMadeGalaxy/JudeOS/issues/59) |
| [#61](https://github.com/StarMadeGalaxy/JudeOS/issues/61) · S5-05 | Перевести зал 3 на единый учёт с отдельной сверкой | [#60](https://github.com/StarMadeGalaxy/JudeOS/issues/60) |
| [#62](https://github.com/StarMadeGalaxy/JudeOS/issues/62) · S5-06 | Перевести зал 4 на единый учёт с отдельной сверкой | [#61](https://github.com/StarMadeGalaxy/JudeOS/issues/61) |
| [#63](https://github.com/StarMadeGalaxy/JudeOS/issues/63) · S5-07 | Принять полный MVP во всех четырёх залах | [#60](https://github.com/StarMadeGalaxy/JudeOS/issues/60), [#61](https://github.com/StarMadeGalaxy/JudeOS/issues/61), [#62](https://github.com/StarMadeGalaxy/JudeOS/issues/62) |

### После MVP — уточнение развития

Отложенные задачи исследования требований. Начало только при подтверждённом триггере из плана §7; не обещание реализации и не часть MVP. Обзор: [#15](https://github.com/StarMadeGalaxy/JudeOS/issues/15).

| Issue | Результат | Прямые зависимости |
|---|---|---|
| [#64](https://github.com/StarMadeGalaxy/JudeOS/issues/64) · POST-01 | Уточнить кабинеты представителей и участников | [#63](https://github.com/StarMadeGalaxy/JudeOS/issues/63) |
| [#65](https://github.com/StarMadeGalaxy/JudeOS/issues/65) · POST-02 | Уточнить чаты и правила доступа к истории | [#63](https://github.com/StarMadeGalaxy/JudeOS/issues/63) |
| [#66](https://github.com/StarMadeGalaxy/JudeOS/issues/66) · POST-03 | Уточнить нормативы, измерения и историю спортивных результатов | [#63](https://github.com/StarMadeGalaxy/JudeOS/issues/63) |
| [#67](https://github.com/StarMadeGalaxy/JudeOS/issues/67) · POST-04 | Уточнить рейтинги и воспроизводимый расчёт | [#63](https://github.com/StarMadeGalaxy/JudeOS/issues/63) |
| [#68](https://github.com/StarMadeGalaxy/JudeOS/issues/68) · POST-05 | Подготовить условия второго клуба и платформенного биллинга | [#63](https://github.com/StarMadeGalaxy/JudeOS/issues/63) |
| [#69](https://github.com/StarMadeGalaxy/JudeOS/issues/69) · POST-06 | Уточнить другие платёжные адаптеры и каналы уведомлений | [#63](https://github.com/StarMadeGalaxy/JudeOS/issues/63) |
| [#70](https://github.com/StarMadeGalaxy/JudeOS/issues/70) · POST-07 | Оценить отдельную необходимость медицинских документов | [#63](https://github.com/StarMadeGalaxy/JudeOS/issues/63) |

## Применить GitHub-конфигурацию после восстановления доступа

Нужны GitHub CLI с доступом записи в репозиторий и Project #1 и разрешённое подключение к api.github.com. Репозиторное право push не доказывает право редактировать пользовательский Project. Секреты/токены в чат или репозиторий не передаются.

Из корня checkout:

```bash
python scripts/sync-github-planning.py --validate
python scripts/sync-github-planning.py
python scripts/sync-github-planning.py --apply
```

Первый вызов проверяет manifest без сети, второй читает GitHub и показывает предполагаемые изменения, третий создаёт недостающие milestones, назначает их, добавляет native blocked-by и sub-issues, размещает все 63 Issues планирования в указанном Project и выставляет статусы. Повторный запуск использует существующие названия/номера/связи, не создаёт повторные Issues или доску; assignees/сроки не меняет. Скрипт не удаляет сторонние элементы/зависимости; изменения утверждённого графа согласовать отдельно. Частичный сбой остаётся явным и допускает повторный запуск.

Скрипт сохраняет текущие In progress/Review; не делает вывод о ревью по одному назначению. Для нетронутых задач вычисляет Ready/Backlog по завершению зависимостей; отложенные задачи остаются Backlog. Пустой Status можно настроить автоматически; если поле уже содержит значения и нужных вариантов нет, скрипт останавливается с просьбой добавить варианты через UI, сохранив существующие значения. Применение этих API в текущей среде не проверено из-за Forbidden.

В Project UI проверить/создать Board, сгруппированный по Status, и включить колонки milestone/assignee. Существующие виды/автоматизации не удалять. Автоматизации для закрытого Issue → Done и повторного открытия/новой задачи проверить фактическим событием; автоматическое «добавлено → Ready» недопустимо при зависимостях. Review/In progress отражают фактическую работу/PR и меняются командой. После merge проверять разблокированные задачи и переводить их в Ready; запуск скрипта помогает пересчёту, но не заменяет согласование нового бизнес-правила.

После применения получить read-back milestones, dependencies, sub-issues и состава/статусов Project; результаты записать в #8. Только после этого отметить настройки готовыми и закрыть #8. Текущий документационный PR не закрывает эту незавершённую настройку автоматически.

## Покрытие старого плана

| Прежний этап | Issues текущего плана |
|---|---|
| P00 границы/образцы | #16, #17, #18 |
| P01 контракты/прототипы | #16, #23, #26; расширения #38, #46, #52 |
| P02 каркас/UI | #19, #23, #28, #34, #44, #54 |
| P03 доступ/аудит/очереди | #20, #21; доставка #48, офлайн #53–#55 по мере потребности |
| P04 люди/семьи/допуск | #26–#28, #32, #33, #35 |
| P05 группы/расписание | #29, #30, #34 |
| P06 посещаемость | #31–#34, #36, #37 |
| P07 поддержка/поступления | #38–#45 |
| P08 Telegram | #46–#51; переносы #49 независимо от финансов #50 |
| P09 офлайн | #52–#56 после #36 |
| P10 импорт/отчёты | #17, #35, #38, #40, #41, #43–#45, #57 |
| P11 эксплуатация | #18, #20–#22, #24, #51, #56, #58 |
| P12 пилот/четыре зала | #37 (узкий), #59–#63 (полный MVP) |

## Сквозные критерии API и документации

Для всех задач с HTTP-изменениями действуют [правила API](../docs/API-DOCUMENTATION.md) и [ADR 0004](adr/0004-chi-and-api-documentation.md): chi v5, OpenAPI, реестр endpoint’ов, Swagger UI, права/ошибки/примеры и проверки соответствия. #16 подготавливает контракт/реестр первого среза, #19 — chi/Swagger UI, задача CI — проверку валидности/покрытия/клиента. Эти критерии дополняют опубликованные Issues; manifest должен синхронизироваться при их следующем обновлении. Будущие endpoint’ы не объявляются реализованными.

При недоступности Projects API агент до работы возвращает компактный список прямых ссылок на выбранные карточки, исполнителя и просьбу установить assignee/In progress. Ждёт явного подтверждения или скриншота; после него продолжает без повторного блокера API. Для неизменившегося продолжения того же чата повторный ручной переход не требуется. [Шаблон и правила](../AGENTS.md#первое-сообщение-при-ручном-резервировании).

## Отложенная проверка мобильной переклички

[#86 — проверить пошаговую перекличку](https://github.com/StarMadeGalaxy/JudeOS/issues/86): после рабочего онлайн-журнала и наблюдений на тренировках сравнить список, карточки с кнопками и свайпы. Это гипотеза UX, не обязательная зависимость S0–S5 и не расширение #23/#34. Исполнитель пока не назначен; целевой Backlog не подтверждён через Projects. [Требования, ограничения и рекомендация](MOBILE-COACH-UX.md). Документирование перспективы — #84.
