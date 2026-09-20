// Draws nodes and references as OPC 10000-3 Annex C prescribes (Tables C.1
// and C.2). Colours are not part of the notation; they only mark what
// belongs to another model and what is selected.

import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import { append as svgAppend, attr as svgAttr, create as svgCreate } from 'tiny-svg';
import type { DiagramLine, DiagramShape } from './diagram-model';

type Point = { x: number; y: number };
type ShapeElement = { width: number; height: number; businessObject?: unknown };
type LineElement = { waypoints: Point[]; businessObject?: unknown };

const INK = '#1f2328';
const PAPER = '#ffffff';
const EXTERNAL = '#eef1f4';
const SHADOW = '#9aa4ae';
const SHADOW_OFFSET = 4;

export default class UaRenderer extends BaseRenderer {
  static $inject = ['eventBus'];

  constructor(eventBus: unknown) {
    super(eventBus as never, 2000);
  }

  override canRender(element: { businessObject?: unknown }): boolean {
    return !!element.businessObject;
  }

  override drawShape(parent: SVGElement, element: ShapeElement): SVGElement {
    const s = element.businessObject as DiagramShape;
    const w = element.width;
    const h = element.height;
    const fill = s.external ? EXTERNAL : PAPER;
    if (s.isType) svgAppend(parent, outline(s, w, h, { fill: SHADOW, stroke: 'none', dx: SHADOW_OFFSET, dy: SHADOW_OFFSET }));
    const body = outline(s, w, h, { fill, stroke: INK });
    svgAppend(parent, body);

    const lines = s.typeLabel ? [s.label, s.typeLabel] : [s.label];
    lines.forEach((content, i) => {
      const t = svgCreate('text');
      svgAttr(t, {
        x: w / 2,
        y: h / 2 + (i - (lines.length - 1) / 2) * 15 + 4,
        'text-anchor': 'middle',
        'font-family': 'Segoe UI, Arial, sans-serif',
        'font-size': i === 0 ? 13 : 11,
        // Table C.1: types in italic, instances upright; C.2.3: the TypeDefinition line in italic.
        'font-style': s.isType || i > 0 ? 'italic' : 'normal',
        fill: i === 0 ? INK : '#57606a',
      });
      t.textContent = fit(content, w - 16, i === 0 ? 13 : 11);
      svgAppend(parent, t);
    });
    return body;
  }

