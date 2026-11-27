// Thin GitLab REST v4 client. Browser-only: calls the API directly with a personal access token.

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface GlUser {
  id: number;
  username: string;
  name: string;
  avatar_url?: string;
}

export interface GlIssue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: 'opened' | 'closed';
  labels: string[];
  assignees: GlUser[];
  author: GlUser;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  web_url: string;
  user_notes_count: number;
}

export interface GlNote {
  id: number;
  body: string;
  author: GlUser;
  created_at: string;
  system: boolean;
}

export interface GlProject {
  id: number;
  path_with_namespace: string;
  default_branch: string;
  web_url: string;
}

export interface GlMergeRequest {
  iid: number;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  web_url: string;
  title: string;
  source_branch?: string;
  description?: string | null;
  created_at?: string;
  author?: GlUser;
}

export interface GlTreeEntry {
  id: string;
  name: string;
  type: 'tree' | 'blob';
  path: string;
}

export interface GlCommit {
  id: string;
  short_id: string;
  title: string;
  author_name: string;
  created_at: string;
  web_url?: string;
}

export interface GlWikiPage {
  slug: string;
  title: string;
  format: string;
  content?: string;
}

/** Where standards are mirrored: a project's wiki (all tiers) or a group's wiki (Premium and Ultimate). */
export interface WikiTarget {
  kind: 'project' | 'group';
  path: string;
}

export type CommitAction =
  | { action: 'create' | 'update'; file_path: string; content: string }
  | { action: 'move'; file_path: string; previous_path: string; content?: string }
  | { action: 'delete'; file_path: string };

export class GitLabError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class GitLab {
  private userCache = new Map<string, GlUser | null>();

