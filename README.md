# NodeSet.js

A graphical modeler for OPC UA information models. Types and instances are
drawn in the notation of OPC 10000-3 Annex C and stored as NodeSet2 files,
with nothing in between: the file it opens and the file it writes are the
NodeSets every other OPC UA tool reads. It runs in the browser on its own, and
it embeds: the AutomationML Editor plugin [AMLOpcUa](../AMLOpcUa) hosts it and
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
([AMLOpcUa docs/modeler.md](../AMLOpcUa/docs/modeler.md)).

Status: in development, see [docs/plan.md](docs/plan.md). Lessons that apply to
FPB.js are collected in [docs/lessons-for-fpbjs.md](docs/lessons-for-fpbjs.md).

```bash
npm install
npm run dev        # http://localhost:3002
npm test
npm run typecheck
```

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
