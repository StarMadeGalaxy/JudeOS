const fs = require('node:fs');
const {test, expect} = require('@playwright/test');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const spec = JSON.parse(fs.readFileSync('dist/runtime-openapi.json'));
const ajv = new Ajv({strict:false,allErrors:true});addFormats(ajv);
const tenant = process.env.JUDEOS_BROWSER_TENANT || '00000000-0000-4000-8000-000000000101';
const ownerLogin=process.env.JUDEOS_BROWSER_OWNER || 'synthetic.browser.owner';
const coachLogin=process.env.JUDEOS_BROWSER_COACH || 'synthetic.browser.coach';
const staffPath = `/api/v1/tenants/${tenant}/staff`;
const password = 'synthetic-browser-password-123';
async function responseStatus(page,path) {
  return page.evaluate(async path=>{
    const response=await fetch(path);
    // Consume the body before navigating, so Playwright can validate the completed response.
    await response.arrayBuffer();
    return response.status;
  },path);
}
test('real HTTPS UI: invite → password → login → roles → revoke → logout',async({page,context,browser,baseURL})=>{
  const file = process.env.JUDEOS_BOOTSTRAP_LINK_FILE;
  test.skip(!file,'requires a disposable synthetic owner invitation file');
  const {token} = JSON.parse(fs.readFileSync(file,'utf8'));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const validation=[];
  page.on('response',response=>{
    const pathname=new URL(response.url()).pathname;
    if (!pathname.startsWith('/api/v1/')) return;
    validation.push((async()=>{
      const route=Object.keys(spec.paths).sort((a,b)=>(a.match(/\{/g)||[]).length-(b.match(/\{/g)||[]).length).find(p=>new RegExp('^'+p.replace(/\{[^}]+\}/g,'[^/]+')+'$').test(pathname));
      const op=spec.paths[route]?.[response.request().method().toLowerCase()];
      if (!op) throw new Error('Undocumented runtime response');
      let definition=op.responses[String(response.status())];
      if (!definition) throw new Error(`Undocumented status ${response.status()}`);
      if (definition.$ref) definition=definition.$ref.slice(2).split('/').reduce((v,k)=>v[k],spec);
      expect(response.headers()['cache-control']).toBe('no-store');
      if (response.status()!==204) {
        const validate=ajv.compile({...definition.content['application/json'].schema,components:spec.components});
        const body=await Promise.race([response.json(),new Promise((_,reject)=>setTimeout(()=>reject(new Error(`Response body unavailable: ${response.request().method()} ${route} ${response.status()}`)),5000))]);
        expect(validate(body),JSON.stringify(validate.errors)).toBe(true);
      }
    })().then(()=>null,e=>e));
  });
  await page.goto(`/#token=${token}`);
  await expect(page.getByRole('heading',{name:'Установить пароль'})).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await page.getByLabel('Новый пароль').fill(password);
  await page.getByRole('button',{name:'Установить пароль',exact:true}).click();
  await expect(page.locator('section > .status')).toContainText('Пароль установлен');
  await page.getByLabel('Логин',{exact:true}).fill(ownerLogin);
  await page.getByLabel('Пароль',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Сотрудники',exact:true})).toBeVisible();
  for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
  const cookies=await context.cookies();const session=cookies.find(c=>c.name==='__Host-judeos-session');
  expect(session.secure).toBe(true);expect(session.httpOnly).toBe(true);expect(session.sameSite).toBe('Lax');
  expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
  expect(await page.evaluate(()=>document.cookie)).not.toContain('__Host-judeos-session');
  const ownerRow=page.locator('.staff li').filter({has:page.getByText(ownerLogin,{exact:true})});
  page.once('dialog',d=>d.accept());await ownerRow.getByRole('button',{name:'Отозвать доступ',exact:true}).click();
  await expect(page.locator('section > .status')).toContainText('Изменение отклонено');
  await page.getByLabel('Логин нового сотрудника').fill(coachLogin);
  await page.getByRole('button',{name:'Создать приглашение',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'Приглашение сотруднику'});
  await expect(panel).toContainText(coachLogin);
  await expect(panel).toContainText('Ссылка действует до');
  await expect(panel).toContainText('Получатель открывает ссылку и устанавливает пароль');
  const pendingRow=page.locator('.staff li').filter({has:page.getByText(coachLogin,{exact:true})});
  await expect(pendingRow).toContainText('Ожидает установки пароля');
  const link=await page.getByLabel('Одноразовая ссылка').inputValue();
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:baseURL});
  await page.getByRole('button',{name:'Скопировать ссылку'}).click();
  await expect(panel).toContainText('Ссылка скопирована');
  expect(await page.evaluate(async value=>(await navigator.clipboard.readText())===value,link)).toBe(true);
  await page.getByRole('button',{name:'Скрыть ссылку',exact:true}).click();
  // Real same-document navigation must retain the current session until explicit logout.
  await page.evaluate(value=>{location.href=value;},link);
  await expect(page.getByRole('button',{name:'Выйти и установить пароль'})).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(await responseStatus(page,'/api/v1/access/session')).toBe(200);
  await page.getByRole('button',{name:'Остаться в рабочем пространстве'}).click();
  await expect(page.getByRole('heading',{name:'Сотрудники',exact:true})).toBeVisible();
  await page.goto(link);
  await expect(page.getByRole('button',{name:'Выйти и установить пароль'})).toBeVisible();
  await page.screenshot({path:'dist/access-invitation-session.png',fullPage:true});
  await page.getByRole('button',{name:'Выйти и установить пароль'}).click();
  await expect(page.getByLabel('Новый пароль')).toBeVisible();
  expect(await responseStatus(page,'/api/v1/access/session')).toBe(401);
  await page.getByLabel('Новый пароль').fill(password);
  await page.getByRole('button',{name:'Установить пароль',exact:true}).click();
  await expect(page.locator('section > .status')).toContainText('Пароль установлен');
  // Installing the recipient password must not change the original owner's credentials.
  await page.getByLabel('Логин',{exact:true}).fill(ownerLogin);
  await page.getByLabel('Пароль',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Сотрудники',exact:true})).toBeVisible();
  await expect(pendingRow).toContainText('Доступ активен');
  const coachContext=await browser.newContext({baseURL,ignoreHTTPSErrors:false});
  const coach=await coachContext.newPage();await coach.goto('/');
  await coach.getByLabel('Логин',{exact:true}).fill(coachLogin);await coach.getByLabel('Пароль',{exact:true}).fill(password);await coach.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(coach.getByRole('heading',{name:'Рабочее пространство'})).toBeVisible();
  await expect(coach.getByRole('heading',{name:'Сотрудники',exact:true})).toHaveCount(0);
  expect(await responseStatus(coach,staffPath)).toBe(403);
  await page.reload();await expect(page.getByRole('heading',{name:'Сотрудники',exact:true})).toBeVisible();
  const coachRow=page.locator('.staff li').filter({has:page.getByText(coachLogin,{exact:true})});
  await coachRow.getByRole('button',{name:'Выдать ссылку восстановления'}).click();
  await expect(panel).toContainText('Восстановление доступа');
  const resetLink=await page.getByLabel('Одноразовая ссылка').inputValue();
  await page.getByRole('button',{name:'Скрыть ссылку',exact:true}).click();
  await coach.goto(resetLink);
  await expect(coach.getByRole('button',{name:'Выйти и установить пароль'})).toBeVisible();
  await coach.getByRole('button',{name:'Выйти и установить пароль'}).click();
  await coach.getByLabel('Новый пароль').fill(password);
  await coach.getByRole('button',{name:'Установить пароль',exact:true}).click();
  await expect(coach.getByRole('status')).toContainText('Пароль установлен');
  await coach.getByLabel('Логин',{exact:true}).fill(coachLogin);
  await coach.getByLabel('Пароль',{exact:true}).fill(password);
  await coach.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(coach.getByRole('heading',{name:'Рабочее пространство',exact:true})).toBeVisible();
  await coachRow.getByLabel('Менеджер',{exact:true}).check();await coachRow.getByRole('button',{name:'Сохранить роли',exact:true}).click();
  await expect(page.locator('section > .status')).toContainText('Доступ обновлён');
  expect(await responseStatus(coach,'/api/v1/access/session')).toBe(401);
  await coach.reload();await expect(coach.getByRole('heading',{name:'Вход в клуб'})).toBeVisible();
  await coach.getByLabel('Логин',{exact:true}).fill(coachLogin);await coach.getByLabel('Пароль',{exact:true}).fill(password);await coach.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(coach.getByText('Ваши роли: Тренер, Менеджер.')).toBeVisible();
  page.once('dialog',d=>d.accept());await coachRow.getByRole('button',{name:'Отозвать доступ',exact:true}).click();await expect(page.locator('section > .status')).toContainText('Доступ обновлён');
  expect(await responseStatus(coach,'/api/v1/access/session')).toBe(401);
  await expect(coachRow).toContainText('Доступ отозван');
  await expect(coachRow.getByRole('button')).toHaveCount(0);
  for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`dist/access-staff-${width}.png`,fullPage:true});}
  await coachContext.close();
  await page.screenshot({path:'dist/access-staff.png',fullPage:true});
  await page.getByRole('button',{name:'Выйти',exact:true}).click();await expect(page.getByRole('heading',{name:'Вход в клуб'})).toBeVisible();
  const failures=(await Promise.all(validation)).filter(Boolean);
  expect(failures.map(e=>e.message)).toEqual([]);expect(errors).toEqual([]);
});
