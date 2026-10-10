# Реализация месячных семейных рекомендаций #39

10 октября 2026. **Подготовлен wire-проект; backend/SQL пока не реализованы.**
Все данные синтетические. [Issue39](https://github.com/StarMadeGalaxy/JudeOS/issues/39),
[wire и DTO](../../api/RECOMMENDATIONS-CONTRACT.md),
[standalone OpenAPI](../../api/recommendations/openapi.json).

## Резервирование и принятые зависимости

@NikishGum; run `family-39-20261010T084704Z-a67294d6`, ветка
`feat/39-family-monthly-recommendations` от main328b8637.
[Собственный claim](https://github.com/StarMadeGalaxy/JudeOS/issues/39#issuecomment-6095859137).
In progress39 подтверждён пользователем этого чата словами «установлено in progress»;
Projects API Forbidden, подтверждения других задач не использованы.
27/38 completed; PR111/112 merged и APPROVED. В ходе работы PR114 принят/merged в main7219d0d; Issue29 CLOSED/completed,
Approve финального head подтверждён. Эта main получена ff в своей ветке.
Бизнес-правила F39-01–03 отдельно подтверждены;
[точные вопросы/ответы](https://github.com/StarMadeGalaxy/JudeOS/issues/39#issuecomment-6095906412).

## Согласование до общих изменений

| Владелец / предмет | Запрос | Статус |
|---|---|---|
| #29, отдельный run того же NikishGum: wire/router/checks/docs,00012→00013, merge114→39, ADR0016 | [Точный запрос](https://github.com/StarMadeGalaxy/JudeOS/issues/29#issuecomment-6095870629) | Ожидается |
| #34 / StarMadeGalaxy: shared OpenAPI/docs и непересечение journal/UI/training | [Точный запрос](https://github.com/StarMadeGalaxy/JudeOS/issues/34#issuecomment-6095870808) | Ожидается |
| #46, отдельный run NikishGum: собственные DECISIONS/STATUS/finance, сохранение T46/shared-docs.patch | [Точный запрос](https://github.com/StarMadeGalaxy/JudeOS/issues/46#issuecomment-6095871021) | Ожидается |

До ответов общие OpenAPI/ENDPOINTS, people/family DTO и таблицы, SQL, router,
DATA-MODEL/ARCHITECTURE/DECISIONS/STATUS/README не редактируются. ADR0016
и миграция00013 предложены, но не объявляются зарезервированными согласованно.
Отдельный standalone wire позволяет рассмотреть конкретный контракт без
добавления planned операций в действующий runtime и без пересечения shared files.

## Открытые вопросы конкретного wire

- Нужны ли одиночные рекомендации без Household? Текущий проект покрывает
  семью из одного ребёнка, не требует автоматического изменения реестра.
- Как явно прекратить рекомендацию семьи после ухода последнего ребёнка?
  Пустой список и бесконтрольное дублирование Athlete/месяца не предлагаются.
- Для нового месяца предложена проверка семейного периода на первый день
  месяца в Europe/Minsk; середина месяца не пересчитывается пропорционально.
  Нужно согласовать этот cutoff и поведение исторически архивного спортсмена.
- При явной замене состава предложено сохранить прежнее уменьшение и заново
  распределить его по новому порядку. Сбросить его можно отдельной явной
  set_reduction, если такая команда будет принята владельцем.
- Политика сохраняет версию baseline110/88/77/0. API изменения ставок,
  автоматические формулы пропусков и индивидуальные произвольные ставки
  не добавляются без конкретного решения.

## Граница результата и следующий шаг

Wire0.1 требует согласования перечисленных технических вопросов до соответствующей реализации.
После согласований: включить exact additive OpenAPI/ENDPOINTS patch, записать
wire commit, реализовать согласованный recommendations модуль/миграцию,
обновить связанные документы и выполнить проверки из wire.
Нельзя объявлять HTTP/PostgreSQL/tenant/RLS/повторы/конкуренцию проверенными
по валидации документального проекта. До полного результата PR остаётся draft,
Issue39/In progress, критерии не отмечаются выполненными.

VPS release, checkout, manifest, рабочие тома, Receipt/Allocation/импорт,
финансовый UI и Telegram не затрагиваются. Автоматического merge/deploy нет.
