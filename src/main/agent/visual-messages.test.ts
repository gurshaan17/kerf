import { expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { prepareVisualMessages } from './visual-messages';

function messages(): ModelMessage[] {
  return [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'frame',
          toolName: 'renderStoryboard',
          input: {},
        },
        {
          type: 'tool-call',
          toolCallId: 'duration',
          toolName: 'readDuration',
          input: {},
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'frame',
          toolName: 'renderStoryboard',
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'Frame 12' },
              {
                type: 'file',
                mediaType: 'image/png',
                data: { type: 'data', data: 'iVBORw==' },
              },
            ],
          },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'duration',
          toolName: 'readDuration',
          output: { type: 'json', value: { frames: 96 } },
        },
      ],
    },
  ];
}
it('moves image bytes into standard image parts after all tool responses, without duplication', () => {
  const original = messages();
  const result = prepareVisualMessages(original, () => true);
  expect(result.map((message) => message.role)).toEqual([
    'assistant',
    'tool',
    'tool',
    'user',
  ]);
  const imageMessage = result[3];
  expect(imageMessage).toMatchObject({
    role: 'user',
    content: [
      expect.objectContaining({
        text: expect.stringContaining('renderStoryboard (frame)'),
      }),
      { type: 'image', image: 'iVBORw==', mediaType: 'image/png' },
    ],
  });
  expect(JSON.stringify(result[1])).not.toContain('iVBORw==');
  expect(JSON.stringify(original[1])).toContain('iVBORw==');
  expect(prepareVisualMessages(result, () => true)).toEqual(result);
});
it('stops image forwarding when consent is revoked, including previously prepared images', () => {
  expect(() => prepareVisualMessages(messages(), () => false)).toThrow(
    'consent changed',
  );
  const prepared = prepareVisualMessages(messages(), () => true);
  expect(() => prepareVisualMessages(prepared, () => false)).toThrow(
    'consent changed',
  );
});
