// Structure values of any depth in the XML encoding (OPC 10000-6 5.3.6):
// fields of built-in types, enumerations ("Name_Value"), nested structures
// (their fields inside an element named after the field), arrays of all of
// these, optional fields (an EncodingMask first) and unions (a SwitchField,
// then the one field). A value is edited as a plain tree:
//
//   built-in field   the text, arrays as "a; b; c"
//   enumeration      the name, arrays as a list of names
//   structure        a StructValue, arrays as a list of them
//   optional field   absent (undefined) or present
//   union            exactly one field present, or none
//
// Fields that allow subtypes carry the concrete type in the value itself
// (an ExtensionObject); a structure with such a field is not edited here.

import { DOMParser, Element as XmlElement } from '@xmldom/xmldom';
import { AddressSpace } from './address-space';
import { ExtensionObjectValue, UA_NAMESPACE, UaNode, uaKey } from './model';
import { TYPES_NS, ValueError, builtInOf, childElements, element, scalarText } from './values';

export interface FieldShape {
  name: string;
  array: boolean;
  optional: boolean;
  kind: 'builtIn' | 'enum' | 'structure';
  /** kind builtIn: the built-in type. */
  builtIn?: string;
  /** kind enum: the names and numbers, and the element name of an array item. */
  enumValues?: { name: string; value: number }[];
  /** kind enum and structure: key of the field's DataType. */
  dataType?: string;
}

export interface StructShape {
  /** Key of the DataType. */
  key: string;
  /** Name and namespace of the body element. */
  element: string;
  namespaceUri: string;
  /** Key of the "Default XML" encoding, the TypeId of a value; needed at the top only. */
  encoding?: string;
  union: boolean;
  fields: FieldShape[];
}

export type FieldValue = string | string[] | StructValue | StructValue[];

/** A structure value: field name to value; an absent optional field (or unselected union field) is undefined. */
export interface StructValue {
  [field: string]: FieldValue | undefined;
}

const ENUMERATION = uaKey(29);
const STRUCTURE = uaKey(22);
const UNION = uaKey(12756);

/**
 * The shape of a structure DataType, or undefined when its values are not
 * edited here: not a structure, no definition, a field that allows subtypes,
 * a matrix, or a field of a type that is neither built-in, enumeration nor
 * such a structure. Structures that contain themselves (through an array)
 * are fine: their shapes are resolved as the value is.
 */
export function structShape(space: AddressSpace, key: string | undefined, seen = new Set<string>()): StructShape | undefined {
  const t = space.get(key);
  if (!t || !key || t.nodeClass !== 'DataType' || !t.definition || !space.isSubtypeOf(t.id, STRUCTURE)) return undefined;
  if (t.definition.fields.length === 0) return undefined;
  // Names become element names of the encoding; a name XML cannot carry is not edited here.
  if (!isXmlName(t.definition.name.name) || t.definition.fields.some(f => !isXmlName(f.name))) return undefined;
  seen.add(key);
  const union = space.isSubtypeOf(t.id, UNION) || t.definition.otherAttributes.IsUnion === 'true';
  const fields: FieldShape[] = [];
  for (const f of t.definition.fields) {
    const rank = f.valueRank ?? -1;
    if (!f.dataType || (rank !== -1 && rank !== 1) || f.otherAttributes.AllowSubTypes === 'true') return undefined;
    const base = { name: f.name, array: rank === 1, optional: f.isOptional === true };
    if (space.isSubtypeOf(f.dataType, ENUMERATION)) {
      const values = enumValues(space, f.dataType);
      if (!values) return undefined;
      fields.push({ ...base, kind: 'enum', enumValues: values, dataType: f.dataType });
    } else if (builtInOf(space, f.dataType)) {
      fields.push({ ...base, kind: 'builtIn', builtIn: builtInOf(space, f.dataType) });
    } else if (seen.has(f.dataType) || structShape(space, f.dataType, seen)) {
      fields.push({ ...base, kind: 'structure', dataType: f.dataType });
    } else {
      return undefined;
    }
  }
  const namespaceUri = t.id.startsWith(UA_NAMESPACE + '|') ? TYPES_NS : t.definition.name.namespaceUri;
  const encoding = space.out(t.id, uaKey(38)).map(e => space.get(e.target)).find(n => n?.browseName.name === 'Default XML');
  return { key, element: t.definition.name.name, namespaceUri, encoding: encoding?.id, union, fields };
}

/** A name XML allows for an element without escaping (ASCII letters, digits, '_', '-', '.'). */
function isXmlName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name);
}

