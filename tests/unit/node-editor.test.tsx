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

  it('removes a value with a button, also one the panel does not edit', async () => {
    const ws = new Workspace();
    await ws.create('http://example.org/Types/');
    const pump = ws.editor!.addType('ObjectType', 'PumpType');
    const speed = ws.editor!.addDeclaration(pump, 'Variable', 'Speed');
    ws.editor!.setDataType(speed, uaKey(11));
    const removeButton = () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Remove value');

    show(ws, speed);
    expect(removeButton()).toBeUndefined();
    ws.editor!.setValue(speed, '3.5');
    show(ws, speed);
    act(() => removeButton()!.click());
    expect(ws.space.get(speed)!.valueXml).toBeUndefined();

    ws.editor!.setDataType(speed, uaKey(17)); // NodeId: shown, not edited
    ws.editable!.nodes.find(n => n.id === speed)!.valueXml = '<NodeId><Identifier>i=85</Identifier></NodeId>';
    ws.editor!.rename(speed, 'Speed');
    show(ws, speed);
    act(() => removeButton()!.click());
    expect(ws.space.get(speed)!.valueXml).toBeUndefined();
  });

  // The target was a list of every node of the model (9624 on Pumps), none of another model.
  it('finds the target of a reference by name, in every loaded model', async () => {
    const DI = 'http://opcfoundation.org/UA/DI/';
    const ws = new Workspace();
    await ws.create('http://example.org/Plant/');
    await ws.addBundled(DI);
    const pump = ws.editor!.addType('ObjectType', 'PumpType');
    show(ws, pump);
    const section = Array.from(host.querySelectorAll('fieldset')).find(f => f.querySelector('legend')?.textContent === 'References')!;
    const input = (placeholder: string) => section.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
    const options = () => Array.from(section.querySelectorAll(`datalist[id="${input('Target …').getAttribute('list')}"] option`),
      o => (o as HTMLOptionElement).value);
    const typeInto = (field: HTMLInputElement, value: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });

    typeInto(input('ReferenceType …'), 'GeneratesEvent');
    act(() => { input('ReferenceType …').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(options()).toEqual([]);
    typeInto(input('Target …'), 'devicet');
    expect(options()).toContain('DeviceType (DI)');
    expect(options().length).toBeLessThanOrEqual(50);
    typeInto(input('Target …'), 'DeviceType (DI)');
    act(() => { Array.from(section.querySelectorAll('button')).find(b => b.textContent === 'Add')!.click(); });

    expect(ws.space.out(pump).map(e => e.target)).toContain(`${DI}|i=1002`);
  });

  it('adds a subtype of the type shown, also of a type of another model', async () => {
    const DI = 'http://opcfoundation.org/UA/DI/';
    const ws = new Workspace();
    await ws.create('http://example.org/Plant/');
    await ws.addBundled(DI);
    const opened: string[] = [];
    act(() => root.render(
      <NodeEditor space={ws.space} editor={ws.editor!} nodeKey={`${DI}|i=1002`} run={action => action()}
        onOpenType={key => opened.push(key)} onCreated={() => undefined} onInstance={() => undefined} />));
    const section = Array.from(host.querySelectorAll('fieldset')).find(f => f.querySelector('legend')?.textContent === 'Add subtype')!;
    const name = section.querySelector('input') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'PumpDeviceType');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => { section.querySelector('button')!.click(); });

    const created = ws.editable!.nodes.find(n => n.browseName.name === 'PumpDeviceType')!;
    expect(ws.space.supertypeKey(created.id)).toBe(`${DI}|i=1002`);
    expect(opened).toEqual([created.id]);
  });

  it('lists what a subtype inherits and does not declare itself, by the type it comes from', async () => {
    const DI = 'http://opcfoundation.org/UA/DI/';
    const ws = new Workspace();
    await ws.create('http://example.org/Plant/');
    await ws.addBundled(DI);
    const pump = ws.editor!.addType('ObjectType', 'PumpDeviceType', `${DI}|i=1002`);
    ws.editor!.addDeclaration(pump, 'Variable', 'SerialNumber'); // overrides DeviceType's in another namespace: both stay
    const speed = ws.editor!.addDeclaration(pump, 'Variable', 'Speed');
    const selected: string[] = [];
    act(() => root.render(
      <NodeEditor space={ws.space} editor={ws.editor!} nodeKey={pump} run={action => action()}
        onOpenType={() => undefined} onCreated={key => selected.push(key)} onInstance={() => undefined} />));

    const section = Array.from(host.querySelectorAll('fieldset')).find(f => f.querySelector('legend')?.textContent === 'Inherited')!;
    const groups = Array.from(section.querySelectorAll('details'), d => [d.querySelector('summary')!.textContent, Array.from(d.querySelectorAll('li button'), b => b.textContent)]);
    const from = groups.map(g => (g[0] as string).split(' ')[0]);
    expect(from[0]).toBe('DeviceType');
    expect(from.every(name => ['DeviceType', 'ComponentType', 'TopologyElementType'].includes(name))).toBe(true);
    const fromDevice = groups.find(g => (g[0] as string).startsWith('DeviceType'))![1] as string[];
    expect(fromDevice).toContain('Manufacturer');
    expect(fromDevice).not.toContain('Speed');
    act(() => { (Array.from(section.querySelectorAll('li button')).find(b => b.textContent === 'Manufacturer') as HTMLButtonElement).click(); });
    expect(selected).toHaveLength(1);
    expect(selected[0]).not.toBe(speed);
    expect(ws.space.get(selected[0])!.browseName.name).toBe('Manufacturer');
  });

  it('lets a variable be written, historized and sampled from the panel', async () => {
    const ws = new Workspace();
    await ws.create('http://example.org/Types/');
    const pump = ws.editor!.addType('ObjectType', 'PumpType');
    const speed = ws.editor!.addDeclaration(pump, 'Variable', 'Speed');
    show(ws, speed);
    const group = (name: string) => Array.from(host.querySelectorAll('.field')).find(f => f.querySelector('span')?.textContent === name)!;
    const box = (name: string, label: string) => Array.from(group(name).querySelectorAll('label')).find(l => l.textContent === label)!.querySelector('input')!;

    expect(box('AccessLevel', 'read').checked).toBe(true);
    expect(box('AccessLevel', 'write').checked).toBe(false);
    act(() => box('AccessLevel', 'write').click());
    act(() => (group('Historizing').querySelector('input') as HTMLInputElement).click());

    expect(ws.space.get(speed)!.accessLevel).toBe(3);
    expect(ws.space.get(speed)!.otherAttributes.Historizing).toBe('true');
    show(ws, speed);
    expect(box('AccessLevel', 'write').checked).toBe(true);
    expect(box('UserAccessLevel', 'write').checked).toBe(false);
  });

  // A refused state or transition took the typed name with it.
  it('keeps the name of a state or transition the model refuses', async () => {
    const ws = new Workspace();
    await ws.create('http://example.org/Machine/');
    const machine = ws.editor!.addStateMachineType('PumpStateMachineType');
    ws.editor!.addState(machine, 'Idle', 1);
    const running = ws.editor!.addState(machine, 'Running', 2);
    ws.editor!.addTransition(machine, 'Go', 1, running, running);
    // As the app runs an edit: a refusal goes to the status line.
    const refusals: string[] = [];
    act(() => root.render(
      <NodeEditor space={ws.space} editor={ws.editor!} nodeKey={machine}
        run={action => { try { action(); } catch (e) { refusals.push((e as Error).message); } }}
        onOpenType={() => undefined} onCreated={() => undefined} onInstance={() => undefined} />));
    const field = (placeholder: string) => host.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
    const type = (input: HTMLInputElement, value: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const click = (label: string) => act(() => { Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!.click(); });
    const choose = (select: HTMLSelectElement, value: string) => act(() => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    type(field('New state'), 'Idle');
    click('Add state');
    expect(refusals).toHaveLength(1);
    expect(field('New state').value).toBe('Idle');

    type(field('New transition'), 'Go');
    const ends = Array.from(field('New transition').parentElement!.querySelectorAll('select'));
    choose(ends[0], running);
    choose(ends[1], running);
    click('Add transition');
    expect(refusals).toHaveLength(2);
    expect(field('New transition').value).toBe('Go');
  });

  // The ends of a transition could only be changed by removing it and adding it again.
  it('changes the ends and the cause of a transition in place', async () => {
    const ws = new Workspace();
    await ws.create('http://example.org/Machine/');
    const e = ws.editor!;
    const machine = e.addStateMachineType('PumpStateMachineType');
    const start = e.addDeclaration(machine, 'Method', 'Start');
    const idle = e.addState(machine, 'Idle', 1);
    const running = e.addState(machine, 'Running', 2);
    const go = e.addTransition(machine, 'IdleToRunning', 1, idle, running, start);
    show(ws, machine);
    const item = () => Array.from(host.querySelectorAll('ul.machine li')).find(li => li.textContent?.includes('IdleToRunning'))!;
    act(() => (item().querySelector('button[title="Change ends and cause"]') as HTMLButtonElement).click());
    const selects = () => Array.from(item().querySelectorAll('select'));
    expect(selects().map(s => s.value)).toEqual([idle, running, start]);

    act(() => {
      selects()[1].value = idle;
      selects()[1].dispatchEvent(new Event('change', { bubbles: true }));
    });
    show(ws, machine);
    act(() => {
      selects()[2].value = '';
      selects()[2].dispatchEvent(new Event('change', { bubbles: true }));
    });

    const transition = readStateMachine(ws.space, ws.space.get(machine)!).transitions.find(t => t.key === go)!;
    expect([transition.from, transition.to, transition.cause]).toEqual([idle, idle, undefined]);
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
