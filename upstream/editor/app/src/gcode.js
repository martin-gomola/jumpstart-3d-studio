// G-code for the 3D Print Sim: turns the sliced toolpaths (walls, infill, skins) and support
// columns into a G-code file a printer can run, the way a slicer like Orca Slicer writes it:
// a start block for the printer's firmware (Marlin, Klipper, Prusa or Bambu style), relative
// extrusion, a skirt or brim on the first layer, retraction and Z hop on travel moves, cooling,
// feature comments (;TYPE:Outer wall …) and layer comments so slicer previews show the lines,
// progress (M73) and tool changes (T0, T1 …) for multi-filament prints.

import { Moves, timeMoves, featureMotion, motionFor, MOTION, COOLING, SPEED_PRESETS } from "./motion.js";
import { machineFor } from "./machines.js";
import { VERSION } from "./version.js";
export { SPEED_PRESETS, motionFor, MOTION, COOLING };
export const KINDS = ["outer", "inner", "sparse", "solid", "top", "bottom", "bridge"];
const TYPE_NAME = { ironing: "Ironing", outer: "Outer wall", inner: "Inner wall", sparse: "Sparse infill", solid: "Internal solid infill", top: "Top surface", bottom: "Bottom surface", bridge: "Bridge", support: "Support", skirt: "Skirt", brim: "Brim" };
// nozzle / bed temperatures (°C), fan (%), for each filament
export const FIL_TEMPS = {
  pla: [210, 60, 100], plaplus: [215, 60, 100], petg: [240, 80, 40], abs: [250, 100, 15], asa: [255, 100, 20], nylon: [260, 80, 20],
  pc: [270, 110, 10], cfpla: [220, 60, 100], cfnylon: [275, 80, 20], peek: [400, 130, 0], tpu: [225, 45, 60],
};
export const FLAVORS = [["marlin", "Marlin"], ["klipper", "Klipper"], ["prusa", "Prusa"], ["bambu", "Bambu Lab"]];
export function flavorFor(printer) {
  const b = (printer && printer.brand) || "";
  if (b === "Bambu Lab") return "bambu";
  if (b === "Prusa") return "prusa";
  if (b === "Voron" || b === "Snapmaker" || b === "Elegoo" || /K1|K2|Adventurer|AD5X|Creator/.test(printer.name || "")) return "klipper";
  return "marlin";
}

const f3 = (x) => (Math.round(x * 1000) / 1000).toString();
const f5 = (x) => (Math.round(x * 100000) / 100000).toString();
const INFILL = new Set(["sparse", "solid", "top", "bottom", "bridge", "ironing"]);

