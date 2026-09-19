// Writes a NodeSetFile as NodeSet2 XML. The namespace table keeps the order
// it was read in; namespaces used since are appended. References and data
// types use an alias where the file has one for the target.

import { Argument, DataTypeDefinition, LocalizedText, NodeSetFile, parseNodeIdKey, QualifiedName, UA_NAMESPACE, UaNode } from './model';

const UA_NODESET_NS = 'http://opcfoundation.org/UA/2011/03/UANodeSet.xsd';
const UA_TYPES_NS = 'http://opcfoundation.org/UA/2008/02/Types.xsd';

export function writeNodeSet(file: NodeSetFile): string {
  const table = namespaceTable(file);
  const indexOf = (uri: string): number => (uri === UA_NAMESPACE ? 0 : table.indexOf(uri) + 1);
  const aliasByKey = new Map<string, string>();
  for (const [alias, key] of file.aliases) if (!aliasByKey.has(key)) aliasByKey.set(key, alias);

  const idText = (key: string): string => {
    const { namespaceUri, identifier } = parseNodeIdKey(key);
    const index = indexOf(namespaceUri);
    return index === 0 ? identifier : `ns=${index};${identifier}`;
  };
  const refText = (key: string): string => aliasByKey.get(key) ?? idText(key);
  const qn = (q: QualifiedName): string => {
    const index = indexOf(q.namespaceUri);
    return index === 0 ? q.name : `${index}:${q.name}`;
  };

  const out: string[] = ['<?xml version="1.0" encoding="utf-8"?>'];
  const rootAttributes: Record<string, string> = {
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xmlns:uax': UA_TYPES_NS,
    ...file.otherAttributes,
    ...(file.lastModified ? { LastModified: file.lastModified } : {}),
    xmlns: UA_NODESET_NS,
  };
  out.push(`<UANodeSet${attributes(rootAttributes)}>`);

  if (table.length > 0) {
    out.push('  <NamespaceUris>');
    for (const uri of table) out.push(`    <Uri>${esc(uri)}</Uri>`);
    out.push('  </NamespaceUris>');
  }
  if (file.serverUris.length > 0) {
    out.push('  <ServerUris>');
    for (const uri of file.serverUris) out.push(`    <Uri>${esc(uri)}</Uri>`);
    out.push('  </ServerUris>');
  }
  if (file.models.length > 0) {
    out.push('  <Models>');
    for (const m of file.models) {
      const own = attributes({ ModelUri: m.modelUri, Version: m.version, PublicationDate: m.publicationDate, ...m.otherAttributes });
      if (m.requiredModels.length === 0) {
        out.push(`    <Model${own} />`);
        continue;
      }
      out.push(`    <Model${own}>`);
      for (const r of m.requiredModels) {
        out.push(`      <RequiredModel${attributes({ ModelUri: r.modelUri, Version: r.version, PublicationDate: r.publicationDate })} />`);
      }
      out.push('    </Model>');
    }
    out.push('  </Models>');
  }
  if (file.aliases.size > 0) {
    out.push('  <Aliases>');
    for (const [alias, key] of file.aliases) out.push(`    <Alias Alias="${esc(alias)}">${esc(idText(key))}</Alias>`);
    out.push('  </Aliases>');
  }
  for (const raw of file.otherElements) out.push('  ' + raw);
  for (const node of file.nodes) writeNode(out, node, idText, refText, qn);
  out.push('</UANodeSet>');
  return out.join('\n') + '\n';
}

function writeNode(
  out: string[], n: UaNode, idText: (k: string) => string, refText: (k: string) => string, qn: (q: QualifiedName) => string,
): void {
  const a: Record<string, string | undefined> = {
    NodeId: idText(n.id),
    BrowseName: qn(n.browseName),
    SymbolicName: n.symbolicName,
    ParentNodeId: n.parent ? idText(n.parent) : undefined,
    DataType: n.dataType ? refText(n.dataType) : undefined,
    ValueRank: n.valueRank?.toString(),
    ArrayDimensions: n.arrayDimensions,
    AccessLevel: n.accessLevel?.toString(),
    IsAbstract: n.isAbstract === undefined ? undefined : String(n.isAbstract),
    Symmetric: n.symmetric === undefined ? undefined : String(n.symmetric),
    ...n.otherAttributes,
  };
  out.push(`  <UA${n.nodeClass}${attributes(a)}>`);
  for (const d of n.displayName) out.push(`    ${localized('DisplayName', d)}`);
  for (const d of n.description) out.push(`    ${localized('Description', d)}`);
  // UANodeSet.xsd: Category and Documentation precede References; the rest
  // of the base elements (RolePermissions, AccessRestrictions, Extensions) follow.
  const early = n.otherElements.filter(raw => /^<(\w+:)?(Category|Documentation)\b/.test(raw));
  const late = n.otherElements.filter(raw => !early.includes(raw));
  for (const raw of early) out.push('    ' + raw);
  if (n.references.length > 0) {
    out.push('    <References>');
    for (const r of n.references) {
      const forward = r.isForward ? '' : ' IsForward="false"';
      out.push(`      <Reference ReferenceType="${esc(refText(r.type))}"${forward}>${esc(refText(r.target))}</Reference>`);
    }
    out.push('    </References>');
  }
  for (const raw of late) out.push('    ' + raw);
  for (const inv of n.inverseName ?? []) out.push(`    ${localized('InverseName', inv)}`);
  if (n.definition) writeDefinition(out, n.definition, refText, qn);
  if (n.arguments) writeArguments(out, n.arguments, idText);
  else if (n.valueXml !== undefined) out.push(`    <Value>${n.valueXml}</Value>`);
  out.push(`  </UA${n.nodeClass}>`);
}

