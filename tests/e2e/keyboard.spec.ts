import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { answer, watchErrors } from './modeler';

// The shortcuts of the modeler on a page of its own; the host's Ctrl+S is in host.spec.ts.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New model…' }).click();
  await page.locator('.inline-form input').fill('http://example.org/Keys/');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.status')).toContainText('nodes of http://example.org/Keys/');
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'PumpType');
});

test('deletes the node selected on the canvas with Delete, and undoes it with Ctrl+Z, Caps Lock or not', async ({ page }) => {
  const errors = watchErrors(page);
  const section = page.locator('fieldset', { has: page.locator('legend', { hasText: 'Add child' }) });
  await section.getByPlaceholder('Name').fill('Speed');
  await section.getByRole('button', { name: 'Add' }).click();
  const speed = page.locator('.djs-shape', { hasText: 'Speed' });
  await expect(speed).toHaveCount(1);

  // A new child is selected already, and a click on a selected shape deselects it.
  await page.locator('.djs-shape', { hasText: 'PumpType' }).click();
  await speed.click();
  await expect(page.locator('.editor h3')).toContainText('Speed');
  await page.keyboard.press('Delete');
  await expect(speed).toHaveCount(0);
  // Ctrl+Z with Caps Lock on: the key is "Z", without Shift.
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, bubbles: true })));
  await expect(speed).toHaveCount(1);
  await page.keyboard.press('Control+Shift+Z');
  await expect(speed).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('saves the NodeSet with Ctrl+S, also from a field, with what the field holds', async ({ page }) => {
  await page.locator('.editor textarea').fill('A pump.');
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const xml = await readFile(await download.path(), 'utf8');
  expect(xml).toContain(':PumpType"');
  expect(xml).toContain('A pump.');
  await expect(page.getByRole('button', { name: 'Save NodeSet', exact: true })).toBeVisible();
});
