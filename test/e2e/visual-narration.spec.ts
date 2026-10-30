import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cacheRoot, launchKerf } from './helpers';

test('silent video generates editable narration, protects edits on regeneration and explicitly updates captions', async () => {
  mkdirSync(cacheRoot, { recursive: true });
  const source = join(cacheRoot, 'visual-source.mp4');
  execFileSync('ffmpeg', [
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=24:duration=6',
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    source,
  ]);
  let calls = 0;
  const server = createServer((request, response) => {
    const parts: Buffer[] = [];
    request.on('data', (data) => parts.push(data));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(parts).toString());
      const texts = body.messages.flatMap((message: { content: unknown }) =>
        Array.isArray(message.content) ? message.content : [],
      );
      const eligible = texts.filter(
        (part: { type?: string; text?: string }) =>
          part.type === 'text' && part.text?.includes('OUTPUT ELIGIBLE'),
      );
      const first = Number(eligible[0].text.match(/Frame (\d+)/)[1]);
      const last = Number(eligible.at(-1).text.match(/Frame (\d+)/)[1]);
      const content = JSON.stringify({
        segments: [
          {
            startFrameIndex: first,
            endFrameIndex: last,
            text: `Visible workflow step ${++calls}`,
          },
        ],
      });
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
              message: { role: 'assistant', content },
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
    throw new Error('Mock provider did not bind');
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  try {
    await page.getByPlaceholder('New project').fill('Visual narration journey');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const provider = await page.evaluate(
      async (baseUrl) =>
        window.kerf.analysis.saveProvider({
          kind: 'openai-compatible',
          label: 'Local fixture vision',
          model: 'fixture-vision',
          baseUrl,
          enabled: true,
          visionConsent: true,
        }),
      `http://127.0.0.1:${address.port}/v1`,
    );
    await page.evaluate(
      async (path) => window.kerf.assets.import([path]),
      source,
    );
    const card = page.locator('button[title="visual-source.mp4"]');
    await expect(card).toContainText('Ready', { timeout: 120000 });
    await card.click();
    const asset = await page.evaluate(
      async () =>
        (await window.kerf.assets.list()).find(
          (a) => a.name === 'visual-source.mp4',
        )!,
    );
    await kerf.app.evaluate(
      async (_, { id }) => {
        const services = (
          globalThis as {
            __kerfServices?: {
              tools: {
                call(
                  name: string,
                  input: unknown,
                  actor: 'user',
                ): Promise<unknown>;
              };
            };
          }
        ).__kerfServices;
        if (!services) throw new Error('Missing test services');
        await services.tools.call('insertClip', { assetId: id }, 'user');
      },
      { id: asset.id },
    );
    await page
      .getByRole('button', { name: 'Visual narration', exact: true })
      .click();
    await page
      .locator('dialog[open]')
      .getByLabel('Narration provider')
      .selectOption(provider.id);
    await page
      .getByRole('button', { name: 'Send frames and generate draft' })
      .click();
    await expect
      .poll(async () =>
        page.evaluate(
          async () => (await window.kerf.projects.active())!.transcripts.length,
        ),
      )
      .toBe(1);
    await expect(
      page.getByRole('heading', { name: 'Visual narration', exact: true }),
    ).toBeVisible();
    const read = () =>
      page.evaluate(
        async () => (await window.kerf.projects.active())!.transcripts[0]!,
      );
    const initial = await read();
    expect(initial.source).toBe('visual');
    expect(initial.status).toBe('draft');
    expect(calls).toBeGreaterThan(0);
    const rows = page.locator('[data-narration-row]');
    const initialCount = initial.segments.length;
    await rows
      .first()
      .getByLabel('Narration text')
      .fill('Corrected visible workflow step');
    await expect(
      page.getByRole('button', { name: 'Mark reviewed' }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Regenerate range' }),
    ).toBeDisabled();
    await rows.first().getByRole('button', { name: 'Save text' }).click();
    await expect
      .poll(async () => (await read()).segments[0]!.text)
      .toBe('Corrected visible workflow step');
    await page
      .getByRole('button', { name: 'Undo narration', exact: true })
      .click();
    await expect
      .poll(async () => (await read()).segments[0]!.text)
      .toBe(initial.segments[0]!.text);
    await page
      .getByRole('button', { name: 'Redo narration', exact: true })
      .click();
    await expect
      .poll(async () => (await read()).segments[0]!.text)
      .toBe('Corrected visible workflow step');
    const first = (await read()).segments[0]!;
    const split = (first.startFrame + first.endFrame) / 48;
    await page.locator('video').evaluate((video, t) => {
      if (!(video instanceof HTMLVideoElement))
        throw new Error('Expected video');
      video.pause();
      video.currentTime = t;
      video.dispatchEvent(new Event('timeupdate'));
    }, split);
    await rows
      .first()
      .getByRole('button', { name: 'Split at playhead' })
      .click();
    await expect(rows).toHaveCount(initialCount + 1);
    await rows.nth(0).getByRole('checkbox').check();
    await rows.nth(1).getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Merge selected' }).click();
    await expect(rows).toHaveCount(initialCount);
    const current = await read();
    const last = current.segments.at(-1)!;
    const shortened =
      last.startFrame +
      Math.max(1, Math.floor((last.endFrame - last.startFrame) / 2));
    await rows
      .last()
      .getByLabel('Row end seconds')
      .fill(String(shortened / 24));
    await rows.last().getByRole('button', { name: 'Set timing' }).click();
    await expect
      .poll(async () => (await read()).segments.at(-1)!.endFrame)
      .toBe(shortened);
    await page.locator('video').evaluate(
      (video, t) => {
        if (!(video instanceof HTMLVideoElement))
          throw new Error('Expected video');
        video.pause();
        video.currentTime = t;
        video.dispatchEvent(new Event('timeupdate'));
      },
      (shortened + 1) / 24,
    );
    await page.getByLabel('New manual narration').fill('Manual source note');
    await page.getByRole('button', { name: 'Add at playhead' }).click();
    await expect(rows).toHaveCount(initialCount + 1);
    const beforeRegeneration = await read();
    const protectedIds = beforeRegeneration.segments
      .filter((s) => s.origin === 'edited' || s.origin === 'manual')
      .map((s) => s.id);
    await page.getByRole('button', { name: 'Regenerate range' }).click();
    await page
      .locator('dialog[open]')
      .getByLabel('Narration provider')
      .selectOption(provider.id);
    await page
      .getByRole('button', { name: 'Send frames and generate draft' })
      .click();
    await expect
      .poll(async () => (await read()).revision)
      .toBeGreaterThan(beforeRegeneration.revision);
    const regenerated = await read();
    expect(
      regenerated.segments
        .filter((s) => protectedIds.includes(s.id))
        .map((s) => s.id)
        .sort(),
    ).toEqual(protectedIds.sort());
    await page.getByRole('button', { name: 'Mark reviewed' }).click();
    await expect.poll(async () => (await read()).status).toBe('reviewed');
    const captions = () =>
      page.evaluate(async () =>
        (await window.kerf.projects.active())!.project.sequence.tracks
          .flatMap((t) => t.clips)
          .filter((c) => c.type === 'caption'),
      );
    await page
      .getByRole('button', { name: 'Create / update captions' })
      .click();
    await page.getByRole('button', { name: 'Confirm caption update' }).click();
    await expect
      .poll(async () => (await captions()).length)
      .toBe(regenerated.segments.length);
    const beforeCaptions = await captions();
    await rows
      .first()
      .getByLabel('Narration text')
      .fill('Explicitly updated caption text');
    await rows.first().getByRole('button', { name: 'Save text' }).click();
    await expect
      .poll(async () => (await read()).segments[0]!.text)
      .toBe('Explicitly updated caption text');
    expect(await captions()).toEqual(beforeCaptions);
    await page.getByRole('button', { name: 'Mark reviewed' }).click();
    await page
      .getByRole('button', { name: 'Create / update captions' })
      .click();
    await page.getByRole('button', { name: 'Confirm caption update' }).click();
    await expect
      .poll(async () =>
        (await captions()).some(
          (c) => c.text === 'Explicitly updated caption text',
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: join(cacheRoot, 'visual-narration-review.png'),
    });
  } finally {
    await kerf.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
