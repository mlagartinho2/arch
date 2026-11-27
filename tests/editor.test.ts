import { describe, expect, it } from 'vitest';
import { countWords, mdRender, outline } from '../src/editor/markdown';
import { collapseDiff, diffStats, lineDiff } from '../src/editor/diff';
import { applyTableOp, tableAt, tableText, tsvToTable } from '../src/editor/tables';
import { checkMarkdown, checkStandard, meetingChecks } from '../src/editor/checks';
import { joinMarkers, splitMarkers, toggleTask } from '../src/lib/markers';
import { renderMeetingPreview } from '../src/editor/meetingPreview';
import { dueTokens, slashFor } from '../src/editor/completions';
import { parseMeeting } from '../src/lib/parser';
import type { Item } from '../src/lib/model';

const today = '2026-11-26'; // a Thursday
const user = (username: string, name = username) => ({ id: username.length, username, name, avatar_url: '', web_url: '' });
const item = (iid: number, p: Partial<Item> = {}): Item => ({
  iid, projectId: 11, kind: 'action', title: `Item ${iid}`, description: '', open: true, author: user('marco'), labels: [], webUrl: '', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', notesCount: 0, ...p,
});

describe('markdown renderer (ported from GitLab Everything)', () => {
  it('renders headings, lists, tasks and code with source lines', () => {
    const r = mdRender('# Title\n\nText **bold** and `code`\n\n- [x] done\n- [ ] open\n\n```ts\nconst a = 1 < 2;\n```', { tasks: true });
    expect(r.html).toContain('<h1 id="mdh-title" data-line="0">Title</h1>');
    expect(r.html).toContain('<strong>bold</strong>');
    expect(r.html).toContain('<code>code</code>');
    expect(r.html).toContain('data-src-line="4" checked');
    expect(r.html).toContain('data-src-line="5"');
    expect(r.html).toContain('const a = 1 &lt; 2;');
    expect(r.headings).toEqual([{ level: 1, text: 'Title', id: 'title', line: 0 }]);
  });

  it('escapes HTML and drops hidden markers', () => {
    const r = mdRender('<script>alert(1)</script>\n<!-- fu:meeting=3 -->\nok');
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).not.toContain('fu:meeting');
  });

  it('links #refs to known items, marks finished ones, and leaves decisions plain', () => {
    const known = new Map([[7, { title: 'Load test', open: false, kind: 'action' }], [3, { title: 'Use Kafka', open: false, kind: 'decision' }]]);
    const html = mdRender('See #7, #3 and #99 with @anna', { item: (i) => known.get(i) }).html;
    expect(html).toContain('class="ref closed" data-iid="7"');
    expect(html).toContain('class="ref" data-iid="3"');
    expect(html).toContain('<span class="ref">#99</span>');
    expect(html).toContain('<span class="ref mention">@anna</span>');
  });

  it('renders GitLab alerts and tables, and offsets lines', () => {
    const r = mdRender('> [!WARNING]\n> Careful\n\n| a | b |\n|---|--:|\n| 1 | 2 |', { lineOffset: 10 });
    expect(r.html).toContain('class="alert alert-warning" data-line="10"');
    expect(r.html).toContain('<td style="text-align:right">2</td>');
    expect(r.html).toContain('data-line="13"');
  });

  it('builds an outline and counts words', () => {
    expect(outline('## A\ntext\n### B').map((h) => [h.level, h.text, h.line])).toEqual([[2, 'A', 0], [3, 'B', 2]]);
    expect(countWords('Hello wörld, it’s 2 words <!-- hidden marker -->')).toBe(5);
  });
});

describe('diff', () => {
  it('finds added and removed lines and collapses long unchanged runs', () => {
    const a = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const b = a.replace('line 10', 'line ten') + '\nline 20';
    const d = lineDiff(a, b);
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
    const c = collapseDiff(d, 2);
    expect(c[0]).toEqual({ t: 'gap', count: 8 });
    expect(c.filter((x) => x.t === 'gap')).toHaveLength(2);
    expect(c.some((x) => x.t === '+' && x.text === 'line ten')).toBe(true);
  });
});

