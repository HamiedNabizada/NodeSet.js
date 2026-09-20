import { RULE } from '../../src/nodeset/address-space';
import { check } from '../../src/nodeset/checks';
import { Workspace } from '../../src/workspace';

/**
 * An instance against its type. Until an audit asked, nothing checked it: an
 * instance stripped of a Mandatory child, or one that fills no
 * MandatoryPlaceholder, saved without a word and a server would refuse it.
 */
describe('Checks on an instance', () => {
  async function model() {
    const ws = new Workspace();
    await ws.create('http://example.org/Instances/');
    const e = ws.editor!;
    const part = e.addType('ObjectType', 'PartType');
    const pump = e.addType('ObjectType', 'PumpType');
    e.addDeclaration(pump, 'Variable', 'SerialNumber');
    const placeholder = e.addDeclaration(pump, 'Object', '<PartIdentifier>');
    e.setTypeDefinition(placeholder, part);
    e.setModellingRule(placeholder, RULE.MandatoryPlaceholder);
    return { ws, e, pump, part };
  }

  it('says nothing about an instance that has what its type declares', async () => {
    const { ws, e, pump, part } = await model();
    const instance = e.instantiate(pump, 'Pump1');
    // The placeholder is filled with a part of its own name.
    const child = e.addDeclaration(instance, 'Object', 'LeftPart');
    e.setTypeDefinition(child, part);

    const findings = check(ws.space, ws.editable!).filter(f => f.rule === 'M022' || f.rule === 'M023');
    expect(findings).toEqual([]);
  });

  it('finds a Mandatory child an instance does not have', async () => {
    const { ws, e, pump, part } = await model();
    const instance = e.instantiate(pump, 'Pump1');
    const child = e.addDeclaration(instance, 'Object', 'LeftPart');
    e.setTypeDefinition(child, part);
    const serial = ws.space.children(ws.space.get(instance)!).find(c => c.node.browseName.name === 'SerialNumber')!;
    e.delete(serial.node.id);

    const findings = check(ws.space, ws.editable!).filter(f => f.rule === 'M022');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('SerialNumber');
  });

  it('finds a MandatoryPlaceholder nothing fills', async () => {
    const { ws, e, pump } = await model();
    e.instantiate(pump, 'Pump1');

    const findings = check(ws.space, ws.editable!).filter(f => f.rule === 'M023');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('<PartIdentifier>');
  });
});
