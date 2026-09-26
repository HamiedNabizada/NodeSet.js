import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { uaKey } from '../../src/nodeset/model';
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
});
