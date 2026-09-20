// The NodeSet layer on its own: reading and writing NodeSet2, the address
// space, the editor, the checks and the workspace, with no canvas, no React
// and no stylesheet. This is the entry a script uses, in a page or in Node,
// to build or change a NodeSet without a window.
//
// The entry beside it (index.ts) adds the canvas and the app, and needs a
// browser. Everything here works in both.

export * from './nodeset/model';
export { readNodeSet, NodeSetFormatError } from './nodeset/reader';
export { writeNodeSet } from './nodeset/writer';
export { AddressSpace, REF, RULE, SM } from './nodeset/address-space';
export type { Edge, LoadedFile } from './nodeset/address-space';
export { ModelEditor, EditError, newModel } from './nodeset/edit';
export type { DeclarationKind, InstantiateOptions } from './nodeset/edit';
export { check, RULES } from './nodeset/checks';
export type { Finding, Severity } from './nodeset/checks';
export { readLayout, writeLayout, LAYOUT_NAMESPACE } from './nodeset/layout';
export type { Layout, Position } from './nodeset/layout';
export { isStateMachineType, readStateMachine, nextNumber, stateChartSvg } from './nodeset/statemachine';
export type { MachineState, MachineTransition, StateMachine } from './nodeset/statemachine';
export { parseSignals, addSignals } from './nodeset/csv';
export type { SignalRow } from './nodeset/csv';
export { Workspace } from './workspace';
