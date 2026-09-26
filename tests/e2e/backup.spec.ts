import { expect, Page, test } from '@playwright/test';
import { answer, drafts, typeList } from './modeler';

// The backup writes once editing pauses (1.5 s).
const pause = (page: Page) => page.waitForTimeout(2500);

async function unsavedModel(page: Page, type: string) {
  // Leaving a page with unsaved changes asks; the tests leave anyway.
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.getByRole('button', { name: 'New model…' }).click();
  await page.locator('.inline-form input').fill('http://example.org/Draft/');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, type);
  await pause(page);
  expect((await drafts(page)).map(d => d.title)).toEqual(['http://example.org/Draft/']);
}

test('offers the unsaved model after a reload, and forgets it as soon as it is saved', async ({ page }) => {
  await unsavedModel(page, 'DraftType');
  await page.reload();

  const offer = page.locator('.offer');
  await expect(offer).toContainText('http://example.org/Draft/');
  await offer.getByRole('button', { name: 'Restore' }).click();
  await expect(typeList(page).filter({ hasText: 'DraftType' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Save NodeSet *' })).toBeVisible();
  // Restored, the draft belongs to this page; there is one copy, not none.
  await expect.poll(() => drafts(page).then(d => d.length), { timeout: 1000 }).toBe(1);

  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Save NodeSet/ }).click()]);
  // Saved, the draft goes at once, not after the pause.
  await expect.poll(() => drafts(page).then(d => d.length), { timeout: 1000 }).toBe(0);
});

test('forgets the unsaved model when it is discarded', async ({ page }) => {
  await unsavedModel(page, 'DraftType');
  await page.reload();

  await page.locator('.offer').getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('.offer')).toHaveCount(0);
  await expect.poll(() => drafts(page).then(d => d.length), { timeout: 1000 }).toBe(0);
});

test('leaves the draft of a page still open to that page', async ({ context }) => {
  const first = await context.newPage();
  await unsavedModel(first, 'DraftType');

  const second = await context.newPage();
  await second.goto('/');
  await second.waitForTimeout(1000);
  await expect(second.locator('.offer')).toHaveCount(0);

  // Closed, the page lets go of its lock; the browser does so a moment later.
  await first.close();
  await expect(async () => {
    await second.reload();
    await expect(second.locator('.offer')).toContainText('http://example.org/Draft/', { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
});

test('keeps a draft that does not open, and says why', async ({ page }) => {
  await page.goto('/');
  await drafts(page, { id: 'gone', savedAt: Date.now(), title: 'http://example.org/Broken/', xml: '<UANodeSet', required: [] });
  await page.reload();

  await page.locator('.offer').getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.status.warn')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Save NodeSet/ })).toBeDisabled();
  expect((await drafts(page)).map(d => d.id)).toEqual(['gone']);
});
