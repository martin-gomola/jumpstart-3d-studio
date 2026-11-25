import assert from "node:assert/strict";
import test from "node:test";
import { readX2DProfiles, x2dBuildTransform, X2D_DEFAULT_FILAMENT, X2D_PRINTER, X2D_PROCESS } from "../../src/bambu-project.js";

test("X2D profile packs contain distinct single-filament 0.4 mm presets for the Standard process", () => {
  const profile = {
    printer_settings_id: X2D_PRINTER, print_settings_id: X2D_PROCESS, printer_variant: "0.4",
    layer_height: "0.2", version: "02.09.01.70", filament_settings_id: [X2D_DEFAULT_FILAMENT],
    curr_bed_type: "Textured PEI Plate", extruder_nozzle_diameter: ["0.4", "0.4"],
  };
  const read = (...profiles) => readX2DProfiles(JSON.stringify({ format: "jumpstart-bambu-x2d-v1", profiles }));
  assert.deepEqual(read(profile), [profile]);
  assert.throws(() => read(profile, profile), /profile pack/);
  assert.throws(() => read({ ...profile, extruder_nozzle_diameter: ["0.4", "0.6"] }), /profile pack/);
  assert.throws(() => read({ ...profile, print_settings_id: "Draft" }), /profile pack/);
});

test("X2D export centers and grounds the whole layout and rejects oversized models", () => {
  assert.equal(x2dBuildTransform([-5, 10, -3], [35, 50, 12], 261), "1 0 0 0 1 0 0 0 1 113 98 3");
  assert.throws(() => x2dBuildTransform([0, 0, 0], [257, 30, 20], 261), /too large/);
});
