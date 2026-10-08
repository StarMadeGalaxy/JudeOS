# CI, релизы и синтетический test (#22)

Это эксплуатация **main с каркасом #19 и интегрированной #20**. Вход и предметные операции здесь не реализуются; роли/RLS берутся из #20 без изменений. Только синтетические данные; контур не разрешает реальный пилот. [Локальная разработка](../../ops/README.md) остаётся отдельной и использует обычный `make up`, без обязательного host CA.

- [Синтетический HTTPS test](test-environment.md): внешний config, БД без host-порта, локальная проверка, параметры реального размещения.
- [Первый запуск на Hostinger](hostinger-first-run.md): точные команды для judopride.tech, опубликованный digest, preflight и внешние проверки.
- [Действующий baseline](second-synthetic-release.md): v0.1.0-test.2, pinned identifiers и фактические Apply/внешние проверки.
- [Эксплуатационная приёмка Hostinger](hostinger-operations.md): сверка критериев #22, read-only disk/HTTP, согласуемые backup/restore и reboot без смены baseline.
- [Первый опубликованный release](first-synthetic-release.md): v0.1.0-test.1, исторические identifiers/команды; старый VPS checkout сохраняется.
- [CI и релизы](releases.md): checks, commit/digest/schema, совместимость, защита main.
- [Диагностика и копии](runbook.md): health/readiness, время ответа, диск, проверка восстановления.
- [ADR 0009, предложено](../../planning/adr/0009-ci-test-releases.md) и [инфраструктура](../../planning/INFRASTRUCTURE.md).

На Hostinger VPS 187.7.69.230 **https://judopride.tech работает** на synthetic release v0.1.0-test.2/source0c224452/schema3. [Первый Apply](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37764403714) success; workflow остаётся failure из-за прежнего AAAA. После его удаления [независимая публичная проверка](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37765696629) success: trusted TLS/redirect/root/health/ready/OpenAPI/docs, 80/443 open и 5432/8080 closed. Второго Apply не было. [#98](https://github.com/StarMadeGalaxy/JudeOS/pull/98) merged, main16a5c9d/CI success; frozen checkout/manifest и оба tag сохранены. Пользователь включил main protection, branch API подтвердил protected=true/четыре contexts. Оператор — NikishGum; **backup/restore на VPS ещё требуют фактического результата**, новые deploy/bootstrap/release не нужны. CI использует принятую #20, схема 3 и отдельные bootstrap/migrator/runtime credentials. Production не развёрнут; реальные данные запрещены до #18/#24.

Оператор передал успешный VPS read-only check: релиз/schema3/DB isolation/HTTPS, free48389632000 из50884108288 bytes, Docker enabled/active. [Cloud compatibility release1](releases.md#предыдущий-совместимый-релиз) на схеме/fixtures release2 проверена после явного разрешения; working VPS не переключалась. Теперь нужен только фактический VPS backup/restore и ручная приёмка docs. Reboot — отдельный необязательный check, не разрешён/не выполнен.
