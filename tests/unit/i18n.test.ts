import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES } from '../../src/nodeset/checks';
import { EditError } from '../../src/nodeset/edit';
import { msg } from '../../src/nodeset/message';
import { de } from '../../src/ui/de';
import { setLanguage, t, translate } from '../../src/ui/i18n';

describe('The interface in German', () => {
  afterEach(() => setLanguage('en'));

  it('stays English unless the language is German, and fills in the values', () => {
    expect(t('Save NodeSet')).toBe('Save NodeSet');
    expect(t('{0} nodes of {1}.', 12, 'http://example.org/')).toBe('12 nodes of http://example.org/.');

    setLanguage('de');
    expect(t('Save NodeSet')).toBe('NodeSet speichern');
    expect(t('{0} nodes of {1}.', 12, 'http://example.org/')).toBe('12 Knoten von http://example.org/.');
  });

  it('keeps a message of the core English and hands the interface its template', () => {
    const error = new EditError(msg`'${'Pump'}' already has a child named '${'Speed'}'.`);

    expect(error.message).toBe("'Pump' already has a child named 'Speed'.");
    setLanguage('de');
    expect(translate(error)).toBe("'Pump' hat schon einen Kindknoten namens 'Speed'.");
  });

  // Every text the interface shows, and every message of the core, has a
  // German entry; and no entry is left over from a text that is gone.
  it('has a German entry for every text, and none left over', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap(d => d.isDirectory() ? files(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []);
    const keys = new Set<string>();
    for (const file of files(join(__dirname, '../../src'))) {
      if (file.endsWith('de.ts')) continue;
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
      for (const m of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(m[1].replace(/\\"/g, '"'));
      for (const m of source.matchAll(/\bmsg`((?:[^`\\]|\\.)*)`/g)) {
        let i = 0;
        keys.add(m[1].replace(/\$\{[^}]*\}/g, () => `{${i++}}`));
      }
    }
    for (const sentence of Object.values(RULES)) keys.add(sentence);
    const missing = [...keys].filter(k => !(k in de));
    const unused = Object.keys(de).filter(k => !keys.has(k));
    expect(missing).toEqual([]);
    expect(unused).toEqual([]);
  });

  it('writes no dash where German would pause', () => {
    const dashes = Object.values(de).filter(v => / [-–—] /.test(v) || v.includes('—'));
    expect(dashes).toEqual([]);
  });
});
