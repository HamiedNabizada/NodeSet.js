// Values of Variables and VariableTypes that the panel can edit as text: the
// built-in scalar types and arrays of them (OPC 10000-6 5.3, XML encoding),
// and single structures whose fields are such values. Other structured
// values (ExtensionObjects) are left as they were read.

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

export class ValueError extends Error {}

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
 * The value as the panel shows it: a scalar as its text, an array as its
 * elements joined by "; ". Undefined when there is no value; null when the
 * value is not of a kind the panel edits.
 */
export function valueText(node: UaNode, builtIn: string | undefined): string | undefined | null {
  const xml = node.valueXml?.trim();
  if (!xml) return undefined;
  if (!builtIn) return null;
  const list = new RegExp(`^<(?:\\w+:)?ListOf${builtIn}\\b[^>]*>([\\s\\S]*)</(?:\\w+:)?ListOf${builtIn}>$`).exec(xml);
  const items = list ? elements(list[1], builtIn) : elements(xml, builtIn);
  if (items === null || (!list && items.length !== 1)) return null;
  return items.join('; ');
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

/** The XML of a value typed in the panel; an array when the ValueRank asks for one. */
export function valueXml(builtIn: string, text: string, array: boolean): string {
  const parts = array ? text.split(';').map(s => s.trim()).filter(s => s !== '') : [text.trim()];
  const encoded = parts.map(p => element(builtIn, p));
  return array
    ? `<ListOf${builtIn} xmlns="${TYPES_NS}">${encoded.join('')}</ListOf${builtIn}>`
    : encoded[0].replace(`<${builtIn}>`, `<${builtIn} xmlns="${TYPES_NS}">`);
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
    if (text === '' && f.builtIn !== 'String' && f.builtIn !== 'LocalizedText') throw new ValueError(`The field '${f.name}' needs a value.`);
    const inner = /^<[^>]+>([\s\S]*)<\/[^>]+>$/.exec(element(f.builtIn, text))![1];
    return `<${f.name}>${inner}</${f.name}>`;
  });
  return { typeId: shape.encoding, bodyXml: `<${shape.element} xmlns="${shape.namespaceUri}">${fields.join('')}</${shape.element}>` };
}

function childElements(e: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  for (let c = e.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) result.push(c as XmlElement);
  return result;
}

function scalarText(e: XmlElement, builtIn: string): string {
  const wrapped = builtIn === 'LocalizedText' ? 'Text' : builtIn === 'Guid' ? 'String' : undefined;
  if (!wrapped) return (e.textContent ?? '').trim();
  return childElements(e).find(c => c.localName === wrapped)?.textContent ?? '';
}

function element(builtIn: string, text: string): string {
  const fail = (what: string) => { throw new ValueError(`'${text}' is not ${what}.`); };
  let content = text;
  if (builtIn === 'Boolean') {
    if (!/^(true|false)$/i.test(text)) fail('true or false');
    content = text.toLowerCase();
  } else if (builtIn in INTEGER_RANGES) {
    if (!/^[+-]?\d+$/.test(text)) fail(`an integer (${builtIn})`);
    const [min, max] = INTEGER_RANGES[builtIn];
    const v = BigInt(text);
    if (v < min || v > max) fail(`within the range of ${builtIn}`);
    content = v.toString();
  } else if (builtIn === 'Float' || builtIn === 'Double') {
    if (text === '' || Number.isNaN(Number(text))) fail('a number');
  } else if (builtIn === 'DateTime') {
    const d = new Date(text);
    if (Number.isNaN(d.getTime())) fail('a date and time');
    content = d.toISOString();
  } else if (builtIn === 'Guid') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) fail('a GUID');
  } else if (builtIn === 'ByteString') {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) fail('Base64');
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
