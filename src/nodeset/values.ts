// Values of Variables and VariableTypes that the panel can edit as text: the
// built-in scalar types and arrays of them (OPC 10000-6 5.3, XML encoding),
// and single structures whose fields are such values. Other structured
// values (ExtensionObjects) are left as they were read.

import { Message, MessageError, msg } from './message';
import { DOMParser, Element as XmlElement } from '@xmldom/xmldom';
import { AddressSpace } from './address-space';
import { ExtensionObjectValue, UA_NAMESPACE, UaNode, uaKey } from './model';

export const TYPES_NS = 'http://opcfoundation.org/UA/2008/02/Types.xsd';

/** The built-in DataTypes by numeric id, as their XML elements are named. */
const BUILT_IN: Record<number, string> = {
  1: 'Boolean', 2: 'SByte', 3: 'Byte', 4: 'Int16', 5: 'UInt16', 6: 'Int32', 7: 'UInt32', 8: 'Int64', 9: 'UInt64',
  10: 'Float', 11: 'Double', 12: 'String', 13: 'DateTime', 14: 'Guid', 15: 'ByteString', 21: 'LocalizedText',
};

const INTEGER_RANGES: Record<string, [bigint, bigint]> = {
  SByte: [-128n, 127n], Byte: [0n, 255n], Int16: [-32768n, 32767n], UInt16: [0n, 65535n],
  Int32: [-2147483648n, 2147483647n], UInt32: [0n, 4294967295n],
  Int64: [-9223372036854775808n, 9223372036854775807n], UInt64: [0n, 18446744073709551615n],
};

/** A value the panel cannot write; its message is English, its template translatable. */
export class ValueError extends MessageError {}

/** The built-in type a DataType is encoded as, following its supertypes; enumerations are Int32. */
export function builtInOf(space: AddressSpace, dataType: string | undefined): string | undefined {
  const seen = new Set<string>();
  for (let t = dataType; t && !seen.has(t); t = space.supertypeKey(t)) {
    seen.add(t);
    if (t === uaKey(29)) return 'Int32';
    if (t.startsWith(UA_NAMESPACE + '|i=')) {
      const name = BUILT_IN[Number(t.slice(UA_NAMESPACE.length + 3))];
      if (name) return name;
    }
  }
  return undefined;
}

/**
 * A value of a built-in type, element by element: a scalar is one row of one
 * element, an array one row, a matrix of two dimensions its rows.
 */
export interface ValueElements {
  kind: 'scalar' | 'list' | 'matrix';
  rows: string[][];
}

/**
 * The value as elements of the built-in type. Undefined when there is no
 * value; null when the value is not of that type or not of a kind the panel
 * edits.
 */
export function valueElements(node: UaNode, builtIn: string | undefined): ValueElements | undefined | null {
  const xml = node.valueXml?.trim();
  if (!xml) return undefined;
  if (!builtIn) return null;
  const matrix = /^<(?:\w+:)?Matrix\b[^>]*>([\s\S]*)<\/(?:\w+:)?Matrix>$/.exec(xml);
  if (matrix) {
    const rows = matrixRows(matrix[1], builtIn);
    return rows && { kind: 'matrix', rows };
  }
  const list = new RegExp(`^<(?:\\w+:)?ListOf${builtIn}\\b[^>]*>([\\s\\S]*)</(?:\\w+:)?ListOf${builtIn}>$`).exec(xml);
  const items = list ? elements(list[1], builtIn) : elements(xml, builtIn);
  if (items === null || (!list && items.length !== 1)) return null;
  return { kind: list ? 'list' : 'scalar', rows: [items] };
}

/**
 * The value as the panel shows it: a scalar as its text, an array as its
 * elements joined by "; ", a matrix of two dimensions row by row, the rows
 * joined by " | ". Undefined when there is no value; null when the value is
 * not of a kind the panel edits.
 */
export function valueText(node: UaNode, builtIn: string | undefined): string | undefined | null {
  const value = valueElements(node, builtIn);
  return value ? value.rows.map(r => r.join('; ')).join(' | ') : value;
}

/**
 * The elements in the shape a ValueRank asks for, or undefined when they do
 * not have it: Scalar takes one element, OneDimension one row, TwoDimensions
 * a matrix (an array becomes its one row), Any whatever there is.
 */
