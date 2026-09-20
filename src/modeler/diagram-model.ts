// What a diagram shows, independent of drawing: the shapes for nodes and
// the lines for references, in the notation of OPC 10000-3 Annex C.
//
// A type diagram shows a type with its instance declarations (the nodes it
// holds through hierarchical references, recursively) and its supertype. An
// instance declaration names its TypeDefinition inside its box ("::Type",
// Annex C.2.3) instead of a HasTypeDefinition line, and its ModellingRule as
// cardinality on the line that holds it (Table C.3).
//
// Layout is an indented tree: every child sits one column to the right of
// its parent and one row below the previous node. It keeps wide types such
// as DeviceType readable and needs no crossing-free placement.

import { AddressSpace, Edge, REF, RULE } from '../nodeset/address-space';
import { NodeClass, text, UaNode } from '../nodeset/model';

export type LineKind =
  | 'HasComponent'
  | 'HasProperty'
  | 'HasSubtype'
  | 'HasTypeDefinition'
  | 'Hierarchical'
  | 'NonHierarchical'
  | 'Symmetric';

export interface DiagramShape {
  /** Unique within the diagram; the node key. */
  id: string;
  nodeKey: string;
  nodeClass: NodeClass;
  label: string;
  /** "::TypeName" for Objects and Variables whose TypeDefinition is not drawn. */
  typeLabel?: string;
  /** Type nodes are italic and shadowed (Table C.1). */
  isType: boolean;
  /** The node belongs to another model than the one being edited. */
  external: boolean;
  isAbstract: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramLine {
  id: string;
  source: string;
  target: string;
  kind: LineKind;
  /** BrowseName of the ReferenceType, for kinds without a shortcut. */
  label?: string;
  /** Table C.3: "1", "0..1", "0..n", "1..n". */
  cardinality?: string;
  referenceType: string;
  waypoints: { x: number; y: number }[];
}

export interface Diagram {
  root: string;
  shapes: DiagramShape[];
  lines: DiagramLine[];
  /** Declarations left out because of the depth or node limit. */
  truncated: boolean;
}

export interface TypeDiagramOptions {
  /** Levels of instance declarations below the type. */
  depth?: number;
  maxShapes?: number;
  /** Namespaces of the model being edited; nodes of others are marked external. */
  ownNamespaces?: string[];
  /** Positions the user chose, by node key; the others are laid out as a tree. */
  positions?: ReadonlyMap<string, { x: number; y: number }>;
}

export const SIZE = {
  width: 190,
  height: 44,
  column: 64,
  row: 64,
  margin: 40,
} as const;

const TYPE_CLASSES: NodeClass[] = ['ObjectType', 'VariableType', 'DataType', 'ReferenceType'];

export function cardinality(rule: string | undefined): string | undefined {
  switch (rule) {
    case RULE.Mandatory: return '1';
    case RULE.Optional: return '0..1';
    case RULE.OptionalPlaceholder: return '0..n';
    case RULE.MandatoryPlaceholder: return '1..n';
    default: return undefined;
  }
}

export function lineKind(space: AddressSpace, referenceType: string): LineKind {
  if (referenceType === REF.HasProperty) return 'HasProperty';
  if (referenceType === REF.HasComponent) return 'HasComponent';
  if (referenceType === REF.HasSubtype) return 'HasSubtype';
  if (referenceType === REF.HasTypeDefinition) return 'HasTypeDefinition';
  const type = space.get(referenceType);
  if (type?.symmetric) return 'Symmetric';
  return space.isHierarchical(referenceType) ? 'Hierarchical' : 'NonHierarchical';
}

export function buildTypeDiagram(space: AddressSpace, typeKey: string, options: TypeDiagramOptions = {}): Diagram {
  const depth = options.depth ?? 3;
  const maxShapes = options.maxShapes ?? 200;
  const own = options.ownNamespaces;
  const type = space.get(typeKey);
  if (!type) throw new Error(`Unknown node '${typeKey}'.`);

  const shapes: DiagramShape[] = [];
  const lines: DiagramLine[] = [];
  const placed = new Map<string, DiagramShape>();
  let truncated = false;
  let row = 0;

  const shape = (node: UaNode, column: number): DiagramShape => {
    const isType = TYPE_CLASSES.includes(node.nodeClass);
    const typeDefinition = isType ? undefined : space.typeDefinition(node);
    const s: DiagramShape = {
      id: node.id,
      nodeKey: node.id,
      nodeClass: node.nodeClass,
      label: text(node.displayName) || node.browseName.name,
      typeLabel: typeDefinition ? '::' + (text(typeDefinition.displayName) || typeDefinition.browseName.name) : undefined,
      isType,
      external: own ? !own.includes(node.browseName.namespaceUri) && !own.some(ns => node.id.startsWith(ns + '|')) : false,
      isAbstract: node.isAbstract === true,
      x: options.positions?.get(node.id)?.x ?? SIZE.margin + column * SIZE.column,
      y: options.positions?.get(node.id)?.y ?? SIZE.margin + row * SIZE.row,
      width: SIZE.width,
      height: SIZE.height,
    };
    row++;
    shapes.push(s);
    placed.set(node.id, s);
    return s;
  };

  // The supertype first, then the type below it.
  const supertype = space.supertype(type);
  const superShape = supertype ? shape(supertype, 0) : undefined;
  const root = shape(type, 0);
  if (superShape) {
    lines.push({
      id: `${root.id}->${superShape.id}:subtype`,
      source: superShape.id,
      target: root.id,
      kind: 'HasSubtype',
      referenceType: REF.HasSubtype,
      waypoints: [bottom(superShape, 0.5), top(root, 0.5)],
    });
  }

  const walk = (parent: DiagramShape, node: UaNode, level: number) => {
    if (level > depth) {
      if (space.children(node).length > 0) truncated = true;
      return;
    }
    for (const { edge, node: child } of space.children(node)) {
      if (placed.has(child.id)) {
        lines.push(line(space, edge, parent, placed.get(child.id)!));
        continue;
      }
      if (shapes.length >= maxShapes) { truncated = true; return; }
      const s = shape(child, level);
      lines.push(line(space, edge, parent, s));
      walk(s, child, level + 1);
    }
  };
  walk(root, type, 1);

  // Non-hierarchical references between shapes already on the diagram. They
  // run on rails to the right of every shape, not straight across the
  // diagram: a state machine has many of them (FromState, ToState, HasCause)
  // and a line through the boxes hides what it crosses.
  const sideways: DiagramLine[] = [];
  for (const s of shapes) {
    for (const e of space.out(s.nodeKey)) {
      if (space.isHierarchical(e.type) || e.type === REF.HasTypeDefinition || e.type === REF.HasModellingRule) continue;
      const target = placed.get(e.target);
      if (target && target !== s) sideways.push(line(space, e, s, target));
    }
  }
  const edge = Math.max(...shapes.map(s => s.x + s.width));
  sideways.forEach((l, i) => {
    const source = shapes.find(s => s.id === l.source)!;
    const target = shapes.find(s => s.id === l.target)!;
    const rail = edge + 24 + (i % 5) * 14;
    l.waypoints = [
      { x: source.x + source.width, y: source.y + source.height / 2 },
      { x: rail, y: source.y + source.height / 2 },
      { x: rail, y: target.y + target.height / 2 },
      { x: target.x + target.width, y: target.y + target.height / 2 },
    ];
  });
  lines.push(...sideways);

  return { root: root.id, shapes, lines, truncated };
}

function line(space: AddressSpace, edge: Edge, source: DiagramShape, target: DiagramShape): DiagramLine {
  const kind = lineKind(space, edge.type);
  const referenceType = space.get(edge.type);
  const hierarchical = kind !== 'NonHierarchical' && kind !== 'Symmetric';
  const child = space.get(target.nodeKey);
  return {
    id: `${source.id}-${edge.type}->${target.id}`,
    source: source.id,
    target: target.id,
    kind,
    label: kind === 'HasComponent' || kind === 'HasProperty' ? undefined : referenceType?.browseName.name ?? edge.type,
    cardinality: hierarchical && child ? cardinality(space.modellingRule(child)) : undefined,
    referenceType: edge.type,
    // Tree lines leave the parent near its left edge, go down and enter the child from the left.
    waypoints: hierarchical && target.x > source.x
      ? [trunk(source), { x: trunk(source).x, y: target.y + target.height / 2 }, left(target)]
      : [right(source), right(target)],
  };
}

/** Where tree lines leave a parent: its bottom edge, near the left. */
const trunk = (s: DiagramShape) => ({ x: s.x + 20, y: s.y + s.height });
const top = (s: DiagramShape, f: number) => ({ x: s.x + s.width * f, y: s.y });
const bottom = (s: DiagramShape, f: number) => ({ x: s.x + s.width * f, y: s.y + s.height });
const left = (s: DiagramShape) => ({ x: s.x, y: s.y + s.height / 2 });
const right = (s: DiagramShape) => ({ x: s.x + s.width, y: s.y + s.height / 2 });
