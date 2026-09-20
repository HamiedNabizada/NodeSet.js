import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REF, RULE } from '../../src/nodeset/address-space';
import { check } from '../../src/nodeset/checks';
import { readNodeSet } from '../../src/nodeset/reader';
import { uaKey } from '../../src/nodeset/model';
import { Workspace } from '../../src/workspace';

describe('Checks', () => {
  it('finds nothing wrong in DI', async () => {
    const ws = new Workspace();
    await ws.open(readFileSync(join(__dirname, '../../assets/nodesets/Opc.Ua.Di.NodeSet2.xml'), 'utf8'));

    expect(check(ws.space, ws.editable!).filter(f => f.severity === 'error')).toEqual([]);
  });

  it('reports what a hand-made model gets wrong', async () => {
    const ws = new Workspace();
    await ws.create('http://example.org/Pumps/');
    const editor = ws.editor!;
    const pump = editor.addType('ObjectType', 'PumpType');
    const speed = editor.addDeclaration(pump, 'Variable', 'Speed');
    editor.setModellingRule(speed, undefined);
    const file = editor.file;
    const speedNode = file.nodes.find(n => n.id === speed)!;
    speedNode.references = speedNode.references.filter(r => r.type !== REF.HasTypeDefinition);
    speedNode.dataType = undefined;
    file.nodes.find(n => n.id === pump)!.references.push({ type: REF.HasComponent, isForward: true, target: 'http://example.org/Pumps/|i=9999' });
    // The file was changed behind the editor's back; rebuild as the editor would.
    editor.rename(pump, 'PumpType');

    const rules = check(ws.space, ws.editable!).map(f => f.rule).sort();

    expect(rules).toEqual(['M001', 'M003', 'M004', 'M006']);
  });

  it('checks a new ReferenceType for its InverseName', async () => {
    const ws = new Workspace();
    await ws.create('http://example.org/Pumps/');
    const feeds = ws.editor!.addType('ReferenceType', 'Feeds');
    ws.editable!.nodes.find(n => n.id === feeds)!.inverseName = [];
    ws.editor!.rename(feeds, 'Feeds');

    expect(check(ws.space, ws.editable!).map(f => f.rule)).toEqual(['M008']);
  });

  it('asks for the fields of a new structure or enumeration', async () => {
    const ws = new Workspace();
    await ws.create('http://example.org/Pumps/');
    const settings = ws.editor!.addType('DataType', 'PumpSettingsDataType');

    expect(check(ws.space, ws.editable!).map(f => f.rule)).toEqual(['M011']);
    ws.editor!.setFields(settings, [{ name: 'Speed', dataType: 'http://opcfoundation.org/UA/|i=11' }]);
    expect(check(ws.space, ws.editable!)).toEqual([]);
  });
});

describe('Rules on the NodeSet itself', () => {
  it('finds arrays, placeholders, properties, duplicate fields, symmetric inverse names and lost nodes', async () => {
    const ws = new Workspace();
    await ws.create('http://example.org/Rules/');
    const e = ws.editor!;
    const type = e.addType('ObjectType', 'PumpType');
    const rules = (): string[] => check(ws.space, ws.editable!).map(f => f.rule);

    // ArrayDimensions without an array ValueRank.
    const speed = e.addDeclaration(type, 'Variable', 'Speed');
    ws.space.get(speed)!.arrayDimensions = '3';
    expect(rules()).toContain('M013');
    e.setValueRank(speed, 1);
    expect(rules()).not.toContain('M013');

    // A placeholder that is not named <like this>.
    const slot = e.addDeclaration(type, 'Object', 'Slot', RULE.MandatoryPlaceholder);
    expect(rules()).toContain('M015');
    e.rename(slot, '<Slot>');
    expect(rules()).not.toContain('M015');

    // An Object held by HasProperty.
    const child = e.addDeclaration(type, 'Object', 'Held');
    e.removeReference(type, REF.HasComponent, child);
    e.addReference(type, REF.HasProperty, child);
    expect(rules()).toContain('M016');

    // Two fields of the same name, as a file may hold them; the editor itself refuses them.
    const data = e.addType('DataType', 'SettingsType', uaKey(22));
    e.setFields(data, [{ name: 'A', dataType: uaKey(11) }]);
    expect(() => e.setFields(data, [{ name: 'A', dataType: uaKey(11) }, { name: 'A', dataType: uaKey(11) }])).toThrow(/named 'A'/);
    ws.space.get(data)!.definition!.fields.push({ ...ws.space.get(data)!.definition!.fields[0] });
    expect(rules()).toContain('M017');
    const reference = e.addType('ReferenceType', 'RunsWith');
    e.setSymmetric(reference, true);
    e.setInverseName(reference, 'RunsWith');
    expect(rules()).toContain('M018');
  });
});

