import { describe, expect, it } from 'vitest';
import { resolveDate } from '../src/lib/dates';
import { parseLine, parseNotes } from '../src/lib/parser';
import { getMarker, setMarker } from '../src/lib/model';
import { GitLab } from '../src/lib/gitlab';
import { Service } from '../src/lib/service';
import { createFakeGitLab, seedDb } from '../src/lib/demo';
import { demoSettings } from '../src/lib/settings';

const today = '2026-11-18'; // a Wednesday
const opts = { today, me: 'marco', defaultFollowUpDays: 7 };

describe('dates', () => {
  it.each([
    ['2026-12-01', '2026-12-01'],
    ['1.12.2026', '2026-12-01'],
    ['1.12', '2026-12-01'],
    ['1.2.', '2027-02-01'],
    ['10.11', '2027-11-10'],
    ['today', today],
    ['tomorrow', '2026-11-19'],
    ['+3d', '2026-11-21'],
    ['2w', '2026-12-02'],
    ['fri', '2026-11-20'],
    ['wed', '2026-11-25'],
    ['monday', '2026-11-23'],
    ['eow', '2026-11-20'],
    ['nw', '2026-11-23'],
    ['eom', '2026-11-30'],
  ])('%s → %s', (t, want) => expect(resolveDate(t, today)).toBe(want));
  it('rejects junk', () => expect(resolveDate('soonish', today)).toBeNull());
});

describe('parser', () => {
  it('parses an action with leading assignee and due date', () => {
    expect(parseLine('- ACTION @jonas.weber: share load-test results due:fri', opts)).toMatchObject({
      type: 'action',
      assignee: 'jonas.weber',
      title: 'Share load-test results',
      due: '2026-11-20',
    });
  });
  it('mention after colon and mid-sentence', () => {
    expect(parseLine('ACTION: @anna update the C4 diagrams', opts)).toMatchObject({ assignee: 'anna', title: 'Update the C4 diagrams' });
    expect(parseLine('todo: ask @sofia to list RabbitMQ consumers', opts)).toMatchObject({
      assignee: 'sofia',
      title: 'Ask @sofia to list RabbitMQ consumers',
    });
  });
  it('TODO without mention is mine and gets the default follow-up date', () => {
    expect(parseLine('TODO write ADR for caching', opts)).toMatchObject({ assignee: undefined, due: '2026-11-25' });
    expect(parseLine('AI @me: book the room', opts)).toMatchObject({ assignee: undefined, title: 'Book the room' });
  });
  it('decisions have no assignee or due date', () => {
    expect(parseLine('* DECISION: we use Kafka for async events (@jonas agrees)', opts)).toEqual({
      type: 'decision',
      title: 'We use Kafka for async events (@jonas agrees)',
      assignee: undefined,
      due: undefined,
      details: '',
      line: 1,
    });
  });
  it('standards', () => {
    expect(parseLine('STANDARD: API error format (RFC 7807) due:1.12', opts)).toMatchObject({
      type: 'standard',
      title: 'API error format (RFC 7807)',
      due: '2026-12-01',
    });
  });
  it('ignores prose that merely starts with a keyword', () => {
    expect(parseLine('AI strategy was discussed at length', opts)).toBeNull();
    expect(parseLine('Decision makers were not present', opts)).toBeNull();
    expect(parseLine('Ask around for more input', opts)).toBeNull();
    expect(parseLine('- [ ] todo: check this', opts)).not.toBeNull();
  });
  it('collects indented details under an item', () => {
    const notes = `Board meeting
- DECISION: Use Kafka
    RabbitMQ only for legacy
    - revisit in 2027
Other notes
  indented but not under an item
- ACTION @priya: migrate callbacks due:2026-12-05`;
    const items = parseNotes(notes, opts);
    expect(items).toHaveLength(2);
    expect(items[0].details).toBe('RabbitMQ only for legacy\n- revisit in 2027');
    expect(items[1]).toMatchObject({ assignee: 'priya', due: '2026-12-05', details: '', line: 7 });
  });
});

describe('markers', () => {
  it('replaces instead of duplicating', () => {
    let d = setMarker('text', 'mr', '12:3');
    d = setMarker(d, 'mr', '12:4');
    expect(getMarker(d, 'mr')).toBe('12:4');
    expect(d.match(/fu:mr/g)).toHaveLength(1);
  });
});

describe('service against fake GitLab', () => {
  const setup = async (labels = true) => {
    const fake = createFakeGitLab(seedDb(today, { labels }));
    const svc = new Service(new GitLab('https://gitlab.demo.local', 't', fake.fetch), demoSettings);
    await svc.init();
    return { svc, fake };
  };

  it('bootstraps labels', async () => {
    const { svc } = await setup(false);
    expect(svc.missingLabels.length).toBe(4);
    await svc.ensureLabels();
    await svc.init();
    expect(svc.missingLabels).toEqual([]);
  });

  it('captures a meeting end to end', async () => {
    const { svc, fake } = await setup();
    const notes = `- DECISION: Adopt OpenTelemetry
- ACTION @lukas.brunner: confirm budget due:fri
- TODO: draft OTel rollout plan
- STANDARD: Tracing headers`;
    const drafts = parseNotes(notes, opts);
    const r = await svc.captureMeeting({ title: 'Observability', date: today, attendees: 'Lukas', notes }, drafts);
    expect(r.errors).toEqual([]);
    expect(r.created.map((c) => c.kind)).toEqual(['decision', 'action', 'action', 'action']);
    const decision = r.created[0];
    expect(decision.open).toBe(false);
    expect(r.created[1].assignee?.username).toBe('lukas.brunner');
    expect(r.created[2].assignee?.username).toBe('marco');
    // A STANDARD line becomes an action to write the standard, linked to the meeting.
    expect(r.created[3]).toMatchObject({ title: 'Write standard: Tracing headers', newStandard: true });
    expect(r.created[3].meetingIid).toBe(r.meetingIid);
    const meeting = fake.db.issues.find((i) => i.iid === r.meetingIid)!;
    expect(meeting.state).toBe('closed');
    expect(meeting.description).toContain('### Decisions\n- #');
    const items = await svc.loadItems();
    expect(items.filter((i) => i.meetingIid === r.meetingIid)).toHaveLength(4);
  });

  it('reports an unknown assignee without aborting the meeting', async () => {
    const { svc } = await setup();
    const drafts = parseNotes('- ACTION @nobody: x\n- TODO: y', opts);
    const r = await svc.captureMeeting({ title: 'M', date: today, attendees: '', notes: '' }, drafts);
    expect(r.created).toHaveLength(1);
    expect(r.errors[0]).toMatch(/@nobody not found/);
  });

  it('nudges the assignee and pushes the follow-up date', async () => {
    const { svc, fake } = await setup();
    const it0 = (await svc.loadItems()).find((i) => i.assignee?.username === 'jonas.weber')!;
    const upd = await svc.nudge(it0, 'any update?', 3);
    expect(fake.db.notes[`11:${it0.iid}`].filter((n) => !n.system)[0].body).toBe('@jonas.weber any update?');
    expect(upd!.due! > today).toBe(true);
  });
});
