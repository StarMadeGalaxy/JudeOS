# Текущее состояние JudeOS и передача коллеге

Обновлено 7 октября 2026 года. Этап — синтетическая основа S0; история/подробности в Issues/PR и Git.

## Приёмка и текущая работа

[#16](https://github.com/StarMadeGalaxy/JudeOS/issues/16) принята пользователем, PR #78 merged, Issue закрыта; ADR 0006/API синхронизированы с DECISIONS U2026-10-07-S0-01. Семь бизнес-операций остаются запланированы.

[#19](https://github.com/StarMadeGalaxy/JudeOS/issues/19) принята после запуска `make up`: «принято, выбери следующий логичный issue». Источник — передача пользователя в текущем чате 7 октября 2026, DECISIONS U2026-10-07-S0-02. [PR #83](https://github.com/StarMadeGalaxy/JudeOS/pull/83) merged, Issue закрыта. Fetch main при старте #20 подтвердил `d9162a4f24c2615c79826d01bf4b7445a5e8f38f`. Приёмка каркаса не утверждает будущие рекомендации ADR 0007 или готовность MVP.

[#20](https://github.com/StarMadeGalaxy/JudeOS/issues/20), исполнитель NikishGum; ветка `feat/20-tenant-isolation`, run `tenant-20-20261007T162818Z`, [claim](https://github.com/StarMadeGalaxy/JudeOS/issues/20#issuecomment-6042202052). До назначения: нет assignees/комментариев/конкурирующей ветки или открытого связанного PR; REST подтвердил единственного assignee. Пользователь ответил «in progress установлен» на конкретный блок #20/NikishGum/Project #1; источник ручного статуса — этот чат/DECISIONS S0-20-CLAIM. API read-back недоступен и повторно не блокирует. Реализация опубликована: [PR #85](https://github.com/StarMadeGalaxy/JudeOS/pull/85) готов к ревью, коммит кода `1b6d437`; последующий коммит фиксирует ссылку/передачу. Issue открыта до приёмки/merge, автоматического merge нет.

## Реализованная синтетическая основа

Go/chi API, React/TypeScript/Vite оболочка, PostgreSQL и goose 00001–00003, явный synthetic seed. Bootstrap-local отделяет admin, migrator и runtime credential; runtime без владения/BYPASSRLS/DDL. Club, синтетическая иерархия с составным FK, минимальный атомарный audit с ENABLE/FORCE RLS; tenant/actor/request локальны транзакции. Runtime не читает/меняет аудит, NOLOGIN audit_reader не назначен продуктовым ролям. Хранение синтетического аудита — жизнь disposable БД/тома до явного сброса; подтверждённые реальные сроки/права не придуманы, #18/#24 остаются блокером реальных данных. [ADR 0008, предложено для ревью](adr/0008-tenant-isolation-and-audit.md), [запуск/эксплуатация](../ops/README.md).

Readiness проверяет БД/ровно версию 3/безопасную runtime роль; health — процесс. Go отдаёт web/Swagger на одном origin. Runtime OpenAPI показывает четыре служебные операции, chi.Walk сверяет их и четыре static routes. HTTP генерирует request_id для context/ответов/логов; логи не содержат URL/query/header/body/SQL/raw errors. Account/auth/предметный журнал/объектные права, CI/HTTPS, worker и PWA/offline остаются в следующих задачах.

## Проверки #20

- `make check-db`: реальный PostgreSQL 18.3, разные LOGIN; legacy admin ownership #19 → migrator/00003, сохранение существующей строки, repeat bootstrap/up/seed. Два клуба: чужие write/FK/смена tenant и отсутствующий контекст отвергаются; read/update/delete чужих строк не раскрывают/меняют их. Runtime не владелец, без BYPASSRLS, DDL/TRUNCATE/SET ROLE/audit/старые fixtures закрыты.
- Один connection pool: commit/error/panic/cancel очищают tenant/actor/request, 20 конкурирующих обращений двух клубов не смешиваются. Аудит insert/update/delete атомарен, no-op/repeat seed не дублируются, rollback удаляет события, reader видит только свой tenant; контакты/label/секреты отсутствуют в событиях. Privileged/empty/old/new schema readiness отклоняются.
- Go 1.27.1: build -mod=readonly, race/vet/modules verify; web/TS сборка; OpenAPI/$ref/operationId/реестр, 29 схемных fixtures/примеры всех ответов, TS-клиент и chi.Walk. HTTP-тест с синтетическим чувствительным вводом проверяет нейтральный panic и серверный request_id без утечки в ответ/лог.
- Docker чистая БД → bootstrap → migrate → seed → API; свежая network build с явным публичным CA/proxy/TLS, повтор обычного `make up` без host CA на закэшированных зависимостях. Том/пароли сохранены. Live HTTP status/schema/заголовки, Playwright/system Chromium: web на 320/390/768/1280, runtime Swagger (4 операции) и полный контракт (11) проходят.
- Auth/cookie/CSRF/права внутри клуба, бизнес-команды, реальные данные/телефоны, production backup/retention/HTTPS не проверялись в #20. Go зависимости не менялись; прежний network-блокер tidy тестовой SQLite-зависимости goose не обходился.

## Project API и независимая работа

Projects GraphQL по-прежнему возвращает Resource not accessible by integration; текущий runtime snapshot GH_PROJECT_TOKEN — unknown, готовность credential не заявляется. [#8](https://github.com/StarMadeGalaxy/JudeOS/issues/8) остаётся открытой. Автоматическое управление/состав Project не заявляются исправленными. Последний подтверждённый Status #20 — ручной In progress; для готового PR нужен ручной Review.

#23/[PR #81](https://github.com/StarMadeGalaxy/JudeOS/pull/81) ведётся отдельно. Пользователь запросил промпт для параллельного агента: предложена свободная при проверке #22 (зависит только от принятой #19), отдельное окружение/резервирование. В claim #20 записаны границы файлов: #22 работает с workflows/новыми test-release ops/docs/INFRASTRUCTURE; изменения общих файлов согласуются. #20 не назначает/перехватывает #22.

## Следующий шаг

Ревью/приёмка [PR #85](https://github.com/StarMadeGalaxy/JudeOS/pull/85) вторым разработчиком; нужен ручной Review для [#20](https://github.com/StarMadeGalaxy/JudeOS/issues/20) в [Project #1](https://github.com/users/StarMadeGalaxy/projects/1); автоматического merge нет. #21 (auth) начинается после приёмки/merge #20 и собственного резервирования. После merge обоим получить актуальную main; агент #22 повторно проверяет CI/команды с новым bootstrap/ролью/схемой 3. Реальные данные/пилот остаются заблокированы условиями #18/#24.

## #22 — CI, релизы и синтетический HTTPS test

NikishGum; run `ci-22-20261007T170927Z`, ветка `feat/22-ci-test-release`. Assignee подтверждён REST; пользователь ответил «установил» на конкретный блок #22/In progress, источник в claim. Projects API недоступен; повторное ручное резервирование этого чата не требуется. Во время работы #20/PR #85 merged, #20 закрыта; свежая main `02d9630` интегрирована merge `b61f286`, передача #20 выше сохранена. #23/PR #81 не затрагивается; #21 здесь не начинается.

Добавлены четыре CI checks, tagged release workflow/manifest, standalone HTTPS test с раздельными bootstrap/migrator/runtime credentials вне Git, [операционные инструкции](../docs/operations/README.md), INFRASTRUCTURE и предложенный ADR 0009. Shared файлы #20 не редактировались; только новые ops-файлы #22 адаптированы к её опубликованным bootstrap/роль/seed интерфейсам и схеме 3. TCP readiness закрывает initdb race без изменения shared Compose.

После merge #20 повторно прошли Go/web build, race/vet/modules verify, OpenAPI/fixtures/TS/chi.Walk и PostgreSQL check-db (upgrade/роли/RLS/FK/контекст пула/audit). Dedicated pinned BuildKit 0.24.0 подтвердил одинаковый image ID после no-cache rebuild; Docker driver отвергается, public CA/proxy/TLS сохранены. Чистый HTTPS test: закрытые DB ports/internal network, bootstrap→migrate→seed→runtime, health/readiness 200→503→200, HTTP contract через HTTPS, synthetic dump/изолированный restore, probe диска/свежести; повтор up/seed сохраняет данные. Actionlint/config/Caddy/ссылки и отрицательные TLS/config/probe/publish проверки прошли. Локальная reproducibility-проверка помечена dirty; она не опубликованный release.

[Draft PR #89](https://github.com/StarMadeGalaxy/JudeOS/pull/89) опубликован с Closes #22; Issue остаётся открытой/In progress: публичные host/домен/DNS/защищённый доступ/оператор запрошены, пока не предоставлены. [Actions run 37666094247](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37666094247) для реализации `80a1d94`: все четыре checks прошли, release-image artifact сохранён. Web job явно делает make build перед chi.Walk, npm закреплён 11.9.0. GHCR/tag release, предыдущий runtime-совместимый digest и protection main нужно подтвердить фактически; main protected=false. Production/retention/RPO/RTO не заявлены. Следующий шаг: получить параметры test и выполнить внешнюю HTTPS/firewall проверку; после завершения критериев перевести PR в ready и вручную #22 в Review в Project #1.
