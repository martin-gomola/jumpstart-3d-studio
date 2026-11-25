# Sliding lids that catch a flange

## Read the reference and locate the contact

- Inspect the underside, entry and closed position in reference CAD or photos supplied with a 3MF. A reference shows how the mechanism works. Size the new interface from the actual container.
- Establish flange thickness, outside width, usable underside projection and any wall taper at the hook depth. A calibrated top photo can estimate the outline and corner radius. Use the side view to identify a visible overhanging flange and keep dimensions uncertain if it is out of the scale plane. See the workflow table for photo measurements.
- Keep the rail spacing, vertical slot, and hook reach as separate parameters. Use the user's clearance on the specified axis and account for folded foil in the mating envelope. A nominal flange thickness alone gives neither the rail spacing nor the amount of underlap.

## Model the path and the catch

- Start with a U layout for a one-way lid: open entry, two side rails and a rear travel stop. Follow the user's motions from entry through full closure and back out. Check for a front crossbar or abrupt edge that could bunch the foil, and leave a way to grasp the lid.
- In a section through the flange, identify which surfaces guide it, which prevent lift, and which stop travel. Use a return under the visible flange for retention. A bump on a vertical stop can make side contact but cannot catch the underside. If foil should be held only at closure, keep the foil contact near the rear and leave it room along the entry path. Verify the actual contact with the folded foil before calling it a clamp or seal.
- When slimming the rails, shorten their return and reduce excess height first. Keep a broad root joined to the lid, and keep its outside face flush with the lid edge when the envelope and mating geometry allow. Preserve rail spacing and slot height when changing only the outer root or return.
- In the intended print pose, start with the broad lid face on the bed and use a sloped return suited to the printer's overhang limit. A flat lip can become an unsupported shelf in this pose. Shorten the return or adjust its slope while keeping useful underlap and a printable tip.

## Verify before applying

- Preview the full underside and a transverse section through the working rail. Inspect a longitudinal section through the rear catch and a line sample at the entry. Use `jumpstart_inspect_geometry` with the preview ID and axis samples to measure the open entry, rail spacing, root thickness, slot height, and return reach. Sample away from tangent and boundary faces. Inspect the actual flange in the same section or pose when reliable mating geometry is available.
- Attach checks for the outer envelope, one connected body, and the specified overhang limit in the print pose. Inspect the root and tip after a thickness change. Report geometric checks and physical checks separately. A short coupon with the same rail profile and print orientation can check insertion and clearance; the full lid with the original foil checks closure, removal, and retention.
