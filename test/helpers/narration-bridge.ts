import type { NarrationBridge } from '../../src/shared/contracts';
const unused = async (): Promise<never> => {
  throw new Error('Narration is not used by this fixture.');
};
export const unusedNarrationBridge: NarrationBridge = {
  generate: unused,
  captions: unused,
  updateText: unused,
  setTiming: unused,
  split: unused,
  merge: unused,
  add: unused,
  delete: unused,
  undo: unused,
  redo: unused,
  review: unused,
};
