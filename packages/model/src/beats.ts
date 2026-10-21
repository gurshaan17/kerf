import { z } from 'zod';
import { idSchema } from './ids';

export const beatSchema = z.object({
  id: idSchema('beat'),
  frame: z.number().int().nonnegative(),
  strength: z.number().min(0).max(1).default(0.5),
});

export type Beat = z.infer<typeof beatSchema>;

export const beatSectionSchema = z
  .object({
    id: idSchema('section'),
    label: z.string().min(1),
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().nonnegative(),
  })
  .refine((section) => section.endFrame > section.startFrame, {
    message: 'A beat section must have a positive duration',
  });

export type BeatSection = z.infer<typeof beatSectionSchema>;

export const beatMapSchema = z.object({
  id: idSchema('beatmap'),
  assetId: idSchema('asset'),
  bpm: z.number().positive().max(400),
  offsetFrames: z.number().int().default(0),
  beats: z.array(beatSchema).default([]),
  sections: z.array(beatSectionSchema).default([]),
  createdAt: z.number().int().nonnegative(),
});

export type BeatMap = z.infer<typeof beatMapSchema>;

export function beatMapDurationFrames(beatMap: BeatMap): number {
  const latestBeat = beatMap.beats.reduce(
    (latest, beat) => Math.max(latest, beat.frame),
    beatMap.offsetFrames,
  );
  const latestSection = beatMap.sections.reduce(
    (latest, section) => Math.max(latest, section.endFrame),
    0,
  );
  return Math.max(latestBeat, latestSection);
}
