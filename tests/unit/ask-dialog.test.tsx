import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { AskDialog } from '../../src/ui/AskDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('The dialog that asks for a name', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement('div'); root = createRoot(host); });
  afterEach(() => act(() => root.unmount()));

  const type = (input: HTMLInputElement, value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // A new type got BaseObjectType and so on; its supertype is chosen with its name now.
  it('asks for a second value, such as the supertype of a new type, and checks it', () => {
    const answers: [string, string | undefined][] = [];
    const closed: boolean[] = [];
    act(() => root.render(<AskDialog onClose={() => closed.push(true)} ask={{
      title: 'Name of the new ObjectType',
      extra: { label: 'Supertype', value: 'BaseObjectType', options: ['BaseObjectType', 'DeviceType'], check: v => (v === 'Nothing' ? 'No such type.' : undefined) },
      onOk: (value, extra) => answers.push([value, extra]),
    }} />));
    const [name, supertype] = Array.from(host.querySelectorAll('input'));
    expect(supertype.value).toBe('BaseObjectType');
    const ok = () => act(() => { Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'OK')!.click(); });

    type(name, 'PumpType');
    type(supertype, 'Nothing');
    ok();
    expect(host.querySelector('[role=alert]')?.textContent).toBe('No such type.');
    expect(answers).toEqual([]);

    type(supertype, 'DeviceType');
    ok();
    expect(answers).toEqual([['PumpType', 'DeviceType']]);
    expect(closed).toEqual([true]);
  });
});
