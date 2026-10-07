const app = document.querySelector('#app');
const scenarioSelect = document.querySelector('#scenario');
const logout = document.querySelector('#logout');
const labels = { present: 'Присутствовал', absent: 'Отсутствовал', sick: 'Болел', other: 'Другая причина', unmarked: 'Не отмечен' };
const fixture = await fetch('./fixture.json').then(r => { if (!r.ok) throw new Error('Fixture unavailable'); return r.json(); });
let server, view, screen = 'login', query = '', scenario = 'normal', authenticated = false, loading = false, generation = 0;
const pending = new Map(), states = new Map(), replies = new Map();
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wait = () => new Promise(resolve => setTimeout(resolve, 450));
const time = value => new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Minsk' }).format(new Date(value));
function reset() { generation++; server = structuredClone(fixture); view = structuredClone(server); pending.clear(); states.clear(); replies.clear(); query = ''; authenticated = false; screen = 'login'; loading = false; render(); }
function count() { return view.roster.filter(e => e.attendance.status !== 'unmarked').length; }
function entry(id) { return view.roster.find(e => e.athlete_id === id); }
function errorPanel(message) { return `<div class="notice" role="alert"><p>${esc(message)}</p><button data-action="reload">Попробовать снова</button></div>`; }
function render() {
 logout.hidden = !authenticated;
 if (screen === 'login') {
  app.innerHTML = `<section class="panel login"><div class="eyebrow">Для сотрудников клуба</div><h1>Рады видеть вас<br>на татами</h1><p class="muted">Войдите, чтобы открыть свои занятия и отметить участников.</p><form id="login"><label for="email">Электронная почта</label><input id="email" name="email" type="email" autocomplete="username" value="coach@example.test" required><label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" required><div id="login-error" role="alert"></div><button class="primary wide" type="submit">Войти</button></form><p class="muted">Учебный вход: любой непустой пароль. Реальные данные не вводите.</p></section>`;
  return;
 }
 const s = view.session;
 const day = new Intl.DateTimeFormat('ru', {day:'numeric',month:'long',timeZone:'Europe/Minsk'}).format(new Date(s.starts_at));
 if (screen === 'sessions') {
  let content;
  if (scenario === 'empty') content = '<section class="panel empty"><h2>На этот день занятий нет</h2><p class="muted">Здесь появятся занятия, на которые вы назначены тренером.</p></section>';
  else if (scenario === 'network') content = errorPanel('Не удалось загрузить занятия. Проверьте связь.');
  else if (scenario === 'forbidden') content = errorPanel('Нет доступа к занятиям этого клуба. Обратитесь к администратору.');
  else if (scenario === 'error') content = errorPanel('Сервис временно недоступен. Занятия пока не загружены.');
  else content = `<button class="session-button" data-action="open"><span class="eyebrow">${time(s.starts_at)} — ${time(s.ends_at)} · Проводится</span><strong>${esc(s.group.name)}</strong><span class="session-meta">${esc(s.venue.name)} · ${view.roster.length} участников</span><span class="cta">Открыть журнал →</span></button>`;
  app.innerHTML = `<div class="eyebrow">Judo Pride · тренер</div><h1>Мои занятия</h1><p class="muted">${day} · время Минска</p>${content}`;
 } else {
  app.innerHTML = `<button class="back" data-action="back">← Мои занятия</button><div class="eyebrow">${time(s.starts_at)} — ${time(s.ends_at)} · ${esc(s.venue.name)}</div><h1>${esc(s.group.name)}</h1><p class="muted">${day} · Проводится</p><div class="stats"><div><strong>${count()} / ${view.roster.length}</strong><span>отмечено</span></div><div><strong>${view.roster.filter(e=>e.attendance.status==='present').length}</strong><span>присутствуют</span></div></div><div class="toolbar"><h2>Участники</h2><input id="search" type="search" aria-label="Найти участника" placeholder="Найти участника" value="${esc(query)}"></div><p class="muted">Каждая отметка сохраняется отдельно. Не отмечен — не значит отсутствовал.</p><div id="global-message" role="status"></div><div class="roster" id="roster"></div>`;
  renderRoster();
 }
}
function renderRoster() {
 const roster = document.querySelector('#roster'); if (!roster) return;
 const entries = view.roster.filter(e=>e.display_name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
 roster.innerHTML = entries.length ? entries.map(e => {
  const id = e.athlete_id, st = states.get(id), locked = pending.has(id), a = e.attendance;
  let note = st?.text || (a.status === 'unmarked' ? 'Пока не отмечен' : `Сохранено · ${time(a.recorded_at)}`);
  let extra = '';
  if (st?.kind === 'retry') extra = `<div class="notice"><p>Результат пока неизвестен. Повтор отправит ту же команду.</p><button data-action="retry" data-id="${id}">Повторить сохранение</button></div>`;
  if (st?.kind === 'conflict') extra = `<div class="conflict" role="alert"><strong>Другой тренер изменил отметку</strong><p>Вы выбрали: ${labels[st.wanted]}. Сейчас: ${labels[a.status]}.</p><button data-action="accept" data-id="${id}">Оставить текущую</button><button data-action="resolve" data-id="${id}" class="primary">Сохранить мой выбор</button></div>`;
  return `<article class="athlete" data-athlete="${id}"><div class="person"><span class="avatar" aria-hidden="true">${esc(e.display_name.split(' ').map(n=>n[0]).join(''))}</span><div><h2>${esc(e.display_name)}</h2><small>${e.trial ? 'Пробное занятие' : e.participation === 'visit' ? 'Визит из другой группы' : 'Участник группы'}</small></div></div><div class="choices" role="group" aria-label="Отметка: ${esc(e.display_name)}">${Object.entries(labels).filter(([key])=>key!=='unmarked').map(([key,label])=>`<button data-action="mark" data-id="${id}" data-status="${key}" aria-pressed="${a.status===key}" ${locked?'disabled':''}>${label}</button>`).join('')}</div><p class="save-state" role="status">${esc(note)}</p>${extra}</article>`;
 }).join('') : '<p class="muted">Участник не найден. Попробуйте другое имя.</p>';
}
function update() { if (screen !== 'journal') return; const q = query; render(); query = q; }
// In-memory adapter models the command semantics; it is not an HTTP/auth implementation.
async function mark(id, status, retry = false) {
 if (!authenticated || loading) return;
 const old = pending.get(id); if (old && !retry) return;
 const command = old || { operation_id: crypto.randomUUID(), base_version: entry(id).attendance.version, status };
 pending.set(id, command); states.set(id, {kind:'saving',text:'Сохраняется…'}); renderRoster();
 const token = generation, mode = scenario;
 await wait(); if (token !== generation) return;
 if (mode === 'network' || mode === 'error') { states.set(id,{kind:'retry',text:mode==='network'?'Нет связи · сохранение не подтверждено':'Сервис недоступен · сохранение не подтверждено'}); update(); return; }
 if (mode === 'expired') { generation++; authenticated = false; pending.clear(); states.clear(); screen = 'login'; render(); document.querySelector('#login-error').textContent = 'Сессия истекла. Войдите снова; журнал будет перечитан.'; return; }
 if (mode === 'forbidden') { pending.delete(id); states.set(id,{kind:'denied',text:'Нет права изменить отметку. Изменение не сохранено.'}); update(); return; }
 const current = server.roster.find(e=>e.athlete_id===id);
 if (mode === 'conflict' && !replies.has(command.operation_id)) { current.attendance = recorded(current, command.status==='absent'?'present':'absent'); scenario='normal'; scenarioSelect.value='normal'; }
 let reply = replies.get(command.operation_id);
 if (!reply) {
  if (current.attendance.version !== command.base_version) reply = {kind:'conflict',attendance:structuredClone(current.attendance)};
  else { current.attendance = recorded(current,command.status); reply={kind:'saved',attendance:structuredClone(current.attendance)}; }
  replies.set(command.operation_id,reply);
 }
 if (mode === 'lost' && !retry) { states.set(id,{kind:'retry',text:'Ответ не получен · результат неизвестен'}); update(); return; }
 pending.delete(id); entry(id).attendance=structuredClone(reply.attendance);
 states.set(id,reply.kind==='conflict'?{kind:'conflict',wanted:command.status,text:'Нужно разрешить конфликт'}:{kind:'saved',text:`Сохранено · ${time(reply.attendance.recorded_at)}`}); update();
}
function recorded(e,status) { return {athlete_id:e.athlete_id,status,version:e.attendance.version+1,recorded_at:new Date().toISOString(),recorded_by_account_id:'00000000-0000-4000-8000-000000000001'}; }
app.addEventListener('submit', async event => {
 if (event.target.id !== 'login') return; event.preventDefault();
 const button=event.target.querySelector('button');button.disabled=true;button.textContent='Входим…';loading=true;const token=generation;
 await wait();if(token!==generation)return;loading=false;authenticated=true;screen='sessions';view=structuredClone(server);states.clear();render();
});
app.addEventListener('input',event=>{if(event.target.id==='search'){query=event.target.value;renderRoster();}});
app.addEventListener('click',event=>{
 const b=event.target.closest('button[data-action]');if(!b)return;const id=b.dataset.id;
 switch(b.dataset.action){
  case 'open':screen='journal';render();break;
  case 'back':screen='sessions';render();break;
  case 'reload':render();break;
  case 'mark':mark(id,b.dataset.status);break;
  case 'retry':mark(id,pending.get(id).status,true);break;
  case 'accept':states.delete(id);update();break;
  case 'resolve':{const status=states.get(id).wanted;states.delete(id);mark(id,status);break;}
 }
});
logout.addEventListener('click',()=>{if(pending.size&&!confirm('Есть отметки без подтверждения. Выйти и перечитать журнал при следующем входе?'))return;generation++;authenticated=false;pending.clear();states.clear();screen='login';render();});
scenarioSelect.addEventListener('change',()=>{scenario=scenarioSelect.value;if(screen==='sessions')render();});
document.querySelector('#reset').addEventListener('click',()=>{scenario='normal';scenarioSelect.value='normal';reset();});
reset();
