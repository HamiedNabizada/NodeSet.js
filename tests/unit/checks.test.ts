import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REF } from '../../src/nodeset/address-space';
import { check } from '../../src/nodeset/checks';
import { readNodeSet } from '../../src/nodeset/reader';
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
});
