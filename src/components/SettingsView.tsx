import { useState } from 'react';
import { GitLab } from '../lib/gitlab';
import { DEFAULT_CATEGORIES, demoSettings, wikiTarget, type Category, type Crew, type Settings } from '../lib/settings';
import { slug } from '../lib/standards';
import { resetDemo } from '../lib/demo';

function crewsToText(c: Crew[]) {
  return c.map((x) => [x.name, x.handle ?? '', x.lead ? `@${x.lead}` : ''].join(' | ').replace(/(\s\|\s)+$/, '')).join('\n');
}
function textToCrews(t: string): Crew[] {
  return t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, handle, lead] = l.split('|').map((s) => s.trim());
      return { name, handle: handle || undefined, lead: lead ? lead.replace(/^@/, '') : undefined };
    });
}
function catsToText(c: Category[]) {
  return c.map((x) => `${x.key} | ${x.label}`).join('\n');
}
function textToCats(t: string): Category[] {
  const out = t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [a, b] = l.split('|').map((s) => s.trim());
      return { key: slug(a), label: b || a };
    })
    .filter((c) => c.key);
  return out.length ? out : DEFAULT_CATEGORIES;
}

export function SettingsView({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => void }) {
  const [s, setS] = useState<Settings>(settings.demo ? { ...settings, demo: false, token: '', baseUrl: '' } : settings);
  const [crews, setCrews] = useState(crewsToText(settings.crews));
  const [cats, setCats] = useState(catsToText(settings.categories?.length ? settings.categories : DEFAULT_CATEGORIES));
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setS({ ...s, [k]: k === 'defaultFollowUpDays' || k === 'adoptionDays' ? Number(e.target.value) : e.target.value });

  const testConnection = async () => {
    setTest(null);
    try {
      const gl = new GitLab(s.baseUrl, s.token);
      const me = await gl.currentUser();
      const p = await gl.project(s.followupsProject);
      let extra = '';
      if (s.standardsProject) {
        const sp = await gl.project(s.standardsProject);
        extra = `, standards repo ${sp.path_with_namespace} (${sp.default_branch})`;
        const t = wikiTarget(s);
        try {
          const pages = await gl.wikiPages(t);
          extra += `, ${t.kind} wiki ${t.path} (${pages.length} pages)`;
        } catch (e) {
          throw new Error(`Can't read the ${t.kind} wiki of ${t.path}: ${(e as Error).message}${t.kind === 'group' ? ' (group wikis need GitLab Premium or Ultimate)' : ' (is the wiki enabled for that project?)'}`);
        }
      }
      setTest({ ok: true, msg: `Signed in as @${me.username}. Follow-ups project ${p.path_with_namespace}${extra}.` });
    } catch (e) {
      const msg = (e as Error).message;
      setTest({
        ok: false,
        msg: msg.includes('Failed to fetch')
          ? `${msg}. Check the URL, VPN, and that your GitLab allows CORS for API calls.`
          : msg,
      });
    }
  };

  return (
    <div className="settings">
      {settings.demo && (
        <div className="banner">
          You're in demo mode with fake data. Fill in your GitLab details below to switch to the real thing.
          <button
            className="ghost xs"
            onClick={() => {
              resetDemo();
              location.reload();
            }}
          >
            Reset demo data
          </button>
        </div>
      )}
      <h3>GitLab</h3>
      <label>
        GitLab URL
        <input value={s.baseUrl} onChange={set('baseUrl')} placeholder="https://gitlab.mycompany.com" />
      </label>
      <label>
        Personal access token <span className="muted">(scope: api — stored only in this browser)</span>
        <input type="password" value={s.token} onChange={set('token')} placeholder="glpat-…" autoComplete="off" />
      </label>
      <label>
        Follow-ups project <span className="muted">(full path; every note, action, decision and standard is an issue here)</span>
        <input value={s.followupsProject} onChange={set('followupsProject')} placeholder="architecture/follow-ups" />
      </label>
      <h3>Standards</h3>
      <div className="field-row">
        <label className="grow">
          Standards repository
          <input value={s.standardsProject} onChange={set('standardsProject')} placeholder="architecture/standards" />
        </label>
        <label>
          Folder
          <input value={s.standardsFolder} onChange={set('standardsFolder')} />
        </label>
      </div>
      <div className="field-row">
        <label>
          Wiki
          <select value={s.wikiKind} onChange={(e) => setS({ ...s, wikiKind: e.target.value as 'project' | 'group' })}>
            <option value="project">Project wiki</option>
            <option value="group">Group wiki (Premium+)</option>
          </select>
        </label>
        <label className="grow">
          {s.wikiKind === 'group' ? 'Group path' : 'Project path'} <span className="muted">(empty = the standards repository)</span>
          <input value={s.wikiPath} onChange={set('wikiPath')} placeholder={s.wikiKind === 'group' ? 'architecture' : s.standardsProject || 'architecture/standards'} />
        </label>
        <label>
          Wiki folder
          <input value={s.wikiPrefix} onChange={set('wikiPrefix')} />
        </label>
      </div>
      <label>
        Categories <span className="muted">— one per line: <code>folder | Label</code></span>
        <textarea rows={4} value={cats} onChange={(e) => setCats(e.target.value)} />
      </label>
      <label>
        Teams that may adopt standards{' '}
        <span className="muted">
          — one per line: <code>Name | @team-handle | @usual-responsible</code> (handle and responsible optional)
        </span>
        <textarea rows={5} value={crews} onChange={(e) => setCrews(e.target.value)} />
      </label>
      <label className="narrow">
        Default adoption deadline (days)
        <input type="number" min={1} value={s.adoptionDays} onChange={set('adoptionDays')} />
      </label>
      <h3>Follow-ups</h3>
      <label className="narrow">
        Default follow-up for actions without a date (days)
        <input type="number" min={0} value={s.defaultFollowUpDays} onChange={set('defaultFollowUpDays')} />
      </label>
      {test && <div className={test.ok ? 'banner ok' : 'banner err'}>{test.msg}</div>}
      <div className="settings-actions">
        <button className="ghost" onClick={testConnection} disabled={!s.baseUrl || !s.token || !s.followupsProject}>
          Test connection
        </button>
        <button
          className="primary"
          disabled={!s.baseUrl || !s.token || !s.followupsProject}
          onClick={() => onSave({ ...s, crews: textToCrews(crews), categories: textToCats(cats), demo: false })}
        >
          Save & connect
        </button>
        {!settings.demo && (
          <button className="link" onClick={() => onSave({ ...demoSettings })}>
            Try it with demo data
          </button>
        )}
      </div>
    </div>
  );
}
