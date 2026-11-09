import { expect, test } from '@playwright/test';
import { launchKerf } from './helpers';

test('footage toolbar fits and workspace panel respects resize limits', async () => {
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  try {
    await page.getByPlaceholder('New project').fill('Panel resizing');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Footage bin' });
    const divider = page.getByRole('separator', {
      name: 'Resize workspace panel',
    });
    await expect(panel).toBeVisible();
    await divider.focus();
    await page.keyboard.press('Home');
    await expect(divider).toHaveAttribute('aria-valuenow', '280');
    const bounds = await panel.boundingBox();
    expect(bounds!.width).toBe(280);
    for (const button of await panel.locator('header button').all()) {
      const rect = await button.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(
        bounds!.x + bounds!.width,
      );
    }
    const handle = await divider.boundingBox();
    await page.mouse.move(handle!.x + 3, handle!.y + 100);
    await page.mouse.down();
    await page.mouse.move(handle!.x + 103, handle!.y + 100);
    await page.mouse.up();
    expect((await panel.boundingBox())!.width).toBeGreaterThan(350);
    await divider.focus();
    await page.keyboard.press('End');
    expect(
      (await page.locator('.k-shell__center').boundingBox())!.width,
    ).toBeGreaterThanOrEqual(359);
    await page.screenshot({ path: 'test-results/panel-expanded.png' });
    await page.keyboard.press('Home');
    await page.screenshot({ path: 'test-results/panel-minimum.png' });
  } finally {
    await kerf.close();
  }
});
