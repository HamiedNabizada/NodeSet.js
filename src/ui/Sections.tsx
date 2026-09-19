// Panel sections for what has more structure than a field: method
// arguments, DataType fields, and references outside the hierarchy.
// Arguments and fields are edited as a draft and applied as one undo step.

import { useEffect, useMemo, useState } from 'react';
import { AddressSpace, REF } from '../nodeset/address-space';
import { ModelEditor } from '../nodeset/edit';
import { Argument, text, uaKey, UaNode } from '../nodeset/model';
import { TypePicker } from './NodeEditor';

type Run = (action: () => unknown) => void;

const VALUE_RANKS: [number, string][] = [[-1, 'Scalar'], [1, 'Array'], [-2, 'Any'], [0, 'Array (n dims)']];

export function ArgumentsSection({ space, editor, method, run }: { space: AddressSpace; editor: ModelEditor; method: UaNode; run: Run }) {
  return (
    <>
      <ArgumentList space={space} editor={editor} method={method} which="Input" run={run} />
      <ArgumentList space={space} editor={editor} method={method} which="Output" run={run} />
    </>
  );
}

function ArgumentList({ space, editor, method, which, run }: { space: AddressSpace; editor: ModelEditor; method: UaNode; which: 'Input' | 'Output'; run: Run }) {
  const current = useMemo(() => space.children(method)
    .find(c => c.node.browseName.name === `${which}Arguments`)?.node.arguments ?? [], [space, method, which]);
  const [draft, setDraft] = useState<Argument[]>(current);
  useEffect(() => setDraft(current), [current]);
  const changed = JSON.stringify(draft) !== JSON.stringify(current);
  const update = (i: number, patch: Partial<Argument>) => setDraft(d => d.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  return (
    <fieldset className="add">
      <legend>{which} arguments</legend>
      {draft.map((a, i) => (
        <div className="row item-row" key={i}>
          <input placeholder="Name" value={a.name} onChange={e => update(i, { name: e.target.value })} />
          <TypePicker space={space} nodeClass="DataType" value={a.dataType} onPick={k => update(i, { dataType: k })} />
          <select value={a.valueRank} onChange={e => update(i, { valueRank: Number(e.target.value) })}>
            {VALUE_RANKS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button title="Remove" onClick={() => setDraft(d => d.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="row">
        <button onClick={() => setDraft(d => [...d, { name: '', dataType: uaKey(12), valueRank: -1, arrayDimensions: [] }])}>+ Argument</button>
        {changed && <button onClick={() => run(() => editor.setArguments(method.id, which, draft))}>Apply</button>}
        {changed && <button onClick={() => setDraft(current)}>Discard</button>}
      </div>
    </fieldset>
  );
}

interface FieldDraft { name: string; dataType?: string; valueRank?: number; isOptional?: boolean; description?: string; value?: number }

export function FieldsSection({ space, editor, dataType, run }: { space: AddressSpace; editor: ModelEditor; dataType: UaNode; run: Run }) {
  const isEnum = space.isSubtypeOf(dataType.id, uaKey(29));
  const isStructure = space.isSubtypeOf(dataType.id, uaKey(22));
  const current = useMemo<FieldDraft[]>(() => (dataType.definition?.fields ?? []).map(f => ({
    name: f.name, dataType: f.dataType, valueRank: f.valueRank, isOptional: f.isOptional, description: text(f.description), value: f.value,
  })), [dataType]);
  const [draft, setDraft] = useState<FieldDraft[]>(current);
  useEffect(() => setDraft(current), [current]);
  if (!isEnum && !isStructure) return null;
  const changed = JSON.stringify(draft) !== JSON.stringify(current);
  const update = (i: number, patch: Partial<FieldDraft>) => setDraft(d => d.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <fieldset className="add">
      <legend>{isEnum ? 'Values' : 'Fields'}</legend>
      {draft.map((f, i) => (
        <div className={`row${isEnum ? '' : ' item-row'}`} key={i}>
          {isEnum && (
            <input className="value" type="number" step={1} value={f.value ?? i} title="Value"
              onChange={e => update(i, { value: e.target.value === '' ? undefined : Number(e.target.value) })} />
          )}
          <input placeholder="Name" value={f.name} onChange={e => update(i, { name: e.target.value })} />
          {!isEnum && (
            <>
              <TypePicker space={space} nodeClass="DataType" value={f.dataType} onPick={k => update(i, { dataType: k })} />
              <select value={f.valueRank ?? -1} onChange={e => update(i, { valueRank: Number(e.target.value) })}>
                {VALUE_RANKS.filter(([k]) => k === -1 || k === 1).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </>
          )}
          <button title="Remove" onClick={() => setDraft(d => d.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="row">
        <button onClick={() => setDraft(d => [...d, isEnum
          ? { name: '', value: d.length === 0 ? 0 : Math.max(...d.map((x, j) => x.value ?? j)) + 1 }
          : { name: '', dataType: uaKey(12), valueRank: -1 }])}>
          + {isEnum ? 'Value' : 'Field'}
        </button>
        {changed && <button onClick={() => run(() => editor.setFields(dataType.id, draft))}>Apply</button>}
        {changed && <button onClick={() => setDraft(current)}>Discard</button>}
      </div>
    </fieldset>
  );
}

/** References that are not part of the hierarchy, the type system or the modelling rules. */
const STRUCTURAL = new Set<string>([REF.HasTypeDefinition, REF.HasModellingRule, REF.HasSubtype, uaKey(38) /* HasEncoding */]);

export function ReferencesSection({ space, editor, node, run }: { space: AddressSpace; editor: ModelEditor; node: UaNode; run: Run }) {
  const refs = space.out(node.id).filter(e => !STRUCTURAL.has(e.type) && !space.isHierarchical(e.type));
  const [type, setType] = useState<string>();
  const [target, setTarget] = useState<string>();
  const name = (key: string) => { const n = space.get(key); return n ? text(n.displayName) || n.browseName.name : key; };
  const targets = useMemo(() => editor.file.nodes
    .filter(n => n.id !== node.id)
    .map(n => ({ key: n.id, label: pathOf(space, n) }))
    .sort((a, b) => a.label.localeCompare(b.label)), [space, editor.file, node.id]);

  return (
    <fieldset className="add">
      <legend>References</legend>
      {refs.length === 0 && <div className="note">None besides the hierarchy.</div>}
      {refs.map(e => (
        <div className="row ref" key={`${e.type}>${e.target}`}>
          <span><em>{name(e.type)}</em> → {name(e.target)}</span>
          <button title="Remove" onClick={() => run(() => editor.removeReference(node.id, e.type, e.target))}>×</button>
        </div>
      ))}
      <TypePicker space={space} nodeClass="ReferenceType" value={type} onPick={setType} placeholder="ReferenceType …" />
      <div className="row">
        <select value={target ?? ''} onChange={e => setTarget(e.target.value || undefined)}>
          <option value="">Target …</option>
          {targets.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <button disabled={!type || !target} onClick={() => run(() => editor.addReference(node.id, type!, target!))}>Add</button>
      </div>
    </fieldset>
  );
}

/** Creates an instance of a type: a name and the Optional declarations to include. */
export function InstantiateSection({ editor, type, run, onCreated }: { editor: ModelEditor; type: UaNode; run: Run; onCreated: (key: string) => void }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const optional = useMemo(() => editor.optionalPaths(type.id), [editor, type]);
  const create = () => run(() => {
    const key = editor.instantiate(type.id, name, { optional: p => picked.has(p) });
    setName('');
    onCreated(key);
  });
  return (
    <fieldset className="add">
      <legend>Create instance</legend>
      {optional.length > 0 && <div className="note">Optional children to include:</div>}
      {optional.map(p => (
        <label key={p} className="check">
          <input type="checkbox" checked={picked.has(p)}
            onChange={e => setPicked(s => { const n = new Set(s); if (e.target.checked) n.add(p); else n.delete(p); return n; })} />
          {p}
        </label>
      ))}
      <div className="row">
        <input placeholder="Name of the instance" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) create(); }} />
        <button disabled={!name.trim() || !!type.isAbstract} title={type.isAbstract ? 'Abstract types have no instances.' : undefined} onClick={create}>Create</button>
      </div>
    </fieldset>
  );
}

/** "PumpType/Motor/Speed": the node's name after those of the nodes that hold it. */
function pathOf(space: AddressSpace, n: UaNode): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (let p: UaNode | undefined = n; p && !seen.has(p.id) && parts.length < 6; p = space.parentOf(p)) {
    seen.add(p.id);
    parts.unshift(text(p.displayName) || p.browseName.name);
  }
  return parts.join('/');
}
