import { describe, expect, it } from 'vitest';
import { parseMeeting, parseUpdate, updateNote } from '../src/lib/parser';
import { agendaMarkdown, agendaNotes, buildPrep, listSeries, resolveAttendees, seriesName } from '../src/lib/prep';
import { GitLab } from '../src/lib/gitlab';
import { Service } from '../src/lib/service';
import { createFakeGitLab, seedDb } from '../src/lib/demo';
import { demoSettings } from '../src/lib/settings';
import type { GlUser } from '../src/lib/gitlab';

const today = '2026-11-18'; // Wednesday
const opts = { today, me: 'marco', defaultFollowUpDays: 7 };

describe('update syntax', () => {
  it.each([
    ['DONE #7', { op: 'done', iid: 7, text: '' }],
    ['- [x] #7 Share load-test results (jonas.weber, 2d overdue)', { op: 'done', iid: 7 }],
    ['done: #7 shared on the wiki', { op: 'done', iid: 7, text: 'shared on the wiki' }],
    ['UPDATE #8: vendor answers Friday', { op: 'note', iid: 8, text: 'vendor answers Friday' }],
    ['note #8 due:fri waiting', { op: 'note', iid: 8, due: '2026-11-20', text: 'waiting' }],
    ['PUSH #9 due:2w', { op: 'push', iid: 9, due: '2026-12-02' }],
    ['- [ ] PUSH #9', { op: 'push', iid: 9, due: '2026-11-25' }],
    ['DROP #10: superseded by #12', { op: 'drop', iid: 10, text: 'superseded by #12' }],
    ['UPDATE #10 @anna.keller: Anna takes it over', { op: 'note', iid: 10, assignee: 'anna.keller', text: 'Anna takes it over' }],
    ['ADOPTED #14 Onboarding, Data', { op: 'adopted', iid: 14, text: 'Onboarding, Data' }],
  ])('%s', (line, want) => expect(parseUpdate(line, opts)).toMatchObject(want));

  it('ignores lines that are not updates', () => {
    for (const l of ['- [ ] #7 Share load-test results', 'Done with the intro', '#7 was discussed', 'Note: nothing today']) {
      expect(parseUpdate(l, opts)).toBeNull();
    }
  });

  it('strips the copied agenda title from the note', () => {
    expect(updateNote('Share load-test results (jonas.weber, 2d overdue): on the wiki', 'Share load-test results')).toBe('on the wiki');
    expect(updateNote('Share load-test results (jonas.weber, 2d overdue)', 'Share load-test results')).toBe('');
    expect(updateNote('vendor late', 'Share load-test results')).toBe('vendor late');
  });

  it('parseMeeting separates new items from updates, and an update line ends a details block', () => {
    const r = parseMeeting('- ACTION @bob: x\n    detail\n- [x] #7 old item\n    not a detail\nDECISION: y', opts);
    expect(r.items.map((i) => i.title)).toEqual(['X', 'Y']);
    expect(r.items[0].details).toBe('detail');
    expect(r.updates).toEqual([{ op: 'done', iid: 7, text: 'old item', line: 3 }]);
  });
});

describe('prep', () => {
  const fake = createFakeGitLab(seedDb(today));
  const users = fake.db.users as GlUser[];
  const load = async () => {
    const svc = new Service(new GitLab('https://gitlab.demo.local', 't', fake.fetch), demoSettings);
    await svc.init();
    return { svc, items: await svc.loadItems() };
  };

  it('names series and resolves attendees', () => {
    expect(seriesName('Architecture Board (2026-11-12)')).toBe('Architecture Board');
    expect(resolveAttendees('Anna, Jonas Weber, @sofia.ricci and Bob', users)).toEqual({
      usernames: ['anna.keller', 'jonas.weber', 'sofia.ricci'],
      unresolved: ['Bob'],
    });
  });

  it('gathers a recurring meeting', async () => {
    const { items } = await load();
    expect(listSeries(items).map((s) => s.name)).toEqual(['Payments crew sync', 'Architecture Board']);
    const prep = buildPrep(items, {
      title: 'architecture board',
      attendees: ['anna.keller', 'jonas.weber', 'sofia.ricci', 'lukas.brunner'],
      crews: [],
      me: 'marco',
      users,
    });
    const ids = Object.fromEntries(prep.sections.map((s) => [s.id, s.items.map((i) => i.iid)]));
    expect(prep.lastSession?.iid).toBe(1);
    expect(ids).toEqual({ carry: [7, 6, 8], theyOwe: [12], mine: [10], standards: [13, 14], decisions: [3, 4] });
  });

  it('gathers a 1:1 without a series, and pending standards for selected crews', async () => {
    const { items } = await load();
    const prep = buildPrep(items, { title: '1:1 Priya', attendees: ['priya.nair'], crews: ['Onboarding'], me: 'marco', users });
    const ids = Object.fromEntries(prep.sections.map((s) => [s.id, s.items.map((i) => i.iid)]));
    expect(prep.series).toBeUndefined();
    expect(ids).toEqual({ carry: [], theyOwe: [9], mine: [10], standards: [14], decisions: [] });
  });

  it('renders the agenda and capture notes', async () => {
    const { items } = await load();
    const prep = buildPrep(items, { title: 'Architecture Board', attendees: ['jonas.weber'], crews: [], me: 'marco', users });
    const o = {
      title: 'Architecture Board',
      date: '2026-11-25',
      attendeeNames: ['Jonas Weber'],
      topics: 'Observability budget\n- Kafka retention',
      today,
      projectPath: 'architecture/follow-ups',
      excluded: new Set([8]),
    };
    const md = agendaMarkdown(prep, o);
    expect(md).toContain('## Architecture Board — 2026-11-25\n**Attendees:** Jonas Weber');
    expect(md).toContain('- [ ] architecture/follow-ups#7 Share load-test results of the new gateway — @jonas.weber, 2d overdue');
    expect(md).not.toContain('#8 ');
    expect(md).toContain('- architecture/follow-ups#14 Kafka topic naming & schema rules — pending: Onboarding');
    expect(md).toContain('### Other topics\n- Observability budget\n- Kafka retention');
    const notes = agendaNotes(prep, o);
    expect(notes).toContain('- [ ] #7 Share load-test results of the new gateway (jonas.weber, 2d overdue)');
    // Agenda lines are inert until the user ticks or prefixes them.
    expect(parseMeeting(notes, opts)).toEqual({ items: [], updates: [] });
    const ticked = parseMeeting(notes.replace('- [ ] #7', '- [x] #7'), opts).updates[0];
    expect(updateNote(ticked.text, 'Share load-test results of the new gateway')).toBe('');
  });
});

