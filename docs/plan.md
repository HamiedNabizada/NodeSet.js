# Plan

A browser application in the manner of FPB.js: diagram-js for the canvas,
React for panels, a library build for embedding. The file format is NodeSet2,
so the modeler needs no format of its own and every other OPC UA tool can
read what it writes. Layout is kept in the NodeSet's `Extensions`.

What it deliberately does not do, unlike commercial modelers such as
UaModeler (Unified Automation) or SiOME (Siemens): generate server code for an
SDK. The modeling part is covered: types, instances, references, modelling
rules, checks, NodeSet in and out.

| Stage | Content | Status |
|---|---|---|
| M0 | Repository, toolchain (TypeScript, webpack, vitest, diagram-js, React) | done |
| M1 | NodeSet2 core: read and write losslessly, address space across models, type queries | done |
| M2 | Canvas in the notation of OPC 10000-3 Annex C, automatic layout, layout stored in the NodeSet | done |
| M3 | Editing: properties panel, arguments, fields, references, checks, undo, save | done |
| M4 | Instances by ModellingRule | done |
| M5 | Embedding in the AMLOpcUa plugin through WebView2, exchange with the C# core | done |
| M6 | Library build, standalone build, documentation | done |

Added after M6, from a review of what was missing:

- Further models: DI (bundled) or any NodeSet file can be loaded into a model;
  saving declares every model whose nodes are used as RequiredModel.
- Model version and publication date.
- Values of built-in types, scalar and array, checked against the type.
- DataTypeEncodings ("Default Binary", "Default XML", "Default JSON") for
  structures, and check M010.
- Enumerations with any values (EnumValues instead of EnumStrings).
- MethodDeclarationId kept as a NodeId and set on methods of instances.
- Editing on the canvas: context pad (add child, draw reference, delete).
- ExtensionObject values read structurally (TypeId as a NodeId, so its index
  follows the saved file); single structures whose fields are built-in types
  edited field by field (Range, EUInformation, own structures).
- OptionSets (subtypes of an unsigned integer or of OptionSet, IsOptionSet,
  OptionSetValues), unions (IsUnion), optional structure fields, check M011.
  Changing a DataType's supertype fits its encodings and fields.

- Structure values of any shape (`structures.ts`, OPC 10000-6 5.3.6): nested
  structures, enumerations ("Name_Value"), arrays of all of these, optional
  fields (EncodingMask), unions (SwitchField), structures that contain
  themselves, and arrays of structures as the value of a Variable. The panel
  edits them as nested fields; deep levels start folded.

- The instantiation rules are checked against cases shared with the AMLOpcUa
  plugin, which implements them a second time in C# (`tests/shared/instantiation.json`,
  read by both test suites; `UPDATE_SHARED=1 npm test` rewrites it from this
  implementation). The first run found that the plugin instantiated children
  without a ModellingRule (DefaultInstanceBrowseName); it no longer does.

- Guards against lost work: Open, New and the DI sample ask before dropping
  unsaved changes, leaving a node asks before dropping an unapplied draft
  (`drafts.ts`), and on its own the page asks before it is closed or
  reloaded. Embedded, the host answers `apply` with `applied` and a save with
  `saved`; only then is the model clean. The host's own Open and New replace
  the page's. Undo and redo mark the model changed only when they did
  something. Type lists and findings work from the keyboard (Enter, Space),
  and findings name their severity in words. Names are asked in a dialog of
  the page's own (`AskDialog`), not `window.prompt`: it follows the theme,
  offers the ReferenceTypes for a new reference and says what is wrong
  without closing. Structure values escape the
  namespace URI and leave out types whose names XML cannot carry.

- A catalogue of rules on the NodeSet itself (`checks.ts`, M001 to M021):
  besides the earlier ones on types and instances, a NodeId in a namespace the
  model does not own, ValueRank against ArrayDimensions, a method argument of
  an unknown DataType, a placeholder not named <like this>, a node held by
  HasProperty that is no Variable of PropertyType, fields of the same name or
  values of the same number, a symmetric ReferenceType with an InverseName, and
  a node no reference leads to. Each finding carries its rule; the rule's
  sentence is its tooltip.

- Finite state machines (OPC 10000-5 Annex B): "+ machine" adds an ObjectType
  below FiniteStateMachineType; its panel then holds the states and the
  transitions between them, each with its number, its ends and the method that
  causes it, and draws the machine as a state chart (`statemachine.ts`,
  `ModelEditor.addState`/`addTransition`/`setTransition`). States and
  transitions are written as the base model writes its own: components with a
  type definition of StateType or TransitionType, a Mandatory StateNumber or
  TransitionNumber in the UA namespace, FromState, ToState and HasCause in both
  directions, and no ModellingRule of their own. M020 finds a transition
  missing an end, M021 a number given twice or not at all.

- Variables from a signal list: "Variables from CSV…" on a type or object of
  the model reads a CSV file (comma, semicolon or tab, header row; columns
  Name, DataType, Kind, ModellingRule, Description, Value) and adds one
  variable per row, as one step that undo takes back; a bad row stops the
  import with its line and keeps nothing (`csv.ts`, `ModelEditor.batch`).

- Two entries into the library: `nodeset-js` brings the canvas and the app and
  needs a browser; `nodeset-js/core` is the NodeSet layer alone (reading,
  writing, address space, editor, checks, state machines, workspace) and runs
  in Node, with the base model and DI inside the build. `npm run verify:core`
  builds a model in Node after every library build, so the entry cannot quietly
  grow a dependency on a window.

Not done: structure fields that allow subtypes (their values name their own
type), matrices, a test inside the AutomationML Editor itself.

## Decisions

- **NodeId identity.** A NodeId is keyed by namespace URI and identifier;
  indexes only exist while reading and writing a file.
- **Lossless.** Value, Definition, Extensions and attributes the modeler does
  not edit are kept as read and written back unchanged.
- **Logic in TypeScript.** The type system and instantiation exist here and in
  the C# core of AMLOpcUa. The modeler works on NodeSets alone; everything
  AutomationML stays in C#.
- **Name.** NodeSet.js, since 2026-09-20, after the working title "UaModeler"
  and the short-lived "InfoModel.js". Named after the format it edits, as
  bpmn-js and dmn-js are: everyone in OPC UA knows what a NodeSet is, while
  "information model" also means something in the AAS, in AutomationML and in
  IEC 61360. The names of the other tools are taken and defended: UaModeler,
  UaExpert and UaGateway are trademarks of Unified Automation, and a name in
  that series would sit in the same product class with the same audience;
  "OPC UA Modeler" (Prosys, Sterfive) and "UA NodeSet Editor" (OPC Foundation)
  are taken as well. "NodeSet" itself is a term of the specification that
  everyone in the field uses descriptively and nobody holds as a product name.
  Layouts saved under the earlier namespaces are still read.
