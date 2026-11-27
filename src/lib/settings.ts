/** A team (crew) that may have to adopt standards. */
export interface Crew {
  name: string;
  /** Optional GitLab handle of the team, e.g. "@platform/crew-payments", shown on its adoption issues */
  handle?: string;
  /** GitLab username of the person usually responsible for adoption in this team (pre-fills adoption cycles) */
  lead?: string;
}

/** A category of standards. `key` is the folder name in the repo and the wiki; `label` is what people see. */
export interface Category {
  key: string;
  label: string;
}

export const DEFAULT_CATEGORIES: Category[] = [
  { key: 'api', label: 'API' },
  { key: 'react', label: 'React' },
  { key: 'devops', label: 'DevOps' },
  { key: 'security', label: 'Security & vulnerabilities' },
  { key: 'architecture', label: 'Architecture' },
  { key: 'data', label: 'Data' },
];

export interface Settings {
  /** e.g. https://gitlab.mycompany.com */
  baseUrl: string;
  /** Personal access token with `api` scope. Stored only in this browser's localStorage. */
  token: string;
  /** Project (full path) that holds all follow-up issues, e.g. "architecture/follow-ups" */
  followupsProject: string;
  /** Repository (full path) holding the standard documents, e.g. "architecture/standards" */
  standardsProject: string;
  /** Folder inside the standards repo: documents live at <folder>/<category>/<id>.md */
  standardsFolder: string;
  /** Wiki that mirrors the standards: a project's (all tiers) or a group's (Premium and Ultimate). Empty path = the standards project's wiki */
  wikiKind: 'project' | 'group';
  wikiPath: string;
  /** Wiki folder for the mirrored pages; the index page lives at this slug */
  wikiPrefix: string;
  /** Categories of standards */
  categories: Category[];
  /** Teams (crews) that may have to adopt standards */
  crews: Crew[];
  /** Default deadline for a new adoption cycle, in days */
  adoptionDays: number;
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
  wikiKind: 'project',
  wikiPath: '',
  wikiPrefix: 'standards',
  categories: DEFAULT_CATEGORIES,
  crews: [],
  adoptionDays: 30,
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
    { name: 'Payments', handle: '@platform/crew-payments', lead: 'priya.nair' },
    { name: 'Onboarding', handle: '@platform/crew-onboarding', lead: 'jonas.weber' },
    { name: 'Data', handle: '@platform/crew-data', lead: 'sofia.ricci' },
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

/** The wiki standards are mirrored to; defaults to the standards project's own wiki. */
export function wikiTarget(s: Settings) {
  return { kind: s.wikiKind, path: s.wikiPath || s.standardsProject } as const;
}

export function categoryLabel(s: Settings, key: string) {
  return s.categories.find((c) => c.key === key)?.label ?? key;
}

export function isConfigured(s: Settings) {
  return s.demo || Boolean(s.baseUrl && s.token && s.followupsProject);
}
