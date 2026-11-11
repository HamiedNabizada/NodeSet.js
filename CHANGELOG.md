# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Until 1.0.0 the library's shape may still change between minor versions.

## [Unreleased]

### Added

- **Add subtype** in the panel of any type, also of a loaded model's (DI's
  DeviceType, say), adds a subtype of it to the model. The dialog of a new
  type asks for its supertype with its name.
- AccessLevel and UserAccessLevel (read, write), Historizing and
  MinimumSamplingInterval of a variable in the panel (`setAccess` in the
  editor). The defaults of the schema are not written; an instance takes
  them from its declaration.
- Keyboard: Delete deletes the shape selected on the canvas; Ctrl+S saves
  the NodeSet (inside a host it applies the model to the document, as the
  toolbar's first button does) instead of the browser saving the page;
  Ctrl+Shift+Z redoes. Undo and redo no longer miss Ctrl+Z and Ctrl+Y with
  Caps Lock on.
- Rule M024: a value does not fit the DataType or ValueRank of its node (an
  element of another built-in type, text that is not of the type, an array
  where a single value belongs, or the other way round). The base model and
  DI have no such value.
- **Remove value** in the panel, also for a value the panel shows but does
  not edit.
- Rule M025: a variable or a field names a DataType that is unknown or no
  DataType. M001 sees only references, and the DataType is an attribute.

### Changed

- Moving shapes and Reset layout no longer run the checks nor rebuild the
  lists: they mark the model unsaved and draw the diagram anew. The checks
  run once the page is idle after a change, not in the render that shows it,
  so a large model answers at once and its findings follow.
- The target of a reference in the panel is found by name in every loaded
  model: two letters or more offer up to 50 matching nodes with their path
  and model, the model's own first. Before, the list held every node of the
  model (9624 on Pumps, built at each redraw) and none of another model.
- Host protocol: "apply" and "save" carry `change`, the number of the last
  change the NodeSet holds. A host that echoes it in "applied" or "saved"
  (`{ type, ok, text, change }`) lets the modeler count the model as
  unchanged only when nothing was changed since; a host that does not echo it
  is taken at its word, as before.

### Fixed

- Add state and Add transition emptied the form even when the model refused
  the state or transition (a name given twice, say); the typed name now stays
  to be corrected.
- The German interface showed some English: "Part of …; read only.",
  "(none)" for the ModellingRule, the question before dropping unapplied
  changes and the names of its sections, "The checks stopped:", "optional,
  not set", the tooltips Bit and Value, and "Load DI/" (now "Load DI"). A
  test reads the sources and finds text that passes t() by.
- Deleting a state that holds a machine of its own left the machine
  (`<State>StateMachine`) behind on the machine type; it now goes with the
  state.
- Apply in the fields of a DataType dropped a field's ArrayDimensions and
  DisplayName, which the reader keeps apart from its other attributes; a new
  supertype dropped AllowSubTypes. They now stay with the field's name, the
  ArrayDimensions while the field stays an array of the same ValueRank.
- The encodings of a DataType ("Default Binary", "Default XML", "Default
  JSON") were offered as places for a new instance. They are not any more.
- An instance placed below a node of a loaded model, such as DI's DeviceSet,
  was missing from the list of instances, so it could not be found again. The
  list now holds every instance that no node of the model holds.
- Deleting a DataType left the variables, arguments and fields that named it
  pointing nowhere, and the next new node took over its NodeId and so became
  their DataType. Deleting a DataType in use is now refused, naming who uses
  it, and new NodeIds count on from the highest the file names anywhere or
  the editor gave out, so none is given out twice in a session.
- Changing the DataType or the ValueRank kept the old value: `3.5` as Double
  stayed `<Double>3.5</Double>` on an Int32. The value now follows in the same
  step: kept where the new DataType takes it, written anew where its elements
  fit the new type and rank, removed otherwise.
- What the panel held for one node carried over to the next: unapplied
  arguments shown and applied to another method after "Drop them?", the name
  of a child to add, Optional picks, the transition form. Each node now gets
  a panel of its own. Clicking the node you are on, or a redraw of the canvas,
  no longer asks to drop unapplied changes. A transition's ends must be states
  of its own machine (or ones it inherits), not of any machine.
- Inside a host, an edit made while the host imported or saved the model
  counted as saved once the host answered. With a host that echoes `change`
  it stays unsaved, and the status line says so.

- Loading the model that is open (the DI sample, then Load DI/, or its file
  through Load a NodeSet file…) loaded it a second time: every reference
  counted twice, and showing DeviceType took the modeler down. The model
  being edited is no longer offered nor loaded, also not as a model another
  file requires; an address space counts a reference once even when two of
  its files hold the node, and a diagram draws a line once.

## [0.2.0] - 2026-11-09

### Added

- A user manual, `docs/manual.md`, with pictures taken by
  `npm run manual:shots` (Playwright, outside the end-to-end tests).
- The interface in German, following the language of the browser (inside the
  AutomationML Editor plugin the language of Windows); OPC UA terms stay as the
  specification names them. The messages of the core (EditError, findings,
  errors of a NodeSet file) stay English for scripts and carry a template the
  interface translates. A test sees to it that every text has a German entry
  and no entry is left over.
- An instance can go below a node of a loaded model, as companion
  specifications put their devices into DI's DeviceSet: the panel offers the
  Objects folder, what loaded models place there and the model's own
  instances. The other model's node stays as it is; the new instance alone
  holds the reference and names it as ParentNodeId.
- Sub-state machines (OPC 10000-5): a state of a machine type can hold a
  machine of its own, a Mandatory component of another machine type that the
  state refers to with HasSubStateMachine. The panel sets, replaces and removes
  it; the state chart draws such a state with a second outline and the type of
  its machine below it.
- Matrices: a value of ValueRank 2 is edited row by row ("1; 2 | 3; 4") and
  written as a Matrix with its Dimensions, the last dimension running fastest
  (OPC 10000-6); rows of different length are refused. Higher ranks are shown
  and kept, not edited.
- A structure or union field can allow subtypes of its DataType (AllowSubTypes,
  StructureWithSubtypedValues): a checkbox in the fields section. Values of
  such fields are shown and kept, not edited; they hardly occur in NodeSets
  (six fields in the 24 released companion specifications, no values).

### Fixed

- Editing the fields of a DataType in the panel dropped what a field carried
  that the panel has no field for (AllowSubTypes, MaxStringLength,
  ArrayDimensions); it now stays with the field's name.

### Changed

- Undo keeps what a step changed instead of a copy of the whole file: each
  node is compared as JSON after every change, and a step keeps the nodes that
  differ, before and after. On Pumps (9624 nodes) a step keeps a few KB instead
  of 23 MB, undo takes 60 ms instead of 400, an edit 230 ms instead of 300 to
  400, and every model keeps 100 steps again (Pumps had 20).

## [0.1.2] - 2026-09-27

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
