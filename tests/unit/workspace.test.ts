import { Workspace } from '../../src/workspace';

const PUMPS = 'http://example.org/Pumps/';
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
});
