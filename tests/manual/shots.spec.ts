import { expect, Locator, Page, test } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { answer, settle, typeList, watchErrors } from '../e2e/modeler';

// The pictures of the user manual (docs/manual.md). One model is built the way
// the manual describes it, and each picture is taken on the way, so a picture
// that no longer matches the modeler fails here first.
// `npm run manual:shots` builds the web page and writes docs/manual/*.png.

const out = join(__dirname, '..', '..', 'docs', 'manual');

/** A text as a whole, for filters that must not match a longer name. */
const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

const panel = (page: Page) => page.locator('.side.right');
const heading = (page: Page) => panel(page).locator('h3');

/** A field of the node editor by its label: "DataType", "Value" … */
const field = (page: Page, label: string) =>
  panel(page).locator('label.field').filter({ has: page.locator('span', { hasText: exact(label) }) });

/** A section of the node editor by its legend: "Add child", "Fields" … */
const section = (page: Page, legend: string) =>
  panel(page).locator('fieldset').filter({ has: page.locator('legend', { hasText: exact(legend) }) });

/** A shape on the canvas by the name it shows. */
const shape = (page: Page, name: string) =>
  page.locator('.djs-shape').filter({ has: page.locator('text', { hasText: exact(name) }) });

/** Types into a field and commits it with Enter, as the panel expects. */
async function enter(input: Locator, value: string): Promise<void> {
  await input.fill(value);
  await input.press('Enter');
}

/** Picks an entry of the list on the left; the panel then shows it. */
async function open(page: Page, name: string): Promise<void> {
  await typeList(page).filter({ hasText: exact(name) }).click();
  await expect(heading(page)).toContainText(name);
}

/** A new type through the + of its group. */
async function addType(page: Page, nodeClass: string, name: string): Promise<void> {
  await page.locator(`button[title="New ${nodeClass}"]`).click();
  await answer(page, name);
  await expect(heading(page)).toContainText(name);
}

/** A child through the panel's Add child; the panel then shows the child. */
async function addChild(page: Page, kind: 'Variable' | 'Property' | 'Object' | 'Method', rule: string, name: string): Promise<void> {
  const box = section(page, 'Add child');
  await box.locator('select').first().selectOption({ label: `${kind} (${kind === 'Property' ? 'HasProperty' : 'HasComponent'})` });
  await box.locator('select').nth(1).selectOption({ label: rule });
  await box.getByPlaceholder('Name').fill(name);
  await box.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(heading(page)).toContainText(name);
}

async function setDataType(page: Page, name: string): Promise<void> {
  const input = field(page, 'DataType').locator('input');
  await enter(input, name);
  await expect(input).toHaveValue(name);
}

/** No focus ring and no hover in the picture: the mouse on the toolbar's title, the focus nowhere. */
async function quiet(page: Page): Promise<void> {
  await page.mouse.move(40, 20);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle(page);
}

/** Runs the work with a window tall enough for the whole panel, so nothing of it is scrolled away. */
async function withRoom(page: Page, work: () => Promise<void>): Promise<void> {
  const size = page.viewportSize()!;
  const content = await panel(page).evaluate(e => e.scrollHeight);
  if (content + 140 > size.height) await page.setViewportSize({ width: size.width, height: content + 140 });
  await panel(page).evaluate(e => { e.scrollTop = 0; });
  await quiet(page);
  try {
    await work();
  } finally {
    await page.setViewportSize(size);
  }
}

/** A picture of the panel from the top of `first` to the bottom of `last`. */
async function panelShot(page: Page, name: string, first: Locator, last: Locator = first): Promise<void> {
  await withRoom(page, async () => {
    const side = (await panel(page).boundingBox())!;
    const top = (await first.boundingBox())!;
    const bottom = (await last.boundingBox())!;
    const y = Math.max(side.y, top.y - 8);
    await page.screenshot({ path: join(out, `${name}.png`), clip: { x: side.x, y, width: side.width, height: bottom.y + bottom.height + 6 - y } });
  });
}

/** A picture of a strip of the page, from the left edge to the right of `right`, `top` to `bottom` (page coordinates). */
async function strip(page: Page, name: string, right: Locator, top: number, bottom: number): Promise<void> {
  const edge = (await right.boundingBox())!;
  await page.screenshot({ path: join(out, `${name}.png`), clip: { x: 0, y: top, width: edge.x + edge.width + 12, height: bottom - top } });
}

/** A picture of an element with some of the page around it. */
async function around(page: Page, name: string, target: Locator, pad: number): Promise<void> {
  const box = (await target.boundingBox())!;
  const size = page.viewportSize()!;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  await page.screenshot({
    path: join(out, `${name}.png`),
    clip: { x, y, width: Math.min(size.width - x, box.width + 2 * pad), height: Math.min(size.height - y, box.height + 2 * pad) },
  });
}

