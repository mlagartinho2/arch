import { useEffect, useState } from 'react';
import type { GlCommit } from '../lib/gitlab';
import { categoryLabel } from '../lib/settings';
import { compareVersions, isMajorChange, type StandardStatus } from '../lib/standards';
import { adoptionCycles, type StandardEntry } from '../lib/standardsService';
import { isAdopted, isOverdue, type Item } from '../lib/model';
import { addDays } from '../lib/dates';
import { useApp, type StdPreset } from './ctx';
import { StandardEditor } from './StandardEditor';
import { Avatar, Due, Empty } from './ui';

type Mode = { kind: 'list' } | { kind: 'edit'; id?: string; status?: StandardStatus };

export function Standards({ preset }: { preset?: StdPreset }) {
  const { svc, catalog: cs, loadCatalog, go, run } = useApp();
  const [mode, setMode] = useState<Mode>(preset?.newFrom ? { kind: 'edit' } : { kind: 'list' });
  const [selected, setSelected] = useState<string | undefined>(preset?.open);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');

  useEffect(() => {
    if (svc.std.configured && !cs.catalog && !cs.loading) loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!svc.std.configured) {
    return (
      <Empty>
        Set a standards repository in <a href="#/settings" onClick={() => go('settings')}>Settings</a> to manage standards.
      </Empty>
    );
  }
  if (cs.error && !cs.catalog) return <div className="banner err">Couldn't load the standards: {cs.error}</div>;
  if (!cs.catalog) return <div className="empty">Loading standards…</div>;
  const catalog = cs.catalog;

  if (mode.kind === 'edit') {
    const entry = mode.id ? catalog.entries.find((e) => e.doc.meta.id === mode.id) : undefined;
    return (
      <StandardEditor
        entry={entry}
        presetStatus={mode.status}
        newFrom={!mode.id ? preset?.newFrom : undefined}
        onDone={(id) => {
          setMode({ kind: 'list' });
          if (id) setSelected(id);
        }}
      />
    );
  }

  const cats = svc.settings.categories;
  const behind = catalog.entries.filter((e) => e.wikiVersion !== e.doc.meta.version);
  const needle = q.trim().toLowerCase();
  const shown = catalog.entries.filter(
    (e) =>
      (cat === 'all' || e.doc.meta.category === cat) &&
      (!needle || `${e.doc.meta.title} ${e.doc.meta.id} ${e.doc.meta.tags.join(' ')} ${e.doc.body}`.toLowerCase().includes(needle)),
  );
  const groups = [...new Set([...cats.map((c) => c.key), ...shown.map((e) => e.doc.meta.category)])]
    .map((key) => ({ key, entries: shown.filter((e) => e.doc.meta.category === key) }))
    .filter((g) => g.entries.length);
  const sel = selected ? catalog.entries.find((e) => e.doc.meta.id === selected) : undefined;
  const usedCats = new Set(catalog.entries.map((e) => e.doc.meta.category));

  return (
    <div className={`std-layout ${sel ? 'with-detail' : ''}`}>
      <div className="std-list">
        <div className="toolbar">
          <input className="search" placeholder="Search standards…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted small">
            {catalog.entries.length} standards · {catalog.project.path_with_namespace}
          </span>
          <button className="ghost sm" title={`Loaded ${catalog.loadedAt.toLocaleTimeString()}`} onClick={() => run('Standards reloaded', () => loadCatalog(true))}>
            ↻
          </button>
          <button className="primary sm" onClick={() => setMode({ kind: 'edit' })}>
            + New standard
          </button>
        </div>
        <div className="cat-chips">
          <button className={`chip-btn ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>
            All
          </button>
          {[...new Set([...cats.map((c) => c.key), ...usedCats])].map((k) => (
            <button key={k} className={`chip-btn ${cat === k ? 'on' : ''}`} onClick={() => setCat(k)}>
              {categoryLabel(svc.settings, k)} <span className="count">{catalog.entries.filter((e) => e.doc.meta.category === k).length}</span>
            </button>
          ))}
        </div>

        {catalog.wikiError && (
          <div className="banner err inline">
            Couldn't read the wiki ({catalog.wikiError}). Check the wiki settings, and that the wiki is enabled.
          </div>
        )}
        {!catalog.wikiError && behind.length > 0 && (
          <div className="banner inline">
            {behind.length} standard{behind.length === 1 ? ' is' : 's are'} newer than the wiki: {behind.map((e) => e.doc.meta.title).join(', ')}.
            <button className="primary xs" onClick={() => run('Published to the wiki', () => svc.std.publish(catalog, behind).then(() => loadCatalog(true)))}>
              Publish to wiki
            </button>
          </div>
        )}

        {catalog.newProposals.length > 0 && (
          <section className="section">
            <header>
              <h3>
                Proposed <span className="count">{catalog.newProposals.length}</span>
              </h3>
              <span className="muted small">New standards in review</span>
            </header>
            <div className="list">
              {catalog.newProposals.map((p) => (
                <a className="row" key={p.mr.iid} href={p.mr.web_url} target="_blank" rel="noreferrer">
                  <div className="row-main">
                    <div className="row-title">{p.title}</div>
                    <div className="row-meta">
                      <span className="ref">!{p.mr.iid}</span>
                      <span className="pill warn">in review</span>
                    </div>
                  </div>
                  <span className="ver">v{p.version}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {!groups.length && <Empty>{needle || cat !== 'all' ? 'No standards match.' : 'No standards yet. Click “New standard” to propose the first one.'}</Empty>}
        {groups.map((g) => (
          <section className="section" key={g.key}>
            <header>
              <h3>
                {categoryLabel(svc.settings, g.key)} <span className="count">{g.entries.length}</span>
              </h3>
            </header>
            <div className="list">
              {g.entries.map((e) => (
                <StdRow key={e.doc.meta.id} entry={e} active={e.doc.meta.id === selected} onClick={() => setSelected(e.doc.meta.id)} />
              ))}
            </div>
          </section>
        ))}
      </div>
      {sel && (
        <StdDetail
          entry={sel}
          onClose={() => setSelected(undefined)}
          onChange={(status) => setMode({ kind: 'edit', id: sel.doc.meta.id, status })}
        />
      )}
    </div>
  );
}

function cycleSummary(items: Item[], id: string, today: string) {
  const c = adoptionCycles(items, id)[0];
  if (!c) return null;
  const overdue = c.issues.filter((i) => i.open && isOverdue(i, today)).length;
  return { version: c.version, text: `${c.adopted}/${c.active} adopted`, overdue };
}

function WikiState({ entry }: { entry: StandardEntry }) {
  if (entry.wikiVersion === entry.doc.meta.version) return <span className="wiki ok">wiki ✓</span>;
  if (!entry.wikiVersion) return <span className="wiki warn">not on wiki</span>;
  return <span className="wiki warn">wiki v{entry.wikiVersion}</span>;
}

function StdRow({ entry, active, onClick }: { entry: StandardEntry; active: boolean; onClick: () => void }) {
  const { items, today } = useApp();
  const m = entry.doc.meta;
  const cyc = cycleSummary(items, m.id, today);
  return (
    <div className={`row ${active ? 'row-active' : ''} ${m.status === 'deprecated' ? 'row-dep' : ''}`} onClick={onClick} role="button" tabIndex={0}>
      <div className="row-main">
        <div className="row-title">{m.title}</div>
        <div className="row-meta">
          <span className="ref">{m.id}</span>
          {m.tags.length > 0 && <span className="muted">{m.tags.join(', ')}</span>}
          {m.status === 'deprecated' && <span className="pill">deprecated</span>}
          {entry.proposals.map((p) => (
            <span key={p.mr.iid} className="pill warn">
              v{p.version} in review
            </span>
          ))}
          {cyc && (
            <span className={cyc.overdue ? 'err' : 'muted'}>
              adoption v{cyc.version}: {cyc.text}
              {cyc.overdue ? ` · ${cyc.overdue} overdue` : ''}
            </span>
          )}
        </div>
      </div>
      <WikiState entry={entry} />
      <span className="ver">v{m.version}</span>
    </div>
  );
}

function StdDetail({ entry, onClose, onChange }: { entry: StandardEntry; onClose: () => void; onChange: (status?: StandardStatus) => void }) {
  const { svc, items, today, userMap, openItem, run, loadCatalog, catalog } = useApp();
  const [cycleOpen, setCycleOpen] = useState(false);
  const [commits, setCommits] = useState<GlCommit[] | null>(null);
  const m = entry.doc.meta;
  const cycles = adoptionCycles(items, m.id);
  const latest = cycles[0]?.version;
  const suggest =
    m.status === 'active' && (!latest ? true : compareVersions(m.version, latest) > 0 && isMajorChange(latest, m.version));
  // Every configured team already has a live issue (open or adopted) for the current version.
  const current = cycles.find((c) => c.version === m.version);
  const allCovered =
    svc.settings.crews.length > 0 &&
    svc.settings.crews.every((t) => current?.issues.some((i) => i.adoption!.team === t.name && !i.adoption!.outcome));

  useEffect(() => {
    setCycleOpen(false);
    setCommits(null);
  }, [m.id]);

  return (
    <aside className="std-detail">
      <header className="drawer-head">
        <span className="kind kind-standard">{categoryLabel(svc.settings, m.category)}</span>
        <span className="ver">v{m.version}</span>
        {m.status === 'deprecated' && <span className="pill">deprecated</span>}
        <button className="ghost close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <h2 className="std-title">{m.title}</h2>
      <div className="std-meta">
        {m.owner && (
          <span>
            <Avatar user={userMap.get(m.owner) ?? { id: 0, username: m.owner, name: m.owner }} size={18} /> {userMap.get(m.owner)?.name ?? `@${m.owner}`}
          </span>
        )}
        {m.updated && <span className="muted">updated {m.updated}</span>}
        {m.tags.length > 0 && <span className="muted">{m.tags.join(', ')}</span>}
      </div>
      <div className="std-links">
        {entry.wikiVersion ? (
          <a href={entry.wikiUrl} target="_blank" rel="noreferrer">
            Wiki ↗
          </a>
        ) : (
          <span className="muted">Wiki</span>
        )}
        <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
          Source ↗
        </a>
        <a href={entry.historyUrl} target="_blank" rel="noreferrer">
          History ↗
        </a>
      </div>

      <div className="box">
        <h4>
          Wiki <WikiState entry={entry} />
        </h4>
        {entry.wikiVersion === m.version ? (
          <div className="muted small">The wiki shows the current version.</div>
        ) : (
          <div className="box-actions">
            <span className="muted small">
              {entry.wikiVersion ? `The wiki still shows v${entry.wikiVersion}.` : 'This standard is not on the wiki yet.'}
            </span>
            <button
              className="primary sm"
              onClick={() => run(`v${m.version} published to the wiki`, () => svc.std.publish(catalog.catalog!, [entry]).then(() => loadCatalog(true)))}
            >
              Publish v{m.version}
            </button>
          </div>
        )}
      </div>

      <div className="box">
        <h4>Changes</h4>
        {entry.proposals.length ? (
          entry.proposals.map((p) => (
            <div className="small" key={p.mr.iid}>
              <a href={p.mr.web_url} target="_blank" rel="noreferrer">
                !{p.mr.iid} {p.title}
              </a>{' '}
              <span className="pill warn">in review</span>
            </div>
          ))
        ) : (
          <div className="muted small">No change in review.</div>
        )}
        <div className="box-actions">
          <span className="muted small">Changes go through a merge request in the standards repository.</span>
          <span className="btns">
            {m.status === 'active' && (
              <button className="ghost sm" onClick={() => onChange('deprecated')}>
                Deprecate…
              </button>
            )}
            <button className="primary sm" onClick={() => onChange()}>
              Propose change
            </button>
          </span>
        </div>
      </div>

      <div className="box">
        <h4>Adoption</h4>
        {!cycles.length && <div className="muted small">No adoption cycle yet. Adoption is optional.</div>}
        {suggest && latest && (
          <div className="hint-box">
            v{m.version} is a major change from v{latest}: teams should probably adopt it.
          </div>
        )}
        {cycles.map((c) => (
          <div className="cycle" key={c.version}>
            <div className="cycle-head">
              <b>v{c.version}</b>
              <span className="muted small">
                {c.adopted}/{c.active} adopted
              </span>
            </div>
            {c.issues.map((i) => (
              <div className="cycle-row" key={i.iid} onClick={() => openItem(i)} role="button" tabIndex={0}>
                <span className="cycle-team">{i.adoption!.team}</span>
                <Avatar user={i.assignee} size={18} />
                <span className="muted small grow">{i.assignee?.name}</span>
                {i.open ? <Due item={i} today={today} /> : null}
                <span className={`pill ${isAdopted(i) ? 'ok' : i.open ? '' : 'muted-pill'}`}>
                  {isAdopted(i) ? 'adopted' : i.open ? 'open' : i.adoption!.outcome ?? 'closed'}
                </span>
              </div>
            ))}
          </div>
        ))}
        {m.status === 'active' && allCovered && <div className="muted small">Every team is in the v{m.version} cycle.</div>}
        {m.status === 'active' &&
          !allCovered &&
          (cycleOpen ? (
            <CycleForm entry={entry} onDone={() => setCycleOpen(false)} />
          ) : (
            <div className="box-actions">
              <span className="muted small">One GitLab issue per team, assigned to its responsible person.</span>
              <button className={suggest ? 'primary sm' : 'ghost sm'} onClick={() => setCycleOpen(true)}>
                Start adoption of v{m.version}…
              </button>
            </div>
          ))}
      </div>

      <div className="box">
        <h4>
          Versions
          {commits === null && (
            <button className="link small" onClick={() => svc.std.history(catalog.catalog!, entry).then(setCommits).catch(() => setCommits([]))}>
              Show commits
            </button>
          )}
        </h4>
        <table className="changelog">
          <tbody>
            {entry.doc.changelog.map((c) => (
              <tr key={c.version}>
                <td className="ver-cell">v{c.version}</td>
                <td className="muted small nowrap">{c.date}</td>
                <td className="small">{c.change}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {commits && (
          <div className="commits">
            {commits.map((c) => (
              <div className="small" key={c.id}>
                <span className="ref">{c.short_id}</span> {c.title} <span className="muted">· {c.author_name} · {c.created_at.slice(0, 10)}</span>
              </div>
            ))}
            {!commits.length && <div className="muted small">No commits found.</div>}
          </div>
        )}
      </div>

      <div className="box">
        <h4>Content</h4>
        <pre className="desc">{entry.doc.body}</pre>
      </div>
    </aside>
  );
}

function CycleForm({ entry, onDone }: { entry: StandardEntry; onDone: () => void }) {
  const { svc, items, today, run, reload, toast, go } = useApp();
  const crews = svc.settings.crews;
  const due0 = addDays(today, svc.settings.adoptionDays || 30);
  const [rows, setRows] = useState(() =>
    crews.map((c) => {
      const open = items.some((i) => i.open && i.adoption?.std === entry.doc.meta.id && i.adoption.team === c.name && i.adoption.version === entry.doc.meta.version);
      return { team: c.name, on: !open, responsible: c.lead ?? '', due: due0, already: open };
    }),
  );
  const [supersede, setSupersede] = useState(true);
  const chosen = rows.filter((r) => r.on && !r.already);
  const missing = chosen.filter((r) => !r.responsible.trim());

  if (!crews.length) {
    return (
      <div className="muted small">
        Add your teams (with their usual responsible person) in <a href="#/settings" onClick={() => go('settings')}>Settings</a> first.
      </div>
    );
  }
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <div className="cycle-form">
      <div className="cycle-grid">
        <span className="muted small">Team</span>
        <span className="muted small">Responsible</span>
        <span className="muted small">Adopt by</span>
        {rows.map((r, i) => (
          <div className="cycle-grid-row" key={r.team}>
            <label className="crew-row">
              <input type="checkbox" checked={r.on && !r.already} disabled={r.already} onChange={() => set(i, { on: !r.on })} />
              {r.team}
            </label>
            {r.already ? (
              <span className="muted small span2">already has an open issue for v{entry.doc.meta.version}</span>
            ) : (
              <>
                <input list="users" value={r.responsible} onChange={(e) => set(i, { responsible: e.target.value.replace(/^@/, '') })} placeholder="username" disabled={!r.on} />
                <input type="date" value={r.due} onChange={(e) => set(i, { due: e.target.value })} disabled={!r.on} />
              </>
            )}
          </div>
        ))}
      </div>
      <label className="crew-row small">
        <input type="checkbox" checked={supersede} onChange={() => setSupersede(!supersede)} />
        Close open issues for older versions of this standard as superseded
      </label>
      <div className="box-actions">
        <button className="ghost sm" onClick={onDone}>
          Cancel
        </button>
        <button
          className="primary sm"
          disabled={!chosen.length || missing.length > 0}
          title={missing.length ? 'Every selected team needs a responsible person' : ''}
          onClick={async () => {
            const r = await run('', () => svc.std.startCycle(entry, chosen, items, { supersede }));
            if (!r) return;
            await reload();
            toast(`${r.created.length} adoption issue${r.created.length === 1 ? '' : 's'} created`);
            if (r.errors.length) toast(`Not created: ${r.errors.join('; ')}`, 'err');
            onDone();
          }}
        >
          Create {chosen.length} issue{chosen.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}
