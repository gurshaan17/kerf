import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import type { KerfServices } from '../../src/main/services';
import { ensureScenesFixture, launchKerf } from './helpers';

test('compares, dismisses, applies and invalidates a suggested zoom', async () => {
  const source = ensureScenesFixture();
  let clipId = '';
  let providerId = '';
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const { messages } = JSON.parse(raw);
    const last = messages.at(-1);
    const storyboardId = raw.match(/visual_[a-f0-9-]{36}/)?.[0];
    const tool =
      last.role === 'user' &&
      typeof last.content === 'string' &&
      last.content.startsWith('How can I improve')
        ? { name: 'renderStoryboard', input: { frames: [36], maxWidth: 480 } }
        : last.role === 'user' &&
            storyboardId &&
            raw.includes('data:image/png;base64,')
          ? {
              name: 'suggestZoom',
              input: {
                storyboardId,
                clipId,
                providerId,
                frame: 36,
                x: 0.3,
                y: 0.4,
                reason: 'Draw attention to the subject.',
              },
            }
          : null;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = tool
      ? {
          tool_calls: [
            {
              index: 0,
              id: `call-${tool.name}`,
              type: 'function',
              function: {
                name: tool.name,
                arguments: JSON.stringify(tool.input),
              },
            },
          ],
        }
      : {
          content:
            'Gently zoom in around 0:01 to draw attention to the subject.',
        };
    for (const choice of [
      { delta: { role: 'assistant', ...delta }, finish_reason: null },
      { delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' },
    ]) {
      response.write(
        `data: ${JSON.stringify({ id: 'zoom-fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture-vision', choices: [{ index: 0, ...choice }] })}\n\n`,
      );
    }
    response.end('data: [DONE]\n\n');
  });
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No fixture port');
    await page.getByPlaceholder('New project').fill('Review zoom');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.evaluate((path) => window.kerf.assets.import([path]), source);
    await expect(
      page.locator('button[title="scenes-source.mp4"]'),
    ).toContainText('Ready');
    const asset = await page.evaluate(
      async () => (await window.kerf.assets.list())[0]!,
    );
    clipId = await kerf.app.evaluate(async (_, assetId) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      return (
        (await services.tools.call('insertClip', { assetId }, 'user')) as {
          clipId: string;
        }
      ).clipId;
    }, asset.id);
    providerId = await page.evaluate(async (port) => {
      const provider = await window.kerf.analysis.saveProvider({
        kind: 'openai-compatible',
        label: 'Zoom fixture',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'fixture-vision',
        chatModel: 'fixture-vision',
        enabled: true,
        visionConsent: true,
        chatConsent: true,
      });
      await window.kerf.chat.setProvider(provider.id);
      return provider.id;
    }, address.port);
    await page.getByRole('button', { name: 'Assistant', exact: true }).click();
    const sequence = () =>
      page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      );
    const before = await sequence();
    const preview = page.getByRole('button', {
      name: 'Preview zoom',
      exact: true,
    });
    const dialog = page.getByRole('dialog', { name: 'Preview zoom' });
    const ask = async () => {
      await page
        .getByRole('textbox', { name: 'Message the assistant' })
        .fill('How can I improve this video?');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await preview.click();
      await expect(
        dialog.getByRole('button', { name: 'Apply zoom' }),
      ).toBeEnabled();
    };

    await ask();
    const position = dialog.getByRole('slider', { name: 'Proposal position' });
    await expect(position).toHaveValue('24');
    await position.fill('50');
    await dialog.getByRole('button', { name: 'Original' }).click();
    await expect(position).toHaveValue('50');
    await dialog.getByRole('button', { name: 'With zoom' }).click();
    await expect(position).toHaveValue('50');
    await dialog.getByRole('button', { name: 'Dismiss' }).click();
    await expect(preview).toHaveCount(0);
    expect(await sequence()).toEqual(before);

    await ask();
    await dialog.getByRole('button', { name: 'Apply zoom' }).click();
    await expect(page.getByText('Zoom applied', { exact: true })).toBeVisible();
    expect(
      (await sequence()).tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.type === 'fxOverlay'),
    ).toMatchObject({
      startFrame: 36,
      linkedItemId: clipId,
      props: { kind: 'zoom', zoom: 1.2 },
    });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(sequence).toEqual(before);

    await ask();
    await kerf.app.evaluate(async (_, id) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      await services.tools.call(
        'editClip',
        { clipId: id, patch: { label: 'Updated source' } },
        'user',
      );
    }, clipId);
    await expect(
      dialog.getByRole('button', { name: 'Apply zoom' }),
    ).toBeDisabled();
    expect(
      (await sequence()).tracks
        .flatMap((track) => track.clips)
        .some((clip) => clip.type === 'fxOverlay'),
    ).toBe(false);
  } finally {
    await kerf.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
