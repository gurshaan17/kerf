import { createCanvas, loadImage } from '@napi-rs/canvas';
import { expect, test } from '@playwright/test';
import type { Page } from 'playwright';
import { ensureScenesFixture, launchKerf } from './helpers';

const OVERLAY_KINDS = [
  { title: 'Blur' },
  { title: 'Callout' },
  { title: 'Spotlight' },
  { title: 'Zoom' },
] as const;

interface Rgba {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

function readPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): Rgba {
  const offset = (Math.round(y) * width + Math.round(x)) * 4;
  return {
    red: data[offset] ?? 0,
    green: data[offset + 1] ?? 0,
    blue: data[offset + 2] ?? 0,
  };
}

function expectClose(actual: Rgba, expected: Rgba, tolerance = 12): void {
  expect(Math.abs(actual.red - expected.red)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.green - expected.green)).toBeLessThanOrEqual(
    tolerance,
  );
  expect(Math.abs(actual.blue - expected.blue)).toBeLessThanOrEqual(tolerance);
}

function previewPixels(page: Page): Promise<{
  width: number;
  height: number;
  centre: Rgba;
  corner: Rgba;
}> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '.k-stage__frame-canvas',
    );
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      throw new Error('The preview canvas is not available.');
    }
    const sample = (x: number, y: number) => {
      const data = context.getImageData(x, y, 1, 1).data;
      return {
        red: data[0] ?? 0,
        green: data[1] ?? 0,
        blue: data[2] ?? 0,
      };
    };
    return {
      width: canvas.width,
      height: canvas.height,
      centre: sample(
        Math.round(canvas.width / 2),
        Math.round(canvas.height / 2),
      ),
      corner: sample(
        Math.round(canvas.width * 0.05),
        Math.round(canvas.height * 0.05),
      ),
    };
  });
}

