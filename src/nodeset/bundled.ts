// The NodeSets that ship with the modeler, loaded on demand so the base
// model (4 MB of XML) does not weigh on the first page load.

import { NodeSetFile, UA_NAMESPACE } from './model';
import { readNodeSet } from './reader';

const BUNDLED: Record<string, () => Promise<{ default: string }>> = {
  [UA_NAMESPACE]: () => import(/* webpackChunkName: "nodeset-ua" */ '../../assets/nodesets/Opc.Ua.NodeSet2.xml'),
  'http://opcfoundation.org/UA/DI/': () => import(/* webpackChunkName: "nodeset-di" */ '../../assets/nodesets/Opc.Ua.Di.NodeSet2.xml'),
};

export function isBundled(modelUri: string): boolean {
  return modelUri in BUNDLED;
}

export async function loadBundled(modelUri: string): Promise<NodeSetFile> {
  const load = BUNDLED[modelUri];
  if (!load) throw new Error(`No bundled NodeSet for '${modelUri}'.`);
  return readNodeSet((await load()).default);
}
