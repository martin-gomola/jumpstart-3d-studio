# LEGO part references

Use this workflow for LEGO-compatible geometry, named LEGO elements, LEGO part numbers, or parts intended to connect to LEGO System pieces.

## Find a part and its nominal dimensions

1. Search the [Brick Architect LEGO Parts Guide](https://brickarchitect.com/parts/) by part name or element number. It is a useful visual index with metric dimensions and cross-links to other catalogs, but it is an independent fan resource, not an official LEGO specification. Coverage and detail vary by part. For example, its [92947 page](https://brickarchitect.com/parts/92947) identifies the 2×2 round ribbed brick, lists a 15.83 mm diameter, and links to LEGO Pick a Brick, BrickLink, Rebrickable, Brickset, and LDraw.
2. Use the [LDraw Official Parts Library](https://library.ldraw.org/) when you need a digital reference shape. Search by the LEGO or LDraw part number, then inspect the part file and its header. For the user's [92947 BrickOwl example](https://www.brickowl.com/catalog/lego-brick-2-x-2-round-with-grille-92947), LDraw has an [official 92947 part entry](https://library.ldraw.org/parts/list?tableSearch=92947.dat). The library is community maintained and is not affiliated with LEGO. Attribute CC BY 4.0 parts when redistributing derived geometry; some parts may instead be CC0, so check the individual part's license.
3. Use [BrickOwl](https://www.brickowl.com/) and [BrickLink](https://www.bricklink.com/) as secondary catalogs for names, identifiers, variants and sourcing. BrickLink says its catalog dimensions are mainly for item identification and shipping estimates; do not treat those fields as complete measured CAD geometry.

## Convert standard System dimensions

The [LDraw format specification](https://www.ldraw.org/article/218.html) defines 20 LDU per brick stud pitch, 24 LDU per brick body height, 8 LDU per plate height, 12 LDU per stud diameter, and 4 LDU per stud height. Its 1 LDU = 0.4 mm conversion is explicitly approximate. This gives nominal reference values of 8 mm pitch, 9.6 mm brick body height, 3.2 mm plate height, 4.8 mm stud diameter and 1.6 mm stud height. The exterior width of a molded part can be smaller than its grid envelope, and specialized parts may differ; use the part-specific catalog entry or reference shape where available.

For a mating part, state which dimensions come from a catalog or LDraw and which are assumptions. Keep printed fit clearances editable, and use a small fit coupon or test print to confirm engagement. A catalog dimension or tessellation check alone does not establish that a printed part will fit a LEGO element.

## LEGO socket patterns and print feedback

For repeated sockets on a flat bottom face, prefer the typed `holePattern` operation for a grid of round blind holes when its current schema covers the requested face and layout. Read the current schema before building. For a 2×2 LEGO footprint, the nominal stud pitch is 8 mm; expose socket diameter and depth as named model parameters when fit may need tuning.

Project calibration note: the maintainer reports a firm fit on a Bambu Lab X2D with a 5.0 mm socket over a nominal 4.8 mm stud (0.2 mm diametral clearance). Treat that as verified only for the tested X2D setup. P1S and P2S similarity is the maintainer's assumption, not a tested result; use a fit coupon when changing printer, material or profile. When the user reports a fit test, use it instead of resetting to the generic starting clearance and change only the fit parameter under review.

The `socketArray` acceptance check measures X/Y spans and blind depth at declared world XY centers. It does not prove roundness or physical fit; retain a slicer or test-print check for a snap interface.

For the stump in this project, the first 0.22 mm grooves were not visible after printing. The revised 0.8–1.2 mm wide, 0.4–0.6 mm deep bark grooves have not yet been printed; treat those values as provisional and verify their appearance in the slicer or on a test print.

## LEGO socket patterns and print feedback

For repeated sockets on a flat bottom face, prefer the native `holePattern` operation for a grid of round blind holes when its current schema covers the requested layout. Read the current schema before building. For a 2×2 LEGO footprint, the nominal stud pitch is 8 mm; expose socket diameter and depth as named model parameters when fit may need tuning.

The user has tested a 5.0 mm socket over a nominal 4.8 mm stud on a Bambu Lab X2D and reports a firm fit. This is 0.2 mm diametral clearance. The user expects the P1S and P2S to behave similarly, but has not tested those printers; label that as an assumption and use a fit coupon when switching printer, material or profile. When the user reports a fit test, use it instead of resetting to the generic starting clearance and change only the fit parameter under review.

For this user's first stump print, 0.22 mm grooves were not visible. The revised 0.8–1.2 mm wide, 0.4–0.6 mm deep bark grooves have not yet been printed; treat those values as a provisional design and verify their appearance in the slicer or on a test print.

Attach a `socketArray` acceptance check to expected world XY centers, X/Y opening spans and depth. It verifies those dimensions from mesh line intersections, but does not prove the opening is circular or that a print will snap onto a LEGO stud.
