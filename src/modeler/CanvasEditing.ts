// Editing on the canvas: a context pad on the shapes of the edited model
// (add a child, draw a reference, delete) and drawing references by
// dragging. The canvas only asks; the application decides and changes the
// model through its editor, after which the diagram is rebuilt.

import ContextPadModule from 'diagram-js/lib/features/context-pad';
import ConnectModule from 'diagram-js/lib/features/connect';
import RulesModule from 'diagram-js/lib/features/rules';
import RuleProvider from 'diagram-js/lib/features/rules/RuleProvider';
import type { DeclarationKind } from '../nodeset/edit';

/** What the canvas can ask the application to do, by node key. */
export interface CanvasActions {
  /** Whether the node belongs to the model being edited. */
  isOwn(nodeKey: string): boolean;
  /** Whether the node can hold instance declarations (types, objects, variables). */
  canHoldChildren(nodeKey: string): boolean;
  addChild(nodeKey: string, kind: DeclarationKind): void;
  addReference(sourceKey: string, targetKey: string): void;
  remove(nodeKey: string): void;
}

type Shape = { businessObject?: { nodeKey?: string } };
const keyOf = (e: Shape | undefined) => e?.businessObject?.nodeKey;

const CHILDREN: [DeclarationKind, string, string][] = [
  ['Variable', 'V', 'Add a variable (HasComponent)'],
  ['Property', 'P', 'Add a property (HasProperty)'],
  ['Object', 'O', 'Add an object (HasComponent)'],
  ['Method', 'M', 'Add a method (HasComponent)'],
];

class UaContextPadProvider {
  static $inject = ['contextPad', 'connect', 'uaActions'];

  constructor(contextPad: { registerProvider(p: unknown): void }, private readonly connect: { start(e: Event, s: unknown, auto?: boolean): void },
    private readonly actions: CanvasActions) {
    contextPad.registerProvider(this);
  }

  getContextPadEntries(element: Shape) {
    const key = keyOf(element);
    if (!key || !this.actions.isOwn(key)) return {};
    const entries: Record<string, unknown> = {};
    if (this.actions.canHoldChildren(key)) {
      for (const [kind, glyph, title] of CHILDREN) {
        entries[`add-${kind}`] = {
          group: 'add',
          html: `<div class="entry ua-pad" draggable="true">${glyph}</div>`,
          title,
          action: { click: () => this.actions.addChild(key, kind) },
        };
      }
    }
    entries.reference = {
      group: 'connect',
      html: '<div class="entry ua-pad" draggable="true">→</div>',
      title: 'Draw a reference to another node',
      action: {
        click: (event: Event, target: unknown) => this.connect.start(event, target),
        dragstart: (event: Event, target: unknown) => this.connect.start(event, target),
      },
    };
    entries.delete = {
      group: 'edit',
      html: '<div class="entry ua-pad" draggable="true">×</div>',
      title: 'Delete the node and what it holds',
      action: { click: () => this.actions.remove(key) },
    };
    return entries;
  }
}

/** A reference may start at a node of the edited model and end at any node. */
class UaRules extends RuleProvider {
  static override $inject = ['eventBus', 'uaActions'];

  constructor(eventBus: unknown, private readonly actions: CanvasActions) {
    super(eventBus as never);
  }

  override init() {
    this.addRule('connection.create', (context: { source?: Shape; target?: Shape }) => {
      const source = keyOf(context.source);
      const target = keyOf(context.target);
      return !!source && !!target && source !== target && this.actions.isOwn(source);
    });
  }
}

/** Turns a finished drag into a request for a reference instead of a drawn line. */
function ReferenceOnConnect(eventBus: { on(e: string, p: number, f: (ev: { context: { source?: Shape; target?: Shape; canExecute?: unknown } }) => unknown): void },
  actions: CanvasActions) {
  eventBus.on('connect.end', 1500, event => {
    const { source, target, canExecute } = event.context;
    const s = keyOf(source);
    const t = keyOf(target);
    if (canExecute && s && t) actions.addReference(s, t);
    return false;
  });
}
ReferenceOnConnect.$inject = ['eventBus', 'uaActions'];

export function canvasEditingModule(actions: CanvasActions) {
  return {
    __depends__: [ContextPadModule, ConnectModule, RulesModule],
    __init__: ['uaContextPadProvider', 'uaRules', 'uaReferenceOnConnect'],
    uaActions: ['value', actions],
    uaContextPadProvider: ['type', UaContextPadProvider],
    uaRules: ['type', UaRules],
    uaReferenceOnConnect: ['type', ReferenceOnConnect],
  };
}
