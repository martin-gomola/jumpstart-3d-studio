# Fitted adapters for existing holders

Use when a new insert must fit an existing holder while preserving the item-facing
opening and the holder's mounting features. Load [Imported parts](imported-parts.md)
only when import handling or resizing is also needed.

1. Identify the holder, shaped insert and any earlier agent drafts that are
   present. Reread the document after the user adds or moves a
   body. Never treat a prior preview or applied-body selection as the user's new
   choice. Preserve the holder and unrelated bodies in attached requirements.
2. Establish the fit frame: insertion direction, holder wall or floor, item-facing
   opening, and mounting interface. Measure the holder's *interior* with sections
   and line samples at several heights and positions. Whole-body bounds are not
   cavity dimensions. Record the user's printed measurements alongside CAD
   measurements and investigate disagreements before changing geometry.
3. Preserve a supplied item contour. A rounded rectangle based only on overall
   product dimensions is a provisional envelope, not an exact substitute for a
   supplied STEP or measured outline. If the shaped insert is already present,
   build outward from that body; do not replace it with a generic frame. Keep
   external holder clearance separate from internal item clearance.
4. Choose a supported edit that preserves the item-facing shape and meets the
   measured external clearance and wall requirements. One option for a filler is
   a native outer envelope with the item opening removed, joined to the existing
   insert. Check that the added material overlaps the insert sufficiently to join
   without gaps or thin slivers, while remaining outside the protected opening.
   If the source was over-trimmed, positioning and clipping may be needed before
   adding material. Prefer a simpler supported parameter or feature edit when it
   meets the same requirements. Do not scale the entire source when that also
   changes its item-facing opening.
5. Preview before apply. Check the source holder is unchanged; compare inner
   opening intervals before and after at multiple stations; check outer intervals
   against the holder at the same world coordinates and several heights; inspect
   floor and end-wall thickness, mesh components and complete views. A successful
   `combine` or mesh validation does not prove that a mesh used as a cutting tool
   actually removed overlapping material. Verify the expected material delta
   independently. Failed, unknown or contradictory fit evidence blocks apply.
6. For an authorized model edit, make the result visible in the editor; honor a
   request for a proposal or preview only. A preview is not an applied body; say
   which it is. After applying a successful preview, reread the document, identify the
   final body, and export only that printable body when an export is needed.
   Earlier agent drafts must not be described as the final insert. If the MCP
   cannot remove an obsolete draft safely, identify it explicitly rather than
   using undo after later user edits.

CAD sections and nominal clearances support a prototype, not certified physical
fit. Use a small test print when printer tolerance is unknown.
