import { REF, RULE } from '../../src/nodeset/address-space';
import { check } from '../../src/nodeset/checks';
import { uaKey } from '../../src/nodeset/model';
import { Workspace } from '../../src/workspace';

const NS = 'http://example.org/Pumps/';

async function pumps() {
  const ws = new Workspace();
  await ws.create(NS);
  const e = ws.editor!;
  const motorType = e.addType('ObjectType', 'MotorType');
  e.addDeclaration(motorType, 'Variable', 'Temperature');
  e.addDeclaration(motorType, 'Variable', 'Vibration', RULE.Optional);

  const pumpType = e.addType('ObjectType', 'PumpType');
  const speed = e.addDeclaration(pumpType, 'Variable', 'Speed');
  e.addDeclaration(pumpType, 'Property', 'SerialNumber', RULE.Optional);
  e.addDeclaration(pumpType, 'Object', '<Accessory>', RULE.OptionalPlaceholder);
  const motor = e.addDeclaration(pumpType, 'Object', 'Motor');
  e.setTypeDefinition(motor, motorType);
  // The declaration adds a child of its own to what MotorType declares.
  e.addDeclaration(motor, 'Property', 'RatedPower');
  const start = e.addDeclaration(pumpType, 'Method', 'Start');
  e.setArguments(start, 'Input', [{ name: 'Speed', dataType: uaKey(11), valueRank: -1, arrayDimensions: [] }]);
  const feeds = e.addType('ReferenceType', 'Drives');
  e.addReference(motor, feeds, speed);

  // A subtype overrides Speed and adds Impeller.
  const centrifugal = e.addType('ObjectType', 'CentrifugalPumpType', pumpType);
  const override = e.addDeclaration(centrifugal, 'Variable', 'Speed');
  e.setDataType(override, uaKey(11));
  e.addDeclaration(centrifugal, 'Object', 'Impeller');
  return { ws, e, pumpType, centrifugal, motorType, feeds };
}

describe('Instances by ModellingRule', () => {
  it('takes the Mandatory declarations of the whole type chain, the chosen Optional ones, no placeholders', async () => {
    const { ws, e, centrifugal } = await pumps();
    const p1 = e.instantiate(centrifugal, 'P-101', { optional: path => path === 'SerialNumber' || path === 'Motor/Vibration' });
    const space = ws.space;
    const names = (key: string) => space.children(space.get(key)!).map(c => c.node.browseName.name).sort();

    expect(space.typeDefinition(space.get(p1)!)?.id).toBe(centrifugal);
    expect(names(p1)).toEqual(['Impeller', 'Motor', 'SerialNumber', 'Speed', 'Start']);
    const motor = space.children(space.get(p1)!).find(c => c.node.browseName.name === 'Motor')!.node;
    expect(names(motor.id)).toEqual(['RatedPower', 'Temperature', 'Vibration']);
    // The subtype's Speed wins.
    expect(space.children(space.get(p1)!).find(c => c.node.browseName.name === 'Speed')!.node.dataType).toBe(uaKey(11));
  });

  it('gives instances no modelling rules, their own NodeIds, the Objects folder and carried-over references', async () => {
    const { ws, e, pumpType, feeds } = await pumps();
    const p = e.instantiate(pumpType, 'P-102');
    const space = ws.space;
    const node = space.get(p)!;
    const children = space.children(node).map(c => c.node);
    const motor = children.find(c => c.browseName.name === 'Motor')!;
    const speed = children.find(c => c.browseName.name === 'Speed')!;
    const start = children.find(c => c.browseName.name === 'Start')!;

    expect(space.in(p, REF.Organizes)[0].source).toBe(uaKey(85));
    expect(children.every(c => !space.modellingRule(c))).toBe(true);
    expect(children.every(c => c.id.startsWith(NS) && !space.get(c.id)!.id.endsWith('i=1000'))).toBe(true);
    expect(space.out(motor.id, feeds).map(x => x.target)).toEqual([speed.id]);
    expect(space.children(start).map(c => c.node.arguments?.[0].name)).toEqual(['Speed']);
    expect(check(space, ws.editable!).filter(f => f.severity === 'error')).toEqual([]);
  });

  it('refuses abstract types and duplicate names, and undoes in one step', async () => {
    const { ws, e, pumpType } = await pumps();
    e.setAbstract(pumpType, true);
    expect(() => e.instantiate(pumpType, 'X')).toThrow(/abstract/);
    e.setAbstract(pumpType, false);

    const before = ws.editable!.nodes.length;
    const p = e.instantiate(pumpType, 'P-103');
    expect(() => e.instantiate(pumpType, 'Inner', { parent: p })).not.toThrow();
    expect(() => e.instantiate(pumpType, 'Inner', { parent: p })).toThrow(/already has a child/);
    e.undo();
    e.undo();
    expect(ws.editable!.nodes.length).toBe(before);
  });
});
