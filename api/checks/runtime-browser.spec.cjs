const { test, expect } = require('@playwright/test');
test('built web shell works with live API at mobile and desktop widths', async ({page}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for (const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:850});
    await page.goto('/');
    await expect(page.getByRole('heading',{name:'Вход в клуб'})).toBeVisible();
    await page.getByRole('button',{name:'Проверить готовность'}).click();
    await expect(page.getByRole('status')).toHaveText('Тестовая среда готова.');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.route('**/readyz',route=>route.fulfill({status:503,contentType:'application/json',body:'{"code":"SERVICE_UNAVAILABLE"}'}));
  await page.getByRole('button',{name:'Проверить готовность'}).click();
  await expect(page.getByRole('status')).toContainText('Не удалось выполнить');
  await page.unroute('**/readyz');
  await page.route('**/readyz',route=>route.abort());
  await page.getByRole('button',{name:'Проверить готовность'}).click();
  await expect(page.getByRole('status')).toContainText('Не удалось связаться');
  expect(errors).toEqual([]);
  await page.screenshot({path:'dist/web-scaffold.png',fullPage:true});
});
test('runtime Swagger displays only implemented operations',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/docs');
  await expect(page.locator('.opblock')).toHaveCount(13);
  await page.locator('#operations-operations-getReadiness .opblock-summary').click();
  await expect(page.locator('#operations-operations-getReadiness')).toContainText('503');
  expect(await page.locator('.errors-wrapper').count()).toBe(0);
  expect(errors).toEqual([]);
  await page.screenshot({path:'dist/runtime-swagger.png',fullPage:true});
});
