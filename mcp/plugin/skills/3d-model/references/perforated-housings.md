# Rebuilt and perforated housings

Use for softer exterior corners, hexagonal wall cutouts and a native reconstruction
of an imported housing. These are measured design workflows, not automatic mesh
conversion or structural certification.

1. Read the current document. Cosmetic edits may concern a newly loaded model;
   do not assume the previous product is still present. Inspect representation.
   If fillets require native geometry but only a mesh is available, explain the
   limit of that fillet operation, then test a typed `combine` on the current
   body for a local cut or join. A rejected mesh fillet does not prove a
   boolean is unavailable. Request a source file only when the current body and
   supported operations cannot express the requested edit and reconstruction is
   necessary. Once reconstruction is authorized, measure floor, cavity, access
   cutout and hooks from sections and line samples. Prefer retaining source
   mounting geometry to recreating it from a 2D extrusion: matching its middle
   section can still lose the 3D rounding needed for insertion. Distinguish
   reconstructed surfaces from retained ones, and keep the source available for
   comparison.
2. Establish a visible design change: outer corner radius, touch-edge radius,
   perforation count, hole orientation, rib thickness and solid perimeter. Keep
   floor and load paths around mounting roots solid. Change corner radii in the
   native base profile before selecting later edge modifiers.
   When thinning a fitted holder, preserve its functional cavity unless changing
   the fit is requested. Consider trimming the exterior instead of enlarging the
   pocket; retain local root pads if necessary to connect original hooks. Measure
   wall and floor sections independently and report any retained thicker zones.
3. For a suitable flat face, discover `holePattern` with `shape: "hex"`. Verify its
   local axes and actual output. A requested row/column
   count may be filtered by the selected flat face and margin. Inspect the number
   and position of holes on both sides rather than reporting the requested count.
   Measure margins to the full housing boundary separately from the tool's margin
   to a reduced planar face. Do not reduce a required frame to make a pattern fit.
   Recheck the pattern after changing wall thickness or curvature. A cut near a
   curved transition can leave knife edges despite adequate nominal wall thickness.
   Move, resize or reduce an unconstrained pattern to resolve them and report the
   departure; do not silently drop an explicitly required hole count.
4. If a fitted pattern cannot express the orientation or layout, use an explicit
   `regularPolygon` sketch, a native cut extrusion and `featurePattern` along a
   named world axis. Set the cut directly on the sketch-backed `extrude` feature;
   `featurePattern` cannot repeat a `combine` operation. For an STL, compare
   material intervals at the same world coordinates before and after the cut
   to confirm material was removed and protected walls remain. A cut through
   both walls is suitable only when the intervening
   space is empty and no other feature is crossed. Inspect both sides. For a
   regular hexagon, across-flats size is not its vertex-to-vertex span: derive rib
   spacing from the oriented profile, then verify it with solid intervals.
5. For upright FDM walls, consider flat-top hexagons with short top bridges.
   Measure the resulting geometry. The overhang heuristic does not model bridging;
   a thin-wall check can pass while the report still warns about bridges or hook
   overhangs. Report warnings and the slicer check explicitly; do not call the
   model support-free solely because `checks[].pass` is true. Use the print
   reference's profile and inspect the intended print pose.
   Perforations can reduce material while increasing print time through added
   perimeters, short moves and bridges. When time or cost matters, compare sliced
   variants with the same printer, material, orientation and process profile;
   geometry volume alone cannot establish a time saving.
6. A valid CAD preview can still contain degenerate triangles after filleting.
   Inspect mesh validity before apply. Compare the unfilleted baseline, isolate
   problematic edge groups, and reacquire selectors after geometry changes.
   Repeating smaller radii without isolating the failure is not a diagnosis.
   Report any omitted rounding as a design departure; never silently apply an
   invalid mesh or claim that every edge was softened.
7. For an authorized edit, apply the validated design in the authorized document
   and reread its body id; honor requests for a proposal or preview only.
   Verify placement. Replacements should occupy the previous design's position;
   comparison copies need an explicit location. Report preview, applied, saved
   and exported states accurately so the user does not have to request insertion
   on the board again.
