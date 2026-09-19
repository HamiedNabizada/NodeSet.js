// What the modeler has open: one editable NodeSet and the models it
// requires, taken from what is already loaded, the bundled NodeSets, or
// files the user adds. The address space is rebuilt after every change to
// the editable file.

import { AddressSpace } from './nodeset/address-space';
import { isBundled, loadBundled } from './nodeset/bundled';
import { ModelEditor, newModel } from './nodeset/edit';
import { Layout, readLayout, writeLayout } from './nodeset/layout';
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
  /** Where the user placed nodes; not part of undo. */
  layout: Layout = new Map();
  /** Required models, in load order. */
  private readonly dependencies: NodeSetFile[] = [];
  private readonly loaded = new Set<string>();
  /** The required models, indexed once; the editable model sits on top. */
  private base?: AddressSpace;

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
    this.base = undefined;
    const missing = await this.require(file, new Set());
    this.layout = readLayout(file);
    this.editor = new ModelEditor(file, () => this.space, f => this.rebuild(f));
    this.rebuild(file);
    return { file, missing };
  }

  /** Adds a model from a NodeSet file, with what it requires; returns the models still missing. */
  async addRequired(xml: string): Promise<string[]> {
    const file = readNodeSet(xml);
    if (file.models.length > 0 && file.models.every(m => this.loaded.has(m.modelUri))) return [];
    const missing = await this.require(file, new Set());
    this.add(file);
    if (this.editable) this.rebuild(this.editable);
    return missing;
  }

  /** Adds a model the modeler ships (DI), with what it requires. */
  async addBundled(modelUri: string): Promise<void> {
    if (this.loaded.has(modelUri)) return;
    const file = await loadBundled(modelUri);
    await this.require(file, new Set());
    this.add(file);
    if (this.editable) this.rebuild(this.editable);
  }

  /** The models loaded besides the editable one. */
  get loadedModels(): { modelUri: string; version?: string; publicationDate?: string }[] {
    return this.dependencies.flatMap(d => d.models.map(m => ({ modelUri: m.modelUri, version: m.version, publicationDate: m.publicationDate })));
  }

  /**
   * Adds a RequiredModel for every namespace the editable model uses and does
   * not declare yet, with the version and date of the loaded model. Without
   * it, a NodeSet importer does not know it has to load that model.
   */
  syncRequiredModels(): string[] {
    const file = this.editable;
    const own = file?.models[0];
    if (!file || !own) return [];
    const used = new Set<string>([UA_NAMESPACE]);
    const add = (key: string | undefined) => { if (key) used.add(key.slice(0, key.lastIndexOf('|'))); };
    for (const n of file.nodes) {
      add(n.dataType);
      for (const r of n.references) { add(r.type); add(r.target); }
      for (const a of n.arguments ?? []) add(a.dataType);
      for (const f of n.definition?.fields ?? []) add(f.dataType);
    }
    const added: string[] = [];
    for (const uri of used) {
      if (file.models.some(m => m.modelUri === uri) || own.requiredModels.some(r => r.modelUri === uri)) continue;
      const info = this.loadedModels.find(m => m.modelUri === uri);
      own.requiredModels.push({ modelUri: uri, version: info?.version, publicationDate: info?.publicationDate });
      added.push(uri);
    }
    return added;
  }

  private add(file: NodeSetFile) {
    this.dependencies.push(file);
    for (const m of file.models) this.loaded.add(m.modelUri);
    this.base = undefined;
  }

  private rebuild(editable: NodeSetFile) {
    if (!this.base) {
      this.base = new AddressSpace();
      for (const d of this.dependencies) this.base.load(d);
    }
    const space = new AddressSpace(this.base);
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

  /** Remembers where the user put a node on the diagram of a type. */
  place(diagram: string, node: string, x: number, y: number): void {
    let positions = this.layout.get(diagram);
    if (!positions) this.layout.set(diagram, positions = new Map());
    positions.set(node, { x, y });
  }

  /** Forgets the positions of a diagram, so it is laid out anew. */
  resetLayout(diagram: string): void {
    this.layout.delete(diagram);
  }

  /** Models the editable file requires that are not loaded. */
  get missing(): string[] {
    const file = this.editable;
    if (!file) return [];
    const own = new Set(file.models.map(m => m.modelUri));
    return [...new Set(file.models.flatMap(m => m.requiredModels.map(r => r.modelUri)))]
      .filter(uri => uri !== UA_NAMESPACE && !own.has(uri) && !this.loaded.has(uri));
  }

  /** The namespaces of the editable file's own models. */
  get ownNamespaces(): string[] {
    return this.editable?.models.map(m => m.modelUri) ?? [];
  }

  save(): string {
    if (!this.editable) throw new Error('Nothing is open.');
    writeLayout(this.editable, this.layout);
    this.syncRequiredModels();
    return writeNodeSet(this.editable);
  }
}