function writeDefinition(out: string[], d: DataTypeDefinition, refText: (k: string) => string, qn: (q: QualifiedName) => string) {
  const own = attributes({ Name: qn(d.name), ...d.otherAttributes });
  if (d.fields.length === 0) { out.push(`    <Definition${own} />`); return; }
  out.push(`    <Definition${own}>`);
  for (const f of d.fields) {
    const a = attributes({
      Name: f.name,
      DataType: f.dataType ? refText(f.dataType) : undefined,
      ValueRank: f.valueRank?.toString(),
      ArrayDimensions: f.arrayDimensions,
      Value: f.value?.toString(),
      IsOptional: f.isOptional === undefined ? undefined : String(f.isOptional),
      ...f.otherAttributes,
    });
    const inner = [...f.displayName.map(t => localized('DisplayName', t)), ...f.description.map(t => localized('Description', t))];
    out.push(inner.length === 0 ? `      <Field${a} />` : `      <Field${a}>${inner.join('')}</Field>`);
  }
  out.push('    </Definition>');
}

/** InputArguments / OutputArguments as the XML encoding of a list of Argument structures. */
function writeArguments(out: string[], args: Argument[], idText: (k: string) => string) {
  out.push('    <Value>');
  out.push(`      <ListOfExtensionObject xmlns="${UA_TYPES_NS}">`);
  for (const a of args) {
    const dims = a.arrayDimensions.length > 0
      ? `<ArrayDimensions>${a.arrayDimensions.map(d => `<UInt32>${d}</UInt32>`).join('')}</ArrayDimensions>`
      : '<ArrayDimensions />';
    const description = a.description
      ? `<Description>${a.description.locale ? `<Locale>${esc(a.description.locale)}</Locale>` : ''}<Text>${esc(a.description.text)}</Text></Description>`
      : '';
    out.push('        <ExtensionObject><TypeId><Identifier>i=297</Identifier></TypeId><Body><Argument>'
      + `<Name>${esc(a.name)}</Name><DataType><Identifier>${esc(idText(a.dataType))}</Identifier></DataType>`
      + `<ValueRank>${a.valueRank}</ValueRank>${dims}${description}</Argument></Body></ExtensionObject>`);
  }
  out.push('      </ListOfExtensionObject>');
  out.push('    </Value>');
}

/** The file's table, extended by every namespace its nodes use. */
export function namespaceTable(file: NodeSetFile): string[] {
  const table = [...file.namespaceUris];
  const add = (key: string | undefined) => {
    if (!key) return;
    const uri = parseNodeIdKey(key).namespaceUri;
    if (uri !== UA_NAMESPACE && !table.includes(uri)) table.push(uri);
  };
  for (const n of file.nodes) {
    add(n.id);
    add(n.parent);
    add(n.dataType);
    if (n.browseName.namespaceUri !== UA_NAMESPACE && !table.includes(n.browseName.namespaceUri)) table.push(n.browseName.namespaceUri);
    for (const r of n.references) { add(r.type); add(r.target); }
    for (const a of n.arguments ?? []) add(a.dataType);
    for (const f of n.definition?.fields ?? []) add(f.dataType);
    if (n.definition && n.definition.name.namespaceUri !== UA_NAMESPACE && !table.includes(n.definition.name.namespaceUri)) {
      table.push(n.definition.name.namespaceUri);
    }
  }
  for (const key of file.aliases.values()) add(key);
  return table;
}

function localized(name: string, t: LocalizedText): string {
  return `<${name}${t.locale ? ` Locale="${esc(t.locale)}"` : ''}>${esc(t.text)}</${name}>`;
}

function attributes(values: Record<string, string | undefined>): string {
  return Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${esc(v!)}"`).join('');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
