import { copyFileSync, utimesSync } from 'node:fs';
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
  const kerf = await launchKerf({ whisper: false });
  const sources = [
    join(kerf.workspace, 'preview-speech.mp4'),
    ensureScenesFixture(),
  ];
  copyFileSync(ensureCaptionFixture(), sources[0]!);
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
    const beforePreview = await page.evaluate(async () => {
      const snapshot = (await window.kerf.projects.active())!;
      return { project: snapshot.project, history: snapshot.history };
    });
    await page.evaluate(() => {
      const original = HTMLMediaElement.prototype.play;
      const media: HTMLMediaElement[] = [];
      (globalThis as { __proposalMedia?: HTMLMediaElement[] }).__proposalMedia =
        media;
      HTMLMediaElement.prototype.play = function () {
        if (!media.includes(this)) media.push(this);
        return original.call(this);
      };
    });
    await reviews
      .getByRole('button', { name: 'Preview selected cut', exact: true })
      .click();
    const audition = page.getByRole('dialog', {
      name: 'Rough-cut proposal preview',
      exact: true,
    });
    await expect(audition.getByLabel('Proposal playback')).toBeVisible();
    await expect(audition.getByLabel('Proposal position')).toHaveAttribute(
      'max',
      '95',
    );
    await audition
      .getByLabel('Proposal position')
      .evaluate((input: HTMLInputElement) => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(input, '60');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await expect(audition.locator('canvas')).toHaveAttribute(
      'aria-label',
      'Frame 60',
    );
    await audition.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            (globalThis as { __proposalMedia?: HTMLMediaElement[] })
              .__proposalMedia ?? []
          ).some(
            (m) =>
              m.tagName === 'AUDIO' &&
              !m.paused &&
              m.volume > 0 &&
              m.currentTime >= 0.5,
          ),
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: join(cacheRoot, 'phase4-proposal-playback.png'),
    });
    expect(
      await page.evaluate(async () => {
        const snapshot = (await window.kerf.projects.active())!;
        return { project: snapshot.project, history: snapshot.history };
      }),
    ).toEqual(beforePreview);
    await audition
      .getByRole('button', { name: 'Close preview', exact: true })
      .click();
    await expect(audition).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            (globalThis as { __proposalMedia?: HTMLMediaElement[] })
              .__proposalMedia ?? []
          ).every((m) => m.paused && !m.getAttribute('src')),
        ),
      )
      .toBe(true);
    await reviews
      .getByRole('button', { name: 'Preview selected cut', exact: true })
      .click();
    await expect(audition.getByLabel('Proposal playback')).toBeVisible();
    // A changed review selection invalidates the candidate, even without a timeline edit.
    await kerf.app.evaluate(
      async (_, input) => {
        await (
          globalThis as { __kerfServices?: KerfServices }
        ).__kerfServices!.tools.call(
          'applyEditProposal',
          { jobId: input.jobId, changeIds: [input.id] },
          'mcp',
        );
      },
      { jobId: plan.id, id: plan.proposal.changes[0]!.id },
    );
    await expect(audition.getByRole('alert')).toContainText(
      'selection, project or source changed',
    );
    await expect(audition.getByLabel('Proposal playback')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            (globalThis as { __proposalMedia?: HTMLMediaElement[] })
              .__proposalMedia ?? []
          ).every((m) => m.paused && !m.getAttribute('src')),
        ),
      )
      .toBe(true);
    await audition
      .getByRole('button', { name: 'Close preview', exact: true })
      .click();
    await boxes.nth(1).check();
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
    const fresh = await kerf.app.evaluate(
      async (_, input) =>
        (
          globalThis as { __kerfServices?: KerfServices }
        ).__kerfServices!.tools.call(
          'planRoughCut',
          {
            assetIds: input.assets,
            intent: 'Demonstration',
            selections: input.ids.map((evidenceId) => ({
              evidenceId,
              reason: 'Preview this complete step',
            })),
          },
          'mcp',
        ) as Promise<EditingJob>,
      {
        assets: assets.map((a) => a.id),
        ids: [...transcripts].reverse().map((t) => t.segments[0]!.id),
      },
    );
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.kerf.jobs.list()).find((j) => j.id === id)?.status,
          fresh.id,
        ),
      )
      .toBe('succeeded');
    await reviews
      .getByRole('button', { name: 'Preview selected cut', exact: true })
      .click();
    await expect(audition.getByLabel('Proposal playback')).toBeVisible();
    await audition
      .getByRole('button', { name: 'Close preview', exact: true })
      .click();
    await page.clock.install({ time: new Date() });
    await reviews
      .getByRole('button', { name: 'Preview selected cut', exact: true })
      .click();
    await expect(audition.getByLabel('Proposal playback')).toBeVisible();
    await page.clock.fastForward(120_001);
    await expect(audition.getByRole('alert')).toContainText('preview expired');
    await expect(audition.getByLabel('Proposal playback')).toHaveCount(0);
    await audition
      .getByRole('button', { name: 'Close preview', exact: true })
      .click();
    await page.clock.setSystemTime(new Date());
    await reviews
      .getByRole('button', { name: 'Preview selected cut', exact: true })
      .click();
    await expect(audition.getByLabel('Proposal playback')).toBeVisible();
    const unchanged = await page.evaluate(
      async () => (await window.kerf.projects.active())!.project,
    );
    await audition.getByRole('button', { name: 'Play', exact: true }).focus();
    await page.keyboard.press('Meta+Shift+z');
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project,
      ),
    ).toEqual(unchanged);
    utimesSync(sources[0]!, new Date(), new Date(Date.now() + 5000));
    await expect(audition.getByRole('alert')).toContainText(
      'selection, project or source changed',
    );
    await expect(audition.getByLabel('Proposal playback')).toHaveCount(0);
    expect(
      await page.evaluate(
        async () => (await window.kerf.projects.active())!.project,
      ),
    ).toEqual(unchanged);
    await audition
      .getByRole('button', { name: 'Close preview', exact: true })
      .click();
  } finally {
    await kerf.close();
  }
});
