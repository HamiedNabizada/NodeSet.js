import { expect, Page, test } from '@playwright/test';
import { answer, watchErrors } from './modeler';

// The panel of the node editor: what one node's panel holds stays with it.

async function newModel(page: Page, uri = 'http://example.org/Pump/') {
  await page.goto('/');
  await page.getByRole('button', { name: 'New model…' }).click();
  await page.locator('.inline-form input').fill(uri);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.status')).toContainText(`nodes of ${uri}`);
}

/** Adds a child to the node in the panel; the panel then shows the child. */
async function addChild(page: Page, kind: string, name: string) {
  const section = page.locator('fieldset', { has: page.locator('legend', { hasText: 'Add child' }) });
  await section.locator('select').first().selectOption(kind);
  await section.getByPlaceholder('Name').fill(name);
  await section.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.editor h3')).toContainText(name);
}

const shape = (page: Page, name: string) => page.locator('.djs-shape', { hasText: name });

test('does not carry an unapplied argument over to the next method, and asks only when leaving', async ({ page }) => {
  const errors = watchErrors(page);
  const questions: string[] = [];
  page.on('dialog', dialog => { questions.push(dialog.message()); return dialog.accept(); });
  await newModel(page);
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'PumpType');
  await addChild(page, 'Method', 'Start');
  await shape(page, 'PumpType').click();
  await expect(page.locator('.editor h3')).toContainText('PumpType');
  await addChild(page, 'Method', 'Stop');

  await shape(page, 'Start').click();
  await expect(page.locator('.editor h3')).toContainText('Start');
  await page.getByRole('button', { name: '+ Argument' }).first().click();
  await expect(page.locator('.editor .item-row')).toHaveCount(1);

  // Staying on the node asks nothing, also when a change redraws the canvas.
  await shape(page, 'Start').click();
  await page.locator('.editor textarea').fill('Starts the pump.');
  await page.locator('.editor textarea').blur();
  await expect(page.locator('.status')).toContainText('Changed.');
  expect(questions).toEqual([]);
  await expect(page.locator('.editor .item-row')).toHaveCount(1);

  // Leaving asks, and the next method shows its own arguments: none.
  await shape(page, 'Stop').click();
  await expect(page.locator('.editor h3')).toContainText('Stop');
  expect(questions).toHaveLength(1);
  await expect(page.locator('.editor .item-row')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('lists an instance placed below a node of a loaded model, such as DeviceSet', async ({ page }) => {
  const errors = watchErrors(page);
  await newModel(page);
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await page.getByRole('button', { name: /^Load DI/ }).click();
  await expect(page.locator('.status')).toContainText('Loaded');
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'PumpType');
  const create = page.locator('fieldset', { has: page.locator('legend', { hasText: 'Create instance' }) });
  await create.locator('select').selectOption({ label: 'DeviceSet (DI)' });
  await create.getByPlaceholder('Name of the instance').fill('Pump1');
  await create.getByRole('button', { name: 'Create' }).click();

  await expect(page.locator('.main > .side:not(.right) .item', { hasText: 'Pump1' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('creates a type below the supertype named with it, and a subtype of a type of the base model', async ({ page }) => {
  const errors = watchErrors(page);
  await newModel(page);
  await page.locator('button[title="New ObjectType"]').click();
  const dialog = page.locator('.ask-backdrop');
  await expect(dialog.locator('input').nth(1)).toHaveValue('BaseObjectType');
  await dialog.locator('input').nth(0).fill('PumpType');
  await dialog.locator('input').nth(1).fill('FolderType');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.editor h3')).toContainText('PumpType');
  await expect(page.locator('.field', { hasText: 'Supertype' }).locator('input')).toHaveValue('FolderType');

  // FolderType is the base model's: its panel adds a subtype of it to the model.
  await page.locator('.djs-shape', { hasText: 'FolderType' }).click();
  const add = page.locator('fieldset', { has: page.locator('legend', { hasText: 'Add subtype' }) });
  await add.getByPlaceholder('Name').fill('CabinetType');
  await add.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.editor h3')).toContainText('CabinetType');
  await expect(page.locator('.main > .side:not(.right) .item', { hasText: 'CabinetType' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('starts the panel of another node empty: the name of a child to add does not stay', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await newModel(page);
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'PumpType');
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'ValveType');
  const name = page.locator('fieldset', { has: page.locator('legend', { hasText: 'Add child' }) }).getByPlaceholder('Name');
  await name.fill('Speed');

  await page.locator('.main > .side:not(.right) .item', { hasText: 'PumpType' }).click();
  await expect(page.locator('.editor h3')).toContainText('PumpType');
  await expect(name).toHaveValue('');
});
