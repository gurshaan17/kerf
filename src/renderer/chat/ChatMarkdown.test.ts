import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ChatMarkdown } from './ChatMarkdown';

it('renders assistant formatting as semantic HTML', () => {
  const html = renderToStaticMarkup(
    createElement(ChatMarkdown, {
      text: '## Audio work\n\n**Keyframe Animation** with `scale`.\n\n1. First\n2. Second\n\n* Nested options\n\n```js\nconst x = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |',
    }),
  );
  for (const tag of ['h2', 'strong', 'code', 'ol', 'ul', 'pre', 'table']) {
    expect(html).toContain(`<${tag}`);
  }
  expect(html).not.toContain('**');
});

it('does not render raw HTML or unsafe links', () => {
  const html = renderToStaticMarkup(
    createElement(ChatMarkdown, {
      text: '<script>alert(1)</script>\n\n[click](javascript:alert%281%29)',
    }),
  );
  expect(html).not.toContain('<script');
  expect(html).not.toContain('javascript:');
});