function escapeAttribute(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function enumValues(space: AddressSpace, key: string): { name: string; value: number }[] | undefined {
  const fields = space.get(key)?.definition?.fields;
  if (!fields?.length) return undefined;
  return fields.map((f, i) => ({ name: f.name, value: f.value ?? i }));
}

function shapeOf(space: AddressSpace, key: string): StructShape {
  const s = structShape(space, key);
  if (!s) throw new ValueError(`Values of ${space.get(key)?.browseName.name ?? key} are not edited here.`);
  return s;
}

/** A new value: required fields empty (the first name for an enumeration), optional ones absent, unions with none chosen. */
export function emptyStructure(space: AddressSpace, key: string, depth = 0): StructValue {
  const shape = shapeOf(space, key);
  const value: StructValue = {};
  if (shape.union) return value;
  for (const f of shape.fields) {
    if (f.optional) continue;
    value[f.name] = emptyField(space, f, depth);
  }
  return value;
}

export function emptyField(space: AddressSpace, f: FieldShape, depth = 0): FieldValue {
  if (f.array) return f.kind === 'builtIn' ? '' : [];
  if (f.kind === 'enum') return f.enumValues![0].name;
  // A structure that contains itself directly and is not optional could not have a value at all.
  if (f.kind === 'structure') return depth > 16 ? {} : emptyStructure(space, f.dataType!, depth + 1);
  return '';
}

/** Reads the body element of a structure value; null when it does not fit the shape. */
export function readStructure(space: AddressSpace, key: string, body: XmlElement): StructValue | null {
  const shape = structShape(space, key);
  if (!shape) return null;
  const children = childElements(body);
  const value: StructValue = {};
  if (shape.union) {
    const sw = children.find(c => c.localName === 'SwitchField');
    const index = sw ? Number((sw.textContent ?? '').trim()) : 0;
    if (!Number.isInteger(index) || index < 0 || index > shape.fields.length) return null;
    if (index === 0) return value;
    const f = shape.fields[index - 1];
    const e = children.find(c => c.localName === f.name);
    if (!e) return null;
    const v = readField(space, f, e);
    if (v === null) return null;
    value[f.name] = v;
    return value;
  }
  const byName = new Map(children.map(c => [c.localName ?? '', c]));
  const optional = shape.fields.filter(f => f.optional);
  const mask = optional.length > 0 ? Number((byName.get('EncodingMask')?.textContent ?? '0').trim()) : 0;
  for (const f of shape.fields) {
    const e = byName.get(f.name);
    if (f.optional) {
      const bit = optional.indexOf(f);
      if (!(mask & (1 << bit)) || !e) continue;
    }
    if (!e) { value[f.name] = emptyField(space, f); continue; }
    const v = readField(space, f, e);
    if (v === null) return null;
    value[f.name] = v;
  }
  return value;
}

function readField(space: AddressSpace, f: FieldShape, e: XmlElement): FieldValue | null {
  const items = f.array ? childElements(e) : [e];
  switch (f.kind) {
    case 'builtIn': {
      const texts = items.map(i => scalarText(i, f.builtIn!));
      return f.array ? texts.join('; ') : texts[0];
    }
    case 'enum': {
      const names = items.map(i => enumName(f, (i.textContent ?? '').trim()));
      if (names.some(n => n === null)) return null;
      return f.array ? names as string[] : names[0]!;
    }
    case 'structure': {
      const values = items.map(i => readStructure(space, f.dataType!, i));
      if (values.some(v => v === null)) return null;
      return f.array ? values as StructValue[] : values[0]!;
    }
  }
}

/** "Name_Value", a name or a number as the enumeration's name. */
function enumName(f: FieldShape, text: string): string | null {
  const values = f.enumValues!;
  if (values.some(v => v.name === text)) return text;
  const number = /^(?:.*_)?(-?\d+)$/.exec(text)?.[1];
  const byNumber = number === undefined ? undefined : values.find(v => v.value === Number(number));
  return byNumber?.name ?? null;
}

/** The XML of a structure value: the body element with its fields. Throws ValueError naming the field. */
export function encodeStructure(space: AddressSpace, key: string, value: StructValue, elementName?: string, path = ''): string {
  const shape = shapeOf(space, key);
  const name = elementName ?? shape.element;
  const open = elementName ? `<${name}>` : `<${name} xmlns="${escapeAttribute(shape.namespaceUri)}">`;
  const parts: string[] = [];
  if (shape.union) {
    const chosen = shape.fields.findIndex(f => value[f.name] !== undefined);
    parts.push(`<SwitchField>${chosen + 1}</SwitchField>`);
    if (chosen >= 0) parts.push(encodeField(space, shape.fields[chosen], value[shape.fields[chosen].name]!, path));
    return `${open}${parts.join('')}</${name}>`;
  }
  const optional = shape.fields.filter(f => f.optional);
  if (optional.length > 0) {
    const mask = optional.reduce((m, f, i) => (value[f.name] !== undefined ? m | (1 << i) : m), 0);
    parts.push(`<EncodingMask>${mask}</EncodingMask>`);
  }
  for (const f of shape.fields) {
    const v = value[f.name];
    if (v === undefined) {
      if (f.optional) continue;
      throw new ValueError(`The field '${path}${f.name}' needs a value.`);
    }
    parts.push(encodeField(space, f, v, path));
  }
  return `${open}${parts.join('')}</${name}>`;
}

function encodeField(space: AddressSpace, f: FieldShape, v: FieldValue, path: string): string {
  const here = `${path}${f.name}`;
  const wrap = (inner: string) => `<${f.name}>${inner}</${f.name}>`;
  switch (f.kind) {
    case 'builtIn': {
      const text = String(v).trim();
      if (f.array) return wrap(text.split(';').map(s => s.trim()).filter(s => s !== '').map(s => scalar(f.builtIn!, s, here)).join(''));
      if (text === '' && f.builtIn !== 'String' && f.builtIn !== 'LocalizedText') throw new ValueError(`The field '${here}' needs a value.`);
      return wrap(/^<[^>]+>([\s\S]*)<\/[^>]+>$/.exec(scalar(f.builtIn!, text, here))![1]);
    }
    case 'enum': {
      const element = space.get(f.dataType)?.definition?.name.name ?? space.get(f.dataType)?.browseName.name ?? 'Enumeration';
      const names = f.array ? (v as string[]) : [v as string];
      const encoded = names.map(n => {
        const found = f.enumValues!.find(e => e.name === n);
        if (!found) throw new ValueError(`'${n}' is no value of '${here}'.`);
        return `${found.name}_${found.value}`;
      });
      return f.array ? wrap(encoded.map(e => `<${element}>${e}</${element}>`).join('')) : wrap(encoded[0]);
    }
    case 'structure': {
      if (!f.array) return encodeStructure(space, f.dataType!, v as StructValue, f.name, `${here}.`);
      const item = space.get(f.dataType)?.definition?.name.name ?? 'Structure';
      return wrap((v as StructValue[]).map((s, i) => encodeStructure(space, f.dataType!, s, item, `${here}[${i}].`)).join(''));
    }
  }
}

function scalar(builtIn: string, text: string, field: string): string {
  try {
    return element(builtIn, text);
  } catch (e) {
    if (e instanceof ValueError) throw new ValueError(`${field}: ${e.message}`);
    throw e;
  }
}

/**
 * The structure value of a Variable: one or a list. Undefined when it has
 * none; null when it is not a value of this shape (another encoding, a body
 * that does not fit).
 */
export function structureValues(space: AddressSpace, node: UaNode, shape: StructShape): { list: boolean; items: StructValue[] } | undefined | null {
  const eo = node.extensionObjects;
  if (!eo && !node.valueXml?.trim()) return undefined;
  if (!eo || eo.items.some(i => i.typeId !== shape.encoding)) return null;
  const items: StructValue[] = [];
  for (const item of eo.items) {
    const doc = new DOMParser({ onError: () => undefined }).parseFromString(`<r>${item.bodyXml}</r>`, 'text/xml');
    const body = childElements(doc.documentElement as unknown as XmlElement);
    if (body.length !== 1 || body[0].localName !== shape.element) return null;
    const v = readStructure(space, shape.key, body[0]);
    if (v === null) return null;
    items.push(v);
  }
  return { list: eo.list, items };
}

/** The ExtensionObjects of structure values, with the DataType's "Default XML" encoding as TypeId. */
export function structureObjects(space: AddressSpace, shape: StructShape, items: StructValue[]): ExtensionObjectValue[] {
  if (!shape.encoding) throw new ValueError(`${shape.element} has no "Default XML" encoding.`);
  return items.map((v, i) => ({
    typeId: shape.encoding!,
    bodyXml: encodeStructure(space, shape.key, v, undefined, items.length > 1 ? `[${i}].` : ''),
  }));
}
