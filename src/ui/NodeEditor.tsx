// The properties of the selected node: editable for nodes of the model being
// edited, read only for nodes of required models.

import { useEffect, useMemo, useState } from 'react';
import { AddressSpace, RULE } from '../nodeset/address-space';
import { insideType } from '../nodeset/checks';
import { DeclarationKind, ModelEditor } from '../nodeset/edit';
import { NodeClass, parseNodeIdKey, text, UaNode } from '../nodeset/model';
import { builtInOf, valueText } from '../nodeset/values';
import { structShape, structureValues } from '../nodeset/structures';
import { addSignals, parseSignals } from '../nodeset/csv';
import { ArgumentsSection, FieldsSection, InheritedSection, InstantiateSection, ReferencesSection, StateMachineSection, StructureValueSection } from './Sections';
import { isStateMachineType } from '../nodeset/statemachine';
import { t } from './i18n';

/** The ModellingRules by their names in the specification; "(none)" is translated where it is shown. */
const RULES: [string, string][] = [
  ['', '(none)'],
  [RULE.Mandatory, 'Mandatory (1)'],
  [RULE.Optional, 'Optional (0..1)'],
  [RULE.MandatoryPlaceholder, 'MandatoryPlaceholder (1..n)'],
  [RULE.OptionalPlaceholder, 'OptionalPlaceholder (0..n)'],
];

const VALUE_RANKS: [number, string][] = [
  [-3, 'ScalarOrOneDimension'], [-2, 'Any'], [-1, 'Scalar'], [0, 'OneOrMoreDimensions'], [1, 'OneDimension'], [2, 'TwoDimensions'],
];

interface Props {
  space: AddressSpace;
  editor: ModelEditor;
  nodeKey: string;
  /** Runs an edit and reports its error, if any. */
  run: (action: () => unknown) => void;
  onOpenType: (key: string) => void;
  onCreated: (key: string) => void;
  /** An instance was created: show it. */
  onInstance: (key: string) => void;
}

