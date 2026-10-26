import { expect, test } from '@playwright/test';
import { ensureScenesFixture, launchKerf } from './helpers';

const fixture = 'scenes-source.mp4';

interface SceneRecord {
  readonly id: string;
  readonly assetId: string;
  readonly index: number;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly thumbnailPath: string | null;
  readonly description: string | null;
  readonly score: number;
}

interface SeedServices {
  readonly repository: {
    listScenes(projectId: string): SceneRecord[];
    saveScene(scene: SceneRecord): SceneRecord;
  };
  readonly projects: {
    current(): { readonly project: { readonly id: string } } | null;
    refresh(reason: string): unknown;
  };
}

test('reviews and re-runs scene descriptions from the side panel', async () => {
  const source = ensureScenesFixture();
  const kerf = await launchKerf();
  const { page } = kerf;

  try {
    await page.getByPlaceholder('New project').fill('Description index');
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

    // Cloud vision is not configured in E2E. Seed two saved descriptions so
    // the review surface can be exercised without making a provider request.
    const seeded = await kerf.app.evaluate(async (_electron, id) => {
      const services = (globalThis as { __kerfServices?: SeedServices })
        .__kerfServices;
      if (!services) {
        throw new Error('The E2E service hook is unavailable.');
      }
      const active = services.projects.current();
      if (!active) {
        throw new Error('No project is open.');
      }
      const scenes = services.repository
        .listScenes(active.project.id)
        .filter((scene) => scene.assetId === id)
        .sort((left, right) => left.index - right.index);
      for (const [index, scene] of scenes.slice(0, 2).entries()) {
        services.repository.saveScene({
          ...scene,
          description:
            index === 0
              ? 'A wide red field with a soft gradient.'
              : 'A green field with a bright horizon.',
        });
      }
      services.projects.refresh('analysis');
      return scenes.length;
    }, assetId);
    expect(seeded).toBeGreaterThanOrEqual(3);

    await card.click();
    const badge = page.locator('button[title="Review descriptions"]');
    await expect(badge).toContainText('2 described');
    await badge.click();
    await expect(
      page.getByRole('heading', { name: 'Descriptions', exact: true }),
    ).toBeVisible();

    const rows = page.locator('[data-description-row]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText(
      'A wide red field with a soft gradient.',
    );
    await expect(rows.nth(1)).toContainText(
      'A green field with a bright horizon.',
    );
    await expect(rows.nth(2)).toContainText('Not described yet');

    const aside = page.locator('aside[aria-label="Inspector"]');
    await expect(aside).toContainText('2 of 3 described');
    await expect(aside).toContainText('1 missing');
    await expect(aside).toContainText('Describe missing');
    await expect(aside).toContainText('Re-run all');
    const asideBox = await aside.boundingBox();
    expect(asideBox?.width).toBeGreaterThan(280);
    expect(asideBox?.width).toBeLessThan(320);
    // The inspector is overflow-hidden, so a hidden tooltip bubble can inflate
    // its scrollWidth without being visible. Check the content that must fit.
    expect(
      await aside.evaluate((node) =>
        [
          ...node.querySelectorAll<HTMLElement>(
            '[data-description-actions], [data-description-actions] button, [data-description-row]',
          ),
        ]
          .filter((entry) => entry.scrollWidth > entry.clientWidth + 1)
          .map((entry) => entry.textContent?.trim()),
      ),
    ).toEqual([]);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const images = [
            ...document.querySelectorAll('[data-description-row] img'),
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

    // Clicking a row seeks the shared source preview and marks it active.
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveAttribute('data-active', 'true');
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const video = document.querySelector('video');
          return video ? video.currentTime : 0;
        }),
      )
      .toBeGreaterThan(1);

    // Without a vision provider the request is rejected before any network
    // call, but the panel wiring and missing-only path still run.
    await page.getByRole('button', { name: 'Describe missing' }).click();
    await expect(page.getByText('vision skipped')).toBeVisible();
    await expect(
      page.getByText(
        'Enable a vision provider and grant per-account consent first.',
      ),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Close descriptions' }).click();
    await expect(
      page.getByRole('heading', { name: 'Descriptions', exact: true }),
    ).toHaveCount(0);

    // The palette opens the same review surface for a selected timeline clip.
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
    await page.getByLabel('Search commands').fill('view descriptions');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Descriptions', exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-description-row]')).toHaveCount(3);
  } finally {
    await kerf.close();
  }
});
