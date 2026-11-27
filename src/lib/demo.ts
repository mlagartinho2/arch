// In-memory fake of the GitLab endpoints this app uses. Powers demo mode and the tests.
import type { FetchFn, GlIssue, GlNote, GlUser } from './gitlab';
import { addDays, todayIso } from './dates';
import { LABEL_DEFS, LABELS, adoptionDescription, adoptionTitle, setMarker } from './model';
import {
  newStandardDoc,
  nextVersion,
  renderStandardFile,
  renderWikiIndex,
  renderWikiPage,
  standardFilePath,
  standardTemplate,
  wikiSlug,
  type StandardDoc,
} from './standards';

interface FakeMr {
  project_id: number;
  iid: number;
  state: string;
  title: string;
  description: string;
  source_branch: string;
  target_branch: string;
  web_url: string;
  created: number;
  created_at: string;
  /** Demo only: merge automatically 30 seconds after creation */
  autoMerge: boolean;
}

interface FakeCommit {
  id: string;
  short_id: string;
  project_id: number;
  branch: string;
  title: string;
  author_name: string;
  created_at: string;
  paths: string[];
}

interface WikiPage {
  slug: string;
  title: string;
  content: string;
}

interface Db {
  seq: number;
  users: GlUser[];
  projects: { id: number; path_with_namespace: string; default_branch: string; web_url: string }[];
  groups: { id: number; full_path: string }[];
  issues: GlIssue[];
  notes: Record<string, GlNote[]>;
  labels: Record<number, string[]>;
  mrs: FakeMr[];
  /** "projectId:branch:path" → content */
  files: Record<string, string>;
  /** "projectId:branch" → changes made on that branch (applied to the target on merge); null content = deleted */
  changes: Record<string, { path: string; content: string | null }[]>;
  commits: FakeCommit[];
  /** "project:<id>" or "group:<id>" → pages */
  wikis: Record<string, WikiPage[]>;
}

const BASE = 'https://gitlab.demo.local';
const STORE_KEY = 'arch.demo-db.v3';

const users: GlUser[] = [
  { id: 1, username: 'marco', name: 'Marco' },
  { id: 2, username: 'anna.keller', name: 'Anna Keller' },
  { id: 3, username: 'jonas.weber', name: 'Jonas Weber' },
  { id: 4, username: 'sofia.ricci', name: 'Sofia Ricci' },
  { id: 5, username: 'lukas.brunner', name: 'Lukas Brunner' },
  { id: 6, username: 'priya.nair', name: 'Priya Nair' },
];

const STD = 12;
const STD_WEB = `${BASE}/architecture/standards`;

function emptyDb(): Db {
  return {
    seq: 1000,
    users,
    projects: [
      { id: 11, path_with_namespace: 'architecture/follow-ups', default_branch: 'main', web_url: `${BASE}/architecture/follow-ups` },
      { id: STD, path_with_namespace: 'architecture/standards', default_branch: 'main', web_url: STD_WEB },
    ],
    groups: [{ id: 20, full_path: 'architecture' }],
    issues: [],
    notes: {},
    labels: { 11: LABEL_DEFS.map((l) => l.name), [STD]: [] },
    mrs: [],
    files: {},
    changes: {},
    commits: [],
    wikis: { [`project:${STD}`]: [], 'group:20': [] },
  };
}

const CATS: Record<string, string> = { api: 'API', react: 'React', devops: 'DevOps', security: 'Security & vulnerabilities' };

