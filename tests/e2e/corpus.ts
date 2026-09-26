// The released companion specifications in a clone of OPCFoundation/UA-Nodeset,
// found by the model they declare, so that a test can load what a model requires.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Released companion specifications of different size and shape, each opened
// with what it requires: every type shown once, one edit and its undo, save.
// UA_NODESET names a clone of OPCFoundation/UA-Nodeset; CI checks out the
// folders in corpus-folders.txt at a fixed commit. Without it the test is skipped.
export const SPECIFICATIONS = [
  'CommercialKitchenEquipment/Opc.Ua.CommercialKitchenEquipment.NodeSet2.xml',
  'LADS/Opc.Ua.LADS.NodeSet2.xml',
  'MachineTool/Opc.Ua.MachineTool.NodeSet2.xml',
  'MachineVision/Opc.Ua.MachineVision.NodeSet2.xml',
  'Machinery/Opc.Ua.Machinery.NodeSet2.xml',
  'PackML/Opc.Ua.PackML.NodeSet2.xml',
  'PADIM/Opc.Ua.PADIM.NodeSet2.xml',
  'PlasticsRubber/GeneralTypes/1.03/Opc.Ua.PlasticsRubber.GeneralTypes.NodeSet2.xml',
  'Pumps/Opc.Ua.Pumps.NodeSet2.xml',
  'Robotics/Opc.Ua.Robotics.NodeSet2.xml',
  'Scales/Opc.Ua.Scales.NodeSet2.xml',
  'Woodworking/Opc.Ua.Woodworking.NodeSet2.xml',
];

interface Entry {
  file: string;
  modelUri: string;
  version?: string;
  publicationDate?: string;
  required: { modelUri: string; version?: string }[];
}

/** Models the modeler ships; they are never loaded from the corpus. */
const BUNDLED = new Set(['http://opcfoundation.org/UA/', 'http://opcfoundation.org/UA/DI/']);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    if (d.name.startsWith('.')) return [];
    const path = join(dir, d.name);
    return d.isDirectory() ? files(path) : /\.nodeset2\.xml$/i.test(d.name) ? [path] : [];
  });
}

const attribute = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/** The <Models> part of a NodeSet, read without parsing the whole file. */
function read(file: string): Entry | undefined {
  const head = readFileSync(file, 'utf8').slice(0, 20_000);
  const models = head.match(/<Models>([\s\S]*?)<\/Models>/)?.[1];
  const model = models?.match(/<Model\b[^>]*>/)?.[0];
  const modelUri = model && attribute(model, 'ModelUri');
  if (!models || !model || !modelUri) return undefined;
  const required = [...models.matchAll(/<RequiredModel\b[^>]*>/g)].map(m => ({
    modelUri: attribute(m[0], 'ModelUri')!, version: attribute(m[0], 'Version'),
  }));
  return { file, modelUri, version: attribute(model, 'Version'), publicationDate: attribute(model, 'PublicationDate'), required };
}

export class Corpus {
  private readonly byModel = new Map<string, Entry[]>();

  constructor(readonly root: string) {
    for (const file of files(root)) {
      const entry = read(file);
      if (!entry) continue;
      const list = this.byModel.get(entry.modelUri) ?? [];
      list.push(entry);
      this.byModel.set(entry.modelUri, list);
    }
  }

  /** The file of a model: the version asked for, else the newest publication. */
  private find(modelUri: string, version?: string): Entry | undefined {
    const list = this.byModel.get(modelUri) ?? [];
    return list.find(e => version && e.version === version)
      ?? [...list].sort((a, b) => (b.publicationDate ?? '').localeCompare(a.publicationDate ?? ''))[0];
  }

  /** The files a NodeSet requires, those it requires in turn first; bundled models left out. */
  required(file: string): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (entry: Entry) => {
      for (const r of entry.required) {
        if (BUNDLED.has(r.modelUri) || seen.has(r.modelUri)) continue;
        seen.add(r.modelUri);
        const found = this.find(r.modelUri, r.version);
        if (!found) throw new Error(`${r.modelUri}, required by ${entry.modelUri}, is not in ${this.root}.`);
        visit(found);
        order.push(found.file);
      }
    };
    const own = read(file);
    if (!own) throw new Error(`${file} declares no model.`);
    seen.add(own.modelUri);
    visit(own);
    return order;
  }
}
