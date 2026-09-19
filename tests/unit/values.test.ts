import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EditError } from '../../src/nodeset/edit';
import { uaKey } from '../../src/nodeset/model';
import { readNodeSet } from '../../src/nodeset/reader';
import { builtInOf, valueText } from '../../src/nodeset/values';
import { Workspace } from '../../src/workspace';

async function speed() {
  const ws = new Workspace();
  await ws.create('http://example.org/Pumps/');
  const e = ws.editor!;
  const pump = e.addType('ObjectType', 'PumpType');
  const v = e.addDeclaration(pump, 'Variable', 'Speed');
  return { ws, e, v };
}

describe('Values', () => {
  it('knows the built-in type behind a DataType', async () => {
    const { ws } = await speed();

    expect(builtInOf(ws.space, uaKey(290))).toBe('Double'); // Duration
    expect(builtInOf(ws.space, uaKey(294))).toBe('DateTime'); // UtcTime
    expect(builtInOf(ws.space, uaKey(852))).toBe('Int32'); // ServerState, an enumeration
    expect(builtInOf(ws.space, uaKey(884))).toBeUndefined(); // Range, a structure
  });

  it('writes scalars and arrays that survive saving, and checks the text', async () => {
    const { ws, e, v } = await speed();
    e.setDataType(v, uaKey(11));
    e.setValue(v, '12.5');
    const tags = e.addDeclaration(v, 'Property', 'Tags');
    e.setDataType(tags, uaKey(12));
    e.setValueRank(tags, 1);
    e.setValue(tags, 'a; b & c');

    const saved = readNodeSet(ws.save());
    const speedNode = saved.nodes.find(n => n.browseName.name === 'Speed')!;
    const tagsNode = saved.nodes.find(n => n.browseName.name === 'Tags')!;
    expect(valueText(speedNode, 'Double')).toBe('12.5');
    expect(valueText(tagsNode, 'String')).toBe('a; b & c');
    expect(() => e.setValue(v, 'fast')).toThrow(EditError);
    e.setDataType(v, uaKey(3)); // Byte
    expect(() => e.setValue(v, '300')).toThrow(/range of Byte/);
    e.setValue(v, '');
    expect(ws.space.get(v)!.valueXml).toBeUndefined();
  });

  it('reads the values of the base model, and leaves structures alone', () => {
    const ua = readNodeSet(readFileSync(join(__dirname, '../../assets/nodesets/Opc.Ua.NodeSet2.xml'), 'utf8'));
    // A Classification property of the diagnostics model: an enumeration, encoded as Int32 1.
    const classification = ua.nodes.find(n => n.id.endsWith('|i=18732'))!;
    const enumStrings = ua.nodes.find(n => n.browseName.name === 'EnumStrings' && n.valueXml?.includes('ListOfLocalizedText'))!;

    expect(valueText(classification, 'Int32')).toBe('1');
    expect(valueText(enumStrings, 'LocalizedText')).toMatch(/; /);
    expect(valueText({ ...classification, valueXml: '<ExtensionObject><Body/></ExtensionObject>' }, 'Int32')).toBeNull();
  });
});
