// The checks run on every change and feed both the toolbar and the list of
// findings. They run in the modeler, not inside the list's error boundary, so
// a check that throws is caught here and shown as what it is, instead of
// taking the whole modeler with it.

import { Finding } from '../nodeset/checks';

export interface Checked {
  findings: Finding[];
  /** Set when the checks stopped; the findings are then empty. */
  error?: string;
}

export function runChecks(checks: () => Finding[]): Checked {
  try {
    return { findings: checks() };
  } catch (e) {
    return { findings: [], error: `The checks stopped: ${e instanceof Error ? e.message : String(e)}` };
  }
}
