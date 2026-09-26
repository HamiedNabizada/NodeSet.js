import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Guard } from '../../src/ui/Guard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let failing = true;
function Part() {
  if (failing) throw new Error('the node has no BrowseName');
  return <p>drawn</p>;
}

describe('A guarded part of the modeler', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    failing = true;
    host = document.createElement('div');
    root = createRoot(host);
    // React reports every error a boundary catches; here that is the point.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); });

  const render = (node: JSX.Element) => act(() => root.render(node));
  const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text);

  it('says what went wrong instead of taking the page with it', () => {
    render(<div><h1>toolbar</h1><Guard name="node editor"><Part /></Guard></div>);
    expect(host.querySelector('h1')?.textContent).toBe('toolbar');
    expect(host.querySelector('[role=alert]')?.textContent).toContain('The node editor stopped: the node has no BrowseName');
  });

  it('shows the part again when asked to', () => {
    render(<Guard name="node editor"><Part /></Guard>);
    failing = false;
    act(() => button('Try again')!.click());
    expect(host.textContent).toBe('drawn');
  });

  it('shows the part again when its key changes, as for another node', () => {
    render(<Guard name="node editor" resetKey="a"><Part /></Guard>);
    failing = false;
    render(<Guard name="node editor" resetKey="b"><Part /></Guard>);
    expect(host.textContent).toBe('drawn');
  });

  it('offers what the host of the part can still do, asked when it fails', () => {
    let saved = 0;
    let open = false;
    render(<Guard name="modeler" actions={() => open && <button onClick={() => saved++}>Save NodeSet</button>}><Part /></Guard>);
    expect(button('Save NodeSet')).toBeUndefined();

    open = true;
    act(() => button('Try again')!.click());
    act(() => button('Save NodeSet')!.click());
    expect(saved).toBe(1);
  });
});
