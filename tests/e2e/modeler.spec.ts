import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { answer, breakSorting, mendSorting, openNodeSet, selectEach, typeList, watchErrors } from './modeler';

// A small model with every kind of DataType: structure, enumeration, OptionSet and a plain Int32.
const fixture = join(__dirname, 'fixtures', 'Robustness.NodeSet2.xml');

test('models a type with a state machine and saves it as a NodeSet', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'New model…' }).click();
  await page.locator('.inline-form input').fill('http://example.org/Pump/');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.status')).toContainText('nodes of http://example.org/Pump/');

  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'PumpType');
  await page.locator('button[title*="state machine"]').click();
  await answer(page, 'PumpStateMachineType');
  for (const state of ['Idle', 'Running']) {
    await page.getByPlaceholder('New state').fill(state);
    await page.getByRole('button', { name: 'Add state' }).click();
  }
  await page.getByPlaceholder('New transition').fill('IdleToRunning');
  const ends = page.locator('.row.wrap select');
  await ends.nth(0).selectOption({ label: 'Idle' });
  await ends.nth(1).selectOption({ label: 'Running' });
  await page.getByRole('button', { name: 'Add transition' }).click();
  await expect(page.locator('ul.machine')).toContainText('IdleToRunning');
  await expect(page.locator('.chart svg')).toHaveCount(1);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Save NodeSet/ }).click()]);
  const xml = await readFile(await download.path(), 'utf8');
  for (const name of ['PumpType', 'PumpStateMachineType', 'Idle', 'Running', 'IdleToRunning']) expect(xml).toContain(`:${name}"`);
  expect(errors).toEqual([]);
});

test('shows every type in turn, DataTypes with and without fields among them', async ({ page }) => {
  const errors = watchErrors(page);
  await openNodeSet(page, fixture);
  const { count, emptied } = await selectEach(page);
  expect(count).toBeGreaterThanOrEqual(6);
  expect(emptied).toEqual([]);
  expect(errors).toEqual([]);
});

test('keeps the model through a failure of the modeler, to save it and to go on with it', async ({ page }) => {
  await openNodeSet(page, fixture);
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'ValveType');

  await breakSorting(page);
  await page.locator('.filter').fill('Type');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('The modeler stopped: injected failure');

  const [download] = await Promise.all([page.waitForEvent('download'), alert.getByRole('button', { name: 'Save NodeSet' }).click()]);
  expect(await readFile(await download.path(), 'utf8')).toContain(':ValveType"');

  await mendSorting(page);
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.status')).toContainText('started again');
  await expect(typeList(page).filter({ hasText: 'ValveType' })).toHaveCount(1);
});

test('counts an edit that made the modeler fail as unsaved', async ({ page }) => {
  await openNodeSet(page, fixture);
  await breakSorting(page);
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'CrashType');
  await expect(page.getByRole('alert')).toContainText('The modeler stopped');

  await mendSorting(page);
  await page.getByRole('alert').getByRole('button', { name: 'Try again' }).click();
  await expect(typeList(page).filter({ hasText: 'CrashType' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Save NodeSet *' })).toBeVisible();
});
