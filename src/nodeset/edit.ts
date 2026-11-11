// Changes to the editable NodeSet. Every change keeps the file consistent
// the way NodeSets are usually written: a parent holds a forward reference to
// its child, the child an inverse one and its ParentNodeId; a subtype holds
// the inverse HasSubtype to its supertype. New nodes get the next free
// numeric NodeId of the model's namespace.
//
// Undo keeps what a step changed, not a copy of the file: after every change
// each node is written as JSON and compared with the state before, and the
// nodes that differ are kept as they were and as they became, with where
// added and removed nodes stood. A copy of the whole file had cost 250 ms and
// 23 MB a step for a model like Pumps; comparing costs about half the time,
// and a step keeps a few KB. Writing every node is what makes it safe: no
// edit can change a node without the step noticing.

import { AddressSpace, REF, RULE, SM } from './address-space';
import { insideType } from './checks';
import { readStateMachine } from './statemachine';
import { builtInOf, elementsXml, matrixXml, shapeFor, structureOf, structureValue, valueElements, ValueError, valueXml } from './values';
import { StructValue, structShape, structureObjects } from './structures';
import { Argument, NodeClass, NodeSetFile, parseNodeIdKey, Reference, text, UA_NAMESPACE, uaKey, UaNode } from './model';
import { Message, MessageError, msg } from './message';

/** A change the model does not allow; its message is English, its template translatable. */
export class EditError extends MessageError {}

export const TYPE_DEFAULTS = {
  ObjectType: { supertype: uaKey(58) }, // BaseObjectType
  VariableType: { supertype: uaKey(63) }, // BaseDataVariableType
  DataType: { supertype: uaKey(22) }, // Structure
  ReferenceType: { supertype: uaKey(32) }, // NonHierarchicalReferences
} as const;

export const TYPE_DEFINITIONS = {
  Object: uaKey(58), // BaseObjectType
  Variable: uaKey(63), // BaseDataVariableType
  Property: uaKey(68), // PropertyType
} as const;

export type DeclarationKind = 'Object' | 'Variable' | 'Property' | 'Method';

export interface FieldInput {
  name: string;
  dataType?: string;
  valueRank?: number;
  isOptional?: boolean;
  /** The field may hold a subtype of its DataType (AllowSubTypes; StructureWithSubtypedValues). */
  allowSubTypes?: boolean;
  description?: string;
  value?: number;
}

/** What the fields of a DataType's definition describe. */
export type FieldKind = 'enumeration' | 'optionSet' | 'union' | 'structure';

export interface InstantiateOptions {
  /** Where to put the instance; the Objects folder when missing. */
  parent?: string;
  /** How the parent holds it; HasComponent by default. */
  referenceType?: string;
  /** Which Optional declarations to include, by path relative to the instance. */
  optional?: (path: string) => boolean;
  allowAbstract?: boolean;
}

const OBJECTS_FOLDER = uaKey(85);
const ARGUMENT = uaKey(296);
const STRUCTURE = uaKey(22);
const ENUMERATION = uaKey(29);
const HAS_ENCODING = uaKey(38);
const ENUM_VALUE_TYPE = uaKey(7594);
const OPTION_SET = uaKey(12755);
const UNION = uaKey(12756);
const UINTEGER = uaKey(28);
/** Bits of the unsigned integers an OptionSet can be a subtype of. */
const BITS: Record<string, number> = { [uaKey(3)]: 8, [uaKey(5)]: 16, [uaKey(7)]: 32, [uaKey(9)]: 64 };

/**
 * Enumerations, OptionSets (subtypes of an unsigned integer or of the
 * OptionSet structure), unions and other structures have fields; other
 * DataTypes have none.
 */
export function fieldKind(space: AddressSpace, dataType: string): FieldKind | undefined {
  if (space.isSubtypeOf(dataType, ENUMERATION)) return 'enumeration';
  if (space.isSubtypeOf(dataType, UINTEGER) || space.isSubtypeOf(dataType, OPTION_SET)) return 'optionSet';
  if (space.isSubtypeOf(dataType, UNION)) return 'union';
  if (space.isSubtypeOf(dataType, STRUCTURE)) return 'structure';
  return undefined;
}

/** How many bits an OptionSet has: those of the integer it refines, any number for the OptionSet structure. */
function optionBits(space: AddressSpace, dataType: string): number | undefined {
  for (const [key, bits] of Object.entries(BITS)) if (space.isSubtypeOf(dataType, key)) return bits;
  return space.isSubtypeOf(dataType, OPTION_SET) ? undefined : 64;
}

/** One declaration of a type, with the declarations it overrides, the base first. */
interface Declaration {
  node: UaNode;
  refType: string;
  overrides: UaNode[];
}

