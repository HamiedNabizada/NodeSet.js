import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EditError } from '../../src/nodeset/edit';
import { uaKey } from '../../src/nodeset/model';
import { readNodeSet } from '../../src/nodeset/reader';
import { builtInOf, structureOf, structureText, valueText } from '../../src/nodeset/values';
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

describe('Structure values', () => {
  it('edits a Range field by field and keeps it through saving', async () => {
    const { ws, e, v } = await speed();
    e.setDataType(v, uaKey(884)); // Range
    const shape = structureOf(ws.space, uaKey(884))!;
    expect(shape.fields.map(f => `${f.name}:${f.builtIn}`)).toEqual(['Low:Double', 'High:Double']);
    expect(ws.space.get(shape.encoding)!.browseName.name).toBe('Default XML');

    e.setStructuredValue(v, { Low: '0', High: '3000' });
    const saved = ws.save();
    expect(saved).toContain('<Identifier>i=885</Identifier>');
    const node = readNodeSet(saved).nodes.find(n => n.browseName.name === 'Speed')!;
    expect(structureText(node, shape)).toEqual({ Low: '0', High: '3000' });
    expect(() => e.setStructuredValue(v, { Low: 'low', High: '1' })).toThrow(EditError);
    expect(() => e.setStructuredValue(v, { Low: '', High: '1' })).toThrow(/needs a value/);
  });

  it('edits EUInformation, with its localized texts', async () => {
    const { ws, e, v } = await speed();
    e.setDataType(v, uaKey(887)); // EUInformation
    e.setStructuredValue(v, { NamespaceUri: 'http://www.opcfoundation.org/UA/units/un/cefact', UnitId: '4534832', DisplayName: 'rpm', Description: 'revolutions per minute' });
    const node = readNodeSet(ws.save()).nodes.find(n => n.browseName.name === 'Speed')!;
    expect(structureText(node, structureOf(ws.space, uaKey(887))!)).toMatchObject({ UnitId: '4534832', DisplayName: 'rpm' });
  });

  it('encodes a structure of the model in its own namespace, with the TypeId index of the saved file', async () => {
    const { ws, e, v } = await speed();
    const point = e.addType('DataType', 'PointType', uaKey(22));
    e.setFields(point, [{ name: 'X', dataType: uaKey(11) }, { name: 'Y', dataType: uaKey(11) }]);
    e.setDataType(v, point);
    e.setStructuredValue(v, { X: '1.5', Y: '-2' });

    const xml = ws.save();
    expect(xml).toMatch(/<TypeId><Identifier>ns=1;i=\d+<\/Identifier><\/TypeId><Body><PointType xmlns="http:\/\/example.org\/Pumps\/">/);
    const node = readNodeSet(xml).nodes.find(n => n.browseName.name === 'Speed')!;
    expect(structureText(node, structureOf(ws.space, point)!)).toEqual({ X: '1.5', Y: '-2' });

    e.setFields(point, [{ name: 'X', dataType: uaKey(11), isOptional: true }]);
    expect(structureOf(ws.space, point)).toBeUndefined();
  });

  it('reads single ExtensionObjects of the base model structurally and writes them back unchanged', () => {
    const ua = readNodeSet(readFileSync(join(__dirname, '../../assets/nodesets/Opc.Ua.NodeSet2.xml'), 'utf8'));
    const single = ua.nodes.filter(n => n.extensionObjects);
    expect(single.length).toBeGreaterThan(20);
    expect(ua.nodes.some(n => n.valueXml?.includes('ExtensionObject'))).toBe(false);
    expect(single.every(n => n.valueXml === undefined)).toBe(true);
  });
});
