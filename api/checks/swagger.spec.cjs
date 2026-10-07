const { test, expect } = require('@playwright/test');
test('Swagger resolves the proposed operations and displays command and conflict examples', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.opblock')).toHaveCount(7);
  await page.locator('#operations-attendance-setAttendance .opblock-summary').click();
  await expect(page.locator('#operations-attendance-setAttendance')).toContainText('base_version');
  await expect(page.locator('#operations-attendance-setAttendance')).toContainText('ATTENDANCE_VERSION_CONFLICT');
  const spec = await page.evaluate(() => window.ui.specSelectors.specJson().toJS());
  expect(spec.openapi).toBe('3.0.3');
  expect(await page.locator('.errors-wrapper').count()).toBe(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'dist/swagger-preview.png', fullPage: true });
});
