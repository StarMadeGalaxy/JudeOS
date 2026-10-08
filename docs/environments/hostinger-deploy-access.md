# Доступ к VPS и автоматизация синтетического test

Обновлено 8 октября 2026. Задача [#91](https://github.com/StarMadeGalaxy/JudeOS/issues/91), техническое предложение — [ADR 0010](../../planning/adr/0010-restricted-vps-deployment-access.md). [Inventory VPS](hostinger-vps.md) и #88/PR #90 уже в main. Release/test-инструменты и эксплуатация остаются [#22](https://github.com/StarMadeGalaxy/JudeOS/issues/22); [первый actual rollout](https://github.com/StarMadeGalaxy/JudeOS/issues/91#issuecomment-6058208908) выполнен #91 после принятия #22/95 и #91/96. HTTPS, redirect и внешние закрытые порты БД подтверждены; оставшиеся protection/ops/restore ведёт #22.

## Проверенные пользователем вводные

Через консоль Hostinger пользователь предоставил: Ubuntu 24.04 LTS, Docker 29.8.2, Compose v5.6.0. `ss -lntp` для TCP 80/443 показал пустой список на момент проверки. Это не подтверждает работающий HTTPS на VPS. Домен `judopride.tech` назначен IP `187.7.69.230`; пользователь сообщил об автоматическом выпуске SSL, но текущие issuer, TLS termination и renewal неизвестны. Новый Nginx/Angie/Envoy для выбранного запуска не требуется: в #22 пользователь выбрал Caddy/public ACME после preflight; существующий сертификат нельзя считать автоматически подключённым к будущему контейнеру.

Публичный SSH ED25519 fingerprint, полученный пользователем из `/etc/ssh/ssh_host_ed25519_key.pub`:

```text
SHA256:+eOshfW+q1dZVPC0oUvA5DJPEFJTDcPkOYQHpKvPrdA
```

Это отпечаток SSH, а не SSL. Позднее пользователь установил bootstrap, reload-нул SSH и проверил подключение с Mac: `ok:true`, Ubuntu 24.04/x86_64, Docker29.8.2/Compose5.6.0, TCP listener только22, adapter false. SSH-порт 22 подтверждён этой проверкой. Источник — DECISIONS U2026-10-07-VPS-04 / [комментарий #91](https://github.com/StarMadeGalaxy/JudeOS/issues/91#issuecomment-6045440734). Это не подключение агента или работающий HTTPS. Полный host key закреплён пользователем на Mac и передан в GitHub Environment test-vps; actual pinned Actions preflight37764172815 прошёл. SSH key/Variables уже настроены; их значения не выводятся. Последующий внешний public check37765696629 подтвердил первый HTTPS test, подробности — в [runbook](hostinger-release2.md).

## Что получит ключ

[install.py](../../ops/deploy-access/install.py) создаёт `judeos-deploy`, корневую собственность его home/authorized_keys, отдельный OpenSSH Match и единственное sudo-разрешение на root-owned [controller.py](../../ops/deploy-access/controller.py). Пользователь не состоит в Docker/sudo, не может менять ключи/контроллер и не получает обычную оболочку, SFTP/SCP, TTY или forwarding. Другие SSH-пользователи и firewall не изменяются. Root/admin-доступ пользователя сохраняется для установки и восстановления.

Home `/var/lib/judeos-deploy` остаётся root-owned `0755`: OpenSSH должен читать
публичный `.ssh/authorized_keys` от имени ограниченного пользователя. Home и ключи
для него недоступны на запись; private state files — `0600`, config/secrets —
`0700`/`0600`. `0700` на самом home закрывает key login после активации; enable
теперь сохраняет исходный режим установщика. Регрессионная проверка выполняет
actual activation и новую real OpenSSH connection, затем проверяет запрет записи
home и чтения private state. Для уже установленного release2 коррекция описана в
[продолжении установки](hostinger-release2.md#4-восстановление-ssh-для-опубликованного-release2).

Контроллер принимает `check` либо точный tagged/digest `deploy` из раздела 6. `check` возвращает разрешённые поля ОС/архитектуры, версии Docker/Compose и наличие TCP-слушателей на 22/80/443/5432/8080. Порты в результате не говорят об их доступности извне. Переменные, raw errors, docker inspect/logs и секреты не выдаются.

`deploy` без активации закрыт с `release_adapter_unconfigured`: SSH установщик не создаёт policy, адаптер активирует оператор отдельно после release gate. Подготовленный root-owned адаптер запускает приложение с полномочиями Docker/root; это существенная административная capability, даже при ограниченной оболочке. Её включение требует ревью интеграции #22, а не просто установки ключа. Не выдавайте аккаунту членство Docker или произвольный sudo для обхода этого ограничения.

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

Сначала ревью PR #92 (Issue #91); до merge используйте его опубликованную ветку `feat/91-vps-deploy-access`. Здесь root выполняет только настройку доступа, приложение не запускается:

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

Environment **test-vps** уже обнаружен GitHub REST. На момент проверки deployment branch policy отсутствует. Чтение Secrets/Variables и изменение policy этим агентом запрещены HTTP 403 `Resource not accessible by integration`; наличие ключа/переменных не подтверждено. Пользователь сообщил, что пока проверил только Mac. Настройте Environment в [Settings → Environments](https://github.com/StarMadeGalaxy/JudeOS/settings/environments): Deployment branches and tags → Selected branches and tags → branch `main`. Для выбранных автоматических обновлений required reviewer не обязателен; ручное ревью изменений кода остаётся обычным PR-процессом.

На Mac со своим авторизованным `gh` передайте ключ прямо в GitHub, не выводя содержимое:

```bash
set -euo pipefail
gh api user --jq .login
access_dir="$HOME/.ssh/judeos-test"
test -f "$access_dir/id_ed25519"
test -f "$access_dir/known_hosts"
gh secret set JUDEOS_VPS_SSH_KEY --repo StarMadeGalaxy/JudeOS --env test-vps \
  < "$access_dir/id_ed25519"
gh variable set JUDEOS_VPS_HOST --repo StarMadeGalaxy/JudeOS --env test-vps --body '187.7.69.230'
gh variable set JUDEOS_VPS_PORT --repo StarMadeGalaxy/JudeOS --env test-vps --body '22'
gh variable set JUDEOS_VPS_KNOWN_HOSTS --repo StarMadeGalaxy/JudeOS --env test-vps \
  < "$access_dir/known_hosts"
```

Используйте ранее проверенный pin: не создавайте новый через непроверенный `ssh-keyscan`. Private key не передавать в чат. Если `gh` на Mac ещё не авторизован, `gh auth login --web` использует браузер; агенту токен не нужен.

[#91 workflow preflight](../../.github/workflows/vps-preflight.yml) получает Environment credentials только при ручном запуске на `main`. После ревью/merge #92:

```bash
gh workflow run vps-preflight.yml --repo StarMadeGalaxy/JudeOS --ref main
gh run list --repo StarMadeGalaxy/JudeOS --workflow vps-preflight.yml --limit 3
```

Этот check подтверждает канал Actions → VPS и ничего не запускает. [Шаблон](../../ops/deploy-access/github-preflight.yml) сохранён для чтения; активный файл уже подготовлен в `.github/workflows`, но до merge на default branch ручной запуск недоступен. Environment Secrets не становятся доступными этому чату.

## 5. Как дать прямой доступ агенту

Сейчас среда этого агента имеет restricted network, VPS отсутствует в разрешённых направлениях, SSH credential не подключена. Проверка с Mac и GitHub Secrets это не меняют. Прямому агенту нужны защищённо подключённый файл ключа, проверенный known_hosts и поддерживаемое разрешение TCP к `187.7.69.230:22`/HTTPS к `judopride.tech`. Не передавайте значения через чат/Git, не отключайте proxy/TLS/host-key verification и не обходите сетевую политику.

Для этого workflow достаточно GitHub-hosted runner: после настройки Environment агент может инициировать согласованный workflow через GitHub API без чтения private key и без прямого SSH из облачной среды. Пользователь сохраняет root-консоль Hostinger как административный канал восстановления.

## 6. Включить release adapter после интеграции #22

**Для уже начатой установки используйте [точное продолжение release2](hostinger-release2.md).**
PR #95/#96 merged; v0.1.0-test.2 опубликован из source0c224452 с обоими fixes.
Сначала разбирается failed auto Apply/state/lock/containers, затем оператор
получает новый checkout/manifest в отдельных versioned paths. Старый setup,
checkout и manifest не обновляются/не патчатся. Enable и первый dispatch остаются
отдельными этапами; до успешного VPS checker и явного user operator-enable
подтверждения запуск запрещён. Команды ниже — общий интерфейс для новой установки,
**не команды продолжения существующей VPS**.

Пользователь ранее получил
`v0.1.0-test.1`, проверил manifest, чистый checkout `a546194` и GHCR pull.
Docker29.8.2/containerd возвращает registry manifest digest в `.Id`; этот source
содержит прежние checker/adapter. [PR #95](https://github.com/StarMadeGalaxy/JudeOS/pull/95)
merged и предоставляет строгий helper; исправление adapter #91 использует его
из принятого baseline. [Согласованный контракт и порядок](https://github.com/StarMadeGalaxy/JudeOS/issues/91#issuecomment-6055948993).
Исправленный release2 ещё требует фактической проверки на VPS; до неё не
выполнять следующие enable/dispatch команды. Старые tag/manifest и существующий
`/srv/judeos-test` не патчить. Первый dispatch выполняет
только владелец #91 после явного подтверждения operator enable пользователем;
#22 не запускает параллельный bootstrap. Ниже описан общий интерфейс установки.

Пользователь выбрал автоматические обновления **после успешного CI и публикации релиза, если миграции не изменились** (DECISIONS U2026-10-07-VPS-AUTO). Подготовительный [PR #89](https://github.com/StarMadeGalaxy/JudeOS/pull/89) merged в main `b091312` с `Refs #22`; #22 остаётся открытой до фактических результатов. Он предоставляет CI/tag/GHCR/manifest и public Caddy/test-stack. #92 добавляет транспорт, root adapter и workflow; PR #92 объединяется вручную после ревью. До интеграции #92 и первого реального published release приложение не объявляется развёрнутым. На момент проверки GitHub Releases пусты; выпускать первый тег и выбирать номер версии следует после интеграции кода, по release runbook #22.

Не нужен отдельный Nginx/Angie/Envoy: пользователь выбрал Caddy/public ACME в #22 после повторного preflight. Перед первым запуском оператор проверяет отсутствие чужих listeners/контейнеров на 80/443, DNS A/AAAA, доступность inbound 80/443, TLS ownership/renewal, свободный диск и ресурсы. SSH административный канал сохранить, PostgreSQL/API 5432/8080 публично не открывать. Docker-published ports требуют проверки Docker/firewall и снаружи, одной настройки UFW недостаточно. Чужие сервисы/сертификаты не удалять.

1. По [runbook #22](../operations/hostinger-first-run.md) получить **реальный published release.json**, создать root-owned `/srv/judeos-test` на точном `source_commit` в актуальной `origin/main`, выполнить release identity check. В `/var/lib/judeos-test-release/release.json` хранится публичный manifest. На сервере используется готовый digest, приложение не собирается. Не подставлять вымышленный tag/digest.
2. Получить в существующем root setup checkout принятый код #92. Каталог не сбрасывать при чужих/локальных изменениях:

```bash
set -euo pipefail
test -z "$(git -C /root/judeos-deploy-setup status --porcelain)"
git -C /root/judeos-deploy-setup fetch origin main
git -C /root/judeos-deploy-setup checkout --detach origin/main
python3 /root/judeos-deploy-setup/ops/deploy-access/enable-release.py \
  --checkout /srv/judeos-test \
  --manifest /var/lib/judeos-test-release/release.json
```

[enable-release.py](../../ops/deploy-access/enable-release.py) — root-команда оператора. Она повторяет published/tag/CI gate, проверяет accepted clean checkout, запрещает доступные для записи не-root файлы/родителей (включая Git config/hooks), фиксирует SQL/schema baseline и копирует reviewed controller/entry/gate/adapter. Новый `/srv/judeos-test-config` создаётся через #22 `test-env.py`: public Caddy, проект `judeos-hostinger-test`, domain `judopride.tech`, ports 80/443, secrets 0600/каталог 0700. Уже существующие secrets/config не перегенерируются; их соответствие проверяется при deploy. Policy `/etc/judeos-deploy/release.json` root 0600 записывается последней. Команда не запускает приложение, не меняет ключ/SSH rule, повтор при уже включённой policy отказывает. Новый SSH reload не нужен: ForceCommand использует тот же путь обновлённого entry.

3. С Mac повторить `client.py check`: теперь ожидается `release_adapter_installed:true` (этот флаг означает наличие файлов, а успешный deploy — их фактическую проверку). Выполнить первый dispatch с настоящим опубликованным тегом:

```bash
read -r -p 'Опубликованный CI-verified release tag: ' RELEASE_TAG
gh workflow run vps-deploy.yml --repo StarMadeGalaxy/JudeOS --ref main \
  -f "release_tag=$RELEASE_TAG"
gh run list --repo StarMadeGalaxy/JudeOS --workflow vps-deploy.yml --limit 3
```

Первый автоматический CI event может прийти до установки adapter/credentials и безопасно завершиться ошибкой; после настройки используйте этот manual dispatch. Зафиксировать run URL, release tag/commit/digest/schema, безопасные результаты в #91/#22. Только фактический successful deploy с внешним check подтверждает размещение. После него следующие опубликованные CI-релизы обновляются автоматически.

### Что проверяет автоматический workflow

[workflow](../../.github/workflows/vps-deploy.yml) использует `workflow_run: CI completed`: публикация через `GITHUB_TOKEN` обычно не запускает новый `release` workflow. Job допускает successful tag push из этого репозитория либо ручной dispatch на `main`; код транспорта берётся из main commit, не из недоверенного PR. [release-gate.py](../../ops/deploy-access/release-gate.py) требует опубликованный release.json, tag→manifest commit, ancestry в main, именно workflow `ci.yml` и успешные jobs текущей попытки `Go`, `Web and contract`, `Migrations`, `Image and HTTPS`, `Publish tagged release`. Проверяется fixed repository/digest/platform/rebuild/schema/hash metadata; skipped publish, fork/PR CI и заменённый tag отвергаются. Это сверка GitHub/OCI identity, не криптографически подписанная provenance.

SSH grammar — `deploy vMAJOR.MINOR.PATCH[-prerelease] sha256:<64 hex>`, без shell evaluation/paths/commands. Старый `deploy sha256:...` сохранён для первоначального baseline tag; для нового релиза требуется явный tag. [apply-release](../../ops/deploy-access/apply-release) на сервере повторяет gate, сравнивает schema version и **полный набор SQL-хешей** с root-owned policy до pull/config update. Изменённые миграции, неизвестный текущий image, dirty/изменённый baseline checkout, неподходящий public config, writable secrets, чужой image identity или более старый/diverged source прекращают операцию.

После pull adapter вызывает `verifier.verify_image_identity(data, docker='/usr/bin/docker')`
из проверенного root-owned **baseline** `ops/test-release-check.py`. Docker classic
проверяет config ID прямо; containerd принимает только exact registry manifest ID
и SHA256 фактического config blob из локального `docker image save`. Manifest
digest не заменяет ожидаемый `local_image_id`; несовпадение config hash, platform
или OCI source/version останавливает операцию до записи state/config и `up`.
Helper наследует очищенное root-approved окружение (proxy/CA сохраняются),
не получает код из candidate release и не выводит config/layers или raw errors.
Root lock и сериализация продолжают охватывать всю проверку и запуск.

При неизменной схеме adapter меняет только `TEST_IMAGE`, сохраняет server credentials/config/volumes/Caddy material и вызывает **замороженный baseline** `test-stack.py up`, затем HTTPS `check`. Автообновление не скачивает/не исполняет новые server-side скрипты из очередного tag. Изменение ops baseline/SQL требует отдельного рассмотрения оператором; policy не переписывается автоматически. Отсутствие SQL-изменений ограничивает rollout, но не доказывает полной совместимости бизнес-поведения; readiness/внешний check обязательны, предыдущий совместимый релиз пока не установлен.

Environment job и root `flock` сериализованы; `cancel-in-progress:false`, adapter в отдельной session удерживает lock fd при потере SSH/controller. Повторное подключение не запускает второй deploy, пока первый работает. Actions timeout/ошибка SSH не означает остановленный серверный процесс: сначала оператор проверяет state/процессы, затем повторяет. Raw stdout/stderr root adapter скрыты. `/var/lib/judeos-deploy/status.json` root 0600 хранит allowlisted attempted/successful image/source/tag и phase; при сбое после update остаётся `applying`, а не ложный success. Не очищать volume, не выполнять автоматический downgrade/rollback БД. Для диагностики оператор использует status и runbook #22 через отдельный admin channel; перед публикацией logs исключает credentials.

[public-check.py](../../ops/deploy-access/public-check.py) из внешнего runner требует DNS только на предоставленный IPv4 (неожиданный AAAA требует проверки), HTTP→HTTPS redirect, TLS/hostname verification, 200 web/health/readiness/OpenAPI/Swagger и корректные health/readiness bodies. TCP контрольные 80/443 доступны, 5432/8080 недоступны с этого runner; это сопоставляется с Docker network/bindings/firewall на сервере и не доказывает закрытие всех маршрутов.

### Proxy, TLS и registry credentials на сервере

Controller не принимает среду SSH. Если VPS использует proxy/дополнительную CA/приватный registry, оператор отдельно создаёт root-owned `/etc/judeos-deploy/server.env` mode 0600. Разрешены только `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, lowercase варианты, `SSL_CERT_FILE`, `SSL_CERT_DIR`, `DOCKER_CONFIG`, `GH_TOKEN`; формат `NAME=value`, без shell evaluation. GH_TOKEN необязателен для публичных GitHub API и не передаётся Compose. Не хранить секреты в policy/Git. Docker daemon proxy/TLS и registry login конфигурируются оператором отдельно: env клиента не меняет daemon. Не отключать verification; дополнительная public CA подключается явно к нужному клиенту/daemon. Обычный `make up` не требует host CA, дополнительный build CA остаётся опциональным `BUILD_CA_PATH`.

#91 остаётся открытой до Actions access/deploy и внешнего результата. #22 отдельно завершает реальный release/VPS/protection/эксплуатационные проверки. Оператор test — @NikishGum по источнику #22; реальные данные/production/сроки/RPO/RTO этим не согласованы, до #18/#24 используется только synthetic.

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

Для облачного HTTPS-прокси build допускает явный публичный CA `--secret id=build_ca,src=/etc/ssl/certs/ca-certificates.crt`; proxy/TLS verification сохраняются. Локальные тесты проверяют настоящий OpenSSH и sudo, tag grammar/lock после потери controller, gate и adapter на synthetic API/command fixtures (без реального GHCR/VPS), host-key mismatch, отказ оболочки/TTY/forwarding/SFTP, повтор bootstrap, грамматику команды, root ownership/policy, lock и скрытие raw errors. Успех этих тестов не означает установленного доступа, TLS, release или deployment на Hostinger.

## Независимая публичная проверка без нового deploy

[vps-public-check.yml](../../.github/workflows/vps-public-check.yml) выполняет только
[public-check.py](../../ops/deploy-access/public-check.py) с фиксированными
`187.7.69.230` / `judopride.tech`: DNS exact IP, HTTP→HTTPS redirect, TLS verification,
HTTP200 для root/health/readiness/OpenAPI/docs и закрытые TCP5432/8080. Он не использует
SSH, Environment test-vps, секреты, Docker или deploy. Проверка запускается на PR,
затрагивающем checker/этот workflow, и вручную после появления workflow в main.
Это позволяет повторить внешний probe после успешного Apply без повторного Apply.

При ошибке checker выдаёт нейтральный code (DNS/TLS/HTTP/timeout/port), для DNS mismatch
— публичные resolved addresses, для port mismatch — результаты соединения. Raw
исключения, URL/headers/body и proxy errors не выводятся; критерии и TLS не ослаблены.
Успешный Apply и неуспешный внешний probe записываются отдельно; app/volumes не
удаляются, deploy-job не перезапускается ради проверки HTTPS.
