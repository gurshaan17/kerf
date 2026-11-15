import type { ImagePart, ModelMessage } from 'ai';

/**
 * Some chat adapters stringify tool content instead of forwarding its images.
 * Keep the tool's text/result association and deliver images as ordinary user
 * image parts after all adjacent tool results have been answered.
 */
export function prepareVisualMessages(
  messages: readonly ModelMessage[],
  canSendImages: () => boolean,
): ModelMessage[] {
  const output: ModelMessage[] = [];
  const images: ImagePart[] = [];
  const sources: string[] = [];
  const requireConsent = () => {
    if (!canSendImages())
      throw new Error(
        'Vision or chat consent changed. Image delivery and visual refinement stopped.',
      );
  };
  const flush = () => {
    if (!images.length) return;
    requireConsent();
    output.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Tool-rendered image evidence for ${sources.join(', ')}. Match these images to the frames in those tool results. Inspect only the samples; do not infer whole-video, playback or audio quality.`,
        },
        ...images,
      ],
    });
    images.length = 0;
    sources.length = 0;
  };
  for (const message of messages) {
    if (message.role !== 'tool') {
      flush();
      if (
        message.role === 'user' &&
        Array.isArray(message.content) &&
        message.content.some(
          (part) =>
            part.type === 'image' ||
            (part.type === 'file' && part.mediaType.startsWith('image/')),
        )
      )
        requireConsent();
      output.push(message);
      continue;
    }
    output.push({
      ...message,
      content: message.content.map((part) => {
        if (part.type !== 'tool-result' || part.output.type !== 'content')
          return part;
        const remaining = part.output.value.filter((content) => {
          if (
            content.type !== 'file' ||
            !content.mediaType.startsWith('image/') ||
            content.data.type !== 'data'
          )
            return true;
          requireConsent();
          images.push({
            type: 'image',
            image: content.data.data,
            mediaType: content.mediaType,
          });
          return false;
        });
        if (remaining.length === part.output.value.length) return part;
        sources.push(`${part.toolName} (${part.toolCallId})`);
        return {
          ...part,
          output: {
            ...part.output,
            value: [
              ...remaining,
              {
                type: 'text' as const,
                text: 'Rendered image bytes are supplied as image evidence immediately after the tool results.',
              },
            ],
          },
        };
      }),
    });
  }
  flush();
  return output;
}
