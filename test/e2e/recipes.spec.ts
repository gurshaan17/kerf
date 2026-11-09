import { expect, test } from '@playwright/test';
import { ensureScenesFixture, launchKerf } from './helpers';

test('previews, trims, saves and atomically applies a footage-backed Blueprint', async () => {
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  try {
    await page.getByPlaceholder('New project').fill('Blueprint journey');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const before = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    await page
      .getByRole('button', { name: 'Blueprints & brand kits', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Blueprints & brand kits',
    });
    await page.screenshot({ path: '.cache/blueprints-gallery.png' });
    await dialog
      .getByRole('button', { name: 'Preview Quick tip', exact: true })
      .click();
    await expect(dialog.locator('canvas')).toBeVisible();
    await dialog.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Pause', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      ),
    ).toEqual(before);
    await dialog
      .getByRole('button', { name: 'Use Quick tip', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Build storyboard' }),
    ).toBeDisabled();
    await page.evaluate(
      async (path) => window.kerf.assets.import([path]),
      ensureScenesFixture(),
    );
    await expect(
      dialog.getByLabel('Starting footage').locator('option'),
    ).toHaveCount(2, { timeout: 120000 });
    await dialog
      .getByLabel('Starting footage')
      .selectOption({ label: 'scenes-source.mp4' });
    await dialog.getByLabel('Video goal').fill('A faster workflow');
    await dialog.getByLabel('Target duration').fill('6');
    await dialog.getByRole('button', { name: 'Build storyboard' }).click();
    await expect(
      dialog.getByRole('heading', { name: 'Quick tip storyboard' }),
    ).toBeVisible();
    await dialog.getByLabel('Show on-screen title').check();
    await expect(
      dialog.getByLabel('On-screen title', { exact: true }),
    ).toHaveValue('A faster workflow');
    await dialog
      .getByRole('navigation', { name: 'Storyboard scenes' })
      .getByRole('button')
      .nth(1)
      .click();
    await expect(dialog.getByLabel('Source start')).toHaveValue('2');
    await dialog.getByLabel('Source start').fill('5');
    await expect(
      dialog.getByRole('button', { name: 'Add to timeline', exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByText(/selected range exceeds/)).toBeVisible();
    await dialog.getByLabel('Source start').fill('2');
    const sourcePlayer = dialog.locator('.bp-source-trim video');
    await expect
      .poll(() =>
        sourcePlayer.evaluate((video: HTMLVideoElement) => video.readyState),
      )
      .toBeGreaterThan(1);
    await sourcePlayer.evaluate((video: HTMLVideoElement) => {
      video.currentTime = 3;
    });
    await expect(
      dialog.getByRole('button', { name: 'End here', exact: true }),
    ).toBeEnabled();
    await dialog.getByRole('button', { name: 'End here', exact: true }).click();
    await expect(dialog.getByLabel('Scene duration')).toHaveValue('1');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByRole('button', { name: 'Build storyboard' }).click();
    await dialog
      .getByRole('navigation', { name: 'Storyboard scenes' })
      .getByRole('button')
      .nth(1)
      .click();
    await expect(dialog.getByLabel('Scene duration')).toHaveValue('1');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Use Product demo', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'replaces your current storyboard',
    );
    await dialog
      .getByRole('button', { name: 'Keep current storyboard', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Use Quick tip', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Build storyboard', exact: true })
      .click();
    await dialog
      .getByRole('navigation', { name: 'Storyboard scenes' })
      .getByRole('button')
      .nth(1)
      .click();
    await expect(dialog.getByLabel('Scene duration')).toHaveValue('1');
    await dialog
      .locator('summary')
      .filter({ hasText: 'Save Blueprint structure' })
      .click();
    await dialog.getByLabel('Saved blueprint name').fill('My quick tips');
    await dialog
      .getByRole('button', { name: 'Save Blueprint', exact: true })
      .click();
    await expect(dialog.getByRole('status')).toContainText('saved locally');
    await dialog.locator('summary').filter({ hasText: 'Brand &' }).click();
    await dialog.getByLabel('Brand preset name').fill('My brand');
    await dialog
      .getByRole('button', { name: 'Save brand preset', exact: true })
      .click();
    await expect(dialog.getByRole('status')).toContainText(
      'Brand preset saved',
    );
    await dialog.locator('summary').filter({ hasText: 'Brand &' }).click();
    await page.screenshot({ path: '.cache/blueprints-storyboard.png' });
    const pixels = await dialog
      .locator('canvas')
      .evaluate((canvas: HTMLCanvasElement) => {
        const data = canvas
          .getContext('2d')!
          .getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
        return [...data];
      });
    expect(pixels[1]).toBeGreaterThan(100);
    await dialog
      .getByRole('button', { name: 'Add to timeline', exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    await expect(dialog).not.toBeVisible();
    const result = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    const videos = result.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => clip.type === 'video');
    expect(videos.map((clip) => clip.sourceInFrame)).toEqual([0, 48, 96]);
    expect(videos.map((clip) => clip.durationFrames)).toEqual([48, 24, 48]);
    expect(
      result.tracks
        .flatMap((track) => track.clips)
        .some(
          (clip) => clip.type === 'text' && clip.text === 'A faster workflow',
        ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      ),
    ).toEqual(before);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.reload();
    await page
      .getByRole('button', { name: 'Blueprints & brand kits', exact: true })
      .click();
    await expect(
      dialog
        .getByLabel('Other Blueprints')
        .locator('option')
        .filter({ hasText: 'My quick tips' }),
    ).toHaveCount(1);
    await dialog
      .getByLabel('Other Blueprints')
      .selectOption({ label: 'My quick tips' });
    await expect(
      dialog
        .getByLabel('Brand kit')
        .locator('option')
        .filter({ hasText: 'My brand' }),
    ).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Build storyboard' }).click();
    await expect(
      dialog.getByRole('button', { name: 'Add after current edit' }),
    ).toBeEnabled();
    await page.setViewportSize({ width: 800, height: 700 });
    await page.screenshot({ path: '.cache/blueprints-storyboard-small.png' });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await dialog
      .getByRole('button', { name: 'Add after current edit', exact: true })
      .click();
    const appended = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    const newVideos = appended.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => clip.type === 'video' && clip.startFrame >= 120);
    expect(newVideos).toHaveLength(3);
    expect(newVideos[0]!.startFrame).toBe(120);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      ),
    ).toEqual(result);
  } finally {
    await kerf.close();
  }
});
