const API = "https://api.openfilamentdatabase.org/api/v1/brands";
const MAX_RESPONSE_BYTES = 1024 * 1024;
export const FILAMENT_NAME_PATTERN = "^[A-Za-z0-9][A-Za-z0-9 _+.-]{0,79}$";
const SAFE_SLUG = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const matchKey = value => String(value ?? "").trim().toLowerCase().replace(/[ _-]+/g, "_");
const shortString = value => typeof value === "string" && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value);

const NUMERIC_FIELDS = [
  "min_print_temperature", "max_print_temperature", "min_bed_temperature", "max_bed_temperature",
  "min_fan_speed", "max_fan_speed", "dry_temperature", "dry_time", "max_volumetric_speed", "density",
];

export async function getFilamentReference({ brand, material, filament }, fetcher = fetch) {
  const brandSlug = brand.toLowerCase().replace(/ +/g, "_");
  if (!SAFE_SLUG.test(brandSlug)) throw new Error("Use the exact Open Filament Database brand slug.");
  // One deadline covers all reads. Only construct requests to the fixed public API.
  const signal = AbortSignal.timeout(8000);
  async function read(url) {
    try {
      const response = await fetcher(url, { signal, redirect: "error", headers: { Accept: "application/json" } });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        if (response.status === 404) return null;
        throw new Error("Request failed");
      }
      const reader = response.body.getReader();
      const parts = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) throw new Error("Response too large");
          parts.push(value);
        }
      } finally { await reader.cancel(); }
      return JSON.parse(Buffer.concat(parts).toString("utf8"));
    } catch {
      throw new Error("Open Filament Database is unavailable or returned invalid data. Try again or use the manufacturer's datasheet.");
    }
  }

  const brandUrl = `${API}/${brandSlug}`;
  const brandRecord = await read(`${brandUrl}/index.json`);
  if (!brandRecord) return { status: "not_found", missing: "brand", query: { brand, material, filament } };
  const materials = Array.isArray(brandRecord.materials) ? brandRecord.materials : [];
  const materialMatch = materials.find(item => [item?.slug, item?.material].some(name => matchKey(name) === matchKey(material)));
  if (!materialMatch || !SAFE_SLUG.test(materialMatch.slug ?? "")) return { status: "not_found", missing: "material", query: { brand, material, filament } };
  const materialUrl = `${brandUrl}/materials/${materialMatch.slug}`;
  const materialRecord = await read(`${materialUrl}/index.json`);
  const filaments = Array.isArray(materialRecord?.filaments) ? materialRecord.filaments : [];
  const filamentMatch = filaments.find(item => [item?.slug, item?.name].some(name => matchKey(name) === matchKey(filament)));
  if (!filamentMatch || !SAFE_SLUG.test(filamentMatch.slug ?? "")) return { status: "not_found", missing: "filament", query: { brand, material, filament } };
  const url = `${materialUrl}/filaments/${filamentMatch.slug}/index.json`;
  const record = await read(url);
  if (!record || record.slug !== filamentMatch.slug) throw new Error("Open Filament Database returned an inconsistent product record.");
  const published = Object.fromEntries(NUMERIC_FIELDS
    .filter(key => Number.isFinite(record[key]))
    .map(key => [key, record[key]]));
  const slicers = Object.fromEntries(["bambustudio", "orcaslicer"].flatMap(slicer => {
    const preset = record.slicer_settings?.[slicer];
    if (!preset) return [];
    return [[slicer, Object.fromEntries(["id", "generic_id", "profile_name"].filter(key => shortString(preset[key])).map(key => [key, preset[key]]))]];
  }));
  return {
    status: "found", source: url,
    brand: shortString(brandRecord.name) ? brandRecord.name : brandSlug,
    material: materialMatch.slug, filament: shortString(record.name) ? record.name : filamentMatch.slug,
    published, slicers,
    ...(shortString(record.data_sheet_url) && /^https:\/\//i.test(record.data_sheet_url) ? { datasheet: record.data_sheet_url } : {}),
    scope: "Public filament reference data. Temperatures are °C, fan is %, drying time is hours, maximum volumetric speed is mm³/s, and density is g/cm³. These are not measured settings for a specific printer or spool.",
  };
}
