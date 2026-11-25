# Edit existing parts

Use for local changes to an existing native part. Read current focused tool
schemas; the tool contracts own supported fields and limits.

## Contents

- Choose the representation and edit level
- Declare the change and preservation contract
- Preview an identified feature
- Inspect the delta and read back
- Capture repeatable agent evidence

## Choose the representation and edit level

Read the target's geometry fingerprint, placement matrix and `editing` context.
For known numeric edits, omit selectors and the full feature tree; the compact
context includes current supported values. Fetch the tree only when needed.
Prefer independent template parameters, then native bound parameters, then a
supported existing feature edit. Use a new modifier or boolean when the request
is genuinely an added feature. Reconstruct only the necessary target geometry
when the existing representation cannot express the edit and the user agrees.

A curve in a sketch is not necessarily a removable fillet. Do not invent a
feature id or treat an imported mesh as parametric history. The feature-edit
context lists supported ids, fields, dependency restrictions and preferred tool.
`$base` identifies a supported one-sided extrusion. Modifier ids are stable
within their document revision; geometric selectors still need fresh discovery
when an upstream change makes them ambiguous or stale.

The initial feature-edit API supports top-level fillet radius, chamfer/offset
distance, shell thickness, hole diameter/blind depth/single location, modifier
removal and a one-sided base extrusion distance. It rejects managed generators,
parameter bindings, variable-radius sets and linked dependents instead of
silently detaching them. Use the appropriate parameter/generator route first.
Unsupported native topology is a capability gap, not permission to edit app
source, execute JavaScript, replace unrelated parts or approximate with a mesh.

## Edit a body that is already in the document

Before requesting an original model file or rebuilding the part, check whether a
typed boolean can edit the current body. `group` and `combine` operations accept
body ids from the document, including imported mesh bodies, when the preview
kernel supports the requested cut or join. A mesh has no editable parametric
history, but that alone does not prevent a localized boolean.

- For one cutter, use `combine` with the existing body as `target` and a primitive
  as `tool`. Set `operation` to `cut`, `join` or `intersect` according to the
  requested material change. `combine` retains the target's body id.
- When creating a new group body id is intended, mirror the editor's Hole-and-Group
  workflow by adding a primitive with
  `hole: true`, then use a `group` operation with the existing body and cutter as
  `members`. The default `union` keeps the primitive's hole role. Explicit
  `operation: "cut"` marks every member after the first as a cutter.
- Example `plan` for a round cavity. Replace the example `name` and `body-id`
  with the current document name and target id from `jumpstart_get_document`.
  Choose the cutter's position and height from measured bounds and the requested floor.

  ```json
  {
    "name": "Current document name",
    "primitives": [
      {
        "id": "opening-tool",
        "kind": "cylinder",
        "parameters": { "w": 35, "d": 35, "h": 23 },
        "position": [0, 0, 2]
      }
    ],
    "operations": [
      { "id": "opened-body", "type": "combine", "target": "body-id", "tool": "opening-tool", "operation": "cut" }
    ]
  }
  ```

  The cutter is consumed and the target remains under its original id. Omit
  `replaceBodyIds`. A `group` instead consumes its members and adds a new body,
  which fails a single-target `requirements.intent` check.
- Position cutters from measured body bounds and the requested floor or opening.
  Primitive positions are world-space, centered on X/Y, with the bottom at Z.
  Inspect sections or material intervals to verify the remaining floor and
  opening; inspect the full preview to make sure surrounding details remain.
- Do not place an existing body id in `replaceBodyIds` when the same plan
  references it as a `target`, `member` or `source`. `replaceBodyIds` removes
  those bodies before the plan operations run, which makes the references
  unavailable. Use it only for a rebuild that does not refer to the replaced
  bodies.

Request an external source file only when the current body and available typed
operations cannot express the requested edit and a rebuild is necessary. Check
the managed import catalog before asking the operator to place another file.

## Resolve curved reinforcement before modeling

