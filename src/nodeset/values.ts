// Values of Variables and VariableTypes that the panel can edit as text: the
// built-in scalar types and arrays of them (OPC 10000-6 5.3, XML encoding).
// Structured values (ExtensionObjects) are left as they were read.

import { AddressSpace } from './address-space';
import { UA_NAMESPACE, UaNode, uaKey } from './model';

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
