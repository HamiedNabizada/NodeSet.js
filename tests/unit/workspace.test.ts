import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTypeDiagram } from '../../src/modeler/diagram-model';
import { AddressSpace } from '../../src/nodeset/address-space';
import { newModel } from '../../src/nodeset/edit';
import { readNodeSet } from '../../src/nodeset/reader';
import { Workspace } from '../../src/workspace';

const PUMPS = 'http://example.org/Pumps/';
const DI = 'http://opcfoundation.org/UA/DI/';
const MACHINERY = 'http://opcfoundation.org/UA/Machinery/';
const machinery = `<?xml version="1.0" encoding="utf-8"?>
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
  <NamespaceUris><Uri>${MACHINERY}</Uri></NamespaceUris>
  <Models>
    <Model ModelUri="${MACHINERY}" Version="1.0.0" PublicationDate="2026-09-19T00:00:00Z">
      <RequiredModel ModelUri="http://opcfoundation.org/UA/" />
    </Model>
  </Models>
  <UAObjectType NodeId="ns=1;i=1002" BrowseName="1:MachineType">
    <DisplayName>MachineType</DisplayName>
    <References><Reference ReferenceType="i=45" IsForward="false">i=58</Reference></References>
  </UAObjectType>
</UANodeSet>`;
const nodeSet = (required: string) => `<?xml version="1.0" encoding="utf-8"?>
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
  <NamespaceUris><Uri>${PUMPS}</Uri><Uri>http://opcfoundation.org/UA/DI/</Uri></NamespaceUris>
  <Models>
    <Model ModelUri="${PUMPS}" Version="1.0.0" PublicationDate="2026-09-19T00:00:00Z">
      <RequiredModel ModelUri="http://opcfoundation.org/UA/" />
      <RequiredModel ModelUri="${required}" />
    </Model>
  </Models>
  <UAObjectType NodeId="ns=1;i=1000" BrowseName="1:PumpType">
    <DisplayName>PumpType</DisplayName>
    <References><Reference ReferenceType="i=45" IsForward="false">ns=2;i=1002</Reference></References>
  </UAObjectType>
</UANodeSet>`;

describe('Workspace', () => {
  it('loads the bundled models a file requires', async () => {
    const ws = new Workspace();
    const { missing } = await ws.open(nodeSet('http://opcfoundation.org/UA/DI/'));

    expect(missing).toEqual([]);
    const pump = ws.space.get(`${PUMPS}|i=1000`)!;
    expect(ws.space.typeChain(pump).map(t => t.browseName.name)).toEqual(
      ['PumpType', 'DeviceType', 'ComponentType', 'TopologyElementType', 'BaseObjectType']);
    expect(ws.ownNamespaces).toEqual([PUMPS]);
  });

  it('names required models it cannot find', async () => {
    const ws = new Workspace();
    const { missing } = await ws.open(nodeSet('http://opcfoundation.org/UA/Machinery/'));

    expect(missing).toEqual(['http://opcfoundation.org/UA/Machinery/']);
  });

  it('keeps the NodeSets added to it, so that a draft can be opened again with them', async () => {
    const ws = new Workspace();
    await ws.open(nodeSet(MACHINERY));
    await ws.addRequired(machinery);

    expect(ws.addedFiles).toEqual([machinery]);
    expect(ws.missing).toEqual([]);
  });

  it('writes a draft that opens again as it was, without touching the model', async () => {
    const ws = new Workspace();
    await ws.create(PUMPS);
    await ws.addBundled(DI);
    const valve = ws.editor!.addType('ObjectType', 'ValveType', `${DI}|i=1002`);
    ws.place(valve, valve, 40, 80);

    const draft = ws.snapshot();
    expect(ws.editable!.models[0].requiredModels.map(r => r.modelUri)).not.toContain(DI);

    const again = new Workspace();
    const { missing } = await again.open(draft);
    expect(missing).toEqual([]);
    expect(again.space.typeChain(again.space.get(valve)!).map(t => t.browseName.name)).toContain('DeviceType');
    expect(again.layout.get(valve)?.get(valve)).toEqual({ x: 40, y: 80 });
  });

  // Opening the DI sample and then loading DI loaded the edited model a second
  // time: every reference counted twice, and the diagram of DeviceType gave
  // diagram-js one id twice, which took the modeler down.
  it('does not load the model being edited a second time', async () => {
    const di = readFileSync(join(__dirname, '../../assets/nodesets/Opc.Ua.Di.NodeSet2.xml'), 'utf8');
    const usesDi = nodeSet(DI).replace(/Pumps/g, 'UsesDi');
    const ws = new Workspace();
    await ws.open(di);

    await ws.addBundled(DI);
    expect(await ws.addRequired(di)).toEqual([]);
    expect(await ws.addRequired(usesDi)).toEqual([]);

    expect(ws.loadedModels.map(m => m.modelUri)).not.toContain(DI);
    expect(ws.space.files.filter(f => f.file.models.some(m => m.modelUri === DI))).toHaveLength(1);
    const diagram = buildTypeDiagram(ws.space, `${DI}|i=1002`, { ownNamespaces: ws.ownNamespaces });
    const ids = [...diagram.shapes.map(s => s.id), ...diagram.lines.map(l => l.id)];
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('counts a reference once even when two loaded files hold the same node', async () => {
    const file = newModel(PUMPS);
    file.nodes.push({
      id: `${PUMPS}|i=1000`, nodeClass: 'ObjectType', browseName: { namespaceUri: PUMPS, name: 'PumpType' }, displayName: [], description: [],
      references: [{ type: 'http://opcfoundation.org/UA/|i=45', isForward: false, target: 'http://opcfoundation.org/UA/|i=58' }],
      otherAttributes: {}, otherElements: [],
    });
    const base = new AddressSpace();
    base.load(readNodeSet(readFileSync(join(__dirname, '../../assets/nodesets/Opc.Ua.NodeSet2.xml'), 'utf8')));
    base.load(file);
    const space = new AddressSpace(base);
    space.load(structuredClone(file), true);

    expect(space.in(`${PUMPS}|i=1000`)).toHaveLength(1);
    expect(space.out('http://opcfoundation.org/UA/|i=58').filter(e => e.target === `${PUMPS}|i=1000`)).toHaveLength(1);
  });
});