test('adds, previews and undoes all four overlay kinds', async () => {
  const kerf = await launchKerf();
  const { page } = kerf;

  try {
    await expect(
      page.getByRole('heading', { name: 'Your projects' }),
    ).toBeVisible();

    await page.getByPlaceholder('New project').fill('Overlay journey');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.locator('.k-shell__project-name')).toHaveText(
      'Overlay journey',
    );

    await page.getByRole('button', { name: 'Effects', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Effects', exact: true }),
    ).toBeVisible();

    for (const [index, kind] of OVERLAY_KINDS.entries()) {
      await page
        .getByRole('button', { name: `Add ${kind.title}`, exact: true })
        .click();

      await expect(page.locator('.k-clip--fxOverlay')).toHaveCount(index + 1);
      // Adding an overlay selects it so the preview handles appear immediately.
      await expect(page.locator('.k-clip--fxOverlay.is-selected')).toHaveCount(
        1,
      );
      await expect(page.locator('.k-overlay-controls__region')).toBeVisible();
      await expect(
        page.locator('.k-effects__badge', { hasText: kind.title }),
      ).toBeVisible();
    }

    await expect(page.locator('[data-track-kind="effects"]')).toHaveCount(1);
    await expect(page.locator('.k-effects__item')).toHaveCount(4);

    // The Effects track is created lazily, so undoing every add removes it.
    for (let index = 0; index < OVERLAY_KINDS.length; index += 1) {
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
    }
    await expect(page.locator('.k-clip')).toHaveCount(0);
    await expect(page.locator('[data-track-kind="effects"]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.locator('.k-clip--fxOverlay')).toHaveCount(1);
    await expect(page.locator('[data-track-kind="effects"]')).toHaveCount(1);

    await page.locator('.k-effects__main').click();
    await expect(page.locator('.k-overlay-controls__region')).toBeVisible();

    await page
      .locator('.k-effects__actions button[aria-label="Delete overlay"]')
      .first()
      .click();
    await expect(page.locator('.k-clip')).toHaveCount(0);
  } finally {
    await kerf.close();
  }
});

test('keeps linked overlays in sync and matches exported frames', async () => {
  const fixture = ensureScenesFixture();
  const kerf = await launchKerf();
  const { page } = kerf;

  try {
    await expect(
      page.getByRole('heading', { name: 'Your projects' }),
    ).toBeVisible();

    await page.getByPlaceholder('New project').fill('Linked overlays');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.locator('.k-shell__project-name')).toHaveText(
      'Linked overlays',
    );

    await page.evaluate(async (path) => {
      await window.kerf.assets.import([path]);
    }, fixture);

    const assetCard = page.locator('button[title="scenes-source.mp4"]');
    await expect(assetCard).toBeVisible();
    await expect(assetCard).toContainText('Ready', { timeout: 120_000 });

    const assetId = await page.evaluate(async () => {
      const assets = await window.kerf.assets.list();
      return assets.find((asset) => asset.name === 'scenes-source.mp4')?.id;
    });
    expect(assetId).toBeTruthy();
    if (!assetId) {
      throw new Error('The imported asset did not get an id.');
    }

    const laneBox = await page
      .locator('[data-track-kind="video"]')
      .first()
      .boundingBox();
    if (!laneBox) {
      throw new Error('The video track is not visible.');
    }
    await page.evaluate(
      ({ id, clientX, clientY }) => {
        const source = document.querySelector<HTMLElement>(
          'button[title="scenes-source.mp4"]',
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

    await expect(page.locator('.k-clip--video')).toHaveCount(1);
    await page.locator('.k-clip--video').click();

    await page.getByRole('button', { name: 'Effects', exact: true }).click();
    await page
      .getByRole('button', { name: 'Add Spotlight', exact: true })
      .click();

    await expect(page.locator('.k-clip--fxOverlay')).toHaveCount(1);
    await expect(page.getByText('Linked to scenes-source.mp4')).toBeVisible();

    // Scrub a few frames into the red scene so the spotlight has footage under
    // it, then wait for the preview to finish painting that frame.
    const overlayBox = await page.locator('.k-clip--fxOverlay').boundingBox();
    const rulerBox = await page.locator('.k-timeline__ruler').boundingBox();
    if (!overlayBox || !rulerBox) {
      throw new Error('The overlay or timeline ruler is not visible.');
    }
    await page.mouse.click(overlayBox.x + 12, rulerBox.y + rulerBox.height / 2);
    const label = await page
      .locator('.k-stage__frame-canvas')
      .getAttribute('aria-label');
    const frame = Number(label?.replace('Frame ', ''));
    expect(frame).toBeGreaterThan(0);
    expect(frame).toBeLessThan(48);
    await expect
      .poll(async () => {
        const pixels = await previewPixels(page);
        return pixels.centre.red > 100;
      })
      .toBe(true);
    const preview = await previewPixels(page);

    const rendered = await kerf.app.evaluate(
      async (_electron, frameToRender) => {
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
          'renderFrame',
          { frame: frameToRender },
          'user',
        );
      },
      frame,
    );
    const stillPath = (rendered as { path?: string }).path;
    expect(stillPath).toBeTruthy();
    if (!stillPath) {
      throw new Error('The rendered frame did not return a path.');
    }

    const image = await loadImage(stillPath);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const exported = context.getImageData(0, 0, canvas.width, canvas.height);

    // Same compositor, same region: the spotlight keeps the centre lit and
    // dims the corner in both the preview and the export-quality frame.
    expect(preview.centre.red).toBeGreaterThan(preview.corner.red + 40);
    expectClose(
      readPixel(
        exported.data,
        exported.width,
        exported.width / 2,
        exported.height / 2,
      ),
      preview.centre,
    );
    expectClose(
      readPixel(
        exported.data,
        exported.width,
        exported.width * 0.05,
        exported.height * 0.05,
      ),
      preview.corner,
    );

    const starts = () =>
      page.evaluate(async () => {
        const snapshot = await window.kerf.projects.active();
        const clips = (snapshot?.project.sequence.tracks ?? []).flatMap(
          (track) => track.clips,
        );
        return {
          video:
            clips.find((clip) => clip.type === 'video')?.startFrame ?? null,
          overlay:
            clips.find((clip) => clip.type === 'fxOverlay')?.startFrame ?? null,
        };
      });

    const initial = await starts();

    // Moving the source moves the linked overlay in the same edit.
    await page.locator('.k-clip--video').click();
    await page.getByLabel('Start frame', { exact: true }).fill('24');
    await page.getByLabel('Start frame', { exact: true }).press('Enter');

    await expect.poll(starts).toEqual({ video: 24, overlay: 24 });

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(starts).toEqual(initial);

    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(starts).toEqual({ video: 24, overlay: 24 });

    // Deleting the source removes its linked overlay in the same undo step.
    await page.locator('.k-clip--video').click();
    await page.keyboard.press('Delete');
    await expect(page.locator('.k-clip')).toHaveCount(0);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('.k-clip--video')).toHaveCount(1);
    await expect(page.locator('.k-clip--fxOverlay')).toHaveCount(1);
  } finally {
    await kerf.close();
  }
});
