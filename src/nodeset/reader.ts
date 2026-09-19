// Reads a NodeSet2 file into a NodeSetFile. NodeIds, BrowseNames and
// aliases are resolved against the file's own namespace table, so the result
// no longer depends on indexes.

import { DOMParser, Element as XmlElement, XMLSerializer } from '@xmldom/xmldom';
import {
  Argument, DataTypeDefinition, LocalizedText, ModelInfo, NodeClass, NodeSetFile, NODE_CLASSES, QualifiedName, Reference, UA_NAMESPACE, UaNode,
} from './model';

export class NodeSetFormatError extends Error {}

const NAMED_NODE_ATTRIBUTES = new Set([
  'NodeId', 'BrowseName', 'SymbolicName', 'ParentNodeId', 'IsAbstract', 'Symmetric',
  'DataType', 'ValueRank', 'ArrayDimensions', 'AccessLevel', 'MethodDeclarationId',
]);
const NAMED_NODE_ELEMENTS = new Set(['DisplayName', 'Description', 'References', 'Value', 'Definition', 'InverseName']);

type El = XmlElement;

export function readNodeSet(xml: string): NodeSetFile {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (level, msg) => { if (level !== 'warning') errors.push(msg); } })
    .parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'UANodeSet') {
    throw new NodeSetFormatError(errors[0] ?? 'Not a NodeSet2 file: the root element is not UANodeSet.');
  }

  const namespaceUris = children(root, 'NamespaceUris').flatMap(n => children(n, 'Uri')).map(u => textOf(u));
  const serverUris = children(root, 'ServerUris').flatMap(n => children(n, 'Uri')).map(u => textOf(u));
  const table = [UA_NAMESPACE, ...namespaceUris];

  const resolveIndex = (index: number): string => {
    if (index < 0 || index >= table.length) throw new NodeSetFormatError(`Namespace index ${index} is not in the namespace table.`);
    return table[index];
  };

  const rawAliases = new Map<string, string>();
  for (const a of children(root, 'Aliases').flatMap(n => children(n, 'Alias'))) {
    rawAliases.set(a.getAttribute('Alias') ?? '', textOf(a));
  }
  const parseId = (raw: string): string => parseNodeIdText(raw, resolveIndex);
  const aliases = new Map<string, string>();
  for (const [name, target] of rawAliases) aliases.set(name, parseId(target));
  const resolve = (raw: string | null): string | undefined => {
    if (raw == null || raw === '') return undefined;
    const trimmed = raw.trim();
    return aliases.get(trimmed) ?? parseId(trimmed);
  };

  const models: ModelInfo[] = children(root, 'Models').flatMap(n => children(n, 'Model')).map(m => ({
    modelUri: m.getAttribute('ModelUri') ?? '',
    version: attr(m, 'Version'),
    publicationDate: attr(m, 'PublicationDate'),
    requiredModels: children(m, 'RequiredModel').map(r => ({
      modelUri: r.getAttribute('ModelUri') ?? '',
      version: attr(r, 'Version'),
      publicationDate: attr(r, 'PublicationDate'),
    })),
    otherAttributes: otherAttributes(m, new Set(['ModelUri', 'Version', 'PublicationDate'])),
  }));

  const nodes: UaNode[] = [];
  const serializer = new XMLSerializer();
  const otherRootElements: string[] = [];
  for (const e of elementChildren(root)) {
    const kind = e.localName ?? '';
    if (kind.startsWith('UA') && NODE_CLASSES.includes(kind.slice(2) as NodeClass)) {
      nodes.push(readNode(e, kind.slice(2) as NodeClass, resolve, resolveIndex, serializer));
    } else if (!['NamespaceUris', 'ServerUris', 'Models', 'Aliases'].includes(kind)) {
      otherRootElements.push(serializer.serializeToString(e));
    }
  }

  return {
    namespaceUris,
    serverUris,
    models,
    aliases,
    nodes,
    lastModified: attr(root, 'LastModified'),
    otherAttributes: otherAttributes(root, new Set(['LastModified']), true),
    otherElements: otherRootElements,
  };
}

