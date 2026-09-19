// The sections of the node editor (arguments, fields, structure values) keep
// a draft until Apply. Selecting another node would drop a draft silently;
// the sections register theirs here, and the app asks before leaving them.

import { useEffect } from 'react';

const pending = new Set<string>();

/** Registers a section's draft while it differs from the model. */
export function useDraft(name: string, changed: boolean): void {
  useEffect(() => {
    if (changed) pending.add(name);
    else pending.delete(name);
    return () => { pending.delete(name); };
  }, [name, changed]);
}

/** The sections whose drafts are not applied. */
export function pendingDrafts(): string[] {
  return [...pending];
}

/** True when there is no draft, or the user agrees to drop the drafts. */
export function mayLeaveDrafts(ask: (message: string) => boolean = m => window.confirm(m)): boolean {
  const names = pendingDrafts();
  if (names.length === 0) return true;
  if (!ask(`${names.join(', ')}: changes not applied yet. Drop them?`)) return false;
  pending.clear();
  return true;
}