describe('tables', () => {
  it('reads, edits and writes aligned tables', () => {
    const lines = ['| a | b |', '|---|:-:|', '| 1 | 2 |'];
    const t = tableAt((n) => lines[n], 2, 2)!;
    expect(t.rows).toEqual([['a', 'b'], ['1', '2']]);
    expect(applyTableOp(t, 'rowBelow', 1, 0)).toEqual({ row: 2, col: 0 });
    expect(tableText(t).lines).toEqual(['| a   |  b  |', '| --- | :-: |', '| 1   |  2  |', '|     |     |']);
    expect(tsvToTable('x\ty\n1\t2')).toBe('| x   | y   |\n| --- | --- |\n| 1   | 2   |');
  });
});

describe('checks', () => {
  it('flags markdown problems', () => {
    const c = checkMarkdown('# A\n### C\n#Missing\n[](x)\n```\nopen');
    expect(c.map((x) => [x.line, x.severity])).toEqual([[1, 'warning'], [2, 'info'], [3, 'warning'], [4, 'error']]);
  });

  it('flags unknown people, unreadable dates and impossible updates in meeting notes', () => {
    const notes = 'ACTION @ghost: do it due:someday\nDONE #1\nADOPTED #2\nDONE without number';
    const items = new Map([[1, item(1, { kind: 'meeting' })], [2, item(2)]]);
    const c = meetingChecks(notes, items, { unknown: new Set(['ghost']) }, today, 'marco', 7);
    const msgs = c.map((x) => `${x.line}:${x.severity}:${x.message}`);
    expect(msgs).toContain('0:error:@ghost is not a GitLab user — the item would be assigned to nobody');
    expect(msgs.some((m) => m.startsWith('0:warning:“someday”'))).toBe(true);
    expect(msgs).toContain('1:error:#1: is a meeting');
    expect(msgs).toContain('2:error:#2: is not an adoption issue: use DONE');
    expect(msgs).toContain('3:warning:Updates need an item number, like DONE #7');
  });

  it('checks the sections and rule keywords of a standard', () => {
    const c = checkStandard('# T\n\n## Context\n- Teams **must** do it');
    expect(c.map((x) => x.message)).toEqual([
      'No “## The standard” section: readers look there for the rules',
      'No “## How to adopt” section: adoption issues link to it',
      'Rule keywords are written in capitals (MUST, SHOULD, MAY)',
    ]);
  });
});

describe('description markers', () => {
  const desc = 'From meeting #1\n\n- [ ] one\n- [x] two\n<!-- fu:meeting=1 -->\n<!-- fu:newstandard=API%20errors -->\n';

  it('hides markers while editing and puts them back on save', () => {
    const s = splitMarkers(desc);
    expect(s.text).toBe('From meeting #1\n\n- [ ] one\n- [x] two');
    expect(s.markers).toEqual(['<!-- fu:meeting=1 -->', '<!-- fu:newstandard=API%20errors -->']);
    expect(joinMarkers(s.text + '\n- [ ] three\n\n', s.markers)).toBe('From meeting #1\n\n- [ ] one\n- [x] two\n- [ ] three\n<!-- fu:meeting=1 -->\n<!-- fu:newstandard=API%20errors -->\n');
    expect(splitMarkers('Text <!-- fu:std=x -->').text).toBe('Text');
  });

  it('ticks a task, following it when lines moved, and refuses when it is gone', () => {
    const { text } = splitMarkers(desc);
    expect(toggleTask(text, 2, '- [ ] one', true)).toBe('From meeting #1\n\n- [x] one\n- [x] two');
    const moved = 'New intro\n' + text;
    expect(toggleTask(moved, 2, '- [ ] one', true)).toBe('New intro\nFrom meeting #1\n\n- [x] one\n- [x] two');
    expect(toggleTask(text, 2, '- [ ] removed task', true)).toBeNull();
  });
});

