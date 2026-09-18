// What the modeler has open: one editable NodeSet and the models it
// requires, taken from what is already loaded, the bundled NodeSets, or
// files the user adds.

import { AddressSpace } from './nodeset/address-space';
import { isBundled, loadBundled } from './nodeset/bundled';
import { NodeSetFile, UA_NAMESPACE } from './nodeset/model';
import { readNodeSet } from './nodeset/reader';
import { writeNodeSet } from './nodeset/writer';

export interface OpenResult {
  file: NodeSetFile;
  /** Required models that are neither loaded nor bundled. */
  missing: string[];
}

export class Workspace {
  space = new AddressSpace();
  editable?: NodeSetFile;
  private readonly loaded = new Map<string, NodeSetFile>();

  /** Opens a NodeSet for editing, with everything it requires that can be found. */
  async open(xml: string): Promise<OpenResult> {
    const file = readNodeSet(xml);
    this.space = new AddressSpace();
    this.loaded.clear();
    const missing = await this.require(file, new Set());
    this.space.load(file, true);
    for (const m of file.models) this.loaded.set(m.modelUri, file);
    this.editable = file;
    return { file, missing };
  }

  /** Adds a model the editable file requires but that is not bundled. */
  async addRequired(xml: string): Promise<string[]> {
    const file = readNodeSet(xml);
    const missing = await this.require(file, new Set());
    this.space.load(file);
    for (const m of file.models) this.loaded.set(m.modelUri, file);
    if (this.editable) {
      // Keep the editable file on top: it may override nodes of what it requires.
      this.space.load(this.editable, true);
    }
    return missing;
  }

  private async require(file: NodeSetFile, visiting: Set<string>): Promise<string[]> {
    const missing: string[] = [];
    const needed = new Set([UA_NAMESPACE, ...file.models.flatMap(m => m.requiredModels.map(r => r.modelUri))]);
    for (const uri of needed) {
      if (this.loaded.has(uri) || visiting.has(uri) || file.models.some(m => m.modelUri === uri)) continue;
      if (!isBundled(uri)) { missing.push(uri); continue; }
      visiting.add(uri);
      const dependency = await loadBundled(uri);
      missing.push(...await this.require(dependency, visiting));
      this.space.load(dependency);
      for (const m of dependency.models) this.loaded.set(m.modelUri, dependency);
    }
    return [...new Set(missing)];
  }

  /** The namespaces of the editable file's own models. */
  get ownNamespaces(): string[] {
    return this.editable?.models.map(m => m.modelUri) ?? [];
  }

  save(): string {
    if (!this.editable) throw new Error('Nothing is open.');
    return writeNodeSet(this.editable);
  }
}
