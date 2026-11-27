/*
 * Markdown to HTML for Arch: a GitLab Flavored Markdown subset, ported from GitLab Everything
 * (src/lib/markdown/render.ts) without the wiki links, diagrams, math and syntax highlighting.
 *
 * Everything is escaped first and only known constructs become HTML, so the output is safe to
 * inject. Top-level blocks carry data-line (the 0-based source line), which the editors use to
 * scroll the preview with the source and to toggle task checkboxes. HTML comments (Arch's hidden
 * markers) are dropped.
 */

export interface RenderContext {
  /** Make task checkboxes clickable. */
  tasks?: boolean;
  /** Added to every data-line, for documents rendered in pieces. */
  lineOffset?: number;
  /** Looks up #123 references in the follow-ups project (title and state for the chip). */
  item?: (iid: number) => { title: string; open: boolean; kind?: string } | undefined;
  /** URL of a merge request (!12) in the standards project. */
  mrUrl?: (iid: number) => string | undefined;
}
export interface Heading { level: number; text: string; id: string; line: number }
export interface Rendered { html: string; headings: Heading[] }

export const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const stripMd = (s: string) => s.replace(/[`*_~[\]]|\(.*?\)/g, '').replace(/<[^>]+>/g, '').trim();
export const headingId = (s: string) => s.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'section';
const isExternal = (href: string) => /^(https?:|mailto:)/i.test(href);

export const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const ALERT_ICON: Record<string, string> = { note: 'ⓘ', tip: '✦', important: '❖', warning: '⚠', caution: '⛔' };
const indentOf = (l: string) => l.match(/^\s*/)![0].replace(/\t/g, '    ').length;

/** Splits a table row into cells, honouring \| escapes and pipes inside `code`. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') code = !code;
    if (c === '|' && !code) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Heading elements get this id prefix so they never clash with ids used by the app. */
export const ANCHOR_PREFIX = 'mdh-';

/** Renders the inline parts of one line (used for card titles and comment snippets). */
export function mdInline(text: string, ctx: RenderContext = {}): string {
  return mdRender(text, ctx).html.replace(/^<p[^>]*>|<\/p>$/g, '');
}

export function mdRender(src: string, ctx: RenderContext = {}): Rendered {
  const off = ctx.lineOffset ?? 0;
  const raw = String(src ?? '').replace(/\r\n?/g, '\n').replace(/<!--[^\n]*?-->/g, '').split('\n');
  const headings: Heading[] = [];
  const ids = new Map<string, number>();
  const refs: Record<string, { href: string; title?: string }> = {};
  const notes = new Map<string, string>();
  const noteOrder: string[] = [];

  // Pre-pass: pull out reference-link and footnote definitions (outside code fences).
  const L0: string[] = [], N0: number[] = [];
  let fence: string | null = null;
  raw.forEach((l, i) => {
    const f = l.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; }
    if (!fence) {
      let m;
      if ((m = l.match(/^\s{0,3}\[\^([^\]]+)\]:\s*(.*)$/))) { notes.set(m[1], m[2]); return; }
      if ((m = l.match(/^\s{0,3}\[([^\]^][^\]]*)\]:\s*<?(\S+?)>?(?:\s+["'(]([^"')]*)["')])?\s*$/))) { refs[m[1].toLowerCase()] = { href: m[2], title: m[3] }; return; }
    }
    L0.push(l);
    N0.push(i);
  });
  const uniqueId = (base: string) => { const n = ids.get(base) || 0; ids.set(base, n + 1); return n ? `${base}-${n}` : base; };

  function anchor(href: string, inner: string, title?: string): string {
    const t = title ? ` title="${esc(title)}"` : '';
    if (isExternal(href)) return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer"${t}>${inner}</a>`;
    if (href.startsWith('#')) return `<a href="#" data-anchor="${esc(href.slice(1))}"${t}>${inner}</a>`;
    return `<span class="lnk" title="${esc(title || href)}">${inner}</span>`;
  }
  function image(alt: string, src: string, title?: string): string {
    return /^(https?:|data:image\/)/i.test(src)
      ? `<img src="${esc(src)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy">`
      : `<span class="faint">[image: ${esc(alt || src)}]</span>`;
  }
  function refChip(path: string | undefined, sym: string, n: string): string {
    const label = (path || '') + sym + n;
    if (!path && sym === '#') {
      const it = ctx.item?.(Number(n));
      // Decisions and meetings are closed by design; only finished work is struck through.
      const done = it && !it.open && it.kind !== 'decision' && it.kind !== 'meeting';
      if (it) return `<a href="#" class="ref${done ? ' closed' : ''}" data-iid="${n}" title="${esc(it.title)}">${esc(label)}</a>`;
    }
    if (!path && sym === '!') {
      const url = ctx.mrUrl?.(Number(n));
      if (url) return `<a href="${esc(url)}" class="ref" target="_blank" rel="noopener noreferrer" title="Merge request ${esc(label)}">${esc(label)}</a>`;
    }
    return `<span class="ref">${esc(label)}</span>`;
  }

  function inline(text: string): string {
    const slots: string[] = [];
    const put = (html: string) => `${slots.push(html) - 1}`;
    let t = String(text);
    t = t.replace(/\\([\\`*_{}[\]()#+\-.!|~<>$])/g, (_m, c) => put(esc(c)));
    t = t.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_m, _t, code) => put(`<code>${esc(code.replace(/^ (.*) $/, '$1'))}</code>`));
    t = t.replace(/<(https?:\/\/[^\s>]+)>/g, (_m, u) => put(anchor(u, esc(u))));
    t = t.replace(/\[\^([^\]\s]+)\]/g, (m, id) => {
      if (!notes.has(id)) return m;
      if (!noteOrder.includes(id)) noteOrder.push(id);
      return put(`<sup class="fn"><a href="#" data-anchor="fn-${esc(id)}" id="${ANCHOR_PREFIX}fnref-${esc(id)}">${noteOrder.indexOf(id) + 1}</a></sup>`);
    });
    t = t.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["']([^"']*)["'])?\s*\)(?:\{[^}]*\})?/g, (_m, alt, s, title) => put(image(alt, s, title)));
    t = t.replace(/\[((?:[^[\]]|\[[^\]]*\])+)\]\(\s*<?([^)\s>]*)>?(?:\s+["']([^"']*)["'])?\s*\)/g, (_m, txt, href, title) => put(anchor(href, inline(txt), title)));
    t = t.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (m, txt, id) => { const r = refs[(id || txt).toLowerCase()]; return r ? put(anchor(r.href, inline(txt), r.title)) : m; });
    t = t.replace(/<(\/?)(kbd|sup|sub|mark|ins|del|b|i|u|s|small|abbr|br)\s*\/?>/gi, (m) => put(m.toLowerCase().replace(/\s*\/?>$/, '>')));
    t = t.replace(/(^|[\s(])(https?:\/\/[^\s<]*[^\s<.,;:!?'")\]])/g, (_m, pre, u) => pre + put(anchor(u, esc(u))));
    t = esc(t);
    t = t
      .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/(^|[^\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
      .replace(/(^|[^\w])==(?=\S)([^=]*?\S)==/g, '$1<mark>$2</mark>');
    t = t.replace(/(^|[\s(>])((?:[\w.-]+\/)+[\w.-]+)?([#!])(\d+)\b/g, (_m, pre, path, sym, n) => pre + refChip(path, sym, n));
    t = t.replace(/(^|[\s(>])@([\w][\w.-]*[\w]|[\w])/g, (_m, pre, u) => `${pre}<span class="ref mention">@${u}</span>`);
    t = t.replace(/( {2,}|\\)\n/g, '<br>').replace(/\n/g, ' ');
    let prev;
    do { prev = t; t = t.replace(/(\d+)/g, (_m, i) => slots[+i]); } while (t !== prev && t.includes(''));
    return t;
  }

  const isBlockStart = (l: string) =>
    /^\s{0,3}(#{1,6}(\s|$)|`{3,}|~{3,}|>|[-*_](\s*[-*_]){2,}\s*$|<details|\[\[_TOC_\]\]\s*$)/i.test(l) || LIST_RE.test(l);
  const at = (N: number[], k: number) => ({ attr: ` data-line="${N[k] + off}"`, line: N[k] + off });

  function heading(level: number, text: string, a: { attr: string; line: number }): string {
    const plain = stripMd(text);
    const id = uniqueId(headingId(plain));
    headings.push({ level, text: plain, id, line: a.line });
    return `<h${level} id="${ANCHOR_PREFIX}${esc(id)}"${a.attr}>${inline(text)}</h${level}>`;
  }
  function codeBlock(code: string, lang: string, attr: string): string {
    return `<div class="code"${attr}><div class="code-h"><span>${esc(lang || 'text')}</span><button type="button" data-copy>Copy</button></div><pre><code>${esc(code)}</code></pre></div>`;
  }

  function list(L: string[], N: number[], i0: number): { html: string; end: number } {
    const first = L[i0].match(LIST_RE)!;
    const base = indentOf(L[i0]);
    const ordered = /\d/.test(first[2]);
    const startNum = ordered ? parseInt(first[2], 10) : 1;
    const items: { lines: string[]; nos: number[]; line: number }[] = [];
    let i = i0;
    let loose = false;
    while (i < L.length) {
      const m = L[i].match(LIST_RE);
      if (!m || indentOf(L[i]) !== base || /\d/.test(m[2]) !== ordered) break;
      const contentIndent = base + m[2].length + 1;
      const lines = [m[3] ?? ''], nos = [N[i]], line = N[i];
      i++;
      while (i < L.length) {
        const x = L[i];
        if (!x.trim()) {
          let k = i;
          while (k < L.length && !L[k].trim()) k++;
          if (k < L.length && indentOf(L[k]) > base) { for (; i < k; i++) { lines.push(''); nos.push(N[i]); } continue; }
          break;
        }
        if (indentOf(x) > base) {
          lines.push(x.replace(/^\s+/, (s) => ' '.repeat(Math.max(0, s.replace(/\t/g, '    ').length - contentIndent))));
          nos.push(N[i]);
          i++;
          continue;
        }
        if (LIST_RE.test(x) || isBlockStart(x)) break;
        lines.push(x.trim());
        nos.push(N[i]);
        i++;
      }
      items.push({ lines, nos, line });
      if (i < L.length && !L[i].trim()) {
        let k = i;
        while (k < L.length && !L[k].trim()) k++;
        const nm = k < L.length && L[k].match(LIST_RE);
        if (nm && indentOf(L[k]) === base && /\d/.test(nm[2]) === ordered) { loose = true; i = k; } else break;
      }
    }
    const html = items.map((it) => {
      let j = 0;
      const para: string[] = [];
      while (j < it.lines.length && it.lines[j].trim() !== '' && !(j > 0 && isBlockStart(it.lines[j]))) para.push(it.lines[j++]);
      if (j === 0 && it.lines[0] === '') j = 1;
      let text = para.join('\n');
      let task = '';
      const tm = text.match(/^\[([ xX])\]\s+/);
      const done = !!tm && tm[1] !== ' ';
      if (tm) {
        text = text.slice(tm[0].length);
        task = `<input type="checkbox" class="task" data-src-line="${it.line + off}"${done ? ' checked' : ''}${ctx.tasks ? '' : ' disabled'} aria-label="Task">`;
      }
      const head = text ? (loose ? `<p>${inline(text)}</p>` : `<span class="tt">${inline(text)}</span>`) : '';
      const rest = j < it.lines.length ? blocks(it.lines.slice(j), it.nos.slice(j)) : '';
      return `<li${tm ? ` class="task${done ? ' done' : ''}"` : ''}>${task}${head}${rest}</li>`;
    }).join('');
    const tag = ordered ? 'ol' : 'ul';
    return { html: `<${tag}${ordered && startNum !== 1 ? ` start="${startNum}"` : ''} data-line="${N[i0] + off}">${html}</${tag}>`, end: i };
  }

  function blocks(L: string[], N: number[]): string {
    let out = '';
    let i = 0;
    while (i < L.length) {
      const l = L[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if (N[i] === 0 && /^(---|\+\+\+)\s*$/.test(l)) {
        const close = L.findIndex((x, k) => k > i && x.trim() === l.trim());
        if (close > 0) {
          out += `<details class="fm"${at(N, i).attr}><summary>Front matter</summary><pre><code>${esc(L.slice(i + 1, close).join('\n'))}</code></pre></details>`;
          i = close + 1;
          continue;
        }
      }
      if ((m = l.match(/^(\s{0,3})(`{3,}|~{3,})\s*([\w+#.-]*)/))) {
        const fch = m[2][0], flen = m[2].length, lang = m[3].toLowerCase(), ind = m[1].length, start = i;
        const buf: string[] = [];
        i++;
        const closeRe = new RegExp(`^\\s{0,3}\\${fch}{${flen},}\\s*$`);
        while (i < L.length && !closeRe.test(L[i])) { buf.push(L[i].replace(new RegExp(`^ {0,${ind}}`), '')); i++; }
        i++;
        out += codeBlock(buf.join('\n'), lang, at(N, start).attr);
        continue;
      }
      if (/^\s*(\[\[_TOC_\]\]|\[TOC\])\s*$/i.test(l)) { out += `<nav class="toc"${at(N, i).attr}>TOC</nav>`; i++; continue; }
      if (/^\s{0,3}#{1,6}(\s|$)/.test(l) && (m = l.match(/^\s{0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/))) { out += heading(m[1].length, m[2] || '', at(N, i)); i++; continue; }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { out += `<hr${at(N, i).attr}>`; i++; continue; }
      if (l.includes('|') && i + 1 < L.length && L[i + 1].includes('-')) {
        const head = splitRow(l), seps = splitRow(L[i + 1]);
        if (seps.length && seps.every((c) => /^\s*:?-+:?\s*$/.test(c)) && (seps.length === head.length || L[i + 1].includes('|'))) {
          const align = seps.map((c) => { c = c.trim(); return c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''; });
          const start = i;
          i += 2;
          const rows: string[][] = [];
          while (i < L.length && L[i].trim() && L[i].includes('|')) rows.push(splitRow(L[i++]));
          const cell = (tag: string, c: string | undefined, k: number) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline((c ?? '').trim())}</${tag}>`;
          out += `<div class="tbl-x"${at(N, start).attr}><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => cell('td', r[k], k)).join('')}</tr>`).join('')}</tbody></table></div>`;
          continue;
        }
      }
      if (/^\s{0,3}>/.test(l)) {
        const start = i, bl: string[] = [], bn: number[] = [];
        while (i < L.length && /^\s{0,3}>/.test(L[i])) { bl.push(L[i].replace(/^\s{0,3}>\s?/, '')); bn.push(N[i]); i++; }
        const am = bl[0].match(/^\s*\[!(note|tip|important|warning|caution)\]\s*(.*)$/i);
        if (am) {
          const type = am[1].toLowerCase();
          const rest = am[2] ? [am[2], ...bl.slice(1)] : bl.slice(1);
          const restN = am[2] ? bn : bn.slice(1);
          out += `<div class="alert alert-${type}"${at(N, start).attr}><div class="alert-t"><span aria-hidden="true">${ALERT_ICON[type]}</span>${cap(type)}</div>${blocks(rest, restN)}</div>`;
        } else out += `<blockquote${at(N, start).attr}>${blocks(bl, bn)}</blockquote>`;
        continue;
      }
      if ((m = l.match(/^\s*<details(\s+open)?\s*>\s*$/i))) {
        const start = i;
        let depth = 1, j = i + 1;
        while (j < L.length && depth) {
          if (/^\s*<details/i.test(L[j])) depth++;
          if (/^\s*<\/details>\s*$/i.test(L[j])) depth--;
          if (depth) j++;
        }
        let inner = L.slice(i + 1, j), innerN = N.slice(i + 1, j), summary = 'Details';
        const si = inner.findIndex((x) => x.trim());
        const sm = si >= 0 && inner[si].match(/^\s*<summary>(.*)<\/summary>\s*$/i);
        if (sm) { summary = sm[1]; inner = inner.slice(si + 1); innerN = innerN.slice(si + 1); }
        out += `<details${m[1] ? ' open' : ''}${at(N, start).attr}><summary>${inline(summary)}</summary>${blocks(inner, innerN)}</details>`;
        i = j + 1;
        continue;
      }
      if ((LIST_RE.test(l) && (l.match(LIST_RE)![3] || '').trim() !== '') || /^\s*([-*+]|\d+[.)])\s*$/.test(l)) {
        const r = list(L, N, i);
        out += r.html;
        i = r.end;
        continue;
      }
      const start = i, buf: string[] = [];
      let setext = 0;
      while (i < L.length && L[i].trim()) {
        if (buf.length && /^\s{0,3}=+\s*$/.test(L[i])) { setext = 1; i++; break; }
        if (buf.length && /^\s{0,3}-+\s*$/.test(L[i])) { setext = 2; i++; break; }
        if (buf.length && isBlockStart(L[i])) break;
        if (buf.length && L[i].includes('|') && i + 1 < L.length && /^\s*\|?\s*:?-+:?\s*\|/.test(L[i + 1])) break;
        buf.push(L[i++]);
      }
      out += setext ? heading(setext, buf.join(' '), at(N, start)) : `<p${at(N, start).attr}>${inline(buf.join('\n'))}</p>`;
    }
    return out;
  }

  let html = blocks(L0, N0);
  if (html.includes('TOC')) {
    const hs = headings.filter((h) => h.level <= 4);
    const min = Math.min(...hs.map((h) => h.level), 6);
    let toc = '<div class="toc-t">Contents</div>';
    let depth = 0;
    for (const h of hs) {
      const d = h.level - min + 1;
      while (depth < d) { toc += '<ul>'; depth++; }
      while (depth > d) { toc += '</ul>'; depth--; }
      toc += `<li><a href="#" data-anchor="${esc(h.id)}">${esc(h.text)}</a></li>`;
    }
    while (depth > 0) { toc += '</ul>'; depth--; }
    html = html.split('TOC').join(hs.length ? toc : '<div class="toc-t">Contents</div><p class="faint">No headings yet.</p>');
  }
  if (noteOrder.length) {
    html += `<section class="footnotes"><ol>${noteOrder.map((id) => `<li id="${ANCHOR_PREFIX}fn-${esc(id)}">${inline(notes.get(id)!)} <a href="#" data-anchor="fnref-${esc(id)}" aria-label="Back to text">↩</a></li>`).join('')}</ol></section>`;
  }
  return { html, headings };
}

/** Headings of a document without rendering it (for the Outline tab). */
export function outline(src: string): Heading[] {
  return mdRender(src).headings;
}

export const findAnchor = (box: ParentNode, x: string) => box.querySelector<HTMLElement>(`[id="${ANCHOR_PREFIX}${CSS.escape(x)}"]`);

/** Words, for the status bar. */
export const countWords = (s: string) => (s.replace(/<!--[\s\S]*?-->/g, '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
