import { expect, test } from '@playwright/test';
import { ensureBeatsFixture, launchKerf } from './helpers';

const fixture = 'beats-source.wav';

test('places beat markers and splits clips from the beat panel', async () => {
  const source = ensureBeatsFixture();
  const kerf = await launchKerf();
  const { page } = kerf;

  try {
    await page.getByPlaceholder('New project').fill('Beat grid');
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

    // Beats only act on clips that are already on the timeline.
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
      return services.tools.call('insertAudio', { assetId: id }, 'user');
    }, assetId);

    await page.evaluate(
      async (id) => window.kerf.analysis.run({ assetId: id, kinds: ['beats'] }),
      assetId,
    );
    await expect
      .poll(
        async () =>
          page.evaluate(async (id) => {
            const status = await window.kerf.analysis.status();
            return (
              status.find((entry) => entry.assetId === id)?.beatMap ?? false
            );
          }, assetId),
        { timeout: 180_000 },
      )
      .toBe(true);

    const bpm = await page.evaluate(async (id) => {
      const status = await window.kerf.analysis.status();
      return status.find((entry) => entry.assetId === id)?.bpm ?? null;
    }, assetId);
    expect(bpm).not.toBeNull();
    expect(bpm ?? 0).toBeGreaterThan(115);
    expect(bpm ?? 0).toBeLessThan(125);

    // The badge becomes the way into the beat panel and carries the tempo.
    await card.click();
    const beatsBadge = page.locator('button[title="View beats"]');
    await expect(beatsBadge).toContainText('BPM');
    await beatsBadge.click();
    await expect(
      page.getByRole('heading', { name: 'Beats', exact: true }),
    ).toBeVisible();

    const aside = page.locator('aside[aria-label="Inspector"]');
    await expect(aside).toContainText('BPM');
    await expect(aside).toContainText(
      `${Number.isInteger(bpm) ? bpm : (bpm ?? 0).toFixed(1)} BPM`,
    );
    await expect(page.locator('[data-beat-strip]')).toBeVisible();
    const sections = page.locator('[data-beat-section]');
    await expect(sections).not.toHaveCount(0);

    // Sparse keeps the ruler readable: every fourth beat.
    const sparse = page.locator('[data-beat-density="sparse"]');
    await sparse.click();
    await expect(sparse).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Add markers' }).click();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const snapshot = await window.kerf.projects.active();
          return snapshot?.project.sequence.markers.length ?? 0;
        }),
      )
      .toBeGreaterThan(0);
    await expect(page.locator('.k-ruler-marker').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add markers' }),
    ).toBeDisabled();

    // Sections seek both the source and the timeline playhead.
    const sectionCount = await sections.count();
    expect(sectionCount).toBeGreaterThan(0);
    await sections.first().click();
    await expect(sections.first()).toHaveAttribute('data-active', 'true');
    await expect(page.getByText('Clip is not on the timeline')).toHaveCount(0);

    await page.getByRole('button', { name: 'Split on beats' }).click();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const snapshot = await window.kerf.projects.active();
          const track = snapshot?.project.sequence.tracks.find((candidate) =>
            candidate.clips.some((clip) => clip.type === 'audio'),
          );
          return track?.clips.length ?? 0;
        }),
      )
      .toBeGreaterThan(1);
    await expect(page.locator('.k-clip').first()).toBeVisible();

    await page.getByRole('button', { name: 'Close beats' }).click();
    await expect(
      page.getByRole('heading', { name: 'Beats', exact: true }),
    ).toHaveCount(0);

    // The palette opens the same panel for a selected timeline clip.
    await page.locator('.k-clip').first().click();
    await page.keyboard.press('Meta+k');
    await page.getByLabel('Search commands').fill('view beats');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Beats', exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-beat-strip]')).toBeVisible();
  } finally {
    await kerf.close();
  }
});
