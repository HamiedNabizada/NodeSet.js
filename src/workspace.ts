// What the modeler has open: one editable NodeSet and the models it
// requires, taken from what is already loaded, the bundled NodeSets, or
// files the user adds. The address space is rebuilt after every change to
// the editable file.

import { AddressSpace } from './nodeset/address-space';
import { isBundled, loadBundled } from './nodeset/bundled';
import { ModelEditor, newModel } from './nodeset/edit';
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
  editor?: ModelEditor;
  /** Required models, in load order. */
  private readonly dependencies: NodeSetFile[] = [];
  private readonly loaded = new Set<string>();

  get editable(): NodeSetFile | undefined {
    return this.editor?.file;
  }

  /** Opens a NodeSet for editing, with everything it requires that can be found. */
  async open(xml: string): Promise<OpenResult> {
    return this.start(readNodeSet(xml));
  }

  /** Starts a new, empty model. */
  async create(modelUri: string): Promise<OpenResult> {
    return this.start(newModel(modelUri));
  }

  private async start(file: NodeSetFile): Promise<OpenResult> {
    this.dependencies.length = 0;
    this.loaded.clear();
    const missing = await this.require(file, new Set());
    this.editor = new ModelEditor(file, () => this.space, f => this.rebuild(f));
    this.rebuild(file);
    return { file, missing };
  }

  /** Adds a model the editable file requires but that is not bundled. */
  async addRequired(xml: string): Promise<string[]> {
    const file = readNodeSet(xml);
    const missing = await this.require(file, new Set());
    this.add(file);
    if (this.editable) this.rebuild(this.editable);
    return missing;
  }

  private add(file: NodeSetFile) {
    this.dependencies.push(file);
    for (const m of file.models) this.loaded.add(m.modelUri);
  }

  private rebuild(editable: NodeSetFile) {
    const space = new AddressSpace();
    for (const d of this.dependencies) space.load(d);
    space.load(editable, true);
    this.space = space;
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
      this.add(dependency);
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
