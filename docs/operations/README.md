# CI, релизы и синтетический test (#22)

Текущая main содержит **основу #19/#20 и access #21, schema4**; [вход/HTTPS/права](../access/README.md). Документы опубликованных release1/release2 сохраняют свои исторические source/schema3. Журнал main ещё planned, его мобильный прототип имитирует сервер. Только синтетические данные; контур не разрешает реальный пилот. [Локальная разработка](../../ops/README.md) остаётся отдельной и использует обычный `make up`, без обязательного host CA.

- [Приёмка S0 #25](s0-acceptance.md): свежие изолированные проверки main4 и upgrade3→4, команды и границы доказательств.
- [Условия реальных данных #18](real-data-conditions.md): открытые обязательные решения, варианты данных/хранения/оператора/эксплуатации/пилота; [ADR 0012, предложено](../../planning/adr/0012-real-data-pilot-conditions.md). Реальные данные не разрешены, реализация production/restore остаётся #24.
- [Синтетический HTTPS test](test-environment.md): внешний config, БД без host-порта, локальная проверка, параметры реального размещения.
- [Первый запуск на Hostinger](hostinger-first-run.md): точные команды для judopride.tech, опубликованный digest, preflight и внешние проверки.
- [Действующий baseline](second-synthetic-release.md): v0.1.0-test.2, pinned identifiers и фактические Apply/внешние проверки.
- [Эксплуатационная приёмка Hostinger](hostinger-operations.md): сверка критериев #22, read-only disk/HTTP, согласуемые backup/restore и reboot без смены baseline.
- [Первый опубликованный release](first-synthetic-release.md): v0.1.0-test.1, исторические identifiers/команды; старый VPS checkout сохраняется.
- [CI и релизы](releases.md): checks, commit/digest/schema, совместимость, защита main.
- [Диагностика и копии](runbook.md): health/readiness, время ответа, диск, проверка восстановления.
- [ADR 0009, предложено](../../planning/adr/0009-ci-test-releases.md) и [инфраструктура](../../planning/INFRASTRUCTURE.md).

На Hostinger VPS 187.7.69.230 **https://judopride.tech работает** на synthetic release v0.1.0-test.2/source0c224452/schema3. [Первый Apply](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37764403714) success; workflow остаётся failure из-за прежнего AAAA. После его удаления [независимая публичная проверка](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37765696629) success: trusted TLS/redirect/root/health/ready/OpenAPI/docs, 80/443 open и 5432/8080 closed. Второго Apply не было. [#98](https://github.com/StarMadeGalaxy/JudeOS/pull/98) merged, main16a5c9d/CI success; frozen checkout/manifest и оба tag сохранены. Пользователь включил main protection, branch API подтвердил protected=true/четыре contexts. Оператор — NikishGum; [backup/isolated restore на VPS подтверждён](https://github.com/StarMadeGalaxy/JudeOS/issues/22#issuecomment-6059425070), новые deploy/bootstrap/release не нужны. Опубликованный release2 использует принятую #20, schema3 и отдельные bootstrap/migrator/runtime credentials; текущий CI/main используют schema4. Production не развёрнут; реальные данные запрещены до #18/#24.

Оператор передал успешный VPS read-only check: релиз/schema3/DB isolation/HTTPS, free48389632000 из50884108288 bytes, Docker enabled/active. [Cloud compatibility release1](releases.md#предыдущий-совместимый-релиз) на схеме/fixtures release2 проверена после явного разрешения; working VPS не переключалась. VPS backup/isolated restore успешно выполнен оператором; #22 закрыта после приёмки/merge PR #97; дополнительные VPS команды в #25 не выполняются. Reboot — отдельный необязательный check, не разрешён/не выполнен.
