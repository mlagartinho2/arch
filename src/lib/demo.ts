// In-memory fake of the handful of GitLab endpoints this app uses. Powers demo mode and the tests.
import type { FetchFn, GlIssue, GlNote, GlUser } from './gitlab';
import { addDays, todayIso } from './dates';
import { LABEL_DEFS, LABELS, standardDescription, setAdoption, setMarker } from './model';

interface Db {
  seq: number;
  users: GlUser[];
  projects: { id: number; path_with_namespace: string; default_branch: string; web_url: string }[];
  issues: GlIssue[];
  notes: Record<string, GlNote[]>;
  labels: Record<number, string[]>;
  mrs: { project_id: number; iid: number; state: string; title: string; web_url: string; created: number }[];
  files: Record<string, string>;
}

const BASE = 'https://gitlab.demo.local';
const STORE_KEY = 'arch.demo-db.v1';

const users: GlUser[] = [
  { id: 1, username: 'marco', name: 'Marco' },
  { id: 2, username: 'anna.keller', name: 'Anna Keller' },
  { id: 3, username: 'jonas.weber', name: 'Jonas Weber' },
  { id: 4, username: 'sofia.ricci', name: 'Sofia Ricci' },
  { id: 5, username: 'lukas.brunner', name: 'Lukas Brunner' },
  { id: 6, username: 'priya.nair', name: 'Priya Nair' },
];

function emptyDb(): Db {
  return {
    seq: 1000,
    users,
    projects: [
      { id: 11, path_with_namespace: 'architecture/follow-ups', default_branch: 'main', web_url: `${BASE}/architecture/follow-ups` },
      { id: 12, path_with_namespace: 'architecture/standards', default_branch: 'main', web_url: `${BASE}/architecture/standards` },
    ],
    issues: [],
    notes: {},
    labels: { 11: LABEL_DEFS.map((l) => l.name), 12: [] },
    mrs: [],
    files: {},
  };
}

