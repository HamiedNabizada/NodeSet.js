// The properties of the selected node: editable for nodes of the model being
// edited, read only for nodes of required models.

import { useEffect, useMemo, useState } from 'react';
import { AddressSpace, RULE } from '../nodeset/address-space';
import { insideType } from '../nodeset/checks';
import { DeclarationKind, ModelEditor } from '../nodeset/edit';
import { NodeClass, parseNodeIdKey, text, UaNode } from '../nodeset/model';
import { builtInOf, valueText } from '../nodeset/values';
import { structShape, structureValues } from '../nodeset/structures';
import { ArgumentsSection, FieldsSection, InstantiateSection, ReferencesSection, StructureValueSection } from './Sections';

const RULES: [string, string][] = [
  ['', '(none)'],
  [RULE.Mandatory, 'Mandatory (1)'],
  [RULE.Optional, 'Optional (0..1)'],
  [RULE.MandatoryPlaceholder, 'MandatoryPlaceholder (1..n)'],
  [RULE.OptionalPlaceholder, 'OptionalPlaceholder (0..n)'],
];

const VALUE_RANKS: [number, string][] = [
  [-3, 'ScalarOrOneDimension'], [-2, 'Any'], [-1, 'Scalar'], [0, 'OneOrMoreDimensions'], [1, 'OneDimension'], [2, 'Two dimensions'],
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
  if (!node) return <div className="empty">Unknown node.</div>;
  const own = editor.owns(nodeKey);
  const isType = node.nodeClass.endsWith('Type');
  const id = parseNodeIdKey(node.id);
  const typeDefinition = space.typeDefinition(node);
  const rule = space.modellingRule(node);
  const supertype = space.supertypeKey(node.id);

  return (
    <div className="editor">
      <h3>{label(node)} <span className="kind">{node.nodeClass}</span></h3>
      {!own && <div className="note">Part of {id.namespaceUri}; read only.</div>}
      <Field label="Name">
        <TextInput value={node.browseName.name} disabled={!own} onCommit={v => run(() => editor.rename(nodeKey, v))} />
      </Field>
      <Field label="NodeId"><span className="mono">{id.identifier}</span></Field>
      <Field label="Description">
        <TextInput value={text(node.description)} disabled={!own} multiline onCommit={v => run(() => editor.setDescription(nodeKey, v))} />
      </Field>
      {isType && (
        <>
          <Field label="Supertype">
            <TypePicker space={space} nodeClass={node.nodeClass} value={supertype} disabled={!own}
              onPick={k => run(() => editor.setSupertype(nodeKey, k))} />
          </Field>
          <Field label="Abstract">
            <input type="checkbox" checked={node.isAbstract === true} disabled={!own} onChange={e => run(() => editor.setAbstract(nodeKey, e.target.checked))} />
          </Field>
        </>
      )}
      {(node.nodeClass === 'Object' || node.nodeClass === 'Variable') && (
        <Field label="TypeDefinition">
          <TypePicker space={space} nodeClass={node.nodeClass === 'Object' ? 'ObjectType' : 'VariableType'} value={typeDefinition?.id} disabled={!own}
            onPick={k => run(() => editor.setTypeDefinition(nodeKey, k))} />
          {typeDefinition && <button className="link" onClick={() => onOpenType(typeDefinition.id)}>open</button>}
        </Field>
      )}
      {!isType && insideType(space, node) && (
        <Field label="ModellingRule">
          <select value={rule ?? ''} disabled={!own} onChange={e => run(() => editor.setModellingRule(nodeKey, e.target.value || undefined))}>
            {RULES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
        </>
      )}
      {node.nodeClass === 'ReferenceType' && (
        <>
          <Field label="Symmetric">
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
      {own && canHoldChildren(node.nodeClass) && (
        <AddChild editor={editor} parent={nodeKey} run={run} onCreated={onCreated} declaration={isType || insideType(space, node)} />
      )}
      {own && <ReferencesSection space={space} editor={editor} node={node} run={run} />}
      {(node.nodeClass === 'ObjectType' || node.nodeClass === 'VariableType') && (
        <InstantiateSection editor={editor} type={node} run={run} onCreated={onInstance} />
      )}
      {own && (
        <div className="actions">
          {isType && <button onClick={() => onOpenType(nodeKey)}>Show diagram</button>}
          <button className="danger" onClick={() => run(() => editor.delete(nodeKey))}>Delete</button>
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
  const hint = !node.dataType ? 'choose a DataType first' : 'values of this DataType are not edited here';
  return (
    <Field label="Value">
      {text === null
        ? <span className="note">A structured value; kept as it was read.</span>
        : <TextInput value={text ?? ''} disabled={!own || !builtIn} placeholder={!builtIn ? hint : array ? 'a; b; c' : builtIn}
            onCommit={v => run(() => editor.setValue(node.id, v))} />}
    </Field>
  );
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
      <legend>Add child</legend>
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
        <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
        <button onClick={add} disabled={!name.trim()}>Add</button>
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
  const options = useMemo(() => {
    const nodes = space.ofClass(nodeClass);
    const count = new Map<string, number>();
    for (const n of nodes) count.set(label(n), (count.get(label(n)) ?? 0) + 1);
    return nodes
      .map(n => ({ key: n.id, name: count.get(label(n))! > 1 ? `${label(n)} (${shortNs(n.browseName.namespaceUri)})` : label(n) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [space, nodeClass]);
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

function shortNs(uri: string): string {
  return uri.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function label(n: UaNode): string {
  return text(n.displayName) || n.browseName.name;
}

