import { REF, RULE } from '../../src/nodeset/address-space';
import { EditError } from '../../src/nodeset/edit';
import { uaKey } from '../../src/nodeset/model';
import { readNodeSet } from '../../src/nodeset/reader';
import { Workspace } from '../../src/workspace';

const PUMPS = 'http://example.org/Pumps/';

async function pumpModel() {
  const ws = new Workspace();
  await ws.create(PUMPS);
  const editor = ws.editor!;
  const pump = editor.addType('ObjectType', 'PumpType');
  const speed = editor.addDeclaration(pump, 'Variable', 'Speed');
  const serial = editor.addDeclaration(pump, 'Property', 'SerialNumber', RULE.Optional);
  const start = editor.addDeclaration(pump, 'Method', 'Start');
  return { ws, editor, pump, speed, serial, start };
}

describe('Editing a model', () => {
  it('creates types and declarations with NodeIds, references and modelling rules', async () => {
    const { ws, pump, speed, serial, start } = await pumpModel();
    const space = ws.space;
    const pumpNode = space.get(pump)!;

    expect(pump).toBe(`${PUMPS}|i=1000`);
    expect(space.supertype(pumpNode)?.browseName.name).toBe('BaseObjectType');
    expect(space.children(pumpNode).map(c => [c.node.browseName.name, c.edge.type])).toEqual([
      ['Speed', REF.HasComponent], ['SerialNumber', REF.HasProperty], ['Start', REF.HasComponent],
    ]);
    expect(space.typeDefinition(space.get(speed)!)?.browseName.name).toBe('BaseDataVariableType');
    expect(space.typeDefinition(space.get(serial)!)?.browseName.name).toBe('PropertyType');
    expect(space.modellingRule(space.get(serial)!)).toBe(RULE.Optional);
    expect(space.get(start)!.nodeClass).toBe('Method');
    expect(space.get(speed)!.parent).toBe(pump);
  });

  it('refuses duplicate child names and wrong kinds of types', async () => {
    const { editor, pump, speed } = await pumpModel();

    expect(() => editor.addDeclaration(pump, 'Variable', 'Speed')).toThrow(EditError);
    expect(() => editor.setTypeDefinition(speed, uaKey(58))).toThrow(/VariableType/);
    expect(() => editor.addType('ObjectType', 'X', uaKey(63))).toThrow(/supertype must be a ObjectType/);
    // A failed change leaves nothing behind.
    expect(editor.file.nodes).toHaveLength(4);
  });

  it('changes supertype, type definition, data type and rule', async () => {
    const { ws, editor, pump, speed } = await pumpModel();
    const device = editor.addType('ObjectType', 'DeviceBaseType');
    editor.setSupertype(pump, device);
    editor.setTypeDefinition(speed, uaKey(2368)); // AnalogItemType
    editor.setDataType(speed, uaKey(11)); // Double
    editor.setModellingRule(speed, RULE.Optional);
    editor.rename(speed, 'RotationalSpeed');
    const space = ws.space;

    expect(space.supertype(space.get(pump)!)?.id).toBe(device);
    expect(space.typeDefinition(space.get(speed)!)?.browseName.name).toBe('AnalogItemType');
    expect(space.get(speed)!.dataType).toBe(uaKey(11));
    expect(space.modellingRule(space.get(speed)!)).toBe(RULE.Optional);
    expect(space.get(speed)!.browseName.name).toBe('RotationalSpeed');
    expect(() => editor.setSupertype(device, pump)).toThrow(/is a subtype of/);
  });

  it('deletes a declaration with what it holds, and undoes and redoes', async () => {
    const { ws, editor, pump, speed } = await pumpModel();
    const inner = editor.addDeclaration(speed, 'Property', 'EURange');
    editor.delete(speed);

    expect(ws.space.get(speed)).toBeUndefined();
    expect(ws.space.get(inner)).toBeUndefined();
    expect(ws.space.children(ws.space.get(pump)!).map(c => c.node.browseName.name)).toEqual(['SerialNumber', 'Start']);
    expect(() => editor.delete(pump)).not.toThrow();

    editor.undo();
    editor.undo();
    expect(ws.space.get(inner)?.browseName.name).toBe('EURange');
    editor.redo();
    expect(ws.space.get(speed)).toBeUndefined();
  });

  it('keeps a supertype that still has subtypes', async () => {
    const { editor, pump } = await pumpModel();
    editor.addType('ObjectType', 'CentrifugalPumpType', pump);

    expect(() => editor.delete(pump)).toThrow(/has subtypes/);
  });

  it('writes a model that reads back the same', async () => {
    const { ws } = await pumpModel();
    const again = readNodeSet(ws.save());

    expect(again.models[0].modelUri).toBe(PUMPS);
    expect(again.nodes.map(n => n.browseName.name)).toEqual(['PumpType', 'Speed', 'SerialNumber', 'Start']);
    expect(again.nodes[1].references).toContainEqual({ type: REF.HasModellingRule, isForward: true, target: RULE.Mandatory });
  });
});

