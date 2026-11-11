// The instances of the model as the list on the left shows them.

import { AddressSpace } from '../nodeset/address-space';
import { insideType } from '../nodeset/checks';
import { NodeSetFile, UaNode } from '../nodeset/model';

/**
 * The instances of the model that no node of the model holds: those the
 * Objects folder organizes, and those placed below a node of another model,
 * such as DI's DeviceSet. What they hold, the declarations of types, and
 * nodes outside the hierarchy (the encodings of a DataType) are not among them.
 */
export function topInstances(space: AddressSpace, file: NodeSetFile): UaNode[] {
  return file.nodes.filter(n => {
    if (n.nodeClass !== 'Object' && n.nodeClass !== 'Variable') return false;
    const parent = space.parentOf(n);
    return !!parent && !space.fileOf(parent.id)?.editable && !insideType(space, n);
  });
}
