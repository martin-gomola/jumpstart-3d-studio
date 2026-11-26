# Geared machines

Use this when one crank should drive several motions, such as an orrery.
Read the `gear` schema through [Knobs, gears and turned parts](knobs-gears-and-turned-parts.md)
before building. The operation makes one spur, rack, or straight bevel with
nominal zero-backlash teeth and no root undercut. It does not place the mating
wheel and it does not turn the machine.

## Function before parts

Name the input and every output before modeling. For each output record the
turns per input turn, the axis, and whether the output sits on a carrier that
also rotates.

A pair that meshes uses one module. Its centre distance is module times
(driver teeth plus driven teeth) divided by two. Output turns equal input
turns times driver teeth divided by driven teeth. Pitch radius is module times
tooth count divided by two. An extra spur between a pair flips direction and
leaves the ratio unchanged. A rack moves π times module times pinion teeth per
pinion turn. Place its pitch line one pitch radius from the pinion centre.

When the train crosses onto a carrier that itself rotates, add that carrier's
turns to the output's turns relative to the ground.

Use at least 17 teeth on spur and bevel gears at a 20-degree pressure angle,
and stay within the operation limit of 120 teeth. The schema accepts 6 to 120
teeth, but below 17 teeth these un-undercut profiles can rub against a larger
mate. State the ratio you achieve and how it differs from the requested
function. Do not copy a commercial model's parts.

For a right-angle pair, set each `coneAngle` to the angle whose tangent is its
own tooth count divided by its mate's, so the two angles sum to 90. Use the
same module. The bevel operation does not certify tooth contact.

## Parts you may use

Build the machine from gear operations and plain frames. Do not invent a
custom tooth profile or a one-piece gearbox.

| Function | Part |
| --- | --- |
| Spur reduction or idler | `gear` with `gearType` `spur` |
| Right-angle turn | `gear` with `gearType` `bevel` |
| Straight slide | `gear` with `gearType` `rack`, driven by a spur |
| Axle | `cylinder` primitive through the gear `bore` |
| Crank | `knurl`, or a cylinder handle on the input shaft |
| Planet or sun | `sphere` primitive |
| Arm, base, or bearing plate | `box` primitive |

Start the rotating bore 0.2 mm per side over the axle. Because `gear` has no
built-in tooth print clearance, add a named radial centre-distance allowance
(`gear_backlash`, starting at 0.2 to 0.4 mm for a 0.4 mm nozzle) and phase the
driven wheel so a tooth enters a gap (rotate an even-toothed mate by 180
divided by its tooth count in degrees). Confirm both allowances on the coupon
before copying them through the machine.

## Orrery like set 42179

Published reviews of LEGO Technic 42179 count about 3 Earth spins per crank, a
Moon orbit about every 27 of those spins, one year in about 121.5 cranks, and
an Earth tilt of 22.5 degrees. The Sun's gear path crosses the year arm, so
its speed against the ground includes that arm. Use those counts as the
function. Do not rebuild the set's bricks or its instruction steps.

One original train at module 1.5 mm (all wheels 18 to 108 teeth, largest
outside diameter 165 mm):

| Output | Teeth, driver then driven | Result |
| --- | --- | --- |
| Earth spin | 54 then 18 | 3 spins per crank |
| Moon orbit | 18 then 54, then 18 then 54 | 1/9 turn per crank, 27 Earth spins per orbit |
| Year arm | 18 then 81, 18 then 81, 18 then 108 | 1 turn per 121.5 cranks (364.5 spins per year) |
| Sun | same 1/9 relative to the year arm | add the arm's turn for rotation against the ground |
| Earth tilt | none | rotate the Earth mount by 22.5 degrees |

Say that this train is a chosen approximation. It is not the set's gear list
and it does not fit official LEGO parts. The planets are spheres.

## Print and verify

Print each spur with its face on the bed so the tooth profile lies in XY.
Start at module 1.5 mm or 2 mm. Section one tooth before accepting a finer
module. Keep every body inside the print envelope. Fold a long train with an
idler instead of exceeding the bed.

Preview one phased meshing pair on a short test plate before the whole
machine. Do not require `maximumOverlapVolume` 0 on an un-backlashed nominal
mesh, because touching involute flanks can fail that check or force teeth out
of engagement. Use `maximumOverlapVolume` 0 for non-meshing clearances (gears
against frames, plates, axles, and stacked layers), and section the mesh plane
to inspect tooth engagement and root clearance. A seated pair check cannot
prove that the gears turn. Export that test pair and plate as a coupon. Report
smoothness, backlash, and the running ratios as unverified until someone turns
the coupon by hand.