describe('Editing methods and data types', () => {
  it('gives a method InputArguments and OutputArguments that survive saving', async () => {
    const { ws, editor, start } = await pumpModel();
    editor.setArguments(start, 'Input', [{ name: 'Speed', dataType: uaKey(11), valueRank: -1, arrayDimensions: [], description: { text: 'Target speed' } }]);
    editor.setArguments(start, 'Output', [{ name: 'Accepted', dataType: uaKey(1), valueRank: -1, arrayDimensions: [] }]);

    const props = ws.space.children(ws.space.get(start)!).map(c => c.node);
    expect(props.map(p => p.browseName)).toEqual([
      { namespaceUri: 'http://opcfoundation.org/UA/', name: 'InputArguments' },
      { namespaceUri: 'http://opcfoundation.org/UA/', name: 'OutputArguments' },
    ]);
    const again = readNodeSet(ws.save()).nodes.find(n => n.browseName.name === 'InputArguments')!;
    expect(again.arguments).toEqual([{ name: 'Speed', dataType: uaKey(11), valueRank: -1, arrayDimensions: [], description: { text: 'Target speed' } }]);

    editor.setArguments(start, 'Input', []);
    expect(ws.space.children(ws.space.get(start)!).map(c => c.node.browseName.name)).toEqual(['OutputArguments']);
  });

  it('defines structure fields and enumeration values with EnumStrings', async () => {
    const { ws, editor } = await pumpModel();
    const settings = editor.addType('DataType', 'PumpSettingsDataType');
    editor.setFields(settings, [{ name: 'Speed', dataType: uaKey(11) }, { name: 'Tags', dataType: uaKey(12), valueRank: 1 }]);
    const mode = editor.addType('DataType', 'PumpModeEnum', uaKey(29));
    editor.setFields(mode, [{ name: 'Off' }, { name: 'Manual' }, { name: 'Automatic' }]);
    editor.rename(mode, 'PumpMode');

    const saved = readNodeSet(ws.save());
    const s = saved.nodes.find(n => n.browseName.name === 'PumpSettingsDataType')!;
    const m = saved.nodes.find(n => n.browseName.name === 'PumpMode')!;
    expect(s.definition!.fields.map(f => [f.name, f.dataType, f.valueRank])).toEqual([['Speed', uaKey(11), -1], ['Tags', uaKey(12), 1]]);
    expect(m.definition!.name.name).toBe('PumpMode');
    expect(m.definition!.fields.map(f => [f.name, f.value])).toEqual([['Off', 0], ['Manual', 1], ['Automatic', 2]]);
    expect(saved.nodes.find(n => n.browseName.name === 'EnumStrings')!.valueXml).toContain('<Text>Automatic</Text>');
    expect(() => editor.setFields(mode, [{ name: 'A' }, { name: 'A' }])).toThrow(/Two fields/);
  });
});
