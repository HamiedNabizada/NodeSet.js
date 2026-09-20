// Checks on the model being edited, following OPC 10000-3. Findings are
// advice while editing; nothing prevents saving a model with findings.

import { AddressSpace, REF, RULE, SM } from './address-space';
import { isStateMachineType, readStateMachine } from './statemachine';
import { NodeSetFile, parseNodeIdKey, text, UA_NAMESPACE, uaKey, UaNode } from './model';

export type Severity = 'error' | 'warning';

export interface Finding {
  rule: string;
  severity: Severity;
  node: string;
  message: string;
}

export const RULES: Record<string, string> = {
  M001: 'A reference points to a node or reference type that is neither in the model nor in a model it requires.',
  M002: 'Two children of one node have the same BrowseName.',
  M003: 'An Object or Variable has no TypeDefinition.',
  M004: 'A Variable or VariableType has no DataType.',
  M005: 'A type has no supertype.',
  M006: 'An instance declaration below a type has no ModellingRule.',
  M007: 'An instance (no ModellingRule) is typed by an abstract type.',
  M008: 'A non-symmetric ReferenceType has no InverseName.',
  M009: 'The BrowseName is in another namespace than the NodeId.',
  M010: 'A structure has no "Default Binary" encoding, so servers cannot encode its values.',
  M011: 'A structure or enumeration has no fields, so clients cannot interpret its values.',
  M012: 'The model declares a node whose NodeId belongs to another namespace.',
  M013: 'ValueRank and ArrayDimensions do not agree.',
  M014: 'An argument of a method names a DataType the model does not know.',
  M015: 'A placeholder is not named in angle brackets, or a name in angle brackets is no placeholder.',
  M016: 'A node held by HasProperty is not a Variable of PropertyType.',
  M017: 'Two fields of a DataType have the same name, or two values the same number.',
  M018: 'A symmetric ReferenceType has an InverseName.',
  M019: 'No reference at all leads to a node: it is part of no type and no hierarchy.',
  M020: 'A transition of a state machine does not name both of its ends.',
  M021: 'A state or transition has no number, or two of them share one.',
  M022: 'An instance is missing a child its type declares as Mandatory.',
  M023: 'An instance fills none of a MandatoryPlaceholder its type declares.',
};

const TYPE_CLASSES = new Set(['ObjectType', 'VariableType', 'DataType', 'ReferenceType']);
/** The roots of the four type hierarchies have no supertype. */
const ROOT_TYPES = new Set(['BaseObjectType', 'BaseVariableType', 'BaseDataType', 'References']);

