// 3D Print Sim: save the plate as a 3MF project (objects, filaments, colour painting and all the
// slicer settings) or as an STL, like Orca Slicer's File > Save project / Export plate as STL.
//
// The 3MF has:
//  - 3D/3dmodel.model: one object per part, placed on the plate by its build item; every
//    triangle carries its filament as `paint_color` (the PrusaSlicer / Bambu / Orca colour
//    painting code, split into finer pieces where a brush stroke crosses it) and as a core 3MF
//    material (pid / p1), so plain 3MF viewers see the colours too
//  - Metadata/model_settings.config: each object's name and filament (Bambu / Orca layout)
//  - Metadata/project_settings.config: the settings under their Orca Slicer names (JSON)
//  - Metadata/jumpstart_sim.json: everything the sim needs to open it again exactly as it was
import { makeZip } from "./util.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (v) => (Math.abs(v) < 1e-9 ? "0" : String(+v.toFixed(5)));

// a triangle's colour painting tree as the hex string the slicers read (see paintState in
// simimport.js): bits are written LSB first, packed four to a hex digit, and the string reversed
export function encodePaint(tree) {
  const bits = [];
  const put = (v, n) => { for (let i = 0; i < n; i++) bits.push((v >> i) & 1); };
  const walk = (nd) => {
    if (!nd.kids) { put(0, 2); if (nd.s <= 2) put(nd.s, 2); else { put(3, 2); put(nd.s - 3, 4); } return; }
    put(3, 2); put(0, 2); // all three sides split, special side 0
    for (let i = 3; i >= 0; i--) walk(nd.kids[i]); // children are stored last to first
  };
  walk(tree);
  let s = "";
  for (let o = 0; o < bits.length; o += 4) { let c = 0; for (let i = o + 3; i >= o; i--) c = (c << 1) | (bits[i] || 0); s += c.toString(16).toUpperCase(); }
  return s.split("").reverse().join("");
}

