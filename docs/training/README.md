# Группы и ручные занятия

Backend #29 / [PR114](https://github.com/StarMadeGalaxy/JudeOS/pull/114) реализует залы, направления, группы, Enrollment/GroupCoach с интервалами и ручные Session с явными roster/SessionCoach. Пользователь согласовал wire до кода; независимая приёмка финального PR ожидается. [Контракт](../../api/TRAINING-CONTRACT.md), [OpenAPI](../../api/openapi/openapi.yaml), [реестр](../../api/ENDPOINTS.md), [ADR0015](../../planning/adr/0015-training-groups-and-saved-roster.md).

## Рабочий порядок

1. Manager создаёт Venue/Discipline и Group в разрешённом клубе. Account спортсмену не требуется; Person/Athlete создаются принятым people API. Имена не уникальные идентификаторы.
2. Enrollment задаёт Athlete/Group и UTC Z `[valid_from,valid_until)`, GroupCoach — действующий coach membership/Group и такой же период. Null конец открыт. Несколько групп и тренеров разрешены; пересечение одной и той же связи внутри группы запрещено. Команда end завершает открытый период; история не переписывается.
3. Manager читает Group/version и явно выбирает спортсменов, trial и coach membership IDs. POST sessions передаёт group_base_version и выбор в массивах. Это подсказки по интервалам, а не автоматическое включение всей группы. В одной транзакции создаются planned Session/version1, snapshot имён Group/Venue, строки roster и назначения. Athlete, зачисленный на starts_at, получает regular; известный без Enrollment — visit, существующий guest — guest.
4. Перевод — явный end прежнего Enrollment и создание нового; другие группы автоматически не прекращаются. Уже созданные прошлые и будущие roster не пересчитываются. Для изменения текущего занятия используют отдельные versioned команды.
5. Coach читает только занятия с текущим SessionCoach и действующим club coach grant. GroupCoach не даёт доступа. Coach может временно добавить известного Athlete как visit; менеджер исключает, оставляя строку excluded. Coach не исключает, не меняет группы/назначения и не создаёт ручное занятие. Отдельный GET/PUT coaches доступен административным ролям; PUT сохраняет историю снятых назначений. Для closed/cancelled разрешён только отзыв, не добавление coach.

Перед командой нужен текущий вход, CSRF и exact HTTPS Origin. После неизвестного результата повторяют прежние operation_id/payload; после терминального409 версии перечитывают объект и выбирают новый ID. Повтор возвращает сохранённый результат, поэтому клиент перечитывает текущие данные. Replay не обходит отзыв права, чужую ссылку, архив Athlete, недопустимое состояние или исключение строки. Один operation_id одного actor/клуба нельзя использовать и в people, и в training.

## Доступ и PostgreSQL

Runtime schema12; добавлена только миграция00012 после неизменённых00001–00011. На training таблицах ENABLE/FORCE RLS, составные tenant FK; runtime не имеет DELETE, DDL, доступа к аудиту, UPDATE времени/state занятия или постоянных полей roster. Invoker triggers под parent row lock запрещают пересечение/восстановление законченных периодов, повторное включение excluded и roster/add coach после завершения. Metadata audit пишет только ID/actor/request/action/type/time; private operation results хранятся отдельно. Production TTL/retention/recovery epoch не определяются этим срезом (#18/#24/#52).

Application service использует общую access/people club advisory lock, после ожидания перечитывает текущие права, затем SessionCoach/ссылки/state/version/ключ. Серверный object authorizer допускает coach к конкретному объекту, клиентский assigned boolean отсутствует. Список фильтруется по актуальным назначениям на каждой странице; HMAC cursor связан с текущим входом/actor/tenant/date Europe/Minsk. Чужой клуб403, чужой/неназначенный объект404 без версии или данных. Administrator клуба не становится network owner; явный owner/platform сохраняют принятые границы #27.

## Запуск и проверка

В изолированном синтетическом контуре: `make env install build db-up bootstrap migrate` с Go из `.go-version`, затем `make run`. Игнорируемый .env/пароли не передаются в чат и не коммитятся. API использует текущую схему, startup не запускает миграции. PostgreSQL18.3 закреплён compose; рабочий VPS/release/manifest не изменяется. Rollout/backup/restore отдельно #24, эта инструкция не является поручением deploy.

`make check` проверяет Go race/vet, OpenAPI/примеры/TS и настоящий chi tree; `JUDEOS_CHROMIUM_PATH=/usr/bin/chromium npm --prefix api run check:swagger` — отображение полного контракта. Эти проверки не доказывают права/конкуренцию БД. Для настоящего API/PostgreSQL:

```sh
JUDEOS_TEST_RESPONSE_FILE=/tmp/judeos-training-responses.jsonl make check-db
cd api
JUDEOS_TEST_RESPONSE_FILE=/tmp/judeos-training-responses.jsonl npm run check:postgres-responses
```

check-db создаёт одноразовую БД и удаляет её в finally. Реальные LOGIN мигратора/runtime, trusted TLS httptest без отключения проверки сертификата, только синтетические клубы/сотрудники/спортсмены. JSONL — приватный временный файл0600, не артефакт для публикации: содержит тестовые auth DTO. Используйте новый путь для отдельного evidence-run.

Проверены upgrade11→12 с прежним accountless Person и повторный migrate; весь прежний access/people/recovery набор; все22 новых операции и четыре принятых journal/roster операции через HTTPS→PostgreSQL. История после перевода и архива, два клуба, нескольких coaches, role union, запреты coach, ключи/replay, версии, SQL RLS/FK/grants/guard/audit. Две реальные конкурентные POST с одной base_version дают200/409; одинаковый operation_id даёт два200 и одну строку/результат/INSERT audit. Контролируемый SQL отзыв SessionCoach под той же блокировкой заставляет ожидающий HTTP writer перечитать назначение и вернуть404 без эффекта. Это HTTP/DB interleaving evidence; отзыв в этом конкретном race выполнен fixture SQL, не HTTP endpoint. Обычный отзыв через PUT coaches и club revoke проверен отдельно через HTTP.

Отдельная проверка453 настоящих ответов58 операций против runtime OpenAPI включает прежние модули, а не только training.106 AJV fixtures/примеры и Swagger/TS остаются отдельным схемным evidence.

## Границы

До #31 Attendance в roster — только unrecorded projection unmarked/version0/null автор/время; таблицы/команд записи и закрытия здесь нет. Состояния closed/cancelled для запретов создаются мигратором только в тестовой БД, это не реализация закрытия/отмены. #30 расписание/шаблоны/генерация/перенос/отмена, #32 новый гость/дубли, #33 допуск/контакты, #34 интерфейс журнала, #36 общая интеграция остаются отдельными. Optional contact/admission не выдумываются. Нового manager UI нет; wire доступен для согласованной независимой #34. Физические мобильные устройства и judopride.tech этим срезом не проверялись.
