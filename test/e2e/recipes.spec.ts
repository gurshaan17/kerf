import { expect, test } from '@playwright/test';
import { launchKerf } from './helpers';
test('customizes, saves and applies a reusable blueprint', async () => {
  const kerf = await launchKerf();
  const { page } = kerf;
  try {
    await page.getByPlaceholder('New project').fill('Blueprint journey');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page
      .getByRole('button', { name: 'Blueprints & brand kits', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Blueprints & brand kits',
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByLabel('Blueprint', { exact: true }).locator('option'),
    ).toHaveCount(10);
    await dialog
      .getByLabel('Blueprint', { exact: true })
      .selectOption('quick-tip');
    await dialog.getByLabel('Section 1 title').fill('A faster workflow');
    await dialog.getByLabel('Saved blueprint name').fill('My quick tips');
    await dialog
      .getByRole('button', { name: 'Save blueprint & kit', exact: true })
      .click();
    await expect(dialog.getByRole('status')).toContainText('Saved locally');
    await dialog.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: '.cache/recipes-dialog.png' });
    await dialog
      .getByRole('button', { name: 'Append draft', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Undo', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Undo', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page
      .getByRole('button', { name: 'Blueprints & brand kits', exact: true })
      .click();
    await dialog
      .getByLabel('Blueprint', { exact: true })
      .selectOption({ label: 'My quick tips' });
    await expect(dialog.getByLabel('Section 1 title')).toHaveValue(
      'A faster workflow',
    );
    await page.reload();
    await page
      .getByRole('button', { name: 'Blueprints & brand kits', exact: true })
      .click();
    await expect(
      dialog.getByLabel('Blueprint', { exact: true }).locator('option'),
    ).toHaveCount(11);
  } finally {
    await kerf.close();
  }
});
