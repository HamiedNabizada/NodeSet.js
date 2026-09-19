// Where the user placed nodes on a diagram, kept in the NodeSet itself: an
// Extension of the UANodeSet's Extensions element (OPC 10000-6 Annex F
// allows any content there), in a namespace of its own. NodeIds are written
// in the expanded form "nsu=<URI>;i=…", so the layout does not depend on
// the file's namespace table. Other tools ignore the extension.

import { DOMParser, Element as XmlElement, XMLSerializer } from '@xmldom/xmldom';
import { NodeSetFile, parseNodeIdKey } from './model';
import { parseNodeIdText } from './reader';

export const LAYOUT_NAMESPACE = 'urn:ua-modeler:diagram-layout:1';

export interface Position { x: number; y: number }

/** Diagram (by the key of the node it shows) → node key → position. */
export type Layout = Map<string, Map<string, Position>>;

const noIndex = (i: number): string => { throw new Error(`Namespace index ${i} in a layout; expected an expanded NodeId.`); };

function expanded(key: string): string {
  const { namespaceUri, identifier } = parseNodeIdKey(key);
  return `nsu=${namespaceUri};${identifier}`;
}

/** Reads the layout from the file's root Extensions, if there is one. */
export function readLayout(file: NodeSetFile): Layout {
  const layout: Layout = new Map();
  for (const raw of file.otherElements) {
    if (!raw.includes(LAYOUT_NAMESPACE)) continue;
    const doc = new DOMParser().parseFromString(raw, 'text/xml');
    const diagrams = doc.getElementsByTagNameNS(LAYOUT_NAMESPACE, 'Diagram');
    for (let i = 0; i < diagrams.length; i++) {
      const d = diagrams[i] as XmlElement;
      const positions = new Map<string, Position>();
      const shapes = d.getElementsByTagNameNS(LAYOUT_NAMESPACE, 'Shape');
      for (let j = 0; j < shapes.length; j++) {
        const s = shapes[j] as XmlElement;
        positions.set(parseNodeIdText(s.getAttribute('Node') ?? '', noIndex), { x: Number(s.getAttribute('X')), y: Number(s.getAttribute('Y')) });
      }
      layout.set(parseNodeIdText(d.getAttribute('Node') ?? '', noIndex), positions);
    }
  }
  return layout;
}

/** Writes the layout into the file's root Extensions, replacing an earlier one and keeping other extensions. */
export function writeLayout(file: NodeSetFile, layout: Layout): void {
  const ours = [...layout].filter(([, positions]) => positions.size > 0);
  const body = ours.map(([root, positions]) =>
    `<Diagram Node="${esc(expanded(root))}">` +
    [...positions].map(([node, p]) => `<Shape Node="${esc(expanded(node))}" X="${Math.round(p.x)}" Y="${Math.round(p.y)}" />`).join('') +
    '</Diagram>').join('');
  const extension = ours.length > 0 ? `<Extension><Layout xmlns="${LAYOUT_NAMESPACE}">${body}</Layout></Extension>` : '';

  const index = file.otherElements.findIndex(raw => /^<(\w+:)?Extensions\b/.test(raw));
  if (index < 0) {
    if (extension) file.otherElements.push(`<Extensions>${extension}</Extensions>`);
    return;
  }
  // Keep the other Extension children of an existing Extensions element.
  const doc = new DOMParser().parseFromString(file.otherElements[index], 'text/xml');
  const root = doc.documentElement!;
  const serializer = new XMLSerializer();
  const others: string[] = [];
  for (let n = root.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    const s = serializer.serializeToString(n);
    if (!s.includes(LAYOUT_NAMESPACE)) others.push(s);
  }
  const all = [...others, extension].filter(Boolean);
  if (all.length === 0) file.otherElements.splice(index, 1);
  else file.otherElements[index] = `<Extensions>${all.join('')}</Extensions>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
