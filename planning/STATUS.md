# Текущее состояние JudeOS и передача коллеге

Обновлено 7 октября 2026 года. Этап — синтетическая основа S0; подробные результаты/история в Issues/PR и Git.

## Контракт и каркас

[#16](https://github.com/StarMadeGalaxy/JudeOS/issues/16) принята пользователем, PR #78 merged, Issue закрыта; формальные статусы ADR 0006 и API-документов синхронизированы с DECISIONS U2026-10-07-S0-01. Семь бизнес-операций остаются запланированы, auth/журнал не реализованы.

[#19](https://github.com/StarMadeGalaxy/JudeOS/issues/19), исполнитель NikishGum; ветка `feat/19-project-scaffold`, [PR #83](https://github.com/StarMadeGalaxy/JudeOS/pull/83), опубликованный коммит реализации `a9cf712`, run `scaffold-19-20261007T150701Z`. Пользователь выбрал ручной процесс и ответил «готово» на конкретный блок #19/NikishGum/In progress; источник записан в claim и DECISIONS U2026-10-07-S0-RESUME-01. Assignee подтверждён REST. Переданный коммит `86ecd0a` восстановлен из GitHub: именованной ветки на origin при старте не было. Актуальная main `2933858` интегрирована merge-коммитом `2773d10`, обе записи контекста сохранены. Дополнительный checkout/worktree не создавался.

Каркас реализует Go/chi API, React/TypeScript/Vite web-оболочку, PostgreSQL и два SQL-шага goose с повторяемым синтетическим seed в отдельной schema development. Health/readiness проверяют процесс/БД/текущую версию схемы; Go отдаёт web и локальный Swagger на одном origin. Runtime OpenAPI показывает только четыре реализованные служебные операции, chi.Walk проверяет их и четыре явных static routes. [Запуск/эксплуатация](../ops/README.md), [ADR 0007, предложено для ревью](adr/0007-synthetic-scaffold.md). Worker, предметные таблицы/RLS/auth, CI/HTTPS и PWA/offline — последующие задачи, не готовые части каркаса.

## Проверки

- Сборка Go/web и Docker stages с сохранёнными proxy/TLS, закреплённые versions/digests/lockfiles; чистый Compose запуск на собственном новом томе, миграции → seed → API/web/Swagger; две вымышленные записи.
- Реальный PostgreSQL: пустая/старая/слишком новая схема не ready, upgrade с существующей строкой сохраняет данные/добавляет timezone, повтор up/seed не создаёт дубликатов. Отдельная тестовая БД создаётся и удаляется check-db.
- Go race/vet/modules verify; OpenAPI/$ref/operationId/реестр, 29 схемных fixtures и примеры всех ответов, TS-клиент; chi.Walk против runtime-контракта. Tidy тестовых зависимостей goose ограничен запрещённым storage.googleapis.com; runtime build -mod=readonly проходит, ограничение не обходилось.
- Реальные HTTP status/schema/Cache-Control/request_id, 404 запланированного API, 405/Allow и slash/HEAD/OPTIONS; остановка БД → health 200 / readiness 503, после старта БД readiness восстанавливается.
- Playwright/system Chromium: web с реальным API на 320/390/768/1280 без горизонтального overflow, ошибки readiness/сети; runtime Swagger (4 операции) и полный принятый контракт (11), без JS/Swagger ошибок. Скриншоты просмотрены; реальные телефоны/RLS/cookie/CSRF/журнал не проверяются до своей реализации.

## Project API и независимая работа

[#8](https://github.com/StarMadeGalaxy/JudeOS/issues/8) остаётся открытой, [draft PR #82](https://github.com/StarMadeGalaxy/JudeOS/pull/82) передавал настройку. GH_PROJECT_TOKEN теперь ready/непустой, но исходящая GraphQL авторизация заменяется интеграцией: даже неверный диагностический credential возвращает viewer NikishGum и Resource not accessible by integration. Сам PAT/его actor/scopes/Write не проверены. Нужна поддерживаемая настройка credentials; значения не выводились. Milestones/native links/состав и статусы Project не заявляются настроенными; полный sync --apply не запускался.

Пауза #19 снята прямым поручением о ручном резервировании. Следующим карточкам при недоступном API агент даёт прямую ссылку, assignee и просьбу In progress, затем ждёт явного ответа; подтверждённую карточку того же чата не просит двигать повторно. #23/PR #81 ведётся отдельно, её файлы/ветка не менялись.

## Следующий шаг

Ревью/приёмка PR реализации #19 вторым разработчиком; нужен ручной Status Review, автоматическое обновление недоступно. Issue не закрывается до merge/приёмки. После интеграции обоим получить актуальную main; затем выбрать свободную #20 (изоляция/роли/RLS/FK) или #22 (CI/размещение) по живой занятости и зависимостям. #21 (auth) зависит от #20. Реальные данные/пилот остаются заблокированы условиями #18/#24, каркас использует только синтетические fixtures.
