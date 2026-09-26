import { REF } from '../../src/nodeset/address-space';
import { Workspace } from '../../src/workspace';

async function renamed(times: number) {
  const ws = new Workspace();
  await ws.create('http://example.org/Undo/');
  const editor = ws.editor!;
  const type = editor.addType('ObjectType', 'T0');
  for (let i = 1; i <= times; i++) editor.rename(type, `T${i}`);
  return { ws, editor, type };
}

const name = (ws: Workspace, key: string) => ws.space.get(key)!.browseName.name;
const file = (ws: Workspace) => JSON.stringify(ws.editable!.nodes);

describe('Undo', () => {
  it('keeps the last 100 steps and drops the oldest', async () => {
    const { ws, editor, type } = await renamed(110);
    let steps = 0;
    while (editor.canUndo) { editor.undo(); steps++; }

    expect(steps).toBe(100);
    expect(name(ws, type)).toBe('T10');
  });

  // A step used to be a copy of the whole file: 23 MB for Pumps.
  it('keeps only what a step changed, however large the model', async () => {
    const ws = new Workspace();
    await ws.create('http://example.org/Large/');
    const editor = ws.editor!;
    const types = editor.batch(() => Array.from({ length: 2000 }, (_, i) => editor.addType('ObjectType', `Type${i}`)));
    const one = JSON.stringify(ws.space.get(types[0])).length;

    for (let i = 0; i < 100; i++) editor.rename(types[i % 10], `Renamed${i}`);

    expect(editor.undoCharacters).toBeLessThan(100 * 4 * one);
    let steps = 0;
    while (editor.canUndo) { editor.undo(); steps++; }
    expect(steps).toBe(100);
  });

  it('brings a deleted node back where it was, with the references to it', async () => {
    const { ws, editor, type } = await renamed(0);
    const other = editor.addType('ObjectType', 'Other');
    const valve = editor.addType('ObjectType', 'Valve');
    editor.addReference(type, REF.HasComponent, other);
    const before = file(ws);

    editor.delete(other);
    expect(ws.space.get(other)).toBeUndefined();
    editor.undo();

    expect(file(ws)).toBe(before);
    expect(ws.space.out(type, REF.HasComponent).map(e => e.target)).toContain(other);
    expect(ws.editable!.nodes.map(n => n.id).indexOf(valve)).toBeGreaterThan(ws.editable!.nodes.map(n => n.id).indexOf(other));
  });

  it('does again what was undone', async () => {
    const { ws, editor, type } = await renamed(2);
    const after = file(ws);

    editor.undo();
    editor.undo();
    editor.redo();
    editor.redo();

    expect(file(ws)).toBe(after);
    expect(name(ws, type)).toBe('T2');
    expect(editor.canRedo).toBe(false);
  });

  it('takes back a change of the model itself: version and date', async () => {
    const { ws, editor } = await renamed(0);
    const model = () => ({ ...ws.editable!.models[0] });
    const before = model();

    editor.setModelInfo('2.0.0', '2026-09-27T00:00:00Z');
    expect(model().version).toBe('2.0.0');
    editor.undo();

    expect(model()).toEqual(before);
  });

  it('leaves the file as it was after a change that fails, and keeps no step for it', async () => {
    const { ws, editor, type } = await renamed(1);
    const before = file(ws);

    expect(() => editor.rename(type, '')).toThrow();

    expect(file(ws)).toBe(before);
    editor.undo();
    expect(name(ws, type)).toBe('T0');
  });

  it('takes a batch back whole', async () => {
    const { ws, editor, type } = await renamed(100);
    editor.batch(() => {
      editor.rename(type, 'A');
      editor.rename(type, 'B');
      editor.rename(type, 'C');
    });

    editor.undo();
    expect(name(ws, type)).toBe('T100');
    editor.undo();
    expect(name(ws, type)).toBe('T99');
  });

  it('keeps nothing of a batch that fails', async () => {
    const { ws, editor, type } = await renamed(1);
    const before = file(ws);

    expect(() => editor.batch(() => {
      editor.rename(type, 'A');
      editor.addType('ObjectType', 'Half');
      editor.rename(type, '');
    })).toThrow();

    expect(file(ws)).toBe(before);
    editor.undo();
    expect(name(ws, type)).toBe('T0');
  });
});
