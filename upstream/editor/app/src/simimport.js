// 3D Print Sim: open STL and 3MF files straight into the sim (not into the design).
// 3MF files keep their objects, positions and colours: the filament colours and each part's
// filament from Bambu Studio / Orca Slicer / PrusaSlicer projects, their colour painting
// (paint_color / mmu_segmentation per triangle), and core 3MF material and colour groups.
import { readZip, isZip, stlPositions, repairMesh } from "./meshimport.js";

const DEFAULT_COLS = ["#d9dde3", "#e5484d", "#2f7de1", "#f5c518", "#2fbf71", "#1f2328", "#f08a24", "#8a5cf0"];
const ID12 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, meter: 1000, inch: 25.4, foot: 304.8 };

function attrs(s) {
  const o = {};
  const re = /([\w:]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) o[m[1]] = m[2];
  return o;
}
const parseT = (s) => { if (!s) return ID12; const v = s.trim().split(/\s+/).map(Number); return v.length === 12 && v.every(isFinite) ? v : ID12; };
function composeT(A, B) {
  const a = (r, c) => (c < 3 ? A[r * 3 + c] : r === 3 ? 1 : 0), b = (r, c) => (c < 3 ? B[r * 3 + c] : r === 3 ? 1 : 0), out = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) { let s = 0; for (let k = 0; k < 4; k++) s += a(r, k) * b(k, c); out.push(s); }
  return out;
}
const pathOf = (a) => a["p:path"] || Object.keys(a).filter((k) => /:path$/.test(k)).map((k) => a[k])[0];
const hex6 = (c) => { if (!c) return null; const m = /^#?([0-9a-f]{6})/i.exec(c.trim()); return m ? "#" + m[1].toLowerCase() : null; };

// PrusaSlicer / Bambu / Orca triangle painting: a hex string holding a little tree of how the
// triangle was split, with a filament number (state) on each leaf. Read from the end, one
// nibble at a time: the low 2 bits say how many sides were split (0 = a leaf), the high 2 bits
// the state (3 means "3 + the next nibble"). Returns the state covering most of the triangle.
export function paintState(str) {
  if (!str) return 0;
  let pos = str.length - 1;
  const next = () => (pos >= 0 ? parseInt(str[pos--], 16) || 0 : 0);
  const w = new Map();
  const walk = (weight, depth) => {
    if (depth > 24 || pos < -1) return;
    const code = next(), split = code & 3;
    if (!split) {
      let s = code >> 2;
      if (s === 3) s = next() + 3;
      w.set(s, (w.get(s) || 0) + weight);
      return;
    }
    const kids = split + 1;
    for (let i = 0; i < kids; i++) walk(weight / kids, depth + 1);
  };
  walk(1, 0);
  let best = 0, bw = -1;
  for (const [s, v] of w) if (v > bw) { bw = v; best = s; }
  return best;
}

// one model file: objects (mesh or components), colour resources, build items
function parseModel(text) {
  const unitM = text.match(/<(?:\w+:)?model\b[^>]*\bunit\s*=\s*"([^"]+)"/);
  const res = new Map(); // id -> [hex,...] (basematerials and colour groups)
  for (const m of text.matchAll(/<(?:\w+:)?(basematerials|colorgroup)\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?\1>/g)) {
    const id = attrs(m[2]).id, cols = [];
    for (const b of m[3].matchAll(/<(?:\w+:)?(?:base|color)\b([^>]*?)\/?>/g)) { const a = attrs(b[1]); cols.push(hex6(a.displaycolor || a.color) || null); }
    res.set(id, cols);
  }
  const objects = new Map();
  for (const m of text.matchAll(/<(?:\w+:)?object\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?object>/g)) {
    const at = attrs(m[1]), body = m[2];
    const ob = { id: at.id, name: at.name || "", type: at.type || "model", pid: at.pid, pindex: at.pindex, mesh: null, components: [] };
    const vs = body.indexOf("<vertices") >= 0 || /<\w+:vertices/.test(body);
    if (vs) {
      const V = [];
      for (const v of body.matchAll(/<(?:\w+:)?vertex\b([^>]*?)\/?>/g)) { const a = attrs(v[1]); V.push(+a.x, +a.y, +a.z); }
      const T = [], tcol = [], tpaint = [];
      let anyCol = false, anyPaint = false;
      for (const v of body.matchAll(/<(?:\w+:)?triangle\b([^>]*?)\/?>/g)) {
        const a = attrs(v[1]);
        T.push(a.v1 | 0, a.v2 | 0, a.v3 | 0);
        const pid = a.pid || ob.pid, pi = a.p1 != null ? a.p1 : ob.pindex;
        const col = pid != null && res.has(pid) ? res.get(pid)[pi | 0] || null : null;
        tcol.push(col); if (col) anyCol = true;
        const pc = a.paint_color || a["slic3rpe:mmu_segmentation"] || "";
        tpaint.push(pc); if (pc) anyPaint = true;
      }
      if (!anyCol && ob.pid != null && res.has(ob.pid)) { const c = res.get(ob.pid)[ob.pindex | 0]; if (c) { tcol.fill(c); anyCol = true; } }
      ob.mesh = { V, T, tcol: anyCol ? tcol : null, tpaint: anyPaint ? tpaint : null };
    }
    for (const c of body.matchAll(/<(?:\w+:)?component\b([^>]*?)\/?>/g)) { const a = attrs(c[1]); ob.components.push({ id: a.objectid, T: parseT(a.transform), path: pathOf(a) }); }
    objects.set(at.id, ob);
  }
  const items = [];
  const build = text.match(/<(?:\w+:)?build\b[^>]*>([\s\S]*?)<\/(?:\w+:)?build>/);
  if (build) for (const it of build[1].matchAll(/<(?:\w+:)?item\b([^>]*?)\/?>/g)) { const a = attrs(it[1]); items.push({ id: a.objectid, T: parseT(a.transform), path: pathOf(a) }); }
  return { unit: unitM ? unitM[1] : "millimeter", objects, items };
}