function readNode(
  e: El, nodeClass: NodeClass, resolve: (raw: string | null) => string | undefined,
  resolveIndex: (i: number) => string, serializer: XMLSerializer,
): UaNode {
  const id = resolve(e.getAttribute('NodeId'));
  if (!id) throw new NodeSetFormatError(`A ${e.localName} has no NodeId.`);
  const references: Reference[] = children(e, 'References').flatMap(r => children(r, 'Reference')).map(r => ({
    type: resolve(r.getAttribute('ReferenceType')) ?? '',
    isForward: (r.getAttribute('IsForward') ?? 'true').toLowerCase() !== 'false',
    target: resolve(textOf(r)) ?? '',
  }));
  const value = children(e, 'Value')[0];
  const definition = children(e, 'Definition')[0];
  const node: UaNode = {
    id,
    nodeClass,
    browseName: parseQualifiedName(e.getAttribute('BrowseName') ?? '', resolveIndex),
    displayName: localized(e, 'DisplayName'),
    description: localized(e, 'Description'),
    references,
    parent: resolve(e.getAttribute('ParentNodeId')),
    methodDeclaration: resolve(e.getAttribute('MethodDeclarationId')),
    symbolicName: attr(e, 'SymbolicName'),
    isAbstract: bool(e, 'IsAbstract'),
    symmetric: bool(e, 'Symmetric'),
    inverseName: nodeClass === 'ReferenceType' ? localized(e, 'InverseName') : undefined,
    dataType: resolve(e.getAttribute('DataType')),
    valueRank: num(e, 'ValueRank'),
    arrayDimensions: attr(e, 'ArrayDimensions'),
    accessLevel: num(e, 'AccessLevel'),
    valueXml: value ? innerXml(value, serializer) : undefined,
    definition: definition ? readDefinition(definition, resolve, resolveIndex) : undefined,
    otherAttributes: otherAttributes(e, NAMED_NODE_ATTRIBUTES),
    otherElements: elementChildren(e).filter(c => !NAMED_NODE_ELEMENTS.has(c.localName ?? '')).map(c => serializer.serializeToString(c)),
  };
  if (value && node.dataType === ARGUMENT_TYPE) {
    const args = readArguments(value, resolve);
    if (args) { node.arguments = args; node.valueXml = undefined; }
  }
  if (value && !node.arguments) {
    const objects = readExtensionObjects(value, resolve, serializer);
    if (objects) { node.extensionObjects = objects; node.valueXml = undefined; }
  }
  return node;
}

const ARGUMENT_TYPE = `${UA_NAMESPACE}|i=296`;
const ARGUMENT_XML_ENCODING = 'i=297';

/** The Arguments of a ListOfExtensionObject value, or undefined if the value holds anything else. */
function readArguments(value: El, resolve: (raw: string | null) => string | undefined): Argument[] | undefined {
  const list = elementChildren(value);
  if (list.length !== 1 || list[0].localName !== 'ListOfExtensionObject') return undefined;
  const known = new Set(['Name', 'DataType', 'ValueRank', 'ArrayDimensions', 'Description']);
  const result: Argument[] = [];
  for (const eo of elementChildren(list[0])) {
    const typeId = path(eo, 'TypeId', 'Identifier');
    const body = path(eo, 'Body', 'Argument');
    if (eo.localName !== 'ExtensionObject' || !typeId || textOf(typeId) !== ARGUMENT_XML_ENCODING || !body) return undefined;
    if (elementChildren(body).some(c => !known.has(c.localName ?? ''))) return undefined;
    const dataTypeId = path(body, 'DataType', 'Identifier');
    const dataType = dataTypeId ? resolve(textOf(dataTypeId)) : undefined;
    if (!dataType) return undefined;
    const description = path(body, 'Description', 'Text');
    const locale = path(body, 'Description', 'Locale');
    const valueRank = path(body, 'ValueRank');
    const dimensions = path(body, 'ArrayDimensions');
    const name = path(body, 'Name');
    const arg: Argument = {
      name: name ? textOf(name) : '',
      dataType,
      valueRank: valueRank ? Number(textOf(valueRank)) : -1,
      arrayDimensions: dimensions ? elementChildren(dimensions).map(d => Number(textOf(d))) : [],
    };
    if (description && textOf(description)) {
      arg.description = locale && textOf(locale) ? { text: textOf(description), locale: textOf(locale) } : { text: textOf(description) };
    }
    result.push(arg);
  }
  return result;
}

