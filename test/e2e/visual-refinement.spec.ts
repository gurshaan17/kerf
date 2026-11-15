import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { KerfServices } from '../../src/main/services';
import { cacheRoot, launchKerf } from './helpers';

/** A deterministic vision fixture exercises orchestration; it does not evaluate model taste. */
test('inspects actual timeline images, repairs once, rechecks and preserves an undoable chat record', async () => {
  mkdirSync(cacheRoot, { recursive: true });
  let titleId = '';
  let calls = 0;
  let receivedImages = false;
  let fixtureError = '';
  const server = createServer((request, response) => {
    const parts: Buffer[] = [];
    request.on('data', (part) => parts.push(part));
    request.on('end', () => {
      try {
        const raw = Buffer.concat(parts).toString();
        const stage = calls++;
        receivedImages ||= raw.includes('data:image/png;base64,');
        const storyboardId = raw.match(/visual_[a-f0-9-]{36}/)?.[0];
        if (stage >= 3 && stage <= 4 && !storyboardId)
          throw new Error('Fixture did not receive storyboard evidence.');
        const toolCall =
          stage === 0
            ? { name: 'readContext', input: {} }
            : stage === 1
              ? { name: 'readTimeline', input: {} }
              : stage === 2
                ? {
                    name: 'renderStoryboard',
                    input: { clipIds: [titleId], maxWidth: 480 },
                  }
                : stage === 3
                  ? {
                      name: 'repairVisuals',
                      input: {
                        storyboardId,
                        findings: [
                          {
                            clipId: titleId,
                            frame: 48,
                            category: 'text-clipping',
                            observation:
                              'The title sits beyond the top edge of the sampled frame.',
                            patch: {
                              transform: { y: 0 },
                              style: { color: '#ffffff', fontSize: 64 },
                            },
                          },
                        ],
                      },
                    }
                  : stage === 4
                    ? {
                        name: 'renderStoryboard',
                        input: { recheckOf: storyboardId },
                      }
                    : null;
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        });
        const emit = (delta: unknown, finishReason: string | null = null) =>
          response.write(
            `data: ${JSON.stringify({ id: `fixture-${stage}`, object: 'chat.completion.chunk', created: 0, model: 'fixture-vision', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`,
          );
        emit({ role: 'assistant' });
        if (toolCall) {
          emit({
            tool_calls: [
              {
                index: 0,
                id: `call-${stage}`,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.input),
                },
              },
            ],
          });
          emit({}, 'tool_calls');
        } else {
          emit({
            content:
              'Moved the title into frame and checked the same samples. Playback and audio were not reviewed.',
          });
          emit({}, 'stop');
        }
        response.end('data: [DONE]\n\n');
      } catch (cause) {
        fixtureError = String(cause);
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: fixtureError } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fixture provider did not bind.');
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  try {
    await page.getByPlaceholder('New project').fill('Visual refinement');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    titleId = await kerf.app.evaluate(async () => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      const result = (await services.tools.call(
        'insertText',
        {
          text: 'A readable title',
          durationFrames: 96,
          style: { fontSize: 64, color: '#222222' },
        },
        'user',
      )) as { clipId: string };
      await services.tools.call(
        'editClip',
        { clipId: result.clipId, patch: { transform: { y: -700 } } },
        'user',
      );
      return result.clipId;
    });
    const before = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    const provider = await page.evaluate(
      (baseUrl) =>
        window.kerf.analysis.saveProvider({
          kind: 'openai-compatible',
          label: 'Fixture vision',
          baseUrl,
          model: 'fixture-vision',
          chatModel: 'fixture-vision',
          enabled: true,
          visionConsent: true,
          chatConsent: true,
        }),
      `http://127.0.0.1:${address.port}/v1`,
    );
    await page.evaluate((id) => window.kerf.chat.setProvider(id), provider.id);
    await page.getByRole('button', { name: 'Assistant', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Message the assistant' })
      .fill(
        'Improve the title readability and framing, then visually recheck it.',
      );
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      page.getByText(
        'Moved the title into frame and checked the same samples.',
        { exact: false },
      ),
    ).toBeVisible({ timeout: 60000 });
    expect(fixtureError).toBe('');
    expect(calls).toBe(6);
    expect(receivedImages).toBe(true);
    const repaired = page.locator('[aria-label="Visual repairs applied"]');
    await expect(repaired).toContainText('The title sits beyond the top edge');
    const recheck = page.locator('[aria-label="Visual recheck"]');
    await recheck.scrollIntoViewIfNeeded();
    await expect(recheck.getByRole('img')).toHaveCount(3);
    await page.screenshot({
      path: join(cacheRoot, 'phase4-visual-recheck.png'),
    });
    const history = await page.evaluate(() => window.kerf.chat.history());
    const activities = history[0]!.turns[0]!.tools;
    const initial = activities.find(
      (t) =>
        t.name === 'renderStoryboard' && t.visualReview?.pass === 'initial',
    )!.visualReview!;
    const final = activities.find(
      (t) =>
        t.name === 'renderStoryboard' && t.visualReview?.pass === 'recheck',
    )!.visualReview!;
    expect(initial.previews).toHaveLength(3);
    expect(initial.previews[0]!.dataUrl).not.toBe(final.previews[0]!.dataUrl);
    expect(activities.filter((t) => t.receipt)).toHaveLength(1);
    const after = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    const title = after.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === titleId)!;
    expect(title.transform.y).toBe(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      ),
    ).toEqual(before);
  } finally {
    await kerf.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