// Bambu Studio / Orca: Metadata/model_settings.config: each object's and part's filament
function parseModelSettings(text) {
  const out = new Map(); // object id -> { name, ext, parts: Map(part id -> ext), ranges: [[first, last, ext]] }
  for (const m of text.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const at = attrs(m[1]), body = m[2], o = { name: "", ext: 0, parts: new Map(), ranges: [] };
    const top = body.replace(/<(part|volume)\b[\s\S]*?<\/\1>/g, "");
    for (const md of top.matchAll(/<metadata\b([^>]*?)\/?>/g)) { const a = attrs(md[1]); if (a.key === "extruder") o.ext = +a.value || 0; if (a.key === "name") o.name = a.value; }
    for (const p of body.matchAll(/<part\b([^>]*)>([\s\S]*?)<\/part>/g)) {
      const pa = attrs(p[1]);
      if (pa.subtype && pa.subtype !== "normal_part") continue;
      for (const md of p[2].matchAll(/<metadata\b([^>]*?)\/?>/g)) { const a = attrs(md[1]); if (a.key === "extruder") o.parts.set(pa.id, +a.value || 0); }
    }
    // PrusaSlicer: volumes by triangle range
    for (const v of body.matchAll(/<volume\b([^>]*)>([\s\S]*?)<\/volume>/g)) {
      const va = attrs(v[1]);
      for (const md of v[2].matchAll(/<metadata\b([^>]*?)\/?>/g)) { const a = attrs(md[1]); if (a.key === "extruder") o.ranges.push([+va.firstid, +va.lastid, +a.value || 0]); }
    }
    out.set(at.id, o);
  }
  return out;
}
// filament colours: Bambu / Orca project_settings.config (JSON), PrusaSlicer Slic3r_PE.config
function parseFilamentColours(text) {
  try { const j = JSON.parse(text); const c = j.filament_colour || j.filament_color || j.extruder_colour; if (Array.isArray(c)) return c.map(hex6); } catch (e) { /* not JSON */ }
  const m = text.match(/;\s*(?:filament_colour|extruder_colour)\s*=\s*([^\n]*)/);
  if (m) return m[1].split(";").map(hex6);
  return [];
}

