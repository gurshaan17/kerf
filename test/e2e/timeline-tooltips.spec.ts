import { expect, test } from '@playwright/test';
import { launchKerf } from './helpers';

test('timeline tooltips stay visible outside the clipped pane', async () => {
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  try {
    await page.getByPlaceholder('New project').fill('Timeline tooltips');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const toolbar = page.locator('.k-timeline__toolbar');

    const expectUnclipped = async (label: string) => {
      const tooltip = page.getByRole('tooltip', { name: label, exact: true });
      await expect(tooltip).toBeVisible();
      await expect
        .poll(() =>
          tooltip.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            if (
              rect.left < 0 ||
              rect.top < 0 ||
              rect.right > innerWidth ||
              rect.bottom > innerHeight
            )
              return false;
            for (
              let parent = element.parentElement;
              parent;
              parent = parent.parentElement
            ) {
              const style = getComputedStyle(parent);
              const bounds = parent.getBoundingClientRect();
              if (
                /(hidden|clip|auto|scroll)/.test(style.overflowX) &&
                (rect.left < bounds.left || rect.right > bounds.right)
              )
                return false;
              if (
                /(hidden|clip|auto|scroll)/.test(style.overflowY) &&
                (rect.top < bounds.top || rect.bottom > bounds.bottom)
              )
                return false;
            }
            return true;
          }),
        )
        .toBe(true);
    };

    await toolbar
      .getByRole('button', { name: 'Select tool', exact: true })
      .hover();
    await expectUnclipped('Select (V)');
    await toolbar
      .getByRole('button', { name: 'Snapping', exact: true })
      .hover();
    await expectUnclipped('Snapping on (N)');
    await page.mouse.move(0, 0);
    await expect(
      page.getByRole('tooltip', { name: 'Snapping on (N)', exact: true }),
    ).toBeHidden();
    await toolbar
      .getByRole('button', { name: 'Select tool', exact: true })
      .focus();
    await page.keyboard.press('Tab');
    await expectUnclipped('Blade tool (B)');
    await page.screenshot({ path: 'test-results/timeline-tooltip.png' });
  } finally {
    await kerf.close();
  }
});
