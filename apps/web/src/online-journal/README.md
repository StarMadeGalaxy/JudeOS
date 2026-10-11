# Мобильный онлайн-журнал #34

Явная синтетическая демонстрация `/?demo=journal` в обычной сборке JudeOS, [PR116](https://github.com/StarMadeGalaxy/JudeOS/pull/116). Тренер открывает назначенные занятия и сохранённый состав; менеджер/администратор — расписание доступного клуба, разовый визит и исключение с историей. Администратор отдельно настраивает дату/время и тренеров конкретного занятия либо отменяет его. Реестр людей/семей, сетевые права, вход и восстановление остаются в прежнем App. [Согласованный точный diff навигации](https://github.com/StarMadeGalaxy/JudeOS/issues/29#issuecomment-6095593159); [границы #46/#39](https://github.com/StarMadeGalaxy/JudeOS/issues/34#issuecomment-6095940635).

Все имена/телефоны/ID в `fixtures.ts` вымышлены. Роль выбирается как учебная, а не как авторизация. Данные и результаты команд хранятся только в памяти вкладки: перезагрузка, явный сброс или смена учебной роли создают новую демонстрацию. Модуль не делает fetch, не читает/не пишет cookie и не использует localStorage, sessionStorage, IndexedDB или офлайн-очередь. Demo не получает session/tenant/token из App; ошибка live API не включает его. Любой непустой hash до или после открытия Demo переключает Entry в прежний App и оставляет его там после удаления hash.

## Принятый контракт и граница реализации

`contract/journal.openapi.json` — read-only subset общего OpenAPI из `9fc3267daadf2dcd79d67155dae8b97eb28aa72e`, в котором принятый контракт зафиксирован до зависимой UI-реализации. Транзитивные компоненты и 13 операций совпадают с исходником без локальных DTO/endpoint. `wire.d.ts` сгенерирован openapi-typescript7.13.0, `model.ts` использует его aliases. Внутренний `JournalAdapter` оборачивает эти операции; это не дополнительный HTTP-контракт. Общий контракт, документы и примеры обновлены вместе; Go/SQL/backend и миграции здесь не меняются.

| Операции | Использование |
| --- | --- |
| listAssignedSessions / getSessionJournal | Локальная дата Europe/Minsk, страницы с opaque cursor, snapshot сохранённого состава; manager/admin в своей области, coach по текущим назначениям |
| setAttendance | Четыре принятых статуса present/absent/sick/unmarked; независимая Attendance.version |
| closeSession | Session.version, предупреждение/число unmarked, без автоматического absent |
| createSessionGuest | Имя одной строкой, необязательный телефон, trial; постоянная карточка гостя и строка этого занятия без Account/семьи/Enrollment |
| listAthletes / addKnownRosterAthlete | Минимальный список только manager/admin; разовый visit не меняет постоянную группу |
| excludeRosterAthlete | Только manager/admin, сохраняет Attendance/историю, скрывает контакт/допуск и блокирует новые отметки |
| rescheduleSession / cancelSession | Только administrator; дата/время в том же зале и отдельная отмена; Session.version, operation_id, optional reason |
| getSessionCoaches / listStaff / setSessionCoaches | Чтение текущих назначений/истории и доступных тренеров; отдельное подтверждение administrator, после closed/cancelled только отзыв текущих назначений |

В main7219d0d list/get/addKnown/exclude/getSessionCoaches/setSessionCoaches уже реализованы в #29, listAthletes — в #27, listStaff — в #21; setAttendance/closeSession/createSessionGuest остаются planned для #31/#32. Новые rescheduleSession/cancelSession и серверное выравнивание createManualSession/setSessionCoaches относятся к #30. Full OpenAPI содержит77 операций, runtime72; будущие семантика administrator-only/reason не выдаются за реализованные: runtime `/docs` сохраняет точную прежнюю ревизию двух операций и схемы запроса из7219d0d. [Правила planned/legacy](../../../../api/SESSION-CONFIGURATION-CONTRACT.md). Этот модуль использует **только synthetic adapter**; живую интеграцию/транзакции/права проверяет #36. Реестр доступен отдельно через сохранённый RegistryPanel и `/?demo=people`.

**Настройка реализована в synthetic UI:** [ответы владельца10 октября2026](https://github.com/StarMadeGalaxy/JudeOS/issues/34#issuecomment-6098111977), [U2026-10-10-S1-34-CONFIG](../../../../planning/DECISIONS.md#настройка-конкретного-занятия-34--10-октября-2026). Только administrator меняет дату/время и тренеров одного занятия в том же зале либо отменяет его. Эти действия доступны в planned/in_progress, блокируются после closed/cancelled; причина — необязательное пояснение до500 символов. Дата и часы вводятся отдельными подписанными полями в Europe/Minsk; wire получает UTC, независимо от часового пояса браузера. Смена даты перечитывает расписание за новую дату; переход через полночь показывает обе даты. Время и тренеры подтверждаются отдельными командами с актуальной Session.version. Исправление отметок closed сохраняется. Настройка не меняет состав/Enrollment/GroupCoach/шаблоны/другие занятия; ID/исходный ключ/история/факты сохраняются. Manager продолжает видеть расписание и пользоваться остальными принятыми правами.

[Позднее уточнение владельца](https://github.com/StarMadeGalaxy/JudeOS/issues/34#issuecomment-6098369503): только administrator выбирает тренеров также при создании Session; он же отдельно отзывает назначение/доступ в closed/cancelled без добавления или замены тренеров. В форме выбора читаются точные StaffPage/SessionCoaches; недоступный read имеет явный повтор, 401/403/404 очищают прежние выбор и журнал. Новыми назначениями могут стать только active coach/assigned_sessions; прежние назначения доступны для снятия с сохранением истории. Конфликт перечитывает текущие назначения и требует нового явного выбора, unknown замораживает выбор/reason/UUID/body.

**Блокер wire снят:** владелец принял точное опубликованное предложение [d49d05a](https://github.com/StarMadeGalaxy/JudeOS/blob/d49d05a428d4a159b8b28fc322a0553f877f08df/apps/web/src/online-journal/SESSION-CONFIG-PROPOSAL.md): [источник принятия](https://github.com/StarMadeGalaxy/JudeOS/issues/34#issuecomment-6098890491). Канонический [контракт](../../../../api/SESSION-CONFIGURATION-CONTRACT.md) и [ADR0017](../../../../planning/adr/0017-session-configuration.md) приняты до UI; [исполнитель #29 уведомлён до shared правок](https://github.com/StarMadeGalaxy/JudeOS/issues/29#issuecomment-6099125525). Старый proposed JSON сохранён только как исторический материал и не импортируется UI. Полный синтетический объём #34 подготовлен для независимого review/ручной UX-приёмки в PR116; backend/шаблон/генерация #30 остаются отдельной работой. Swipes/notes из #86 остаются гипотезой; optional reason относится к конкретной команде настройки.

## Состояния команд

| Состояние | Поведение |
| --- | --- |
| sending | «Ожидаем подтверждения… Пока не сохранено». Намерение отдельно от подтверждённой отметки; один незавершённый command на спортсмена, один общий lock команд состава/закрытия/настройки занятия |
| подтверждённый результат | «Подтверждено в демонстрации». Успех памяти не называется серверным сохранением. После результата журнал перечитывается |
| unknown: разрыв/потерянный ответ/5xx | Команда могла быть принята. Только явный повтор того же operation_id, target, payload и base_version; новые записи для неё и смена контекста заблокированы |
| replay | Возвращённый старый результат не применяется поверх актуальной Attendance/Session. Успешный повтор подтверждается, затем читается свежий журнал, даже после закрытия/отмены собственной прежней командой |
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

Из корня checkout, Node24.19.x, Go1.27.1 для проверки маршрутов, установленный API/web (`npm ci --prefix api`, `npm ci --prefix apps/web`); системный Chromium или `JUDEOS_CHROMIUM_PATH`:

```sh
git show 9fc3267:api/openapi/openapi.yaml | node apps/web/src/online-journal/checks/contract-check.cjs
./apps/web/node_modules/.bin/tsc --target ES2022 --module commonjs --strict --skipLibCheck --outDir apps/web/src/online-journal/dist/adapter-tests apps/web/src/online-journal/synthetic-adapter.ts
node --input-type=commonjs -e 'require("node:fs").writeFileSync("apps/web/src/online-journal/dist/adapter-tests/package.json", JSON.stringify({type:"commonjs"}))'
node apps/web/src/online-journal/checks/adapter.test.cjs
npm --prefix apps/web run build
node apps/web/src/online-journal/checks/build-preview.mjs
./api/node_modules/.bin/playwright test -c apps/web/src/online-journal/checks/playwright.config.cjs
./api/node_modules/.bin/playwright test -c apps/web/src/online-journal/checks/navigation.config.cjs
./api/node_modules/.bin/playwright test -c apps/web/src/people-manager/checks/navigation.config.cjs
npm --prefix api run check
go build -mod=readonly -trimpath -o bin/api ./cmd/api
npm --prefix api run check:routes
```

Отдельный dev preview: `npm --prefix apps/web run dev -- --port 5179`, затем `/src/online-journal/preview.html?role=manager`. Его fault selector и `window.__journalFixture` предназначены только для тестов, отсутствуют в обычном Demo и его bundle. Preview собирается отдельно в игнорируемый `dist/preview`; обычная сборка не включает этот entry.

Axe4.11.0 устанавливается отдельно от shared package/lockfile. При запущенном preview:

```sh
npm install --prefix /tmp/judeos34-a11y --no-audit --no-fund axe-core@4.11.0
AXE_CORE_PATH=/tmp/judeos34-a11y/node_modules/axe-core/axe.min.js node apps/web/src/online-journal/checks/accessibility.cjs
```

Можно задать `JOURNAL_A11Y_URL` для проверки обычного собранного Demo. Проверяются16 состояний WCAG2A/AA/2.1AA/best-practice: расписание, mobile/desktop состав/четыре кнопки, guest/ошибка поля, выбор известного участника, закрытие, administrator journal, время/ошибка интервала/desktop/текст200%, тренеры/история, отмена и отзыв в closed. Screenshot390 — `dist/journal-mobile.png`; дополнительные viewport/desktop и формы — `dist/journal-mobile-viewport.png`, `dist/journal-desktop.png`, `dist/journal-time-mobile.png`, `dist/journal-coaches-mobile.png`, `dist/journal-time-desktop.png`, `dist/journal-time-enlarged-top.png`. Браузерные сценарии проверяют 320/390/768/1280, текст200%, reduced-motion, focus/Tab/Shift+Tab/Escape, независимость спортсменов, 401/403/404/5xx, потери ответа/повтор/конфликт, роли/контакты/историю, UTC с браузером America/New_York и отсутствие storage. Navigation suite проверяет обычную сборку и восемь initial/late fragment-путей; существующий navigation suite people-manager запускается отдельно как регрессия Entry.

Проверка11 октября2026: snapshot13 операций/всех DTO,23 adapter/schema,43 UI и20 navigation (10 журнала +10 прежнего people-manager) прошли; обычная web/TS и отдельная preview сборки, API check77 операций/119fixtures/runtime72 и Swagger Chromium прошли. После визуальной проверки увеличенного текста datetime-local разделён на дату/часы и устранено native ограничение max-width диалога; дата и часы видны при320/390 и тексте200%. Шесть затронутых keyboard/layout сценариев и все16 axe-состояний обычной сборки повторно прошли после исправления. Markdown15 файлов/171 локальный путь/fences и сохранность чужих APP-FLOWS/STATUS/принятых DECISIONS проверены. Routes проверяются в CI Web and contract: локальный `go` в этой среде не является Go-компилятором, поэтому локальный check:routes не выполнен. Diff, CI и независимое review актуального head фиксируются в Issue34/PR116 перед передачей.

Генерация snapshot выполняется явно из закреплённого commit; extract.cjs проверяет SHA256 исходника и не принимает другую main молча:

```sh
git show 9fc3267:api/openapi/openapi.yaml | node apps/web/src/online-journal/contract/extract.cjs
node api/node_modules/openapi-typescript/bin/cli.js apps/web/src/online-journal/contract/journal.openapi.json -o apps/web/src/online-journal/contract/wire.d.ts
```

Эти проверки — UI/схемы и mocked auth. Они не доказывают live API/RLS/CSRF, SQL-конкуренцию, фактические права/отзыв, реальные устройства iOS/Android или пригодность пилота. Synthetic adapter не реализует server security. RD-01–11, #24/production/restore и #36 остаются отдельными; merge #110 не разрешает реальные данные. VPS, release, секреты и рабочие тома не меняются.
