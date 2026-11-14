import { createTranscript, newId } from '../../packages/model/src/index';
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import type { KerfServices } from '../../src/main/services';
import type { EditingJob, EditingProposal } from '@kerf/tools';
import {
  cacheRoot,
  ensureCaptionFixture,
  ensureScenesFixture,
  launchKerf,
} from './helpers';

test('reviews a multi-source rough cut, captions and verifies it, then undoes each stage', async () => {
  const sources = [ensureCaptionFixture(), ensureScenesFixture()];
  const kerf = await launchKerf({ whisper: false });
  const { page } = kerf;
  try {
    await page.getByPlaceholder('New project').fill('Planned first cut');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.evaluate((paths) => window.kerf.assets.import(paths), sources);
    await expect
      .poll(
        () =>
          page.evaluate(
            async () =>
              (await window.kerf.assets.list()).filter(
                (a) => a.status === 'ready',
              ).length,
          ),
        { timeout: 120000 },
      )
      .toBe(2);
    const assets = await page.evaluate(() => window.kerf.assets.list());
    const transcripts = assets.map((asset, index) =>
      createTranscript({
        assetId: asset.id,
        now: 1,
        segments: [
          {
            id: newId('segment'),
            startFrame: 0,
            endFrame: 48,
            text: `Demonstration step ${index + 1}`,
            words: [],
          },
        ],
      }),
    );
    const plan = await kerf.app.evaluate(async (_, transcripts) => {
      const services = (globalThis as { __kerfServices?: KerfServices })
        .__kerfServices!;
      const snapshot = services.projects.current()!;
      for (const transcript of transcripts)
        services.repository.saveTranscript(transcript);
      services.projects.refresh('analysis');
      return (await services.tools.call(
        'planRoughCut',
        {
          assetIds: snapshot.assets.map((a) => a.id),
          intent: 'Demonstration',
          targetDurationSeconds: 3,
          selections: [...transcripts].reverse().map((t) => ({
            evidenceId: t.segments[0]!.id,
            reason: 'Show this complete step in the story.',
          })),
        },
        'agent',
      )) as EditingJob & { proposal: EditingProposal };
    }, transcripts);
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.kerf.jobs.list()).find((j) => j.id === id)?.status,
          plan.id,
        ),
      )
      .toBe('succeeded');
    expect(
      await page.evaluate(
        async () =>
          (await window.kerf.projects.active())!.project.sequence.tracks.flatMap(
            (t) => t.clips,
          ).length,
      ),
    ).toBe(0);
    await kerf.app.evaluate(
      async (_, input) => {
        const services = (globalThis as { __kerfServices?: KerfServices })
          .__kerfServices!;
        await services.tools.call('applyEditProposal', input, 'mcp');
      },
      { jobId: plan.id, changeIds: plan.proposal.changes.map((c) => c.id) },
    );
    await page.getByRole('button', { name: 'Assistant', exact: true }).click();
    const reviews = page.getByLabel('AI editing reviews');
    await expect(
      reviews.getByText('Rough cut · succeeded', { exact: false }),
    ).toBeVisible();
    await expect(
      reviews.getByText('Speech was not truncated', { exact: false }),
    ).toBeVisible();
    const boxes = reviews.getByRole('checkbox');
    await expect(boxes).toHaveCount(2);
    await boxes.nth(1).uncheck();
    await expect(
      reviews.getByText('Selected cut: 2.00s', { exact: false }),
    ).toBeVisible();
    await boxes.nth(1).check();
    await reviews
      .getByRole('button', { name: 'Inspect source frames', exact: false })
      .first()
      .click();
    await expect
      .poll(() =>
        reviews
          .getByLabel('Review source footage')
          .evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await page.screenshot({
      path: join(cacheRoot, 'phase3-rough-cut-review.png'),
    });
    await reviews
      .getByRole('button', { name: 'Apply 2 reviewed changes', exact: true })
      .click();
    await expect(
      reviews.getByRole('button', { name: 'Caption this cut', exact: true }),
    ).toBeVisible();
    const cut = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project.sequence,
    );
    expect(
      cut.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'video'),
    ).toHaveLength(2);
    await reviews
      .getByRole('button', { name: 'Caption this cut', exact: true })
      .click();
    await expect(
      reviews.getByText('Captions applied as a separate undo step.', {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        async () =>
          (await window.kerf.projects.active())!.project.sequence.tracks
            .flatMap((t) => t.clips)
            .filter((c) => c.type === 'caption').length,
      ),
    ).toBe(2);
    await reviews
      .getByRole('button', { name: 'Verify this cut', exact: true })
      .click();
    await expect(
      reviews
        .getByRole('img', { name: 'Cut preview at frame', exact: false })
        .first(),
    ).toBeVisible({ timeout: 60000 });
    await page.screenshot({
      path: join(cacheRoot, 'phase3-rough-cut-verified.png'),
    });
    await page.evaluate(() => window.kerf.edits.undo());
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project.sequence,
      ),
    ).toEqual(cut);
    await page.evaluate(() => window.kerf.edits.undo());
    expect(
      await page.evaluate(
        async () =>
          (await window.kerf.projects.active())!.project.sequence.tracks.flatMap(
            (t) => t.clips,
          ).length,
      ),
    ).toBe(0);
    await expect(
      kerf.app.evaluate(
        async (_, input) =>
          (
            globalThis as { __kerfServices?: KerfServices }
          ).__kerfServices!.tools.confirmEditing(input.jobId, input.ids),
        { jobId: plan.id, ids: plan.proposal.changes.map((c) => c.id) },
      ),
    ).rejects.toThrow('already');
  } finally {
    await kerf.close();
  }
});