export function shapeFor(value: ValueElements, rank: number): ValueElements | undefined {
  const all = value.rows.flat();
  const oneRow = value.kind !== 'matrix' || value.rows.length === 1;
  switch (rank) {
    case -1: return all.length === 1 ? { kind: 'scalar', rows: [all] } : undefined;
    case -2: return value;
    case -3: return value.kind === 'scalar' ? value : oneRow ? { kind: 'list', rows: [all] } : undefined;
    case 0: return value.kind === 'scalar' ? { kind: 'list', rows: [all] } : value;
    case 1: return oneRow ? { kind: 'list', rows: [all] } : undefined;
    case 2: return value.kind === 'matrix' ? value : all.length > 0 ? { kind: 'matrix', rows: [all] } : undefined;
    default: return undefined;
  }
}

/** The XML of a value from its elements; throws ValueError for an element that is not of the type. */
export function elementsXml(builtIn: string, value: ValueElements): string {
  if (value.kind === 'matrix') return matrixOf(builtIn, value.rows);
  if (value.kind === 'list') return `<ListOf${builtIn} xmlns="${TYPES_NS}">${value.rows[0].map(p => element(builtIn, p)).join('')}</ListOf${builtIn}>`;
  return element(builtIn, value.rows[0][0]).replace(`<${builtIn}>`, `<${builtIn} xmlns="${TYPES_NS}">`);
}

/** The names of the built-in types the panel edits, as XML elements. */
const BUILT_IN_NAMES = new Set(Object.values(BUILT_IN));

/**
 * Why the value read from a file does not fit the DataType and ValueRank of
 * its node, or undefined when it fits or nothing can be told: values of
 * DataTypes that are no built-in type the panel knows (abstract ones, NodeId,
 * structures …) are checked for their shape only, ExtensionObjects and
 * arguments not at all.
 */
export function valueMisfit(space: AddressSpace, node: UaNode): Message | undefined {
  const xml = node.valueXml?.trim();
  if (!xml || node.arguments || node.extensionObjects) return undefined;
  const top = /^<(?:\w+:)?(\w+)\b/.exec(xml)?.[1];
  if (!top || top === 'ExtensionObject' || top === 'ListOfExtensionObject') return undefined;
  const kind = top === 'Matrix' ? 'matrix' : top.startsWith('ListOf') ? 'list' : 'scalar';
  const rank = node.valueRank ?? -1;
  if (kind === 'scalar' && rank !== -1 && rank !== -2 && rank !== -3) return msg`its value is a single element, but its ValueRank is ${rank}.`;
  if (kind === 'list' && rank !== 0 && rank !== 1 && rank !== -2 && rank !== -3) return msg`its value is an array, but its ValueRank is ${rank}.`;
  if (kind === 'matrix' && rank !== 0 && rank !== -2 && rank < 2) return msg`its value is a matrix, but its ValueRank is ${rank}.`;

  const builtIn = builtInOf(space, node.dataType);
  if (!builtIn) return undefined;
  const name = kind === 'list' ? top.slice('ListOf'.length) : kind === 'scalar' ? top : builtIn;
  if (name !== builtIn) return BUILT_IN_NAMES.has(name) ? msg`its value is a ${name}, not a ${builtIn} as its DataType asks.` : undefined;
  for (const text of valueElements(node, builtIn)?.rows.flat() ?? []) {
    // What XML Schema allows besides what the panel writes.
    if ((builtIn === 'Float' || builtIn === 'Double') && /^[+-]?(INF|NaN)$/.test(text)) continue;
    if (builtIn === 'Boolean' && /^[01]$/.test(text)) continue;
    try {
      element(builtIn, builtIn === 'ByteString' ? text.replace(/\s+/g, '') : text);
    } catch (e) {
      if (e instanceof ValueError) return msg`its value does not fit its DataType: ${e}`;
      throw e;
    }
  }
  return undefined;
}

function elements(xml: string, builtIn: string): string[] | null {
  const result: string[] = [];
  const re = new RegExp(`<(?:\\w+:)?${builtIn}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${builtIn}>)`, 'g');
  let rest = xml;
  for (const m of xml.matchAll(re)) {
    rest = rest.replace(m[0], '');
    const inner = m[1] ?? '';
    const wrapped = builtIn === 'LocalizedText' ? 'Text' : builtIn === 'Guid' ? 'String' : undefined;
    result.push(unescape(wrapped ? new RegExp(`<(?:\\w+:)?${wrapped}>([\\s\\S]*?)<`).exec(inner)?.[1] ?? '' : inner.trim()));
  }
  return rest.trim() === '' ? result : null;
}