Separate three different requests: an edge fillet rounds a selected seam; a
curved rib or gusset adds material along a path or wall; a torus adds a rounded
annular bead. Do not substitute one for another. Use a fillet only when the
requested edge is identified and supported. Use a typed swept or revolved
profile for a requested rib or gusset when its path and section are clear. Use
a torus only when the reference calls for a bead. If a screenshot does not show
which side, path, or cross-section the user means, ask one concise question
before applying a materially different shape.

For any strengthening feature, record where the material is added, the path it
follows, and its section dimensions. Do not infer the desired cross-section
from the word “arc” alone. Verify the cable opening or other functional gap
after adding the reinforcement; inspect a section through both the feature and
the opening.

## Declare the change and preservation contract

Before preview, record the requested outcome, target ids and geometric evidence
needed to distinguish success from a plausible image. Separate three questions:
what material should be added/removed, which interfaces must remain unchanged,
and which measurements establish the requested relationship.

`requirements.intent` declares the goal and existing target body ids. Its optional
`changeRegion` is a world-space AABB: native material outside it must remain
unchanged. Other changed, added or removed bodies fail the intent check.
`preserveBodyIds` protects unrelated source definitions and placements.
`preserveRegions` compares baseline and candidate native material inside explicit
world-space boxes, including added and removed volume. Equal total volume or
bounds alone cannot establish preservation.

Derive these boxes from actual mating faces, measured interfaces and intended
feature extents. Do not assume a generator-specific protected base height for
arbitrary parts. A world AABB is only the supported initial region mask, not an
exact arbitrary feature boundary. Keep the mask meaningful rather than enlarging
it after a failed check to hide an unintended change.

Use dimension, bound, channel, component, sample and pair inspections as relevant.
A whole-body minimum distance can be zero at an unrelated contact while the
intended interface has a gap. Inspect the actual interface and use both material
and void evidence. Failed or unknown required checks block apply. Native region
queries initially require valid single native/STEP source solids, support empty
or disconnected clipped material, and do not certify surface tolerances or
minimum wall thickness everywhere. Mesh queries remain unsupported.

## Preview an identified feature

Use `jumpstart_preview_feature_edit` with the current `expectedRevision`, target
`expectedFingerprint`, `edit` and explicit single-target `requirements.intent`.
For example, choose an observed modifier id and its supported numeric field;
retain the other selector and placement data rather than rebuilding the part.
MCP geometry is always millimetres; `displayUnits` is only the editor UI setting.
Hole positions are body-local millimetres, so resolve world requests into that
frame before supplying a new location. Multi-location hole patterns require a
separate edit; do not silently move only one of their holes.

For local work, supply `detail` as a world AABB or use the intent's change region.
For an existing target, the preview returns an overview and a detail for both
`before` and `after`, with identical world framing for the detail. Keep the
complete overview to detect side effects and the detail to inspect the local
change. Section and detail comparison images are separate requests within the
four-image budget. Capturing images restores the editor camera and section.

## Inspect the delta and read back

Check that the target body identity, roles and companion bodies remain correct.
Inspect changed feature values, actual geometry and all acceptance results.
Feature values alone are not evidence that a bore moved, a wall thickened or a
joint closed. Use independent sections or probes of the old and new locations.

On a CAD error, inspect the first failing stage and its input selectors. Do not
repeat an identical preview, raise tolerances or strip failed requirements.
Requery geometry after a revision/fingerprint change. Apply only the successful
preview id, then read back the actual document. Preserve save, export and undo
boundaries from the main skill; do not substitute development shell commands
for ordinary MCP model edits.

## Capture repeatable agent evidence

The operator can enable server-side local recording with `JUMPSTART_MCP_TRACE=1`.
The agent continues using normal MCP tools. Compact capabilities report recording
status; no extra HTTP or shell transport is required. Recording is off by default,
local and bounded. It redacts credentials, separates image artifacts and reports
incomplete recording rather than changing modeling results on a logging failure.

A controlled trial needs the task, initial document, client/model configuration,
actual tool trace and independently verified geometry/export. Report tool calls,
failed previews, bytes and elapsed tool time separately from correctness. The
recorder cannot infer LLM tokens or hidden reasoning. Integration tests and skill
trigger fixtures do not establish agent success rates. Use varied generic edits
and compare equivalent runs before claiming that the skill improved efficiency.