export function check(space: AddressSpace, file: NodeSetFile): Finding[] {
  const findings: Finding[] = [];
  const add = (rule: string, severity: Severity, node: UaNode, detail: string) =>
    findings.push({ rule, severity, node: node.id, message: `${label(node)}: ${detail}` });

  for (const n of file.nodes) {
    for (const r of n.references) {
      if (!space.get(r.target)) add('M001', 'error', n, `the target ${r.target} of a reference is unknown.`);
      if (!space.get(r.type)) add('M001', 'error', n, `the reference type ${r.type} is unknown.`);
    }

    // A BrowseName is unique with its namespace, not without it: a type may
    // well hold its own NodeVersion beside the one of the UA namespace. And
    // only the declarations of a type must be unique; instances may repeat a
    // name.
    if (TYPE_CLASSES.has(n.nodeClass)) {
      const names = new Map<string, number>();
      for (const c of space.children(n)) {
        const key = `${c.node.browseName.namespaceUri}|${c.node.browseName.name}`;
        names.set(key, (names.get(key) ?? 0) + 1);
      }
      for (const [key, count] of names) {
        if (count > 1) add('M002', 'error', n, `${count} children are named '${key.split('|')[1]}'.`);
      }
    }

    if ((n.nodeClass === 'Object' || n.nodeClass === 'Variable') && !space.typeDefinition(n)) {
      add('M003', 'error', n, 'it has no TypeDefinition.');
    }
    if ((n.nodeClass === 'Variable' || n.nodeClass === 'VariableType') && !n.dataType) {
      add('M004', 'warning', n, 'it has no DataType; BaseDataType is assumed.');
    }
    if (TYPE_CLASSES.has(n.nodeClass) && !space.supertypeKey(n.id) && !ROOT_TYPES.has(n.browseName.name)) {
      add('M005', 'error', n, 'it has no supertype.');
    }

    // The available states and transitions of a machine type carry no
    // ModellingRule, as the base model's own machines show.
    const definition = space.typeDefinition(n)?.id;
    const partOfMachine = definition !== undefined
      && (space.isSubtypeOf(definition, SM.StateType) || space.isSubtypeOf(definition, SM.TransitionType));

    const rule = space.modellingRule(n);
    if (!TYPE_CLASSES.has(n.nodeClass) && !rule && !partOfMachine && !STANDARD_PROPERTIES.has(n.browseName.name)
        && insideType(space, n)) {
      add('M006', 'warning', n, 'it is part of a type but has no ModellingRule, so instances will not get it.');
    }
    const typeDefinition = space.typeDefinition(n);
    if (!rule && !insideType(space, n) && typeDefinition?.isAbstract) {
      add('M007', 'error', n, `its type ${label(typeDefinition)} is abstract.`);
    }

    if (n.nodeClass === 'ReferenceType' && !n.symmetric && text(n.inverseName) === '') {
      add('M008', 'warning', n, 'it has no InverseName.');
    }
    if (n.nodeClass === 'DataType' && !n.isAbstract && space.isSubtypeOf(n.id, uaKey(22))
      && !space.out(n.id, uaKey(38), false)
        .some(e => space.get(e.target)?.browseName.name === 'Default Binary'
                   || space.get(e.target)?.browseName.name === 'Default XML')) {
      add('M010', 'warning', n, 'it has neither a "Default Binary" nor a "Default XML" encoding.');
    }
    // A definition holds the fields a type adds; the ones it inherits stay
    // where they were declared, so a structure with an empty definition is
    // only empty when no supertype of it has fields either.
    if (n.nodeClass === 'DataType' && !n.isAbstract && (space.isSubtypeOf(n.id, uaKey(22)) || space.isSubtypeOf(n.id, uaKey(29)))
      && !inheritedFields(space, n)) {
      add('M011', 'warning', n, 'it and the types it derives from have no fields.');
    }
    // The model owns what its Models section declares. The namespace table
    // does not say it: the base model has no table at all, and every one of
    // its nodes would be a foreigner in its own file.
    const owned = file.models.length > 0
      ? file.models.map(m => m.modelUri)
      : file.namespaceUris;
    if (!owned.includes(parseNodeIdKey(n.id).namespaceUri)) {
      add('M012', 'error', n, `its NodeId is in ${parseNodeIdKey(n.id).namespaceUri}, which the model does not own.`);
    }

    const rank = n.valueRank ?? -1;
    const dimensions = (n.arrayDimensions ?? '').split(',').map(d => d.trim()).filter(d => d !== '');
    if (dimensions.length > 0 && rank < 1) {
      add('M013', 'error', n, `it has ArrayDimensions but ValueRank ${rank}.`);
    } else if (rank >= 1 && dimensions.length > 0 && dimensions.length !== rank) {
      add('M013', 'error', n, `ValueRank ${rank} asks for ${rank} ArrayDimensions, not ${dimensions.length}.`);
    }

    for (const a of n.arguments ?? []) {
      if (!space.get(a.dataType)) add('M014', 'error', n, `the argument '${a.name}' names the unknown DataType ${a.dataType}.`);
      if (a.name.trim() === '') add('M014', 'warning', n, 'an argument has no name.');
    }

    const placeholder = rule === RULE.MandatoryPlaceholder || rule === RULE.OptionalPlaceholder;
    const angled = /<.+>/.test(n.browseName.name);
    // A placeholder method keeps its name: what the instance may choose are
    // its arguments, not what it is called.
    if (placeholder && !angled && n.nodeClass !== 'Method') {
      add('M015', 'warning', n, 'it is a placeholder but not named <like this>.');
    }
    if (!placeholder && angled && rule) add('M015', 'warning', n, 'it is named <like a placeholder> but its ModellingRule is not one.');

    for (const e of space.out(n.id, REF.HasProperty, false)) {
      const target = space.get(e.target);
      if (!target) continue;
      if (target.nodeClass !== 'Variable') add('M016', 'error', n, `'${label(target)}' is held by HasProperty but is a ${target.nodeClass}.`);
      else if (space.typeDefinition(target) && space.typeDefinition(target)!.browseName.name !== 'PropertyType') {
        add('M016', 'warning', n, `'${label(target)}' is held by HasProperty but is a ${label(space.typeDefinition(target)!)}.`);
      }
    }

    const fields = n.definition?.fields ?? [];
    for (const [name, count] of countBy(fields.map(f => f.name))) {
      if (count > 1) add('M017', 'error', n, `${count} fields are named '${name}'.`);
    }
    const numbers = fields.map(f => f.value).filter((v): v is number => v !== undefined);
    if (numbers.length > 0 && space.isSubtypeOf(n.id, uaKey(29))) {
      for (const [value, count] of countBy(numbers.map(String))) {
        if (count > 1) add('M017', 'error', n, `${count} values are ${value}.`);
      }
    }

    if (n.nodeClass === 'ReferenceType' && n.symmetric && text(n.inverseName) !== '') {
      add('M018', 'error', n, 'it is symmetric, so it must have no InverseName.');
    }

    // Encodings and other nodes hang on references of their own kind; only a node nothing points to is lost.
    if (!TYPE_CLASSES.has(n.nodeClass) && !space.parentOf(n) && space.in(n.id).length === 0) {
      add('M019', 'warning', n, 'no reference leads to it; it is part of no type and no hierarchy.');
    }

    if (isStateMachineType(space, n)) {
      const machine = readStateMachine(space, n);
      for (const t of machine.transitions) {
        if (!t.from || !t.to) add('M020', 'error', n, `the transition '${t.name}' has no ${!t.from ? 'FromState' : 'ToState'}.`);
      }
      for (const [what, items] of [['state', machine.states], ['transition', machine.transitions]] as const) {
        const numbers = new Map<number, number>();
        // A machine that numbers none of them leaves the numbers to its
        // instances, as released companion specifications do; one that numbers
        // some and not others has forgotten the rest.
        const numbered = items.some(i => i.number !== undefined);
        for (const i of items) {
          if (i.number === undefined) {
            if (numbered) add('M021', 'warning', n, `the ${what} '${i.name}' has no number, while others have one.`);
          } else numbers.set(i.number, (numbers.get(i.number) ?? 0) + 1);
        }
        for (const [number, count] of numbers) {
          if (count > 1) add('M021', 'error', n, `${count} ${what}s share the number ${number}.`);
        }
      }
    }

    // An instance against its type: what the type promises, the instance has
    // to have (OPC 10000-3 6.4.4.4). Nothing checked this, so a model a server
    // would refuse saved without a word.
    if ((n.nodeClass === 'Object' || n.nodeClass === 'Variable') && !rule && !insideType(space, n)) {
      const type = space.typeDefinition(n);
      if (type) {
        const children = new Set(space.children(n).map(c => `${c.node.browseName.namespaceUri}|${c.node.browseName.name}`));
        for (const declaration of declarationsOf(space, type)) {
          const declarationRule = space.modellingRule(declaration);
          const key = `${declaration.browseName.namespaceUri}|${declaration.browseName.name}`;
          if (declarationRule === RULE.Mandatory && !children.has(key)) {
            add('M022', 'error', n, `it has no '${declaration.browseName.name}', which ${label(type)} declares as Mandatory.`);
          }
          if (declarationRule === RULE.MandatoryPlaceholder && !filled(space, n, declaration)) {
            add('M023', 'error', n, `nothing fills '${declaration.browseName.name}', which ${label(type)} declares as a MandatoryPlaceholder.`);
          }
        }
      }
    }

    // A BrowseName from another model is normal almost everywhere: a type that
    // overrides an inherited child keeps the name of the model that declared
    // it, an instance keeps the name of the declaration it fills, and the
    // standard properties keep the UA namespace. A type itself, though, names
    // itself, so a foreign namespace there is a mistake.
    if (TYPE_CLASSES.has(n.nodeClass) && !n.id.startsWith(n.browseName.namespaceUri + '|')
        && n.browseName.namespaceUri !== UA_NAMESPACE) {
      add('M009', 'warning', n, `its BrowseName is in ${n.browseName.namespaceUri}.`);
    }
  }
  return findings;
}

