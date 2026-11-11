// The model being edited: its URI, version and date, the models it requires,
// and adding more models (the bundled DI, or a NodeSet file).

import { useEffect, useState } from 'react';
import { isBundled } from '../nodeset/bundled';
import { Workspace } from '../workspace';
import { t, translate } from './i18n';

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
  if (!model) return <div className="empty">{t('No model open.')}</div>;

  const loaded = workspace.loadedModels;
  const declared = new Set(model.requiredModels.map(r => r.modelUri));
  // Not the model being edited: loaded beside itself, it would count every reference twice.
  const offer = OFFERED.filter(uri => isBundled(uri) && !loaded.some(m => m.modelUri === uri) && !workspace.ownNamespaces.includes(uri));
  const commit = () => {
    if (version !== model.version || date !== model.publicationDate?.slice(0, 10)) run(() => workspace.editor!.setModelInfo(version, date));
  };

  const addBundled = async (uri: string) => {
    await workspace.addBundled(uri);
    onLoaded(t('Loaded {0}. Its types can now be used; saving declares it as required.', uri));
  };
  const addFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const before = workspace.loadedModels.length;
      const missing = await workspace.addRequired(await file.text());
      if (workspace.loadedModels.length === before) onLoaded(t('{0} adds no model: its models are open or loaded already.', file.name));
      else onLoaded(missing.length > 0 ? t('Loaded {0}; it requires models that are missing: {1}.', file.name, missing.join(', ')) : t('Loaded {0}.', file.name), missing.length > 0);
    } catch (err) {
      onLoaded(t('{0}: {1}', file.name, translate(err as Error)), true);
    }
  };

  return (
    <div className="editor">
      <h3>{t('Model')} <span className="kind">{t('{0} nodes', workspace.editable!.nodes.length)}</span></h3>
      <label className="field"><span>Namespace</span><div><span className="mono wrap">{model.modelUri}</span></div></label>
      <label className="field"><span>Version</span><div>
        <input value={version} onChange={e => setVersion(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
      </div></label>
      <label className="field"><span>{t('Published')}</span><div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} onBlur={commit} />
      </div></label>
      <fieldset className="add">
        <legend>{t('Models in use')}</legend>
        {loaded.map(m => (
          <div key={m.modelUri} className="row ref">
            <span title={m.modelUri}>{shortName(m.modelUri)} <em>{m.version}</em></span>
            {declared.has(m.modelUri) ? <span className="note">{t('required')}</span> : <span className="note">{t('loaded')}</span>}
          </div>
        ))}
        <div className="note">{t('Models whose types the model uses are declared as required when it is saved.')}</div>
        {offer.map(uri => <button key={uri} onClick={() => addBundled(uri)}>{t('Load {0}', shortName(uri))}</button>)}
        <label className="button-like">{t('Load a NodeSet file…')}<input type="file" accept=".xml" onChange={addFile} /></label>
      </fieldset>
    </div>
  );
}

/** "UA", "DI", "Machinery" for OPC Foundation models; other URIs as they are. */
function shortName(uri: string): string {
  const opcf = 'http://opcfoundation.org/UA/';
  if (uri === opcf) return 'UA';
  return uri.startsWith(opcf) ? uri.slice(opcf.length).replace(/\/$/, '') : uri;
}
