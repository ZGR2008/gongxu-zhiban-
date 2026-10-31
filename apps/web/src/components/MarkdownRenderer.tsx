import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Formatting is optional; raw HTML and model-supplied image fetches stay disabled. */
export function MarkdownRenderer({ value }: { value: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      img: ({ alt }) => <span className="markdown-image-note">[图片：{alt || '未命名'}]</span>,
      table: ({ children }) => <div className="markdown-table-scroll" tabIndex={0}><table>{children}</table></div>,
    }}>
      {value}
    </Markdown>
  );
}
