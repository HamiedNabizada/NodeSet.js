import { newModel } from '../../src/nodeset/edit';
import { Layout, LAYOUT_NAMESPACE, readLayout, writeLayout } from '../../src/nodeset/layout';
import { readNodeSet } from '../../src/nodeset/reader';
import { writeNodeSet } from '../../src/nodeset/writer';

const NS = 'http://example.org/Pumps/';

describe('Layout in the NodeSet', () => {
  it('survives writing and reading the NodeSet', () => {
    const file = newModel(NS);
    const layout: Layout = new Map([[`${NS}|i=1000`, new Map([[`${NS}|i=1001`, { x: 120, y: 80.4 }], ['http://opcfoundation.org/UA/|i=58', { x: 0, y: 0 }]])]]);
    writeLayout(file, layout);

    const xml = writeNodeSet(file);
    const again = readLayout(readNodeSet(xml));

    expect(xml).toContain(LAYOUT_NAMESPACE);
    expect(xml).toContain('Node="nsu=http://example.org/Pumps/;i=1001"');
    expect(again.get(`${NS}|i=1000`)?.get(`${NS}|i=1001`)).toEqual({ x: 120, y: 80 });
    expect(again.get(`${NS}|i=1000`)?.get('http://opcfoundation.org/UA/|i=58')).toEqual({ x: 0, y: 0 });
  });

  it('replaces its own extension and keeps those of other tools', () => {
    const file = newModel(NS);
    file.otherElements.push('<Extensions><Extension><Other xmlns="urn:someone">keep</Other></Extension></Extensions>');
    writeLayout(file, new Map([[`${NS}|i=1`, new Map([[`${NS}|i=2`, { x: 1, y: 2 }]])]]));
    writeLayout(file, new Map([[`${NS}|i=1`, new Map([[`${NS}|i=2`, { x: 5, y: 6 }]])]]));

    expect(file.otherElements).toHaveLength(1);
    expect(file.otherElements[0]).toContain('urn:someone');
    expect(file.otherElements[0].match(new RegExp(LAYOUT_NAMESPACE, 'g'))).toHaveLength(1);
    expect(readLayout(file).get(`${NS}|i=1`)?.get(`${NS}|i=2`)).toEqual({ x: 5, y: 6 });

    writeLayout(file, new Map());
    expect(file.otherElements[0]).not.toContain(LAYOUT_NAMESPACE);
  });
});

describe('Layouts of earlier versions', () => {
  it('reads a layout written under the working name and replaces it on writing', () => {
    const file = readNodeSet(`<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd"><NamespaceUris><Uri>http://example.org/Old/</Uri></NamespaceUris><Extensions><Extension><Layout xmlns="urn:ua-modeler:diagram-layout:1"><Diagram Node="nsu=http://example.org/Old/;i=1"><Shape Node="nsu=http://example.org/Old/;i=2" X="10" Y="20" /></Diagram></Layout></Extension></Extensions></UANodeSet>`);
    const layout = readLayout(file);

    expect(layout.get('http://example.org/Old/|i=1')?.get('http://example.org/Old/|i=2')).toEqual({ x: 10, y: 20 });
    writeLayout(file, layout);
    const written = file.otherElements.join('');
    expect(written).toContain('urn:nodeset-js:diagram-layout:1');
    expect(written).not.toContain('urn:ua-modeler:diagram-layout:1');
  });
});
