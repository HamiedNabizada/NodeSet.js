// The keyboard shortcuts of the modeler.

export type Shortcut = 'undo' | 'redo' | 'save' | 'delete';

/** Where the key was pressed: in a text field or list, on the canvas (or nowhere in particular), or elsewhere on the page. */
export type KeyPlace = 'field' | 'canvas' | 'elsewhere';

/**
 * The shortcut a key press asks for. Letters count whatever their case, so
 * Caps Lock does not get in the way; Ctrl+Shift+Z redoes as Ctrl+Y does.
 * Ctrl+S saves wherever the focus is, instead of the browser saving the page;
 * undo and redo leave a field to its own; Delete deletes on the canvas only.
 */
export function shortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey?: boolean }, place: KeyPlace): Shortcut | undefined {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && !e.altKey && key === 's') return 'save';
  if (place === 'field') return undefined;
  if (mod && key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (mod && key === 'y') return 'redo';
  if (!mod && !e.altKey && e.key === 'Delete' && place === 'canvas') return 'delete';
  return undefined;
}

/** Where a key press happened, from its target. */
export function keyPlace(target: EventTarget | null): KeyPlace {
  const element = target instanceof Element ? target : undefined;
  if (element?.closest('input, textarea, select')) return 'field';
  // Clicking the canvas focuses nothing, so its keys reach the page itself.
  if (!element || element === document.body || element === document.documentElement || element.closest('.canvas')) return 'canvas';
  return 'elsewhere';
}
