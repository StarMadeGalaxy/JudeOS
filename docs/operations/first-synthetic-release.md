# Первый synthetic test release: v0.1.0-test.1

8 октября 2026 опубликован настоящий GitHub prerelease из принятой main после PR #89/#92. Это synthetic test, не production. [Передача #91](https://github.com/StarMadeGalaxy/JudeOS/issues/91#issuecomment-6053570291) фиксирует единственный порядок: получение/проверка → operator enable → первый запуск адаптером #91. #22 остаётся открытой для фактических результатов.

| Идентификатор | Проверенное значение |
|---|---|
| Tag | `v0.1.0-test.1` |
| Source commit | `a54619410aeb1d397bb65b73459785978973c667` |
| GitHub Release | https://github.com/StarMadeGalaxy/JudeOS/releases/tag/v0.1.0-test.1 |
| Manifest | https://github.com/StarMadeGalaxy/JudeOS/releases/download/v0.1.0-test.1/release.json |
| Manifest SHA256 | `80796ff33f9abafd4c5cc015969d3b78d768563fac9d0dcd30342e58f4b27fb9` |
| Registry image | `ghcr.io/starmadegalaxy/judeos@sha256:8beb9d63541b2ddc4bffe60ad339f2392540af3d209fb5ee2590299faed0d456` |
| Image config ID | `sha256:2d4831944d02bc9310c8a69075a845dd3827e65cc573be2aff625d96eca9b3c7` |
| Platform/schema | `linux/amd64`, schema `3` |
| Tag CI | https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37735626740 |

Все пять jobs, включая **Publish tagged release**, success. Release опубликован (`draft=false`, `prerelease=true`); `release.json` скачан, `dirty=false`, `rebuild_verified=true`, commit/tag и полный набор SQL-хешей сверены. Принятый release-gate #91 подтвердил этот run/tag. Анонимный GHCR pull по digest и test-release-check на clean source checkout прошли из облачной среды с сохранением proxy/TLS. Это не проверка registry/VPS HTTPS с самой VPS: команды ниже повторяют identity check там. `previous_compatible_release=null`; проверенного rollback-кандидата пока нет.

## Root-команды получения и проверки на VPS

В доверенной **Bash root-консоли VPS**, после [preflight](hostinger-first-run.md#read-only-preflight-на-vps). Используются точные опубликованные значения. Блок рассчитан на первый запуск с новыми путями; при существующем checkout/manifest/config он останавливается, ничего не удаляет и не регенерирует пароли. Для уже начатой настройки сначала согласовать её состояние с #91, не обходить guards. Не отключать proxy, CA/TLS или SSH host verification.

```bash
set -euo pipefail
test "$(id -u)" -eq 0
for task_dir in /srv/judeos-test /var/lib/judeos-test-release /srv/judeos-test-config; do
  if test -e "$task_dir" || test -L "$task_dir"; then
    printf 'Путь уже существует; остановка без перезаписи: %s\n' "$task_dir" >&2
    exit 1
  fi
done
umask 077
install -d -m 0700 /var/lib/judeos-test-release
curl --fail --location --proto '=https' --proto-redir '=https' \
  https://github.com/StarMadeGalaxy/JudeOS/releases/download/v0.1.0-test.1/release.json \
  --output /var/lib/judeos-test-release/release.json
printf '%s  %s\n' \
  80796ff33f9abafd4c5cc015969d3b78d768563fac9d0dcd30342e58f4b27fb9 \
  /var/lib/judeos-test-release/release.json | sha256sum --check -
git clone https://github.com/StarMadeGalaxy/JudeOS.git /srv/judeos-test
git -C /srv/judeos-test fetch origin main --tags
git -C /srv/judeos-test checkout --detach a54619410aeb1d397bb65b73459785978973c667
git -C /srv/judeos-test merge-base --is-ancestor \
  a54619410aeb1d397bb65b73459785978973c667 origin/main
test "$(git -C /srv/judeos-test rev-parse 'v0.1.0-test.1^{commit}')" = \
  a54619410aeb1d397bb65b73459785978973c667
python3 /srv/judeos-test/ops/deploy-access/release-gate.py \
  --tag v0.1.0-test.1 --run-id 37735626740
python3 /srv/judeos-test/ops/test-release-check.py \
  --manifest /var/lib/judeos-test-release/release.json --pull
```

Ожидаются `release.json: OK`, gate JSON с `verified:true`, затем image identity JSON с `verified:true`, нужными digest/source/schema/tag. Ошибка — остановка до enable: не заменять digest тегом, не собирать приложение на VPS, не обходить проверку. Нужны Git/Python/curl/Docker и outbound GitHub/GHCR. Проверка SHA256 фиксирует полученный manifest; криптографическая подпись образа/tag пока не внедрена. Checkout/manifest созданы root-owned вне config; блок **не создаёт DB secrets и не запускает контейнеры**.

## Единственный первый bootstrap

1. Оператор сообщает успешный результат блока выше и повторный preflight текущих TCP 80/443, DNS, существующего SSL service/firewall. Caddy/public ACME выбран пользователем, но сообщение об автоматическом SSL не заменяет проверку владельцев портов/termination/renewal.
2. Оператор выполняет **enable-release.py из принятого #92**, согласно [инструкции #91](../environments/hostinger-deploy-access.md#6-включить-release-adapter-после-интеграции-22), с checkout `/srv/judeos-test` и manifest `/var/lib/judeos-test-release/release.json`. Enable создаёт новый config/фиксирует policy; само приложение не стартует.
3. После явного подтверждения enable владелец #91 делает первый `vps-deploy.yml` dispatch на main с `release_tag=v0.1.0-test.1`. Только adapter под root lock выполняет up/bootstrap/migrate/seed/runtime/check, затем workflow — независимые внешние проверки. #22 не делает второй dispatch и не вызывает test-env/up параллельно.

Автоматический workflow_run от первого tag CI уже создал [run 37735825526](https://github.com/StarMadeGalaxy/JudeOS/actions/runs/37735825526): selection success, Apply verified image on pinned VPS failure, внешний check не выполнен. Это не успешное размещение; причина по одному job status не установлена. По последней передаче adapter ещё не установлен, но #91 должен подтвердить безопасный server state/причину до повторного dispatch. При timeout/ошибке SSH серверный foreground process может сохраняться под lock: повторять только после проверки состояния, не запускать ручной bootstrap.

После фактического deploy #22 проверяет main protection, эксплуатацию/копии/восстановление и remaining HTTPS/closed-port результаты. Успешные CI/release/access не закрывают эти критерии; Issue не закрывается этим документом, PR uses `Refs #22`.