  override drawConnection(parent: SVGElement, element: LineElement): SVGElement {
    const l = element.businessObject as DiagramLine;
    const pts = element.waypoints;
    const path = svgCreate('polyline');
    svgAttr(path, { points: pts.map(p => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: INK, 'stroke-width': 1.2 });
    svgAppend(parent, path);

    const end = pts[pts.length - 1];
    const beforeEnd = pts[pts.length - 2];
    const start = pts[0];
    const afterStart = pts[1];
    switch (l.kind) {
      case 'HasComponent':
        hash(parent, beforeEnd, end, [10]);
        break;
      case 'HasProperty':
        hash(parent, beforeEnd, end, [10, 15]);
        break;
      case 'HasTypeDefinition':
        arrow(parent, beforeEnd, end, 0, true);
        arrow(parent, beforeEnd, end, 9, true);
        break;
      case 'HasSubtype':
        // The double closed arrows point to the SourceNode.
        arrow(parent, afterStart, start, 0, false);
        arrow(parent, afterStart, start, 9, false);
        break;
      case 'Hierarchical':
        openArrow(parent, beforeEnd, end);
        break;
      case 'NonHierarchical':
        arrow(parent, beforeEnd, end, 0, true);
        break;
      case 'Symmetric':
        arrow(parent, beforeEnd, end, 0, true);
        arrow(parent, afterStart, start, 0, true);
        break;
    }
    if (l.label) label(parent, midpoint(pts), l.label, true);
    // Table C.3: the cardinality near the held node, clear of the hash strokes.
    if (l.cardinality) label(parent, { x: end.x - 22, y: end.y - 2 }, l.cardinality, false, 'end');
    return path;
  }

  override getShapePath(element: { x: number; y: number; width: number; height: number }): string {
    const { x, y, width, height } = element;
    return `M${x},${y}h${width}v${height}h${-width}z`;
  }

  override getConnectionPath(element: { waypoints: Point[] }): string {
    return element.waypoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join('');
  }
}

/** The outline of a node by NodeClass (Table C.1). */
function outline(s: DiagramShape, w: number, h: number, style: { fill: string; stroke: string; dx?: number; dy?: number }): SVGElement {
  const dx = style.dx ?? 0;
  const dy = style.dy ?? 0;
  const common = { fill: style.fill, stroke: style.stroke, 'stroke-width': 1.3, transform: `translate(${dx},${dy})` };
  const polygon = (points: [number, number][]) => {
    const p = svgCreate('polygon');
    svgAttr(p, { ...common, points: points.map(([a, b]) => `${a},${b}`).join(' ') });
    return p;
  };
  switch (s.nodeClass) {
    case 'Object':
    case 'ObjectType': {
      const r = svgCreate('rect');
      svgAttr(r, { ...common, width: w, height: h });
      return r;
    }
    case 'Variable':
    case 'VariableType': {
      const r = svgCreate('rect');
      svgAttr(r, { ...common, width: w, height: h, rx: 12, ry: 12 });
      return r;
    }
    case 'Method': {
      const e = svgCreate('ellipse');
      svgAttr(e, { ...common, cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 });
      return e;
    }
    case 'DataType':
      return polygon([[14, 0], [w - 14, 0], [w, h / 2], [w - 14, h], [14, h], [0, h / 2]]);
    case 'ReferenceType':
      // Six corners as well, set apart from DataType by the notched left side.
      return polygon([[0, 0], [w - 14, 0], [w, h / 2], [w - 14, h], [0, h], [14, h / 2]]);
    case 'View':
      return polygon([[16, 0], [w - 16, 0], [w, h], [0, h]]);
  }
}

function unit(from: Point, to: Point): { ux: number; uy: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { ux: dx / len, uy: dy / len };
}

/** Short strokes across the line, at the given distances from its end. */
function hash(parent: SVGElement, from: Point, to: Point, distances: number[]) {
  const { ux, uy } = unit(from, to);
  for (const d of distances) {
    const cx = to.x - ux * d;
    const cy = to.y - uy * d;
    const l = svgCreate('line');
    svgAttr(l, { x1: cx - uy * 6, y1: cy + ux * 6, x2: cx + uy * 6, y2: cy - ux * 6, stroke: INK, 'stroke-width': 1.3 });
    svgAppend(parent, l);
  }
}

/** A closed arrow head pointing at `to`, set back by `offset`; filled or hollow. */
function arrow(parent: SVGElement, from: Point, to: Point, offset: number, filled: boolean) {
  const { ux, uy } = unit(from, to);
  const tipX = to.x - ux * offset;
  const tipY = to.y - uy * offset;
  const baseX = tipX - ux * 9;
  const baseY = tipY - uy * 9;
  const p = svgCreate('polygon');
  svgAttr(p, {
    points: `${tipX},${tipY} ${baseX - uy * 4.5},${baseY + ux * 4.5} ${baseX + uy * 4.5},${baseY - ux * 4.5}`,
    fill: filled ? INK : PAPER,
    stroke: INK,
    'stroke-width': 1.1,
  });
  svgAppend(parent, p);
}

function openArrow(parent: SVGElement, from: Point, to: Point) {
  const { ux, uy } = unit(from, to);
  const baseX = to.x - ux * 10;
  const baseY = to.y - uy * 10;
  const p = svgCreate('polyline');
  svgAttr(p, {
    points: `${baseX - uy * 5},${baseY + ux * 5} ${to.x},${to.y} ${baseX + uy * 5},${baseY - ux * 5}`,
    fill: 'none',
    stroke: INK,
    'stroke-width': 1.3,
  });
  svgAppend(parent, p);
}

function label(parent: SVGElement, at: Point, content: string, italic: boolean, anchor: 'start' | 'end' = 'start') {
  const x = anchor === 'start' ? at.x + 4 : at.x;
  const y = at.y - 4;
  // A line of a reference crosses other nodes on a full diagram. The label
  // keeps a sheet of its own underneath, so it stays readable over them.
  const width = content.length * 5.7 + 4;
  const sheet = svgCreate('rect');
  svgAttr(sheet, {
    x: (anchor === 'start' ? x : x - width) - 2,
    y: y - 9,
    width,
    height: 12,
    fill: '#ffffff',
    'fill-opacity': 0.85,
  });
  svgAppend(parent, sheet);
  const t = svgCreate('text');
  svgAttr(t, {
    x,
    y,
    'text-anchor': anchor,
    'font-family': 'Segoe UI, Arial, sans-serif',
    'font-size': 11,
    'font-style': italic ? 'italic' : 'normal',
    fill: '#57606a',
  });
  t.textContent = content;
  svgAppend(parent, t);
}

/**
 * Where the name of a reference goes: the middle of its longest straight
 * piece, which is the part with room for it. On the middle of the whole line
 * it would land on a corner, or on a node the line passes.
 */
function midpoint(pts: Point[]): Point {
  let best = { a: pts[0], b: pts[1] ?? pts[0], length: -1 };
  for (let i = 0; i + 1 < pts.length; i++) {
    const length = Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    if (length > best.length) best = { a: pts[i], b: pts[i + 1], length };
  }
  return { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 };
}

/** Shortens a label to about the width available (no text measuring outside the browser). */
function fit(content: string, width: number, size: number): string {
  const max = Math.floor(width / (size * 0.55));
  return content.length > max ? content.slice(0, Math.max(1, max - 1)) + '…' : content;
}
