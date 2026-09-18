import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AddressSpace } from '../../src/nodeset/address-space';
import { readNodeSet } from '../../src/nodeset/reader';
import { buildTypeDiagram } from '../../src/modeler/diagram-model';

const asset = (name: string) => readFileSync(join(__dirname, '../../assets/nodesets', name), 'utf8');
const DI = 'http://opcfoundation.org/UA/DI/';

describe('Type diagram in the notation of OPC 10000-3 Annex C', () => {
  const space = new AddressSpace();
  space.load(readNodeSet(asset('Opc.Ua.NodeSet2.xml')));
  space.load(readNodeSet(asset('Opc.Ua.Di.NodeSet2.xml')), true);
  const diagram = buildTypeDiagram(space, `${DI}|i=1002`, { depth: 1, ownNamespaces: [DI] });
  const byLabel = (label: string) => diagram.shapes.find(s => s.label === label)!;

  it('shows the type below its supertype, linked by HasSubtype from the supertype', () => {
    const device = byLabel('DeviceType');
    const component = byLabel('ComponentType');

    expect(device.isType).toBe(true);
    expect(device.isAbstract).toBe(true);
    expect(component.y).toBeLessThan(device.y);
    expect(diagram.lines).toContainEqual(expect.objectContaining({ kind: 'HasSubtype', source: component.id, target: device.id }));
  });

  it('names type definitions inside the box and modelling rules as cardinality', () => {
    const serial = byLabel('SerialNumber');
    const line = diagram.lines.find(l => l.target === serial.id)!;

    expect(serial.nodeClass).toBe('Variable');
    expect(serial.typeLabel).toBe('::PropertyType');
    expect(line.kind).toBe('HasProperty');
    expect(line.cardinality).toBe('1');
  });

  it('marks nodes of other models as external', () => {
    expect(byLabel('ComponentType').external).toBe(false);
    expect(byLabel('DeviceType').external).toBe(false);
    const base = buildTypeDiagram(space, `${DI}|i=15063`, { depth: 0, ownNamespaces: [DI] });
    expect(base.shapes.find(s => s.label === 'TopologyElementType')!.external).toBe(false);
    const ua = buildTypeDiagram(space, `${DI}|i=1001`, { depth: 0, ownNamespaces: [DI] });
    expect(ua.shapes.find(s => s.label === 'BaseObjectType')!.external).toBe(true);
  });

  it('places children in an indented tree and reports what the depth left out', () => {
    const device = byLabel('DeviceType');
    const serial = byLabel('SerialNumber');

    expect(serial.x).toBeGreaterThan(device.x);
    expect(serial.y).toBeGreaterThan(device.y);
    expect(buildTypeDiagram(space, `${DI}|i=1002`, { depth: 0 }).truncated).toBe(true);
    const deep = buildTypeDiagram(space, `${DI}|i=1002`, { depth: 3 });
    expect(deep.shapes.length).toBeGreaterThan(diagram.shapes.length);
  });
});
