import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { launchKerf } from './helpers';

test('shows feedback before the collapsed inspection evidence', async () => {
  const answer =
    'At the start, zoom in on the purple bar so the jump is easy to spot.';
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const { messages } = JSON.parse(body);
    const inspected = messages.some(
      (message: { role: string }) => message.role === 'tool',
    );
    const delta = inspected
      ? { content: answer }
      : {
          tool_calls: [
            {
              index: 0,
              id: 'inspect',
              type: 'function',
              function: { name: 'readTimeline', arguments: '{}' },
            },
          ],
        };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const choice of [
      { delta: { role: 'assistant', ...delta }, finish_reason: null },
      { delta: {}, finish_reason: inspected ? 'stop' : 'tool_calls' },
    ]) {
      response.write(
        `data: ${JSON.stringify({ id: 'advice', object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, ...choice }] })}\n\n`,
      );
    }
    response.end('data: [DONE]\n\n');
  });
  const kerf = await launchKerf({ whisper: false });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No fixture port');
    const { page } = kerf;
    await page.getByPlaceholder('New project').fill('Incident breakdown');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.evaluate(async (port) => {
      const provider = await window.kerf.analysis.saveProvider({
        kind: 'openai-compatible',
        label: 'Advice fixture',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'fixture',
        chatModel: 'fixture',
        enabled: true,
        visionConsent: false,
        chatConsent: true,
      });
      await window.kerf.chat.setProvider(provider.id);
    }, address.port);
    await page.getByRole('button', { name: 'Assistant', exact: true }).click();
    const readProject = () =>
      page.evaluate(async () => (await window.kerf.projects.active())?.project);
    const before = await readProject();
    await page
      .getByRole('textbox', { name: 'Message the assistant' })
      .fill('How can I improve this video?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    const details = page.getByText('Technical details', { exact: true });
    const inspection = page.getByText('readTimeline', { exact: true });
    await expect(details).toBeVisible();
    await expect(inspection).toBeAttached();
    await expect(inspection).toBeHidden();
    await details.click();
    await expect(inspection).toBeVisible();
    expect(await readProject()).toEqual(before);
  } finally {
    await kerf.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
