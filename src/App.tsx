import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitLab } from './lib/gitlab';
import { createFakeGitLab } from './lib/demo';
import { Service } from './lib/service';
import { isConfigured, loadSettings, saveSettings, type Settings } from './lib/settings';
import { UPDATE_LABEL, isMine, isOverdue, isTrackable, isWaiting, updateProblem, type Item } from './lib/model';
import type { GlUser } from './lib/gitlab';
import { parseLine, parseUpdate, updateNote } from './lib/parser';
import { humanDue, todayIso } from './lib/dates';
import { AppCtx, useApp as useAppSafe, type CatalogState, type Ctx, type FullFocus, type PrepPreset, type StdPreset, type View } from './components/ctx';
import { Capture } from './components/Capture';
import { Prepare } from './components/Prepare';
import { QuickLook } from './components/QuickLook';
import { ItemScreen } from './components/ItemScreen';
import { SettingsView } from './components/SettingsView';
import { DecisionsView, FocusView, MeetingsView, MineView, WaitingView } from './components/Views';
import { Standards } from './components/Standards';
import { KindTag } from './components/ui';
import { ArchMark } from './components/ArchMark';

const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'focus', label: 'Focus', icon: '◎' },
  { id: 'prepare', label: 'Prepare meeting', icon: '✎' },
  { id: 'mine', label: 'My actions', icon: '☐' },
  { id: 'waiting', label: 'Waiting on others', icon: '⧗' },
  { id: 'standards', label: 'Standards', icon: '▤' },
  { id: 'decisions', label: 'Decision log', icon: '◆' },
  { id: 'meetings', label: 'Meetings', icon: '☰' },
];

const TITLES: Record<View, string> = {
  focus: 'Focus',
  mine: 'My actions',
  waiting: 'Waiting on others',
  standards: 'Standards',
  decisions: 'Decision log',
  meetings: 'Meetings',
  capture: 'Capture meeting notes',
  prepare: 'Prepare a meeting',
  settings: 'Settings',
};

function viewFromHash(fallback: View = 'focus'): View {
  const h = location.hash.replace('#/', '') as View;
  return h in TITLES ? h : itemFromHash() ? fallback : 'focus';
}

/** "#/item/12" → 12 */
function itemFromHash(): number | null {
  const m = location.hash.match(/^#\/item\/(\d+)/);
  return m ? Number(m[1]) : null;
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el instanceof HTMLInputElement) return !/^(checkbox|radio|button|submit)$/.test(el.type);
  return el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName);
};

