import { expect, Page, test } from '@playwright/test';
import { answer, typeList } from './modeler';

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
}

test('offers the unsaved model after a reload, and forgets it once saved', async ({ page }) => {
  await unsavedModel(page, 'DraftType');
  await page.reload();

  const offer = page.locator('.offer');
  await expect(offer).toContainText('http://example.org/Draft/');
  await offer.getByRole('button', { name: 'Restore' }).click();
  await expect(typeList(page).filter({ hasText: 'DraftType' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Save NodeSet *' })).toBeVisible();

  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Save NodeSet/ }).click()]);
  await pause(page);
  await page.reload();
  await page.waitForTimeout(500);
  await expect(page.locator('.offer')).toHaveCount(0);
});

test('forgets the unsaved model when it is discarded', async ({ page }) => {
  await unsavedModel(page, 'DraftType');
  await page.reload();

  await page.locator('.offer').getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('.offer')).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(500);
  await expect(page.locator('.offer')).toHaveCount(0);
});
