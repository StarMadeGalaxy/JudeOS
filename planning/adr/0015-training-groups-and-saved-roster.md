# ADR0015 — Интервалы групп и сохранённый ручной состав

Статус: технический вариант согласован для реализации #29; независимый review PR114 ожидается. Дата:10 октября2026. Номер0014 оставлен отдельной финансовой #38. Стек и принятые people/access правила сохраняются.

## Контекст и источники

Athlete может состоять в нескольких группах, у группы/занятия несколько тренеров. Перевод не должен переписывать проведённое занятие. Выбор менеджером подтверждён отдельно: [6095132482](https://github.com/StarMadeGalaxy/JudeOS/issues/29#issuecomment-6095132482). Wire TRAINING-CONTRACT/OpenAPI зафиксирован8ff75fbd до реализации и разрешён пользователем: [6095187659](https://github.com/StarMadeGalaxy/JudeOS/issues/29#issuecomment-6095187659). Это не восстановление отсутствующих D26–D63 и не приёмка финального кода.

## Выбор

Training модуль владеет Venue/Discipline/Group, `[from,until)` Enrollment/GroupCoach и Session/roster/SessionCoach. Минимальное чтение Athlete выполняется в уже авторизованной tenant tx через people без контактов/Account. Назначение тренера использует существующий coach ClubMembership, а не Person/совпадение имени. Manual create сохраняет explicit selection и snapshot имён; текущие group periods лишь определяют regular/visit для выбранной строки. Изменение периодов/имён группы не синхронизирует сохранённые занятия.

Используется существующий access/people club lock21; текущие права и object assignment перечитываются после неё. Динамическое coach разрешение — trusted server callback внутри tx; не новый клиентский scope. Начальный список явно фильтруется по текущим SessionCoach. Все мутации используют родительскую версию, canonical typed hash и атомарный private result; people/training общий logical key проверяется под этой же lock, отдельно от metadata audit. SQL guards дополнительно блокируют overlap и изменение завершённой истории; RLS/FK остаются второй tenant границей.

## Альтернативы и последствия

Автоматическое обновление каждого roster при переводе разрушало бы историю и противоречило явному выбору менеджера. Один coach_id/group_id исключал бы разрешённую множественность. Доступ по GroupCoach выдавал бы занятия без SessionCoach. Полные people DTO в roster раскрывали бы лишние контакты. Только application проверки оставили бы SQL boundary без guards.

Club lock намеренно переиспользует текущий порядок блокировок и защищает отзыв/namespace одновременно; уменьшение гранулярности можно оценить по фактической нагрузке, это не обещание масштабирования. Manual selection ограничена техническим body16KiB/100 строк/20 тренеров, не продуктовыми лимитами клуба. Snapshot roster не является snapshot всего профиля Person: имя Athlete читается из профиля; participation/trial/exclusion и group/venue label сохранены. Новые UUID keyset каталоги и login-bound Session cursor не дают snapshot списка между страницами.

Миграция00012 добавляется после неизменённых00001–00011. Привилегированный SQL migrator остаётся доверенным оператором; аудит не tamper-proof. Production retention/recovery/deploy отдельно. #30–#33 и frontend#34 не объявляются реализованными. [Контракт](../../api/TRAINING-CONTRACT.md) и [проверки/границы](../../docs/training/README.md).
