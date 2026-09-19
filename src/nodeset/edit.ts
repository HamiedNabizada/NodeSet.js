// Changes to the editable NodeSet. Every change keeps the file consistent
// the way NodeSets are usually written: a parent holds a forward reference to
// its child, the child an inverse one and its ParentNodeId; a subtype holds
// the inverse HasSubtype to its supertype. New nodes get the next free
// numeric NodeId of the model's namespace.
//
// Undo and redo work on snapshots of the file, which is simple and cheap at
// the size of information models.

import { AddressSpace, REF, RULE } from './address-space';
import { insideType } from './checks';
import { builtInOf, ValueError, valueXml } from './values';
import { Argument, NodeClass, NodeSetFile, parseNodeIdKey, Reference, UA_NAMESPACE, uaKey, UaNode } from './model';

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

function qualified(n: UaNode): string {
  return `${n.browseName.namespaceUri}|${n.browseName.name}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
      if (!trimmed) throw new EditError('A name is required.');
      const parent = this.space().parentOf(n);
      if (parent && this.space().children(parent).some(c => c.node.id !== key && c.node.browseName.name === trimmed)) {
        throw new EditError(`'${parent.browseName.name}' already has a child named '${trimmed}'.`);
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

  /** ReferenceType: a symmetric type has no InverseName. */
  setSymmetric(key: string, symmetric: boolean): void {
    this.change(() => {
      const n = this.node(key);
      if (n.nodeClass !== 'ReferenceType') throw new EditError('Only a ReferenceType is symmetric or not.');
      n.symmetric = symmetric ? true : undefined;
      if (symmetric) n.inverseName = [];
    });
  }

  setInverseName(key: string, inverseName: string): void {
    this.change(() => {
      const n = this.node(key);
      if (n.nodeClass !== 'ReferenceType') throw new EditError('Only a ReferenceType has an InverseName.');
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
      if (m.nodeClass !== 'Method') throw new EditError('Only a Method has arguments.');
      const names = new Set<string>();
      for (const a of args) {
        if (!a.name.trim()) throw new EditError('Every argument needs a name.');
        if (names.has(a.name.trim())) throw new EditError(`Two arguments are named '${a.name.trim()}'.`);
        names.add(a.name.trim());
        if (this.space().get(a.dataType)?.nodeClass !== 'DataType') throw new EditError(`The data type of '${a.name}' is not a DataType.`);
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
   * Sets the fields of a structure or the values of an enumeration. An
   * enumeration gets its EnumStrings property; its values are 0, 1, 2 … in
   * the order given.
   */
  setFields(dataType: string, fields: { name: string; dataType?: string; valueRank?: number; isOptional?: boolean; description?: string }[]): void {
    this.change(() => {
      const d = this.node(dataType);
      if (d.nodeClass !== 'DataType') throw new EditError('Only a DataType has fields.');
      const isEnum = this.space().isSubtypeOf(d.id, ENUMERATION);
      if (!isEnum && !this.space().isSubtypeOf(d.id, STRUCTURE)) {
        throw new EditError('Fields belong to structures (subtypes of Structure) and enumerations (subtypes of Enumeration).');
      }
      const names = new Set<string>();
      for (const f of fields) {
        if (!f.name.trim()) throw new EditError('Every field needs a name.');
        if (names.has(f.name.trim())) throw new EditError(`Two fields are named '${f.name.trim()}'.`);
        names.add(f.name.trim());
        if (!isEnum && this.space().get(f.dataType)?.nodeClass !== 'DataType') throw new EditError(`The data type of '${f.name}' is not a DataType.`);
      }
      d.definition = {
        name: d.browseName,
        otherAttributes: d.definition?.otherAttributes ?? {},
        fields: fields.map((f, i) => ({
          name: f.name.trim(),
          ...(isEnum ? { value: i } : { dataType: f.dataType, valueRank: f.valueRank ?? -1, ...(f.isOptional ? { isOptional: true } : {}) }),
          description: f.description?.trim() ? [{ text: f.description.trim() }] : [],
          displayName: [],
          otherAttributes: {},
        })),
      };
      if (isEnum) this.setEnumStrings(d, fields.map(f => f.name.trim()));
    });
  }

  private setEnumStrings(d: UaNode, names: string[]) {
    const existing = this.space().children(d).find(c => c.node.browseName.name === 'EnumStrings' && c.node.browseName.namespaceUri === UA_NAMESPACE);
    let p = existing ? this.node(existing.node.id) : undefined;
    if (!p) {
      p = this.create('Variable', 'EnumStrings');
      p.browseName = { namespaceUri: UA_NAMESPACE, name: 'EnumStrings' };
      d.references.push({ type: REF.HasProperty, isForward: true, target: p.id });
      p.references.push(
        { type: REF.HasProperty, isForward: false, target: d.id },
        { type: REF.HasTypeDefinition, isForward: true, target: uaKey(68) },
        { type: REF.HasModellingRule, isForward: true, target: RULE.Mandatory },
      );
      p.parent = d.id;
      p.dataType = uaKey(21); // LocalizedText
      p.valueRank = 1;
    }
    p.arrayDimensions = String(names.length);
    p.valueXml = `<ListOfLocalizedText xmlns="http://opcfoundation.org/UA/2008/02/Types.xsd">${names.map(n => `<LocalizedText><Text>${escapeXml(n)}</Text></LocalizedText>`).join('')}</ListOfLocalizedText>`;
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
      if (!t || (t.nodeClass !== 'ObjectType' && t.nodeClass !== 'VariableType')) throw new EditError('Only ObjectTypes and VariableTypes have instances.');
      if (t.isAbstract && !options.allowAbstract) throw new EditError(`'${t.browseName.name}' is abstract; OPC UA does not instantiate abstract types.`);
      const parent = options.parent ? this.node(options.parent) : undefined;
      if (parent && space.children(parent).some(c => c.node.browseName.name === name.trim())) {
        throw new EditError(`'${parent.browseName.name}' already has a child named '${name.trim()}'.`);
      }

      const mapping = new Map<string, string>();
      const root = this.create(t.nodeClass === 'ObjectType' ? 'Object' : 'Variable', name);
      root.references.push({ type: REF.HasTypeDefinition, isForward: true, target: t.id });
      if (t.nodeClass === 'VariableType') { root.dataType = t.dataType; root.valueRank = t.valueRank === -2 ? -1 : t.valueRank; }
      if (parent) {
        const refType = options.referenceType ?? REF.HasComponent;
        parent.references.push({ type: refType, isForward: true, target: root.id });
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
    const walk = (declarations: Map<string, { node: UaNode; refType: string }>, path: string, depth: number) => {
      if (depth > 20) return;
      for (const { node: d } of declarations.values()) {
        const rule = space.modellingRule(d);
        if (rule !== RULE.Mandatory && rule !== RULE.Optional) continue;
        const p = path ? `${path}/${d.browseName.name}` : d.browseName.name;
        if (rule === RULE.Optional) paths.push(p);
        const typeDefinition = space.typeDefinition(d);
        const inner = typeDefinition ? this.declarationsOf(typeDefinition.id) : new Map<string, { node: UaNode; refType: string }>();
        for (const own of space.children(d)) inner.set(qualified(own.node), { node: own.node, refType: own.edge.type });
        walk(inner, p, depth + 1);
      }
    };
    if (space.get(type)) walk(this.declarationsOf(type), '', 0);
    return paths;
  }

  /** The effective declarations of a type: its own and its supertypes', by BrowseName, the most specific winning. */
  private declarationsOf(type: string): Map<string, { node: UaNode; refType: string }> {
    const space = this.space();
    const result = new Map<string, { node: UaNode; refType: string }>();
    const chain = space.typeChain(space.get(type)!).reverse();
    for (const t of chain) {
      for (const c of space.children(t)) result.set(qualified(c.node), { node: c.node, refType: c.edge.type });
    }
    return result;
  }

  private fill(parent: UaNode, declarations: Map<string, { node: UaNode; refType: string }>, path: string,
    options: InstantiateOptions, mapping: Map<string, string>, depth: number) {
    if (depth > 20) throw new EditError('The type nests its declarations more than 20 levels deep.');
    const space = this.space();
    for (const { node: d, refType } of declarations.values()) {
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
      c.parent = parent.id;
      parent.references.push({ type: refType, isForward: true, target: c.id });
      c.references.push({ type: refType, isForward: false, target: parent.id });
      const typeDefinition = space.typeDefinition(d);
      if (typeDefinition) c.references.push({ type: REF.HasTypeDefinition, isForward: true, target: typeDefinition.id });
      mapping.set(d.id, c.id);

      // The declaration's own children override those its type declares.
      const inner = typeDefinition ? this.declarationsOf(typeDefinition.id) : new Map<string, { node: UaNode; refType: string }>();
      for (const own of space.children(d)) inner.set(qualified(own.node), { node: own.node, refType: own.edge.type });
      this.fill(c, inner, childPath, options, mapping, depth + 1);
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
      if (n.nodeClass !== 'Variable' && n.nodeClass !== 'VariableType') throw new EditError(`A ${n.nodeClass} has no value.`);
      if (n.arguments) throw new EditError('Arguments are edited in their own section.');
      if (text === undefined || text.trim() === '') { n.valueXml = undefined; return; }
      const builtIn = builtInOf(this.space(), n.dataType);
      if (!builtIn) throw new EditError('Values of this DataType are structures; the panel does not edit them.');
      try {
        n.valueXml = valueXml(builtIn, text, (n.valueRank ?? -1) >= 0);
      } catch (e) {
        if (e instanceof ValueError) throw new EditError(e.message);
        throw e;
      }
    });
  }

  /** Version and publication date of the model being edited. */
  setModelInfo(version: string, publicationDate: string): void {
    this.change(() => {
      const m = this.file.models[0];
      if (!m) throw new EditError('The file declares no model.');
      if (!version.trim()) throw new EditError('A version is required.');
      const date = new Date(publicationDate);
      if (Number.isNaN(date.getTime())) throw new EditError(`'${publicationDate}' is not a date.`);
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
      this.removeNodes(doomed);
      return [...doomed];
    });
  }

  private replaceSingle(n: UaNode, type: string, isForward: boolean, target: string) {
    n.references = n.references.filter(r => !(r.type === type && r.isForward === isForward));
    const ref: Reference = { type, isForward, target };
    n.references.push(ref);
  }
}