// S: the slice (lines in order, layerEnd, lkind, lslot, nL, lh), sup: support columns
// [{x, y, z0, z1}] with spacing sp, o: settings (o.motion: a profile from motion.js),
// opt.estimate: work out the times only (no text)
export function makeGcode(S, sup, o, opt = {}) {
  const est = !!opt.estimate;
  const out = [];
  const W = est ? () => {} : (s) => out.push(s);
  const lh = S.lh, LW = o.lineWidth || 0.42, fil = o.filamentDia || 1.75;
  const eArea = Math.PI * (fil / 2) ** 2;
  const ePerMM = (LW * lh) / eArea;
  // Orca's "First layer height": the first layer is printed at its own thickness (more squish,
  // better grip); every layer after it is the normal height
  const flh = o.firstLayer > 0 ? Math.min(LW * 0.9, Math.max(0.05, +o.firstLayer)) : lh;
  // spiral vase: after the bottom layers, one outer wall that climbs steadily (no layer seams)
  const spiralK = (k) => !!o.spiral && k >= Math.max(1, o.botN || 0);
  let spiral = null;
  // seam: where each closed wall loop starts (Orca's Seam position)
  const seamMode = o.seam || "aligned";
  let seamPrev = [], seamNow = [];
  let rnd = 12345;
  const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  // the sim's plate is centred on 0, 0; most printers put 0, 0 at a corner, a delta at the middle
  // v2.9.9.9.12: each printer's own start, end and tool changes (machines.js); some put 0, 0 in the
  // middle of the bed (deltas, the Flashforge Adventurer 5M)
  const mach = o.machine || machineFor(o.printerKey);
  const centred = !!o.bed.round || mach.origin === "center";
  const ox = centred ? 0 : o.bed.w / 2, oy = centred ? 0 : o.bed.d / 2;
  const mult = (SPEED_PRESETS.find((p) => p[0] === o.speed) || SPEED_PRESETS[1])[2];
  const prof = o.motion || motionFor(o.printerKey, null);
  const maxV = (o.maxFlow || 18) / (LW * lh); // mm/s the hot end can melt
  const [coolT, coolMin] = o.cooling || COOLING[o.filamentKey] || [4, 20];
  const motion = (kind, k) => { const [v, a] = featureMotion(prof, kind, k, mult); return [Math.max(5, Math.min(v, maxV)), a]; };
  const travelV = Math.min(prof.mach.v, prof.travel * Math.min(1.4, mult)), travelA = Math.min(prof.mach.travel, (prof.acc.travel || prof.acc.def) * Math.min(1, mult));
  const retract = o.retract ?? 0.8, hop = o.zhop ? 0.4 : 0, retractV = 40;
  const [tn, tb, fan] = [o.nozzleTemp, o.bedTemp, o.fan];
  // per layer: the moves, then their times, then the text
  const M = new Moves(1 << 15);
  const ops = []; // per layer: numbers are moves (index into M), strings are other G-code lines
  let x = 0, y = 0, z = 0, e = 0, retracted = false, curType = "", tool = -1, lastKind = "";
  let filUsed = 0;
  const filBy = [];
  const mv = (nx, ny, nz, de, f, a, trav) => { e += de; ops.push(M.push(nx, ny, nz, e, f, a, trav)); x = nx; y = ny; z = nz; if (de > 0) { filUsed += de; const tt = Math.max(0, tool); filBy[tt] = (filBy[tt] || 0) + de; } };
  const doRetract = () => { if (retract > 0 && !retracted) { mv(x, y, z, -retract, retractV, 0, true); retracted = true; if (hop) mv(x, y, z + hop, 0, prof.mach.z, 500, true); } };
  const unRetract = () => { if (retracted) { if (hop) mv(x, y, z - hop, 0, prof.mach.z, 500, true); mv(x, y, z, retract, retractV, 0, true); retracted = false; } };
  const travel = (nx, ny, nextKind) => {
    const d = Math.hypot(nx - x, ny - y);
    if (d < 0.01) return;
    // like Orca's "reduce infill retraction": moving from infill to infill inside the part
    // doesn't need a retraction
    const inInfill = INFILL.has(lastKind) && INFILL.has(nextKind) && d < 15;
    if (d > 1 && !inInfill) doRetract();
    mv(nx, ny, z, 0, travelV, travelA, true);
    unRetract();
  };
  const type = (k) => { if (k !== curType) { ops.push(";TYPE:" + TYPE_NAME[k]); curType = k; } };
  // Orca Slicer 2.5's "Sparse infill smooth factor": the turn from one sparse infill line to the
  // next is a curve instead of a stop-and-go corner (0 % leaves the path as it was)
  const smooth = Math.max(0, Math.min(100, +o.smooth || 0)) / 100;
  let pdx = 0, pdy = 0;
  const extrude = (x0, y0, x1, y1, kind, k, flow = 1) => {
    const gap = Math.hypot(x0 - x, y0 - y);
    if (smooth > 0 && kind === "sparse" && lastKind === "sparse" && gap > 0.02 && gap < 12 && !retracted) {
      // a cubic curve leaving along the last line and arriving along the new one
      let ndx = x1 - x0, ndy = y1 - y0; const nl = Math.hypot(ndx, ndy) || 1; ndx /= nl; ndy /= nl;
      const kk = gap * (0.25 + 0.55 * smooth);
      const ax = x + pdx * kk, ay = y + pdy * kk, bx = x0 - ndx * kk, by = y0 - ndy * kk, sx = x, sy = y;
      const [v, a] = motion(kind, k), steps = 3 + Math.round(5 * smooth);
      type(kind);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        const qx = u * u * u * sx + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * x0, qy = u * u * u * sy + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * y0;
        const dd = Math.hypot(qx - x, qy - y);
        if (dd > 0.005) mv(qx, qy, z, dd * ePerMM * flow * 0.6, v, a, false);
      }
    }
    if (Math.hypot(x0 - x, y0 - y) > 0.02) travel(x0, y0, kind);
    { const dl = Math.hypot(x1 - x0, y1 - y0) || 1; pdx = (x1 - x0) / dl; pdy = (y1 - y0) / dl; }
    type(kind);
    const d = Math.hypot(x1 - x0, y1 - y0); if (d < 0.005) return;
    const [v, a] = motion(kind, k);
    if (spiral) { spiral.acc += d; z = spiral.z0 + spiral.h * Math.min(1, spiral.acc / spiral.len); }
    mv(x1, y1, z, d * ePerMM * flow * (k === 0 ? 1.05 * (flh / lh) : 1), v, a, false);
    lastKind = kind;
  };
  // text for a move: only what changed, with the speed (F, mm/min) and acceleration (M204)
  let tx = 0, ty = 0, tz = 0, tF = 0, tA = 0, force = false;
  const writeOps = () => {
    const d = M.d;
    for (const op of ops) {
      // after a tool change the head is somewhere else: the next move says X, Y and Z in full
      if (op === "@@RESET@@") { force = true; tF = 0; tA = 0; continue; }
      if (typeof op === "string") { W(op); continue; }
      const q = op * 7, dx = d[q] - tx, dy = d[q + 1] - ty, dz = d[q + 2] - tz, de = d[q + 3] - (q >= 7 ? d[q - 4] : d[q + 3]);
      const f = Math.round(d[q + 4] * 60), a = Math.round(d[q + 5]), trav = d[q + 6] > 0;
      const xy = force || Math.abs(dx) > 5e-4 || Math.abs(dy) > 5e-4;
      if (xy && a && a !== tA) { W(`M204 S${a}`); tA = a; }
      let s = trav && xy && !Math.abs(dz) ? "G0" : "G1";
      if (xy) s += ` X${f3(d[q] + ox)} Y${f3(d[q + 1] + oy)}`;
      if (force || Math.abs(dz) > 5e-5) s += ` Z${f3(d[q + 2])}`;
      force = false;
      if (Math.abs(de) > 1e-6) s += ` E${f5(de)}`;
      if (f !== tF) { s += ` F${f}`; tF = f; }
      W(s);
      tx = d[q]; ty = d[q + 1]; tz = d[q + 2];
    }
  };
  // closed wall loops start at the seam: back (furthest from the front), aligned (lined up with
  // the layer below, so the seam is one neat line), nearest (closest to the nozzle) or random
  const seamOrder = (idx) => {
    if (idx.length < 3) return idx;
    const out2 = [], close = (a, b) => Math.abs(a - b) < 0.02;
    let s0 = 0;
    for (let i = 0; i < idx.length; i++) {
      const m = idx[i] * 6, last = i === idx.length - 1 || !(close(L[m + 3], L[idx[i + 1] * 6]) && close(L[m + 4], L[idx[i + 1] * 6 + 1]));
      const m0 = idx[s0] * 6, shut = close(L[m + 3], L[m0]) && close(L[m + 4], L[m0 + 1]);
      if (!(last || shut)) continue;
      const lp = idx.slice(s0, i + 1);
      if (shut && lp.length > 2) {
        let best = 0, bv = Infinity;
        const n = seamNow.length, ref = seamPrev[n];
        if (seamMode === "random") best = Math.floor(rand() * lp.length);
        else for (let j = 0; j < lp.length; j++) {
          const px = L[lp[j] * 6], py = L[lp[j] * 6 + 1];
          const v = seamMode === "nearest" ? Math.hypot(px - x, py - y) : seamMode === "aligned" && ref ? Math.hypot(px - ref[0], py - ref[1]) : -py + Math.abs(px) * 1e-3;
          if (v < bv) { bv = v; best = j; }
        }
        seamNow.push([L[lp[best] * 6], L[lp[best] * 6 + 1]]);
        out2.push(...lp.slice(best), ...lp.slice(0, best));
      } else out2.push(...lp);
      s0 = i + 1;
    }
    return out2;
  };
  // ironing: a second, nearly dry pass over top surfaces with the hot nozzle to flatten them
  const iron = (k, from, to, zz) => {
    const tops = [];
    for (let q = from; q < to; q++) if (KINDS[K[q]] === "top") tops.push(q);
    if (!tops.length) return;
    const nextFrom = to, nextTo = (ends[k + 1] || 0) / 2;
    if (o.ironing === "topmost" && nextTo > nextFrom) { for (let q = nextFrom; q < nextTo; q++) if (KINDS[K[q]] === "top") return; }
    let use = tops;
    if (o.ironing !== "solid" && nextTo > nextFrom) {
      // only where nothing is printed on top (the surface you see)
      const G = new Set(), gs = 1;
      for (let q = nextFrom; q < nextTo; q++) { const m = q * 6, n = Math.max(1, Math.ceil(Math.hypot(L[m + 3] - L[m], L[m + 4] - L[m + 1]) / gs)); for (let i = 0; i <= n; i++) G.add(Math.floor((L[m] + ((L[m + 3] - L[m]) * i) / n) / gs) + "," + Math.floor((L[m + 1] + ((L[m + 4] - L[m + 1]) * i) / n) / gs)); }
      use = tops.filter((q) => { const m = q * 6; return !G.has(Math.floor((L[m] + L[m + 3]) / 2 / gs) + "," + Math.floor((L[m + 1] + L[m + 4]) / 2 / gs)); });
    }
    if (!use.length) return;
    const spc = Math.max(0.05, Math.min(LW, o.ironSpacing || 0.1)), passes = Math.max(1, Math.round(LW / spc));
    const v = Math.max(5, o.ironSpeed || 30), a = prof.acc.def, flow = Math.max(0, Math.min(100, o.ironFlow ?? 10)) / 100 / passes;
    let flip = false;
    for (const q of use) {
      const m = q * 6; let x0 = L[m], y0 = L[m + 1], x1 = L[m + 3], y1 = L[m + 4];
      const dl = Math.hypot(x1 - x0, y1 - y0); if (dl < 0.05) continue;
      const nx = -(y1 - y0) / dl, ny = (x1 - x0) / dl;
      for (let p2 = 0; p2 < passes; p2++) {
        const off = ((p2 + 0.5) / passes - 0.5) * LW;
        let ax = x0 + nx * off, ay = y0 + ny * off, bx = x1 + nx * off, by = y1 + ny * off;
        if (flip) { [ax, ay, bx, by] = [bx, by, ax, ay]; }
        flip = !flip;
        if (Math.hypot(ax - x, ay - y) > 0.02) travel(ax, ay, "ironing");
        type("ironing");
        mv(bx, by, zz, Math.hypot(bx - ax, by - ay) * ePerMM * flow, v, a, false);
        lastKind = "ironing";
      }
    }
  };
  // ---- what the printer's start, end and tool changes need to know
  const used = [];
  if (S.lslot) { const n0 = S.lines.length / 6; for (let q = 0; q < n0; q++) { const t0 = S.lslot[q]; if (!used.includes(t0)) used.push(t0); if (used.length >= 32) break; } }
  if (!used.length) used.push(0);
  const nCol = Math.max(used.reduce((a, b) => Math.max(a, b), 0) + 1, (o.colors || []).length, 1);
  const C = {
    tn, tb, fan, nozzle: o.nozzle || 0.4, tools: used, initial: used[0], layers: S.nL, height: +(flh + Math.max(0, S.nL - 1) * lh).toFixed(3),
    types: Array.from({ length: nCol }, (_, i) => (o.types || [])[i] || (o.types || [])[0] || "PLA"),
    colors: Array.from({ length: nCol }, (_, i) => (o.colors || [])[i] || "#808080"),
    bedW: o.bed.w, bedD: o.bed.d, bedH: o.bed.h || 250, retract, heads: o.heads || 1,
  };
  // ---- header: who wrote it (in the words of OrcaSlicer's own first line, so printers and
  // Moonraker read the settings at the end of the file), a picture of the plate, the settings
  W("; HEADER_BLOCK_START");
  W(`; generated by JumpStart 3D ${VERSION}, written like OrcaSlicer 2.5.1 on the same settings`);
  W(`; total layer number: ${S.nL}`);
  W("; estimated printing time (normal mode) = @@TIME@@");
  W(";HEADER_BLOCK_END");
  if (o.thumbs && o.thumbs.length) {
    W(""); W("; THUMBNAIL_BLOCK_START");
    for (const th of o.thumbs) {
      W(";"); W(`; thumbnail begin ${th.w}x${th.h} ${th.b64.length}`);
      for (let q = 0; q < th.b64.length; q += 78) W("; " + th.b64.slice(q, q + 78));
      W("; thumbnail end");
    }
    W("; THUMBNAIL_BLOCK_END"); W("");
  }
  W(`; printer: ${o.printerName} (${mach.model})`);
  W(`; filament: ${o.filamentName}, nozzle ${tn} °C, bed ${tb} °C`);
  W(`; layer height: ${lh} mm, walls: ${o.walls}, infill: ${o.infill}% (${o.pattern || "rectilinear"}, smooth factor ${Math.round(smooth * 100)}%), top ${o.topN} / bottom ${o.botN} layers`);
  W(`; supports: ${o.supports}, speed: ${o.speed}, G-code flavor: ${mach.flavor || o.flavor}`);
  W(`; first layer height: ${flh} mm, seam: ${seamMode}, ironing: ${o.ironing || "no ironing"}${o.spiral ? ", spiral vase" : ""}`);
  W(`; speeds and accelerations: ${prof.name} (Orca Slicer profile)`);
  W("; filament used [mm]: @@FIL@@");
  W("; filament used [g]: @@GRAMS@@");
  // ---- the printer's own start
  const st0 = mach.start(C);
  for (const s of st0.lines) W(s);
  W(mach.flavor === "klipper" ? `SET_VELOCITY_LIMIT ACCEL=${prof.mach.acc} ; acceleration limit` : `M201 X${prof.mach.acc} Y${prof.mach.acc} ; acceleration limits`);
  W("M107 ; fan off for the first layer");
  // the head is where the start left it (in the printer's coordinates), 2 mm up
  x = st0.at[0] - ox; y = st0.at[1] - oy; z = 2;
  tool = C.initial;
  tx = x; ty = y; tz = z;
  // ---- layers
  const nL = S.nL, ends = S.layerEnd, L = S.lines, K = S.lkind, SL = S.lslot;
  let li = 0;
  const totalLines = L.length / 6;
  // first-layer outline (for the skirt / brim): the convex hull of the first layer's lines
  const hull = (() => {
    const end0 = (ends[0] || 0) / 2, P = [];
    for (let i = 0; i < end0; i++) P.push([L[i * 6], L[i * 6 + 1]], [L[i * 6 + 3], L[i * 6 + 4]]);
    if (P.length < 3) return null;
    P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o2, a, b) => (a[0] - o2[0]) * (b[1] - o2[1]) - (a[1] - o2[1]) * (b[0] - o2[0]);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  })();
  const loopAround = (H, d) => {
    // the hull pushed out by d (corners rounded)
    const c = H.reduce((a, p) => [a[0] + p[0] / H.length, a[1] + p[1] / H.length], [0, 0]), out2 = [];
    for (let i = 0; i < H.length; i++) {
      const a = H[(i + H.length - 1) % H.length], b = H[i], cc = H[(i + 1) % H.length];
      const n1 = norm2([b[1] - a[1], a[0] - b[0]]), n2 = norm2([cc[1] - b[1], b[0] - cc[0]]);
      // outward: away from the middle
      const s = (b[0] - c[0]) * (n1[0] + n2[0]) + (b[1] - c[1]) * (n1[1] + n2[1]) < 0 ? -1 : 1;
      const a1 = Math.atan2(s * n1[1], s * n1[0]); let a2 = Math.atan2(s * n2[1], s * n2[0]);
      let da = a2 - a1; da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI;
      const steps = Math.max(1, Math.ceil(Math.abs(da) / 0.3));
      for (let k = 0; k <= steps; k++) { const an = a1 + (da * k) / steps; out2.push([b[0] + d * Math.cos(an), b[1] + d * Math.sin(an)]); }
    }
    return out2;
  };
  const supByLayer = (k, zz) => {
    if (!sup || !sup.cols || !sup.cols.length) return [];
    // rows of support columns active at this height become zig-zag lines
    const rows = new Map(), sp = sup.sp || 2;
    for (const c of sup.cols) if (c.z0 < zz && c.z1 >= zz - 1e-6) { const key = Math.round(c.y / sp); if (!rows.has(key)) rows.set(key, []); rows.get(key).push(c.x); }
    const segs = [];
    let flip = false;
    for (const key of [...rows.keys()].sort((a, b) => a - b)) {
      const xs = rows.get(key).sort((a, b) => a - b), yy = key * sp;
      let s0 = xs[0], prev = xs[0];
      const runs = [];
      for (let i = 1; i <= xs.length; i++) { if (i === xs.length || xs[i] - prev > sp * 1.5) { runs.push([s0 - sp * 0.45, prev + sp * 0.45]); if (i < xs.length) s0 = xs[i]; } if (i < xs.length) prev = xs[i]; }
      for (const [a, b] of runs) segs.push(flip ? [b, yy, a, yy] : [a, yy, b, yy]);
      flip = !flip;
    }
    return segs;
  };
  const layerT = new Float64Array(nL);
  let t = 0, slowed = 0;
  for (let k = 0; k < nL; k++) {
    const zz = +(flh + k * lh).toFixed(4);
    // each layer's moves start again at index 1; move 0 is where the head is
    M.n = 0; ops.length = 0; M.push(x, y, z, e, travelV, travelA, true);
    ops.push(";BEFORE_LAYER_CHANGE", `;${f3(zz)}`, ";LAYER_CHANGE", `;Z:${f3(zz)}`, `;HEIGHT:${k === 0 ? flh : lh}`);
    if (mach.layerInfo) ops.push(`SET_PRINT_STATS_INFO TOTAL_LAYER=${nL} CURRENT_LAYER=${k + 1}`);
    spiral = null;
    if (spiralK(k)) {
      // the outer wall rises from the last layer's height to this one as it goes round
      let len = 0; const e0 = (ends[k] || 0) / 2; for (let q = li; q < e0; q++) if (KINDS[K[q]] === "outer") len += Math.hypot(L[q * 6 + 3] - L[q * 6], L[q * 6 + 4] - L[q * 6 + 1]);
      if (len > 0) spiral = { z0: zz - lh, h: lh, len, acc: 0 };
    }
    if (k > 0 && !spiral) doRetract();
    if (!spiral) mv(x, y, zz + (retracted && hop ? hop : 0), 0, prof.mach.z, 500, true);
    unRetract();
    ops.push(`M73 P${Math.round((li / Math.max(1, totalLines)) * 100)} R@@R${k}@@`);
    if (k === 1 && fan > 0) ops.push(`M106 S${Math.round((fan / 100) * 255)}`);
    lastKind = "";
    const ring = (lp, kind) => { for (let i = 0; i < lp.length; i++) { const a = lp[i], b = lp[(i + 1) % lp.length]; extrude(a[0], a[1], b[0], b[1], kind, 0); } };
    const brimW = o.brimType === "no_brim" ? 0 : o.brimType === "auto_brim" && !(o.brim > 0) ? (o.autoBrim || 0) : o.brim || 0;
    if (k === 0 && hull && brimW > 0) {
      const gap = Math.max(0, o.brimGap || 0), n = Math.max(1, Math.round(brimW / LW));
      if (o.brimType === "brim_ears") {
        // mouse ears: round pads at the sharp corners only
        const ears = [];
        for (let i = 0; i < hull.length; i++) {
          const a = hull[(i + hull.length - 1) % hull.length], b = hull[i], c = hull[(i + 1) % hull.length];
          const u = norm2([a[0] - b[0], a[1] - b[1]]), v = norm2([c[0] - b[0], c[1] - b[1]]);
          if (Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) < (125 * Math.PI) / 180 && !ears.some((q) => Math.hypot(q[0] - b[0], q[1] - b[1]) < brimW)) ears.push(b);
        }
        for (const b of ears.slice(0, 16)) for (let r = n; r >= 1; r--) {
          const rr = r * LW, m = Math.max(8, Math.ceil((2 * Math.PI * rr) / 0.8)), lp = [];
          for (let q = 0; q < m; q++) lp.push([b[0] + rr * Math.cos((q / m) * 2 * Math.PI), b[1] + rr * Math.sin((q / m) * 2 * Math.PI)]);
          ring(lp, "brim");
        }
      } else for (let r = n; r >= 1; r--) ring(loopAround(hull, gap + r * LW), "brim");
    }
    if (hull && k < Math.max(1, o.skirtH || 1)) {
      const sd = o.skirtDist != null ? +o.skirtDist : 4;
      for (let s2 = (o.skirt || 0) - 1; s2 >= 0; s2--) ring(loopAround(hull, (brimW > 0 && o.brimType !== "brim_ears" ? brimW + (o.brimGap || 0) : 0) + sd + s2 * LW), "skirt");
    }
    for (const [a0, b0, a1, b1] of supByLayer(k, zz)) extrude(a0, b0, a1, b1, "support", k, 0.85);
    // the model's lines: kept in order, but each run of the same feature is walked nearest-first
    // (and lines flipped) so the nozzle doesn't travel back and forth across the part
    const end = (ends[k] || 0) / 2;
    let i = li;
    while (i < end) {
      const kind = KINDS[K[i]], slot = SL ? SL[i] : 0;
      let j = i; while (j < end && K[j] === K[i] && (SL ? SL[j] : 0) === slot) j++;
      if (SL && slot !== tool) {
        doRetract();
        const tc = mach.toolChange ? mach.toolChange(C, slot, tool, k) : [`T${slot}`];
        ops.push(`; filament F${tool + 1} -> F${slot + 1}`, ...(tc.length ? tc : [`; (this printer changes filament only from its own slicer project: print the 3MF project for colours)`]), "@@RESET@@");
        tool = slot;
      }
      const idx = []; for (let q = i; q < j; q++) idx.push(q);
      const walls = kind === "outer" || kind === "inner";
      if (!walls && idx.length > 1) {
        // nearest first, using a coarse grid so big layers stay quick
        const used = new Uint8Array(idx.length), G = new Map(), gs = 4;
        const gk = (px, py) => Math.floor(px / gs) + "," + Math.floor(py / gs);
        idx.forEach((q, n) => { const m = q * 6; for (const [px, py] of [[L[m], L[m + 1]], [L[m + 3], L[m + 4]]]) { const kk = gk(px, py); if (!G.has(kk)) G.set(kk, []); G.get(kk).push(n); } });
        let cx = x, cy = y, left = idx.length;
        while (left) {
          let best = -1, bd = Infinity, fl = false;
          const gx = Math.floor(cx / gs), gy = Math.floor(cy / gs);
          for (let r = 0; r < 64 && best < 0; r++) {
            for (let ix = gx - r; ix <= gx + r; ix++) for (let iy = gy - r; iy <= gy + r; iy++) {
              if (r && ix > gx - r && ix < gx + r && iy > gy - r && iy < gy + r) continue;
              const cell = G.get(ix + "," + iy); if (!cell) continue;
              for (const n of cell) {
                if (used[n]) continue;
                const m = idx[n] * 6, d0 = (L[m] - cx) ** 2 + (L[m + 1] - cy) ** 2, d1 = (L[m + 3] - cx) ** 2 + (L[m + 4] - cy) ** 2;
                if (d0 < bd) { bd = d0; best = n; fl = false; }
                if (d1 < bd) { bd = d1; best = n; fl = true; }
              }
            }
          }
          if (best < 0) { for (let n = 0; n < idx.length; n++) if (!used[n]) { best = n; break; } }
          used[best] = 1; left--;
          const m = idx[best] * 6;
          if (fl) { extrude(L[m + 3], L[m + 4], L[m], L[m + 1], kind, k); cx = L[m]; cy = L[m + 1]; }
          else { extrude(L[m], L[m + 1], L[m + 3], L[m + 4], kind, k); cx = L[m + 3]; cy = L[m + 4]; }
        }
      } else for (const q of seamOrder(idx)) { const m = q * 6; extrude(L[m], L[m + 1], L[m + 3], L[m + 4], kind, k); }
      i = j;
    }
    if (o.ironing && o.ironing !== "no ironing") iron(k, li, end, zz);
    li = end;
    seamPrev = seamNow; seamNow = [];
    // time the layer; slow it down for cooling if it would print faster than the filament allows
    const per = new Float64Array(M.n);
    let lt = timeMoves(M, 1, M.n, prof, per.subarray(1));
    if (coolT > 0 && lt < coolT && k > 0) {
      let te = 0; for (let q = 1; q < M.n; q++) if (!M.d[q * 7 + 6] && M.d[q * 7 + 3] > M.d[q * 7 - 4]) te += per[q];
      const want = te + (coolT - lt);
      if (te > 0.01) {
        const s = te / want;
        for (let q = 1; q < M.n; q++) { const o2 = q * 7; if (!M.d[o2 + 6] && M.d[o2 + 3] > M.d[o2 - 4]) M.d[o2 + 4] = Math.max(Math.min(coolMin, M.d[o2 + 4]), M.d[o2 + 4] * s); }
        lt = timeMoves(M, 1, M.n, prof, null); slowed++;
      }
    }
    t += lt; layerT[k] = lt;
    if (!est) { writeOps(); out.push("@@LAYER_TIME@@" + k + "|" + t); }
  }
  if (est) return { secs: t, layerT, filamentMM: filUsed, grams: (filUsed * eArea * (o.density || 1.24)) / 1000, layers: nL, slowed, profile: prof.name };
  // ---- the printer's own end
  W("; filament end"); W(`;${f3(z)}`);
  for (const s2 of [...mach.end(C), "M73 P100 R0"]) W(s2);
  // fill in the time and the filament
  const grams = (filUsed * eArea * (o.density || 1.24)) / 1000;
  const hms = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60); return (h ? h + "h " : "") + m + "m " + sec + "s"; };
  const times = new Map();
  const lines = [];
  for (const s of out) { if (s.startsWith("@@LAYER_TIME@@")) { const [kk, tt] = s.slice(14).split("|"); times.set(+kk, +tt); } else lines.push(s); }
  // like OrcaSlicer: totals per filament, then every setting (the printer's screen and Moonraker
  // read the model, nozzles, filaments and times from here)
  const perMM = Array.from({ length: C.colors.length }, (_, i) => filBy[i] || 0);
  const perG = perMM.map((mm) => (mm * eArea * (o.density || 1.24)) / 1000);
  lines.push("", `; filament used [mm] = ${perMM.map((v) => v.toFixed(2)).join(",")}`, `; filament used [cm3] = ${perMM.map((v) => ((v * eArea) / 1000).toFixed(2)).join(",")}`,
    `; filament used [g] = ${perG.map((v) => v.toFixed(2)).join(",")}`, `; total filament used [g] = ${grams.toFixed(2)}`, `; total layers count = ${S.nL}`, "; estimated printing time (normal mode) = @@TIME@@");
  const cfg = { ...(o.config || {}) };
  cfg.printer_model = mach.model;
  if (!cfg.printer_settings_id || cfg.printer_settings_id === o.printerName) cfg.printer_settings_id = `${mach.model} ${C.nozzle} nozzle`;
  cfg.gcode_flavor = mach.flavor === "prusa" ? "marlin2" : mach.flavor === "bambu" ? "marlin" : mach.flavor || cfg.gcode_flavor;
  cfg.layer_height = String(lh); cfg.first_layer_height = String(flh);
  cfg.first_layer_temperature = C.colors.map(() => String(tn)); cfg.first_layer_bed_temperature = C.colors.map(() => String(tb));
  cfg.nozzle_temperature = C.colors.map(() => String(tn)); cfg.nozzle_temperature_initial_layer = cfg.nozzle_temperature;
  cfg.filament_colour = C.colors.map((q) => String(q).toUpperCase()); cfg.filament_type = C.types;
  cfg.nozzle_diameter = Array.from({ length: C.heads }, () => String(C.nozzle));
  cfg.filament_diameter = C.colors.map(() => String(fil));
  cfg.outer_wall_speed = String(Math.round(prof.v ? prof.v.outer : 200)); cfg.outer_wall_acceleration = String(Math.round(prof.acc ? prof.acc.outer || prof.acc.def : 5000));
  if (!cfg.line_width) cfg.line_width = String(LW);
  cfg.print_sequence = "by layer";
  if (mach.footer) Object.assign(cfg, mach.footer(C));
  // Orca's lists: words separated by ";", numbers by ","
  const listOf = (vv, kk) => vv.join(/^filament_|^default_filament/.test(kk) && !vv.every((q) => q !== "" && isFinite(+q)) ? ";" : ",");
  lines.push("", "; CONFIG_BLOCK_START");
  for (const [kk, vv] of Object.entries(cfg)) lines.push(`; ${kk} = ${Array.isArray(vv) ? listOf(vv.map(String), kk) : vv}`);
  lines.push("; CONFIG_BLOCK_END");
  let text = lines.join("\n") + "\n";
  text = text.replaceAll("@@TIME@@", hms(t)).replace("@@FIL@@", f3(filUsed)).replace("@@GRAMS@@", grams.toFixed(2));
  text = text.replace(/@@R(\d+)@@/g, (m0, kk) => { const at = kk > 0 ? times.get(+kk - 1) || 0 : 0; return String(Math.max(0, Math.round((t - at) / 60))); });
  return { text, secs: t, layerT, filamentMM: filUsed, grams, layers: nL, slowed, profile: prof.name };
}
function norm2(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