describe('applying updates', () => {
  const setup = async () => {
    const fake = createFakeGitLab(seedDb(today));
    const svc = new Service(new GitLab('https://gitlab.demo.local', 't', fake.fetch), demoSettings);
    await svc.init();
    return { svc, fake };
  };
  const issue = (fake: ReturnType<typeof createFakeGitLab>, iid: number) => fake.db.issues.find((i) => i.iid === iid)!;
  const notes = (fake: ReturnType<typeof createFakeGitLab>, iid: number) => fake.db.notes[`11:${iid}`].map((n) => n.body);

  it('captures a meeting that both creates and updates items', async () => {
    const { svc, fake } = await setup();
    const text = `- [x] #7 Share load-test results of the new gateway (jonas.weber, 2d overdue)
UPDATE #8: halfway, 4 services left
PUSH #6 due:fri
DROP #12: budget moved to Q1
ADOPTED #14 Onboarding
ACTION @sofia.ricci: plan the remaining migrations
DONE #999`;
    const { items, updates } = parseMeeting(text, opts);
    const r = await svc.captureMeeting({ title: 'Architecture Board', date: today, attendees: 'Sofia', notes: text }, items, undefined, updates);
    expect(r.created).toHaveLength(1);
    expect(r.updated.map((u) => [u.iid, u.summary])).toEqual([
      [7, 'done'],
      [8, 'updated'],
      [6, 'follow-up → 2026-11-20'],
      [12, 'dropped'],
      [14, 'adopted by Onboarding'],
    ]);
    expect(r.errors).toEqual(['#999: GET /projects/11/issues/999: 404 404 Issue Not Found']);
    const m = r.meetingIid;
    expect(issue(fake, 7).state).toBe('closed');
    expect(notes(fake, 7)[0]).toBe(`✅ Done in #${m}`);
    expect(notes(fake, 8)[0]).toBe(`📝 Update in #${m}: halfway, 4 services left`);
    expect(issue(fake, 6).due_date).toBe('2026-11-20');
    expect(issue(fake, 12).state).toBe('closed');
    expect(notes(fake, 12)[0]).toBe(`🚫 Dropped in #${m}: budget moved to Q1`);
    expect(issue(fake, 14).state).toBe('closed'); // last pending crew adopted
    expect(issue(fake, 14).labels).toContain('fu-std::adopted');
    expect(issue(fake, m).description).toContain('### Updated\n- #7 Share load-test results of the new gateway — done');
  });

  it('rejects updates that make no sense', async () => {
    const { svc } = await setup();
    const u = (l: string) => parseUpdate(l, opts)!;
    await expect(svc.applyUpdate(u('DONE #13'))).rejects.toThrow(/is a standard/);
    await expect(svc.applyUpdate(u('ADOPTED #13 Mars'))).rejects.toThrow(/no crew "Mars"/);
    await expect(svc.applyUpdate(u('ADOPTED #7 Payments'))).rejects.toThrow(/not a standard/);
    await expect(svc.applyUpdate(u('UPDATE #7'))).rejects.toThrow(/no text/);
    await expect(svc.applyUpdate(u('DONE #1'))).rejects.toThrow(/is a meeting/);
  });

  it('reassigns and works without a meeting (quick add)', async () => {
    const { svc, fake } = await setup();
    const r = await svc.applyUpdate(parseUpdate('UPDATE #10 @anna.keller: Anna takes it', opts)!);
    expect(r.summary).toBe('updated · → @anna.keller');
    expect(issue(fake, 10).assignees[0].username).toBe('anna.keller');
    expect(notes(fake, 10)[0]).toBe('📝 Update: Anna takes it');
  });
});
