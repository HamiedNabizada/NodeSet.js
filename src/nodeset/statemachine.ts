// Reading a finite state machine out of the model (OPC 10000-5 Annex B), and
// drawing it: the states and transitions a machine type holds as components,
// with their numbers, their ends (FromState, ToState) and the method that
// causes each transition (HasCause). The editor writes them (addState,
// addTransition); this side only looks and draws.

import { AddressSpace, SM } from './address-space';
import { text, UaNode } from './model';
import { valueText } from './values';

export interface MachineState {
  key: string;
  name: string;
  number?: number;
}

export interface MachineTransition {
  key: string;
  name: string;
  number?: number;
  from?: string;
  to?: string;
  cause?: string;
  causeName?: string;
}

export interface StateMachine {
  states: MachineState[];
  transitions: MachineTransition[];
}

/** Whether the node is a type of a finite state machine. */
export function isStateMachineType(space: AddressSpace, node: UaNode): boolean {
  return node.nodeClass === 'ObjectType' && space.isSubtypeOf(node.id, SM.FiniteStateMachineType) && node.id !== SM.FiniteStateMachineType;
}

/** The states and transitions the type holds, including the ones it inherits. */
export function readStateMachine(space: AddressSpace, type: UaNode): StateMachine {
  const states: MachineState[] = [];
  const transitions: MachineTransition[] = [];
  const seen = new Set<string>();
  for (const t of space.typeChain(type)) {
    for (const { node } of space.children(t)) {
      if (seen.has(node.browseName.name)) continue;
      const definition = space.typeDefinition(node)?.id;
      if (definition && space.isSubtypeOf(definition, SM.StateType)) {
        seen.add(node.browseName.name);
        states.push({ key: node.id, name: label(node), number: numberOf(space, node, SM.StateNumber) });
      } else if (definition && space.isSubtypeOf(definition, SM.TransitionType)) {
        seen.add(node.browseName.name);
        const cause = space.out(node.id, SM.HasCause, false)[0]?.target;
        transitions.push({
          key: node.id,
          name: label(node),
          number: numberOf(space, node, SM.TransitionNumber),
          from: space.out(node.id, SM.FromState, false)[0]?.target,
          to: space.out(node.id, SM.ToState, false)[0]?.target,
          cause,
          causeName: cause ? label(space.get(cause)) : undefined,
        });
      }
    }
  }
  states.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  transitions.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  return { states, transitions };
}

/** The next free number, so states and transitions are counted as the model counts them. */
export function nextNumber(items: { number?: number }[]): number {
  return items.reduce((max, i) => Math.max(max, i.number ?? 0), 0) + 1;
}

function numberOf(space: AddressSpace, node: UaNode, property: string): number | undefined {
  const p = space.children(node).find(c => c.node.browseName.name === property)?.node;
  const value = p ? valueText(p, 'UInt32') : undefined;
  return value ? Number(value) : undefined;
}

function label(node: UaNode | undefined): string {
  return node ? text(node.displayName) || node.browseName.name : '';
}

/**
 * The machine as an SVG state chart: states on a circle, transitions as
 * arrows between them with their name, a transition back to its own state as
 * a small loop. Drawn as geometry, so it survives an export and needs no ids.
 */
export function stateChartSvg(machine: StateMachine, size = 420): string {
  const { states, transitions } = machine;
  if (states.length === 0) return '';
  const radius = size / 2 - 60;
  const centre = size / 2;
  const box = { width: 96, height: 30 };
  const places = new Map<string, { x: number; y: number }>();
  states.forEach((s, i) => {
    const angle = (2 * Math.PI * i) / states.length - Math.PI / 2;
    places.set(s.key, { x: centre + radius * Math.cos(angle), y: centre + radius * Math.sin(angle) });
  });

  const parts: string[] = [];
  parts.push('<defs><marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
    + '<path d="M 0 0 L 10 5 L 0 10 z" fill="#57606a"/></marker></defs>');
  for (const t of transitions) {
    const from = t.from ? places.get(t.from) : undefined;
    const to = t.to ? places.get(t.to) : undefined;
    if (!from || !to) continue;
    if (t.from === t.to) {
      const loop = `M ${from.x - 18} ${from.y - box.height / 2} A 22 22 0 1 1 ${from.x + 18} ${from.y - box.height / 2}`;
      parts.push(`<path d="${loop}" fill="none" stroke="#57606a" marker-end="url(#sm-arrow)"/>`);
      parts.push(label_(from.x, from.y - box.height / 2 - 30, t.name, t.causeName));
      continue;
    }
    const [a, b] = [edgePoint(from, to, box), edgePoint(to, from, box)];
    parts.push(`<line x1="${round(a.x)}" y1="${round(a.y)}" x2="${round(b.x)}" y2="${round(b.y)}" stroke="#57606a" marker-end="url(#sm-arrow)"/>`);
    parts.push(label_((a.x + b.x) / 2, (a.y + b.y) / 2 - 4, t.name, t.causeName));
  }
  for (const s of states) {
    const p = places.get(s.key)!;
    parts.push(`<rect x="${round(p.x - box.width / 2)}" y="${round(p.y - box.height / 2)}" width="${box.width}" height="${box.height}" rx="14"`
      + ' fill="#ffffff" stroke="#1f2328"/>');
    parts.push(`<text x="${round(p.x)}" y="${round(p.y + 4)}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="12">${escape(s.name)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${parts.join('')}</svg>`;
}

/** Where a line from one state to another leaves the first one's box. */
function edgePoint(from: { x: number; y: number }, to: { x: number; y: number }, box: { width: number; height: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const scale = Math.min(dx === 0 ? Infinity : box.width / 2 / Math.abs(dx), dy === 0 ? Infinity : box.height / 2 / Math.abs(dy));
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

function label_(x: number, y: number, name: string, cause?: string): string {
  const shown = cause ? `${name} / ${cause}()` : name;
  return `<text x="${round(x)}" y="${round(y)}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="11" fill="#57606a">${escape(shown)}</text>`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
