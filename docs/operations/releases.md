# CI и идентифицируемые релизы

## Checks

[CI workflow](../../.github/workflows/ci.yml) запускается на pull_request, push main, tags `v*` и вручную. Нет path filters: изменения docs/ops не обходят обязательный CI. PR-код не получает deploy/package secrets; используется pull_request, а не pull_request_target. Actions закреплены commit SHA, зависимостям разрешён только обычный TLS. Job permissions по умолчанию `contents: read`; write предоставлен только publish для release tag.

| Check name | Проверка |
|---|---|
| `Go` | module hashes, race tests, vet, readonly build API/db |
| `Web and contract` | npm ci по lockfiles, lint/bundle/$ref/operationId/fixtures/TS client, chi.Walk routes, TS/Vite build |
| `Migrations` | существующие make db-up/check-db на реальном PostgreSQL: upgrade/bootstrap/seed/роли/RLS/FK/audit/версия readiness, собственная случайная DB |
| `Image and HTTPS` | два build одного source (второй no-cache), равенство image ID, metadata, локальный TLS с проверкой CA/hostname, закрытая DB network/ports, failure/recovery readiness, существующий HTTP contract checker через HTTPS, synthetic backup/restore |

Go-unit tests без JUDEOS_TEST_DATABASE_URL пропускают PostgreSQL integration test: отдельный Migrations job запускает его обязательно через существующий check-db, предварительно ожидая final TCP readiness PostgreSQL (не временный Unix socket initdb). CI переиспользует PostgreSQL-проверки #20 из интегрированной main `02d9630`; test-compose адаптирован к опубликованным bootstrap/роль/seed интерфейсам. После этого merge все четыре checks проверяются повторно. Auth #21, продуктовые права и production readiness этим CI не доказаны. Browser/реальные телефоны и внешнее публичное размещение не включены в эти checks.

## Образ и manifest

`ops/release-build.py --builder judeos-release --output /absolute/external/path --verify-rebuild` требует явно выбранный dedicated docker-container builder с закреплённым BuildKit 0.24.0; Docker driver отвергается до сборки, поскольку нормализация слоёв с ним не обеспечена. [release-builder.py](../../ops/release-builder.py) сохраняет proxy из Docker client config и при явном BUILD_CA_PATH подключает публичный CA для registry trust builder. CI создаёт такой builder pinned setup-buildx Action. Сборка использует существующий ops/Dockerfile, закреплённые base digests и lockfiles, linux/amd64, SOURCE_DATE_EPOCH из commit, нормализацию timestamp-ов слоёв (`rewrite-timestamp=true`) и стабильные OCI labels source/revision/version/created. Вторая сборка без layer cache должна дать тот же **local image ID**. Provenance отключена именно для локального сравнения; signed provenance/подпись образов пока не внедрены. При ограниченном диске VFS в собственном изолированном builder допускается явный `--prune-between-builds`: удаляется build cache между двумя сборками, не образы/контейнеры/тома. Не применять к общему builder. По умолчанию cache не удаляется.

Проверка относится к этому source/platform/BuildKit и сохранённым зависимостям; разные будущие builders требуют повторной проверки.

Manifest `release.json`: source commit/epoch, dirty flag, platform, local image ID, версия схемы и SHA256 каждого SQL, факт rebuild, registry digest, previous compatible release. `image.tar`/manifest — CI artifact; secrets не включаются. Untracked/dirty checkout запрещён, кроме явно помеченной локальной проверки. Tag/image label `sha-<full commit>` связывает build с исходниками. Local image ID (config hash) и registry manifest digest — разные значения.

После ревью и merge владелец выпускает новый SemVer tag `vMAJOR.MINOR.PATCH[-prerelease]` на **интегрированном main**. Tag workflow заново выполняет те же checks; publish принимает их artifact, не пересобирает его. Публикует GHCR image с tag версии и full commit, получает registry digest и создаёт GitHub Release с `release.json`. Deploy не выполняется. Нужны доступные Actions/packages и разрешения GITHUB_TOKEN; первый реальный tag run/доступность package ещё должны быть проверены. Не использовать новый tag как способ обойти merge/review. Не переписывать tags/releases и не перемещать version/sha tags; запуск по существующему Release и перезапись registry tag другим image отвергаются; невозможность прочитать tag state останавливает publish. Deployment всегда по `ghcr.io/...@sha256:...`, не `latest`/mutable tag.

## Предыдущий совместимый релиз

Первый выпуск не имеет предыдущего проверенного release; manifest явно содержит `previous_compatible_release: null`. Это честное отсутствие кандидата, не обещание rollback. У каркаса #19 readiness принимает **ровно текущую версию схемы**: старый binary после новой миграции может вернуть 503. Нельзя автоматически считать прошлый tag совместимым или делать SQL down.

1. Сохранить manifest/digest текущего и предыдущего GitHub Release вне Git. `python3 ops/release-compare.py /path/current-release.json /path/previous-release.json` выводит identifiable candidate и требует одинаковые версии/хеши схемы; разные схемы отвергаются.
2. На отдельной синтетической БД текущей версии запустить предыдущий образ **по digest**, проверить HTTPS/readiness/web и существенные проверки. Не применять неизвестный старый migrator к общей БД. При одинаковой версии/миграциях bootstrap/up/seed идемпотентны; повтор проверяется на интегрированной #20.
3. Записать результат runtime check и digest предыдущего совместимого release в эксплуатационной записи вне Git/#22. Metadata comparison сам по себе совместимость не доказывает. Для изменения schema разработчик задаёт совместимость в PR и проверяет её; пока нет явного результата — остановить rollout и выбрать forward fix.
4. Rollback приложения допускается только на записанный совместимый digest с повторным readiness. Не удалять новую схему/данные. Restore БД — отдельная операция с проверками, не скрытая часть rollback.

## Защита main после появления checks

Администратор репозитория после первого успешного CI выбирает реально появившиеся contexts: **Go**, **Web and contract**, **Migrations**, **Image and HTTPS** (приложение GitHub Actions). Требовать PR, как минимум одно одобрение второго разработчика, снятие устаревших approvals при новых коммитах, разрешение conversations, эти четыре checks и актуальность ветки относительно main. Запретить force-push/deletion, ограничить обход правил; прямой push в main не использовать. `Publish tagged release` не required context для PR: он выполняется только на tag.

Названия выбираются из фактического UI/check API, не вымышленные ID. Workflow не ставит branch protection от имени collaborator и не объявляет её включённой. Администратор фиксирует настройки/read-back в #8/#22. Если появится merge queue, добавить merge_group trigger до её включения. При переименовании job сначала обновить ruleset, чтобы не оставить вечный pending check. Не включать правило до того, как checks действительно появились.
