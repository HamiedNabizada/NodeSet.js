import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
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

  // A text written straight into the interface stayed English in a German
  // browser ("Part of …; read only.", "optional, not set", "Load DI/"). Text
  // between tags, the props a user reads, and any other string of two words
  // or more go through t(); OPC UA terms, key names and the like may stay.
  it('shows no text that passes t() by', () => {
    const ALLOWED = new Set([
      'NodeSet.js', 'OK', 'Namespace', 'Version', 'NodeId', 'TypeDefinition', 'ModellingRule', 'DataType', 'ValueRank', 'InverseName',
      'AccessLevel', 'UserAccessLevel', 'Historizing', 'MinimumSamplingInterval',
      'Variable (HasComponent)', 'Property (HasProperty)', 'Object (HasComponent)', 'Method (HasComponent)',
      'Ctrl+S', 'Ctrl+Z', 'Ctrl+Y, Ctrl+Shift+Z',
      // A font, and an error for the programmer who calls the library.
      'Segoe UI, Arial, sans-serif', "Unknown node '…'.",
    ]);
    const PROPS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'label']);
    const callee = (n: ts.Node) => (ts.isCallExpression(n.parent) && ts.isIdentifier(n.parent.expression) ? n.parent.expression.text : undefined);
    const compared = (n: ts.Node) => ts.isBinaryExpression(n.parent)
      && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.parent.operatorToken.kind);
    const found: string[] = [];
    for (const dir of ['ui', 'modeler']) {
      for (const file of readdirSync(join(__dirname, '../../src', dir)).filter(f => /\.tsx?$/.test(f) && f !== 'de.ts')) {
        const path = join(__dirname, '../../src', dir, file);
        const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const report = (text: string) => { if (!ALLOWED.has(text)) found.push(`${file}: ${text}`); };
        // read: the string is shown as it is (JSX text, a prop a user reads, a JSX child); skip: an attribute such as className.
        const visit = (node: ts.Node, read: boolean, skip: boolean) => {
          if (ts.isJsxText(node) && /[A-Za-z]{2}/.test(node.text)) report(node.text.trim());
          if (ts.isJsxAttribute(node)) { read = PROPS.has(node.name.getText(source)); skip = !read; }
          if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) read = true;
          if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
            const text = ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map(s => s.literal.text)].join('…') : node.text;
            const passed = callee(node) === 't' || callee(node) === 'msg' || compared(node) || ts.isImportDeclaration(node.parent) || text.startsWith('<');
            if (!passed && !skip && (read ? !callee(node) && /[A-Za-z]{2}/.test(text) : /[A-Za-z]{2,} [A-Za-z]{2,}/.test(text))) report(text);
          }
          ts.forEachChild(node, child => visit(child, read, skip));
        };
        visit(source, false, false);
      }
    }
    expect(found).toEqual([]);
  });

  it('writes no dash where German would pause', () => {
    const dashes = Object.values(de).filter(v => / [-–—] /.test(v) || v.includes('—'));
    expect(dashes).toEqual([]);
  });
});
