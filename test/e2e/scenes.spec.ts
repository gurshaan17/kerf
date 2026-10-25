import { expect, test } from '@playwright/test';
import { ensureScenesFixture, launchKerf } from './helpers';

const fixture = 'scenes-source.mp4';

test('browses detected scenes in the side panel', async () => {
  const source = ensureScenesFixture();
  const kerf = await launchKerf();
  const { page } = kerf;

  try {
    await page.getByPlaceholder('New project').fill('Scene storyboard');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.evaluate(async (path) => {
      await window.kerf.assets.import([path]);
    }, source);

    const card = page.locator(`button[title="${fixture}"]`);
    await expect(card).toContainText('Ready', { timeout: 120_000 });

    const assetId = await page.evaluate(async (name) => {
      const assets = await window.kerf.assets.list();
      return assets.find((asset) => asset.name === name)?.id;
    }, fixture);
    expect(assetId).toBeTruthy();
    if (!assetId) {
      throw new Error('The imported asset did not get an id.');
    }

    await page.evaluate(
      async (id) =>
        window.kerf.analysis.run({ assetId: id, kinds: ['scenes'] }),
      assetId,
    );
    await expect
      .poll(
        async () =>
          page.evaluate(async (id) => {
            const status = await window.kerf.analysis.status();
            return (
              status.find((entry) => entry.assetId === id)?.sceneCount ?? 0
            );
          }, assetId),
        { timeout: 180_000 },
      )
      .toBeGreaterThanOrEqual(3);

    // The scene badge is the primary way into the storyboard.
    await card.click();
    await page.locator('button[title="View scenes"]').click();
    await expect(
      page.getByRole('heading', { name: 'Scenes', exact: true }),
    ).toBeVisible();

    const scenes = page.locator('[data-scene-card]');
    await expect(scenes).toHaveCount(3);

    const aside = page.locator('aside[aria-label="Inspector"]');
    await expect(aside).toContainText('3 shots');
    const asideBox = await aside.boundingBox();
    expect(asideBox?.width).toBeGreaterThan(280);
    expect(asideBox?.width).toBeLessThan(320);

    // Thumbnails are served through the dedicated scene media route.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const images = [
            ...document.querySelectorAll('[data-scene-card] img'),
          ] as HTMLImageElement[];
          return (
            images.length === 3 &&
            images.every(
              (image) =>
                image.getAttribute('src')?.startsWith('kerfmedia://scene/') &&
                image.complete &&
                image.naturalWidth > 0,
            )
          );
        }),
      )
      .toBe(true);

    // Clicking a shot plays the source at its first frame and marks it active.
    await scenes.nth(1).click();
    await expect(scenes.nth(1)).toHaveAttribute('data-active', 'true');
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const video = document.querySelector('video');
          return video ? video.currentTime : 0;
        }),
      )
      .toBeGreaterThan(1);
    await expect(page.getByText('Clip is not on the timeline')).toHaveCount(0);

    await page.getByRole('button', { name: 'Close scenes' }).click();
    await expect(
      page.getByRole('heading', { name: 'Scenes', exact: true }),
    ).toHaveCount(0);

    // The palette opens the same storyboard for a selected timeline clip.
    await kerf.app.evaluate(async (_electron, id) => {
      const services = (
        globalThis as {
          __kerfServices?: {
            tools: {
              call: (
                name: string,
                input: unknown,
                actor: string,
              ) => Promise<unknown>;
            };
          };
        }
      ).__kerfServices;
      if (!services) {
        throw new Error('The E2E service hook is unavailable.');
      }
      return services.tools.call('insertClip', { assetId: id }, 'user');
    }, assetId);
    await page.locator('.k-clip').first().click();
    await page.keyboard.press('Meta+k');
    await page.getByLabel('Search commands').fill('view scenes');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Scenes', exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-scene-card]')).toHaveCount(3);
  } finally {
    await kerf.close();
  }
});
