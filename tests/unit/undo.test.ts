import { undoLimit } from '../../src/nodeset/edit';
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

describe('Undo', () => {
  // Every step keeps a copy of the whole file: 1.5 MB for MachineVision, 23 MB for Pumps.
  it('keeps fewer steps the larger the model, so memory stays bounded', () => {
    expect(undoLimit(790)).toBe(100);
    expect(undoLimit(9624)).toBe(20);
    expect(undoLimit(1_000_000)).toBe(10);
  });

  it('keeps the last steps up to the limit and drops the oldest', async () => {
    const { ws, editor, type } = await renamed(110);
    let steps = 0;
    while (editor.canUndo) { editor.undo(); steps++; }

    expect(steps).toBe(100);
    expect(name(ws, type)).toBe('T10');
  });

  it('takes a batch back whole when the limit is reached inside it', async () => {
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
});
