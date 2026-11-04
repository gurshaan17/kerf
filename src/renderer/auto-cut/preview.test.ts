import { expect, it } from 'vitest';
import { autoCutPreviewDestination } from './preview';
it('skips removed head, middle and tail ranges at exact frame boundaries', () => {
  const kept = [
    { startFrame: 10, endFrame: 30 },
    { startFrame: 60, endFrame: 90 },
  ];
  expect(autoCutPreviewDestination(0, kept)).toBe(10);
  expect(autoCutPreviewDestination(29, kept)).toBe(29);
  expect(autoCutPreviewDestination(30, kept)).toBe(60);
  expect(autoCutPreviewDestination(89, kept)).toBe(89);
  expect(autoCutPreviewDestination(90, kept)).toBeNull();
  expect(autoCutPreviewDestination(0, [])).toBeNull();
});