function makeService(s: Settings) {
  if (s.demo) {
    const fake = createFakeGitLab(undefined, true);
    // Demo mode only: lets a tester change "GitLab" behind the app's back (e.g. to try the edit-conflict banner).
    (window as unknown as { __archDemo?: unknown }).__archDemo = fake;
    return new Service(new GitLab(s.baseUrl, s.token, fake.fetch), s);
  }
  return new Service(new GitLab(s.baseUrl, s.token), s);
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [view, setView] = useState<View>(viewFromHash);
  const svc = useMemo(() => (isConfigured(settings) ? makeService(settings) : null), [settings]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [nav, setNav] = useState<number[]>([]);
  const [full, setFull] = useState<{ iid: number; focus?: FullFocus } | null>(() => {
    const iid = itemFromHash();
    return iid ? { iid } : null;
  });
  const [prepPreset, setPrepPreset] = useState<{ id: number; preset?: PrepPreset }>({ id: 0 });
  const [stdPreset, setStdPreset] = useState<{ id: number; preset?: StdPreset }>({ id: 0 });
  const [catalog, setCatalog] = useState<CatalogState>({ loading: false });
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: 'ok' | 'err' }[]>([]);
  const [busy, setBusy] = useState(0);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const today = todayIso();

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 8000 : 2500);
  }, []);

  const loadCatalog = useCallback(
    async (force = false) => {
      if (!svc || !svc.std.configured) return;
      if (!force && catalog.catalog) return;
      setCatalog((c) => ({ ...c, loading: true, error: undefined }));
      try {
        const cat = await svc.std.loadCatalog();
        setCatalog({ catalog: cat, loading: false });
      } catch (e) {
        setCatalog((c) => ({ ...c, loading: false, error: (e as Error).message }));
        throw e;
      }
    },
    [svc, catalog.catalog],
  );

  useEffect(() => setCatalog({ loading: false }), [svc]);

  const reload = useCallback(async () => {
    if (!svc) return;
    setItems(await svc.loadItems());
    setLoadedAt(new Date());
  }, [svc]);

  useEffect(() => {
    if (!svc) return;
    setStatus('loading');
    svc
      .init()
      .then(reload)
      .then(() => setStatus('ready'))
      .catch((e) => {
        setError((e as Error).message);
        setStatus('error');
      });
  }, [svc, reload]);

  useEffect(() => {
    const onHash = () => {
      const iid = itemFromHash();
      setFull((f) => (iid ? (f?.iid === iid ? f : { iid }) : null));
      setView((v) => viewFromHash(v));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((v: View) => {
    location.hash = `#/${v}`;
    setView(v);
    setFull(null);
    if (v === 'capture') setSelected(null);
  }, []);

  const openFull = useCallback((iid: number, focus?: FullFocus) => {
    setFull({ iid, focus });
    if (location.hash !== `#/item/${iid}`) location.hash = `#/item/${iid}`;
  }, []);
  const closeFull = useCallback(() => {
    setFull(null);
    location.hash = `#/${view}`;
  }, [view]);

  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>) => {
      setBusy((b) => b + 1);
      try {
        const r = await fn();
        if (label) toast(label);
        return r;
      } catch (e) {
        toast((e as Error).message, 'err');
        return undefined;
      } finally {
        setBusy((b) => b - 1);
      }
    },
    [toast],
  );

  const upsert = useCallback((it: Item | null | undefined) => {
    if (!it) return;
    setItems((list) => (list.some((x) => x.iid === it.iid) ? list.map((x) => (x.iid === it.iid ? it : x)) : [...list, it]));
  }, []);

  const me = status === 'ready' && svc ? svc.me.username : '';
  const users = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => {
      if (i.assignee) s.add(i.assignee.username);
      s.add(i.author.username);
    });
    return [...s].sort();
  }, [items]);
  const userMap = useMemo(() => {
    const m = new Map<string, GlUser>();
    if (svc && status === 'ready') m.set(svc.me.username, svc.me);
    items.forEach((i) => {
      if (i.assignee) m.set(i.assignee.username, i.assignee);
      m.set(i.author.username, i.author);
    });
    return m;
  }, [items, svc, status]);

  const ctx: Ctx | null =
    svc && status === 'ready'
      ? {
          svc,
          items,
          today,
          me,
          users,
          userMap,
          openItem: (it, list) => {
            setSelected(typeof it === 'number' ? it : it.iid);
            if (list) setNav(list);
          },
          openFull,
          selected: selected ?? undefined,
          upsert,
          reload,
          toast,
          go,
          run,
          catalog,
          loadCatalog: (force) => loadCatalog(force).catch(() => undefined),
          standards: (preset) => {
            setStdPreset((p) => ({ id: p.id + 1, preset }));
            setSelected(null);
            go('standards');
          },
          prepare: (preset) => {
            setPrepPreset((p) => ({ id: p.id + 1, preset }));
            setSelected(null);
            go('prepare');
          },
        }
      : null;

  const saveAndApply = (s: Settings) => {
    saveSettings(s);
    setSettings(s);
    go('focus');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (full || view === 'capture' || document.querySelector('.fs')) return; // full-screen editors handle their own keys
      if (e.key === 'Escape') setSelected(null);
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (selected !== null) {
        const k = nav.indexOf(selected);
        const open = (focus?: FullFocus) => {
          e.preventDefault(); // or the key would be typed into the editor that opens
          openFull(selected, focus);
        };
        if (e.key === 'Enter' && !(e.target as HTMLElement).closest?.('button, a, .row')) return open();
        if (e.key === 'e' || e.key === 'E') return open('desc');
        if (e.key === 'c' || e.key === 'C') return open('comment');
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && k >= 0) {
          e.preventDefault();
          const n = nav[k + (e.key === 'ArrowDown' ? 1 : -1)];
          if (n !== undefined) {
            setSelected(n);
            document.querySelector<HTMLElement>(`.row[data-iid="${n}"]`)?.scrollIntoView({ block: 'nearest' });
          }
          return;
        }
      }
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('quickadd')?.focus();
      }
      if (e.key === 'n') {
        e.preventDefault(); // or the n would land in the meeting title
        go('capture');
      }
      if (e.key === 'p') {
        e.preventDefault();
        setPrepPreset((p) => ({ id: p.id + 1 }));
        go('prepare');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, full, view, selected, nav, openFull]);

  if (!svc || view === 'settings' || status === 'error') {
    return (
      <div className="setup">
        <div className="setup-card">
          <h1>
            <ArchMark size={34} />
            Arch <span className="muted">— follow-ups, decisions & standards on GitLab</span>
          </h1>
          {status === 'error' && <div className="banner err">Couldn't connect: {error}</div>}
          <SettingsView settings={settings} onSave={saveAndApply} />
          {svc && status !== 'error' && (
            <button className="link" onClick={() => go('focus')}>
              ← Back
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!ctx) return <div className="loading">Connecting to GitLab…</div>;

  const open = items.filter(isTrackable);
  const counts: Partial<Record<View, number>> = {
    focus: open.filter((i) => isOverdue(i, today) || i.due === today).length,
    mine: open.filter((i) => isMine(i, me)).length,
    waiting: open.filter((i) => isWaiting(i, me)).length,
    standards: items.filter((i) => i.kind === 'adoption' && i.open).length,
  };
  const sel = selected !== null ? items.find((i) => i.iid === selected) : undefined;

  return (
    <AppCtx.Provider value={ctx}>
      <div className={`app ${sel && !full ? 'with-drawer' : ''}`}>
        <nav className="nav">
          <div className="brand">
            <ArchMark size={26} />
            Arch
            {settings.demo && <span className="demo-tag">demo</span>}
          </div>
          <button className="primary capture-btn" onClick={() => go('capture')}>
            + Meeting notes <kbd>n</kbd>
          </button>
          {VIEWS.map((v) => (
            <button key={v.id} className={`nav-item ${view === v.id ? 'active' : ''}`} onClick={() => (v.id === 'prepare' ? ctx.prepare() : v.id === 'standards' ? ctx.standards() : go(v.id))}>
              <span className="nav-icon">{v.icon}</span>
              {v.label}
              {counts[v.id] ? <span className={`nav-count ${v.id === 'focus' ? 'alert' : ''}`}>{counts[v.id]}</span> : null}
            </button>
          ))}
          <div className="nav-foot">
            <button className="nav-item" onClick={() => go('settings')}>
              <span className="nav-icon">⚙</span>Settings
            </button>
            <div className="muted small">
              @{me} · {svc.project.path_with_namespace}
            </div>
          </div>
        </nav>

        <main className="main">
          <header className="topbar">
            <h2>{TITLES[view]}</h2>
            <QuickAdd />
            <button
              className="ghost"
              title={loadedAt ? `Loaded ${loadedAt.toLocaleTimeString()}` : ''}
              onClick={() => run('Refreshed', reload)}
            >
              ↻
            </button>
            {busy > 0 && <span className="spinner" />}
          </header>
          {svc.missingLabels.length > 0 && (
            <div className="banner">
              The follow-ups project is missing {svc.missingLabels.length} label(s) this app uses.
              <button
                className="primary xs"
                onClick={async () => {
                  await run('Labels created', () => svc.ensureLabels());
                  setItems([...items]);
                }}
              >
                Create labels
              </button>
            </div>
          )}
          <div className="content">
            {view === 'focus' && <FocusView />}
            {view === 'mine' && <MineView />}
            {view === 'waiting' && <WaitingView />}
            {view === 'decisions' && <DecisionsView />}
            {view === 'standards' && <Standards key={stdPreset.id} preset={stdPreset.preset} />}
            {view === 'meetings' && <MeetingsView />}
            {view === 'capture' && <Capture />}
            {view === 'prepare' && <Prepare key={prepPreset.id} preset={prepPreset.preset} />}
          </div>
        </main>

        {sel && !full && <QuickLook item={sel} onClose={() => setSelected(null)} />}
        {full && (
          <ItemScreen
            key={full.iid + (full.focus ?? '')}
            iid={full.iid}
            focus={full.focus}
            nav={nav.includes(full.iid) ? nav : [full.iid]}
            backLabel={TITLES[view]}
            onClose={closeFull}
          />
        )}
        <datalist id="users">
          {users.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>
              {t.msg}
            </div>
          ))}
        </div>
      </div>
    </AppCtx.Provider>
  );
}

function QuickAdd() {
  const { svc, today, me, run, upsert, openItem, items, toast } = useAppSafe();
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const opts = { today, me, defaultFollowUpDays: svc.settings.defaultFollowUpDays };
  const update = text.trim() ? parseUpdate(text, opts) : null;
  const parsed = text.trim() && !update ? parseLine(text, opts) ?? parseLine(`TODO: ${text}`, opts) : null;
  const target = update ? items.find((i) => i.iid === update.iid) : undefined;
  const problem = update ? updateProblem(update, target) : null;

  const submit = async () => {
    if (update) {
      if (problem?.level === 'err') return;
      const r = await run('', () => svc.applyUpdate(update));
      if (r) {
        upsert(r.item);
        toast(`#${update.iid} ${r.summary}`);
        setText('');
        openItem(r.item);
      }
      return;
    }
    if (!parsed) return;
    const it = await run('Added', () => svc.createItem(parsed));
    if (it) {
      upsert(it);
      setText('');
      openItem(it);
    }
  };

  return (
    <div className="quickadd">
      <input
        id="quickadd"
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') {
            setText('');
            ref.current?.blur();
          }
        }}
        placeholder="Quick add — ACTION @anna: send C4 diagrams due:fri · DONE #7 · PUSH #7 due:mon   ( / )"
      />
      {update && (
        <div className="quickadd-preview">
          <span className={`op op-${update.op}`}>{UPDATE_LABEL[update.op]}</span> <span className="ref">#{update.iid}</span> {target?.title ?? ''}
          {update.due && <span className="muted"> · follow-up {humanDue(update.due, today)}</span>}
          {update.assignee && <span className="muted"> · → @{update.assignee}</span>}
          {updateNote(update.text, target?.title) && <span className="muted"> · “{updateNote(update.text, target?.title)}”</span>}
          {problem ? <span className={problem.level === 'err' ? 'err' : 'muted'}> · {problem.msg}</span> : <span className="muted"> · Enter</span>}
        </div>
      )}
      {parsed && (
        <div className="quickadd-preview">
          <KindTag kind={parsed.type} /> {parsed.title}
          {parsed.type !== 'decision' && <span className="muted"> → {parsed.assignee ? `@${parsed.assignee}` : 'me'}</span>}
          {parsed.due && <span className="muted"> · {humanDue(parsed.due, today)}</span>}
          <span className="muted"> · Enter</span>
        </div>
      )}
    </div>
  );
}
