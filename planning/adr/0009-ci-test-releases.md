# ADR 0009: CI, идентификация релизов и синтетический HTTPS test

Статус: **предложено для ревью**. Дата: 7 октября 2026 года. Issue [#22](https://github.com/StarMadeGalaxy/JudeOS/issues/22), run `ci-22-20261007T170927Z`. Номер проверен по main/живым PR/claims; 0008 принадлежит #20. Это техническое предложение, не подтверждение production-контура.

## Контекст

#19 принята пользователем, PR #83 merged; исходный baseline `d9162a4`. На момент предложения CI, идентифицируемый выпуск и HTTPS test отсутствовали. #20 первоначально разрабатывала отдельные роли/RLS параллельно; #22 не копировала её незавершённый интерфейс. После PR #85 самостоятельный test адаптирован только к опубликованным bootstrap/migrator/runtime интерфейсам/схеме 3. Позже пользователь предоставил Hostinger/judopride.tech/оператора NikishGum; отдельная #91 реализовала доступ/adapter. Каркас принимает только текущую версию схемы. [Актуальные фактические результаты](../../docs/operations/hostinger-operations.md) отделены от исходного выбора: real release2/первый Apply/внешний HTTPS уже подтверждены, protection и VPS recovery остаются pending.

## Выбор

- GitHub Actions: четыре независимых required checks Go / Web and contract / Migrations / Image and HTTPS, закреплённые Actions SHA, readonly PR permissions. PostgreSQL checks на отдельной disposable DB; локальный TLS проверяет цепочку/hostname и outage/recovery readiness.
- Выделенный BuildKit docker-container builder, закреплённый image/digest; Docker driver отклоняется из-за неподдержанной нормализации timestamp-ов. Образ из существующего ops/Dockerfile, pinned versions/digests/lockfiles; SOURCE_DATE_EPOCH, нормализация timestamp-ов слоёв и OCI commit labels. Две сборки (вторая no-cache) сравнивают image ID. Release manifest содержит commit/schema/хеши миграций; tag run после checks публикует тот же artifact в GHCR и фиксирует registry digest в GitHub Release, без deployment.
- Самостоятельный ops/test-compose вместо правки shared dev-compose: отдельные project/тома/config/credentials, БД в internal network без host-порта, HTTPS edge Caddy. Внешние config и secrets создаются раздельно, не в Git. Локальный CA и публичный ACME — разные явные режимы; публичный режим только по immutable digest/реальному DNS.
- Предыдущий совместимый release не назначается по порядку tags. Одинаковые schema/hash metadata выбирают кандидата, runtime readiness подтверждает совместимость. Отсутствие предыдущего релиза первого выпуска записывается явно; schema down не выполняется.
- Порог диска/свежести копии и реальные RPO/RTO/retention выбирает оператор. Минимальный synthetic dump/restore-check проверяет каркас, не production recovery.

## Альтернативы

Overlay существующего dev-compose смешал бы host DB-порты, secrets и параллельные изменения #20. Отдельный Dockerfile дублировал бы build-контракт; используется существующий. На момент предложения автоматический deploy с PR/tag требовал неопределённых host credentials и представлял бы шаблон как подтверждённое размещение; позже отдельная #91 ввела root-owned pinned adapter и пользователь подтвердил один первый dispatch. Автоматический rollback на предыдущий tag опасен при точной версии схемы. Kubernetes/несколько VM сейчас не нужны для S0; выбранная пользователем площадка test — Hostinger, production-контур не подтверждён.

## Последствия и ограничения

CI обязателен после реального появления contexts и настройки protection администратором. Test-compose использует три разных credentials интегрированной #20: admin только явному bootstrap-local, migrator только миграциям/seed, runtime только API. После merge #20 все проверки повторяются; shared файлы не меняются. Docker administrator видит API environment; secret-file API интерфейс не добавлен без координации. Сборка dirty local не выпускается. Публичный DNS/HTTPS/host firewall, GHCR tag run, независимые копии и уведомления оператору требуют отдельной фактической проверки. Только synthetic данные; #18/#24 и auth #21 не закрываются.

Подробности: [операции](../../docs/operations/README.md), [инфраструктура](../INFRASTRUCTURE.md). Эта запись не изменяет подтверждённый стек и не выдаёт инженеринговые настройки за требования пользователя.
