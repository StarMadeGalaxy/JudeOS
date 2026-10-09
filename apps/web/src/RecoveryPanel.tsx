import { useState, type FormEvent } from "react";
import { request, errorMessage } from "./api";

type RecoveryLink = { kind: "recovery"; token: string; expires_at: string };

export function RecoveryPanel() {
  const [login, setLogin] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<RecoveryLink | null>(null);
  const [status, setStatus] = useState("");
  async function issue(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLink(null);
    setStatus("");
    try {
      setLink(await request<RecoveryLink>("/api/v1/platform/password-recovery", "POST", {
        login, identity_verified: verified,
      }));
      setVerified(false);
      setStatus("Передайте ссылку проверенному получателю. Он сам установит новый пароль.");
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Восстановление входа">
      <h3>Восстановление входа</h3>
      <p>Сначала проверьте личность человека. Совпадения имени или телефона недостаточно.</p>
      <form onSubmit={issue}>
        <label>Логин получателя
          <input value={login} onChange={(e) => { setLogin(e.target.value); setVerified(false); setLink(null); }} required maxLength={254} disabled={busy} autoComplete="off" />
        </label>
        <label className="check">
          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} required disabled={busy} />
          Личность получателя проверена
        </label>
        <button disabled={busy || !verified}>{busy ? "Выдаём ссылку…" : "Выдать ссылку восстановления"}</button>
      </form>
      <p>Повторная выдача заменит прежнюю ссылку. Если ответ не получен, выдайте новую. Права человека не меняются; после установки пароля его старые сеансы завершатся.</p>
      {link && <div className="record">
        <label>Одноразовая ссылка восстановления
          <input readOnly value={`${location.origin}/#token=${link.token}`} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <p>Действует до {new Date(link.expires_at).toLocaleString("ru-RU", { timeZone: "Europe/Minsk" })} (Минск).</p>
        <button className="secondary" disabled={busy} onClick={() => {
          navigator.clipboard.writeText(`${location.origin}/#token=${link.token}`)
            .then(() => setStatus("Ссылка скопирована."))
            .catch(() => setStatus("Выделите и скопируйте ссылку из поля."));
        }}>Скопировать ссылку восстановления</button>
        <button className="secondary" onClick={() => setLink(null)}>Скрыть ссылку</button>
      </div>}
      <p role="status" aria-live="polite">{status}</p>
    </section>
  );
}
