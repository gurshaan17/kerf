import { expect, test } from '@playwright/test';
import { launchKerf } from './helpers';

test('creates a project and opens core panels from the keyboard', async () => {
  const kerf = await launchKerf();
  const { page } = kerf;

  try {
    await expect(
      page.getByRole('heading', { name: 'Your projects' }),
    ).toBeVisible();

    await page.keyboard.press('Tab');
    const projectName = page.getByPlaceholder('New project');
    await expect(projectName).toBeFocused();
    await page.keyboard.type('Keyboard Project');
    await page.keyboard.press('Enter');
    await expect(page.locator('.k-shell__project-name')).toHaveText(
      'Keyboard Project',
    );
    await expect(
      page.getByRole('region', { name: 'Getting started' }),
    ).toBeVisible();

    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) {
        return null;
      }
      const style = getComputedStyle(element);
      return {
        label:
          element.getAttribute('aria-label') ??
          element.textContent?.trim() ??
          element.tagName,
        boxShadow: style.boxShadow,
      };
    });
    expect(focus).not.toBeNull();
    expect(focus?.boxShadow).not.toBe('none');

    await page.keyboard.press('Meta+k');
    await expect(
      page
        .getByRole('dialog')
        .getByRole('heading', { name: 'Command palette' }),
    ).toBeVisible();
    await page.getByLabel('Search commands').fill('shortcuts');
    await page.keyboard.press('Enter');
    await expect(
      page
        .getByRole('dialog')
        .getByRole('heading', { name: 'Keyboard shortcuts' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.keyboard.press('Meta+k');
    await page.getByLabel('Search commands').fill('about');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'About Kerf' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.keyboard.press('Meta+k');
    await page.getByLabel('Search commands').fill('export');
    await page.keyboard.press('Enter');
    await expect(
      page
        .getByRole('dialog')
        .getByRole('heading', { name: 'Export', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  } finally {
    await kerf.close();
  }
});
