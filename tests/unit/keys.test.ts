import { shortcut } from '../../src/ui/keys';

const press = (key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  ({ key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: !!mods.alt });

describe('Keyboard shortcuts', () => {
  it('undoes and redoes, Caps Lock or not, and redoes with Ctrl+Shift+Z too', () => {
    expect(shortcut(press('z', { ctrl: true }), 'canvas')).toBe('undo');
    expect(shortcut(press('Z', { ctrl: true }), 'canvas')).toBe('undo'); // Caps Lock
    expect(shortcut(press('Z', { ctrl: true, shift: true }), 'canvas')).toBe('redo');
    expect(shortcut(press('z', { ctrl: true, shift: true }), 'canvas')).toBe('redo'); // Caps Lock and Shift
    expect(shortcut(press('y', { ctrl: true }), 'elsewhere')).toBe('redo');
    expect(shortcut(press('z', { meta: true }), 'canvas')).toBe('undo');
    // A field undoes its own text.
    expect(shortcut(press('z', { ctrl: true }), 'field')).toBeUndefined();
  });

  it('saves with Ctrl+S wherever the focus is, instead of the browser saving the page', () => {
    expect(shortcut(press('s', { ctrl: true }), 'field')).toBe('save');
    expect(shortcut(press('S', { ctrl: true }), 'canvas')).toBe('save');
    expect(shortcut(press('s', { ctrl: true, alt: true }), 'canvas')).toBeUndefined();
    expect(shortcut(press('s'), 'canvas')).toBeUndefined();
  });

  it('deletes with Delete on the canvas only', () => {
    expect(shortcut(press('Delete'), 'canvas')).toBe('delete');
    expect(shortcut(press('Delete'), 'field')).toBeUndefined();
    expect(shortcut(press('Delete'), 'elsewhere')).toBeUndefined();
    expect(shortcut(press('Delete', { ctrl: true }), 'canvas')).toBeUndefined();
  });
});