/** A Matrix of two dimensions as rows; null for other ranks and for elements that do not add up. */
function matrixRows(inner: string, builtIn: string): string[][] | null {
  const dimensions = /<(?:\w+:)?Dimensions>([\s\S]*?)<\/(?:\w+:)?Dimensions>/.exec(inner);
  const sizes = dimensions ? elements(dimensions[1], 'Int32')?.map(Number) : null;
  const value = /<(?:\w+:)?Value>([\s\S]*)<\/(?:\w+:)?Value>/.exec(inner);
  const items = value ? elements(value[1], builtIn) : [];
  if (!sizes || sizes.length !== 2 || items === null || items.length !== sizes[0] * sizes[1] || sizes[1] === 0) return null;
  const rows: string[][] = [];
  for (let i = 0; i < items.length; i += sizes[1]) rows.push(items.slice(i, i + sizes[1]));
  return rows;
}

/**
 * The XML of a matrix typed in the panel, rows separated by "|" and the
 * elements of a row by ";": a Matrix with its Dimensions and its elements,
 * the last dimension running fastest (OPC 10000-6).
 */
export function matrixXml(builtIn: string, text: string): string {
  return matrixOf(builtIn, text.split('|').map(r => r.split(';').map(c => c.trim()).filter(c => c !== '')).filter(r => r.length > 0));
}

function matrixOf(builtIn: string, rows: string[][]): string {
  if (rows.length === 0) throw new ValueError(msg`A matrix needs at least one row.`);
  const width = rows[0].length;
  if (rows.some(r => r.length !== width)) throw new ValueError(msg`Every row of the matrix needs ${width} element(s), as the first has.`);
  const cells = rows.flat().map(c => element(builtIn, c)).join('');
  return `<Matrix xmlns="${TYPES_NS}"><Dimensions><Int32>${rows.length}</Int32><Int32>${width}</Int32></Dimensions><Value>${cells}</Value></Matrix>`;
}

/** The XML of a value typed in the panel; an array when the ValueRank asks for one. */
export function valueXml(builtIn: string, text: string, array: boolean): string {
  const parts = array ? text.split(';').map(s => s.trim()).filter(s => s !== '') : [text.trim()];
  return elementsXml(builtIn, { kind: array ? 'list' : 'scalar', rows: [parts] });
}

/** A structure the panel can edit: every field a built-in type, no optional fields. */
export interface StructureShape {
  /** Key of its "Default XML" DataTypeEncoding, the TypeId of its values. */
  encoding: string;
  /** Name and namespace of the body element. */
  element: string;
  namespaceUri: string;
  fields: { name: string; builtIn: string; array: boolean }[];
}

/**
 * The shape of a structure's values, or undefined when the panel cannot edit
 * them: unions, optional fields, fields that are structures or enumerations
 * (enumerations are "Name_Value" strings in XML), or no XML encoding.
 */
export function structureOf(space: AddressSpace, dataType: string | undefined): StructureShape | undefined {
  const t = space.get(dataType);
  if (!t || t.nodeClass !== 'DataType' || !t.definition || !space.isSubtypeOf(t.id, uaKey(22)) || space.isSubtypeOf(t.id, uaKey(12756))) return undefined;
  if (t.definition.otherAttributes.IsUnion === 'true' || t.definition.fields.length === 0) return undefined;
  const encoding = space.out(t.id, uaKey(38)).map(e => space.get(e.target)).find(n => n?.browseName.name === 'Default XML');
  if (!encoding) return undefined;
  const fields: StructureShape['fields'] = [];
  for (const f of t.definition.fields) {
    if (f.isOptional || !f.dataType || space.isSubtypeOf(f.dataType, uaKey(29))) return undefined;
    const builtIn = builtInOf(space, f.dataType);
    const rank = f.valueRank ?? -1;
    if (!builtIn || (rank !== -1 && rank !== 1)) return undefined;
    fields.push({ name: f.name, builtIn, array: rank === 1 });
  }
  const namespaceUri = t.id.startsWith(UA_NAMESPACE + '|') ? TYPES_NS : t.definition.name.namespaceUri;
  return { encoding: encoding.id, element: t.definition.name.name, namespaceUri, fields };
}

