import { AddressSpace } from '../nodeset/address-space';
import { parseNodeIdKey, text } from '../nodeset/model';
import { cardinality } from '../modeler/diagram-model';

const RULE_NAMES: Record<string, string> = {
  '1': 'Mandatory', '0..1': 'Optional', '0..n': 'OptionalPlaceholder', '1..n': 'MandatoryPlaceholder',
};

export function NodeDetails({ space, nodeKey }: { space: AddressSpace; nodeKey: string }) {
  const node = space.get(nodeKey);
  if (!node) return <div className="empty">Unknown node.</div>;
  const name = (key: string | undefined) => {
    const n = space.get(key);
    return n ? text(n.displayName) || n.browseName.name : key ?? '';
  };
  const id = parseNodeIdKey(node.id);
  const rule = cardinality(space.modellingRule(node));
  const rows: [string, string | undefined][] = [
    ['NodeClass', node.nodeClass],
    ['NodeId', id.identifier],
    ['Namespace', id.namespaceUri],
    ['BrowseName', node.browseName.name],
    ['Description', text(node.description) || undefined],
    ['IsAbstract', node.isAbstract ? 'true' : undefined],
    ['Supertype', node.nodeClass.endsWith('Type') ? name(space.supertypeKey(node.id)) || undefined : undefined],
    ['TypeDefinition', space.typeDefinition(node) ? name(space.typeDefinition(node)!.id) : undefined],
    ['ModellingRule', rule ? RULE_NAMES[rule] : undefined],
    ['DataType', node.dataType ? name(node.dataType) : undefined],
    ['ValueRank', node.valueRank?.toString()],
    ['Symmetric', node.symmetric ? 'true' : undefined],
    ['InverseName', node.inverseName ? text(node.inverseName) || undefined : undefined],
  ];
  return (
    <>
      <h3>{text(node.displayName) || node.browseName.name}</h3>
      <table>
        <tbody>
          {rows.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => (
            <tr key={k}><td>{k}</td><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
