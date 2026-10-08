const {test,expect}=require('../../../api/node_modules/@playwright/test');
async function login(page){await page.goto('/');await page.getByLabel('Пароль',{exact:true}).fill('synthetic');await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(page.getByRole('heading',{name:'Мои занятия'})).toBeVisible();}
async function journal(page){await login(page);await page.getByRole('button',{name:/Открыть журнал/}).click();}
async function scenario(page,value){await page.locator('summary').click();await page.getByLabel('Сценарий проверки').selectOption(value);}
function card(page){return page.locator('.athlete').first();}
test('mobile journal supports four marks, searching and no overflow',async({page})=>{
 await journal(page);await expect(page.locator('.athlete')).toHaveCount(6);
 for(const name of ['Присутствовал','Отсутствовал','Болел','Другая причина']){await card(page).getByRole('button',{name,exact:true}).click();await expect(card(page).getByRole('status')).toContainText('Сохранено');await expect(card(page).getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');}
 await page.getByRole('searchbox').fill('Мария');await expect(page.locator('.athlete')).toHaveCount(1);await page.getByRole('searchbox').fill('');
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.fonts.check('400 16px Rubik','Присутствовал'))).toBeTruthy();await page.screenshot({path:'docs/prototypes/online-journal/dist/journal-mobile.png',fullPage:true});
});
test('lost response retries same operation once and retains confirmed choice',async({page})=>{
 await journal(page);await scenario(page,'lost');await card(page).getByRole('button',{name:'Присутствовал',exact:true}).click();await expect(card(page)).toContainText('результат неизвестен');await expect(card(page).getByRole('button',{name:'Присутствовал',exact:true})).toHaveAttribute('aria-pressed','false');await card(page).getByRole('button',{name:'Повторить сохранение'}).click();await expect(card(page).getByRole('status')).toContainText('Сохранено');await expect(card(page).getByRole('button',{name:'Присутствовал',exact:true})).toHaveAttribute('aria-pressed','true');
});
test('network failure can recover and conflict needs explicit resolution',async({page})=>{
 await journal(page);await scenario(page,'network');await card(page).getByRole('button',{name:'Болел',exact:true}).click();await expect(card(page)).toContainText('сохранение не подтверждено');await page.getByLabel('Сценарий проверки').selectOption('normal');await card(page).getByRole('button',{name:'Повторить сохранение'}).click();await expect(card(page).getByRole('status')).toContainText('Сохранено');
 await page.getByLabel('Сценарий проверки').selectOption('conflict');await card(page).getByRole('button',{name:'Присутствовал',exact:true}).click();await expect(card(page)).toContainText('Другой тренер изменил отметку');await card(page).getByRole('button',{name:'Сохранить мой выбор'}).click();await expect(card(page).getByRole('status')).toContainText('Сохранено');
});
test('empty, denied, server unavailable and expired session remain actionable',async({page})=>{
 await login(page);await scenario(page,'empty');await expect(page.getByRole('heading',{name:'На этот день занятий нет'})).toBeVisible();await page.getByLabel('Сценарий проверки').selectOption('error');await expect(page.getByRole('alert')).toContainText('Сервис временно недоступен');await page.getByLabel('Сценарий проверки').selectOption('normal');await page.getByRole('button',{name:/Открыть журнал/}).click();await page.getByLabel('Сценарий проверки').selectOption('forbidden');await card(page).getByRole('button',{name:'Присутствовал',exact:true}).click();await expect(card(page)).toContainText('Изменение не сохранено');await page.getByLabel('Сценарий проверки').selectOption('expired');await card(page).getByRole('button',{name:'Присутствовал',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Сессия истекла');
});
