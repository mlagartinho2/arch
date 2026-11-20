import { useState } from 'react';
import { GitLab } from '../lib/gitlab';
import { demoSettings, type Crew, type Settings } from '../lib/settings';
import { resetDemo } from '../lib/demo';

function crewsToText(c: Crew[]) {
  return c.map((x) => (x.handle ? `${x.name} | ${x.handle}` : x.name)).join('\n');
}
function textToCrews(t: string): Crew[] {
  return t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, handle] = l.split('|').map((s) => s.trim());
      return { name, handle: handle || undefined };
    });
}

export function SettingsView({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => void }) {
  const [s, setS] = useState<Settings>(settings.demo ? { ...settings, demo: false, token: '', baseUrl: '' } : settings);
  const [crews, setCrews] = useState(crewsToText(settings.crews));
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setS({ ...s, [k]: k === 'defaultFollowUpDays' ? Number(e.target.value) : e.target.value });

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
      <label>
        Crews that must adopt standards <span className="muted">— one per line, optional GitLab handle to notify: <code>Payments | @platform/crew-payments</code></span>
        <textarea rows={5} value={crews} onChange={(e) => setCrews(e.target.value)} />
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
          onClick={() => onSave({ ...s, crews: textToCrews(crews), demo: false })}
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
