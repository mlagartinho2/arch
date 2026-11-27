// Standards as documents: one markdown file per standard in the standards repository, mirrored to a wiki.
// Pure functions only (no I/O, no React). Also bundled into the optional CI wiki-sync script, so keep it dependency-free.

export type StandardStatus = 'active' | 'deprecated';

export interface StandardMeta {
  /** Stable identifier, also the file name and the last part of the wiki slug */
  id: string;
  title: string;
  /** Category key: a folder name, e.g. "api", "react", "devops", "security" */
  category: string;
  tags: string[];
  /** major.minor, e.g. "1.0" */
  version: string;
  status: StandardStatus;
  /** GitLab username of the owner */
  owner?: string;
  /** Date of the last version, YYYY-MM-DD */
  updated?: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  change: string;
}

export interface StandardDoc {
  meta: StandardMeta;
  /** Markdown body: everything except the front matter and the changelog section */
  body: string;
  /** Newest first */
  changelog: ChangelogEntry[];
}

// ---------- versions ----------

export function parseVersion(v: string): [number, number] {
  const m = String(v).trim().match(/^v?(\d+)(?:\.(\d+))?/i);
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : [0, 0];
}

export function formatVersion([major, minor]: [number, number]) {
  return `${major}.${minor}`;
}

export function compareVersions(a: string, b: string) {
  const [x1, y1] = parseVersion(a);
  const [x2, y2] = parseVersion(b);
  return x1 - x2 || y1 - y2;
}

export function bumpVersion(v: string, kind: 'major' | 'minor') {
  const [major, minor] = parseVersion(v);
  return kind === 'major' ? formatVersion([major + 1, 0]) : formatVersion([major, minor + 1]);
}

/** True when going from `from` to `to` crosses a major version. */
export function isMajorChange(from: string | undefined, to: string) {
  return !from || parseVersion(to)[0] > parseVersion(from)[0];
}

// ---------- names, paths, slugs ----------

export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function standardFilePath(folder: string, category: string, id: string) {
  return `${folder.replace(/^\/+|\/+$/g, '')}/${slug(category)}/${id}.md`;
}

export function wikiSlug(prefix: string, category: string, id: string) {
  return `${prefix.replace(/^\/+|\/+$/g, '')}/${slug(category)}/${id}`;
}

/** "standards/api/api-error-format.md" → { category: "api", id: "api-error-format" } (null if not a standard file) */
export function parseStandardPath(folder: string, path: string): { category: string; id: string } | null {
  const f = folder.replace(/^\/+|\/+$/g, '');
  const m = path.match(new RegExp(`^${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/]+)/([^/]+)\\.md$`));
  return m ? { category: m[1], id: m[2] } : null;
}

// ---------- front matter (a small YAML subset: "key: value" and "key: [a, b]") ----------

function unquote(v: string) {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

function quote(v: string) {
  return /^[\w .\-/()]*$/.test(v) && !/^[\s-]/.test(v) && v.trim() === v && v !== '' ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function parseFrontMatter(text: string): { data: Record<string, string | string[]>; rest: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, rest: text };
  const data: Record<string, string | string[]> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const raw = kv[2].trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      data[kv[1]] = raw
        .slice(1, -1)
        .split(',')
        .map((x) => unquote(x))
        .filter(Boolean);
    } else data[kv[1]] = unquote(raw);
  }
  return { data, rest: text.slice(m[0].length) };
}

function renderFrontMatter(entries: [string, string | string[] | undefined][]) {
  const lines = entries
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map(quote).join(', ')}]` : quote(v as string)}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

// ---------- changelog ----------

const CHANGELOG_RE = /^## Changelog\s*$/m;

function cell(s: string) {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

export function parseChangelog(section: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  for (const line of section.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line) || /^\s*\|\s*-/.test(line)) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, '|'));
    if (cells.length < 3 || /^version$/i.test(cells[0])) continue;
    out.push({ version: cells[0], date: cells[1], change: cells.slice(2).join(' | ') });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

export function renderChangelog(entries: ChangelogEntry[]) {
  return [
    '## Changelog',
    '',
    '| Version | Date | Change |',
    '|---|---|---|',
    ...[...entries].sort((a, b) => compareVersions(b.version, a.version)).map((e) => `| ${cell(e.version)} | ${cell(e.date)} | ${cell(e.change)} |`),
    '',
  ].join('\n');
}

// ---------- the standard file ----------

/** Parse a standard file. `fallback` fills what the front matter leaves out (e.g. from the file path). */
export function parseStandardFile(text: string, fallback: Partial<StandardMeta> = {}): StandardDoc {
  const { data, rest } = parseFrontMatter(text);
  const s = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : undefined);
  const tags = Array.isArray(data.tags) ? data.tags : s('tags') ? s('tags')!.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const idx = rest.search(CHANGELOG_RE);
  const body = (idx >= 0 ? rest.slice(0, idx) : rest).trim();
  const changelog = idx >= 0 ? parseChangelog(rest.slice(idx).replace(CHANGELOG_RE, '').split(/^## /m)[0]) : [];
  const meta: StandardMeta = {
    id: s('id') || fallback.id || slug(s('title') || 'untitled'),
    title: s('title') || fallback.title || fallback.id || 'Untitled standard',
    category: s('category') || fallback.category || 'general',
    tags: tags.length ? tags : fallback.tags ?? [],
    version: s('version') || changelog[0]?.version || fallback.version || '1.0',
    status: s('status') === 'deprecated' ? 'deprecated' : 'active',
    owner: (s('owner') || fallback.owner)?.replace(/^@/, ''),
    updated: s('updated') || changelog[0]?.date || fallback.updated,
  };
  return { meta, body, changelog };
}

export function renderStandardFile(doc: StandardDoc): string {
  const m = doc.meta;
  return (
    renderFrontMatter([
      ['id', m.id],
      ['title', m.title],
      ['category', slug(m.category)],
      ['tags', m.tags],
      ['version', m.version],
      ['status', m.status],
      ['owner', m.owner?.replace(/^@/, '')],
      ['updated', m.updated],
    ]) +
    `\n${doc.body.trim()}\n\n` +
    renderChangelog(doc.changelog)
  );
}

/** A new version of a document: bumped version, today's date, and a changelog entry. */
export function nextVersion(doc: StandardDoc, change: { kind: 'major' | 'minor'; note: string; date: string }, edits: Partial<Pick<StandardDoc, 'body'>> & { meta?: Partial<StandardMeta> } = {}): StandardDoc {
  const version = bumpVersion(doc.meta.version, change.kind);
  return {
    meta: { ...doc.meta, ...edits.meta, owner: (edits.meta?.owner ?? doc.meta.owner)?.replace(/^@/, '') || undefined, version, updated: change.date },
    body: edits.body ?? doc.body,
    changelog: [{ version, date: change.date, change: change.note }, ...doc.changelog],
  };
}

export function newStandardDoc(meta: Omit<StandardMeta, 'version' | 'status' | 'updated'>, body: string, date: string, note = 'Initial version'): StandardDoc {
  return {
    meta: { ...meta, id: meta.id || slug(meta.title), owner: meta.owner?.replace(/^@/, '') || undefined, version: '1.0', status: 'active', updated: date },
    body,
    changelog: [{ version: '1.0', date, change: note }],
  };
}

export function standardTemplate(title: string, summary = '') {
  return `# ${title}

