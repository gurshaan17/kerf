import { expect, test } from '@playwright/test';
import { launchKerf } from './helpers';

test('creates a project from presets and updates the active sequence', async () => {
  const kerf = await launchKerf();
  const { page } = kerf;

  try {
    await expect(
      page.getByRole('heading', { name: 'Your projects' }),
    ).toBeVisible();

    await page.getByPlaceholder('New project').fill('Vertical social');
    await page.getByLabel('Aspect ratio').selectOption('9:16');
    await page.getByLabel('Frame rate').selectOption('60');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.locator('.k-shell__project-name')).toHaveText(
      'Vertical social',
    );
    await expect(page.locator('.k-shell__project-meta')).toHaveText(
      '1080 × 1920 · 60 fps',
    );

    await page.getByRole('button', { name: 'Sequence settings' }).click();
    await expect(
      page.getByRole('heading', { name: 'Sequence settings', exact: true }),
    ).toBeVisible();

    await page.getByLabel('Aspect ratio').selectOption('21:9');
    await page.getByLabel('Frame rate').selectOption('120');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    await expect(
      page.getByRole('heading', { name: 'Sequence settings', exact: true }),
    ).not.toBeVisible();
    await expect(page.locator('.k-shell__project-meta')).toHaveText(
      '2560 × 1080 · 120 fps',
    );

    const sequence = await page.evaluate(async () => {
      const active = await window.kerf.projects.active();
      return active?.project.sequence ?? null;
    });
    expect(sequence).toMatchObject({
      width: 2560,
      height: 1080,
      frameRate: { numerator: 120, denominator: 1 },
    });
  } finally {
    await kerf.close();
  }
});
