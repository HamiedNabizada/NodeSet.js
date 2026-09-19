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
