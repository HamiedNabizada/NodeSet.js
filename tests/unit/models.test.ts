import { readNodeSet } from '../../src/nodeset/reader';
import { Workspace } from '../../src/workspace';

const DI = 'http://opcfoundation.org/UA/DI/';
const NS = 'http://example.org/Pumps/';

describe('Required models', () => {
  it('builds a new model on DI and declares DI as required when it saves', async () => {
    const ws = new Workspace();
    await ws.create(NS);
    await ws.addBundled(DI);
    const e = ws.editor!;
    const pump = e.addType('ObjectType', 'PumpType', `${DI}|i=1002`); // DeviceType

    expect(ws.space.typeChain(ws.space.get(pump)!).map(t => t.browseName.name)).toContain('DeviceType');
    const saved = readNodeSet(ws.save());
    const required = saved.models[0].requiredModels;
    expect(required.map(r => r.modelUri)).toEqual(['http://opcfoundation.org/UA/', DI]);
    expect(required[1].version).toBe('1.05.0');
    expect(saved.namespaceUris).toEqual([NS, DI]);
  });

  it('adds nothing twice and loads a model from a file only once', async () => {
    const ws = new Workspace();
    await ws.create(NS);
    await ws.addBundled(DI);
    await ws.addBundled(DI);

    expect(ws.loadedModels.filter(m => m.modelUri === DI)).toHaveLength(1);
    expect(ws.syncRequiredModels()).toEqual([]);
  });

  it('sets version and publication date of the model', async () => {
    const ws = new Workspace();
    await ws.create(NS);
    ws.editor!.setModelInfo('1.1.0', '2026-10-01');

    expect(ws.editable!.models[0]).toMatchObject({ version: '1.1.0', publicationDate: '2026-10-01T00:00:00Z' });
    expect(() => ws.editor!.setModelInfo('1.2.0', 'soon')).toThrow(/not a date/);
  });
});
