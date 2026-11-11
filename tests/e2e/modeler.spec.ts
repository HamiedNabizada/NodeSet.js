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
  const ends = page.locator('.row.wrap', { has: page.getByPlaceholder('New transition') }).locator('select');
  await ends.nth(0).selectOption({ label: 'Idle' });
  await ends.nth(1).selectOption({ label: 'Running' });
  await page.getByRole('button', { name: 'Add transition' }).click();
  await expect(page.locator('ul.machine')).toContainText('IdleToRunning');
  await expect(page.locator('.chart svg')).toHaveCount(1);
  await page.getByRole('button', { name: /^Checks: \d+ error\(s\)/ }).click();
  await expect(page.locator('.findings')).toBeVisible();

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

// DI loaded beside the open DI sample counted every reference twice, and the
// diagram of DeviceType then took the modeler down.
test('does not load the open model a second time', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open DI sample' }).click();
  await expect(page.locator('.status')).toContainText('nodes of http://opcfoundation.org/UA/DI/');
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Load DI/ })).toHaveCount(0);

  await page.locator('.button-like input[type=file]').setInputFiles(join(__dirname, '../../assets/nodesets/Opc.Ua.Di.NodeSet2.xml'));
  await expect(page.locator('.status')).toContainText('adds no model');
  await typeList(page).filter({ hasText: /^DeviceType$/ }).click();
  await expect(page.locator('.editor h3')).toContainText('DeviceType');
  await expect(page.locator('.djs-shape')).not.toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Moving a shape changes no node: no checks, but an unsaved change all the same.
test('keeps where a shape was moved to, as an unsaved change, and lays the diagram out anew', async ({ page }) => {
  const errors = watchErrors(page);
  await openNodeSet(page, fixture);
  await typeList(page).first().click();
  const shape = page.locator('.djs-shape').first();
  const before = await shape.boundingBox();
  await page.mouse.move(before!.x + 40, before!.y + 20);
  await page.mouse.down();
  await page.mouse.move(before!.x + 140, before!.y + 120, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Save NodeSet *' })).toBeVisible();
  await expect.poll(async () => (await page.locator('.djs-shape').first().boundingBox())!.x).toBeGreaterThan(before!.x + 50);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Save NodeSet/ }).click()]);
  expect(await readFile(await download.path(), 'utf8')).toContain('<UANodeSet');
  await expect(page.getByRole('button', { name: 'Save NodeSet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset layout' }).click();
  await expect(page.getByRole('button', { name: 'Save NodeSet *' })).toBeVisible();
  await expect.poll(async () => Math.round((await page.locator('.djs-shape').first().boundingBox())!.x)).toBe(Math.round(before!.x));
  expect(errors).toEqual([]);
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
