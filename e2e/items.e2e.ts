import { editorText, expect, pick, test, toast, typeAtEnd } from './fixtures';

test.describe('quick look', () => {
  test('ticking a task saves it at once and keeps the hidden markers', async ({ page, demo }) => {
    await page.locator('.row[data-iid="6"]').first().click();
    await expect(page.locator('#quicklook .ql-title')).toHaveText('Write ADR for Kafka adoption');

    await page.locator('#ql-desc li', { hasText: 'Consequences' }).locator('input.task').click();
    await expect(toast(page).first()).toHaveText('Task ticked');

    const desc = (await demo.issue(6)).description!;
    expect(desc).toContain("- [x] Consequences for @sofia.ricci's inventory services");
    expect(desc).toContain('<!-- fu:meeting=1 -->');
  });

  test('arrow keys move through the list; Enter opens full screen; Esc comes back', async ({ page }) => {
    // Focus → Overdue lists #14, #7, #6 (by follow-up date).
    await page.locator('.row[data-iid="7"]').first().click();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#quicklook .ql-title')).toHaveText('Write ADR for Kafka adoption');
    await expect(page.locator('.row[data-iid="6"]').first()).toHaveClass(/row-sel/);
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#quicklook .ql-title')).toHaveText('Share load-test results of the new gateway');

    await page.keyboard.press('Enter');
    await expect(page.locator('#item-screen')).toHaveAttribute('data-iid', '7');
    await expect(page).toHaveURL(/#\/item\/7$/);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#item-screen')).toHaveAttribute('data-iid', '6');

    await page.keyboard.press('Escape');
    await expect(page.locator('#item-screen')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/focus$/);
    await expect(page.locator('#quicklook')).toBeVisible();
  });
});

test.describe('item full screen', () => {
  test('E opens the description editor; # links an item; markers survive the save', async ({ page, demo }) => {
    await page.locator('.row[data-iid="6"]').first().click();
    await page.keyboard.press('e');
    await expect(page.locator('#desc-editor')).toBeVisible();
    expect(await editorText(page, 'desc-editor')).toMatch(/^From meeting #1/); // the "e" must not be typed
    expect(await editorText(page, 'desc-editor')).not.toContain('fu:meeting');

    await typeAtEnd(page, 'desc-editor', '\n\nSee #');
    await pick(page, 'Use Kafka for all async domain events');
    await page.keyboard.type('for the decision.');
    await expect(page.locator('#desc-status')).toContainText('Unsaved changes');

    await page.keyboard.press('ControlOrMeta+s');
    await expect(toast(page).first()).toHaveText('Description saved');
    await expect(page.locator('#desc-card .desc-read').getByText('for the decision.')).toBeVisible();
    await expect(page.locator('#desc-card .desc-read a.ref[data-iid="3"]')).toHaveCount(2); // the existing reference and the new one

    const desc = (await demo.issue(6)).description!;
    expect(desc).toContain('See #3 for the decision.');
    expect(desc.trimEnd().endsWith('<!-- fu:meeting=1 -->')).toBe(true);
    expect((await demo.notes(6)).some((n) => n.system && n.body === 'changed the description')).toBe(true);
  });

  test('a description changed in GitLab meanwhile is not overwritten without asking', async ({ page, demo }) => {
    await page.goto('/#/item/8');
    await page.locator('#desc-edit').click();
    await demo.editIssue(8, `(i) => { i.description = 'Edited by Sofia in GitLab\\n\\n' + i.description; }`);
    await typeAtEnd(page, 'desc-editor', '\nMy addition');
    await page.locator('#desc-save').click();

    await expect(page.locator('#ed-banner')).toContainText('Someone changed this description in GitLab');
    await page.getByRole('button', { name: 'Compare versions' }).click();
    await expect(page.locator('#ed-diff')).toContainText('Their version in GitLab → yours');
    await expect(page.locator('#ed-diff .diff .del').first()).toContainText('Edited by Sofia in GitLab');

    await page.getByRole('button', { name: 'Load their version' }).click();
    await expect(page.locator('#ed-banner')).toContainText('Their version is loaded');
    await page.locator('#desc-card [data-view="write"]').click();
    expect(await editorText(page, 'desc-editor')).toMatch(/^Edited by Sofia in GitLab/);
    expect((await demo.issue(8)).description).not.toContain('My addition');
  });

  test('"Save mine anyway" replaces the version in GitLab', async ({ page, demo }) => {
    await page.goto('/#/item/8');
    await page.locator('#desc-edit').click();
    await demo.editIssue(8, `(i) => { i.description = 'Edited by Sofia in GitLab\\n\\n' + i.description; }`);
    await typeAtEnd(page, 'desc-editor', '\nMy addition');
    await page.locator('#desc-save').click();
    await page.getByRole('button', { name: 'Save mine anyway' }).click();

    await expect(toast(page).first()).toHaveText('Description saved');
    const desc = (await demo.issue(8)).description!;
    expect(desc).toContain('My addition');
    expect(desc).not.toContain('Edited by Sofia');
    expect(desc).toContain('<!-- fu:meeting=1 -->');
  });

  test('a comment can push the follow-up and close the action', async ({ page, demo }) => {
    await page.goto('/#/item/7');
    await typeAtEnd(page, 'comment-editor', 'Results look good, thanks');
    await page.getByLabel('Push follow-up +3 days').check();
    await page.getByLabel('Close the action').check();
    await page.locator('#comment-editor .cm-content').click();
    await page.keyboard.press('ControlOrMeta+Enter');

    await expect(toast(page).first()).toHaveText('Commented and closed');
    const issue = await demo.issue(7);
    expect(issue).toMatchObject({ state: 'closed', due_date: '2026-11-29' });
    expect((await demo.notes(7)).find((n) => !n.system)?.body).toBe('Results look good, thanks');
    await expect(page.locator('.activity .bubble').last()).toContainText('Results look good, thanks');
    await expect(page.locator('.hist')).toContainText('closed');
  });

  test('nudging mentions the owner and pushes the follow-up', async ({ page, demo }) => {
    await page.goto('/#/item/7');
    await page.getByRole('button', { name: 'Nudge…' }).click();
    await page.getByRole('button', { name: 'Nudge', exact: true }).click();

    await expect(toast(page).first()).toHaveText('Nudged @jonas.weber');
    expect((await demo.issue(7)).due_date).toBe('2026-11-29');
    expect((await demo.notes(7)).find((n) => !n.system)?.body).toContain('@jonas.weber');
  });

  test('deep links: an item opens on reload, an unknown number explains itself', async ({ page }) => {
    await page.goto('/#/item/9');
    await expect(page.locator('#it-title')).toHaveValue('Migrate payment-callbacks to the new API gateway');
    await page.reload();
    await expect(page.locator('#it-title')).toHaveValue('Migrate payment-callbacks to the new API gateway');

    await page.goto('/#/item/999');
    await expect(page.getByText('#999 is not an Arch item')).toBeVisible();
  });
});