export function NodeEditor({ space, editor, nodeKey, run, onOpenType, onCreated, onInstance }: Props) {
  const node = space.get(nodeKey);
  if (!node) return <div className="empty">{t('Unknown node.')}</div>;
  const own = editor.owns(nodeKey);
  const isType = node.nodeClass.endsWith('Type');
  const id = parseNodeIdKey(node.id);
  const typeDefinition = space.typeDefinition(node);
  const rule = space.modellingRule(node);
  const supertype = space.supertypeKey(node.id);

  return (
    <div className="editor">
      <h3>{label(node)} <span className="kind">{node.nodeClass}</span></h3>
      {!own && <div className="note">{t('Part of {0}; read only.', id.namespaceUri)}</div>}
      <Field label={t('Name')}>
        <TextInput value={node.browseName.name} disabled={!own} onCommit={v => run(() => editor.rename(nodeKey, v))} />
      </Field>
      <Field label="DisplayName">
        <TextInput value={text(node.displayName)} disabled={!own} placeholder={node.browseName.name}
          onCommit={v => run(() => editor.setDisplayName(nodeKey, v))} />
      </Field>
      <Field label="NodeId"><span className="mono">{id.identifier}</span></Field>
      <Field label={t('Description')}>
        <TextInput value={text(node.description)} disabled={!own} multiline onCommit={v => run(() => editor.setDescription(nodeKey, v))} />
      </Field>
      {isType && (
        <>
          <Field label={t('Supertype')}>
            <TypePicker space={space} nodeClass={node.nodeClass} value={supertype} disabled={!own}
              onPick={k => run(() => editor.setSupertype(nodeKey, k))} />
          </Field>
          <Field label={t('Abstract')}>
            <input type="checkbox" checked={node.isAbstract === true} disabled={!own} onChange={e => run(() => editor.setAbstract(nodeKey, e.target.checked))} />
          </Field>
        </>
      )}
      {(node.nodeClass === 'Object' || node.nodeClass === 'Variable') && (
        <Field label="TypeDefinition">
          <TypePicker space={space} nodeClass={node.nodeClass === 'Object' ? 'ObjectType' : 'VariableType'} value={typeDefinition?.id} disabled={!own}
            onPick={k => run(() => editor.setTypeDefinition(nodeKey, k))} />
          {typeDefinition && <button className="link" onClick={() => onOpenType(typeDefinition.id)}>{t('open')}</button>}
        </Field>
      )}
      {!isType && insideType(space, node) && (
        <Field label="ModellingRule">
          <select value={rule ?? ''} disabled={!own} onChange={e => run(() => editor.setModellingRule(nodeKey, e.target.value || undefined))}>
            {RULES.map(([k, v]) => <option key={k} value={k}>{k ? v : t('(none)')}</option>)}
          </select>
        </Field>
      )}
      {(node.nodeClass === 'Variable' || node.nodeClass === 'VariableType') && (
        <>
          <Field label="DataType">
            <TypePicker space={space} nodeClass="DataType" value={node.dataType} disabled={!own}
              onPick={k => run(() => editor.setDataType(nodeKey, k))} />
          </Field>
          <Field label="ValueRank">
            <select value={node.valueRank ?? -1} disabled={!own} onChange={e => run(() => editor.setValueRank(nodeKey, Number(e.target.value)))}>
              {VALUE_RANKS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {!node.arguments && <ValueField space={space} editor={editor} node={node} own={own} run={run} />}
          {node.nodeClass === 'Variable' && <AccessFields editor={editor} node={node} own={own} run={run} />}
        </>
      )}
      {node.nodeClass === 'ReferenceType' && (
        <>
          <Field label={t('Symmetric')}>
            <input type="checkbox" checked={node.symmetric === true} disabled={!own} onChange={e => run(() => editor.setSymmetric(nodeKey, e.target.checked))} />
          </Field>
          {!node.symmetric && (
            <Field label="InverseName">
              <TextInput value={text(node.inverseName)} disabled={!own} onCommit={v => run(() => editor.setInverseName(nodeKey, v))} />
            </Field>
          )}
        </>
      )}
      {own && node.nodeClass === 'Method' && <ArgumentsSection space={space} editor={editor} method={node} run={run} />}
      {own && node.nodeClass === 'DataType' && <FieldsSection space={space} editor={editor} dataType={node} run={run} />}
      {own && isStateMachineType(space, node) && (
        <StateMachineSection space={space} editor={editor} type={node} run={run} onSelect={onCreated} />
      )}
      {own && canHoldChildren(node.nodeClass) && (
        <AddChild editor={editor} parent={nodeKey} run={run} onCreated={onCreated} declaration={isType || insideType(space, node)} />
      )}
      {own && canHoldChildren(node.nodeClass) && (
        <div className="row">
          <label className="button-like" title={t('A CSV file with a header row: Name, and optionally DataType, Kind (Variable or Property), ModellingRule, Description, Value')}>
            {t('Variables from CSV…')}
            <input type="file" accept=".csv,.txt" onChange={async e => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const text = await file.text();
              run(() => addSignals(editor, () => space, nodeKey, parseSignals(text)));
            }} />
          </label>
        </div>
      )}
      {own && <ReferencesSection space={space} editor={editor} node={node} run={run} />}
      {(node.nodeClass === 'ObjectType' || node.nodeClass === 'VariableType') && (
        <InstantiateSection space={space} editor={editor} type={node} run={run} onCreated={onInstance} />
      )}
      {(node.nodeClass === 'ObjectType' || node.nodeClass === 'VariableType') && <InheritedSection space={space} type={node} onSelect={onCreated} />}
      {isType && <AddSubtype editor={editor} type={node} run={run} onCreated={onOpenType} />}
      {own && (
        <div className="actions">
          {isType && <button onClick={() => onOpenType(nodeKey)}>{t('Show diagram')}</button>}
          <button className="danger" onClick={() => run(() => editor.delete(nodeKey))}>{t('Delete')}</button>
        </div>
      )}
    </div>
  );
}

/**
 * The value as text: a scalar, or array elements separated by ";"; a
 * structure (or an array of them) field by field, nested structures,
 * enumerations, optional fields and unions included. Structures with fields
 * that allow subtypes are shown, not edited.
 */
