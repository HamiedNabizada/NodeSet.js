import { addSignals, parseSignals } from '../../src/nodeset/csv';
import { RULE } from '../../src/nodeset/address-space';
import { EditError } from '../../src/nodeset/edit';
import { uaKey } from '../../src/nodeset/model';
import { Workspace } from '../../src/workspace';

async function pumpType() {
  const ws = new Workspace();
  await ws.create('http://example.org/Signals/');
  const pump = ws.editor!.addType('ObjectType', 'PumpType');
  return { ws, pump };
}

describe('Variables from a signal list', () => {
  it('reads semicolons, quotes, a byte order mark and columns in any order', () => {
    const rows = parseSignals('﻿Description;Name;DataType;Value\n"Speed; in rpm";Speed;Double;1500\n\n;Running;Boolean;\n');
    expect(rows.map(r => [r.name, r.dataType, r.description, r.value])).toEqual([
      ['Speed', 'Double', 'Speed; in rpm', '1500'],
      ['Running', 'Boolean', undefined, undefined],
    ]);
    expect(parseSignals('name,type\nA,Int32').map(r => r.dataType)).toEqual(['Int32']);
    expect(() => parseSignals('Type;Value\nDouble;1')).toThrow(/column Name/);
  });

  it('adds the rows as declarations of a type, in one step undo takes back', async () => {
    const { ws, pump } = await pumpType();
    const rows = parseSignals('Name;DataType;Kind;ModellingRule;Description;Value\n'
      + 'Speed;Double;Variable;Mandatory;Current speed;1500\n'
      + 'SerialNumber;String;Property;Optional;;P-17\n');

    const keys = addSignals(ws.editor!, () => ws.space, pump, rows);

    const [speed, serial] = keys.map(k => ws.space.get(k)!);
    expect(speed.dataType).toBe(uaKey(11));
    expect(speed.description[0].text).toBe('Current speed');
    expect(speed.valueXml).toContain('1500');
    expect(ws.space.out(serial.id, uaKey(37)).map(e => e.target)).toContain(RULE.Optional);
    expect(ws.space.in(serial.id, uaKey(46)).map(e => e.source)).toContain(pump); // HasProperty from the type

    ws.editor!.undo();
    expect(keys.every(k => ws.space.get(k) === undefined)).toBe(true);
  });

  it('stops at a bad row and keeps none of the rows before it', async () => {
    const { ws, pump } = await pumpType();
    const before = ws.space.children(ws.space.get(pump)!).length;
    const rows = parseSignals('Name;DataType\nSpeed;Double\nMood;Happiness\n');

    expect(() => addSignals(ws.editor!, () => ws.space, pump, rows)).toThrow(EditError);
    expect(() => addSignals(ws.editor!, () => ws.space, pump, rows)).toThrow(/Line 3 \(Mood\): There is no DataType named 'Happiness'/);
    expect(ws.space.children(ws.space.get(pump)!).length).toBe(before);
  });
});
