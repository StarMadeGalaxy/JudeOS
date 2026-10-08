import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/rubik/cyrillic-400.css';
import '@fontsource/rubik/cyrillic-700.css';
import '../../../design-system/tokens.css';
import './style.css';

type Role = 'administrator' | 'manager' | 'coach';
type Grant = {role: Role; scope: 'club' | 'assigned_sessions'};
type Membership = {membership_id: string; tenant_id: string; club_name: string; grants: Grant[]};
type Session = {account_id: string; expires_at: string; memberships: Membership[]};
type Staff = {membership_id: string; login: string; active: boolean; grants: Grant[]};
const roleNames: Record<Role, string> = {administrator: 'Администратор', manager: 'Менеджер', coach: 'Тренер'};
const grants = (roles: Role[]): Grant[] => roles.map(role => ({role, scope: role === 'coach' ? 'assigned_sessions' : 'club'}));
class APIError extends Error { constructor(public status: number, public code: string) { super(code); } }
async function request<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    const csrfResponse = await fetch('/api/v1/access/csrf', {cache: 'no-store'});
    if (!csrfResponse.ok) throw new APIError(csrfResponse.status, 'BOOTSTRAP_FAILED');
    headers['X-CSRF-Token'] = (await csrfResponse.json()).csrf_token;
    if (data !== undefined) headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, {method, headers, body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store'});
  const body = res.status === 204 ? undefined : await res.json();
  if (!res.ok) throw new APIError(res.status, body?.code || 'REQUEST_FAILED');
  return body as T;
}
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState(() => {
    const value = new URLSearchParams(location.hash.slice(1)).get('token') || '';
    // Keep invite/reset only in memory; immediately remove fragment from history.
    if (location.hash) history.replaceState(null, '', location.pathname);
    return value;
  });
  const [redeeming, setRedeeming] = useState(() => Boolean(token));
  const [tenant, setTenant] = useState('');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [inviteLogin, setInviteLogin] = useState('');
  const [inviteRoles, setInviteRoles] = useState<Role[]>(['coach']);
  const [link, setLink] = useState('');
  const membership = session?.memberships.find(m => m.tenant_id === tenant);
  const admin = membership?.grants.some(g => g.role === 'administrator') || false;
  useEffect(() => {
    let active = true;
    request<Session>('/api/v1/access/session').then(s => {if (active) {setSession(s); setTenant(s.memberships[0]?.tenant_id || '');}})
      .catch(e => {if (active && !(e instanceof APIError && e.status === 401)) setStatus('Не удалось проверить вход. Попробуйте ещё раз.');})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, []);
  useEffect(() => {
    setStaff([]); setLink('');
    if (!admin || !tenant) return;
    let active = true;
    request<{items: Staff[]}>(`/api/v1/tenants/${tenant}/staff`).then(v => {if (active) setStaff(v.items);})
      .catch(() => {if (active) setStatus('Не удалось загрузить сотрудников.');});
    return () => {active = false;};
  }, [admin, tenant]);
  async function act(fn: () => Promise<void>) {
    setBusy(true); setStatus(''); setLink('');
    try {await fn();}
    catch (e) {
      if (e instanceof APIError) {
        if (e.status === 401 && e.code !== 'LOGIN_FAILED') {setSession(null); setStaff([]); setPassword(''); setStatus('Вход завершён. Войдите снова.');}
        else setStatus(e.code === 'LOGIN_FAILED' ? 'Не удалось войти. Проверьте логин и пароль.' : e.status === 409 ? 'Изменение отклонено. Проверьте роли и наличие другого владельца.' : e.status === 429 ? 'Слишком много попыток. Попробуйте позже.' : e.code === 'LINK_INVALID' ? 'Ссылка недействительна или истекла. Обратитесь к администратору.' : e.status === 403 ? 'Доступ запрещён. Обновите страницу и проверьте свои права.' : 'Не удалось выполнить запрос. Попробуйте ещё раз.');
      } else setStatus('Не удалось связаться с сервером. Попробуйте ещё раз.');
    } finally {setBusy(false); setPassword('');}
  }
  async function signIn(e: FormEvent) {e.preventDefault(); await act(async () => {
    const s = await request<Session>('/api/v1/access/login', 'POST', {login, password});
    setSession(s); setTenant(s.memberships[0]?.tenant_id || ''); setStatus('Вы вошли.');
  });}
  async function redeem(e: FormEvent) {e.preventDefault(); await act(async () => {
    await request('/api/v1/access/redeem', 'POST', {token, password}); setToken(''); setRedeeming(false); setStatus('Пароль установлен. Войдите с вашим логином.');
  });}
  async function loadStaff() {const v = await request<{items: Staff[]}>(`/api/v1/tenants/${tenant}/staff`); setStaff(v.items);}
  async function invite(e: FormEvent) {e.preventDefault(); await act(async () => {
    const v = await request<{token: string}>(`/api/v1/tenants/${tenant}/staff/invitations`, 'POST', {login: inviteLogin, grants: grants(inviteRoles)});
    setLink(`${location.origin}/#token=${v.token}`); await loadStaff(); setInviteLogin(''); setStatus('Приглашение готово. Передайте ссылку лично через проверенный канал.');
  });}
  return <main>
    <header><span className="brand">JUDO PRIDE</span><span>JudeOS</span></header>
    <section>
      <p className="eyebrow">Для сотрудников</p>
      <h1>{session ? 'Рабочее пространство' : redeeming ? 'Установить пароль' : 'Вход в клуб'}</h1>
      <p className="note">Тестовая среда использует только синтетические данные.</p>
      {loading ? <p>Проверяем вход…</p> : !session ? <>
        <form onSubmit={redeeming ? redeem : signIn}>
          {redeeming ? <label>Код приглашения или восстановления<input autoComplete="off" value={token} onChange={e => setToken(e.target.value)} required pattern="[a-f0-9]{64}" /></label> : <label>Логин<input autoComplete="username" value={login} onChange={e => setLogin(e.target.value)} required maxLength={254} /></label>}
          <label>{redeeming ? 'Новый пароль (не менее 12 символов)' : 'Пароль'}<input type="password" autoComplete={redeeming ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={redeeming ? 12 : 1} maxLength={1024} /></label>
          <button disabled={busy}>{busy ? 'Подождите…' : redeeming ? 'Установить пароль' : 'Войти'}</button>
        </form>
        <button className="secondary" disabled={busy} onClick={() => {setRedeeming(!redeeming); setPassword(''); setStatus('');}}>{redeeming ? 'Вернуться ко входу' : 'У меня есть приглашение или код восстановления'}</button>
        <p>Для восстановления доступа попросите администратора передать одноразовую ссылку.</p>
      </> : <>
        <label>Клуб<select value={tenant} onChange={e => setTenant(e.target.value)} disabled={busy}>{session.memberships.map(m => <option key={m.tenant_id} value={m.tenant_id}>{m.club_name}</option>)}</select></label>
        <p>Ваши роли: {membership?.grants.map(g => roleNames[g.role]).join(', ')}.</p>
        <button className="secondary" disabled={busy} onClick={() => act(async () => {await request('/api/v1/access/logout', 'POST'); setSession(null); setStaff([]); setTenant(''); setStatus('Вы вышли.');})}>Выйти</button>
        {admin && <div>
          <h2>Сотрудники</h2>
          <form onSubmit={invite}>
            <label>Логин нового сотрудника<input value={inviteLogin} onChange={e => setInviteLogin(e.target.value)} required maxLength={254} /></label>
            <fieldset><legend>Роли приглашённого сотрудника</legend>{(Object.keys(roleNames) as Role[]).map(role => <label className="check" key={role}><input type="checkbox" checked={inviteRoles.includes(role)} onChange={e => setInviteRoles(e.target.checked ? [...inviteRoles, role] : inviteRoles.filter(r => r !== role))} />{roleNames[role]}</label>)}</fieldset>
            <button disabled={busy || inviteRoles.length === 0}>Создать приглашение</button>
          </form>
          <ul className="staff">{staff.map(item => <li key={item.membership_id}>
            <strong>{item.login}</strong><p>{item.active ? 'Активен' : 'Доступ не активен'} · {item.grants.map(g => roleNames[g.role]).join(', ')}</p>
            <button className="secondary" disabled={busy} onClick={() => act(async () => {const v = await request<{token: string}>(`/api/v1/tenants/${tenant}/staff/${item.membership_id}/reset`, 'POST'); setLink(`${location.origin}/#token=${v.token}`); setStatus('Передайте новую ссылку через проверенный канал. Предыдущие ссылки отозваны.');})}>Выдать ссылку установки пароля</button>
            {item.active && <form onSubmit={e => {e.preventDefault(); const data = new FormData(e.currentTarget); const roles = data.getAll('role') as Role[]; const revoke = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'revoke'; if (revoke && !window.confirm(`Отозвать доступ ${item.login}? Его сессии будут завершены.`)) return; void act(async () => {await request(`/api/v1/tenants/${tenant}/staff/${item.membership_id}`, 'PUT', {active: !revoke, grants: grants(roles)}); if (item.membership_id === membership?.membership_id) {setSession(null); setStaff([]); setStatus('Права изменены. Войдите снова.');} else {await loadStaff(); setStatus('Доступ обновлён.');}});}}>
              <fieldset><legend>Роли {item.login}</legend>{(Object.keys(roleNames) as Role[]).map(role => <label className="check" key={role}><input type="checkbox" name="role" value={role} defaultChecked={item.grants.some(g => g.role === role)} disabled={busy} />{roleNames[role]}</label>)}</fieldset>
              <button disabled={busy}>Сохранить роли</button> <button className="secondary" value="revoke" disabled={busy}>Отозвать доступ</button>
            </form>}
          </li>)}</ul>
        </div>}
      </>}
      {link && <div><label>Одноразовая ссылка<textarea readOnly value={link} /></label><button className="secondary" onClick={() => setLink('')}>Скрыть ссылку</button></div>}
      <p role="status" aria-live="polite" className="status">{status}</p>
      <button className="secondary" disabled={busy} onClick={() => act(async () => {const v = await request<{status: string}>('/readyz'); setStatus(v.status === 'ready' ? 'Тестовая среда готова.' : 'Среда временно недоступна.');})}>Проверить готовность</button>
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
