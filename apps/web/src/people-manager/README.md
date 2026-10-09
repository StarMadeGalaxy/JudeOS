# Интерфейс менеджера людей и семей — #28

Mobile-first модуль для [Issue #28](https://github.com/StarMadeGalaxy/JudeOS/issues/28): **явная синтетическая демонстрация в памяти**, включённая в обычную web-сборку по адресу `/?demo=people`. В рабочем пространстве administrator/manager выбранного клуба есть отдельная ссылка на неё. Существующий живой RegistryPanel остаётся доступным. Общие auth/API/сеть/платформа, SQL и релизы сохранены.

[PR #111](https://github.com/StarMadeGalaxy/JudeOS/pull/111) принят и merged; актуальная main77f2546 объединена в ветку #28. Минимальный patch main.tsx согласован [исполнителем #27 до редактирования](https://github.com/StarMadeGalaxy/JudeOS/issues/27#issuecomment-6085778355), включая переход в прежний App при первоначальном или новом fragment приглашения/reset/join/recovery. После потребления fragment App остаётся смонтированным; автоматического возврата к fixtures нет. Новый модуль не получает token. Независимые review и UX-приёмка [PR #113](https://github.com/StarMadeGalaxy/JudeOS/pull/113) остаются условиями завершения #28; live интеграционная приёмка — #36.

## Запуск и проверяемое поведение

Из корня репозитория, Node 24.19.x:

```sh
npm --prefix apps/web ci
npm --prefix api ci
npm --prefix apps/web run dev -- --port 5178
```

Откройте [демонстрацию в приложении](http://127.0.0.1:5178/?demo=people); «← К приложению» возвращает к обычному входу. [Отдельный test preview](http://127.0.0.1:5178/src/people-manager/preview.html) содержит fault controls/window.__peopleFixture, которых нет в Demo обычной сборки. Это отдельный явный адрес; ошибка настоящего API никогда не включает fixtures. Состояние сбрасывается при обновлении страницы, данные/команды/токены не сохраняются в localStorage, sessionStorage или IndexedDB. Синтетические даты рассчитываются относительно фиксированного `2026-10-09T12:00:00Z`; поля времени показывают **Минск**, wire — UTC с Z. Контакты/личные сведения, реальные аккаунты и медицинские документы вводить нельзя.

- «Люди»: самостоятельные профили с полным именем и необязательным телефоном; Account не требуется. Одинаковые имена остаются отдельными записями. Спортивное участие regular/guest создаётся отдельным действием, без автоматического зачисления в группу.
- «Спортсмены»: изменение вида участия, отдельная ручная проверка представителя с основанием и периодом, отзыв связи, выбор/снятие одного основного контакта. Семья/номер телефона не подтверждают представительство. Истёкшая/будущая/отозванная связь недоступна для выбора; контакт исчезает без fallback, в том числе при наступлении конца периода в открытой карточке. Номер может отсутствовать.
- «Семьи»: название, создание пустой семьи, добавление отдельных людей с периодом `[from, until)`, завершение открытого периода и сохранённая история. Семья не даёт доступ или GuardianLink. Окончание уже заданного периода изменить нельзя. Архива/восстановления семьи нет; active/all не создают скрытых правил фильтрации по наличию членов.
- Архив Person/Athlete требует отдельного подтверждения последствий. Архив человека очищает телефон, архивирует его Athlete и отзывает связанные представительства/контакты; архив Athlete оставляет Person. Имя, стабильные ID и разрешённая история сохраняются. Независимые рабочие права Account не выводятся из профиля и не отзываются по совпадению имени. Unarchive/DELETE отсутствуют.
- Поиск — буквальная подстрока имени/названия; UUID keyset, `items/next_cursor`, кнопка «Показать ещё» добавляет строки. Поиск/фильтр сбрасывают cursor. Телефоны и связи не попадают в список. Total/offset/номер страницы/снимок списка не обещаются.

На уровне UI есть загрузка, пустой список/поиск/архив/семья, ошибки полей и периода, 401/403/404/503, конфликт версии и неизвестный ответ. При неизвестном результате заморожены исходные ID/target/payload/base_version и поля формы; разрешён явный повтор **той же** команды. При 409 нужно перечитать карточку, проверить состояние и заново оформить действие с новым operation_id. Verify перечитывает родительский Athlete перед следующей командой; add/end используют версию Household. Успех памяти явно отличается от серверного подтверждения. Симулятор однократных ошибок расположен отдельно под «Проверка состояний демонстрации».

Rubik с кириллицей 400/500/600/700 и существующие tokens.css загружены локально; основной текст 16 px, действия от48 px, подписи/ошибки полей связаны через label/aria-describedby, статусы объявляются текстом. При открытии карточки/формы фокус переходит на заголовок, при возврате — на исходную карточку. Действия доступны без жестов. Ширины320–1280, увеличенный текст и reduced-motion проверяются отдельно от физических устройств.

## Источник wire и границы адаптера

Согласование **до редактирования**: [ответ исполнителя #27](https://github.com/StarMadeGalaxy/JudeOS/issues/27#issuecomment-6083937359), [подтверждение #28](https://github.com/StarMadeGalaxy/JudeOS/issues/28#issuecomment-6084045489). Первоначальное согласование разрешало fixtures до приёмки backend; последующая приёмка/merge111 проверена отдельно. [FRONTEND-HANDOFF](https://github.com/StarMadeGalaxy/JudeOS/blob/94be7babf4779b81ae72e05a1572566ce3277491/docs/people/FRONTEND-HANDOFF.md) описывает разделение файлов и19 операций.

`contract/registry.openapi.json` — механически извлечённые19 операций и транзитивные `$ref` из [фиксированного snapshot880e1f2](https://github.com/StarMadeGalaxy/JudeOS/blob/880e1f2bcffaa4101d00fa1ccc65734b3f55bd76/api/openapi/openapi.yaml). Статусы implemented внутри копии относятся к серверу #27, принятому через111; сам fixture-adapter HTTP-сервером не является. Единственный источник схем — тот OpenAPI; новые DTO не проектируются. `wire.d.ts` генерируется openapi-typescript; model.ts даёт алиасы сгенерированных схем и внутренний UI-port без нового HTTP API. Snapshot никогда не выдаётся через runtime `/openapi.json` и не меняет общую схему.

Повторная генерация из Git (ветка #27 должна быть fetched):

```sh
git fetch origin feat/27-people-registry
node apps/web/src/people-manager/contract/extract.cjs
api/node_modules/.bin/openapi-typescript apps/web/src/people-manager/contract/registry.openapi.json -o apps/web/src/people-manager/contract/wire.d.ts
```

`PeopleManager` принимает явно переданные `RegistryAdapter`, название выбранного клуба и clock. Реализован только `SyntheticAdapter`; он не делает fetch, не проверяет настоящую сессию и не выдаёт права. Будущий live adapter должен использовать актуальный общий клиент #27/CSRF/Origin, серверные проверки каждого запроса, сброс контекста при смене клуба/выходе и отдельную интеграционную приёмку [#36](https://github.com/StarMadeGalaxy/JudeOS/issues/36). Значение mode не является доказательством авторизации. В main.tsx только согласованные Entry/lazy import и ссылка в прежней области registry; api.ts/style.css/RegistryPanel.tsx/NetworkPanel.tsx сохранены. Автоматической подмены живого UI/ошибок этим модулем нет.

Симулятор воспроизводит только согласованные сценарии UI: проекции страниц, версии родителей, периоды, архив/историю, текущий основной контакт, замороженный повтор и отказ/конфликт. Он **не заменяет** PostgreSQL транзакции, RLS, tenant FK, audit, CSRF, роли/сеть/платформу, реальную идемпотентность/конкуренцию, ограничения JSON и производственное хранение/erasure. Тестовые history/clock/fault controls доступны только в явном preview. Физические iOS/Android, live API и VPS этим модулем не проверялись.

## Проверки

Из корня; browser checks требуют работающий dev server выше либо запускают его сами:

```sh
npm --prefix apps/web run build
node apps/web/src/people-manager/checks/build-preview.mjs
node --test apps/web/src/people-manager/checks/adapter.test.cjs
api/node_modules/.bin/playwright test -c apps/web/src/people-manager/checks/playwright.config.cjs
api/node_modules/.bin/playwright test -c apps/web/src/people-manager/checks/navigation.config.cjs
```

На принятой main0e793f2 повторно проверены web/preview сборки, adapter5 и актуальный API53/runtime46/81fixtures/TS. Все19 операций и их транзитивные схемы извлечённого snapshot структурно совпадают с OpenAPI принятой main. Обычный web build проверяет TypeScript и собирает lazy Demo. Navigation checks запускают Vite preview именно этой собранной версии: десять сценариев проверяют изоляцию demo от API/storage, сброс при reload, отсутствие тестовых controls, возврат к App, ссылку по прежним ролям, отсутствие fallback при401/403/503 и восемь путей fragment (invite/reset/join/recovery при загрузке и после открытия demo). Auth-ответы перехвачены синтетическими mocks, это не live серверные права. Отдельный build-preview собирает саму демонстрацию в игнорируемый `dist/preview` внутри модуля. Пять adapter tests проверяют request/response всех19 операций через AJV по извлечённому OpenAPI, страницы/однофамильцев/архив, семейные периоды, GuardianLink/контакт, повтор/устаревание/отказ и версии родителей. Пять Playwright scenarios проверяют UI/клавиатуру/формы/страницы/ошибки/повтор, отсутствие `/api` запросов и storage. Снимки320/390/768/1280 сохраняются в игнорируемый `dist/` модуля.

Дополнительная проверка axe-core4.11.0 не добавляет зависимость в общие package/lockfiles:

```sh
npm install --prefix /tmp/judeos28-a11y --no-audit --no-fund --ignore-scripts axe-core@4.11.0
AXE_CORE_PATH=/tmp/judeos28-a11y/node_modules/axe-core/axe.min.js node apps/web/src/people-manager/checks/accessibility.cjs
# Для собранного приложения запустите Vite preview на5180 и проверьте те же пять состояний:
# node apps/web/node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 5180
PEOPLE_MANAGER_A11Y_URL="http://127.0.0.1:5180/?demo=people" AXE_CORE_PATH=/tmp/judeos28-a11y/node_modules/axe-core/axe.min.js node apps/web/src/people-manager/checks/accessibility.cjs
```

Проверяется мобильный список, форма человека, контакты/представительство, форма проверки и семейные периоды (WCAG2A/AA/2.1AA и best-practice). Автоматические проверки не заменяют human UX/review и реальную интеграцию. Общие workflows/пакеты не меняются; дополнительные checks запускаются явными командами, их прохождение не приписывается автоматически существующей CI.
