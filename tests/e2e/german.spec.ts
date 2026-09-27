import { expect, test } from '@playwright/test';
import { answer } from './modeler';

// The interface follows the browser's language; here a German one.
test.use({ locale: 'de-DE' });

test('speaks German in a German browser, the messages of the core included', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Neues Modell…' })).toBeVisible();

  await page.getByRole('button', { name: 'Neues Modell…' }).click();
  await page.locator('.inline-form input').fill('http://example.org/Anlage/');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.locator('.status')).toContainText('Knoten von http://example.org/Anlage/');

  await page.locator('button[title="Neuer ObjectType"]').click();
  await answer(page, 'PumpType');
  await expect(page.locator('.status')).toContainText('Geändert.');

  // A message of the core: a model URI that is none.
  await page.getByRole('button', { name: 'Neues Modell…' }).click();
  await page.locator('.inline-form input').fill('keine Adresse');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.inline-form').getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.locator('.status')).toContainText("'keine Adresse' ist keine URI.");
  await expect(page.getByRole('button', { name: /^NodeSet speichern/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Prüfung: \d+ Fehler/ })).toBeVisible();
});
