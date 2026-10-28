import { expect, test } from '@playwright/test';
import { launchKerf } from './helpers';

test('adds, previews and undoes a timed overlay', async () => {
  const kerf = await launchKerf();
  const { page } = kerf;

  try {
    await expect(
      page.getByRole('heading', { name: 'Your projects' }),
    ).toBeVisible();

    await page.getByPlaceholder('New project').fill('Overlay journey');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.locator('.k-shell__project-name')).toHaveText(
      'Overlay journey',
    );

    await page.getByRole('button', { name: 'Effects', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Effects', exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Add Blur', exact: true }).click();

    await expect(page.locator('.k-clip--fxOverlay')).toHaveCount(1);
    await expect(page.locator('[data-track-kind="effects"]')).toHaveCount(1);
    // Adding an overlay selects it so the preview handles appear immediately.
    await expect(page.locator('.k-clip--fxOverlay')).toHaveClass(/is-selected/);
    await expect(page.locator('.k-overlay-controls__region')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Overlay' })).toBeVisible();

    // The Effects track is created lazily, so undoing the first add removes it.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('.k-clip')).toHaveCount(0);
    await expect(page.locator('[data-track-kind="effects"]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.locator('.k-clip--fxOverlay')).toHaveCount(1);
    await expect(page.locator('[data-track-kind="effects"]')).toHaveCount(1);

    await page.locator('.k-effects__main').click();
    await expect(page.locator('.k-overlay-controls__region')).toBeVisible();

    await page
      .locator('.k-effects__actions button[aria-label="Delete overlay"]')
      .click();
    await expect(page.locator('.k-clip')).toHaveCount(0);
  } finally {
    await kerf.close();
  }
});
