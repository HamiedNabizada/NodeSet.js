# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Until 1.0.0 the library's shape may still change between minor versions.

## [Unreleased]

### Fixed

- Undo kept a copy of the whole file for every step, without end: about
  23 MB a step for Pumps, so a long session on a large model grew until the
  tab gave up. A model now keeps at most 100 steps and about 200 000 copied
  nodes, never fewer than 10 steps (20 for Pumps). A batch is still taken back
  whole.
- A check that throws no longer stops the whole modeler: the toolbar says
  "Checks failed" and the list of findings says why.

## [0.1.1] - 2026-09-26

### Fixed

- Selecting a DataType without fields (a subtype of Int32, say) after one with
  fields (a structure or an enumeration) blanked the whole page, and whatever
  was not saved was gone: the fields section called a hook after an early
  return. It showed on MachineVision, whose ResultStateDataType refines Int32.

### Added

- A part of the modeler that fails while it is drawn says so in its place
  instead of taking the page with it. If the modeler as a whole fails, the
  model stays: the message offers Save NodeSet, and Try again starts the
  modeler anew with the same model. An edit whose drawing failed still counts
  as unsaved, and what a host sends meanwhile is kept for the modeler.
- On a page of its own the modeler keeps unsaved work in the browser
  (IndexedDB) once editing pauses, with the NodeSets loaded from files, and the
  next start offers it with Restore and Discard. A draft goes as soon as the
  model is saved, and a page never offers the draft of another page that is
  still open. Inside a host such as AMLOpcUa there is no backup; the host keeps
  the model.
- Tests that drive the web build in Chromium (`npm run test:e2e`): modelling a
  type with a state machine, every kind of DataType in turn, a failure of the
  modeler, the backup, the modeler inside a host, and twelve released
  companion specifications from OPCFoundation/UA-Nodeset, each opened with
  what it requires, every type shown, one edit undone and saved. CI runs them
  on a sparse checkout at a fixed commit.
- `npm run lint`: `eslint-plugin-react-hooks` with its rule on the order of
  hooks, the one that would have caught the fault above. It runs in CI.

### Known limits

- The checks run in the modeler itself, not inside the boundary of the list
  of findings, so a check that throws still stops the whole modeler (the
  model stays, as above). None is known to throw.

## [0.1.0] - 2026-09-21

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
- A second entry, `nodeset-js/core`: the NodeSet layer without the canvas and
  without React, so a script can build and check a NodeSet in Node. The base
  model and DI are inside that build. `npm run verify:core` keeps it honest.
- Two rules on an instance against its type, which nothing checked before:
  M022 finds a Mandatory child the instance does not have, M023 a
  MandatoryPlaceholder nothing fills. Over the 24 released companion
  specifications they fire twice, both times on an example model that is
  indeed missing a Mandatory child.

### Fixed

Found after these notes were first written on 20 September and fixed before
the tag:

- The state chart draws the way there and the way back apart: on one line the
  two arrows and their names covered each other.
- A declaration that overrides another keeps what the overridden one holds at
  every depth, not only one level below the type: a child of a child used to
  replace the one it overrides with everything below it.
- A value of a structure carries the fields it inherits, not only the ones its
  own type adds: a NodeSet declares only the latter, and a server refuses a
  value that leaves the inherited ones out.
- A boolean written as `1` or `0`, which XML allows, was read as the opposite:
  an abstract type became instantiable, an optional structure field mandatory,
  and `IsForward="0"` turned a reference around. Found by an audit over the
  published companion specifications, where nothing spells it that way yet.
- A description is written back with the whitespace it had, a required model
  keeps the attributes it carries (`XmlSchemaUri`, `ModelVersion`), an empty
  argument description keeps its locale, a file that starts with a byte order
  mark opens at all (one released companion specification does), and `Value`
  is written before the elements the modeler does not know, which the schema
  demands. All 37 NodeSets on hand now read and write back with no difference
  at all.
- Rules that fired on released models: M012 reported every node of the base
  model as foreign (5476 errors), M002 counted names without their namespace,
  M011 asked a structure for the fields it inherits, M010 insisted on a
  "Default Binary" encoding where the specification allows "Default XML", and
  M015 asked a placeholder method to be named in angle brackets, which is for
  objects and variables.
- References that are not the ones holding a child now run on rails beside the
  shapes instead of crossing them, and their names sit on the longest straight
  piece of the line, on a sheet of their own.

### Known limits

- Structure fields that allow subtypes, and matrices, are kept as they were
  read but not edited.
- The instantiation rules are checked against cases shared with AMLOpcUa
  (`tests/shared/instantiation.json`), which implements them a second time in
  C#; anything outside those cases is not compared.