function qualified(n: UaNode): string {
  return `${n.browseName.namespaceUri}|${n.browseName.name}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function newModel(modelUri: string, version = '1.0.0'): NodeSetFile {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(modelUri)) throw new EditError(msg`'${modelUri}' is not a URI.`);
  return {
    namespaceUris: [modelUri],
    serverUris: [],
    models: [{
      modelUri,
      version,
      publicationDate: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      requiredModels: [{ modelUri: UA_NAMESPACE }],
      otherAttributes: {},
    }],
    aliases: new Map([
      ['HasComponent', REF.HasComponent], ['HasProperty', REF.HasProperty], ['HasSubtype', REF.HasSubtype],
      ['HasTypeDefinition', REF.HasTypeDefinition], ['HasModellingRule', REF.HasModellingRule], ['Organizes', REF.Organizes],
    ]),
    nodes: [],
    otherAttributes: {},
    otherElements: [],
  };
}

/** How many steps undo keeps. */
const UNDO_STEPS = 100;

/** The file apart from its nodes: namespaces, models, aliases, what the modeler does not name. */
function metaOf(file: NodeSetFile): string {
  return JSON.stringify({
    namespaceUris: file.namespaceUris, serverUris: file.serverUris, models: file.models, aliases: [...file.aliases],
    lastModified: file.lastModified, otherAttributes: file.otherAttributes, otherElements: file.otherElements,
  });
}

function setMeta(file: NodeSetFile, json: string): void {
  const m = JSON.parse(json);
  file.namespaceUris = m.namespaceUris;
  file.serverUris = m.serverUris;
  file.models = m.models;
  file.aliases = new Map(m.aliases);
  file.lastModified = m.lastModified;
  file.otherAttributes = m.otherAttributes;
  file.otherElements = m.otherElements;
}

/** The file as JSON, node by node, as undo compares it. */
interface Recorded {
  nodes: Map<string, string>;
  order: string[];
  meta: string;
}

type Side = 'before' | 'after';

/**
 * One undo step: the nodes it changed as JSON before and after (undefined
 * where the node was not there), where added and removed nodes stood, and the
 * rest of the file when that changed.
 */
interface Step {
  before: Map<string, string | undefined>;
  after: Map<string, string | undefined>;
  /** Index in that side's order of each node only that side has. */
  placed: Record<Side, [string, number][]>;
  /** Both orders in full, only when the nodes both sides have changed their order. */
  order?: Record<Side, string[]>;
  meta?: Record<Side, string>;
}

export class ModelEditor {
  private readonly undoStack: Step[] = [];
  private readonly redoStack: Step[] = [];
  /** The file as the last step left it; recorded at the first change. */
  private recordedState?: Recorded;
  /** Inside a batch the changes become one step when the outermost batch ends. */
  private batching = 0;
  /** The highest number of a NodeId the file named or the editor gave out; see nextId. */
  private highest?: number;

  /**
   * @param file the editable file, changed in place
   * @param rebuild called after every change with the file, to reload the address space
   */
  constructor(public file: NodeSetFile, private readonly space: () => AddressSpace, private readonly rebuild: (file: NodeSetFile) => void) {}

  get namespace(): string {
    return this.file.models[0]?.modelUri ?? this.file.namespaceUris[0];
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** How much undo and redo hold, in characters of JSON. */
  get undoCharacters(): number {
    let count = 0;
    for (const step of [...this.undoStack, ...this.redoStack]) {
      for (const side of [step.before, step.after]) for (const json of side.values()) count += json?.length ?? 0;
      for (const [id] of [...step.placed.before, ...step.placed.after]) count += id.length;
      if (step.order) count += [...step.order.before, ...step.order.after].reduce((n, id) => n + id.length, 0);
      if (step.meta) count += step.meta.before.length + step.meta.after.length;
    }
    return count;
  }

  undo(): void {
    const step = this.undoStack.pop();
    if (!step) return;
    this.apply(step, 'before');
    this.redoStack.push(step);
  }

  redo(): void {
    const step = this.redoStack.pop();
    if (!step) return;
    this.apply(step, 'after');
    this.undoStack.push(step);
  }

  /**
   * Takes the file as it is now as the state undo starts from, without a
   * step: for changes made outside the editor, such as the required models
   * and the layout that saving writes into the file.
   */
  acceptOutsideChanges(): void {
    if (this.recordedState) this.recordedState = this.record();
  }

  /**
   * Runs several edits as one step: undo takes them back together, and when
   * one fails none of them stays.
   */
  batch<T>(action: () => T): T {
    this.recorded();
    this.batching++;
    try {
      const result = action();
      if (--this.batching === 0) this.commit();
      return result;
    } catch (e) {
      if (--this.batching === 0) this.revert();
      throw e;
    }
  }

  /** Runs a change as one undo step. A failing change leaves the file as it was. */
  private change<T>(action: () => T): T {
    this.recorded();
    if (this.batching > 0) {
      // The batch keeps or reverts the whole; what a later edit of it asks needs the index now.
      const result = action();
      this.rebuild(this.file);
      return result;
    }
    try {
      const result = action();
      this.commit();
      this.rebuild(this.file);
      return result;
    } catch (e) {
      this.revert();
      throw e;
    }
  }

  private record(): Recorded {
    return {
      nodes: new Map(this.file.nodes.map(n => [n.id, JSON.stringify(n)])),
      order: this.file.nodes.map(n => n.id),
      meta: metaOf(this.file),
    };
  }

  private recorded(): Recorded {
    return this.recordedState ??= this.record();
  }

  /** What changed since the recorded state, as a step (none when nothing did), and the state now. */
  private diff(): { step?: Step; now: Recorded } {
    const was = this.recorded();
    const now = this.record();
    const before = new Map<string, string | undefined>();
    const after = new Map<string, string | undefined>();
    for (const [id, json] of now.nodes) {
      const old = was.nodes.get(id);
      if (old !== json) { before.set(id, old); after.set(id, json); }
    }
    for (const [id, json] of was.nodes) if (!now.nodes.has(id)) { before.set(id, json); after.set(id, undefined); }

    const placed: Record<Side, [string, number][]> = { before: [], after: [] };
    was.order.forEach((id, i) => { if (!now.nodes.has(id)) placed.before.push([id, i]); });
    now.order.forEach((id, i) => { if (!was.nodes.has(id)) placed.after.push([id, i]); });
    const common = (order: string[], other: Map<string, string>) => order.filter(id => other.has(id));
    const wasCommon = common(was.order, now.nodes);
    const nowCommon = common(now.order, was.nodes);
    const reordered = wasCommon.length !== nowCommon.length || wasCommon.some((id, i) => id !== nowCommon[i]);
    const metaChanged = was.meta !== now.meta;
    if (before.size === 0 && !reordered && !metaChanged) return { now };
    return {
      step: {
        before, after, placed,
        order: reordered ? { before: was.order, after: now.order } : undefined,
        meta: metaChanged ? { before: was.meta, after: now.meta } : undefined,
      },
      now,
    };
  }

  /** Keeps what the change did as a step, dropping the oldest beyond the limit. */
  private commit(): void {
    const { step, now } = this.diff();
    this.recordedState = now;
    if (!step) return;
    this.undoStack.push(step);
    if (this.undoStack.length > UNDO_STEPS) this.undoStack.splice(0, this.undoStack.length - UNDO_STEPS);
    this.redoStack.length = 0;
  }

  /** Puts back what a failed change did. */
  private revert(): void {
    const { step } = this.diff();
    if (step) this.apply(step, 'before');
    else this.rebuild(this.file);
  }

  /** Brings the file to one side of a step; nodes the step did not touch keep their objects. */
  private apply(step: Step, side: Side): void {
    const changed = step[side];
    const byId = new Map(this.file.nodes.map(n => [n.id, n]));
    for (const [id, json] of changed) {
      if (json === undefined) byId.delete(id);
      else byId.set(id, JSON.parse(json) as UaNode);
    }
    let order: string[];
    if (step.order) {
      order = [...step.order[side]];
    } else {
      order = this.file.nodes.map(n => n.id).filter(id => changed.get(id) !== undefined || !changed.has(id));
      for (const [id, index] of [...step.placed[side]].sort((a, b) => a[1] - b[1])) order.splice(index, 0, id);
    }
    this.file.nodes = order.map(id => byId.get(id)!);
    if (step.meta) setMeta(this.file, step.meta[side]);

    const state = this.recorded();
    for (const [id, json] of changed) {
      if (json === undefined) state.nodes.delete(id);
      else state.nodes.set(id, json);
    }
    state.order = order;
    if (step.meta) state.meta = step.meta[side];
    this.rebuild(this.file);
  }

  private node(key: string): UaNode {
    const n = this.file.nodes.find(x => x.id === key);
    if (!n) throw new EditError(msg`'${key}' is not part of the model being edited.`);
    return n;
  }

  /**
   * The next free numeric NodeId of the model's namespace. Numbers count on
   * from the highest the file names anywhere (a node, a reference, a
   * DataType) and the highest given out while editing, so a node deleted,
   * or one an undo took back, never passes its NodeId to another.
   */
  private nextId(): string {
    if (this.highest === undefined) {
      let max = 999;
      const note = (key: string | undefined) => {
        if (!key) return;
        const { namespaceUri, identifier } = parseNodeIdKey(key);
        if (namespaceUri === this.namespace && identifier.startsWith('i=')) max = Math.max(max, Number(identifier.slice(2)) || 0);
      };
      for (const n of this.file.nodes) {
        note(n.id); note(n.parent); note(n.dataType); note(n.methodDeclaration);
        for (const r of n.references) { note(r.type); note(r.target); }
        for (const a of n.arguments ?? []) note(a.dataType);
        for (const f of n.definition?.fields ?? []) note(f.dataType);
      }
      this.highest = max;
    }
    let key: string;
    do key = `${this.namespace}|i=${++this.highest}`;
    while (this.file.nodes.some(n => n.id === key));
    return key;
  }

  private create(nodeClass: NodeClass, name: string): UaNode {
    const trimmed = name.trim();
    if (!trimmed) throw new EditError(msg`A name is required.`);
    const n: UaNode = {
      id: this.nextId(),
      nodeClass,
      browseName: { namespaceUri: this.namespace, name: trimmed },
      displayName: [{ text: trimmed }],
      description: [],
      references: [],
      otherAttributes: {},
      otherElements: [],
    };
    this.file.nodes.push(n);
    return n;
  }

  addType(nodeClass: 'ObjectType' | 'VariableType' | 'DataType' | 'ReferenceType', name: string, supertype?: string): string {
    return this.change(() => {
      const base = supertype ?? TYPE_DEFAULTS[nodeClass].supertype;
      const baseNode = this.space().get(base);
      if (!baseNode || baseNode.nodeClass !== nodeClass) throw new EditError(msg`The supertype must be a ${nodeClass}.`);
      const t = this.create(nodeClass, name);
      t.references.push({ type: REF.HasSubtype, isForward: false, target: base });
      if (nodeClass === 'VariableType') { t.dataType = uaKey(24); t.valueRank = -2; } // BaseDataType, any rank
      if (nodeClass === 'ReferenceType') t.inverseName = [{ text: `Inverse${name.trim()}` }];
      if (nodeClass === 'DataType' && this.space().isSubtypeOf(base, STRUCTURE)) this.ensureEncodings(t);
      return t.id;
    });
  }

  /** Adds an instance declaration below a type or another declaration. */
  addDeclaration(parent: string, kind: DeclarationKind, name: string, modellingRule: string = RULE.Mandatory): string {
    return this.change(() => {
      const p = this.node(parent);
      if (!['ObjectType', 'VariableType', 'Object', 'Variable'].includes(p.nodeClass)) {
        throw new EditError(msg`A ${p.nodeClass} cannot hold instance declarations.`);
      }
      const siblings = this.space().children(p).map(c => c.node.browseName.name);
      if (siblings.includes(name.trim())) throw new EditError(msg`'${p.browseName.name}' already has a child named '${name.trim()}'.`);
      const nodeClass: NodeClass = kind === 'Property' ? 'Variable' : kind;
      const d = this.create(nodeClass, name);
      const refType = kind === 'Property' ? REF.HasProperty : REF.HasComponent;
      p.references.push({ type: refType, isForward: true, target: d.id });
      d.references.push({ type: refType, isForward: false, target: p.id });
      d.parent = p.id;
      if (kind !== 'Method') d.references.push({ type: REF.HasTypeDefinition, isForward: true, target: TYPE_DEFINITIONS[kind] });
      // Only declarations of a type have a ModellingRule; children of instances do not.
      if (p.nodeClass.endsWith('Type') || insideType(this.space(), p)) {
        d.references.push({ type: REF.HasModellingRule, isForward: true, target: modellingRule });
      }
      if (nodeClass === 'Variable') { d.dataType = uaKey(24); d.valueRank = -1; }
      return d.id;
    });
  }

  rename(key: string, name: string): void {
    this.change(() => {
      const n = this.node(key);
      const trimmed = name.trim();
      if (!trimmed) throw new EditError(msg`A name is required.`);
      const parent = this.space().parentOf(n);
      if (parent && this.space().children(parent).some(c => c.node.id !== key && c.node.browseName.name === trimmed)) {
        throw new EditError(msg`'${parent.browseName.name}' already has a child named '${trimmed}'.`);
      }
      n.browseName = { ...n.browseName, name: trimmed };
      n.displayName = [{ ...(n.displayName[0] ?? {}), text: trimmed }];
      if (n.definition) n.definition.name = n.browseName;
    });
  }

  setDescription(key: string, description: string): void {
    this.change(() => {
      const n = this.node(key);
      n.description = description.trim() ? [{ text: description.trim() }] : [];
    });
  }

  setAbstract(key: string, isAbstract: boolean): void {
    this.change(() => {
      const n = this.node(key);
      n.isAbstract = isAbstract ? true : undefined;
      // An abstract DataType is never encoded, so it is the source of no
      // HasEncoding (OPC 10000-3); a concrete structure needs its encodings.
      if (n.nodeClass !== 'DataType') return;
      if (isAbstract) this.removeEncodings(n);
      else if (this.space().isSubtypeOf(n.id, uaKey(22))) this.ensureEncodings(n);
    });
  }

  /** Removes the encodings of a DataType with the nodes that carry them. */
  private removeEncodings(dataType: UaNode): void {
    const encodings = dataType.references
      .filter(r => r.type === uaKey(38) && r.isForward)
      .map(r => r.target);
    if (encodings.length === 0) return;
    dataType.references = dataType.references.filter(r => !(r.type === uaKey(38) && r.isForward));
    this.file.nodes = this.file.nodes.filter(n => !encodings.includes(n.id));
    for (const n of this.file.nodes) {
      n.references = n.references.filter(r => !encodings.includes(r.target));
    }
  }

  setSupertype(key: string, supertype: string): void {
    this.change(() => {
      const n = this.node(key);
      const base = this.space().get(supertype);
      if (!base || base.nodeClass !== n.nodeClass) throw new EditError(msg`The supertype must be a ${n.nodeClass}.`);
      if (this.space().isSubtypeOf(supertype, key)) throw new EditError(msg`'${base.browseName.name}' is a subtype of '${n.browseName.name}'.`);
      // The file may also hold the reference forward, on the old supertype.
      for (const other of this.file.nodes) {
        other.references = other.references.filter(r => !(r.type === REF.HasSubtype && r.isForward && r.target === key));
      }
      const kindBefore = n.nodeClass === 'DataType' ? fieldKind(this.space(), key) : undefined;
      this.replaceSingle(n, REF.HasSubtype, false, supertype);
      if (n.nodeClass === 'DataType') this.fitDataType(n, kindBefore, supertype);
    });
  }

  /**
   * After a DataType got another supertype: encodings only for structures,
   * and fields that fit what the DataType now is. Fields carry over between
   * structures and unions, and between enumerations and OptionSets; otherwise
   * they are removed, with the properties that named them.
   * The address space still has the old supertype, so the new one decides.
   */
  private fitDataType(d: UaNode, before: FieldKind | undefined, supertype: string) {
    const space = this.space();
    const after = fieldKind(space, supertype);
    if (space.isSubtypeOf(supertype, STRUCTURE)) {
      this.ensureEncodings(d);
    } else {
      const encodings = d.references.filter(r => r.type === HAS_ENCODING && r.isForward && this.owns(r.target)).map(r => r.target);
      this.removeNodes(new Set(encodings));
      d.references = d.references.filter(r => r.type !== HAS_ENCODING);
    }
    if (before === after || !d.definition) return;
    const numbered = (k: FieldKind | undefined) => k === 'enumeration' || k === 'optionSet';
    const standard = ['EnumStrings', 'EnumValues', 'OptionSetValues'];
    const doomed = space.children(d).filter(c => standard.includes(c.node.browseName.name) && c.node.browseName.namespaceUri === UA_NAMESPACE && this.owns(c.node.id));
    this.removeNodes(new Set(doomed.map(c => c.node.id)));
    if (after && numbered(before) === numbered(after)) {
      this.writeFields(d, d.definition.fields.map(f => ({
        name: f.name, dataType: f.dataType, valueRank: f.valueRank, isOptional: after === 'union' ? undefined : f.isOptional, description: text(f.description), value: f.value,
        allowSubTypes: f.otherAttributes.AllowSubTypes === 'true' || undefined,
      })), supertype);
    } else {
      d.definition = undefined;
    }
  }

  setTypeDefinition(key: string, type: string): void {
    this.change(() => {
      const n = this.node(key);
      const t = this.space().get(type);
      const expected = n.nodeClass === 'Object' ? 'ObjectType' : n.nodeClass === 'Variable' ? 'VariableType' : undefined;
      if (!expected || !t || t.nodeClass !== expected) throw new EditError(msg`The type definition of a ${n.nodeClass} must be a ${expected ?? 'type'}.`);
      this.replaceSingle(n, REF.HasTypeDefinition, true, type);
    });
  }

  setModellingRule(key: string, rule: string | undefined): void {
    this.change(() => {
      const n = this.node(key);
      if (rule) this.replaceSingle(n, REF.HasModellingRule, true, rule);
      else n.references = n.references.filter(r => r.type !== REF.HasModellingRule);
    });
  }

  setDataType(key: string, dataType: string): void {
    this.change(() => {
      const n = this.node(key);
      const t = this.space().get(dataType);
      if (!t || t.nodeClass !== 'DataType') throw new EditError(msg`The data type must be a DataType.`);
      if (n.nodeClass !== 'Variable' && n.nodeClass !== 'VariableType') throw new EditError(msg`A ${n.nodeClass} has no data type.`);
      const before = n.dataType;
      n.dataType = dataType;
      this.fitValue(n, before, n.valueRank ?? -1);
    });
  }

  setValueRank(key: string, valueRank: number): void {
    this.change(() => {
      const n = this.node(key);
      const before = n.valueRank ?? -1;
      n.valueRank = valueRank;
      if (n.nodeClass === 'Variable' || n.nodeClass === 'VariableType') this.fitValue(n, n.dataType, before);
    });
  }

  /**
   * Fits the value to a new DataType or ValueRank, in the same step: a value
   * the new DataType takes as it is (the old one derives from it) stays; one
   * whose elements fit the new built-in type and shape is written anew; any
   * other is removed.
   */
  private fitValue(n: UaNode, typeBefore: string | undefined, rankBefore: number): void {
    const space = this.space();
    const rank = n.valueRank ?? -1;
    if (n.dataType === typeBefore && rank === rankBefore) return;
    const takesOld = !!typeBefore && !!n.dataType && space.isSubtypeOf(typeBefore, n.dataType);

    if (n.arguments) {
      if (n.dataType !== ARGUMENT) n.arguments = undefined;
      return;
    }
    if (n.extensionObjects) {
      const { items, list } = n.extensionObjects;
      const typed = items.every(i => {
        const type = space.in(i.typeId, HAS_ENCODING, false)[0]?.source;
        return !!type && !!n.dataType && space.isSubtypeOf(type, n.dataType);
      });
      const asList = rank === 0 || rank === 1 ? true : rank === -1 ? false : rank < -1 ? list : undefined;
      n.extensionObjects = typed && asList !== undefined && (asList || items.length === 1) ? { list: asList, items } : undefined;
      return;
    }
    if (!n.valueXml?.trim()) return;
    const value = valueElements(n, builtInOf(space, typeBefore));
    if (!value) {
      // A value the panel cannot read stays only where it still fits for certain.
      if (!(takesOld && (rank === rankBefore || rank === -2))) n.valueXml = undefined;
      return;
    }
    if (takesOld && rank === rankBefore) return;
    const builtIn = builtInOf(space, n.dataType) ?? (takesOld ? builtInOf(space, typeBefore) : undefined);
    const shaped = shapeFor(value, rank);
    try {
      n.valueXml = builtIn && shaped ? elementsXml(builtIn, shaped) : undefined;
    } catch (e) {
      if (!(e instanceof ValueError)) throw e;
      n.valueXml = undefined;
    }
  }

  /** ReferenceType: a symmetric type has no InverseName. */
  setSymmetric(key: string, symmetric: boolean): void {
    this.change(() => {
      const n = this.node(key);
      if (n.nodeClass !== 'ReferenceType') throw new EditError(msg`Only a ReferenceType is symmetric or not.`);
      n.symmetric = symmetric ? true : undefined;
      if (symmetric) n.inverseName = [];
    });
  }

  setInverseName(key: string, inverseName: string): void {
    this.change(() => {
      const n = this.node(key);
      if (n.nodeClass !== 'ReferenceType') throw new EditError(msg`Only a ReferenceType has an InverseName.`);
      n.inverseName = inverseName.trim() ? [{ text: inverseName.trim() }] : [];
    });
  }

  /**
   * Sets the InputArguments or OutputArguments of a method, creating or
   * removing the property as needed (OPC 10000-3 5.7.2).
   */
  setArguments(method: string, which: 'Input' | 'Output', args: Argument[]): void {
    this.change(() => {
      const m = this.node(method);
      if (m.nodeClass !== 'Method') throw new EditError(msg`Only a Method has arguments.`);
      const names = new Set<string>();
      for (const a of args) {
        if (!a.name.trim()) throw new EditError(msg`Every argument needs a name.`);
        if (names.has(a.name.trim())) throw new EditError(msg`Two arguments are named '${a.name.trim()}'.`);
        names.add(a.name.trim());
        if (this.space().get(a.dataType)?.nodeClass !== 'DataType') throw new EditError(msg`The data type of '${a.name}' is not a DataType.`);
      }
      const browseName = `${which}Arguments`;
      const existing = this.space().children(m).find(c => c.node.browseName.name === browseName && c.node.browseName.namespaceUri === UA_NAMESPACE);
      if (args.length === 0) {
        if (existing) this.removeNodes(new Set([existing.node.id]));
        return;
      }
      let p = existing ? this.node(existing.node.id) : undefined;
      if (!p) {
        p = this.create('Variable', browseName);
        // A standard property: its BrowseName is in the UA namespace.
        p.browseName = { namespaceUri: UA_NAMESPACE, name: browseName };
        m.references.push({ type: REF.HasProperty, isForward: true, target: p.id });
        p.references.push(
          { type: REF.HasProperty, isForward: false, target: m.id },
          { type: REF.HasTypeDefinition, isForward: true, target: uaKey(68) },
          { type: REF.HasModellingRule, isForward: true, target: RULE.Mandatory },
        );
        p.parent = m.id;
        p.dataType = ARGUMENT;
        p.valueRank = 1;
      }
      p.arrayDimensions = String(args.length);
      p.arguments = args.map(a => ({ ...a, name: a.name.trim() }));
      p.valueXml = undefined;
    });
  }

  /**
   * Sets the fields of a DataType's definition (OPC 10000-3 5.8.3, 8.40):
   * - an enumeration names its values; it gets EnumStrings when they are
   *   0, 1, 2 …, EnumValues otherwise;
   * - an OptionSet names its bits (IsOptionSet); it gets OptionSetValues;
   * - a union has exactly one of its fields set (IsUnion), none optional;
   * - a structure has typed fields, some of which may be optional.
   * Structures, unions and OptionSet structures get their encodings.
   */
  setFields(dataType: string, fields: FieldInput[]): void {
    this.change(() => {
      const d = this.node(dataType);
      if (d.nodeClass !== 'DataType') throw new EditError(msg`Only a DataType has fields.`);
      this.writeFields(d, fields, d.id);
    });
  }

  /** The fields of a DataType, whose kind the given type (itself or its new supertype) decides. */
  private writeFields(d: UaNode, fields: FieldInput[], kindOf: string) {
    const space = this.space();
    const kind = fieldKind(space, kindOf);
    if (!kind) {
      throw new EditError(msg`Fields belong to structures, unions, enumerations and OptionSets (subtypes of an unsigned integer or of OptionSet).`);
    }
    const numbered = kind === 'enumeration' || kind === 'optionSet';
    const names = new Set<string>();
    for (const f of fields) {
      if (!f.name.trim()) throw new EditError(msg`Every field needs a name.`);
      if (names.has(f.name.trim())) throw new EditError(msg`Two fields are named '${f.name.trim()}'.`);
      names.add(f.name.trim());
      if (!numbered && space.get(f.dataType)?.nodeClass !== 'DataType') throw new EditError(msg`The data type of '${f.name}' is not a DataType.`);
      if (kind === 'union' && f.isOptional) throw new EditError(msg`The fields of a union are not optional; exactly one of them is set.`);
    }
    if (numbered) {
      const values = fields.map((f, i) => f.value ?? i);
      if (values.some(v => !Number.isInteger(v))) {
        throw new EditError(kind === 'enumeration' ? msg`Enumeration values are integers.` : msg`Bits are integers.`);
      }
      if (new Set(values).size !== values.length) {
        throw new EditError(kind === 'enumeration' ? msg`Two enumeration values are the same.` : msg`Two options are the same.`);
      }
      const bits = kind === 'optionSet' ? optionBits(space, kindOf) : undefined;
      if (kind === 'optionSet' && values.some(v => v < 0 || (bits !== undefined && v >= bits))) {
        throw new EditError(msg`Bits of '${d.browseName.name}' are 0 to ${(bits ?? 1) - 1}.`);
      }
    }
    const { IsUnion: _u, IsOptionSet: _o, ...otherAttributes } = d.definition?.otherAttributes ?? {};
    // What a field carries that the panel does not edit (MaxStringLength, its
    // DisplayName, its ArrayDimensions while it stays an array of the same
    // rank …) stays with its name.
    const kept = new Map((d.definition?.fields ?? []).map(f => [f.name, f] as const));
    const attributesOf = (f: FieldInput) => {
      const { AllowSubTypes: _s, ...rest } = kept.get(f.name.trim())?.otherAttributes ?? {};
      return { ...rest, ...(!numbered && f.allowSubTypes ? { AllowSubTypes: 'true' } : {}) };
    };
    const carried = (f: FieldInput) => {
      const old = kept.get(f.name.trim());
      const rank = f.valueRank ?? -1;
      return {
        displayName: old ? structuredClone(old.displayName) : [],
        ...(!numbered && old?.arrayDimensions && rank >= 1 && (old.valueRank ?? -1) === rank ? { arrayDimensions: old.arrayDimensions } : {}),
      };
    };
    d.definition = {
      name: d.browseName,
      otherAttributes: {
        ...otherAttributes,
        ...(kind === 'union' ? { IsUnion: 'true' } : {}),
        ...(kind === 'optionSet' ? { IsOptionSet: 'true' } : {}),
      },
      fields: fields.map((f, i) => ({
        name: f.name.trim(),
        ...(numbered ? { value: f.value ?? i } : { dataType: f.dataType, valueRank: f.valueRank ?? -1, ...(f.isOptional ? { isOptional: true } : {}) }),
        description: f.description?.trim() ? [{ text: f.description.trim() }] : [],
        ...carried(f),
        otherAttributes: attributesOf(f),
      })),
    };
    const entries = d.definition.fields.map(f => ({ name: f.name, value: f.value!, description: text(f.description) }));
    if (kind === 'enumeration') this.setEnumProperties(d, entries);
    if (kind === 'optionSet') this.setOptionSetValues(d, entries);
    if (space.isSubtypeOf(kindOf, STRUCTURE)) this.ensureEncodings(d);
  }

  /**
   * The properties that name the values of an enumeration: EnumStrings when
   * the values are 0, 1, 2 …, EnumValues otherwise (OPC 10000-3 5.8.3).
   * The one not needed is removed.
   */
  private setEnumProperties(d: UaNode, entries: { name: string; value: number; description: string }[]) {
    const contiguous = entries.every((e, i) => e.value === i);
    const keep = contiguous ? 'EnumStrings' : 'EnumValues';
    const drop = contiguous ? 'EnumValues' : 'EnumStrings';
    const dropped = this.space().children(d).filter(c => c.node.browseName.name === drop && c.node.browseName.namespaceUri === UA_NAMESPACE);
    if (dropped.length > 0) this.removeNodes(new Set(dropped.map(c => c.node.id)));

    const p = this.standardProperty(d, keep);
    p.dataType = contiguous ? uaKey(21) : ENUM_VALUE_TYPE; // LocalizedText or EnumValueType
    p.arrayDimensions = String(entries.length);
    const types = 'http://opcfoundation.org/UA/2008/02/Types.xsd';
    p.valueXml = contiguous
      ? `<ListOfLocalizedText xmlns="${types}">${entries.map(e => `<LocalizedText><Text>${escapeXml(e.name)}</Text></LocalizedText>`).join('')}</ListOfLocalizedText>`
      : `<ListOfExtensionObject xmlns="${types}">${entries.map(e => '<ExtensionObject><TypeId><Identifier>i=7616</Identifier></TypeId><Body><EnumValueType>'
        + `<Value>${e.value}</Value><DisplayName><Text>${escapeXml(e.name)}</Text></DisplayName>`
        + `<Description>${e.description ? `<Text>${escapeXml(e.description)}</Text>` : ''}</Description></EnumValueType></Body></ExtensionObject>`).join('')}</ListOfExtensionObject>`;
  }

  /**
   * The names of an OptionSet's bits: a LocalizedText per bit up to the
   * highest one used, empty for bits without a name.
   */
  private setOptionSetValues(d: UaNode, entries: { name: string; value: number }[]) {
    const names: string[] = [];
    for (const e of entries) names[e.value] = e.name;
    const p = this.standardProperty(d, 'OptionSetValues');
    p.dataType = uaKey(21);
    p.arrayDimensions = String(names.length);
    const types = 'http://opcfoundation.org/UA/2008/02/Types.xsd';
    p.valueXml = `<ListOfLocalizedText xmlns="${types}">${Array.from(names, n => (n === undefined ? '<LocalizedText />'
      : `<LocalizedText><Text>${escapeXml(n)}</Text></LocalizedText>`)).join('')}</ListOfLocalizedText>`;
  }

  // ── state machines (OPC 10000-5 Annex B) ──────────────────────────────
  //
  // A state machine type holds its available states and transitions as
  // components. They carry no ModellingRule, as the base model's own machines
  // show; their StateNumber and TransitionNumber properties do, and their
  // BrowseNames belong to the UA namespace. A transition names its ends with
  // FromState and ToState, the method that causes it with HasCause.

  /** An ObjectType that is a finite state machine. */
  addStateMachineType(name: string): string {
    return this.addType('ObjectType', name, SM.FiniteStateMachineType);
  }

  /** A state of a machine type, numbered as the type's states are counted. */
  addState(type: string, name: string, number: number): string {
    return this.change(() => {
      const t = this.machineType(type);
      const s = this.namedChild(t, name, 'Object', SM.StateType);
      this.numberProperty(s, SM.StateNumber, number);
      return s.id;
    });
  }

  /**
   * Gives a state of a machine type a machine of its own (OPC 10000-5,
   * SubStateMachine): a component of the machine type named after the state,
   * of the given machine type and Mandatory, which the state refers to with
   * HasSubStateMachine. Another type replaces the machine, undefined removes it.
   * Returns the machine's node, if any.
   */
  setSubStateMachine(type: string, state: string, subType: string | undefined): string | undefined {
    return this.change(() => {
      const machine = this.machineType(type);
      const s = this.node(state);
      if (!this.space().isSubtypeOf(this.space().typeDefinition(s)?.id ?? '', SM.StateType)) {
        throw new EditError(msg`'${s.browseName.name}' is no state.`);
      }
      if (subType) {
        const sub = this.space().get(subType);
        if (!sub || sub.nodeClass !== 'ObjectType' || !this.space().isSubtypeOf(subType, SM.StateMachineType)) {
          throw new EditError(msg`'${sub?.browseName.name ?? subType}' is no state machine type.`);
        }
        if (subType === machine.id || this.space().isSubtypeOf(subType, machine.id)) {
          throw new EditError(msg`'${machine.browseName.name}' cannot hold itself as the machine of one of its states.`);
        }
      }
      // The machine the state had goes, with what it holds.
      const old = s.references.filter(r => r.type === SM.HasSubStateMachine && r.isForward && this.owns(r.target));
      for (const r of old) this.removeNodes(this.ownedSubtree(this.node(r.target)));
      s.references = s.references.filter(r => !(r.type === SM.HasSubStateMachine && r.isForward));
      if (!subType) return undefined;
      // The index still holds the removed machine until it is rebuilt.
      if (old.length > 0) this.rebuild(this.file);
      const object = this.namedChild(machine, `${s.browseName.name}StateMachine`, 'Object', subType);
      object.references.push({ type: REF.HasModellingRule, isForward: true, target: RULE.Mandatory });
      s.references.push({ type: SM.HasSubStateMachine, isForward: true, target: object.id });
      object.references.push({ type: SM.HasSubStateMachine, isForward: false, target: s.id });
      return object.id;
    });
  }

  /** A transition between two states of the same machine type. */
  addTransition(type: string, name: string, number: number, from: string, to: string, cause?: string): string {
    return this.change(() => {
      const t = this.machineType(type);
      const s = this.namedChild(t, name, 'Object', SM.TransitionType);
      this.numberProperty(s, SM.TransitionNumber, number);
      this.transitionEnd(t, s, SM.FromState, from);
      this.transitionEnd(t, s, SM.ToState, to);
      if (cause) this.transitionEnd(t, s, SM.HasCause, cause);
      return s.id;
    });
  }

  /**
   * Changes where a transition leads and what causes it. A field that is
   * there but undefined removes that reference; a field left out keeps it.
   */
  setTransition(transition: string, ends: { from?: string; to?: string; cause?: string }): void {
    this.change(() => {
      const s = this.node(transition);
      const machine = this.space().parentOf(s);
      if ('from' in ends) this.transitionEnd(machine, s, SM.FromState, ends.from);
      if ('to' in ends) this.transitionEnd(machine, s, SM.ToState, ends.to);
      if ('cause' in ends) this.transitionEnd(machine, s, SM.HasCause, ends.cause);
    });
  }

  private machineType(key: string): UaNode {
    const t = this.node(key);
    if (!this.space().isSubtypeOf(t.id, SM.FiniteStateMachineType)) {
      throw new EditError(msg`'${t.browseName.name}' is no finite state machine; its type does not derive from FiniteStateMachineType.`);
    }
    return t;
  }

  /** A component of the machine type with its own name and type definition. */
  private namedChild(parent: UaNode, name: string, nodeClass: NodeClass, typeDefinition: string): UaNode {
    const trimmed = name.trim();
    if (this.space().children(parent).some(c => c.node.browseName.name === trimmed)) {
      throw new EditError(msg`'${parent.browseName.name}' already has a child named '${trimmed}'.`);
    }
    const n = this.create(nodeClass, trimmed);
    parent.references.push({ type: REF.HasComponent, isForward: true, target: n.id });
    n.references.push(
      { type: REF.HasComponent, isForward: false, target: parent.id },
      { type: REF.HasTypeDefinition, isForward: true, target: typeDefinition },
    );
    n.parent = parent.id;
    return n;
  }

  /** StateNumber or TransitionNumber: a Mandatory UInt32 property of the UA namespace. */
  private numberProperty(owner: UaNode, name: string, value: number): void {
    const p = this.create('Variable', name);
    p.browseName = { namespaceUri: UA_NAMESPACE, name };
    owner.references.push({ type: REF.HasProperty, isForward: true, target: p.id });
    p.references.push(
      { type: REF.HasProperty, isForward: false, target: owner.id },
      { type: REF.HasTypeDefinition, isForward: true, target: uaKey(68) },
      { type: REF.HasModellingRule, isForward: true, target: RULE.Mandatory },
    );
    p.parent = owner.id;
    p.dataType = uaKey(7);
    p.valueRank = -1;
    p.valueXml = valueXml('UInt32', String(Math.trunc(value)), false);
  }

  /**
   * One FromState, ToState or HasCause of a transition, with the inverse on
   * the other node. An end is a state of the transition's machine, its own or
   * one it inherits.
   */
  private transitionEnd(machine: UaNode | undefined, transition: UaNode, type: string, target: string | undefined): void {
    for (const old of transition.references.filter(r => r.type === type && r.isForward)) {
      const node = this.file.nodes.find(n => n.id === old.target);
      if (node) node.references = node.references.filter(r => !(r.type === type && !r.isForward && r.target === transition.id));
    }
    transition.references = transition.references.filter(r => !(r.type === type && r.isForward));
    if (!target) return;
    const node = this.space().get(target);
    if (!node) throw new EditError(msg`The node of the reference is unknown.`);
    if (type !== SM.HasCause && !(machine && readStateMachine(this.space(), machine).states.some(s => s.key === target))) {
      throw new EditError(msg`'${node.browseName.name}' is no state of this machine.`);
    }
    if (type === SM.HasCause && node.nodeClass !== 'Method') throw new EditError(msg`'${node.browseName.name}' is no method.`);
    transition.references.push({ type, isForward: true, target });
    const own = this.file.nodes.find(n => n.id === target);
    if (own) own.references.push({ type, isForward: false, target: transition.id });
  }

  /** A property of a DataType from the UA namespace (EnumStrings, OptionSetValues …), created if missing. */
  private standardProperty(d: UaNode, name: string): UaNode {
    const existing = this.space().children(d).find(c => c.node.browseName.name === name && c.node.browseName.namespaceUri === UA_NAMESPACE);
    if (existing && this.owns(existing.node.id)) return this.node(existing.node.id);
    const p = this.create('Variable', name);
    p.browseName = { namespaceUri: UA_NAMESPACE, name };
    d.references.push({ type: REF.HasProperty, isForward: true, target: p.id });
    p.references.push(
      { type: REF.HasProperty, isForward: false, target: d.id },
      { type: REF.HasTypeDefinition, isForward: true, target: uaKey(68) },
      { type: REF.HasModellingRule, isForward: true, target: RULE.Mandatory },
    );
    p.parent = d.id;
    p.valueRank = 1;
    return p;
  }

  /**
   * Gives a structure its DataTypeEncoding objects ("Default Binary",
   * "Default XML", "Default JSON"), which servers need to encode values of
   * it. The dictionaries of OPC 10000-5 (HasDescription) are deprecated
   * since 1.04 and not created.
   */
  private ensureEncodings(d: UaNode) {
    const existing = new Set(this.file.nodes
      .filter(n => n.references.some(r => r.type === HAS_ENCODING && !r.isForward && r.target === d.id))
      .map(n => n.browseName.name));
    for (const name of ['Default Binary', 'Default XML', 'Default JSON']) {
      if (existing.has(name)) continue;
      const e = this.create('Object', name);
      e.browseName = { namespaceUri: UA_NAMESPACE, name };
      e.symbolicName = name.replace(' ', '');
      e.references.push(
        { type: HAS_ENCODING, isForward: false, target: d.id },
        { type: REF.HasTypeDefinition, isForward: true, target: uaKey(76) },
      );
      d.references.push({ type: HAS_ENCODING, isForward: true, target: e.id });
    }
  }

  private removeNodes(doomed: Set<string>) {
    this.file.nodes = this.file.nodes.filter(n => !doomed.has(n.id));
    for (const n of this.file.nodes) n.references = n.references.filter(r => !doomed.has(r.target));
  }

  /**
   * Creates an instance of an ObjectType or VariableType the way a server
   * would: every Mandatory declaration of the type and its supertypes, the
   * Optional ones the caller picks (by path relative to the instance, such as
   * "Motor/Temperature"), no placeholders. A declaration of a subtype
   * overrides one of the same BrowseName in a supertype; a declaration's own
   * children override those of its type. References between declarations are
   * carried over to the new nodes. Without a parent the instance is organized
   * by the Objects folder.
   */
  instantiate(type: string, name: string, options: InstantiateOptions = {}): string {
    return this.change(() => {
      const space = this.space();
      const t = space.get(type);
      if (!t || (t.nodeClass !== 'ObjectType' && t.nodeClass !== 'VariableType')) throw new EditError(msg`Only ObjectTypes and VariableTypes have instances.`);
      if (t.isAbstract && !options.allowAbstract) throw new EditError(msg`'${t.browseName.name}' is abstract; OPC UA does not instantiate abstract types.`);
      // A parent of another model (DI's DeviceSet, say) is not changed: the new
      // node alone holds the reference, as companion specifications do.
      const parent = options.parent ? space.get(options.parent) : undefined;
      if (options.parent && !parent) throw new EditError(msg`There is no node '${options.parent}' in the loaded models.`);
      const ownParent = parent && this.owns(parent.id) ? this.node(parent.id) : undefined;
      if (parent && space.children(parent).some(c => c.node.browseName.name === name.trim())) {
        throw new EditError(msg`'${parent.browseName.name}' already has a child named '${name.trim()}'.`);
      }

      const mapping = new Map<string, string>();
      const root = this.create(t.nodeClass === 'ObjectType' ? 'Object' : 'Variable', name);
      root.references.push({ type: REF.HasTypeDefinition, isForward: true, target: t.id });
      if (t.nodeClass === 'VariableType') { root.dataType = t.dataType; root.valueRank = t.valueRank === -2 ? -1 : t.valueRank; }
      if (parent) {
        const refType = options.referenceType ?? REF.HasComponent;
        ownParent?.references.push({ type: refType, isForward: true, target: root.id });
        root.references.push({ type: refType, isForward: false, target: parent.id });
        root.parent = parent.id;
      } else {
        root.references.push({ type: REF.Organizes, isForward: false, target: OBJECTS_FOLDER });
      }
      mapping.set(t.id, root.id);
      this.fill(root, this.declarationsOf(t.id), '', options, mapping, 0);

      // References between declarations become references between the new nodes.
      for (const [declaration, instance] of mapping) {
        const node = this.file.nodes.find(n => n.id === instance)!;
        for (const e of space.out(declaration)) {
          if (space.isHierarchical(e.type) || e.type === REF.HasTypeDefinition || e.type === REF.HasModellingRule) continue;
          const target = mapping.get(e.target);
          if (target) node.references.push({ type: e.type, isForward: true, target });
        }
      }
      return root.id;
    });
  }

  /** The paths of the Optional declarations an instance of the type can get, as `instantiate` takes them. */
  optionalPaths(type: string): string[] {
    const space = this.space();
    const paths: string[] = [];
    const walk = (declarations: Map<string, Declaration>, path: string, depth: number) => {
      if (depth > 20) return;
      for (const declaration of declarations.values()) {
        const d = declaration.node;
        const rule = space.modellingRule(d);
        if (rule !== RULE.Mandatory && rule !== RULE.Optional) continue;
        const p = path ? `${path}/${d.browseName.name}` : d.browseName.name;
        if (rule === RULE.Optional) paths.push(p);
        walk(this.childrenOf(declaration), p, depth + 1);
      }
    };
    if (space.get(type)) walk(this.declarationsOf(type), '', 0);
    return paths;
  }

  /**
   * The effective declarations of a type: its own and its supertypes', by
   * BrowseName with its namespace, the most specific winning. A declaration
   * that overrides another keeps the one it overrides, because the children
   * of both belong to the instance (OPC 10000-3, the fully inherited instance
   * declaration hierarchy).
   */
  private declarationsOf(type: string): Map<string, Declaration> {
    const space = this.space();
    const result = new Map<string, Declaration>();
    const chain = space.typeChain(space.get(type)!).reverse();   // the base first
    for (const t of chain) {
      for (const c of space.children(t)) {
        const key = qualified(c.node);
        const previous = result.get(key);
        result.set(key, {
          node: c.node,
          refType: c.edge.type,
          overrides: previous ? [...previous.overrides, previous.node] : [],
        });
      }
    }
    return result;
  }

  /**
   * What an instance gets below one declaration: the declarations of its type,
   * then the children the declaration and every declaration it overrides carry
   * themselves, the most specific winning.
   */
  private childrenOf(d: Declaration): Map<string, Declaration> {
    const space = this.space();
    const typeDefinition = space.typeDefinition(d.node);
    const inner = typeDefinition ? this.declarationsOf(typeDefinition.id) : new Map<string, Declaration>();
    for (const over of [...d.overrides, d.node]) {
      for (const own of space.children(over)) {
        const key = qualified(own.node);
        const previous = inner.get(key);
        // A child that overrides another keeps it too, at every depth.
        inner.set(key, {
          node: own.node,
          refType: own.edge.type,
          overrides: previous ? [...previous.overrides, previous.node] : [],
        });
      }
    }
    return inner;
  }

  private fill(parent: UaNode, declarations: Map<string, Declaration>, path: string,
    options: InstantiateOptions, mapping: Map<string, string>, depth: number) {
    if (depth > 20) throw new EditError(msg`The type nests its declarations more than 20 levels deep.`);
    const space = this.space();
    for (const declaration of declarations.values()) {
      const { node: d, refType } = declaration;
      const rule = space.modellingRule(d);
      const childPath = path ? `${path}/${d.browseName.name}` : d.browseName.name;
      const include = rule === RULE.Mandatory || (rule === RULE.Optional && (options.optional?.(childPath) ?? false));
      if (!include) continue;
      const c = this.create(d.nodeClass, d.browseName.name);
      c.browseName = d.browseName;
      c.displayName = structuredClone(d.displayName);
      c.description = structuredClone(d.description);
      c.dataType = d.dataType;
      c.valueRank = d.valueRank;
      c.arrayDimensions = d.arrayDimensions;
      c.accessLevel = d.accessLevel;
      c.valueXml = d.valueXml;
      c.arguments = d.arguments ? structuredClone(d.arguments) : undefined;
      c.extensionObjects = d.extensionObjects ? structuredClone(d.extensionObjects) : undefined;
      if (d.nodeClass === 'Method') c.methodDeclaration = d.methodDeclaration ?? d.id;
      c.parent = parent.id;
      parent.references.push({ type: refType, isForward: true, target: c.id });
      c.references.push({ type: refType, isForward: false, target: parent.id });
      const typeDefinition = space.typeDefinition(d);
      if (typeDefinition) c.references.push({ type: REF.HasTypeDefinition, isForward: true, target: typeDefinition.id });
      mapping.set(d.id, c.id);

      this.fill(c, this.childrenOf(declaration), childPath, options, mapping, depth + 1);
    }
  }

  /**
   * Sets the value of a Variable or VariableType from text: a scalar, or
   * elements separated by ";" when the ValueRank is an array. Empty text
   * removes the value.
   */
  setValue(key: string, text: string | undefined): void {
    this.change(() => {
      const n = this.node(key);
      if (n.nodeClass !== 'Variable' && n.nodeClass !== 'VariableType') throw new EditError(msg`A ${n.nodeClass} has no value.`);
      if (n.arguments) throw new EditError(msg`Arguments are edited in their own section.`);
      if (text === undefined || text.trim() === '') { n.valueXml = undefined; n.extensionObjects = undefined; return; }
      const builtIn = builtInOf(this.space(), n.dataType);
      if (!builtIn) throw new EditError(msg`Values of this DataType are structures; the panel does not edit them.`);
      try {
        const rank = n.valueRank ?? -1;
        n.valueXml = rank >= 2 ? matrixXml(builtIn, text) : valueXml(builtIn, text, rank >= 0);
        n.extensionObjects = undefined;
      } catch (e) {
        if (e instanceof ValueError) throw new EditError(new Message(e.template, e.args));
        throw e;
      }
    });
  }

  /**
   * Sets a single structure value field by field, encoded with the
   * DataType's "Default XML" encoding. Undefined removes the value.
   */
  setStructuredValue(key: string, values: Record<string, string> | undefined): void {
    this.change(() => {
      const n = this.node(key);
      if (n.nodeClass !== 'Variable' && n.nodeClass !== 'VariableType') throw new EditError(msg`A ${n.nodeClass} has no value.`);
      if (values === undefined) { n.valueXml = undefined; n.extensionObjects = undefined; return; }
      if ((n.valueRank ?? -1) >= 0) throw new EditError(msg`The panel edits single structures, not arrays of them.`);
      const shape = structureOf(this.space(), n.dataType);
      if (!shape) throw new EditError(msg`The panel edits structures whose fields are all built-in types and not optional.`);
      try {
        n.extensionObjects = { list: false, items: [structureValue(shape, values)] };
        n.valueXml = undefined;
      } catch (e) {
        if (e instanceof ValueError) throw new EditError(new Message(e.template, e.args));
        throw e;
      }
    });
  }

  /**
   * Sets a structure value of any shape the panel edits (nested structures,
   * enumerations, arrays, optional fields, unions): one structure, or a list
   * when the ValueRank is an array. Undefined removes the value.
   */
  setStructureValue(key: string, items: StructValue[] | undefined): void {
    this.change(() => {
      const n = this.node(key);
      if (n.nodeClass !== 'Variable' && n.nodeClass !== 'VariableType') throw new EditError(msg`A ${n.nodeClass} has no value.`);
      if (items === undefined) { n.valueXml = undefined; n.extensionObjects = undefined; return; }
      const list = (n.valueRank ?? -1) >= 0;
      if (!list && items.length !== 1) throw new EditError(msg`A scalar value is one structure.`);
      const shape = structShape(this.space(), n.dataType);
      if (!shape) throw new EditError(msg`Values of this DataType are not edited here.`);
      try {
        n.extensionObjects = { list, items: structureObjects(this.space(), shape, items) };
        n.valueXml = undefined;
      } catch (e) {
        if (e instanceof ValueError) throw new EditError(new Message(e.template, e.args));
        throw e;
      }
    });
  }

  /** Version and publication date of the model being edited. */
  setModelInfo(version: string, publicationDate: string): void {
    this.change(() => {
      const m = this.file.models[0];
      if (!m) throw new EditError(msg`The file declares no model.`);
      if (!version.trim()) throw new EditError(msg`A version is required.`);
      const date = new Date(publicationDate);
      if (Number.isNaN(date.getTime())) throw new EditError(msg`'${publicationDate}' is not a date.`);
      m.version = version.trim();
      m.publicationDate = date.toISOString().replace(/\.\d+Z$/, 'Z');
    });
  }

  /** Whether a node belongs to the model being edited. */
  owns(key: string): boolean {
    return this.file.nodes.some(n => n.id === key);
  }

  addReference(source: string, type: string, target: string): void {
    this.change(() => {
      const s = this.node(source);
      if (!this.space().get(target)) throw new EditError(msg`Unknown target '${target}'.`);
      const t = this.space().get(type);
      if (!t || t.nodeClass !== 'ReferenceType') throw new EditError(msg`The reference type must be a ReferenceType.`);
      if (s.references.some(r => r.type === type && r.isForward && r.target === target)) return;
      s.references.push({ type, isForward: true, target });
    });
  }

  removeReference(source: string, type: string, target: string): void {
    this.change(() => {
      for (const n of this.file.nodes) {
        n.references = n.references.filter(r => !(
          (n.id === source && r.type === type && r.isForward && r.target === target)
          || (n.id === target && r.type === type && !r.isForward && r.target === source)));
      }
    });
  }

  /** Deletes a node, the declarations it holds, and every reference to them. */
  delete(key: string): string[] {
    return this.change(() => {
      const root = this.node(key);
      const doomed = this.ownedSubtree(root);
      // The machine a state holds is a component of the machine type, not of
      // the state (HasSubStateMachine); it goes with the state, with what it holds.
      for (const pending = [...doomed]; pending.length > 0;) {
        for (const e of this.space().out(pending.pop()!, SM.HasSubStateMachine, false)) {
          if (!this.owns(e.target) || doomed.has(e.target)) continue;
          for (const k of this.ownedSubtree(this.node(e.target))) {
            if (!doomed.has(k)) { doomed.add(k); pending.push(k); }
          }
        }
      }
      // A DataType's encodings go with it.
      for (const key of [...doomed]) {
        for (const e of this.space().out(key, HAS_ENCODING, false)) if (this.owns(e.target)) doomed.add(e.target);
      }
      if (this.file.nodes.some(n => !doomed.has(n.id) && n.references.some(r => r.type === REF.HasSubtype && !r.isForward && doomed.has(r.target)))) {
        throw new EditError(msg`'${root.browseName.name}' has subtypes; delete or move them first.`);
      }
      this.refuseDataTypeInUse(doomed);
      this.removeNodes(doomed);
      return [...doomed];
    });
  }

  /**
   * A DataType is named by attributes (of a variable, an argument, a field),
   * not by references, so deleting it would leave them pointing nowhere.
   * Refuses that, naming who still uses it.
   */
  private refuseDataTypeInUse(doomed: Set<string>): void {
    const users: string[] = [];
    let used: UaNode | undefined;
    const names = (dataType: string | undefined) => {
      if (!dataType || !doomed.has(dataType)) return false;
      used ??= this.file.nodes.find(x => x.id === dataType);
      return true;
    };
    for (const n of this.file.nodes) {
      if (doomed.has(n.id)) continue;
      if (names(n.dataType)) users.push(n.browseName.name);
      // An argument belongs to its method, which the user knows by name.
      if ((n.arguments ?? []).some(a => names(a.dataType))) users.push(this.space().parentOf(n)?.browseName.name ?? n.browseName.name);
      if ((n.definition?.fields ?? []).some(f => names(f.dataType))) users.push(n.browseName.name);
    }
    if (users.length === 0 || !used) return;
    throw new EditError(users.length === 1
      ? msg`'${used.browseName.name}' is the DataType of '${users[0]}'; give it another DataType first.`
      : msg`'${used.browseName.name}' is the DataType of '${users[0]}' and ${users.length - 1} more; give them another DataType first.`);
  }

  /** A node and what it holds as its own (its ParentNodeId), not what it merely organizes. */
  private ownedSubtree(root: UaNode): Set<string> {
    const doomed = new Set<string>([root.id]);
    const collect = (n: UaNode) => {
      for (const c of this.space().children(n)) {
        if (doomed.has(c.node.id) || !this.file.nodes.includes(c.node)) continue;
        if (c.node.parent !== n.id) continue;
        doomed.add(c.node.id);
        collect(c.node);
      }
    };
    collect(root);
    return doomed;
  }

  private replaceSingle(n: UaNode, type: string, isForward: boolean, target: string) {
    n.references = n.references.filter(r => !(r.type === type && r.isForward === isForward));
    const ref: Reference = { type, isForward, target };
    n.references.push(ref);
  }
}
