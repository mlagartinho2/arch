/* Shared setup for the browser tests: a fresh demo workspace on a fixed date, and a guard against page errors. */
import { expect, test as base, type Locator, type Page } from '@playwright/test';

/** The demo data is seeded relative to "today"; the tests run on this Thursday. */
export const TODAY = '2026-11-26';

/** Minimal shapes of the fake GitLab's database, read through window.__archDemo (demo mode only). */
export interface FakeIssue {
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: 'opened' | 'closed';
  labels: string[];
  due_date: string | null;
  assignees: { username: string }[];
}
export interface FakeNote { body: string; system: boolean; author: { username: string } }

export class Demo {
  constructor(private page: Page) {}

  /** Reads a value from the fake GitLab's database. */
  db<T>(fn: string): Promise<T> {
    return this.page.evaluate(`(${fn})(window.__archDemo.db)`) as Promise<T>;
  }
  issue(iid: number) {
    return this.db<FakeIssue>(`(db) => db.issues.find((i) => i.project_id === 11 && i.iid === ${iid})`);
  }
  issueByTitle(title: string) {
    return this.db<FakeIssue | undefined>(`(db) => db.issues.find((i) => i.title === ${JSON.stringify(title)})`);
  }
  notes(iid: number) {
    return this.db<FakeNote[]>(`(db) => db.notes['11:${iid}'] ?? []`);
  }
  /** Changes an issue in "GitLab" behind the app's back. */
  async editIssue(iid: number, patch: string) {
    await this.page.evaluate(`((db) => { const i = db.issues.find((x) => x.project_id === 11 && x.iid === ${iid}); (${patch})(i); })(window.__archDemo.db)`);
  }
}

/** Types into a CodeMirror editor (inside the element with this id), at the end of its text. */
export async function typeAtEnd(page: Page, editorId: string, text: string) {
  await page.locator(`#${editorId} .cm-content`).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}
export const editorText = (page: Page, editorId: string) => page.locator(`#${editorId} .cm-content`).evaluate((el) => (el as HTMLElement).innerText.replace(/​/g, ''));
export const toast = (page: Page): Locator => page.locator('.toast');

/**
 * Picks a suggestion from the open completion list. Clicking (rather than pressing Enter) avoids
 * CodeMirror's short delay during which Enter is ignored right after the list opens.
 */
export async function pick(page: Page, text: string | RegExp) {
  const option = page.locator('.cm-tooltip-autocomplete li', { hasText: text }).first();
  await expect(option).toBeVisible();
  await option.click();
}

export const test = base.extend<{ demo: Demo; errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text()}`);
      });
      await use(errors);
      expect(errors, 'the page logged errors').toEqual([]);
    },
    { auto: true },
  ],
  // Every test starts in a fresh demo workspace (new browser context = empty localStorage).
  demo: [
    async ({ page }, use) => {
      await page.clock.setFixedTime(new Date(`${TODAY}T09:00:00+01:00`));
      await page.goto('/');
      await page.getByRole('button', { name: 'Try it with demo data' }).click();
      await expect(page.locator('.stats')).toBeVisible();
      await use(new Demo(page));
    },
    { auto: true },
  ],
});
export { expect };