function seedStandards(db: Db, today: string): Record<string, StandardDoc> {
  const d = (n: number) => addDays(today, -n);
  const api10 = newStandardDoc(
    { id: 'api-error-format', title: 'API error format (RFC 7807)', category: 'api', tags: ['rest', 'errors'], owner: 'marco' },
    standardTemplate('API error format (RFC 7807)', 'Clients need one predictable error shape across all public REST APIs.').replace(
      '- Teams **MUST** …\n- Teams **SHOULD** …',
      '- Public REST APIs **MUST** return `application/problem+json` for every 4xx and 5xx response.\n- Responses **MUST** include `type`, `title` and `status`; **SHOULD** include `detail` and `instance`.',
    ),
    d(40),
  );
  const api11 = nextVersion(api10, { kind: 'minor', note: 'Clarified that validation errors list fields in `errors[]`', date: d(10) });
  const react10 = newStandardDoc(
    { id: 'react-state-management', title: 'React state management', category: 'react', tags: ['frontend', 'state'], owner: 'anna.keller' },
    standardTemplate('React state management', 'Keep server state and UI state apart so caching and refetching stay predictable.'),
    d(30),
  );
  const ops10 = newStandardDoc(
    { id: 'container-image-baseline', title: 'Container image baseline', category: 'devops', tags: ['docker', 'ci'], owner: 'lukas.brunner' },
    standardTemplate('Container image baseline', 'Every service image starts from an approved, regularly patched base.'),
    d(60),
  );
  const ops20 = nextVersion(ops10, { kind: 'major', note: 'Distroless base images required; Alpine no longer allowed', date: d(3) });
  const sec10 = newStandardDoc(
    { id: 'dependency-vulnerability-sla', title: 'Dependency vulnerability SLA', category: 'security', tags: ['cve', 'sla'], owner: 'marco' },
    standardTemplate('Dependency vulnerability SLA', 'Known vulnerabilities in dependencies are fixed within a fixed time per severity.'),
    d(20),
  );
  let n = 0;
  const commit = (doc: StandardDoc, date: string, title: string) => {
    const path = standardFilePath('standards', doc.meta.category, doc.meta.id);
    db.files[`${STD}:main:${path}`] = renderStandardFile(doc);
    const id = `c0ffee${String(++n).padStart(2, '0')}deadbeef`;
    db.commits.push({ id, short_id: id.slice(0, 8), project_id: STD, branch: 'main', title, author_name: 'Marco', created_at: `${date}T10:00:00Z`, paths: [path] });
  };
  commit(api10, d(40), 'Add standard API error format (RFC 7807) v1.0');
  commit(api11, d(10), 'Update standard API error format (RFC 7807) v1.1');
  commit(react10, d(30), 'Add standard React state management v1.0');
  commit(ops10, d(60), 'Add standard Container image baseline v1.0');
  commit(ops20, d(3), 'Update standard Container image baseline v2.0');
  commit(sec10, d(20), 'Add standard Dependency vulnerability SLA v1.0');

  // Wiki: up to date except the container baseline, still on 1.0 (merged three days ago, not published yet).
  const page = (doc: StandardDoc) => {
    const path = standardFilePath('standards', doc.meta.category, doc.meta.id);
    const slug = wikiSlug('standards', doc.meta.category, doc.meta.id);
    return {
      slug,
      title: slug,
      content: renderWikiPage(doc, {
        categoryLabel: CATS[doc.meta.category],
        sourceUrl: `${STD_WEB}/-/blob/main/${path}`,
        historyUrl: `${STD_WEB}/-/commits/main/${path}`,
      }),
    };
  };
  db.wikis[`project:${STD}`] = [
    page(api11),
    page(react10),
    page(ops10),
    page(sec10),
    { slug: 'standards', title: 'standards', content: renderWikiIndex([api11, react10, ops10, sec10], 'standards', (k) => CATS[k] ?? k) },
  ];

  // An open change in review: React state management 1.1.
  const react11 = nextVersion(react10, { kind: 'minor', note: 'Recommend TanStack Query for server state', date: d(1) });
  const branch = 'standard/react-state-management-1-1-demo';
  const rpath = standardFilePath('standards', 'react', 'react-state-management');
  db.changes[`${STD}:${branch}`] = [{ path: rpath, content: renderStandardFile(react11) }];
  db.files[`${STD}:${branch}:${rpath}`] = renderStandardFile(react11);
  db.mrs.push({
    project_id: STD,
    iid: 1,
    state: 'opened',
    title: 'Standard: React state management v1.1',
    description: `**Change:** Recommend TanStack Query for server state\n\n<!-- arch:proposal id=react-state-management version=1.1 kind=change -->`,
    source_branch: branch,
    target_branch: 'main',
    web_url: `${STD_WEB}/-/merge_requests/1`,
    created: Date.now(),
    created_at: `${d(1)}T09:00:00Z`,
    autoMerge: false,
  });
  return { api11, ops20 };
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
  const docs = seedStandards(db, today);

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
  mk({
    title: 'Write ADR for Kafka adoption',
    labels: [LABELS.action],
    assignee: 'marco',
    due: -1,
    ago: 6,
    desc: from(m1)(
      `## Scope\n\nRecord the decision #${m2.iid + 1} as an ADR before the next board.\n\n- [x] Context and options (Kafka, RabbitMQ, SNS)\n- [ ] Consequences for @sofia.ricci's inventory services\n- [ ] Migration plan for legacy integrations`,
    ),
  });
  mk({ title: 'Share load-test results of the new gateway', labels: [LABELS.action], assignee: 'jonas.weber', due: -2, ago: 6, desc: from(m1)('') });
  mk({ title: 'Inventory services still on RabbitMQ', labels: [LABELS.action], assignee: 'sofia.ricci', due: 2, ago: 6, desc: from(m1)('') });
  mk({ title: 'Migrate payment-callbacks to the new API gateway', labels: [LABELS.action], assignee: 'priya.nair', due: 5, ago: 2, desc: from(m2)('') });
  mk({ title: "Review Priya's gateway migration plan", labels: [LABELS.action], assignee: 'marco', due: 0, ago: 2, desc: from(m2)('') });
  mk({ title: 'Book slot at the next Tech Council for the API guidelines', labels: [LABELS.action], assignee: 'marco', due: 9, ago: 1 });
  mk({ title: 'Confirm budget for the observability POC', labels: [LABELS.action], assignee: 'lukas.brunner', due: 12, ago: 4 });

  // Adoption cycle for API error format v1.0 (Payments done, Onboarding overdue, Data in progress), and v2.0 of the container baseline.
  const adopt = (doc: StandardDoc, version: string, team: string, handle: string, who: string, due: number, closed = false, ago = 30) =>
    mk({
      title: adoptionTitle(doc.meta.title, version, team),
      labels: [LABELS.adoption],
      assignee: who,
      due,
      closed,
      ago,
      desc: adoptionDescription({
        stdId: doc.meta.id,
        stdTitle: doc.meta.title,
        version,
        categoryLabel: CATS[doc.meta.category],
        wikiUrl: `${STD_WEB}/-/wikis/${wikiSlug('standards', doc.meta.category, doc.meta.id)}`,
        team,
        teamHandle: handle,
        responsible: who,
        due: addDays(today, due),
        changes: [],
        firstAdoption: true,
      }),
    });
  adopt(docs.api11, '1.0', 'Payments', '@platform/crew-payments', 'priya.nair', -12, true);
  adopt(docs.api11, '1.0', 'Onboarding', '@platform/crew-onboarding', 'jonas.weber', -3);
  adopt(docs.api11, '1.0', 'Data', '@platform/crew-data', 'sofia.ricci', 10);
  adopt(docs.ops20, '2.0', 'Payments', '@platform/crew-payments', 'priya.nair', 20, false, 2);
  mk({ title: 'Old: document service ownership', labels: [LABELS.action], assignee: 'anna.keller', due: -10, closed: true, ago: 15 });
  db.seq = 2000;
  db.issues.forEach((i) => (db.notes[`11:${i.iid}`] = []));
  const note = (title: string, who: string, body: string, daysAgo: number, system = false) => {
    const i = db.issues.find((x) => x.title === title)!;
    db.notes[`11:${i.iid}`].unshift({ id: ++db.seq, body, author: u(who), created_at: `${addDays(today, -daysAgo)}T10:00:00Z`, system });
    if (!system) i.user_notes_count++;
  };
  note('Write ADR for Kafka adoption', 'marco', 'changed the description', 5, true);
  note('Write ADR for Kafka adoption', 'marco', `changed due date to ${addDays(today, -1)}`, 4, true);
  note('Write ADR for Kafka adoption', 'marco', "Follow-up moved: waiting for the platform team's numbers.", 4);
  note('Write ADR for Kafka adoption', 'sofia.ricci', 'Numbers are in the capacity sheet. Two services still need a consumer group each.', 2);
  note('Share load-test results of the new gateway', 'jonas.weber', 'Running the last scenario on Thursday, results by Friday.', 3);
  return db;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function page<T>(list: T[], q: URLSearchParams) {
  const per = Number(q.get('per_page') ?? 20);
  const pg = Number(q.get('page') ?? 1);
  return json(list.slice((pg - 1) * per, pg * per), 200, { 'x-next-page': pg * per < list.length ? String(pg + 1) : '' });
}

export function createFakeGitLab(initial?: Db, persist = false) {
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

  /** Apply a merge request's branch changes to its target branch. */
  const merge = (pid: number, iid: number) => {
    const mr = db.mrs.find((x) => x.project_id === pid && x.iid === iid);
    if (!mr || mr.state !== 'opened') return;
    for (const c of db.changes[`${pid}:${mr.source_branch}`] ?? []) {
      const key = `${pid}:${mr.target_branch}:${c.path}`;
      if (c.content === null) delete db.files[key];
      else db.files[key] = c.content;
    }
    for (const c of db.commits) if (c.project_id === pid && c.branch === mr.source_branch) c.branch = mr.target_branch;
    mr.state = 'merged';
    save();
  };
  const maybeAutoMerge = (mr: FakeMr) => {
    if (mr.autoMerge && mr.state === 'opened' && Date.now() - mr.created > 30000) merge(mr.project_id, mr.iid);
  };
  const mrJson = (mr: FakeMr) => ({ ...mr, description: mr.description });

  const wikiKey = (kind: string, idOrPath: string): string | null => {
    const dec = decodeURIComponent(idOrPath);
    if (kind === 'projects') {
      const p = proj(idOrPath);
      return p ? `project:${p.id}` : null;
    }
    const g = db.groups.find((x) => String(x.id) === dec || x.full_path === dec);
    return g ? `group:${g.id}` : null;
  };

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

    // ---------- wikis (project or group) ----------
    if ((m = path.match(/^\/(projects|groups)\/([^/]+)\/wikis(?:\/(.+))?$/))) {
      const key = wikiKey(m[1], m[2]);
      if (!key) return json({ message: '404 Not Found' }, 404);
      const pages = (db.wikis[key] ??= []);
      const slug = m[3] ? decodeURIComponent(m[3]) : undefined;
      if (!slug && method === 'GET') {
        const withContent = q.get('with_content') === '1' || q.get('with_content') === 'true';
        return json(pages.map((p) => ({ slug: p.slug, title: p.title, format: 'markdown', ...(withContent ? { content: p.content } : {}) })));
      }
      if (!slug && method === 'POST') {
        const s = String(body.title).trim().replace(/\s+/g, '-');
        if (pages.some((p) => p.slug === s)) return json({ message: 'Duplicate page' }, 400);
        const pg = { slug: s, title: body.title, content: body.content };
        pages.push(pg);
        save();
        return json({ ...pg, format: 'markdown' }, 201);
      }
      const pg = pages.find((p) => p.slug === slug);
      if (!pg) return json({ message: '404 Wiki Page Not Found' }, 404);
      if (method === 'GET') return json({ ...pg, format: 'markdown' });
      if (method === 'PUT') {
        if (body.content !== undefined) pg.content = body.content;
        if (body.title !== undefined) pg.title = body.title;
        save();
        return json({ ...pg, format: 'markdown' });
      }
      if (method === 'DELETE') {
        db.wikis[key] = pages.filter((p) => p !== pg);
        save();
        return new Response(null, { status: 204 });
      }
    }

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
      return page(
        db.issues.filter(
          (i) =>
            i.project_id === p.id &&
            (state === 'all' || i.state === state) &&
            labels.every((l) => i.labels.includes(l)) &&
            (!after || i.updated_at >= after),
        ),
        q,
      );
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
        const sys: string[] = [];
        if (body.title !== undefined && body.title !== issue.title) sys.push(`changed title from **${issue.title}** to **${body.title}**`);
        if (body.description !== undefined && body.description !== issue.description) sys.push('changed the description');
        if (body.due_date !== undefined && body.due_date !== issue.due_date) sys.push(body.due_date ? `changed due date to ${body.due_date}` : 'removed due date');
        if (body.assignee_ids) sys.push(body.assignee_ids.length ? `assigned to @${db.users.find((x) => x.id === body.assignee_ids[0])?.username}` : 'removed the assignee');
        if (body.state_event === 'close' && issue.state !== 'closed') sys.push('closed');
        if (body.state_event === 'reopen' && issue.state !== 'opened') sys.push('reopened');
        db.notes[key] ??= [];
        for (const b of sys) db.notes[key].unshift({ id: ++db.seq, body: b, author: me, created_at: now, system: true });
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

    // ---------- repository ----------
    if (sub === '/repository/tree' && method === 'GET') {
      const ref = q.get('ref') ?? p.default_branch;
      const prefix = (q.get('path') ?? '').replace(/\/+$/, '');
      const blobs = Object.keys(db.files)
        .filter((k) => k.startsWith(`${p.id}:${ref}:`))
        .map((k) => k.slice(`${p.id}:${ref}:`.length))
        .filter((f) => !prefix || f.startsWith(`${prefix}/`))
        .sort()
        .map((f) => ({ id: f, name: f.split('/').pop()!, type: 'blob', path: f }));
      if (prefix && !blobs.length) return json({ message: '404 Tree Not Found' }, 404);
      return page(blobs, q);
    }
    if ((m = sub.match(/^\/repository\/files\/([^/]+)\/raw$/)) && method === 'GET') {
      const file = decodeURIComponent(m[1]);
      let ref = q.get('ref') ?? p.default_branch;
      const c = db.commits.find((x) => x.id === ref && x.project_id === p.id);
      if (c) ref = c.branch; // demo: a commit reads as its branch's current content
      const content = db.files[`${p.id}:${ref}:${file}`];
      if (content === undefined) return json({ message: '404 File Not Found' }, 404);
      return new Response(content, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (sub === '/repository/commits' && method === 'GET') {
      const ref = q.get('ref_name') ?? p.default_branch;
      const file = q.get('path');
      return json(
        db.commits
          .filter((c) => c.project_id === p.id && c.branch === ref && (!file || c.paths.includes(file)))
          .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      );
    }
    if (sub === '/repository/commits' && method === 'POST') {
      const branch: string = body.branch;
      const bkey = `${p.id}:${branch}`;
      if (!db.changes[bkey]) {
        const start = body.start_branch ?? p.default_branch;
        for (const k of Object.keys(db.files).filter((k) => k.startsWith(`${p.id}:${start}:`))) {
          db.files[`${p.id}:${branch}:${k.slice(`${p.id}:${start}:`.length)}`] = db.files[k];
        }
        db.changes[bkey] = [];
      }
      const paths: string[] = [];
      for (const a of body.actions) {
        if (a.action === 'delete' || a.action === 'move') {
          const old = a.action === 'move' ? a.previous_path : a.file_path;
          const prev = db.files[`${p.id}:${branch}:${old}`];
          delete db.files[`${p.id}:${branch}:${old}`];
          db.changes[bkey].push({ path: old, content: null });
          paths.push(old);
          if (a.action === 'move') {
            const content = a.content ?? prev ?? '';
            db.files[`${p.id}:${branch}:${a.file_path}`] = content;
            db.changes[bkey].push({ path: a.file_path, content });
            paths.push(a.file_path);
          }
        } else {
          if (a.action === 'create' && db.files[`${p.id}:${branch}:${a.file_path}`] !== undefined) {
            return json({ message: 'A file with this name already exists' }, 400);
          }
          db.files[`${p.id}:${branch}:${a.file_path}`] = a.content;
          db.changes[bkey].push({ path: a.file_path, content: a.content });
          paths.push(a.file_path);
        }
      }
      const id = `${(++db.seq).toString(16)}cafe${Date.now().toString(16)}`;
      db.commits.push({ id, short_id: id.slice(0, 8), project_id: p.id, branch, title: String(body.commit_message).split('\n')[0], author_name: me.name, created_at: now, paths });
      save();
      return json({ id }, 201);
    }
    if (sub === '/merge_requests' && method === 'POST') {
      const iid = Math.max(0, ...db.mrs.filter((x) => x.project_id === p.id).map((x) => x.iid)) + 1;
      const mr: FakeMr = {
        project_id: p.id,
        iid,
        state: 'opened',
        title: body.title,
        description: body.description ?? '',
        source_branch: body.source_branch,
        target_branch: body.target_branch,
        web_url: `${p.web_url}/-/merge_requests/${iid}`,
        created: Date.now(),
        created_at: now,
        autoMerge: true,
      };
      db.mrs.push(mr);
      save();
      return json(mrJson(mr), 201);
    }
    if (sub === '/merge_requests' && method === 'GET') {
      const state = q.get('state') ?? 'all';
      const list = db.mrs.filter((x) => x.project_id === p.id);
      list.forEach(maybeAutoMerge);
      return page(list.filter((x) => state === 'all' || x.state === state).map(mrJson), q);
    }
    if ((m = sub.match(/^\/merge_requests\/(\d+)$/))) {
      const mr = db.mrs.find((x) => x.project_id === p.id && x.iid === Number(m![1]));
      if (!mr) return json({ message: '404' }, 404);
      maybeAutoMerge(mr);
      return json(mrJson(mr));
    }
    return json({ message: `Demo does not implement ${method} ${path}` }, 404);
  };
  return { fetch: fetchFn, db, merge };
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
