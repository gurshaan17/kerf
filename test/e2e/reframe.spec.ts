import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ToolExportStartResult } from '@kerf/tools';
import type { ClipId } from '@kerf/model';
import type { KerfServices } from '../../src/main/services';
import { launchKerf } from './helpers';

test('tracks a subject, reviews a scene change, and exports an independent vertical project', async () => {
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  const source = join(kerf.workspace, 'reframe-source.mp4');
  const output = join(kerf.workspace, 'vertical.mp4');
  try {
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=320x180:r=24:d=2',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=40x40:r=24:d=2,drawbox=x=4:y=4:w=8:h=8:color=white:t=fill',
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=320x180:r=24:d=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=800:sample_rate=48000:duration=3',
      '-filter_complex',
      "[0:v][1:v]overlay=x='60+45*t':y=70:shortest=1[moving];[moving][2:v]concat=n=2:v=1:a=0[video]",
      '-map',
      '[video]',
      '-map',
      '3:a',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      source,
    ]);
    await page.getByPlaceholder('New project').fill('Camera crop');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.evaluate((path) => window.kerf.assets.import([path]), source);
    await expect(
      page.locator('button[title="reframe-source.mp4"]'),
    ).toContainText('Ready');
    const asset = await page.evaluate(
      async () => (await window.kerf.assets.list())[0]!,
    );
    const clipId = await kerf.app.evaluate(async (_, assetId) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      return (
        (await services.tools.call(
          'insertClip',
          { assetId, startFrame: 12 },
          'user',
        )) as { clipId: ClipId }
      ).clipId;
    }, asset.id);
    const active = () => page.evaluate(() => window.kerf.projects.active());
    const before = (await active())!;
    const video = page.locator('.k-clip--video').first();
    await video.focus();
    await video.press('Enter');
    await page
      .getByRole('button', { name: 'Reframe video', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Reframe video' });
    const focus = dialog.getByRole('slider', { name: 'Horizontal focus' });
    await focus.fill('25');
    const canvas = dialog.getByLabel('Reframed playback').locator('canvas');
    const center = () =>
      canvas.evaluate((element) => {
        const surface = element as HTMLCanvasElement;
        const data = surface
          .getContext('2d')!
          .getImageData(surface.width / 2, surface.height / 2, 1, 1).data;
        return data[0]! - data[2]!;
      });
    await expect.poll(center).toBeGreaterThan(75);
    await dialog
      .getByRole('button', { name: 'Track subject', exact: true })
      .click();
    const shot = dialog.getByRole('button', { name: /New shot/ }).first();
    await expect(shot).toBeVisible();
    const position = dialog.getByRole('slider', { name: 'Proposal position' });
    await position.fill('30');
    await expect.poll(center).toBeGreaterThan(75);
    await shot.click();
    await expect(position).toHaveValue('48');
    await focus.fill('75');
    await dialog
      .getByRole('button', { name: 'Create vertical project' })
      .click();
    await expect(dialog.getByRole('status')).toContainText(
      'Camera crop · Vertical',
    );
    expect((await active())?.project).toEqual(before.project);
    await dialog.getByRole('button', { name: 'Open vertical project' }).click();
    await expect
      .poll(async () => (await active())?.project.name)
      .toBe('Camera crop · Vertical');
    const child = (await active())!;
    expect(child.project.reframeOrigin).toMatchObject({
      parentProjectId: before.project.id,
      sourceClipId: clipId,
      format: 'vertical',
    });
    expect(child.project.sequence).toMatchObject({ width: 1080, height: 1920 });
    const clips = child.project.sequence.tracks.flatMap((track) => track.clips);
    const framed = clips.find((item) => item.type === 'video')!;
    expect(framed.startFrame).toBe(0);
    expect(
      framed.keyframes.x.find((key) => key.frame === 30)?.value,
    ).toBeLessThan(framed.keyframes.x[0]!.value - 300);
    expect(
      framed.keyframes.x.find((key) => key.frame === 48)?.value,
    ).toBeLessThan(0);
    expect(clips.find((item) => item.type === 'audio')).toMatchObject({
      startFrame: 0,
      sourceInFrame: 0,
      durationFrames: framed.durationFrames,
      volume: 1,
    });
    const exportId = await kerf.app.evaluate(async (_, outputPath) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      return (
        (await services.tools.call(
          'startExport',
          { outputPath },
          'user',
        )) as ToolExportStartResult
      ).export.id;
    }, output);
    await expect
      .poll(
        () =>
          kerf.app.evaluate((_, id) => {
            const services = (globalThis as { __kerfServices?: KerfServices })
              .__kerfServices!;
            return services.exports.get(id)?.status;
          }, exportId),
        { timeout: 90_000 },
      )
      .toBe('succeeded');
    const streams = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_streams', '-of', 'json', output],
        { encoding: 'utf8' },
      ),
    ).streams;
    expect(
      streams.find(
        (stream: { codec_type: string }) => stream.codec_type === 'video',
      ),
    ).toMatchObject({ width: 1080, height: 1920 });
    expect(
      streams.find(
        (stream: { codec_type: string }) => stream.codec_type === 'audio',
      ),
    ).toBeTruthy();
    for (const seconds of ['0', '1.25']) {
      const center = execFileSync('ffmpeg', [
        '-v',
        'error',
        '-ss',
        seconds,
        '-i',
        output,
        '-frames:v',
        '1',
        '-vf',
        'crop=2:2:(iw-2)/2:(ih-2)/2',
        '-pix_fmt',
        'rgb24',
        '-f',
        'rawvideo',
        'pipe:1',
      ]);
      expect(center[0]! - center[2]!).toBeGreaterThan(75);
    }
    await page.evaluate(
      (id) => window.kerf.projects.open(id),
      before.project.id,
    );
    expect((await active())?.project).toEqual(before.project);
    const replay = await page.evaluate(async (id) => {
      const reviewId = crypto.randomUUID();
      await window.kerf.reframe!.prepare({ clipId: id, reviewId });
      const request = {
        reviewId,
        format: 'square' as const,
        points: [{ frame: 0, x: 0.3, y: 0.5 }],
      };
      const first = await window.kerf.reframe!.create(request);
      const second = await window.kerf.reframe!.create(request);
      return { first, second };
    }, clipId);
    expect(replay.first).toEqual(replay.second);
    const staleReview = await page.evaluate(async (id) => {
      const reviewId = crypto.randomUUID();
      await window.kerf.reframe!.prepare({ clipId: id, reviewId });
      await window.kerf.edits.apply({
        type: 'clip.update',
        clipId: id,
        patch: { label: 'Changed after review' },
      });
      return reviewId;
    }, clipId);
    await expect(
      page.evaluate(
        (reviewId) =>
          window.kerf.reframe!.create({
            reviewId,
            format: 'square',
            points: [{ frame: 0, x: 0.3, y: 0.5 }],
          }),
        staleReview,
      ),
    ).rejects.toThrow('project or video changed');
    await page.evaluate(() => window.kerf.edits.undo());
    expect((await active())?.project.sequence).toEqual(before.project.sequence);

    const rotated = join(kerf.workspace, 'rotated.mp4');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-display_rotation:v:0',
      '90',
      '-i',
      source,
      '-c',
      'copy',
      rotated,
    ]);
    await page.evaluate((path) => window.kerf.assets.import([path]), rotated);
    await expect(page.locator('button[title="rotated.mp4"]')).toContainText(
      'Ready',
    );
    const rotatedAsset = await page.evaluate(
      async () =>
        (await window.kerf.assets.list()).find(
          (item) => item.name === 'rotated.mp4',
        )!,
    );
    const rotatedClip = await kerf.app.evaluate(async (_, assetId) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      return (
        (await services.tools.call(
          'insertClip',
          { assetId, startFrame: 120 },
          'user',
        )) as { clipId: ClipId }
      ).clipId;
    }, rotatedAsset.id);
    const displaySize = await page.evaluate(async (id) => {
      const reviewId = crypto.randomUUID();
      const review = await window.kerf.reframe!.prepare({
        clipId: id,
        reviewId,
      });
      await window.kerf.reframe!.cancel(reviewId);
      return review.source;
    }, rotatedClip);
    expect(displaySize).toEqual({ width: 180, height: 320 });
  } finally {
    await kerf.close();
  }
});