/**
 * The fields of a single structure value as the panel shows them. Undefined
 * when there is no value; null when the value is not one of this shape.
 */
export function structureText(node: UaNode, shape: StructureShape): Record<string, string> | undefined | null {
  const eo = node.extensionObjects;
  if (!eo && !node.valueXml?.trim()) return undefined;
  if (!eo || eo.list || eo.items.length !== 1 || eo.items[0].typeId !== shape.encoding) return null;
  const doc = new DOMParser({ onError: () => undefined }).parseFromString(`<r>${eo.items[0].bodyXml}</r>`, 'text/xml');
  const body = childElements(doc.documentElement as unknown as XmlElement);
  if (body.length !== 1 || body[0].localName !== shape.element) return null;
  const byName = new Map(childElements(body[0]).map(e => [e.localName ?? '', e]));
  const result: Record<string, string> = {};
  for (const f of shape.fields) {
    const e = byName.get(f.name);
    if (!e) { result[f.name] = ''; continue; }
    const items = f.array ? childElements(e) : [e];
    result[f.name] = items.map(i => scalarText(i, f.builtIn)).join('; ');
  }
  return result;
}

/** The ExtensionObject of a structure value typed in the panel, field by field. */
export function structureValue(shape: StructureShape, values: Record<string, string>): ExtensionObjectValue {
  const fields = shape.fields.map(f => {
    const text = (values[f.name] ?? '').trim();
    if (f.array) {
      const parts = text.split(';').map(s => s.trim()).filter(s => s !== '');
      return `<${f.name}>${parts.map(p => element(f.builtIn, p)).join('')}</${f.name}>`;
    }
    if (text === '' && f.builtIn !== 'String' && f.builtIn !== 'LocalizedText') throw new ValueError(msg`The field '${f.name}' needs a value.`);
    const inner = /^<[^>]+>([\s\S]*)<\/[^>]+>$/.exec(element(f.builtIn, text))![1];
    return `<${f.name}>${inner}</${f.name}>`;
  });
  return { typeId: shape.encoding, bodyXml: `<${shape.element} xmlns="${shape.namespaceUri}">${fields.join('')}</${shape.element}>` };
}

export function childElements(e: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  for (let c = e.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) result.push(c as XmlElement);
  return result;
}

export function scalarText(e: XmlElement, builtIn: string): string {
  const wrapped = builtIn === 'LocalizedText' ? 'Text' : builtIn === 'Guid' ? 'String' : undefined;
  if (!wrapped) return (e.textContent ?? '').trim();
  return childElements(e).find(c => c.localName === wrapped)?.textContent ?? '';
}

/** A scalar of a built-in type as its XML element; throws ValueError for text that is not of the type. */
export function element(builtIn: string, text: string): string {
  const fail = (message: Message) => { throw new ValueError(message); };
  let content = text;
  if (builtIn === 'Boolean') {
    if (!/^(true|false)$/i.test(text)) fail(msg`'${text}' is not true or false.`);
    content = text.toLowerCase();
  } else if (builtIn in INTEGER_RANGES) {
    if (!/^[+-]?\d+$/.test(text)) fail(msg`'${text}' is not an integer (${builtIn}).`);
    const [min, max] = INTEGER_RANGES[builtIn];
    const v = BigInt(text);
    if (v < min || v > max) fail(msg`'${text}' is not within the range of ${builtIn}.`);
    content = v.toString();
  } else if (builtIn === 'Float' || builtIn === 'Double') {
    if (text === '' || Number.isNaN(Number(text))) fail(msg`'${text}' is not a number.`);
  } else if (builtIn === 'DateTime') {
    const d = new Date(text);
    if (Number.isNaN(d.getTime())) fail(msg`'${text}' is not a date and time.`);
    content = d.toISOString();
  } else if (builtIn === 'Guid') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) fail(msg`'${text}' is not a GUID.`);
  } else if (builtIn === 'ByteString') {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) fail(msg`'${text}' is not Base64.`);
  }
  if (builtIn === 'LocalizedText') return `<LocalizedText><Text>${escape(content)}</Text></LocalizedText>`;
  if (builtIn === 'Guid') return `<Guid><String>${escape(content)}</String></Guid>`;
  return `<${builtIn}>${escape(content)}</${builtIn}>`;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescape(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