async function read3MF(bytes, fileName) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const z = readZip(buf), dec = new TextDecoder();
  const names = z.names(), has = (n) => names.some((x) => x.toLowerCase() === n.toLowerCase());
  const text = async (n) => dec.decode(await z.get(n));
  let root = "3D/3dmodel.model";
  try { const rels = await text("_rels/.rels"); const rel = [...rels.matchAll(/<Relationship\b([^>]*)>/g)].map((x) => attrs(x[1])).find((a) => /3dmodel$/i.test(a.Type || "")); if (rel && rel.Target) root = rel.Target.replace(/^\/+/, ""); } catch (e) { /* default */ }
  const cache = new Map();
  const model = async (path) => { const k = path.replace(/^\/+/, ""); if (!cache.has(k)) cache.set(k, parseModel(await text(k))); return cache.get(k); };
  const rootM = await model(root);
  const settings = has("Metadata/model_settings.config") ? parseModelSettings(await text("Metadata/model_settings.config")) : has("Metadata/Slic3r_PE_model.config") ? parseModelSettings(await text("Metadata/Slic3r_PE_model.config")) : new Map();
  // the slicer's settings (Orca / Bambu JSON) and, from a JumpStart 3MF, the sim's own state
  let orca = null, sim = null;
  if (has("Metadata/project_settings.config")) { try { orca = JSON.parse(await text("Metadata/project_settings.config")); } catch (e) { orca = null; } }
  if (has("Metadata/jumpstart_sim.json")) { try { sim = JSON.parse(await text("Metadata/jumpstart_sim.json")); } catch (e) { sim = null; } }
  let fcols = [];
  for (const n of ["Metadata/project_settings.config", "Metadata/Slic3r_PE.config"]) if (has(n)) { fcols = parseFilamentColours(await text(n)); if (fcols.length) break; }
  const k = UNIT_MM[rootM.unit] || 1;
  const parts = [];
  let usedExt = false;
  // each build item becomes one part on the plate, its components merged
  const itemList = rootM.items.length ? rootM.items : [...rootM.objects.keys()].map((id) => ({ id, T: ID12 }));
  for (const it of itemList) {
    const P = [], I = [], ext = [], col = [];
    const rootObj = (await model(it.path || root)).objects.get(it.id);
    const ms = settings.get(it.id);
    const emit = async (path, id, T, depth, e) => {
      if (depth > 32) return;
      const ob = (await model(path)).objects.get(id);
      if (!ob || ob.type === "support" || ob.type === "other") return;
      if (ob.mesh) {
        const { V, T: Tr, tcol, tpaint } = ob.mesh, nv = V.length / 3, base = P.length / 3;
        for (let i = 0; i < nv; i++) { const x = V[i * 3], y = V[i * 3 + 1], zz = V[i * 3 + 2]; P.push((x * T[0] + y * T[3] + zz * T[6] + T[9]) * k, (x * T[1] + y * T[4] + zz * T[7] + T[10]) * k, (x * T[2] + y * T[5] + zz * T[8] + T[11]) * k); }
        for (let t = 0, n = 0; t + 2 < Tr.length; t += 3, n++) {
          if (![Tr[t], Tr[t + 1], Tr[t + 2]].every((q) => q >= 0 && q < nv)) continue;
          I.push(base + Tr[t], base + Tr[t + 1], base + Tr[t + 2]);
          let te = e;
          if (ms && ms.ranges.length) { const g = ms.ranges.find((r) => n >= r[0] && n <= r[1]); if (g && g[2]) te = g[2]; }
          const ps = tpaint ? paintState(tpaint[n]) : 0;
          if (ps > 0) { te = ps; usedExt = true; }
          ext.push(te);
          col.push(tcol ? tcol[n] : null);
        }
      }
      for (const c of ob.components) {
        let ce = e;
        if (ms && ms.parts.has(c.id) && ms.parts.get(c.id)) { ce = ms.parts.get(c.id); usedExt = true; }
        await emit(c.path || path, c.id, composeT(c.T, T), depth + 1, ce);
      }
    };
    const e0 = ms && ms.ext ? ms.ext : 0;
    if (e0) usedExt = true;
    await emit(it.path || root, it.id, it.T, 0, e0);
    if (I.length) parts.push({ name: (ms && ms.name) || (rootObj && rootObj.name) || `${fileName} ${parts.length + 1}`, V: new Float32Array(P), I: new Uint32Array(I), ext, col });
  }
  if (!parts.length) throw new Error("This 3MF file has no triangles to slice.");
  // filaments: by extruder number when the file says, else by the colours in it
  const anyCol = parts.some((p) => p.col.some(Boolean));
  let slots = [];
  if (usedExt || (fcols.length && !anyCol)) {
    const maxE = Math.max(1, ...parts.flatMap((p) => p.ext));
    const n = Math.max(maxE, fcols.filter(Boolean).length ? 1 : 0);
    for (let i = 0; i < n; i++) slots.push(fcols[i] || DEFAULT_COLS[i % DEFAULT_COLS.length]);
    for (const p of parts) p.tri = Int16Array.from(p.ext, (e) => Math.max(0, (e || 1) - 1));
  } else if (anyCol) {
    const idx = new Map();
    for (const p of parts) p.tri = Int16Array.from(p.col, (c) => { const h = c || "#d9dde3"; if (!idx.has(h)) { idx.set(h, slots.length); slots.push(h); } return idx.get(h); });
  } else {
    slots = [DEFAULT_COLS[0]];
    for (const p of parts) p.tri = new Int16Array(p.I.length / 3);
  }
  return { parts, slots, format: "3MF", orca, sim };
}

