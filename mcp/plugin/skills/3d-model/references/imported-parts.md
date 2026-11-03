# Imported parts

Load this reference for managed imports, mesh scaling, or STEP revisions.

- To import a file, call `jumpstart_list_imports` and choose a listed digest id.
  The operator places files in the local `imports/` directory. Use a typed
  `import` operation with that `assetId`; never request or invent a host path or
  send file bytes. STL requires explicit `units` (`mm`, `cm`, or `in`). Leave
  `units` out for 3MF and STEP so file semantics are preserved. Plans support at
  most four imports and 24 MiB total. STL and 3MF remain editable mesh bodies;
  STEP/STP become native STEP bodies. Use `jumpstart_preview_resize_body` for
  resizing an imported body, and do not claim parametric reconstruction.
  After the preview, compare its dimensions with the object it represents. A
  part about 25.4 or 1000 times too small or too large usually has the wrong
  `units`: ask the user to confirm them instead of resizing it to fit.
- When the user needs a purchased part that is not yet in `imports/`, the
  `step-parts` companion skill finds it in the public catalog and saves a
  checksum-verified STEP file there. Its `assetId` then equals the catalog
  SHA-256. Give purchased parts the `hardware` role.

## Resize and fit intent

Read body-local dimensions and world bounds. Establish whether resizing means
uniform scaling or independent axes. Scaling a mesh also scales its locking
details; it does not independently adjust a fit clearance. An imported STL remains
a mesh. Use native features for edits around it, and report physical fit as
unverified until supported measurements establish it.

Inspect support for each requested operation separately. A mesh without editable
fillet history may still support cuts and intersections. Preview supported typed
operations and inspect their material delta;
an empty or unchanged Boolean result can also be a failed solid conversion.
Do not declare a general capability limit from one failed operation or silently
replace the source with an approximate reconstruction. Diagnose the reported
failure through supported tools; application-code changes require their own scope.

## Preservation checklist

Name the exact target body and list existing bodies that must stay intact. Attach
`preserveBodyIds` in preview requirements. Source-preservation checks compare
native definitions, resolved inputs and placements; they do not prove exact
solid equality or recover a mesh feature tree. Inspect the changed region from
complete views before applying.

For critical mating geometry, prefer retaining the original source region while
editing surrounding material when the tools support it. Bounds and a single
section cannot capture rounding across a hook's width, tapered ends or a latch
undercut. Compare several transverse and longitudinal sections in an aligned
frame, including entry tips and roots. State which surfaces are retained from
the source and which are reconstructed; sampled agreement is not a global proof.
