# Текущее состояние JudeOS и передача коллеге

Обновлено 7 октября 2026 года. Текущий приоритет по прямому поручению пользователя — доступ к GitHub Project API; результаты/история в Issues/PR и Git.

## Приоритет: самостоятельное управление Project #1

Пользователь остановил #19 и поручил сначала настроить Project API; источник сохранён в DECISIONS. Рабочая область — [#8](https://github.com/StarMadeGalaxy/JudeOS/issues/8), assignee NikishGum, run `project-api-8-20261007`, ветка `chore/8-project-api-access` от main `ae9ab50`. Резервирование частичное: Project In progress не подтверждён из-за устраняемого отказа. Ветка содержит только фиксацию смены приоритета/блокера, без новых скриптов, схем или реализации приложения.

Проверены текущие Issues/обсуждения/PR и GitHub actor обоими каналами. REST user/repository/issues работает как NikishGum, repository push=true, admin=false. api.github.com разрешён сетью, политика enforced. GraphQL Project #1 владельца StarMadeGalaxy возвращает `Resource not accessible by integration`; поле projectV2 недоступно. Подключённый GitHub plugin проверен: Project-операций среди доступных инструментов нет. У пользовательского Project отдельные права Collaborator и отдельная авторизация API; текущий отказ не доказывает отсутствие права Write у пользователя — это нужно проверить после настройки credentials.

Официальные источники: [авторизация Projects API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects), [доступ к пользовательскому Project](https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/managing-access-to-your-projects), [ограничения fine-grained PAT](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens). Подготовлен путь настройки: подтвердить Write для NikishGum на доске, classic PAT пользователя со scope project и ограниченным сроком, отдельный защищённый runtime-секрет GH_PROJECT_TOKEN в этом облачном окружении. Токен в чат/репозиторий/Issue не передаётся. В текущих наблюдениях environment_status дополнительные secrets/runtime variables отсутствуют; конфигурация не заявляется применённой.

## Состояние реализации

Контракт #16 принят пользователем, PR #78 merged, #16 closed; актуальная main `ae9ab50`. Go/web/PostgreSQL каркас, SQL-миграции и CI ещё не созданы. Формальные пометки ADR 0006/контракта нужно синхронизировать с приёмкой при следующем разрешённом изменении.

#19 назначена NikishGum и на паузе по поручению пользователя. Ветка `feat/19-project-scaffold` опубликована, commit `86ecd0a` содержит только запись приёмки/блокера в DECISIONS/STATUS; предметная реализация и тесты не начинались, PR не создан. Ручная установка In progress #19 больше не запрашивается: сначала должен заработать самостоятельный API. Claim #19 обновлён, назначение сохранено.

## Проверки и следующий шаг

- Диагностические REST/GraphQL чтения, безопасные заголовки scopes без credential values, permissions репозитория и environment readiness проверены; пользовательский Project пока возвращает Forbidden. GitHub plugin найден уже подключённым; новых интеграций/прав через Plugin Management не устанавливалось.
- Нужна настройка защищённого credential и доступа пользователя к Project через интерфейс владельца/окружения. Без неё нельзя подтвердить чтение/запись Projects. Общий sync backlog, изменения Status/milestones/native dependencies не выполнялись.
- После настройки: проверить соответствие actor NikishGum, project ID/viewerCanUpdate и реальные field/option IDs; перевести выбранную карточку #8 в In progress с read-back. Затем проверить управление согласованной карточкой #19 и сохранить инструкции эксплуатации без секретов. Общая настройка backlog из #8 — отдельный проверяемый шаг, не объявляется выполненной по одному успешному чтению.
- После устранения доступа продолжать #19 по принятому #16 и зависимостям плана. Перед каждой новой задачей проверять актуальные зависимости, занятость, assignee/Status/claim. Новых API/runtime тестов на этом этапе нет.
