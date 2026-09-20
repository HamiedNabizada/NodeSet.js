import { RULE } from '../../src/nodeset/address-space';
import { Workspace } from '../../src/workspace';

/**
 * The fully inherited instance declaration hierarchy (OPC 10000-3 6.3.3.3): a
 * subtype that overrides a declaration replaces that node, not everything
 * below it. An instance of the subtype must still have what the supertype
 * promised, or it is no instance of the supertype.
 */
describe('Overriding a declaration', () => {
  /** BaseType.Sub (of PartType) with an extra property; Derived overrides Sub and adds another. */
  async function types() {
    const ws = new Workspace();
    await ws.create('http://example.org/Inheritance/');
    const e = ws.editor!;

    const part = e.addType('ObjectType', 'PartType');
    e.addDeclaration(part, 'Variable', 'FromPartType');

    const base = e.addType('ObjectType', 'BaseType');
    const subInBase = e.addDeclaration(base, 'Object', 'Sub');
    e.setTypeDefinition(subInBase, part);
    e.addDeclaration(subInBase, 'Variable', 'FromBaseType');

    const derived = e.addType('ObjectType', 'DerivedType', base);
    const subInDerived = e.addDeclaration(derived, 'Object', 'Sub');
    e.setTypeDefinition(subInDerived, part);
    e.addDeclaration(subInDerived, 'Variable', 'FromDerivedType');

    return { ws, e, derived };
  }

  it('keeps the children of the declaration it overrides', async () => {
    const { ws, e, derived } = await types();

    const instance = e.instantiate(derived, 'Thing');
    const sub = ws.space.children(ws.space.get(instance)!).find(c => c.node.browseName.name === 'Sub')!;
    const names = ws.space.children(sub.node).map(c => c.node.browseName.name).sort();

    // From the type of the declaration, from the supertype's declaration, and
    // from the one that overrides it.
    expect(names).toEqual(['FromBaseType', 'FromDerivedType', 'FromPartType']);
  });

  it('offers the optional children of both declarations', async () => {
    const { ws, e, derived } = await types();
    // Both declarations of Sub hold an optional child, one in the supertype
    // and one in the type that overrides it.
    for (const type of ws.space.typeChain(ws.space.get(derived)!)) {
      const sub = ws.space.children(type).find(c => c.node.browseName.name === 'Sub');
      if (!sub) continue;
      for (const child of ws.space.children(sub.node)) e.setModellingRule(child.node.id, RULE.Optional);
    }

    const paths = e.optionalPaths(derived);
    expect(paths).toContain('Sub/FromDerivedType');
    expect(paths).toContain('Sub/FromBaseType');
  });

  it('keeps what an overridden declaration holds two levels down', async () => {
    // The same rule below a declaration: Sub/Inner of DerivedType overrides
    // Sub/Inner of BaseType, and the instance gets the children of both.
    const { ws, e, derived } = await types();
    const base = ws.space.typeChain(ws.space.get(derived)!).find(t => t.browseName.name === 'BaseType')!;
    for (const [type, mark] of [[base, 'Base'], [ws.space.get(derived)!, 'Derived']] as const) {
      const sub = ws.space.children(type).find(c => c.node.browseName.name === 'Sub')!;
      const inner = e.addDeclaration(sub.node.id, 'Object', 'Inner');
      e.addDeclaration(inner, 'Variable', `Inner${mark}`);
    }

    const instance = e.instantiate(derived, 'Thing');
    const sub = ws.space.children(ws.space.get(instance)!).find(c => c.node.browseName.name === 'Sub')!;
    const inner = ws.space.children(sub.node).find(c => c.node.browseName.name === 'Inner')!;
    const names = ws.space.children(inner.node).map(c => c.node.browseName.name).sort();

    expect(names).toEqual(['InnerBase', 'InnerDerived']);
  });

  it('tells two children apart that share a name in different namespaces', async () => {
    // A type may hold its own NodeVersion beside the one of the UA namespace;
    // the BrowseName is unique with its namespace, not without it.
    const { ws, e } = await types();
    const type = e.addType('ObjectType', 'TwoNamesType');
    const own = e.addDeclaration(type, 'Variable', 'NodeVersion');
    // The editor refuses a second child of the same name; the file may hold one.
    const ua = e.addDeclaration(type, 'Variable', 'NodeVersionUa');
    const uaNode = e.file.nodes.find(n => n.id === ua)!;
    uaNode.browseName = { namespaceUri: 'http://opcfoundation.org/UA/', name: 'NodeVersion' };
    e.rename(type, 'TwoNamesType');
    expect(own).not.toEqual(ua);

    const instance = e.instantiate(type, 'Thing');
    const children = ws.space.children(ws.space.get(instance)!);
    expect(children).toHaveLength(2);
    expect(new Set(children.map(c => c.node.browseName.namespaceUri)).size).toBe(2);
  });
});
