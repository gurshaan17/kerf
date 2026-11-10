import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './chat.css';

export function ChatMarkdown({ text }: { readonly text: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} skipHtml>
      {text}
    </Markdown>
  );
}
