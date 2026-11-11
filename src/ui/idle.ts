// Work the page does once it is idle, not while it draws: the checks take
// seconds on a large model, and run after every change of the model.

import { useEffect, useRef, useState } from 'react';

type IdleWindow = {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/** Runs work once the browser is idle, at the latest after the timeout; returns what cancels it. */
export function whenIdle(work: () => void, timeout = 300): () => void {
  const w = (typeof window === 'undefined' ? {} : window) as IdleWindow;
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const id = w.requestIdleCallback(work, { timeout });
    return () => w.cancelIdleCallback!(id);
  }
  const id = setTimeout(work, 0);
  return () => clearTimeout(id);
}

/**
 * What `work` returns, worked out once the page is idle after `key` changed;
 * until then what it returned for the key before (`initial` at first). A key
 * that changes again before the page is idle drops the work for the one before.
 */
export function useIdle<T>(work: () => T, key: unknown, initial: T): T {
  const [value, setValue] = useState(initial);
  const latest = useRef(work);
  useEffect(() => { latest.current = work; });
  useEffect(() => whenIdle(() => setValue(latest.current())), [key]);
  return value;
}
