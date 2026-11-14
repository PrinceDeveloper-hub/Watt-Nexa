import type { ReactNode } from 'react';

/**
 * Minimal, safe markdown renderer for assistant answers: bold, italic, inline
 * code, links, lists, quotes and headings. No raw HTML is ever injected, which
 * keeps model output from becoming an XSS vector.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={`ol-${blocks.length}`} className="ml-4 list-decimal space-y-1">
          {items}
        </ol>
      ) : (
        <ul key={`ul-${blocks.length}`} className="ml-4 list-disc space-y-1">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  lines.forEach((raw, index) => {
    const line = raw.trimEnd();

    if (/^\s*[-*]\s+/.test(line)) {
      const item = line.replace(/^\s*[-*]\s+/, '');
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(item);
      return;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const item = line.replace(/^\s*\d+\.\s+/, '');
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(item);
      return;
    }

    flushList();

    if (!line.trim()) return;

    if (line.startsWith('# ')) {
      blocks.push(
        <h3 key={index} className="text-base font-semibold">
          {inline(line.slice(2))}
        </h3>,
      );
      return;
    }
    if (line.startsWith('## ') || line.startsWith('### ')) {
      blocks.push(
        <h4 key={index} className="text-sm font-semibold">
          {inline(line.replace(/^#+\s+/, ''))}
        </h4>,
      );
      return;
    }
    if (line.startsWith('> ')) {
      blocks.push(
        <blockquote key={index} className="border-l-2 border-border pl-3 text-muted-foreground">
          {inline(line.slice(2))}
        </blockquote>,
      );
      return;
    }

    blocks.push(
      <p key={index} className="leading-relaxed">
        {inline(line)}
      </p>,
    );
  });

  flushList();

  return <div className={className ?? 'space-y-2 text-sm'}>{blocks}</div>;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\((?:https?:\/\/)[^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  const parts = text.split(INLINE).filter((part) => part !== '');
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (link) {
      return (
        <a
          key={index}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {link[1]}
        </a>
      );
    }
    return <span key={index}>{part}</span>;
  });
}
