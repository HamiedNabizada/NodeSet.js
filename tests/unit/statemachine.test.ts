import { RULE, SM } from '../../src/nodeset/address-space';
import { check } from '../../src/nodeset/checks';
import { EditError } from '../../src/nodeset/edit';
import { UA_NAMESPACE, uaKey } from '../../src/nodeset/model';
import { isStateMachineType, nextNumber, readStateMachine, stateChartSvg } from '../../src/nodeset/statemachine';
import { Workspace } from '../../src/workspace';

/** A machine with Idle and Running, and Start from one to the other. */
async function machine() {
  const ws = new Workspace();
  await ws.create('http://example.org/Machine/');
  const e = ws.editor!;
  const type = e.addStateMachineType('PumpStateMachineType');
  const start = e.addDeclaration(type, 'Method', 'Start');
  const idle = e.addState(type, 'Idle', 1);
  const running = e.addState(type, 'Running', 2);
  const toRunning = e.addTransition(type, 'IdleToRunning', 1, idle, running, start);
  return { ws, e, type, idle, running, start, toRunning };
}

describe('Finite state machines', () => {
  it('writes states and transitions as OPC 10000-5 does, and reads them back', async () => {
    const { ws, type, idle, running, start, toRunning } = await machine();
    const space = ws.space;

    expect(isStateMachineType(space, space.get(type)!)).toBe(true);
    expect(space.supertypeKey(type)).toBe(SM.FiniteStateMachineType);
    const read = readStateMachine(space, space.get(type)!);
    expect(read.states.map(s => [s.name, s.number])).toEqual([['Idle', 1], ['Running', 2]]);
    expect(read.transitions).toEqual([{ key: toRunning, name: 'IdleToRunning', number: 1, from: idle, to: running, cause: start, causeName: 'Start' }]);
    expect(nextNumber(read.states)).toBe(3);

    // The nodes themselves: type definitions, the numbers as UA properties, both ends of the reference.
    expect(space.typeDefinition(space.get(idle)!)!.id).toBe(SM.StateType);
    expect(space.typeDefinition(space.get(toRunning)!)!.id).toBe(SM.TransitionType);
    const number = space.children(space.get(idle)!)[0].node;
    expect(number.browseName).toEqual({ namespaceUri: UA_NAMESPACE, name: 'StateNumber' });
    expect(number.dataType).toBe(uaKey(7));
    expect(space.out(number.id, uaKey(37)).map(e => e.target)).toContain(RULE.Mandatory);
    expect(space.in(running, SM.ToState, false).map(e => e.source)).toEqual([toRunning]);
    // States and transitions carry no ModellingRule of their own, as the base model's machines show.
    expect(space.modellingRule(space.get(idle)!)).toBeUndefined();
    expect(check(space, ws.editable!)).toEqual([]);
  });

  it('survives saving and reading the file', async () => {
    const { ws, type } = await machine();

    const back = new Workspace();
    await back.open(ws.save());
    const read = readStateMachine(back.space, back.space.get(type)!);

    expect(read.states.map(s => s.name)).toEqual(['Idle', 'Running']);
    expect(read.transitions[0].causeName).toBe('Start');
  });

  it('refuses ends that are no states and a cause that is no method', async () => {
    const { e, type, idle, running } = await machine();

    expect(() => e.addTransition(type, 'Bad', 2, idle, type)).toThrow(EditError);
    expect(() => e.addTransition(type, 'Bad', 2, idle, running, idle)).toThrow(/no method/);
    expect(() => e.addState('http://example.org/Machine/|i=9999', 'X', 1)).toThrow(EditError);
  });

  it('finds a transition without ends and numbers given twice', async () => {
    const { ws, e, type, idle, running } = await machine();
    const loose = e.addTransition(type, 'Loose', 2, idle, running);
    e.setTransition(loose, { to: undefined });
    e.addState(type, 'Fault', 1);

    const findings = check(ws.space, ws.editable!).map(f => f.rule);

    expect(findings).toContain('M020');
    expect(findings).toContain('M021');
  });

  it('draws the machine as a state chart', async () => {
    const { ws, type } = await machine();

    const svg = stateChartSvg(readStateMachine(ws.space, ws.space.get(type)!));

    expect(svg).toContain('<svg');
    expect(svg).toContain('>Idle<');
    expect(svg).toContain('>Running<');
    expect(svg).toContain('IdleToRunning / Start()');
    expect(svg.match(/<line /g)).toHaveLength(1);
  });

  it('draws the way there and the way back apart', async () => {
    // On one line the two cover each other, and one name hides the other.
    const { ws, e, type, idle, running } = await machine();
    e.addTransition(type, 'RunningToIdle', 2, running, idle);

    const svg = stateChartSvg(readStateMachine(ws.space, ws.space.get(type)!));

    expect(svg.match(/<line /g)).toBeNull();
    expect(svg.match(/ Q /g)).toHaveLength(2);
    const places = [...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>(IdleToRunning[^<]*|RunningToIdle)</g)]
      .map(m => `${m[1]},${m[2]}`);
    expect(places).toHaveLength(2);
    expect(new Set(places).size).toBe(2);
  });
});
