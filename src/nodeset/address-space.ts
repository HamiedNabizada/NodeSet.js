// Several NodeSet files loaded together: the UA base model, the models a
// file requires, and the file being edited. References are normalized to
// one direction (source → target), whichever node wrote them, so the type
// questions below do not depend on how a NodeSet chose to store them.
//
// A space can sit on a base space: it indexes only its own files and asks
// the base for the rest. The modeler keeps the required models in a base that
// is indexed once, and rebuilds only the edited model after a change.

import { NodeClass, NodeSetFile, Reference, uaKey, UaNode } from './model';

export const REF = {
  HierarchicalReferences: uaKey(33),
  HasChild: uaKey(34),
  Organizes: uaKey(35),
  HasEventSource: uaKey(36),
  HasModellingRule: uaKey(37),
  HasTypeDefinition: uaKey(40),
  HasSubtype: uaKey(45),
  HasProperty: uaKey(46),
  HasComponent: uaKey(47),
  HasNotifier: uaKey(48),
  HasOrderedComponent: uaKey(49),
  HasInterface: uaKey(17603),
  NonHierarchicalReferences: uaKey(32),
  References: uaKey(31),
} as const;

/**
 * The nodes and references of a finite state machine (OPC 10000-5 Annex B):
 * a subtype of FiniteStateMachineType holds its available states and
 * transitions as components, each typed StateType or TransitionType and
 * numbered by a property; a transition names its ends with FromState and
 * ToState, the method that causes it with HasCause and the event it raises
 * with HasEffect.
 */
export const SM = {
  FiniteStateMachineType: uaKey(2771),
  StateMachineType: uaKey(2299),
  StateType: uaKey(2307),
  TransitionType: uaKey(2310),
  StateNumber: 'StateNumber',
  TransitionNumber: 'TransitionNumber',
  FromState: uaKey(51),
  ToState: uaKey(52),
  HasCause: uaKey(53),
  HasEffect: uaKey(54),
  HasSubStateMachine: uaKey(117),
} as const;

export const RULE = {
  Mandatory: uaKey(78),
  Optional: uaKey(80),
  ExposesItsArray: uaKey(83),
  OptionalPlaceholder: uaKey(11508),
  MandatoryPlaceholder: uaKey(11510),
} as const;

export interface Edge {
  source: string;
  type: string;
  target: string;
}

export interface LoadedFile {
  file: NodeSetFile;
  editable: boolean;
}

export class AddressSpace {
  private readonly nodes = new Map<string, UaNode>();
  private readonly owner = new Map<string, LoadedFile>();
  private readonly outgoing = new Map<string, Edge[]>();
  private readonly incoming = new Map<string, Edge[]>();
  private readonly subtypeCache = new Map<string, boolean>();
  private readonly ownFiles: LoadedFile[] = [];

  constructor(private readonly base?: AddressSpace) {}

  get files(): LoadedFile[] {
    return [...(this.base?.files ?? []), ...this.ownFiles];
  }

  /** Adds a file. A node already known from an earlier file is replaced. */
  load(file: NodeSetFile, editable = false): LoadedFile {
    const loaded = { file, editable };
    this.ownFiles.push(loaded);
    for (const n of file.nodes) {
      this.nodes.set(n.id, n);
      this.owner.set(n.id, loaded);
    }
    this.reindex();
    return loaded;
  }

  get(key: string | undefined): UaNode | undefined {
    return key ? this.nodes.get(key) ?? this.base?.get(key) : undefined;
  }

  fileOf(key: string): LoadedFile | undefined {
    return this.owner.get(key) ?? this.base?.fileOf(key);
  }

  *all(): IterableIterator<UaNode> {
    if (this.base) for (const n of this.base.all()) if (!this.nodes.has(n.id)) yield n;
    yield* this.nodes.values();
  }

  /** Recomputes the reference index; call after editing references. */
  reindex(): void {
    this.outgoing.clear();
    this.incoming.clear();
    this.subtypeCache.clear();
    const seen = new Set<string>();
    for (const n of this.nodes.values()) {
      for (const r of n.references) {
        const e = toEdge(n.id, r);
        const k = edgeKey(e);
        if (seen.has(k)) continue;
        seen.add(k);
        push(this.outgoing, e.source, e);
        push(this.incoming, e.target, e);
      }
    }
  }

  private outgoingOf(key: string): Edge[] {
    const own = this.outgoing.get(key) ?? [];
    return this.base ? merged(this.base.outgoingOf(key), own) : own;
  }

