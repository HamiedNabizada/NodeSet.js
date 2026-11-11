import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeSetModeler } from '../modeler/Modeler';
import { RULE } from '../nodeset/address-space';
import { insideType } from '../nodeset/checks';
import { check, Finding, RULES } from '../nodeset/checks';
import { EditError } from '../nodeset/edit';
import { NodeClass, text, UaNode } from '../nodeset/model';
import { applyTheme, HostBridge, HostToModeler, savesAll } from '../host/bridge';
import { Workspace } from '../workspace';
import { Backup, browserStore, Draft } from './backup';
import { mayLeaveDrafts } from './drafts';
import { Checked, runChecks } from './findings';
import { Guard } from './Guard';
import { useIdle } from './idle';
import { topInstances } from './instances';
import { t, translate } from './i18n';
import { Ask, AskDialog } from './AskDialog';
import { ModelPanel } from './ModelPanel';
import { NodeEditor } from './NodeEditor';

const TYPE_GROUPS: { nodeClass: 'ObjectType' | 'VariableType' | 'DataType' | 'ReferenceType'; title: string }[] = [
  { nodeClass: 'ObjectType', title: 'ObjectTypes' },
  { nodeClass: 'VariableType', title: 'VariableTypes' },
  { nodeClass: 'DataType', title: 'DataTypes' },
  { nodeClass: 'ReferenceType', title: 'ReferenceTypes' },
];

type Status = { text: string; warn?: boolean };

/** Told to the host in "ready". */
const VERSION = '0.2.0';

/** What is open, kept outside the modeler so that a failure of the modeler does not take it along. */
interface Kept {
  workspace?: Workspace;
  dirty: boolean;
  /** Counts the changes; "apply" and "save" tell the host the last one, and its reply names the one it took. */
  change: number;
}

/** What the modeler receives from outside while it lives; kept for it while it has failed. */
interface Inbox {
  /** The modeler's handler of host messages, while it is there. */
  host?: (message: HostToModeler) => void;
  /** An "open" or "new" of the host that came while the modeler had failed. */
  pending?: HostToModeler;
  /** The modeler's status line, while it is there. */
  report?: (message: string) => void;
  /** A failure of the backup that came while the modeler had failed. */
  missed?: string;
}

/** The file name a model is saved under. */
function fileName(workspace: Workspace): string {
  const model = workspace.editable?.models[0]?.modelUri ?? 'Model';
  return `${model.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '.').replace(/\.+$/, '')}.NodeSet2.xml`;
}

