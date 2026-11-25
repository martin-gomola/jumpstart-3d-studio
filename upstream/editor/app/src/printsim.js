// 3D Print Sim: lays the design on a printer's plate and slices it, like Orca Slicer: layers
// with walls, infill and top/bottom skins, overhangs, normal or tree supports, a strength /
// weak-point map and print estimates, then saves G-code for the printer (gcode.js).
import * as THREE from "three";
import { store, findBody } from "./store.js";
import { el, fmt } from "./util.js";
import { M4 } from "./ops.js";
import { FILAMENTS } from "./fea.js";
import { readSimFiles } from "./simimport.js";
import { make3MF, makeSTL, encodePaint, orcaSettings, fromOrca } from "./simexport.js";
import { makeGcode, KINDS as GK, FIL_TEMPS, FLAVORS, flavorFor, SPEED_PRESETS, motionFor } from "./gcode.js";
import { machineFor, genericMachine, THUMB_SIZES, MACHINES } from "./machines.js";

// Printers and how they handle more than one filament (like Orca Slicer's printer profiles):
//   tools.kind  "single"  one nozzle, one filament (swap by hand)
//               "mmu"     one nozzle fed by a spool switcher (AMS, CFS, Canvas, IFS, MMU3):
//                         every change unloads, loads and purges ("flushes") the old color
//               "heads"   independent toolheads / nozzles (tool changers, dual nozzle, Vortek):
//                         each filament keeps its own nozzle, so a change is a quick swap with
//                         only a small prime; more filaments than heads share a head (and flush)
//   heads: nozzles that can hold different filaments, slots: most filaments at once,
//   swap: seconds per head change, load: seconds to unload + load a spool (purge time is added),
//   prime: mm³ primed after a head swap, wSingle / wDual: printable width with one / both
//   nozzles (dual-nozzle printers), sys: what it's called.
export const PRINTERS = {
  // Bambu Lab
  a1mini: { brand: "Bambu Lab", name: "Bambu Lab A1 mini", w: 180, d: 180, h: 180, tools: { kind: "mmu", heads: 1, slots: 4, load: 30, sys: "AMS lite" } },
  a1: { brand: "Bambu Lab", name: "Bambu Lab A1", w: 256, d: 256, h: 256, tools: { kind: "mmu", heads: 1, slots: 4, load: 30, sys: "AMS lite" } },
  a2l: { brand: "Bambu Lab", name: "Bambu Lab A2L", w: 330, d: 320, h: 325, tools: { kind: "mmu", heads: 1, slots: 19, load: 30, sys: "AMS lite + AMS units" } },
  p1s: { brand: "Bambu Lab", name: "Bambu Lab P1S / P1P", w: 256, d: 256, h: 250, tools: { kind: "mmu", heads: 1, slots: 16, load: 25, sys: "AMS" } },
  p2s: { brand: "Bambu Lab", name: "Bambu Lab P2S", w: 256, d: 256, h: 256, tools: { kind: "mmu", heads: 1, slots: 16, load: 22, sys: "AMS 2 Pro" } },
  x1: { brand: "Bambu Lab", name: "Bambu Lab X1 Carbon / X1E", w: 256, d: 256, h: 250, tools: { kind: "mmu", heads: 1, slots: 16, load: 25, sys: "AMS" } },
  x2d: { brand: "Bambu Lab", name: "Bambu Lab X2D (dual nozzle)", w: 256, d: 256, h: 260, tools: { kind: "heads", heads: 2, slots: 16, swap: 12, prime: 30, load: 25, lr: true, sys: "dual nozzle + AMS" } },
  h2s: { brand: "Bambu Lab", name: "Bambu Lab H2S", w: 340, d: 320, h: 340, tools: { kind: "mmu", heads: 1, slots: 24, load: 25, sys: "AMS 2 Pro / AMS HT" } },
  h2d: { brand: "Bambu Lab", name: "Bambu Lab H2D / H2D Pro (dual nozzle)", w: 350, d: 320, h: 325, tools: { kind: "heads", heads: 2, slots: 24, swap: 12, prime: 30, load: 25, lr: true, wSingle: 325, wDual: 300, sys: "dual nozzle + AMS" } },
  h3c: { brand: "Bambu Lab", name: "Bambu Lab H3C (Swaptek, 9 PrintTools)", w: 330, d: 320, h: 325, tools: { kind: "heads", heads: 9, slots: 24, swap: 6, prime: 31, load: 25, sys: "Swaptek tool changer (9 PrintTools; tool 9 takes 2.85 mm TPU) + AMS 3H" } },
  h2c: { brand: "Bambu Lab", name: "Bambu Lab H2C (Vortek, 7 hotends)", w: 350, d: 320, h: 325, tools: { kind: "heads", heads: 7, slots: 24, swap: 25, prime: 15, load: 25, wSingle: 325, wDual: 300, sys: "Vortek hotend swapping (1 left + 6 right) + AMS" } },
  // Creality
  ender3: { brand: "Creality", name: "Creality Ender-3", w: 220, d: 220, h: 250, tools: { kind: "single" } },
  k1: { brand: "Creality", name: "Creality K1 / K1C / K1 SE", w: 220, d: 220, h: 250, tools: { kind: "single" } },
  k1max: { brand: "Creality", name: "Creality K1 Max", w: 300, d: 300, h: 300, tools: { kind: "single" } },
  k2se: { brand: "Creality", name: "Creality K2 SE", w: 220, d: 215, h: 245, tools: { kind: "mmu", heads: 1, slots: 16, load: 40, sys: "CFS" } },
  k2: { brand: "Creality", name: "Creality K2", w: 260, d: 260, h: 260, tools: { kind: "mmu", heads: 1, slots: 16, load: 40, sys: "CFS" } },
  k2pro: { brand: "Creality", name: "Creality K2 Pro", w: 300, d: 300, h: 300, tools: { kind: "mmu", heads: 1, slots: 16, load: 40, sys: "CFS" } },
  k2plus: { brand: "Creality", name: "Creality K2 Plus", w: 350, d: 350, h: 350, tools: { kind: "mmu", heads: 1, slots: 16, load: 40, sys: "CFS" } },
  // Elegoo
  cc: { brand: "Elegoo", name: "Elegoo Centauri Carbon", w: 256, d: 256, h: 256, tools: { kind: "single" } },
  cc2: { brand: "Elegoo", name: "Elegoo Centauri Carbon 2", w: 256, d: 256, h: 256, tools: { kind: "mmu", heads: 1, slots: 4, load: 45, sys: "CANVAS" } },
  // Flashforge
  ff5m: { brand: "Flashforge", name: "Flashforge Adventurer 5M / 5M Pro", w: 220, d: 220, h: 220, tools: { kind: "single" } },
  ffad5x: { brand: "Flashforge", name: "Flashforge AD5X", w: 220, d: 220, h: 220, tools: { kind: "mmu", heads: 1, slots: 4, load: 45, sys: "IFS" } },
  creator5: { brand: "Flashforge", name: "Flashforge Creator 5 (4 toolheads)", w: 256, d: 256, h: 256, tools: { kind: "heads", heads: 4, slots: 4, swap: 10, prime: 15, sys: "4-toolhead tool changer" } },
  creator5pro: { brand: "Flashforge", name: "Flashforge Creator 5 Pro (4 toolheads)", w: 256, d: 256, h: 256, tools: { kind: "heads", heads: 4, slots: 4, swap: 10, prime: 15, sys: "4-toolhead tool changer, heated chamber" } },
  // Prusa
  mini: { brand: "Prusa", name: "Prusa MINI+", w: 180, d: 180, h: 180, tools: { kind: "single" } },
  // the MK3 family: the original MK3, MK3S and MK3S+ (Marlin, 250 × 210 × 210), the MK3.5 / MK3.5S
  // upgrade (input shaping, 220 mm tall) and the MK3.9 / MK3.9S (MK4 electronics and Nextruder in an MK3 frame)
  mk3: { brand: "Prusa", name: "Prusa i3 MK3 (+ MMU2)", w: 250, d: 210, h: 210, tools: { kind: "mmu", heads: 1, slots: 5, load: 45, sys: "MMU2" } },
  mk3s: { brand: "Prusa", name: "Prusa i3 MK3S (+ MMU2S)", w: 250, d: 210, h: 210, tools: { kind: "mmu", heads: 1, slots: 5, load: 40, sys: "MMU2S" } },
  mk3splus: { brand: "Prusa", name: "Prusa i3 MK3S+ (+ MMU3)", w: 250, d: 210, h: 210, tools: { kind: "mmu", heads: 1, slots: 5, load: 35, sys: "MMU3" } },
  mk35: { brand: "Prusa", name: "Prusa MK3.5 (+ MMU3)", w: 250, d: 210, h: 220, tools: { kind: "mmu", heads: 1, slots: 5, load: 35, sys: "MMU3" } },
  mk35s: { brand: "Prusa", name: "Prusa MK3.5S (+ MMU3)", w: 250, d: 210, h: 220, tools: { kind: "mmu", heads: 1, slots: 5, load: 35, sys: "MMU3" } },
  mk39: { brand: "Prusa", name: "Prusa MK3.9 (+ MMU3)", w: 250, d: 210, h: 220, tools: { kind: "mmu", heads: 1, slots: 5, load: 30, sys: "MMU3" } },
  mk39s: { brand: "Prusa", name: "Prusa MK3.9S (+ MMU3)", w: 250, d: 210, h: 220, tools: { kind: "mmu", heads: 1, slots: 5, load: 30, sys: "MMU3" } },
  mk4: { brand: "Prusa", name: "Prusa MK4S (+ MMU3)", w: 250, d: 210, h: 220, tools: { kind: "mmu", heads: 1, slots: 5, load: 30, sys: "MMU3" } },
  core1: { brand: "Prusa", name: "Prusa CORE One (+ MMU3)", w: 250, d: 220, h: 270, tools: { kind: "mmu", heads: 1, slots: 5, load: 30, sys: "MMU3" } },
  core1l: { brand: "Prusa", name: "Prusa CORE One L", w: 300, d: 300, h: 330, tools: { kind: "single" } },
  core1lindx4: { brand: "Prusa", name: "Prusa CORE One L INDX (4 tools)", w: 298, d: 275, h: 330, tools: { kind: "heads", heads: 4, slots: 4, swap: 12, prime: 10, sys: "INDX tool changer" } },
  core1lindx8: { brand: "Prusa", name: "Prusa CORE One L INDX (8 tools)", w: 298, d: 275, h: 330, tools: { kind: "heads", heads: 8, slots: 8, swap: 12, prime: 10, sys: "INDX tool changer" } },
  xl1: { brand: "Prusa", name: "Prusa XL (1 toolhead)", w: 360, d: 360, h: 360, tools: { kind: "single" } },
  xl2: { brand: "Prusa", name: "Prusa XL (2 toolheads)", w: 360, d: 360, h: 360, tools: { kind: "heads", heads: 2, slots: 2, swap: 10, prime: 15, sys: "tool changer" } },
  xl5: { brand: "Prusa", name: "Prusa XL (5 toolheads)", w: 360, d: 360, h: 360, tools: { kind: "heads", heads: 5, slots: 5, swap: 10, prime: 15, sys: "tool changer" } },
  // FLSUN (delta: a round bed, measured by its diameter)
  qqs: { brand: "FLSUN", name: "FLSUN QQ-S / QQ-S Pro (delta)", w: 260, d: 260, h: 360, round: true, tools: { kind: "single" } },
  // Snapmaker
  u1: { brand: "Snapmaker", name: "Snapmaker U1 (4 toolheads)", w: 270, d: 270, h: 270, tools: { kind: "heads", heads: 4, slots: 4, swap: 5, prime: 15, sys: "SnapSwap tool changer" } },
  // Voron
  voron: { brand: "Voron", name: "Voron 2.4 350", w: 350, d: 350, h: 325, tools: { kind: "single" } },
};
const PURGE_FLOW = 12; // mm³/s a nozzle purges at while flushing
// Orca-style flushing volume (mm³) from one color to the next: more when going from dark to
// light, and more the more different the colors are
function flushVolume(from, to) {
  const rgb = (hex) => { const c = new THREE.Color(hex || "#808080"); return [c.r, c.g, c.b]; };
  const a = rgb(from), b = rgb(to);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const dl = Math.max(0, lum(b) - lum(a));
  const dc = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / Math.sqrt(3);
  return 140 + 520 * dl + 160 * dc;
}
// typical max volumetric flow (mm³/s) and speeds for a standard 0.4 mm nozzle profile
const FLOW = { pla: 21, plaplus: 16, petg: 12, abs: 15, asa: 14, nylon: 10, pc: 10, cfpla: 12, cfnylon: 9, peek: 6, tpu: 4 };
const COL = {
  outer: 0xff8000, inner: 0xffd400, sparse: 0xb03029, solid: 0x9654cc, top: 0xf04040, bottom: 0x5a9ee6, bridge: 0x4d80ba, support: 0x1fb85a,
};
const LEGEND = [["outer", "Outer wall"], ["inner", "Inner wall"], ["sparse", "Sparse infill"], ["solid", "Solid infill"], ["top", "Top surface"], ["bottom", "Bottom surface"], ["bridge", "Bridge"], ["support", "Support"]];
const LW = 0.42; // line width for a 0.4 mm nozzle
const SPEEDS = { outer: 150, inner: 220, sparse: 270, solid: 220, top: 180, bottom: 60, bridge: 50 }; // mm/s

