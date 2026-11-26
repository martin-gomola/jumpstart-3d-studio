# Modular clip crates

Use this for a stackable crate or box built from separate printed parts that
clip together: corner posts, edge rails, panels, and small latches. A single
flexing latch is in [Snap-fit joints](snap-fit-joints.md). Read that file
before sizing a clip.

A photo of a commercial system, including a Blokz-style crate, shows the part
roles only. It is not a measured drawing and it is not permission to reproduce
that product. Design an original crate. Do not copy its labels, mesh artwork,
or section, and do not claim the result fits the commercial parts.

## Contents

- Name the parts
- Choose the clip
- Size and print
- Verify

## Name the parts

Agree the outside width, depth, and one module height before modeling. A photo
does not supply those sizes. Call one module `H` and a double module `2H`, and
keep both on the same corner and rail sections so they stack only if the user
asks for a stack.

Keep the parts separate bodies:

| Part | Role |
| --- | --- |
| Corner post | Locates the vertical edges. One height is `H` or `2H`. |
| Edge rail | Spans between two corners and carries the panel. |
| Panel | Mesh or solid fill for a side or the floor. It does not carry the crate's shear. |
| Clip | Small latch that holds a panel or rail after the shoulders are seated. |
| Lid | Optional cover. It uses the same clip or a rim, not a new joint type. |

Four corners, rails between them, then panels, then clips. The corner and the
rail shoulders carry the load. The clip only resists pull-off. A loose spring,
pin, or nut is hardware from the print reference or `step-parts`, not one of
these printed parts.

## Choose the clip

Use a rounded bead on the panel or rail and a jaw on the clip. The jaw needs a
lead-in, a small return, and an empty pocket so it can flex and then sit
without preload. Locating shoulders seat before the bead reaches the return.
Do not ask the bead to align the crate.

Follow the snap-fit reference for root and tip thickness, the half-thickness
taper, the root radius, the 0.2 mm per-side starting clearance, and the 0.8 mm
starting undercut. As starting values for the coupon (not measured commercial
sizes), use a 1.2 mm bead radius (2.4 mm bead width, above the 2.0 mm
free-standing minimum), a 2.4 mm jaw root tapering to a 1.2 mm tip, and a
deflection pocket at least `crate_undercut + crate_clearance` deep. Name
`crate_bead`, `crate_undercut`, `crate_clearance`, and `crate_jaw_length`. A
serviceable crate is opened repeatedly, so use the repeated-opening strain
reduction and prefer PETG for the clips. PLA corners and rails are acceptable
when the clips are the only flexing parts.

## Size and print

Keep every corner, rail, panel, and clip inside the print reference's usable
envelope. Split a long side into more than one rail instead of exceeding the
bed. Mesh openings stay large enough that the printed strands are at least the
2.0 mm free-standing minimum. A decorative hole pattern that leaves knife edges
is not a panel.

Print each clip so its jaw length and bending thickness lie in XY. Print rails
and corners with their long axis in XY when that pose does not put the bead's
lead-in past 45 degrees. Panels lie flat. Chamfer bed-facing edges.

State every size as `given`, `measured`, or `assumed`. Outer size and `H` are
assumed until the user supplies them. The commercial photo does not calibrate
them.

## Verify

Preview one corner, one rail, one panel edge, and one clip in the seated pose
before building the whole crate. Attach `requirements.pairs` with
`maximumOverlapVolume` 0. A seated pair check cannot prove that the jaw can
pass the bead. Section the bead, the return, the empty pocket, and the root.

Export one clip coupon on a short rail in the crate's print pose and material
before the full set. Report stack fit, clip life, and compatibility with any
commercial crate as unverified.
