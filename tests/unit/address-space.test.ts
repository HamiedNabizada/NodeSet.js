import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AddressSpace, REF, RULE } from '../../src/nodeset/address-space';
import { uaKey } from '../../src/nodeset/model';
import { readNodeSet } from '../../src/nodeset/reader';

const asset = (name: string) => readFileSync(join(__dirname, '../../assets/nodesets', name), 'utf8');
const DI = 'http://opcfoundation.org/UA/DI/';

describe('AddressSpace over UA and DI', () => {
  const space = new AddressSpace();
  space.load(readNodeSet(asset('Opc.Ua.NodeSet2.xml')));
  space.load(readNodeSet(asset('Opc.Ua.Di.NodeSet2.xml')));
  const device = space.get(`${DI}|i=1002`)!;

  it('follows the supertype chain across models', () => {
    expect(space.typeChain(device).map(t => t.browseName.name))
      .toEqual(['DeviceType', 'ComponentType', 'TopologyElementType', 'BaseObjectType']);
    expect(space.isSubtypeOf(device.id, uaKey(58))).toBe(true);
  });

  it('knows the reference type hierarchy', () => {
    expect(space.isHierarchical(REF.HasComponent)).toBe(true);
    expect(space.isHierarchical(REF.HasTypeDefinition)).toBe(false);
    expect(space.isSubtypeOf(REF.HasOrderedComponent, REF.HasComponent)).toBe(true);
  });

  it('lists instance declarations with their modelling rules', () => {
    const children = space.children(device).map(c => [c.node.browseName.name, space.modellingRule(c.node)] as const);

    expect(children).toContainEqual(['SerialNumber', RULE.Mandatory]);
    expect(children).toContainEqual(['DeviceManual', RULE.Mandatory]);
    const topology = space.get(`${DI}|i=1001`)!;
    expect(space.children(topology).map(c => c.node.browseName.name)).toContain('ParameterSet');
  });

  it('finds type definitions and parents from either direction', () => {
    const serial = space.children(device).find(c => c.node.browseName.name === 'SerialNumber')!.node;

    expect(space.typeDefinition(serial)?.browseName.name).toBe('PropertyType');
    expect(space.parentOf(serial)?.id).toBe(device.id);
  });
});
