import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UaModeler } from '../modeler/Modeler';
import { NodeClass, text, UaNode } from '../nodeset/model';
import { Workspace } from '../workspace';
import { NodeDetails } from './NodeDetails';

const TYPE_GROUPS: { nodeClass: NodeClass; title: string }[] = [
  { nodeClass: 'ObjectType', title: 'ObjectTypes' },
  { nodeClass: 'VariableType', title: 'VariableTypes' },
  { nodeClass: 'DataType', title: 'DataTypes' },
  { nodeClass: 'ReferenceType', title: 'ReferenceTypes' },
];

export function App() {
  const [workspace, setWorkspace] = useState<Workspace>();
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<{ text: string; warn?: boolean }>({ text: 'Open a NodeSet2 file, or the DI sample.' });
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [showExternal, setShowExternal] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<UaModeler>();

  const open = useCallback(async (xml: string, name: string) => {
    setStatus({ text: `Reading ${name} …` });
    try {
      const ws = new Workspace();
      const { file, missing } = await ws.open(xml);
      setWorkspace(ws);
      setRevision(r => r + 1);
      setShown(undefined);
      setSelected(undefined);
      setStatus(missing.length > 0
        ? { text: `${name}: ${file.nodes.length} nodes. Missing required models: ${missing.join(', ')}.`, warn: true }
        : { text: `${name}: ${file.nodes.length} nodes of ${file.models.map(m => m.modelUri).join(', ')}.` });
    } catch (e) {
      setStatus({ text: `${name}: ${(e as Error).message}`, warn: true });
    }
  }, []);

  const openSample = useCallback(async () => {
    const di = await import(/* webpackChunkName: "nodeset-di" */ '../../assets/nodesets/Opc.Ua.Di.NodeSet2.xml');
    await open(di.default, 'Opc.Ua.Di.NodeSet2.xml');
  }, [open]);

  const openFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await open(await file.text(), file.name);
  }, [open]);

  const save = useCallback(() => {
    if (!workspace?.editable) return;
    const blob = new Blob([workspace.save()], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const model = workspace.editable.models[0]?.modelUri ?? 'Model';
    a.download = `${model.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '.').replace(/\.+$/, '')}.NodeSet2.xml`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [workspace]);

  // The canvas lives as long as the workspace.
  useEffect(() => {
    if (!workspace || !canvasRef.current) return;
    const modeler = new UaModeler(canvasRef.current, workspace.space);
    modeler.onSelect(setSelected);
    modeler.onOpen(key => {
      const node = workspace.space.get(key);
      if (node && node.nodeClass.endsWith('Type')) setShown(key);
    });
    modelerRef.current = modeler;
    return () => { modeler.destroy(); modelerRef.current = undefined; };
  }, [workspace]);

  useEffect(() => {
    if (!shown || !modelerRef.current) return;
    const d = modelerRef.current.showType(shown, { ownNamespaces: workspace?.ownNamespaces });
    modelerRef.current.fit();
    setSelected(shown);
    if (d.truncated) setStatus({ text: 'Deeper declarations are left out; double-click a type to open it.' });
  }, [shown, workspace, revision]);

  const types = useMemo(() => {
    if (!workspace) return [];
    const own = new Set(workspace.ownNamespaces);
    const needle = filter.trim().toLowerCase();
    return TYPE_GROUPS.map(g => ({
      ...g,
      nodes: workspace.space.ofClass(g.nodeClass)
        .filter(n => showExternal || own.has(n.browseName.namespaceUri))
        .filter(n => !needle || label(n).toLowerCase().includes(needle))
        .sort((a, b) => label(a).localeCompare(label(b))),
      own,
    })).filter(g => g.nodes.length > 0);
  }, [workspace, filter, showExternal, revision]);

  return (
    <div className="app">
      <div className="toolbar">
        <span className="title">OPC UA Modeler</span>
        <label className="button">Open NodeSet…<input type="file" accept=".xml" onChange={openFile} /></label>
        <button onClick={openSample}>Open DI sample</button>
        <button onClick={save} disabled={!workspace?.editable}>Save NodeSet</button>
        <label style={{ marginLeft: 'auto', fontSize: 13 }}>
          <input type="checkbox" checked={showExternal} onChange={e => setShowExternal(e.target.checked)} /> Types of required models
        </label>
      </div>
      <div className="main">
        <div className="side">
          <input className="filter" placeholder="Filter types" value={filter} onChange={e => setFilter(e.target.value)} />
          {types.map(g => (
            <div key={g.nodeClass}>
              <div className="group">{g.title} ({g.nodes.length})</div>
              {g.nodes.map(n => (
                <div
                  key={n.id}
                  className={`item${n.id === shown ? ' active' : ''}${g.own.has(n.browseName.namespaceUri) ? '' : ' external'}`}
                  title={n.id}
                  onClick={() => setShown(n.id)}
                >
                  {n.isAbstract ? <em>{label(n)}</em> : label(n)}
                </div>
              ))}
            </div>
          ))}
          {!workspace && <div className="empty">No model open.</div>}
        </div>
        <div className="canvas"><div ref={canvasRef} /></div>
        <div className="side right details">
          {workspace && selected ? <NodeDetails space={workspace.space} nodeKey={selected} /> : <div className="empty">Select a node.</div>}
        </div>
      </div>
      <div className={`status${status.warn ? ' warn' : ''}`}>{status.text}</div>
    </div>
  );
}

function label(n: UaNode): string {
  return text(n.displayName) || n.browseName.name;
}
