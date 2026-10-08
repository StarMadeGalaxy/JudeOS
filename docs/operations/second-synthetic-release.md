# Новый synthetic baseline: v0.1.0-test.2

8 октября 2026 опубликован GitHub prerelease из принятой main после ручного merge #95/#96. Он содержит исправленный config/manifest identity checker и адаптер #91. [План tag/source до публикации](https://github.com/StarMadeGalaxy/JudeOS/issues/22#issuecomment-6056476659), [передача #91](https://github.com/StarMadeGalaxy/JudeOS/issues/91#issuecomment-6056635669). Только synthetic test; это не разрешение реальных данных или production.

| Идентификатор | Проверенное значение |
|---|---|
| Tag | `v0.1.0-test.2` |
| Source commit | `0c224452ef4f060613b6838d8f787ce997043337` |
| GitHub Release | https://github.com/StarMadeGalaxy/JudeOS/releases/tag/v0.1.0-test.2 |
| Manifest | https://github.com/StarMadeGalaxy/JudeOS/releases/download/v0.1.0-test.2/release.json |
| Manifest SHA256 | `c9067f38b4aa7f0b8d709c8c74cc473a1181d7c73c62adadb442edd892ef85d6` |
| Registry image | `ghcr.io/starmadegalaxy/judeos@sha256:f60e513f0ae5a8aaf15835763f26600cc4371ac56a62c690e90564326bf4a373` |
| Config digest | `sha256:feb6a42b457c474473c07aa49914484c458ecd3f86e6e2aa0770b57cf0046bf0` |
| Platform/schema | `linux/amd64`, schema `3` |
| Tag CI | https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37754148019 |
| Main CI | https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37752529913 |

## Фактические проверки

Tag CI завершил **все пять jobs включая Publish tagged release успешно**. GitHub Release `draft=false`, `prerelease=true`. Скачанный manifest — 857 байт совпадает с таблицей; `dirty=false`, `rebuild_verified=true`, source/tag/schema/полный набор SQL SHA256 проверены. Принятый release-gate.py с tag и run37754148019 вернул verified=true.

Новый GHCR образ скачан **анонимно** по digest в отдельный Docker 29.8.2/containerd в облачной среде #22. Полный test-release-check.py на clean accepted source `0c22445`/origin/main подтвердил registry digest, SHA256 локально экспортированной конфигурации, platform, OCI revision/version, schema/SQL hashes и выдал verified=true. Docker 28/classic прошёл тот же полный checker. Proxy/CA/TLS сохранены; config/layers/secrets не публиковались. Это реальная проверка registry и Docker 29 в облаке; download/check на целевой VPS, её HTTPS и runtime должны быть проверены отдельно оператором/#91.

Schema/SQL hashes совпадают с [первым выпуском](first-synthetic-release.md). Это metadata comparison, не runtime rollback test; `previous_compatible_release=null` сохранён. Старые v0.1.0-test.1/tag/source `a546194` и опубликованный manifest не изменены: скачанные байты до/после совпали, SHA256 `80796ff…` и tag commit проверены.

## Продолжение на существующей VPS — только через #91

Существующие `/srv/judeos-test` (a546194) и `/var/lib/judeos-test-release/release.json` (release1) сохраняются. Не переключать/патчить frozen checkout, не перезаписывать manifest, не удалять/пересоздавать каталоги, credentials или volumes. Старые first-run guards не обходить.

1. #91 сначала получает безопасный read-only state VPS и согласует новые отдельные versioned paths checkout/manifest/adapter code. Точные root-команды продолжения выдаёт владелец #91 после этого; данная передача их не заменяет.
2. Оператор получает published manifest нового tag, проверяет **полный SHA256 из таблицы**, tag→source `0c22445` и clean accepted checkout, published gate/tag CI и image pull/identity/schema на VPS. Main на момент установки может продвинуться: не заменять pinned source на произвольный HEAD.
3. Только после успешной проверки нового baseline и повторного preflight 80/443/DNS/TLS/firewall оператор устанавливает enable по принятой инструкции #91 и явно подтверждает результат. Сейчас operator enable не подтверждён; #22 не выполняет enable/test-env/up/bootstrap/deploy/manual dispatch на VPS.
4. Первый dispatch делает только run91 после явного подтверждения enable. #22 не запускает второй bootstrap. #91 проверяет state/lock после ошибки или timeout до повтора; не сбрасывает DB/credentials/volumes.

Автоматический workflow_run от tag создал [run37754469953](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37754469953): selection success, Apply verified image on pinned VPS failure, independent public checks не выполнены. Это не успешный deploy; фактическая причина/server state требует безопасной проверки #91. Ручного dispatch из #22 не было. CI и registry check не доказывают состояние VPS.

[Hostinger preflight/эксплуатация](hostinger-first-run.md), [runbook/копии](runbook.md) и [требования защиты main](releases.md#защита-main-после-появления-checks) остаются действующими. Public HTTPS/closed DB/API ports, фактическая эксплуатация/restore/reboot и main protection ещё открыты. #22 не закрывается; документационный PR использует Refs #22, автоматического merge нет.
