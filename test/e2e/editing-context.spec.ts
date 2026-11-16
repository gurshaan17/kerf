import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication } from 'playwright';
import { launchKerf, repoRoot } from './helpers';

// The provider is deterministic; this measures continuity, not editorial judgment.
test('retains output IDs across an app restart and marks undone outputs stale', async () => {
  let calls = 0;
  let outputId = '';
  const prompts: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      prompts.push(raw);
      const stage = calls++;
      const action =
        stage === 0
          ? {
              name: 'insertText',
              input: { text: 'Continuity title', durationFrames: 96 },
            }
          : stage === 2
            ? {
                name: 'editClip',
                input: { clipId: outputId, patch: { durationFrames: 48 } },
              }
            : null;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = (delta: unknown, finish: string | null = null) =>
        response.write(
          `data: ${JSON.stringify({ id: `context-${stage}`, object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      emit({ role: 'assistant' });
      if (action) {
        emit({
          tool_calls: [
            {
              index: 0,
              id: `call-${stage}`,
              type: 'function',
              function: {
                name: action.name,
                arguments: JSON.stringify(action.input),
              },
            },
          ],
        });
        emit({}, 'tool_calls');
      } else {
        emit({ content: 'Recorded the result.' });
        emit({}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing fixture port');
  const kerf = await launchKerf({ whisper: false });
  let restarted: ElectronApplication | undefined;
  try {
    let page = kerf.page;
    await page.getByPlaceholder('New project').fill('Editing continuity');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const projectId = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.id,
    );
    const provider = await page.evaluate(
      (baseUrl) =>
        window.kerf.analysis.saveProvider({
          kind: 'openai-compatible',
          label: 'Fixture',
          baseUrl,
          model: 'fixture',
          chatModel: 'fixture',
          enabled: true,
          visionConsent: false,
          chatConsent: true,
        }),
      `http://127.0.0.1:${address.port}/v1`,
    );
    await page.evaluate((id) => window.kerf.chat.setProvider(id), provider.id);
    await page.evaluate(() =>
      window.kerf.chat.send({ message: 'Create a 96-frame title.' }),
    );
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.kerf.chat.history())[0]?.turns[0]?.status,
        ),
      )
      .toBe('done');
    const saved = await page.evaluate(
      async () => (await window.kerf.chat.history())[0]!,
    );
    outputId = saved.editingContext!.tasks[0]!.references.find(
      (r) => r.role === 'output',
    )!.id;
    expect(calls).toBe(2);
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
    page = await restarted.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate((id) => window.kerf.projects.open(id), projectId);
    await page.evaluate((id) => window.kerf.chat.open(id), saved.id);
    expect(calls).toBe(2);
    await page.evaluate(() =>
      window.kerf.chat.send({ message: 'Shorten that title to 48 frames.' }),
    );
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.kerf.chat.history())[0]?.turns[1]?.status,
        ),
      )
      .toBe('done');
    expect(prompts[2]).toContain(outputId);
    const clips = await page.evaluate(async () =>
      (await window.kerf.projects.active())!.project.sequence.tracks.flatMap(
        (t) => t.clips,
      ),
    );
    expect(clips.find((c) => c.id === outputId)?.durationFrames).toBe(48);
    await page.evaluate(() => window.kerf.edits.undo());
    const reopened = await page.evaluate(
      (id) => window.kerf.chat.open(id),
      saved.id,
    );
    expect(
      reopened.editingContext!.tasks[1]!.references.find(
        (r) => r.id === outputId,
      )?.stale,
    ).toBe(true);
    expect(calls).toBe(4);
  } finally {
    await restarted?.close();
    await kerf.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
