import { expect, test } from '@playwright/test';
import { ensureScenesFixture, launchKerf } from './helpers';

test('previews and applies a vertical gaming Blueprint with undo', async () => {
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  try {
    await page.getByPlaceholder('New project').fill('Blueprint journey');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.locator('.gaming-demo video')).toHaveCount(0);
    const before = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    await page
      .getByRole('button', { name: 'Blueprints & brand kits', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Gaming shorts' });
    await expect(dialog.locator('.gaming-demo video')).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Apply Blueprint' }),
    ).toBeDisabled();
    await page.evaluate(
      async (path) => window.kerf.assets.import([path]),
      ensureScenesFixture(),
    );
    await expect(
      dialog.getByLabel('Choose a gaming clip').locator('option'),
    ).toHaveCount(2, { timeout: 120000 });
    await dialog
      .getByLabel('Choose a gaming clip')
      .selectOption({ label: 'scenes-source.mp4' });
    await dialog.getByLabel('Place the edit').selectOption('replace');
    await dialog.getByRole('button', { name: 'Apply Blueprint' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.gaming-demo video')).toHaveCount(0);
    const edited = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    expect(edited.width).toBe(1080);
    expect(edited.height).toBe(1920);
    expect(edited.tracks.flatMap((t) => t.clips)).toHaveLength(1);
    await page.evaluate(() => window.kerf.edits.undo());
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      ),
    ).toEqual(before);
  } finally {
    await kerf.close();
  }
});
