# Доступ к VPS и автоматизация синтетического test

Обновлено 7 октября 2026. Задача [#91](https://github.com/StarMadeGalaxy/JudeOS/issues/91), техническое предложение — [ADR 0010](../../planning/adr/0010-restricted-vps-deployment-access.md). [Inventory VPS](hostinger-vps.md) и #88/PR #90 уже в main. Контейнеры, первый релиз и реальное размещение остаются [#22 / draft PR #89](https://github.com/StarMadeGalaxy/JudeOS/pull/89).

## Проверенные пользователем вводные

Через консоль Hostinger пользователь предоставил: Ubuntu 24.04 LTS, Docker 29.8.2, Compose v5.6.0. `ss -lntp` для TCP 80/443 показал пустой список на момент проверки. Это не подтверждает работающий HTTPS на VPS. Домен `judopride.tech` назначен IP `187.7.69.230`; пользователь сообщил об автоматическом выпуске SSL, но текущие issuer, TLS termination и renewal неизвестны. Новый Nginx/Angie/Envoy не требуется для установки SSH-доступа. Выбор и установка прокси — #22 после preflight; существующий сертификат нельзя считать автоматически подключённым к будущему контейнеру.

Публичный SSH ED25519 fingerprint, полученный пользователем из `/etc/ssh/ssh_host_ed25519_key.pub`:

```text
SHA256:+eOshfW+q1dZVPC0oUvA5DJPEFJTDcPkOYQHpKvPrdA
```

Это отпечаток SSH, а не SSL. Полный публичный host key ещё нужно получить и сверить. SSH-порт не предоставлен; в командах ниже 22 — пример, подтвердите фактический порт в консоли:

```bash
/usr/sbin/sshd -T | awk '$1 == "port" {print}'
```

## Что получит ключ

[install.py](../../ops/deploy-access/install.py) создаёт `judeos-deploy`, корневую собственность его home/authorized_keys, отдельный OpenSSH Match и единственное sudo-разрешение на root-owned [controller.py](../../ops/deploy-access/controller.py). Пользователь не состоит в Docker/sudo, не может менять ключи/контроллер и не получает обычную оболочку, SFTP/SCP, TTY или forwarding. Другие SSH-пользователи и firewall не изменяются. Root/admin-доступ пользователя сохраняется для установки и восстановления.

Контроллер принимает только `check` либо `deploy sha256:<64 lowercase hex>`. `check` возвращает разрешённые поля ОС/архитектуры, версии Docker/Compose и наличие TCP-слушателей на 22/80/443/5432/8080. Порты в результате не говорят об их доступности извне. Переменные, raw errors, docker inspect/logs и секреты не выдаются.

`deploy` пока закрыт с `release_adapter_unconfigured`: адаптер приложения и release policy установщик не создаёт. Будущий root-owned адаптер запускает приложение с полномочиями Docker/root; это существенная административная capability, даже при ограниченной оболочке. Её включение требует ревью интеграции #22, а не просто установки ключа. Не выдавайте аккаунту членство Docker или произвольный sudo для обхода этого ограничения.

## 1. Создать ключ на своей машине

Выполнить на личной машине с OpenSSH, не на VPS и не в публичном CI-логе:

```bash
umask 077
access_dir="$HOME/.ssh/judeos-test"
mkdir -p "$access_dir"
test ! -e "$access_dir/id_ed25519"
ssh-keygen -t ed25519 -N '' -C judeos-test-deploy -f "$access_dir/id_ed25519"
cat "$access_dir/id_ed25519.pub"
```

Приватный файл без passphrase предназначен для автоматизации; защищается ограничениями сервера и хранилища. В консоль VPS/Hostinger передаётся только строка `.pub`. Приватный ключ не отправлять в чат, Issue, Git или Docker Manager Compose. Для прямого агента рекомендуется отдельный ключ: повтор установки заменяет действующий public key, не добавляет второй незаметно.

## 2. Установить ограниченный аккаунт на VPS

Сначала ревью PR #91; до merge используйте его опубликованную ветку `feat/91-vps-deploy-access`. Здесь root выполняет только настройку доступа, приложение не запускается:

```bash
apt-get update
apt-get install -y git python3 sudo openssh-client
# Если каталог уже существует, не перезаписывайте его слепым clone/reset.
git clone --branch feat/91-vps-deploy-access --single-branch \
  https://github.com/StarMadeGalaxy/JudeOS.git /root/judeos-deploy-setup
nano /root/judeos-deploy.pub
# Вставить только строку ssh-ed25519 из id_ed25519.pub, сохранить файл.
python3 /root/judeos-deploy-setup/ops/deploy-access/install.py \
  --public-key /root/judeos-deploy.pub
/usr/sbin/sshd -t && systemctl reload ssh
```

При отсутствии GitHub-доступа с VPS передайте проверенные файлы из PR административным каналом. Не используйте `curl | sh`. Установщик не отключает проверку TLS, не переустанавливает Docker и не перезапускает приложение. Держите консоль Hostinger открытой до успешного key-login. При ошибке SSH Include/Match он восстанавливает прежний собственный SSH-файл и не reload-ит ssh; частично созданный аккаунт/каталоги могут остаться. После проверки причины администратором можно повторить установку (не удалять неизвестные конфигурации).

## 3. Зафиксировать host key и проверить доступ

На своей машине с checkout PR #91, после подтверждения SSH-порта:

```bash
access_dir="$HOME/.ssh/judeos-test"
vps_port=22  # заменить, если sshd сообщил другой порт
ssh-keyscan -T 10 -p "$vps_port" -t ed25519 187.7.69.230 > "$access_dir/host.scan"
python3 ops/deploy-access/pin-host.py \
  --scan "$access_dir/host.scan" --host 187.7.69.230 --port "$vps_port" \
  --fingerprint 'SHA256:+eOshfW+q1dZVPC0oUvA5DJPEFJTDcPkOYQHpKvPrdA' \
  --output "$access_dir/known_hosts"
python3 ops/deploy-access/client.py \
  --host 187.7.69.230 --port "$vps_port" \
  --identity "$access_dir/id_ed25519" --known-hosts "$access_dir/known_hosts" check
```

`ssh-keyscan` сам не устанавливает доверие: [pin-host.py](../../ops/deploy-access/pin-host.py) сравнивает ключ с отпечатком из проверенной консоли и не пишет файл при несовпадении. Existing known_hosts не перезаписывается. После переустановки VPS/смены host key повторно подтвердите новый fingerprint через консоль, сохраните источник и замените pin явно. Не использовать `StrictHostKeyChecking=no`.

Firewall Hostinger/Ubuntu должен разрешать фактический SSH-порт из выбранного канала. Не закрывайте текущий административный доступ без проверенной альтернативы. Правила доступа/firewall сейчас не менялись; GitHub-hosted runner не имеет гарантированного одного статического IPv4. Для строгой адресной фильтрации нужен отдельно выбранный runner/канал со стабильным исходящим адресом; произвольно открывать SSH всем не требуется этой инструкцией.

## 4. Подключить GitHub Actions

Создать Environment **test-vps** в [настройках репозитория](https://github.com/StarMadeGalaxy/JudeOS/settings/environments), ограничить deployment branch `main`, настроить required reviewers, если доступно на используемом тарифе. Если protection недоступен, не считать ручной approval настроенным. Включение первого workflow выполнять после ревью кода на main.

В Environment Variables установить:

| Имя | Значение |
|---|---|
| `JUDEOS_VPS_HOST` | `187.7.69.230` |
| `JUDEOS_VPS_PORT` | Проверенный SSH-порт |
| `JUDEOS_VPS_KNOWN_HOSTS` | Содержимое проверенного `known_hosts` из шага 3, публичный ключ |

Из своей машины передать private key напрямую в Environment Secret, не выводя его:

```bash
gh secret set JUDEOS_VPS_SSH_KEY --repo StarMadeGalaxy/JudeOS --env test-vps \
  < "$HOME/.ssh/judeos-test/id_ed25519"
```

Готовый [github-preflight.yml](../../ops/deploy-access/github-preflight.yml) — шаблон workflow **проверки доступа**, а не релиза. После согласования он копируется в `.github/workflows/vps-preflight.yml` через обычную ветку/PR. Пока лежит вне `.github`, Actions его не запускает. Он допускает только ручной запуск на main, читает клиент из конкретного main commit, получает secret только в Environment job, проверяет pinned host и удаляет временные файлы ключа. События PR и произвольная shell-команда не поддерживаются. Секреты в runner не означают, что они доступны этому чату.

## 5. Как дать прямой доступ агенту

Сейчас среда этого агента имеет restricted network, VPS отсутствует в разрешённых направлениях, SSH credential не подключена. Изменение настроек GitHub Secrets это не меняет. Для прямого `client.py check` потребуется:

1. В конфигурации среды агента предоставить секрет защищённым способом, например `JUDEOS_VPS_SSH_KEY`; значение не передавать через чат или репозиторий. Настроить read-only файл ключа или запись из секретной переменной в временный файл с mode 0600 без вывода значения.
2. Через поддерживаемую настройку среды разрешить TCP к `187.7.69.230:<проверенный порт>`; для проверок приложения — HTTPS к `judopride.tech`. HTTP allowlist сама по себе не подтверждает доступ SSH/TCP. Если такой настройки нет, использовать GitHub Actions или отдельную согласованную среду со связностью; не обходить proxy/политику маршрутов.
3. Подключить проверенный known_hosts и повторно проверить readiness credential/сетевую политику выбранной среды, затем выполнить тот же `client.py check`.

Ключ Environment Actions остаётся в GitHub; агент может инициировать согласованный workflow через GitHub API, когда шаблон установлен на main, без чтения private key. Для этого не требуется прямое SSH-соединение из облачной среды агента. Полный deployment job добавляется после согласования #22; preflight не запускает приложение.

## 6. Завершение автоматического деплоя вместе с #22

Предложенный transport-контракт: root устанавливает `/etc/judeos-deploy/release.json` с фиксированным `repository` и `/usr/local/lib/judeos-deploy/apply-release`. Их файлы и каждый родитель должны принадлежать root и не быть доступны для записи группе/остальным; symlink отклоняется. SSH-пользователь не может загружать или менять адаптер/policy. Контроллер принимает digest и передаёт адаптеру ровно один аргумент `<repository>@sha256:<digest>`, выполняет его под чистым окружением с единой блокировкой. stdout/stderr адаптера скрыты; доступны нейтральные коды результата. Proxy и серверные credentials при необходимости загружает адаптер из администратором проверенной защищённой конфигурации, а не из среды SSH.

До включения адаптера согласовать с #22:

- источник разрешённого опубликованного release/digest и проверку его CI/происхождения; любой произвольный digest в нужном registry не становится одобренным релизом;
- точные пути server-owned конфигурации, bootstrap/migrate/seed/runtime, расположение образа и проверку совместимости схемы; credentials остаются на сервере;
- текущий proxy/HTTPS и renewal, внешний health/readiness по `https://judopride.tech`, закрытые API/БД-порты;
- foreground completion/отмену и границы lock, нейтральную диагностику, действия при прерванном запуске; адаптер не должен отпускать блокировку до окончания операций;
- триггер после успешного CI/публикации main release, Environment protection, concurrency `cancel-in-progress: false`; автоматическое применение допустимо только проверенного релиза и после согласованного включения.

Адаптер и deployment job здесь не установлены: #22 пока draft. Первый запуск может выполнить администратор по её проверенным командам; #91 не требует закрыть #22 прежде, чем дать SSH preflight. Не использовать dev `make up` как публичный deploy. Нет обещания автоматического rollback БД/первого предыдущего совместимого релиза. Оператор, реальные права/сроки/копии/RPO/RTO не назначены; только синтетические данные до #18/#24.

## Отзыв и проверки

Для немедленного отзыва deploy-ключа через административную консоль:

```bash
: > /var/lib/judeos-deploy/.ssh/authorized_keys
```

Это блокирует новые key-logins, но не останавливает уже работающий controller/adapter. Текущее выполнение сначала оценивает администратор; не убивайте миграции и не сбрасывайте тома слепо. Для ротации повторить install.py с новым public key, затем заменить секрет выбранного канала и проверить доступ. Root-owned конфигурация/marker остаются; блокировка password через `passwd -l` сама по себе не гарантирует отзыв public key.

Проверка в одноразовом контейнере Ubuntu 24.04 (без подключения к реальной VPS/БД):

```bash
docker build -f ops/deploy-access/test.Dockerfile -t judeos-deploy-access:test .
docker run --rm --network none judeos-deploy-access:test
```

Для облачного HTTPS-прокси build допускает явный публичный CA `--secret id=build_ca,src=/etc/ssl/certs/ca-certificates.crt`; proxy/TLS verification сохраняются. Локальный тест проверяет настоящий OpenSSH и sudo, host-key mismatch, отказ оболочки/TTY/forwarding/SFTP, повтор bootstrap, грамматику команды, root ownership/policy, lock и скрытие raw errors. Успех этих тестов не означает установленного доступа, TLS, release или deployment на Hostinger.
