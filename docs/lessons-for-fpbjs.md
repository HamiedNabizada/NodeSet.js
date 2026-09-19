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

**diagram-js 15 context pad: `html` is the whole entry.** An entry's `html`
replaces the default `<div class="entry">`, so it must carry the class
`entry` itself, or the pad's click and drag handling does not find it.

**diagram-js 15 toggles selection on click.** Clicking an element that is
already selected deselects it and closes its context pad. Tests (and users)
that "click to make sure it is selected" undo the selection.

**Draw references by dragging, decide in the application.** A rule allows
`connection.create`, and a `connect.end` listener with higher priority hands
source and target to the application and returns `false`, so no line is
drawn on the canvas; the model changes, and the diagram is rebuilt from it.

**TypeScript works with diagram-js 15** through Babel's TypeScript preset; the
package ships `.d.ts` files. `BaseRenderer` subclasses must accept
`businessObject` as optional.

## Panels

**Grid and flex items need `min-width: 0`.** Their default minimum is their
content, so a `<select>` with long option texts pushes a whole panel section
out of its column. One rule for the panel's form containers fixes every case.

**Structured values are drafts, applied as one step.** Method arguments and
DataType fields are edited as a list in the panel and applied with one
button, which is one undo step and one validation, instead of an edit per
keystroke.

**Memoize on content, not on object identity.** The editor changes nodes in
place, so a panel's `useMemo([node])` kept the old fields after an apply and
the Apply button stayed. Depending on the changed part, or on a content key,
fixes it.
*FPB.js:* business objects are mutated in place too; the same trap applies
to any memoized panel state.

**Compare drafts by a normalized key.** `JSON.stringify` depends on the order
in which properties were set, so a draft built by the UI and the same data
read from the model compared unequal. A key function with a fixed order per
item does not.

**A failed change must not reset the draft.** A change that fails restores
the snapshot and rebuilds, which gives every node a new identity; a panel that
resets its draft on a new identity then throws away what the user typed along
with the error. Resetting only when the content key changes keeps it.

**Inside a transaction, the index is still the old one.** The address space
is rebuilt after a change, so code that runs within the change and asks the
index about a supertype it just set gets the old answer. Such code asks about
the new supertype directly.
*FPB.js:* the same holds for CommandInterceptor handlers that query the
element registry before the canvas has updated.

## Embedding in the AutomationML Editor

**Test the host bridge without the host.** A Playwright init script puts a
fake `window.chrome.webview` into the page that records `postMessage` and can
dispatch host messages. The whole protocol (ready, open, dirty, apply) is
checked in a browser in seconds, before any C# is built.
*FPB.js:* the FPB plugin's bridge could get the same harness.

**Drive React from `ExecuteScriptAsync` with the native value setter.**
Setting `input.value` does not reach React's `onChange`; calling the
prototype's `value` setter and dispatching an `input` event does. With that,
a WPF probe can click through the embedded page end to end.

**Give WebView2 its own profile folder.** Without `CreationProperties`,
WebView2 writes its profile next to the executable; under Program Files that
fails. The OPC UA plugin uses `%LOCALAPPDATA%\AMLOpcUa\WebView2`.
*FPB.js plugin:* sets none today and works only because the editor was
installed per user.

**A test host needs the plugin's dependencies itself.** A plugin that
references its core with `PrivateAssets=all` gives a test executable no
entry for the core's dependencies in its `deps.json`; the OPC UA stack then
failed in a type initializer, while the plugin works in the editor, which
loads it with its own `deps.json`. The probe references the core directly.

## AutomationML Editor plugins (from AMLOpcUa)

**One status bar for all tabs.** The OPC UA plugin had its status line and
progress bar inside the first tab; a mirror started in the Server tab
reported into a tab nobody looked at. A status bar below the TabControl is
seen from every tab.
*FPB plugin:* worth checking wherever a tab reports progress.

**First steps instead of an empty list.** A document without the plugin's
content shows cards for the three or four ways in (import, search, connect,
model). Users who open the plugin for the first time see what it is for.

