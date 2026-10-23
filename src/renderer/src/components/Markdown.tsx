// A small, safe GitHub-flavoured Markdown renderer for PR descriptions and comments.
// It builds React elements only: raw HTML is never inserted. A few tags GitHub bots use
// (<details>, <summary>, <br>, <a>, <b>, <code>, <img alt>) are mapped to Markdown first; other tags are dropped.
import { Fragment, type ReactNode } from 'react';
import { open } from '../api';

type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; children: Block[] }
  | { t: 'list'; ordered: boolean; items: Array<{ text: string; task: boolean | null; depth: number }> }
  | { t: 'table'; head: string[]; align: Array<'left' | 'center' | 'right' | null>; rows: string[][] }
  | { t: 'hr' }
  | { t: 'details'; summary: string; children: Block[] };

/** Turn the bits of HTML GitHub comments commonly contain into Markdown, and drop the rest. */
function fromHtml(src: string): string {
  return src
    .replace(/\r/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<img[^>]*\balt="([^"]*)"[^>]*>/gi, (_m, alt: string) => (alt ? `[${alt}]` : ''))
    .replace(/<a\s[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => `[${text.replace(/<[^>]+>/g, '').trim() || href}](${href})`)
    .replace(/<\/?(b|strong)>/gi, '**')
    .replace(/<\/?(i|em)>/gi, '_')
    .replace(/<\/?code>/gi, '`')
    .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_m, h: string, text: string) => `\n${'#'.repeat(Number(h[1]))} ${text.trim()}\n`)
    .replace(/<summary[^>]*>([\s\S]*?)<\/summary>/gi, (_m, s: string) => `\u0001SUMMARY ${s.replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim()}\n`)
    .replace(/<details[^>]*>/gi, '\n\u0001DETAILS\n')
    .replace(/<\/details>/gi, '\n\u0001END\n')
    .replace(/<\/?(p|div|span|sub|sup|kbd|ins|del|u|center|table|thead|tbody|tr|td|th|ul|ol|li|picture|source|g-emoji)[^>]*>/gi, (m) => (/^<\/?(p|div|tr|li|ul|ol|table)\b/i.test(m) ? '\n' : ''))
    .replace(/<\/?[a-z][^>]*>/gi, '');
}

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

function parse(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('\u0001DETAILS')) {
      let depth = 1;
      let j = i + 1;
      let summary = 'Details';
      const inner: string[] = [];
      for (; j < lines.length; j++) {
        if (lines[j].startsWith('\u0001DETAILS')) depth++;
        if (lines[j].startsWith('\u0001END') && --depth === 0) break;
        if (depth === 1 && lines[j].startsWith('\u0001SUMMARY ')) summary = lines[j].slice(9);
        else inner.push(lines[j]);
      }
      out.push({ t: 'details', summary, children: parse(inner) });
      i = j + 1;
      continue;
    }
    if (l.startsWith('\u0001')) { i++; continue; }
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(l);
    if (fence) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith(fence[1])) body.push(lines[j++]);
      out.push({ t: 'code', lang: fence[2], text: body.join('\n') });
      i = j + 1;
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) { out.push({ t: 'h', level: h[1].length, text: h[2] }); i++; continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push({ t: 'hr' }); i++; continue; }
    if (/^\s*>/.test(l)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', children: parse(q) });
      continue;
    }
    if (l.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = cells(l);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push({ t: 'table', head, align, rows });
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items: Array<{ text: string; task: boolean | null; depth: number }> = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m) {
          const task = /^\[([ xX])\]\s+/.exec(m[3]);
          items.push({ text: task ? m[3].slice(task[0].length) : m[3], task: task ? task[1] !== ' ' : null, depth: Math.min(4, Math.floor(m[1].replace(/\t/g, '  ').length / 2)) });
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ' ' + lines[i].trim();
          i++;
        } else break;
      }
      out.push({ t: 'list', ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|>|```|~~~|([-*+]|\d+[.)])\s)/.test(lines[i]) && !lines[i].startsWith('\u0001') && !(lines[i].includes('|') && TABLE_SEP.test(lines[i + 1] ?? ''))) para.push(lines[i++]);
    if (para.length) out.push({ t: 'p', text: para.join('\n') });
    else i++;
  }
  return out;
}

const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])|(?<![\w_])_(?!\s)([^_\n]+?)_(?![\w_])|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|\n/g;

function Link({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} onClick={(e) => { e.preventDefault(); open(href); }} title={href}>{children}</a>;
}

function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[0] === '\n') out.push(<br key={k} />);
    else if (m[1]) out.push(<code key={k}>{m[2].trim()}</code>);
    else if (m[3] ?? m[4]) out.push(<strong key={k}>{inline((m[3] ?? m[4])!, k)}</strong>);
    else if (m[5]) out.push(<del key={k}>{inline(m[5], k)}</del>);
    else if (m[6]) out.push(<Link key={k} href={m[7]}>{inline(m[6], k)}</Link>);
    else if (m[8] ?? m[9]) out.push(<em key={k}>{inline((m[8] ?? m[9])!, k)}</em>);
    else if (m[10]) out.push(<Link key={k} href={m[10]}>{m[10]}</Link>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function render(blocks: Block[], key = 'b'): ReactNode {
  return blocks.map((b, i) => {
    const k = `${key}-${i}`;
    switch (b.t) {
      case 'p': return <p key={k}>{inline(b.text, k)}</p>;
      case 'h': {
        const H = `h${Math.min(6, b.level + 1)}` as 'h2';
        return <H key={k}>{inline(b.text, k)}</H>;
      }
      case 'code': return <pre key={k} className="mono" aria-label={b.lang ? `${b.lang} code` : 'Code'}><code>{b.text}</code></pre>;
      case 'quote': return <blockquote key={k}>{render(b.children, k)}</blockquote>;
      case 'hr': return <hr key={k} />;
      case 'details': return <details key={k}><summary>{inline(b.summary, k)}</summary>{render(b.children, k)}</details>;
      case 'table':
        return (
          <div key={k} className="md-table">
            <table>
              <thead><tr>{b.head.map((c, j) => <th key={j} style={{ textAlign: b.align[j] ?? undefined }}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
              <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} style={{ textAlign: b.align[j] ?? undefined }}>{inline(c, `${k}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      case 'list': {
        const L = b.ordered ? 'ol' : 'ul';
        return (
          <L key={k} className={b.items.some((x) => x.task !== null) ? 'md-tasks' : undefined}>
            {b.items.map((it, j) => (
              <li key={j} style={{ marginLeft: it.depth * 18 }}>
                {it.task !== null && <input type="checkbox" checked={it.task} readOnly disabled aria-label={it.task ? 'Done' : 'Not done'} />}
                {inline(it.text, `${k}-${j}`)}
              </li>
            ))}
          </L>
        );
      }
    }
  });
}

/** Render Markdown text (as GitHub does for PR descriptions and comments). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parse(fromHtml(text ?? '').split('\n'));
  if (!blocks.length) return null;
  return <div className={`md ${className ?? ''}`}><Fragment>{render(blocks)}</Fragment></div>;
}