describe('Checks against real models', () => {
  // The rules used to fire more than two thousand times on the companion
  // specifications the OPC Foundation publishes. A rule that a released model
  // breaks is a rule about us, not about the model.

  it('does not mind a declaration that keeps the name of the model that declared it', async () => {
    // A type of our model overrides a child inherited from DI, which keeps its
    // BrowseName in the DI namespace. That is how overriding works (M009).
    const ws = new Workspace();
    await ws.create('http://example.org/Device/');
    await ws.addBundled('http://opcfoundation.org/UA/DI/');
    const editor = ws.editor!;
    const type = editor.addType('ObjectType', 'MyDeviceType');
    const child = editor.addDeclaration(type, 'Object', 'ParameterSet');
    const node = editor.file.nodes.find(n => n.id === child)!;
    node.browseName = { namespaceUri: 'http://opcfoundation.org/UA/DI/', name: 'ParameterSet' };
    editor.rename(type, 'MyDeviceType');

    expect(check(ws.space, ws.editable!).filter(f => f.rule === 'M009')).toEqual([]);
  });

  it('does not ask a standard property for a ModellingRule', async () => {
    // EnumStrings and DefaultInstanceBrowseName describe the type itself and
    // carry no rule, as every released model shows (M006).
    const ws = new Workspace();
    await ws.create('http://example.org/Device/');
    const editor = ws.editor!;
    const type = editor.addType('ObjectType', 'MyDeviceType');
    const property = editor.addDeclaration(type, 'Variable', 'DefaultInstanceBrowseName');
    editor.setModellingRule(property, undefined);

    expect(check(ws.space, ws.editable!).filter(f => f.rule === 'M006')).toEqual([]);
  });

  it('accepts a placeholder named the way companion specifications name them', async () => {
    // "ActualTemperature_<No.>" is a placeholder too, not only "<Name>" (M015).
    const ws = new Workspace();
    await ws.create('http://example.org/Device/');
    const editor = ws.editor!;
    const type = editor.addType('ObjectType', 'MyDeviceType');
    const child = editor.addDeclaration(type, 'Variable', 'ActualTemperature_<No.>');
    editor.setModellingRule(child, RULE.MandatoryPlaceholder);

    expect(check(ws.space, ws.editable!).filter(f => f.rule === 'M015')).toEqual([]);
  });

  it('leaves the numbers of a machine alone until one of them has a number', async () => {
    // PackML declares its transitions without numbers and leaves them to the
    // instances; a machine that numbers some and not others is the mistake (M021).
    const ws = new Workspace();
    await ws.create('http://example.org/Machine/');
    const editor = ws.editor!;
    const type = editor.addStateMachineType('MachineStateMachineType');
    const idle = editor.addState(type, 'Idle', 1);
    const running = editor.addState(type, 'Running', 2);
    editor.addTransition(type, 'IdleToRunning', 1, idle, running);
    const numbers = editor.file.nodes.filter(n => n.browseName.name === 'StateNumber' || n.browseName.name === 'TransitionNumber');
    for (const n of numbers) n.valueXml = undefined;
    editor.rename(type, 'MachineStateMachineType');

    expect(check(ws.space, ws.editable!).filter(f => f.rule === 'M021')).toEqual([]);

    // One of them numbered again: now the others are missing something.
    const one = editor.file.nodes.find(n => n.browseName.name === 'StateNumber')!;
    one.valueXml = '<uax:UInt32 xmlns:uax="http://opcfoundation.org/UA/2008/02/Types.xsd">1</uax:UInt32>';
    editor.rename(type, 'MachineStateMachineType');
    expect(check(ws.space, ws.editable!).filter(f => f.rule === 'M021').length).toBeGreaterThan(0);
  });
});
