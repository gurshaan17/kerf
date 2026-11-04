import type { AutoCutBridge } from '../../src/shared/auto-cut';

const unused = async (): Promise<never> => {
  throw new Error('Auto cut is not used by this fixture.');
};
export const unusedAutoCutBridge: AutoCutBridge = {
  generate: unused,
  proposal: unused,
  apply: unused,
};
