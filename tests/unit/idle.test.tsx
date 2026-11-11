import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { useIdle } from '../../src/ui/idle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The checks ran inside the render after every change, moving a shape included:
// seconds on a large model before the page answered again.
describe('Work done once the page is idle', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement('div'); root = createRoot(host); });
  afterEach(() => act(() => root.unmount()));

  const idle = () => act(() => new Promise(resolve => setTimeout(resolve, 50)));

  it('runs after the render, once per key, and shows the last result meanwhile', async () => {
    const work = vi.fn((key: number) => `checked ${key}`);
    function Probe({ k, other }: { k: number; other: string }) {
      const value = useIdle(() => work(k), k, 'not yet');
      return <span>{value} {other}</span>;
    }

    act(() => root.render(<Probe k={1} other="a" />));
    expect(work).not.toHaveBeenCalled();
    expect(host.textContent).toBe('not yet a');
    await idle();
    expect(host.textContent).toBe('checked 1 a');

    // Something else changes, such as where a shape is: no work.
    act(() => root.render(<Probe k={1} other="b" />));
    await idle();
    expect(work).toHaveBeenCalledTimes(1);

    // Two keys in a row before the page is idle: only the last is worked out.
    act(() => root.render(<Probe k={2} other="b" />));
    act(() => root.render(<Probe k={3} other="b" />));
    expect(host.textContent).toBe('checked 1 b');
    await idle();
    expect(work.mock.calls.map(c => c[0])).toEqual([1, 3]);
    expect(host.textContent).toBe('checked 3 b');
  });
});
