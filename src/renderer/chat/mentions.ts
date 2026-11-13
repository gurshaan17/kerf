import type { ChatAssetMention } from '../../shared/contracts';

export function mentionQuery(text: string, caret: number) {
  const match = /(?:^|\s)@([^@\n]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1]!.length - 1, end: caret, query: match[1]! };
}

/** Keep tags attached to their text; editing a tag turns it back into plain text. */
export function updateMentions(
  before: string,
  after: string,
  mentions: readonly ChatAssetMention[],
  edit?: { start: number; end: number },
): ChatAssetMention[] {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  if (
    edit &&
    before.slice(0, edit.start) === after.slice(0, edit.start) &&
    before.slice(edit.end) ===
      after.slice(edit.end + after.length - before.length)
  ) {
    start = edit.start;
    oldEnd = edit.end;
    newEnd = oldEnd + after.length - before.length;
  }
  const delta = newEnd - oldEnd;
  return mentions.flatMap((mention) => {
    if (mention.end <= start) return [mention];
    if (mention.start >= oldEnd)
      return [
        { ...mention, start: mention.start + delta, end: mention.end + delta },
      ];
    return [];
  });
}
