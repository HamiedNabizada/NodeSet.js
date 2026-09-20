# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Until 1.0.0 the library's shape may still change between minor versions.

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-09-20

The first release: a graphical modeler for OPC UA information models that
reads and writes NodeSet2 files, runs in the browser on its own and embeds in
the AutomationML Editor plugin
[AMLOpcUa](https://github.com/hsu-aut/AMLOpcUa).

### Added

- **The file is the format.** NodeSet2 in and out, losslessly: values,
  definitions, extensions and the attributes the modeler does not edit are
  written back as they were read. Diagram positions live in the NodeSet's own
  `Extensions` (OPC 10000-6 Annex F), which every other tool ignores.
- **Types**: ObjectTypes, VariableTypes, DataTypes and ReferenceTypes with
  supertypes, instance declarations by ModellingRule, method arguments,
  structure fields, enumeration values, OptionSets, unions, optional fields and
  DataTypeEncodings.
- **Instances** by ModellingRule: every Mandatory child, the Optional ones
  chosen, placeholders filled by name.
- **Values** of built-in types as scalars and arrays, and structure values of
  any shape (nested, arrays, optional fields, unions, self-containing), edited
  field by field.
- **Canvas** in the notation of OPC 10000-3 Annex C, with a context pad for
  adding children, drawing references and deleting, and a layout that is kept.
- **Finite state machines** (OPC 10000-5 Annex B): states and transitions with
  their numbers, ends and causes, written as the base model writes its own, and
  drawn as a state chart.
- **Checks** on the NodeSet itself, rules M001 to M021, each finding with its
  rule and a sentence.
- **Further models**: DI ships with the modeler, any NodeSet can be loaded, and
  saving declares every model whose nodes are used as RequiredModel.
- **Variables from a signal list** (CSV), as one step that undo takes back.
- **Embedding**: a library build (`nodeset-js`) with type declarations, and a
  host protocol over WebView2 messages for the AMLOpcUa plugin.

### Known limits

- Structure fields that allow subtypes, and matrices, are kept as they were
  read but not edited.
- The instantiation rules are checked against cases shared with AMLOpcUa
  (`tests/shared/instantiation.json`), which implements them a second time in
  C#; anything outside those cases is not compared.
