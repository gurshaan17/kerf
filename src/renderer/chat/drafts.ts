import type { ChatAssetMention } from '../../shared/contracts';
import type { ChatScope } from '../../shared/chat-scope';

export interface ChatDraft {
  readonly text: string;
  readonly mentions: readonly ChatAssetMention[];
  readonly scope?: ChatScope;
}
export const EMPTY_CHAT_DRAFT: ChatDraft = {
  text: '',
  mentions: [],
  scope: undefined,
};
export const chatDraftKey = (
  projectId: string | null | undefined,
  conversationId: string | null,
) => JSON.stringify([projectId ?? null, conversationId]);
