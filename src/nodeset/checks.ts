// Checks on the model being edited, following OPC 10000-3. Findings are
// advice while editing; nothing prevents saving a model with findings.

import { AddressSpace, REF } from './address-space';
import { NodeSetFile, text, UA_NAMESPACE, UaNode } from './model';

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

    const names = new Map<string, number>();
    for (const c of space.children(n)) names.set(c.node.browseName.name, (names.get(c.node.browseName.name) ?? 0) + 1);
    for (const [name, count] of names) if (count > 1) add('M002', 'error', n, `${count} children are named '${name}'.`);

    if ((n.nodeClass === 'Object' || n.nodeClass === 'Variable') && !space.typeDefinition(n)) {
      add('M003', 'error', n, 'it has no TypeDefinition.');
    }
    if ((n.nodeClass === 'Variable' || n.nodeClass === 'VariableType') && !n.dataType) {
      add('M004', 'warning', n, 'it has no DataType; BaseDataType is assumed.');
    }
    if (TYPE_CLASSES.has(n.nodeClass) && !space.supertypeKey(n.id) && !ROOT_TYPES.has(n.browseName.name)) {
      add('M005', 'error', n, 'it has no supertype.');
    }

    const rule = space.modellingRule(n);
    if (!TYPE_CLASSES.has(n.nodeClass) && !rule && insideType(space, n)) {
      add('M006', 'warning', n, 'it is part of a type but has no ModellingRule, so instances will not get it.');
    }
    const typeDefinition = space.typeDefinition(n);
    if (!rule && !insideType(space, n) && typeDefinition?.isAbstract) {
      add('M007', 'error', n, `its type ${label(typeDefinition)} is abstract.`);
    }

    if (n.nodeClass === 'ReferenceType' && !n.symmetric && text(n.inverseName) === '') {
      add('M008', 'warning', n, 'it has no InverseName.');
    }
    // Standard properties (InputArguments, EnumStrings …) keep their BrowseName in the UA namespace.
    if (!n.id.startsWith(n.browseName.namespaceUri + '|') && n.browseName.namespaceUri !== UA_NAMESPACE) {
      add('M009', 'warning', n, `its BrowseName is in ${n.browseName.namespaceUri}.`);
    }
  }
  return findings;
}

/** Whether a node is held, directly or through other declarations, by a type. */
function insideType(space: AddressSpace, n: UaNode): boolean {
  const seen = new Set<string>();
  for (let p = space.parentOf(n); p && !seen.has(p.id); p = space.parentOf(p)) {
    seen.add(p.id);
    if (TYPE_CLASSES.has(p.nodeClass)) return true;
    // A node organized by a folder instance is not part of a type.
    if (space.out(p.id, REF.Organizes).some(e => e.target === n.id)) return false;
  }
  return false;
}

function label(n: UaNode): string {
  return text(n.displayName) || n.browseName.name;
}
