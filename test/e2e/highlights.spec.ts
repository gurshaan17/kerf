import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication } from 'playwright';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTranscript, newId } from '@kerf/model';
import type { KerfServices } from '../../src/main/services';
import type { ClipDiscoveryReview } from '@kerf/tools';
import { cacheRoot, launchKerf, repoRoot } from './helpers';

test('discovers evidenced highlights, auditions and selects separate projects, persists IDs and rejects replay/stale sources', async () => {
  mkdirSync(cacheRoot, { recursive: true });
  const source = join(cacheRoot, 'highlight-source.mp4');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=18',
    '-stream_loop',
    '-1',
    '-i',
    join(repoRoot, 'test/fixtures/caption-speech.wav'),
    '-t',
    '18',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    source,
  ]);
  let calls = 0;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const parts: Buffer[] = [];
    request.on('data', (chunk) => parts.push(chunk));
    request.on('end', () => {
      calls++;
      requests.push(Buffer.concat(parts).toString());
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion',
          created: 0,
          model: 'fixture-text',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  candidates: [
                    [0, 1],
                    [2, 3],
                  ].map(([a, b], i) => ({
                    startEvidenceId: `speech_${a}`,
                    endEvidenceId: `speech_${b}`,
                    title: `Useful thought ${i + 1}`,
                    rationale:
                      'A specific problem opens the thought; a practical solution closes it.',
                    warnings: [],
                  })),
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 100,
            total_tokens: 200,
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No fixture address');
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  let restarted: ElectronApplication | undefined;
  try {
    await page.getByPlaceholder('New project').fill('Highlights source');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.evaluate((path) => window.kerf.assets.import([path]), source);
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.kerf.assets.list())[0]?.status),
      )
      .toBe('ready');
    const asset = await page.evaluate(
      async () => (await window.kerf.assets.list())[0]!,
    );
    const transcript = createTranscript({
      assetId: asset.id,
      segments: Array.from({ length: 4 }, (_, i) => ({
        id: newId('segment'),
        startFrame: 30 + i * 90,
        endFrame: 90 + i * 90,
        text: `Complete useful thought ${i}.`,
        words: [],
      })),
    });
    const parent = await kerf.app.evaluate(
      async (_, input) => {
        const services = (globalThis as { __kerfServices?: KerfServices })
          .__kerfServices!;
        services.repository.saveTranscript(input.transcript);
        services.projects.refresh('analysis');
        await services.tools.call(
          'insertClip',
          { assetId: input.assetId },
          'user',
        );
        return services.projects.current()!;
      },
      { transcript, assetId: asset.id },
    );
    const provider = await page.evaluate(
      (baseUrl) =>
        window.kerf.analysis.saveProvider({
          kind: 'openai-compatible',
          label: 'Fixture text',
          model: 'fixture-text',
          baseUrl,
          enabled: true,
          chatConsent: true,
          visionConsent: false,
        }),
      `http://127.0.0.1:${address.port}/v1`,
    );
    await page.getByRole('button', { name: 'Assistant', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Highlights', exact: true });
    await panel
      .getByRole('button', { name: 'Discover highlights', exact: true })
      .click();
    await panel
      .getByLabel('Highlight source', { exact: true })
      .selectOption(asset.id);
    await panel
      .getByLabel('Discovery provider', { exact: true })
      .selectOption(provider.id);
    await panel.getByLabel('Minimum seconds', { exact: true }).fill('2');
    await panel.getByLabel('Maximum seconds', { exact: true }).fill('6');
    await panel
      .getByRole('button', { name: 'Find candidate moments', exact: true })
      .click();
    await expect(panel).toContainText('Requested 3; evidence supports 2');
    expect(calls).toBe(1);
    expect(requests[0]).toContain('Complete useful thought');
    expect(requests[0]).not.toContain('image_url');
    const review = await page.evaluate(
      async () => (await window.kerf.highlights!.reviews())[0]!,
    );
    const requested = await kerf.app.evaluate(async (_, id) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      return services.tools.call(
        'createClipsFromProposal',
        { jobId: id, selections: [{ candidateId: 'highlight_2' }] },
        'mcp',
      );
    }, review.id);
    expect(requested).toMatchObject({ status: 'awaiting-review' });
    expect(await page.evaluate(() => window.kerf.projects.list())).toHaveLength(
      1,
    );
    const candidate = panel.getByLabel('Candidate highlight_2', {
      exact: true,
    });
    await candidate
      .getByRole('checkbox', { name: 'Useful thought 2', exact: true })
      .check();
    await candidate
      .getByRole('button', { name: 'Preview Useful thought 2', exact: true })
      .click();
    const video = panel.getByLabel('Highlight source preview', { exact: true });
    await expect
      .poll(() => video.evaluate((e) => (e as HTMLVideoElement).readyState))
      .toBeGreaterThan(1);
    await video.evaluate((e) => (e as HTMLVideoElement).play());
    await expect
      .poll(() => video.evaluate((e) => (e as HTMLVideoElement).currentTime))
      .toBeGreaterThan(7);
    await video.evaluate((e) => (e as HTMLVideoElement).pause());
    await page.screenshot({
      path: join(cacheRoot, 'phase6-highlight-review.png'),
    });
    const sourceAfter = await page.evaluate(
      async () => (await window.kerf.projects.active())!,
    );
    expect(sourceAfter.project).toEqual(parent.project);
    expect(sourceAfter.history).toEqual(parent.history);
    await panel
      .getByRole('button', { name: 'Create selected projects', exact: true })
      .click();
    await expect(
      panel.getByRole('button', { name: 'Open Useful thought 2', exact: true }),
    ).toBeEnabled();
    expect(await page.evaluate(() => window.kerf.projects.list())).toHaveLength(
      2,
    );
    const applied = await page.evaluate(
      async () => (await window.kerf.highlights!.reviews())[0]!,
    );
    const output = applied.outputs[0]!;
    expect(output.candidateId).toBe('highlight_2');
    expect(output.durationFrames).toBe(150);
    expect(output.startFrame).toBe(210);
    const verify = await kerf.app.evaluate(
      async (_, id) =>
        (
          globalThis as { __kerfServices?: KerfServices }
        ).__kerfServices!.tools.call(
          'verifyClipOutput',
          { projectId: id },
          'mcp',
        ),
      output.projectId,
    );
    expect(verify).toMatchObject({ valid: true });
    await expect(
      page.evaluate(
        (id) =>
          window.kerf.highlights!.confirm({
            jobId: id,
            selections: [{ candidateId: 'highlight_2' }],
          }),
        review.id,
      ),
    ).rejects.toThrow('already created');
    await panel
      .getByRole('button', { name: 'Open Useful thought 2', exact: true })
      .click();
    const child = await page.evaluate(
      async () => (await window.kerf.projects.active())!,
    );
    expect(child.project.id).toBe(output.projectId);
    expect(child.project.sequence.frameRate.numerator).toBe(30);
    expect(child.assets[0]!.sourcePath).toBe(asset.sourcePath);
    expect(child.project.highlightOrigin).toMatchObject({
      jobId: review.id,
      candidateId: 'highlight_2',
    });
    await kerf.app.evaluate((_, id) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      services.projects.apply({
        type: 'clip.update',
        clipId: services.projects
          .current()!
          .project.sequence.tracks.flatMap((t) => t.clips)
          .find((c) => c.id === id)!.id,
        patch: { label: 'Refined highlight' },
      });
    }, output.videoClipId);
    await page.evaluate(() => window.kerf.edits.undo());
    expect(
      (await page.evaluate(async () => (await window.kerf.projects.active())!))
        .project.sequence,
    ).toEqual(child.project.sequence);
    await page.evaluate(
      (id) => window.kerf.projects.open(id),
      parent.project.id,
    );
    const again = await page.evaluate(
      async () => (await window.kerf.highlights!.reviews())[0]!,
    );
    expect(again.outputs).toEqual(applied.outputs);
    expect(calls).toBe(1);
    const stale = await page.evaluate(
      (input) => window.kerf.highlights!.start(input),
      {
        assetId: asset.id,
        providerId: provider.id,
        count: 3,
        minSeconds: 2,
        maxSeconds: 6,
        topic: '',
      },
    );
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(async () => window.kerf.highlights!.reviews())
          ).find((r: ClipDiscoveryReview) => r.id === stale.id)?.status,
      )
      .toBe('succeeded');
    await kerf.app.evaluate((_, input) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      services.repository.saveTranscript({ ...input, revision: 1 });
      services.projects.refresh('analysis');
    }, transcript);
    await expect(
      page.evaluate(
        (id) =>
          window.kerf.highlights!.confirm({
            jobId: id,
            selections: [{ candidateId: 'highlight_1' }],
          }),
        stale.id,
      ),
    ).rejects.toThrow('changed');
    expect(await page.evaluate(() => window.kerf.projects.list())).toHaveLength(
      2,
    );
    expect(calls).toBe(2);
    expect(
      (await page.evaluate(async () => (await window.kerf.projects.active())!))
        .project.sequence,
    ).toEqual(parent.project.sequence);
    const env = await kerf.app.evaluate(() =>
      Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.startsWith('KERF_')),
      ),
    );
    await kerf.app.close();
    restarted = await electron.launch({
      args: [repoRoot],
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...env }).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    });
    const reopened = await restarted.firstWindow();
    await reopened.waitForLoadState('domcontentloaded');
    await reopened.evaluate(
      (id) => window.kerf.projects.open(id),
      parent.project.id,
    );
    const saved = await reopened.evaluate(async () =>
      window.kerf.highlights!.reviews(),
    );
    expect(saved.find((r) => r.id === review.id)!.outputs).toEqual(
      applied.outputs,
    );
    expect(calls).toBe(2);
    await expect(
      reopened.evaluate(
        (id) =>
          window.kerf.highlights!.confirm({
            jobId: id,
            selections: [{ candidateId: 'highlight_2' }],
          }),
        review.id,
      ),
    ).rejects.toThrow('already created');
    const reopenedChild = await reopened.evaluate(
      (id) => window.kerf.projects.open(id),
      output.projectId,
    );
    expect(reopenedChild.project.sequence).toEqual(child.project.sequence);
    expect(calls).toBe(2);
  } finally {
    await restarted?.close();
    await kerf.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
