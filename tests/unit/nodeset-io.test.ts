import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { NodeSetFile, UA_NAMESPACE, uaKey } from '../../src/nodeset/model';
import { readNodeSet } from '../../src/nodeset/reader';
import { writeNodeSet } from '../../src/nodeset/writer';

const asset = (name: string) => readFileSync(join(__dirname, '../../assets/nodesets', name), 'utf8');
const DI = 'http://opcfoundation.org/UA/DI/';

/** Everything a node says, independent of indexes, aliases and order of references. */
function fingerprint(file: NodeSetFile): Map<string, string> {
  const result = new Map<string, string>();
  for (const n of file.nodes) {
    const refs = n.references.map(r => `${r.type}${r.isForward ? '>' : '<'}${r.target}`).sort();
    result.set(n.id, JSON.stringify({
      ...n,
      references: refs,
      // Raw XML is compared without whitespace and namespace declarations.
      valueXml: normalize(n.valueXml),
      definitionXml: normalize(n.definitionXml),
      otherElements: n.otherElements.map(normalize),
    }));
  }
  return result;
}

function normalize(xml: string | undefined): string | undefined {
  return xml?.replace(/\s+xmlns(:\w+)?="[^"]*"/g, '').replace(/>\s+</g, '><').trim();
}

function expectSameContent(a: NodeSetFile, b: NodeSetFile) {
  const fa = fingerprint(a);
  const fb = fingerprint(b);
  expect([...fb.keys()].sort()).toEqual([...fa.keys()].sort());
  for (const [id, value] of fa) expect(fb.get(id), id).toBe(value);
  expect(b.models).toEqual(a.models);
  expect([...b.aliases]).toEqual([...a.aliases]);
}

describe('NodeSet2 reading and writing', () => {
  it('reads DI with namespaces, models, aliases and resolved NodeIds', () => {
    const di = readNodeSet(asset('Opc.Ua.Di.NodeSet2.xml'));

    expect(di.namespaceUris).toEqual([DI]);
    expect(di.models[0].modelUri).toBe(DI);
    expect(di.models[0].requiredModels[0].modelUri).toBe(UA_NAMESPACE);
    const device = di.nodes.find(n => n.browseName.name === 'DeviceType')!;
    expect(device.nodeClass).toBe('ObjectType');
    expect(device.id).toBe(`${DI}|i=1002`);
    expect(device.browseName.namespaceUri).toBe(DI);
    expect(device.isAbstract).toBe(true);
    // HasSubtype (alias) from ComponentType, inverse.
    expect(device.references).toContainEqual({ type: uaKey(45), isForward: false, target: `${DI}|i=15063` });
  });

  it('writes DI back with the same content', () => {
    const di = readNodeSet(asset('Opc.Ua.Di.NodeSet2.xml'));
    const again = readNodeSet(writeNodeSet(di));

    expectSameContent(di, again);
  });

  it('writes the UA base model back with the same content', () => {
    const ua = readNodeSet(asset('Opc.Ua.NodeSet2.xml'));
    const again = readNodeSet(writeNodeSet(ua));

    expect(ua.nodes.length).toBeGreaterThan(5000);
    expectSameContent(ua, again);
  });

  it('writes well-formed XML with the NodeSet namespace', () => {
    const xml = writeNodeSet(readNodeSet(asset('Opc.Ua.Di.NodeSet2.xml')));
    const doc = new DOMParser().parseFromString(xml, 'text/xml');

    expect(doc.documentElement!.namespaceURI).toBe('http://opcfoundation.org/UA/2011/03/UANodeSet.xsd');
  });
});