// parts: [{ name, V: Float32Array (plate mm), I, paint: [string per triangle] | null, state: [per triangle 0..] | null, ext }]
// filaments: [{ color, type }]; settings: { orca key: value }; sim: anything JSON; bed: { w, d }
export function make3MF({ parts, filaments, settings, sim, bed, title }) {
  const enc = new TextEncoder();
  const xml = [];
  xml.push('<?xml version="1.0" encoding="UTF-8"?>');
  xml.push('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">');
  xml.push(`<metadata name="Title">${esc(title || "Plate")}</metadata>`);
  xml.push('<metadata name="Application">JumpStart 3D (3D Print Sim)</metadata>');
  xml.push("<resources>");
  xml.push('<basematerials id="1">' + filaments.map((f, i) => `<base name="F${i + 1} ${esc(f.type || "PLA")}" displaycolor="${esc((f.color || "#cccccc").toUpperCase())}FF"/>`).join("") + "</basematerials>");
  const items = [];
  parts.forEach((p, n) => {
    const id = n + 2;
    // the object in its own coordinates, centred; the build item puts it back on the plate
    let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity;
    for (let i = 0; i < p.V.length; i += 3) { lx = Math.min(lx, p.V[i]); hx = Math.max(hx, p.V[i]); ly = Math.min(ly, p.V[i + 1]); hy = Math.max(hy, p.V[i + 1]); lz = Math.min(lz, p.V[i + 2]); }
    const cx = (lx + hx) / 2, cy = (ly + hy) / 2;
    const vs = [], ts = [];
    for (let i = 0; i < p.V.length; i += 3) vs.push(`<vertex x="${num(p.V[i] - cx)}" y="${num(p.V[i + 1] - cy)}" z="${num(p.V[i + 2] - lz)}"/>`);
    for (let t = 0; t < p.I.length / 3; t++) {
      const st = p.state ? p.state[t] : 0, ext = st > 0 ? st : p.ext;
      ts.push(`<triangle v1="${p.I[t * 3]}" v2="${p.I[t * 3 + 1]}" v3="${p.I[t * 3 + 2]}" pid="1" p1="${Math.max(0, ext - 1)}"${p.paint && p.paint[t] ? ` paint_color="${p.paint[t]}"` : ""}/>`);
    }
    xml.push(`<object id="${id}" name="${esc(p.name)}" type="model" pid="1" pindex="${Math.max(0, p.ext - 1)}"><mesh><vertices>${vs.join("")}</vertices><triangles>${ts.join("")}</triangles></mesh></object>`);
    items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(cx + bed.w / 2)} ${num(cy + bed.d / 2)} ${num(lz)}" printable="1"/>`);
  });
  xml.push("</resources>");
  xml.push("<build>" + items.join("") + "</build>");
  xml.push("</model>");
  const ms = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>"];
  parts.forEach((p, n) => {
    ms.push(`  <object id="${n + 2}">`, `    <metadata key="name" value="${esc(p.name)}"/>`, `    <metadata key="extruder" value="${p.ext}"/>`,
      `    <part id="${n + 2}" subtype="normal_part">`, `      <metadata key="name" value="${esc(p.name)}"/>`, `      <metadata key="extruder" value="${p.ext}"/>`, "    </part>", "  </object>");
  });
  ms.push("</config>");
  const files = [
    { name: "[Content_Types].xml", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/><Default Extension="json" ContentType="application/json"/></Types>') },
    { name: "_rels/.rels", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    { name: "3D/3dmodel.model", data: enc.encode(xml.join("\n")) },
    { name: "Metadata/model_settings.config", data: enc.encode(ms.join("\n")) },
    { name: "Metadata/project_settings.config", data: enc.encode(JSON.stringify(settings, null, 4)) },
    { name: "Metadata/jumpstart_sim.json", data: enc.encode(JSON.stringify(sim)) },
  ];
  return makeZip(files);
}

// one binary STL of everything on the plate (in plate millimetres, bed corner at 0, 0)
export function makeSTL(parts, bed) {
  const nT = parts.reduce((a, p) => a + p.I.length / 3, 0);
  const buf = new ArrayBuffer(84 + nT * 50), dv = new DataView(buf);
  const head = new TextEncoder().encode("JumpStart 3D plate");
  new Uint8Array(buf, 0, 80).set(head.subarray(0, 80));
  dv.setUint32(80, nT, true);
  let o = 84;
  for (const p of parts) {
    const V = p.V, I = p.I;
    for (let t = 0; t < I.length / 3; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
      let q = o + 12;
      for (const v of [a, b, c]) { dv.setFloat32(q, V[v] + bed.w / 2, true); dv.setFloat32(q + 4, V[v + 1] + bed.d / 2, true); dv.setFloat32(q + 8, V[v + 2], true); q += 12; }
      o += 50;
    }
  }
  return new Uint8Array(buf);
}

// ---- the sim's settings under Orca Slicer's names (project_settings.config), and back
const pct = (v) => `${Math.round(+v)}%`, unpct = (s) => parseFloat(String(s)) || 0;
const b01 = (v) => (v ? "1" : "0"), unb = (s) => s === true || s === "1" || s === "true";
const str = (v) => String(v), numb = (s) => +s;
const PAT = { rectilinear: "zig-zag", alignedrectilinear: "alignedrectilinear", grid: "grid", triangles: "triangles", crosshatch: "crosshatch" };
const PAT_BACK = Object.fromEntries(Object.entries(PAT).map(([a, b]) => [b, a]));
const FLAVOR = { marlin: "marlin", klipper: "klipper", prusa: "marlin2", bambu: "marlin" };
// [sim key, Orca key, to Orca, from Orca] for single values
export const ORCA_KEYS = [
  ["layer", "layer_height", str, numb], ["firstLayer", "initial_layer_print_height", str, numb],
  ["walls", "wall_loops", str, numb], ["topN", "top_shell_layers", str, numb], ["botN", "bottom_shell_layers", str, numb],
  ["infill", "sparse_infill_density", pct, unpct], ["pattern", "sparse_infill_pattern", (v) => PAT[v] || v, (s) => PAT_BACK[s]],
  ["seam", "seam_position", str, (s) => (["aligned", "nearest", "back", "random"].includes(s) ? s : undefined)],
  ["ironing", "ironing_type", str, (s) => (["no ironing", "top", "topmost", "solid"].includes(s) ? s : undefined)],
  ["ironFlow", "ironing_flow", pct, unpct], ["ironSpacing", "ironing_spacing", str, numb], ["ironSpeed", "ironing_speed", str, numb],
  ["wallGen", "wall_generator", str, str], ["topPat", "top_surface_pattern", str, str], ["botPat", "bottom_surface_pattern", str, str],
  ["thinWalls", "detect_thin_wall", b01, unb], ["oneWallTop", "only_one_wall_top", b01, unb],
  ["supports", "enable_support", (v) => b01(v !== "none"), (s) => (unb(s) ? undefined : "none")],
  ["threshold", "support_threshold_angle", (v) => str(90 - v), (s) => 90 - +s], ["plateOnly", "support_on_build_plate_only", b01, unb],
  ["supZ", "support_top_z_distance", str, numb], ["raft", "raft_layers", str, numb],
  ["skirt", "skirt_loops", str, numb], ["skirtDist", "skirt_distance", str, numb], ["skirtH", "skirt_height", str, numb],
  ["brimType", "brim_type", str, (s) => (["no_brim", "outer_only", "auto_brim", "brim_ears", "outer_and_inner", "inner_only"].includes(s) ? (s === "outer_and_inner" || s === "inner_only" ? "outer_only" : s) : undefined)],
  ["brim", "brim_width", str, numb], ["brimGap", "brim_object_gap", str, numb],
  ["spiral", "spiral_mode", b01, unb], ["seq", "print_sequence", str, (s) => (s === "by object" ? s : "by layer")], ["fuzzy", "fuzzy_skin", str, str],
  ["tower", "enable_prime_tower", b01, unb], ["towerW", "prime_tower_width", (v) => str(v || 35), numb], ["flushMul", "flush_multiplier", str, numb],
  ["plate", "curr_bed_type", str, str], ["flavor", "gcode_flavor", (v) => FLAVOR[v] || "marlin", () => undefined],
];

// st: the sim's settings; o: { printer: {name, w, d, h}, filaments: [{color, type, temp:[nozzle, bed, fan]}], flavor, supportsType }
export function orcaSettings(st, o) {
  const j = { from: "project", name: "project_settings", print_settings_id: `${st.layer.toFixed(2)}mm Standard @JumpStart`, printer_settings_id: (o.model || o.printer.name) + " 0.4 nozzle", printer_model: o.model || o.printer.name };
  for (const [k, ok, to] of ORCA_KEYS) { const v = k === "flavor" ? o.flavor : st[k]; if (v != null) j[ok] = to(v); }
  if (st.supports !== "none") j.support_type = st.supports === "tree" ? "tree(auto)" : "normal(auto)";
  const F = o.filaments, n = Math.max(1, F.length), arr = (f) => F.map(f);
  j.filament_colour = arr((f) => (f.color || "#cccccc").toUpperCase());
  j.filament_type = arr((f) => f.type || "PLA");
  j.filament_settings_id = arr((f) => `${f.name || f.type || "PLA"} @JumpStart`);
  j.nozzle_temperature = arr((f) => str(f.temp[0])); j.nozzle_temperature_initial_layer = arr((f) => str(f.temp[0] + 5));
  j.hot_plate_temp = arr((f) => str(f.temp[1])); j.hot_plate_temp_initial_layer = arr((f) => str(f.temp[1]));
  j.textured_plate_temp = j.hot_plate_temp; j.textured_plate_temp_initial_layer = j.hot_plate_temp;
  j.fan_max_speed = arr((f) => str(f.temp[2])); j.fan_min_speed = arr((f) => str(Math.round(f.temp[2] * 0.6)));
  j.filament_diameter = arr(() => "1.75");
  j.nozzle_diameter = Array.from({ length: o.heads || 1 }, () => "0.4");
  j.retraction_length = Array.from({ length: o.heads || 1 }, () => str(st.retract));
  j.z_hop = Array.from({ length: o.heads || 1 }, () => (st.zhop ? "0.4" : "0"));
  j.line_width = "0.42"; j.outer_wall_line_width = "0.42"; j.inner_wall_line_width = "0.45"; j.sparse_infill_line_width = "0.45";
  const W = o.printer.w, D = o.printer.d;
  j.printable_area = o.printer.round ? [`${-W / 2}x${-W / 2}`, `${W / 2}x${-W / 2}`, `${W / 2}x${W / 2}`, `${-W / 2}x${W / 2}`] : ["0x0", `${W}x0`, `${W}x${D}`, `0x${D}`];
  j.printable_height = str(o.printer.h || 250);
  j.flush_volumes_matrix = o.flush || [];
  if (n > 1) j.wipe_tower_x = [str(Math.round(W * 0.7))], j.wipe_tower_y = [str(Math.round(D * 0.7))];
  return j;
}
// an Orca / Bambu project_settings.config -> the sim's settings it has (only what's there)
export function fromOrca(j) {
  const out = {};
  if (!j || typeof j !== "object") return out;
  for (const [k, ok, , from] of ORCA_KEYS) {
    if (!(ok in j)) continue;
    let v = j[ok]; if (Array.isArray(v)) v = v[0];
    const r = from(v);
    if (r !== undefined && !(typeof r === "number" && !isFinite(r))) out[k] = r;
  }
  if (unb(Array.isArray(j.enable_support) ? j.enable_support[0] : j.enable_support)) out.supports = /tree/.test(String(j.support_type || "")) ? "tree" : "normal";
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  if (j.retraction_length != null) out.retract = +first(j.retraction_length) || 0;
  if (j.z_hop != null) out.zhop = +first(j.z_hop) > 0;
  if (j.nozzle_temperature != null) out.nozzleT = +first(j.nozzle_temperature) || null;
  const bt = j.hot_plate_temp ?? j.textured_plate_temp; if (bt != null) out.bedT = +first(bt) || null;
  return out;
}
