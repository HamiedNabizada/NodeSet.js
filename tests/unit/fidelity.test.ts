import { readNodeSet } from '../../src/nodeset/reader';
import { writeNodeSet } from '../../src/nodeset/writer';

/**
 * What an audit over the published companion specifications turned up: the
 * file says things in more than one way, and reading only one of them changes
 * what the model means.
 */
describe('Reading a file as it is written', () => {
  const head = (body: string, extra = '') => `<?xml version="1.0" encoding="utf-8"?>
    <UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
      <NamespaceUris><Uri>http://example.org/Fidelity/</Uri></NamespaceUris>
      <Models><Model ModelUri="http://example.org/Fidelity/" Version="1.0.0" PublicationDate="2026-01-01T00:00:00Z">${extra}</Model></Models>
      ${body}
    </UANodeSet>`;

  it('reads a boolean written as 1 or 0', () => {
    // XML says true is "true" or "1". Reading only "true" made an abstract
    // type instantiable, an optional field mandatory, and turned a reference
    // around, all without a word.
    const file = readNodeSet(head(`
      <UAObjectType NodeId="ns=1;i=1000" BrowseName="1:AbstractType" IsAbstract="1">
        <DisplayName>AbstractType</DisplayName>
        <References><Reference ReferenceType="i=45" IsForward="0">i=58</Reference></References>
      </UAObjectType>
      <UADataType NodeId="ns=1;i=1001" BrowseName="1:OptionalStruct">
        <DisplayName>OptionalStruct</DisplayName>
        <References><Reference ReferenceType="i=45" IsForward="0">i=22</Reference></References>
        <Definition Name="1:OptionalStruct"><Field Name="May" DataType="i=12" IsOptional="1" /></Definition>
      </UADataType>`));

    const type = file.nodes.find(n => n.browseName.name === 'AbstractType')!;
    expect(type.isAbstract).toBe(true);
    expect(type.references[0].isForward).toBe(false);
    const dataType = file.nodes.find(n => n.browseName.name === 'OptionalStruct')!;
    expect(dataType.definition!.fields[0].isOptional).toBe(true);
  });

  it('keeps the whitespace of a description', () => {
    // A description that ends in a space came back without it, which made
    // every comparison against the original file noisy for ever.
    const file = readNodeSet(head(`
      <UAObjectType NodeId="ns=1;i=1000" BrowseName="1:Kept">
        <DisplayName>Kept</DisplayName>
        <Description>a description that ends in a space </Description>
        <References><Reference ReferenceType="i=45" IsForward="false">i=58</Reference></References>
      </UAObjectType>`));

    expect(file.nodes[0].description![0].text).toBe('a description that ends in a space ');
    expect(writeNodeSet(file)).toContain('<Description>a description that ends in a space </Description>');
  });

  it('keeps what a RequiredModel carries besides its version', () => {
    const file = readNodeSet(head('', `
      <RequiredModel ModelUri="http://opcfoundation.org/UA/" XmlSchemaUri="http://opcfoundation.org/UA/2008/02/Types.xsd"
                     Version="1.05.04" PublicationDate="2025-01-01T00:00:00Z" ModelVersion="1.5.4" />`));

    const required = file.models[0].requiredModels[0];
    expect(required.otherAttributes).toEqual({
      XmlSchemaUri: 'http://opcfoundation.org/UA/2008/02/Types.xsd',
      ModelVersion: '1.5.4',
    });
    expect(writeNodeSet(file)).toContain('XmlSchemaUri="http://opcfoundation.org/UA/2008/02/Types.xsd"');
  });

  it('opens a file that starts with a byte order mark', () => {
    // A published companion specification (IRDI) does, and the parser saw the
    // mark as content before the XML declaration.
    const file = readNodeSet('﻿' + head(`
      <UAObjectType NodeId="ns=1;i=1000" BrowseName="1:WithMark">
        <DisplayName>WithMark</DisplayName>
        <References><Reference ReferenceType="i=45" IsForward="false">i=58</Reference></References>
      </UAObjectType>`));

    expect(file.nodes).toHaveLength(1);
  });

  it('writes the Value before the elements it does not know', () => {
    // The schema wants Value first and Translation after it; the other way
    // round the file is invalid for anything that validates.
    const file = readNodeSet(head(`
      <UAVariable NodeId="ns=1;i=1000" BrowseName="1:WithTranslation" DataType="i=12">
        <DisplayName>WithTranslation</DisplayName>
        <References><Reference ReferenceType="i=40">i=68</Reference></References>
        <Value><uax:String xmlns:uax="http://opcfoundation.org/UA/2008/02/Types.xsd">text</uax:String></Value>
        <Translation><Text Locale="de">Text</Text></Translation>
      </UAVariable>`));

    const xml = writeNodeSet(file);
    expect(xml.indexOf('<Value>')).toBeLessThan(xml.indexOf('<Translation'));
  });
});
