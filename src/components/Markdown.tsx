import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy, FileDown } from './icons';
import { copyText, downloadFile, useContextMenu } from './ContextMenu';

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return '';
}

const EXT: Record<string, string> = {
  python: 'py', javascript: 'js', typescript: 'ts', tsx: 'tsx', jsx: 'jsx', bash: 'sh', shell: 'sh', sh: 'sh', zsh: 'sh',
  json: 'json', html: 'html', css: 'css', rust: 'rs', go: 'go', java: 'java', kotlin: 'kt', swift: 'swift', c: 'c',
  cpp: 'cpp', csharp: 'cs', ruby: 'rb', php: 'php', sql: 'sql', yaml: 'yml', markdown: 'md', xml: 'xml', toml: 'toml',
};

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const menu = useContextMenu();
  const child = Array.isArray(children) ? children[0] : children;
  const className = (child as { props?: { className?: string } })?.props?.className ?? '';
  const lang = /language-(\S+)/.exec(className)?.[1] ?? 'text';
  const copy = () => {
    copyText(textOf(children));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div
      className="codeblock"
      onContextMenu={(e) => {
        const selection = window.getSelection()?.toString() ?? '';
        menu(e, [
          selection && { label: 'Copy selection', icon: Copy, onClick: () => copyText(selection) },
          { label: 'Copy code', icon: Copy, onClick: copy },
          { label: `Save as .${EXT[lang] ?? 'txt'}…`, icon: FileDown, onClick: () => downloadFile(`snippet.${EXT[lang] ?? 'txt'}`, textOf(children), 'text/plain') },
        ]);
      }}
    >
      <div className="codeblock-head">
        <span>{lang}</span>
        <button className="icon-btn sm" onClick={copy} title="Copy code">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: CodeBlock,
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

/** Some models emit reasoning inline as <think>…</think>; split it out for display. */
export function splitThinking(content: string): { thinking: string; answer: string } {
  const m = /^\s*<think>([\s\S]*?)(<\/think>|$)/.exec(content);
  if (!m) return { thinking: '', answer: content };
  return { thinking: m[1].trim(), answer: content.slice(m[0].length).trimStart() };
}
