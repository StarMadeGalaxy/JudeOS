# Текущее состояние JudeOS и передача коллеге

Обновлено 7 октября 2026 года. Этап — синтетическая основа S0; история/подробности в Issues/PR и Git.

## Приёмка и текущая работа

[#16](https://github.com/StarMadeGalaxy/JudeOS/issues/16) принята пользователем, PR #78 merged, Issue закрыта; ADR 0006/API синхронизированы с DECISIONS U2026-10-07-S0-01. Семь бизнес-операций остаются запланированы.

[#19](https://github.com/StarMadeGalaxy/JudeOS/issues/19) принята после запуска `make up`: «принято, выбери следующий логичный issue». Источник — передача пользователя в текущем чате 7 октября 2026, DECISIONS U2026-10-07-S0-02. [PR #83](https://github.com/StarMadeGalaxy/JudeOS/pull/83) merged, Issue закрыта. Fetch main при старте #20 подтвердил `d9162a4f24c2615c79826d01bf4b7445a5e8f38f`. Приёмка каркаса не утверждает будущие рекомендации ADR 0007 или готовность MVP.

[#20](https://github.com/StarMadeGalaxy/JudeOS/issues/20) принята: пользователь в этом чате ответил «Перевел в rview и принял» после передачи результата. Источник — DECISIONS U2026-10-07-S0-20-ACCEPT и [комментарий приёмки](https://github.com/StarMadeGalaxy/JudeOS/issues/20#issuecomment-6043446443). [PR #85](https://github.com/StarMadeGalaxy/JudeOS/pull/85) merged, Issue закрыта; актуальная main при старте #88 — `02d963065b49eaf05c4d18398249a28e287a383d`. Run `tenant-20-20261007T162818Z` завершён. Принята синтетическая основа; реальные права/сроки/условия и auth не добавлены. Последний явно подтверждённый Project Status — ручной Review; Done через API не заявляется.

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

Projects GraphQL возвращает Resource not accessible by integration; текущий runtime snapshot GH_PROJECT_TOKEN — ready, но это не устанавливает права Projects API. [#8](https://github.com/StarMadeGalaxy/JudeOS/issues/8) остаётся открытой. Автоматическое управление/состав Project не заявляются исправленными. Подтверждения ручных статусов сохраняются с источником в claims/DECISIONS; повторного блокера API после них нет.

#23/[PR #81](https://github.com/StarMadeGalaxy/JudeOS/pull/81) ведётся отдельно.

[#22](https://github.com/StarMadeGalaxy/JudeOS/issues/22) занята другим run `ci-22-20261007T170927Z` / NikishGum, ветка `feat/22-ci-test-release`, [draft PR #89](https://github.com/StarMadeGalaxy/JudeOS/pull/89); [claim](https://github.com/StarMadeGalaxy/JudeOS/issues/22#issuecomment-6042864506). По живым комментариям агент сохранил работу и интегрировал принятую #20/main `02d9630`, адаптировал свои test/CI-файлы к bootstrap/разным LOGIN/схеме 3. В [передаче #22](https://github.com/StarMadeGalaxy/JudeOS/issues/22#issuecomment-6044175711) сообщил о четырёх прошедших CI checks; внешний серверный запуск и релиз ещё не подтверждены. Его файлы/назначение не перехватываются. В #22 добавлены предоставленные пользователем параметры Hostinger VPS и целевой серверный test; фактический доступ/развёртывание/внешний HTTPS ещё не подтверждены.

## Hostinger VPS и документация #88

Пользователь предоставил Hostinger VPS `187.7.69.230` (1 core / 4 GB RAM / 50 GB disk), сообщил о подключённом Docker Manager и разрешил использовать сервер для синтетических тестов/запуска JudeOS вместо зависимости от локальной машины. Домен `judopride.tech` назначен этому IP, SSL установлен по сообщению пользователя; скриншот показывает A-ответы `187.7.69.230`. Целевой origin — `https://judopride.tech`; сертификат, TLS termination/renewal и внешний HTTPS JudeOS не проверены. Bandwidth «4» без единицы/периода; ОС, регион, защищённый доступ, оператор и копии не сообщены/не проверены. Источник — DECISIONS U2026-10-07-VPS-01/02; [параметры и границы готовности](../docs/environments/hostinger-vps.md). Развёртывание остаётся #22; покупка VPS не означает production-контур или снятие условий #18/#24.

[#88](https://github.com/StarMadeGalaxy/JudeOS/issues/88), исполнитель NikishGum; ветка `docs/88-hostinger-test-vps`, run `vps-docs-88-20261007T181559Z`, [claim](https://github.com/StarMadeGalaxy/JudeOS/issues/88#issuecomment-6044049234). Единственный assignee подтверждён REST; пользователь ответил «88 in progress» на конкретный блок карточки. Готов [PR #90](https://github.com/StarMadeGalaxy/JudeOS/pull/90) с `Closes #88`: документ площадки, источники в DECISIONS, уточнения домена/SSL и эта передача; commits `1fb7f16`, `7485c75`. Проверены `git diff --check` и 23 локальные Markdown-ссылки (отсутствующих нет). PR ожидает ревью; нужен ручной Review в Project, его установка ещё не подтверждена. Приложение/БД этим документационным изменением не затронуты; вход/развёртывание на VPS не выполнялись. INFRASTRUCTURE, ops, workflows и docs/operations #22 не менялись; сведения переданы в [комментарии #22 о VPS](https://github.com/StarMadeGalaxy/JudeOS/issues/22#issuecomment-6044050366) и [уточнении домена/SSL](https://github.com/StarMadeGalaxy/JudeOS/issues/22#issuecomment-6044337117), дублирующая задача развёртывания не создаётся.

## Следующий шаг

Ревью документационного PR #88 и ручной Review; #22 использует предоставленную VPS как test-площадку, получает защищённый доступ/проверяет ОС/порты/HTTPS и фиксирует фактический серверный запуск. Сам факт покупки не закрывает критерии #22. У #21 (auth) снята зависимость от #20; старт требует живой проверки и собственного резервирования. После каждого merge обоим получать актуальную main, сохраняя работу и источники общих документов. Реальные данные/пилот остаются за условиями #18/#24.
