// Panel sections for what has more structure than a field: method
// arguments, DataType fields, structure values, and references outside the
// hierarchy. Arguments, fields and structure values are edited as a draft
// and applied as one undo step.

import { useEffect, useMemo, useState } from 'react';
import { AddressSpace, REF } from '../nodeset/address-space';
import { fieldKind, FieldKind, ModelEditor } from '../nodeset/edit';
import { Argument, text, uaKey, UaNode } from '../nodeset/model';
import { emptyField, emptyStructure, FieldShape, FieldValue, StructShape, structShape, StructValue } from '../nodeset/structures';
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
  // Reset the draft when the model changes, not when a failed change rebuilt the same content.
  const currentKey = JSON.stringify(current);
  useEffect(() => setDraft(current), [currentKey]);
  const changed = JSON.stringify(draft) !== currentKey;
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

/** Fields compared by content, whatever order their properties were set in. */
function fieldsKey(fields: FieldDraft[]): string {
  return JSON.stringify(fields.map(f => [f.name, f.dataType, f.valueRank ?? -1, !!f.isOptional, f.description ?? '', f.value]));
}

const FIELD_LEGENDS: Record<FieldKind, [string, string]> = {
  enumeration: ['Values', 'Value'],
  optionSet: ['Options (bit numbers)', 'Option'],
  union: ['Fields (exactly one is set)', 'Field'],
  structure: ['Fields', 'Field'],
};

