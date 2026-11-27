import { editorText, expect, pick, test, toast, typeAtEnd } from './fixtures';

test.describe('meeting notes, full screen', () => {
  test('capture a meeting with a decision and an action, then find it in Meetings', async ({ page, demo }) => {
    await page.keyboard.press('n');
    await expect(page.locator('#capture')).toBeVisible();
    await expect(page.locator('#cap-title')).toHaveValue(''); // the "n" must not be typed into the title

    await page.locator('#cap-title').fill('Platform sync');
    await page.keyboard.press('Enter');

    await page.locator('.fs-people .chip-input').fill('Anna, Vendor rep');
    await page.keyboard.press('Enter');
    await expect(page.locator('.fs-people .chip')).toHaveText([/Anna Keller/, /Vendor rep \(guest\)/]);

    await page.locator('#tb-decision').click();
    await page.keyboard.type('Use cosign for image signing');
    await page.keyboard.press('Enter');
    await page.locator('#tb-action').click();
    await page.keyboard.type('luk');
    await pick(page, 'lukas.brunner');
    await page.keyboard.type('size the cluster due:2w');
    await page.keyboard.press('Escape');

    expect(await editorText(page, 'cap-editor')).toContain('ACTION @lukas.brunner size the cluster due:2w');
    await expect(page.locator('#cap-editor .cm-arch-kw')).toHaveCount(2);
    await expect(page.locator('#cap-preview .mcard')).toHaveCount(2);
    await expect(page.locator('#cap-preview .mcard-action')).toContainText('Lukas Brunner');
    await expect(page.locator('#cap-items')).toContainText('Will create 2');
    await expect(page.locator('#cap-sb')).toContainText('2 new · 0 updates');

    await page.keyboard.press('ControlOrMeta+s');
    await expect(toast(page).first()).toHaveText('Meeting saved: 2 new, 0 updated');
    await expect(page).toHaveURL(/#\/meetings$/);
    await expect(page.locator('#quicklook .ql-title')).toHaveText('Platform sync (2026-11-26)');
    await expect(page.locator('#quicklook .box')).toContainText('Size the cluster'); // titles start with a capital

    const action = await demo.db<{ title: string; state: string; due_date: string; labels: string[]; assignees: { username: string }[] }>(
      `(db) => db.issues.find((i) => /size the cluster/i.test(i.title))`,
    );
    expect(action).toMatchObject({ state: 'opened', due_date: '2026-12-10', labels: ['fu::action'], assignees: [{ username: 'lukas.brunner' }] });
    const decision = await demo.issueByTitle('Use cosign for image signing');
    expect(decision).toMatchObject({ state: 'closed', labels: ['fu::decision'] });
  });

  test('flags an unknown person, still saves the rest and reports the failure', async ({ page }) => {
    await page.keyboard.press('n');
    await page.locator('#cap-title').fill('Vendor call');
    await typeAtEnd(page, 'cap-editor', 'ACTION @nobody.here: check something\nTODO: send the minutes');
    await page.keyboard.press('Escape');

    await expect(page.locator('#cap-editor .cm-arch-mention-bad')).toHaveText('@nobody.here');
    await page.locator('[data-tab="checks"]').click();
    await expect(page.locator('.ed-side-b')).toContainText('@nobody.here is not a GitLab user');
    await expect(page.locator('#tb-panel .badge.bad')).toHaveText('1');

    await page.locator('#cap-save').click();
    await expect(toast(page).filter({ hasText: 'Meeting saved' })).toHaveText('Meeting saved: 1 new, 0 updated');
    await expect(toast(page).filter({ hasText: 'failed' })).toContainText('GitLab user @nobody.here not found');
  });

  test('notes started from Prepare: changes against the agenda, ticking an item marks it done', async ({ page, demo }) => {
    await page.locator('.nav-item', { hasText: 'Meetings' }).click();
    await page.locator('.row', { hasText: 'Architecture Board' }).click();
    await page.locator('#quicklook').getByRole('button', { name: /Prepare next session/ }).click();
    await page.getByRole('button', { name: /Start meeting notes/ }).click();

    await expect(page.locator('#capture')).toBeVisible();
    await expect(page.locator('#cap-title')).toHaveValue('Architecture Board');
    await expect(page.locator('#cap-series-hint')).toHaveText('recurring, session 2');
    await expect(page.locator('.fs-people .note')).toContainText('Started from the agenda');

    await page.locator('.fs-bar [data-view="changes"]').click();
    await expect(page.locator('#ed-diff')).toContainText('Your notes compared with the agenda');
    await expect(page.locator('#ed-diff')).toContainText('No changes yet.');

    await page.locator('.fs-bar [data-view="split"]').click();
    await page.locator('#cap-preview li', { hasText: '#7' }).locator('input.task').click();
    await expect(page.locator('#cap-preview .mcard-update[data-iid="7"]')).toContainText('Share load-test results');
    await expect(page.locator('#cap-items')).toContainText('Will update 1');

    await page.locator('.fs-bar [data-view="changes"]').click();
    await expect(page.locator('#ed-diff .diff-add')).toHaveText('+1');
    await expect(page.locator('#ed-diff .diff-del')).toHaveText('−1');

    await page.locator('#cap-save').click();
    await expect(toast(page).first()).toHaveText(/Meeting saved: 0 new, 1 updated/);
    expect((await demo.issue(7)).state).toBe('closed');
  });

  test('unsaved notes survive a reload, and Cancel discards them', async ({ page }) => {
    await page.keyboard.press('n');
    await page.locator('#cap-title').fill('Draft test');
    await typeAtEnd(page, 'cap-editor', 'Some notes worth keeping');
    await expect(page.locator('#cap-status')).toContainText('Draft saved');

    await page.reload();
    await expect(page.locator('#cap-title')).toHaveValue('Draft test');
    expect(await editorText(page, 'cap-editor')).toContain('Some notes worth keeping');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard notes' }).click();
    await expect(page).toHaveURL(/#\/meetings$/);
    await page.keyboard.press('n');
    await expect(page.locator('#cap-title')).toHaveValue('');
  });
});
