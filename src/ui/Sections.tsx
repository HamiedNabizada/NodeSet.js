// Panel sections for what has more structure than a field: method
// arguments, DataType fields, structure values, and references outside the
// hierarchy. Arguments, fields and structure values are edited as a draft
// and applied as one undo step.

import { useEffect, useId, useMemo, useState } from 'react';
import { useDraft } from './drafts';
import { isStateMachineType, MachineTransition, nextNumber, readStateMachine, StateMachine, stateChartSvg } from '../nodeset/statemachine';
import { AddressSpace, REF } from '../nodeset/address-space';
import { fieldKind, FieldKind, ModelEditor } from '../nodeset/edit';
import { Argument, parseNodeIdKey, text, UA_NAMESPACE, uaKey, UaNode } from '../nodeset/model';
import { insideType } from '../nodeset/checks';
import { emptyField, emptyStructure, FieldShape, FieldValue, StructShape, structShape, StructValue } from '../nodeset/structures';
import { TypePicker } from './NodeEditor';
import { cardinality } from '../modeler/diagram-model';
import { t } from './i18n';

type Run = (action: () => unknown) => void;

const valueRanks = (): [number, string][] => [[-1, t('Scalar')], [1, t('Array')], [-2, t('Any')], [0, t('Array (n dims)')]];

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
  // The name the question before leaving shows.
  useDraft(which === 'Input' ? t('Input arguments') : t('Output arguments'), changed);
  const update = (i: number, patch: Partial<Argument>) => setDraft(d => d.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  return (
    <fieldset className="add">
      <legend>{which === 'Input' ? t('Input arguments') : t('Output arguments')}</legend>
      {draft.map((a, i) => (
        <div className="row item-row" key={i}>
          <input placeholder={t('Name')} value={a.name} onChange={e => update(i, { name: e.target.value })} />
          <TypePicker space={space} nodeClass="DataType" value={a.dataType} onPick={k => update(i, { dataType: k })} />
          <select value={a.valueRank} onChange={e => update(i, { valueRank: Number(e.target.value) })}>
            {valueRanks().map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button title={t('Remove')} onClick={() => setDraft(d => d.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="row">
        <button onClick={() => setDraft(d => [...d, { name: '', dataType: uaKey(12), valueRank: -1, arrayDimensions: [] }])}>{t('+ Argument')}</button>
        {changed && <button onClick={() => run(() => editor.setArguments(method.id, which, draft))}>{t('Apply')}</button>}
        {changed && <button onClick={() => setDraft(current)}>{t('Discard')}</button>}
      </div>
    </fieldset>
  );
}

interface FieldDraft { name: string; dataType?: string; valueRank?: number; isOptional?: boolean; allowSubTypes?: boolean; description?: string; value?: number }

/** Fields compared by content, whatever order their properties were set in. */
function fieldsKey(fields: FieldDraft[]): string {
  return JSON.stringify(fields.map(f => [f.name, f.dataType, f.valueRank ?? -1, !!f.isOptional, !!f.allowSubTypes, f.description ?? '', f.value]));
}

const fieldLegends = (): Record<FieldKind, [string, string]> => ({
  enumeration: [t('Values'), t('Value')],
  optionSet: [t('Options (bit numbers)'), t('Option')],
  union: [t('Fields (exactly one is set)'), t('Field')],
  structure: [t('Fields'), t('Field')],
});

export function FieldsSection({ space, editor, dataType, run }: { space: AddressSpace; editor: ModelEditor; dataType: UaNode; run: Run }) {
  const kind = fieldKind(space, dataType.id);
  const isEnum = kind === 'enumeration' || kind === 'optionSet';
  const current = useMemo<FieldDraft[]>(() => (dataType.definition?.fields ?? []).map(f => ({
    name: f.name, dataType: f.dataType, valueRank: f.valueRank, isOptional: f.isOptional,
    allowSubTypes: f.otherAttributes?.AllowSubTypes === 'true' || undefined, description: text(f.description), value: f.value,
  })), [dataType, dataType.definition]);
  const [draft, setDraft] = useState<FieldDraft[]>(current);
  const currentKey = fieldsKey(current);
  useEffect(() => setDraft(current), [currentKey]);
  const changed = !!kind && fieldsKey(draft) !== currentKey;
  // Before the return below: a DataType without fields calls no fewer hooks than one with.
  useDraft(t('Fields'), changed);
  if (!kind) return null;
  const [legend, noun] = fieldLegends()[kind];
  const update = (i: number, patch: Partial<FieldDraft>) => setDraft(d => d.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <fieldset className="add">
      <legend>{legend}</legend>
      {draft.map((f, i) => (
        <div className={`row${isEnum ? '' : ' item-row'}`} key={i}>
          {isEnum && (
            <input className="value" type="number" step={1} min={kind === 'optionSet' ? 0 : undefined} value={f.value ?? i} title={kind === 'optionSet' ? t('Bit') : t('Value')}
              onChange={e => update(i, { value: e.target.value === '' ? undefined : Number(e.target.value) })} />
          )}
          <input placeholder={t('Name')} value={f.name} onChange={e => update(i, { name: e.target.value })} />
          {!isEnum && (
            <>
              <TypePicker space={space} nodeClass="DataType" value={f.dataType} onPick={k => update(i, { dataType: k })} />
              <select value={f.valueRank ?? -1} onChange={e => update(i, { valueRank: Number(e.target.value) })}>
                {valueRanks().filter(([k]) => k === -1 || k === 1).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {kind === 'structure' && (
                <label className="check" title={t('The field may be absent from a value (StructureWithOptionalFields).')}>
                  <input type="checkbox" checked={!!f.isOptional} onChange={e => update(i, { isOptional: e.target.checked || undefined })} />
                  {t('optional')}
                </label>
              )}
              <label className="check" title={t('The field may hold a subtype of its DataType (AllowSubTypes); a value then names its own type.')}>
                <input type="checkbox" checked={!!f.allowSubTypes} onChange={e => update(i, { allowSubTypes: e.target.checked || undefined })} />
                {t('subtypes')}
              </label>
            </>
          )}
          <button title={t('Remove')} onClick={() => setDraft(d => d.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="row">
        <button onClick={() => setDraft(d => [...d, isEnum
          ? { name: '', description: '', value: d.length === 0 ? 0 : Math.max(...d.map((x, j) => x.value ?? j)) + 1 }
          : { name: '', dataType: uaKey(12), valueRank: -1, description: '' }])}>
          + {noun}
        </button>
        {changed && <button onClick={() => run(() => editor.setFields(dataType.id, draft))}>{t('Apply')}</button>}
        {changed && <button onClick={() => setDraft(current)}>{t('Discard')}</button>}
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
  useDraft(t('Value'), changed);
  const set = (i: number, v: StructValue) => setDraft(d => d.map((x, j) => (j === i ? v : x)));

  return (
    <fieldset className="add">
      <legend>{list ? t('Value ({0}, array)', shape.element) : t('Value ({0})', shape.element)}</legend>
      {!current && <div className="note">{t('No value yet.')}</div>}
      {draft.map((item, i) => (
        <div key={i} className={list ? 'struct-item' : undefined}>
          {list && (
            <div className="struct-head">
              <span>[{i}]</span>
              {own && <button onClick={() => setDraft(d => d.filter((_, j) => j !== i))}>{t('Remove')}</button>}
            </div>
          )}
          <StructFields space={space} shapeKey={shape.key} value={item} onChange={v => set(i, v)} disabled={!own} depth={0} />
        </div>
      ))}
      {own && list && <div className="row"><button onClick={() => setDraft(d => [...d, emptyStructure(space, shape.key)])}>{t('Add item')}</button></div>}
      {own && (
        <div className="row">
          {changed && <button onClick={() => run(() => editor.setStructureValue(node.id, draft))}>{t('Apply')}</button>}
          {changed && <button onClick={() => setDraft(JSON.parse(currentJson))}>{t('Discard')}</button>}
          {current && !changed && <button onClick={() => run(() => editor.setStructureValue(node.id, undefined))}>{t('Remove value')}</button>}
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
  if (!shape) return <div className="note">{t('Not edited here.')}</div>;
  const setField = (name: string, v: FieldValue | undefined) => onChange({ ...value, [name]: v });

  if (shape.union) {
    const chosen = shape.fields.find(f => value[f.name] !== undefined);
    return (
      <div className="struct-fields">
        <div className="row struct-row">
          <span>{t('set field')}</span>
          <select value={chosen?.name ?? ''} disabled={disabled}
            onChange={e => {
              const f = shape.fields.find(x => x.name === e.target.value);
              onChange(f ? { [f.name]: emptyField(space, f, depth) } : {});
            }}>
            <option value="">{t('(none)')}</option>
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
                <input type="checkbox" checked={false} disabled={disabled} onChange={() => setField(f.name, emptyField(space, f, depth))} /> {t('optional, not set')}
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
  return `${type}${f.array ? '[]' : ''}${f.optional ? `, ${t('optional')}` : ''}`;
}

/** One field: a text for built-in values, a list for enumerations, nested fields for structures; arrays of each. */
function FieldEditor({ space, field: f, value, onChange, disabled, depth, onClear }: {
  space: AddressSpace; field: FieldShape; value: FieldValue; onChange: (v: FieldValue) => void; disabled: boolean; depth: number;
  /** An optional field: leave it out again. */
  onClear?: () => void;
}) {
  const label = (
    <span title={typeTitle(space, f)}>
      {onClear && <input type="checkbox" checked disabled={disabled} onChange={onClear} title={t('Leave this optional field out')} />}
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
        <div className="struct-head">{label}{!disabled && <button onClick={() => onChange([...items, f.enumValues![0].name])}>{t('Add')}</button>}</div>
        {items.map((v, i) => (
          <div className="row" key={i}>
            {select(v, x => onChange(items.map((y, j) => (j === i ? x : y))))}
            {!disabled && <button onClick={() => onChange(items.filter((_, j) => j !== i))}>{t('Remove')}</button>}
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
      <summary>{label} <span className="note">{t('{0} item(s)', items.length)}</span></summary>
      {items.map((item, i) => (
        <div className="struct-item" key={i}>
          <div className="struct-head">
            <span>[{i}]</span>
            {!disabled && <button onClick={() => onChange(items.filter((_, j) => j !== i))}>{t('Remove')}</button>}
          </div>
          <StructFields space={space} shapeKey={f.dataType!} value={item} disabled={disabled} depth={depth + 1}
            onChange={v => onChange(items.map((x, j) => (j === i ? v : x)))} />
        </div>
      ))}
      {!disabled && <div className="row"><button onClick={() => onChange([...items, emptyStructure(space, f.dataType!, depth + 1)])}>{t('Add item')}</button></div>}
    </details>
  );
}

/** References that are not part of the hierarchy, the type system or the modelling rules. */
const STRUCTURAL = new Set<string>([REF.HasTypeDefinition, REF.HasModellingRule, REF.HasSubtype, uaKey(38) /* HasEncoding */]);

/**
 * The states and transitions of a finite state machine type, and the machine
 * as a state chart. Adding, renaming and deleting go through the editor, so
 * every step is one undo.
 */
export function StateMachineSection({ space, editor, type, run, onSelect }: {
  space: AddressSpace; editor: ModelEditor; type: UaNode; run: Run; onSelect: (key: string) => void;
}) {
  const machine = useMemo(() => readStateMachine(space, type), [space, type]);
  const [state, setState] = useState('');
  const [transition, setTransition] = useState({ name: '', from: '', to: '', cause: '' });
  const methods = useMemo(() => space.children(type).filter(c => c.node.nodeClass === 'Method').map(c => c.node), [space, type]);
  const chart = useMemo(() => stateChartSvg(machine), [machine]);
  // Machines a state can hold: those of the model and of loaded models, not this one or its subtypes.
  const machineTypes = useMemo(() => space.ofClass('ObjectType')
    .filter(n => isStateMachineType(space, n) && n.browseName.namespaceUri !== UA_NAMESPACE && n.id !== type.id && !space.isSubtypeOf(n.id, type.id))
    .sort((a, b) => (text(a.displayName) || a.browseName.name).localeCompare(text(b.displayName) || b.browseName.name)), [space, type]);
  const [holder, setHolder] = useState('');
  // The transition whose ends and cause are open for change.
  const [editing, setEditing] = useState<string>();
  const chosen = machine.states.find(s => s.key === holder) ?? machine.states[0];
  // The form empties only once the model took the state or transition; a refusal leaves it to correct.
  const addState = () => run(() => {
    editor.addState(type.id, state.trim(), nextNumber(machine.states));
    setState('');
  });
  const addTransition = () => run(() => {
    editor.addTransition(type.id, transition.name.trim(), nextNumber(machine.transitions), transition.from, transition.to, transition.cause || undefined);
    setTransition({ name: '', from: '', to: '', cause: '' });
  });

  return (
    <fieldset className="add">
      <legend>{t('State machine')}</legend>
      {machine.states.length === 0 && <div className="hint-text">{t('No states yet. A machine needs its states first, then the transitions between them.')}</div>}
      {machine.states.length > 0 && (
        <table className="grid">
          <thead><tr><th>{t('State')}</th><th>{t('No.')}</th><th /></tr></thead>
          <tbody>
            {machine.states.map(s => (
              <tr key={s.key}>
                <td><button className="link" onClick={() => onSelect(s.key)}>{s.name}</button></td>
                <td>{s.number ?? ''}</td>
                <td><button title={t('Remove')} onClick={() => run(() => editor.delete(s.key))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {chosen && (
        <div className="row wrap">
          <span className="note">{t('Machine of')}</span>
          <select value={chosen.key} onChange={e => setHolder(e.target.value)} title={t('The state whose machine of its own to set.')}>
            {machine.states.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
          <select value={chosen.subMachine?.type ?? ''}
            title={t('The machine the state holds (HasSubStateMachine): a Mandatory component of this type, of the machine type chosen here.')}
            onChange={e => run(() => editor.setSubStateMachine(type.id, chosen.key, e.target.value || undefined))}>
            <option value="">{t('(none)')}</option>
            {machineTypes.map(t => <option key={t.id} value={t.id}>{text(t.displayName) || t.browseName.name}</option>)}
          </select>
        </div>
      )}
      <div className="row">
        <input placeholder={t('New state')} value={state} onChange={e => setState(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && state.trim()) addState(); }} />
        <button disabled={!state.trim()} onClick={addState}>{t('Add state')}</button>
      </div>

      {machine.transitions.length > 0 && (
        /* A list, not a table: the panel is too narrow for four columns of names. */
        <ul className="machine">
          {machine.transitions.map(tr => (
            <li key={tr.key}>
              <button className="link" onClick={() => onSelect(tr.key)}>{tr.name}</button>
              <span className="ends">{ends(machine, tr)}{tr.causeName ? ` / ${tr.causeName}()` : ''}</span>
              {editor.owns(tr.key) && (
                <button title={t('Change ends and cause')} onClick={() => setEditing(k => (k === tr.key ? undefined : tr.key))}>✎</button>
              )}
              <button title={t('Remove')} onClick={() => run(() => editor.delete(tr.key))}>×</button>
              {/* Each change is a step of its own; ends must be states of this machine. */}
              {editing === tr.key && (
                <div className="row wrap">
                  <select value={tr.from ?? ''} onChange={e => run(() => editor.setTransition(tr.key, { from: e.target.value || undefined }))}>
                    <option value="">{t('from …')}</option>
                    {machine.states.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
                  </select>
                  <select value={tr.to ?? ''} onChange={e => run(() => editor.setTransition(tr.key, { to: e.target.value || undefined }))}>
                    <option value="">{t('to …')}</option>
                    {machine.states.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
                  </select>
                  <select value={tr.cause ?? ''} onChange={e => run(() => editor.setTransition(tr.key, { cause: e.target.value || undefined }))}>
                    <option value="">{t('caused by …')}</option>
                    {methods.map(m => <option key={m.id} value={m.id}>{text(m.displayName) || m.browseName.name}()</option>)}
                  </select>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {machine.states.length >= 1 && (
        <div className="row wrap">
          <input placeholder={t('New transition')} value={transition.name} onChange={e => setTransition({ ...transition, name: e.target.value })} />
          <select value={transition.from} onChange={e => setTransition({ ...transition, from: e.target.value })}>
            <option value="">{t('from …')}</option>
            {machine.states.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
          <select value={transition.to} onChange={e => setTransition({ ...transition, to: e.target.value })}>
            <option value="">{t('to …')}</option>
            {machine.states.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
          <select value={transition.cause} onChange={e => setTransition({ ...transition, cause: e.target.value })}>
            <option value="">{t('caused by …')}</option>
            {methods.map(m => <option key={m.id} value={m.id}>{text(m.displayName) || m.browseName.name}()</option>)}
          </select>
          <button disabled={!transition.name.trim() || !transition.from || !transition.to} onClick={addTransition}>{t('Add transition')}</button>
        </div>
      )}
      {chart && (
        <details open>
          <summary>{t('State chart')}</summary>
          <div className="chart" dangerouslySetInnerHTML={{ __html: chart }} />
        </details>
      )}
    </fieldset>
  );
}

function nameOf(machine: StateMachine, key: string | undefined): string {
  return machine.states.find(s => s.key === key)?.name ?? (key ? '?' : '');
}

/** Both ends of a transition in one cell, so the narrow panel still shows them. */
function ends(machine: StateMachine, t: MachineTransition): string {
  return `${nameOf(machine, t.from) || '…'} → ${nameOf(machine, t.to) || '…'}`;
}

export function ReferencesSection({ space, editor, node, run }: { space: AddressSpace; editor: ModelEditor; node: UaNode; run: Run }) {
  const refs = space.out(node.id).filter(e => !STRUCTURAL.has(e.type) && !space.isHierarchical(e.type));
  const [type, setType] = useState<string>();
  const [target, setTarget] = useState<string>();
  const name = (key: string) => { const n = space.get(key); return n ? text(n.displayName) || n.browseName.name : key; };

  return (
    <fieldset className="add">
      <legend>{t('References')}</legend>
      {refs.length === 0 && <div className="note">{t('None besides the hierarchy.')}</div>}
      {refs.map(e => (
        <div className="row ref" key={`${e.type}>${e.target}`}>
          <span><em>{name(e.type)}</em> → {name(e.target)}</span>
          <button title={t('Remove')} onClick={() => run(() => editor.removeReference(node.id, e.type, e.target))}>×</button>
        </div>
      ))}
      <TypePicker space={space} nodeClass="ReferenceType" value={type} onPick={setType} placeholder={t('ReferenceType …')} />
      <div className="row">
        <NodePicker space={space} exclude={node.id} onPick={setTarget} placeholder={t('Target …')} />
        <button disabled={!type || !target} onClick={() => run(() => editor.addReference(node.id, type!, target!))}>{t('Add')}</button>
      </div>
    </fieldset>
  );
}

/** At most this many nodes are offered; more letters narrow them. */
const MAX_MATCHES = 50;

/**
 * Picks any node of the loaded models by name: from two letters on, the
 * nodes whose name holds them are offered with their path and model, the
 * model's own first. The list is built as you type, not for every node.
 */
function NodePicker({ space, exclude, onPick, placeholder }: {
  space: AddressSpace; exclude?: string; onPick: (key: string | undefined) => void; placeholder?: string;
}) {
  const [value, setValue] = useState('');
  const [query, setQuery] = useState('');
  // React's ids hold colons, which a selector for the list does not take.
  const listId = `nodes-${useId().replace(/[^\w-]/g, '')}`;
  const nodes = useMemo(() => [...space.all()].map(n => ({ n, name: labelOf(n).toLowerCase(), browse: n.browseName.name.toLowerCase() })), [space]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const own = (n: UaNode) => (space.fileOf(n.id)?.editable ? 0 : 1);
    const starts = (n: UaNode) => (labelOf(n).toLowerCase().startsWith(needle) ? 0 : 1);
    const hits = nodes.filter(x => x.n.id !== exclude && (x.name.includes(needle) || x.browse.includes(needle))).map(x => x.n);
    hits.sort((a, b) => own(a) - own(b) || starts(a) - starts(b) || labelOf(a).length - labelOf(b).length || labelOf(a).localeCompare(labelOf(b)));
    const options = hits.slice(0, MAX_MATCHES)
      .map(n => ({ key: n.id, label: `${pathOf(space, n)} (${modelName(parseNodeIdKey(n.id).namespaceUri)})` }));
    // Two nodes of one path and model are told apart by their NodeId.
    const count = new Map<string, number>();
    for (const o of options) count.set(o.label, (count.get(o.label) ?? 0) + 1);
    return options.map(o => (count.get(o.label)! > 1 ? { ...o, label: `${o.label} ${parseNodeIdKey(o.key).identifier}` } : o));
  }, [nodes, query, exclude, space]);

  const change = (typed: string) => {
    setValue(typed);
    const hit = matches.find(m => m.label === typed);
    if (hit) { onPick(hit.key); return; }
    setQuery(typed);
    onPick(undefined);
  };
  return (
    <>
      <input list={listId} value={value} placeholder={placeholder} title={t('Type two letters or more of the name; any loaded model.')}
        onChange={e => change(e.target.value)} />
      <datalist id={listId}>{matches.map(m => <option key={m.key} value={m.label} />)}</datalist>
    </>
  );
}

function labelOf(n: UaNode): string {
  return text(n.displayName) || n.browseName.name;
}

/**
 * What a type gets from its supertypes and does not declare itself, by the
 * type it comes from, the nearest first: shown, not edited. A click shows the
 * declaration in the panel. A declaration of the type that overrides one of a
 * supertype (the same BrowseName and namespace) hides it.
 */
export function InheritedSection({ space, type, onSelect }: { space: AddressSpace; type: UaNode; onSelect: (key: string) => void }) {
  const groups = useMemo(() => {
    const seen = new Set(space.children(type).map(c => `${c.node.browseName.namespaceUri}|${c.node.browseName.name}`));
    const result: { from: UaNode; items: UaNode[] }[] = [];
    for (const t of space.typeChain(type).slice(1)) {
      const items: UaNode[] = [];
      for (const { node } of space.children(t)) {
        const name = `${node.browseName.namespaceUri}|${node.browseName.name}`;
        if (seen.has(name)) continue;
        seen.add(name);
        items.push(node);
      }
      if (items.length > 0) result.push({ from: t, items });
    }
    return result;
  }, [space, type]);
  if (groups.length === 0) return null;
  return (
    <fieldset className="add">
      <legend>{t('Inherited')}</legend>
      {groups.map(g => (
        <details key={g.from.id} open={groups.length === 1}>
          <summary>{labelOf(g.from)} ({g.items.length})</summary>
          <ul className="inherited">
            {g.items.map(n => (
              <li key={n.id}>
                <button className="link" onClick={() => onSelect(n.id)}>{labelOf(n)}</button>
                <span className="note"> {n.nodeClass} {cardinality(space.modellingRule(n)) ?? ''}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </fieldset>
  );
}

/** Creates an instance of a type: a name and the Optional declarations to include. */
const OBJECTS = uaKey(85);
const DATA_TYPE_ENCODING = uaKey(76);

/** The last part of a model URI: DI for http://opcfoundation.org/UA/DI/. */
function modelName(uri: string): string {
  return uri.replace(/[/:]+$/, '').split(/[/:]/).pop() || uri;
}

/** A node's names from below the Objects folder down to it: "Hall/Pump2". */
function placeName(space: AddressSpace, n: UaNode): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (let p: UaNode | undefined = n; p && p.id !== OBJECTS && !seen.has(p.id) && parts.length < 8; p = space.parentOf(p)) {
    seen.add(p.id);
    parts.unshift(text(p.displayName) || p.browseName.name);
  }
  return parts.join('/');
}

/**
 * Where a new instance can go: the Objects folder, what loaded models put
 * there for others to fill (DI's DeviceSet, say), and the model's own
 * instances. The base model's objects (Server and the like) are left out.
 */
export function instancePlaces(space: AddressSpace, editor: ModelEditor): { key: string; label: string }[] {
  const places = [{ key: '', label: t('Objects folder') }];
  const objects = space.get(OBJECTS);
  for (const c of objects ? space.children(objects) : []) {
    const n = c.node;
    if (n.nodeClass !== 'Object' || editor.owns(n.id) || n.browseName.namespaceUri === UA_NAMESPACE) continue;
    places.push({ key: n.id, label: `${text(n.displayName) || n.browseName.name} (${modelName(n.browseName.namespaceUri)})` });
  }
  for (const n of editor.file.nodes) {
    // Not the encodings of a DataType: Objects too, but outside the hierarchy and of no use as a place.
    const encoding = space.isSubtypeOf(space.typeDefinition(n)?.id ?? '', DATA_TYPE_ENCODING);
    if (n.nodeClass === 'Object' && !encoding && space.parentOf(n) && !insideType(space, n)) places.push({ key: n.id, label: placeName(space, n) });
  }
  return places;
}

export function InstantiateSection({ space, editor, type, run, onCreated }: { space: AddressSpace; editor: ModelEditor; type: UaNode; run: Run; onCreated: (key: string) => void }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [place, setPlace] = useState('');
  const optional = useMemo(() => editor.optionalPaths(type.id), [editor, type]);
  const places = useMemo(() => instancePlaces(space, editor), [space, editor]);
  const create = () => run(() => {
    const key = editor.instantiate(type.id, name, { optional: p => picked.has(p), parent: place || undefined });
    setName('');
    onCreated(key);
  });
  return (
    <fieldset className="add">
      <legend>{t('Create instance')}</legend>
      {optional.length > 0 && <div className="note">{t('Optional children to include:')}</div>}
      {optional.map(p => (
        <label key={p} className="check">
          <input type="checkbox" checked={picked.has(p)}
            onChange={e => setPicked(s => { const n = new Set(s); if (e.target.checked) n.add(p); else n.delete(p); return n; })} />
          {p}
        </label>
      ))}
      <label className="field"><span>{t('Place')}</span>
        <select value={places.some(p => p.key === place) ? place : ''} onChange={e => setPlace(e.target.value)}
          title={t('Where the instance goes. A node of another model stays as it is; the instance alone refers to it.')}>
          {places.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
      <div className="row">
        <input placeholder={t('Name of the instance')} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) create(); }} />
        <button disabled={!name.trim() || !!type.isAbstract} title={type.isAbstract ? t('Abstract types have no instances.') : undefined} onClick={create}>{t('Create')}</button>
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
