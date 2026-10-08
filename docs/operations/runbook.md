# Диагностика и синтетические копии

Все команды относятся к собственному test из [инструкции](test-environment.md). Credentials/config/dumps не публикуются. Host administration и уведомления оператору требуют выбранного ответственного; здесь нет выдуманного SLA, срока хранения или production доступа.

Для уже работающей VPS judopride.tech использовать [эксплуатационную приёмку Hostinger](hostinger-operations.md): точные pinned пути release2, read-only disk/HTTP и отдельное согласование backup/reboot с NikishGum. Примеры `/tmp` ниже относятся к disposable локальной среде, не предлагают повторный bootstrap общего test.

## Проверка состояния

```sh
python3 ops/test-stack.py --config /tmp/judeos-test/test.env status
python3 ops/test-probe.py --url https://localhost:8443 --ca /tmp/judeos-test/local-root.crt --disk-path /var/lib/docker
```

JSON содержит status и elapsed_ms `/healthz`, `/readyz`, `/`, `/openapi.json`, свободное/общее место на выбранном filesystem. Exit 1 — неверный status/TLS/network или нарушение **явно заданного** порога. Внешние origins используют унаследованный proxy; literal localhost/127.0.0.1/::1 проверяются локально, без отправки loopback-запроса во внешний proxy. TLS verification включена в обоих случаях. Скрипт не выводит password, response body или raw exception. Для публичного test CA-параметр не нужен. Измеряется клиентский round-trip, не серверная percentile-метрика; ошибки всех API-операций/нагрузка пока не измеряются. Raw access logging в Caddy не включено, чтобы не собирать query/credentials. Чувствительные тела/DSN не включать в будущие метрики/логи.

`--min-free-bytes N` задаёт согласованный оператором порог свободного места, без default SLA. Проверять filesystem Docker volumes, а не случайный host root. Можно запускать probe через выбранный scheduler/monitor; назначить получателя уведомлений и пороги после выбора host. Фоновое оповещение само по себе здесь не настроено. Health 200 означает процесс, readiness 200 — доступна БД текущей версии. Health 200/readiness 503 ожидаемы при недоступной/старой/новой БД; не направлять туда рабочий трафик.

| Симптом | Действие |
|---|---|
| HTTPS/TLS ошибка | Проверить DNS/порт/hostname/CA, Caddy state и outbound ACME; не отключать verification |
| health не 200 | Проверить API container/process и edge; status/restart причина через Docker |
| health 200, readiness 503 | DB health/сеть и версия схемы; проверить завершение migrator/seed, не повторять down/reset |
| миграция завершилась с ошибкой | Остановить rollout, исправить причину, повторить up; не править уже применённый SQL |
| диск заполнен | Проверить filesystem/volume и размеры logs/backups; удаление только по согласованной политике |
| копия отсутствует/устарела | Создать новую и проверить restore; возраст файла не доказывает целостность или RPO |

Для локальной диагностики `docker compose --env-file /tmp/judeos-test/test.env -f ops/test-compose.yaml logs --tail=100 api migrate seed edge`; не публиковать полные logs или Compose config без проверки содержимого. Ротация container logs/host retention выбирается оператором, не обещана по этому шаблону. Не менять пароль config поверх существующего DB volume без явной процедуры ротации.

## Копия и восстановление только synthetic

```sh
python3 ops/test-backup.py --config /tmp/judeos-test/test.env --output /tmp/judeos-synthetic.dump
python3 ops/test-probe.py --url https://localhost:8443 --ca /tmp/judeos-test/local-root.crt \
  --backup /tmp/judeos-synthetic.dump --max-backup-age-seconds YOUR_AGREED_THRESHOLD
```

CI задаёт 300 секунд только для проверки свежесозданного synthetic dump в одном job; это тестовый интервал, не срок хранения/RPO или эксплуатационный SLA.

Файл должен быть новым и вне checkout; output mode 0600. Backup использует `pg_dump -Fc`, затем создаёт собственную случайно названную restore DB, выполняет pg_restore с exit-on-error и сравнивает версию goose/число legacy fixtures, клубов, synthetic objects и audit events, после проверки удаляет **только эту DB**. Основная БД сохраняется. Выполнение backup должно быть отдельно согласовано с правами host/DB; в этом отдельном test pg_dump/restore выполняет только synthetic bootstrap administrator judeos_test. Runtime/migrator не получают backup/CREATEDB прав; новая LOGIN backup роль не выдумывается. Production права оператора выбираются отдельно.

Это минимальная проверка целостности копии синтетической основы #19/#20: сравнение количества строк не доказывает восстановление владельцев/RLS/продуктовых прав/финансов/Telegram. Нет внешних отправок и боевых ключей в test; реальные данные не импортируются. Имя/размер файла и его свежесть не гарантируют успешный restore. Незавершённый backup при ошибке нельзя считать годным. Частоту, место независимых копий, срок хранения, шифрование/доступ, RPO/RTO и получателя алертов выбрать до реального пилота. Hostinger test уже работает, но off-host backup и scheduler не настроены; [фактический VPS restore-check](https://github.com/StarMadeGalaxy/JudeOS/issues/22#issuecomment-6059425070) успешно выполнен оператором 8 октября 2026, dump0600/17381 bytes и его SHA256 записаны в [эксплуатационной приёмке](hostinger-operations.md#фактический-vps-backuprestore). На время сравнения согласовать отсутствие writes, иначе dump и число строк основной БД могут разойтись.

Проверенный synthetic dump можно удалить только по собственной выбранной политике disposable test; автоматическое удаление/retention не добавлено. Production restore требует отдельного runbook из [архитектуры §10](../../planning/ARCHITECTURE.md), включая запрет внешних отправок вне восстановленной БД, отзыв сессий/tokens, recovery epoch и сверку. Этот скрипт для production не подходит.

## Передача и rollout

Перед rollout записать source commit, image digest, schema/migration hashes, config project/host/domain без secrets и результат readiness. Сохранить совместимый предыдущий digest или явное «не установлен». Перед миграцией при нужных данных сделать проверенную независимую копию. Ошибка readiness останавливает rollout. Смена image в external test.env не является подтверждением совместимости; применять порядок из [релизов](releases.md). Не применять SQL down и не менять принятую схему вручную для старого binary.

## Восстановление доступа сотрудников (schema 4, #21)

До возобновления API после восстановления отозвать все восстановленные `access.sessions`, удалить `access.preauth`, в каждом trusted tenant context пометить `core.access_tokens.used=true` (audit actor/request обязательны). Проверить актуальные memberships/grants независимо от старого backup. Не запускать operator bootstrap при восстановлении автоматически. Команды operator migration credential выполнять в закрытом контуре; синтетический rehearsal не доказывает production recovery. [Access runbook](../access/README.md) содержит TTL/CLI/bootstrap/границы; schema 3 API не совместим с migration 4.