export function seedDb(today = todayIso(), opts: { labels?: boolean } = { labels: true }): Db {
  const db = emptyDb();
  if (!opts.labels) db.labels[11] = [];
  const u = (name: string) => users.find((x) => x.username === name)!;
  let iid = 0;
  const mk = (p: {
    title: string;
    labels: string[];
    assignee?: string;
    author?: string;
    due?: number | null;
    closed?: boolean;
    desc?: string;
    ago?: number;
  }) => {
    iid++;
    const created = `${addDays(today, -(p.ago ?? 3))}T09:00:00Z`;
    const issue: GlIssue = {
      id: 5000 + iid,
      iid,
      project_id: 11,
      title: p.title,
      description: p.desc ?? '',
      state: p.closed ? 'closed' : 'opened',
      labels: p.labels,
      assignees: p.assignee ? [u(p.assignee)] : [],
      author: u(p.author ?? 'marco'),
      due_date: p.due === undefined || p.due === null ? null : addDays(today, p.due),
      created_at: created,
      updated_at: created,
      closed_at: p.closed ? created : null,
      web_url: `${BASE}/architecture/follow-ups/-/issues/${iid}`,
      user_notes_count: 0,
    };
    db.issues.push(issue);
    return issue;
  };
  const m1 = mk({
    title: 'Architecture Board (' + addDays(today, -6) + ')',
    labels: [LABELS.meeting],
    closed: true,
    ago: 6,
    desc: `**Date:** ${addDays(today, -6)}  \n**Attendees:** Anna, Jonas, Sofia, Lukas\n\n## Notes\n\nDiscussed async messaging and API error formats.\n`,
  });
  const m2 = mk({
    title: 'Payments crew sync (' + addDays(today, -2) + ')',
    labels: [LABELS.meeting],
    closed: true,
    ago: 2,
    desc: `**Date:** ${addDays(today, -2)}  \n**Attendees:** Jonas, Priya\n\n## Notes\n\nGateway migration status.\n`,
  });
  const from = (m: GlIssue) => (d: string) => setMarker(`From meeting #${m.iid}\n\n${d}`.trim(), 'meeting', String(m.iid));
  mk({ title: 'Use Kafka for all async domain events', labels: [LABELS.decision], closed: true, ago: 6, desc: from(m1)('RabbitMQ stays only for legacy integrations until 2027.') });
  mk({ title: 'Public APIs return RFC 7807 problem+json errors', labels: [LABELS.decision], closed: true, ago: 6, desc: from(m1)('') });
  mk({ title: 'Payments keeps its own Postgres cluster', labels: [LABELS.decision], closed: true, ago: 2, desc: from(m2)('Revisit when the shared platform DB offers PITR.') });
  mk({ title: 'Write ADR for Kafka adoption', labels: [LABELS.action], assignee: 'marco', due: -1, ago: 6, desc: from(m1)('') });
  mk({ title: 'Share load-test results of the new gateway', labels: [LABELS.action], assignee: 'jonas.weber', due: -2, ago: 6, desc: from(m1)('') });
  mk({ title: 'Inventory services still on RabbitMQ', labels: [LABELS.action], assignee: 'sofia.ricci', due: 2, ago: 6, desc: from(m1)('') });
  mk({ title: 'Migrate payment-callbacks to the new API gateway', labels: [LABELS.action], assignee: 'priya.nair', due: 5, ago: 2, desc: from(m2)('') });
  mk({ title: 'Review Priya\'s gateway migration plan', labels: [LABELS.action], assignee: 'marco', due: 0, ago: 2, desc: from(m2)('') });
  mk({ title: 'Book slot at the next Tech Council for the API guidelines', labels: [LABELS.action], assignee: 'marco', due: 9, ago: 1 });
  mk({ title: 'Confirm budget for the observability POC', labels: [LABELS.action], assignee: 'lukas.brunner', due: 12, ago: 4 });
  const crews = [
    { name: 'Payments', handle: '@platform/crew-payments' },
    { name: 'Onboarding', handle: '@platform/crew-onboarding' },
    { name: 'Data', handle: '@platform/crew-data' },
  ];
  mk({
    title: 'API error format (RFC 7807)',
    labels: [LABELS.standard, LABELS.stdDraft],
    assignee: 'marco',
    due: 4,
    ago: 6,
    desc: standardDescription({ summary: 'All public REST APIs return application/problem+json for 4xx/5xx.', crews, meetingIid: m1.iid }),
  });
  let kafka = standardDescription({ summary: 'Topic naming, schema registry usage and retention defaults.', crews, meetingIid: m1.iid });
  kafka = setAdoption(setAdoption(kafka, 'Payments', true), 'Data', true);
  mk({ title: 'Kafka topic naming & schema rules', labels: [LABELS.standard, LABELS.stdPublished], assignee: 'marco', due: 14, ago: 20, desc: kafka });
  mk({ title: 'Old: document service ownership', labels: [LABELS.action], assignee: 'anna.keller', due: -10, closed: true, ago: 15 });
  db.seq = 2000;
  db.issues.forEach((i) => (db.notes[`11:${i.iid}`] = []));
  return db;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function createFakeGitLab(initial?: Db, persist = false): { fetch: FetchFn; db: Db } {
  const db: Db = initial ?? loadPersisted() ?? seedDb();
  const save = () => {
    if (!persist) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(db));
    } catch {
      /* ignore */
    }
  };
  const proj = (idOrPath: string) => {
    const dec = decodeURIComponent(idOrPath);
    return db.projects.find((p) => String(p.id) === dec || p.path_with_namespace === dec);
  };
  const me = db.users[0];

  const fetchFn: FetchFn = async (input, init) => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/api\/v4/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const q = url.searchParams;
    let m: RegExpMatchArray | null;
    const now = new Date().toISOString();

    if (path === '/user') return json(me);
    if (path === '/users') return json(db.users.filter((u) => u.username === q.get('username')));

    if (!(m = path.match(/^\/projects\/([^/]+)(\/.*)?$/))) return json({ message: '404 Not Found' }, 404);
    const p = proj(m[1]);
    if (!p) return json({ message: '404 Project Not Found' }, 404);
    const sub = m[2] ?? '';

    if (sub === '' && method === 'GET') return json(p);
    if (sub === '/members/all') {
      const query = (q.get('query') ?? '').toLowerCase();
      return json(db.users.filter((u) => u.username.includes(query) || u.name.toLowerCase().includes(query)));
    }
    if (sub === '/labels') {
      if (method === 'POST') {
        db.labels[p.id] = [...(db.labels[p.id] ?? []), body.name];
        save();
        return json({ name: body.name }, 201);
      }
      return json((db.labels[p.id] ?? []).map((name) => ({ name })));
    }
    if (sub === '/issues' && method === 'GET') {
      const state = q.get('state') ?? 'all';
      const labels = (q.get('labels') ?? '').split(',').filter(Boolean);
      const after = q.get('updated_after');
      const list = db.issues.filter(
        (i) =>
          i.project_id === p.id &&
          (state === 'all' || i.state === state) &&
          labels.every((l) => i.labels.includes(l)) &&
          (!after || i.updated_at >= after),
      );
      const per = Number(q.get('per_page') ?? 20);
      const page = Number(q.get('page') ?? 1);
      const slice = list.slice((page - 1) * per, page * per);
      return json(slice, 200, { 'x-next-page': page * per < list.length ? String(page + 1) : '' });
    }
    if (sub === '/issues' && method === 'POST') {
      const iid = Math.max(0, ...db.issues.filter((i) => i.project_id === p.id).map((i) => i.iid)) + 1;
      const issue: GlIssue = {
        id: ++db.seq,
        iid,
        project_id: p.id,
        title: body.title,
        description: body.description ?? '',
        state: 'opened',
        labels: (body.labels ?? '').split(',').filter(Boolean),
        assignees: (body.assignee_ids ?? []).map((id: number) => db.users.find((u) => u.id === id)).filter(Boolean),
        author: me,
        due_date: body.due_date ?? null,
        created_at: now,
        updated_at: now,
        closed_at: null,
        web_url: `${p.web_url}/-/issues/${iid}`,
        user_notes_count: 0,
      };
      db.issues.push(issue);
      db.notes[`${p.id}:${iid}`] = [];
      save();
      return json(issue, 201);
    }
    if ((m = sub.match(/^\/issues\/(\d+)(\/.*)?$/))) {
      const issue = db.issues.find((i) => i.project_id === p.id && i.iid === Number(m![1]));
      if (!issue) return json({ message: '404 Issue Not Found' }, 404);
      const rest = m[2] ?? '';
      const key = `${p.id}:${issue.iid}`;
      if (rest === '' && method === 'GET') return json(issue);
      if (rest === '' && method === 'PUT') {
        if (body.title !== undefined) issue.title = body.title;
        if (body.description !== undefined) issue.description = body.description;
        if (body.due_date !== undefined) issue.due_date = body.due_date;
        if (body.assignee_ids) issue.assignees = body.assignee_ids.map((id: number) => db.users.find((u) => u.id === id)!);
        if (body.labels !== undefined) issue.labels = String(body.labels).split(',').filter(Boolean);
        if (body.remove_labels) {
          const rm = String(body.remove_labels).split(',');
          issue.labels = issue.labels.filter((l) => !rm.includes(l));
        }
        if (body.add_labels) {
          for (const l of String(body.add_labels).split(',')) if (!issue.labels.includes(l)) issue.labels.push(l);
        }
        if (body.state_event === 'close') {
          issue.state = 'closed';
          issue.closed_at = now;
        }
        if (body.state_event === 'reopen') {
          issue.state = 'opened';
          issue.closed_at = null;
        }
        issue.updated_at = now;
        save();
        return json(issue);
      }
      if (rest === '/notes') {
        db.notes[key] ??= [];
        if (method === 'POST') {
          const note: GlNote = { id: ++db.seq, body: body.body, author: me, created_at: now, system: false };
          db.notes[key].unshift(note);
          issue.user_notes_count++;
          issue.updated_at = now;
          save();
          return json(note, 201);
        }
        return json(db.notes[key]);
      }
      if (rest === '/links' && method === 'POST') return json({}, 201);
    }
    if (sub === '/repository/commits' && method === 'POST') {
      for (const a of body.actions) db.files[`${p.id}:${body.branch}:${a.file_path}`] = a.content;
      save();
      return json({ id: 'abc123' }, 201);
    }
    if (sub === '/merge_requests' && method === 'POST') {
      const iid = db.mrs.filter((x) => x.project_id === p.id).length + 1;
      const mr = { project_id: p.id, iid, state: 'opened', title: body.title, web_url: `${p.web_url}/-/merge_requests/${iid}`, created: Date.now() };
      db.mrs.push(mr);
      save();
      return json(mr, 201);
    }
    if ((m = sub.match(/^\/merge_requests\/(\d+)$/))) {
      const mr = db.mrs.find((x) => x.project_id === p.id && x.iid === Number(m![1]));
      if (!mr) return json({ message: '404' }, 404);
      // Demo: pretend reviewers merge after 30 seconds.
      if (mr.state === 'opened' && Date.now() - mr.created > 30000) mr.state = 'merged';
      save();
      return json(mr);
    }
    return json({ message: `Demo does not implement ${method} ${path}` }, 404);
  };
  return { fetch: fetchFn, db };
}

function loadPersisted(): Db | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Db) : null;
  } catch {
    return null;
  }
}

export function resetDemo() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}