test('takes the pictures of the manual', async ({ page, browser }) => {
  await mkdir(out, { recursive: true });
  const errors = watchErrors(page);
  // Leaving the page with unsaved changes asks; the backup step leaves anyway.
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');

  await test.step('a new model', async () => {
    await expect(page.locator('.status')).toHaveText('Start a new model, open a NodeSet2 file, or open the DI sample.');
    await page.getByRole('button', { name: 'New model…' }).click();
    await page.locator('.inline-form input').fill('http://example.org/Pump/');
    // The toolbar wraps at this width; the picture keeps its first row, up to Open DI sample.
    const cancel = (await page.locator('.inline-form').getByRole('button', { name: 'Cancel' }).boundingBox())!;
    await strip(page, 'new-model', page.getByRole('button', { name: 'Open DI sample' }), 0, cancel.y + cancel.height + 7);
    await page.locator('.inline-form').getByRole('button', { name: 'Create' }).click();
    await expect(page.locator('.status')).toContainText('nodes of http://example.org/Pump/');
  });

  await test.step('the model panel, with DI loaded', async () => {
    await page.getByRole('button', { name: 'Model', exact: true }).click();
    await page.getByRole('button', { name: /^Load DI/ }).click();
    await expect(page.locator('.status')).toContainText('Loaded http://opcfoundation.org/UA/DI/');
    await expect(panel(page)).toContainText('loaded');
    await panelShot(page, 'model-panel', heading(page), section(page, 'Models in use'));
  });

  await test.step('an enumeration', async () => {
    await addType(page, 'DataType', 'PumpModeEnum');
    await field(page, 'Description').locator('textarea').fill('How the pump is operated.');
    await field(page, 'Description').locator('textarea').blur();
    await enter(field(page, 'Supertype').locator('input'), 'Enumeration');
    const values = section(page, 'Values');
    for (const name of ['Off', 'Manual', 'Automatic']) {
      await values.getByRole('button', { name: '+ Value' }).click();
      await values.getByPlaceholder('Name').last().fill(name);
    }
    await values.getByRole('button', { name: 'Apply' }).click();
    await expect(values.getByRole('button', { name: 'Apply' })).toHaveCount(0);
    await panelShot(page, 'datatype-enumeration', heading(page), values);
  });

  await test.step('a structure', async () => {
    await addType(page, 'DataType', 'PumpSettingsDataType');
    const fields = section(page, 'Fields');
    const rows: [string, string, boolean][] = [['MaxSpeed', 'Double', false], ['Mode', 'PumpModeEnum', false], ['Note', 'String', true]];
    for (const [name, dataType, optional] of rows) {
      await fields.getByRole('button', { name: '+ Field' }).click();
      const row = fields.locator('.item-row').last();
      await row.getByPlaceholder('Name').fill(name);
      await enter(row.locator('input[list]'), dataType);
      if (optional) await row.locator('label.check', { hasText: 'optional' }).locator('input').check();
    }
    await fields.getByRole('button', { name: 'Apply' }).click();
    await expect(fields.getByRole('button', { name: 'Apply' })).toHaveCount(0);
    await panelShot(page, 'datatype-structure', heading(page), fields);
  });

  await test.step('a ReferenceType', async () => {
    await addType(page, 'ReferenceType', 'Drives');
    await expect(field(page, 'InverseName').locator('input')).toHaveValue('InverseDrives');
    await enter(field(page, 'InverseName').locator('input'), 'IsDrivenBy');
    await expect(page.locator('.status')).toContainText('Changed.');
  });

  await test.step('an ObjectType with its instance declarations', async () => {
    await addType(page, 'ObjectType', 'PumpType');
    await field(page, 'Description').locator('textarea').fill('A centrifugal pump.');
    await field(page, 'Description').locator('textarea').blur();

    await addChild(page, 'Property', 'Mandatory (1)', 'SerialNumber');
    await setDataType(page, 'String');

    await open(page, 'PumpType');
    await addChild(page, 'Variable', 'Mandatory (1)', 'Speed');
    await setDataType(page, 'Double');
    await field(page, 'Description').locator('textarea').fill('Rotational speed in 1/min.');
    await field(page, 'Description').locator('textarea').blur();
    await expect(page.locator('.status')).toContainText('Changed.');
    await panelShot(page, 'declaration', heading(page), field(page, 'Value'));
  });

  await test.step('a matrix value', async () => {
    await open(page, 'PumpType');
    await addChild(page, 'Variable', 'Optional (0..1)', 'PerformanceCurve');
    await setDataType(page, 'Double');
    await field(page, 'ValueRank').locator('select').selectOption({ label: 'TwoDimensions' });
    await expect(field(page, 'Value').locator('input')).toHaveAttribute('placeholder', 'a; b | c; d (rows separated by |)');
    await enter(field(page, 'Value').locator('input'), '0; 0 | 1450; 38.5 | 2900; 75');
    await expect(field(page, 'Value').locator('input')).toHaveValue('0; 0 | 1450; 38.5 | 2900; 75');
    await expect(page.locator('.status')).toContainText('Changed.');
    await panelShot(page, 'value-matrix', heading(page), field(page, 'Value'));
  });

  await test.step('a structure value', async () => {
    await open(page, 'PumpType');
    await addChild(page, 'Variable', 'Mandatory (1)', 'Settings');
    await setDataType(page, 'PumpSettingsDataType');
    const value = section(page, 'Value (PumpSettingsDataType)');
    await value.locator('.struct-row', { hasText: 'MaxSpeed' }).locator('input').fill('2900');
    await value.locator('.struct-row', { hasText: 'Mode' }).locator('select').selectOption({ label: 'Automatic (2)' });
    await value.locator('.struct-row', { hasText: 'Note' }).locator('input[type=checkbox]').check();
    await value.locator('.struct-row', { hasText: 'Note' }).locator('input:not([type=checkbox])').fill('Set at the factory');
    await value.getByRole('button', { name: 'Apply' }).click();
    await expect(value.getByRole('button', { name: 'Remove value' })).toBeVisible();
    await panelShot(page, 'value-structure', heading(page), value);
  });

  await test.step('a method with arguments', async () => {
    await open(page, 'PumpType');
    await addChild(page, 'Object', 'Mandatory (1)', 'Motor');
    await open(page, 'PumpType');
    await addChild(page, 'Object', 'Optional (0..1)', 'Impeller');
    await open(page, 'PumpType');
    await addChild(page, 'Method', 'Mandatory (1)', 'Start');
    const args: [string, string, string][] = [['Input arguments', 'Speed', 'Double'], ['Output arguments', 'Accepted', 'Boolean']];
    for (const [legend, name, dataType] of args) {
      const box = section(page, legend);
      await box.getByRole('button', { name: '+ Argument' }).click();
      await box.getByPlaceholder('Name').fill(name);
      await enter(box.locator('input[list]'), dataType);
      await box.getByRole('button', { name: 'Apply' }).click();
      await expect(box.getByRole('button', { name: 'Apply' })).toHaveCount(0);
    }
    await panelShot(page, 'method-arguments', heading(page), section(page, 'Output arguments'));
  });

  await test.step('a reference drawn on the canvas', async () => {
    // Another type and back, so the diagram is fitted to all the declarations.
    await open(page, 'PumpModeEnum');
    await open(page, 'PumpType');
    await shape(page, 'Motor').click();
    await expect(heading(page)).toContainText('Motor');
    await page.locator('.djs-context-pad [data-action="reference"]').click();
    const target = (await shape(page, 'Impeller').boundingBox())!;
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
    await page.mouse.down();
    await page.mouse.up();
    const dialog = page.locator('.ask');
    await expect(dialog).toContainText('ReferenceType of the new reference');
    await dialog.locator('input').fill('Drives');
    await around(page, 'reference-dialog', dialog, 28);
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(section(page, 'References')).toContainText('Drives → Impeller');
  });

  await test.step('state machines', async () => {
    const machine = async (name: string, states: string[], transitions: [string, string, string, string?][]) => {
      await page.locator('button[title*="state machine"]').click();
      await answer(page, name);
      await expect(heading(page)).toContainText(name);
      if (transitions.some(t => t[3])) {
        await addChild(page, 'Method', 'Mandatory (1)', 'Start');
        await open(page, name);
      }
      for (const state of states) {
        await page.getByPlaceholder('New state').fill(state);
        await page.getByRole('button', { name: 'Add state' }).click();
        await expect(section(page, 'State machine').locator('table')).toContainText(state);
      }
      for (const [transition, from, to, cause] of transitions) {
        const row = page.locator('.row.wrap', { has: page.getByPlaceholder('New transition') });
        await row.getByPlaceholder('New transition').fill(transition);
        await row.locator('select').nth(0).selectOption({ label: from });
        await row.locator('select').nth(1).selectOption({ label: to });
        if (cause) await row.locator('select').nth(2).selectOption({ label: `${cause}()` });
        await page.getByRole('button', { name: 'Add transition' }).click();
        await expect(page.locator('ul.machine')).toContainText(transition);
      }
    };
    await machine('MaintenanceStateMachineType', ['Cleaning', 'Inspection'], [['CleaningToInspection', 'Cleaning', 'Inspection']]);
    await machine('PumpStateMachineType', ['Idle', 'Running', 'Maintenance'], [
      ['IdleToRunning', 'Idle', 'Running', 'Start'],
      ['RunningToIdle', 'Running', 'Idle'],
      ['RunningToMaintenance', 'Running', 'Maintenance'],
      ['MaintenanceToIdle', 'Maintenance', 'Idle'],
    ]);
    const holder = section(page, 'State machine').locator('.row.wrap', { hasText: 'Machine of' });
    await holder.locator('select').nth(0).selectOption({ label: 'Maintenance' });
    await holder.locator('select').nth(1).selectOption({ label: 'MaintenanceStateMachineType' });
    await expect(page.locator('.chart svg')).toContainText('MaintenanceStateMachineType');
    // The lists here; the chart, too small to read in the panel, is taken enlarged below.
    await panelShot(page, 'state-machine', section(page, 'State machine'), page.getByRole('button', { name: 'Add transition' }));
  });

  await test.step('an instance', async () => {
    await open(page, 'PumpType');
    const create = section(page, 'Create instance');
    await create.locator('label.check', { hasText: 'Impeller' }).locator('input').check();
    await expect(create.locator('select option', { hasText: 'DeviceSet (DI)' })).toHaveCount(1);
    await create.getByPlaceholder('Name of the instance').fill('Pump1');
    await panelShot(page, 'create-instance', create);
    await create.getByRole('button', { name: 'Create' }).click();
    await expect(heading(page)).toContainText('Pump1');
    await expect(typeList(page).filter({ hasText: 'Pump1' })).toHaveCount(1);
  });

  await test.step('checks', async () => {
    // A Mandatory declaration the instance does not have yet: rule M022.
    await open(page, 'PumpType');
    await addChild(page, 'Variable', 'Mandatory (1)', 'FlowRate');
    await setDataType(page, 'Double');
    // The list stays open for the picture of the whole window.
    await page.getByRole('button', { name: /^Checks: / }).click();
    await expect(page.locator('.findings')).toContainText("M022 Pump1: it has no 'FlowRate', which PumpType declares as Mandatory.");
  });

  await test.step('the whole window', async () => {
    await open(page, 'PumpModeEnum');
    await open(page, 'PumpType');
    await shape(page, 'Speed').click();
    await expect(page.locator('.djs-context-pad')).toBeVisible();
    await quiet(page);
    await page.screenshot({ path: join(out, 'overview.png') });
  });

  let xml = '';
  await test.step('saving', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Save NodeSet/ }).click()]);
    expect(download.suggestedFilename()).toBe('example.org.Pump.NodeSet2.xml');
    xml = await readFile(await download.path(), 'utf8');
    // DI was loaded but nothing uses it, so it is not required.
    expect(xml).toContain('<RequiredModel ModelUri="http://opcfoundation.org/UA/"');
    expect(xml).not.toMatch(/<RequiredModel[^>]*UA\/DI\//);
    await expect(page.getByRole('button', { name: 'Save NodeSet', exact: true })).toBeVisible();
  });

  await test.step('the backup of unsaved work', async () => {
    await open(page, 'PumpType');
    await addChild(page, 'Property', 'Mandatory (1)', 'Manufacturer');
    await expect(page.getByRole('button', { name: 'Save NodeSet *' })).toBeVisible();
    // The backup writes once editing pauses (1.5 s).
    await page.waitForTimeout(2500);
    // Narrower, so the line of the offer is not mostly empty space.
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: 1000, height: size.height });
    await page.reload();
    const offer = page.locator('.offer');
    await expect(offer).toContainText('http://example.org/Pump/');
    await quiet(page);
    // The line of the offer, not the whole bar, which grows with the window.
    const line = (await offer.locator('span').first().boundingBox())!;
    await strip(page, 'backup-offer', offer.getByRole('button', { name: 'Discard' }), line.y - 10, line.y + line.height + 10);
    await offer.getByRole('button', { name: 'Restore' }).click();
    await expect(typeList(page).filter({ hasText: exact('PumpType') })).toHaveCount(1);
    await page.setViewportSize(size);
  });

  await test.step('the state chart, enlarged', async () => {
    // Twice the pixels, the saved model opened in a page of its own, so the chart's names can be read.
    const context = await browser.newContext({
      baseURL: new URL(page.url()).origin, viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, locale: 'en-US', colorScheme: 'light',
    });
    const other = await context.newPage();
    await other.goto('/');
    await other.locator('.toolbar input[type=file]').setInputFiles({ name: 'example.org.Pump.NodeSet2.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
    await expect(other.locator('.status')).toContainText('nodes of http://example.org/Pump/');
    await typeList(other).filter({ hasText: exact('PumpStateMachineType') }).click();
    await other.locator('.chart').scrollIntoViewIfNeeded();
    await other.locator('.chart').screenshot({ path: join(out, 'state-chart.png') });
    await context.close();
  });

  expect(errors).toEqual([]);
});
