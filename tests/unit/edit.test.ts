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

describe('Structure encodings', () => {
  it('gives a structure its encodings once and deletes them with it', async () => {
    const { ws, editor } = await pumpModel();
    const settings = editor.addType('DataType', 'PumpSettingsDataType');
    editor.setFields(settings, [{ name: 'Speed', dataType: uaKey(11) }]);
    const space = ws.space;
    const encodings = space.out(settings, uaKey(38), false).map(e => space.get(e.target)!);

    expect(encodings.map(e => e.browseName.name).sort()).toEqual(['Default Binary', 'Default JSON', 'Default XML']);
    expect(encodings.every(e => e.browseName.namespaceUri === 'http://opcfoundation.org/UA/' && space.typeDefinition(e)?.id === uaKey(76))).toBe(true);
    const before = ws.editable!.nodes.length;
    editor.delete(settings);
    expect(ws.editable!.nodes.length).toBe(before - 4);
    // An enumeration gets none.
    const mode = editor.addType('DataType', 'ModeEnum', uaKey(29));
    expect(ws.space.out(mode, uaKey(38), false)).toEqual([]);
  });
});

describe('Enumeration values', () => {
  it('uses EnumValues when the values have gaps, and EnumStrings again when they do not', async () => {
    const { ws, editor } = await pumpModel();
    const mode = editor.addType('DataType', 'ModeEnum', uaKey(29));
    editor.setFields(mode, [{ name: 'Off', value: 0 }, { name: 'Auto', value: 10, description: 'Automatic' }]);
    const props = () => ws.space.children(ws.space.get(mode)!).map(c => c.node);

    expect(props().map(p => p.browseName.name)).toEqual(['EnumValues']);
    expect(props()[0].dataType).toBe(uaKey(7594));
    expect(props()[0].valueXml).toContain('<Value>10</Value><DisplayName><Text>Auto</Text></DisplayName><Description><Text>Automatic</Text>');
    expect(ws.space.get(mode)!.definition!.fields.map(f => f.value)).toEqual([0, 10]);

    editor.setFields(mode, [{ name: 'Off' }, { name: 'On' }]);
    expect(props().map(p => p.browseName.name)).toEqual(['EnumStrings']);
    expect(() => editor.setFields(mode, [{ name: 'A', value: 1 }, { name: 'B', value: 1 }])).toThrow(/same/);
  });
});

describe('OptionSets and unions', () => {
  it('names the bits of an OptionSet with OptionSetValues and checks them against the integer', async () => {
    const { ws, editor } = await pumpModel();
    const flags = editor.addType('DataType', 'PumpFlags', uaKey(3)); // Byte
    editor.setFields(flags, [{ name: 'Running', value: 0 }, { name: 'Fault', value: 2 }]);

    const saved = readNodeSet(ws.save());
    const d = saved.nodes.find(n => n.browseName.name === 'PumpFlags')!;
    const values = saved.nodes.find(n => n.browseName.name === 'OptionSetValues')!;
    expect(d.definition!.otherAttributes.IsOptionSet).toBe('true');
    expect(d.definition!.fields.map(f => [f.name, f.value])).toEqual([['Running', 0], ['Fault', 2]]);
    expect(values.valueXml!.replace(/\s/g, '')).toMatch(/<Text>Running<\/Text><\/LocalizedText><LocalizedText\/><LocalizedText><Text>Fault</);
    expect(values.arrayDimensions).toBe('3');
    expect(ws.space.out(flags, uaKey(38), false)).toEqual([]); // an integer needs no encodings
    expect(() => editor.setFields(flags, [{ name: 'High', value: 8 }])).toThrow(/0 to 7/);

    // The OptionSet structure has any number of bits and is encoded like a structure.
    const wide = editor.addType('DataType', 'WideFlags', uaKey(12755));
    editor.setFields(wide, [{ name: 'Far', value: 100 }]);
    expect(ws.space.out(wide, uaKey(38), false)).toHaveLength(3);
  });

  it('marks a union, whose fields are not optional', async () => {
    const { ws, editor } = await pumpModel();
    const choice = editor.addType('DataType', 'SetpointChoice', uaKey(12756));
    editor.setFields(choice, [{ name: 'Speed', dataType: uaKey(11) }, { name: 'Flow', dataType: uaKey(11) }]);

    const d = readNodeSet(ws.save()).nodes.find(n => n.browseName.name === 'SetpointChoice')!;
    expect(d.definition!.otherAttributes.IsUnion).toBe('true');
    expect(ws.space.out(choice, uaKey(38), false)).toHaveLength(3);
    expect(() => editor.setFields(choice, [{ name: 'Speed', dataType: uaKey(11), isOptional: true }])).toThrow(/not optional/);
  });

  it('keeps optional structure fields', async () => {
    const { ws, editor } = await pumpModel();
    const s = editor.addType('DataType', 'PumpSettingsDataType');
    editor.setFields(s, [{ name: 'Speed', dataType: uaKey(11) }, { name: 'Note', dataType: uaKey(12), isOptional: true }]);
    const d = readNodeSet(ws.save()).nodes.find(n => n.browseName.name === 'PumpSettingsDataType')!;
    expect(d.definition!.fields.map(f => f.isOptional ?? false)).toEqual([false, true]);
    expect(d.definition!.otherAttributes.IsUnion).toBeUndefined();
  });
});

describe('Changing the supertype of a DataType', () => {
  it('turns a new structure into an OptionSet and back, fitting encodings and fields', async () => {
    const { ws, editor } = await pumpModel();
    const flags = editor.addType('DataType', 'PumpFlags');
    expect(ws.space.out(flags, uaKey(38), false)).toHaveLength(3);

    editor.setSupertype(flags, uaKey(7)); // UInt32
    expect(ws.space.out(flags, uaKey(38), false)).toEqual([]);
    expect(ws.editable!.nodes.some(n => n.browseName.name === 'Default XML')).toBe(false);
    editor.setFields(flags, [{ name: 'Running' }, { name: 'Fault' }]);
    expect(ws.space.get(flags)!.definition!.otherAttributes.IsOptionSet).toBe('true');

    // Enumeration and OptionSet are both named values: the names carry over.
    editor.setSupertype(flags, uaKey(29));
    const children = () => ws.space.children(ws.space.get(flags)!).map(c => c.node.browseName.name);
    expect(children()).toEqual(['EnumStrings']);
    expect(ws.space.get(flags)!.definition!.otherAttributes.IsOptionSet).toBeUndefined();

    // A structure has typed fields: the named values go, the encodings come.
    editor.setSupertype(flags, uaKey(22));
    expect(ws.space.get(flags)!.definition).toBeUndefined();
    expect(children()).toEqual([]);
    expect(ws.space.out(flags, uaKey(38), false)).toHaveLength(3);
  });

  it('turns a structure into a union, keeping its fields', async () => {
    const { ws, editor } = await pumpModel();
    const s = editor.addType('DataType', 'Setpoint');
    editor.setFields(s, [{ name: 'Speed', dataType: uaKey(11) }, { name: 'Flow', dataType: uaKey(11), isOptional: true }]);
    editor.setSupertype(s, uaKey(12756));
    const d = ws.space.get(s)!.definition!;
    expect(d.otherAttributes.IsUnion).toBe('true');
    expect(d.fields.map(f => [f.name, f.isOptional])).toEqual([['Speed', undefined], ['Flow', undefined]]);
  });
});
