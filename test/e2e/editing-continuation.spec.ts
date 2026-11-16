import { createServer } from 'node:http';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { KerfServices } from '../../src/main/services';
import { cacheRoot, ensureScenesFixture, launchKerf } from './helpers';

test('finishes analysis after a turn, reopens one owned card, continues without reanalysis and applies once', async () => {
  let clipId = '';
  let providerId = '';
  let jobId = '';
  let changeIds: string[] = [];
  let chatCalls = 0;
  let analysisCalls = 0;
  let analysisWaiting = false;
  let finishAnalysis = () => {};
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        stream?: boolean;
      };
      if (!body.stream) {
        analysisCalls++;
        analysisWaiting = true;
        finishAnalysis = () => {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              id: 'analysis',
              object: 'chat.completion',
              created: 0,
              model: 'fixture',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: JSON.stringify({
                      removals: [
                        {
                          unitId: 'unit_1',
                          reason: 'Repeated setup',
                          confidence: 'clear',
                        },
                      ],
                    }),
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 10,
                total_tokens: 20,
              },
            }),
          );
        };
        return;
      }
      const stage = chatCalls++;
      const action =
        stage === 0
          ? {
              name: 'planAutoCut',
              input: { clipId, providerId, purpose: 'Keep the demonstration' },
            }
          : stage === 2
            ? { name: 'readEditProposal', input: { jobId } }
            : stage === 3
              ? { name: 'applyEditProposal', input: { jobId, changeIds } }
              : null;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = (delta: unknown, finish: string | null = null) =>
        response.write(
          `data: ${JSON.stringify({ id: `chat-${stage}`, object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
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
        emit({
          content:
            stage === 1
              ? 'Analysis is running. Return when it completes.'
              : 'Review the existing result and click Apply.',
        });
        emit({}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No fixture port');
  const source = ensureScenesFixture();
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  try {
    await page.getByPlaceholder('New project').fill('Async continuation');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.evaluate((path) => window.kerf.assets.import([path]), source);
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.kerf.assets.list())[0]?.status),
      )
      .toBe('ready');
    clipId = await kerf.app.evaluate(async () => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      const result = (await services.tools.call(
        'insertClip',
        { assetId: services.projects.current()!.assets[0]!.id },
        'user',
      )) as { clipId: string };
      return result.clipId;
    });
    const provider = await page.evaluate(
      (baseUrl) =>
        window.kerf.analysis.saveProvider({
          kind: 'openai-compatible',
          label: 'Fixture',
          baseUrl,
          model: 'fixture',
          chatModel: 'fixture',
          enabled: true,
          visionConsent: true,
          chatConsent: true,
        }),
      `http://127.0.0.1:${address.port}/v1`,
    );
    providerId = provider.id;
    await page.evaluate((id) => window.kerf.chat.setProvider(id), providerId);
    await page.getByRole('button', { name: 'Assistant', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Message the assistant' })
      .fill('Analyze this clip and prepare a proposal.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.kerf.chat.history())[0]?.turns[0]?.status,
        ),
      )
      .toBe('done');
    await expect.poll(() => analysisWaiting).toBe(true);
    expect(analysisCalls).toBe(1);
    const history = await page.evaluate(() => window.kerf.chat.history());
    const jobs = await page.evaluate(() => window.kerf.jobs.list());
    jobId = jobs.find((j) => j.kind === 'analysis.autoCut')!.id;
    const card = page.getByLabel(`Editing job ${jobId}`, { exact: true });
    await expect(card).toHaveCount(1);
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(card).toHaveCount(0);
    finishAnalysis();
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.kerf.jobs.list()).find((j) => j.id === id)?.status,
          jobId,
        ),
      )
      .toBe('succeeded');
    await expect(card).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Chat history', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: 'Analyze this clip and prepare a proposal.',
        exact: false,
      })
      .click();
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Completed');
    expect(chatCalls).toBe(2);
    const review = await page.evaluate(
      async (id) =>
        (await window.kerf.editing!.reviews()).find((r) => r.job.id === id)!,
      jobId,
    );
    expect(review.origin?.conversationId).toBe(history[0]!.id);
    changeIds = review.proposal!.changes.map((c) => c.id);
    const before = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    await page
      .getByLabel('Suggested actions')
      .getByRole('button', { name: 'Review completed analysis', exact: true })
      .click();
    await expect(
      card.getByRole('button', { name: 'Hide result', exact: true }),
    ).toBeVisible();
    expect(analysisCalls).toBe(1);
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.screenshot({
      path: join(cacheRoot, 'phase2-completed-job.png'),
    });
    await card
      .getByRole('button', { name: 'Continue with this result', exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.kerf.chat.history())[0]?.turns[1]?.status,
        ),
      )
      .toBe('done');
    expect(chatCalls).toBe(5);
    expect(analysisCalls).toBe(1);
    expect(
      await page.evaluate(
        async () => (await window.kerf.chat.history())[0]!.turns.length,
      ),
    ).toBe(2);
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      ),
    ).toEqual(before);
    await card.getByRole('button', { name: /Apply 1 reviewed change/ }).click();
    await expect(card).toContainText('Applied:');
    const applied = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    expect(applied).not.toEqual(before);
    const replayRejected = await page.evaluate(
      async ({ jobId, changeIds }) => {
        try {
          await window.kerf.editing!.confirm({ jobId, changeIds });
          return false;
        } catch {
          return true;
        }
      },
      { jobId, changeIds },
    );
    expect(replayRejected).toBe(true);
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      ),
    ).toEqual(applied);
    await page.evaluate(() => window.kerf.edits.undo());
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
