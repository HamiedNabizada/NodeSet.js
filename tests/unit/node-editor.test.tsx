import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { uaKey } from '../../src/nodeset/model';
import { readStateMachine } from '../../src/nodeset/statemachine';
import { NodeEditor } from '../../src/ui/NodeEditor';
import { Workspace } from '../../src/workspace';

// Tells React that updates are flushed by act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('The node editor', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement('div'); root = createRoot(host); });
  afterEach(() => act(() => root.unmount()));

  const legends = () => Array.from(host.querySelectorAll('legend'), l => l.textContent);
  const show = (ws: Workspace, key: string) => act(() => root.render(
    <NodeEditor space={ws.space} editor={ws.editor!} nodeKey={key} run={action => action()}
      onOpenType={() => undefined} onCreated={() => undefined} onInstance={() => undefined} />));

  // MachineVision has both: ResultStateDataType refines Int32 next to structures.
  it('goes from a structure to a DataType without fields and back', async () => {
    const ws = new Workspace();
    await ws.create('http://example.org/Types/');
    const structure = ws.editor!.addType('DataType', 'ResultType');
    const simple = ws.editor!.addType('DataType', 'ResultStateDataType', uaKey(6));

    show(ws, structure);
    expect(legends()).toContain('Fields');
    show(ws, simple);
    expect(host.querySelector('h3')?.textContent).toContain('ResultStateDataType');
    expect(legends()).not.toContain('Fields');
    show(ws, structure);
    expect(legends()).toContain('Fields');
  });

  it('offers where a new instance goes: the Objects folder, what loaded models put there, own instances', async () => {
    const ws = new Workspace();
    await ws.create('http://example.org/Plant/');
    await ws.addBundled('http://opcfoundation.org/UA/DI/');
    const pump = ws.editor!.addType('ObjectType', 'PumpType');
    ws.editor!.instantiate(pump, 'Pump1');

    show(ws, pump);

    const section = Array.from(host.querySelectorAll('fieldset')).find(f => f.querySelector('legend')?.textContent === 'Create instance')!;
    const places = Array.from(section.querySelectorAll('select option'), o => o.textContent);
    expect(places[0]).toBe('Objects folder');
    expect(places).toContain('DeviceSet (DI)');
    expect(places).toContain('Pump1');
    expect(places).not.toContain('Server (UA)');
  });

  it('gives a state a machine of its own from the panel', async () => {
    const ws = new Workspace();
    await ws.create('http://example.org/Machine/');
    const main = ws.editor!.addStateMachineType('MainStateMachineType');
    const running = ws.editor!.addState(main, 'Running', 1);
    const sub = ws.editor!.addStateMachineType('ExecuteStateMachineType');

    show(ws, main);
    const machineOf = host.querySelector('select[title^="The machine the state holds"]') as HTMLSelectElement;
    expect(Array.from(machineOf.options, o => o.textContent)).toEqual(['(none)', 'ExecuteStateMachineType']);
    act(() => {
      machineOf.value = sub;
      machineOf.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const state = readStateMachine(ws.space, ws.space.get(main)!).states.find(s => s.key === running)!;
    expect(state.subMachine?.type).toBe(sub);
  });
});
