import { expect, Page, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { answer, breakSorting, mendSorting, typeList } from './modeler';

// The modeler inside a host, such as the AMLOpcUa plugin: WebView2's
// chrome.webview, stood in for by a page script that records what the
// modeler posts and delivers what the test sends.
type Message = { type: string; [key: string]: unknown };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const listeners = new Set<(e: { data: unknown }) => void>();
    const host = window as unknown as { posted: unknown[]; send: (m: unknown) => void };
    host.posted = [];
    host.send = message => listeners.forEach(listener => listener({ data: message }));
    (window as unknown as { chrome: unknown }).chrome = {
      webview: {
        postMessage: (message: unknown) => host.posted.push(message),
        addEventListener: (_: string, listener: (e: { data: unknown }) => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: (e: { data: unknown }) => void) => listeners.delete(listener),
      },
    };
  });
});

const posted = (page: Page) => page.evaluate(() => (window as unknown as { posted: Message[] }).posted);
const send = (page: Page, message: Message) => page.evaluate(m => (window as unknown as { send: (m: unknown) => void }).send(m), message);
const lastDirty = async (page: Page) => (await posted(page)).filter(m => m.type === 'dirty').pop()?.dirty;

async function openedByHost(page: Page) {
  await page.goto('/');
  await expect.poll(async () => (await posted(page)).some(m => m.type === 'ready')).toBe(true);
  const xml = await readFile(join(__dirname, 'fixtures', 'Robustness.NodeSet2.xml'), 'utf8');
  await send(page, { type: 'open', name: 'Robustness.NodeSet2.xml', xml, required: [] });
  await expect(page.locator('.status')).toContainText('nodes of http://example.org/Robustness/');
}

test('tells the host that an edit which made the modeler fail is unsaved', async ({ page }) => {
  await openedByHost(page);
  await breakSorting(page);
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'CrashType');
  await expect(page.getByRole('alert')).toContainText('The modeler stopped');

  await expect.poll(() => lastDirty(page)).toBe(true);
});

const lastPosted = async (page: Page, type: string) => (await posted(page)).filter(m => m.type === type).pop();

// The page stays editable while the host imports; an edit made then is not in what the host took.
test('keeps an edit made while the host imports unsaved, when the host names the change it took', async ({ page }) => {
  await openedByHost(page);
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'FirstType');
  await page.getByRole('button', { name: 'Apply to document' }).click();
  const apply = await lastPosted(page, 'apply');
  expect(typeof apply?.change).toBe('number');

  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'SecondType');
  await send(page, { type: 'applied', ok: true, text: 'Imported.', change: apply!.change });
  await expect(page.locator('.status')).toContainText('Imported.');
  await expect(page.getByRole('button', { name: 'Save NodeSet *' })).toBeVisible();
  expect(await lastDirty(page)).toBe(true);

  // Applied again, with nothing changed since: the model counts as saved.
  await page.getByRole('button', { name: 'Apply to document' }).click();
  const again = await lastPosted(page, 'apply');
  expect(again?.change).not.toBe(apply!.change);
  await send(page, { type: 'applied', ok: true, text: 'Imported again.', change: again!.change });
  await expect(page.getByRole('button', { name: 'Save NodeSet', exact: true })).toBeVisible();
  await expect.poll(() => lastDirty(page)).toBe(false);

  // A save names its change as well.
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'ThirdType');
  await page.getByRole('button', { name: /^Save NodeSet/ }).click();
  const save = await lastPosted(page, 'save');
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'FourthType');
  await send(page, { type: 'saved', ok: true, text: 'Saved.', change: save!.change });
  await expect(page.locator('.status')).toContainText('Saved.');
  await expect(page.getByRole('button', { name: 'Save NodeSet *' })).toBeVisible();
});

test('applies the model to the document with Ctrl+S, as the first button of the toolbar does', async ({ page }) => {
  await openedByHost(page);
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'FirstType');
  await page.keyboard.press('Control+S');
  await expect.poll(async () => (await lastPosted(page, 'apply'))?.xml).toContain(':FirstType"');
  expect(await lastPosted(page, 'save')).toBeUndefined();
});

test('counts the model as saved on a reply without a change, as hosts did before', async ({ page }) => {
  await openedByHost(page);
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'FirstType');
  await page.getByRole('button', { name: 'Apply to document' }).click();
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'SecondType');
  await send(page, { type: 'applied', ok: true, text: 'Imported.' });
  await expect(page.getByRole('button', { name: 'Save NodeSet', exact: true })).toBeVisible();
  await expect.poll(() => lastDirty(page)).toBe(false);
});

test('hears the host while the modeler shows a failure', async ({ page }) => {
  await openedByHost(page);
  await breakSorting(page);
  await page.locator('button[title="New ObjectType"]').click();
  await answer(page, 'CrashType');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('The modeler stopped');

  // Saved through the host from the failure, then asked for another model.
  await alert.getByRole('button', { name: 'Save NodeSet' }).click();
  await expect.poll(async () => (await posted(page)).some(m => m.type === 'save')).toBe(true);
  await send(page, { type: 'saved', ok: true, text: 'Saved.' });
  await expect.poll(() => lastDirty(page)).toBe(false);
  await send(page, { type: 'new', modelUri: 'http://example.org/Other/', required: [] });

  await mendSorting(page);
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.status')).toContainText('http://example.org/Other/');
  await expect(typeList(page).filter({ hasText: 'CrashType' })).toHaveCount(0);
});
