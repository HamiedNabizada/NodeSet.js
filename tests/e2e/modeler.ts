// What the end-to-end tests do with the modeler, in the words of its toolbar.

import { expect, Page } from '@playwright/test';

/** Collects what the page throws or logs as an error, for the test to check at the end. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

/** Waits until React has drawn what the last action changed. */
export const settle = (page: Page) =>
  page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))));

/** The entries of the list on the left: types, then instances. */
export const typeList = (page: Page) => page.locator('.main > .side:not(.right) .item');

/** Opens a NodeSet file and loads the models it requires from the files given. */
export async function openNodeSet(page: Page, file: string, required: string[] = []): Promise<void> {
  await page.goto('/');
  await page.locator('.toolbar input[type=file]').setInputFiles(file);
  await expect(page.locator('.status')).toContainText(/nodes of|missing required models/, { timeout: 120_000 });
  for (const other of required) {
    const before = await page.locator('.status').innerText();
    await page.locator('.button-like input[type=file]').setInputFiles(other);
    await expect(page.locator('.status')).not.toHaveText(before, { timeout: 120_000 });
  }
}

/** Answers the page's own dialog (AskDialog) with a name. */
export async function answer(page: Page, value: string): Promise<void> {
  const dialog = page.locator('.ask-backdrop');
  await dialog.locator('input').first().fill(value);
  await dialog.getByRole('button').first().click();
  await expect(dialog).toHaveCount(0);
}

/** Selects every entry of the list once; returns the names that emptied the page. */
export async function selectEach(page: Page): Promise<{ count: number; emptied: string[] }> {
  const items = typeList(page);
  const count = await items.count();
  const emptied: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = (await items.nth(i).innerText()).split('\n')[0];
    await items.nth(i).click();
    await settle(page);
    if (await items.count() !== count) {
      emptied.push(name);
      break;
    }
  }
  return { count, emptied };
}

/** A failure the modeler has no part in: sorting the list of types throws, until mended. */
export async function breakSorting(page: Page): Promise<void> {
  await page.evaluate(() => {
    const original = String.prototype.localeCompare;
    (window as unknown as { mend: () => void }).mend = () => { String.prototype.localeCompare = original; };
    String.prototype.localeCompare = () => { throw new Error('injected failure'); };
  });
}

export const mendSorting = (page: Page) => page.evaluate(() => (window as unknown as { mend: () => void }).mend());

/** A draft as the backup keeps it in IndexedDB. */
export interface StoredDraft { id: string; savedAt: number; title: string; xml: string; required: string[] }

/** Runs on the drafts the page's browser keeps: lists them, or puts one there. */
export function drafts(page: Page, put?: StoredDraft): Promise<StoredDraft[]> {
  return page.evaluate(draft => new Promise<StoredDraft[]>((resolve, reject) => {
    const request = indexedDB.open('nodeset-js', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('drafts', 'readwrite');
      const store = transaction.objectStore('drafts');
      if (draft) store.put(draft);
      const all = store.getAll();
      transaction.oncomplete = () => { db.close(); resolve(all.result as StoredDraft[]); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), put);
}
