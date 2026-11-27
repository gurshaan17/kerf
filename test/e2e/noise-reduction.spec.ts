import { execFileSync } from 'node:child_process';
import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { KerfServices } from '../../src/main/services';
import type { ToolExportStartResult } from '@kerf/tools';
import { launchKerf } from './helpers';

function samples(path: string) {
  const pcm = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    path,
    '-map',
    '0:a:0',
    '-f',
    'f32le',
    'pipe:1',
  ]);
  return Array.from({ length: pcm.length / 8 }, (_, index) =>
    pcm.readFloatLE(index * 8),
  );
}

function rms(values: readonly number[]) {
  return Math.sqrt(
    values.reduce((sum, value) => sum + value ** 2, 0) / values.length,
  );
}

test('auditions, applies, measures and exports cleaned embedded audio', async () => {
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  const source = join(kerf.workspace, 'noisy.mp4');
  const output = join(kerf.workspace, 'cleaned.mp4');
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
      'anoisesrc=r=48000:a=0.006:d=2:s=13',
      '-af',
      'aeval=val(0)+if(eq(n\\,57600)\\,0.65\\,0),pan=stereo|c0=c0|c1=0.5*c0',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      source,
    ]);
    await page.getByPlaceholder('New project').fill('Noise reduction');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.evaluate((path) => window.kerf.assets.import([path]), source);
    await expect(page.locator('button[title="noisy.mp4"]')).toContainText(
      'Ready',
    );
    const asset = await page.evaluate(
      async () => (await window.kerf.assets.list())[0]!,
    );
    await kerf.app.evaluate(async (_, assetId) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      await services.tools.call('insertClip', { assetId }, 'user');
    }, asset.id);
    const readSequence = () =>
      page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      );
    const sourceClip = (await readSequence()).tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.type === 'audio')!;
    await page.evaluate(
      (clipId) =>
        window.kerf.edits.apply({
          type: 'clip.update',
          clipId,
          patch: { sourceInFrame: 12, durationFrames: 36 },
        }),
      sourceClip.id,
    );
    const initial = await readSequence();
    const staleRequest = await page.evaluate(async (clipId) => {
      const requestId = crypto.randomUUID();
      await window.kerf.noiseReduction!.prepare({
        requestId,
        clipId,
        strength: 'strong',
      });
      await window.kerf.edits.apply({
        type: 'clip.update',
        clipId,
        patch: { durationFrames: 35 },
      });
      return requestId;
    }, sourceClip.id);
    await expect(
      page.evaluate(
        (id) => window.kerf.noiseReduction!.apply(id),
        staleRequest,
      ),
    ).rejects.toThrow('The clip changed');
    await page.evaluate(async (id) => {
      await window.kerf.noiseReduction!.cancel(id);
      await window.kerf.edits.undo();
    }, staleRequest);
    expect(await readSequence()).toEqual(initial);
    const measure = () =>
      page.evaluate(
        (id) => window.kerf.audioFinishing!.measure({ clipIds: [id] }),
        sourceClip.id,
      );
    const originalMeasurement = await measure();
    await page.getByRole('button', { name: 'Assistant', exact: true }).click();
    const audioClip = page.locator('.k-clip--audio').first();
    await audioClip.focus();
    await audioClip.press('Enter');
    const panel = page.getByLabel('Audio finishing', { exact: true });
    await panel
      .getByRole('button', { name: 'Audio finishing', exact: true })
      .click();
    const noise = panel.getByRole('group', { name: 'Reduce background noise' });
    await noise.getByLabel('Strength').selectOption('strong');
    await noise
      .getByRole('button', { name: 'Preview noise reduction' })
      .click();
    const audition = noise.locator('audio');
    await expect(audition).toHaveAccessibleName('Cleaned audio');
    await expect
      .poll(() =>
        audition.evaluate(
          (element) => (element as HTMLAudioElement).currentTime,
        ),
      )
      .toBeCloseTo(0.5, 2);
    await audition.evaluate((element) => {
      (element as HTMLAudioElement).currentTime = 0.8;
    });
    await noise.getByRole('button', { name: 'Original', exact: true }).click();
    await expect(audition).toHaveAccessibleName('Original audio');
    await expect
      .poll(() =>
        audition.evaluate(
          (element) => (element as HTMLAudioElement).currentTime,
        ),
      )
      .toBeCloseTo(0.8, 2);
    await noise.getByRole('button', { name: 'Cleaned', exact: true }).click();
    await expect
      .poll(() =>
        audition.evaluate(
          (element) => (element as HTMLAudioElement).currentTime,
        ),
      )
      .toBeCloseTo(0.8, 2);
    expect(await readSequence()).toEqual(initial);
    await noise.getByRole('button', { name: 'Apply noise reduction' }).click();
    await expect(
      noise.getByRole('button', { name: 'Remove noise reduction' }),
    ).toBeVisible();
    const cleanedMeasurement = await measure();
    expect(cleanedMeasurement.integratedLufs!).toBeLessThan(
      originalMeasurement.integratedLufs! - 1,
    );
    const project = await page.evaluate(() => window.kerf.projects.active());
    const projectFolder = project!.summary.folderPath;
    const cache = join(projectFolder, '.noise-reduction');
    const [file] = readdirSync(cache);
    const cleaned = samples(join(cache, file!));
    const raw = samples(source);
    expect(Math.abs(cleaned.length - raw.length)).toBeLessThan(48);
    expect(rms(cleaned.slice(24000, 45000))).toBeLessThan(
      rms(raw.slice(24000, 45000)) * 0.7,
    );
    const peak = (values: number[]) =>
      values.reduce(
        (maximum, value, index) =>
          Math.abs(value) > Math.abs(values[maximum]!) ? index : maximum,
        0,
      );
    expect(Math.abs(peak(cleaned) - peak(raw))).toBeLessThan(4);

    const render = async (path: string) => {
      const exportId = await kerf.app.evaluate(async (_, outputPath) => {
        const services = (globalThis as { __kerfServices?: KerfServices })
          .__kerfServices!;
        const result = await services.tools.call(
          'startExport',
          { outputPath },
          'user',
        );
        return (result as ToolExportStartResult).export.id;
      }, path);
      await expect
        .poll(
          () =>
            kerf.app.evaluate((_, id) => {
              const services = (globalThis as { __kerfServices?: KerfServices })
                .__kerfServices!;
              return services.exports.get(id)?.status;
            }, exportId),
          { timeout: 60_000 },
        )
        .toBe('succeeded');
      return samples(path);
    };
    await page.evaluate(() => window.kerf.edits.undo());
    expect(await readSequence()).toEqual(initial);
    const baseline = await render(join(kerf.workspace, 'original.mp4'));
    await page.evaluate(() => window.kerf.edits.redo());
    await page.evaluate(
      (id) => window.kerf.projects.open(id),
      project!.project.id,
    );
    expect(
      (await readSequence()).tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === sourceClip.id),
    ).toMatchObject({ noiseReduction: 'strong' });
    unlinkSync(join(cache, file!));
    const rendered = await render(output);
    expect(readdirSync(cache)).toEqual([file]);
    expect(rms(rendered.slice(1000, 16000))).toBeLessThan(
      rms(baseline.slice(1000, 16000)) * 0.75,
    );
    expect(rendered.length).toBe(baseline.length);
    expect(Math.abs(peak(rendered) - peak(baseline))).toBeLessThan(120);
  } finally {
    await kerf.close();
  }
});
