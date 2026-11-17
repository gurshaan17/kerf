import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranscript, newId } from '@kerf/model';
import type { ClipId } from '@kerf/model';
import type { KerfServices } from '../../src/main/services';
import { audioFilter } from '../../src/main/export/args';
import { buildExportAudioPlan } from '../../src/main/export/audio-plan';
import { cacheRoot, launchKerf, repoRoot } from './helpers';

test('measures real audio, reviews gain and speech envelopes, preserves undo and matches playback/export', async () => {
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  const tone = join(kerf.workspace, 'background.wav');
  const voice = join(kerf.workspace, 'voice.wav');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=0.1*sin(2*PI*1000*t)|0.1*sin(2*PI*1000*t):s=48000:d=12',
    '-c:a',
    'pcm_f32le',
    tone,
  ]);
  copyFileSync(join(repoRoot, 'test/fixtures/caption-speech.wav'), voice);
  try {
    await page.getByPlaceholder('New project').fill('Audio finishing');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.evaluate(
      (paths) => window.kerf.assets.import(paths),
      [tone, voice],
    );
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.kerf.assets.list()).filter(
              (a) => a.status === 'ready',
            ).length,
        ),
      )
      .toBe(2);
    const assets = await page.evaluate(() => window.kerf.assets.list());
    const speech = assets.find((a) => a.name === 'voice.wav')!;
    const music = assets.find((a) => a.name === 'background.wav')!;
    const transcript = createTranscript({
      assetId: speech.id,
      segments: [
        {
          id: newId('segment'),
          startFrame: 24,
          endFrame: 96,
          text: 'Indexed speech',
          words: [
            { text: 'One', startFrame: 24, endFrame: 48, confidence: 1 },
            { text: 'Two', startFrame: 72, endFrame: 96, confidence: 1 },
          ],
        },
      ],
    });
    const ids = await kerf.app.evaluate(
      async (_, input) => {
        const services = (globalThis as { __kerfServices?: KerfServices })
          .__kerfServices!;
        const bg = (await services.tools.call(
          'insertAudio',
          { assetId: input.music },
          'user',
        )) as { clipId: ClipId };
        const speech = (await services.tools.call(
          'insertAudio',
          {
            assetId: input.speech,
            startFrame: 48,
            trackId: services.projects
              .current()!
              .project.sequence.tracks.filter((t) => t.kind === 'audio')[1]!.id,
          },
          'user',
        )) as { clipId: ClipId };
        services.repository.saveTranscript(input.transcript);
        services.projects.refresh('analysis');
        return { bg: bg.clipId, speech: speech.clipId };
      },
      { music: music.id, speech: speech.id, transcript },
    );
    const before = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    await page.getByRole('button', { name: 'Assistant', exact: true }).click();
    const bgClip = page
      .locator('.k-clip--audio')
      .filter({ hasText: 'background.wav' })
      .first();
    await bgClip.focus();
    await bgClip.press('Enter');
    const panel = page.getByLabel('Audio finishing', { exact: true });
    await panel
      .getByRole('button', { name: 'Audio finishing', exact: true })
      .click();
    await panel
      .getByRole('button', { name: 'Measure selected audio', exact: true })
      .click();
    await expect(panel.getByLabel('Audio measurements')).toContainText('LUFS');
    const measured = await page.evaluate(
      (id) => window.kerf.audioFinishing!.measure({ clipIds: [id] }),
      ids.bg,
    );
    expect(measured.integratedLufs).toBeCloseTo(-20, 0);
    expect(measured.truePeakDbtp).toBeCloseTo(-20, 1);
    expect(measured.clipIds).toEqual([ids.bg]);
    await panel
      .getByLabel('Loudness target (LUFS)', { exact: true })
      .fill('-8');
    await panel.getByLabel('Peak ceiling (dBTP)', { exact: true }).fill('-18');
    await panel
      .getByRole('button', { name: 'Plan gain and fades', exact: true })
      .click();
    await expect(panel).toContainText('unattainable');
    await expect(
      panel.getByRole('button', {
        name: 'Apply reviewed audio changes',
        exact: true,
      }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      ),
    ).toEqual(before);
    await panel
      .getByLabel('Loudness target (LUFS)', { exact: true })
      .fill('-16');
    await panel.getByLabel('Peak ceiling (dBTP)', { exact: true }).fill('-1');
    await panel
      .getByRole('button', { name: 'Plan gain and fades', exact: true })
      .click();
    const gainPlan = await page.evaluate(
      async () =>
        (await window.kerf.audioFinishing!.reviews()).find(
          (p) => p.kind === 'gain' && p.status === 'ready',
        )!,
    );
    const gainCard = panel.getByLabel(`Audio plan ${gainPlan.id}`, {
      exact: true,
    });
    await gainCard
      .getByRole('button', {
        name: 'Apply reviewed audio changes',
        exact: true,
      })
      .click();
    await expect(gainCard).toContainText('Applied');
    const afterGain = await page.evaluate(
      (id) => window.kerf.audioFinishing!.measure({ clipIds: [id] }),
      ids.bg,
    );
    expect(afterGain.integratedLufs!).toBeCloseTo(-16, 0);
    await page.evaluate(() => {
      const nodes: GainNode[] = [];
      (globalThis as { __audioGainNodes?: GainNode[] }).__audioGainNodes =
        nodes;
      const original = AudioContext.prototype.createGain;
      AudioContext.prototype.createGain = function () {
        const node = original.call(this);
        nodes.push(node);
        return node;
      };
    });
    const monitor = page.getByRole('region', { name: 'Preview', exact: true });
    await monitor
      .getByRole('button', { name: 'Jump to start', exact: true })
      .click();
    await monitor.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (globalThis as { __audioGainNodes?: GainNode[] })
              .__audioGainNodes?.[0]?.gain.value ?? 0,
        ),
      )
      .toBeGreaterThan(1.5);
    await monitor.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(
      page.evaluate(async (id) => {
        await window.kerf.audioFinishing!.confirm(id);
      }, gainPlan.id),
    ).rejects.toThrow('already applied');
    await page.evaluate(() => window.kerf.edits.undo());
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      ),
    ).toEqual(before);
    await panel
      .getByRole('checkbox', { name: 'Speech: voice.wav', exact: true })
      .check();
    await panel
      .getByRole('button', { name: 'Plan speech ducking', exact: true })
      .click();
    const duckPlan = await page.evaluate(
      async () =>
        (await window.kerf.audioFinishing!.reviews()).find(
          (p) => p.kind === 'duck' && p.status === 'ready',
        )!,
    );
    const duckCard = panel.getByLabel(`Audio plan ${duckPlan.id}`, {
      exact: true,
    });
    await duckCard
      .getByRole('button', {
        name: 'Apply reviewed audio changes',
        exact: true,
      })
      .click();
    await expect(duckCard).toContainText('Applied');
    const applied = await page.evaluate(
      async () => (await window.kerf.projects.active())!,
    );
    const bg = applied.project.sequence.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === ids.bg)!;
    expect(bg.keyframes.volume.length).toBeGreaterThan(4);
    expect(
      applied.project.sequence.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === ids.speech),
    ).toEqual(
      before.tracks.flatMap((t) => t.clips).find((c) => c.id === ids.speech),
    );
    await monitor
      .getByRole('button', { name: 'Jump to start', exact: true })
      .click();
    await monitor.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (globalThis as { __audioGainNodes?: GainNode[] })
                .__audioGainNodes?.[0]?.gain.value ?? 0,
          ),
        { timeout: 10000, intervals: [50] },
      )
      .toBeCloseTo(0.35, 1);
    await monitor.getByRole('button', { name: 'Pause', exact: true }).click();
    const scoped = {
      ...applied.project.sequence,
      tracks: applied.project.sequence.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => c.id === ids.bg),
      })),
    };
    mkdirSync(cacheRoot, { recursive: true });
    for (const [name, sequence] of [
      ['before', before],
      ['after', applied.project.sequence],
    ] as const) {
      const mix = buildExportAudioPlan(sequence, applied.assets, 0, 288);
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-y',
        ...mix.flatMap((c) => [
          '-ss',
          String(c.sourceStartSeconds),
          '-t',
          String(c.sourceDurationSeconds),
          '-i',
          c.path,
        ]),
        '-filter_complex',
        [
          ...mix.map((c, i) => audioFilter(c, i)),
          `${mix.map((_, i) => `[a${i}]`).join('')}amix=inputs=${mix.length}:normalize=0,atrim=0:12[mix]`,
        ].join(';'),
        '-map',
        '[mix]',
        '-c:a',
        'pcm_f32le',
        join(cacheRoot, `phase5-listening-${name}.wav`),
      ]);
    }
    const plan = buildExportAudioPlan(scoped, applied.assets, 0, 288);
    mkdirSync(cacheRoot, { recursive: true });
    const rendered = join(cacheRoot, 'phase5-ducked-background.wav');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      tone,
      '-filter_complex',
      audioFilter(plan[0]!, 0),
      '-map',
      '[a0]',
      '-c:a',
      'pcm_f32le',
      rendered,
    ]);
    const raw = execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        rendered,
        '-f',
        'f32le',
        '-ac',
        '2',
        '-ar',
        '48000',
        '-',
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const rms = (time: number) => {
      let sum = 0;
      const count = 4800;
      for (let i = 0; i < count; i++)
        sum += raw.readFloatLE((Math.round(time * 48000) + i) * 8) ** 2;
      return Math.sqrt(sum / count);
    };
    expect(rms(3.4) / rms(1)).toBeCloseTo(0.35, 2);
    expect(rms(4.4) / rms(1)).toBeCloseTo(1, 2);
    let previous = 0;
    let largest = 0;
    for (
      let sample = Math.round(2.8 * 48000);
      sample < 3.2 * 48000;
      sample += 48
    ) {
      let peak = 0;
      for (let i = 0; i < 48; i++)
        peak = Math.max(peak, Math.abs(raw.readFloatLE((sample + i) * 8)));
      if (previous)
        largest = Math.max(largest, Math.abs(peak - previous) / 0.1);
      previous = peak;
    }
    expect(largest).toBeLessThan(0.02);
    expect(readFileSync(rendered).length).toBeGreaterThan(1000);
    await page.screenshot({
      path: join(cacheRoot, 'phase5-audio-finishing.png'),
    });
    await expect(
      page.evaluate(async (id) => {
        await window.kerf.audioFinishing!.confirm(id);
      }, duckPlan.id),
    ).rejects.toThrow('already applied');
    await page.evaluate(() => window.kerf.edits.undo());
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      ),
    ).toEqual(before);
  } finally {
    await kerf.close();
  }
});
