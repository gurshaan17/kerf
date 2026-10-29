import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  ensureCaptionFixture,
  launchKerf,
  probeDurationSeconds,
} from './helpers';

test('creates, imports, cuts, captions and exports a project', async () => {
  const perf = process.env.KERF_PERF === '1';
  const launchStartedAt = Date.now();
  const fixture = ensureCaptionFixture();
  const kerf = await launchKerf();
  const { page } = kerf;

  try {
    await expect(
      page.getByRole('heading', { name: 'Your projects' }),
    ).toBeVisible();
    if (perf) {
      console.log(`[perf] startup ${Date.now() - launchStartedAt}ms`);
      const mainPerf = await kerf.app.evaluate(
        () =>
          (
            globalThis as {
              __kerfPerf?: {
                bootStartedAt: number;
                windowReadyAt: number | null;
              };
            }
          ).__kerfPerf ?? null,
      );
      if (
        mainPerf?.windowReadyAt !== null &&
        mainPerf?.windowReadyAt !== undefined
      ) {
        console.log(
          `[perf] main window ready ${Math.round(
            mainPerf.windowReadyAt - mainPerf.bootStartedAt,
          )}ms`,
        );
      }
    }

    await page.getByPlaceholder('New project').fill('E2E Journey');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.locator('.k-shell__project-name')).toHaveText(
      'E2E Journey',
    );

    const importStartedAt = Date.now();
    await page.evaluate(async (path) => {
      await window.kerf.assets.import([path]);
    }, fixture);

    const assetCard = page.locator('button[title="caption-source.mp4"]');
    await expect(assetCard).toBeVisible();
    await expect(assetCard).toContainText('Ready', { timeout: 120_000 });
    if (perf) {
      console.log(`[perf] ingest ${Date.now() - importStartedAt}ms`);
    }

    const assetId = await page.evaluate(async () => {
      const assets = await window.kerf.assets.list();
      return assets.find((asset) => asset.name === 'caption-source.mp4')?.id;
    });
    expect(assetId).toBeTruthy();
    if (!assetId) {
      throw new Error('The imported asset did not get an id.');
    }

    const lane = page.locator('[data-track-kind="video"]').first();
    const laneBox = await lane.boundingBox();
    if (!laneBox) {
      throw new Error('The video track is not visible.');
    }
    await page.evaluate(
      ({ id, clientX, clientY }) => {
        const source = document.querySelector<HTMLElement>(
          'button[title="caption-source.mp4"]',
        );
        const target = document.querySelector<HTMLElement>(
          '[data-track-kind="video"]',
        );
        if (!source || !target) {
          throw new Error('The drag source or timeline lane is missing.');
        }
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('application/x-kerf-asset', id);
        source.dispatchEvent(
          new DragEvent('dragstart', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          }),
        );
        target.dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX,
            clientY,
          }),
        );
        target.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX,
            clientY,
          }),
        );
      },
      {
        id: assetId,
        clientX: laneBox.x + 12,
        clientY: laneBox.y + laneBox.height / 2,
      },
    );

    const clips = page.locator('.k-clip--video');
    await expect(clips).toHaveCount(1);

    const clipBox = await clips.first().boundingBox();
    const rulerBox = await page.locator('.k-timeline__ruler').boundingBox();
    if (!clipBox || !rulerBox) {
      throw new Error('The clip or timeline ruler is not visible.');
    }
    const seekStartedAt = Date.now();
    await page.mouse.click(
      clipBox.x + clipBox.width / 2,
      rulerBox.y + rulerBox.height / 2,
    );
    if (perf) {
      await expect(page.locator('.k-stage__frame-canvas')).not.toHaveAttribute(
        'aria-label',
        'Frame 0',
      );
      console.log(`[perf] seek ${Date.now() - seekStartedAt}ms`);
    }
    await page.getByRole('button', { name: 'Split at playhead' }).click();
    await expect(clips).toHaveCount(2);

    const analysis = await page.evaluate(
      async (id) =>
        window.kerf.analysis.run({
          assetId: id,
          kinds: ['transcript'],
        }),
      assetId,
    );
    expect(analysis.skipped).toHaveLength(0);
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

    // Verify the transcript viewer: select the source in the bin, open it from
    // the badge, and confirm segments plus the inline source player render.
    await assetCard.click();
    await page.getByRole('button', { name: 'Transcript', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Transcript', exact: true }),
    ).toBeVisible();
    const transcriptSegments = page.locator('[data-transcript-segment]');
    await expect(transcriptSegments.first()).toBeVisible();
    await expect(
      page.locator('video[src^="kerfmedia://"][src$="/source"]'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close transcript' }).click();
    await expect(
      page.getByRole('heading', { name: 'Transcript', exact: true }),
    ).toHaveCount(0);

    const captionResult = await kerf.app.evaluate(async (_electron, id) => {
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
      return services.tools.call(
        'writeCaptions',
        { assetId: id, preset: 'clean' },
        'user',
      );
    }, assetId);
    expect(captionResult).toMatchObject({
      captionCount: expect.any(Number),
    });
    await expect(page.locator('.k-clip--caption').first()).toBeAttached();
    await expect(
      page.locator('[data-track-kind="caption"]').first(),
    ).toBeAttached();

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const exportDialog = page.getByRole('dialog');
    await expect(
      exportDialog.getByRole('heading', { name: 'Export', exact: true }),
    ).toBeVisible();
    await exportDialog.getByLabel('Duration (seconds)').fill('2');
    if (perf) {
      await page.evaluate(() => {
        const target = window as unknown as {
          __kerfExportPerf?: {
            startedAt: number;
            events: Array<{
              status: string;
              progress: number;
              at: number;
            }>;
          };
        };
        target.__kerfExportPerf = { startedAt: 0, events: [] };
        window.kerf.events.subscribe((event) => {
          if (event.type !== 'export.changed') {
            return;
          }
          target.__kerfExportPerf?.events.push({
            status: event.export.status,
            progress: event.export.progress,
            at: performance.now(),
          });
        });
      });
    }
    const exportStartedAt = Date.now();
    if (perf) {
      await page.evaluate(() => {
        const target = window as unknown as {
          __kerfExportPerf?: { startedAt: number };
        };
        if (target.__kerfExportPerf) {
          target.__kerfExportPerf.startedAt = performance.now();
        }
      });
    }
    await exportDialog.getByRole('button', { name: 'Export MP4' }).click();
    await expect(
      exportDialog.getByText('Complete', { exact: true }),
    ).toBeVisible({ timeout: 180_000 });
    if (perf) {
      const measured = await page.evaluate(() => {
        const target = window as unknown as {
          __kerfExportPerf?: {
            startedAt: number;
            events: Array<{
              status: string;
              progress: number;
              at: number;
            }>;
          };
        };
        return target.__kerfExportPerf ?? null;
      });
      const rendering = measured?.events.find(
        (event) => event.status === 'encoding' || event.progress >= 0.8,
      );
      if (measured && rendering) {
        const renderMs = rendering.at - measured.startedAt;
        const fps = 48 / (renderMs / 1_000);
        console.log(
          `[perf] export render ${renderMs.toFixed(0)}ms (48 frames, ${fps.toFixed(1)}fps), total ${Date.now() - exportStartedAt}ms`,
        );
      }
    }

    const records = await kerf.app.evaluate(() => {
      const services = (
        globalThis as {
          __kerfServices?: {
            exports: {
              list: () => Array<{
                status: string;
                outputPath: string;
              }>;
            };
          };
        }
      ).__kerfServices;
      if (!services) {
        throw new Error('The E2E service hook is unavailable.');
      }
      return services.exports.list();
    });
    const exported = records.find((record) => record.status === 'succeeded');
    expect(exported).toBeTruthy();
    if (!exported) {
      throw new Error('The export did not succeed.');
    }
    expect(existsSync(exported.outputPath)).toBe(true);
    expect(probeDurationSeconds(exported.outputPath)).toBeGreaterThan(1.5);
  } finally {
    await kerf.close();
  }
});
