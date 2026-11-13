// Auto-escaping HTML templating for server-rendered pages.
//   html`<p>${userText}</p>`  — interpolations are escaped
//   html`<div>${raw(trusted)}</div>` — opt out for markup we built ourselves
// Arrays are joined; null, undefined and false render nothing.

export class SafeHtml {
  constructor(public readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]!);

type Value = SafeHtml | string | number | boolean | null | undefined | Value[];

function render(v: Value): string {
  if (v == null || v === false || v === true) return '';
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(v);
}

export function html(strings: TemplateStringsArray, ...values: Value[]): SafeHtml {
  let out = strings[0]!;
  for (let i = 0; i < values.length; i++) out += render(values[i]!) + strings[i + 1]!;
  return new SafeHtml(out);
}

export const raw = (s: string): SafeHtml => new SafeHtml(s);

/** JSON for embedding inside <script type="application/json"> or JSON-LD — escapes `<` so it can never close the tag. */
export const jsonForScript = (data: unknown): SafeHtml => new SafeHtml(JSON.stringify(data).replace(/</g, '\\u003c').replace(/ /g, '\\u2028').replace(/ /g, '\\u2029'));

/**
 * Minimal, safe Markdown for admin-written copy: paragraphs, ## / ### headings, - bullets,
 * 1. numbered steps, **bold** and [links](https://…). All text is escaped first.
 */
export function markdown(src: string): SafeHtml {
  const inline = (s: string): string =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (_m, text: string, href: string) => `<a href="${href}"${href.startsWith('http') ? ' rel="noopener" target="_blank"' : ''}>${text}</a>`);
  const blocks = src.replace(/\r/g, '').split(/\n{2,}/);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    let para: string[] = [];
    let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(inline).join(' ')}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
      list = null;
    };
    for (const line of lines) {
      const t = line.trim();
      const h = /^(#{2,3})\s+(.*)$/.exec(t);
      const ul = /^[-*]\s+(.*)$/.exec(t);
      const ol = /^\d+[.)]\s+(.*)$/.exec(t);
      if (h) {
        flushPara();
        flushList();
        out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`);
      } else if (ul || ol) {
        flushPara();
        const tag = ul ? 'ul' : 'ol';
        if (list && list.tag !== tag) flushList();
        list ??= { tag, items: [] };
        list.items.push((ul ?? ol)![1]!);
      } else {
        flushList();
        para.push(t);
      }
    }
    flushPara();
    flushList();
  }
  return new SafeHtml(out.join('\n'));
}
