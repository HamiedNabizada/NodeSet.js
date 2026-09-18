// Reads a NodeSet2 file into a NodeSetFile. NodeIds, BrowseNames and
// aliases are resolved against the file's own namespace table, so the result
// no longer depends on indexes.

import { DOMParser, Element as XmlElement, XMLSerializer } from '@xmldom/xmldom';
import {
  LocalizedText, ModelInfo, NodeClass, NodeSetFile, NODE_CLASSES, QualifiedName, Reference, UA_NAMESPACE, UaNode,
} from './model';

export class NodeSetFormatError extends Error {}

const NAMED_NODE_ATTRIBUTES = new Set([
  'NodeId', 'BrowseName', 'SymbolicName', 'ParentNodeId', 'IsAbstract', 'Symmetric',
  'DataType', 'ValueRank', 'ArrayDimensions', 'AccessLevel',
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
    symbolicName: attr(e, 'SymbolicName'),
    isAbstract: bool(e, 'IsAbstract'),
    symmetric: bool(e, 'Symmetric'),
    inverseName: nodeClass === 'ReferenceType' ? localized(e, 'InverseName') : undefined,
    dataType: resolve(e.getAttribute('DataType')),
    valueRank: num(e, 'ValueRank'),
    arrayDimensions: attr(e, 'ArrayDimensions'),
    accessLevel: num(e, 'AccessLevel'),
    valueXml: value ? innerXml(value, serializer) : undefined,
    definitionXml: definition ? serializer.serializeToString(definition) : undefined,
    otherAttributes: otherAttributes(e, NAMED_NODE_ATTRIBUTES),
    otherElements: elementChildren(e).filter(c => !NAMED_NODE_ELEMENTS.has(c.localName ?? '')).map(c => serializer.serializeToString(c)),
  };
  return node;
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
