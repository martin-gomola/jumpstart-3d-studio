/*! @license
Dimensional profiles adapted from gridfinity-rebuilt-openscad, revision
910e22d8607fd7f5f51ad5e5cbc5287a76810bfd.
Additional baseplate notice: Copyright Arthur Moore 2025, MIT License.

MIT License

Copyright (c) 2023 Kenneth Hodson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


This repository is based on Gridfinity:

MIT License

Copyright (c) 2023 Zachary Freedman and Voidstar Lab LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { findRegions, resolveSketch } from "../../../src/regions.js";
import { normalizeMagnetPockets, magnetCarrierHeight, magnetCenters, MAGNET_CARRIER_FLOOR } from "../../shared/gridfinity-magnets.js";

import { normalizeFingerScoop, normalizeFingerScoopSlope, normalizeOpenSides, normalizeCloseGaps, binFootprint } from "../../shared/gridfinity-walls.js";
import { partEnvelope, usableDepthError } from "../../shared/gridfinity-envelope.js";
import { GRIDFINITY_LIMITS } from "../../shared/gridfinity-limits.js";
import { BASEPLATE_CLIP } from "../../shared/baseplate-clips.js";
import { normalizeDividerPositions, evenDividerPositions } from "../../shared/gridfinity-dividers.js";
export { GRIDFINITY_LIMITS } from "../../shared/gridfinity-limits.js";
const IDENTITY = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const sourceRevision = "910e22d8607fd7f5f51ad5e5cbc5287a76810bfd";
const fail = message => { throw new Error(message); };
function number(value, label, min, max, fallback) {
  const n = value === undefined ? fallback : value;
  if (!Number.isFinite(n) || n < min || n > max) fail(`${label} must be between ${min} and ${max}`);
  return n;
}
function integer(value, label, min, max, fallback) {
  const n = number(value, label, min, max, fallback);
  if (!Number.isInteger(n)) fail(`${label} must be an integer`);
  return n;
}
function text(value, label, fallback) {
  const s = value === undefined ? fallback : value;
  if (typeof s !== "string" || !s.trim() || s.length > 80) fail(`${label} must contain 1 to 80 characters`);
  return s.trim();
}
function triple(value, label, min, max) {
  const v = value === undefined ? [0,0,0] : value;
  if (!Array.isArray(v) || v.length !== 3) fail(`${label} must be a triple`);
  return v.map((n, i) => number(n, `${label}[${i}]`, min, max));
}

export function normalizeGridfinity(raw, label = "operation") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`${label} must be an object`);
  const allowed = new Set(["id", "type", "name", "kind", "columns", "rows", "heightUnits", "floor", "wall", "lip", "openSides", "closeGaps", "fingerScoop", "fingerScoopSlope", "dividers", "dividerPositions", "magnets", "position", "rotation"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) fail(`${label}.${key} is not supported`);
  if (raw.type !== "gridfinity") fail(`${label}.type must be gridfinity`);
  const kind = raw.kind ?? "insert";
  if (!["insert", "bin", "baseplate"].includes(kind)) fail(`${label}.kind must be insert, bin or baseplate`);
  const columns = integer(raw.columns, `${label}.columns`, 1, GRIDFINITY_LIMITS.columns, 1);
  const rows = integer(raw.rows, `${label}.rows`, 1, GRIDFINITY_LIMITS.rows, 1);
  if (columns * rows > GRIDFINITY_LIMITS.cells) fail(`${label} exceeds the ${GRIDFINITY_LIMITS.cells}-cell limit`);
  const heightUnits = integer(raw.heightUnits, `${label}.heightUnits`, 2, GRIDFINITY_LIMITS.heightUnits, 3);
  const floor = number(raw.floor, `${label}.floor`, 0.8, 6, 2);
  const wall = number(raw.wall, `${label}.wall`, 0.8, 4, 1.2);
  if (raw.lip !== undefined && typeof raw.lip !== "boolean") fail(`${label}.lip must be a boolean`);
  const lip = raw.lip === true;
  const openSides = normalizeOpenSides(raw.openSides, `${label}.openSides`);
  const closeGaps = normalizeCloseGaps(raw.closeGaps, openSides, kind);
  if (kind !== "bin" && openSides.length) fail(`${label}: open sides are only supported for bins`);
  const dividers = raw.dividers ?? {};
  if (!dividers || typeof dividers !== "object" || Array.isArray(dividers) || Object.keys(dividers).some(key => !["x", "y"].includes(key))) fail(`${label}.dividers must contain only x and y counts`);
  const x = integer(dividers.x, `${label}.dividers.x`, 0, GRIDFINITY_LIMITS.dividers, 0);
  const y = integer(dividers.y, `${label}.dividers.y`, 0, GRIDFINITY_LIMITS.dividers, 0);
  const dividerPositions = raw.dividerPositions === undefined ? undefined
    : normalizeDividerPositions(raw.dividerPositions, { x, y }, columns * 42 - 0.5, rows * 42 - 0.5, wall, `${label}.dividerPositions`);
  if (kind !== "bin" && (lip || x || y)) fail(`${label}: stacking lip and dividers are only supported for bins`);
  if (kind === "baseplate" && (raw.heightUnits !== undefined && heightUnits !== 3 || raw.floor !== undefined && floor !== 2 || raw.wall !== undefined && wall !== 1.2)) fail(`${label}: baseplate height is fixed at 5 mm; bin height, floor and wall overrides are unsupported`);
  const depthError = usableDepthError({ kind, heightUnits, floor }, label); if (depthError) fail(depthError);
  const fingerScoop = normalizeFingerScoop(raw.fingerScoop, kind, openSides);
  const fingerScoopSlope = normalizeFingerScoopSlope(raw.fingerScoopSlope, fingerScoop);
  return { ...(fingerScoop ? { fingerScoop } : {}), ...(fingerScoopSlope ? { fingerScoopSlope } : {}), type: "gridfinity", id: text(raw.id, `${label}.id`), name: text(raw.name, `${label}.name`, `Gridfinity ${kind}`), kind, columns, rows, heightUnits, floor, wall, lip, openSides, closeGaps, dividers: { x, y }, ...(dividerPositions ? { dividerPositions } : {}), magnets: normalizeMagnetPockets(raw.magnets, `${label}.magnets`), position: triple(raw.position, `${label}.position`, -10000, 10000), rotation: triple(raw.rotation, `${label}.rotation`, -360, 360) };
}

export function buildGridfinity(operation, { document, idFactory, nextSeq, clipSlots = [] }) {
  const op = normalizeGridfinity(operation);
  const width = op.columns * 42 - (op.kind === "baseplate" ? 0 : 0.5);
  const depth = op.rows * 42 - (op.kind === "baseplate" ? 0 : 0.5);
  const footprint = binFootprint(op), envelope = partEnvelope(op);
  const carrierHeight = op.kind === "baseplate" ? magnetCarrierHeight(op.magnets) : 0;
  const topZ = op.kind === "baseplate" ? 5 + carrierHeight : op.heightUnits * 7;
  const floorZ = 7 + op.floor;
  const floorRadius = op.kind === "bin" && op.openSides.length < 4 ? Math.min(1, (topZ - floorZ) / 2) : 0;
  const lipBottom = topZ-3.8;
  // Shared by the rim solid and flush opening tools: z, inward offset, radius.
  const rimProfile = [[lipBottom-0.01,op.wall,Math.max(0,3.75-op.wall)],
    [topZ-1.2,2.6,1.15],[topZ,2.6,1.15],[topZ+0.7,1.9,1.85],
    [topZ+2.5,1.9,1.85],[topZ+4.4,0,3.75],[topZ+4.42,0,3.75]];
  const seq = nextSeq || (() => ++document.seq);
  const child = (node, x = 0, y = 0, z = 0, hole = false) => {
    const m = IDENTITY.slice(); m[12] = x; m[13] = y; m[14] = z;
    return { node: structuredClone(node), m, hole };
  };
  const group = children => ({ t: "group", children, mods: [] });
  const roundedSketch = (name, w, d, radius, z, flush = false, center = [0,0]) => {
    const sketch = { id: idFactory("s"), name, seq: seq(), plane: { o: [center[0],center[1],z], x: [1,0,0], n: [0,0,1] }, pts: [], ents: [], hidden: true };
    const point = xy => {
      const existing = sketch.pts.find(p => Math.hypot(p.x - xy[0], p.y - xy[1]) < 1e-8);
      if (existing) return existing.id;
      const id = idFactory("p"); sketch.pts.push({ id, x: xy[0], y: xy[1] }); return id;
    };
    const line = (a, b) => sketch.ents.push({ id: idFactory("e"), t: "line", a: point(a), b: point(b) });
    const extend = side => flush && op.openSides.includes(side) ? 0.25 : 0;
    const [l,r,b,t] = [-w/2-extend("left"),w/2+extend("right"),-d/2-extend("front"),d/2+extend("back")];
    if (radius <= 1e-8) {
      const corners = [[l,b],[r,b],[r,t],[l,t]];
      corners.forEach((corner, i) => line(corner, corners[(i+1)%4]));
    } else {
      const cornerRadius = (a, b) => flush && (op.openSides.includes(a) || op.openSides.includes(b)) ? 0 : radius;
      const br = cornerRadius("right", "front"), tr = cornerRadius("right", "back"), tl = cornerRadius("left", "back"), bl = cornerRadius("left", "front");
      const corners = [
        { radius: br, a: [r-br,b], b: [r,b+br], c: [r-br,b+br] },
        { radius: tr, a: [r,t-tr], b: [r-tr,t], c: [r-tr,t-tr] },
        { radius: tl, a: [l+tl,t], b: [l,t-tl], c: [l+tl,t-tl] },
        { radius: bl, a: [l,b+bl], b: [l+bl,b], c: [l+bl,b+bl] },
      ];
      corners.forEach((corner, i) => {
        if (corner.radius > 1e-8) sketch.ents.push({ id: idFactory("e"), t: "arc", a: point(corner.a), b: point(corner.b), c: point(corner.c) });
        line(corner.b, corners[(i+1)%4].a);
      });
    }
    const regions = findRegions(resolveSketch(sketch));
    if (regions.length !== 1) fail(`Gridfinity profile ${name} did not form one closed region`);
    document.sketches.push(sketch);
    return { sketch: sketch.id, ref: { key: sketch.ents.map(entity => entity.id).sort().join(","), pt: [0,0] } };
  };
  const extrude = (name, w, d, radius, z, height, flush = false) => {
    const ref = roundedSketch(name, w, d, radius, z, flush);
    return { t: "extrude", sketch: ref.sketch, profiles: [ref.ref], dist: height, mode: "one", dist2: 0, mods: [] };
  };
  const loft = sections => ({ t: "loft", sections, rail: null, ruled: true, closed: false, mods: [] });
  const repeated = (node, hole = false) => Array.from({ length: op.columns * op.rows }, (_, i) => child(node, (i % op.columns - (op.columns-1)/2)*42, (Math.floor(i/op.columns)-(op.rows-1)/2)*42, 0, hole));
  let node;
  const dividerNodes = new Set();
  if (op.kind === "baseplate") {
    const sections = [
      [-0.02,36.3,1.15], [0.35,36.3,1.15], [1.05,37.7,1.85], [2.85,37.7,1.85], [5,42,4], [5.02,42,4],
    ].map(([z,w,r]) => roundedSketch(`Socket at ${z + carrierHeight} mm`, w, w, r, z + carrierHeight));
    const socket = loft(sections);
    node = group([child(extrude("Baseplate perimeter", width, depth, 4, carrierHeight ? carrierHeight - 0.02 : 0, carrierHeight ? 5.02 : 5)), ...repeated(socket, true)]);
    if (op.magnets) {
      // A perforated carrier leaves corner pads and edge rails beneath the sockets.
      const carrier = extrude("Magnet carrier", width, depth, 4, 0, carrierHeight);
      const padRadius = op.magnets.diameter / 2 + 1.2;
      const crossWidth = 26 - 2 * padRadius;
      const horizontal = extrude("Carrier horizontal opening", 37.2, crossWidth, 1.2, -0.01, carrierHeight + 0.02);
      const vertical = extrude("Carrier vertical opening", crossWidth, 37.2, 1.2, -0.01, carrierHeight + 0.02);
      carrier.mods.push({ id: idFactory("f"), seq: seq(), t: "bool", src: "magnetCarrier", op: "cut", tool: group([...repeated(horizontal), ...repeated(vertical)]), m: IDENTITY.slice() });
      node = group([child(carrier), child(node)]);
    }
  } else {
    const sections = [[0,35.6,0.8],[0.8,37.2,1.6],[2.6,37.2,1.6],[4.75,41.5,3.75]].map(([z,w,r]) => roundedSketch(`Foot at ${z} mm`, w, w, r, z));
    const foot = loft(sections);
    // Carry squared open ends down to the feet instead of leaving a rounded ledge at Z=7.
    const outer = extrude("Outer body", width, depth, 3.75, 4.75, topZ-4.75, op.closeGaps);
    const scoopEnvelope = op.fingerScoop ? structuredClone(outer) : null;
    if (op.kind === "bin") {
      const innerWidth = width - 2 * op.wall, innerDepth = depth - 2 * op.wall;
      const cavity = extrude("Bin cavity", innerWidth, innerDepth, Math.max(0,3.75-op.wall), floorZ, topZ-floorZ+0.02, op.closeGaps);
      if (floorRadius) {
        const profile = document.sketches.at(-1);
        const points = new Map(profile.pts.map(point => [point.id, point]));
        const x0 = footprint.minX + op.wall, y0 = footprint.minY + op.wall;
        const edges = profile.ents.filter(entity => entity.t === "line").map(entity => {
          const a = points.get(entity.a), b = points.get(entity.b);
          const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
          return { a: [a.x, a.y, floorZ], b: [b.x, b.y, floorZ], m: [x, y, floorZ],
            n: [(x - x0) / (footprint.width - 2 * op.wall), (y - y0) / (footprint.depth - 2 * op.wall), 0], t: "LINE" };
        });
        // Rounding the cavity cutter retains material continuously along the inside wall roots.
        cavity.mods.push({ id: idFactory("f"), seq: seq(), t: "fillet", r: floorRadius, edges });
      }
      outer.mods.push({ id: idFactory("f"), seq: seq(), t: "bool", op: "cut", tool: cavity, m: IDENTITY.slice() });
    }
    const solids = [...repeated(foot), child(outer)];
    if (op.kind === "bin") {
      const h = topZ - floorZ;
      const stackable = op.lip && op.openSides.length < 4;
      // Stop the divider below the upper bin's feet, including on shallow bins.
      const dividerHeight = stackable ? Math.max(0.5, h - 2.5) : h;
      const jointHeight = Math.max(0.5, lipBottom - 0.2 - floorZ);
      const divider = (acrossX, across, lo, hi, startSide, endSide, radius) => {
        const startRadius = op.openSides.includes(startSide) ? 0 : radius;
        const endRadius = op.openSides.includes(endSide) ? 0 : radius;
        const center = (hi + lo) / 2, run = hi - lo;
        const [x, y] = acrossX ? [across, center] : [center, across];
        const z = floorZ - 0.01;
        if (!startRadius && !endRadius) {
          return child({ t: "prim", kind: "box", p: { w: acrossX ? op.wall : run, d: acrossX ? run : op.wall, h: dividerHeight, r: 0, c: 0 }, mods: [] }, x, y, z);
        }
        const sketch = { id: idFactory("s"), name: "Divider with rounded wall joints", seq: seq(), hidden: true,
          plane: { o: [0,0,0], x: acrossX ? [1,0,0] : [0,-1,0], n: [0,0,1] }, pts: [], ents: [] };
        const point = ([x, y]) => {
          const id = idFactory("p"); sketch.pts.push({ id, x, y }); return id;
        };
        const w = op.wall / 2, s = startRadius, e = endRadius, a = -run / 2, b = run / 2;
        const corners = [
          [[w+s,a], [w,a+s], [w+s,a+s], s], [[w,b-e], [w+e,b], [w+e,b-e], e],
          [[-w-e,b], [-w,b-e], [-w-e,b-e], e], [[-w,a+s], [-w-s,a], [-w-s,a+s], s],
        ].map(([from, to, center, r]) => {
          const first = point(from), last = r ? point(to) : first;
          if (r) sketch.ents.push({ id: idFactory("e"), t: "arc", a: last, b: first, c: point(center) });
          return { first, last };
        });
        corners.forEach(({ last }, index) => sketch.ents.push({ id: idFactory("e"), t: "line", a: last, b: corners[(index + 1) % 4].first }));
        document.sketches.push(sketch);
        const mods = [];
        if (stackable && dividerHeight > jointHeight) {
          // Keep the taller span, but start the rounded wall joints below the rim.
          const pad = op.wall / 2 + radius + 0.02, land = 2, taper = 2;
          const outline = [[-0.02, -0.02], [run + 0.02, -0.02],
            ...(endRadius ? [[run + 0.02, jointHeight], [run - land, jointHeight], [run - land - taper, dividerHeight]]
              : [[run + 0.02, dividerHeight]]),
            ...(startRadius ? [[land + taper, dividerHeight], [land, jointHeight], [-0.02, jointHeight]]
              : [[-0.02, dividerHeight]])];
          const side = { id: idFactory("s"), name: "Divider height at stacking rim", seq: seq(), hidden: true,
            plane: { o: acrossX ? [-pad, a, 0] : [a, pad, 0], x: acrossX ? [0,1,0] : [1,0,0], n: acrossX ? [1,0,0] : [0,-1,0] },
            pts: outline.map(([x, y]) => ({ id: idFactory("p"), x, y })), ents: [] };
          side.ents = side.pts.map(({ id }, index) => ({ id: idFactory("e"), t: "line", a: id, b: side.pts[(index + 1) % side.pts.length].id }));
          document.sketches.push(side);
          const tool = { t: "extrude", sketch: side.id, profiles: [{ key: side.ents.map(entity => entity.id).sort().join(","), pt: [run / 2, jointHeight / 2] }],
            dist: 2 * pad, mode: "one", dist2: 0, mods: [] };
          mods.push({ id: idFactory("f"), seq: seq(), t: "bool", op: "intersect", tool, m: IDENTITY.slice() });
        }
        return child({ t: "extrude", sketch: sketch.id, profiles: [{ key: sketch.ents.map(entity => entity.id).sort().join(","), pt: [0,0] }],
          dist: dividerHeight, mode: "one", dist2: 0, mods }, x, y, z);
      };
      const dividerPositions = op.dividerPositions ?? evenDividerPositions(op.dividers);
      const jointRadius = (positions, index, span) => {
        const current = positions[index];
        const before = (current - (positions[index - 1] ?? 0)) * span - op.wall * (index ? 1 : 0.5);
        const after = ((positions[index + 1] ?? 1) - current) * span - op.wall * (index + 1 < positions.length ? 1 : 0.5);
        return Math.max(0, Math.min(0.6, before / 2, after / 2));
      };
      if (op.fingerScoop) {
        const side = op.fingerScoop;
        const acrossX = side === "front" || side === "back";
        const span = acrossX ? depth : width;
        const cuts = acrossX ? dividerPositions.y : dividerPositions.x;
        const near = side === "front" || side === "left";
        const clear = (span - 2 * op.wall) * (near ? cuts[0] ?? 1 : 1 - (cuts.at(-1) ?? 0)) - (cuts.length ? op.wall / 2 : 0);
        const steep = op.fingerScoopSlope === 2;
        const room = stackable ? Math.max(0.5, lipBottom - 0.2 - floorZ) : h * 0.75;
        const reach = Math.min(steep ? 20 : 10, room * (steep ? 1.25 : 0.8), clear / 2);
        const rise = Math.min(room * (steep ? 1 : 0.45), reach * (steep ? 1.5 : 1));
        const run = (acrossX ? width : depth) - 2 * op.wall + 0.04;
        const [nx, ny] = { front: [1, 0], right: [0, 1], back: [-1, 0], left: [0, -1] }[side];
        const inward = op.wall - span / 2;
        const sketch = {
          id: idFactory("s"), name: "Finger scoop profile", seq: seq(), hidden: true,
          plane: { o: [-nx * run / 2 - ny * inward, -ny * run / 2 + nx * inward, 7 + op.floor], x: [-ny, nx, 0], n: [nx, ny, 0] },
          pts: [[0, rise], [reach, 0], [reach, -0.02], [-0.02, -0.02], [-0.02, rise]]
            .map(([x, y]) => ({ id: idFactory("p"), x, y })),
          ents: [],
        };
        const point = index => sketch.pts[index].id;
        const curve = Array.from({ length: 8 }, (_, i) => {
          const angle = (i + 1) * Math.PI / 18;
          const id = idFactory("p");
          sketch.pts.push({ id, x: reach * (1 - Math.cos(angle)), y: rise * (1 - Math.sin(angle)) });
          return id;
        });
        sketch.ents.push({ id: idFactory("e"), t: "spline", pts: [point(0), ...curve, point(1)], closed: false });
        for (let i = 1; i < 5; i++) sketch.ents.push({ id: idFactory("e"), t: "line", a: point(i), b: point((i + 1) % 5) });
        if (findRegions(resolveSketch(sketch)).length !== 1) fail("Finger scoop profile did not form one closed region");
        document.sketches.push(sketch);
        const mods = [{ id: idFactory("f"), seq: seq(), t: "bool", op: "intersect", tool: scoopEnvelope, m: IDENTITY.slice() }];
        solids.push(child({ t: "extrude", sketch: sketch.id, profiles: [{ key: sketch.ents.map(entity => entity.id).sort().join(","), pt: [reach / 10, rise / 10] }],
          dist: run, mode: "one", dist2: 0, mods }));
      }
      for (const [index, position] of dividerPositions.x.entries()) {
        const lo = op.closeGaps && op.openSides.includes("front") ? footprint.minY : -depth/2+op.wall-0.01;
        const hi = op.closeGaps && op.openSides.includes("back") ? footprint.maxY : depth/2-op.wall+0.01;
        const wall = divider(true, -width/2+op.wall+(width-2*op.wall)*position, lo, hi, "front", "back", jointRadius(dividerPositions.x, index, width - 2 * op.wall));
        solids.push(wall); dividerNodes.add(wall);
      }
      for (const [index, position] of dividerPositions.y.entries()) {
        const lo = op.closeGaps && op.openSides.includes("left") ? footprint.minX : -width/2+op.wall-0.01;
        const hi = op.closeGaps && op.openSides.includes("right") ? footprint.maxX : width/2-op.wall+0.01;
        const wall = divider(false, -depth/2+op.wall+(depth-2*op.wall)*position, lo, hi, "left", "right", jointRadius(dividerPositions.y, index, depth - 2 * op.wall));
        solids.push(wall); dividerNodes.add(wall);
      }
      if (op.lip) {
        const lipOuter = extrude("Stacking lip outside", width,depth,3.75, lipBottom, 8.2, op.closeGaps);
        const innerSections = rimProfile.map(([z,inset,r]) => roundedSketch(`Stacking lip inside at ${z} mm`, width-2*inset,depth-2*inset,r,z,op.closeGaps));
        lipOuter.mods.push({ id:idFactory("f"),seq:seq(),t:"bool",op:"cut",tool:loft(innerSections),m:IDENTITY.slice() });
        solids.push(child(lipOuter));
      }
    }
    node = group(solids);
  }
  if (op.openSides.length) {
    // Clear the opening and shared open corners without trimming closed neighbouring walls.
    const inset = Math.max(op.wall, 3.75), bottom = 7 + op.floor;
    const height = topZ + (op.lip ? 4.4 : 0) - bottom + 0.02;
    const cutters = op.openSides.flatMap(side => {
      const acrossX = side === "left" || side === "right";
      const direction = side === "left" || side === "front" ? -1 : 1;
      const opening = margin => {
        const loX = footprint.minX + (op.openSides.includes("left") ? -0.02 : margin), hiX = footprint.maxX - (op.openSides.includes("right") ? -0.02 : margin);
        const loY = footprint.minY + (op.openSides.includes("front") ? -0.02 : margin), hiY = footprint.maxY - (op.openSides.includes("back") ? -0.02 : margin);
        return { w: acrossX ? inset+0.02 : hiX-loX, d: acrossX ? hiY-loY : inset+0.02,
          x: acrossX ? (direction < 0 ? footprint.minX+inset/2 : footprint.maxX-inset/2) : (loX+hiX)/2,
          y: acrossX ? (loY+hiY)/2 : (direction < 0 ? footprint.minY+inset/2 : footprint.maxY-inset/2) };
      };
      const relief = [];
      if (floorRadius) {
        const r = opening(op.wall);
        // Extend into the cavity only at floor height so the open edge stays level.
        const reach = Math.max(0, op.wall + floorRadius + 0.02 - inset);
        const tool = { t: "prim", kind: "box", p: { w: r.w + (acrossX ? reach : 0), d: r.d + (acrossX ? 0 : reach), h: floorRadius + 0.02, r: 0, c: 0 }, mods: [] };
        relief.push(child(tool, r.x - (acrossX ? direction * reach / 2 : 0), r.y - (acrossX ? 0 : direction * reach / 2), bottom));
      }
      if (op.closeGaps && op.lip) {
        // Follow the closed neighbours' rim profile instead of cutting a notch
        // into their ledges at the joint. The body and upper rim meet at topZ.
        const peak = Math.max(op.wall,rimProfile[1][1]);
        const bodyMargin = z => {
          const fraction = Math.max(0,Math.min(1,(z-rimProfile[0][0])/(rimProfile[1][0]-rimProfile[0][0])));
          return Math.max(op.wall,op.wall+(rimProfile[1][1]-op.wall)*fraction);
        };
        const levels = [[bottom,bodyMargin(bottom)], ...rimProfile.slice(0,2).filter(([z]) => z>bottom).map(([z,inset]) => [z,Math.max(op.wall,inset)]), [topZ+0.01,peak]];
        const upper = rimProfile.slice(2).map(([z,inset]) => [z,inset]);
        return [...[levels,upper].map(stages => child(loft(stages.map(([z,margin]) => {
          const r = opening(margin);
          return roundedSketch(`Flush ${side} opening at ${z} mm`, r.w,r.d,0,z,false,[r.x,r.y]);
        })))), ...relief];
      }
      const r = opening(op.wall);
      const cutter = { t: "prim", kind: "box", p: { w:r.w,d:r.d,h:height,r:0,c:0 }, mods: [] };
      return [child(cutter,r.x,r.y,bottom), ...relief];
    });
    const dividers = node.children.filter(child => dividerNodes.has(child));
    node.children = node.children.filter(child => !dividerNodes.has(child));
    node.mods.push({ id: idFactory("f"), seq: seq(), t: "bool", src: "openSides", op: "cut", tool: group(cutters), m: IDENTITY.slice() });
    if (dividers.length) node = group([child(node), ...dividers]);
  }
  const centers = op.magnets ? magnetCenters(op.columns, op.rows) : [];
  if (op.magnets) {
    const bottom = op.kind === "baseplate" ? MAGNET_CARRIER_FLOOR : -0.01;
    const pocketHeight = op.magnets.depth + 0.01;
    const cutter = { t: "prim", kind: "cylinder", p: { w: op.magnets.diameter, d: op.magnets.diameter, h: pocketHeight, r: 0, c: 0 }, mods: [] };
    node.mods.push({ id: idFactory("f"), seq: seq(), t: "bool", src: "magnetPockets", op: "cut", tool: group(centers.map(([x, y]) => child(cutter, x, y, bottom))), m: IDENTITY.slice() });
  }
  if (op.kind === "baseplate" && clipSlots.length) {
    const cutters = clipSlots.flatMap(s => {
      const clearance = (s.width - BASEPLATE_CLIP.width) / 2;
      const { width, arm, barb, bottom, slotDepth } = BASEPLATE_CLIP;
      const outerClearance = Math.min(clearance, barb / 2);
      const innerClearance = Math.max(clearance, barb - outerClearance + 0.05);
      const slot = (w, d, h, x, z = -0.01) => child({ t: "prim", kind: "box", p: { w: s.axis === "x" ? w : d, d: s.axis === "x" ? d : w, h, r: 0, c: 0 }, mods: [] },
        s.x + (s.axis === "x" ? x : 0), s.y + (s.axis === "x" ? 0 : x), carrierHeight + z);
      // Separate leg pockets preserve the inner keeper walls that resist tile separation.
      return [slot(s.width, s.length, 5.02, 0, bottom + slotDepth - arm - clearance),
        ...[-1, 1].flatMap(sign => [
          // Keep the outer snap interference; reserve only the inward release travel needed.
          slot(arm + innerClearance + outerClearance, s.length, 5.02, sign * (width - arm + outerClearance - innerClearance) / 2),
          slot(arm + barb + 2 * clearance, s.length, 1.21, sign * (width - arm + barb) / 2),
        ])];
    });
    node.mods.push({ id: idFactory("f"), seq: seq(), t: "bool", src: "clipSlots", op: "cut", tool: group(cutters), m: IDENTITY.slice() });
  }
  const referencedSketches = new Set();
  JSON.stringify(node, (key, value) => { if (key === "sketch" && typeof value === "string") referencedSketches.add(value); return value; });
  const sketchSignatures = Object.fromEntries([...referencedSketches].map(id => [id, JSON.stringify(document.sketches.find(sketch => sketch.id === id))]));
  const recipe = { version: 1, ...op, width: envelope.width, depth: envelope.depth, topZ, protectedBaseHeight: op.kind === "baseplate" ? 0 : 7, outerRadius: op.kind === "baseplate" ? 4 : 3.75, totalHeight: envelope.height, pitch:42, heightUnit:7, sourceRevision, referenceFit: "unverified", baseplatePlacementZ:carrierHeight + 0.25,
    ...(op.magnets ? { magnetPockets: { ...op.magnets, count: centers.length, centers, carrierHeight, carrierFloor: op.kind === "baseplate" ? MAGNET_CARRIER_FLOOR : null, opening: op.kind === "baseplate" ? "top" : "bottom" } } : {}), ...(op.kind === "baseplate" && clipSlots.length ? { clipSlots: structuredClone(clipSlots) } : {}), nodeSignature:JSON.stringify(node), sketchSignatures };
  return { node, recipe };
}
