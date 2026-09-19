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
- **Name.** InfoModel.js, since 2026-09-19: it models OPC UA information
  models, as FPB.js models formalized process descriptions. The working title
  "UaModeler" is a product of Unified Automation; "OPC UA Modeler" (Prosys,
  Sterfive) and "UA NodeSet Editor" (OPC Foundation) are taken too. Layouts
  saved under the working title's namespace are still read.
