import { expect, test } from '@playwright/test';
import { ensureCaptionFixture, launchKerf } from './helpers';

const fixture = 'caption-source.mp4';

test('verifies a transcript in the side panel', async () => {
  const source = ensureCaptionFixture();
  const kerf = await launchKerf();
  const { page } = kerf;

  try {
    await page.getByPlaceholder('New project').fill('Transcript review');
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
        window.kerf.analysis.run({ assetId: id, kinds: ['transcript'] }),
      assetId,
    );
    await expect
      .poll(
        async () =>
          page.evaluate(async (id) => {
            const status = await window.kerf.analysis.status();
            return (
              status.find((entry) => entry.assetId === id)?.transcript ?? false
            );
          }, assetId),
        { timeout: 180_000 },
      )
      .toBe(true);

    // The bin badge is the primary way in.
    await card.click();
    await page.getByRole('button', { name: 'Transcript', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Transcript', exact: true }),
    ).toBeVisible();

    const segments = page.locator('[data-transcript-segment]');
    await expect(segments).toHaveCount(2);
    await expect(segments.first()).toBeVisible();

    const aside = page.locator('aside[aria-label="Inspector"]');
    await expect(aside).toContainText('2 segments');
    await expect(aside).toContainText('EN');
    const asideBox = await aside.boundingBox();
    expect(asideBox?.width).toBeGreaterThan(280);
    expect(asideBox?.width).toBeLessThan(320);
    const videoBox = await page.locator('video').boundingBox();
    expect(videoBox?.width).toBeGreaterThan(240);
    expect(videoBox?.width).toBeLessThan(asideBox?.width ?? 0);

    // No visible child may spill past the panel.
    const spill = await page.evaluate(() => {
      const element = document.querySelector('aside[aria-label="Inspector"]');
      if (!element) {
        return null;
      }
      const right = element.getBoundingClientRect().right;
      return [...element.querySelectorAll('*')]
        .filter((child) => getComputedStyle(child).visibility !== 'hidden')
        .filter((child) => child.getBoundingClientRect().right - right > 0.5)
        .length;
    });
    expect(spill).toBe(0);

    // Clicking a segment plays the source at that moment and marks it active.
    await segments.first().click();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const video = document.querySelector('video');
          return video ? video.currentTime : 0;
        }),
      )
      .toBeGreaterThan(0);
    await expect(segments.first()).toHaveAttribute('data-active', 'true');
    await expect(page.getByText('Clip is not on the timeline')).toHaveCount(0);

    await page.getByLabel('Find in transcript').fill('caption');
    await expect(segments).toHaveCount(1);
    await page.getByLabel('Find in transcript').fill('');
    await expect(segments).toHaveCount(2);

    await page.getByRole('button', { name: 'Copy transcript' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('local first video editor');

    await page.getByRole('button', { name: 'Close transcript' }).click();
    await expect(
      page.getByRole('heading', { name: 'Transcript', exact: true }),
    ).toHaveCount(0);

    // The palette opens the same panel for a selected timeline clip.
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
    await page.getByLabel('Search commands').fill('view transcript');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Transcript', exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-transcript-segment]')).toHaveCount(2);
  } finally {
    await kerf.close();
  }
});
