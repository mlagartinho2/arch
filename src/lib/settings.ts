export interface Crew {
  name: string;
  /** Optional GitLab handle to mention when notifying the crew, e.g. "@platform/crew-payments" or "@jdoe" */
  handle?: string;
}

export interface Settings {
  /** e.g. https://gitlab.mycompany.com */
  baseUrl: string;
  /** Personal access token with `api` scope. Stored only in this browser's localStorage. */
  token: string;
  /** Project (full path) that holds all follow-up issues, e.g. "architecture/follow-ups" */
  followupsProject: string;
  /** Project (full path) holding the published standards, e.g. "architecture/standards" */
  standardsProject: string;
  /** Folder inside the standards repo where new standard documents are written */
  standardsFolder: string;
  /** Crews that must adopt standards */
  crews: Crew[];
  /** Follow-up date given to an action that has no explicit due: date */
  defaultFollowUpDays: number;
  /** Run against an in-memory fake GitLab (no token needed) */
  demo: boolean;
}

const KEY = 'arch.settings.v1';

/** The app was first called "Loose Ends". Copy its browser storage to the new keys once, so nothing is lost. */
const LEGACY_KEYS: [string, string][] = [
  ['loose-ends.settings.v1', 'arch.settings.v1'],
  ['loose-ends.capture-draft.v1', 'arch.capture-draft.v1'],
  ['loose-ends.demo-db.v1', 'arch.demo-db.v1'],
];

export function migrateLegacyStorage() {
  try {
    for (const [from, to] of LEGACY_KEYS) {
      const old = localStorage.getItem(from);
      if (old !== null && localStorage.getItem(to) === null) localStorage.setItem(to, old);
      if (old !== null) localStorage.removeItem(from);
    }
  } catch {
    /* storage unavailable: nothing to migrate */
  }
}

export const defaultSettings: Settings = {
  baseUrl: '',
  token: '',
  followupsProject: '',
  standardsProject: '',
  standardsFolder: 'standards',
  crews: [],
  defaultFollowUpDays: 7,
  demo: false,
};

export const demoSettings: Settings = {
  ...defaultSettings,
  baseUrl: 'https://gitlab.demo.local',
  token: 'demo',
  followupsProject: 'architecture/follow-ups',
  standardsProject: 'architecture/standards',
  crews: [
    { name: 'Payments', handle: '@platform/crew-payments' },
    { name: 'Onboarding', handle: '@platform/crew-onboarding' },
    { name: 'Data', handle: '@platform/crew-data' },
  ],
  demo: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...defaultSettings };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function isConfigured(s: Settings) {
  return s.demo || Boolean(s.baseUrl && s.token && s.followupsProject);
}
