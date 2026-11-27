import { describe, expect, it } from 'vitest';
import {
  bumpVersion,
  changesSince,
  compareVersions,
  isMajorChange,
  newStandardDoc,
  nextVersion,
  parseStandardFile,
  parseStandardPath,
  parseWikiMarker,
  renderStandardFile,
  renderWikiIndex,
  renderWikiPage,
  standardFilePath,
  wikiSlug,
} from '../src/lib/standards';
import { GitLab } from '../src/lib/gitlab';
import { Service } from '../src/lib/service';
import { adoptionCycles } from '../src/lib/standardsService';
import { createFakeGitLab, seedDb } from '../src/lib/demo';
import { demoSettings, type Settings } from '../src/lib/settings';
import { isAdopted } from '../src/lib/model';
import { addDays, todayIso } from '../src/lib/dates';

describe('versions', () => {
  it('compares and bumps', () => {
    expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0', '2.0')).toBe(0);
    expect(bumpVersion('1.4', 'minor')).toBe('1.5');
    expect(bumpVersion('1.4', 'major')).toBe('2.0');
    expect(isMajorChange('1.4', '2.0')).toBe(true);
    expect(isMajorChange('1.4', '1.5')).toBe(false);
    expect(isMajorChange(undefined, '1.0')).toBe(true);
  });
});

describe('standard file', () => {
  const doc = newStandardDoc(
    { id: 'api-errors', title: 'API errors: the "problem" format', category: 'API', tags: ['rest', 'errors'], owner: '@marco' },
    '# API errors\n\nUse problem+json.',
    '2026-11-01',
  );

  it('round-trips through the file format', () => {
    const text = renderStandardFile(doc);
    expect(text).toMatch(/^---\nid: api-errors\ntitle: "API errors: the \\"problem\\" format"\ncategory: api\ntags: \[rest, errors\]\nversion: 1\.0\nstatus: active\nowner: marco\nupdated: 2026-11-01\n---\n/);
    const back = parseStandardFile(text);
    expect(back.meta).toEqual({ ...doc.meta, category: 'api' });
    expect(doc.meta.owner).toBe('marco');
    expect(back.body).toBe(doc.body);
    expect(back.changelog).toEqual([{ version: '1.0', date: '2026-11-01', change: 'Initial version' }]);
  });

  it('versions a change and keeps the changelog newest first, with pipes escaped', () => {
    let d = nextVersion(doc, { kind: 'minor', note: 'Clarify `errors[]` | field list', date: '2026-11-10' });
    d = nextVersion(d, { kind: 'major', note: 'Require `instance`', date: '2026-11-20' }, { body: 'New body', meta: { status: 'active' } });
    expect(d.meta.version).toBe('2.0');
    expect(d.meta.updated).toBe('2026-11-20');
    const back = parseStandardFile(renderStandardFile(d));
    expect(back.changelog.map((c) => [c.version, c.change])).toEqual([
      ['2.0', 'Require `instance`'],
      ['1.1', 'Clarify `errors[]` | field list'],
      ['1.0', 'Initial version'],
    ]);
    expect(back.body).toBe('New body');
    expect(changesSince(back, '1.0').map((c) => c.version)).toEqual(['2.0', '1.1']);
    expect(changesSince(back, '1.1', '1.1')).toEqual([]);
  });

  it('is lenient with hand-written files', () => {
    const d = parseStandardFile('# Just markdown\n\nNo front matter.', { id: 'x', category: 'react' });
    expect(d.meta).toMatchObject({ id: 'x', title: 'x', category: 'react', version: '1.0', status: 'active', tags: [] });
    expect(parseStandardFile('---\ntitle: T\nversion: 3.2\nstatus: deprecated\ntags: a, b\n---\nBody').meta).toMatchObject({
      version: '3.2',
      status: 'deprecated',
      tags: ['a', 'b'],
    });
  });

  it('maps paths and wiki slugs', () => {
    expect(standardFilePath('standards/', 'Dev Ops', 'image-baseline')).toBe('standards/dev-ops/image-baseline.md');
    expect(parseStandardPath('standards', 'standards/api/api-errors.md')).toEqual({ category: 'api', id: 'api-errors' });
    expect(parseStandardPath('standards', 'standards/README.md')).toBeNull();
    expect(parseStandardPath('standards', 'other/api/x.md')).toBeNull();
    expect(wikiSlug('/standards/', 'api', 'api-errors')).toBe('standards/api/api-errors');
  });

  it('renders the wiki page and the index', () => {
    const page = renderWikiPage(doc, { categoryLabel: 'API', sourceUrl: 'https://src', historyUrl: 'https://hist' });
    expect(parseWikiMarker(page)).toEqual({ id: 'api-errors', version: '1.0' });
    expect(page).toContain('| **Category** | API |');
    expect(page).toContain('[source file](https://src)');
    expect(page).toContain('## Changelog');
    const index = renderWikiIndex([doc], 'standards', (k) => k.toUpperCase());
    expect(index).toContain('## API');
    expect(index).toContain('| [API errors: the "problem" format](standards/api/api-errors) | 1.0 | Active | @marco | 2026-11-01 |');
  });
});

