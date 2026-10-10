# Мобильный онлайн-журнал #34

Явная синтетическая демонстрация `/?demo=journal` в обычной сборке JudeOS, [draft PR116](https://github.com/StarMadeGalaxy/JudeOS/pull/116). Тренер открывает назначенные занятия и сохранённый состав; менеджер/администратор — расписание доступного клуба, разовый визит и исключение с историей. Реестр людей/семей, сетевые права, вход и восстановление остаются в прежнем App. [Согласованный точный diff навигации](https://github.com/StarMadeGalaxy/JudeOS/issues/29#issuecomment-6095593159); [границы #46/#39](https://github.com/StarMadeGalaxy/JudeOS/issues/34#issuecomment-6095940635).

Все имена/телефоны/ID в `fixtures.ts` вымышлены. Роль выбирается как учебная, а не как авторизация. Данные и результаты команд хранятся только в памяти вкладки: перезагрузка, явный сброс или смена учебной роли создают новую демонстрацию. Модуль не делает fetch, не читает/не пишет cookie и не использует localStorage, sessionStorage, IndexedDB или офлайн-очередь. Demo не получает session/tenant/token из App; ошибка live API не включает его. Любой непустой hash до или после открытия Demo переключает Entry в прежний App и оставляет его там после удаления hash.

## Контракт и открытый блокер

`contract/journal.openapi.json` — read-only subset принятой main `7219d0d9703de08fb9779ba1c215cf7a60cd16db` после merge #112/#114. Транзитивные компоненты и восемь операций совпадают с исходным OpenAPI без локальных DTO/endpoint. `wire.d.ts` сгенерирован openapi-typescript7.13.0, `model.ts` использует его aliases. Внутренний `JournalAdapter` оборачивает существующие операции; это не дополнительный HTTP-контракт. Shared OpenAPI/SQL/backend не меняются, миграция для UI не нужна.

| Операции | Использование |
| --- | --- |
| listAssignedSessions / getSessionJournal | Локальная дата Europe/Minsk, страницы с opaque cursor, snapshot сохранённого состава; manager/admin в своей области, coach по текущим назначениям |
| setAttendance | Четыре принятых статуса present/absent/sick/unmarked; независимая Attendance.version |
| closeSession | Session.version, предупреждение/число unmarked, без автоматического absent |
| createSessionGuest | Имя одной строкой, необязательный телефон, trial; постоянная карточка гостя и строка этого занятия без Account/семьи/Enrollment |
| listAthletes / addKnownRosterAthlete | Минимальный список только manager/admin; разовый visit не меняет постоянную группу |
| excludeRosterAthlete | Только manager/admin, сохраняет Attendance/историю, скрывает контакт/допуск и блокирует новые отметки |

На этой main list/get/addKnown/exclude уже реализованы в #29, listAthletes — в #27; setAttendance/closeSession/createSessionGuest остаются planned для #31/#32. Этот модуль использует **только synthetic adapter**; живую интеграцию/транзакции/права проверяет #36. Реестр доступен отдельно через сохранённый RegistryPanel и `/?demo=people`.

**Подтверждённая цель настройки:** [ответы владельца10 октября2026](https://github.com/StarMadeGalaxy/JudeOS/issues/34#issuecomment-6098111977), [U2026-10-10-S1-34-CONFIG](../../../../planning/DECISIONS.md#настройка-конкретного-занятия-34--10-октября-2026). Только administrator меняет дату/время и тренера одного занятия в том же зале либо отменяет его. Эти действия доступны до начала и во время, блокируются после closed/cancelled; причина — необязательное пояснение. Исправление отметок closed сохраняется. Настройка не меняет состав/Enrollment/GroupCoach/шаблоны/другие занятия; ID/исходный ключ/история/факты сохраняются. Manager продолжает видеть расписание и пользоваться остальными принятыми правами. Это ещё не реализация этих действий.

[Позднее уточнение владельца](https://github.com/StarMadeGalaxy/JudeOS/issues/34#issuecomment-6098369503): только administrator выбирает тренеров также при создании Session; он же отдельно отзывает назначение/доступ в closed/cancelled без добавления или замены тренеров. [Предложение общего API](SESSION-CONFIG-PROPOSAL.md) и [отдельный proposed OpenAPI](contract/session-configuration.proposed.openapi.json) готовы для прямого согласования владельцем. Они не импортируются UI и не изменяют действующий общий wire/runtime; новые DTO/пути не объявляются принятыми.

**Полный объём #34 ещё не завершён:** у настройки времени/отмены нет принятого wire. [Исполнитель #29 подтвердил принадлежность #30](https://github.com/StarMadeGalaxy/JudeOS/issues/29#issuecomment-6095593159); [#30](https://github.com/StarMadeGalaxy/JudeOS/issues/30) остаётся отдельной backend-работой. Пользователь10 октября2026 подтвердил «Контракт ещё не принят», затем решил согласовать его напрямую. Предложение выше включает ограничения createManualSession/setSessionCoaches и отдельный отзыв в closed/cancelled; бизнес-ответ коллеги не требуется вместо решения владельца. В расписании действия явно недоступны; proposed DTO/пути не объявлены существующими/принятыми, UI/общий API/серверные права не изменены. До принятия общего wire, реализации UI и проверки PR116 остаётся draft/In progress; Closes #34 допустим только вместе с полным объёмом после ручной приёмки. Номер будущего PR #30 не подставляется в Merge after. Swipes/notes из #86 остаются гипотезой и отсутствуют в этом UI; reason не превращён в новую функцию заметок.

## Состояния команд

| Состояние | Поведение |
| --- | --- |
| sending | «Ожидаем подтверждения… Пока не сохранено». Намерение отдельно от подтверждённой отметки; один незавершённый command на спортсмена |
| подтверждённый результат | «Подтверждено в демонстрации». Успех памяти не называется серверным сохранением. После результата журнал перечитывается |
| unknown: разрыв/потерянный ответ/5xx | Команда могла быть принята. Только явный повтор того же operation_id, target, payload и base_version; новые записи для неё и смена контекста заблокированы |
| replay | Возвращённый старый результат не применяется поверх актуальной Attendance. Успешный повтор подтверждается, затем читается свежий журнал |
| Attendance conflict | Показаны текущий статус и свой выбор. «Оставить текущую» перечитывает без новой команды; «Сохранить мой выбор» перечитывает и отправляет новый UUID с текущей версией |
| Session conflict | Сначала перечитать; потом отдельно подтвердить действие новым UUID/версией |
| read failure после ack | Команда уже подтверждена, её форма закрывается. Повтор не нужен; новые записи заблокированы до успешного чтения |
| 401/403/404 | Журнал, контакты и старые результаты скрыты; fixture fallback отсутствует |
| offline | Записи/повторы запрещены. Очередь и постоянное локальное сохранение появятся только в S4 |

Пример принятого PUT-body (ID синтетический):

```json
{
  "operation_id": "00000000-0000-4000-8000-000000009001",
  "base_version": 0,
  "status": "present"
}
```

После неизвестного результата повторяется **этот же** body. После сохранённого конфликта и явного выбора пользователя создаётся новый operation_id с перечитанной base_version. Unrecorded `unmarked/version0` имеет null автор/время; явная команда `unmarked` получает version>=1 и сохраняет историю. Закрытие не преобразует ни один unmarked в absent. Исправления активных отметок в closed доступны всем разрешённым ролям; изменение состава в closed/cancelled запрещено. Not_admitted не мешает фиксировать фактическое присутствие. Однофамильцы различаются ID/участием/trial, не объединяются. Отзыв контакта не выбирает запасной телефон.

## Воспроизведение проверок

Из корня checkout, Node24.19.x, установленный API/web (`npm ci --prefix api`, `npm ci --prefix apps/web`); системный Chromium или `JUDEOS_CHROMIUM_PATH`:

```sh
git show 7219d0d:api/openapi/openapi.yaml | node apps/web/src/online-journal/checks/contract-check.cjs
./apps/web/node_modules/.bin/tsc --target ES2022 --module commonjs --strict --skipLibCheck --outDir apps/web/src/online-journal/dist/adapter-tests apps/web/src/online-journal/synthetic-adapter.ts
node --input-type=commonjs -e 'require("node:fs").writeFileSync("apps/web/src/online-journal/dist/adapter-tests/package.json", JSON.stringify({type:"commonjs"}))'
node apps/web/src/online-journal/checks/adapter.test.cjs
npm --prefix apps/web run build
node apps/web/src/online-journal/checks/build-preview.mjs
./api/node_modules/.bin/playwright test -c apps/web/src/online-journal/checks/playwright.config.cjs
./api/node_modules/.bin/playwright test -c apps/web/src/online-journal/checks/navigation.config.cjs
npm --prefix api run check
```

Отдельный dev preview: `npm --prefix apps/web run dev -- --port 5179`, затем `/src/online-journal/preview.html?role=manager`. Его fault selector и `window.__journalFixture` предназначены только для тестов, отсутствуют в обычном Demo и его bundle. Preview собирается отдельно в игнорируемый `dist/preview`; обычная сборка не включает этот entry.

Axe4.11.0 устанавливается отдельно от shared package/lockfile. При запущенном preview:

```sh
npm install --prefix /tmp/judeos34-a11y --no-audit --no-fund axe-core@4.11.0
AXE_CORE_PATH=/tmp/judeos34-a11y/node_modules/axe-core/axe.min.js node apps/web/src/online-journal/checks/accessibility.cjs
```

Можно задать `JOURNAL_A11Y_URL` для проверки обычного собранного Demo. Проверяются WCAG2A/AA/2.1AA/best-practice: расписание, mobile/desktop состав/четыре кнопки, guest/ошибка поля, выбор известного участника, предупреждение закрытия. Screenshot390 — `dist/journal-mobile.png`; дополнительные viewport/desktop — `dist/journal-mobile-viewport.png`/`dist/journal-desktop.png`. Браузерные сценарии проверяют 320/390/768/1280, текст200%, reduced-motion, focus/Tab/Shift+Tab/Escape, независимость спортсменов, 401/403/404/5xx, потери ответа/повтор/конфликт, роли/контакты/историю и отсутствие storage. Navigation suite проверяет обычную сборку и восемь initial/late fragment-путей; существующий navigation suite people-manager запускается отдельно как регрессия Entry.

Проверка10 октября2026: snapshot восьми операций/всех DTO, 10 adapter/schema, 22 UI и 20 navigation (10 новых +10 прежних) прошли. Обычная web/TS и отдельная preview сборки, API check75 операций/106fixtures прошли. После просмотра mobile screenshot header изолирован от глобального flex; web/preview сборки, четыре layout/enlarged/reduced-motion и семь axe состояний обычной сборки (включая desktop) прошли. Markdown3файла/41локальный путь/fences и diff check прошли. [Результаты, источник блокера и запрос review](https://github.com/StarMadeGalaxy/JudeOS/issues/34#issuecomment-6097502039); CI/независимое review актуального head публикуются в Issue34/PR116.

Генерация snapshot выполняется явно из закреплённого commit; extract.cjs проверяет SHA256 исходника и не принимает другую main молча:

```sh
git show 7219d0d:api/openapi/openapi.yaml | node apps/web/src/online-journal/contract/extract.cjs
node api/node_modules/openapi-typescript/bin/cli.js apps/web/src/online-journal/contract/journal.openapi.json -o apps/web/src/online-journal/contract/wire.d.ts
```

Эти проверки — UI/схемы и mocked auth. Они не доказывают live API/RLS/CSRF, SQL-конкуренцию, фактические права/отзыв, реальные устройства iOS/Android или пригодность пилота. Synthetic adapter не реализует server security. RD-01–11, #24/production/restore и #36 остаются отдельными; merge #110 не разрешает реальные данные. VPS, release, секреты и рабочие тома не меняются.