export function FieldsSection({ space, editor, dataType, run }: { space: AddressSpace; editor: ModelEditor; dataType: UaNode; run: Run }) {
  const kind = fieldKind(space, dataType.id);
  const isEnum = kind === 'enumeration' || kind === 'optionSet';
  const current = useMemo<FieldDraft[]>(() => (dataType.definition?.fields ?? []).map(f => ({
    name: f.name, dataType: f.dataType, valueRank: f.valueRank, isOptional: f.isOptional, description: text(f.description), value: f.value,
  })), [dataType, dataType.definition]);
  const [draft, setDraft] = useState<FieldDraft[]>(current);
  const currentKey = fieldsKey(current);
  useEffect(() => setDraft(current), [currentKey]);
  if (!kind) return null;
  const [legend, noun] = FIELD_LEGENDS[kind];
  const changed = fieldsKey(draft) !== currentKey;
  const update = (i: number, patch: Partial<FieldDraft>) => setDraft(d => d.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <fieldset className="add">
      <legend>{legend}</legend>
      {draft.map((f, i) => (
        <div className={`row${isEnum ? '' : ' item-row'}`} key={i}>
          {isEnum && (
            <input className="value" type="number" step={1} min={kind === 'optionSet' ? 0 : undefined} value={f.value ?? i} title={kind === 'optionSet' ? 'Bit' : 'Value'}
              onChange={e => update(i, { value: e.target.value === '' ? undefined : Number(e.target.value) })} />
          )}
          <input placeholder="Name" value={f.name} onChange={e => update(i, { name: e.target.value })} />
          {!isEnum && (
            <>
              <TypePicker space={space} nodeClass="DataType" value={f.dataType} onPick={k => update(i, { dataType: k })} />
              <select value={f.valueRank ?? -1} onChange={e => update(i, { valueRank: Number(e.target.value) })}>
                {VALUE_RANKS.filter(([k]) => k === -1 || k === 1).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {kind === 'structure' && (
                <label className="check" title="The field may be absent from a value (StructureWithOptionalFields).">
                  <input type="checkbox" checked={!!f.isOptional} onChange={e => update(i, { isOptional: e.target.checked || undefined })} />
                  optional
                </label>
              )}
            </>
          )}
          <button title="Remove" onClick={() => setDraft(d => d.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="row">
        <button onClick={() => setDraft(d => [...d, isEnum
          ? { name: '', description: '', value: d.length === 0 ? 0 : Math.max(...d.map((x, j) => x.value ?? j)) + 1 }
          : { name: '', dataType: uaKey(12), valueRank: -1, description: '' }])}>
          + {noun}
        </button>
        {changed && <button onClick={() => run(() => editor.setFields(dataType.id, draft))}>Apply</button>}
        {changed && <button onClick={() => setDraft(current)}>Discard</button>}
      </div>
    </fieldset>
  );
}

/** A single structure value, one input per field; arrays as elements separated by ";". */
export function StructureValueSection({ space, editor, node, shape, current, own, run }: {
  space: AddressSpace; editor: ModelEditor; node: UaNode; shape: StructShape;
  current: { list: boolean; items: StructValue[] } | undefined; own: boolean; run: Run;
}) {
  const list = (node.valueRank ?? -1) >= 0;
  const fresh = useMemo(() => (list ? [] : [emptyStructure(space, shape.key)]), [space, shape.key, list]);
  // The parsed value is a new object on every render; compare it by content.
  const currentJson = JSON.stringify(current?.items ?? fresh);
  const [draft, setDraft] = useState<StructValue[]>(JSON.parse(currentJson));
  useEffect(() => setDraft(JSON.parse(currentJson)), [currentJson]);
  const changed = JSON.stringify(draft) !== currentJson;
  const set = (i: number, v: StructValue) => setDraft(d => d.map((x, j) => (j === i ? v : x)));

  return (
    <fieldset className="add">
      <legend>Value ({shape.element}{list ? ', array' : ''})</legend>
      {!current && <div className="note">No value yet.</div>}
      {draft.map((item, i) => (
        <div key={i} className={list ? 'struct-item' : undefined}>
          {list && (
            <div className="struct-head">
              <span>[{i}]</span>
              {own && <button onClick={() => setDraft(d => d.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          )}
          <StructFields space={space} shapeKey={shape.key} value={item} onChange={v => set(i, v)} disabled={!own} depth={0} />
        </div>
      ))}
      {own && list && <div className="row"><button onClick={() => setDraft(d => [...d, emptyStructure(space, shape.key)])}>Add item</button></div>}
      {own && (
        <div className="row">
          {changed && <button onClick={() => run(() => editor.setStructureValue(node.id, draft))}>Apply</button>}
          {changed && <button onClick={() => setDraft(JSON.parse(currentJson))}>Discard</button>}
          {current && !changed && <button onClick={() => run(() => editor.setStructureValue(node.id, undefined))}>Remove value</button>}
        </div>
      )}
    </fieldset>
  );
}

/**
 * The fields of one structure value. A union shows which field is set and
 * that field; an optional field is included or left out with its box.
 */
function StructFields({ space, shapeKey, value, onChange, disabled, depth }: {
  space: AddressSpace; shapeKey: string; value: StructValue; onChange: (v: StructValue) => void; disabled: boolean; depth: number;
}) {
  const shape = useMemo(() => structShape(space, shapeKey), [space, shapeKey]);
  if (!shape) return <div className="note">Not edited here.</div>;
  const setField = (name: string, v: FieldValue | undefined) => onChange({ ...value, [name]: v });

  if (shape.union) {
    const chosen = shape.fields.find(f => value[f.name] !== undefined);
    return (
      <div className="struct-fields">
        <div className="row struct-row">
          <span>set field</span>
          <select value={chosen?.name ?? ''} disabled={disabled}
            onChange={e => {
              const f = shape.fields.find(x => x.name === e.target.value);
              onChange(f ? { [f.name]: emptyField(space, f, depth) } : {});
            }}>
            <option value="">(none)</option>
            {shape.fields.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
        </div>
        {chosen && <FieldEditor space={space} field={chosen} value={value[chosen.name]!} onChange={v => setField(chosen.name, v)} disabled={disabled} depth={depth} />}
      </div>
    );
  }

  return (
    <div className="struct-fields">
      {shape.fields.map(f => {
        const v = value[f.name];
        if (f.optional && v === undefined) {
          return (
            <div className="row struct-row" key={f.name}>
              <span title={typeTitle(space, f)}>{f.name}</span>
              <label className="struct-optional">
                <input type="checkbox" checked={false} disabled={disabled} onChange={() => setField(f.name, emptyField(space, f, depth))} /> optional, not set
              </label>
            </div>
          );
        }
        return (
          <div key={f.name}>
            <FieldEditor space={space} field={f} value={v ?? emptyField(space, f, depth)} onChange={x => setField(f.name, x)} disabled={disabled} depth={depth}
              onClear={f.optional ? () => setField(f.name, undefined) : undefined} />
          </div>
        );
      })}
    </div>
  );
}

function typeTitle(space: AddressSpace, f: FieldShape): string {
  const type = f.kind === 'builtIn' ? f.builtIn! : space.get(f.dataType)?.browseName.name ?? '';
  return `${type}${f.array ? '[]' : ''}${f.optional ? ', optional' : ''}`;
}

/** One field: a text for built-in values, a list for enumerations, nested fields for structures; arrays of each. */
function FieldEditor({ space, field: f, value, onChange, disabled, depth, onClear }: {
  space: AddressSpace; field: FieldShape; value: FieldValue; onChange: (v: FieldValue) => void; disabled: boolean; depth: number;
  /** An optional field: leave it out again. */
  onClear?: () => void;
}) {
  const label = (
    <span title={typeTitle(space, f)}>
      {onClear && <input type="checkbox" checked disabled={disabled} onChange={onClear} title="Leave this optional field out" />}
      {f.name}
    </span>
  );

  if (f.kind === 'builtIn') {
    return (
      <div className="row struct-row">
        {label}
        <input value={value as string} disabled={disabled} placeholder={f.array ? `${f.builtIn}; …` : f.builtIn}
          onChange={e => onChange(e.target.value)} />
      </div>
    );
  }

  if (f.kind === 'enum') {
    const select = (v: string, set: (v: string) => void) => (
      <select value={v} disabled={disabled} onChange={e => set(e.target.value)}>
        {f.enumValues!.map(o => <option key={o.name} value={o.name}>{o.name} ({o.value})</option>)}
      </select>
    );
    if (!f.array) return <div className="row struct-row">{label}{select(value as string, onChange)}</div>;
    const items = value as string[];
    return (
      <div className="struct-nested">
        <div className="struct-head">{label}{!disabled && <button onClick={() => onChange([...items, f.enumValues![0].name])}>Add</button>}</div>
        {items.map((v, i) => (
          <div className="row" key={i}>
            {select(v, x => onChange(items.map((y, j) => (j === i ? x : y))))}
            {!disabled && <button onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
      </div>
    );
  }

  // A structure: its fields nested; deep levels start folded.
  if (!f.array) {
    return (
      <details className="struct-nested" open={depth < 2}>
        <summary>{label}</summary>
        <StructFields space={space} shapeKey={f.dataType!} value={value as StructValue} onChange={onChange} disabled={disabled} depth={depth + 1} />
      </details>
    );
  }
  const items = value as StructValue[];
  return (
    <details className="struct-nested" open={depth < 2}>
      <summary>{label} <span className="note">{items.length} item(s)</span></summary>
      {items.map((item, i) => (
        <div className="struct-item" key={i}>
          <div className="struct-head">
            <span>[{i}]</span>
            {!disabled && <button onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>}
          </div>
          <StructFields space={space} shapeKey={f.dataType!} value={item} disabled={disabled} depth={depth + 1}
            onChange={v => onChange(items.map((x, j) => (j === i ? v : x)))} />
        </div>
      ))}
      {!disabled && <div className="row"><button onClick={() => onChange([...items, emptyStructure(space, f.dataType!, depth + 1)])}>Add item</button></div>}
    </details>
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