/** One ExtensionObject or a list of them, or undefined if the value holds anything else. */
function readExtensionObjects(value: El, resolve: (raw: string | null) => string | undefined, serializer: XMLSerializer):
  { list: boolean; items: { typeId: string; bodyXml: string }[] } | undefined {
  const top = elementChildren(value);
  if (top.length !== 1) return undefined;
  const list = top[0].localName === 'ListOfExtensionObject';
  if (!list && top[0].localName !== 'ExtensionObject') return undefined;
  const objects = list ? elementChildren(top[0]) : [top[0]];
  const items: { typeId: string; bodyXml: string }[] = [];
  for (const eo of objects) {
    const identifier = path(eo, 'TypeId', 'Identifier');
    const body = path(eo, 'Body');
    if (eo.localName !== 'ExtensionObject' || !identifier || !body || elementChildren(eo).length !== 2) return undefined;
    const typeId = resolve(textOf(identifier));
    if (!typeId) return undefined;
    items.push({ typeId, bodyXml: innerXml(body, serializer) });
  }
  return { list, items };
}

function readDefinition(e: El, resolve: (raw: string | null) => string | undefined, resolveIndex: (i: number) => string): DataTypeDefinition {
  return {
    name: parseQualifiedName(e.getAttribute('Name') ?? '', resolveIndex),
    otherAttributes: otherAttributes(e, new Set(['Name'])),
    fields: children(e, 'Field').map(f => ({
      name: f.getAttribute('Name') ?? '',
      dataType: resolve(f.getAttribute('DataType')),
      valueRank: num(f, 'ValueRank'),
      arrayDimensions: attr(f, 'ArrayDimensions'),
      value: num(f, 'Value'),
      isOptional: bool(f, 'IsOptional'),
      description: localized(f, 'Description'),
      displayName: localized(f, 'DisplayName'),
      otherAttributes: otherAttributes(f, new Set(['Name', 'DataType', 'ValueRank', 'ArrayDimensions', 'Value', 'IsOptional'])),
    })),
  };
}

/** "ns=2;i=5", "i=5", "nsu=http://…;s=X" → key. */
export function parseNodeIdText(raw: string, resolveIndex: (i: number) => string): string {
  const text = raw.trim();
  let rest = text;
  let uri = UA_NAMESPACE;
  const ns = /^ns=(\d+);(.*)$/s.exec(text);
  const nsu = /^nsu=(.*?);([isgb]=.*)$/s.exec(text);
  if (ns) {
    uri = resolveIndex(Number(ns[1]));
    rest = ns[2];
  } else if (nsu) {
    uri = nsu[1];
    rest = nsu[2];
  }
  if (!/^[isgb]=/.test(rest)) throw new NodeSetFormatError(`'${raw}' is not a NodeId.`);
  return `${uri}|${rest}`;
}

export function parseQualifiedName(raw: string, resolveIndex: (i: number) => string): QualifiedName {
  const m = /^(\d+):(.*)$/s.exec(raw);
  return m ? { namespaceUri: resolveIndex(Number(m[1])), name: m[2] } : { namespaceUri: UA_NAMESPACE, name: raw };
}

function localized(e: El, name: string): LocalizedText[] {
  return children(e, name).map(c => {
    const locale = c.getAttribute('Locale');
    return locale ? { text: textOf(c), locale } : { text: textOf(c) };
  });
}

function innerXml(e: El, serializer: XMLSerializer): string {
  let s = '';
  for (let n = e.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) s += serializer.serializeToString(n);
  }
  return s;
}

function elementChildren(e: El): El[] {
  const result: El[] = [];
  for (let n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) result.push(n as El);
  return result;
}

function children(e: El, localName: string): El[] {
  return elementChildren(e).filter(c => c.localName === localName);
}

/** The first element along a path of child names, or undefined. */
function path(e: El, ...names: string[]): El | undefined {
  let current: El | undefined = e;
  for (const name of names) current = current ? children(current, name)[0] : undefined;
  return current;
}

function textOf(e: El): string {
  return (e.textContent ?? '').trim();
}

function attr(e: El, name: string): string | undefined {
  return e.hasAttribute(name) ? e.getAttribute(name) ?? undefined : undefined;
}

function bool(e: El, name: string): boolean | undefined {
  const v = attr(e, name);
  return v === undefined ? undefined : v.toLowerCase() === 'true';
}

function num(e: El, name: string): number | undefined {
  const v = attr(e, name);
  return v === undefined ? undefined : Number(v);
}

function otherAttributes(e: El, named: Set<string>, skipNamespaces = false): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < e.attributes.length; i++) {
    const a = e.attributes[i];
    if (named.has(a.name)) continue;
    if (skipNamespaces && (a.name === 'xmlns' || a.name.startsWith('xmlns:'))) continue;
    if (a.name.startsWith('xmlns')) continue;
    result[a.name] = a.value;
  }
  return result;
}
