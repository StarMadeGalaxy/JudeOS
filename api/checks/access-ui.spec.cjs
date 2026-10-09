const {test,expect}=require('@playwright/test');
const id='00000000-0000-4000-8000-000000000101';
const grants=[{role:'administrator',scope:'club'}];
const owner={account_id:id,expires_at:'2050-01-01T12:00:00Z',memberships:[{membership_id:id,tenant_id:id,club_name:'Синтетический клуб',grants}]};
async function server(page) {
  const state={signedIn:true,logout:0,redeem:0};
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const method=route.request().method();
    let status=200,body={};
    if(path.endsWith('/csrf'))body={csrf_token:'synthetic-csrf'};
    else if(path.endsWith('/session')){status=state.signedIn?200:401;body=state.signedIn?owner:{code:'SESSION_EXPIRED'};}
    else if(path.endsWith('/logout')){state.signedIn=false;state.logout++;status=204;}
    else if(path.endsWith('/redeem')){state.redeem++;expect(state.signedIn).toBe(false);status=204;}
    else if(path.endsWith('/people')&&method==='GET')body={items:[],next_cursor:null};
    else if(path.endsWith('/invitations'))body={token:'a'.repeat(64),expires_at:'2050-01-01T12:00:00Z'};
    else if(path.endsWith('/staff')&&method==='GET')body={items:[
      {membership_id:id,login:'synthetic.owner',active:true,state:'active',grants},
      {membership_id:'pending',login:'synthetic.coach',active:false,state:'pending',grants:[{role:'coach',scope:'assigned_sessions'}]},
      {membership_id:'revoked',login:'synthetic.revoked',active:false,state:'revoked',grants:[]}
    ]};
    else throw Error('Unexpected route '+method+' '+path);
    await route.fulfill({status,contentType:'application/json',body:status===204?undefined:JSON.stringify(body)});
  });
  return state;
}
test('states, invitation details and copy feedback are understandable',async({page})=>{
  await server(page);
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.syntheticCopied=text;}}}));
  await page.goto('/');
  await expect(page.getByText('Ожидает установки пароля',{exact:false})).toBeVisible();
  await expect(page.getByText('Доступ отозван',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Проверить готовность'})).toHaveCount(0);
  const revoked=page.locator('.staff li').filter({hasText:'synthetic.revoked'});
  await expect(revoked.getByRole('button')).toHaveCount(0);
  await page.getByLabel('Логин нового сотрудника').fill('synthetic.new.coach');
  await page.getByRole('button',{name:'Создать приглашение',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'Приглашение сотруднику'});
  await expect(panel).toContainText('synthetic.new.coach');
  await expect(panel).toContainText('Ссылка действует до');
  await expect(panel).toContainText('Получатель открывает ссылку и устанавливает пароль');
  await panel.getByRole('button',{name:'Скопировать ссылку'}).click();
  await expect(panel).toContainText('Ссылка скопирована');
  expect(await page.evaluate(()=>window.syntheticCopied)).toContain('/#token=');
  for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await panel.getByRole('button',{name:'Скрыть ссылку'}).click();
  await expect(panel).toHaveCount(0);
  await page.screenshot({path:'dist/access-states.png',fullPage:true});
});
test('same-document fragment and loaded invitation preserve session until explicit logout',async({page})=>{
  const state=await server(page);
  await page.goto('/');await expect(page.getByRole('heading',{name:'Сотрудники',exact:true})).toBeVisible();
  await page.evaluate(()=>{location.hash='token='+'b'.repeat(64);});
  await expect(page.getByRole('button',{name:'Выйти и установить пароль'})).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');expect(state.logout).toBe(0);
  await page.getByRole('button',{name:'Остаться в рабочем пространстве'}).click();
  await expect(page.getByRole('heading',{name:'Сотрудники',exact:true})).toBeVisible();
  await page.goto('/#token='+'c'.repeat(64));
  await expect(page.getByRole('button',{name:'Выйти и установить пароль'})).toBeVisible();
  expect(state.logout).toBe(0);expect(state.redeem).toBe(0);
  await page.getByRole('button',{name:'Выйти и установить пароль'}).click();
  await page.getByLabel('Новый пароль').fill('Synthetic-password-21');
  await page.getByRole('button',{name:'Установить пароль',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Вход в клуб',exact:true})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Пароль установлен');
  expect(state.logout).toBe(1);expect(state.redeem).toBe(1);
});

test('registry next page remains visible after the read finishes',async({page})=>{
  await server(page);
  await page.route('**/api/v1/tenants/*/people*',async route=>{
    const url=new URL(route.request().url());
    const next=url.searchParams.has('cursor');
    const items=next?[{person_id:'00000000-0000-4000-8000-000000000999',display_name:'Синтетическая следующая страница',archived:false,version:1}]:[{person_id:'00000000-0000-4000-8000-000000000901',display_name:'Синтетическая первая страница',archived:false,version:1}];
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items,next_cursor:next?null:'00000000-0000-4000-8000-000000000901'})});
  });
  await page.goto('/');
  const registry=page.getByLabel('Реестр клуба');
  await registry.getByRole('button',{name:'Следующая страница',exact:true}).click();
  await page.waitForLoadState('networkidle');
  await expect(registry.getByRole('button',{name:/Синтетическая следующая страница/})).toBeVisible();
  await expect(registry.locator('.records > li')).toHaveCount(2);
  await expect(registry.getByRole('button',{name:'Следующая страница',exact:true})).toHaveCount(0);
});
