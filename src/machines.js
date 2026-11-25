// v2.9.9.9.12: what each printer in the 3D Print Sim needs in a G-code file so it accepts and
// runs it: its official model name (the name its slicer profile and firmware use), where 0, 0 is
// on its bed, and its own start, end, tool-change and layer-change lines. The lines are written
// here from each maker's published commands and macros (PRINT_START, START_PRINT, M862.3 …);
// nothing is copied from slicer profiles.
//
// c (context): tn / tb nozzle and bed °C, fan %, tools (filament numbers used, in order),
// initial (first tool), layers, height (top of the print), types (filament type per tool),
// colors (per tool), nozzle (mm), heads (tool heads on the printer)

const f = (x) => (Math.round(x * 1000) / 1000).toString();

// ---- the families
// a plain Marlin printer: heat, home, purge line along the left edge
const marlin = (o = {}) => ({
  flavor: "marlin",
  start: (c) => ({
    lines: [`M140 S${c.tb}`, `M104 S150 ; warm the nozzle without oozing`, "G90", "M83 ; relative extrusion", "G28 ; home", `M190 S${c.tb}`, `M104 S${c.tn}`, `M109 S${c.tn}`,
      "G92 E0", "G1 Z2 F900", "G1 X3 Y20 F6000", "G1 Z0.28 F900", "G1 X3 Y140 E10 F1500 ; purge line", "G1 X3.4 Y140 F3000", "G1 X3.4 Y20 E10 F1500", "G92 E0", "G1 Z2 F900"],
    at: [3.4, 20],
  }),
  end: (c) => [`G1 E-${f(c.retract || 0.8)} F2400`, `G1 Z${f(Math.min(c.height + 10, c.bedH - 1))} F720`, `G0 X5 Y${f(c.bedD * 0.85)} F6000 ; present the print`, "M104 S0", "M140 S0", "M107", "M84 ; motors off"],
  ...o,
});
// a delta (FLSUN): 0, 0 in the middle of the round bed; the purge is an arc near the front
const delta = () => ({
  flavor: "marlin", origin: "center",
  start: (c) => {
    const R = c.bedW / 2 - 12, pts = [];
    for (let a = -120; a <= -60; a += 5) pts.push([R * Math.cos((a * Math.PI) / 180), R * Math.sin((a * Math.PI) / 180)]);
    const lines = [`M140 S${c.tb}`, "M104 S100 ; warm the nozzle without oozing", "G90", "M83", `M190 S${c.tb}`, "G28 ; home (a delta homes at the top)", `M104 S${c.tn}`, `M109 S${c.tn}`, "G92 E0",
      `G1 X${f(pts[0][0])} Y${f(pts[0][1])} Z5 F4000`, "G1 Z0.3 F900"];
    for (let i = 1; i < pts.length; i++) lines.push(`G1 X${f(pts[i][0])} Y${f(pts[i][1])} E${f(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * 0.08)} F1200${i === 1 ? " ; purge arc" : ""}`);
    lines.push("G92 E0", "G1 Z2 F900");
    return { lines, at: pts[pts.length - 1] };
  },
  end: (c) => [`G1 E-${f(c.retract || 0.8)} F2400`, `G1 Z${f(Math.min(c.height + 10, c.bedH - 1))} F720`, "G28 ; home: a delta parks at the top", "M104 S0", "M140 S0", "M107", "M84"],
});
// Bambu Lab: their printers want a project from Bambu Studio or Orca Slicer; this G-code is a
// plain start that the printer can run from the SD card
const bambu = () => ({
  flavor: "bambu",
  note: "Bambu Lab printers print best from a project: save the project (.3mf), open it in Bambu Studio or Orca Slicer and print from there. This G-code uses a plain start (no AMS colour changes).",
  start: (c) => ({
    lines: ["; Bambu Lab: for the AMS, calibration and the printer's own start, print the saved 3MF project from Bambu Studio or Orca Slicer", `M140 S${c.tb}`, `M104 S${c.tn}`, "G28 ; home", `M190 S${c.tb}`, `M109 S${c.tn}`,
      "G90", "M83", "G92 E0", "G1 Z2 F900", "G1 X18 Y1 F6000", "G1 Z0.3 F900", "G1 X120 Y1 E12 F1800 ; purge line", "G1 X120 Y1.5 F3000", "G1 X18 Y1.5 E12 F1800", "G92 E0", "G1 Z2 F900"],
    at: [18, 1.5],
  }),
  end: (c) => [`G1 E-${f(c.retract || 0.8)} F2400`, `G1 Z${f(Math.min(c.height + 10, c.bedH - 1))} F720`, `G0 X65 Y${f(c.bedD - 10)} F6000`, "M104 S0", "M140 S0", "M106 S0", "M84"],
  toolChange: () => [], // the AMS needs Bambu's own change sequence: one filament only here
});
// Prusa: the printer checks the nozzle and the model before it starts (M862.x)
const prusa = (o) => ({
  flavor: "prusa",
  start: (c) => {
    const L = ["M17 ; motors on", `M862.1 P${c.nozzle} ; nozzle diameter check`];
    if (o.check) L.push(`M862.3 P "${o.check}" ; printer model check`);
    if (o.check && o.buddy) L.push("M862.5 P2 ; g-code level check");
    if (c.tools.length > 1 && o.mmu) L.push('M862.6 P "MMU3" ; MMU check');
    L.push("G90", "M83", `M140 S${c.tb}`);
    if (o.mk3) L.push(`M104 S${c.tn}`, `M190 S${c.tb}`, `M109 S${c.tn}`, "G28 W ; home without mesh levelling", "G80 ; mesh bed levelling");
    else {
      // a tool changer (XL, INDX): name the tool, none is picked yet
      const T = o.xl ? ` T${c.initial}` : "";
      L.push(`M104${T} S170 ; probing temperature: no ooze`, `M109${T} R170`, "G28 ; home", `M190 S${c.tb}`, "G29 ; mesh bed levelling", `M104${T} S${c.tn}`);
    }
    if (o.xl) L.push(`T${c.initial} ; pick the first tool`);
    const [x0, x1, y] = o.purge;
    L.push(`G1 X${x0} Y${y} Z15 F4800 ; to the purge line`, `M109${o.xl ? ` T${c.initial}` : ""} S${c.tn}`, "G92 E0", "G1 Z0.2 F720", `G1 X${f((x0 + x1) / 2)} E${f(Math.abs(x1 - x0) * 0.12)} F1000 ; purge`, `G1 X${x1} E${f(Math.abs(x1 - x0) * 0.1)} F1000`, "G92 E0", "G1 Z2 F720");
    return { lines: L, at: [x1, y] };
  },
  end: (c) => [`G1 E-${f(c.retract || 0.8)} F2400`, `G1 Z${f(Math.min(c.height + 2, c.bedH))} F720`, `G1 X${o.park[0]} Y${o.park[1]} F4200 ; park`, `G1 Z${f(Math.min(c.height + 30, c.bedH))} F720`, "G4 ; wait",
    ...(o.xl ? c.tools.map((t) => `M104 T${t} S0`) : ["M104 S0"]), "M140 S0", "M107", "M84 X Y E ; motors off"],
  toolChange: o.xl ? (c, to) => [`M109 T${to} S${c.tn} ; heat the next tool`, `T${to}`] : null,
  ...o.extra,
});
// Klipper printers call the printer's own start and end macros
const klipper = (o) => ({
  flavor: "klipper",
  layerInfo: true,
  start: (c) => {
    const L = [...(o.pre ? o.pre(c) : []), ...o.startMacro(c)];
    if (o.tool !== false) L.push(`T${c.initial}`);
    L.push(`M109 S${c.tn}`, "G90", "M83", "G92 E0");
    const [x0, x1, y] = o.purge(c);
    L.push(`G1 Z2 F600`, `G1 X${f(x0)} Y${f(y)} F12000`, "G1 Z0.3 F600", `G1 X${f(x1)} E${f(Math.abs(x1 - x0) * 0.1)} F1800 ; purge line`, "G92 E0", "G1 Z2 F600");
    return { lines: L, at: [x1, y] };
  },
  end: (c) => [`G1 E-${f(c.retract || 0.8)} F2400`, `G91`, "G1 Z2 F600", "G90", ...o.endMacro(c)],
  ...o.extra,
});
const creality = (o = {}) => klipper({
  startMacro: (c) => ["M140 S0", "M104 S0", `START_PRINT EXTRUDER_TEMP=${c.tn} BED_TEMP=${c.tb}`],
  pre: o.k2 ? (c) => ["; HEADER_BLOCK_START", `; total layer number: ${c.layers}`, "; HEADER_BLOCK_END"] : null,
  purge: () => [5, 125, 0.5],
  endMacro: () => ["END_PRINT"],
});
const voron = () => klipper({
  startMacro: (c) => [`M190 S${c.tb}`, `M109 S${c.tn}`, `PRINT_START EXTRUDER=${c.tn} BED=${c.tb}`],
  tool: false,
  purge: () => [5, 105, 2],
  endMacro: () => ["PRINT_END"],
});
// Elegoo Centauri Carbon (and 2, with CANVAS): Elegoo's firmware reads the model line
const elegoo = (canvas) => klipper({
  pre: (c) => [`;printer_model:${canvas ? "Elegoo Centauri Carbon 2" : "Elegoo Centauri Carbon"}`, `;initial_filament:${c.types[c.initial] || "PLA"}`],
  startMacro: (c) => ["M400", "M220 S100", "M221 S100", "M104 S140", `M140 S${c.tb}`, "G90", "M83", "G28 ; home", `M190 S${c.tb}`],
  purge: (c) => [c.bedW / 2 - 40, c.bedW / 2 + 40, -1.2],
  endMacro: () => ["M400", "M140 S0", "M104 S0", "M106 S0", "M84"],
  extra: canvas ? { toolChange: (c, to) => ["M106 S0", "M106 P2 S0", `T${to}`] } : {},
});
// Flashforge (Klipper inside, with its own screen); the Adventurer 5M puts 0, 0 in the middle
const flashforge = (o = {}) => ({
  flavor: "klipper", origin: o.center ? "center" : "corner", layerInfo: false,
  start: (c) => {
    const y = o.center ? -c.bedD / 2 + 0.5 : c.bedD - 0.5, x0 = o.center ? 55 : 200, x1 = o.center ? -55 : 70;
    const L = [`M190 S${c.tb}`, `M104 S${c.tn}`, "G90", "M83", "G1 Z5 F6000"];
    if (o.heads) L.push(`T${c.initial}`, `M109 S${c.tn} T${c.initial}`); else L.push(`M109 S${c.tn}`);
    L.push(`G1 X${x0} Y${f(y)} Z0.25 F4800`, `G1 X${x1} E${f(Math.abs(x0 - x1) * 0.1)} F1800 ; purge line`, "G92 E0", "G1 Z2 F600");
    return { lines: L, at: [x1, y] };
  },
  end: (c) => [`G1 E-3 F3600`, `G1 Z${f(Math.min(c.height + 10, c.bedH - 1))} F600`, "G0 X50 Y50 F30000", ...(o.heads ? c.tools.map((t) => `M104 T${t} S0`) : ["M104 S0"]), "M140 S0", "M107"],
  toolChange: o.heads ? (c, to) => [`M109 T${to} S${c.tn}`, `T${to}`] : null,
});
// Snapmaker U1: Snapmaker's firmware (Klipper) prepares the heads, the bed and the nozzle in
// PRINT_START and its own macros; the touchscreen reads the model, filaments and nozzles
// from the comment block at the end of the file
const snapmakerU1 = () => ({
  flavor: "klipper", layerInfo: true, u1: true,
  start: (c) => {
    const L = ["PRINT_START", `SET_PRINT_STATS_INFO TOTAL_LAYER=${c.layers} CURRENT_LAYER=0`, `M140 S${c.tb}`, `M104 T${c.initial} S140`, "M204 S10000", "G28 X Y", `T${c.initial}`, "G90",
      "SM_PRINT_CHECK_SWITCH_EXTRUDER"];
    // each head the print uses: fed and flow-calibrated, as Snapmaker's own start does
    // (Snapmaker's macros skip any head the print doesn't use)
    for (const t of c.tools) L.push(`SM_PRINT_EXTRUDER_PREHEAT EXTRUDER=${t} TEMP=140`, `SM_PRINT_AUTO_FEED EXTRUDER=${t}`, `SM_PRINT_FLOW_CALIBRATE EXTRUDER=${t}`);
    for (let t = 0; t < 4; t++) L.push(`M104 S0 T${t} A0`);
    L.push(`M104 T${c.initial} S${c.tn}`, `T${c.initial}`, `M109 T${c.initial} S${c.tn}`, `SM_PRINT_PREEXTRUDE_FILAMENT INDEX=${c.initial}`, `M104 T${c.initial} S${c.tn - 90}`,
      "M106 S255", "MOVE_TO_DISCARD_FILAMENT_POSITION", `M109 T${c.initial} S${c.tn - 90}`, "ROUGHLY_CLEAN_NOZZLE_WITH_DISCARD", "MOVE_TO_XY_IDLE_POSITION_EXTRUDER", "M107", "G28 Z I140 J140",
      "DETECT_BED_PLATE", `M190 S${c.tb}`, "G90", "G0 Z5 F10000", "G28 Z",
      `BED_MESH_CALIBRATE mesh_min=3,3 mesh_max=267,267 ALGORITHM=bicubic PROBE_COUNT=7,7 ADAPTIVE=0 ADAPTIVE_MARGIN=0`,
      "G90", "G1 Z1.5", "G0 X85 Y1 Z2 F18000", `M109 S${c.tn}`, "G1 Z0.2", "M83", "G1 X185 E15 F360 ; purge line", "G1 Z1.5", "G90", "M106 S0");
    return { lines: L, at: [185, 1] };
  },
  end: () => ["G91", "G1 Z1 F600", "G90", "PRINT_END"],
  // Snapmaker's tool change: lift, heat the next head, swap, prime it
  toolChange: (c, to, from, k) => ["G91", "G1 Z1.5 F600", "G90", `M109 S${c.tn} T${to}`, "M400", `T${to}`, ...(to !== c.initial ? [`SM_PRINT_PREEXTRUDE_FILAMENT INDEX=${to}`] : []), "G90"],
  footer: (c) => ({
    printer_settings_id: `Snapmaker U1 (${c.nozzle} nozzle)`,
    // (written as Snapmaker's profile writes them: comma lists)
    nozzle_volume_type: "Standard,Standard,Standard,Standard",
    filament_map: c.colors.map((_, i) => String(i + 1)),
    filament_volume_type: c.colors.map(() => "standard").join(","),
    temperature_vitrification: c.types.map((t) => String(VITRIFY[t] || 45)),
  }),
});
// softening temperature per filament type (the U1 picks its top-cover fan from it)
const VITRIFY = { PLA: 45, "PLA-CF": 50, PETG: 70, ABS: 94, ASA: 100, PA: 108, "PA-CF": 110, PC: 140, TPU: 30, PEEK: 150 };