/** Whether a node is held, directly or through other declarations, by a type. */
/**
 * Properties the specification gives a type without a ModellingRule, because
 * they describe the type itself rather than what an instance gets.
 */
const STANDARD_PROPERTIES = new Set([
  'EnumStrings', 'EnumValues', 'OptionSetValues', 'DefaultInstanceBrowseName', 'NodeVersion',
]);

/** The declarations of a type and of the types it derives from, the most specific winning. */
function declarationsOf(space: AddressSpace, type: UaNode): UaNode[] {
  const byName = new Map<string, UaNode>();
  for (const t of space.typeChain(type)) {
    for (const c of space.children(t)) {
      const key = `${c.node.browseName.namespaceUri}|${c.node.browseName.name}`;
      if (!byName.has(key)) byName.set(key, c.node);
    }
  }
  return [...byName.values()];
}

/**
 * Whether a child of the instance fills the placeholder: one that instantiates
 * its type and is not the placeholder itself. A placeholder object or variable
 * is filled under a name of its own, a placeholder method keeps the name its
 * declaration gives it.
 */
function filled(space: AddressSpace, instance: UaNode, declaration: UaNode): boolean {
  const wanted = space.typeDefinition(declaration)?.id;
  return space.children(instance).some(c => {
    if (space.modellingRule(c.node) === RULE.MandatoryPlaceholder
        || space.modellingRule(c.node) === RULE.OptionalPlaceholder) return false;
    if (c.node.nodeClass !== declaration.nodeClass) return false;
    if (!wanted) return true;
    const type = space.typeDefinition(c.node);
    return type !== undefined && space.isSubtypeOf(type.id, wanted);
  });
}

/** Whether the DataType or one of the types it derives from declares a field. */
function inheritedFields(space: AddressSpace, n: UaNode): boolean {
  const seen = new Set<string>();
  for (let t: UaNode | undefined = n; t && !seen.has(t.id); t = space.get(space.supertypeKey(t.id) ?? '')) {
    seen.add(t.id);
    if (t.definition?.fields.length) return true;
  }
  return false;
}

export function insideType(space: AddressSpace, n: UaNode): boolean {
  const seen = new Set<string>();
  for (let p = space.parentOf(n); p && !seen.has(p.id); p = space.parentOf(p)) {
    seen.add(p.id);
    if (TYPE_CLASSES.has(p.nodeClass)) return true;
    // A node organized by a folder instance is not part of a type.
    if (space.out(p.id, REF.Organizes).some(e => e.target === n.id)) return false;
  }
  return false;
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

function label(n: UaNode): string {
  return text(n.displayName) || n.browseName.name;
}
