# Source lookup and test selection

## Look up the filament

Use the [Open Filament Database docs](https://openfilamentdatabase.org/docs) and static API on `api.openfilamentdatabase.org`. Prefer a user-provided exact product, or resolve the brand in `/api/v1/brands/index.json`. Follow the material and filament paths returned by the brand and material indexes. Preserve path casing. The [Bambu PETG Basic record](https://api.openfilamentdatabase.org/api/v1/brands/bambu_lab/materials/PETG/filaments/petg_basic/index.json) uses uppercase `PETG` in the API. Match the product name and brand and check diameter or variant when meaningful.

Compare print temperature as a range, speed limits in mm³/s, fan in percent and drying in degrees and time. Compare bed temperature only when the surface and field match. Read the manufacturer's data for drying when available, including the equipment it specifies. Do not treat the database's advertised throughput or generic profile as calibrated on the user's hotend. Leave missing values blank. For Bambu PETG Basic, prefer the [manufacturer's technical sheet](https://store.bblcdn.com/s1/default/cb94589bf7994fdcbfa833badefae9cd/Bambu_PETG_Basic_Technical_Data_Sheet.pdf) for published equipment-specific drying guidance. The [Bambu X2D manual](https://csm.bblcdn.com/hub/7c58718aaa2e40edab56efb87419a96a.pdf) explains its Bambu Studio calibration workflow. Use the [OrcaSlicer calibration guide](https://github.com/OrcaSlicer/OrcaSlicer/wiki/calibration_guide) to select and score a test. A method described for Orca may have a different name or entry point in Bambu Studio.

The [bambu-filament-profiles README](https://github.com/skornehl/bambu-filament-profiles#sources-and-priority) is a reference for tracking where a profile value came from. Its generator merges public databases with inherited Generic settings and targets the P1S 0.4 mm by default. Treat generated values as hypotheses even for matching materials. For X2D, use the saved X2D project and known measurements; do not transfer a P1S value just because the nozzle diameter matches.

## Select one test

| Observation and evidence | Candidate single test |
| --- | --- |
| Fine strings or popping, with damp or unverified filament | Compare the same small part before and after documented drying, with the same settings. |
| Stringing on known dry filament, with temperature still uncertain | Temperature tower within the documented material range. Compare strings and layer bond before choosing a segment. |
| Uniform top surfaces with gaps or raised ridges | Flow ratio calibration and compare flatness and fill. |
| Bulging corners or gaps after speed transitions | Flow Dynamics / pressure advance calibration and compare transition uniformity. |
| Under-extrusion mainly on faster, sustained lines, after temperature is established | Maximum volumetric speed test. Locate the first sustained loss of surface consistency or extrusion. |
| Adhesion or squish varies by plate location | Repeat a short first-layer pattern on the same build plate and compare the affected and unaffected regions. Keep slicer settings fixed while isolating the relevant plate condition. |

The table suggests starting points. Check the photo, actual saved settings and material limitations before choosing. If what looks like a filament issue follows the same geometric feature or seam on every print, inspect that feature and slicer preview before tuning the material.
