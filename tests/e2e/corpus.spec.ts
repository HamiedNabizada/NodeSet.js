import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Corpus, SPECIFICATIONS } from './corpus';
import { answer, openNodeSet, selectEach, typeList, watchErrors } from './modeler';

// Each specification of the corpus: every type shown once, one edit and its undo, save.
const root = process.env.UA_NODESET;
let corpus: Corpus | undefined;

for (const specification of SPECIFICATIONS) {
  test(`shows, edits and saves ${specification.slice(specification.lastIndexOf('/') + 1)}`, async ({ page }) => {
    test.skip(!root, 'UA_NODESET names no clone of OPCFoundation/UA-Nodeset.');
    corpus ??= new Corpus(root!);
    const file = join(root!, specification);
    const errors = watchErrors(page);

    await openNodeSet(page, file, corpus.required(file));
    await expect(page.locator('.status')).not.toContainText('missing');

    const { count, emptied } = await selectEach(page);
    expect(count).toBeGreaterThan(0);
    expect(emptied).toEqual([]);

    await page.locator('button[title="New ObjectType"]').click();
    await answer(page, 'SmokeTestType');
    await expect(typeList(page).filter({ hasText: 'SmokeTestType' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(typeList(page).filter({ hasText: 'SmokeTestType' })).toHaveCount(0);

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Save NodeSet/ }).click()]);
    expect(await readFile(await download.path(), 'utf8')).toContain('<UANodeSet');
    expect(errors).toEqual([]);
  });
}
