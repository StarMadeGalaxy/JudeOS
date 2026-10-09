import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/rubik/cyrillic-400.css";
import "@fontsource/rubik/cyrillic-700.css";
import "../../../design-system/tokens.css";
import "./style.css";

import { APIError, request, type Role, type Grant, type Session } from "./api";
import { NetworkPanel } from "./NetworkPanel";
import { RegistryPanel } from "./RegistryPanel";
const PeopleDemo = lazy(() => import("./people-manager/Demo"));
type Staff = {
  membership_id: string;
  login: string;
  active: boolean;
  state: "pending" | "active" | "revoked";
  grants: Grant[];
};
type IssuedLink = {
  url: string;
  login: string;
  roles: Grant[];
  expires: string;
  kind: "invite" | "reset" | "join";
};
let invitationKind = "invite";
function consumeFragment() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const value = fragment.get("token") || "";
  invitationKind = fragment.get("kind") === "join" ? "join" : "invite";
  if (location.hash)
    history.replaceState(null, "", location.pathname + location.search);
  return value;
}
const stateNames = {
  pending: "Ожидает установки пароля",
  active: "Доступ активен",
  revoked: "Доступ отозван",
};
const roleNames: Record<Role, string> = {
  administrator: "Администратор",
  manager: "Менеджер",
  coach: "Тренер",
};
const grants = (roles: Role[]): Grant[] =>
  roles.map((role) => ({
    role,
    scope: role === "coach" ? "assigned_sessions" : "club",
  }));
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(consumeFragment);
  const [joining, setJoining] = useState(() => invitationKind === "join");
  const [existingLogin, setExistingLogin] = useState(false);
  const [redeeming, setRedeeming] = useState(() => Boolean(token));
  const [tenant, setTenant] = useState("");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [inviteLogin, setInviteLogin] = useState("");
  const [inviteRoles, setInviteRoles] = useState<Role[]>(["coach"]);
  const [link, setLink] = useState<IssuedLink | null>(null);
  const [copied, setCopied] = useState(false);
  const membership = session?.memberships.find((m) => m.tenant_id === tenant);
  const admin =
    membership?.grants.some((g) => g.role === "administrator") || false;
  const manager = membership?.grants.some((g) => g.role === "manager") || false;
  const registry = admin || manager;
  async function refresh() {
    const s = await request<Session>("/api/v1/access/session");
    setSession(s);
    if (!s.memberships.some((m) => m.tenant_id === tenant))
      setTenant(s.memberships[0]?.tenant_id || "");
  }
  useEffect(() => {
    function end() {
      setSession(null);
      setStaff([]);
      setLink(null);
      setTenant("");
    }
    window.addEventListener("judeos-session-ended", end);
    return () => window.removeEventListener("judeos-session-ended", end);
  }, []);
  useEffect(() => {
    function openInvitation() {
      const value = consumeFragment();
      if (!value) return;
      setToken(value);
      setJoining(invitationKind === "join");
      setRedeeming(true);
      setPassword("");
      setLogin("");
      setStatus("");
      setLink(null);
    }
    window.addEventListener("hashchange", openInvitation);
    return () => window.removeEventListener("hashchange", openInvitation);
  }, []);
  useEffect(() => {
    let active = true;
    request<Session>("/api/v1/access/session")
      .then((s) => {
        if (active) {
          setSession(s);
          setTenant(s.memberships[0]?.tenant_id || "");
        }
      })
      .catch((e) => {
        if (active && !(e instanceof APIError && e.status === 401))
          setStatus("Не удалось проверить вход. Попробуйте ещё раз.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setStaff([]);
    setLink(null);
    if (!(admin || manager) || !tenant) return;
    let active = true;
    request<{ items: Staff[] }>(
      `/api/v1/tenants/${tenant}/${admin ? "staff" : "coaches"}`,
    )
      .then((v) => {
        if (active) setStaff(v.items);
      })
      .catch(() => {
        if (active) setStatus("Не удалось загрузить сотрудников.");
      });
    return () => {
      active = false;
    };
  }, [admin, manager, tenant]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    setLink(null);
    setCopied(false);
    try {
      await fn();
    } catch (e) {
      if (e instanceof APIError) {
        if (e.status === 401 && e.code !== "LOGIN_FAILED") {
          setSession(null);
          setStaff([]);
          setPassword("");
          setStatus("Вход завершён. Войдите снова.");
        } else
          setStatus(
            e.code === "LOGIN_FAILED"
              ? "Не удалось войти. Проверьте логин и пароль."
              : e.status === 409
                ? "Изменение отклонено. Проверьте роли и наличие другого владельца."
                : e.status === 429
                  ? "Слишком много попыток. Попробуйте позже."
                  : e.code === "LINK_INVALID"
                    ? "Ссылка недействительна или истекла. Обратитесь к администратору."
                    : e.status === 403
                      ? "Доступ запрещён. Обновите страницу и проверьте свои права."
                      : "Не удалось выполнить запрос. Попробуйте ещё раз.",
          );
      } else setStatus("Не удалось связаться с сервером. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
      setPassword("");
    }
  }
  async function signIn(e: FormEvent) {
    e.preventDefault();
    await act(async () => {
      const s = await request<Session>("/api/v1/access/login", "POST", {
        login,
        password,
      });
      setSession(s);
      setTenant(s.memberships[0]?.tenant_id || "");
      setStatus("Вы вошли.");
    });
  }
  async function redeem(e: FormEvent) {
    e.preventDefault();
    await act(async () => {
      await request("/api/v1/access/redeem", "POST", { token, password });
      setToken("");
      setRedeeming(false);
      setSession(null);
      setStaff([]);
      setTenant("");
      setStatus("Пароль установлен. Войдите с вашим логином.");
    });
  }
  async function loadStaff() {
    const v = await request<{ items: Staff[] }>(
      `/api/v1/tenants/${tenant}/${admin ? "staff" : "coaches"}`,
    );
    setStaff(v.items);
  }
  async function invite(e: FormEvent) {
    e.preventDefault();
    await act(async () => {
      const v = await request<{
        token: string;
        expires_at: string;
        kind?: "invite" | "join";
      }>(
        `/api/v1/tenants/${tenant}/staff/${existingLogin || !admin ? "assignments" : "invitations"}`,
        "POST",
        { login: inviteLogin, grants: grants(admin ? inviteRoles : ["coach"]) },
      );
      setLink({
        url: `${location.origin}/#token=${v.token}${v.kind === "join" ? "&kind=join" : ""}`,
        login: inviteLogin.trim().toLowerCase(),
        roles: grants(inviteRoles),
        expires: v.expires_at,
        kind: v.kind || "invite",
      });
      await loadStaff();
      setInviteLogin("");
      setStatus(
        "Приглашение готово. Передайте ссылку лично через проверенный канал.",
      );
    });
  }
  return (
    <main>
      <header>
        <span className="brand">JUDO PRIDE</span>
        <span>JudeOS</span>
      </header>
      <section>
        <p className="eyebrow">Для сотрудников</p>
        <h1>
          {redeeming && joining
            ? "Войти и принять приглашение"
            : redeeming
              ? "Установить пароль"
              : session
                ? "Рабочее пространство"
                : "Вход в клуб"}
        </h1>
        <p className="note">
          Тестовая среда использует только синтетические данные.
        </p>
        {loading ? (
          <p>Проверяем вход…</p>
        ) : redeeming && joining && session ? (
          <div className="invitation">
            <p>Принять приглашение в новый клуб для текущего входа?</p>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await request("/api/v1/access/accept-invitation", "POST", {
                    token,
                  });
                  setToken("");
                  setRedeeming(false);
                  setJoining(false);
                  await refresh();
                  setStatus("Приглашение принято. Выберите клуб.");
                })
              }
            >
              Принять приглашение в клуб
            </button>
            <button
              className="secondary"
              onClick={() => {
                setToken("");
                setRedeeming(false);
                setJoining(false);
              }}
            >
              Отказаться от приглашения
            </button>
          </div>
        ) : redeeming && session ? (
          <div className="invitation">
            <p>
              Вы уже вошли в клуб. Чтобы установить пароль по приглашению или
              восстановить доступ, сначала выйдите из текущей сессии. Права
              текущего сотрудника не изменятся.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await request("/api/v1/access/logout", "POST");
                  setSession(null);
                  setStaff([]);
                  setTenant("");
                  setPassword("");
                  setLogin("");
                  setStatus("Теперь установите пароль по полученной ссылке.");
                })
              }
            >
              Выйти и установить пароль
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setToken("");
                setRedeeming(false);
                setPassword("");
                setStatus("");
              }}
            >
              Остаться в рабочем пространстве
            </button>
          </div>
        ) : !session ? (
          <>
            {redeeming && !joining && (
              <p>
                Установите пароль, затем войдите с логином, который передал
                администратор. Ссылка одноразовая. Если она истекла, попросите
                новую.
              </p>
            )}
            <form onSubmit={redeeming && !joining ? redeem : signIn}>
              {redeeming && !joining ? (
                <label>
                  Код приглашения или восстановления
                  <input
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                    pattern="[a-f0-9]{64}"
                  />
                </label>
              ) : (
                <label>
                  Логин
                  <input
                    autoComplete="username"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    required
                    maxLength={254}
                  />
                </label>
              )}
              <label>
                {redeeming && !joining
                  ? "Новый пароль (не менее 12 символов)"
                  : "Пароль"}
                <input
                  type="password"
                  autoComplete={
                    redeeming && !joining ? "new-password" : "current-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={redeeming && !joining ? 12 : 1}
                  maxLength={1024}
                />
              </label>
              <button disabled={busy}>
                {busy
                  ? "Подождите…"
                  : redeeming && !joining
                    ? "Установить пароль"
                    : "Войти"}
              </button>
            </form>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setRedeeming(!redeeming);
                setToken("");
                setPassword("");
                setStatus("");
              }}
            >
              {redeeming
                ? "Вернуться ко входу"
                : "У меня есть приглашение или код восстановления"}
            </button>
            <p>
              Для восстановления доступа попросите администратора передать
              одноразовую ссылку.
            </p>
          </>
        ) : (
          <>
            <label>
              Клуб
              <select
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                disabled={busy}
              >
                {session.memberships.map((m) => (
                  <option key={m.tenant_id} value={m.tenant_id}>
                    {m.club_name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Ваши роли:{" "}
              {membership?.grants.map((g) => roleNames[g.role]).join(", ")}.
            </p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await request("/api/v1/access/logout", "POST");
                  setSession(null);
                  setStaff([]);
                  setTenant("");
                  setStatus("Вы вышли.");
                })
              }
            >
              Выйти
            </button>
            <NetworkPanel
              key={session.account_id}
              session={session}
              tenant={tenant}
              admin={admin}
              refresh={refresh}
            />
            {registry && tenant && (
              <>
                <p>
                  <a href="?demo=people">
                    Люди и семьи — синтетическая демонстрация
                  </a>
                </p>
                <RegistryPanel key={tenant} tenant={tenant} />
              </>
            )}
            {(admin || manager) && (
              <div>
                <h2>Сотрудники</h2>
                <form onSubmit={invite}>
                  <label>
                    Логин нового сотрудника
                    <input
                      value={inviteLogin}
                      onChange={(e) => setInviteLogin(e.target.value)}
                      required
                      maxLength={254}
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={existingLogin}
                      onChange={(e) => setExistingLogin(e.target.checked)}
                    />
                    У сотрудника уже есть вход в программу
                  </label>
                  <fieldset>
                    <legend>Роли приглашённого сотрудника</legend>
                    {(
                      (admin ? Object.keys(roleNames) : ["coach"]) as Role[]
                    ).map((role) => (
                      <label className="check" key={role}>
                        <input
                          type="checkbox"
                          checked={inviteRoles.includes(role)}
                          onChange={(e) =>
                            setInviteRoles(
                              e.target.checked
                                ? [...inviteRoles, role]
                                : inviteRoles.filter((r) => r !== role),
                            )
                          }
                        />
                        {roleNames[role]}
                      </label>
                    ))}
                  </fieldset>
                  <button disabled={busy || inviteRoles.length === 0}>
                    Создать приглашение
                  </button>
                </form>
                {link && (
                  <aside
                    className="invitation"
                    aria-label="Приглашение сотруднику"
                  >
                    <h3>
                      {link.kind === "invite"
                        ? "Приглашение готово"
                        : "Восстановление доступа"}
                    </h3>
                    <p>
                      Логин получателя: <strong>{link.login}</strong>
                    </p>
                    <p>
                      Роли:{" "}
                      {link.roles.map((g) => roleNames[g.role]).join(", ")}.
                    </p>
                    <p>
                      Ссылка действует до{" "}
                      {new Date(link.expires).toLocaleString("ru-RU")}.
                    </p>
                    <ol>
                      <li>
                        Передайте получателю логин и ссылку лично через
                        проверенный канал.
                      </li>
                      <li>
                        {link.kind === "join"
                          ? "Получатель входит с прежним паролем и принимает приглашение."
                          : "Получатель открывает ссылку и устанавливает пароль."}
                      </li>
                      <li>
                        После этого входит с указанным логином и новым паролем.
                      </li>
                    </ol>
                    <label>
                      Одноразовая ссылка
                      <textarea readOnly value={link.url} />
                    </label>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(link.url);
                          setCopied(true);
                        } catch {
                          setCopied(false);
                          setStatus(
                            "Не удалось скопировать. Выделите ссылку и скопируйте вручную.",
                          );
                        }
                      }}
                    >
                      Скопировать ссылку
                    </button>
                    <p aria-live="polite">
                      {copied
                        ? "Ссылка скопирована."
                        : "Сохраните ссылку сейчас: после закрытия блока она не отображается повторно."}
                    </p>
                    <button
                      className="secondary"
                      onClick={() => {
                        setLink(null);
                        setCopied(false);
                      }}
                    >
                      Скрыть ссылку
                    </button>
                  </aside>
                )}
                <ul className="staff">
                  {staff.map((item) => (
                    <li key={item.membership_id}>
                      <strong>{item.login}</strong>
                      <p>
                        {stateNames[item.state]} ·{" "}
                        {item.grants.map((g) => roleNames[g.role]).join(", ")}
                      </p>
                      {admin && item.state !== "revoked" && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              const v = await request<{
                                token: string;
                                expires_at: string;
                                kind?: "invite" | "reset" | "join";
                              }>(
                                `/api/v1/tenants/${tenant}/staff/${item.membership_id}/reset`,
                                "POST",
                              );
                              setLink({
                                url: `${location.origin}/#token=${v.token}${v.kind === "join" ? "&kind=join" : ""}`,
                                login: item.login,
                                roles: item.grants,
                                expires: v.expires_at,
                                kind:
                                  v.kind ||
                                  (item.state === "pending"
                                    ? "invite"
                                    : "reset"),
                              });
                              setStatus(
                                "Передайте новую ссылку получателю. Предыдущие ссылки отозваны.",
                              );
                            })
                          }
                        >
                          {item.state === "pending"
                            ? "Выдать новое приглашение"
                            : "Выдать ссылку восстановления"}
                        </button>
                      )}
                      {!admin && item.active && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => {
                            if (
                              confirm(`Отозвать доступ тренера ${item.login}?`)
                            )
                              void act(async () => {
                                await request(
                                  `/api/v1/tenants/${tenant}/coaches/${item.membership_id}/revoke`,
                                  "POST",
                                );
                                await loadStaff();
                              });
                          }}
                        >
                          Отозвать доступ тренера
                        </button>
                      )}
                      {admin && item.active && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const data = new FormData(e.currentTarget);
                            const roles = data.getAll("role") as Role[];
                            const revoke =
                              (
                                e.nativeEvent as SubmitEvent
                              ).submitter?.getAttribute("value") === "revoke";
                            if (
                              revoke &&
                              !window.confirm(
                                `Отозвать доступ ${item.login}? Его сессии будут завершены.`,
                              )
                            )
                              return;
                            void act(async () => {
                              await request(
                                `/api/v1/tenants/${tenant}/staff/${item.membership_id}`,
                                "PUT",
                                { active: !revoke, grants: grants(roles) },
                              );
                              if (
                                item.membership_id === membership?.membership_id
                              ) {
                                setSession(null);
                                setStaff([]);
                                setStatus("Права изменены. Войдите снова.");
                              } else {
                                await loadStaff();
                                setStatus("Доступ обновлён.");
                              }
                            });
                          }}
                        >
                          <fieldset>
                            <legend>Роли {item.login}</legend>
                            {(Object.keys(roleNames) as Role[]).map((role) => (
                              <label className="check" key={role}>
                                <input
                                  type="checkbox"
                                  name="role"
                                  value={role}
                                  defaultChecked={item.grants.some(
                                    (g) => g.role === role,
                                  )}
                                  disabled={busy}
                                />
                                {roleNames[role]}
                              </label>
                            ))}
                          </fieldset>
                          <button disabled={busy}>Сохранить роли</button>{" "}
                          <button
                            className="secondary"
                            value="revoke"
                            disabled={busy}
                          >
                            Отозвать доступ
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <p role="status" aria-live="polite" className="status">
          {status}
        </p>
      </section>
    </main>
  );
}
// Agreed in #27: a fragment always returns to App, including after demo opened.
function Entry() {
  const [demo, setDemo] = useState(
    () =>
      new URLSearchParams(location.search).get("demo") === "people" &&
      !location.hash,
  );
  useEffect(() => {
    const openApp = () => {
      if (location.hash) setDemo(false);
    };
    window.addEventListener("hashchange", openApp);
    openApp();
    return () => window.removeEventListener("hashchange", openApp);
  }, []);
  return demo ? (
    <Suspense fallback={<p role="status">Загрузка демонстрации…</p>}>
      <PeopleDemo />
    </Suspense>
  ) : (
    <App />
  );
}
createRoot(document.getElementById("root")!).render(<Entry />);
