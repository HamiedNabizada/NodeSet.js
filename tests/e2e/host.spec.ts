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
