// Variables from a signal list: engineers keep them in spreadsheets, one row
// per signal. A CSV file (comma, semicolon or tab, with a header row) becomes
// instance declarations below a type or children below an object, in one
// step that undo takes back as a whole and that a bad row stops entirely.
//
// Columns, found by their header (case does not matter): Name (required),
// DataType (a DataType's name, default BaseDataType), Kind (Variable or
// Property, default Variable), ModellingRule (Mandatory or Optional, for
// declarations of a type; default Mandatory), Description, Value.

import { RULE } from './address-space';
import type { AddressSpace } from './address-space';
import { DeclarationKind, EditError, ModelEditor } from './edit';
import { uaKey } from './model';

export interface SignalRow {
  line: number;
  name: string;
  dataType?: string;
  kind?: string;
  rule?: string;
  description?: string;
  value?: string;
}

/** The rows of a CSV text; throws EditError naming the line of what it cannot read. */
export function parseSignals(text: string): SignalRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const headerIndex = lines.findIndex(l => l.trim() !== '');
  if (headerIndex < 0) throw new EditError('The file is empty.');
  const header = lines[headerIndex];
  const delimiter = [';', '\t', ','].map(d => ({ d, n: split(header, d).length })).sort((a, b) => b.n - a.n)[0].d;
  const columns = split(header, delimiter).map(c => c.trim().toLowerCase());
  const at = (names: string[]) => columns.findIndex(c => names.includes(c));
  const name = at(['name', 'browsename']);
  if (name < 0) throw new EditError(`Line ${headerIndex + 1}: the header needs a column Name.`);
  const index = {
    dataType: at(['datatype', 'data type', 'type']),
    kind: at(['kind', 'nodeclass']),
    rule: at(['modellingrule', 'modelingrule', 'rule']),
    description: at(['description']),
    value: at(['value', 'default', 'defaultvalue']),
  };
  const rows: SignalRow[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const cells = split(lines[i], delimiter);
    const cell = (k: number) => (k >= 0 && k < cells.length && cells[k].trim() !== '' ? cells[k].trim() : undefined);
    const n = cell(name);
    if (!n) throw new EditError(`Line ${i + 1}: no name.`);
    rows.push({
      line: i + 1, name: n, dataType: cell(index.dataType), kind: cell(index.kind),
      rule: cell(index.rule), description: cell(index.description), value: cell(index.value),
    });
  }
  if (rows.length === 0) throw new EditError('The file has a header but no rows.');
  return rows;
}

/** Splits one line at the delimiter, with "quoted" cells that may hold it and "" for a quote. */
function split(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell.trim() === '') quoted = true;
    else if (c === delimiter) { cells.push(cell); cell = ''; }
    else cell += c;
  }
  cells.push(cell);
  return cells;
}

/**
 * Adds the rows as variables below <paramref name="parent"/>, as one step.
 * Returns the keys of the new nodes.
 */
export function addSignals(editor: ModelEditor, space: () => AddressSpace, parent: string, rows: SignalRow[]): string[] {
  return editor.batch(() => rows.map(row => {
    try {
      const kind: DeclarationKind = /^prop/i.test(row.kind ?? '') ? 'Property' : 'Variable';
      if (row.kind && !/^(prop|var)/i.test(row.kind)) throw new EditError(`Kind '${row.kind}' is neither Variable nor Property.`);
      const rule = !row.rule || /^mand/i.test(row.rule) ? RULE.Mandatory
        : /^opt/i.test(row.rule) ? RULE.Optional
        : (() => { throw new EditError(`ModellingRule '${row.rule}' is neither Mandatory nor Optional.`); })();
      const key = editor.addDeclaration(parent, kind, row.name, rule);
      editor.setDataType(key, row.dataType ? dataTypeNamed(space(), row.dataType) : uaKey(24));
      if (row.description) editor.setDescription(key, row.description);
      if (row.value !== undefined) editor.setValue(key, row.value);
      return key;
    } catch (e) {
      if (e instanceof EditError) throw new EditError(`Line ${row.line} (${row.name}): ${e.message}`);
      throw e;
    }
  }));
}

/** A DataType by its name; the edited model's own first, the base model's otherwise. */
function dataTypeNamed(space: AddressSpace, name: string): string {
  const matches = space.ofClass('DataType').filter(n => n.browseName.name.toLowerCase() === name.toLowerCase());
  if (matches.length === 0) throw new EditError(`There is no DataType named '${name}'.`);
  return (matches.find(n => !n.id.startsWith('http://opcfoundation.org/UA/|')) ?? matches[0]).id;
}