// sparse infill patterns (Orca Slicer 2.5 names): the directions of the lines on layer k
export const INFILL_PATTERNS = [["rectilinear", "Rectilinear"], ["alignedrectilinear", "Aligned Rectilinear"], ["grid", "Grid"], ["triangles", "Triangles"], ["crosshatch", "Cross Hatch"]];
export function initPrintSim(app, X) {
  const { vp, scene, openCmd, closeCmd, row, seg, sliderRow } = X;
  const st = {
    printer: "x1", filament: "pla", layer: 0.2, walls: 2, infill: 15, topN: 4, botN: 3,
    // Orca Slicer 2.5: sparse infill pattern and "Sparse infill smooth factor" (rounds the corners
    // of the infill path so the head keeps its speed through the turns)
    pattern: "rectilinear", smooth: 0,
    supports: "none", threshold: 45, plateOnly: false, view: "model", R: new THREE.Matrix4(), ids: [],
    // objects on the plate: { key, id (body), X (sim placement), home, s (scale), n (copy no.) }; osel: picked objects
    inst: [], osel: new Set(), copyN: 0, oang: 90,
    pickFace: false, layerMax: 0, ptab: "quality",
    // filaments: slots[i] = { color }, and the slot each body prints with (grouped by color at first)
    slots: [], slotOf: new Map(), colorBy: "auto",
    // full color: every design color mixed from cyan, magenta, yellow, black and white filaments
    cmyk: { on: false, n: 6, surf: true, inks: null },
    // color painting: faces painted with a filament; tool: null | "paint" | "fill" | "erase"
    paint: new Map(), paintTool: null, brush: 0,
    // Orca Slicer 2.5 painting: strokes kept per body (see pushOp); brush size, smart fill angle,
    // height range band, and Shift to erase
    ops: new Map(), pv: 0, brushR: 4, smartAng: 30, bandH: 5,
    // v2.9.9.9.8: Circle brush (front only) or Sphere; Paint can angle limit (180 = none);
    // smart fill stops at other colours / measures from the clicked spot; undo snapshots
    brushMode: "circle", fillAng: 180, smartStop: true, smartSeed: false, undo: [],
    // Orca Slicer 2.5 color mixing: a slot with { mix: { of, w, grad } } is a mixed filament,
    // printed as its filaments in alternating layers; mixUI is the "Add mixed filament" editor
    mixUI: { open: false, a: 0, b: 1, c: -1, r: 50, r2: 25, grad: false, dc: "#8a5cf0", dres: null }, autoMsg: "",
    // Process > Multimaterial: filament for features, prime tower and flushing volumes
    feat: { walls: -1, sparse: -1, solid: -1 }, tower: true, towerW: 0, flushMul: 1,
    // G-code (like Orca's process and filament settings)
    gflavor: null, nozzleT: null, bedT: null, fanP: null, speed: "standard", skirt: 1, brim: 0, retract: 0.8, zhop: true, showG: false, lastG: null,
    // v2.9.9.9.9: more of Orca Slicer's process settings (same names and defaults)
    firstLayer: 0.2, seam: "aligned", ironing: "no ironing", ironFlow: 10, ironSpacing: 0.1, ironSpeed: 30, spiral: false,
    brimType: "auto_brim", brimGap: 0.1, skirtDist: 2, skirtH: 1, seq: "by layer", wallGen: "arachne", topPat: "monotonicline", botPat: "monotonic",
    fuzzy: "none", raft: 0, thinWalls: false, oneWallTop: false, plate: "Textured PEI Plate", supStyle: "default", supZ: 0.2,
  };
  function sparseAngles(k) {
    const d = Math.PI / 180;
    switch (st.pattern) {
      case "alignedrectilinear": return [45 * d];
      case "grid": return [45 * d, -45 * d];
      case "triangles": return [0, 60 * d, 120 * d];
      case "crosshatch": { const blk = Math.max(1, Math.round(2 / st.layer)); return [Math.floor(k / blk) % 2 ? 45 * d : -45 * d]; }
      default: return [k % 2 ? 45 * d : -45 * d];
    }
  }
  const root = new THREE.Group(); root.visible = false; vp.world.add(root);
  const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e9); // keeps z below the shown layer
  vp.renderer.localClippingEnabled = true;
  const plateG = new THREE.Group(), supG = new THREE.Group(), ovG = new THREE.Group(), layG = new THREE.Group(), strG = new THREE.Group();
  root.add(plateG, supG, ovG, layG, strG);
  let W = null; // world geometry of the plate
  let A = null; // analysis (overhangs, supports)
  let S = null; // slice result
  let sliceJob = 0, slider = null, legendEl = null;
  // objects that aren't in the design (from the Color Lithophane Studio): id -> { name, color, data }
  const EXT = new Map();
  const bodyOf = (id) => findBody(store.doc, id) || EXT.get(id) || null;
  // the Color Lithophane Studio sets its own filaments; imported STL / 3MF files paint and mix like the design
  const litho = () => EXT.size > 0 && st.extKind !== "import";
  const viewOf = (id) => scene.views.get(id) || (EXT.has(id) ? { data: EXT.get(id).data } : null);

  const disposeGroup = (g) => { for (const c of [...g.children]) { g.remove(c); c.traverse((o) => { o.geometry && o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); }); } };

  // ------------------------------------------------------------ plate
  function buildPlate() {
    disposeGroup(plateG);
    const P = PRINTERS[st.printer], dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    // a textured build plate like Orca Slicer's: dark PEI, a 10 mm grid with bolder 50 mm lines
    // from the centre, the plate's name and number in a corner
    const k = Math.min(6, 2048 / Math.max(P.w, P.d)), cv = document.createElement("canvas");
    cv.width = Math.round(P.w * k); cv.height = Math.round(P.d * k);
    const g = cv.getContext("2d");
    g.fillStyle = dark ? "#33373d" : "#4a4f56"; g.fillRect(0, 0, cv.width, cv.height);
    // a faint speckle, like textured PEI
    for (let i = 0; i < (cv.width * cv.height) / 90; i++) { g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)"; g.fillRect(Math.random() * cv.width, Math.random() * cv.height, 1.5, 1.5); }
    const line = (x0, y0, x1, y1, c, w) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
    for (let x = 0; x <= P.w / 2 + 1e-6; x += 10) for (const sx of x ? [-1, 1] : [1]) { const px = (P.w / 2 + sx * x) * k, bold = x % 50 === 0; line(px, 0, px, cv.height, bold ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.09)", bold ? 1.6 : 1); }
    for (let y = 0; y <= P.d / 2 + 1e-6; y += 10) for (const sy of y ? [-1, 1] : [1]) { const py = (P.d / 2 + sy * y) * k, bold = y % 50 === 0; line(0, py, cv.width, py, bold ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.09)", bold ? 1.6 : 1); }
    g.strokeStyle = "rgba(0,150,136,0.9)"; g.lineWidth = 3;
    if (P.round) { g.beginPath(); g.arc(cv.width / 2, cv.height / 2, cv.width / 2 - 1.5, 0, Math.PI * 2); g.stroke(); } else g.strokeRect(1.5, 1.5, cv.width - 3, cv.height - 3);
    g.fillStyle = "rgba(255,255,255,0.32)"; g.font = `600 ${Math.round(7 * k)}px system-ui, sans-serif`; g.textBaseline = "bottom";
    // (on a round plate the label and number go nearer the middle, inside the circle)
    const lx = P.round ? P.w * 0.2 : 6, ly = P.round ? P.d * 0.2 : 5, nx = P.round ? P.w * 0.2 : 4;
    g.fillText(P.name.replace(/\s*\(.*\)/, "") + (P.round ? " · Ø" + P.w + " mm" : " · Textured PEI Plate"), lx * k, cv.height - ly * k);
    g.fillStyle = "rgba(0,150,136,0.95)"; g.fillRect(nx * k, nx * k, 12 * k, 12 * k);
    g.fillStyle = "#fff"; g.font = `700 ${Math.round(9 * k)}px system-ui, sans-serif`; g.textBaseline = "middle"; g.textAlign = "center"; g.fillText("1", (nx + 6) * k, (nx + 6.5) * k);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const plate = new THREE.Mesh(P.round ? new THREE.CircleGeometry(P.w / 2, 128) : new THREE.PlaneGeometry(P.w, P.d), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
    plate.position.z = -0.02;
    plateG.add(plate);
    // the plate's edge, a few millimetres thick
    const edge = new THREE.Mesh(P.round ? new THREE.CylinderGeometry(P.w / 2 + 2, P.w / 2 + 2, 3, 128).rotateX(Math.PI / 2) : new THREE.BoxGeometry(P.w + 4, P.d + 4, 3), new THREE.MeshBasicMaterial({ color: dark ? 0x1f2226 : 0x2b2f34 }));
    edge.position.z = -1.6; plateG.add(edge);
    if (P.round) {
      // a delta's build volume: a cylinder (rings top and bottom, a few uprights)
      const pts = [], R0 = P.w / 2;
      for (const z of [0, P.h]) for (let i = 0; i < 96; i++) { const a = (i / 96) * Math.PI * 2, b = ((i + 1) / 96) * Math.PI * 2; pts.push(R0 * Math.cos(a), R0 * Math.sin(a), z, R0 * Math.cos(b), R0 * Math.sin(b), z); }
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; pts.push(R0 * Math.cos(a), R0 * Math.sin(a), 0, R0 * Math.cos(a), R0 * Math.sin(a), P.h); }
      const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      plateG.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: dark ? 0x7d8996 : 0x8e99a5, transparent: true, opacity: 0.45 })));
    } else {
      const box = new THREE.Box3(new THREE.Vector3(-P.w / 2, -P.d / 2, 0), new THREE.Vector3(P.w / 2, P.d / 2, P.h));
      const bh = new THREE.Box3Helper(box, dark ? 0x7d8996 : 0x8e99a5);
      bh.material.transparent = true; bh.material.opacity = 0.45;
      plateG.add(bh);
    }
    // dual-nozzle printers: the width both nozzles (or one) can actually reach
    const uw = usableWidth();
    if (uw < P.w) {
      const u = new THREE.Box3(new THREE.Vector3(-uw / 2, -P.d / 2, 0), new THREE.Vector3(uw / 2, P.d / 2, 0.05));
      const uh = new THREE.Box3Helper(u, 0x2f7de1);
      plateG.add(uh);
    }
  }
  function usableWidth() {
    const P = PRINTERS[st.printer], T = P.tools || {};
    if (!T.wSingle) return P.w;
    ensureSlots();
    const heads = new Set(usedSlots().map(headOf)).size;
    return heads > 1 ? T.wDual : T.wSingle;
  }

  // ------------------------------------------------------------ the parts on the plate
  function targetIds() {
    if (EXT.size) return [...EXT.keys()];
    const sel = app.sel.map((id) => findBody(store.doc, id)).filter((b) => b && !b.hole);
    const list = sel.length ? sel : store.doc.bodies.filter((b) => !b.hole && !b.hidden);
    return list.map((b) => b.id);
  }
  // ------------------------------------------------------------ objects on the plate (sim only)
  // every body on the plate is an object; copies made here are objects too. Each object has its
  // own placement X (turn, scale, move, made in the sim) applied after the plate turn st.R. None of
  // this is written to the design: the bodies keep their own shape and position.
  function syncInst() {
    st.inst = st.inst.filter((q) => st.ids.includes(q.id));
    for (const id of st.ids) if (!st.inst.some((q) => q.key === id)) st.inst.push({ key: id, id, X: new THREE.Matrix4(), home: new THREE.Matrix4(), s: 1 });
    // keep the design's order: each body, then its copies
    st.inst.sort((a, b) => st.ids.indexOf(a.id) - st.ids.indexOf(b.id) || (a.key === a.id ? -1 : b.key === b.id ? 1 : a.n - b.n));
    for (const k of [...st.osel]) if (!st.inst.some((q) => q.key === k)) st.osel.delete(k);
  }
  const instOf = (key) => st.inst.find((q) => q.key === key);
  const isCopy = (q) => q.key !== q.id;
  const instName = (q) => (bodyOf(q.id)?.name || "Body") + (isCopy(q) ? ` · copy ${q.n}` : "");
  const hasLayout = () => st.inst.some((q) => isCopy(q) || !isIdent(q.X));
  const isIdent = (m) => m.elements.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9);
  // world triangles of the objects after the sim placement, dropped on the plate and centred
  function buildWorld() {
    syncInst();
    const parts = [], t = new THREE.Vector3();
    // the design's own layout (no sim moves) sets the centre, so moving one object leaves the rest
    const box0 = new THREE.Box3();
    for (const q of st.inst) {
      const b = bodyOf(q.id), v = viewOf(q.id);
      if (!b || !v || !v.data) continue;
      const base = st.R.clone().multiply(M4(b.m));
      const M = q.X.clone().multiply(base), V = v.data.vertices, bk = new THREE.Box3();
      for (let i = 0; i < V.length; i += 3) bk.expandByPoint(t.set(V[i], V[i + 1], V[i + 2]).applyMatrix4(M));
      if (!isCopy(q)) {
        if (isIdent(q.X)) box0.union(bk);
        else for (let i = 0; i < V.length; i += 3) box0.expandByPoint(t.set(V[i], V[i + 1], V[i + 2]).applyMatrix4(base));
      }
      parts.push({ id: q.id, key: q.key, q, data: v.data, M, bk });
    }
    if (!parts.length) return null;
    // bodies that touch or overlap stay together as one object (like a multi-color model:
    // letters on a plate, a two-color part); each separate object rests on the plate.
    const grp = parts.map((_, i) => i);
    const find = (i) => (grp[i] === i ? i : (grp[i] = find(grp[i])));
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (parts[i].bk.clone().expandByScalar(0.05).intersectsBox(parts[j].bk)) grp[find(i)] = find(j);
    const low = new Map();
    parts.forEach((p, i) => { const g = find(i); low.set(g, Math.min(low.has(g) ? low.get(g) : Infinity, p.bk.min.z)); });
    const c = box0.isEmpty() ? parts[0].bk.getCenter(new THREE.Vector3()) : box0.getCenter(new THREE.Vector3());
    const box = new THREE.Box3();
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.dz = -low.get(find(i));
      p.g = find(i);
      p.wb = p.bk.clone().translate(new THREE.Vector3(-c.x, -c.y, p.dz));
      box.union(p.wb);
    }
    let nV = 0, nT = 0;
    for (const p of parts) { nV += p.data.vertices.length / 3; nT += p.data.triangles.length / 3; }
    const pos = new Float32Array(nV * 3), tri = new Uint32Array(nT * 3), owner = new Uint16Array(nT), tface = new Int32Array(nT);
    let ov = 0, ot = 0;
    const pose = new Map(), cpose = [];
    // per part: its first triangle, and its body -> plate matrix (and back), for the paint
    const tbase = new Int32Array(parts.length), mats = [], inv = [], scl = new Float64Array(parts.length);
    parts.forEach((p, k) => {
      const T = new THREE.Matrix4().makeTranslation(-c.x, -c.y, p.dz);
      const P = T.clone().multiply(p.q.X).multiply(st.R);
      if (isCopy(p.q)) cpose.push({ k, id: p.id, P }); else pose.set(p.id, P);
      const M = T.clone().multiply(p.M), V = p.data.vertices, Tr = p.data.triangles;
      const flip = M.determinant() < 0;
      tbase[k] = ot; mats.push(Float64Array.from(M.elements)); inv.push(Float64Array.from(M.clone().invert().elements)); scl[k] = Math.cbrt(Math.abs(M.determinant())) || 1;
      for (let i = 0; i < V.length; i += 3) { t.set(V[i], V[i + 1], V[i + 2]).applyMatrix4(M); pos[(ov + i / 3) * 3] = t.x; pos[(ov + i / 3) * 3 + 1] = t.y; pos[(ov + i / 3) * 3 + 2] = t.z; }
      // which CAD face each triangle belongs to (faces are what gets painted)
      const fOf = new Int32Array(Tr.length / 3).fill(-1);
      (p.data.faceGroups || []).forEach(([st0, cnt], fi) => { for (let q = st0 / 3; q < (st0 + cnt) / 3; q++) fOf[q] = fi; });
      for (let i = 0; i < Tr.length; i += 3) {
        tri[ot * 3] = Tr[i] + ov; tri[ot * 3 + 1] = (flip ? Tr[i + 2] : Tr[i + 1]) + ov; tri[ot * 3 + 2] = (flip ? Tr[i + 1] : Tr[i + 2]) + ov;
        owner[ot] = k; tface[ot] = fOf[i / 3]; ot++;
      }
      ov += V.length / 3;
    });
    const size = box.getSize(new THREE.Vector3());
    const vowner = new Uint16Array(nV);
    for (let t = 0; t < nT; t++) for (let e = 0; e < 3; e++) vowner[tri[t * 3 + e]] = owner[t];
    return {
      pos, tri, owner, tface, vowner, nParts: parts.length, ids: parts.map((p) => p.id), keys: parts.map((p) => p.key), group: parts.map((p) => p.g),
      wbox: parts.map((p) => p.wb), pre: parts.map((p) => p.bk), names: parts.map((p) => instName(p.q)), pose, cpose, size, box, nT, tbase, mats, inv, scl,
    };
  }

  // ------------------------------------------------------------ vertical-ray lookups
  function makeGrid(w) {
    const { pos, tri, nT } = w;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pos.length; i += 3) { x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]); }
    const cell = Math.max(1, Math.sqrt(((x1 - x0) * (y1 - y0)) / Math.max(1, nT)) * 2);
    const nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1), ny = Math.max(1, Math.ceil((y1 - y0) / cell) + 1);
    const buckets = Array.from({ length: nx * ny }, () => []);
    for (let t = 0; t < nT; t++) {
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      const i0 = Math.floor((Math.min(pos[a], pos[b], pos[c]) - x0) / cell), i1 = Math.floor((Math.max(pos[a], pos[b], pos[c]) - x0) / cell);
      const j0 = Math.floor((Math.min(pos[a + 1], pos[b + 1], pos[c + 1]) - y0) / cell), j1 = Math.floor((Math.max(pos[a + 1], pos[b + 1], pos[c + 1]) - y0) / cell);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * nx + i].push(t);
    }
    // every crossing of the vertical line at (x, y): {z, up (surface faces up), t}
    function hits(x, y) {
      const i = Math.floor((x - x0) / cell), j = Math.floor((y - y0) / cell);
      if (i < 0 || j < 0 || i >= nx || j >= ny) return [];
      const out = [];
      for (const t of buckets[j * nx + i]) {
        const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
        const ax = pos[a], ay = pos[a + 1], bx = pos[b], by = pos[b + 1], cx = pos[c], cy = pos[c + 1];
        const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(d) < 1e-12) continue;
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        out.push({ z: l1 * pos[a + 2] + l2 * pos[b + 2] + l3 * pos[c + 2], up: d > 0, t });
      }
      out.sort((p, q) => p.z - q.z);
      // drop duplicates where the line passes exactly through a shared edge
      return out.filter((h, k) => k === 0 || Math.abs(h.z - out[k - 1].z) > 1e-5 || h.up !== out[k - 1].up);
    }
    return { hits, x0, y0, x1, y1 };
  }

  // ------------------------------------------------------------ overhangs and supports
  function analyse() {
    const w = W, { pos, tri, nT } = w;
    const cosT = Math.cos((st.threshold * Math.PI) / 180);
    const over = new Uint8Array(nT), nrm = new Float32Array(nT * 3);
    let overArea = 0, bedArea = 0;
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    const grid = makeGrid(w);
    // an underside resting on another body (a part stacked on another) needs no support
    const restsOnPart = (t, a, b, c) => {
      const cx = (pos[a] + pos[b] + pos[c]) / 3, cy = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, cz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
      return grid.hits(cx, cy).some((h) => h.up && h.t !== t && w.owner[h.t] !== w.owner[t] && h.z <= cz + 0.05 && h.z >= cz - Math.max(0.3, st.layer));
    };
    for (let t = 0; t < nT; t++) {
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      e1.set(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
      e2.set(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]);
      n.crossVectors(e1, e2);
      const ar = n.length() / 2;
      if (ar < 1e-12) continue;
      n.normalize();
      nrm[t * 3] = n.x; nrm[t * 3 + 1] = n.y; nrm[t * 3 + 2] = n.z;
      const zmax = Math.max(pos[a + 2], pos[b + 2], pos[c + 2]);
      if (zmax < 0.05 && n.z < -0.98) { bedArea += ar; continue; }
      if (-n.z > cosT && Math.min(pos[a + 2], pos[b + 2], pos[c + 2]) > st.layer * 0.5 && !(w.nParts > 1 && restsOnPart(t, a, b, c))) { over[t] = 1; overArea += ar; }
    }
    // support columns: under every overhang, from the plate (or the part below) up to it
    const sp = st.supports === "tree" ? 3 : 2, zgap = st.layer;
    const cols = [];
    if (st.supports !== "none" && overArea > 0) {
      for (let y = grid.y0 + sp / 2; y <= grid.y1; y += sp) for (let x = grid.x0 + sp / 2; x <= grid.x1; x += sp) {
        const hs = grid.hits(x, y);
        let below = 0, inside = false;
        for (const h of hs) {
          if (!h.up) { // entering material from below: an underside
            if (!inside && over[h.t] && h.z - zgap - below > st.layer * 2 && (!st.plateOnly || below === 0)) cols.push({ x, y, z0: below, z1: h.z - zgap });
            inside = true;
          } else { inside = false; below = h.z; }
        }
      }
    }
    let supVol = 0;
    disposeGroup(supG);
    if (cols.length && st.supports === "normal") {
      const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: COL.support, transparent: true, opacity: 0.55, roughness: 0.8, depthWrite: false, clippingPlanes: [clip] }), cols.length);
      const m = new THREE.Matrix4();
      cols.forEach((c, i) => { const h = c.z1 - c.z0; m.makeScale(sp * 0.92, sp * 0.92, h).setPosition(c.x, c.y, c.z0); mesh.setMatrixAt(i, m); supVol += sp * sp * h * 0.15 + sp * sp * st.layer * 2 * 0.7; });
      supG.add(mesh);
    } else if (cols.length && st.supports === "tree") {
      supVol = buildTrees(cols, grid);
    }
    // the undersides that need support, in red
    disposeGroup(ovG);
    const op = [];
    for (let t = 0; t < nT; t++) if (over[t]) for (let k = 0; k < 3; k++) { const v = tri[t * 3 + k] * 3; op.push(pos[v], pos[v + 1], pos[v + 2] - 0.01); }
    if (op.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(op, 3));
      ovG.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: st.supports === "none" ? 0xff2d2d : 0xff7a2d, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthTest: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    }
    A = { over, nrm, overArea, bedArea, grid, cols, supVol };
    adviceCache = null;
    updateBanner();
  }
  // ------------------------------------------------------------ teaching: the big red warning
  // Anything hanging out more than the overhang limit (45° from upright by default) with supports
  // off would be printed in mid-air: the plastic droops, strings or the print fails.
  let banner = null;
  function updateBanner() {
    const need = !!(A && root.visible && st.supports === "none" && A.overArea > 1);
    if (!need) { if (banner) { banner.remove(); banner = null; } return; }
    if (!banner) {
      banner = el("div", { class: "ps-banner", id: "ps-banner", role: "alert" });
      document.getElementById("viewport").append(banner);
    }
    banner.innerHTML = "";
    banner.append(
      el("div", { class: "ps-banner-sign", "aria-hidden": "true" }, "⚠"),
      el("div", { class: "ps-banner-text" },
        el("b", {}, "Supports needed!"),
        el("span", {}, `${fmt(A.overArea, 0)} mm² of this part (shown in red) hangs out more than ${st.threshold}° with nothing under it. A printer can't print on air: those layers would droop, string or fail.`),
        el("span", { class: "ps-banner-fix" }, "Fix it: turn on Supports (Normal or Tree), or turn the part (Orientation advice) so less of it hangs out.")),
      el("div", { class: "ps-banner-btns" },
        el("button", { class: "btn", id: "ps-banner-tree", onclick: () => { st.supports = "tree"; rebuild(false); renderPanel(); } }, "Tree supports"),
        el("button", { class: "btn", id: "ps-banner-normal", onclick: () => { st.supports = "normal"; rebuild(false); renderPanel(); } }, "Normal supports")));
  }

  // ------------------------------------------------------------ teaching: orientation advice
  // Each way the part could lie (the six main directions and its biggest flat faces) is scored
  // for overhang, contact with the plate and height, then the best one for each goal is offered,
  // with why it helps and how to do it.
  let adviceCache = null;
  function orientMetrics(dn) {
    const { pos, tri, nT } = W;
    const q = new THREE.Quaternion().setFromUnitVectors(dn, new THREE.Vector3(0, 0, -1));
    const Rm = new THREE.Matrix4().makeRotationFromQuaternion(q);
    const nVtx = pos.length / 3, zs = new Float32Array(nVtx), v = new THREE.Vector3();
    const bb = new THREE.Box3();
    for (let i = 0; i < nVtx; i++) { v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(Rm); zs[i] = v.z; bb.expandByPoint(v); }
    const zmin = bb.min.z, cosT = Math.cos((st.threshold * Math.PI) / 180), nn = new THREE.Vector3();
    let over = 0, bed = 0;
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let t = 0; t < nT; t++) {
      nn.set(A.nrm[t * 3], A.nrm[t * 3 + 1], A.nrm[t * 3 + 2]).applyQuaternion(q);
      const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
      e1.set(pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]);
      e2.set(pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]);
      const ar = e1.cross(e2).length() / 2;
      const hi = Math.max(zs[a], zs[b], zs[c]) - zmin;
      if (hi < 0.05 && nn.z < -0.98) bed += ar;
      else if (-nn.z > cosT && Math.min(zs[a], zs[b], zs[c]) - zmin > st.layer * 0.5) over += ar;
    }
    const size = bb.getSize(new THREE.Vector3());
    return { dn, Rm, over, bed, h: size.z, w: Math.max(size.x, size.y), d: Math.min(size.x, size.y) };
  }
  function advice() {
    if (!W || !A) return null;
    if (adviceCache) return adviceCache;
    const { pos, tri, nT } = W;
    const cand = [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)];
    const byN = new Map();
    for (let t = 0; t < nT; t++) {
      const nx = A.nrm[t * 3], ny = A.nrm[t * 3 + 1], nz = A.nrm[t * 3 + 2];
      const key = `${Math.round(nx * 50)},${Math.round(ny * 50)},${Math.round(nz * 50)}`;
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      const ar = new THREE.Vector3(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]).cross(new THREE.Vector3(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2])).length() / 2;
      const e = byN.get(key) || { n: new THREE.Vector3(nx, ny, nz), a: 0 };
      e.a += ar; byN.set(key, e);
    }
    [...byN.values()].sort((p, q) => q.a - p.a).slice(0, 6).forEach((e) => { const n = e.n.clone().normalize(); if (!cand.some((c) => c.dot(n) > 0.999)) cand.push(n); });
    if (nT > 400000) cand.length = 6; // very big meshes: the main directions only
    const all = cand.map(orientMetrics);
    const cur = all[0];
    const tol = (x) => Math.max(2, x * 0.05);
    const leastSup = all.reduce((b, m) => (m.over < b.over - tol(b.over) || (Math.abs(m.over - b.over) <= tol(b.over) && m.bed > b.bed) ? m : b));
    // strongest: the long side lies flat (lowest height), among ways that touch the plate well
    const okBed = all.filter((m) => m.bed >= 0.25 * Math.max(...all.map((x) => x.bed)) || m.bed > 50);
    const strong = (okBed.length ? okBed : all).reduce((b, m) => (m.h < b.h - 0.5 || (Math.abs(m.h - b.h) <= 0.5 && m.over < b.over) ? m : b));
    const stable = all.reduce((b, m) => (m.bed > b.bed * 1.05 || (m.bed >= b.bed * 0.95 && m.over < b.over) ? m : b));
    adviceCache = { all, cur, leastSup, strong, stable };
    return adviceCache;
  }
  function useOrient(m) { st.R.premultiply(m.Rm); st.refit = true; rebuild(); app.toast("Turned. Check the red overhangs and the Strength view."); }
  function adviceBox() {
    const a = advice();
    if (!a) return null;
    const fil = FILAMENTS[st.filament];
    const zPct = Math.round((fil.z / fil.xy) * 100);
    const same = (m) => m.dn.dot(new THREE.Vector3(0, 0, -1)) > 0.999;
    const card = (cls, title, m, why, how, metric) => el("div", { class: "psadv " + cls },
      el("div", { class: "psadv-h" }, el("b", {}, title), same(m) ? el("span", { class: "psadv-now" }, "✓ This is how it lies now") : el("button", { class: "btn", onclick: () => useOrient(m) }, "Use this")),
      el("div", { class: "psadv-m" }, metric),
      el("div", {}, el("b", {}, "Why: "), why),
      el("div", {}, el("b", {}, "How: "), how));
    const box = el("div", { class: "psadvice", id: "ps-advice" }, el("div", { class: "subhead" }, "Orientation advice"));
    // the part as it lies now: a quick read on its strength direction
    const c = a.cur;
    if (c.h > 2.2 * Math.max(1, c.d) && c.h > 25) box.append(el("div", { class: "psn warn" }, `Tall and thin as it lies now (${fmt(c.h, 0)} mm tall, ${fmt(c.d, 0)} mm thick): its layers stack up through the thin direction, so a push from the side can snap it between two layers. Lay it down if it has to take a load.`));
    box.append(card("strong", "Strongest", a.strong,
      `A printer builds in layers, and layers stick to each other only about ${zPct}% as well as the plastic holds together along a layer (${fil.name}). With the long side lying flat, the lines of plastic run the whole length of the part, so bending it means snapping those lines instead of peeling layers apart.`,
      "Lay the longest side on the plate (Use this, or Lay on face and click that side). Hooks, clips, handles and arms should lie flat so their curves are drawn inside each layer.",
      `${fmt(a.strong.h, 0)} mm tall · ${fmt(a.strong.over, 0)} mm² overhang`));
    if (a.leastSup !== a.strong) box.append(card("sup", "Least support", a.leastSup,
      "Every overhang needs support plastic under it that you break off afterwards: it costs filament and time and leaves rough marks where it touched.",
      "Put the biggest flat face down and avoid big surfaces hanging over air. Slopes steeper than 45° from upright print fine without support.",
      `${fmt(a.leastSup.over, 0)} mm² overhang · ${fmt(a.leastSup.h, 0)} mm tall`));
    if (a.stable !== a.strong && a.stable !== a.leastSup) box.append(card("stable", "Best grip on the plate", a.stable,
      "The first layer holds the whole print down. More contact means it won't come loose or warp at the corners, and the bottom comes out flat.",
      "Put the largest flat face on the plate. For a small footprint, add a brim in your slicer.",
      `${fmt(a.stable.bed, 0)} mm² on the plate · ${fmt(a.stable.over, 0)} mm² overhang`));
    box.append(el("div", { class: "hint", style: { padding: 0 } }, "Switch Show to Strength to see the weak layers in this orientation. The best choice depends on how the part is used: strength for things that bend or carry weight, least support for display pieces."));
    return box;
  }
  // tree supports: branches start under each overhang point and lean together as they go
  // down, merging into trunks that stand on the plate (or land on the part)
  function buildTrees(cols, grid) {
    const dz = 1.5, lean = Math.tan((40 * Math.PI) / 180) * dz;
    // keep it quick on big parts: thin out the contact points
    const stepK = Math.max(1, Math.ceil(cols.length / 1200));
    let nodes = cols.filter((_, i) => i % stepK === 0).map((c) => ({ x: c.x, y: c.y, z: c.z1, n: 1, floor: c.z0, alive: true }));
    const segs = [];
    let zTop = Math.max(...nodes.map((q) => q.z));
    const insideAt = (x, y, z) => { let inside = false; for (const h of grid.hits(x, y)) { if (h.z > z) break; inside = !h.up; } return inside; };
    const floorAt = (x, y, z) => { let f = 0; for (const h of grid.hits(x, y)) { if (h.z > z) break; if (h.up) f = h.z; } return f; };
    for (let z = zTop - dz; z > -dz; z -= dz) {
      const zz = Math.max(0, z);
      const act = nodes.filter((q) => q.alive && q.z > zz + 1e-9);
      for (const q of act) {
        // pull toward the weighted middle of nearby branches
        let sx = 0, sy = 0, sw = 0;
        for (const o of act) { const d = Math.hypot(o.x - q.x, o.y - q.y); if (d < 12) { sx += o.x * o.n; sy += o.y * o.n; sw += o.n; } }
        let tx = sx / sw - q.x, ty = sy / sw - q.y;
        const L = Math.hypot(tx, ty), mv = Math.min(L, lean);
        let nx = q.x + (L > 1e-9 ? (tx / L) * mv : 0), ny = q.y + (L > 1e-9 ? (ty / L) * mv : 0);
        if (insideAt(nx, ny, zz) || (st.plateOnly && floorAt(nx, ny, zz) > 0)) { nx = q.x; ny = q.y; }
        const fl = st.plateOnly ? 0 : floorAt(nx, ny, q.z);
        const nz = Math.max(zz, fl);
        segs.push([q.x, q.y, q.z, nx, ny, nz, rad(q.n)]);
        q.x = nx; q.y = ny; q.z = nz;
        if (nz <= fl + 1e-6) q.alive = false; // landed
      }
      // merge branches that touch
      const live = nodes.filter((q) => q.alive);
      for (let i = 0; i < live.length; i++) {
        const a = live[i];
        if (!a.alive) continue;
        for (let k = i + 1; k < live.length; k++) {
          const b = live[k];
          if (!b.alive || Math.abs(a.z - b.z) > 1e-6) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) < (rad(a.n) + rad(b.n)) * 0.9) {
            a.x = (a.x * a.n + b.x * b.n) / (a.n + b.n); a.y = (a.y * a.n + b.y * b.n) / (a.n + b.n); a.n += b.n; b.alive = false;
          }
        }
      }
      if (!nodes.some((q) => q.alive)) break;
    }
    function rad(n) { return Math.min(4, 0.6 + 0.22 * Math.sqrt(n)); }
    let vol = 0;
    if (segs.length) {
      const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: COL.support, roughness: 0.7, clippingPlanes: [clip] }), segs.length);
      const m = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 0, 1), s = new THREE.Vector3();
      segs.forEach(([x0, y0, z0, x1, y1, z1, r], i) => {
        a.set(x1, y1, z1); b.set(x0 - x1, y0 - y1, z0 - z1);
        const L = b.length() || 1e-3;
        q.setFromUnitVectors(up, b.clone().normalize());
        m.compose(a, q, s.set(r, r, L + r * 0.3));
        mesh.setMatrixAt(i, m);
        vol += Math.PI * r * r * L;
      });
      supG.add(mesh);
    }
    return vol;
  }

  // ------------------------------------------------------------ slicing (done in steps)
  function slice() {
    const job = ++sliceJob;
    const w = W, { pos, tri, nT } = w;
    // spiral vase (Orca's Special mode): one wall, no infill, no top
    const SW = st.spiral ? 1 : st.walls, STN = st.spiral ? 0 : st.topN, SI = st.spiral ? 0 : st.infill;
    const lh = st.layer, H = w.size.z, nL = Math.max(1, Math.ceil(H / lh - 1e-6));
    const order = Array.from({ length: nT }, (_, t) => t);
    const zmin = new Float32Array(nT), zmax = new Float32Array(nT);
    for (let t = 0; t < nT; t++) { const a = pos[tri[t * 3] * 3 + 2], b = pos[tri[t * 3 + 1] * 3 + 2], c = pos[tri[t * 3 + 2] * 3 + 2]; zmin[t] = Math.min(a, b, c); zmax[t] = Math.max(a, b, c); }
    order.sort((p, q) => zmin[p] - zmin[q]);
    // raster for skins, areas and thin walls
    const g = A.grid, cell = Math.max(0.5, Math.min(1, Math.sqrt(((g.x1 - g.x0) * (g.y1 - g.y0)) / 40000)));
    const rx0 = g.x0 - cell, ry0 = g.y0 - cell, RW = Math.ceil((g.x1 - g.x0) / cell) + 3, RH = Math.ceil((g.y1 - g.y0) / cell) + 3;
    const occ = []; // per layer Uint8Array RW*RH
    const segsL = [], ownL = [], triL = []; // contour segments of each layer, the part and the triangle each came from
    let ptr = 0, active = [];
    const areaO = Array.from({ length: w.nParts }, () => new Float32Array(nL)); // cross-section of each part
    const res = { nL, lh, areaO, layers: [], area: new Float32Array(nL), thin: [], len: { outer: 0, inner: 0, sparse: 0, solid: 0, top: 0, bottom: 0, bridge: 0 } };
    S = null;
    const status = (t) => { const e = document.getElementById("ps-status"); if (e) e.textContent = t; };
    let k = 0;
    // pass 1: contours and occupancy
    const pass1 = () => {
      if (job !== sliceJob) return;
      const until = performance.now() + 30;
      for (; k < nL && performance.now() < until; k++) {
        const z = (k + 0.5) * lh;
        while (ptr < nT && zmin[order[ptr]] <= z) active.push(order[ptr++]);
        active = active.filter((t) => zmax[t] >= z);
        const sg = [], so = [], stri = [];
        for (const t of active) {
          const P = [tri[t * 3] * 3, tri[t * 3 + 1] * 3, tri[t * 3 + 2] * 3], q = [];
          for (let e = 0; e < 3; e++) {
            const a = P[e], b = P[(e + 1) % 3];
            const za = pos[a + 2] - z + 1e-7, zb = pos[b + 2] - z + 1e-7;
            if ((za < 0) !== (zb < 0)) { const f = za / (za - zb); q.push(pos[a] + (pos[b] - pos[a]) * f, pos[a + 1] + (pos[b + 1] - pos[a + 1]) * f); }
          }
          if (q.length === 4) {
            // point the segment so the material is on its left; then the shoelace sum is the area
            const nx = A.nrm[t * 3], ny = A.nrm[t * 3 + 1];
            if ((q[2] - q[0]) * -ny + (q[3] - q[1]) * nx < 0) { const a0 = q[0], a1 = q[1]; q[0] = q[2]; q[1] = q[3]; q[2] = a0; q[3] = a1; }
            sg.push(q[0], q[1], q[2], q[3]);
            so.push(w.owner[t]); stri.push(t);
          }
        }
        // occupancy by rows, filled by winding (nonzero), like Orca: shells that overlap inside one
        // part are joined into one solid instead of cancelling out
        const o = new Uint8Array(RW * RH);
        let cnt = 0, overlap = false;
        for (let j = 0; j < RH; j++) {
          const y = ry0 + (j + 0.5) * cell, xs = [];
          for (let i = 0; i < sg.length; i += 4) { const y1 = sg[i + 1], y2 = sg[i + 3]; if ((y1 <= y) !== (y2 <= y)) xs.push([sg[i] + ((y - y1) / (y2 - y1)) * (sg[i + 2] - sg[i]), y2 > y1 ? 1 : -1]); }
          xs.sort((p, q) => p[0] - q[0]);
          let wn = 0;
          for (let m = 0; m + 1 < xs.length; m++) {
            wn += xs[m][1];
            if (Math.abs(wn) > 1) overlap = true;
            if (!wn) continue;
            const i0 = Math.max(0, Math.ceil((xs[m][0] - rx0) / cell - 0.5)), i1 = Math.min(RW - 1, Math.floor((xs[m + 1][0] - rx0) / cell - 0.5));
            for (let i = i0; i <= i1; i++) { if (!o[j * RW + i]) cnt++; o[j * RW + i] = 1; }
          }
        }
        if (overlap) {
          // keep only the outline of the joined shape: drop each piece of contour with material on
          // both sides (its outer side is inside another shell)
          const NB = 64, n = sg.length / 4;
          let y0 = Infinity, y1 = -Infinity;
          for (let i = 0; i < sg.length; i += 2) { y0 = Math.min(y0, sg[i + 1]); y1 = Math.max(y1, sg[i + 1]); }
          const bh = (y1 - y0) / NB || 1, B = Array.from({ length: NB }, () => []);
          for (let i = 0; i < n; i++) { const a = Math.min(sg[i * 4 + 1], sg[i * 4 + 3]), b = Math.max(sg[i * 4 + 1], sg[i * 4 + 3]); for (let q = Math.max(0, Math.floor((a - y0) / bh)); q <= Math.min(NB - 1, Math.floor((b - y0) / bh)); q++) B[q].push(i); }
          const wind = (px, py) => { let w2 = 0; const L = B[Math.max(0, Math.min(NB - 1, Math.floor((py - y0) / bh)))]; for (const i of L) { const ya = sg[i * 4 + 1], yb = sg[i * 4 + 3]; if ((ya <= py) !== (yb <= py)) { const x = sg[i * 4] + ((py - ya) / (yb - ya)) * (sg[i * 4 + 2] - sg[i * 4]); if (x > px) w2 += yb > ya ? 1 : -1; } } return w2; };
          // split every segment where it crosses another (the crossing point is worked out once per
          // pair, so both pieces end at exactly the same point and the outline chains up), then keep
          // the pieces with nothing on their outer side
          const X = new Map(), cuts = Array.from({ length: n }, () => []);
          for (let q = 0; q < NB; q++) {
            const L = B[q];
            for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) {
              const i = Math.min(L[a], L[b]), j = Math.max(L[a], L[b]), kk = i * n + j;
              if (X.has(kk)) continue;
              const ax = sg[i * 4], ay = sg[i * 4 + 1], rx = sg[i * 4 + 2] - ax, ry = sg[i * 4 + 3] - ay;
              const bx = sg[j * 4], by = sg[j * 4 + 1], sx = sg[j * 4 + 2] - bx, sy = sg[j * 4 + 3] - by;
              const den = rx * sy - ry * sx;
              if (Math.abs(den) < 1e-12) {
                // parallel: if they lie on one line and overlap, each is cut where the other ends
                X.set(kk, null);
                const rl = Math.hypot(rx, ry) || 1;
                if (Math.abs((bx - ax) * ry - (by - ay) * rx) / rl > 1e-6) continue;
                const sl = Math.hypot(sx, sy) || 1;
                for (const [qx, qy] of [[bx, by], [bx + sx, by + sy]]) { const t = ((qx - ax) * rx + (qy - ay) * ry) / (rl * rl); if (t > 1e-6 && t < 1 - 1e-6) cuts[i].push([t, [qx, qy]]); }
                for (const [qx, qy] of [[ax, ay], [ax + rx, ay + ry]]) { const u = ((qx - bx) * sx + (qy - by) * sy) / (sl * sl); if (u > 1e-6 && u < 1 - 1e-6) cuts[j].push([u, [qx, qy]]); }
                continue;
              }
              const t = ((bx - ax) * sy - (by - ay) * sx) / den, u = ((bx - ax) * ry - (by - ay) * rx) / den;
              if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) { X.set(kk, null); continue; }
              const P = [ax + rx * t, ay + ry * t]; X.set(kk, P);
              cuts[i].push([t, P]); cuts[j].push([u, P]);
            }
          }
          const sg2 = [], so2 = [], st2 = [], seen = new Set();
          for (let i = 0; i < n; i++) {
            const pts = [[0, [sg[i * 4], sg[i * 4 + 1]]], ...cuts[i].sort((p, q) => p[0] - q[0]), [1, [sg[i * 4 + 2], sg[i * 4 + 3]]]];
            for (let m = 0; m + 1 < pts.length; m++) {
              const [ax, ay] = pts[m][1], [bx, by] = pts[m + 1][1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
              if (L < 1e-9) continue;
              const e = 0.005 / L;
              if (wind((ax + bx) / 2 + dy * e, (ay + by) / 2 - dx * e) !== 0) continue;
              // (two shells sharing a face give the same piece twice: keep one)
              const key = `${Math.round(ax * 1e4)},${Math.round(ay * 1e4)},${Math.round(bx * 1e4)},${Math.round(by * 1e4)}`;
              if (seen.has(key)) continue;
              seen.add(key);
              sg2.push(ax, ay, bx, by); so2.push(so[i]); st2.push(stri[i]);
            }
          }
          sg.length = 0; sg.push(...sg2); so.length = 0; so.push(...so2); stri.length = 0; stri.push(...st2);
        }
        for (let i = 0; i < sg.length; i += 4) areaO[so[i / 4]][k] += (sg[i] * sg[i + 3] - sg[i + 2] * sg[i + 1]) / 2;
        segsL.push(sg); ownL.push(so); triL.push(stri);
        occ.push(o);
        res.area[k] = cnt * cell * cell;
      }
      status(`Slicing… ${Math.round((k / nL) * 50)}%`);
      if (k < nL) { setTimeout(pass1, 0); return; }
      k = 0; setTimeout(pass2, 0);
    };
    // pass 2: walls, infill and skins as toolpath lines
    const lines = [], cols = [], layerEnd = [], lown = [], ltri = [], lkind = [];
    const C = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
    const CC = Object.fromEntries(Object.entries(COL).map(([key, v]) => [key, C(v)]));
    // every line also gets the time it takes to print, for the print animation
    const flow = FLOW[st.filament] || 12, sec = LW * lh;
    const cum = [];
    let tNow = 0;
    // own: the part; tri: the surface triangle the line sits against (walls and skins), so a
    // painted face changes the filament of the lines behind it
    const push = (x0, y0, x1, y1, z, kind, own = 0, tri = -1) => {
      lines.push(x0, y0, z, x1, y1, z); const c = CC[kind]; cols.push(...c, ...c); lown.push(own); ltri.push(tri); lkind.push(GK.indexOf(kind));
      const len = Math.hypot(x1 - x0, y1 - y0);
      res.len[kind] += len;
      tNow += len / Math.min(SPEEDS[kind] || 200, flow / sec); // rough; retime() replaces it
      cum.push(tNow);
    };
    const thinCells = new Set();
    const thinEvery = Math.max(1, Math.round(0.6 / lh));
    // fine raster of one layer, distance to the edge, and the parts thinner than two lines
    const fc = Math.min(0.35, Math.max(0.15, Math.max(g.x1 - g.x0, g.y1 - g.y0) / 260));
    const FW = Math.ceil((g.x1 - g.x0) / fc) + 4, FH = Math.ceil((g.y1 - g.y0) / fc) + 4, fx0 = g.x0 - 2 * fc, fy0 = g.y0 - 2 * fc;
    const fm = new Uint8Array(FW * FH), d1 = new Float32Array(FW * FH), d2 = new Float32Array(FW * FH);
    const BIG = 1e9, R2 = Math.SQRT2;
    const dt = (D) => {
      for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
        const c = j * FW + i; let v = D[c];
        if (v === 0) continue;
        if (i > 0) v = Math.min(v, D[c - 1] + 1);
        if (j > 0) { v = Math.min(v, D[c - FW] + 1); if (i > 0) v = Math.min(v, D[c - FW - 1] + R2); if (i < FW - 1) v = Math.min(v, D[c - FW + 1] + R2); }
        D[c] = v;
      }
      for (let j = FH - 1; j >= 0; j--) for (let i = FW - 1; i >= 0; i--) {
        const c = j * FW + i; let v = D[c];
        if (v === 0) continue;
        if (i < FW - 1) v = Math.min(v, D[c + 1] + 1);
        if (j < FH - 1) { v = Math.min(v, D[c + FW] + 1); if (i < FW - 1) v = Math.min(v, D[c + FW + 1] + R2); if (i > 0) v = Math.min(v, D[c + FW - 1] + R2); }
        D[c] = v;
      }
    };
    function thinCheck(sg, k) {
      fm.fill(0);
      for (let j = 0; j < FH; j++) {
        const y = fy0 + (j + 0.5) * fc, xs = [];
        for (let i = 0; i < sg.length; i += 4) { const y1 = sg[i + 1], y2 = sg[i + 3]; if ((y1 <= y) !== (y2 <= y)) xs.push(sg[i] + ((y - y1) / (y2 - y1)) * (sg[i + 2] - sg[i])); }
        xs.sort((p, q) => p - q);
        for (let m = 0; m + 1 < xs.length; m += 2) {
          const i0 = Math.max(0, Math.ceil((xs[m] - fx0) / fc - 0.5)), i1 = Math.min(FW - 1, Math.floor((xs[m + 1] - fx0) / fc - 0.5));
          for (let i = i0; i <= i1; i++) fm[j * FW + i] = 1;
        }
      }
      for (let c = 0; c < fm.length; c++) d1[c] = fm[c] ? BIG : 0;
      dt(d1);
      const deep = LW / fc; // half of the narrowest printable width (two lines), in cells
      for (let c = 0; c < fm.length; c++) d2[c] = fm[c] && d1[c] >= deep ? 0 : BIG;
      dt(d2);
      for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
        const c = j * FW + i;
        if (fm[c] && d2[c] > deep + 1.5) thinCells.add(`${k}|${Math.round((fx0 + (i + 0.5) * fc) / 1.5)}|${Math.round((fy0 + (j + 0.5) * fc) / 1.5)}`);
      }
    }
    // the top (or bottom) surface right above (below) a skin line, within the skin's depth
    const skinTri = (x, y, z, kind) => {
      if (kind === "sparse") return -1;
      const up = kind === "top" || kind === "solid", down = kind === "bottom" || kind === "bridge" || kind === "solid";
      let best = -1, bd = Infinity;
      for (const h of g.hits(x, y)) {
        if (up && h.up && h.z >= z - lh && h.z - z <= (STN + 1) * lh && h.z - z < bd) { bd = h.z - z; best = h.t; }
        if (down && !h.up && h.z <= z && z - h.z <= (st.botN + 1) * lh && z - h.z < bd) { bd = z - h.z; best = h.t; }
      }
      return best;
    };
    const pass2 = () => {
      if (job !== sliceJob) return;
      const until = performance.now() + 30;
      for (; k < nL && performance.now() < until; k++) {
        const z = (k + 1) * lh, sg = segsL[k], so = ownL[k], sT = triL[k], o = occ[k];
        const at = (L, i, j) => (L && i >= 0 && j >= 0 && i < RW && j < RH ? L[j * RW + i] : 0);
        // walls: the contour, plus inner walls as inward offsets of each loop
        const loops = chain(sg, so, sT);
        for (const lp of loops) {
          for (let i = 0; i < lp.length; i++) { const a = lp[i], b = lp[(i + 1) % lp.length]; push(a[0], a[1], b[0], b[1], z, "outer", lp.own, lp.tri[i]); }
          const inward = inwardSign(lp, sg);
          for (let wi = 1; wi < SW; wi++) {
            const off = offsetLoop(lp, wi * LW * inward);
            if (!off) break;
            for (let i = 0; i < off.length; i++) { const a = off[i], b = off[(i + 1) % off.length]; push(a[0], a[1], b[0], b[1], z, "inner", lp.own, off.length === lp.length ? lp.tri[i] : -1); }
          }
        }
        // skin map for this layer: which cells need solid fill (near the top or bottom)
        const sk = new Uint8Array(RW * RH); // 0 sparse, 1 solid, 2 top, 3 bottom, 4 bridge
        let anySkin = false;
        for (let c = 0; c < RW * RH; c++) {
          if (!o[c]) continue;
          let top = false, bot = k < st.botN;
          for (let d = 1; d <= STN; d++) { const L = occ[k + d]; if (!L || !L[c]) { top = true; break; } }
          if (!bot) for (let d = 1; d <= st.botN; d++) { const L = occ[k - d]; if (!L || !L[c]) { bot = true; break; } }
          if (!top && !bot) continue;
          anySkin = true;
          sk[c] = top && !(occ[k + 1] && occ[k + 1][c]) ? 2 : bot && k === 0 ? 3 : bot && !(occ[k - 1] && occ[k - 1][c]) ? 4 : 1;
        }
        const KIND = [null, "solid", "top", "bottom", "bridge"];
        const skinType = (x, y) => { const i = Math.floor((x - rx0) / cell), j = Math.floor((y - ry0) / cell); return i >= 0 && j >= 0 && i < RW && j < RH ? KIND[sk[j * RW + i]] : null; };
        // infill: solid skins are scan lines at ±45°, alternating each layer; sparse infill
        // follows the chosen pattern (Orca Slicer 2.5's sparse_infill_pattern): the pattern's
        // directions on this layer, each set of lines spaced so the density stays the same
        const inset = SW * LW;
        const sparseStep = SI > 0 ? LW / (SI / 100) : Infinity;
        const base = LW;
        const skinAng = k % 2 ? Math.PI / 4 : -Math.PI / 4;
        const sAngs = sparseAngles(k);
        const passes = [{ ang: skinAng, skins: true, sparse: sAngs.length === 1 && Math.abs(sAngs[0] - skinAng) < 1e-9, mul: 1 }];
        if (!passes[0].sparse) for (const a of sAngs) passes.push({ ang: a, skins: false, sparse: true, mul: sAngs.length });
        for (const pass of passes) {
        if (!pass.skins && !isFinite(sparseStep)) continue;
        if (pass.skins && !anySkin && !pass.sparse) continue;
        const ang = pass.ang, ca = Math.cos(ang), sa = Math.sin(ang);
        const every = isFinite(sparseStep) ? Math.max(1, Math.round((sparseStep * pass.mul) / base)) : Infinity;
        const rs = new Float32Array(sg.length);
        let vmin = Infinity, vmax = -Infinity;
        for (let i = 0; i < sg.length; i += 2) { const x = sg[i], y = sg[i + 1]; rs[i] = x * ca + y * sa; rs[i + 1] = -x * sa + y * ca; vmin = Math.min(vmin, rs[i + 1]); vmax = Math.max(vmax, rs[i + 1]); }
        let li = 0;
        for (let v = Math.ceil(vmin / base) * base; v <= vmax; v += base, li++) {
          const sparseLine = pass.sparse && isFinite(every) && li % every === 0;
          if (!pass.skins && !sparseLine) continue;
          if (!anySkin && !sparseLine) continue;
          const us = [], uo = [];
          for (let i = 0; i < rs.length; i += 4) { const v1 = rs[i + 1], v2 = rs[i + 3]; if ((v1 <= v) !== (v2 <= v)) { us.push(rs[i] + ((v - v1) / (v2 - v1)) * (rs[i + 2] - rs[i])); uo.push(so[i / 4]); } }
          // sort the crossings, keeping each one's part (a fill run belongs to the part it enters)
          const ord = us.map((_, i) => i).sort((p, q) => us[p] - us[q]);
          const usS = ord.map((i) => us[i]), uoS = ord.map((i) => uo[i]);
          for (let m = 0; m + 1 < usS.length; m += 2) {
            const u0 = usS[m] + inset, u1 = usS[m + 1] - inset, own = uoS[m];
            if (u1 - u0 < LW * 0.5) continue;
            if (!anySkin) { push(u0 * ca - v * sa, u0 * sa + v * ca, u1 * ca - v * sa, u1 * sa + v * ca, z, "sparse", own); continue; }
            // walk the line, splitting where the fill type changes
            let runStart = u0, runType;
            const flush = (uEnd) => {
              if (runType === undefined || uEnd - runStart < LW * 0.3) return;
              const kind = runType || "sparse";
              if (kind === "sparse" && !sparseLine) return;
              if (kind !== "sparse" && !pass.skins) return;
              push(runStart * ca - v * sa, runStart * sa + v * ca, uEnd * ca - v * sa, uEnd * sa + v * ca, z, kind, own, skinTri(((runStart + uEnd) / 2) * ca - v * sa, ((runStart + uEnd) / 2) * sa + v * ca, z, kind));
            };
            for (let u = u0; u <= u1 + 1e-9; u += cell * 0.7) {
              const uu = Math.min(u, u1), t = skinType(uu * ca - v * sa, uu * sa + v * ca);
              if (t !== runType) { flush(uu); runStart = uu; runType = t; }
            }
            flush(u1);
          }
        }
        }
        // thin walls: material that a pair of lines can't fill (checked every few layers)
        if (k % thinEvery === 0) thinCheck(sg, k);
        layerEnd.push(lines.length / 3);
      }
      status(`Slicing… ${50 + Math.round((k / nL) * 50)}%`);
      if (k < nL) { setTimeout(pass2, 0); return; }
      res.lines = new Float32Array(lines); res.cols = new Float32Array(cols); res.layerEnd = layerEnd; res.lown = new Uint16Array(lown); res.ltri = new Int32Array(ltri); res.lkind = new Uint8Array(lkind);
      res.cum = new Float64Array(cum); res.total = tNow; res.printTotal = tNow;
      // the slicer's own order; reordered by filament (and tool-change pauses added) per plan
      res.base = { lines: res.lines, cols: res.cols, lown: res.lown, ltri: res.ltri, lkind: res.lkind, cum: res.cum, layerEnd: layerEnd.slice(), total: tNow };
      res.thin = [...thinCells].map((s) => s.split("|").map(Number)).map(([kk, i, j]) => [i * 1.5, j * 1.5, (kk + 0.5) * lh]);
      res.cell = cell;
      res.segs = segsL;
      res.thinLayers = new Set([...thinCells].map((q) => q.split("|")[0])).size;
      res.thinHeight = res.thinLayers * thinEvery * lh;
      S = res;
      finishSlice();
    };
    status("Slicing… 0%");
    setTimeout(pass1, 0);
  }
  // join slice segments end to end into closed loops
  function chain(sg, so, sT) {
    const key = (x, y) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
    const starts = new Map();
    const n = sg.length / 4, used = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const kk = key(sg[i * 4], sg[i * 4 + 1]); if (!starts.has(kk)) starts.set(kk, []); starts.get(kk).push(i); }
    const loops = [];
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const lp = [];
      lp.own = so ? so[i] : 0;
      lp.tri = [];
      let cur = i;
      while (cur !== undefined && !used[cur]) {
        used[cur] = 1;
        lp.push([sg[cur * 4], sg[cur * 4 + 1]]);
        lp.tri.push(sT ? sT[cur] : -1);
        const nxt = (starts.get(key(sg[cur * 4 + 2], sg[cur * 4 + 3])) || []).find((j) => !used[j]);
        cur = nxt;
      }
      if (lp.length >= 3) loops.push(lp);
    }
    return loops;
  }
  // which way is "into the material" from a loop: test a point just to the left of an edge
  function inwardSign(lp, sg) {
    const a = lp[0], b = lp[1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const px = (a[0] + b[0]) / 2 - (dy / L) * 0.02, py = (a[1] + b[1]) / 2 + (dx / L) * 0.02;
    let c = 0;
    for (let i = 0; i < sg.length; i += 4) { const y1 = sg[i + 1], y2 = sg[i + 3]; if ((y1 <= py) !== (y2 <= py)) { const x = sg[i] + ((py - y1) / (y2 - y1)) * (sg[i + 2] - sg[i]); if (x > px) c++; } }
    return c % 2 ? 1 : -1; // +1: material on the left
  }
  function loopArea(lp) { let s = 0; for (let i = 0; i < lp.length; i++) { const a = lp[i], b = lp[(i + 1) % lp.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
  // offset a loop to the left by d (negative = right); null when it collapses
  function offsetLoop(lp, d) {
    const n = lp.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = lp[(i - 1 + n) % n], c = lp[i], q = lp[(i + 1) % n];
      let ax = c[0] - p[0], ay = c[1] - p[1], bx = q[0] - c[0], by = q[1] - c[1];
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      ax /= la; ay /= la; bx /= lb; by /= lb;
      const n1x = -ay, n1y = ax, n2x = -by, n2y = bx;
      let mx = n1x + n2x, my = n1y + n2y;
      const ml = Math.hypot(mx, my);
      if (ml < 1e-6) { mx = n1x; my = n1y; } else { mx /= ml; my /= ml; }
      const cosh = Math.max(0.35, mx * n1x + my * n1y);
      out.push([c[0] + (mx * d) / cosh, c[1] + (my * d) / cosh]);
    }
    const a0 = loopArea(lp), a1 = loopArea(out);
    if (Math.sign(a0) !== Math.sign(a1) || Math.abs(a1) < LW * LW) return null;
    // an inward offset must shrink a loop (and an outward one grow it)
    if ((d > 0) === (a0 > 0) ? Math.abs(a1) > Math.abs(a0) : Math.abs(a1) < Math.abs(a0)) return null;
    return out;
  }

  // ------------------------------------------------------------ filaments and tools (multi-material)
  // every body on the plate gets a filament slot; bodies of the same color share one
  function ensureSlots() {
    for (const id of st.ids) {
      if (st.slotOf.has(id) && st.slots[st.slotOf.get(id)]) continue;
      const c = (bodyOf(id)?.color || "#a7b0ba").toLowerCase();
      let i = st.slots.findIndex((q) => q.color.toLowerCase() === c);
      if (i < 0) { st.slots.push({ color: c }); i = st.slots.length - 1; }
      st.slotOf.set(id, i);
    }
    // the printer's own filament positions (toolheads, AMS slots) are ready to pick colors for
    const T = toolsOf();
    const want = T.kind === "heads" ? Math.min(T.heads, 8) : T.kind === "mmu" ? Math.min(T.slots, 4) : 1;
    while (physSlots().length < want) st.slots.push({ color: nextFilColor() });
  }
  // real spools (not mixes, not removed mixes), and mixed filaments
  const isMix = (i) => !!(st.slots[i] && st.slots[i].mix);
  const physSlots = () => st.slots.map((_, i) => i).filter((i) => !st.slots[i].mix && !st.slots[i].dead);
  const mixSlots = () => st.slots.map((_, i) => i).filter((i) => isMix(i));
  // how many filaments the printer holds at once (shown in the list)
  function slotCap() { const T = toolsOf(); return Math.max(T.kind === "heads" ? T.heads : T.kind === "mmu" ? Math.min(T.slots, 4) : 1, 1); }
  // the filaments the plate asks for, before slicing (mixes as their filaments)
  function declaredSlots(expand = true) {
    const set = new Set();
    for (const id of st.ids) {
      const sl = st.slotOf.get(id);
      if (sl != null) set.add(sl);
      const m = st.paint.get(id);
      if (m) for (const v of m.values()) set.add(v);
      const ops = st.ops.get(id);
      if (ops) for (const o of ops) if (o.s >= 0) set.add(o.s);
    }
    for (const v of Object.values(st.feat)) if (v >= 0 && st.slots[v]) set.add(v);
    if (expand) for (const i of [...set]) if (isMix(i)) { set.delete(i); for (const j of st.slots[i].mix.of) set.add(j); }
    return [...set].filter((i) => st.slots[i] && !st.slots[i].dead).sort((a, b) => a - b);
  }
  // painted faces: st.paint = Map(bodyId -> Map(faceIndex -> slot))
  const paintOf = (id, f) => { const m = st.paint.get(id); return m && m.has(f) ? m.get(f) : null; };
  // the spools the print really uses (from the sliced lines once sliced)
  function usedSlots() {
    if (cmykOn()) return inkSlots();
    if (lastPlan && lastPlan.used && lastPlan.pv === st.pv) return lastPlan.used;
    return declaredSlots();
  }
  const toolsOf = () => PRINTERS[st.printer].tools || { kind: "single" };
  // which nozzle a filament prints from: F1 on T1, F2 on T2…; more filaments than heads share
  function headOf(slot) {
    const T = toolsOf();
    return T.kind === "heads" ? slot % T.heads : 0;
  }
  // the filament of every triangle (painted, or its body's)
  function triSlots() {
    const ts = new Int16Array(W.tri.length / 3);
    const bodySlot = W.ids.map((id) => st.slotOf.get(id) ?? 0);
    for (let t = 0; t < ts.length; t++) {
      const id = W.ids[W.owner[t]], p = paintOf(id, W.tface[t]);
      ts[t] = p != null ? p : bodySlot[W.owner[t]];
    }
    return ts;
  }
  // the filament of every toolpath line (in the slicer's own order)
  // painted (face paint, brush, smart fill, height range), then Orca's "Filament for features"
  // for what isn't painted, then mixes split into their filaments layer by layer
  function lineSlots() {
    const B = S.base, ts = triSlots(), bodySlot = W.ids.map((id) => st.slotOf.get(id) ?? 0);
    const out = new Int16Array(B.lown.length);
    const caches = W.ids.map((id) => opCache(id)), L = B.lines, q = [0, 0, 0];
    const fw = featOK(st.feat.walls), fs = featOK(st.feat.sparse), fo = featOK(st.feat.solid);
    const anyFeat = fw >= 0 || fs >= 0 || fo >= 0;
    for (let i = 0; i < out.length; i++) {
      const k = B.lown[i], t = B.ltri[i];
      let s = t >= 0 ? ts[t] : bodySlot[k], painted = t >= 0 && s !== bodySlot[k];
      const c = caches[k];
      if (c) {
        const o = i * 6;
        toLocal(k, (L[o] + L[o + 3]) / 2, (L[o + 1] + L[o + 4]) / 2, L[o + 2], q);
        const s2 = slotAt(c, t >= 0 && W.owner[t] === k ? t - W.tbase[k] : -1, q[0], q[1], q[2], s, bodySlot[k]);
        if (s2 !== s) { painted = s2 !== bodySlot[k]; s = s2; }
      }
      if (anyFeat && !painted) {
        const kind = B.lkind ? GK[B.lkind[i]] : "outer";
        const f = kind === "outer" || kind === "inner" ? fw : kind === "sparse" ? fs : fo;
        if (f >= 0) s = f;
      }
      out[i] = s;
    }
    if (cmykOn()) cmykLines(out, B); else mixLines(out, B);
    return out;
  }
  const featOK = (v) => (v >= 0 && st.slots[v] && !st.slots[v].dead ? v : -1);
  // ---- full color (CMYK + white). Each design color is matched by a mix of the five inks: N
  // layers in a cycle, so many of each (the counts whose average color is closest, in linear
  // light). Walls take the inks in turn, one per layer, spread evenly through the cycle so the
  // thin layers blend by eye; top and bottom skins change ink line by line. With "surfaces only",
  // inner walls and infill print white (fewer changes, the same look).
  const INKS = [["C", "Cyan", "#00a3e0"], ["M", "Magenta", "#e5007e"], ["Y", "Yellow", "#ffe600"], ["K", "Black", "#1d1d1f"], ["W", "White", "#f4f4f1"]];
  const cmykOn = () => st.cmyk.on && multiOK();
  const inkSlots = () => (st.cmyk.inks || []).filter((i) => st.slots[i]);
  function ensureInks() {
    const T = toolsOf(), room = T.kind === "heads" ? Math.max(T.heads, T.slots || 0) : T.slots || 1, n = room >= 5 ? 5 : 4;
    if (st.cmyk.inks && st.cmyk.inks.length === n && st.cmyk.inks.every((i) => st.slots[i] && st.slots[i].ink)) return;
    st.cmyk.inks = INKS.slice(0, n).map(([k, name, c]) => { let i = st.slots.findIndex((q) => q.ink === k); if (i < 0) { st.slots.push({ color: c, ink: k, name }); i = st.slots.length - 1; } return i; });
  }
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)), unlin = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  // (hex parsed by hand: three.js colors are already in linear light)
  const rgbL = (c) => { const h = toHex(c); return [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255)); };
  const hexOf = (v) => "#" + v.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("");
  const MIX = new Map();
  function mixFor(color) {
    const N = st.cmyk.n, inks = inkSlots(), key = toHex(color) + N + ":" + inks.map((i) => st.slots[i].color).join();
    if (MIX.has(key)) return MIX.get(key);
    const tgt = rgbL(color), cols = inks.map((i) => rgbL(st.slots[i].color));
    let best = null, bestE = Infinity;
    const cnt = new Array(inks.length).fill(0);
    const rec = (j, left) => {
      if (j === inks.length - 1) {
        cnt[j] = left;
        let e = 0; for (let ch = 0; ch < 3; ch++) { let v = 0; for (let q = 0; q < inks.length; q++) v += (cnt[q] / N) * cols[q][ch]; const d = unlin(Math.min(1, v)) - unlin(tgt[ch]); e += d * d; }
        if (e < bestE) { bestE = e; best = cnt.slice(); }
        return;
      }
      for (let c = 0; c <= left; c++) { cnt[j] = c; rec(j + 1, left - c); }
    };
    rec(0, N);
    // the cycle: each ink as evenly spread as it can be
    const seq = [], used = new Array(inks.length).fill(0);
    for (let p = 0; p < N; p++) { let bi = 0, bd = -Infinity; for (let q = 0; q < inks.length; q++) { const d = (best[q] * (p + 1)) / N - used[q]; if (best[q] > used[q] && d > bd) { bd = d; bi = q; } } used[bi]++; seq.push(inks[bi]); }
    const mixed = [0, 1, 2].map((ch) => unlin(Math.min(1, inks.reduce((s, _, q) => s + (best[q] / N) * cols[q][ch], 0))));
    const out = { counts: best, seq, inks, hex: hexOf(mixed), err: Math.sqrt(bestE / 3) };
    MIX.set(key, out);
    return out;
  }
  function cmykLines(out, B) {
    ensureInks();
    const inks = inkSlots(), isInk = new Set(inks), white = inks.find((i) => st.slots[i].ink === "W") ?? inks[0], N = st.cmyk.n;
    let k = 0, inLayer = 0, end = (B.layerEnd[0] || 0) / 2;
    for (let i = 0; i < out.length; i++) {
      while (i >= end && k < B.layerEnd.length - 1) { k++; end = (B.layerEnd[k] || 0) / 2; inLayer = 0; }
      inLayer++;
      const s = out[i];
      if (isInk.has(s)) continue;
      const kind = B.lkind ? GK[B.lkind[i]] : "outer", skin = kind === "top" || kind === "bottom";
      if (st.cmyk.surf && kind !== "outer" && !skin) { out[i] = white; continue; }
      const m = mixFor(st.slots[s] ? st.slots[s].color : "#a7b0ba");
      out[i] = m.seq[(skin ? inLayer + k : k) % N];
    }
  }
  // ---- color mixing (Orca Slicer 2.5). A mixed filament takes a slot of its own; it is made of
  // two or three real filaments and prints as them in alternating layers, in the ratio set
  // (error diffusion, so 60/40 is A B A B A A B…). A gradient shifts from the first filament to
  // the last as the print rises over the layers the mix is used on.
  function mixWeights(m, t) {
    if (!m.grad) return m.w;
    if (m.of.length === 2) return [1 - t, t];
    return t < 0.5 ? [1 - 2 * t, 2 * t, 0] : [0, 2 - 2 * t, 2 * t - 1];
  }
  function mixPattern(m, k0, k1) {
    const n = k1 - k0 + 1, out = new Int16Array(n), acc = new Array(m.of.length).fill(0);
    for (let j = 0; j < n; j++) {
      const w = mixWeights(m, n > 1 ? j / (n - 1) : 0.5), tot = w.reduce((a, b) => a + b, 0) || 1;
      let bi = 0;
      for (let q = 0; q < w.length; q++) { acc[q] += w[q] / tot; if (acc[q] > acc[bi]) bi = q; }
      acc[bi] -= 1;
      out[j] = m.of[bi];
    }
    return out;
  }
  function mixLines(out, B) {
    if (!st.slots.some((q) => q.mix)) return;
    const lk = new Int32Array(out.length), rng = new Map();
    let k = 0, end = (B.layerEnd[0] || 0) / 2;
    for (let i = 0; i < out.length; i++) {
      while (i >= end && k < B.layerEnd.length - 1) { k++; end = (B.layerEnd[k] || 0) / 2; }
      lk[i] = k;
      if (isMix(out[i])) { const r = rng.get(out[i]); if (r) r[1] = k; else rng.set(out[i], [k, k]); }
    }
    for (const [s, [k0, k1]] of rng) {
      const pick = mixPattern(st.slots[s].mix, k0, k1);
      for (let i = 0; i < out.length; i++) if (out[i] === s) out[i] = pick[lk[i] - k0];
    }
  }
  // what a mix looks like: its filaments blended in linear light
  function mixHex(m) {
    const w = m.grad ? m.of.map(() => 1 / m.of.length) : m.w, tot = w.reduce((a, b) => a + b, 0) || 1;
    const cols = m.of.map((i) => rgbL(st.slots[i] ? st.slots[i].color : "#888"));
    return hexOf([0, 1, 2].map((ch) => unlin(Math.min(1, cols.reduce((s, c, q) => s + (w[q] / tot) * c[ch], 0)))));
  }
  function refreshMixColors() {
    for (const i of mixSlots()) {
      const q = st.slots[i];
      q.mix.of = q.mix.of.filter((j) => st.slots[j] && !st.slots[j].mix && !st.slots[j].dead);
      if (q.mix.of.length < 2) { removeMix(i); continue; }
      if (q.mix.w.length !== q.mix.of.length) q.mix.w = q.mix.of.map(() => 1 / q.mix.of.length);
      q.color = mixHex(q.mix);
    }
  }
  const mixText = (m) => m.grad ? "gradient " + m.of.map((j) => "F" + (j + 1)).join(" → ") : m.of.map((j, q) => `F${j + 1} ${Math.round(m.w[q] * 100)}%`).join(" + ");
  const mixCss = (m) => m.grad ? `linear-gradient(0deg, ${m.of.map((j) => toHex(st.slots[j].color)).join(", ")})` : mixHex(m);
  function addMix(of, w, grad = false) {
    const tot = w.reduce((a, b) => a + b, 0) || 1, mix = { of: of.slice(), w: w.map((x) => x / tot), grad };
    // the same mix again is the one already there
    const same = mixSlots().find((i) => { const m = st.slots[i].mix; return m.grad === grad && m.of.join() === mix.of.join() && m.w.every((x, q) => Math.abs(x - mix.w[q]) < 0.02); });
    if (same != null) return same;
    if (mixSlots().length >= 16) { app.toast("Up to 16 mixed filaments."); return null; }
    const dead = st.slots.findIndex((q) => q.dead);
    const q = { mix, color: "#888" };
    q.color = mixHex(mix);
    if (dead >= 0) { st.slots[dead] = q; return dead; }
    st.slots.push(q);
    return st.slots.length - 1;
  }
  // a removed mix keeps its place (so F numbers don't move); what used it goes to its first filament
  function removeMix(i) {
    const q = st.slots[i];
    if (!q || !q.mix) return;
    const to = q.mix.of[0] ?? 0;
    for (const [id, s] of st.slotOf) if (s === i) st.slotOf.set(id, to);
    for (const m of st.paint.values()) for (const [f, s] of m) if (s === i) m.set(f, to);
    for (const ops of st.ops.values()) for (const o of ops) { if (o.s === i) o.s = to; if (o.keep === i) o.keep = to; }
    for (const k of Object.keys(st.feat)) if (st.feat[k] === i) st.feat[k] = -1;
    if (st.brush === i) st.brush = to;
    st.slots[i] = { dead: true, color: "#888" };
  }
  // "Decompose color": the closest a color can be made from the loaded filaments, as one
  // filament or a mix of two or three (5 % steps for two, 10 % for three)
  function decompose(color, pool) {
    const tgt = rgbL(color), cols = pool.map((i) => rgbL(st.slots[i].color));
    const err = (idx, w) => { let e = 0; for (let ch = 0; ch < 3; ch++) { let v = 0; idx.forEach((q, n) => { v += w[n] * cols[q][ch]; }); const d = unlin(Math.min(1, v)) - unlin(tgt[ch]); e += d * d; } return Math.sqrt(e / 3); };
    let one = null;
    pool.forEach((_, q) => { const e = err([q], [1]); if (!one || e < one.err) one = { of: [q], w: [1], err: e }; });
    let two = null;
    for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) for (let x = 5; x <= 95; x += 5) { const e = err([a, b], [x / 100, 1 - x / 100]); if (!two || e < two.err) two = { of: [a, b], w: [x / 100, 1 - x / 100], err: e }; }
    let three = null;
    if (pool.length >= 3) for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) for (let c = b + 1; c < pool.length; c++)
      for (let x = 10; x <= 80; x += 10) for (let y = 10; x + y <= 90; y += 10) { const e = err([a, b, c], [x / 100, y / 100, 1 - (x + y) / 100]); if (!three || e < three.err) three = { of: [a, b, c], w: [x / 100, y / 100, 1 - (x + y) / 100], err: e }; }
    // a simpler answer wins unless the mix is clearly closer
    let best = one;
    if (two && two.err < best.err - 0.012) best = two;
    if (three && three.err < best.err - 0.012) best = three;
    return best ? { of: best.of.map((q) => pool[q]), w: best.w, err: best.err, hex: best.of.length > 1 ? mixHex({ of: best.of.map((q) => pool[q]), w: best.w }) : toHex(st.slots[pool[best.of[0]]].color) } : null;
  }
  // the filaments loaded in the printer (the first ones in the list)
  const loadedPool = () => physSlots().filter((i) => !st.slots[i].ink).slice(0, slotCap());
  // "Auto color mix": every body's design color is matched to a loaded filament, or to a new
  // mix of them when no filament is close (like Orca's Colors + Mix filaments)
  function autoColorMix() {
    if (litho() || !multiOK()) return;
    ensureSlots();
    const pool = loadedPool();
    if (pool.length < 2) { st.autoMsg = "Load at least two filaments first."; renderPanel(); return; }
    let nF = 0, nM = 0;
    const made = new Set();
    for (const id of st.ids) {
      const b = bodyOf(id);
      if (!b) continue;
      const d = decompose(b.color || "#a7b0ba", pool);
      if (!d) continue;
      if (d.of.length === 1) { st.slotOf.set(id, d.of[0]); nF++; continue; }
      const i = addMix(d.of, d.w);
      if (i == null) { st.slotOf.set(id, d.of[0]); nF++; continue; }
      st.slotOf.set(id, i); made.add(i); nM++;
    }
    st.autoMsg = `${nF + nM} bod${nF + nM === 1 ? "y" : "ies"} matched: ${nF} to loaded filaments, ${nM} to ${made.size} mixed filament${made.size === 1 ? "" : "s"}.`;
    filamentsChanged();
  }

  // ---- painting (Orca Slicer 2.5 color painting). Strokes are kept per body in the body's own
  // coordinates, so they follow it when it's turned, scaled or copied, and the newest wins:
  //   { k: "ball", p: [x, y, z], r, s }          the brush (a sphere)
  //   { k: "band", n: [..], o, z0, z1, s }       height range: n·p + o is the height on the plate
  //   { k: "tris", t: Set(triangle), s }         faces and smart fill
  // s = -1 erases back to the body's own filament
  // undo for paint: a snapshot before each stroke or click
  function snapPaint() {
    st.undo.push({ ops: new Map([...st.ops].map(([id, a]) => [id, a.length])), slotOf: new Map(st.slotOf), paint: new Map([...st.paint].map(([id, m]) => [id, new Map(m)])) });
    if (st.undo.length > 60) st.undo.shift();
  }
  function undoPaint() {
    const u = st.undo.pop();
    if (!u) { app.toast("Nothing to undo."); return; }
    for (const [id, a] of [...st.ops]) { const n = u.ops.get(id) || 0; if (!n) st.ops.delete(id); else a.length = n; }
    st.slotOf = u.slotOf; st.paint = u.paint; st.pv++;
    filamentsChanged();
  }
  // Ctrl+Z undoes paint while a paint tool is on (not the design); Alt + wheel sizes the brush
  window.addEventListener("keydown", (e) => {
    if (!st.paintTool || !document.getElementById("ps-paint")) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) { e.preventDefault(); e.stopImmediatePropagation(); undoPaint(); }
  }, true);
  vp.canvas.addEventListener("wheel", (e) => {
    if (st.paintTool !== "brush" || !e.altKey || !document.getElementById("ps-paint")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    st.brushR = Math.round(Math.min(30, Math.max(0.2, st.brushR * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) * 10) / 10;
    const r = document.getElementById("ps-brushr-range"), n = document.getElementById("ps-brushr-num") || document.querySelector("#ps-brushr input[type=number]");
    if (r) r.value = st.brushR; if (n) n.value = st.brushR;
    hoverKey = ""; const h = pickHit(e); hoverFace(h ? h.t : -1, h);
  }, { capture: true, passive: false });
  function pushOp(id, op) { if (!st.ops.has(id)) st.ops.set(id, []); st.ops.get(id).push(op); st.pv++; }
  const OPC = new Map();
  function opCache(id) {
    const ops = st.ops.get(id);
    if (!ops || !ops.length) return null;
    let c = OPC.get(id);
    if (c && c.ops === ops && c.n === ops.length && c.pv === st.pv) return c;
    const data = viewOf(id)?.data, nT = data ? data.triangles.length / 3 : 0;
    // every triangle's ops (faces, smart fill, paint can), oldest first
    const triOps = new Array(nT), balls = [], bands = [];
    let rmax = 0, rmin = Infinity;
    ops.forEach((o, i) => {
      if (o.k === "tris" || o.k === "fill") { for (const t of o.t) if (t < nT) (triOps[t] || (triOps[t] = [])).push(i); }
      else if (o.k === "ball") { balls.push(i); rmax = Math.max(rmax, o.r); rmin = Math.min(rmin, o.r); }
      else if (o.k === "band") bands.push(i);
    });
    const cs = Math.max(rmax, 0.25), grid = new Map(), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const i of balls) {
      const p = ops[i].p, key = gkey(Math.floor(p[0] / cs), Math.floor(p[1] / cs), Math.floor(p[2] / cs));
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a] - ops[i].r); hi[a] = Math.max(hi[a], p[a] + ops[i].r); }
    }
    // the body's triangle directions (its own coordinates), for brushes that only paint what faces you
    let nrm = null;
    if (balls.some((i) => ops[i].v) && data) {
      const V = data.vertices, T = data.triangles;
      nrm = new Float32Array(nT * 3);
      for (let t = 0; t < nT; t++) {
        const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, cc = T[t * 3 + 2] * 3;
        const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[cc] - V[a], vy = V[cc + 1] - V[a + 1], vz = V[cc + 2] - V[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nrm[t * 3] = nx / l; nrm[t * 3 + 1] = ny / l; nrm[t * 3 + 2] = nz / l;
      }
    }
    c = { ops, data, n: ops.length, pv: st.pv, triOps, nT, grid, cs, balls, bands, lo, hi, nrm, rmin: balls.length ? rmin : Infinity };
    OPC.set(id, c);
    return c;
  }
  // grid cells as numbers (a clash only adds candidates: each is still checked)
  const gkey = (x, y, z) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;
  // the newest op older than `limit` covering a point (body coordinates) on body triangle lt, or -1.
  // A front-only brush covers a point only where its triangle faces the way the brush looked.
  function rawOpAt(c, lt, x, y, z, limit = Infinity) {
    let best = -1;
    if (lt >= 0 && lt < c.nT) { const L = c.triOps[lt]; if (L) for (let j = L.length - 1; j >= 0; j--) if (L[j] < limit) { best = L[j]; break; } }
    if (c.balls.length && x >= c.lo[0] && x <= c.hi[0] && y >= c.lo[1] && y <= c.hi[1] && z >= c.lo[2] && z <= c.hi[2]) {
      const cs = c.cs, gx = Math.floor(x / cs), gy = Math.floor(y / cs), gz = Math.floor(z / cs);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
        const Lc = c.grid.get(gkey(gx + a, gy + b, gz + d));
        if (!Lc) continue;
        for (let j = Lc.length - 1; j >= 0; j--) {
          const i = Lc[j];
          if (i >= limit) continue;
          if (i <= best) break;
          const o = c.ops[i], dx = x - o.p[0], dy = y - o.p[1], dz = z - o.p[2];
          if (dx * dx + dy * dy + dz * dz > o.r * o.r) continue;
          if (o.v) { if (lt < 0 || !c.nrm) continue; if (c.nrm[lt * 3] * o.v[0] + c.nrm[lt * 3 + 1] * o.v[1] + c.nrm[lt * 3 + 2] * o.v[2] < 0.05) continue; }
          best = i; break;
        }
      }
    }
    for (let j = c.bands.length - 1; j >= 0; j--) {
      const i = c.bands[j];
      if (i >= limit) continue;
      if (i <= best) break;
      const o = c.ops[i], h = o.n[0] * x + o.n[1] * y + o.n[2] * z + o.o;
      if (h >= o.z0 && h <= o.z1) { best = i; break; }
    }
    return best;
  }
  // the filament at a point: the newest op covering it, where a paint can / smart fill only
  // counts where the colour underneath was the one it was poured onto (so it stops exactly at
  // brush strokes, even half way across a triangle)
  function slotAt(c, lt, x, y, z, base, bodyS, limit = Infinity) {
    const j = rawOpAt(c, lt, x, y, z, limit);
    if (j < 0) return base;
    const o = c.ops[j], sj = o.s < 0 || !st.slots[o.s] ? bodyS : o.s;
    if (o.k !== "fill") return sj;
    const below = slotAt(c, lt, x, y, z, base, bodyS, j);
    // a precise fill only covers the cells it reached in triangles it filled part of
    if (o.sub) { const sb = o.sub.get(lt); if (sb && !inFillCell(c, sb, lt, x, y, z)) return below; }
    return below === o.keep ? sj : below;
  }
  // plate point -> body coordinates of part k (and back)
  function toLocal(k, x, y, z, out = [0, 0, 0]) {
    const e = W.inv[k];
    out[0] = e[0] * x + e[4] * y + e[8] * z + e[12]; out[1] = e[1] * x + e[5] * y + e[9] * z + e[13]; out[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    return out;
  }
  function toWorld(k, x, y, z, out = [0, 0, 0]) {
    const e = W.mats[k];
    out[0] = e[0] * x + e[4] * y + e[8] * z + e[12]; out[1] = e[1] * x + e[5] * y + e[9] * z + e[13]; out[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    return out;
  }
  // smart fill: the triangles reached from t without crossing an edge sharper than the angle
  const ADJ = new Map();
  function triAdj(k) {
    const key = k;
    if (ADJ.get(key) && ADJ.get(key).W === W) return ADJ.get(key);
    const t0 = W.tbase[k], t1 = k + 1 < W.nParts ? W.tbase[k + 1] : W.tri.length / 3, P = W.pos, T = W.tri;
    const vk = (v) => Math.round(P[v * 3] * 1000) + "," + Math.round(P[v * 3 + 1] * 1000) + "," + Math.round(P[v * 3 + 2] * 1000);
    const edges = new Map(), nb = new Array(t1 - t0);
    for (let t = t0; t < t1; t++) {
      nb[t - t0] = [];
      const ks = [vk(T[t * 3]), vk(T[t * 3 + 1]), vk(T[t * 3 + 2])];
      for (let e = 0; e < 3; e++) {
        const a = ks[e], b = ks[(e + 1) % 3], ek = a < b ? a + "|" + b : b + "|" + a;
        const L = edges.get(ek);
        if (L) { for (const u of L) { nb[u - t0].push(t); nb[t - t0].push(u); } L.push(t); } else edges.set(ek, [t]);
      }
    }
    const r = { W, t0, nb };
    ADJ.set(key, r);
    return r;
  }
  function triNormal(t, out = new THREE.Vector3()) {
    const P = W.pos, T = W.tri, a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    return out.set(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx).normalize();
  }
  function smartRegion(t, ang = st.smartAng) {
    const k = W.owner[t], A = triAdj(k), cosT = Math.cos((ang * Math.PI) / 180);
    const seen = new Set([t]), stack = [t], n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
    while (stack.length) {
      const u = stack.pop();
      triNormal(u, n1);
      for (const v of A.nb[u - A.t0]) {
        if (seen.has(v)) continue;
        if (triNormal(v, n2).dot(n1) < cosT) continue;
        seen.add(v); stack.push(v);
      }
    }
    return seen;
  }
  // the filament at a point on triangle t (plate coordinates): face paint, then the strokes
  function slotAtW(t, x, y, z) {
    const k = W.owner[t], id = W.ids[k], bodyS = st.slotOf.get(id) ?? 0, fp = paintOf(id, W.tface[t]), base = fp != null ? fp : bodyS;
    const c = opCache(id);
    if (!c) return base;
    const q = toLocal(k, x, y, z);
    return slotAt(c, t - W.tbase[k], q[0], q[1], q[2], base, bodyS);
  }
  function triCentre(t) { const P = W.pos, T = W.tri; let x = 0, y = 0, z = 0; for (let e = 0; e < 3; e++) { const v = T[t * 3 + e] * 3; x += P[v]; y += P[v + 1]; z += P[v + 2]; } return [x / 3, y / 3, z / 3]; }
  // does any part of triangle t have filament s? (its middle and near each corner)
  function triHas(t, sl) {
    const c = triCentre(t), P = W.pos, T = W.tri;
    if (slotAtW(t, c[0], c[1], c[2]) === sl) return true;
    for (let e = 0; e < 3; e++) { const v = T[t * 3 + e] * 3; if (slotAtW(t, P[v] * 0.85 + c[0] * 0.15, P[v + 1] * 0.85 + c[1] * 0.15, P[v + 2] * 0.85 + c[2] * 0.15) === sl) return true; }
    return false;
  }
  // Paint can / smart fill that stops at other colours: grows over triangles of the clicked
  // colour; triangles the colour only reaches part of are taken too, but the fill paints only
  // the part of them in that colour (see slotAt), so it ends exactly at a brush stroke.
  // ang < 180 also stops at edges sharper than that (against the clicked spot's direction when
  // seedN is given, else against each neighbour, like Orca's smart fill).
  function colourRegion(t, seed, ang = 180, seedN = null) {
    const k = W.owner[t], A = triAdj(k), cosT = ang >= 180 ? -2 : Math.cos((ang * Math.PI) / 180);
    const out = new Set([t]), seen = new Set([t]), stack = [t], n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
    let guard = 0;
    while (stack.length && guard++ < 2e6) {
      const u = stack.pop();
      if (cosT > -2) triNormal(u, n1);
      for (const v of A.nb[u - A.t0]) {
        if (seen.has(v)) continue;
        seen.add(v);
        if (cosT > -2 && triNormal(v, n2).dot(seedN || n1) < cosT) continue;
        const c = triCentre(v);
        if (slotAtW(v, c[0], c[1], c[2]) === seed) { out.add(v); stack.push(v); }
        else if (triHas(v, seed)) out.add(v);
      }
    }
    return out;
  }
  // ---- Paint can, precisely: triangles that a brush stroke crosses are cut into a fine grid of
  // little cells (finer than the smallest stroke), and the fill spreads cell to cell, across
  // shared edges into the next triangles. So it ends exactly at the stroke, even when one big
  // flat triangle is split by it. Returns { tris: Set(body triangle), sub: Map(triangle ->
  // { n, mask }) } for the triangles only partly filled, or null.
  function cellOf(n, u, v) {
    const fu = u * n, fv = v * n;
    let a = Math.min(n - 1, Math.max(0, Math.floor(fu))), b = Math.min(n - 1 - a, Math.max(0, Math.floor(fv)));
    const d = fu - a + (fv - b) > 1 && a + b <= n - 2 ? 1 : 0;
    return (a * n + b) * 2 + d;
  }
  // barycentric (u towards B, v towards C) of point p in triangle A B C (all [x,y,z])
  function bary(A, B, C, p) {
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], w = [p[0] - A[0], p[1] - A[1], p[2] - A[2]];
    const d11 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2], d12 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2], d22 = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2];
    const w1 = w[0] * e1[0] + w[1] * e1[1] + w[2] * e1[2], w2 = w[0] * e2[0] + w[1] * e2[1] + w[2] * e2[2], den = d11 * d22 - d12 * d12 || 1e-12;
    return [(d22 * w1 - d12 * w2) / den, (d11 * w2 - d12 * w1) / den];
  }
  function localTri(data, lt) { const V = data.vertices, T = data.triangles; return [0, 1, 2].map((e) => { const v = T[lt * 3 + e] * 3; return [V[v], V[v + 1], V[v + 2]]; }); }
  function inFillCell(c, sb, lt, x, y, z) {
    const [A, B, C] = localTri(c.data, lt), [u, v] = bary(A, B, C, [x, y, z]);
    return !!sb.mask[cellOf(sb.n, Math.max(0, u), Math.max(0, v))];
  }
  function fillRegion(t0, hitW, seed, ang = 180) {
    const k = W.owner[t0], id = W.ids[k], Adj = triAdj(k), data = viewOf(id).data, c = opCache(id);
    const bodyS = st.slotOf.get(id) ?? 0, tb = W.tbase[k];
    const cosT = ang >= 180 ? -2 : Math.cos((ang * Math.PI) / 180);
    const baseOf = (t) => { const fp = paintOf(id, W.tface[t]); return fp != null ? fp : bodyS; };
    const colour = (t, p) => (c ? slotAt(c, t - tb, p[0], p[1], p[2], baseOf(t), bodyS) : baseOf(t));
    // cells a third of the thinnest stroke across (in the body's own size), 0.1 mm at least
    let fine = Infinity;
    if (c) { if (c.balls.length) fine = c.rmin; for (const i of c.bands) fine = Math.min(fine, (c.ops[i].z1 - c.ops[i].z0) / (W.scl[k] || 1)); }
    const eT = Math.max(0.1 / (W.scl[k] || 1), fine / 3);
    const key = (q) => Math.round(q[0] * 1000) + "," + Math.round(q[1] * 1000) + "," + Math.round(q[2] * 1000);
    const info = new Map();
    const Vw = new Float64Array(9);
    function analyse(t) {
      if (info.has(t)) return info.get(t);
      const L3 = localTri(data, t - tb);
      for (let e = 0; e < 3; e++) { const w = toWorld(k, ...L3[e]); Vw[e * 3] = w[0]; Vw[e * 3 + 1] = w[1]; Vw[e * 3 + 2] = w[2]; }
      let r;
      if (!c || !touchesSplit(c, k, Vw)) {
        const ctr = [(L3[0][0] + L3[1][0] + L3[2][0]) / 3, (L3[0][1] + L3[1][1] + L3[2][1]) / 3, (L3[0][2] + L3[1][2] + L3[2][2]) / 3];
        r = colour(t, ctr) === seed ? { full: true } : { none: true };
      } else {
        const Lm = Math.max(...[[0, 1], [1, 2], [2, 0]].map(([a, b]) => Math.hypot(L3[a][0] - L3[b][0], L3[a][1] - L3[b][1], L3[a][2] - L3[b][2])));
        let n = 1;
        while (n < 64 && Lm / n > eT) n *= 2;
        const comp = new Int32Array(2 * n * n).fill(-2);
        const pt = (u, v) => [0, 1, 2].map((a) => L3[0][a] + u * (L3[1][a] - L3[0][a]) + v * (L3[2][a] - L3[0][a]));
        for (let a = 0; a < n; a++) for (let b = 0; a + b < n; b++) {
          comp[(a * n + b) * 2] = colour(t, pt((a + 1 / 3) / n, (b + 1 / 3) / n)) === seed ? -1 : -2;
          if (a + b <= n - 2) comp[(a * n + b) * 2 + 1] = colour(t, pt((a + 2 / 3) / n, (b + 2 / 3) / n)) === seed ? -1 : -2;
        }
        // connected groups of fill-coloured cells, and where each touches the triangle's edges
        const comps = [];
        for (let i0 = 0; i0 < comp.length; i0++) {
          if (comp[i0] !== -1) continue;
          const ci = comps.length, iv = [], stack = [i0];
          comp[i0] = ci;
          while (stack.length) {
            const i = stack.pop(), d = i & 1, ab = i >> 1, a = Math.floor(ab / n), b = ab % n;
            if (!d) { if (b === 0) iv.push([0, a / n, (a + 1) / n]); if (a + b === n - 1) iv.push([1, b / n, (b + 1) / n]); if (a === 0) iv.push([2, 1 - (b + 1) / n, 1 - b / n]); }
            const nb = d ? [[a, b, 0], [a + 1, b, 0], [a, b + 1, 0]] : [[a, b, 1], [a - 1, b, 1], [a, b - 1, 1]];
            for (const [x, y, dd] of nb) {
              if (x < 0 || y < 0 || x + y > n - 1 || (dd && x + y > n - 2)) continue;
              const j = (x * n + y) * 2 + dd;
              if (comp[j] === -1) { comp[j] = ci; stack.push(j); }
            }
          }
          comps.push({ iv });
        }
        r = comps.length ? { n, comp, comps, L3 } : { none: true };
      }
      info.set(t, r);
      return r;
    }
    const vkeys = (t) => localTri(data, t - tb).map(key);
    function edgeOf(t, u) {
      const kt = vkeys(t), ku = vkeys(u);
      for (let e = 0; e < 3; e++) for (let f = 0; f < 3; f++) {
        if (ku[f] === kt[e] && ku[(f + 1) % 3] === kt[(e + 1) % 3]) return [e, f, false];
        if (ku[f] === kt[(e + 1) % 3] && ku[(f + 1) % 3] === kt[e]) return [e, f, true];
      }
      return null;
    }
    // start: the cell under the click (or the nearest one of the fill colour)
    const r0 = analyse(t0);
    if (r0.none) return null;
    let c0 = -1;
    if (!r0.full) {
      const L = toLocal(k, hitW.x, hitW.y, hitW.z), [u, v] = bary(r0.L3[0], r0.L3[1], r0.L3[2], L);
      c0 = r0.comp[cellOf(r0.n, Math.max(0, u), Math.max(0, v))];
      if (c0 < 0) { let best = Infinity; for (let i = 0; i < r0.comp.length; i++) if (r0.comp[i] >= 0) { const ab = i >> 1, a = Math.floor(ab / r0.n), b = ab % r0.n, du = (a + 0.5) / r0.n - u, dv = (b + 0.5) / r0.n - v, dd = du * du + dv * dv; if (dd < best) { best = dd; c0 = r0.comp[i]; } } }
      if (c0 < 0) return null;
    }
    const seen = new Set([t0 + ":" + c0]), queue = [[t0, c0]], full = new Set(), part = new Map();
    const n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
    let guard = 0;
    while (queue.length && guard++ < 3e6) {
      const [t, ci] = queue.pop();
      if (ci < 0) full.add(t); else { if (!part.has(t)) part.set(t, new Set()); part.get(t).add(ci); }
      const mine = ci < 0 ? [[0, 0, 1], [1, 0, 1], [2, 0, 1]] : info.get(t).comps[ci].iv;
      if (cosT > -2) triNormal(t, n1);
      for (const u of Adj.nb[t - Adj.t0]) {
        if (cosT > -2 && triNormal(u, n2).dot(n1) < cosT) continue;
        const es = edgeOf(t, u);
        if (!es) continue;
        const [e, f, rev] = es;
        const on = mine.filter((q) => q[0] === e).map((q) => (rev ? [1 - q[2], 1 - q[1]] : [q[1], q[2]]));
        if (!on.length) continue;
        const ru = analyse(u);
        if (ru.none) continue;
        const touch = (iv) => iv.some((q) => q[0] === f && on.some((o) => Math.min(o[1], q[2]) - Math.max(o[0], q[1]) > 1e-6));
        if (ru.full) { if (!seen.has(u + ":-1")) { seen.add(u + ":-1"); queue.push([u, -1]); } continue; }
        ru.comps.forEach((cm, j) => { if (!seen.has(u + ":" + j) && touch(cm.iv)) { seen.add(u + ":" + j); queue.push([u, j]); } });
      }
    }
    const tris = new Set(), sub = new Map();
    for (const t of full) tris.add(t - tb);
    for (const [t, cs] of part) {
      const r = info.get(t), mask = new Uint8Array(r.comp.length);
      for (let i = 0; i < mask.length; i++) if (cs.has(r.comp[i])) mask[i] = 1;
      tris.add(t - tb); sub.set(t - tb, { n: r.n, mask });
    }
    return { tris, sub, world: new Set([...full, ...part.keys()]) };
  }
  // smart fill measured against the clicked spot's direction (stays on one side of a rounded shape)
  function smartSeedRegion(t, n0, ang = st.smartAng) {
    const k = W.owner[t], A = triAdj(k), cosT = Math.cos((ang * Math.PI) / 180);
    const seen = new Set([t]), stack = [t], n2 = new THREE.Vector3();
    while (stack.length) { const u = stack.pop(); for (const v of A.nb[u - A.t0]) { if (seen.has(v)) continue; if (triNormal(v, n2).dot(n0) < cosT) continue; seen.add(v); stack.push(v); } }
    return seen;
  }
  const faceRegion = (t) => { const k = W.owner[t], f = W.tface[t]; if (f < 0) return smartRegion(t, 5); const out = new Set(), t0 = W.tbase[k], t1 = k + 1 < W.nParts ? W.tbase[k + 1] : W.tri.length / 3; for (let q = t0; q < t1; q++) if (W.tface[q] === f) out.add(q); return out; };
  // what one filament change costs on this printer: seconds, and whether it swaps / purges
  function changeCost(T, from, to, loaded) {
    const h = headOf(to), hc = headOf(from);
    let secs = 0, swap = false, purge = 0;
    if (T.kind === "heads" && h !== hc) { swap = true; secs += T.swap; }
    if (loaded.get(h) !== to) {
      purge = flushVolume(st.slots[loaded.get(h) ?? from]?.color, st.slots[to]?.color) * (st.flushMul || 1);
      secs += (T.load || 30) + purge / PURGE_FLOW;
    }
    return { secs, swap, purge, h };
  }
  // Orca-style plan: each layer prints every filament it needs once, starting with the one
  // already loaded; count changes, head swaps, purge (flush) and the prime tower
  function toolPlan() {
    if (!S || !W || !S.base) return null;
    ensureSlots();
    const T = toolsOf(), fil = FILAMENTS[st.filament];
    const ls = lineSlots(), B = S.base;
    const used = cmykOn() ? inkSlots() : [...new Set(ls)].sort((a, b) => a - b);
    const perLayer = [];
    const slotLen = new Map();
    let li = 0;
    for (let k = 0; k < S.nL; k++) {
      const end = (B.layerEnd[k] || 0) / 2, set = new Set();
      for (; li < end; li++) {
        const sl = ls[li];
        set.add(sl);
        const L = B.lines, o = li * 6;
        slotLen.set(sl, (slotLen.get(sl) || 0) + Math.hypot(L[o + 3] - L[o], L[o + 4] - L[o + 1]));
      }
      perLayer.push(set);
    }
    const plan = { pv: st.pv, kind: T.kind, used, ls, changes: 0, swaps: 0, flushes: 0, flushVol: 0, primeVol: 0, towerVol: 0, towerH: 0, secs: 0, mixedLayers: 0, firstMixed: -1, slotGrams: new Map(), heads: new Set(used.map(headOf)), seqs: [], costs: [] };
    const sec = LW * S.lh;
    for (const [sl, len] of slotLen) plan.slotGrams.set(sl, (len * sec * fil.rho) / 1000);
    for (let k = 0; k < perLayer.length; k++) if (perLayer[k].size > 1) { plan.mixedLayers++; if (plan.firstMixed < 0) plan.firstMixed = k; }
    if (used.length < 2 || T.kind === "single") return plan;
    const loaded = new Map(); // head -> slot in it
    for (const sl of used) { const h = headOf(sl); if (!loaded.has(h)) loaded.set(h, sl); }
    let cur = null, towerTop = -1;
    for (let k = 0; k < perLayer.length; k++) {
      const set = perLayer[k], seq = [...set].sort((a, b) => a - b), costs = [];
      if (cur != null && set.has(cur)) { seq.splice(seq.indexOf(cur), 1); seq.unshift(cur); }
      let changedHere = false;
      for (const sl of seq) {
        if (cur == null || sl === cur) { cur = sl; costs.push(null); continue; }
        const c = changeCost(T, cur, sl, loaded);
        plan.changes++; changedHere = true;
        if (c.swap) { plan.swaps++; plan.primeVol += T.prime || 15; }
        if (c.purge) { plan.flushes++; plan.flushVol += c.purge; loaded.set(c.h, sl); }
        plan.secs += c.secs;
        costs.push(c);
        cur = sl;
      }
      plan.seqs.push(seq); plan.costs.push(costs);
      if (changedHere || set.size > 1) towerTop = k;
    }
    if (plan.changes && st.tower) {
      // a prime tower keeps every layer's nozzle(s) primed up to the last change
      const side = st.towerW || (T.kind === "heads" ? 25 : 35);
      plan.towerSide = side;
      plan.towerH = (towerTop + 1) * S.lh;
      plan.towerVol = plan.towerH * (4 * side * 2 * LW + side * side * 0.12);
      plan.secs += plan.towerVol / Math.min(FLOW[st.filament] || 12, 200 * sec);
    }
    plan.wasteGrams = ((plan.flushVol + plan.primeVol + plan.towerVol) * fil.rho) / 1000;
    return plan;
  }
  // put each layer's lines in printing order (one filament after another, as the plan says)
  // and add the tool-change / purge pauses to the timeline, for the layer preview and the
  // print animation
  function applyOrder(plan) {
    const B = S.base, n = B.lown.length;
    const ls = plan ? plan.ls : null;
    const durs = new Float64Array(n);
    for (let i = 0; i < n; i++) durs[i] = B.cum[i] - (i ? B.cum[i - 1] : 0);
    const order = new Int32Array(n), pause = new Float32Array(n), pkind = new Uint8Array(n);
    let o = 0;
    const lEnd = [];
    let li = 0;
    for (let k = 0; k < S.nL; k++) {
      const end = (B.layerEnd[k] || 0) / 2;
      const seq = plan && plan.seqs && plan.seqs[k];
      if (!seq || seq.length < 2 && !(plan.costs[k] && plan.costs[k][0])) { for (; li < end; li++) order[o++] = li; }
      else {
        const by = new Map(seq.map((sl) => [sl, []]));
        for (; li < end; li++) (by.get(ls[li]) || by.get(seq[0])).push(li);
        seq.forEach((sl, j) => {
          const list = by.get(sl), c = plan.costs[k][j];
          if (c && list.length) { pause[o] = c.secs; pkind[o] = (c.swap ? 1 : 0) | (c.purge ? 2 : 0); }
          for (const x of list) order[o++] = x;
        });
      }
      lEnd.push(o * 2);
    }
    const lines = new Float32Array(n * 6), cols = new Float32Array(n * 6), lown = new Uint16Array(n), ltri = new Int32Array(n), lslot = new Int16Array(n), lkind = new Uint8Array(n), cum = new Float64Array(n);
    let t = 0;
    for (let j = 0; j < n; j++) {
      const i = order[j];
      lines.set(B.lines.subarray(i * 6, i * 6 + 6), j * 6);
      cols.set(B.cols.subarray(i * 6, i * 6 + 6), j * 6);
      lown[j] = B.lown[i]; ltri[j] = B.ltri[i]; lslot[j] = ls ? ls[i] : 0; lkind[j] = B.lkind ? B.lkind[i] : 0;
      t += pause[j] + durs[i];
      cum[j] = t;
    }
    Object.assign(S, { lines, cols, lown, ltri, lslot, lkind, cum, pause, pkind, durs: Float64Array.from(order, (i) => durs[i]), layerEnd: lEnd, total: t });
    const ln = layG.children[0];
    if (ln) { ln.geometry.setAttribute("position", new THREE.BufferAttribute(S.lines, 3)); ln.geometry.computeBoundingSphere(); }
  }
  const multiOK = () => toolsOf().kind !== "single";
  const toHex = (c) => "#" + new THREE.Color(c || "#a7b0ba").getHexString();
  const lightText = (c) => { const k = new THREE.Color(c || "#a7b0ba"); return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b > 0.45 ? "#111" : "#fff"; };
  const FIL_COLORS = ["#e5484d", "#2f7de1", "#f5c518", "#2fbf71", "#ffffff", "#222222", "#9b59d0", "#ff8a1f"];
  const nextFilColor = () => FIL_COLORS.find((c) => !st.slots.some((q) => q.color.toLowerCase() === c)) || "#888888";
  function headName(h) {
    const T = toolsOf();
    if (T.lr && T.heads === 2) return h === 0 ? "left" : "right";
    if (st.printer === "h2c") return h === 0 ? "left" : `right · hotend ${h}`;
    if (st.printer === "h3c") return h === 8 ? "T9 (2.85 mm TPU)" : "T" + (h + 1);
    return "T" + (h + 1);
  }
  // one line on what the printer does with more than one filament
  function toolText(P) {
    const T = P.tools || { kind: "single" };
    if (T.kind === "single") return "One nozzle, one filament. For two colors, pause at a layer and swap the spool by hand.";
    if (T.kind === "mmu") return `One nozzle with ${T.sys}: up to ${T.slots} filaments. Each change unloads, loads and purges (flushes) filament, so it adds time and waste.`;
    const width = T.wDual ? ` Using both nozzles, the printable width is ${T.wDual} mm (${T.wSingle} mm with one).` : "";
    return `${T.heads} ${T.lr ? "nozzles" : "toolheads"} (${T.sys}): each filament keeps its own nozzle, so changes are quick swaps with almost no waste${T.slots > T.heads ? `; more than ${T.heads} filaments share nozzles and purge` : ""}.${width}`;
  }
  // the plan drives the print order, the tower, the line colors and the painted faces
  let lastPlan = null;
  function refreshPlan() {
    if (!S || !S.base) { lastPlan = null; buildPaint(); return; }
    lastPlan = toolPlan();
    applyOrder(lastPlan);
    if (st.view === "layers") setLayer(st.layerMax);
    lineColors();
    buildTower(lastPlan);
    buildPaint();
  }
  // a filament, paint or printer change: plate area, plan, legend, panel
  function filamentsChanged() {
    st.pv++;
    refreshMixColors();
    buildPlate();
    refreshPlan();
    buildDocks();
    legend();
    renderPanel();
  }
  // colors of the toolpath lines by filament (Orca's "Filament" color scheme)
  function filamentColors() {
    const out = new Float32Array(S.lines.length);
    const cols = st.slots.map((q) => new THREE.Color(q.color || "#a7b0ba"));
    for (let i = 0; i < S.lown.length; i++) {
      const c = cols[S.lslot ? S.lslot[i] : 0] || cols[0];
      for (let j = 0; j < 2; j++) { out[i * 6 + j * 3] = c.r; out[i * 6 + j * 3 + 1] = c.g; out[i * 6 + j * 3 + 2] = c.b; }
    }
    return out;
  }
  const byFilament = () => st.colorBy === "filament" || (st.colorBy === "auto" && usedSlots().length > 1);
  function lineColors() {
    const ls = layG.children[0];
    if (!ls || !S) return;
    ls.geometry.setAttribute("color", new THREE.BufferAttribute(byFilament() ? filamentColors() : S.cols, 3));
    vp.request();
  }
  // painted faces drawn over the model (Model view), plus the face under the brush
  const paintG = new THREE.Group(), hoverG = new THREE.Group(), tmpG = new THREE.Group();
  root.add(paintG, hoverG, tmpG);
  function faceTris(pred) {
    const out = [];
    for (let t = 0; t < W.tri.length / 3; t++) if (pred(t)) for (let e = 0; e < 3; e++) { const v = W.tri[t * 3 + e] * 3; out.push(W.pos[v], W.pos[v + 1], W.pos[v + 2]); }
    return out;
  }
  function overlayMesh(pos, color, opacity) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide, transparent: opacity < 1, opacity, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    m.renderOrder = 3;
    return m;
  }
  function buildPaint() {
    disposeGroup(paintG); disposeGroup(tmpG);
    if (!W) { vp.request(); return; }
    const nT = W.tri.length / 3, P = W.pos, T = W.tri;
    const bodySlot = W.ids.map((id) => st.slotOf.get(id) ?? 0);
    // a body printing in a filament of another color than its own shows that color
    const tint = W.ids.map((id, k) => !litho() && !!st.slots[bodySlot[k]] && toHex(st.slots[bodySlot[k]].color) !== toHex(bodyOf(id)?.color || "#a7b0ba"));
    const caches = W.ids.map((id) => opCache(id));
    if (!st.paint.size && !caches.some(Boolean) && !tint.some(Boolean)) { vp.request(); return; }
    const bySlot = new Map();
    const emit = (s, v) => { let a = bySlot.get(s); if (!a) bySlot.set(s, (a = [])); for (let i = 0; i < 9; i++) a.push(v[i]); };
    let budget = 500000;
    const q = [0, 0, 0], V = new Float64Array(9);
    for (let t = 0; t < nT; t++) {
      const k = W.owner[t], fp = paintOf(W.ids[k], W.tface[t]), base = fp != null ? fp : bodySlot[k];
      const show = (s) => s !== bodySlot[k] || tint[k];
      for (let e = 0; e < 3; e++) { const v = T[t * 3 + e] * 3; V[e * 3] = P[v]; V[e * 3 + 1] = P[v + 1]; V[e * 3 + 2] = P[v + 2]; }
      const c = caches[k];
      if (!c) { if (show(base)) emit(base, V); continue; }
      const lt = t - W.tbase[k];
      const res = (x, y, z) => { toLocal(k, x, y, z, q); return slotAt(c, lt, q[0], q[1], q[2], base, bodySlot[k]); };
      const sc = W.scl[k], rw = c.rmin * sc;
      let bandMin = Infinity; for (const i of c.bands) bandMin = Math.min(bandMin, c.ops[i].z1 - c.ops[i].z0);
      if (!touchesSplit(c, k, V)) { const s = res((V[0] + V[3] + V[6]) / 3, (V[1] + V[4] + V[7]) / 3, (V[2] + V[5] + V[8]) / 3); if (show(s)) emit(s, V); continue; }
      // split the triangle where strokes cross it, finer near the edges of the strokes
      const eSafe = Math.min(rw * 1.4, bandMin * 1.2), eMin = Math.max(0.2, Math.min(rw, bandMin) / 5);
      const rec = (A, d) => {
        const cx = (A[0] + A[3] + A[6]) / 3, cy = (A[1] + A[4] + A[7]) / 3, cz = (A[2] + A[5] + A[8]) / 3, s = res(cx, cy, cz);
        const L = Math.max(Math.hypot(A[3] - A[0], A[4] - A[1], A[5] - A[2]), Math.hypot(A[6] - A[3], A[7] - A[4], A[8] - A[5]), Math.hypot(A[0] - A[6], A[1] - A[7], A[2] - A[8]));
        const done = () => { budget--; if (show(s)) emit(s, A); };
        if (d >= 9 || budget <= 0 || L <= eMin) return done();
        if (L <= eSafe && res(A[0], A[1], A[2]) === s && res(A[3], A[4], A[5]) === s && res(A[6], A[7], A[8]) === s) return done();
        const m = (i, j) => [(A[i] + A[j]) / 2, (A[i + 1] + A[j + 1]) / 2, (A[i + 2] + A[j + 2]) / 2];
        const a = A.slice(0, 3), b = A.slice(3, 6), cc = A.slice(6, 9), ab = m(0, 3), bc = m(3, 6), ca = m(6, 0);
        rec([...a, ...ab, ...ca], d + 1); rec([...ab, ...b, ...bc], d + 1); rec([...ca, ...bc, ...cc], d + 1); rec([...ab, ...bc, ...ca], d + 1);
      };
      rec(Array.from(V), 0);
    }
    for (const [sl, pos] of bySlot) paintG.add(overlayMesh(pos, st.slots[sl]?.color || "#888", 1));
    vp.request();
  }
  // does a brush stroke touch triangle V (plate coordinates), or a height range cross it?
  function touchesSplit(c, k, V) {
    const q = [0, 0, 0], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let hmin = Infinity, hmax = -Infinity;
    for (let e = 0; e < 3; e++) {
      toLocal(k, V[e * 3], V[e * 3 + 1], V[e * 3 + 2], q);
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], q[a]); hi[a] = Math.max(hi[a], q[a]); }
      hmin = Math.min(hmin, V[e * 3 + 2]); hmax = Math.max(hmax, V[e * 3 + 2]);
    }
    for (const i of c.bands) {
      const o = c.ops[i];
      // the band's height on the plate when it was painted (the body may have turned since)
      let a = Infinity, b = -Infinity;
      for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) { const h = o.n[0] * x + o.n[1] * y + o.n[2] * z + o.o; a = Math.min(a, h); b = Math.max(b, h); }
      if (b >= o.z0 && a <= o.z1 && !(a >= o.z0 && b <= o.z1)) return true;
    }
    if (!c.balls.length) return false;
    const cs = c.cs, n = ((Math.floor(hi[0] / cs) - Math.floor(lo[0] / cs) + 3) * (Math.floor(hi[1] / cs) - Math.floor(lo[1] / cs) + 3) * (Math.floor(hi[2] / cs) - Math.floor(lo[2] / cs) + 3));
    const hit = (i) => { const o = c.ops[i]; let d = 0; for (let a = 0; a < 3; a++) { const v = o.p[a] < lo[a] ? lo[a] - o.p[a] : o.p[a] > hi[a] ? o.p[a] - hi[a] : 0; d += v * v; } return d <= o.r * o.r; };
    if (n > c.balls.length) { for (const i of c.balls) if (hit(i)) return true; return false; }
    for (let x = Math.floor(lo[0] / cs) - 1; x <= Math.floor(hi[0] / cs) + 1; x++) for (let y = Math.floor(lo[1] / cs) - 1; y <= Math.floor(hi[1] / cs) + 1; y++) for (let z = Math.floor(lo[2] / cs) - 1; z <= Math.floor(hi[2] / cs) + 1; z++) {
      const L = c.grid.get(gkey(x, y, z));
      if (L) for (const i of L) if (hit(i)) return true;
    }
    return false;
  }
  // while dragging: the new stroke drawn on top straight away (the full paint redraws on release)
  function tempOverlay(pos, color) { if (pos.length) { const m = overlayMesh(pos, color, 1); m.material.polygonOffsetFactor = -3; m.material.polygonOffsetUnits = -6; m.renderOrder = 4; tmpG.add(m); } vp.request(); }
  // triangles of each part bucketed in a grid (plate coordinates), for fast "what's near here"
  function triGrid(k) {
    if (!W.tgrid) W.tgrid = [];
    if (W.tgrid[k]) return W.tgrid[k];
    const t0 = W.tbase[k], t1 = k + 1 < W.nParts ? W.tbase[k + 1] : W.tri.length / 3, P = W.pos, T = W.tri, b = W.wbox[k];
    const g = Math.max(1, Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) / 48), cells = new Map();
    for (let t = t0; t < t1; t++) {
      let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
      for (let e = 0; e < 3; e++) { const v = T[t * 3 + e] * 3; lx = Math.min(lx, P[v]); hx = Math.max(hx, P[v]); ly = Math.min(ly, P[v + 1]); hy = Math.max(hy, P[v + 1]); lz = Math.min(lz, P[v + 2]); hz = Math.max(hz, P[v + 2]); }
      for (let x = Math.floor(lx / g); x <= Math.floor(hx / g); x++) for (let y = Math.floor(ly / g); y <= Math.floor(hy / g); y++) for (let z = Math.floor(lz / g); z <= Math.floor(hz / g); z++) {
        const key = gkey(x, y, z); let L = cells.get(key); if (!L) cells.set(key, (L = [])); L.push(t);
      }
    }
    return (W.tgrid[k] = { g, cells });
  }
  function trisNear(k, c, r) {
    const G = triGrid(k), g = G.g, out = new Set();
    for (let x = Math.floor((c[0] - r) / g); x <= Math.floor((c[0] + r) / g); x++) for (let y = Math.floor((c[1] - r) / g); y <= Math.floor((c[1] + r) / g); y++) for (let z = Math.floor((c[2] - r) / g); z <= Math.floor((c[2] + r) / g); z++) { const L = G.cells.get(gkey(x, y, z)); if (L) for (const t of L) out.add(t); }
    return out;
  }
  function tempBall(id, op, color) {
    const out = [], q = [0, 0, 0];
    for (let k = 0; k < W.nParts; k++) {
      if (W.ids[k] !== id) continue;
      const c = toWorld(k, op.p[0], op.p[1], op.p[2]), r = op.r * W.scl[k], r2 = r * r, t0 = W.tbase[k], t1 = k + 1 < W.nParts ? W.tbase[k + 1] : W.tri.length / 3;
      const inside = (x, y, z) => (x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2 <= r2;
      const cam = op.v ? root.worldToLocal(vp.camera.position.clone()) : null, nn = new THREE.Vector3();
      const eMin = Math.max(0.2, r / 5);
      void t0; void t1;
      for (const t of trisNear(k, c, r)) {
        const A = [];
        for (let e = 0; e < 3; e++) { const v = W.tri[t * 3 + e] * 3; A.push(W.pos[v], W.pos[v + 1], W.pos[v + 2]); }
        let far = false;
        for (let a = 0; a < 3 && !far; a++) { const mn = Math.min(A[a], A[a + 3], A[a + 6]), mx = Math.max(A[a], A[a + 3], A[a + 6]); if (c[a] < mn - r || c[a] > mx + r) far = true; }
        if (far) continue;
        // Circle brush: skip the sides facing away from you
        if (cam) { triNormal(t, nn); const cx = (A[0] + A[3] + A[6]) / 3, cy = (A[1] + A[4] + A[7]) / 3, cz = (A[2] + A[5] + A[8]) / 3, l = Math.hypot(cam.x - cx, cam.y - cy, cam.z - cz) || 1; if ((nn.x * (cam.x - cx) + nn.y * (cam.y - cy) + nn.z * (cam.z - cz)) / l < 0.05) continue; }
        const rec = (B, d) => {
          const L = Math.max(Math.hypot(B[3] - B[0], B[4] - B[1], B[5] - B[2]), Math.hypot(B[6] - B[3], B[7] - B[4], B[8] - B[5]), Math.hypot(B[0] - B[6], B[1] - B[7], B[2] - B[8]));
          const ins = [inside(B[0], B[1], B[2]), inside(B[3], B[4], B[5]), inside(B[6], B[7], B[8])], cin = inside((B[0] + B[3] + B[6]) / 3, (B[1] + B[4] + B[7]) / 3, (B[2] + B[5] + B[8]) / 3);
          if (d >= 8 || L <= eMin || (L <= r * 1.4 && ins[0] === cin && ins[1] === cin && ins[2] === cin)) { if (cin) out.push(...B); return; }
          const m = (i, j) => [(B[i] + B[j]) / 2, (B[i + 1] + B[j + 1]) / 2, (B[i + 2] + B[j + 2]) / 2];
          const a = B.slice(0, 3), b = B.slice(3, 6), cc = B.slice(6, 9), ab = m(0, 3), bc = m(3, 6), ca = m(6, 0);
          rec([...a, ...ab, ...ca], d + 1); rec([...ab, ...b, ...bc], d + 1); rec([...ca, ...bc, ...cc], d + 1); rec([...ab, ...bc, ...ca], d + 1);
        };
        rec(A, 0);
      }
    }
    void q;
    tempOverlay(out, color);
  }
  const tempTris = (set, color) => tempOverlay(faceTris((t) => set.has(t)), color);
  // what the pointer is over: the triangle, the point and the surface direction (plate coordinates)
  function pickHit(e) {
    const t = pickTri(e);
    if (t < 0) return null;
    const h = vp.pick(e, [pickMesh])[0];
    return { t, p: h ? root.worldToLocal(h.point.clone()) : new THREE.Vector3(), n: triNormal(t) };
  }
  // the preview under the pointer for each paint tool
  let hoverKey = "";
  function hoverFace(t, h) {
    if (t < 0 || !W || !st.paintTool) { if (hoverKey) { disposeGroup(hoverG); hoverKey = ""; vp.request(); } return; }
    const tool = st.paintTool, er = st.erasing || tool === "erase";
    const part = W.owner[t];
    const col = er ? st.slots[st.slotOf.get(W.ids[part]) ?? 0]?.color : st.slots[st.brush]?.color;
    if (tool === "brush" && h) {
      disposeGroup(hoverG); hoverKey = "b";
      const r = st.brushR, g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.9, r, 48), new THREE.MeshBasicMaterial({ color: er ? "#ffffff" : col || "#888", side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.95 }));
      const disk = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 48), new THREE.MeshBasicMaterial({ color: col || "#888", side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthTest: false }));
      g.add(ring, disk);
      g.position.copy(h.p).addScaledVector(h.n, 0.05);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), h.n);
      g.renderOrder = 6; ring.renderOrder = 6; disk.renderOrder = 6;
      hoverG.add(g);
      vp.request();
      return;
    }
    if (tool === "height" && h) {
      disposeGroup(hoverG); hoverKey = "h";
      const bx = W.wbox[part], z0 = Math.max(0, h.p.z - st.bandH / 2), z1 = h.p.z + st.bandH / 2, pad = 0.6;
      const m = new THREE.Mesh(new THREE.BoxGeometry(bx.max.x - bx.min.x + pad * 2, bx.max.y - bx.min.y + pad * 2, z1 - z0).translate((bx.min.x + bx.max.x) / 2, (bx.min.y + bx.max.y) / 2, (z0 + z1) / 2), new THREE.MeshBasicMaterial({ color: col || "#888", transparent: true, opacity: 0.35, depthWrite: false }));
      const ed = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: col || "#888" }));
      hoverG.add(m, ed);
      vp.request();
      return;
    }
    const key = tool + ":" + (tool === "fill" ? "p" + part : tool === "smart" || tool === "bucket" ? "t" + t + ":" + st.smartAng + ":" + st.fillAng + ":" + st.smartStop + st.smartSeed + ":" + st.pv : W.tface[t] >= 0 ? "f" + part + ":" + W.tface[t] : "t" + t) + ":" + col;
    if (key === hoverKey) return;
    disposeGroup(hoverG); hoverKey = key;
    const seedAt = () => (h ? slotAtW(t, h.p.x, h.p.y, h.p.z) : slotAtW(t, ...triCentre(t)));
    const set = tool === "fill" ? null : tool === "bucket" ? colourRegion(t, seedAt(), st.fillAng) : tool === "smart" ? (st.smartStop ? colourRegion(t, seedAt(), st.smartAng, st.smartSeed && h ? h.n : null) : st.smartSeed && h ? smartSeedRegion(t, h.n) : smartRegion(t)) : faceRegion(t);
    hoverG.add(overlayMesh(faceTris(set ? (q) => set.has(q) : (q) => W.owner[q] === part), col || "#888", 0.75));
    vp.request();
  }
  // one stroke of the current paint tool at the pointer; true when something changed
  function paintAt(h) {
    if (!h || !W) return false;
    const t = h.t, k = W.owner[t], id = W.ids[k], tool = st.paintTool;
    const er = st.erasing || tool === "erase", s = er ? -1 : st.brush;
    const bodyCol = st.slots[st.slotOf.get(id) ?? 0]?.color || "#888", col = s < 0 ? bodyCol : st.slots[s]?.color || "#888";
    if (tool === "fill") {
      if (st.slotOf.get(id) === st.brush && !st.paint.has(id) && !st.ops.has(id)) return false;
      st.slotOf.set(id, st.brush); st.paint.delete(id); st.ops.delete(id); st.pv++;
      return true;
    }
    const local = (set) => { const out = new Set(); for (const q of set) out.add(q - W.tbase[k]); return out; };
    if (tool === "brush") {
      const p = toLocal(k, h.p.x, h.p.y, h.p.z), r = st.brushR / W.scl[k];
      const last = st.lastBall;
      if (last && last.id === id && Math.hypot(p[0] - last.p[0], p[1] - last.p[1], p[2] - last.p[2]) < r * 0.3) return false;
      const op = { k: "ball", p, r, s };
      // Circle (Orca's default): only the surfaces facing you, not through to the far side
      if (st.brushMode !== "sphere") {
        const cam = root.worldToLocal(vp.camera.position.clone()), dir = cam.clone().sub(h.p).normalize();
        const q2 = toLocal(k, h.p.x + dir.x, h.p.y + dir.y, h.p.z + dir.z), v = [q2[0] - p[0], q2[1] - p[1], q2[2] - p[2]], l = Math.hypot(...v) || 1;
        op.v = v.map((x) => x / l);
      }
      pushOp(id, op); st.lastBall = { id, p };
      tempBall(id, op, col);
      return true;
    }
    if (tool === "height") {
      const e = W.mats[k];
      pushOp(id, { k: "band", n: [e[2], e[6], e[10]], o: e[14], z0: h.p.z - st.bandH / 2, z1: h.p.z + st.bandH / 2, s });
      return true;
    }
    // Paint can: the connected area of the clicked colour, ending exactly at other colours
    if (tool === "bucket" || (tool === "smart" && st.smartStop)) {
      const seed = slotAtW(t, h.p.x, h.p.y, h.p.z), to = s < 0 ? st.slotOf.get(id) ?? 0 : s;
      if (seed === to) { app.toast(`That area is already F${to + 1}.`); return false; }
      if (tool === "smart" && st.smartSeed) {
        const region = colourRegion(t, seed, st.smartAng, h.n);
        pushOp(id, { k: "fill", t: local(region), s, keep: seed });
        tempTris(region, col);
        return true;
      }
      const R = fillRegion(t, h.p, seed, tool === "bucket" ? st.fillAng : st.smartAng);
      if (!R) return false;
      pushOp(id, { k: "fill", t: R.tris, sub: R.sub, s, keep: seed });
      tempTris(R.world, col);
      return true;
    }
    const region = tool === "smart" ? (st.smartSeed ? smartSeedRegion(t, h.n) : smartRegion(t)) : faceRegion(t);
    const key = id + ":" + tool + ":" + (W.tface[t] >= 0 && tool !== "smart" ? W.tface[t] : t);
    if (st.lastFace === key) return false;
    st.lastFace = key;
    pushOp(id, { k: "tris", t: local(region), s });
    if (er && W.tface[t] >= 0) { const m = st.paint.get(id); if (m) { m.delete(W.tface[t]); if (!m.size) st.paint.delete(id); } }
    tempTris(region, col);
    return true;
  }
  // tool changers: the parked toolheads behind the plate (the one printing leaves its dock)
  const dockG = new THREE.Group();
  root.add(dockG);
  function buildDocks() {
    disposeGroup(dockG);
    const T = toolsOf(), P = PRINTERS[st.printer];
    if (T.kind !== "heads" || T.lr) return;
    ensureSlots();
    const n = T.heads, gap = Math.min(30, (P.w - 20) / n);
    for (let h = 0; h < n; h++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(gap * 0.6, 10, 14).translate(0, 0, 7), new THREE.MeshStandardMaterial({ color: 0x8a939e, metalness: 0.3, roughness: 0.5 }));
      const band = new THREE.Mesh(new THREE.BoxGeometry(gap * 0.62, 10.4, 3).translate(0, 0, 10), new THREE.MeshStandardMaterial({ color: st.slots[h]?.color || "#888", roughness: 0.5 }));
      g.add(body, band);
      g.position.set(-((n - 1) * gap) / 2 + h * gap, P.d / 2 + 14, 0);
      g.userData.head = h;
      dockG.add(g);
    }
    dockG.userData.at = (h) => dockG.children[h] ? dockG.children[h].position : null;
  }
  const toolLabel = (sl) => {
    const T = toolsOf();
    return T.kind === "heads" ? `${headName(headOf(sl))} · F${sl + 1}` : T.kind === "mmu" ? `F${sl + 1}` : "";
  };
  // the prime tower, beside the parts (grows with the layer slider)
  const towerG = new THREE.Group();
  root.add(towerG);
  function buildTower(plan) {
    disposeGroup(towerG);
    if (!plan || !plan.towerH || !W) return;
    const P = PRINTERS[st.printer], side = plan.towerSide;
    const x = Math.min(P.w / 2 - side / 2 - 5, W.size.x / 2 + 12 + side / 2), y = Math.min(P.d / 2 - side / 2 - 5, Math.max(-P.d / 2 + side / 2 + 5, W.size.y / 2 - side / 2));
    const m = new THREE.Mesh(new THREE.BoxGeometry(side, side, plan.towerH).translate(x, y, plan.towerH / 2), new THREE.MeshStandardMaterial({ color: 0x9aa4ae, transparent: true, opacity: 0.55, roughness: 0.8, clippingPlanes: [clip] }));
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x5f6b77, clippingPlanes: [clip] }));
    towerG.add(m, e);
    towerG.userData.box = new THREE.Box3().setFromObject(m);
  }

  // ------------------------------------------------------------ after slicing
  function finishSlice() {
    disposeGroup(layG);
    if (S.lines.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(S.lines, 3));
      g.setAttribute("color", new THREE.BufferAttribute(S.cols, 3));
      layG.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true })));
    }
    st.layerMax = S.nL - 1;
    refreshPlan();
    buildStrength();
    applyView();
    renderPanel();
  }
  // strength map: thin walls, weak (narrow) layers, unsupported overhangs and layer direction
  function buildStrength() {
    disposeGroup(strG);
    const { pos, tri, nT } = W;
    const nL = S.nL, lh = S.lh;
    // narrow layers, per part: much smaller cross-section than the part both below and above
    const weakO = S.areaO.map((ar) => {
      const wl = new Float32Array(nL);
      const maxA = Math.max(...ar);
      for (let k = 1; k < nL - 2; k++) {
        if (!(ar[k] > 0.01)) continue;
        let below = 0, above = 0;
        for (let d = 1; d <= 12; d++) { if (k - d >= 0) below = Math.max(below, ar[k - d]); if (k + d < nL) above = Math.max(above, ar[k + d]); }
        const ref = Math.min(below, above);
        if (ref > ar[k]) wl[k] = Math.max(0, Math.min(1, (1 - ar[k] / ref) * 1.4 - 0.2));
        if (ar[k] < 0.03 * maxA && above > 4 * ar[k]) wl[k] = Math.max(wl[k], 0.8);
      }
      return wl;
    });
    const thin = new Map();
    for (const [x, y, z] of S.thin) thin.set(`${Math.round(z / lh - 0.5)}|${Math.round(x / 1.5)}|${Math.round(y / 1.5)}`, 1);
    const colors = new Float32Array(pos.length), score = new Float32Array(pos.length / 3);
    const green = [0.2, 0.75, 0.35], yellow = [0.98, 0.8, 0.15], red = [0.92, 0.18, 0.16];
    const mix = (s) => (s < 0.5 ? green.map((g, i) => g + (yellow[i] - g) * s * 2) : yellow.map((g, i) => g + (red[i] - g) * (s - 0.5) * 2));
    for (let v = 0; v < pos.length / 3; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const k = Math.min(nL - 1, Math.max(0, Math.floor(z / lh)));
      const weakLayer = weakO[W.vowner[v]];
      let s = Math.max(weakLayer[k], k > 0 ? weakLayer[k - 1] : 0);
      for (let dk = -1; dk <= 1 && s < 1; dk++) for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (thin.has(`${k + dk}|${Math.round(x / 1.5) + di}|${Math.round(y / 1.5) + dj}`)) s = Math.max(s, 0.95);
      score[v] = s;
    }
    // unsupported overhangs sag: mark them when supports are off
    if (st.supports === "none") for (let t = 0; t < nT; t++) if (A.over[t]) for (let e = 0; e < 3; e++) { const v = tri[t * 3 + e]; score[v] = Math.max(score[v], 0.7); }
    for (let v = 0; v < score.length; v++) { const c = mix(score[v]); colors[v * 3] = c[0]; colors[v * 3 + 1] = c[1]; colors[v * 3 + 2] = c[2]; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.setIndex(new THREE.BufferAttribute(tri, 1));
    g.computeVertexNormals();
    strG.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide })));
    // the weakest layer, drawn as a ring
    let wk = -1, wv = 0.35, wo = 0;
    weakO.forEach((wl, o) => { for (let k = 0; k < nL; k++) if (wl[k] > wv) { wv = wl[k]; wk = k; wo = o; } });
    S.weakLayer = wk >= 0 ? { k: wk, z: (wk + 0.5) * lh, area: S.areaO[wo][wk], name: W.names[wo] } : null;
    S.thinCount = S.thin.length;
    // outline the weakest layer in red
    if (S.weakLayer) {
      const sg = S.segs[S.weakLayer.k], z = (S.weakLayer.k + 0.5) * lh, pts = [];
      for (let i = 0; i < sg.length; i += 4) pts.push(new THREE.Vector3(sg[i], sg[i + 1], z), new THREE.Vector3(sg[i + 2], sg[i + 3], z));
      const ring = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff1a1a, depthTest: false }));
      ring.renderOrder = 20;
      strG.add(ring);
    }
    if (S.thin.length) {
      const pts = S.thin.slice(0, 4000).map(([x, y, z]) => new THREE.Vector3(x, y, z));
      strG.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), new THREE.PointsMaterial({ color: 0xff2d55, size: 5, sizeAttenuation: false, depthTest: false })));
    }
  }
  // the print time, worked out like Orca Slicer: the same moves the G-code would have, timed
  // with the printer's speeds, accelerations and corner (jerk) limits; the print animation's
  // timeline is scaled to match, layer by layer
  function supFor() { return st.supports !== "none" && A && A.cols && A.cols.length ? { cols: A.cols, sp: st.supports === "tree" ? 3 : 2 } : null; }
  function planTime() {
    if (!S || !S.lines || !S.base) return null;
    const key = [st.printer, st.filament, st.speed, st.pattern, st.smooth, st.skirt, st.brim, st.retract, st.zhop, st.supports, A ? A.cols.length : 0, S.lines.length, lastPlan ? lastPlan.changes : 0].join("|");
    if (S._est && S._estKey === key) return S._est;
    let r;
    try { r = makeGcode(S, supFor(), gcodeOptions(), { estimate: true }); } catch (e) { console.warn("time estimate", e); return null; }
    S._est = r; S._estKey = key;
    // rescale the slicer's rough line times so each layer takes as long as the planner says
    const B = S.base, n = B.cum.length, cum = new Float64Array(n);
    let li = 0, t = 0;
    for (let k = 0; k < S.nL; k++) {
      const end = (B.layerEnd[k] || 0) / 2, t0 = li ? B.cum[li - 1] : 0, span = (end ? B.cum[end - 1] : 0) - t0, f = span > 0 ? r.layerT[k] / span : 0;
      for (let i = li; i < end; i++) { cum[i] = t + (B.cum[i] - t0) * f; }
      t += r.layerT[k]; li = end;
    }
    B.cum = cum; B.total = t; S.printTotal = t;
    applyOrder(lastPlan);
    return r;
  }
  function estimates() {
    const fil = FILAMENTS[st.filament], flow = FLOW[st.filament] || 12;
    const L = S ? S.len : null;
    const sec = LW * st.layer;
    const modelVol = L ? Object.values(L).reduce((a, b) => a + b, 0) * sec : 0;
    const vol = modelVol + (A ? A.supVol : 0);
    const speeds = SPEEDS;
    let t = 0;
    if (L) for (const [k, len] of Object.entries(L)) t += len / Math.min(speeds[k], flow / sec);
    t += (A ? A.supVol : 0) / Math.min(flow, 150 * sec) ;
    if (S) t += S.nL * 4; // layer changes and travel
    const grams = (vol * fil.rho) / 1000;
    const meters = vol / (Math.PI * 0.875 * 0.875) / 1000;
    const pt = planTime();
    if (pt) t = pt.secs;
    else if (S && S.total) t = (S.printTotal ?? S.total) + (A ? A.supVol : 0) / Math.min(flow, 150 * sec);
    return { vol, grams, meters, secs: t, profile: pt ? pt.profile : "", slowed: pt ? pt.slowed : 0 };
  }

  // ------------------------------------------------------------ show
  function applyView() {
    const v = st.view;
    plateG.visible = true;
    towerG.visible = v !== "strength";
    paintG.visible = tmpG.visible = v === "model";
    dockG.visible = v === "layers";
    supG.visible = v !== "strength" && st.supports !== "none";
    ovG.visible = v === "model";
    layG.visible = v === "layers" && !!S;
    strG.visible = v === "strength" && !!S;
    scene.state.simHide = new Set(v === "model" ? hiddenOthers() : store.doc.bodies.map((b) => b.id));
    scene.state.pose = W ? new Map(W.pose) : new Map();
    scene.refresh();
    buildCopies();
    copyG.visible = v === "model";
    selG.visible = v !== "strength";
    drawSel();
    if (layG.visible) setLayer(st.layerMax); else clip.constant = 1e9;
    if (slider) slider.hidden = v !== "layers" || !S;
    legend();
    vp.request();
  }
  const hiddenOthers = () => store.doc.bodies.filter((b) => !st.ids.includes(b.id)).map((b) => b.id);
  function layerSpan(k) {
    if (!S || !S.cum) return [0, 0];
    const i0 = k ? (S.layerEnd[k - 1] || 0) / 2 : 0, i1 = (S.layerEnd[k] || 0) / 2;
    return [i0 ? S.cum[i0 - 1] : 0, i1 ? S.cum[i1 - 1] : 0];
  }
  function vLabel(k) {
    const t = slider && slider.querySelector("#ps-vtop");
    if (t) t.innerHTML = S ? `<b>${k + 1}</b><span>${fmt((k + 1) * S.lh, 2)}</span>` : "";
    const b = slider && slider.querySelector(".psv-bot");
    if (b) b.textContent = S ? `${S.nL} layers` : "";
    const tr = slider && slider.querySelector(".psv-track");
    if (tr && tr.clientHeight) tr.style.setProperty("--psvh", Math.max(60, tr.clientHeight - 18) + "px");
  }
  function setLayer(k) {
    st.layerMax = Math.max(0, Math.min(S ? S.nL - 1 : 0, k));
    clip.constant = st.view === "layers" && S ? (st.layerMax + 1) * S.lh + 1e-3 : 1e9;
    const ls = layG.children[0];
    if (ls && S) ls.geometry.setDrawRange(0, S.layerEnd[st.layerMax] || 0);
    if (slider) {
      slider.querySelector("#ps-layer").max = S ? S.nL - 1 : 0;
      slider.querySelector("#ps-layer").value = st.layerMax;
      slider.querySelector(".lv").textContent = S ? `Layer ${st.layerMax + 1} / ${S.nL} · ${fmt((st.layerMax + 1) * S.lh, 2)} mm` : "";
      const mv = slider.querySelector("#ps-move"); if (mv) mv.value = 1000;
      vLabel(st.layerMax);
    }
    vp.request();
  }
  function legend() {
    if (legendEl) { legendEl.remove(); legendEl = null; }
    const host = document.getElementById("viewport");
    if (st.view === "layers" && S && byFilament()) {
      const T = toolsOf();
      const plan = lastPlan;
      legendEl = el("div", { class: "pslegend" }, el("div", { class: "t" }, "Filament"), ...usedSlots().map((sl) => el("div", { class: "it" }, el("i", { style: { background: st.slots[sl].color, outline: "1px solid rgba(0,0,0,.25)" } }), "F" + (sl + 1) + (st.slots[sl].name ? " " + st.slots[sl].name : "") + (T.kind === "heads" ? " · nozzle " + headName(headOf(sl)) : "") + (plan && plan.slotGrams && plan.slotGrams.get(sl) ? ` · ${fmt(plan.slotGrams.get(sl), 1)} g` : ""))),
        plan && plan.changes ? el("div", { class: "it" }, `${plan.changes} filament changes`) : null);
    } else if (st.view === "layers" && S) {
      const L = S.len || {}, tm = {}, mo = motionFor(st.printer, PRINTERS[st.printer]) || {}, v = mo.v || SPEEDS;
      let tot = 0; for (const [k] of LEGEND) { tm[k] = (L[k] || 0) / Math.max(5, v[k] || SPEEDS[k] || 100); tot += tm[k]; }
      const clock = (x) => { x = Math.round(x); const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s2 = x % 60; return h ? `${h}h${String(m).padStart(2, "0")}m` : m ? `${m}m${String(s2).padStart(2, "0")}s` : `${s2}s`; };
      const est = estimates(), sc = tot > 0 && est.secs ? est.secs / tot : 1;
      legendEl = el("div", { class: "pslegend orca" }, el("div", { class: "t" }, el("span", {}, "Line Type"), el("span", {}, "Time"), el("span", {}, "%")),
        ...LEGEND.filter(([k]) => (L[k] || 0) > 0 || k === "outer").map(([k, l]) => el("div", { class: "it" }, el("i", { style: { background: "#" + COL[k].toString(16).padStart(6, "0") } }), el("span", { class: "nm" }, l), el("span", { class: "tm" }, clock(tm[k] * sc)), el("span", { class: "pc" }, tot ? Math.round((tm[k] / tot) * 100) + "%" : ""))),
        el("div", { class: "sum" }, el("span", {}, "Total estimated time"), el("b", {}, clock(est.secs || 0))),
        el("div", { class: "sum" }, el("span", {}, "Filament"), el("b", {}, `${fmt(est.meters || 0, 2)} m · ${fmt(est.grams || 0, 1)} g`)));
    } else if (st.view === "strength" && S) {
      legendEl = el("div", { class: "pslegend" }, el("div", { class: "t" }, "Print strength"), el("div", { class: "it" }, el("i", { style: { background: "#33bf59" } }), "Strong"), el("div", { class: "it" }, el("i", { style: { background: "#facc26" } }), "Weaker"), el("div", { class: "it" }, el("i", { style: { background: "#eb2e29" } }), "Weak point"), el("div", { class: "it" }, el("i", { style: { background: "#ff2d55", borderRadius: "50%" } }), "Too thin to print well"));
    } else if (st.view === "model") {
      legendEl = el("div", { class: "pslegend" }, el("div", { class: "t" }, "Overhangs"), el("div", { class: "it" }, el("i", { style: { background: st.supports === "none" ? "#ff2d2d" : "#ff7a2d" } }), st.supports === "none" ? "Needs support" : "Supported"), st.supports !== "none" ? el("div", { class: "it" }, el("i", { style: { background: "#1fb85a" } }), st.supports === "tree" ? "Tree support" : "Normal support") : null);
    }
    if (legendEl) host.append(legendEl);
  }

  // ------------------------------------------------------------ run
  let pending = 0;
  function rebuild(resliceNeeded = true) {
    clearTimeout(pending);
    pending = setTimeout(() => {
      W = buildWorld();
      if (!W) { A = null; S = null; renderPanel(); applyView(); return; }
      analyse();
      if (st.refit) { st.refit = false; frame(); }
      if (resliceNeeded) { stopAnim(); S = null; disposeGroup(layG); disposeGroup(strG); slice(); }
      applyView();
      renderPanel();
    }, 60);
  }

  // the Objects section: pick an object, then turn, lay flat, scale or copy it (sim only)
  function objectBox(body) {
    body.append(el("div", { class: "subhead" }, "Objects ", el("span", { style: { fontWeight: 400, opacity: 0.7 } }, "· only in the sim")));
    if (!W) return;
    const chips = el("div", { class: "psbtns", id: "ps-objs" });
    const MAX = 16;
    W.keys.slice(0, MAX).forEach((k, i) => chips.append(el("button", { class: "btn" + (st.osel.has(k) ? " primary" : ""), id: "ps-obj-" + i, "aria-pressed": String(st.osel.has(k)), title: "Pick " + W.names[i] + " (Shift adds)", onclick: (e) => { selectKey(k, e.shiftKey); drawSel(); renderPanel(); } }, W.names[i])));
    if (W.keys.length > MAX) chips.append(el("span", { class: "hint", style: { padding: "4px" } }, `+${W.keys.length - MAX} more`));
    body.append(chips);
    const qs = selInst();
    if (!qs.length) {
      body.append(el("div", { class: "hint", style: { padding: 0 } }, "Click an object on the plate (or its name) to turn it, lay it on a face, scale it or copy it. Drag it to move it. None of this changes your design."));
      return;
    }
    const bx = selBox(), sz = bx.isEmpty() ? null : bx.getSize(new THREE.Vector3());
    body.append(el("div", { class: "hint", id: "ps-osize", style: { padding: 0 } }, `${qs.length === 1 ? instName(qs[0]) : qs.length + " objects"} picked${sz ? ` · ${fmt(sz.x, 1)} × ${fmt(sz.y, 1)} × ${fmt(sz.z, 1)} mm` : ""}.`));
    const ang = el("input", { class: "num", type: "number", id: "ps-oang", value: st.oang, min: -360, max: 360, step: 5, style: { width: "64px" }, "aria-label": "Turn angle in degrees", onchange: (e) => { st.oang = +e.target.value || 90; } });
    ang.addEventListener("keydown", (e) => e.stopPropagation());
    body.append(row("Turn", el("div", { class: "psbtns" }, ang, el("span", { style: { alignSelf: "center" } }, "°"),
      el("button", { class: "btn", id: "ps-otx", title: "Turn around X", onclick: () => turnObj("x", st.oang) }, "X"),
      el("button", { class: "btn", id: "ps-oty", title: "Turn around Y", onclick: () => turnObj("y", st.oang) }, "Y"),
      el("button", { class: "btn", id: "ps-otz", title: "Turn around Z (flat on the plate)", onclick: () => turnObj("z", st.oang) }, "Z"))));
    const sc = el("input", { class: "num", type: "number", id: "ps-oscale", value: Math.round(qs[0].s * 1000) / 10, min: 1, max: 1000, step: 5, style: { width: "72px" }, "aria-label": "Scale in percent", onchange: (e) => scaleObj(+e.target.value) });
    sc.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") scaleObj(+sc.value); });
    body.append(row("Scale", el("div", { class: "psbtns" }, sc, el("span", { style: { alignSelf: "center" } }, "%"),
      el("button", { class: "btn", id: "ps-ohalf", onclick: () => scaleObj(qs[0].s * 50) }, "½×"),
      el("button", { class: "btn", id: "ps-odouble", onclick: () => scaleObj(qs[0].s * 200) }, "2×"))));
    const cnt = el("input", { class: "num", type: "number", id: "ps-ocount", value: 1, min: 1, max: 50, step: 1, style: { width: "56px" }, "aria-label": "How many copies" });
    cnt.addEventListener("keydown", (e) => e.stopPropagation());
    body.append(row("Copies", el("div", { class: "psbtns" }, cnt,
      el("button", { class: "btn", id: "ps-odup", title: "Add copies on the plate. Your design keeps one.", onclick: () => dupObj(+cnt.value) }, "Duplicate"))));
    const anyCopy = qs.some(isCopy);
    body.append(el("div", { class: "psbtns" },
      el("button", { class: "btn" + (st.pickFace ? " primary" : ""), id: "ps-olay", title: "Click the face of this object that should lie on the plate", onclick: () => { st.pickFace = !st.pickFace; renderPanel(); } }, "Lay on face"),
      el("button", { class: "btn", id: "ps-oreset", title: "Undo this object's turns and scale", onclick: () => resetObj() }, "Reset object"),
      el("button", { class: "btn", id: "ps-odel", title: anyCopy ? "Remove the copy from the plate" : "Take it off the plate (your design keeps it)", onclick: () => delObj() }, anyCopy ? "Remove copy" : "Take off plate"),
      el("button", { class: "btn", id: "ps-odone", onclick: () => { st.osel.clear(); st.pickFace = false; drawSel(); renderPanel(); } }, "Done")));
  }
  // ------------------------------------------------------------ panel
  let def = null;
  function renderPanel() { if (def && app.command === def) def.render(); }
  function open() {
    // another design: paint, mixes and feature filaments belong to the last one
    if (st.docId !== store.doc.id) {
      st.docId = store.doc.id;
      st.paint.clear(); st.ops.clear(); st.feat = { walls: -1, sparse: -1, solid: -1 }; st.autoMsg = ""; st.mixUI.open = false; st.mixUI.dres = null;
      for (const i of mixSlots()) removeMix(i);
      // v2.9.9.9.11: and so do the plate turn and the objects' places (they turned the next design too)
      st.R = new THREE.Matrix4(); st.inst = []; st.osel.clear(); st.copyN = 0; st.undo = []; st.pickFace = false; st.refit = true;
    }
    st.ids = targetIds();
    document.body.classList.add("ps-orca");
    root.visible = true;
    vp.grid.visible = false;
    buildPlate();
    buildDocks();
    def = {
      title: "3D Print Sim",
      okLabel: "Done",
      keepSelection: true,
      noEnter: true,
      wide: true,
      ok() { closeCmd(false); },
      hint: () => st.paintTool === "bucket" ? `Paint can with F${st.brush + 1}: click an area to fill it up to other colours. Shift-click erases, Ctrl-click picks a colour, Ctrl+Z undoes.` : st.paintTool === "brush" ? `Brush (${st.brushR} mm) with F${st.brush + 1}: click or drag over the model. Shift-drag erases. Drag empty space to turn the view.` : st.paintTool === "smart" ? `Smart fill with F${st.brush + 1}: click a surface; it fills until an edge sharper than ${st.smartAng}°. Shift-click erases.` : st.paintTool === "height" ? `Height range with F${st.brush + 1}: click the model to paint a ${st.bandH} mm band all the way round. Shift-click erases.` : st.paintTool === "paint" ? `Painting with F${st.brush + 1}: click or drag over faces. Shift erases. Drag empty space to turn the view.` : st.paintTool === "fill" ? `Click a body to print it all with F${st.brush + 1}.` : st.paintTool === "erase" ? "Click painted faces to remove their paint." : st.pickFace ? "Click the face that should lie on the plate." : st.osel.size ? "Drag the picked object to move it. Turn, scale or copy it on the right. Click empty space to let go." : "Click an object to turn, scale or copy it (only in the sim). Then check the layers and Export G-code.",
      build(body0) {
        const P = PRINTERS[st.printer];
        // laid out like Orca Slicer: Printer, Filament and Process (with its tabs), then the plate
        const card = (id, title, ...extra) => { const c = el("section", { class: "pscard", id: "ps-card-" + id }, el("div", { class: "pscard-h" }, el("i", { class: "pscard-dot" }), el("b", {}, title), ...extra)); body0.append(c); return c; };
        let body = card("plate", EXT.size ? "Plate: " + (st.extName || "colour lithophane") : "Plate");
        // open STL / 3MF files straight into the sim, like a slicer
        body.append(el("div", { class: "psbtns" },
          el("button", { class: "btn", id: "ps-import", title: "Open STL or 3MF files to slice here, without adding them to your design. 3MF projects from Bambu Studio, Orca Slicer and PrusaSlicer keep their filament colours and colour painting.", onclick: () => pickImport() }, "📂 Open STL / 3MF…"),
          el("button", { class: "btn", id: "ps-save3mf", disabled: !W, title: "Save the plate as a 3MF project: the objects as placed, their filaments and colour painting, and every setting. Opens again here, in Orca Slicer and in Bambu Studio.", onclick: () => saveProject() }, "💾 Save project (.3mf)"),
          el("button", { class: "btn", id: "ps-savestl", disabled: !W, title: "Export everything on the plate as one STL, placed as it prints (no colours or settings)", onclick: () => exportSTL() }, "⬇ Export plate as STL"),
          st.extKind === "import" ? el("button", { class: "btn", id: "ps-import-back", onclick: () => { st.extKind = ""; clearExternal(); } }, "↩ Back to my design") : null));
        if (st.extKind === "import" && st.importNotes) body.append(el("div", { class: "hint", id: "ps-import-info", style: { padding: 0 } }, st.importNotes + ". You can paint, mix and slice it here; it isn't added to your design."));
        const nm = st.ids.map((id) => bodyOf(id)?.name).filter(Boolean);
        body.append(el("div", { class: "hint", style: { padding: 0 } }, `${nm.length ? nm.length === 1 ? nm[0] : nm.length + (EXT.size ? " parts" : " bodies") : "Nothing"} on the plate. Nothing here changes your design.`));
        if (litho()) body.append(el("div", { class: "hint", style: { padding: 0 } }, "Full colour: each part prints with its own filament, so the colour layers change filament as they go up, like Orca Slicer printing a colour lithophane. ", el("button", { class: "linkbtn", id: "ps-ext-back", onclick: () => clearExternal() }, "Back to my design")));
        if (app.colorLitho) body.append(el("button", { class: "btn", id: "ps-litho", title: "Color Lithophane Studio: a photo becomes a full-colour lithophane printed with white, cyan, magenta and yellow, then sliced here", onclick: () => app.colorLitho.open() }, "🖼 Color lithophane…"));
        const solids = EXT.size ? [] : store.doc.bodies.filter((b) => !b.hole);
        if (solids.length > 1) {
          const pl = el("div", { class: "psplate" }, el("div", { class: "subhead", style: { margin: "0 0 3px" } }, "On the plate"));
          for (const b of solids) {
            const cb = el("input", { type: "checkbox", id: "plate-" + b.id, checked: st.ids.includes(b.id), onchange: (e) => {
              const ids = e.target.checked ? [...st.ids, b.id] : st.ids.filter((x) => x !== b.id);
              st.ids = solids.map((x) => x.id).filter((id) => ids.includes(id));
              stopAnim(); st.refit = true; rebuild();
            } });
            const lab = el("label", { class: "check platenode" }, cb, el("span", { class: "sw", style: { background: b.color || "#a7b0ba" } }), el("span", { class: "pn" }, b.name));
            // which filament this body prints with (like Orca's per-object filament)
            if (st.ids.includes(b.id) && (multiOK() || st.slots.length > 1)) {
              ensureSlots();
              const cur = st.slotOf.get(b.id) ?? 0;
              const fs = el("select", { class: "num psfil", id: "ps-slot-" + b.id, "aria-label": "Filament for " + b.name, title: "Which filament prints this body" },
                ...st.slots.map((q, i) => q.dead ? null : el("option", { value: i, selected: i === cur, style: { background: q.color, color: lightText(q.color) } }, "F" + (i + 1) + (q.mix ? " (mix)" : ""))).filter(Boolean),
                el("option", { value: "new" }, "+ New"));
              fs.style.background = st.slots[cur]?.color || "";
              fs.style.color = lightText(st.slots[cur]?.color);
              fs.onclick = (e) => e.stopPropagation();
              fs.onchange = () => {
                if (fs.value === "new") { st.slots.push({ color: nextFilColor() }); st.slotOf.set(b.id, st.slots.length - 1); }
                else st.slotOf.set(b.id, +fs.value);
                filamentsChanged();
              };
              lab.append(fs);
            }
            pl.append(lab);
          }
          body.append(pl);
        }
        body = card("printer", "Printer", el("span", { class: "pscard-sub", title: "Printers, process settings and print times follow Orca Slicer 2.5.1" }, "Orca Slicer 2.5.1"));
        // printers grouped by brand
        const groups = new Map();
        for (const [k, p] of Object.entries(PRINTERS)) { if (!groups.has(p.brand)) groups.set(p.brand, []); groups.get(p.brand).push([k, p]); }
        const psel = el("select", { class: "num", id: "ps-printer" }, ...[...groups].map(([brand, list]) => {
          const g = document.createElement("optgroup"); g.label = brand;
          for (const [k, p] of list) g.append(el("option", { value: k, selected: k === st.printer }, `${p.name.replace(brand + " ", "")} (${p.round ? "Ø" + p.w : p.w + "×" + p.d}×${p.h})`));
          return g;
        }));
        psel.onchange = () => { st.printer = psel.value; buildPlate(); filamentsChanged(); };
        body.append(row("Printer", psel, "ps-printer"));
        body.append(el("div", { class: "hint pstools", id: "ps-tools", style: { padding: 0 } }, toolText(P)));
        body = card("filament", "Filament");
        const fsel = el("select", { class: "num", id: "ps-fil" }, ...Object.entries(FILAMENTS).map(([k, m]) => el("option", { value: k, selected: k === st.filament }, m.name)));
        fsel.onchange = () => { st.filament = fsel.value; if (S) buildStrength(); renderPanel(); applyView(); };
        body.append(row("Material", fsel, "ps-fil"));
        // the filaments: one per toolhead / spool slot. Pick a color for each, pick one as the
        // paint brush, and paint faces of the model with it (like Orca's color painting)
        ensureSlots();
        refreshMixColors();
        const used = usedSlots();
        if (used.length > 1 || multiOK()) {
          const plan = lastPlan;
          const T = toolsOf();
          const declared = declaredSlots(false);
          const fl = el("div", { class: "psfils", id: "ps-fils", role: "radiogroup", "aria-label": "Filaments (paint brush)" });
          const pick = (sl) => { st.brush = sl; if (!st.paintTool || st.paintTool === "erase") st.paintTool = "brush"; st.view = "model"; applyView(); renderPanel(); };
          const show = physSlots().filter((i, r) => r < slotCap() || used.includes(i) || declared.includes(i));
          for (const sl of show) {
            const q = st.slots[sl];
            const ci = el("input", { type: "color", value: toHex(q.color), id: "ps-fc-" + sl, title: "Filament color", onclick: (e) => e.stopPropagation(), oninput: (e) => { q.color = e.target.value; refreshMixColors(); lineColors(); buildPaint(); }, onchange: () => filamentsChanged() });
            const where = T.kind === "heads" ? `nozzle ${headName(headOf(sl))}` : T.kind === "mmu" ? `${T.sys} slot ${sl + 1}` : sl === (used[0] ?? 0) ? "the nozzle" : "swap by hand";
            const g = plan && plan.slotGrams.get(sl);
            const on = !!st.paintTool && st.paintTool !== "erase" && st.brush === sl;
            const rowEl = el("div", { class: "psfrow" + (on ? " on" : "") + (used.includes(sl) ? "" : " idle"), id: "ps-frow-" + sl, role: "radio", "aria-checked": on ? "true" : "false", tabindex: 0, title: "Paint with F" + (sl + 1), onclick: () => pick(sl) },
              ci, el("b", {}, "F" + (sl + 1)), el("span", {}, q.ink || q.name ? `${q.name} · ${where}` : where), el("i", {}, g ? fmt(g, 1) + " g" : used.includes(sl) ? "" : "not used"));
            fl.append(rowEl);
          }
          const canAdd = !litho() && !cmykOn() && physSlots().length < (T.kind === "single" ? 8 : Math.min(T.slots, 24));
          body.append(el("div", { class: "subhead" }, `Filaments (${used.length} used)`), fl);
          if (canAdd) fl.append(el("button", { class: "btn psadd", id: "ps-addfil", onclick: () => { st.slots.push({ color: nextFilColor() }); st.brush = st.slots.length - 1; renderPanel(); } }, "+ Add filament"));
          // ---- color mixing (Orca Slicer 2.5)
          const canMix = multiOK() && !litho() && !cmykOn() && physSlots().filter((i) => !st.slots[i].ink).length >= 2;
          if (canMix) {
            const mu = st.mixUI, pool = loadedPool(), all = physSlots().filter((i) => !st.slots[i].ink);
            const mixes = mixSlots();
            const mbox = el("div", { class: "psmix", id: "ps-mixes" });
            mbox.append(el("div", { class: "subhead" }, "Mixed filaments", el("span", { class: "pscard-sub" }, " Orca Slicer 2.5")));
            for (const sl of mixes) {
              const q = st.slots[sl], m = q.mix, on = !!st.paintTool && st.paintTool !== "erase" && st.brush === sl;
              mbox.append(el("div", { class: "psfrow psmixrow" + (on ? " on" : "") + (declared.includes(sl) ? "" : " idle"), id: "ps-frow-" + sl, role: "radio", "aria-checked": on ? "true" : "false", tabindex: 0, title: "Paint with mixed filament F" + (sl + 1), onclick: () => pick(sl) },
                el("i", { class: "psmixsw", style: { background: mixCss(m) } }), el("b", {}, "F" + (sl + 1)), el("span", {}, mixText(m)),
                el("button", { class: "linkbtn", id: "ps-mixdel-" + sl, title: "Remove this mix (what uses it goes back to F" + (m.of[0] + 1) + ")", onclick: (e) => { e.stopPropagation(); removeMix(sl); filamentsChanged(); } }, "✕")));
            }
            if (!mixes.length) mbox.append(el("div", { class: "hint", style: { padding: 0 } }, "Blend new colors from the filaments you have: a mix prints as its filaments in alternating layers, which blend by eye (thin layers blend best)."));
            mbox.append(el("div", { class: "psbtns" },
              el("button", { class: "btn" + (mu.open ? " primary" : ""), id: "ps-mixnew", onclick: () => { mu.open = !mu.open; if (mu.open) { mu.a = all[0]; mu.b = all[1]; } renderPanel(); } }, "+ Mixed filament"),
              el("button", { class: "btn", id: "ps-automix", title: "Match every body's color to a loaded filament, or to a new mix of them when none is close", onclick: () => autoColorMix() }, "Auto color mix")));
            if (st.autoMsg) mbox.append(el("div", { class: "hint", id: "ps-automsg", style: { padding: 0 } }, st.autoMsg));
            if (mu.open) {
              if (!all.includes(mu.a)) mu.a = all[0];
              if (!all.includes(mu.b) || mu.b === mu.a) mu.b = all.find((i) => i !== mu.a);
              if (mu.c >= 0 && (!all.includes(mu.c) || mu.c === mu.a || mu.c === mu.b)) mu.c = -1;
              const fsel = (id, v, none, on) => { const s = el("select", { class: "num", id, onchange: (e) => { on(+e.target.value); renderPanel(); } }, ...(none ? [el("option", { value: -1, selected: v < 0 }, "None")] : []), ...all.map((i) => el("option", { value: i, selected: i === v, style: { background: st.slots[i].color, color: lightText(st.slots[i].color) } }, "F" + (i + 1)))); if (v >= 0) { s.style.background = st.slots[v].color; s.style.color = lightText(st.slots[v].color); } return s; };
              const ed = el("div", { class: "psmixed", id: "ps-mixedit" });
              ed.append(row("Filament A", fsel("ps-mixa", mu.a, false, (v) => { mu.a = v; }), "ps-mixa"));
              ed.append(row("Filament B", fsel("ps-mixb", mu.b, false, (v) => { mu.b = v; }), "ps-mixb"));
              ed.append(row("Filament C", fsel("ps-mixc", mu.c, true, (v) => { mu.c = v; }), "ps-mixc"));
              const three = mu.c >= 0;
              if (three) mu.r2 = Math.min(mu.r2, 100 - mu.r);
              const of = three ? [mu.a, mu.b, mu.c] : [mu.a, mu.b];
              const w = three ? [mu.r, mu.r2, Math.max(0, 100 - mu.r - mu.r2)] : [mu.r, 100 - mu.r];
              if (!mu.grad) {
                ed.append(sliderRow(three ? "A" : "A : B", "ps-mixr", mu.r, 5, 95, 5, "%", (v) => { mu.r = v; clearTimeout(st.mixT); st.mixT = setTimeout(() => renderPanel(), 200); }));
                if (three) ed.append(sliderRow("B", "ps-mixr2", mu.r2, 5, 90, 5, "%", (v) => { mu.r2 = v; clearTimeout(st.mixT); st.mixT = setTimeout(() => renderPanel(), 200); }));
              }
              ed.append(el("label", { class: "check", title: "Shift from the first filament to the last as the print rises" }, el("input", { type: "checkbox", id: "ps-mixgrad", checked: mu.grad, onchange: (e) => { mu.grad = e.target.checked; renderPanel(); } }), "Gradient (bottom to top)"));
              const prev = { of, w: w.map((x) => x / 100), grad: mu.grad };
              ed.append(el("div", { class: "psmixprev" }, el("i", { class: "psmixsw big", id: "ps-mixprev", style: { background: mixCss(prev) } }), el("span", {}, mu.grad ? mixText(prev) : mixText(prev) + " (" + mixHex(prev) + ")"),
                el("button", { class: "btn primary", id: "ps-mixadd", onclick: () => { const i = addMix(of, w, mu.grad); if (i != null) { st.brush = i; mu.open = false; } filamentsChanged(); } }, "Add mix")));
              // recommended mixes: every pair of loaded filaments half and half
              const rec = [];
              for (let x = 0; x < pool.length; x++) for (let y = x + 1; y < pool.length; y++) rec.push([pool[x], pool[y]]);
              if (rec.length) ed.append(el("div", { class: "subhead" }, "Recommended"), el("div", { class: "psmixrec" }, ...rec.slice(0, 10).map(([a, b], n) => el("button", { class: "psmixsw rec", id: "ps-mixrec-" + n, title: `F${a + 1} + F${b + 1}, 50/50: add this mix`, style: { background: mixHex({ of: [a, b], w: [0.5, 0.5] }) }, onclick: () => { const i = addMix([a, b], [1, 1]); if (i != null) st.brush = i; filamentsChanged(); } }))));
              // decompose color: the mix of loaded filaments closest to a color
              const dc = el("input", { type: "color", id: "ps-decomp-c", value: mu.dc, oninput: (e) => { mu.dc = e.target.value; } });
              ed.append(el("div", { class: "subhead" }, "Decompose color"), el("div", { class: "psbtns" }, dc, el("button", { class: "btn", id: "ps-decomp", title: "Find the mix of loaded filaments that comes closest to this color", onclick: () => { mu.dres = decompose(mu.dc, pool); renderPanel(); } }, "Find mix")));
              if (mu.dres) {
                const d = mu.dres;
                ed.append(el("div", { class: "psmixprev", id: "ps-decomp-r" }, el("i", { class: "psmixsw", style: { background: mu.dc } }), el("span", {}, "→"), el("i", { class: "psmixsw", style: { background: d.hex } }),
                  el("span", {}, d.of.length === 1 ? `F${d.of[0] + 1} is closest` : mixText({ of: d.of, w: d.w })),
                  d.of.length > 1 ? el("button", { class: "btn", id: "ps-decomp-add", onclick: () => { const i = addMix(d.of, d.w); if (i != null) { st.brush = i; mu.open = false; } mu.dres = null; filamentsChanged(); } }, "Add") : null));
              }
              mbox.append(ed);
            }
            body.append(mbox);
          }
          // full color from CMYK (+ white)
          const cm = st.cmyk;
          if (!litho()) {
          body.append(el("label", { class: "check", title: "Mix any color from cyan, magenta, yellow, black and white filaments, changing filament layer by layer" }, el("input", { type: "checkbox", id: "ps-cmyk", checked: cmykOn(), onchange: (e) => { cm.on = e.target.checked; if (cm.on) ensureInks(); MIX.clear(); filamentsChanged(); renderPanel(); } }), "Full color (CMYK)"));
          if (cmykOn()) {
            ensureInks();
            body.append(row("Mix over", seg([[4, "4 layers"], [6, "6 layers"], [8, "8 layers"]], cm.n, (v) => { cm.n = v; MIX.clear(); filamentsChanged(); renderPanel(); }, "ps-cmyk-n")));
            body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ps-cmyk-surf", checked: cm.surf, onchange: (e) => { cm.surf = e.target.checked; filamentsChanged(); renderPanel(); } }), "Color the outside only (inner walls and infill in white)"));
            const targets = declaredSlots(false).filter((i) => st.slots[i] && !st.slots[i].ink);
            const list = el("div", { class: "pscmyk", id: "ps-cmyk-list" });
            for (const i of targets) {
              const m = mixFor(st.slots[i].color), pct = m.inks.map((s, q) => [st.slots[s].ink, m.counts[q]]).filter((x) => x[1]).map(([k, c]) => `${k} ${Math.round((c / cm.n) * 100)}%`).join(" · ");
              list.append(el("div", { class: "pscmyk-row", title: "Wanted color → what the mix looks like" }, el("span", { class: "sw", style: { background: toHex(st.slots[i].color) } }), el("span", {}, "→"), el("span", { class: "sw", style: { background: m.hex } }), el("span", { class: "pscmyk-pct" }, pct)));
            }
            body.append(list);
            const n = inkSlots().length;
            body.append(el("div", { class: "hint", style: { padding: 0 } }, `${n === 5 ? "Load cyan, magenta, yellow, black and white" : "This printer has 4 spaces: load cyan, magenta, yellow and black"} (F${inkSlots()[0] + 1}-F${inkSlots()[n - 1] + 1}). Each color is mixed over ${cm.n} layers, so use thin layers (0.08-0.12 mm): the layers blend by eye. It changes filament often, so expect more time and purge.${lastPlan ? ` This print: ${lastPlan.changes} changes, ${fmt((lastPlan.flushVol || 0) / 1000 * 1.24, 1)} g purged.` : ""}`));
          }
          }
          // ---- color painting (Orca Slicer 2.5 tools)
          if (!litho()) {
            body.append(el("div", { class: "subhead" }, "Color painting"));
            body.append(seg([["off", "Off"], ["brush", "Brush"], ["bucket", "Paint can"], ["smart", "Smart fill"], ["paint", "Faces"], ["height", "Height range"], ["fill", "Whole body"], ["erase", "Erase"]], st.paintTool || "off", (v) => { st.paintTool = v === "off" ? null : v; if (st.paintTool) { st.view = "model"; applyView(); } hoverFace(-1); renderPanel(); }, "ps-paint"));
            if (st.paintTool === "brush") {
              body.append(row("Brush", seg([["circle", "Circle"], ["sphere", "Sphere"]], st.brushMode, (v) => { st.brushMode = v; renderPanel(); }, "ps-brushmode")));
              body.append(sliderRow("Brush size", "ps-brushr", st.brushR, 0.2, 20, 0.1, " mm", (v) => { st.brushR = v; }));
            }
            if (st.paintTool === "bucket") body.append(sliderRow("Stop at edges sharper than", "ps-fillang", st.fillAng, 5, 180, 5, "°", (v) => { st.fillAng = v; hoverKey = ""; }));
            if (st.paintTool === "smart") {
              body.append(sliderRow("Smart fill angle", "ps-smartang", st.smartAng, 1, 90, 1, "°", (v) => { st.smartAng = v; hoverKey = ""; }));
              body.append(el("label", { class: "check", title: "Don't spread over other colours: it stops at your brush strokes, exactly" }, el("input", { type: "checkbox", id: "ps-smartstop", checked: st.smartStop, onchange: (e) => { st.smartStop = e.target.checked; hoverKey = ""; } }), "Stop at other colours"));
              body.append(el("label", { class: "check", title: "Measure the angle from the spot you click, not from each neighbour: on rounded, organic shapes it stays on one side instead of running all the way round" }, el("input", { type: "checkbox", id: "ps-smartseed", checked: st.smartSeed, onchange: (e) => { st.smartSeed = e.target.checked; hoverKey = ""; } }), "Measure from the clicked spot (rounded shapes)"));
            }
            if (st.paintTool === "height") body.append(sliderRow("Band height", "ps-bandh", st.bandH, 0.2, 40, 0.2, " mm", (v) => { st.bandH = v; }));
            const nOps = [...st.ops.values()].reduce((a, o) => a + o.length, 0);
            const H = { bucket: `Click an area to pour F${st.brush + 1} over it: it spreads over everything of the colour you click and stops exactly at other colours. Outline a detail (an eye, a stripe) with the Brush first, then pour inside it.`, brush: st.brushMode === "sphere" ? `Click or drag to paint a ${st.brushR} mm ball with F${st.brush + 1}: it paints right through thin parts.` : `Click or drag to paint a ${st.brushR} mm circle with F${st.brush + 1} on the surfaces facing you (not through to the back). Alt + scroll changes the size.`, paint: `Click or drag over faces to paint them with F${st.brush + 1}.`, smart: `Click a surface: it fills with F${st.brush + 1} until it meets an edge sharper than ${st.smartAng}°.`, height: `Click the model: everything in a ${st.bandH} mm band at that height prints with F${st.brush + 1} (great for stripes).`, fill: `Click a body to print all of it with F${st.brush + 1}.`, erase: "Click painted faces to give them back their body's filament." };
            body.append(el("div", { class: "hint", style: { padding: 0 } }, st.paintTool ? H[st.paintTool] + (st.paintTool !== "fill" && st.paintTool !== "erase" ? " Hold Shift to erase, Ctrl-click (⌘-click) to pick up a colour, Ctrl+Z to undo. Painted areas print their walls and skins in that filament." : "") : "Pick a filament (or a mix), then paint the model with it, like Orca Slicer's color painting.",
              st.paintTool ? el("button", { class: "linkbtn", id: "ps-eyedrop", title: "Click this, then click the model to paint with the colour that's there", onclick: () => { st.eyedrop = true; app.toast("Click the model to pick up its colour."); } }, " ⦿ Pick colour") : null,
              st.undo.length ? el("button", { class: "linkbtn", id: "ps-pundo", onclick: () => undoPaint() }, " ↶ Undo") : null,
              st.paint.size || nOps ? el("button", { class: "linkbtn", id: "ps-clearpaint", onclick: () => { st.paint.clear(); st.ops.clear(); filamentsChanged(); } }, " Clear all paint") : null));
          }
        }
        const proc = card("process", "Process", el("span", { class: "pscard-sub" }, "Global"));
        const TABS = [["quality", "Quality"], ["strength", "Strength"], ["speed", "Speed"], ["support", "Support"], ["multi", "Multimaterial"], ["others", "Others"], ["objects", "Objects"]];
        if (!TABS.some(([k]) => k === st.ptab)) st.ptab = "quality";
        proc.append(el("div", { class: "pstabs", role: "tablist", "aria-label": "Process settings" }, ...TABS.map(([k, l]) => el("button", { role: "tab", id: "ps-tab-" + k, "aria-selected": String(st.ptab === k), onclick: () => { st.ptab = k; renderPanel(); } }, l))));
        const pane = (k) => { const d = el("div", { class: "pstab", id: "ps-pane-" + k, role: "tabpanel" }); if (st.ptab !== k) d.hidden = true; proc.append(d); return d; };
        const savedHint = (t) => el("div", { class: "hint", style: { padding: 0 } }, t || "Saved in the project (.3mf) and the G-code for Orca Slicer; the sim's preview doesn't draw it.");
        const pick = (id, label, opts, val, on, tip) => row(label, el("select", { class: "num", id, title: tip || "", onchange: (e) => on(e.target.value) }, ...opts.map(([k, n]) => el("option", { value: k, selected: String(val) === String(k) }, n))), id);
        const check = (id, label, val, on, tip) => el("label", { class: "check", title: tip || "" }, el("input", { type: "checkbox", id, checked: !!val, onchange: (e) => on(e.target.checked) }), label);
        body = pane("quality");
        body.append(el("div", { class: "subhead" }, "Layer height"));
        body.append(row("Layer height", seg([[0.08, "0.08"], [0.1, "0.10"], [0.12, "0.12"], [0.16, "0.16"], [0.2, "0.20"], [0.24, "0.24"], [0.28, "0.28"]], st.layer, (v) => { st.layer = v; rebuild(); }, "ps-lh")));
        body.append(row("First layer height", seg([[0.12, "0.12"], [0.16, "0.16"], [0.2, "0.20"], [0.24, "0.24"], [0.28, "0.28"], [0.3, "0.30"]], st.firstLayer, (v) => { st.firstLayer = v; renderPanel(); }, "ps-flh")));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, `Line width ${LW} mm (0.4 mm nozzle). ${st.layer <= 0.1 ? "Fine layers: smooth, and what colour lithophanes need, but slow." : st.layer >= 0.28 ? "Draft layers: quick, with visible steps." : "Standard quality."}`));
        body.append(el("div", { class: "subhead" }, "Seam"));
        body.append(pick("ps-seam", "Seam position", [["aligned", "Aligned"], ["nearest", "Nearest"], ["back", "Back"], ["random", "Random"]], st.seam, (v) => { st.seam = v; }, "Where each wall loop starts and ends: Aligned lines the seams up into one neat line, Back hides it at the back, Random scatters it"));
        body.append(el("div", { class: "subhead" }, "Ironing"));
        body.append(pick("ps-iron", "Ironing type", [["no ironing", "No ironing"], ["top", "Top surfaces"], ["topmost", "Topmost surface"], ["solid", "All solid layers"]], st.ironing, (v) => { st.ironing = v; renderPanel(); }, "A second, nearly dry pass of the hot nozzle over the top to smooth it"));
        if (st.ironing !== "no ironing") {
          body.append(sliderRow("Ironing flow", "ps-ironflow", st.ironFlow, 0, 50, 1, "%", (v) => { st.ironFlow = v; }));
          body.append(sliderRow("Ironing line spacing", "ps-ironsp", st.ironSpacing, 0.05, 0.4, 0.01, " mm", (v) => { st.ironSpacing = v; }));
          body.append(sliderRow("Ironing speed", "ps-ironv", st.ironSpeed, 10, 100, 1, " mm/s", (v) => { st.ironSpeed = v; }));
          body.append(el("div", { class: "hint", style: { padding: 0 } }, "Ironing is in the G-code (;TYPE:Ironing) and the print time; it adds a pass over each top surface."));
        }
        body.append(el("div", { class: "subhead" }, "Wall generator"));
        body.append(pick("ps-wallgen", "Wall generator", [["arachne", "Arachne"], ["classic", "Classic"]], st.wallGen, (v) => { st.wallGen = v; }, "Arachne varies the line width in thin parts; Classic keeps it fixed"));
        body.append(savedHint());
        body = pane("strength");
        body.append(el("div", { class: "subhead" }, "Walls"));
        body.append(row("Wall loops", seg([[1, "1"], [2, "2"], [3, "3"], [4, "4"]], st.walls, (v) => { st.walls = v; rebuild(); }, "ps-walls")));
        body.append(check("ps-thinwall", "Detect thin walls", st.thinWalls, (v) => { st.thinWalls = v; }, "Print walls too thin for two lines as one line"));
        body.append(el("div", { class: "subhead" }, "Top / bottom shells"));
        body.append(pick("ps-toppat", "Top surface pattern", [["monotonicline", "Monotonic line"], ["monotonic", "Monotonic"], ["zig-zag", "Rectilinear"], ["alignedrectilinear", "Aligned Rectilinear"], ["concentric", "Concentric"], ["hilbertcurve", "Hilbert Curve"], ["archimedeanchords", "Archimedean Chords"], ["octagramspiral", "Octagram Spiral"]], st.topPat, (v) => { st.topPat = v; }));
        body.append(pick("ps-botpat", "Bottom surface pattern", [["monotonic", "Monotonic"], ["monotonicline", "Monotonic line"], ["zig-zag", "Rectilinear"], ["alignedrectilinear", "Aligned Rectilinear"], ["concentric", "Concentric"], ["hilbertcurve", "Hilbert Curve"]], st.botPat, (v) => { st.botPat = v; }));
        body.append(check("ps-onewall", "Only one wall on top surfaces", st.oneWallTop, (v) => { st.oneWallTop = v; }));
        body.append(savedHint("Surface patterns, thin walls and one top wall are saved in the project for Orca Slicer; the sim lays top and bottom skins as straight lines."));
        body.append(row("Top layers", seg([[2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"]], st.topN, (v) => { st.topN = v; rebuild(); }, "ps-topn")));
        body.append(row("Bottom layers", seg([[2, "2"], [3, "3"], [4, "4"], [5, "5"]], st.botN, (v) => { st.botN = v; rebuild(); }, "ps-botn")));
        body.append(el("div", { class: "subhead" }, "Sparse infill"));
        body.append(sliderRow("Infill density", "ps-infill", st.infill, 0, 100, 5, "%", (v) => { st.infill = v; clearTimeout(st.infT); st.infT = setTimeout(() => rebuild(), 350); }));
        { const sel = el("select", { class: "num", id: "ps-pattern", onchange: (e) => { st.pattern = e.target.value; rebuild(); } }, ...INFILL_PATTERNS.map(([k, n]) => el("option", { value: k, selected: st.pattern === k }, n)));
          body.append(row("Sparse infill pattern", sel, "ps-pattern")); }
        body.append(sliderRow("Sparse infill smooth factor", "ps-smooth", st.smooth, 0, 100, 5, "%", (v) => { st.smooth = v; clearTimeout(st.smT); st.smT = setTimeout(() => renderPanel(), 300); }));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "New in Orca Slicer 2.5: the smooth factor rounds the turns between infill lines into curves, so the head keeps its speed (watch the print time). 0 % is the old sharp path."));
        body = pane("speed");
        body.append(el("div", { class: "subhead" }, "Speed"));
        body.append(row("Speed", seg(SPEED_PRESETS.map(([k, n]) => [k, n]), st.speed, (v) => { st.speed = v; renderPanel(); }, "ps-speedp")));
        { const mo = motionFor(st.printer, P) || {}, v = mo.v || SPEEDS, f = (SPEED_PRESETS.find((q) => q[0] === st.speed) || [0, 0, 1])[2];
          body.append(el("div", { class: "pskv", id: "ps-speeds" }, el("div", { class: "pskv-h" }, mo.name || "Standard profile"),
            ...[["Outer wall", v.outer], ["Inner wall", v.inner], ["Sparse infill", v.sparse], ["Internal solid infill", v.solid], ["Top surface", v.top], ["Bridge", v.bridge], ["Support", v.support], ["Travel", mo.travel]].filter((q) => q[1]).map(([k, x]) => el("div", {}, el("span", {}, k), el("b", {}, Math.round(x * (k === "Travel" ? 1 : f)) + " mm/s"))),
            mo.first ? el("div", {}, el("span", {}, "First layer"), el("b", {}, `${mo.first.wall} / ${mo.first.infill} mm/s`)) : null,
            mo.acc ? el("div", {}, el("span", {}, "Acceleration"), el("b", {}, `${mo.acc.def} mm/s² (outer wall ${mo.acc.outer || mo.acc.def})`)) : null)); }
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Speeds of a standard 0.20 mm profile for this printer; the preset scales them, and the print time follows the printer's accelerations, like Orca Slicer."));
        body = pane("support");
        body.append(el("div", { class: "subhead" }, "Supports"));
        body.append(row("Type", seg([["none", "None"], ["normal", "Normal"], ["tree", "Tree"]], st.supports, (v) => { st.supports = v; rebuild(false); }, "ps-sup")));
        body.append(sliderRow("Overhang limit", "ps-thr", st.threshold, 10, 80, 1, "°", (v) => { st.threshold = v; clearTimeout(st.thrT); st.thrT = setTimeout(() => rebuild(false), 250); }));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Surfaces that lean out more than this from upright need support under them. 45° is the rule of thumb for most printers."));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ps-plate", checked: st.plateOnly, onchange: (e) => { st.plateOnly = e.target.checked; rebuild(false); } }), "On build plate only"));
        body.append(pick("ps-supz", "Top Z distance", [[0.1, "0.10 mm"], [0.15, "0.15 mm"], [0.2, "0.20 mm"], [0.25, "0.25 mm"], [0.3, "0.30 mm"]], st.supZ, (v) => { st.supZ = +v; }, "Gap between the support and the part above it: bigger peels off easier, smaller leaves a neater underside"));
        body.append(el("div", { class: "subhead" }, "Raft"));
        body.append(row("Raft layers", seg([[0, "None"], [2, "2"], [3, "3"], [4, "4"]], st.raft, (v) => { st.raft = v; renderPanel(); }, "ps-raft")));
        body.append(savedHint("Top Z distance and the raft are saved in the project for Orca Slicer; the sim's supports keep one layer's gap."));
        body = pane("multi");
        if (!multiOK() || litho()) body.append(el("div", { class: "hint", style: { padding: 0 } }, litho() ? "The colour lithophane sets its own filaments." : "This printer has one nozzle and one filament. Pick a printer with an AMS, CFS or more toolheads to print in several filaments."));
        else {
          const T = toolsOf(), opts = st.slots.map((q, i) => (q.dead || q.ink ? null : i)).filter((i) => i != null);
          const fsel = (key, label, tip) => {
            const v = featOK(st.feat[key]);
            const s2 = el("select", { class: "num", id: "ps-feat-" + key, title: tip, onchange: (e) => { st.feat[key] = +e.target.value; filamentsChanged(); } },
              el("option", { value: -1, selected: v < 0 }, "Default"), ...opts.map((i) => el("option", { value: i, selected: i === v, style: { background: st.slots[i].color, color: lightText(st.slots[i].color) } }, "F" + (i + 1) + (isMix(i) ? " (mix)" : ""))));
            if (v >= 0) { s2.style.background = st.slots[v].color; s2.style.color = lightText(st.slots[v].color); }
            return row(label, s2, "ps-feat-" + key);
          };
          body.append(el("div", { class: "subhead" }, "Filament for features"));
          body.append(fsel("walls", "Walls", "Filament for every wall that isn't painted"));
          body.append(fsel("sparse", "Sparse infill", "Filament for the sparse infill inside (a cheap or leftover filament saves the good one)"));
          body.append(fsel("solid", "Solid infill", "Filament for solid infill and top / bottom skins that aren't painted"));
          body.append(el("div", { class: "hint", style: { padding: 0 } }, "Default prints each feature with its object's own filament (as in Orca Slicer 2.5). Painted areas keep their paint."));
          body.append(el("div", { class: "subhead" }, "Prime tower"));
          body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ps-tower", checked: st.tower, onchange: (e) => { st.tower = e.target.checked; filamentsChanged(); } }), "Enable prime tower"));
          if (st.tower) body.append(sliderRow("Width", "ps-towerw", st.towerW || (T.kind === "heads" ? 25 : 35), 15, 60, 1, " mm", (v) => { st.towerW = v; clearTimeout(st.twT); st.twT = setTimeout(() => filamentsChanged(), 300); }));
          body.append(el("div", { class: "hint", style: { padding: 0 } }, st.tower ? "The tower is sized from the real filaments, so mixes don't make it bigger." : "Without a tower the nozzle can ooze the old color onto the part after a change."));
          body.append(el("div", { class: "subhead" }, "Flushing volumes"));
          body.append(sliderRow("Flush multiplier", "ps-flushmul", st.flushMul, 0.3, 2, 0.1, "×", (v) => { st.flushMul = v; clearTimeout(st.fmT); st.fmT = setTimeout(() => filamentsChanged(), 300); }));
          const us = usedSlots().filter((i) => st.slots[i] && !isMix(i));
          if (us.length > 1 && us.length <= 8) {
            const tb = el("table", { class: "psflush", id: "ps-flush" }, el("tr", {}, el("th", {}, "From ↓ To →"), ...us.map((j) => el("th", {}, el("i", { class: "sw", style: { background: st.slots[j].color } }), "F" + (j + 1)))),
              ...us.map((i) => el("tr", {}, el("th", {}, el("i", { class: "sw", style: { background: st.slots[i].color } }), "F" + (i + 1)), ...us.map((j) => el("td", {}, i === j ? "–" : String(Math.round(flushVolume(st.slots[i].color, st.slots[j].color) * st.flushMul)))))));
            body.append(tb, el("div", { class: "hint", style: { padding: 0 } }, `mm³ purged when changing from one filament to another${T.kind === "heads" ? " on a shared nozzle (own nozzles only prime)" : ""}: more going from dark to light.`));
          }
        }
        body = pane("objects");
        body.append(el("div", { class: "subhead" }, "Orientation"));
        body.append(el("div", { class: "psbtns" },
          el("button", { class: "btn" + (st.pickFace ? " primary" : ""), id: "ps-lay", title: "Click the face of an object that should lie on the plate", onclick: () => { st.pickFace = !st.pickFace; renderPanel(); } }, "Lay on face"),
          el("button", { class: "btn", id: "ps-auto", title: "Turn everything on the plate so it needs the least support", onclick: () => autoOrient() }, "Auto orient"),
          el("button", { class: "btn", id: "ps-rx", onclick: () => rotate("x") }, "Rotate X"),
          el("button", { class: "btn", id: "ps-ry", onclick: () => rotate("y") }, "Rotate Y"),
          el("button", { class: "btn", id: "ps-arrange", title: "Pack every object neatly on the plate", onclick: () => arrange() }, "Arrange"),
          el("button", { class: "btn", id: "ps-reset", title: "Undo every turn, scale, move and copy made in the sim", onclick: () => resetAll() }, "Reset")));
        objectBox(body);
        body = pane("others");
        body.append(el("div", { class: "subhead" }, "Bed adhesion"));
        body.append(row("Skirt loops", seg([[0, "None"], [1, "1"], [2, "2"], [3, "3"]], st.skirt, (v) => { st.skirt = v; renderPanel(); }, "ps-skirt")));
        if (st.skirt > 0) {
          body.append(sliderRow("Skirt distance", "ps-skirtd", st.skirtDist, 0, 20, 0.5, " mm", (v) => { st.skirtDist = v; }));
          body.append(sliderRow("Skirt height", "ps-skirth", st.skirtH, 1, 10, 1, " layers", (v) => { st.skirtH = v; }));
        }
        body.append(pick("ps-brimtype", "Brim type", [["auto_brim", "Auto"], ["brim_ears", "Mouse ear"], ["outer_only", "Outer brim only"], ["no_brim", "No-brim"]], st.brimType, (v) => { st.brimType = v; if (v !== "no_brim" && v !== "auto_brim" && !st.brim) st.brim = 5; renderPanel(); }, "Auto adds a brim only to parts that stand tall on a small footprint"));
        if (st.brimType !== "no_brim") {
          body.append(sliderRow("Brim width", "ps-brim", st.brim, 0, 20, 0.5, " mm", (v) => { st.brim = v; }));
          body.append(sliderRow("Brim-object gap", "ps-brimgap", st.brimGap, 0, 2, 0.05, " mm", (v) => { st.brimGap = v; }));
        }
        body.append(pick("ps-bedtype", "Plate type", [["Cool Plate", "Cool Plate"], ["Engineering Plate", "Engineering Plate"], ["High Temp Plate", "Smooth PEI / High Temp Plate"], ["Textured PEI Plate", "Textured PEI Plate"]], st.plate, (v) => { st.plate = v; }));
        body.append(el("div", { class: "subhead" }, "Special mode"));
        body.append(pick("ps-seq", "Print sequence", [["by layer", "By layer"], ["by object", "By object"]], st.seq, (v) => { st.seq = v; }, "By object prints each object to the top before starting the next (Orca checks the clearance)"));
        body.append(check("ps-spiral", "Spiral vase", st.spiral, (v) => { st.spiral = v; rebuild(); }, "One wall that climbs in a smooth spiral, with no top and no infill: vases, lamp shades, cups"));
        if (st.spiral) body.append(el("div", { class: "hint", style: { padding: 0 } }, `Spiral vase: 1 wall, no infill, no top; the first ${st.botN} layers are the solid bottom, then the wall rises continuously (no seam).`));
        body.append(pick("ps-fuzzy", "Fuzzy skin", [["none", "None"], ["external", "Contour"], ["all", "All walls"]], st.fuzzy, (v) => { st.fuzzy = v; }, "A rough, textured outside, like a grip"));
        body.append(savedHint("Print sequence, plate type and fuzzy skin are saved in the project for Orca Slicer. Skirt, brim, spiral vase, seam and ironing are in the sim's G-code too."));
        gcodeBox(body);
        body = card("preview", "Preview");
        body.append(row("Show", seg([["model", "Model"], ["layers", "Layers"], ["strength", "Strength"]], st.view, (v) => { st.view = v; applyView(); renderPanel(); X.onView && X.onView(); }, "ps-view")));
        if (st.view === "layers") body.append(row("Color by", seg([["type", "Line type"], ["filament", "Filament"]], byFilament() ? "filament" : "type", (v) => { st.colorBy = v; lineColors(); legend(); renderPanel(); }, "ps-colorby")));
        body.append(el("button", { class: "btn primary", id: "ps-play2", style: { width: "100%" }, onclick: () => togglePlay() }, anim.playing ? "❚❚ Pause print" : "▶ Play the print"));
        body.append(el("div", { class: "hint", id: "ps-status", style: { padding: 0 } }, S ? `Sliced: ${S.nL} layers.` : W ? "Slicing…" : ""));
        body.append(el("button", { class: "btn ps-export", id: "ps-gcode2", style: { width: "100%" }, disabled: !(S && S.lines), onclick: () => exportGcode() }, "⬇ Export G-code"));
        if (W) body = card("summary", "Estimate");
        if (W) body.append(results(P));
        if (W) { const ab = adviceBox(); if (ab) body.append(ab); }
      },
      cleanup() { teardown(); X.onClose && X.onClose(); },
      handler: {
        hover(e) {
          if (st.paintTool && W) { st.erasing = !!e.shiftKey; const h = pickHit(e); hoverFace(h ? h.t : -1, h); vp.canvas.style.cursor = h ? "crosshair" : "default"; return; }
          if (!W || (!st.pickFace && st.view !== "model")) { vp.canvas.style.cursor = "default"; return; }
          vp.canvas.style.cursor = pickTri(e) >= 0 ? (st.pickFace ? "pointer" : "move") : "default";
        },
        down(e) {
          drag = null;
          if (st.paintTool && W) {
            const h = pickHit(e);
            if (!h) return false; // empty space: orbit as usual
            // Ctrl/⌘-click (or the Pick colour button) picks up the filament under the pointer
            if (e.ctrlKey || e.metaKey || st.eyedrop) { st.eyedrop = false; const sl = slotAtW(h.t, h.p.x, h.p.y, h.p.z); if (st.slots[sl]) { st.brush = sl; if (st.paintTool === "erase" || st.paintTool === "fill") st.paintTool = "brush"; renderPanel(); app.toast(`Picked F${sl + 1}.`); } return true; }
            // Shift erases with any tool, like Orca
            st.erasing = !!e.shiftKey; st.lastBall = null; st.lastFace = null;
            snapPaint();
            st.painting = true;
            const changed = paintAt(h);
            // one-click tools finish straight away
            if (["fill", "smart", "height", "bucket"].includes(st.paintTool)) { st.painting = false; if (changed) filamentsChanged(); else st.undo.pop(); }
            return true;
          }
          if (!W) return false;
          if (!st.pickFace) {
            if (st.view !== "model") return false;
            // click an object to pick it (Shift adds); drag it to move it on the plate
            const t = pickTri(e);
            if (t < 0) { if (st.osel.size) { st.osel.clear(); drawSel(); renderPanel(); } return false; }
            const k = W.owner[t];
            if (!(st.osel.has(W.keys[k]) && !e.shiftKey)) { if (e.shiftKey && st.osel.has(W.keys[k])) selectKey(W.keys[k], true); else selectPart(k, e.shiftKey); drawSel(); renderPanel(); }
            const hz = (() => { const h = vp.pick(e, [pickMesh])[0]; return h ? root.worldToLocal(h.point.clone()).z : 0; })();
            const p0 = platePt(e, hz);
            if (st.osel.size && p0) drag = { p0, z: hz, d: new THREE.Vector2(), moved: false };
            return true;
          }
          const t = pickTri(e);
          if (t < 0) return true;
          const n = new THREE.Vector3(A.nrm[t * 3], A.nrm[t * 3 + 1], A.nrm[t * 3 + 2]);
          st.pickFace = false;
          // with several objects (or one picked) only the clicked object turns, like Orca
          if (st.osel.size || hasLayout() || W.nParts > 1) {
            if (!st.osel.has(W.keys[W.owner[t]])) selectPart(W.owner[t]);
            layObj(n);
            return true;
          }
          const q = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 0, -1));
          st.R.premultiply(new THREE.Matrix4().makeRotationFromQuaternion(q));
          st.refit = true; rebuild();
          return true;
        },
        move(e) {
          if (drag) {
            const p = platePt(e, drag.z);
            if (!p) return;
            drag.d.set(p.x - drag.p0.x, p.y - drag.p0.y);
            if (drag.d.length() > 0.5) drag.moved = true;
            if (drag.moved) dragPreview(drag.d);
            return;
          }
          if (!st.painting) return;
          const h = pickHit(e);
          hoverFace(h ? h.t : -1, h);
          paintAt(h);
        },
        up() {
          if (drag) { const d = drag; drag = null; if (d.moved) { stopAnim(); moveObj(d.d.x, d.d.y); } return; }
          if (st.painting) { st.painting = false; st.lastBall = null; st.lastFace = null; filamentsChanged(); }
        },
        leave() { hoverFace(-1); },
      },
    };
    openCmd(def);
    // layer slider over the view
    const spd = el("select", { class: "num", id: "ps-speed", "aria-label": "Playback speed" }, ...PLAY_SPEEDS.map(([v, l]) => el("option", { value: v, selected: v === anim.speed }, l)));
    spd.onchange = () => { anim.speed = spd.value; };
    slider = el("div", { class: "pslayers", hidden: true },
      el("div", { class: "psplay" },
        el("button", { class: "btn primary", id: "ps-play", "aria-pressed": "false", onclick: () => togglePlay() }, "▶ Play print"),
        el("button", { class: "btn", id: "ps-restart", title: "Back to the first layer", onclick: () => { pause(); showTime(0); } }, "⏮"),
        spd,
        el("span", { class: "lv" }, ""),
        // Orca's bottom slider: the moves within the layer
        el("input", { type: "range", class: "psmove", min: 0, max: 1000, step: 1, value: 1000, id: "ps-move", "aria-label": "Moves in this layer", oninput: (e) => { pause(); if (!S || !S.cum) return; const [t0, t1] = layerSpan(st.layerMax); showTime(t0 + ((t1 - t0) * +e.target.value) / 1000); } })),
      // Orca's layer slider, up the right-hand side: the top layer shown, its number and height
      el("div", { class: "psvbar" }, el("span", { class: "psv-top", id: "ps-vtop" }, ""),
        el("div", { class: "psv-track" }, el("input", { type: "range", min: 0, max: 0, step: 1, value: 0, id: "ps-layer", "aria-label": "Layer", oninput: (e) => { pause(); if (nozzle) nozzle.visible = false; setLayer(+e.target.value); if (S && S.cum) anim.t = S.cum[Math.max(0, S.layerEnd[st.layerMax] / 2 - 1)] || 0; } })),
        el("span", { class: "psv-bot" }, "1")));
    slider.addEventListener("keydown", (e) => e.stopPropagation());
    document.getElementById("viewport").append(slider);
    rebuild();
    st.refit = true;
  }
  // look at the parts, keeping them clear of the settings panel on the right
  function frame() {
    if (!W) return;
    const s2 = W.size, cx = (W.box.min.x + W.box.max.x) / 2, cy = (W.box.min.y + W.box.max.y) / 2, hx = Math.max(10, s2.x / 2) * 1.15, hy = Math.max(10, s2.y / 2) * 1.15;
    // the settings are down the left (like Orca Slicer): leave room for them on that side
    const ext = Math.max(hx, hy) * 1.1;
    vp.fit(new THREE.Box3(new THREE.Vector3(cx - hx - ext, cy - hy, 0), new THREE.Vector3(cx + hx + ext * 0.25, cy + hy, Math.max(s2.z, 8))));
  }
  function results(P) {
    const box = el("div", { class: "simres" });
    const plan = toolPlan();
    const uw = usableWidth();
    // (a round bed: every corner of the parts' footprint must be inside the circle)
    const fits = P.round ? Math.hypot(Math.max(Math.abs(W.box.min.x), Math.abs(W.box.max.x)), Math.max(Math.abs(W.box.min.y), Math.abs(W.box.max.y))) <= P.w / 2 && W.size.z <= P.h : W.size.x <= uw && W.size.y <= P.d && W.size.z <= P.h;
    const est = estimates();
    const multi = plan && plan.used.length > 1 && plan.kind !== "single";
    if (multi) est.secs += plan.secs;
    const hh = Math.floor(est.secs / 3600), mm = Math.round((est.secs % 3600) / 60);
    box.append(el("div", { class: "simtiles" },
      el("div", { class: "simtile", title: est.profile ? `Worked out like Orca Slicer: the printer's ${est.profile} speeds, accelerations and corner limits, the travel moves, and slowing down short layers so they cool${est.slowed ? ` (${est.slowed} layers slowed)` : ""}. Warm-up and bed levelling are not included.` : "" }, el("span", {}, "Print time"), el("b", { id: "ps-time" }, S ? (hh ? `${hh} h ${mm} min` : `${mm} min`) : "…"), est.profile ? el("i", {}, "like Orca, no warm-up") : null),
      el("div", { class: "simtile" }, el("span", {}, "Filament"), el("b", { id: "ps-grams" }, S ? `${fmt(est.grams + (multi ? plan.wasteGrams : 0), 1)} g` : "…"), el("i", {}, S ? (multi ? `incl. ${fmt(plan.wasteGrams, 1)} g purge` : `${fmt(est.meters, 2)} m`) : "")),
      multi ? el("div", { class: "simtile", id: "ps-changes" }, el("span", {}, "Changes"), el("b", {}, String(plan.changes)), el("i", {}, plan.swaps ? `${plan.swaps} nozzle swap${plan.swaps === 1 ? "" : "s"}` : `${plan.flushes} purge${plan.flushes === 1 ? "" : "s"}`)) : el("div", { class: "simtile" }, el("span", {}, "Layers"), el("b", {}, S ? String(S.nL) : "…")),
      el("div", { class: "simtile" + (fits ? "" : " bad") }, el("span", {}, "Size"), el("b", { style: { fontSize: "12px" } }, `${fmt(W.size.x, 1)}×${fmt(W.size.y, 1)}×${fmt(W.size.z, 1)}`), fits ? null : el("i", {}, uw < P.w && W.size.x > uw && W.size.x <= P.w ? `Wider than ${uw} mm` : "Too big for this printer"))));
    // findings, worst first
    const notes = [];
    const fil = FILAMENTS[st.filament];
    // more than one filament: what this printer does with it
    if (plan && plan.used.length > 1) {
      const T = toolsOf(), n = plan.used.length, mins = (x) => (x >= 90 ? `${fmt(x / 60, 0)} min` : `${fmt(x, 0)} s`);
      if (T.kind === "single") {
        if (plan.mixedLayers) notes.push(["bad", `${n} filaments, but this printer has one nozzle and no filament switcher: ${plan.mixedLayers} layer${plan.mixedLayers === 1 ? " mixes" : "s mix"} colors, which only a multi-material printer can do. It would print in one color.`]);
        else notes.push(["warn", `${n} filaments: the colors only change between layers, so you can pause the print and swap the spool by hand at each change.`]);
      } else {
        if (n > T.slots) notes.push(["bad", `${n} filaments, but the ${T.sys} takes at most ${T.slots}. Put some bodies on the same filament.`]);
        if (T.kind === "mmu") notes.push([plan.wasteGrams > est.grams * 0.5 ? "warn" : "info", `${plan.changes} filament change${plan.changes === 1 ? "" : "s"} on one nozzle: each purges the old color (about ${fmt(plan.flushVol / Math.max(1, plan.flushes), 0)} mm³), ${fmt(plan.wasteGrams, 1)} g of waste with the prime tower, and adds about ${mins(plan.secs)}. Fewer layers that mix colors (or matching colors) means less waste.`]);
        else {
          const shared = plan.flushes ? ` ${plan.flushes} change${plan.flushes === 1 ? " shares" : "s share"} a nozzle with another filament and purge${plan.flushes === 1 ? "s" : ""}.` : "";
          notes.push(["good", `${plan.swaps} nozzle swap${plan.swaps === 1 ? "" : "s"}: each filament has its own ${T.lr ? "nozzle" : "toolhead"}, so only ${fmt(plan.wasteGrams, 1)} g is primed or wasted, and changes add about ${mins(plan.secs)}.${shared}`]);
          if (T.wDual && plan.heads.size > 1) notes.push([W.size.x > T.wDual ? "bad" : "info", `Both nozzles are used, so the printable width is ${T.wDual} mm (blue outline on the plate)${W.size.x > T.wDual ? `: this is ${fmt(W.size.x, 0)} mm wide. Use one nozzle, or turn the part` : ""}.`]);
        }
        if (plan.towerH) notes.push(["info", `A prime tower (${plan.towerSide}×${plan.towerSide} mm, ${fmt(plan.towerH, 1)} mm tall, gray) keeps the nozzle${T.kind === "heads" ? "s" : ""} clean between colors.`]);
      }
    } else if (multiOK() && st.ids.length > 1) notes.push(["info", `To print in more colors, give bodies different colors, or pick another filament (F1, F2…) next to each body in the list above.`]);
    { const mx = S ? declaredSlots(false).filter((i) => isMix(i)) : [];
      if (mx.length && !cmykOn()) notes.push(["info", `Mixed filament${mx.length > 1 ? "s" : ""} ${mx.map((i) => "F" + (i + 1)).join(", ")}: ${mx.map((i) => mixText(st.slots[i].mix)).join("; ")}, printed in alternating layers. Thin layers (0.08-0.12 mm) blend best; every switch is a filament change.`]); }
    if (A.overArea > 1 && st.supports === "none") notes.unshift(["bad big", `⚠ SUPPORTS ARE OFF: ${fmt(A.overArea, 0)} mm² hangs out more than ${st.threshold}° (red). This would fail. Turn on supports, or use the orientation advice below.`]);
    else if (A.overArea > 1) { const sg = (A.supVol * fil.rho) / 1000; notes.push(["ok", `${st.supports === "tree" ? "Tree" : "Normal"} supports under ${fmt(A.overArea, 0)} mm² of overhang (${sg < 0.1 ? "under 0.1" : "about " + fmt(sg, 1)} g of support).`]); }
    else notes.push(["good", "No overhangs need support in this orientation."]);
    const footprint = W.size.x * W.size.y;
    if (A.bedArea < 0.05 * footprint && W.size.z > 2.5 * Math.sqrt(Math.max(A.bedArea, 1))) notes.push(["warn", `Small contact with the plate (${fmt(A.bedArea, 0)} mm²) for its height: it may come loose. Add a brim or lay it on a bigger face.`]);
    if (S && S.weakLayer) notes.push(["warn", `Weakest layer${W.nParts > 1 ? " of " + S.weakLayer.name : ""} at ${fmt(S.weakLayer.z, 1)} mm (cross-section ${fmt(S.weakLayer.area, 1)} mm², red outline in Strength): layers split there first.`]);
    if (S && S.thinCount) notes.push(["warn", `Walls thinner than two lines (${fmt(2 * LW, 2)} mm) over about ${fmt(S.thinHeight, 1)} mm of height: weak, or may not print at all (pink dots in Strength).`]);
    notes.push(["info", `${fil.name}: layer bonds (Z) are about ${Math.round((fil.z / fil.xy) * 100)}% as strong as along the layers. Loads that pull layers apart are the weak direction.`]);
    if (fil.flexible) notes.push(["info", "TPU prints slowly; times are estimates."]);
    const ul = el("div", { class: "psnotes" }, ...notes.map(([k, t]) => el("div", { class: "psn " + k }, t)));
    box.append(ul);
    box.append(el("div", { class: "hint", style: { padding: 0 } }, "Estimates use a typical 0.4 mm nozzle profile. Your slicer's numbers will differ."));
    return box;
  }
  function pickTri(e) {
    if (!W) return -1;
    if (!pickMesh || pickMesh.userData.W !== W) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(W.pos, 3));
      g.setIndex(new THREE.BufferAttribute(W.tri, 1));
      g.computeBoundingSphere();
      pickMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      pickMesh.userData.W = W;
    }
    const h = vp.pick(e, [pickMesh])[0];
    return h ? h.faceIndex : -1;
  }
  let pickMesh = null;
  // ------------------------------------------------------------ object tools (turn, lay flat, scale, copy, move)
  // all of them change only the sim's own placement of the objects, never the bodies
  const copyG = new THREE.Group(), selG = new THREE.Group();
  root.add(copyG, selG);
  const geoCache = new Map();
  function geoOf(id, data) {
    const c = geoCache.get(id);
    if (c && c.data === data) return c.g;
    if (c) c.g.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.vertices instanceof Float32Array ? data.vertices : new Float32Array(data.vertices), 3));
    g.setIndex(new THREE.BufferAttribute(data.triangles instanceof Uint32Array ? data.triangles : new Uint32Array(data.triangles), 1));
    g.computeVertexNormals();
    geoCache.set(id, { data, g });
    return g;
  }
  // copies made in the sim are drawn here (the design has no body for them)
  function buildCopies() {
    for (const c of [...copyG.children]) { copyG.remove(c); c.material.dispose(); }
    if (!W) return;
    for (const [id, P] of W.pose) {
      const x = EXT.get(id); if (!x) continue;
      const m = new THREE.Mesh(geoOf(id, x.data), new THREE.MeshStandardMaterial({ color: x.color || "#a7b0ba", roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }));
      m.matrixAutoUpdate = false; m.matrix.copy(P); m.userData = { key: id, P, ext: true };
      copyG.add(m);
    }
    for (const { k, id, P } of W.cpose) {
      const b = bodyOf(id), v = viewOf(id);
      if (!b || !v || !v.data) continue;
      const m = new THREE.Mesh(geoOf(id, v.data), new THREE.MeshStandardMaterial({ color: b.color || "#a7b0ba", roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }));
      m.matrixAutoUpdate = false;
      m.matrix.copy(P).multiply(M4(b.m));
      m.userData = { key: W.keys[k], P };
      copyG.add(m);
    }
  }
  function selBox(keys = st.osel) {
    const bx = new THREE.Box3();
    if (W) W.keys.forEach((k, i) => { if (keys.has(k)) bx.union(W.wbox[i]); });
    return bx;
  }
  function drawSel() {
    disposeGroup(selG);
    selG.position.set(0, 0, 0);
    if (!W || !st.osel.size) { vp.request(); return; }
    const bx = selBox();
    if (bx.isEmpty()) { vp.request(); return; }
    const h = new THREE.Box3Helper(bx.expandByScalar(0.6), 0x2f7de1);
    h.material.depthTest = false; h.renderOrder = 9;
    selG.add(h);
    vp.request();
  }
  // pick the object under part k (bodies that touch are one object)
  function selectPart(k, add) {
    if (!add) st.osel.clear();
    if (k == null || k < 0 || !W) return;
    const g = W.group[k];
    W.keys.forEach((key, i) => { if (W.group[i] === g) st.osel.add(key); });
  }
  function selectKey(key, add) {
    if (!W) { st.osel = new Set([key]); return; }
    const k = W.keys.indexOf(key);
    if (k < 0) return;
    if (add && st.osel.has(key)) { const g = W.group[k]; W.keys.forEach((kk, i) => { if (W.group[i] === g) st.osel.delete(kk); }); return; }
    selectPart(k, add);
  }
  const selInst = () => st.inst.filter((q) => st.osel.has(q.key));
  // centre of the picked objects, in the space their placement X works in
  function selCentre() {
    const bx = new THREE.Box3();
    if (W) W.keys.forEach((k, i) => { if (st.osel.has(k)) bx.union(W.pre[i]); });
    return bx.isEmpty() ? new THREE.Vector3() : bx.getCenter(new THREE.Vector3());
  }
  function about(M) {
    const c = selCentre();
    return new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(M).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  }
  function applySel(G) { for (const q of selInst()) q.X.premultiply(G); st.refit = true; rebuild(); }
  function turnObj(ax, deg = st.oang) {
    if (!st.osel.size) return;
    const a = (deg * Math.PI) / 180;
    applySel(about(ax === "x" ? new THREE.Matrix4().makeRotationX(a) : ax === "y" ? new THREE.Matrix4().makeRotationY(a) : new THREE.Matrix4().makeRotationZ(a)));
  }
  function layObj(n) {
    const q = new THREE.Quaternion().setFromUnitVectors(n.clone().normalize(), new THREE.Vector3(0, 0, -1));
    applySel(about(new THREE.Matrix4().makeRotationFromQuaternion(q)));
  }
  function scaleObj(pct) {
    const qs = selInst();
    if (!qs.length || !(pct > 0)) return;
    const f = Math.max(0.01, Math.min(100, pct / 100)) / qs[0].s;
    if (Math.abs(f - 1) < 1e-6) return;
    for (const q of qs) q.s *= f;
    applySel(about(new THREE.Matrix4().makeScale(f, f, f)));
  }
  function moveObj(dx, dy) { applySel(new THREE.Matrix4().makeTranslation(dx, dy, 0)); }
  // a free place on the plate for a w × d footprint, as near as it can be to `near`
  function freeSpot(w, d, boxes, near) {
    const P = PRINTERS[st.printer], uw = usableWidth(), gap = 4;
    const hit = (x, y) => boxes.some((b) => x - w / 2 < b.max.x + gap && x + w / 2 > b.min.x - gap && y - d / 2 < b.max.y + gap && y + d / 2 > b.min.y - gap);
    let best = null;
    const step = Math.max(2, Math.min(w, d) / 4);
    for (let y = -P.d / 2 + d / 2; y <= P.d / 2 - d / 2 + 1e-6; y += step)
      for (let x = -uw / 2 + w / 2; x <= uw / 2 - w / 2 + 1e-6; x += step) {
        if (hit(x, y)) continue;
        const dist = Math.hypot(x - near.x, y - near.y);
        if (!best || dist < best.dist) best = { x, y, dist };
      }
    if (best) return new THREE.Vector2(best.x, best.y);
    // no room left: put it beside everything (the plate check will say it doesn't fit)
    const all = boxes.reduce((a, b) => a.union(b), new THREE.Box3());
    return new THREE.Vector2(all.max.x + gap + w / 2, near.y);
  }
  function dupObj(count = 1) {
    if (!W || !st.osel.size) return;
    const src = selInst(), bx = selBox();
    if (bx.isEmpty()) return;
    const w = bx.max.x - bx.min.x, d = bx.max.y - bx.min.y, ctr = bx.getCenter(new THREE.Vector3());
    const boxes = W.wbox.map((b) => b.clone());
    const made = new Set();
    count = Math.max(1, Math.min(50, Math.round(count) || 1));
    for (let n = 0; n < count; n++) {
      const at = freeSpot(w, d, boxes, ctr);
      const T = new THREE.Matrix4().makeTranslation(at.x - ctr.x, at.y - ctr.y, 0);
      for (const q of src) {
        const X = T.clone().multiply(q.X), no = ++st.copyN;
        const c = { key: q.id + "#" + no, id: q.id, X, home: X.clone(), s: q.s, hs: q.s, n: no };
        st.inst.push(c); made.add(c.key);
      }
      boxes.push(new THREE.Box3(new THREE.Vector3(at.x - w / 2, at.y - d / 2, 0), new THREE.Vector3(at.x + w / 2, at.y + d / 2, 1)));
    }
    st.osel = made;
    st.refit = true; rebuild();
    app.toast(count === 1 ? "Copied on the plate (your design still has one)." : `${count} copies on the plate (your design is unchanged).`);
  }
  function delObj() {
    const qs = selInst();
    if (!qs.length) return;
    const copies = qs.filter(isCopy), orig = qs.filter((q) => !isCopy(q));
    if (orig.length && st.ids.length - orig.length < 1 && !st.inst.some((q) => isCopy(q) && !qs.includes(q))) { app.toast("Keep at least one object on the plate.", "err"); return; }
    st.inst = st.inst.filter((q) => !copies.includes(q));
    if (orig.length) {
      // an original's copies stay: the first one takes its place on the plate
      st.ids = st.ids.filter((id) => !orig.some((q) => q.id === id) || st.inst.some((q) => q.id === id && isCopy(q)));
      for (const o of orig) {
        const i = st.inst.indexOf(o);
        const heir = st.inst.find((q) => q.id === o.id && isCopy(q));
        if (heir) { heir.key = o.id; delete heir.n; }
        st.inst.splice(i, 1);
      }
    }
    st.osel.clear();
    stopAnim(); st.refit = true; rebuild();
  }
  function resetObj() {
    for (const q of selInst()) { q.X = q.home.clone(); q.s = q.hs || 1; }
    st.refit = true; rebuild();
  }
  function resetAll() {
    st.R.identity();
    st.ids = targetIds();
    st.inst = st.inst.filter((q) => !isCopy(q));
    for (const q of st.inst) { q.X.identity(); q.home.identity(); q.s = 1; q.hs = 1; }
    st.osel.clear(); st.copyN = 0;
    st.refit = true; rebuild();
  }
  // pack every object on the plate in rows (like Orca's Arrange)
  function arrange() {
    if (!W) return;
    const groups = new Map();
    W.keys.forEach((k, i) => { const g = W.group[i]; if (!groups.has(g)) groups.set(g, { keys: [], b: new THREE.Box3() }); groups.get(g).keys.push(k); groups.get(g).b.union(W.wbox[i]); });
    const list = [...groups.values()].sort((a, b) => (b.b.max.y - b.b.min.y) - (a.b.max.y - a.b.min.y));
    const uw = usableWidth(), gap = 6;
    let x = 0, y = 0, rowD = 0, maxW = 0;
    for (const g of list) {
      const w = g.b.max.x - g.b.min.x, d = g.b.max.y - g.b.min.y;
      if (x > 0 && x + w > uw - 4) { y += rowD + gap; x = 0; rowD = 0; }
      g.at = new THREE.Vector2(x, y);
      x += w + gap; rowD = Math.max(rowD, d); maxW = Math.max(maxW, x - gap);
    }
    const totD = y + rowD;
    for (const g of list) {
      const dx = g.at.x - maxW / 2 - g.b.min.x, dy = g.at.y - totD / 2 - g.b.min.y;
      const T = new THREE.Matrix4().makeTranslation(dx, dy, 0);
      for (const k of g.keys) instOf(k).X.premultiply(T);
    }
    st.refit = true; rebuild();
    app.toast("Arranged on the plate.");
  }
  // dragging an object over the plate moves it there (shown live, sliced when let go)
  let drag = null;
  // the pointer on a level plane at height z (the height it grabbed the object at, so it follows the pointer)
  const platePt = (e, z = 0) => { const n = new THREE.Vector3(0, 0, 1).transformDirection(root.matrixWorld), o = root.localToWorld(new THREE.Vector3(0, 0, z)); const p = vp.rayPlane(e, new THREE.Plane().setFromNormalAndCoplanarPoint(n, o)); return p ? root.worldToLocal(p) : null; };
  function dragPreview(d) {
    const T = new THREE.Matrix4().makeTranslation(d.x, d.y, 0);
    for (const c of copyG.children) if (st.osel.has(c.userData.key)) { if (c.userData.ext) { c.matrix.copy(T).multiply(c.userData.P); continue; } const b = findBody(store.doc, W.ids[W.keys.indexOf(c.userData.key)]); if (b) c.matrix.copy(T).multiply(c.userData.P).multiply(M4(b.m)); }
    const pose = new Map(W.pose);
    for (const k of st.osel) if (W.pose.has(k)) pose.set(k, T.clone().multiply(W.pose.get(k)));
    scene.state.pose = pose; scene.refresh();
    selG.position.set(d.x, d.y, 0);
    ovG.visible = paintG.visible = supG.visible = false;
    vp.request();
  }
  function rotate(ax) {
    if (st.osel.size) { turnObj(ax, 90); return; }
    const m = ax === "x" ? new THREE.Matrix4().makeRotationX(Math.PI / 2) : new THREE.Matrix4().makeRotationY(Math.PI / 2);
    st.R.premultiply(m);
    st.refit = true; rebuild();
  }
  // try the main directions and the biggest flat faces; keep the one needing least support
  function autoOrient() {
    if (!W) return;
    const { pos, tri, nT } = W;
    const cand = [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)];
    // big flat faces (grouped by normal)
    const byN = new Map();
    for (let t = 0; t < nT; t++) {
      const nx = A.nrm[t * 3], ny = A.nrm[t * 3 + 1], nz = A.nrm[t * 3 + 2];
      const key = `${Math.round(nx * 50)},${Math.round(ny * 50)},${Math.round(nz * 50)}`;
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      const ar = new THREE.Vector3(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]).cross(new THREE.Vector3(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2])).length() / 2;
      const e = byN.get(key) || { n: new THREE.Vector3(nx, ny, nz), a: 0 };
      e.a += ar; byN.set(key, e);
    }
    [...byN.values()].sort((p, q) => q.a - p.a).slice(0, 8).forEach((e) => cand.push(e.n.clone().normalize()));
    const cosT = Math.cos((st.threshold * Math.PI) / 180);
    let best = null;
    for (const dn of cand) {
      const q = new THREE.Quaternion().setFromUnitVectors(dn, new THREE.Vector3(0, 0, -1));
      const Rm = new THREE.Matrix4().makeRotationFromQuaternion(q);
      const zs = new Float32Array(pos.length / 3);
      const v = new THREE.Vector3();
      let zmin = Infinity, zmax = -Infinity;
      for (let i = 0; i < zs.length; i++) { v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(Rm); zs[i] = v.z; zmin = Math.min(zmin, v.z); zmax = Math.max(zmax, v.z); }
      let over = 0, bed = 0;
      const nn = new THREE.Vector3();
      for (let t = 0; t < nT; t++) {
        nn.set(A.nrm[t * 3], A.nrm[t * 3 + 1], A.nrm[t * 3 + 2]).applyQuaternion(q);
        const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
        const a3 = a * 3, b3 = b * 3, c3 = c * 3;
        const ar = new THREE.Vector3(pos[b3] - pos[a3], pos[b3 + 1] - pos[a3 + 1], pos[b3 + 2] - pos[a3 + 2]).cross(new THREE.Vector3(pos[c3] - pos[a3], pos[c3 + 1] - pos[a3 + 1], pos[c3 + 2] - pos[a3 + 2])).length() / 2;
        const lo = Math.max(zs[a], zs[b], zs[c]) - zmin;
        if (lo < 0.05 && nn.z < -0.98) bed += ar;
        else if (-nn.z > cosT) over += ar;
      }
      const score = over - 0.5 * bed + 0.02 * (zmax - zmin) * Math.sqrt(Math.max(1, bed));
      if (!best || score < best.score - 1e-6) best = { score, Rm };
    }
    st.R.premultiply(best.Rm);
    st.refit = true; rebuild();
    app.toast("Turned to need the least support.");
  }
  function teardown() {
    stopAnim();
    document.body.classList.remove("ps-orca");
    if (banner) { banner.remove(); banner = null; }
    if (nozzle) { root.remove(nozzle); nozzle.traverse((o) => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); nozzle = null; }
    sliceJob++;
    clearTimeout(pending);
    root.visible = false;
    vp.grid.visible = true;
    disposeGroup(supG); disposeGroup(ovG); disposeGroup(layG); disposeGroup(strG);
    if (slider) { slider.remove(); slider = null; }
    if (legendEl) { legendEl.remove(); legendEl = null; }
    scene.state.simHide = new Set();
    scene.state.pose = new Map();
    scene.refresh();
    for (const c of [...copyG.children]) { copyG.remove(c); c.material.dispose(); }
    disposeGroup(selG); drag = null;
    W = null; A = null; S = null; pickMesh = null; st.pickFace = false;
    vp.request();
  }
  // ------------------------------------------------------------ the print, played back
  const PLAY_SPEEDS = [["fit", "Whole print in 30 s"], ["1", "Real time"], ["10", "10×"], ["60", "60×"], ["300", "300×"]];
  const anim = { playing: false, t: 0, speed: "fit", raf: 0, last: 0 };
  let nozzle = null;
  function makeNozzle() {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9a86a, metalness: 0.6, roughness: 0.35 });
    const tip = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.4, 20).rotateX(-Math.PI / 2).translate(0, 0, 1.2), metal);
    const block = new THREE.Mesh(new THREE.BoxGeometry(7, 7, 4).translate(0, 0, 4.4), new THREE.MeshStandardMaterial({ color: 0x8a939e, metalness: 0.4, roughness: 0.5 }));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
    g.add(tip, block, glow);
    g.userData.glow = glow;
    g.renderOrder = 10;
    return g;
  }
  function segAt(t) {
    // the last line finished by time t (binary search)
    const c = S.cum;
    let lo = 0, hi = c.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] <= t) lo = m + 1; else hi = m; }
    return lo; // lines [0, lo) are done; line lo is being printed
  }
  function showTime(t) {
    if (!S || !S.cum) return;
    anim.t = Math.max(0, Math.min(S.total, t));
    const i = segAt(anim.t), n = S.cum.length;
    const ls = layG.children[0];
    if (ls) ls.geometry.setDrawRange(0, Math.min(n, i) * 2);
    // nozzle on the line being printed (or away changing tools / purging)
    if (!nozzle) { nozzle = makeNozzle(); root.add(nozzle); }
    nozzle.visible = i < n || anim.playing;
    const L = S.lines;
    let changing = null;
    if (i < n) {
      const t0 = i ? S.cum[i - 1] : 0, pz = (S.pause && S.pause[i]) || 0;
      const sl = S.lslot ? S.lslot[i] : 0;
      nozzle.userData.glow.material.color.set(st.slots[sl]?.color || "#ffa040");
      if (pz && anim.t < t0 + pz) {
        // a tool change or purge before this line: park at the dock / purge spot
        const T = toolsOf(), P = PRINTERS[st.printer], kind = S.pkind[i];
        const dock = dockG.userData.at && dockG.userData.at(headOf(sl));
        if (kind & 1 && dock) nozzle.position.set(dock.x, dock.y - 9, L[i * 6 + 2] + 2);
        else nozzle.position.set(-P.w / 2 + 6, P.d / 2 - 6, L[i * 6 + 2] + 3);
        changing = kind & 1 ? `changing to ${headName(headOf(sl))} (F${sl + 1})` : `${T.kind === "mmu" ? "loading" : "switching to"} F${sl + 1} and purging`;
        if (ls) ls.geometry.setDrawRange(0, i * 2);
      } else {
        const f = Math.max(0, Math.min(1, (anim.t - t0 - pz) / Math.max(1e-6, S.cum[i] - t0 - pz)));
        nozzle.position.set(L[i * 6] + (L[i * 6 + 3] - L[i * 6]) * f, L[i * 6 + 1] + (L[i * 6 + 4] - L[i * 6 + 1]) * f, L[i * 6 + 2]);
        if (ls) ls.geometry.setDrawRange(0, i * 2 + (f > 0.05 ? 2 : 0));
      }
      // the head that is printing has left its dock
      const ah = headOf(sl);
      for (const d of dockG.children) d.visible = d.userData.head !== ah || !!changing;
    } else if (n) nozzle.position.set(L[(n - 1) * 6 + 3], L[(n - 1) * 6 + 4], L[(n - 1) * 6 + 5] + 5);
    st.toolNow = i < n && S.lslot && lastPlan && lastPlan.used.length > 1 ? (changing || toolLabel(S.lslot[i])) : "";
    // which layer, for the slider and the supports
    let k = 0;
    while (k < S.nL - 1 && S.layerEnd[k] <= i * 2) k++;
    st.layerMax = k;
    clip.constant = (k + 1) * S.lh + 1e-3;
    if (slider) {
      const inp = slider.querySelector("#ps-layer"); inp.max = S.nL - 1; inp.value = k;
      const clock = (x) => { x = Math.round(x); const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s2 = x % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s2).padStart(2, "0"); };
      slider.querySelector(".lv").textContent = `Layer ${k + 1} / ${S.nL} · ${fmt((k + 1) * S.lh, 2)} mm · ${clock(anim.t)} of ${clock(S.total)}` + (st.toolNow ? ` · ${st.toolNow}` : "");
      const [t0, t1] = layerSpan(k), mv = slider.querySelector("#ps-move"); if (mv) mv.value = Math.round(t1 > t0 ? ((anim.t - t0) / (t1 - t0)) * 1000 : 1000);
      vLabel(k);
    }
    vp.request();
  }
  function play() {
    if (!S || !S.cum) { app.toast("Still slicing… try again in a moment."); return; }
    if (st.view !== "layers") { st.view = "layers"; applyView(); renderPanel(); X.onView && X.onView(); }
    if (anim.t >= S.total - 1e-6) anim.t = 0;
    anim.playing = true; anim.last = performance.now();
    const step = (now) => {
      if (!anim.playing || !S) return;
      const dt = (now - anim.last) / 1000; anim.last = now;
      const k = anim.speed === "fit" ? S.total / 30 : +anim.speed;
      showTime(anim.t + dt * k);
      if (anim.t >= S.total) { anim.playing = false; playUI(); return; }
      anim.raf = requestAnimationFrame(step);
    };
    anim.raf = requestAnimationFrame(step);
    playUI();
  }
  function pause() { anim.playing = false; cancelAnimationFrame(anim.raf); playUI(); }
  function playUI() {
    const b2 = document.getElementById("ps-play2");
    if (b2) b2.textContent = anim.playing ? "❚❚ Pause print" : "▶ Play the print";
    const b = document.getElementById("ps-play");
    if (b) { b.textContent = anim.playing ? "❚❚ Pause" : "▶ Play print"; b.setAttribute("aria-pressed", anim.playing ? "true" : "false"); }
  }
  function stopAnim() { pause(); if (nozzle) nozzle.visible = false; anim.t = 0; }
  // like Orca's Preview, the layers open showing the whole print (the top layer)
  const setView = (v) => { if (v !== "layers") stopAnim(); if (v === "layers" && st.view !== "layers" && S) st.layerMax = S.nL - 1; st.view = v; applyView(); renderPanel(); };
  const layFace = () => { st.pickFace = !st.pickFace; renderPanel(); };
  const togglePlay = () => (anim.playing ? pause() : play());
  // ------------------------------------------------------------ G-code
  const temps = () => FIL_TEMPS[st.filament] || [210, 60, 100];
  function gcodeOptions() {
    const P = PRINTERS[st.printer], [tn, tb, fan] = temps(), fil = FILAMENTS[st.filament] || {};
    return {
      bed: { w: P.w, d: P.d, h: P.h, round: !!P.round }, printerName: P.name, filamentName: fil.name || st.filament, flavor: st.gflavor || flavorFor(P),
      nozzleTemp: st.nozzleT ?? tn, bedTemp: st.bedT ?? tb, fan: st.fanP ?? fan, speed: st.speed, skirt: st.skirt, brim: st.brim, retract: st.retract, zhop: st.zhop,
      walls: st.walls, infill: st.infill, pattern: st.pattern, smooth: st.smooth, topN: st.topN, botN: st.botN, supports: st.supports, lineWidth: LW, maxFlow: FLOW[st.filament] || 12, density: fil.rho || 1.24,
      motion: motionFor(st.printer, P), printerKey: st.printer, filamentKey: st.filament,
      firstLayer: st.firstLayer, seam: st.seam, ironing: st.ironing, ironFlow: st.ironFlow, ironSpacing: st.ironSpacing, ironSpeed: st.ironSpeed, spiral: st.spiral,
      brimType: st.brimType, brimGap: st.brimGap, skirtDist: st.skirtDist, skirtH: st.skirtH,
      // Orca's auto brim: a brim when the part stands tall on a small footprint
      autoBrim: A && W && A.bedArea < 0.05 * W.size.x * W.size.y && W.size.z > 2.5 * Math.sqrt(Math.max(A.bedArea, 1)) ? 5 : 0,
      config: orcaConfig(),
      // v2.9.9.9.12: what the printer's own start, tool changes and screen need
      colors: (st.slots.length ? st.slots : [{ color: "#a7b0ba" }]).map((q) => toHex(q.color)), types: (st.slots.length ? st.slots : [0]).map(() => ORCA_TYPE[st.filament] || "PLA"),
      heads: toolsOf().kind === "heads" ? toolsOf().heads : 1, nozzle: 0.4,
      machine: st.gflavor && st.gflavor !== flavorFor(P) ? genericMachine(st.gflavor, machineFor(st.printer).model) : machineFor(st.printer),
    };
  }
  // pictures of the plate for the printer's screen (PNG, like OrcaSlicer's thumbnails)
  function plateThumbs(sizes) {
    try {
      vp.render();
      const src = vp.renderer.domElement, out = [];
      for (const [w, h] of sizes) {
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const g = c.getContext("2d"), sr = src.width / src.height, tr = w / h;
        let sw = src.width, sh = src.height, sx = 0, sy = 0;
        if (sr > tr) { sw = sh * tr; sx = (src.width - sw) / 2; } else { sh = sw / tr; sy = (src.height - sh) / 2; }
        g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
        out.push({ w, h, b64: c.toDataURL("image/png").split(",")[1] });
      }
      return out;
    } catch (e) { return []; }
  }
  async function exportGcode() {
    if (!S || !S.lines) { app.toast("Wait a moment: the plate is still being sliced.", "err"); return; }
    const sup = st.supports !== "none" && A && A.cols && A.cols.length ? { cols: A.cols, sp: st.supports === "tree" ? 3 : 2 } : null;
    const go = gcodeOptions();
    go.thumbs = plateThumbs(THUMB_SIZES[st.printer] || [[48, 48], [300, 300]]);
    const r = makeGcode(S, sup, go);
    st.lastG = { secs: r.secs, grams: r.grams, meters: r.filamentMM / 1000, size: r.text.length };
    const names = st.ids.map((id) => bodyOf(id)?.name).filter(Boolean);
    const base = ((st.extName ? st.extName : names.length === 1 ? names[0] : (store.doc.name || "Plate")) + " " + PRINTERS[st.printer].name.replace(/\s*\(.*\)/, "")).replace(/[\\/:*?"<>|]+/g, "").trim();
    const bytes = new TextEncoder().encode(r.text);
    if (app.projects && app.projects.saveModel) await app.projects.saveModel(base + ".gcode", bytes);
    renderPanel();
    app.toast(`Saved ${base}.gcode: ${Math.round(r.secs / 60)} min, ${r.grams.toFixed(1)} g of filament. Copy it to the printer's SD card or USB stick, or send it with the printer's app.`);
    return r;
  }
  // ---- File: Save project (.3mf) and Export plate as STL, like Orca Slicer
  const SIM_KEYS = ["printer", "filament", "layer", "walls", "infill", "topN", "botN", "pattern", "smooth", "supports", "threshold", "plateOnly", "feat", "tower", "towerW", "flushMul",
    "gflavor", "nozzleT", "bedT", "fanP", "speed", "skirt", "brim", "retract", "zhop", "firstLayer", "seam", "ironing", "ironFlow", "ironSpacing", "ironSpeed", "spiral",
    "brimType", "brimGap", "skirtDist", "skirtH", "seq", "wallGen", "topPat", "botPat", "fuzzy", "raft", "thinWalls", "oneWallTop", "plate", "supStyle", "supZ"];
  const ORCA_TYPE = { pla: "PLA", plaplus: "PLA", petg: "PETG", abs: "ABS", asa: "ASA", nylon: "PA", pc: "PC", cfpla: "PLA-CF", cfnylon: "PA-CF", peek: "PEEK", tpu: "TPU" };
  function orcaConfig() {
    const P = PRINTERS[st.printer], T = toolsOf(), [tn, tb, fan] = temps();
    const temp = [st.nozzleT ?? tn, st.bedT ?? tb, st.fanP ?? fan];
    const fil = (st.slots.length ? st.slots : [{ color: "#a7b0ba" }]).map((q) => ({ color: toHex(q.color), type: ORCA_TYPE[st.filament] || "PLA", name: (FILAMENTS[st.filament] || {}).name, temp }));
    const us = st.slots.map((_, i) => i);
    const flush = us.length > 1 ? us.flatMap((i) => us.map((j) => String(i === j ? 0 : Math.round(flushVolume(st.slots[i].color, st.slots[j].color) * st.flushMul)))) : [];
    return orcaSettings(st, { printer: P, model: machineFor(st.printer).model, filaments: fil, flavor: st.gflavor || flavorFor(P), heads: T.kind === "heads" ? T.heads : 1, flush });
  }
  // the parts on the plate as they print (turned, scaled, moved, copied), in plate millimetres,
  // with each triangle's filament (paint: a tree of finer pieces where a stroke crosses it)
  function plateParts(withPaint) {
    if (!W) return null;
    const parts = [], P = W.pos, T = W.tri;
    for (let k = 0; k < W.nParts; k++) {
      const t0 = W.tbase[k], t1 = k + 1 < W.nParts ? W.tbase[k + 1] : W.nT, id = W.ids[k];
      const vmap = new Map(), V = [], I = new Uint32Array((t1 - t0) * 3);
      for (let t = t0; t < t1; t++) for (let e = 0; e < 3; e++) {
        const v = T[t * 3 + e];
        let n = vmap.get(v); if (n == null) { n = V.length / 3; vmap.set(v, n); V.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); }
        I[(t - t0) * 3 + e] = n;
      }
      const bodyS = st.slotOf.get(id) ?? 0, part = { name: W.names[k], V: new Float32Array(V), I, ext: bodyS + 1, paint: null, state: null, k, id };
      if (withPaint) {
        const c = opCache(id), fp = st.paint.get(id);
        if (c || (fp && fp.size)) {
          const paint = new Array(t1 - t0).fill(null), state = new Int16Array(t1 - t0);
          const at = (t, p) => slotAtW(t, p[0], p[1], p[2]);
          const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
          const pull = (a, g) => [a[0] + (g[0] - a[0]) * 0.02, a[1] + (g[1] - a[1]) * 0.02, a[2] + (g[2] - a[2]) * 0.02];
          const tree = (t, A, B, C, d) => {
            const G = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
            const sG = at(t, G);
            if (!c) return { s: sG + 1 };
            const ab = mid(A, B), bc = mid(B, C), ca = mid(C, A);
            const ss = [at(t, pull(A, G)), at(t, pull(B, G)), at(t, pull(C, G)), at(t, pull(ab, G)), at(t, pull(bc, G)), at(t, pull(ca, G))];
            const edge = Math.max(Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), Math.hypot(C[0] - B[0], C[1] - B[1], C[2] - B[2]), Math.hypot(A[0] - C[0], A[1] - C[1], A[2] - C[2]));
            if (ss.every((q) => q === sG) || d >= 6 || edge < 0.3) return { s: sG + 1 };
            // Orca / PrusaSlicer order: the corner pieces at A, B and C, then the middle one
            return { kids: [tree(t, A, ab, ca, d + 1), tree(t, ab, B, bc, d + 1), tree(t, bc, C, ca, d + 1), tree(t, ab, bc, ca, d + 1)] };
          };
          const most = (nd, w, acc) => { if (!nd.kids) acc.set(nd.s, (acc.get(nd.s) || 0) + w); else for (const q of nd.kids) most(q, w / 4, acc); return acc; };
          for (let t = t0; t < t1; t++) {
            const A = [P[T[t * 3] * 3], P[T[t * 3] * 3 + 1], P[T[t * 3] * 3 + 2]], B = [P[T[t * 3 + 1] * 3], P[T[t * 3 + 1] * 3 + 1], P[T[t * 3 + 1] * 3 + 2]], C = [P[T[t * 3 + 2] * 3], P[T[t * 3 + 2] * 3 + 1], P[T[t * 3 + 2] * 3 + 2]];
            const tr = tree(t, A, B, C, 0);
            const m = [...most(tr, 1, new Map())].sort((a, b) => b[1] - a[1])[0][0];
            state[t - t0] = m;
            if (tr.kids || tr.s !== part.ext) paint[t - t0] = encodePaint(tr);
          }
          part.paint = paint; part.state = state;
        }
      }
      parts.push(part);
    }
    return parts;
  }
  // the paint strokes of part k, moved from its body's own coordinates to the file's
  function opsFor(k, bed) {
    const id = W.ids[k], ops = st.ops.get(id) || [], M = W.mats[k], Inv = W.inv[k], sc = W.scl[k] || 1;
    const B = [bed.w / 2, bed.d / 2, 0], mirrored = new THREE.Matrix4().fromArray(M).determinant() < 0;
    const xf = (p) => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12] + B[0], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13] + B[1], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14] + B[2]];
    const out = [];
    // faces painted in the sim (CAD faces) become triangle paint, under the strokes
    const fp = st.paint.get(id);
    if (fp && fp.size) {
      const t0 = W.tbase[k], t1 = k + 1 < W.nParts ? W.tbase[k + 1] : W.nT, by = new Map();
      for (let t = t0; t < t1; t++) { const f = W.tface[t]; if (f >= 0 && fp.has(f)) { const sl = fp.get(f); if (!by.has(sl)) by.set(sl, []); by.get(sl).push(t - t0); } }
      for (const [sl, tl] of by) out.push({ k: "tris", s: sl, t: tl });
    }
    for (const o of ops) {
      if (o.k === "ball") {
        const r = { k: "ball", s: o.s, p: xf(o.p), r: o.r * sc };
        if (o.v) { const v = [M[0] * o.v[0] + M[4] * o.v[1] + M[8] * o.v[2], M[1] * o.v[0] + M[5] * o.v[1] + M[9] * o.v[2], M[2] * o.v[0] + M[6] * o.v[1] + M[10] * o.v[2]], l = Math.hypot(...v) || 1; r.v = v.map((q) => q / l); }
        out.push(r);
      } else if (o.k === "band") {
        // height n·x + o in body coordinates, written for file coordinates y: x = Inv (y - B)
        const n = [Inv[0] * o.n[0] + Inv[1] * o.n[1] + Inv[2] * o.n[2], Inv[4] * o.n[0] + Inv[5] * o.n[1] + Inv[6] * o.n[2], Inv[8] * o.n[0] + Inv[9] * o.n[1] + Inv[10] * o.n[2]];
        const off = o.n[0] * Inv[12] + o.n[1] * Inv[13] + o.n[2] * Inv[14] + o.o - (n[0] * B[0] + n[1] * B[1] + n[2] * B[2]);
        out.push({ k: "band", s: o.s, n, o: off, z0: o.z0, z1: o.z1 });
      } else if (o.k === "tris" || o.k === "fill") {
        const r = { k: o.k, s: o.s, t: [...o.t] };
        if (o.k === "fill") { r.keep = o.keep; if (o.sub && !mirrored) r.sub = [...o.sub].map(([t, q]) => [t, q.n, [...q.mask.keys()].filter((i) => q.mask[i])]); }
        out.push(r);
      }
    }
    return out;
  }
  function fileBase() {
    const names = st.ids.map((id) => bodyOf(id)?.name).filter(Boolean);
    return (st.extName ? st.extName : names.length === 1 ? names[0] : (store.doc.name || "Plate")).replace(/[\\/:*?"<>|]+/g, "").trim() || "Plate";
  }
  function project3MF() {
    if (!W) return null;
    const P = PRINTERS[st.printer], bed = { w: P.round ? 0 : P.w, d: P.round ? 0 : P.d };
    const parts = plateParts(true);
    const sim = {
      app: "JumpStart 3D", v: 1, settings: Object.fromEntries(SIM_KEYS.map((k) => [k, st[k]])),
      slots: JSON.parse(JSON.stringify(st.slots)), cmyk: { on: st.cmyk.on, n: st.cmyk.n, surf: st.cmyk.surf, inks: st.cmyk.inks },
      parts: parts.map((p) => ({ name: p.name, slot: p.ext - 1, ops: opsFor(p.k, bed) })),
    };
    const fil = (st.slots.length ? st.slots : [{ color: "#a7b0ba" }]).map((q) => ({ color: toHex(q.color), type: ORCA_TYPE[st.filament] || "PLA" }));
    return make3MF({ parts, filaments: fil, settings: orcaConfig(), sim, bed, title: fileBase() });
  }
  async function saveProject() {
    if (!W) { app.toast("Nothing on the plate to save.", "err"); return; }
    const bytes = new Uint8Array(await project3MF().arrayBuffer());
    if (app.projects && app.projects.saveModel) await app.projects.saveModel(fileBase() + ".3mf", bytes);
    st.saved3mf = (st.saved3mf || 0) + 1;
    app.toast(`Saved ${fileBase()}.3mf: the plate, its filaments and colour painting, and every setting. Open it here again, or in Orca Slicer or Bambu Studio.`);
    return bytes;
  }
  async function exportSTL() {
    if (!W) { app.toast("Nothing on the plate to export.", "err"); return; }
    const P = PRINTERS[st.printer], bytes = makeSTL(plateParts(false), { w: P.round ? 0 : P.w, d: P.round ? 0 : P.d });
    if (app.projects && app.projects.saveModel) await app.projects.saveModel(fileBase() + ".stl", bytes);
    app.toast(`Exported ${fileBase()}.stl: everything on the plate as one mesh, placed as it prints. STL has no colours or settings: save the project (.3mf) to keep them.`);
    return bytes;
  }
  // settings from a slicer project (Orca / Bambu names) or a JumpStart 3MF (the sim's own)
  function applySettings(o) {
    for (const [k, v] of Object.entries(o || {})) {
      if (!SIM_KEYS.includes(k) || v === undefined) continue;
      if (k === "printer" && !PRINTERS[v]) continue;
      if (k === "filament" && !FILAMENTS[v]) continue;
      st[k] = k === "feat" ? { ...st.feat, ...v } : v;
    }
    st.walls = Math.max(1, Math.min(8, Math.round(st.walls) || 2)); st.infill = Math.max(0, Math.min(100, +st.infill || 0));
    st.layer = Math.max(0.04, Math.min(0.4, +st.layer || 0.2)); st.topN = Math.max(0, Math.round(st.topN)); st.botN = Math.max(0, Math.round(st.botN));
  }
  function gcodeBox(body) {
    const P = PRINTERS[st.printer], [tn, tb, fan] = temps(), fl = st.gflavor || flavorFor(P);
    body.append(el("div", { class: "subhead" }, "Print settings (G-code)"));
    const fs = el("select", { class: "num", id: "ps-flavor" }, ...FLAVORS.map(([k, n]) => el("option", { value: k, selected: k === fl }, n + (k === flavorFor(P) ? " (this printer)" : ""))));
    fs.onchange = () => { st.gflavor = fs.value; };
    body.append(row("G-code for", fs, "ps-flavor"));
    const r3 = el("div", { class: "row3" });
    const nf = (id, label, val, on, min, max) => el("label", {}, label, el("input", { type: "number", class: "num", id, value: val, min, max, step: 1, onchange: (e) => on(+e.target.value) }));
    r3.append(nf("ps-tnoz", "Nozzle °C", st.nozzleT ?? tn, (v) => { st.nozzleT = v; }, 150, 450), nf("ps-tbed", "Bed °C", st.bedT ?? tb, (v) => { st.bedT = v; }, 0, 130), nf("ps-fan", "Fan %", st.fanP ?? fan, (v) => { st.fanP = Math.max(0, Math.min(100, v)); }, 0, 100));
    body.append(r3);
    body.append(row("Retraction", seg([[0, "Off"], [0.4, "0.4"], [0.8, "0.8"], [1.5, "1.5"], [5, "5 mm"]], st.retract, (v) => { st.retract = v; renderPanel(); }, "ps-retract")));
    body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ps-zhop", checked: st.zhop, onchange: (e) => { st.zhop = e.target.checked; } }), "Lift the nozzle (Z hop) when travelling"));
    body.append(el("button", { class: "btn primary", id: "ps-gcode", style: { width: "100%" }, disabled: !(S && S.lines), onclick: () => exportGcode() }, "⬇ Export G-code"));
    { const mc = machineFor(st.printer);
      body.append(el("div", { class: "hint", id: "ps-gcode-machine", style: { padding: 0 } }, mc.note || `Made for the ${mc.model}: its own start and end${toolsOf().kind === "heads" ? ", tool changes" : ""}, and the model name, filaments and nozzle its screen checks.`)); }
    if (st.lastG) body.append(el("div", { class: "hint", id: "ps-gcode-info", style: { padding: 0 } }, `Last G-code: ${Math.floor(st.lastG.secs / 3600)} h ${Math.round((st.lastG.secs % 3600) / 60)} min · ${st.lastG.grams.toFixed(1)} g · ${st.lastG.meters.toFixed(2)} m of filament · ${(st.lastG.size / 1e6).toFixed(1)} MB`));
    body.append(el("div", { class: "hint", style: { padding: 0 } }, fl === "bambu" ? "Bambu Lab printers: open the .gcode in Bambu Studio or Orca Slicer to send it over Wi-Fi, or print it from the SD card." : fl === "klipper" ? "Klipper printers (Creality K series, Voron…): upload the .gcode in the printer's web page (Mainsail / Fluidd) or copy it to a USB stick." : "Copy the .gcode to the printer's SD card or USB stick, or send it with the printer's app or OctoPrint."));
  }
  // objects from outside the design (the Color Lithophane Studio): each part with its filament
  function loadExternal(list, o = {}) {
    EXT.clear();
    const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    list.forEach((p, i) => EXT.set("ext:" + i, { id: "ext:" + i, name: p.name, color: p.color, m: ID, data: { vertices: p.V, triangles: p.I } }));
    st.extName = o.name || "";
    st.extKind = o.kind || "litho";
    st.inst = []; st.osel.clear(); st.paint.clear(); st.ops.clear(); st.undo = []; st.paintTool = null; st.R = new THREE.Matrix4();
    st.cmyk.on = false;
    if (o.slots) { st.slots = o.slots.map((q) => ({ color: q.color, name: q.name })); st.slotOf = new Map(list.map((p, i) => ["ext:" + i, p.slot || 0])); }
    if (o.layer) st.layer = o.layer;
    if (o.infill != null) st.infill = o.infill;
    st.topN = Math.max(st.topN, 3);
    // a printer that can hold all the filaments
    if (st.slots.length > 1 && (toolsOf().kind === "single" || (toolsOf().slots || 1) < st.slots.length)) st.printer = "x1";
    st.ids = targetIds(); st.refit = true; st.view = "model"; st.ptab = "quality";
  }
  // ---- Open STL / 3MF: files go straight onto the sim's plate (not into the design)
  function pickImport() {
    const inp = el("input", { type: "file", accept: ".stl,.3mf", multiple: true, style: { display: "none" } });
    inp.onchange = () => { const f = [...inp.files]; inp.remove(); if (f.length) importFiles(f); };
    document.body.append(inp);
    inp.click();
  }
  async function importFiles(files) {
    files = files.filter((f) => /\.(stl|3mf)$/i.test(f.name || ""));
    if (!files.length) { app.toast("Pick .stl or .3mf files."); return; }
    app.toast(`Reading ${files.length === 1 ? files[0].name : files.length + " files"}…`);
    let r;
    try { r = await readSimFiles(files); } catch (e) { app.toast(e.message || "Couldn't read that file."); return; }
    // several separate STL files: side by side so they don't overlap
    if (files.length > 1 && files.every((f) => /\.stl$/i.test(f.name))) {
      let x = 0;
      for (const p of r.parts) {
        let mnx = Infinity, mxx = -Infinity, mny = Infinity;
        for (let i = 0; i < p.V.length; i += 3) { mnx = Math.min(mnx, p.V[i]); mxx = Math.max(mxx, p.V[i]); mny = Math.min(mny, p.V[i + 1]); }
        for (let i = 0; i < p.V.length; i += 3) { p.V[i] += x - mnx; p.V[i + 1] -= mny; }
        x += mxx - mnx + 6;
      }
    }
    // centre it all on the plate, sitting on the bed
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of r.parts) for (let i = 0; i < p.V.length; i += 3) for (let a = 0; a < 3; a++) { const v = p.V[i + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
    const d = [-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]];
    for (const p of r.parts) for (let i = 0; i < p.V.length; i += 3) for (let a = 0; a < 3; a++) p.V[i + a] += d[a];
    const nm = files.length === 1 ? files[0].name.replace(/\.(stl|3mf)$/i, "") : files.length + " files";
    loadExternal(r.parts.map((p) => ({ name: p.name, V: p.V, I: p.I, color: p.color, slot: p.slot })), { kind: "import", name: nm, slots: r.slots });
    // settings from the project (Orca / Bambu names), then the sim's own if it's a JumpStart 3MF
    const js = r.sim && r.sim.app === "JumpStart 3D" && Array.isArray(r.sim.parts) && r.sim.parts.length === r.parts.length ? r.sim : null;
    if (r.orca) applySettings(fromOrca(r.orca));
    if (js) {
      applySettings(js.settings);
      if (Array.isArray(js.slots) && js.slots.length) st.slots = js.slots;
      if (js.cmyk) Object.assign(st.cmyk, js.cmyk);
      js.parts.forEach((jp, i) => {
        st.slotOf.set("ext:" + i, jp.slot | 0);
        for (const o of jp.ops || []) {
          const op = { ...o };
          if (o.k === "ball") op.p = [o.p[0] + d[0], o.p[1] + d[1], o.p[2] + d[2]];
          else if (o.k === "band") op.o = o.o - (o.n[0] * d[0] + o.n[1] * d[1] + o.n[2] * d[2]);
          else {
            op.t = new Set(o.t);
            if (o.sub) op.sub = new Map(o.sub.map(([t, n, on]) => { const mask = new Uint8Array(2 * n * n); for (const q of on) mask[q] = 1; return [t, { n, mask }]; }));
          }
          pushOp("ext:" + i, op);
        }
      });
      st.pv++;
    } else {
      // colour painting from the file
      r.parts.forEach((p, i) => { for (const [sl, tris] of p.paint) pushOp("ext:" + i, { k: "tris", t: new Set(tris), s: sl }); });
    }
    st.importNotes = r.notes.join("; ");
    const nT = r.parts.reduce((a, p) => a + p.I.length / 3, 0);
    stopAnim(); buildPlate(); rebuild();
    filamentsChanged();
    app.toast(`Opened ${nm}: ${r.parts.length} part${r.parts.length > 1 ? "s" : ""}, ${nT.toLocaleString()} triangles${nT > 400000 ? " (big: slicing may be slow)" : ""}.`);
  }
  // drop STL / 3MF files on the view while the sim is open
  vp.canvas.addEventListener("dragover", (e) => { if (document.getElementById("ps-import") && [...(e.dataTransfer?.items || [])].some((i) => i.kind === "file")) e.preventDefault(); });
  vp.canvas.addEventListener("drop", (e) => {
    if (!document.getElementById("ps-import")) return;
    const f = [...(e.dataTransfer?.files || [])].filter((x) => /\.(stl|3mf)$/i.test(x.name));
    if (!f.length) return;
    e.preventDefault(); e.stopPropagation();
    importFiles(f);
  }, true);
  function clearExternal() {
    EXT.clear(); st.extName = ""; st.inst = []; st.osel.clear(); st.slotOf = new Map(); st.slots = []; st.ops.clear(); st.paint.clear();
    stopAnim(); st.ids = targetIds(); st.refit = true; buildPlate(); rebuild(); renderPanel();
  }
  return { _S: () => S, _plan: () => lastPlan, importFiles, _dbg: { fillRegion: (...a) => fillRegion(...a), slotAtW: (...a) => slotAtW(...a), buildPaint: () => buildPaint(), paintAt: (t, x, y, z) => { const T0 = performance.now(); const r = paintAt({ t, p: new THREE.Vector3(x, y, z), n: triNormal(t) }); return [r, performance.now() - T0]; }, changed: () => { const T0 = performance.now(); filamentsChanged(); return performance.now() - T0; } }, _lineSlots: () => (S && S.base ? lineSlots() : null), open, teardown, st, loadExternal, clearExternal, hasExternal: () => EXT.size > 0, autoOrient, turnObj, scaleObj, dupObj, delObj, arrange, resetAll, selectKey: (k, add) => { selectKey(k, add); drawSel(); renderPanel(); }, world: () => W, setView, layFace, rotate, togglePlay, exportGcode, gcodeOptions, saveProject, exportSTL, project3MF, orcaConfig, rebuild: () => rebuild(), setIds: (ids) => { st.ids = ids; stopAnim(); st.refit = true; rebuild(); } };
}
