import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UaModeler } from '../modeler/Modeler';
import { REF } from '../nodeset/address-space';
import { check, Finding } from '../nodeset/checks';
import { EditError } from '../nodeset/edit';
import { NodeClass, text, uaKey, UaNode } from '../nodeset/model';
import { HostBridge, HostToModeler } from '../host/bridge';
import { Workspace } from '../workspace';
import { NodeEditor } from './NodeEditor';

const TYPE_GROUPS: { nodeClass: 'ObjectType' | 'VariableType' | 'DataType' | 'ReferenceType'; title: string }[] = [
  { nodeClass: 'ObjectType', title: 'ObjectTypes' },
  { nodeClass: 'VariableType', title: 'VariableTypes' },
  { nodeClass: 'DataType', title: 'DataTypes' },
  { nodeClass: 'ReferenceType', title: 'ReferenceTypes' },
];

type Status = { text: string; warn?: boolean };

const OBJECTS = uaKey(85);

export function App() {
  const [workspace, setWorkspace] = useState<Workspace>();
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<Status>({ text: 'Start a new model, open a NodeSet2 file, or open the DI sample.' });
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [showExternal, setShowExternal] = useState(false);
  const [showFindings, setShowFindings] = useState(false);
  const [newModelUri, setNewModelUri] = useState<string>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<UaModeler>();
  const fittedFor = useRef<string>();
  // The redraw reads the selection without redrawing when only the selection changes.
  const selectedRef = useRef<string>();
  selectedRef.current = selected;
  const [dirty, setDirty] = useState(false);
  // Inside the AutomationML Editor plugin (WebView2) the host opens models and takes them back.
  const host = useMemo(() => HostBridge.detect(), []);
  const bump = useCallback(() => setRevision(r => r + 1), []);
  const changed = useCallback(() => { setRevision(r => r + 1); setDirty(true); }, []);

  const start = useCallback(async (action: (ws: Workspace) => Promise<unknown>, name: string, required: string[] = []) => {
    setStatus({ text: `Reading ${name} …` });
    try {
      const ws = new Workspace();
      await action(ws);
      for (const xml of required) await ws.addRequired(xml);
      const missing = ws.missing;
      setWorkspace(ws);
      setDirty(false);
      setShown(undefined);
      setSelected(undefined);
      fittedFor.current = undefined;
      bump();
      const file = ws.editable!;
      setStatus(missing.length > 0
        ? { text: `${name}: missing required models: ${missing.join(', ')}.`, warn: true }
        : { text: `${name}: ${file.nodes.length} nodes of ${file.models.map(m => m.modelUri).join(', ')}.` });
    } catch (e) {
      setStatus({ text: `${name}: ${(e as Error).message}`, warn: true });
    }
  }, [bump]);

  const openFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      const xml = await file.text();
      await start(ws => ws.open(xml), file.name);
    }
  }, [start]);

  const openSample = useCallback(async () => {
    const di = await import(/* webpackChunkName: "nodeset-di" */ '../../assets/nodesets/Opc.Ua.Di.NodeSet2.xml');
    await start(ws => ws.open(di.default), 'Opc.Ua.Di.NodeSet2.xml');
  }, [start]);

  const createModel = useCallback(async () => {
    const uri = newModelUri?.trim();
    if (!uri) return;
    setNewModelUri(undefined);
    await start(ws => ws.create(uri), uri);
  }, [newModelUri, start]);

  /** Runs an edit; an EditError becomes the status line instead of an exception. */
  const run = useCallback((action: () => unknown) => {
    try {
      action();
      changed();
      setStatus({ text: 'Changed. Save to keep the NodeSet.' });
    } catch (e) {
      if (e instanceof EditError) setStatus({ text: e.message, warn: true });
      else throw e;
    }
  }, [changed]);

  const undo = useCallback(() => { workspace?.editor?.undo(); changed(); }, [workspace, changed]);
  const redo = useCallback(() => { workspace?.editor?.redo(); changed(); }, [workspace, changed]);

  const apply = useCallback(() => {
    if (!host || !workspace?.editable) return;
    host.post({ type: 'apply', xml: workspace.save(), modelUri: workspace.editable.models[0]?.modelUri ?? '' });
    setDirty(false);
    setStatus({ text: 'Sent to the document.' });
  }, [host, workspace]);

  // Messages from the host, and "ready" once the modeler listens.
  useEffect(() => {
    if (!host) return;
    const stop = host.listen((m: HostToModeler) => {
      if (m.type === 'open') start(ws => ws.open(m.xml), m.name, m.required);
      if (m.type === 'new') start(ws => ws.create(m.modelUri), m.modelUri, m.required);
    });
    host.post({ type: 'ready', version: '0.1.0' });
    return stop;
  }, [host, start]);

  useEffect(() => { host?.post({ type: 'dirty', dirty }); }, [host, dirty]);
  useEffect(() => { host?.post({ type: 'status', text: status.text, warn: status.warn }); }, [host, status]);

  const save = useCallback(() => {
    if (!workspace?.editable) return;
    const blob = new Blob([workspace.save()], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const model = workspace.editable.models[0]?.modelUri ?? 'Model';
    a.download = `${model.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '.').replace(/\.+$/, '')}.NodeSet2.xml`;
    a.click();
    URL.revokeObjectURL(a.href);
    setDirty(false);
    setStatus({ text: `Saved ${a.download}.` });
  }, [workspace]);

  // Undo and redo from the keyboard, except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select');
      if (typing || !(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z') { e.preventDefault(); undo(); }
      if (e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // The canvas lives as long as the workspace.
  useEffect(() => {
    if (!workspace || !canvasRef.current) return;
    const modeler = new UaModeler(canvasRef.current, () => workspace.space);
    modeler.onSelect(key => { if (key) setSelected(key); });
    modeler.onOpen(key => {
      const node = workspace.space.get(key);
      if (node?.nodeClass.endsWith('Type')) setShown(key);
      else { const t = node && workspace.space.typeDefinition(node); if (t) setShown(t.id); }
    });
    modeler.onMoved(moved => {
      const diagram = modeler.current?.root;
      if (!diagram) return;
      for (const m of moved) workspace.place(diagram, m.nodeKey, m.x, m.y);
      changed();
    });
    modelerRef.current = modeler;
    return () => { modeler.destroy(); modelerRef.current = undefined; };
  }, [workspace, changed]);

  // Redraw after every change; fit only when another type is shown.
  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler || !workspace) return;
    if (!shown || !workspace.space.get(shown)) {
      modeler.diagram.clear();
      if (shown) setShown(undefined);
      return;
    }
    const d = modeler.showType(shown, { ownNamespaces: workspace.ownNamespaces, positions: workspace.layout.get(shown) });
    if (fittedFor.current !== shown) {
      modeler.fit();
      fittedFor.current = shown;
      if (d.truncated) setStatus({ text: 'Deeper declarations are left out; double-click a node to open its type.' });
    }
    modeler.select(selectedRef.current);
  }, [shown, workspace, revision]);

  useEffect(() => { modelerRef.current?.select(selected); }, [selected]);

  const findings = useMemo<Finding[]>(
    () => (workspace?.editable ? check(workspace.space, workspace.editable) : []),
    [workspace, revision]);

  const types = useMemo(() => {
    if (!workspace) return [];
    const own = new Set(workspace.ownNamespaces);
    const needle = filter.trim().toLowerCase();
    return TYPE_GROUPS.map(g => ({
      ...g,
      nodes: workspace.space.ofClass(g.nodeClass as NodeClass)
        .filter(n => showExternal || own.has(n.browseName.namespaceUri))
        .filter(n => !needle || label(n).toLowerCase().includes(needle))
        .sort((a, b) => label(a).localeCompare(label(b))),
      own,
    }));
  }, [workspace, filter, showExternal, revision]);

  // Instances of the model: its Objects and Variables organized by the Objects folder.
  const instances = useMemo(() => {
    if (!workspace?.editable) return [];
    const needle = filter.trim().toLowerCase();
    return workspace.editable.nodes
      .filter(n => (n.nodeClass === 'Object' || n.nodeClass === 'Variable') && workspace.space.in(n.id, REF.Organizes).some(e => e.source === OBJECTS))
      .filter(n => !needle || label(n).toLowerCase().includes(needle))
      .sort((a, b) => label(a).localeCompare(label(b)));
  }, [workspace, filter, revision]);

  const addType = (nodeClass: typeof TYPE_GROUPS[number]['nodeClass']) => {
    const name = window.prompt(`Name of the new ${nodeClass}`);
    if (!name || !workspace?.editor) return;
    run(() => {
      const key = workspace.editor!.addType(nodeClass, name);
      setShown(key);
      setSelected(key);
    });
  };

  const goTo = (f: Finding) => {
    if (!workspace) return;
    let owner = workspace.space.get(f.node);
    for (let i = 0; owner && !owner.nodeClass.endsWith('Type') && i < 50; i++) owner = workspace.space.parentOf(owner);
    if (owner) setShown(owner.id);
    setSelected(f.node);
  };

  const editor = workspace?.editor;
  const errors = findings.filter(f => f.severity === 'error').length;

  return (
    <div className="app">
      <div className="toolbar">
        <span className="title">OPC UA Modeler</span>
        {newModelUri === undefined
          ? <button onClick={() => setNewModelUri('http://example.org/MyModel/')}>New model…</button>
          : (
            <span className="inline-form">
              <input autoFocus size={36} value={newModelUri} onChange={e => setNewModelUri(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createModel(); if (e.key === 'Escape') setNewModelUri(undefined); }} />
              <button onClick={createModel}>Create</button>
              <button onClick={() => setNewModelUri(undefined)}>Cancel</button>
            </span>
          )}
        <label className="button">Open NodeSet…<input type="file" accept=".xml" onChange={openFile} /></label>
        {!host && <button onClick={openSample}>Open DI sample</button>}
        {host && <button className="primary" onClick={apply} disabled={!workspace?.editable}>Apply to document</button>}
        <button onClick={save} disabled={!workspace?.editable}>Save NodeSet{dirty ? ' *' : ''}</button>
        <span className="sep" />
        <button onClick={undo} disabled={!editor?.canUndo} title="Ctrl+Z">Undo</button>
        <button onClick={redo} disabled={!editor?.canRedo} title="Ctrl+Y">Redo</button>
        {shown && <button onClick={() => { workspace?.resetLayout(shown); changed(); }}>Reset layout</button>}
        <span className="sep" />
        <button className={errors > 0 ? 'warn' : ''} disabled={!workspace} onClick={() => setShowFindings(s => !s)}>
          Checks: {errors} error(s), {findings.length - errors} warning(s)
        </button>
        <label style={{ marginLeft: 'auto', fontSize: 13 }}>
          <input type="checkbox" checked={showExternal} onChange={e => setShowExternal(e.target.checked)} /> Types of required models
        </label>
      </div>
      <div className="main">
        <div className="side">
          <input className="filter" placeholder="Filter types" value={filter} onChange={e => setFilter(e.target.value)} />
          {types.map(g => (
            <div key={g.nodeClass}>
              <div className="group">
                {g.title} ({g.nodes.length})
                {editor && <button className="add-type" title={`New ${g.nodeClass}`} onClick={() => addType(g.nodeClass)}>+</button>}
              </div>
              {g.nodes.map(n => (
                <div
                  key={n.id}
                  className={`item${n.id === shown ? ' active' : ''}${g.own.has(n.browseName.namespaceUri) ? '' : ' external'}`}
                  title={n.id}
                  onClick={() => { setShown(n.id); setSelected(n.id); }}
                >
                  {n.isAbstract ? <em>{label(n)}</em> : label(n)}
                </div>
              ))}
            </div>
          ))}
          {workspace && (
            <div>
              <div className="group">Instances ({instances.length})</div>
              {instances.map(n => (
                <div key={n.id} className={`item${n.id === shown ? ' active' : ''}`} title={n.id}
                  onClick={() => { setShown(n.id); setSelected(n.id); }}>
                  {label(n)} <span className="type-hint">{typeName(workspace, n)}</span>
                </div>
              ))}
            </div>
          )}
          {!workspace && <div className="empty">No model open.</div>}
        </div>
        <div className="canvas">
          <div ref={canvasRef} />
          {workspace && !shown && <div className="hint">Pick a type on the left, or add one with +.</div>}
        </div>
        <div className="side right">
          {workspace && editor && selected && workspace.space.get(selected)
            ? <NodeEditor space={workspace.space} editor={editor} nodeKey={selected} run={run}
                onOpenType={key => { setShown(key); setSelected(key); }} onCreated={key => setSelected(key)}
                onInstance={key => { setShown(key); setSelected(key); }} />
            : <div className="empty">Select a node.</div>}
        </div>
      </div>
      {showFindings && (
        <div className="findings">
          {findings.length === 0 && <div className="empty">No findings.</div>}
          {findings.map((f, i) => (
            <div key={i} className={`finding ${f.severity}`} onClick={() => goTo(f)}>
              <span className="rule">{f.rule}</span> {f.message}
            </div>
          ))}
        </div>
      )}
      <div className={`status${status.warn ? ' warn' : ''}`}>{status.text}</div>
    </div>
  );
}

function typeName(ws: Workspace, n: UaNode): string {
  const t = ws.space.typeDefinition(n);
  return t ? '::' + label(t) : '';
}

function label(n: UaNode): string {
  return text(n.displayName) || n.browseName.name;
}