**Screenshots of a WPF plugin without the editor.** A probe hosts the plugin
control in a window, drives it (`RaiseEvent` for clicks, a DispatcherTimer
to answer modal dialogs) and renders each tab with `RenderTargetBitmap`.
WebView2 content is an HWND and does not appear in such a picture.
*FPB plugin:* the same probe would show every view after a change.

**Test in the editor's dark theme, and never restyle its controls blind.**
The editor themes plugins with Aml.Skins on MahApps.Metro. A plugin's own
`Style TargetType="TabItem"` without `BasedOn` replaced the editor's style,
fell back to plain WPF and passed black text to everything inside; fixed light
surfaces showed the dark theme's white text on white. The OPC UA plugin now
mixes its surfaces, lines and grey text from `MahApps.Brushes.ThemeBackground`,
`ThemeForeground` and `Accent` (`ThemePalette`), and a probe loads MahApps,
Aml.Skins and `ThemeManager.ChangeTheme(app, "Dark.Blue")` to check both
themes by screenshot.
*FPB plugin:* worth the same check; any fixed `Background="White"` is suspect.

**One frame for every dialog.** The OPC UA plugin's eight dialogs share a
small kit (`DialogKit`): a header with the command's glyph in the colour of
its kind, a title and one sentence on what the dialog does; search boxes with
a placeholder; list entries with the name and, in grey, what tells it apart;
a footer with messages left and the answer right. New dialogs cost less and
look like the rest.
*FPB plugin:* its input dialogs would fit the same kit.

**Aml.Engine wraps anew on every access.** Two reads of the same element give
two wrapper objects; compare IDs, not references (`Assert.Same` fails).

**Clean only when the host says so.** The modeler used to clear its dirty
mark as soon as it posted "apply"; an import that then failed left the user
believing the model was in the document. Now the host answers "applied" (and
"saved" for a save dialog of its own) with ok and a text, and only ok clears
the mark. The host asks before Open, New or Reload drop a dirty model; the
page hides its own Open and New when hosted, since only the host knows the
NodeSet folders.
*FPB plugin:* the same handshake fits any "apply to document" of an embedded
editor.

**Drafts register themselves.** Sections with Apply/Discard drafts (arguments,
fields, structure values) lost their draft silently when another node was
selected. A tiny registry (`useDraft(name, changed)`, `mayLeaveDrafts()`)
lets the app ask before leaving, without the app knowing the sections.
*FPB.js:* the properties panel has the same shape of problem.

**A safety net for handlers.** An `async void` WPF handler that throws ends in
the editor's dispatcher, and the editor may end with the user's work. The
plugin catches exceptions whose stack passes through its own code in
`Dispatcher.UnhandledException` and shows them in its status bar; handlers
still catch what they expect.
*FPB plugin:* worth the same net.

**Keep WebView2 on its own page.** Whatever sends "apply" writes into the
document, so the host refuses navigation to anything but its virtual host,
refuses new windows, takes messages only from that origin and turns the
developer tools off in a release build.
*FPB plugin:* the same four lines apply to its bridge.

**Write the document on the UI thread only.** Library code with
`ConfigureAwait(false)` before its writes changed the document from a pool
thread while mirroring; Aml.Engine and the editor's tree are not made for
that. Code that writes the document now resumes on the caller's context, and
a test runs it on a thread with its own synchronization context and checks
where every XML change happened.
*FPB plugin:* worth checking every await before a write.

**Keep a selection where its result lives.** The part of a server mirrored
into a hierarchy is stored as an attribute at the element that stands for
the server, so "mirror again" needs neither settings nor a new selection.

## Tooling

**Big data as lazy chunks.** The 4 MB base NodeSet is an `asset/source`
import behind a dynamic `import()`, so it loads only when needed; vitest gets
the same through a five-line plugin that turns `.xml` into a string module.

**Screenshots as a check.** A small Playwright script serves `dist/web`,
clicks through the app and takes a screenshot; looking at it caught
unreadable zoom and crowded labels that no unit test would.
