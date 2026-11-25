import { crc32, inflateRawSync } from "node:zlib";

const ENTRY = "Metadata/project_settings.config";
const MAX_SETTINGS = 1024 * 1024;
const ZIP_END = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;

const FIELDS = {
  printer: [
    "printer_model", "printer_settings_id", "printer_variant", "nozzle_diameter",
    "extruder_nozzle_diameter", "extruder_nozzle_volume_type", "curr_bed_type",
    "retraction_length", "retraction_speed",
  ],
  process: [
    "print_settings_id", "layer_height", "initial_layer_print_height", "line_width", "wall_loops",
    "sparse_infill_density", "outer_wall_speed", "inner_wall_speed", "initial_layer_speed",
    "overhang_speed_classic", "slow_down_for_overhang", "bridge_speed", "enable_support", "brim_width", "seam_position",
  ],
  filament: [
    "filament_settings_id", "filament_type", "filament_vendor", "filament_colour", "filament_diameter",
    "nozzle_temperature", "nozzle_temperature_initial_layer", "nozzle_temperature_range_low", "nozzle_temperature_range_high",
    "cool_plate_temp", "cool_plate_temp_initial_layer", "eng_plate_temp", "eng_plate_temp_initial_layer",
    "hot_plate_temp", "hot_plate_temp_initial_layer", "textured_plate_temp", "textured_plate_temp_initial_layer",
    "supertack_plate_temp", "supertack_plate_temp_initial_layer", "effect_plate_temp", "effect_plate_temp_initial_layer",
    "filament_flow_ratio", "filament_max_volumetric_speed", "filament_retraction_length", "filament_retraction_speed",
    "fan_min_speed", "fan_max_speed", "close_fan_the_first_x_layers", "slow_down_layer_time",
    "enable_pressure_advance", "pressure_advance", "filament_map",
  ],
};

function readSettingsEntry(bytes) {
  const invalid = () => new Error("The 3MF ZIP directory or settings entry is damaged or unsupported.");
  let end = bytes.length - 22;
  const earliest = Math.max(0, end - 65535);
  while (end >= earliest && (bytes.readUInt32LE(end) !== ZIP_END ||
      end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length)) end--;
  if (end < earliest || bytes.readUInt32LE(end + 4) !== 0) throw invalid();
  const count = bytes.readUInt16LE(end + 10);
  const directoryStart = bytes.readUInt32LE(end + 16);
  const directoryEnd = directoryStart + bytes.readUInt32LE(end + 12);
  if (count > 10000 || count !== bytes.readUInt16LE(end + 8) || directoryEnd !== end) throw invalid();

  let offset = directoryStart;
  let entry;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > directoryEnd || bytes.readUInt32LE(offset) !== ZIP_CENTRAL) throw invalid();
    const nameLength = bytes.readUInt16LE(offset + 28);
    const next = offset + 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    if (next > directoryEnd) throw invalid();
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name.replace(/^\//, "").toLowerCase() === ENTRY.toLowerCase()) {
      if (entry || bytes.readUInt16LE(offset + 34) !== 0) throw invalid();
      entry = { name, flags: bytes.readUInt16LE(offset + 8), method: bytes.readUInt16LE(offset + 10),
        checksum: bytes.readUInt32LE(offset + 16), compressed: bytes.readUInt32LE(offset + 20),
        size: bytes.readUInt32LE(offset + 24), local: bytes.readUInt32LE(offset + 42) };
    }
    offset = next;
  }
  if (offset !== directoryEnd) throw invalid();
  if (!entry) return null;
  const { flags, method, compressed, size, local, checksum, name } = entry;
  if (size > MAX_SETTINGS) throw new Error("The embedded print settings exceed the 1 MiB read limit.");
  if (local + 30 > directoryStart || bytes.readUInt32LE(local) !== ZIP_LOCAL ||
      (flags & 1) || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) throw invalid();
  const nameEnd = local + 30 + bytes.readUInt16LE(local + 26);
  const start = nameEnd + bytes.readUInt16LE(local + 28);
  if (start + compressed > directoryStart || bytes.subarray(local + 30, nameEnd).toString("utf8") !== name) throw invalid();
  const data = bytes.subarray(start, start + compressed);
  let output;
  try {
    if (method === 0) output = data;
    else if (method === 8) output = inflateRawSync(data, { maxOutputLength: MAX_SETTINGS });
  } catch { throw invalid(); }
  if (!output || output.length !== size || crc32(output) !== checksum) throw invalid();
  return output;
}

function scalar(value) {
  return typeof value === "string" && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value) ||
    typeof value === "boolean" || Number.isFinite(value);
}

export function inspectPrintProject(bytes) {
  const entry = readSettingsEntry(bytes);
  if (!entry) return { status: "missing_settings", message: "This 3MF has no Bambu Studio or OrcaSlicer project settings. Save the actual job as a project 3MF from the slicer." };
  let config;
  try { config = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(entry)); }
  catch { throw new Error("Embedded print settings are not valid UTF-8 JSON."); }
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Embedded print settings must be a JSON object.");

  const settings = Object.fromEntries(Object.entries(FIELDS).map(([group, fields]) => [
    group, Object.fromEntries(fields.flatMap(key => {
      if (!Object.hasOwn(config, key)) return [];
      const value = config[key];
      // Arrays keep their original order. Dropping slots could misidentify the material.
      return scalar(value) || (Array.isArray(value) && value.length <= 64 && value.every(scalar)) ? [[key, value]] : [];
    })),
  ]));
  return {
    status: "read", source: ENTRY, settings,
    scope: "Project-level settings saved in the file. Plate, object, modifier and g-code overrides, calibration stored outside the project, and current printer state are not inspected.",
  };
}
