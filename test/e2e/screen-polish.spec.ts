import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { KerfServices } from '../../src/main/services';
import { ensureScenesFixture, launchKerf } from './helpers';

test('analyses footage with vision, reviews evidence, adjusts, exports, persists and undoes polish', async () => {
  const source = ensureScenesFixture();
  let mode: 'suggestions' | 'empty' | 'invalid' | 'hold' = 'suggestions';
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const parts: Buffer[] = [];
    request.on('data', (part) => parts.push(part));
    request.on('end', () => {
      const raw = Buffer.concat(parts).toString();
      requests.push(raw);
      if (mode === 'hold') return;
      const suggestions =
        mode === 'empty'
          ? []
          : ['zoom', 'spotlight', 'callout'].map((kind, i) => ({
              startIndex: i,
              endIndex: mode === 'invalid' ? 9999 : i,
              kind,
              region: { x: 0.2, y: 0.25, w: 0.25, h: 0.3 },
              text: kind === 'callout' ? 'Result shown' : '',
              reason: `Visible result ${i + 1}`,
            }));
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
                content: JSON.stringify({ suggestions }),
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
    throw new Error('Fixture provider did not bind');
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  const overlays = async () =>
    page.evaluate(async () =>
      (await window.kerf.projects.active())!.project.sequence.tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.type === 'fxOverlay'),
    );
  try {
    await page.getByPlaceholder('New project').fill('AI screen polish');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.evaluate(
      async (path) => window.kerf.assets.import([path]),
      source,
    );
    await expect(
      page.locator('button[title="scenes-source.mp4"]'),
    ).toContainText('Ready', { timeout: 120000 });
    const asset = await page.evaluate(
      async () => (await window.kerf.assets.list())[0]!,
    );
    await kerf.app.evaluate(async (_, assetId) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      await services.tools.call('insertClip', { assetId }, 'user');
    }, asset.id);
    await page.locator('.k-clip--video').first().click();
    await page.getByRole('button', { name: 'Effects', exact: true }).click();
    const panel = page.getByRole('region', {
      name: 'Screen polish',
      exact: true,
    });
    // A named section is exposed as a region by Chromium.
    await expect(
      panel.getByRole('button', {
        name: 'Analyse screen recording',
        exact: true,
      }),
    ).toBeDisabled();
    await page.evaluate(
      async (baseUrl) =>
        window.kerf.analysis.saveProvider({
          kind: 'openai-compatible',
          label: 'Fixture vision',
          baseUrl,
          model: 'fixture-vision',
          enabled: true,
          visionConsent: true,
          chatConsent: false,
        }),
      `http://127.0.0.1:${address.port}/v1`,
    );
    await panel.getByLabel('Vision provider').focus();
    await expect(
      panel.getByRole('button', {
        name: 'Analyse screen recording',
        exact: true,
      }),
    ).toBeEnabled();
    const original = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    const analyse = async () =>
      panel
        .getByRole('button', { name: 'Analyse screen recording', exact: true })
        .click();
    await analyse();
    await expect(
      panel.getByRole('button', { name: 'Review suggestion 3', exact: true }),
    ).toBeVisible({ timeout: 120000 });
    expect(await overlays()).toHaveLength(0);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0]).toContain('image_url');
    expect(requests[0]).not.toContain(source);
    await expect(
      panel.getByText('Visible result 1', { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByLabel('Focus X (%)', { exact: true }).first(),
    ).toHaveValue('32.5');
    await panel
      .getByRole('button', { name: 'Evidence 0.00s', exact: true })
      .click();
    await expect(panel.locator('video')).toHaveJSProperty('readyState', 4);
    await page.screenshot({ path: 'test-results/screen-polish-ai-review.png' });
    await panel.getByLabel('Zoom amount', { exact: true }).fill('2.5');
    await panel.getByLabel('Focus X (%)', { exact: true }).first().fill('60');
    await panel
      .getByRole('button', { name: 'Apply screen polish', exact: true })
      .click();
    await expect.poll(async () => (await overlays()).length).toBe(3);
    const effects = await overlays();
    expect(effects.map((e) => e.props.kind)).toEqual([
      'zoom',
      'spotlight',
      'callout',
    ]);
    expect(effects[0]!.props).toMatchObject({
      zoom: 2.5,
      focus: { x: 0.6, y: 0.4 },
      region: { w: 0.25, h: 0.3 },
    });
    const exported = (await kerf.app.evaluate(async () => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      return services.tools.call('renderFrame', { frame: 60 }, 'user');
    })) as { path: string };
    expect(existsSync(exported.path)).toBe(true);
    const image = await loadImage(exported.path);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    // Spotlight is active at frame 60: green footage inside the target stays brighter.
    const inside = context.getImageData(
      Math.round(image.width * 0.325),
      Math.round(image.height * 0.4),
      1,
      1,
    ).data;
    const outside = context.getImageData(10, 10, 1, 1).data;
    expect(inside[1]!).toBeGreaterThan(outside[1]! + 30);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      ),
    ).toEqual(original);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    const projectId = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.id,
    );
    await page.evaluate(async (id) => {
      await window.kerf.projects.close();
      await window.kerf.projects.open(id);
    }, projectId);
    expect(await overlays()).toEqual(effects);
    await page.reload();
    await expect(page.locator('.k-shell__project-name')).toHaveText(
      'AI screen polish',
    );
    await page.getByRole('button', { name: 'Effects', exact: true }).click();
    await panel
      .getByLabel('Video clip', { exact: true })
      .selectOption(effects[0]!.linkedItemId!);
    // Empty and malformed model responses remain review-only and make no edits.
    mode = 'empty';
    await analyse();
    await expect(
      panel.getByText(
        'No clear screen interactions found. No edits were made.',
        { exact: true },
      ),
    ).toBeVisible({ timeout: 120000 });
    expect(await overlays()).toEqual(effects);
    mode = 'invalid';
    await analyse();
    await expect(panel.getByRole('alert')).toContainText('invalid', {
      timeout: 120000,
    });
    expect(await overlays()).toEqual(effects);
    mode = 'hold';
    await analyse();
    await expect(
      panel.getByRole('button', { name: 'Cancel analysis', exact: true }),
    ).toBeVisible();
    await panel
      .getByRole('button', { name: 'Cancel analysis', exact: true })
      .click();
    await expect(
      panel.getByRole('button', {
        name: 'Analyse screen recording',
        exact: true,
      }),
    ).toBeEnabled({ timeout: 15000 });
    expect(await overlays()).toEqual(effects);
  } finally {
    await kerf.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
