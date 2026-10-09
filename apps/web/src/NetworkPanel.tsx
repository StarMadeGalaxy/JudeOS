import { useEffect, useState, type FormEvent } from "react";
import { request, errorMessage, type Network, type Session } from "./api";
type Club = {
  tenant_id: string;
  network_id: string;
  name: string;
  address: string;
  timezone: string;
  version: number;
};
type Profile = Network & {
  clubs: Club[];
  owners: { account_id: string; login: string; active: boolean }[];
};
export function NetworkPanel({
  session,
  tenant,
  admin,
  refresh,
}: {
  session: Session;
  tenant: string;
  admin: boolean;
  refresh: () => Promise<void>;
}) {
  const [id, setID] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [networkName, setNetworkName] = useState("");
  const [ownerLogin, setOwnerLogin] = useState("");
  const [platformLogin, setPlatformLogin] = useState("");
  const networks = session.networks || [];
  const platform = Boolean(session.platform_administrator);
  useEffect(() => {
    let current = true;
    setProfile(null);
    if (id)
      request<Profile>(`/api/v1/networks/${id}`)
        .then((v) => {
          if (current) {
            setProfile(v);
            setNetworkName(v.name);
          }
        })
        .catch((e) => {
          if (current) setStatus(errorMessage(e));
        });
    return () => {
      current = false;
    };
  }, [id]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    try {
      await fn();
      setStatus("Настройки сохранены.");
      await refresh();
    } catch (e) {
      setProfile(null);
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (id) {
      const v = await request<Profile>(`/api/v1/networks/${id}`);
      setProfile(v);
      setNetworkName(v.name);
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    await act(async () => {
      const v = await request<Profile>(
        platform
          ? "/api/v1/platform/networks"
          : `/api/v1/tenants/${tenant}/network`,
        "POST",
        { name: networkName },
      );
      setID(v.network_id);
      setProfile(v);
    });
  }
  if (!platform && !networks.length && !admin) return null;
  return (
    <div
      className="module"
      aria-label={
        platform ? "Панель администратора платформы" : "Настройки сети"
      }
    >
      <h2>{platform ? "Администрирование платформы" : "Моя сеть"}</h2>
      <p>
        {platform
          ? "Настройка всех сетей и их клубов."
          : "Единый вход в клубы вашей сети. Названия и адреса можно менять здесь."}
      </p>
      <label>
        Сеть
        <select
          value={id}
          onChange={(e) => setID(e.target.value)}
          disabled={busy}
        >
          <option value="">Выберите сеть</option>
          {networks.map((n) => (
            <option key={n.network_id} value={n.network_id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void act(reload)}
      >
        Обновить настройки
      </button>
      {!id && (platform || admin) && (
        <form onSubmit={create}>
          <label>
            Название новой сети
            <input
              value={networkName}
              onChange={(e) => setNetworkName(e.target.value)}
              required
              maxLength={120}
            />
          </label>
          <p>
            {platform
              ? "Создайте сеть, затем добавьте клуб и назначьте владельца."
              : "В сеть войдёт выбранный клуб. Другие клубы автоматически не добавляются."}
          </p>
          <button disabled={busy || (!platform && !tenant)}>
            Создать сеть
          </button>
        </form>
      )}
      {profile && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                setProfile(
                  await request<Profile>(`/api/v1/networks/${id}`, "PUT", {
                    name: networkName,
                    base_version: profile.version,
                  }),
                );
              });
            }}
          >
            <label>
              Название сети
              <input
                value={networkName}
                onChange={(e) => setNetworkName(e.target.value)}
                required
                maxLength={120}
              />
            </label>
            <button disabled={busy}>Сохранить название сети</button>
          </form>
          <h3>Клубы сети</h3>
          {profile.clubs.map((c) => (
            <form
              key={`${c.tenant_id}-${c.version}`}
              className="record"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act(async () => {
                  await request(
                    `/api/v1/networks/${id}/clubs/${c.tenant_id}`,
                    "PUT",
                    {
                      name: f.get("name"),
                      address: f.get("address"),
                      base_version: c.version,
                    },
                  );
                  await reload();
                });
              }}
            >
              <label>
                Название клуба
                <input
                  name="name"
                  defaultValue={c.name}
                  required
                  maxLength={120}
                />
              </label>
              <label>
                Адрес клуба
                <input
                  name="address"
                  defaultValue={c.address}
                  maxLength={300}
                />
              </label>
              <button disabled={busy}>Сохранить клуб</button>
            </form>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const form = e.currentTarget;
              void act(async () => {
                await request(`/api/v1/networks/${id}/clubs`, "POST", {
                  name: f.get("name"),
                  address: f.get("address"),
                });
                form.reset();
                await reload();
              });
            }}
          >
            <h3>Добавить клуб</h3>
            <label>
              Название нового клуба
              <input name="name" required maxLength={120} />
            </label>
            <label>
              Адрес нового клуба
              <input name="address" maxLength={300} />
            </label>
            <button disabled={busy}>Добавить клуб</button>
          </form>
          <h3>Владельцы сети</h3>
          <p>
            Укажите логин сотрудника с уже настроенным входом. Нового сотрудника
            сначала пригласите в один из клубов.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await request(`/api/v1/networks/${id}/owners`, "PUT", {
                  login: ownerLogin,
                  active: true,
                });
                setOwnerLogin("");
                await reload();
              });
            }}
          >
            <label>
              Логин владельца
              <input
                value={ownerLogin}
                onChange={(e) => setOwnerLogin(e.target.value)}
                required
                maxLength={254}
              />
            </label>
            <button disabled={busy}>Назначить владельца</button>
          </form>
          <ul>
            {profile.owners
              .filter((o) => o.active)
              .map((o) => (
                <li key={o.account_id}>
                  {o.login}{" "}
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Отозвать сетевые права ${o.login}?`))
                        void act(async () => {
                          await request(
                            `/api/v1/networks/${id}/owners`,
                            "PUT",
                            { login: o.login, active: false },
                          );
                          await reload();
                        });
                    }}
                  >
                    Отозвать права владельца
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
      {platform && (
        <details>
          <summary>Администраторы платформы</summary>
          <p>
            Эти права дают доступ ко всем сетям. Последнего администратора
            отозвать нельзя.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const enable =
                (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                  "value",
                ) !== "revoke";
              if (
                !confirm(
                  `${enable ? "Выдать" : "Отозвать"} права платформы для ${platformLogin}?`,
                )
              )
                return;
              void act(async () => {
                await request("/api/v1/platform/administrators", "PUT", {
                  login: platformLogin,
                  active: enable,
                });
                setPlatformLogin("");
              });
            }}
          >
            <label>
              Логин администратора платформы
              <input
                value={platformLogin}
                onChange={(e) => setPlatformLogin(e.target.value)}
                required
                maxLength={254}
              />
            </label>
            <button disabled={busy}>Назначить администратора платформы</button>{" "}
            <button className="secondary" value="revoke" disabled={busy}>
              Отозвать права платформы
            </button>
          </form>
        </details>
      )}
      <p role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