describe('standards service against fake GitLab', () => {
  const today = todayIso();
  const setup = async (settings: Partial<Settings> = {}) => {
    const fake = createFakeGitLab(seedDb(today));
    const svc = new Service(new GitLab('https://gitlab.demo.local', 't', fake.fetch), { ...demoSettings, ...settings });
    await svc.init();
    return { svc, fake, std: svc.std };
  };

  it('loads the catalog with wiki status and open proposals', async () => {
    const { std } = await setup();
    const c = await std.loadCatalog();
    expect(c.entries.map((e) => [e.doc.meta.id, e.doc.meta.version, e.wikiVersion, e.proposals.length])).toEqual([
      ['api-error-format', '1.1', '1.1', 0],
      ['container-image-baseline', '2.0', '1.0', 0],
      ['dependency-vulnerability-sla', '1.0', '1.0', 0],
      ['react-state-management', '1.0', '1.0', 1],
    ]);
    expect(c.entries[3].proposals[0]).toMatchObject({ kind: 'change', version: '1.1' });
    expect(c.entries[0].wikiUrl).toBe('https://gitlab.demo.local/architecture/standards/-/wikis/standards/api/api-error-format');
  });

  it('proposes a new standard, merges, publishes to the wiki and the index', async () => {
    const { std, fake, svc } = await setup();
    let c = await std.loadCatalog();
    const mr = await std.proposeNew(c, { title: 'Feature flags', category: 'devops', tags: ['release'], body: '# Feature flags' }, 11);
    expect(mr.title).toBe('Standard: Feature flags v1.0 (new)');
    expect(fake.db.notes['11:11'][0].body).toContain(mr.web_url);
    c = await std.loadCatalog();
    expect(c.newProposals.map((p) => p.id)).toEqual(['feature-flags']);
    await expect(std.proposeNew(c, { title: 'Feature flags', category: 'devops', tags: [], body: '' })).rejects.toThrow(/already exists or is proposed/);

    fake.merge(12, mr.iid);
    c = await std.loadCatalog();
    const e = c.entries.find((x) => x.doc.meta.id === 'feature-flags')!;
    expect(e).toMatchObject({ path: 'standards/devops/feature-flags.md', wikiVersion: undefined });
    expect(e.doc.meta.owner).toBe(svc.me.username);

    await std.publish(c, c.entries.filter((x) => x.wikiVersion !== x.doc.meta.version));
    const pages = fake.db.wikis['project:12'];
    expect(parseWikiMarker(pages.find((p) => p.slug === 'standards/devops/feature-flags')!.content)).toEqual({ id: 'feature-flags', version: '1.0' });
    expect(parseWikiMarker(pages.find((p) => p.slug === 'standards/devops/container-image-baseline')!.content)?.version).toBe('2.0');
    expect(pages.find((p) => p.slug === 'standards')!.content).toContain('[Feature flags](standards/devops/feature-flags)');
    c = await std.loadCatalog();
    expect(c.entries.every((x) => x.wikiVersion === x.doc.meta.version)).toBe(true);
  });

  it('proposes a change with a version bump, a category move and history', async () => {
    const { std, fake } = await setup();
    let c = await std.loadCatalog();
    const e = c.entries.find((x) => x.doc.meta.id === 'dependency-vulnerability-sla')!;
    await expect(std.proposeChange(c, e, { kind: 'minor', note: ' ', body: e.doc.body, meta: {} })).rejects.toThrow(/Describe the change/);
    const mr = await std.proposeChange(c, e, { kind: 'major', note: 'Critical CVEs within 48h', body: 'Critical: 48h', meta: { category: 'architecture' } });
    expect(mr.title).toBe('Standard: Dependency vulnerability SLA v2.0');
    fake.merge(12, mr.iid);
    c = await std.loadCatalog();
    const moved = c.entries.find((x) => x.doc.meta.id === 'dependency-vulnerability-sla')!;
    expect(moved).toMatchObject({ path: 'standards/architecture/dependency-vulnerability-sla.md' });
    expect(moved.doc.changelog[0]).toMatchObject({ version: '2.0', change: 'Critical CVEs within 48h' });
    await std.publish(c, [moved]);
    const slugs = fake.db.wikis['project:12'].map((p) => p.slug);
    expect(slugs).toContain('standards/architecture/dependency-vulnerability-sla');
    expect(slugs).not.toContain('standards/security/dependency-vulnerability-sla'); // old page removed
    expect((await std.history(c, moved)).map((h) => h.title)[0]).toBe('Update standard Dependency vulnerability SLA v2.0');
  });

  it('refuses a change based on a stale version', async () => {
    const { std, fake } = await setup();
    const c = await std.loadCatalog();
    const e = c.entries.find((x) => x.doc.meta.id === 'react-state-management')!;
    fake.merge(12, 1); // the open 1.1 change gets merged meanwhile
    await expect(std.proposeChange(c, e, { kind: 'minor', note: 'x', body: 'y', meta: {} })).rejects.toThrow(/changed to v1.1/);
  });

  it('starts adoption cycles: per-team issues, what changed, superseding older cycles', async () => {
    const { std, svc, fake } = await setup();
    const c = await std.loadCatalog();
    let items = await svc.loadItems();
    const api = c.entries.find((x) => x.doc.meta.id === 'api-error-format')!;
    expect(adoptionCycles(items, 'api-error-format')).toMatchObject([{ version: '1.0', adopted: 1, active: 3 }]);

    const due = addDays(today, 30);
    const r = await std.startCycle(
      api,
      [
        { team: 'Payments', responsible: 'priya.nair', due },
        { team: 'Onboarding', responsible: 'jonas.weber', due },
        { team: 'Data', responsible: 'nobody', due },
      ],
      items,
      { supersede: true },
    );
    expect(r.errors).toEqual(['Data: GitLab user @nobody not found']);
    expect(r.created.map((i) => [i.title, i.assignee?.username, i.due, i.adoption])).toEqual([
      ['Adopt "API error format (RFC 7807)" v1.1 — Payments', 'priya.nair', due, { std: 'api-error-format', version: '1.1', team: 'Payments' }],
      ['Adopt "API error format (RFC 7807)" v1.1 — Onboarding', 'jonas.weber', due, { std: 'api-error-format', version: '1.1', team: 'Onboarding' }],
    ]);
    // Payments adopted 1.0, so it only gets the 1.1 change; Onboarding never adopted, so it gets the whole standard.
    expect(r.created[0].description).toContain('- **1.1**');
    expect(r.created[0].description).not.toContain('- **1.0**');
    expect(r.created[1].description).toContain('The whole standard (first adoption by this team).');
    // Onboarding's open 1.0 issue (#14) is superseded, not adopted.
    items = await svc.loadItems();
    const old = items.find((i) => i.iid === 14)!;
    expect(old.open).toBe(false);
    expect(old.adoption?.outcome).toBe('superseded');
    expect(isAdopted(old)).toBe(false);
    expect(fake.db.notes["11:14"].filter((n) => !n.system)[0].body).toBe(`⏭️ Superseded by v1.1: #${r.created[1].iid}`);
    expect(adoptionCycles(items, 'api-error-format').map((x) => [x.version, x.adopted, x.active, x.issues.length])).toEqual([
      ['1.1', 0, 2, 2],
      ['1.0', 1, 2, 3],
    ]);
    const again = await std.startCycle(api, [{ team: 'Payments', responsible: 'priya.nair', due }], items, { supersede: true });
    expect(again.errors).toEqual(['Payments: already has an open adoption issue for v1.1']);
  });

  it('works with a group wiki', async () => {
    const { std, fake } = await setup({ wikiKind: 'group', wikiPath: 'architecture' });
    const c = await std.loadCatalog();
    expect(c.entries.every((e) => e.wikiVersion === undefined)).toBe(true);
    expect(c.entries[0].wikiUrl).toBe('https://gitlab.demo.local/groups/architecture/-/wikis/standards/api/api-error-format');
    await std.publish(c, c.entries);
    expect(fake.db.wikis['group:20'].map((p) => p.slug).sort()).toEqual([
      'standards',
      'standards/api/api-error-format',
      'standards/devops/container-image-baseline',
      'standards/react/react-state-management',
      'standards/security/dependency-vulnerability-sla',
    ]);
  });

  it('reports a wiki it cannot read without failing the catalog', async () => {
    const { std } = await setup({ wikiKind: 'group', wikiPath: 'no-such-group' });
    const c = await std.loadCatalog();
    expect(c.entries).toHaveLength(4);
    expect(c.wikiError).toMatch(/404/);
  });
});