  private incomingOf(key: string): Edge[] {
    const own = this.incoming.get(key) ?? [];
    return this.base ? merged(this.base.incomingOf(key), own) : own;
  }

  out(key: string, type?: string, includeSubtypes = true): Edge[] {
    return this.outgoingOf(key).filter(e => !type || this.matches(e.type, type, includeSubtypes));
  }

  in(key: string, type?: string, includeSubtypes = true): Edge[] {
    return this.incomingOf(key).filter(e => !type || this.matches(e.type, type, includeSubtypes));
  }

  private matches(actual: string, wanted: string, includeSubtypes: boolean): boolean {
    return actual === wanted || (includeSubtypes && this.isSubtypeOf(actual, wanted));
  }

  /** Whether a type is (transitively) a subtype of another, or the same type. */
  isSubtypeOf(type: string, base: string): boolean {
    if (type === base) return true;
    const k = `${type}\u0000${base}`;
    const cached = this.subtypeCache.get(k);
    if (cached !== undefined) return cached;
    let result = false;
    const visited = new Set<string>();
    for (let t: string | undefined = type; t && !visited.has(t); t = this.supertypeKey(t)) {
      visited.add(t);
      if (t === base) { result = true; break; }
    }
    this.subtypeCache.set(k, result);
    return result;
  }

  supertypeKey(type: string): string | undefined {
    return this.incomingOf(type).find(e => e.type === REF.HasSubtype)?.source;
  }

  supertype(node: UaNode): UaNode | undefined {
    return this.get(this.supertypeKey(node.id));
  }

  /** The type and its supertypes, most specific first. */
  typeChain(node: UaNode): UaNode[] {
    const chain: UaNode[] = [];
    const visited = new Set<string>();
    for (let t: UaNode | undefined = node; t && !visited.has(t.id); t = this.supertype(t)) {
      visited.add(t.id);
      chain.push(t);
    }
    return chain;
  }

  subtypes(node: UaNode): UaNode[] {
    return this.out(node.id, REF.HasSubtype, false).map(e => this.get(e.target)).filter(isNode);
  }

  typeDefinition(node: UaNode): UaNode | undefined {
    return this.get(this.out(node.id, REF.HasTypeDefinition, false)[0]?.target);
  }

  modellingRule(node: UaNode): string | undefined {
    return this.out(node.id, REF.HasModellingRule, false)[0]?.target;
  }

  /** Targets of forward hierarchical references except HasSubtype: the components, properties and organized nodes. */
  children(node: UaNode): { edge: Edge; node: UaNode }[] {
    return this.out(node.id, REF.HierarchicalReferences)
      .filter(e => !this.isSubtypeOf(e.type, REF.HasSubtype))
      .map(e => ({ edge: e, node: this.get(e.target) }))
      .filter((c): c is { edge: Edge; node: UaNode } => !!c.node);
  }

  /** The node that holds this one through a hierarchical reference other than HasSubtype. */
  parentOf(node: UaNode): UaNode | undefined {
    const e = this.in(node.id, REF.HierarchicalReferences).find(x => !this.isSubtypeOf(x.type, REF.HasSubtype));
    return this.get(e?.source);
  }

  isHierarchical(referenceType: string): boolean {
    return this.isSubtypeOf(referenceType, REF.HierarchicalReferences);
  }

  ofClass(nodeClass: NodeClass): UaNode[] {
    return [...this.all()].filter(n => n.nodeClass === nodeClass);
  }
}

/**
 * The edges of the base and of a space on top of it, each once: a node that
 * both hold (a model loaded beside the copy being edited) would otherwise
 * count its references twice.
 */
function merged(base: Edge[], own: Edge[]): Edge[] {
  if (base.length === 0) return own;
  if (own.length === 0) return base;
  const seen = new Set(base.map(edgeKey));
  return [...base, ...own.filter(e => !seen.has(edgeKey(e)))];
}

function edgeKey(e: Edge): string {
  return `${e.source}\u0000${e.type}\u0000${e.target}`;
}

function toEdge(owner: string, r: Reference): Edge {
  return r.isForward ? { source: owner, type: r.type, target: r.target } : { source: r.target, type: r.type, target: owner };
}

function push(map: Map<string, Edge[]>, key: string, e: Edge) {
  const list = map.get(key);
  if (list) list.push(e); else map.set(key, [e]);
}

function isNode(n: UaNode | undefined): n is UaNode {
  return n !== undefined;
}
