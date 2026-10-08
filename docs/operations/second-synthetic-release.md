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

Новый GHCR образ скачан **анонимно** по digest в отдельный Docker 29.8.2/containerd в облачной среде #22. Полный test-release-check.py на clean accepted source `0c22445`/origin/main подтвердил registry digest, SHA256 локально экспортированной конфигурации, platform, OCI revision/version, schema/SQL hashes и выдал verified=true. Docker 28/classic прошёл тот же полный checker. Proxy/CA/TLS сохранены; config/layers/secrets не публиковались. Затем [оператор проверил тот же baseline на VPS](https://github.com/StarMadeGalaxy/JudeOS/issues/22#issuecomment-6057775770): clean exact source, manifest SHA, gate, anonymous pull и full Docker29 checker success.

Schema/SQL hashes совпадают с [первым выпуском](first-synthetic-release.md). Это metadata comparison, не runtime rollback test; `previous_compatible_release=null` сохранён. Старые v0.1.0-test.1/tag/source `a546194` и опубликованный manifest не изменены: скачанные байты до/после совпали, SHA256 `80796ff…` и tag commit проверены.

## Фактический первый запуск через #91

Существующие `/srv/judeos-test` (a546194) и `/var/lib/judeos-test-release/release.json` (release1) сохраняются. Не переключать/патчить frozen checkout, не перезаписывать manifest, не удалять/пересоздавать каталоги, credentials или volumes. Старые first-run guards не обходить.

Новые frozen пути согласованы и проверены: `/srv/judeos-test-v0.1.0-test.2` и `/var/lib/judeos-test-release-v0.1.0-test.2/release.json`; config `/srv/judeos-test-config`, project `judeos-hostinger-test`. [Полная staged инструкция #91](../environments/hostinger-release2.md) хранит историю получения/gate/enable. Оператор явно подтвердил enable и разрешил **один** первый deploy; #91 восстановила только root-owned SSH home0755, сохранив private files0600. Код future enable исправлен в [#98](https://github.com/StarMadeGalaxy/JudeOS/pull/98), который уже merged; published source/image/manifest не патчились.

После успешного [SSH preflight](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37764172815) #91 выполнила [единственный manual run37764403714](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37764403714): select и **Apply success**, root response completed с digest из таблицы, server-side HTTPS/readiness и DB bindings/internal network проверены. Workflow conclusion=failure сохраняется: первоначальный внешний check увидел лишнюю AAAA. Пользователь удалил ошибочную IPv6-запись; [отдельный public run37765696629](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37765696629) success, [final public check #98](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37766878813) повторно success. Подтверждены exact IPv4 DNS, HTTP→HTTPS, trusted TLS, root/health/readiness/OpenAPI/docs200, TCP80/443 open и5432/8080 closed. Второго Apply не было; исторические failed runs не переписываются.

Ранний automatic tag run37754469953 отказал до successful first deployment; его не использовать как актуальное состояние. #22 VPS enable/bootstrap/deploy/dispatch не выполняла. Последующие новое release/deploy/bootstrap/reboot запрещены без согласования с оператором NikishGum.

[Эксплуатационная приёмка](hostinger-operations.md), [runbook/копии](runbook.md) и [требования защиты main](releases.md#защита-main-после-появления-checks): фактические VPS disk/backup/restore/reboot ещё открыты; main protection применена пользователем, branch API protected=true/четыре contexts (детальные параметры API403, подтверждены пользователем). CI main после #98 на `16a5c9d` success; работающий frozen runtime остаётся `0c22445`. Runtime compatibility release1 не проверена, manifest previous=null сохраняется. #22 open; документационный PR использует Refs #22, автоматического merge нет.