function readSTL(bytes, fileName) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { mesh } = repairMesh(stlPositions(buf));
  if (!mesh.I.length) throw new Error(fileName + " has no triangles to slice.");
  return { parts: [{ name: fileName.replace(/\.stl$/i, ""), V: mesh.V, I: Uint32Array.from(mesh.I), tri: null }], slots: [DEFAULT_COLS[0]], format: "STL" };
}

// files -> { parts: [{ name, V, I, slot, paint: Map(slot -> [triangle,...]) }], slots: [{ color }], name, notes }
export async function readSimFiles(files) {
  const all = [], slots = [];
  const notes = [];
  let orca = null, sim = null;
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const name = f.name || "model";
    const r = isZip(bytes) ? await read3MF(bytes, name.replace(/\.3mf$/i, "")) : readSTL(bytes, name);
    // this file's filaments: reuse a slot with the same colour, else add one
    const map = r.slots.map((c) => { const h = hex6(c) || DEFAULT_COLS[0]; let i = slots.indexOf(h); if (i < 0 || r.format === "3MF") { slots.push(h); i = slots.length - 1; } return i; });
    for (const p of r.parts) {
      const tri = p.tri ? Int16Array.from(p.tri, (s) => map[s] ?? map[0]) : null;
      // the part's own filament: the one most of it uses; the rest becomes paint
      let slot = map[0];
      const paint = new Map();
      if (tri) {
        const cnt = new Map();
        for (const s of tri) cnt.set(s, (cnt.get(s) || 0) + 1);
        slot = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
        tri.forEach((s, t) => { if (s !== slot) { if (!paint.has(s)) paint.set(s, []); paint.get(s).push(t); } });
      }
      all.push({ name: p.name, V: p.V, I: p.I, slot, paint, color: slots[slot] });
    }
    if (r.orca && !orca) orca = r.orca;
    if (r.sim && files.length === 1) sim = r.sim;
    notes.push(`${name}: ${r.parts.length} part${r.parts.length > 1 ? "s" : ""}${r.format === "3MF" && r.slots.length > 1 ? `, ${r.slots.length} filaments` : ""}`);
  }
  // one filament list for everything, without exact repeats from several STL files
  return { parts: all, slots: slots.map((c) => ({ color: c })), notes, orca, sim };
}