// ---- every printer: official model name, then its family
export const MACHINES = {
  a1mini: { model: "Bambu Lab A1 mini", ...bambu() }, a1: { model: "Bambu Lab A1", ...bambu() }, a2l: { model: "Bambu Lab A2L", ...bambu() },
  p1s: { model: "Bambu Lab P1S", ...bambu() }, p2s: { model: "Bambu Lab P2S", ...bambu() }, x1: { model: "Bambu Lab X1 Carbon", ...bambu() },
  x2d: { model: "Bambu Lab X2D", ...bambu() }, h2s: { model: "Bambu Lab H2S", ...bambu() }, h2d: { model: "Bambu Lab H2D", ...bambu() },
  h3c: { model: "Bambu Lab H3C", ...bambu() }, h2c: { model: "Bambu Lab H2C", ...bambu() },
  ender3: { model: "Creality Ender-3", ...marlin() },
  k1: { model: "Creality K1", ...creality() }, k1max: { model: "Creality K1 Max", ...creality() },
  k2se: { model: "Creality K2 SE", ...creality({ k2: true }) }, k2: { model: "Creality K2", ...creality({ k2: true }) },
  k2pro: { model: "Creality K2 Pro", ...creality({ k2: true }) }, k2plus: { model: "Creality K2 Plus", ...creality({ k2: true }) },
  cc: { model: "Elegoo Centauri Carbon", ...elegoo(false) }, cc2: { model: "Elegoo Centauri Carbon 2", ...elegoo(true) },
  ff5m: { model: "Flashforge Adventurer 5M", ...flashforge({ center: true }) }, ffad5x: { model: "Flashforge AD5X", ...flashforge() },
  creator5: { model: "Flashforge Creator 5", ...flashforge({ heads: true }) }, creator5pro: { model: "Flashforge Creator 5 Pro", ...flashforge({ heads: true }) },
  // Prusa: the M862.3 names their firmware checks; the MK3 family (whose name changes with an
  // MMU attached) and printers whose name isn't published get no model check: a missing check
  // never stops a print, a wrong one does
  mini: { model: "Prusa MINI", ...prusa({ check: "MINI", buddy: true, purge: [170, 40, -2], park: [178, 178] }) },
  mk3: { model: "Prusa MK3", ...prusa({ mk3: true, purge: [5, 100, -3], park: [0, 200] }) },
  mk3s: { model: "Prusa MK3S", ...prusa({ mk3: true, purge: [5, 100, -3], park: [0, 200] }) },
  mk3splus: { model: "Prusa MK3S", ...prusa({ mk3: true, purge: [5, 100, -3], park: [0, 200] }) },
  mk35: { model: "Prusa MK3.5", ...prusa({ check: "MK3.5", buddy: true, mmu: true, purge: [0, 55, -4], park: [241, 170] }) },
  mk35s: { model: "Prusa MK3.5S", ...prusa({ check: "MK3.5S", buddy: true, mmu: true, purge: [0, 55, -4], park: [241, 170] }) },
  mk39: { model: "Prusa MK3.9", ...prusa({ check: "MK3.9", buddy: true, mmu: true, purge: [0, 55, -4], park: [241, 170] }) },
  mk39s: { model: "Prusa MK3.9S", ...prusa({ check: "MK3.9S", buddy: true, mmu: true, purge: [0, 55, -4], park: [241, 170] }) },
  mk4: { model: "Prusa MK4S", ...prusa({ check: "MK4S", buddy: true, mmu: true, purge: [0, 55, -4], park: [241, 170] }) },
  core1: { model: "Prusa CORE One", ...prusa({ check: "COREONE", buddy: true, mmu: true, purge: [249, 190, -2.5], park: [242, -9] }) },
  core1l: { model: "Prusa CORE One L", ...prusa({ check: "COREONEL", buddy: true, purge: [249, 190, -2.5], park: [242, 211] }) },
  core1lindx4: { model: "Prusa CORE One L INDX", ...prusa({ xl: true, purge: [249, 190, -2.5], park: [242, 211] }) },
  core1lindx8: { model: "Prusa CORE One L INDX", ...prusa({ xl: true, purge: [249, 190, -2.5], park: [242, 211] }) },
  xl1: { model: "Prusa XL", ...prusa({ check: "XL", buddy: true, xl: true, purge: [30, 70, -8], park: [180, 340] }) },
  xl2: { model: "Prusa XL", ...prusa({ check: "XL", buddy: true, xl: true, purge: [30, 70, -8], park: [180, 340] }) },
  xl5: { model: "Prusa XL 5T", ...prusa({ check: "XL", buddy: true, xl: true, purge: [30, 70, -8], park: [180, 340] }) },
  qqs: { model: "FLSun QQ-S Pro", ...delta() },
  u1: { model: "Snapmaker U1", ...snapmakerU1() },
  voron: { model: "Voron 2.4 350", ...voron() },
};
export function machineFor(key) { return MACHINES[key] || { model: key, ...marlin() }; }
// "G-code for" set to another firmware than the printer's own (a modified printer): that
// firmware's plain start, still under the printer's official name
export function genericMachine(flavor, model) {
  const fam = flavor === "klipper" ? klipper({ startMacro: (c) => [`M190 S${c.tb}`, `M109 S${c.tn}`, `PRINT_START EXTRUDER=${c.tn} BED=${c.tb}`], tool: false, purge: () => [5, 105, 2], endMacro: () => ["PRINT_END"] })
    : flavor === "prusa" ? prusa({ purge: [5, 100, -3], park: [0, 200] }) : flavor === "bambu" ? bambu() : marlin();
  return { model, ...fam };
}
// pictures of the plate each printer's screen shows (width × height, PNG)
export const THUMB_SIZES = {
  u1: [[48, 48], [300, 300]], k1: [[96, 96], [300, 300]], k1max: [[96, 96], [300, 300]], k2se: [[96, 96], [300, 300]], k2: [[96, 96], [300, 300]], k2pro: [[96, 96], [300, 300]], k2plus: [[96, 96], [300, 300]],
  cc: [[144, 144]], cc2: [[144, 144]], ff5m: [[140, 110]], ffad5x: [[140, 110]], creator5: [[140, 110]], creator5pro: [[140, 110]], voron: [[32, 32], [300, 300]], qqs: [[260, 260]],
  mini: [[220, 124]], mk35: [[440, 240]], mk35s: [[440, 240]], mk39: [[440, 240]], mk39s: [[440, 240]], mk4: [[440, 240]], core1: [[440, 240]], core1l: [[440, 240]], xl1: [[440, 240]], xl2: [[440, 240]], xl5: [[440, 240]],
  core1lindx4: [[440, 240]], core1lindx8: [[440, 240]],
  ender3: [], mk3: [], mk3s: [], mk3splus: [],
  a1mini: [], a1: [], a2l: [], p1s: [], p2s: [], x1: [], x2d: [], h2s: [], h2d: [], h3c: [], h2c: [],
};
