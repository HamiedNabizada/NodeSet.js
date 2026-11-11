import { topInstances } from '../../src/ui/instances';
import { Workspace } from '../../src/workspace';

const DI = 'http://opcfoundation.org/UA/DI/';
const DEVICE_SET = `${DI}|i=5001`;

async function plant() {
  const ws = new Workspace();
  await ws.create('http://example.org/Plant/');
  await ws.addBundled(DI);
  const e = ws.editor!;
  const pump = e.addType('ObjectType', 'PumpType');
  e.addDeclaration(pump, 'Variable', 'Speed');
  // A structure brings its encodings, Objects that hang on HasEncoding alone.
  e.addType('DataType', 'RecipeType');
  const pump1 = e.instantiate(pump, 'Pump1');
  return { ws, e, pump, pump1 };
}

describe('The instances of a model', () => {
  // An instance placed below DI's DeviceSet could not be found again.
  it('lists every instance the model does not hold itself, wherever it hangs', async () => {
    const { ws, e, pump, pump1 } = await plant();
    e.instantiate(pump, 'Pump2', { parent: DEVICE_SET });
    e.instantiate(pump, 'Inner', { parent: pump1 });

    expect(topInstances(ws.space, ws.editable!).map(n => n.browseName.name).sort()).toEqual(['Pump1', 'Pump2']);
  });
});
