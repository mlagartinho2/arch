import { expect, pick, test, toast, typeAtEnd } from './fixtures';
import type { Page } from '@playwright/test';

const openStandard = async (page: Page, title: string) => {
  await page.locator('.nav-item', { hasText: 'Standards' }).click();
  await page.locator('.row', { hasText: title }).click();
};

test.describe('standard editor, full screen', () => {
  test('propose a major change: rule from the / menu, changelog, whole-file diff, merge request', async ({ page, demo }) => {
    await openStandard(page, 'Container image baseline');
    await page.getByRole('button', { name: 'Propose change' }).click();
    await expect(page.locator('#std-editor')).toBeVisible();

    await typeAtEnd(page, 'std-body', '\n\n/must');
    await pick(page, 'MUST rule');
    await page.keyboard.type('sign images with cosign');

    await page.locator('[data-tab="change"]').click();
    await page.getByRole('button', { name: /^Major →/ }).click();
    await page.locator('#std-note').fill('Images must be signed with cosign');
    await expect(page.locator('#std-editor .fs-sub .ver')).toHaveText('v2.0 → v3.0');

    await page.locator('.fs-bar [data-view="changes"]').click();
    await expect(page.locator('#ed-diff .diff .add', { hasText: '**MUST**' })).toHaveText(/- Teams \*\*MUST\*\* sign images with cosign/);
    await page.locator('#std-header').check();
    await expect(page.locator('#ed-diff .diff .add', { hasText: 'Images must be signed with cosign' })).toHaveCount(1);

    await page.locator('#std-submit').click();
    await expect(toast(page).first()).toHaveText(/^Merge request !\d+ opened for review$/);
    await expect(page.locator('#std-editor')).toHaveCount(0);

    const mr = await demo.db<{ title: string; state: string } | undefined>(`(db) => db.mrs.find((m) => m.title.includes('Container image baseline'))`);
    expect(mr).toMatchObject({ title: 'Standard: Container image baseline v3.0', state: 'opened' });
  });

  test('the merge request is refused until the change is described', async ({ page }) => {
    await openStandard(page, 'Container image baseline');
    await page.getByRole('button', { name: 'Propose change' }).click();
    await page.locator('#std-submit').click();

    await expect(page.locator('#ed-banner')).toContainText('Describe the change for the changelog');
    await expect(page.locator('#ed-banner')).toContainText('Nothing has changed yet');
    await expect(page.locator('#std-note')).toBeFocused();
  });

  test('warns when another change to the same standard is in review', async ({ page }) => {
    await openStandard(page, 'React state management');
    await page.getByRole('button', { name: 'Propose change' }).click();
    await expect(page.locator('#ed-banner')).toContainText('Another change to this standard is in review');
    await expect(page.locator('#ed-banner')).toContainText('!1');
  });

  test('a new standard keeps its draft when you leave and come back', async ({ page }) => {
    await page.locator('.nav-item', { hasText: 'Standards' }).click();
    await page.getByRole('button', { name: '+ New standard' }).click();
    await page.locator('#std-title').fill('Log format');
    await expect(page.locator('#std-status')).toContainText('Draft saved');
    await page.locator('#std-editor .fs-back').click();

    await page.getByRole('button', { name: '+ New standard' }).click();
    await expect(page.locator('#std-title')).toHaveValue('Log format');
  });
});
