import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from 'playwright';
import type { KerfServices } from '../../src/main/services';
import { cacheRoot, launchKerf } from './helpers';

function stream(response: ServerResponse, id: number) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = (delta: unknown, finish: string | null = null) =>
    response.write(
      `data: ${JSON.stringify({ id: `comfort-${id}`, object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
    );
  emit({ role: 'assistant' });
  return {
    text: (content: string) => emit({ content }),
    finish: () => {
      emit({}, 'stop');
      response.end('data: [DONE]\n\n');
    },
    tool: (name: string, input: unknown) => {
      emit({
        tool_calls: [
          {
            index: 0,
            id: `call-${id}`,
            type: 'function',
            function: { name, arguments: JSON.stringify(input) },
          },
        ],
      });
      emit({}, 'tool_calls');
      response.end('data: [DONE]\n\n');
    },
  };
}
async function configure(page: Page, port: number) {
  const provider = await page.evaluate(
    (baseUrl) =>
      window.kerf.analysis.saveProvider({
        kind: 'openai-compatible',
        label: 'Comfort fixture',
        baseUrl,
        model: 'fixture',
        chatModel: 'fixture',
        enabled: true,
        visionConsent: false,
        chatConsent: true,
      }),
    `http://127.0.0.1:${port}/v1`,
  );
  await page.evaluate((id) => window.kerf.chat.setProvider(id), provider.id);
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
}