function ValueField({ space, editor, node, own, run }: { space: AddressSpace; editor: ModelEditor; node: UaNode; own: boolean; run: Props['run'] }) {
  const builtIn = builtInOf(space, node.dataType);
  const array = (node.valueRank ?? -1) >= 0;
  const rank = node.valueRank ?? -1;
  const shape = !builtIn && (rank === -1 || rank === 1) ? structShape(space, node.dataType) : undefined;
  const current = shape?.encoding ? structureValues(space, node, shape) : null;
  if (shape?.encoding && current !== null) {
    return <StructureValueSection space={space} editor={editor} node={node} shape={shape} current={current} own={own} run={run} />;
  }
  const text = node.extensionObjects ? null : valueText(node, builtIn);
  const hint = !node.dataType ? t('choose a DataType first') : t('values of this DataType are not edited here');
  const hasValue = !!node.valueXml?.trim() || !!node.extensionObjects;
  return (
    <>
      <Field label={t('Value')}>
        {text === null
          ? <span className="note">{t('A structured value; kept as it was read.')}</span>
          : <TextInput value={text ?? ''} disabled={!own || !builtIn}
              placeholder={!builtIn ? hint : rank >= 2 ? t('a; b | c; d (rows separated by |)') : array ? 'a; b; c' : builtIn}
              onCommit={v => run(() => editor.setValue(node.id, v))} />}
      </Field>
      {/* Outside the field's label, which would pass every click on it to the button. */}
      {own && hasValue && (
        <div className="row"><button onClick={() => run(() => editor.setValue(node.id, undefined))}>{t('Remove value')}</button></div>
      )}
    </>
  );
}

/**
 * Who may read and write the value (the first two bits of AccessLevel and
 * UserAccessLevel; the other bits stay as they are), whether its history is
 * kept, and how fast it is sampled. Absent attributes show the schema's
 * defaults: read only, not historized, no interval.
 */
function AccessFields({ editor, node, own, run }: { editor: ModelEditor; node: UaNode; own: boolean; run: Props['run'] }) {
  const level = node.accessLevel ?? 1;
  const user = Number(node.otherAttributes.UserAccessLevel ?? 1);
  const bits = (name: 'accessLevel' | 'userAccessLevel', value: number) => [[1, t('read')], [2, t('write')]].map(([bit, label]) => (
    <label key={bit} className="check">
      <input type="checkbox" checked={(value & (bit as number)) !== 0} disabled={!own}
        onChange={e => run(() => editor.setAccess(node.id, { [name]: e.target.checked ? value | (bit as number) : value & ~(bit as number) }))} />
      {label}
    </label>
  ));
  return (
    <>
      <Group label="AccessLevel">{bits('accessLevel', level)}</Group>
      <Group label="UserAccessLevel">{bits('userAccessLevel', user)}</Group>
      <Group label="Historizing">
        <input type="checkbox" checked={node.otherAttributes.Historizing === 'true'} disabled={!own}
          onChange={e => run(() => editor.setAccess(node.id, { historizing: e.target.checked }))} />
      </Group>
      <Field label="MinimumSamplingInterval">
        <TextInput value={node.otherAttributes.MinimumSamplingInterval ?? ''} disabled={!own} placeholder={t('ms; -1 not known, 0 continuously')}
          onCommit={v => run(() => editor.setAccess(node.id, { minimumSamplingInterval: v.trim() === '' ? undefined : Number(v) }))} />
      </Field>
    </>
  );
}

