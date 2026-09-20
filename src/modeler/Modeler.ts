// The canvas: a diagram-js instance that shows what diagram-model builds.

import Diagram from 'diagram-js';
import MoveCanvasModule from 'diagram-js/lib/navigation/movecanvas';
import ZoomScrollModule from 'diagram-js/lib/navigation/zoomscroll';
import SelectionModule from 'diagram-js/lib/features/selection';
import OutlineModule from 'diagram-js/lib/features/outline';
import ModelingModule from 'diagram-js/lib/features/modeling';
import MoveModule from 'diagram-js/lib/features/move';
import 'diagram-js/assets/diagram-js.css';
import { AddressSpace } from '../nodeset/address-space';
import { buildTypeDiagram, Diagram as TypeDiagram, TypeDiagramOptions } from './diagram-model';
import UaRenderer from './UaRenderer';
import { CanvasActions, canvasEditingModule } from './CanvasEditing';

const RendererModule = {
  __init__: ['uaRenderer'],
  uaRenderer: ['type', UaRenderer],
};

type Canvas = {
  getRootElement(): unknown;
  addShape(shape: unknown, parent?: unknown): unknown;
  addConnection(connection: unknown, parent?: unknown): unknown;
  zoom(level: string | number, center?: unknown): number;
};
type ElementFactory = {
  createShape(attrs: object): unknown;
  createConnection(attrs: object): unknown;
};
type EventBus = { on(event: string, callback: (e: any) => void): void };

export class NodeSetModeler {
  readonly diagram: Diagram;
  current?: TypeDiagram;

  /**
   * @param space the current address space; the workspace replaces it after every change
   * @param actions editing on the canvas; without them the canvas only shows
   */
  constructor(container: HTMLElement, private readonly space: () => AddressSpace, actions?: CanvasActions) {
    this.diagram = new Diagram({
      canvas: { container },
      modules: [RendererModule, SelectionModule, OutlineModule, ModelingModule, MoveModule, MoveCanvasModule, ZoomScrollModule,
        ...(actions ? [canvasEditingModule(actions)] : [])],
    });
  }

  private get<T>(name: string): T {
    return this.diagram.get(name) as T;
  }

  /** Shows a type with its instance declarations. */
  showType(typeKey: string, options?: TypeDiagramOptions): TypeDiagram {
    const model = buildTypeDiagram(this.space(), typeKey, options);
    this.diagram.clear();
    const canvas = this.get<Canvas>('canvas');
    const factory = this.get<ElementFactory>('elementFactory');
    const root = canvas.getRootElement();
    const shapes = new Map<string, unknown>();
    for (const s of model.shapes) {
      shapes.set(s.id, canvas.addShape(factory.createShape({
        id: s.id, x: s.x, y: s.y, width: s.width, height: s.height, businessObject: s,
      }), root));
    }
    for (const l of model.lines) {
      canvas.addConnection(factory.createConnection({
        id: l.id, waypoints: l.waypoints, source: shapes.get(l.source), target: shapes.get(l.target), businessObject: l,
      }), root);
    }
    this.current = model;
    return model;
  }

  /** Fits the diagram into the view; a diagram too tall to read that way is shown at full size from its top. */
  fit(): void {
    const canvas = this.get<Canvas & { viewbox(box?: object): { outer: { width: number; height: number } } }>('canvas');
    const zoom = canvas.zoom('fit-viewport');
    if (zoom < 0.75) {
      const { outer } = canvas.viewbox();
      canvas.viewbox({ x: 0, y: 0, width: outer.width, height: outer.height });
    } else if (zoom > 1.2) {
      canvas.zoom(1.2, 'auto');
    }
  }

  /** Selects the shape of a node, if the diagram shows it. */
  select(nodeKey: string | undefined): void {
    const registry = this.get<{ get(id: string): unknown }>('elementRegistry');
    const selection = this.get<{ select(element: unknown): void }>('selection');
    const element = nodeKey ? registry.get(nodeKey) : undefined;
    selection.select(element ?? null);
  }

  /** Called with the node key of a shape when the user selects or opens it. */
  onSelect(callback: (nodeKey: string | undefined) => void): void {
    this.get<EventBus>('eventBus').on('selection.changed', (e: { newSelection?: { businessObject?: { nodeKey?: string } }[] }) => {
      callback(e.newSelection?.[0]?.businessObject?.nodeKey);
    });
  }

  onOpen(callback: (nodeKey: string) => void): void {
    this.get<EventBus>('eventBus').on('element.dblclick', e => {
      const key = (e.element?.businessObject as { nodeKey?: string } | undefined)?.nodeKey;
      if (key) callback(key);
    });
  }

  /** Called when the user has moved shapes, with each shape's node key and new position. */
  onMoved(callback: (moved: { nodeKey: string; x: number; y: number }[]) => void): void {
    this.get<EventBus>('eventBus').on('commandStack.elements.move.postExecuted', (e: { context: { shapes: { x: number; y: number; businessObject?: { nodeKey?: string } }[] } }) => {
      callback(e.context.shapes
        .filter(s => s.businessObject?.nodeKey)
        .map(s => ({ nodeKey: s.businessObject!.nodeKey!, x: s.x, y: s.y })));
    });
  }

  destroy(): void {
    this.diagram.destroy();
  }
}