describe('meeting preview', () => {
  it('shows Arch lines as cards and the rest as markdown', () => {
    const notes = '### Discussion\nDECISION: Kafka retention 7 days\n    personal data 24h\nACTION @lukas: size the cluster due:15.12\n- [x] #7\nFree text';
    const parsed = parseMeeting(notes, { today, me: 'marco', defaultFollowUpDays: 7 });
    const html = renderMeetingPreview(notes, parsed, {
      today,
      items: new Map([[7, item(7, { title: 'Load test' })]]),
      name: (u) => (u === 'lukas' ? 'Lukas Brunner' : undefined),
      unknown: new Set(),
      isOff: () => false,
    }).html;
    expect(html).toContain('<h3 id="mdh-discussion" data-line="0">Discussion</h3>');
    expect(html).toContain('class="mcard mcard-decision" data-line="1"');
    expect(html).toContain('personal data 24h');
    expect(html).toContain('→ Lukas Brunner');
    expect(html).toContain('class="mcard mcard-update" data-line="4" data-iid="7"');
    expect(html).toContain('Load test');
    expect(html).toContain('<p data-line="5">Free text</p>');
    expect(html.match(/mcard /g)).toHaveLength(3);
  });
});

describe('completions', () => {
  it('offers Arch lines only in meeting notes, and rules only in standards', () => {
    expect(slashFor('meeting').some((s) => s.id === 'action')).toBe(true);
    expect(slashFor('description').some((s) => s.id === 'action')).toBe(false);
    expect(slashFor('standard').some((s) => s.id === 'must')).toBe(true);
    expect(slashFor('meeting').some((s) => s.id === 'must')).toBe(false);
  });

  it('resolves the due: suggestions against today', () => {
    const d = Object.fromEntries(dueTokens(today).map((x) => [x.token, x.date]));
    expect(d).toMatchObject({ today: '2026-11-26', tomorrow: '2026-11-27', fri: '2026-11-27', mon: '2026-11-30', '+3d': '2026-11-29', '1w': '2026-12-03', eow: '2026-11-27', eom: '2026-11-30' });
  });
});

describe('description edits against fake GitLab', () => {
  it('ticks a task on the latest version and keeps the hidden markers; records history', async () => {
    const { GitLab } = await import('../src/lib/gitlab');
    const { Service } = await import('../src/lib/service');
    const { createFakeGitLab, seedDb } = await import('../src/lib/demo');
    const { demoSettings } = await import('../src/lib/settings');
    const { getMarker } = await import('../src/lib/model');
    const fake = createFakeGitLab(seedDb(today));
    const svc = new Service(new GitLab('https://gitlab.demo.local', 't', fake.fetch), demoSettings);
    await svc.init();
    const adr = (await svc.loadItems()).find((i) => i.title === 'Write ADR for Kafka adoption')!;
    const { text } = splitMarkers(adr.description);
    const line = text.split('\n').findIndex((l) => l.includes('Consequences'));
    // Someone adds a line on top in GitLab meanwhile: the tick still lands on the right task.
    fake.db.issues.find((i) => i.iid === adr.iid)!.description = 'Note from Sofia\n' + adr.description;
    const ticked = await svc.tickTask(adr, line, text.split('\n')[line], true);
    expect(ticked!.description).toContain("- [x] Consequences for @sofia.ricci's inventory services");
    expect(ticked!.description.startsWith('Note from Sofia')).toBe(true);
    expect(getMarker(ticked!.description, 'meeting')).toBe(String(adr.meetingIid));
    expect(await svc.remoteDescription(adr)).toBe(ticked!.description);
    const notes = await svc.notes(adr);
    expect(notes.find((n) => n.system)?.body).toBe('changed the description');
    expect(notes.filter((n) => !n.system).map((n) => n.author.username)).toEqual(['sofia.ricci', 'marco']);
  });
});
