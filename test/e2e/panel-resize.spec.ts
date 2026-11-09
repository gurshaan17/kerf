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
    const inspector = page.getByRole('complementary', {
      name: 'Inspector',
      exact: true,
    });
    const rightDivider = page.getByRole('separator', {
      name: 'Resize inspector panel',
    });
    const rightHandle = await rightDivider.boundingBox();
    const originalRightWidth = (await inspector.boundingBox())!.width;
    await page.mouse.move(rightHandle!.x + 3, rightHandle!.y + 100);
    await page.mouse.down();
    await page.mouse.move(rightHandle!.x - 97, rightHandle!.y + 100);
    await page.mouse.up();
    expect((await inspector.boundingBox())!.width).toBeGreaterThan(
      originalRightWidth + 90,
    );
    await rightDivider.focus();
    await page.keyboard.press('Home');
    expect((await inspector.boundingBox())!.width).toBe(280);
    await page.keyboard.press('ArrowLeft');
    expect((await inspector.boundingBox())!.width).toBe(290);
    await page.keyboard.press('End');
    expect(
      (await page.locator('.k-shell__center').boundingBox())!.width,
    ).toBeGreaterThanOrEqual(359);
    await kerf.app.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.setSize(1100, 800);
    });
    await expect
      .poll(async () => {
        const rect = await inspector.boundingBox();
        return (
          rect!.x + rect!.width <=
          (await page.evaluate(() => window.innerWidth))
        );
      })
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await page.locator('.k-shell__center').boundingBox())!.width,
      )
      .toBeGreaterThanOrEqual(359);
    expect((await inspector.boundingBox())!.width).toBeGreaterThanOrEqual(280);
    expect((await panel.boundingBox())!.width).toBeGreaterThanOrEqual(280);
    await page.screenshot({ path: 'test-results/inspector-resized.png' });
    await rightDivider.dblclick();
    await expect(rightDivider).toHaveAttribute('aria-valuenow', '300');
    await page.getByRole('button', { name: 'Motion', exact: true }).click();
    await rightDivider.focus();
    await page.keyboard.press('End');
    expect((await inspector.boundingBox())!.width).toBeGreaterThan(400);
    expect(
      (await page.locator('.k-shell__center').boundingBox())!.width,
    ).toBeGreaterThanOrEqual(359);
  } finally {
    await kerf.close();
  }
});
