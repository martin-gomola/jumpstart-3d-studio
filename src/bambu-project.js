export const X2D_PRINTER = "Bambu Lab X2D 0.4 nozzle";
export const X2D_PROCESS = "0.20mm Standard @BBL X2D";
export const X2D_DEFAULT_FILAMENT = "Bambu PETG Basic @BBL X2D 0.4 nozzle";
export const X2D_PROFILE_KEY = "jumpstart.bambu-x2d.profiles";
const X2D_FILAMENT_SUFFIX = " @BBL X2D 0.4 nozzle";

export function x2dFilamentLabel(profile) {
  return profile.filament_settings_id[0].replace(X2D_FILAMENT_SUFFIX, "");
}

export function loadStoredX2DProfiles(storage) {
  try {
    const raw = storage?.getItem(X2D_PROFILE_KEY) || "";
    return raw ? readX2DProfiles(raw) : [];
  } catch {
    return [];
  }
}

export function selectX2DProfile(profiles, filament) {
  if (!Array.isArray(profiles) || !profiles.length) {
    throw new Error("No X2D profile pack is loaded in the editor. Load one in Open/Export -> Export X2D project first.");
  }
  if (!filament || filament === true) {
    return profiles.find(p => p.filament_settings_id[0] === X2D_DEFAULT_FILAMENT) ?? profiles[0];
  }
  const wanted = String(filament).trim().toLowerCase();
  const match = profiles.find(p => {
    const full = p.filament_settings_id[0].toLowerCase();
    const label = x2dFilamentLabel(p).toLowerCase();
    return full === wanted || label === wanted;
  });
  if (!match) {
    throw new Error(`Unknown X2D filament "${filament}". Loaded filaments: ${profiles.map(x2dFilamentLabel).join(", ")}.`);
  }
  return match;
}

export function readX2DProfiles(text) {
  if (text.length > 1024 * 1024) throw new Error("The profile pack is too large.");
  let decoded;
  try { decoded = JSON.parse(text); } catch { throw new Error("Choose a valid JumpStart profile pack (.json)."); }
  const { format, profiles } = decoded ?? {};
  if (format !== "jumpstart-bambu-x2d-v1" || !Array.isArray(profiles) || !profiles.length || profiles.length > 24 ||
      profiles.some(p => p?.printer_settings_id !== X2D_PRINTER || p.print_settings_id !== X2D_PROCESS ||
        p.printer_variant !== "0.4" || Number(p.layer_height) !== 0.2 ||
        typeof p.version !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(p.version) ||
        !Array.isArray(p.filament_settings_id) || p.filament_settings_id.length !== 1 ||
        typeof p.filament_settings_id[0] !== "string" || !p.filament_settings_id[0] ||
        typeof p.curr_bed_type !== "string" ||
        !Array.isArray(p.extruder_nozzle_diameter) || p.extruder_nozzle_diameter.length !== 2 ||
        p.extruder_nozzle_diameter.some(diameter => Number(diameter) !== 0.4)) ||
      new Set(profiles.map(p => p.filament_settings_id[0])).size !== profiles.length) {
    throw new Error("Choose a JumpStart profile pack for X2D 0.4 and 0.20 mm Standard.");
  }
  return profiles;
}

export function x2dBuildTransform(min, max, height) {
  const size = max.map((value, axis) => value - min[axis]);
  if (size.some((value, axis) => !Number.isFinite(value) || value < 0 || value > (axis === 2 ? height : 256))) {
    throw new Error("The current layout is too large for the X2D plate. Select fewer bodies or move them closer.");
  }
  return `1 0 0 0 1 0 0 0 1 ${128 - (min[0] + max[0]) / 2} ${128 - (min[1] + max[1]) / 2} ${-min[2]}`;
}
