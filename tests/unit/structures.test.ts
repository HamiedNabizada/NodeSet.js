import { uaKey } from '../../src/nodeset/model';
import { readNodeSet } from '../../src/nodeset/reader';
import { StructValue, structShape, structureValues } from '../../src/nodeset/structures';
import { Workspace } from '../../src/workspace';

/** A model with an enumeration, a point, and a shape made of them. */
async function model() {
  const ws = new Workspace();
  await ws.create('http://example.org/Shapes/');
  const e = ws.editor!;
  const color = e.addType('DataType', 'ColorEnum', uaKey(29));
  e.setFields(color, [{ name: 'Red', value: 0 }, { name: 'Green', value: 1 }, { name: 'Blue', value: 2 }]);
  const point = e.addType('DataType', 'PointType', uaKey(22));
  e.setFields(point, [{ name: 'X', dataType: uaKey(11) }, { name: 'Y', dataType: uaKey(11) }]);
  const shape = e.addType('DataType', 'ShapeType', uaKey(22));
  e.setFields(shape, [
    { name: 'Name', dataType: uaKey(12) },
    { name: 'Color', dataType: color },
    { name: 'Corners', dataType: point, valueRank: 1 },
    { name: 'Center', dataType: point, isOptional: true },
    { name: 'Tags', dataType: uaKey(12), valueRank: 1 },
  ]);
  const holder = e.addType('ObjectType', 'DrawingType');
  const v = e.addDeclaration(holder, 'Variable', 'Figure');
  return { ws, e, color, point, shape, v };
}

/** The value read back from the saved file. */
function reread(ws: Workspace, name: string) {
  const node = readNodeSet(ws.save()).nodes.find(n => n.browseName.name === name)!;
  return node;
}

describe('Structure values of any shape', () => {
  it('writes well-formed XML whatever the namespace URI holds, and leaves names XML cannot carry alone', async () => {
    const ws = new Workspace();
    await ws.create('http://example.org/Shapes?kind=a&b="c"/');
    const e = ws.editor!;
    const point = e.addType('DataType', 'PointType', uaKey(22));
    e.setFields(point, [{ name: 'X', dataType: uaKey(11) }, { name: 'Y', dataType: uaKey(11) }]);
    const holder = e.addType('ObjectType', 'HolderType');
    const v = e.addDeclaration(holder, 'Variable', 'Where');
    e.setDataType(v, point);
    e.setStructureValue(v, [{ X: '1', Y: '2' }]);

    const node = reread(ws, 'Where');
    expect(structureValues(ws.space, node, structShape(ws.space, point)!)!.items[0]).toEqual({ X: '1', Y: '2' });

    const odd = e.addType('DataType', 'OddType', uaKey(22));
    e.setFields(odd, [{ name: 'a b', dataType: uaKey(11) }]);
    expect(structShape(ws.space, odd)).toBeUndefined();
  });

  it('knows which structures it edits', async () => {
    const { ws, shape } = await model();
    const s = structShape(ws.space, shape)!;
    expect(s.fields.map(f => `${f.name}:${f.kind}${f.array ? '[]' : ''}${f.optional ? '?' : ''}`))
      .toEqual(['Name:builtIn', 'Color:enum', 'Corners:structure[]', 'Center:structure?', 'Tags:builtIn[]']);
    expect(structShape(ws.space, uaKey(884))!.fields.map(f => f.name)).toEqual(['Low', 'High']); // Range
  });

  it('writes nested structures, enumerations, arrays and optional fields, and reads them back', async () => {
    const { ws, e, shape, v } = await model();
    e.setDataType(v, shape);
    const value: StructValue = {
      Name: 'Triangle', Color: 'Green',
      Corners: [{ X: '0', Y: '0' }, { X: '4', Y: '0' }, { X: '0', Y: '3' }],
      Center: { X: '1.5', Y: '1' },
      Tags: 'a; b',
    };
    e.setStructureValue(v, [value]);

    const xml = ws.save();
    expect(xml).toContain('<EncodingMask>1</EncodingMask>');
    expect(xml).toContain('<Color>Green_1</Color>');
    expect(xml).toMatch(/<Corners><PointType><X>0<\/X><Y>0<\/Y><\/PointType>/);
    const node = reread(ws, 'Figure');
    const back = structureValues(ws.space, node, structShape(ws.space, shape)!)!;
    expect(back.list).toBe(false);
    expect(back.items[0]).toEqual(value);
  });

  it('leaves an absent optional field out', async () => {
    const { ws, e, shape, v } = await model();
    e.setDataType(v, shape);
    e.setStructureValue(v, [{ Name: 'Line', Color: 'Red', Corners: [], Tags: '' }]);
    const xml = ws.save();
    expect(xml).toContain('<EncodingMask>0</EncodingMask>');
    expect(xml).not.toContain('<Center>');
    const back = structureValues(ws.space, reread(ws, 'Figure'), structShape(ws.space, shape)!)!;
    expect(back.items[0].Center).toBeUndefined();
  });

  it('writes a union with its switch field', async () => {
    const { ws, e, v } = await model();
    const id = e.addType('DataType', 'IdUnion', uaKey(12756));
    e.setFields(id, [{ name: 'Number', dataType: uaKey(7) }, { name: 'Text', dataType: uaKey(12) }]);
    e.setDataType(v, id);
    e.setStructureValue(v, [{ Text: 'P-100' }]);

    expect(ws.save()).toMatch(/<SwitchField>2<\/SwitchField><Text>P-100<\/Text>/);
    const back = structureValues(ws.space, reread(ws, 'Figure'), structShape(ws.space, id)!)!;
    expect(back.items[0]).toEqual({ Text: 'P-100' });
  });

  it('writes an array of structures as a list of ExtensionObjects', async () => {
    const { ws, e, v } = await model();
    e.setDataType(v, uaKey(884)); // Range
    e.setValueRank(v, 1);
    e.setStructureValue(v, [{ Low: '0', High: '10' }, { Low: '20', High: '30' }]);
    const back = structureValues(ws.space, reread(ws, 'Figure'), structShape(ws.space, uaKey(884))!)!;
    expect(back.list).toBe(true);
    expect(back.items).toEqual([{ Low: '0', High: '10' }, { Low: '20', High: '30' }]);
  });

  it('writes a structure that contains itself', async () => {
    const { ws, e, v } = await model();
    const tree = e.addType('DataType', 'TreeNode', uaKey(22));
    e.setFields(tree, [{ name: 'Label', dataType: uaKey(12) }, { name: 'Children', dataType: tree, valueRank: 1 }]);
    e.setDataType(v, tree);
    const value: StructValue = { Label: 'root', Children: [{ Label: 'a', Children: [] }, { Label: 'b', Children: [{ Label: 'b1', Children: [] }] }] };
    e.setStructureValue(v, [value]);
    const back = structureValues(ws.space, reread(ws, 'Figure'), structShape(ws.space, tree)!)!;
    expect(back.items[0]).toEqual(value);
  });

  it('names the field of a wrong value', async () => {
    const { e, shape, v } = await model();
    e.setDataType(v, shape);
    expect(() => e.setStructureValue(v, [{ Name: 'x', Color: 'Green', Corners: [{ X: 'left', Y: '0' }], Tags: '' }])).toThrow(/Corners\[0\]\.X/);
    expect(() => e.setStructureValue(v, [{ Name: 'x', Color: 'Purple', Corners: [], Tags: '' }])).toThrow(/Purple/);
  });
});