  constructor(
    private baseUrl: string,
    private token: string,
    private fetchFn: FetchFn = (i, init) => fetch(i, init),
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async req<T>(method: string, path: string, body?: unknown, raw = false): Promise<{ data: T; headers: Headers }> {
    const res = await this.fetchFn(`${this.baseUrl}/api/v4${path}`, {
      method,
      headers: {
        'PRIVATE-TOKEN': this.token,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const j = await res.json();
        msg = typeof j.message === 'string' ? j.message : JSON.stringify(j.message ?? j.error ?? j);
      } catch {
        /* ignore */
      }
      throw new GitLabError(res.status, `${method} ${path}: ${res.status} ${msg}`);
    }
    const text = await res.text();
    if (raw) return { data: text as T, headers: res.headers };
    return { data: (text ? JSON.parse(text) : null) as T, headers: res.headers };
  }

  private get<T>(path: string) {
    return this.req<T>('GET', path).then((r) => r.data);
  }

  private async getAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let page = 1;
    const sep = path.includes('?') ? '&' : '?';
    for (let guard = 0; guard < 50; guard++) {
      const { data, headers } = await this.req<T[]>('GET', `${path}${sep}per_page=100&page=${page}`);
      out.push(...data);
      const next = headers.get('x-next-page');
      if (next) page = Number(next);
      else if (data.length === 100 && !headers.has('x-next-page')) page++;
      else break;
    }
    return out;
  }

  static pid(project: string | number) {
    return typeof project === 'number' ? String(project) : encodeURIComponent(project);
  }

  currentUser() {
    return this.get<GlUser>('/user');
  }

  project(path: string) {
    return this.get<GlProject>(`/projects/${GitLab.pid(path)}`);
  }

  async userByUsername(username: string): Promise<GlUser | null> {
    const u = username.replace(/^@/, '').toLowerCase();
    if (this.userCache.has(u)) return this.userCache.get(u)!;
    const list = await this.get<GlUser[]>(`/users?username=${encodeURIComponent(u)}`);
    const found = list[0] ?? null;
    this.userCache.set(u, found);
    return found;
  }

  projectMembers(project: string | number, query = '') {
    return this.get<GlUser[]>(
      `/projects/${GitLab.pid(project)}/members/all?per_page=20&query=${encodeURIComponent(query)}`,
    );
  }

  issues(project: string | number, params: Record<string, string>) {
    const qs = new URLSearchParams(params).toString();
    return this.getAll<GlIssue>(`/projects/${GitLab.pid(project)}/issues?${qs}`);
  }

  issue(project: string | number, iid: number) {
    return this.get<GlIssue>(`/projects/${GitLab.pid(project)}/issues/${iid}`);
  }

  createIssue(
    project: string | number,
    body: { title: string; description?: string; labels?: string; assignee_ids?: number[]; due_date?: string | null },
  ) {
    return this.req<GlIssue>('POST', `/projects/${GitLab.pid(project)}/issues`, body).then((r) => r.data);
  }

  updateIssue(project: string | number, iid: number, body: Record<string, unknown>) {
    return this.req<GlIssue>('PUT', `/projects/${GitLab.pid(project)}/issues/${iid}`, body).then((r) => r.data);
  }

  notes(project: string | number, iid: number) {
    return this.get<GlNote[]>(`/projects/${GitLab.pid(project)}/issues/${iid}/notes?sort=desc&per_page=50`);
  }

  addNote(project: string | number, iid: number, body: string) {
    return this.req<GlNote>('POST', `/projects/${GitLab.pid(project)}/issues/${iid}/notes`, { body }).then(
      (r) => r.data,
    );
  }

  linkIssues(project: string | number, iid: number, targetProjectId: number, targetIid: number) {
    return this.req('POST', `/projects/${GitLab.pid(project)}/issues/${iid}/links`, {
      target_project_id: targetProjectId,
      target_issue_iid: targetIid,
      link_type: 'relates_to',
    });
  }

  labels(project: string | number) {
    return this.getAll<{ name: string }>(`/projects/${GitLab.pid(project)}/labels`);
  }

  createLabel(project: string | number, name: string, color: string, description = '') {
    return this.req('POST', `/projects/${GitLab.pid(project)}/labels`, { name, color, description });
  }

  /** Create a branch (from start_branch) and commit files in one call. */
  commit(
    project: string | number,
    body: {
      branch: string;
      start_branch?: string;
      commit_message: string;
      actions: CommitAction[];
    },
  ) {
    return this.req('POST', `/projects/${GitLab.pid(project)}/repository/commits`, body).then((r) => r.data);
  }

  createMergeRequest(
    project: string | number,
    body: { source_branch: string; target_branch: string; title: string; description?: string; remove_source_branch?: boolean },
  ) {
    return this.req<GlMergeRequest>('POST', `/projects/${GitLab.pid(project)}/merge_requests`, body).then(
      (r) => r.data,
    );
  }

  mergeRequest(project: string | number, iid: number) {
    return this.get<GlMergeRequest>(`/projects/${GitLab.pid(project)}/merge_requests/${iid}`);
  }

  /** All open (or other `state`) merge requests of a project. */
  mergeRequests(project: string | number, state: 'opened' | 'merged' | 'all' = 'opened') {
    return this.getAll<GlMergeRequest>(`/projects/${GitLab.pid(project)}/merge_requests?state=${state}`);
  }

  // ---------- repository files ----------

  tree(project: string | number, path: string, ref?: string) {
    const q = new URLSearchParams({ path, recursive: 'true', ...(ref ? { ref } : {}) }).toString();
    return this.getAll<GlTreeEntry>(`/projects/${GitLab.pid(project)}/repository/tree?${q}`);
  }

  rawFile(project: string | number, path: string, ref: string) {
    return this.req<string>(
      'GET',
      `/projects/${GitLab.pid(project)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`,
      undefined,
      true,
    ).then((r) => r.data);
  }

  /** Commits that touched a file, newest first. */
  fileCommits(project: string | number, path: string, ref: string) {
    const q = new URLSearchParams({ path, ref_name: ref, per_page: '50' }).toString();
    return this.get<GlCommit[]>(`/projects/${GitLab.pid(project)}/repository/commits?${q}`);
  }

  // ---------- wikis (project or group) ----------

  private wikiBase(t: WikiTarget) {
    return `/${t.kind === 'group' ? 'groups' : 'projects'}/${encodeURIComponent(t.path)}/wikis`;
  }

  wikiPages(t: WikiTarget) {
    return this.get<GlWikiPage[]>(`${this.wikiBase(t)}?with_content=1`);
  }

  wikiPage(t: WikiTarget, slug: string) {
    return this.get<GlWikiPage>(`${this.wikiBase(t)}/${encodeURIComponent(slug)}`);
  }

  createWikiPage(t: WikiTarget, page: { title: string; content: string }) {
    return this.req<GlWikiPage>('POST', this.wikiBase(t), { ...page, format: 'markdown' }).then((r) => r.data);
  }

  updateWikiPage(t: WikiTarget, slug: string, page: { title: string; content: string }) {
    return this.req<GlWikiPage>('PUT', `${this.wikiBase(t)}/${encodeURIComponent(slug)}`, { ...page, format: 'markdown' }).then(
      (r) => r.data,
    );
  }

  deleteWikiPage(t: WikiTarget, slug: string) {
    return this.req('DELETE', `${this.wikiBase(t)}/${encodeURIComponent(slug)}`).then(() => undefined);
  }

  /** Web URL of a wiki page. */
  wikiUrl(t: WikiTarget, slug: string) {
    return `${this.baseUrl}/${t.kind === 'group' ? 'groups/' : ''}${t.path}/-/wikis/${slug}`;
  }

  webUrl(path: string) {
    return `${this.baseUrl}/${path.replace(/^\/+/, '')}`;
  }
}
