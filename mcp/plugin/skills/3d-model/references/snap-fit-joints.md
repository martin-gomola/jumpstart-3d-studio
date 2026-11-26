# Snap-fit joints

Use this reference for a flexing latch on a multi-part FDM print: a cantilever
hook, a slotted annular detent, a torsion clip, a split pin, or a bayonet catch.
Rigid glue-free joints (dovetails, mortise-and-tenon, wedges, scarfs) belong to
the `woodwork-joints-3d` companion, not here. Read
[Fit and print checks](fit-and-print-checks.md) and
[Print setup and hardware](print-and-hardware.md) with this file.

## Contents

- Choose the latch
- Size the beam
- Leave room for the flex
- Orient and print it
- Model and verify

## Choose the latch

Decide what the latch resists. Locating faces carry shear: pins, rims, or
grooves. The latch only resists pull-off. Do not ask a hook to align the parts.

| Need | Use |
| --- | --- |
| Lid, cover, or removable panel | Cantilever hook, one or more, with locating pins or a rim |
| Round cap or knob | Slotted annular detent. A continuous ring is a hoop strain; slots turn it into bending, which this workflow can check |
| Cover that must open from the outside | Torsion clip: a bar twists and a short catch drops into the seat |
| Peg into a hole, or a panel on posts | Split pin: two or more leaves around a core |
| Part that turns a short angle to lock | Bayonet: a printable ramp plus a small detent. The ramp guides; the detent holds |

Ask for the missing engagement direction, whether the user must open it
repeatedly, and which material. A one-time permanent catch and a serviceable
cover are different return faces.

## Size the beam

The Covestro snap-fit guide treats the permissible deflection as equal to the
undercut the beam must pass. Taper the beam thickness toward the hook; the
guide's preferred linear taper to half the root thickness raises the allowable
deflection by more than 60 percent versus a constant section. If both parts
flex, split that deflection between them. After assembly the beam must be able
to return to a stress-free seat. For a joint that will be opened repeatedly,
use about 60 percent of the single-assembly allowable strain.

Do not copy a molding-resin strain from that guide into PLA, PETG, ASA, or TPU.
Those tables are for Covestro molding resins. When the filament's allowable
snap strain is unknown, do not present a calculated deflection as the printed
one. Lengthen the beam or reduce the hook until a coupon flexes easily, and
keep the strain conclusion unverified.

On the default X2D 0.4 mm profile, start a free-standing beam at a 2.4 mm root
and a 1.2 mm tip. The root stays above the print reference's 2.0 mm cantilever
minimum, and the tip is the guide's half-thickness taper while remaining above
the 1.0 mm supported-wall minimum. The root radius should not be under 0.4 mm,
and about half the root thickness is the useful upper target when it does not
consume the flexible length. The guide shows that a very large root radius
stops reducing stress and only shortens the beam.

Name `snap_root`, `snap_tip`, `snap_length`, `snap_undercut`, `snap_clearance`,
`snap_lead_angle`, and `snap_return_angle`. Start `snap_clearance` at the fit
reference's 0.2 mm per side. Start `snap_undercut` at 0.8 mm so the hook is a
printable positive feature, not a paper-thin lip. Start both angles near 45
degrees, which is the guide's worked lead and return. Round the hook edge. Use
a shallower return only when the user wants an easier opening, and a steeper
return only when they want it to stay closed. A steep return needs a finger
recess or a tool slot. Do not pry the beam apart across layers to open it.

The deflection the beam must survive is the undercut plus the per-side
clearance, not the undercut alone. If the beam cannot pass that distance
without a coupon that creases or whitens, change the length or the hook.
Do not keep both and call the joint acceptable.

## Leave room for the flex

Beside or behind the beam, leave an empty pocket at least as deep as the
deflection above, and at least as wide as the beam's moving face. A fillet, a
rib, or the mating wall must not fill that pocket. The seated hook needs a
ledge deeper than the undercut so the beam can relax. A hook that remains bent
after the click will creep, especially in PLA.

Keep the locating fit separate from the latch. Pins and rims use the ordinary
sliding clearance. The hook's temporary interference during insertion is not a
collision to Boolean away.

## Orient and print it

Print the beam so its length and its bending thickness both lie in XY. The
outer-fiber tension then runs along extruded lines. A beam printed flat on the
bed that must flex in Z is loaded across the layer bonds; rotate it or choose
another latch. The same rule applies to a torsion bar: its axis lies in XY.

Chamfer bed-facing edges. Keep unsupported faces within the print reference's
45 degree limit, including the hook's lead-in in the chosen pose. A flat ledge
under the hook becomes a shelf; slope it or put that face on the bed. Slots in
a split pin or annular detent must stay open after slicing. Start a slot at
1.0 mm and check it in the slicer, because a narrower gap can fuse shut.

PLA is the brittle default and creeps if left bent. PETG is the better default
for a cover that will be opened repeatedly. ASA adds heat resistance and still
needs its own coupon. TPU can be the flexing member only, as a separate body;
do not use it for the locating pins. Name the material in the report.

## Model and verify

There is no snap-fit operation. Build the beam with sketches, extrudes, and a
root fillet, and expose the named parameters above. Preview the two parts in
the seated pose.

Attach `requirements.pairs` for that pose: `maximumOverlapVolume` 0, and
`minimumClearance` only on faces that must not touch. A locating shoulder may
sit at zero distance. A seated pair check cannot prove that the hook can pass
the lip during insertion. Measure the undercut, the relaxed seat, the root
thickness, and the empty pocket with sections through the beam. Run
`jumpstart_inspect_geometry` with `printOrientations: {}` and reject a pose
that bends the beam across layers. Attach the printability check, then still
section the free-standing root against the 2.0 mm rule, because one `minWall`
does not grade cantilevers separately.

Before printing the whole product, preview and export one coupon of a single
latch in the same orientation, profile, and material. The coupon checks
insertion, retention, and removal. A valid mesh, a passed pair check, or a
nominal strain does not prove cycle life, opening force, or that the beam
returns. Report those as unverified until the coupon is printed.
