// Changes to the editable NodeSet. Every change keeps the file consistent
// the way NodeSets are usually written: a parent holds a forward reference to
// its child, the child an inverse one and its ParentNodeId; a subtype holds
// the inverse HasSubtype to its supertype. New nodes get the next free
// numeric NodeId of the model's namespace.
//
// Undo and redo work on snapshots of the file, which is simple and cheap at
// the size of information models.

import { AddressSpace, REF, RULE } from './address-space';
import { NodeClass, NodeSetFile, parseNodeIdKey, Reference, UA_NAMESPACE, uaKey, UaNode } from './model';

export class EditError extends Error {}

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

export function newModel(modelUri: string, version = '1.0.0'): NodeSetFile {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(modelUri)) throw new EditError(`'${modelUri}' is not a URI.`);
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

export class ModelEditor {
  private readonly undoStack: NodeSetFile[] = [];
  private readonly redoStack: NodeSetFile[] = [];

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

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(structuredClone(this.file));
    this.replace(previous);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(structuredClone(this.file));
    this.replace(next);
  }

  private replace(file: NodeSetFile) {
    this.file = file;
    this.rebuild(file);
  }

  /** Runs a change as one undo step. A failing change leaves the file as it was. */
  private change<T>(action: () => T): T {
    const before = structuredClone(this.file);
    try {
      const result = action();
      this.undoStack.push(before);
      this.redoStack.length = 0;
      this.rebuild(this.file);
      return result;
    } catch (e) {
      this.file = before;
      this.rebuild(before);
      throw e;
    }
  }

  private node(key: string): UaNode {
    const n = this.file.nodes.find(x => x.id === key);
    if (!n) throw new EditError(`'${key}' is not part of the model being edited.`);
    return n;
  }

  private nextId(): string {
    let max = 0;
    for (const n of this.file.nodes) {
      const { namespaceUri, identifier } = parseNodeIdKey(n.id);
      if (namespaceUri === this.namespace && identifier.startsWith('i=')) max = Math.max(max, Number(identifier.slice(2)));
    }
    return `${this.namespace}|i=${Math.max(max + 1, 1000)}`;
  }

  private create(nodeClass: NodeClass, name: string): UaNode {
    const trimmed = name.trim();
    if (!trimmed) throw new EditError('A name is required.');
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
      if (!baseNode || baseNode.nodeClass !== nodeClass) throw new EditError(`The supertype must be a ${nodeClass}.`);
      const t = this.create(nodeClass, name);
      t.references.push({ type: REF.HasSubtype, isForward: false, target: base });
      if (nodeClass === 'VariableType') { t.dataType = uaKey(24); t.valueRank = -2; } // BaseDataType, any rank
      if (nodeClass === 'ReferenceType') t.inverseName = [{ text: `Inverse${name.trim()}` }];
      return t.id;
    });
  }

  /** Adds an instance declaration below a type or another declaration. */
  addDeclaration(parent: string, kind: DeclarationKind, name: string, modellingRule: string = RULE.Mandatory): string {
    return this.change(() => {
      const p = this.node(parent);
      if (!['ObjectType', 'VariableType', 'Object', 'Variable'].includes(p.nodeClass)) {
        throw new EditError(`A ${p.nodeClass} cannot hold instance declarations.`);
      }
      const siblings = this.space().children(p).map(c => c.node.browseName.name);
      if (siblings.includes(name.trim())) throw new EditError(`'${p.browseName.name}' already has a child named '${name.trim()}'.`);
      const nodeClass: NodeClass = kind === 'Property' ? 'Variable' : kind;
      const d = this.create(nodeClass, name);
      const refType = kind === 'Property' ? REF.HasProperty : REF.HasComponent;
      p.references.push({ type: refType, isForward: true, target: d.id });
      d.references.push({ type: refType, isForward: false, target: p.id });
      d.parent = p.id;
      if (kind !== 'Method') d.references.push({ type: REF.HasTypeDefinition, isForward: true, target: TYPE_DEFINITIONS[kind] });
      d.references.push({ type: REF.HasModellingRule, isForward: true, target: modellingRule });
      if (nodeClass === 'Variable') { d.dataType = uaKey(24); d.valueRank = -1; }
      return d.id;
    });
  }

  rename(key: string, name: string): void {
    this.change(() => {
      const n = this.node(key);
      const trimmed = name.trim();
      if (!trimmed) throw new EditError('A name is required.');
      const parent = this.space().parentOf(n);
      if (parent && this.space().children(parent).some(c => c.node.id !== key && c.node.browseName.name === trimmed)) {
        throw new EditError(`'${parent.browseName.name}' already has a child named '${trimmed}'.`);
      }
      n.browseName = { ...n.browseName, name: trimmed };
      n.displayName = [{ ...(n.displayName[0] ?? {}), text: trimmed }];
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
    });
  }

  setSupertype(key: string, supertype: string): void {
    this.change(() => {
      const n = this.node(key);
      const base = this.space().get(supertype);
      if (!base || base.nodeClass !== n.nodeClass) throw new EditError(`The supertype must be a ${n.nodeClass}.`);
      if (this.space().isSubtypeOf(supertype, key)) throw new EditError(`'${base.browseName.name}' is a subtype of '${n.browseName.name}'.`);
      // The file may also hold the reference forward, on the old supertype.
      for (const other of this.file.nodes) {
        other.references = other.references.filter(r => !(r.type === REF.HasSubtype && r.isForward && r.target === key));
      }
      this.replaceSingle(n, REF.HasSubtype, false, supertype);
    });
  }

  setTypeDefinition(key: string, type: string): void {
    this.change(() => {
      const n = this.node(key);
      const t = this.space().get(type);
      const expected = n.nodeClass === 'Object' ? 'ObjectType' : n.nodeClass === 'Variable' ? 'VariableType' : undefined;
      if (!expected || !t || t.nodeClass !== expected) throw new EditError(`The type definition of a ${n.nodeClass} must be a ${expected ?? 'type'}.`);
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
      if (!t || t.nodeClass !== 'DataType') throw new EditError('The data type must be a DataType.');
      if (n.nodeClass !== 'Variable' && n.nodeClass !== 'VariableType') throw new EditError(`A ${n.nodeClass} has no data type.`);
      n.dataType = dataType;
    });
  }

  setValueRank(key: string, valueRank: number): void {
    this.change(() => { this.node(key).valueRank = valueRank; });
  }

  addReference(source: string, type: string, target: string): void {
    this.change(() => {
      const s = this.node(source);
      if (!this.space().get(target)) throw new EditError(`Unknown target '${target}'.`);
      const t = this.space().get(type);
      if (!t || t.nodeClass !== 'ReferenceType') throw new EditError('The reference type must be a ReferenceType.');
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
      const doomed = new Set<string>([root.id]);
      const collect = (n: UaNode) => {
        for (const c of this.space().children(n)) {
          if (doomed.has(c.node.id) || !this.file.nodes.includes(c.node)) continue;
          // Only what this node holds as its own (its ParentNodeId), not what it merely organizes.
          if (c.node.parent !== n.id) continue;
          doomed.add(c.node.id);
          collect(c.node);
        }
      };
      collect(root);
      if (this.file.nodes.some(n => !doomed.has(n.id) && n.references.some(r => r.type === REF.HasSubtype && !r.isForward && doomed.has(r.target)))) {
        throw new EditError(`'${root.browseName.name}' has subtypes; delete or move them first.`);
      }
      this.file.nodes = this.file.nodes.filter(n => !doomed.has(n.id));
      for (const n of this.file.nodes) n.references = n.references.filter(r => !doomed.has(r.target));
      return [...doomed];
    });
  }

  private replaceSingle(n: UaNode, type: string, isForward: boolean, target: string) {
    n.references = n.references.filter(r => !(r.type === type && r.isForward === isForward));
    const ref: Reference = { type, isForward, target };
    n.references.push(ref);
  }
}