/** Saves the model: through the host's save dialog when there is a host, else as a download. */
function saveModel(workspace: Workspace, host: HostBridge | undefined, change: number): string {
  const name = fileName(workspace);
  if (host) {
    host.post({ type: 'save', xml: workspace.save(), name, change });
    return name;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([workspace.save()], { type: 'application/xml' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  return name;
}

/**
 * The complete modeler. If it fails while drawing, the model stays: the
 * message offers to save it and to start the modeler again with it.
 */
export function App() {
  const kept = useRef<Kept>({ dirty: false, change: 0 });
  // Inside the AutomationML Editor plugin (WebView2) the host opens models and takes them back.
  const host = useMemo(() => HostBridge.detect(), []);
  const [dirty, setDirty] = useState(false);
  const inbox = useRef<Inbox>({});
  const backup = useMemo(() => {
    const store = host ? undefined : browserStore();
    return store && new Backup(store, {
      onFailure: message => { if (inbox.current.report) inbox.current.report(message); else inbox.current.missed = message; },
    });
  }, [host]);

  // The host is heard here, not in the modeler, so nothing it sends is lost
  // while the modeler shows a failure. "ready" follows the modeler's own
  // listening: a child's effects run before its parent's.
  useEffect(() => {
    if (!host) return;
    const stop = host.listen(message => {
      if (message.type === 'theme') applyTheme(message.dark);
      else if (inbox.current.host) inbox.current.host(message);
      else if (message.type === 'open' || message.type === 'new') inbox.current.pending = message;
      else if (savesAll(message, kept.current.change)) {
        kept.current = { ...kept.current, dirty: false };
        setDirty(false);
      }
    });
    host.post({ type: 'ready', version: VERSION });
    return stop;
  }, [host]);

  useEffect(() => { host?.post({ type: 'dirty', dirty }); }, [host, dirty]);

  // A draft still waiting is written when the page goes away, as far as the browser lets it.
  useEffect(() => {
    if (!backup) return;
    const onHide = () => { backup.flush(); };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [backup]);

  // On its own in a browser, closing or reloading the page asks while changes are unsaved.
  useEffect(() => {
    if (host || !dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [host, dirty]);

  const rescue = () => {
    const workspace = kept.current.workspace;
    if (!workspace?.editable) return null;
    return <button onClick={() => saveModel(workspace, host, kept.current.change)}>{t('Save NodeSet')}</button>;
  };

  return (
    <Guard name={t('The modeler')} actions={rescue}>
      <Modeler kept={kept} host={host} onDirty={setDirty} backup={backup} inbox={inbox} />
    </Guard>
  );
}

interface ModelerProps {
  kept: MutableRefObject<Kept>;
  host: HostBridge | undefined;
  onDirty: (dirty: boolean) => void;
  /** Keeps unsaved work in the browser; none inside a host. */
  backup?: Backup;
  inbox: MutableRefObject<Inbox>;
}

function Modeler({ kept, host, onDirty, backup, inbox }: ModelerProps) {
  // Started again after a failure, the modeler goes on with what was open.
  const [workspace, setWorkspace] = useState<Workspace | undefined>(kept.current.workspace);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<Status>(kept.current.workspace
    ? { text: t('The modeler was started again after an error; the model is as it was.'), warn: true }
    : { text: t('Start a new model, open a NodeSet2 file, or open the DI sample.') });
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [showExternal, setShowExternal] = useState(false);
  const [showFindings, setShowFindings] = useState(false);
  const [newModelUri, setNewModelUri] = useState<string>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<NodeSetModeler>();
  const fittedFor = useRef<string>();
  // The redraw reads the selection without redrawing when only the selection changes.
  const selectedRef = useRef<string>();
  selectedRef.current = selected;
  const [dirty, setDirty] = useState(kept.current.dirty);
  const [ask, setAsk] = useState<Ask>();
  // Unsaved work another page left in the browser.
  const [offer, setOffer] = useState<Draft>();
  // The canvas outlives renders; it reaches the current edit function through a ref.
  const runRef = useRef<(action: () => unknown) => void>(() => undefined);
  const lastReferenceType = useRef('Organizes');
  // Where shapes stand changes no node: the diagram is drawn anew, the checks and the lists stay.
  const [layoutRevision, setLayoutRevision] = useState(0);
  const bump = useCallback(() => setRevision(r => r + 1), []);
  const unsaved = useCallback(() => {
    setDirty(true);
    // At once, not after the next render: that render may be the one that fails.
    kept.current = { ...kept.current, dirty: true, change: kept.current.change + 1 };
    onDirty(true);
  }, [kept, onDirty]);
  const changed = useCallback(() => {
    setRevision(r => r + 1);
    unsaved();
  }, [unsaved]);
  const layoutChanged = useCallback(() => {
    setLayoutRevision(r => r + 1);
    unsaved();
  }, [unsaved]);

  /** Opens or starts a model; false when that failed, which the status line then says. */
  const start = useCallback(async (action: (ws: Workspace) => Promise<unknown>, name: string, required: string[] = []) => {
    setStatus({ text: t('Reading {0} …', name) });
    try {
      const ws = new Workspace();
      await action(ws);
      for (const xml of required) await ws.addRequired(xml);
      const missing = ws.missing;
      kept.current = { ...kept.current, workspace: ws, dirty: false };
      setWorkspace(ws);
      setDirty(false);
      setShown(undefined);
      setSelected(undefined);
      fittedFor.current = undefined;
      bump();
      const file = ws.editable!;
      setStatus(missing.length > 0
        ? { text: t('{0}: missing required models: {1}.', name, missing.join(', ')), warn: true }
        : { text: t('{0}: {1}', name, t('{0} nodes of {1}.', file.nodes.length, file.models.map(m => m.modelUri).join(', '))) });
      return true;
    } catch (e) {
      setStatus({ text: t('{0}: {1}', name, translate(e as Error)), warn: true });
      return false;
    }
  }, [bump, kept]);

  /** True when nothing unsaved would be lost, or the user agrees to lose it. */
  const mayDiscard = useCallback(
    () => (!dirty || window.confirm(t('The model has changes that are not saved. Discard them?'))) && mayLeaveDrafts(),
    [dirty]);

  const openFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && mayDiscard()) {
      const xml = await file.text();
      await start(ws => ws.open(xml), file.name);
    }
  }, [start, mayDiscard]);

  // A draft that does not open stays, and stays offered; the status line says why.
  const restore = useCallback(async (draft: Draft) => {
    if (!mayDiscard()) return;
    setOffer(undefined);
    if (!await start(ws => ws.open(draft.xml), draft.title, draft.required)) {
      setOffer(draft);
      return;
    }
    setDirty(true);
    await backup?.adopt(draft);
  }, [start, mayDiscard, backup]);

  const discard = useCallback((draft: Draft) => {
    setOffer(undefined);
    backup?.forget(draft.id);
  }, [backup]);

  const openSample = useCallback(async () => {
    if (!mayDiscard()) return;
    const di = await import(/* webpackChunkName: "nodeset-di" */ '../../assets/nodesets/Opc.Ua.Di.NodeSet2.xml');
    await start(ws => ws.open(di.default), 'Opc.Ua.Di.NodeSet2.xml');
  }, [start, mayDiscard]);

  const createModel = useCallback(async () => {
    const uri = newModelUri?.trim();
    if (!uri || !mayDiscard()) return;
    setNewModelUri(undefined);
    await start(ws => ws.create(uri), uri);
  }, [newModelUri, start, mayDiscard]);

  /** Runs an edit; an EditError becomes the status line instead of an exception. */
  const run = useCallback((action: () => unknown) => {
    try {
      action();
      changed();
      setStatus({ text: t('Changed. Save to keep the NodeSet.') });
    } catch (e) {
      if (e instanceof EditError) setStatus({ text: translate(e), warn: true });
      else throw e;
    }
  }, [changed]);

  runRef.current = run;

  // Only a step that happened changes the model.
  const undo = useCallback(() => {
    if (!workspace?.editor?.canUndo) return;
    workspace.editor.undo();
    changed();
  }, [workspace, changed]);
  const redo = useCallback(() => {
    if (!workspace?.editor?.canRedo) return;
    workspace.editor.redo();
    changed();
  }, [workspace, changed]);

  /** Another node, once its unapplied drafts may go; staying on the node asks nothing. */
  const select = useCallback((key: string | undefined, show?: string) => {
    if (key !== selectedRef.current && !mayLeaveDrafts()) return;
    if (show !== undefined) setShown(show);
    setSelected(key);
  }, []);

  // The model counts as unchanged once the host reports it imported ("applied"), unless it was changed meanwhile.
  const apply = useCallback(() => {
    if (!host || !workspace?.editable || !mayLeaveDrafts()) return;
    host.post({ type: 'apply', xml: workspace.save(), modelUri: workspace.editable.models[0]?.modelUri ?? '', change: kept.current.change });
    setStatus({ text: t('Applying to the document …') });
  }, [host, workspace, kept]);

  // Messages from the host, through App; one that came while the modeler had failed comes first.
  useEffect(() => {
    if (!host) return;
    const handle = (m: HostToModeler) => {
      if (m.type === 'open') start(ws => ws.open(m.xml), m.name, m.required);
      if (m.type === 'new') start(ws => ws.create(m.modelUri), m.modelUri, m.required);
      if (m.type === 'applied' || m.type === 'saved') {
        const all = savesAll(m, kept.current.change);
        if (all) setDirty(false);
        const later = m.type === 'applied' ? t('{0} Changes made since then are not applied yet.', m.text) : t('{0} Changes made since then are not saved yet.', m.text);
        setStatus({ text: m.ok && !all ? later : m.text, warn: !m.ok });
      }
    };
    const box = inbox.current;
    box.host = handle;
    if (box.pending) {
      handle(box.pending);
      box.pending = undefined;
    }
    return () => { box.host = undefined; };
  }, [host, start, inbox, kept]);

  useEffect(() => {
    kept.current = { ...kept.current, workspace, dirty };
    onDirty(dirty);
  }, [kept, workspace, dirty, onDirty]);

  useEffect(() => {
    const box = inbox.current;
    box.report = text => setStatus({ text, warn: true });
    if (box.missed) {
      box.report(box.missed);
      box.missed = undefined;
    }
    return () => { box.report = undefined; };
  }, [inbox]);

  // Unsaved, the model is kept once editing pauses; saved, its draft goes at once.
  useEffect(() => {
    if (!backup) return;
    if (dirty && workspace?.editable) {
      backup.keep(() => ({ title: workspace.editable!.models[0]?.modelUri ?? 'Model', xml: workspace.snapshot(), required: workspace.addedFiles }));
    } else {
      backup.clear();
    }
  }, [backup, workspace, dirty, revision, layoutRevision]);

  useEffect(() => {
    if (!backup || kept.current.workspace) return;
    backup.offered().then(drafts => setOffer(drafts[0]), () => undefined);
  }, [backup, kept]);
  useEffect(() => { host?.post({ type: 'status', text: status.text, warn: status.warn }); }, [host, status]);

  const save = useCallback(() => {
    if (!workspace?.editable || !mayLeaveDrafts()) return;
    // Inside a desktop host a save dialog of the host, which answers "saved".
    const name = saveModel(workspace, host, kept.current.change);
    if (host) return;
    setDirty(false);
    setStatus({ text: t('Saved {0}.', name) });
  }, [workspace, host, kept]);

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
    const modeler = new NodeSetModeler(canvasRef.current, () => workspace.space, {
      isOwn: key => workspace.editor?.owns(key) ?? false,
      canHoldChildren: key => ['ObjectType', 'VariableType', 'Object', 'Variable'].includes(workspace.space.get(key)?.nodeClass ?? ''),
      addChild: (key, kind) => setAsk({
        title: t('Name of the new {0}', kind),
        onOk: name => runRef.current(() => {
          const parent = workspace.space.get(key)!;
          const declaration = parent.nodeClass.endsWith('Type') || insideType(workspace.space, parent);
          select(workspace.editor!.addDeclaration(key, kind, name, declaration ? RULE.Mandatory : undefined));
        }),
      }),
      addReference: (source, target) => setAsk({
        title: t('ReferenceType of the new reference'),
        value: lastReferenceType.current,
        options: referenceTypeNames(workspace),
        check: name => (findReferenceType(workspace, name) ? undefined : t("There is no ReferenceType named '{0}'.", name)),
        onOk: name => {
          lastReferenceType.current = name;
          runRef.current(() => workspace.editor!.addReference(source, findReferenceType(workspace, name)!, target));
        },
      }),
      remove: key => runRef.current(() => workspace.editor!.delete(key)),
    });
    // A redraw selects the selected node again; that is no step to another node.
    modeler.onSelect(key => { if (key && key !== selectedRef.current) select(key); });
    modeler.onOpen(key => {
      if (!mayLeaveDrafts()) return;
      const node = workspace.space.get(key);
      if (node?.nodeClass.endsWith('Type')) setShown(key);
      else { const t = node && workspace.space.typeDefinition(node); if (t) setShown(t.id); }
    });
    modeler.onMoved(moved => {
      const diagram = modeler.current?.root;
      if (!diagram) return;
      for (const m of moved) workspace.place(diagram, m.nodeKey, m.x, m.y);
      layoutChanged();
    });
    modelerRef.current = modeler;
    return () => { modeler.destroy(); modelerRef.current = undefined; };
  }, [workspace, layoutChanged, select]);

  // Redraw after every change, of the model or of where shapes stand (diagram-js
  // would leave the lines of a moved shape straight); fit only when another type is shown.
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
      if (d.truncated) setStatus({ text: t('Deeper declarations are left out; double-click a node to open its type.') });
    }
    modeler.select(selectedRef.current);
  }, [shown, workspace, revision, layoutRevision]);

  useEffect(() => { modelerRef.current?.select(selected); }, [selected]);

  // The checks run once the page is idle after a change of the model, not in
  // the render that shows the change; they take seconds on a large model.
  const checksFor = useMemo(() => ({ workspace, revision }), [workspace, revision]);
  const checked = useIdle<Checked>(
    () => (checksFor.workspace?.editable ? runChecks(() => check(checksFor.workspace!.space, checksFor.workspace!.editable!)) : { findings: [] }),
    checksFor, { findings: [] });
  const { findings } = checked;

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

  // Instances of the model: those in the Objects folder and those below a node of another model, such as DeviceSet.
  const instances = useMemo(() => {
    if (!workspace?.editable) return [];
    const needle = filter.trim().toLowerCase();
    return topInstances(workspace.space, workspace.editable)
      .filter(n => !needle || label(n).toLowerCase().includes(needle))
      .sort((a, b) => label(a).localeCompare(label(b)));
  }, [workspace, filter, revision]);

  const addType = (nodeClass: typeof TYPE_GROUPS[number]['nodeClass']) => {
    if (!workspace?.editor) return;
    setAsk({
      title: t('Name of the new {0}', nodeClass),
      onOk: name => run(() => {
        const key = workspace.editor!.addType(nodeClass, name);
        select(key, key);
      }),
    });
  };

  const addStateMachine = () => {
    if (!workspace?.editor) return;
    setAsk({
      title: t('Name of the new state machine type'),
      onOk: name => run(() => {
        const key = workspace.editor!.addStateMachineType(name);
        select(key, key);
      }),
    });
  };

  const goTo = (f: Finding) => {
    if (!workspace) return;
    let owner = workspace.space.get(f.node);
    for (let i = 0; owner && !owner.nodeClass.endsWith('Type') && i < 50; i++) owner = workspace.space.parentOf(owner);
    select(f.node, owner?.id);
  };

  const editor = workspace?.editor;
  const errors = findings.filter(f => f.severity === 'error').length;

  return (
    <div className="app">
      <div className="toolbar">
        {!host && <span className="title">NodeSet.js</span>}
        {/* Inside the plugin, its own toolbar opens and starts models: they need its NodeSet folders. */}
        {host ? null : newModelUri === undefined
          ? <button onClick={() => setNewModelUri('http://example.org/MyModel/')}>{t('New model…')}</button>
          : (
            <span className="inline-form">
              <input autoFocus size={36} value={newModelUri} onChange={e => setNewModelUri(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createModel(); if (e.key === 'Escape') setNewModelUri(undefined); }} />
              <button onClick={createModel}>{t('Create')}</button>
              <button onClick={() => setNewModelUri(undefined)}>{t('Cancel')}</button>
            </span>
          )}
        {!host && <label className="button">{t('Open NodeSet…')}<input type="file" accept=".xml" onChange={openFile} /></label>}
        {!host && <button onClick={openSample}>{t('Open DI sample')}</button>}
        {host && <button className="primary" onClick={apply} disabled={!workspace?.editable}>{t('Apply to document')}</button>}
        <button onClick={save} disabled={!workspace?.editable}>{t('Save NodeSet')}{dirty ? ' *' : ''}</button>
        <span className="sep" />
        <button onClick={undo} disabled={!editor?.canUndo} title="Ctrl+Z">{t('Undo')}</button>
        <button onClick={redo} disabled={!editor?.canRedo} title="Ctrl+Y">{t('Redo')}</button>
        {shown && <button onClick={() => { workspace?.resetLayout(shown); layoutChanged(); }}>{t('Reset layout')}</button>}
        <button disabled={!workspace?.editable} onClick={() => select(undefined)} title={t('Version, date and the models in use')}>{t('Model')}</button>
        <span className="sep" />
        <button className={errors > 0 || checked.error ? 'warn' : ''} disabled={!workspace} onClick={() => setShowFindings(s => !s)}>
          {checked.error ? t('Checks failed') : t('Checks: {0} error(s), {1} warning(s)', errors, findings.length - errors)}
        </button>
        <label style={{ marginLeft: 'auto', fontSize: 13 }}>
          <input type="checkbox" checked={showExternal} onChange={e => setShowExternal(e.target.checked)} /> {t('Types of required models')}
        </label>
      </div>
      {offer && (
        <div className="offer" role="status">
          <span>{t('An unsaved model from {0} is kept in this browser:', new Date(offer.savedAt).toLocaleString())} <span className="mono">{offer.title}</span></span>
          <button onClick={() => restore(offer)}>{t('Restore')}</button>
          <button onClick={() => discard(offer)}>{t('Discard')}</button>
        </div>
      )}
      <div className="main">
        <div className="side">
          <input className="filter" placeholder={t('Filter types')} value={filter} onChange={e => setFilter(e.target.value)} />
          {types.map(g => (
            <div key={g.nodeClass}>
              <div className="group">
                {g.title} ({g.nodes.length})
                {editor && g.nodeClass === 'ObjectType' && (
                  <button className="add-type" title={t('New state machine type (OPC 10000-5 Annex B)')} onClick={addStateMachine}>{t('+ machine')}</button>
                )}
                {editor && <button className="add-type" title={t('New {0}', g.nodeClass)} onClick={() => addType(g.nodeClass)}>+</button>}
              </div>
              {g.nodes.map(n => (
                <div
                  key={n.id}
                  className={`item${n.id === shown ? ' active' : ''}${g.own.has(n.browseName.namespaceUri) ? '' : ' external'}`}
                  title={n.id}
                  role="button" tabIndex={0}
                  onClick={() => select(n.id, n.id)} onKeyDown={e => onActivate(e, () => select(n.id, n.id))}
                >
                  {n.isAbstract ? <em>{label(n)}</em> : label(n)}
                </div>
              ))}
            </div>
          ))}
          {workspace && (
            <div>
              <div className="group">{t('Instances')} ({instances.length})</div>
              {instances.map(n => (
                <div key={n.id} className={`item${n.id === shown ? ' active' : ''}`} title={n.id} role="button" tabIndex={0}
                  onClick={() => select(n.id, n.id)} onKeyDown={e => onActivate(e, () => select(n.id, n.id))}>
                  {label(n)} <span className="type-hint">{typeName(workspace, n)}</span>
                </div>
              ))}
            </div>
          )}
          {!workspace && <div className="empty">{t('No model open.')}</div>}
        </div>
        <div className="canvas">
          <div ref={canvasRef} />
          {workspace && !shown && <div className="hint">{t('Pick a type on the left, or add one with +.')}</div>}
        </div>
        <div className="side right">
          <Guard name={t('The node editor')} resetKey={selected}>
            {workspace && editor && selected && workspace.space.get(selected)
              // A node of its own: nothing typed into the panel of one node reaches the next.
              ? <NodeEditor key={selected} space={workspace.space} editor={editor} nodeKey={selected} run={run}
                  onOpenType={key => select(key, key)} onCreated={key => select(key)}
                  onInstance={key => select(key, key)} />
              : workspace?.editable
                ? <ModelPanel workspace={workspace} run={run} onLoaded={(text, warn) => { bump(); setStatus({ text, warn }); }} />
                : <div className="empty">{t('Select a node.')}</div>}
          </Guard>
        </div>
      </div>
      {showFindings && (
        <Guard name={t('The list of findings')} resetKey={revision}>
          <div className="findings">
            {checked.error && <div className="finding error" role="alert">{checked.error}</div>}
            {!checked.error && findings.length === 0 && <div className="empty">{t('No findings.')}</div>}
            {findings.map((f, i) => (
              <div key={i} className={`finding ${f.severity}`} role="button" tabIndex={0}
                onClick={() => goTo(f)} onKeyDown={e => onActivate(e, () => goTo(f))}>
                <span className="severity">{f.severity === 'error' ? t('error') : t('warning')}</span> <span className="rule" title={t(RULES[f.rule])}>{f.rule}</span> {translate(f)}
              </div>
            ))}
          </div>
        </Guard>
      )}
      <div className={`status${status.warn ? ' warn' : ''}`}>{status.text}</div>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(undefined)} />}
    </div>
  );
}

/** Enter or Space on a list entry does what a click does. */
function onActivate(e: React.KeyboardEvent, action: () => void): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  action();
}

/** The names of the ReferenceTypes a new reference may have: the concrete ones. */
function referenceTypeNames(ws: Workspace): string[] {
  return [...new Set(ws.space.ofClass('ReferenceType').filter(n => !n.isAbstract).map(n => n.browseName.name))]
    .sort((a, b) => a.localeCompare(b));
}

/** A ReferenceType by name, preferring the edited model's own. */
function findReferenceType(ws: Workspace, name: string): string | undefined {
  const matches = ws.space.ofClass('ReferenceType').filter(n => n.browseName.name === name || text(n.displayName) === name);
  return (matches.find(n => ws.editor?.owns(n.id)) ?? matches[0])?.id;
}

function typeName(ws: Workspace, n: UaNode): string {
  const t = ws.space.typeDefinition(n);
  return t ? '::' + label(t) : '';
}

function label(n: UaNode): string {
  return text(n.displayName) || n.browseName.name;
}
