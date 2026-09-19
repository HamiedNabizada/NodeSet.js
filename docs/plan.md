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

## Decisions

- **NodeId identity.** A NodeId is keyed by namespace URI and identifier;
  indexes only exist while reading and writing a file.
- **Lossless.** Value, Definition, Extensions and attributes the modeler does
  not edit are kept as read and written back unchanged.
- **Logic in TypeScript.** The type system and instantiation exist here and in
  the C# core of AMLOpcUa. The modeler works on NodeSets alone; everything
  AutomationML stays in C#.
- **Name.** "UaModeler" is a product of Unified Automation. The name is a
  working title and has to change before anything is published.
