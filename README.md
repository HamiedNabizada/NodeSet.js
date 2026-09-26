# NodeSet.js

A graphical modeler for OPC UA information models. Types and instances are
drawn in the notation of OPC 10000-3 Annex C and stored as NodeSet2 files,
with nothing in between: the file it opens and the file it writes are the
NodeSets every other OPC UA tool reads. It runs in the browser on its own, and
it embeds: the AutomationML Editor plugin [AMLOpcUa](https://github.com/hsu-aut/AMLOpcUa) hosts it and
connects the models to AutomationML (OPC 10000-83 Annex A, AML-UA-XSLT rules)
and to VDI 3682 process descriptions.

What it does: types (ObjectTypes, VariableTypes, DataTypes with fields,
encodings, enumeration values, OptionSets and unions, ReferenceTypes), instance declarations with
ModellingRules, values (built-in types and simple structures), method arguments, references, instances by
ModellingRule, models built on DI or other loaded models with their
RequiredModels kept, checks against OPC 10000-3, undo, editing from the
canvas's context pad, and diagram positions kept in the NodeSet.
Inside the AutomationML Editor it runs in the Modeler tab of AMLOpcUa, which
opens a namespace of the document and imports the result back
([AMLOpcUa docs/modeler.md](https://github.com/hsu-aut/AMLOpcUa/blob/main/docs/modeler.md)).

Status: in development.

```bash
npm install
npm run dev        # http://localhost:3002
npm test
npm run typecheck
npm run lint       # the order of React hooks
npm run test:e2e   # the web build in Chromium (npx playwright install chromium once)
```

`npm run test:e2e` also opens twelve released companion specifications when
`UA_NODESET` names a clone of
[OPCFoundation/UA-Nodeset](https://github.com/OPCFoundation/UA-Nodeset) with
the folders in `tests/e2e/corpus-folders.txt`; CI checks them out at the
commit named in `.github/workflows/ci.yml`.

On a page of its own the modeler keeps unsaved work in the browser
(IndexedDB) and offers it at the next start; embedded in a host it does not.

## Third-party content

`assets/nodesets/` holds the OPC UA base NodeSet (1.05.07) and the OPC UA for
Devices NodeSet (1.05.0) from [UA-Nodeset](https://github.com/OPCFoundation/UA-Nodeset),
OPC Foundation MIT License 1.00.

## License

MIT

## As a library

```bash
npm run build       # dist/web (the app) and dist/lib (the library)
```

```ts
import { readNodeSet, writeNodeSet, Workspace, NodeSetModeler, App } from 'nodeset-js';

const ws = new Workspace();
await ws.open(xml);                         // loads the required UA and DI models
const pump = ws.editor!.addType('ObjectType', 'PumpType');
ws.editor!.addDeclaration(pump, 'Variable', 'Speed');
const nodeSet = ws.save();                  // NodeSet2 XML
```

`App` is the complete modeler as a React component; `NodeSetModeler` is the
canvas alone. React 18 is a peer dependency.

For a script, in a page or in Node, there is a second entry without the canvas
and without React:

```js
const { Workspace, check } = require('nodeset-js/core');

const ws = new Workspace();
await ws.create('http://example.org/Pump/');            // brings the base model with it
const type = ws.editor.addStateMachineType('PumpStateMachineType');
const idle = ws.editor.addState(type, 'Idle', 1);
const running = ws.editor.addState(type, 'Running', 2);
ws.editor.addTransition(type, 'IdleToRunning', 1, idle, running);
console.log(check(ws.space, ws.editable));              // the rules on the model
require('fs').writeFileSync('Pump.NodeSet2.xml', ws.save());
```

The base NodeSet and DI are inside that build, so a script needs nothing else.
`npm run verify:core` checks that it still runs outside a browser.
