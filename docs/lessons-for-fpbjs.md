# Lessons for FPB.js

What building this modeler taught that would help FPB.js and other diagram-js
tools. Each entry says what was done here, why, and where it touches FPB.js.
Kept up to date while the modeler grows.

## Architecture

**Domain model first, diagram second.** The NodeSet model, the edits and the
checks (`src/nodeset/`) know nothing of diagram-js. A pure layer
(`src/modeler/diagram-model.ts`) turns the model into shapes and lines with
positions; the diagram-js part only draws that. After every change the
diagram is rebuilt from the model.
*Why:* the canvas can never disagree with the model, and everything except
drawing is unit-tested in vitest without a browser (25 tests run in seconds).
*FPB.js:* consistency lives in diagram-js event handlers (ShapeUpdater,
ConnectionUpdater, DataBehavior); the layer and import bugs of September 2026
come from state kept in two places. A model-first core would remove that
class of bug.

**Undo by snapshots of the domain model.** Every edit clones the model
(`structuredClone`) before it changes it; undo and redo swap snapshots.
A failing edit restores its snapshot, so an error never leaves half a change.
*Why:* no per-command revert code to get wrong.
*FPB.js:* undo across layers turns back changes in hidden layers, decompose
cannot be undone, the command stack is never cleared. Snapshots of the whole
FPB model (all layers) would make undo layer-independent and cover every
command at once. Models of a few thousand elements clone in milliseconds.

**Rebuild only what changes: a layered index.** Rebuilding the whole index
after every edit cost 66 ms, almost all of it for the 5000 nodes of the base
model nobody edits. The address space now sits on a base layer that is
indexed once; an edit re-indexes only the edited model: 0.6 ms per edit.
*FPB.js:* the same applies to libraries and hidden layers: what the user is
not editing can be indexed once and shared.

**Edits as one API with typed errors.** `ModelEditor` is the only way to
change the model; it throws `EditError` with a sentence for the user, which
the UI shows in the status line.
*FPB.js:* rules are spread over RuleProvider, updaters and context pad;
one editing API would give the React panels and the future Python/JSON API
the same guarantees.

## Files and round trips

**Keep what you do not edit, verbatim.** The reader stores unknown
attributes and elements (Value, Definition, Extensions) as raw XML and the
writer puts them back; a test reads, writes and reads the whole OPC UA base
model and compares node by node.
*FPB.js:* actualValues are cut to one value on import, which loses data in
the AML round trip. A "raw passthrough" for everything the modeler does not
understand, plus a round trip test over real files, would catch that.

**Layout inside the exchange file, keyed by stable IDs.** Positions go into
the NodeSet's own extension point (`UANodeSet/Extensions`), with NodeIds in
the form that does not depend on the file's namespace table. Other tools
ignore it.
*FPB.js:* the same idea applies to the AML export: layout in an extension or
attribute of the element it belongs to, keyed by ID, not by position in a list.

## diagram-js

**Markers drawn as geometry, not SVG `<marker>`.** Arrow heads and hash
strokes are computed from the last segment of the line and drawn as plain
polygons and lines.
*Why:* they survive SVG export and copying, need no `<defs>` ids (which clash
when two canvases share a page), and can be tested.

**`fit-viewport` needs a floor.** Fitting a tall diagram makes text
unreadable; below zoom 0.75 the modeler shows 1:1 from the top left instead.

**TypeScript works with diagram-js 15** through Babel's TypeScript preset; the
package ships `.d.ts` files. `BaseRenderer` subclasses must accept
`businessObject` as optional.

## Tooling

**Big data as lazy chunks.** The 4 MB base NodeSet is an `asset/source`
import behind a dynamic `import()`, so it loads only when needed; vitest gets
the same through a five-line plugin that turns `.xml` into a string module.

**Screenshots as a check.** A small Playwright script serves `dist/web`,
clicks through the app and takes a screenshot; looking at it caught
unreadable zoom and crowded labels that no unit test would.
