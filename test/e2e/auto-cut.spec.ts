import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { KerfServices } from '../../src/main/services';
import { cacheRoot, ensureCaptionFixture, launchKerf } from './helpers';

test('reviews contextual cuts, restores sections, previews, applies, undoes and handles stale/cancelled/empty proposals', async () => {
  mkdirSync(cacheRoot, { recursive: true });
  const source = join(cacheRoot, 'auto-cut-source.mp4');
  execFileSync('ffmpeg', [
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=24:duration=12',
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    source,
  ]);
  let mode: 'cuts' | 'empty' | 'invalid' | 'hold' = 'cuts';
  let calls = 0;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const parts: Buffer[] = [];
    request.on('data', (part) => parts.push(part));
    request.on('end', () => {
      calls++;
      const raw = Buffer.concat(parts).toString();
      requests.push(raw);
      if (mode === 'hold') return;
      const removals =
        mode === 'empty'
          ? []
          : (mode === 'invalid' ? ['invented'] : ['unit_1', 'unit_4']).map(
              (unitId) => ({
                unitId,
                reason:
                  unitId === 'unit_1'
                    ? 'Redundant setup before the main action'
                    : 'Repeated setup after the demonstration',
                confidence: 'clear',
              }),
            );
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion',
          created: 0,
          model: 'fixture-vision',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({ removals }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 30,
            total_tokens: 130,
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fixture provider did not bind');
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  try {
    await page.getByPlaceholder('New project').fill('Auto cut journey');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Auto cut', exact: true }),
    ).toBeDisabled();
    await page.evaluate(
      async (path) => window.kerf.assets.import([path]),
      source,
    );
    await expect(
      page.locator('button[title="auto-cut-source.mp4"]'),
    ).toContainText('Ready', { timeout: 120000 });
    const asset = await page.evaluate(
      async () => (await window.kerf.assets.list())[0]!,
    );
    await kerf.app.evaluate(async (_, assetId) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      await services.tools.call('insertClip', { assetId }, 'user');
    }, asset.id);
    const videoClip = page.locator('.k-clip--video').first();
    await videoClip.focus();
    await videoClip.press('Enter');
    await page.getByRole('button', { name: 'Auto cut', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Auto cut', exact: true });
    await expect(
      dialog.getByText('Enable Vision and Chat consent', { exact: false }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Analyse clip' }),
    ).toBeDisabled();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.evaluate(
      async (baseUrl) =>
        window.kerf.analysis.saveProvider({
          kind: 'openai-compatible',
          label: 'Local fixture vision',
          model: 'fixture-vision',
          baseUrl,
          enabled: true,
          visionConsent: true,
          chatConsent: true,
        }),
      `http://127.0.0.1:${address.port}/v1`,
    );
    await page.getByRole('button', { name: 'Auto cut', exact: true }).click();
    await dialog
      .getByLabel('What should this edit keep?')
      .fill('Keep the actual demonstration');
    const original = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    await dialog.getByRole('button', { name: 'Analyse clip' }).click();
    await expect(dialog.getByLabel('Remove section 1')).toBeVisible({
      timeout: 120000,
    });
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      ),
    ).toEqual(original);
    expect(calls).toBe(1);
    expect(requests[0]).toContain('Keep the actual demonstration');
    expect(requests[0]).toContain('image_url');
    expect(requests[0]).not.toContain(source);
    await dialog.getByLabel('Remove section 2').uncheck();
    await expect(
      dialog.getByText('1 section removed', { exact: false }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Preview edit', exact: true })
      .click();
    await dialog.locator('video').evaluate((video: HTMLVideoElement) => {
      video.currentTime = 2.5;
    });
    await expect
      .poll(() =>
        dialog
          .locator('video')
          .evaluate((video: HTMLVideoElement) => video.currentTime),
      )
      .toBeGreaterThanOrEqual(92 / 24);
    await dialog.getByRole('button', { name: 'Stop preview' }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: join(cacheRoot, 'auto-cut-review.png') });
    await page.setViewportSize({ width: 900, height: 700 });
    expect(
      await dialog.evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth &&
          element.getBoundingClientRect().right <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await dialog
        .getByRole('button', { name: 'Apply cuts' })
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight;
        }),
    ).toBe(true);
    await page.screenshot({
      path: join(cacheRoot, 'auto-cut-review-small.png'),
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await dialog.getByRole('button', { name: 'Apply cuts' }).click();
    await expect(dialog).not.toBeVisible();
    const edited = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    const clips = edited.tracks.flatMap((t) => t.clips);
    expect(clips).toHaveLength(2);
    expect(clips.reduce((sum, c) => sum + c.durationFrames, 0)).toBe(248);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.kerf.projects.active())!.project.sequence,
        ),
      )
      .toEqual(original);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.kerf.projects.active())!.project.sequence,
        ),
      )
      .toEqual(edited);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await videoClip.focus();
    await videoClip.press('Enter');
    await page.getByRole('button', { name: 'Auto cut', exact: true }).click();
    await dialog.getByRole('button', { name: 'Analyse clip' }).click();
    await expect(dialog.getByLabel('Remove section 1')).toBeVisible({
      timeout: 120000,
    });
    await page.evaluate(async () => {
      const snapshot = (await window.kerf.projects.active())!;
      const clip = snapshot.project.sequence.tracks.flatMap((t) => t.clips)[0]!;
      await window.kerf.edits.apply({
        type: 'clip.move',
        clipId: clip.id,
        startFrame: 1,
      });
    });
    await expect(
      dialog.getByText('The timeline, transcript or source changed.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Apply cuts' }),
    ).toBeDisabled();
    await dialog
      .getByRole('button', { name: 'Change purpose or analyse again' })
      .click();
    mode = 'hold';
    await dialog.getByRole('button', { name: 'Analyse clip' }).click();
    await expect.poll(() => calls).toBe(3);
    await dialog.getByRole('button', { name: 'Cancel analysis' }).click();
    await expect(
      dialog.getByText('Analysis cancelled.', { exact: false }),
    ).toBeVisible();
    mode = 'invalid';
    await dialog.getByRole('button', { name: 'Analyse clip' }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      'unknown or duplicate evidence',
      { timeout: 120000 },
    );
    mode = 'empty';
    await dialog.getByRole('button', { name: 'Analyse clip' }).click();
    await expect(
      dialog.getByText('No clearly irrelevant sections found.', {
        exact: false,
      }),
    ).toBeVisible({ timeout: 120000 });
    await expect(
      dialog.getByRole('button', { name: 'Apply cuts' }),
    ).toBeDisabled();
    expect(calls).toBe(5);
  } finally {
    await kerf.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('automatically transcribes speech locally and keeps source audio aligned when cuts are applied', async () => {
  const kerf = await launchKerf();
  const { page } = kerf;
  let sawSpeech = false;
  const server = createServer((request, response) => {
    const parts: Buffer[] = [];
    request.on('data', (part) => parts.push(part));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(parts).toString());
      const user = body.messages.find(
        (m: { role: string }) => m.role === 'user',
      );
      const evidence = JSON.parse(
        user.content.find((p: { type: string }) => p.type === 'text').text,
      );
      sawSpeech = evidence.units.some(
        (u: { speech: string }) => u.speech.length > 0,
      );
      // An explicit controlled response tests the integration; this is not an
      // assertion about the editorial quality of any real provider.
      const first = evidence.units.find(
        (u: { startSeconds: number; endSeconds: number }) =>
          u.endSeconds - u.startSeconds >= 1.2,
      );
      const removals = [
        { unitId: first.id, reason: 'Fixture removal', confidence: 'clear' },
      ];
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion',
          created: 0,
          model: 'fixture-vision',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({ removals }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 30,
            total_tokens: 130,
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No fixture server');
  try {
    await page.getByPlaceholder('New project').fill('Auto cut speech');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const provider = await page.evaluate(
      async (baseUrl) =>
        window.kerf.analysis.saveProvider({
          kind: 'openai-compatible',
          label: 'Local fixture',
          model: 'fixture-vision',
          baseUrl,
          enabled: true,
          visionConsent: true,
          chatConsent: true,
        }),
      `http://127.0.0.1:${address.port}/v1`,
    );
    await page.evaluate(
      async (path) => window.kerf.assets.import([path]),
      ensureCaptionFixture(),
    );
    await expect(
      page.locator('button[title="caption-source.mp4"]'),
    ).toContainText('Ready', { timeout: 120000 });
    const asset = await page.evaluate(
      async () => (await window.kerf.assets.list())[0]!,
    );
    await kerf.app.evaluate(async (_, id) => {
      await (
        globalThis as { __kerfServices?: KerfServices }
      ).__kerfServices!.tools.call('insertClip', { assetId: id }, 'user');
    }, asset.id);
    const snapshot = await page.evaluate(
      async () => (await window.kerf.projects.active())!,
    );
    const clip = snapshot.project.sequence.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.type === 'video')!;
    const job = await page.evaluate(
      async (request) => window.kerf.autoCut.generate(request),
      { clipId: clip.id, providerId: provider.id },
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            async (id) =>
              (await window.kerf.jobs.list()).find((j) => j.id === id)?.status,
            job.id,
          ),
        { timeout: 120000 },
      )
      .toBe('succeeded');
    expect(sawSpeech).toBe(true);
    const proposal = await page.evaluate(
      async (id) => window.kerf.autoCut.proposal(id),
      job.id,
    );
    expect(proposal!.removals).toHaveLength(1);
    await page.evaluate(async (request) => window.kerf.autoCut.apply(request), {
      jobId: job.id,
      removalIds: proposal!.removals.map((r) => r.id),
    });
    const after = await page.evaluate(
      async () => (await window.kerf.projects.active())!,
    );
    const video = after.project.sequence.tracks
      .flatMap((t) => t.clips)
      .filter((c) => c.type === 'video');
    const audio = after.project.sequence.tracks
      .flatMap((t) => t.clips)
      .filter((c) => c.type === 'audio');
    expect(
      video.map((c) => [c.startFrame, c.durationFrames, c.sourceInFrame]),
    ).toEqual(
      audio.map((c) => [c.startFrame, c.durationFrames, c.sourceInFrame]),
    );
    expect(after.transcripts).toHaveLength(0);
    await page.evaluate(async () => window.kerf.edits.undo());
    expect(
      (await page.evaluate(async () => (await window.kerf.projects.active())!))
        .project.sequence,
    ).toEqual(snapshot.project.sequence);
  } finally {
    await kerf.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
