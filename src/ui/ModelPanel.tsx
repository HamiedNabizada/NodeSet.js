// The model being edited: its URI, version and date, the models it requires,
// and adding more models (the bundled DI, or a NodeSet file).

import { useEffect, useState } from 'react';
import { isBundled } from '../nodeset/bundled';
import { Workspace } from '../workspace';

const OFFERED = ['http://opcfoundation.org/UA/DI/'];

export function ModelPanel({ workspace, run, onLoaded }: {
  workspace: Workspace;
  run: (action: () => unknown) => void;
  onLoaded: (text: string, warn?: boolean) => void;
}) {
  const model = workspace.editable?.models[0];
  const [version, setVersion] = useState(model?.version ?? '');
  const [date, setDate] = useState(model?.publicationDate?.slice(0, 10) ?? '');
  useEffect(() => { setVersion(model?.version ?? ''); setDate(model?.publicationDate?.slice(0, 10) ?? ''); }, [model?.version, model?.publicationDate]);
  if (!model) return <div className="empty">No model open.</div>;

  const loaded = workspace.loadedModels;
  const declared = new Set(model.requiredModels.map(r => r.modelUri));
  const offer = OFFERED.filter(uri => isBundled(uri) && !loaded.some(m => m.modelUri === uri));
  const commit = () => {
    if (version !== model.version || date !== model.publicationDate?.slice(0, 10)) run(() => workspace.editor!.setModelInfo(version, date));
  };

  const addBundled = async (uri: string) => {
    await workspace.addBundled(uri);
    onLoaded(`Loaded ${uri}. Its types can now be used; saving declares it as required.`);
  };
  const addFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const missing = await workspace.addRequired(await file.text());
      onLoaded(missing.length > 0 ? `Loaded ${file.name}; it requires models that are missing: ${missing.join(', ')}.` : `Loaded ${file.name}.`, missing.length > 0);
    } catch (err) {
      onLoaded(`${file.name}: ${(err as Error).message}`, true);
    }
  };

  return (
    <div className="editor">
      <h3>Model <span className="kind">{workspace.editable!.nodes.length} nodes</span></h3>
      <label className="field"><span>Namespace</span><div><span className="mono wrap">{model.modelUri}</span></div></label>
      <label className="field"><span>Version</span><div>
        <input value={version} onChange={e => setVersion(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
      </div></label>
      <label className="field"><span>Published</span><div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} onBlur={commit} />
      </div></label>
      <fieldset className="add">
        <legend>Models in use</legend>
        {loaded.map(m => (
          <div key={m.modelUri} className="row ref">
            <span title={m.modelUri}>{m.modelUri} <em>{m.version}</em></span>
            {declared.has(m.modelUri) ? <span className="note">required</span> : <span className="note">loaded</span>}
          </div>
        ))}
        <div className="note">Models whose types the model uses are declared as required when it is saved.</div>
        {offer.map(uri => <button key={uri} onClick={() => addBundled(uri)}>Load {uri.replace('http://opcfoundation.org/UA/', '')}</button>)}
        <label className="button-like">Load a NodeSet file…<input type="file" accept=".xml" onChange={addFile} /></label>
      </fieldset>
    </div>
  );
}