## Context
${summary || 'Why this standard exists and which problem it solves.'}

## The standard
- Teams **MUST** …
- Teams **SHOULD** …

## Rationale

## Examples

## How to adopt
1. …
`;
}

/** Changelog entries a team has not adopted yet: newer than `since` (all of them when `since` is undefined). */
export function changesSince(doc: StandardDoc, since?: string, upTo?: string): ChangelogEntry[] {
  return doc.changelog.filter(
    (e) => (!since || compareVersions(e.version, since) > 0) && (!upTo || compareVersions(e.version, upTo) <= 0),
  );
}

// ---------- wiki mirror ----------

const MARKER_RE = /<!-- arch:standard id=(\S+) version=(\S+) -->/;

export interface WikiRenderContext {
  categoryLabel: string;
  /** Link to the file in the repository (default branch) */
  sourceUrl: string;
  /** Link to the file's commit history */
  historyUrl: string;
}

/** The wiki page that mirrors a standard. Carries a marker with id and version, so Arch can tell when the wiki is behind. */
export function renderWikiPage(doc: StandardDoc, ctx: WikiRenderContext): string {
  const m = doc.meta;
  const rows: [string, string][] = [
    ['Version', m.version],
    ['Category', ctx.categoryLabel],
    ['Status', m.status === 'deprecated' ? '**Deprecated**' : 'Active'],
    ...(m.owner ? [['Owner', `@${m.owner.replace(/^@/, '')}`] as [string, string]] : []),
    ...(m.updated ? [['Updated', m.updated] as [string, string]] : []),
    ...(m.tags.length ? [['Tags', m.tags.join(', ')] as [string, string]] : []),
  ];
  return [
    renderFrontMatter([['title', m.title]]),
    `<!-- arch:standard id=${m.id} version=${m.version} -->`,
    '',
    '| | |',
    '|---|---|',
    ...rows.map(([k, v]) => `| **${k}** | ${cell(v)} |`),
    '',
    `> This page mirrors the [source file](${ctx.sourceUrl}) and is overwritten on every new version. Propose changes through a merge request. [Version history](${ctx.historyUrl})`,
    '',
    doc.body.trim(),
    '',
    renderChangelog(doc.changelog),
  ].join('\n');
}

export function parseWikiMarker(content: string): { id: string; version: string } | null {
  const m = content.match(MARKER_RE);
  return m ? { id: m[1], version: m[2] } : null;
}

/** The standards index page: one table per category. Links are relative to the wiki root. */
export function renderWikiIndex(docs: StandardDoc[], prefix: string, categoryLabel: (key: string) => string): string {
  const p = prefix.replace(/^\/+|\/+$/g, '');
  const byCat = new Map<string, StandardDoc[]>();
  for (const d of docs) byCat.set(slug(d.meta.category), [...(byCat.get(slug(d.meta.category)) ?? []), d]);
  const out = [renderFrontMatter([['title', 'Standards']]), '<!-- arch:index -->', '', 'Generated by Arch from the standards repository. Do not edit by hand.', ''];
  for (const cat of [...byCat.keys()].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)))) {
    out.push(`## ${categoryLabel(cat)}`, '', '| Standard | Version | Status | Owner | Updated |', '|---|---|---|---|---|');
    for (const d of byCat.get(cat)!.sort((a, b) => a.meta.title.localeCompare(b.meta.title))) {
      const m = d.meta;
      out.push(
        `| [${cell(m.title)}](${wikiSlug(p, m.category, m.id)}) | ${m.version} | ${m.status === 'deprecated' ? 'Deprecated' : 'Active'} | ${m.owner ? `@${m.owner.replace(/^@/, '')}` : ''} | ${m.updated ?? ''} |`,
      );
    }
    out.push('');
  }
  return out.join('\n');
}