describe('CI wiki sync', () => {
  it('publishes what is behind, prunes deleted standards, and is a no-op the second time', async () => {
    const { syncWiki } = await import('../src/lib/syncWiki');
    const fake = createFakeGitLab(seedDb(todayIso()));
    // A standard deleted from the repo but still on the wiki gets removed.
    delete fake.db.files['12:main:standards/security/dependency-vulnerability-sla.md'];
    const env = { CI_SERVER_URL: 'https://gitlab.demo.local', CI_PROJECT_PATH: 'architecture/standards', ARCH_WIKI_TOKEN: 't' };
    const log: string[] = [];
    const r = await syncWiki(env, (l) => log.push(l), fake.fetch);
    expect(r).toEqual({ published: ['standards/devops/container-image-baseline'], removed: ['standards/security/dependency-vulnerability-sla'] });
    expect(log[0]).toBe('3 standards, 1 to publish');
    expect((await syncWiki(env, () => undefined, fake.fetch)).published).toEqual([]);
    expect((await syncWiki({ ...env, ARCH_FORCE: '1' }, () => undefined, fake.fetch)).published).toHaveLength(3);
    await expect(syncWiki({ ...env, ARCH_WIKI_TOKEN: '' })).rejects.toThrow(/ARCH_WIKI_TOKEN/);
  });
});