/** A row like Field for several controls, each with a label of its own, which a label around them all would confuse. */
function Group({ label: title, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><span>{title}</span><div className="checks">{children}</div></div>;
}

function canHoldChildren(c: NodeClass): boolean {
  return c === 'ObjectType' || c === 'VariableType' || c === 'Object' || c === 'Variable';
}

function AddChild({ editor, parent, run, onCreated, declaration }: {
  editor: ModelEditor; parent: string; run: Props['run']; onCreated: Props['onCreated'];
  /** Children of types are declarations with a ModellingRule; children of instances are not. */
  declaration: boolean;
}) {
  const [kind, setKind] = useState<DeclarationKind>('Variable');
  const [name, setName] = useState('');
  const [rule, setRule] = useState<string>(RULE.Mandatory);
  const add = () => {
    if (!name.trim()) return;
    run(() => {
      const key = editor.addDeclaration(parent, kind, name, rule);
      setName('');
      onCreated(key);
    });
  };
  return (
    <fieldset className="add">
      <legend>{t('Add child')}</legend>
      <select value={kind} onChange={e => setKind(e.target.value as DeclarationKind)}>
        <option value="Variable">Variable (HasComponent)</option>
        <option value="Property">Property (HasProperty)</option>
        <option value="Object">Object (HasComponent)</option>
        <option value="Method">Method (HasComponent)</option>
      </select>
      {declaration && (
        <select value={rule} onChange={e => setRule(e.target.value)}>
          {RULES.filter(([k]) => k).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      )}
      <div className="row">
        <input placeholder={t('Name')} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
        <button onClick={add} disabled={!name.trim()}>{t('Add')}</button>
      </div>
    </fieldset>
  );
}

/** A subtype of the type shown, in the model being edited, whichever model the type belongs to. */
function AddSubtype({ editor, type, run, onCreated }: { editor: ModelEditor; type: UaNode; run: Props['run']; onCreated: (key: string) => void }) {
  const [name, setName] = useState('');
  const add = () => {
    if (!name.trim()) return;
    run(() => {
      const key = editor.addType(type.nodeClass as 'ObjectType' | 'VariableType' | 'DataType' | 'ReferenceType', name, type.id);
      setName('');
      onCreated(key);
    });
  };
  return (
    <fieldset className="add">
      <legend>{t('Add subtype')}</legend>
      <div className="row">
        <input placeholder={t('Name')} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
        <button onClick={add} disabled={!name.trim()}>{t('Add')}</button>
      </div>
    </fieldset>
  );
}

function Field({ label: title, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{title}</span><div>{children}</div></label>;
}

/** A text field that commits on Enter or when it loses focus. */
function TextInput({ value, disabled, multiline, placeholder, onCommit }: {
  value: string; disabled?: boolean; multiline?: boolean; placeholder?: string; onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return multiline
    ? <textarea value={draft} disabled={disabled} rows={3} onChange={e => setDraft(e.target.value)} onBlur={commit} />
    : <input value={draft} disabled={disabled} placeholder={placeholder} onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(value); }} />;
}

/** Picks a node of one NodeClass by name; names that occur in several models carry their namespace. */
export function TypePicker({ space, nodeClass, value, disabled, onPick, placeholder }: {
  space: AddressSpace; nodeClass: NodeClass; value?: string; disabled?: boolean; onPick: (key: string) => void; placeholder?: string;
}) {
  const options = useMemo(() => typeOptions(space, nodeClass), [space, nodeClass]);
  const current = options.find(o => o.key === value)?.name ?? '';
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);
  const listId = `types-${nodeClass}`;
  const commit = () => {
    const hit = options.find(o => o.name === draft);
    if (hit && hit.key !== value) onPick(hit.key);
    else if (!hit) setDraft(current);
  };
  return (
    <>
      <input list={listId} value={draft} disabled={disabled} placeholder={placeholder} onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
      <datalist id={listId}>{options.map(o => <option key={o.key} value={o.name} />)}</datalist>
    </>
  );
}

/** Sorts as localeCompare does, without making a collator for every comparison of a list of hundreds. */
const collator = new Intl.Collator();

/** The nodes of one NodeClass by name, sorted; a name that occurs in several models carries its namespace. */
export function typeOptions(space: AddressSpace, nodeClass: NodeClass): { key: string; name: string }[] {
  const nodes = space.ofClass(nodeClass);
  const count = new Map<string, number>();
  for (const n of nodes) count.set(label(n), (count.get(label(n)) ?? 0) + 1);
  return nodes
    .map(n => ({ key: n.id, name: count.get(label(n))! > 1 ? `${label(n)} (${shortNs(n.browseName.namespaceUri)})` : label(n) }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

function shortNs(uri: string): string {
  return uri.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function label(n: UaNode): string {
  return text(n.displayName) || n.browseName.name;
}