test('copies selected text from an assistant reply', async () => {
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      const control = stream(response, 0);
      control.text('Try the **crossfade** between the clips.');
      control.finish();
    });
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No fixture port');
    await page.getByPlaceholder('New project').fill('Copy reply');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await configure(page, address.port);
    await page
      .getByRole('textbox', { name: 'Message the assistant' })
      .fill('How should I join these clips?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Stop', exact: true }),
    ).toHaveCount(0);

    await page.getByText('crossfade', { exact: true }).dblclick();
    const selection = await page.evaluate(() =>
      window.getSelection()?.toString(),
    );
    expect(selection).toBe('crossfade');

    await page.evaluate(() => {
      document.addEventListener(
        'copy',
        (event) => {
          event.preventDefault();
          document.body.dataset.copiedText = window.getSelection()?.toString();
        },
        { once: true },
      );
    });
    await page.keyboard.press('ControlOrMeta+c');
    await expect(page.locator('body')).toHaveAttribute(
      'data-copied-text',
      'crossfade',
      { timeout: 2_000 },
    );
  } finally {
    await kerf.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('preserves drafts and reader position during streaming, completion, cancellation and chat switching', async () => {
  let calls = 0;
  const controls: ReturnType<typeof stream>[] = [];
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      const stage = calls++;
      const control = stream(response, stage);
      controls[stage] = control;
      control.text(
        stage === 0
          ? Array.from(
              { length: 40 },
              (_, i) =>
                `Paragraph ${i}. This response has enough content to read earlier messages while the assistant continues working.`,
            ).join('\n\n')
          : 'A response is available.',
      );
      if (stage === 1) control.finish();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No fixture port');
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  try {
    await page.getByPlaceholder('New project').fill('Comfort');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await configure(page, address.port);
    await expect(
      page.getByRole('button', { name: 'Import footage', exact: true }),
    ).toBeVisible();
    const input = page.getByRole('textbox', { name: 'Message the assistant' });
    const send = page.getByRole('button', { name: 'Send', exact: true });
    await input.fill('First streaming question.');
    await send.click();
    await expect(
      page.getByText('Paragraph 39.', { exact: false }),
    ).toBeAttached();
    await expect(input).toBeEnabled();
    await input.fill('Draft A survives streaming.');
    await expect(send).toBeDisabled();
    await input.press('Enter');
    expect(calls).toBe(1);
    await expect(
      page.getByRole('button', { name: 'Stop', exact: true }),
    ).toBeVisible();
    const messages = page.getByLabel('Chat messages', { exact: true });
    await messages.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(
      page.getByRole('button', { name: 'Jump to latest', exact: true }),
    ).toBeVisible();
    controls[0]!.text(
      '\n\nAdditional streamed content while the reader stays above.\n\n' +
        'More details. '.repeat(200),
    );
    await expect
      .poll(() => messages.textContent())
      .toContain('Additional streamed content');
    expect(
      await messages.evaluate((element) => element.scrollTop),
    ).toBeLessThan(2);
    await page.screenshot({ path: join(cacheRoot, 'phase3-draft-scroll.png') });
    await page
      .getByRole('button', { name: 'Jump to latest', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() =>
        messages.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop),
      )
      .toBeLessThan(3);
    controls[0]!.finish();
    await expect(
      page.getByRole('button', { name: 'Stop', exact: true }),
    ).toHaveCount(0);
    await expect(input).toHaveValue('Draft A survives streaming.');
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(input).toHaveValue('');
    await input.fill('Second conversation question.');
    await send.click();
    await expect(
      page.getByRole('button', { name: 'Stop', exact: true }),
    ).toHaveCount(0);
    await input.fill('Draft B stays separate.');
    await page
      .getByRole('button', { name: 'Chat history', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'First streaming question.', exact: false })
      .click();
    await expect(input).toHaveValue('Draft A survives streaming.');
    await page
      .getByRole('button', { name: 'Chat history', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: 'Second conversation question.',
        exact: false,
      })
      .click();
    await expect(input).toHaveValue('Draft B stays separate.');
    await send.click();
    await expect(
      page.getByRole('button', { name: 'Stop', exact: true }),
    ).toBeVisible();
    await input.fill('This draft survives Stop.');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Stop', exact: true }),
    ).toHaveCount(0);
    await expect(input).toHaveValue('This draft survives Stop.');
    expect(calls).toBe(3);
  } finally {
    await kerf.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('freezes submitted scope, rejects other targets and validates stale or missing selection', async () => {
  let a = '';
  let b = '';
  let calls = 0;
  let release = () => {};
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      const stage = calls++;
      const control = stream(response, stage);
      if (stage === 0) release = () => control.tool('readTimeline', {});
      else if (stage === 1)
        control.tool('editClip', {
          clipId: b,
          patch: { text: 'Must not change' },
        });
      else if (stage === 2)
        control.tool('editClip', {
          clipId: a,
          patch: { text: 'Scoped change' },
        });
      else {
        control.text('Changed the scoped title only.');
        control.finish();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No fixture port');
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  try {
    await page.getByPlaceholder('New project').fill('Scope');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const ids = await kerf.app.evaluate(async () => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      const first = (await services.tools.call(
        'insertText',
        { text: 'A', startFrame: 0, durationFrames: 96 },
        'user',
      )) as { clipId: string };
      const second = (await services.tools.call(
        'insertText',
        { text: 'B', startFrame: 120, durationFrames: 96 },
        'user',
      )) as { clipId: string };
      return [first.clipId, second.clipId];
    });
    [a, b] = [ids[0]!, ids[1]!];
    await configure(page, address.port);
    const titles = page.locator('.k-clip--text');
    await titles.nth(0).focus();
    await titles.nth(0).press('Enter');
    const input = page.getByRole('textbox', { name: 'Message the assistant' });
    const send = page.getByRole('button', { name: 'Send', exact: true });
    await input.fill('Improve only this selected title.');
    await send.click();
    await expect.poll(() => calls).toBe(1);
    await titles.nth(1).focus();
    await titles.nth(1).press('Enter');
    release();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.kerf.chat.history())[0]?.turns[0]?.status,
        ),
      )
      .toBe('done');
    const state = await page.evaluate(async () => ({
      history: await window.kerf.chat.history(),
      snapshot: await window.kerf.projects.active(),
    }));
    expect(state.history[0]!.turns[0]!.scope).toMatchObject({
      kind: 'targets',
      clipIds: [a],
    });
    const clips = state.snapshot!.project.sequence.tracks.flatMap(
      (t) => t.clips,
    );
    expect(clips.find((c) => c.id === a)).toMatchObject({
      text: 'Scoped change',
    });
    expect(clips.find((c) => c.id === b)).toMatchObject({ text: 'B' });
    await expect(page.getByLabel('Submitted scope')).toHaveAttribute(
      'title',
      new RegExp(a),
    );
    await expect(
      page
        .getByLabel('Edit scope')
        .getByRole('button', { name: `Remove scoped clip ${b}`, exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Use current selection', exact: true })
      .click();
    await input.fill('My next edit.');
    await kerf.app.evaluate(async (_, id) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      await services.tools.call(
        'editClip',
        { clipId: id, patch: { text: 'External change' } },
        'user',
      );
    }, b);
    await expect(
      page.getByText(
        'The selection changed. Refresh the scope before sending.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(send).toBeDisabled();
    await page
      .getByRole('button', { name: 'Refresh scope', exact: true })
      .click();
    await expect(send).toBeEnabled();
    await kerf.app.evaluate(async (_, id) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      await services.tools.call(
        'applyBatch',
        { commands: [{ type: 'clip.remove', clipId: id }] },
        'user',
      );
    }, b);
    await page
      .getByRole('button', { name: 'Refresh scope', exact: true })
      .click();
    await expect(
      page.getByText(
        'A scoped clip is missing. Remove it or use the current selection.',
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole('button', { name: `Remove scoped clip ${b}`, exact: true })
      .click();
    await expect(send).toBeDisabled();
    await page
      .getByLabel('Edit scope')
      .getByRole('button', { name: 'Project', exact: true })
      .click();
    await expect(send).toBeEnabled();
    await page.screenshot({ path: join(cacheRoot, 'phase3-scope.png') });
  } finally {
    await kerf.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
