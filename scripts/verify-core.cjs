// Checks that the core build really runs without a browser: it is the entry a
// script uses in Node, so nothing in it may touch window, document or React.
// Run after `npm run build:lib`.

const assert = require('node:assert');
const path = require('node:path');

const core = require(path.join(__dirname, '..', 'dist', 'lib', 'nodeset.core.cjs'));

(async () => {
  const { Workspace, check, readNodeSet, readStateMachine, isStateMachineType } = core;

  const ws = new Workspace();
  await ws.create('http://example.org/Scripted/');
  const editor = ws.editor;

  const valve = editor.addType('ObjectType', 'ValveType');
  editor.addDeclaration(valve, 'Variable', 'Position');

  const type = editor.addStateMachineType('ValveStateMachineType');
  const open = editor.addState(type, 'Open', 1);
  const closed = editor.addState(type, 'Closed', 2);
  editor.addTransition(type, 'OpenToClosed', 1, open, closed);

  const xml = ws.save();
  assert.ok(xml.includes('ValveStateMachineType'), 'the machine is missing from the file');
  assert.deepStrictEqual(check(ws.space, ws.editable), [], 'the model it wrote does not pass its own checks');

  // What it wrote reads back the same way.
  const back = new Workspace();
  await back.open(xml);
  const machine = back.space.get(type);
  assert.ok(isStateMachineType(back.space, machine), 'the machine is not a machine after reading');
  const read = readStateMachine(back.space, machine);
  assert.strictEqual(read.states.length, 2);
  assert.strictEqual(read.transitions.length, 1);
  assert.ok(readNodeSet(xml).nodes.length > 0);

  console.log(`core build runs in Node: ${xml.length} characters, ${read.states.length} states, ${read.transitions.length} transition`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
