// Geometry kernel: turns the document's node trees into OpenCascade solids
// and meshes. Runs inside a Web Worker in the app, and directly in Node for tests.
import * as R from "replicad";
import { fontBytes, registerFont } from "./fonts.js";
import { facePatCells } from "./facepat.js";
import { shellField, isoSurface } from "./sdfshell.js";

let OC = null;
// a face normal as a unit vector (replicad's isn't normalized on curved faces)
const unitT = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export async function initKernel(opencascade, wasmBinary) {
  OC = await opencascade({ wasmBinary, locateFile: (f) => f });
  R.setOC(OC);
  for (const name of ["sans", "serif", "mono"]) await R.loadFont(fontBytes(name), name, true);
}

// ---------------------------------------------------------------- cache
const cache = new Map(); // key -> Shape (owned by cache)
const cacheNotes = new Map(); // key -> notes raised while that shape was built
const CACHE_MAX = 80;
function cacheGet(key) {
  const s = cache.get(key);
  if (!s) return null;
  cache.delete(key);
  cache.set(key, s); // LRU bump
  return s.clone();
}
function cachePut(key, shape) {
  if (cache.has(key)) return;
  cache.set(key, shape.clone());
  while (cache.size > CACHE_MAX) {
    const [k, s] = cache.entries().next().value;
    cache.delete(k);
    cacheNotes.delete(k);
    try { s.delete(); } catch (e) {}
  }
}
export function clearCache() {
  for (const s of cache.values()) try { s.delete(); } catch (e) {}
  cache.clear();
  cacheNotes.clear();
}

// ---------------------------------------------------------------- helpers
const EPS = 1e-7;
function transformShape(shape, m) {
  // m: column-major 4x4 (three.js Matrix4.elements)
  if (!m) return shape;
  const isId = m.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-12);
  if (isId) return shape;
  const trsf = new OC.gp_Trsf();
  trsf.SetValues(m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]);
  const op = new OC.BRepBuilderAPI_Transform(shape.wrapped, trsf, true, false);
  const out = R.cast(op.Shape());
  op.delete(); trsf.delete(); shape.delete();
  return out;
}

function polyDrawing(pts) {
  let pen = R.draw(pts[0]);
  for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
  return pen.close();
}
function ellipseDrawing(rx, ry) {
  if (Math.abs(rx - ry) < 1e-9) return R.drawCircle(rx);
  return rx >= ry ? R.drawEllipse(rx, ry) : R.drawEllipse(ry, rx).rotate(90, [0, 0]);
}
function ngon(n, rx, ry, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  return pts;
}
const clampPos = (v, min = 0.01) => (v > min ? v : min);
// map 2D points so they exactly fill a w x d box centred on the origin
function fitMap(pts, w, d) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const sx = w / (x1 - x0 || 1), sy = d / (y1 - y0 || 1), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return ([x, y]) => [(x - cx) * sx, (y - cy) * sy];
}
const fitPts = (pts, w, d) => pts.map(fitMap(pts, w, d));

function roundOff(shape, p) {
  // Tinkercad-style "Radius" / "Bevel" on a primitive: applied to every edge.
  // Clamped below half the smallest dimension: OpenCascade can hang otherwise.
  const lim = Math.min(clampPos(p.w), clampPos(p.d), clampPos(p.h)) / 2 * 0.96;
  p = { ...p, r: Math.min(p.r || 0, lim), c: Math.min(p.c || 0, lim) };
  // rounded upright corners only (bins, trays, plates)
  const rv = Math.min(p.rv || 0, Math.min(clampPos(p.w), clampPos(p.d)) / 2 * 0.96);
  if (rv > 0) {
    try { const s = shape.fillet(rv, (e) => e.inDirection("Z")); shape.delete(); shape = s; } catch (e) { throw new Error("Corner radius is too large for this shape"); }
  }
  if (p.r > 0) {
    try { const s = shape.fillet(p.r); shape.delete(); return s; } catch (e) { throw new Error("Radius is too large for this shape"); }
  }
  if (p.c > 0) {
    try { const s = shape.chamfer(p.c); shape.delete(); return s; } catch (e) { throw new Error("Bevel is too large for this shape"); }
  }
  return shape;
}

// ---------------------------------------------------------------- primitives
// Local frame: centered on X/Y, resting on Z = 0, Z up.
function buildPrim(kind, p) {
  const w = clampPos(p.w), d = clampPos(p.d), h = clampPos(p.h);
  switch (kind) {
    case "box": {
      return roundOff(R.makeBaseBox(w, d, h), p);
    }
    case "cylinder": {
      // round ones are true cylinders (one smooth side face), oval ones are extruded ellipses
      const s = Math.abs(w - d) < 1e-9 ? R.makeCylinder(w / 2, h, [0, 0, 0], [0, 0, 1]) : ellipseDrawing(w / 2, d / 2).sketchOnPlane("XY").extrude(h);
      return roundOff(s, p);
    }
    case "tube": {
      const t = Math.min(clampPos(p.wall ?? 2), Math.min(w, d) / 2 - 0.01);
      const outer = ellipseDrawing(w / 2, d / 2);
      const inner = ellipseDrawing(w / 2 - t, d / 2 - t);
      return outer.cut(inner).sketchOnPlane("XY").extrude(h);
    }
    case "cone": {
      const top = Math.max(0, Math.min(1, p.top ?? 0));
      const base = ellipseDrawing(w / 2, d / 2).sketchOnPlane("XY");
      if (top < 0.005) return base.loftWith([], { endPoint: [0, 0, h], ruled: true });
      const lid = ellipseDrawing((w / 2) * top, (d / 2) * top).sketchOnPlane("XY", h);
      return base.loftWith(lid, { ruled: true });
    }
    case "pyramid": {
      const n = Math.max(3, Math.round(p.sides ?? 4));
      const rot = n === 4 ? Math.PI / 4 : Math.PI / 2;
      const k = n === 4 ? Math.SQRT1_2 : 1;
      const pts = ngon(n, (w / 2) / k, (d / 2) / k, rot);
      if (n === 4) for (const q of pts) { q[0] = Math.sign(q[0]) * w / 2; q[1] = Math.sign(q[1]) * d / 2; }
      return polyDrawing(pts).sketchOnPlane("XY").loftWith([], { endPoint: [0, 0, h], ruled: true });
    }
    case "prism": {
      const n = Math.max(3, Math.round(p.sides ?? 6));
      const s = polyDrawing(ngon(n, w / 2, d / 2, Math.PI / 2)).sketchOnPlane("XY").extrude(h);
      return roundOff(s, p);
    }
    case "wedge": {
      // Ramp: right triangle in XZ, extruded along Y.
      const s = polyDrawing([[-w / 2, 0], [w / 2, 0], [-w / 2, h]])
        .sketchOnPlane(new R.Plane([0, d / 2, 0], [1, 0, 0], [0, -1, 0]))
        .extrude(d);
      return roundOff(s, p);
    }
    case "sphere": {
      if (Math.abs(w - d) < 1e-9 && Math.abs(w - h) < 1e-9) return R.makeSphere(w / 2).translate(0, 0, h / 2);
      return R.makeEllipsoid(w / 2, d / 2, h / 2).translate(0, 0, h / 2);
    }
    case "hemisphere": {
      const e = Math.abs(w - d) < 1e-9 && Math.abs(w / 2 - h) < 1e-9 ? R.makeSphere(h) : R.makeEllipsoid(w / 2, d / 2, h);
      const half = e.cutPlane("XY", 0, "positive");
      e.delete();
      return half;
    }
    case "torus": {
      const tube = Math.min(clampPos(p.tube ?? 5), w / 2 - 0.01);
      const R0 = w / 2 - tube / 2;
      const ring = R.drawCircle(tube / 2).translate(R0, 0)
        .sketchOnPlane(new R.Plane([0, 0, tube / 2], [1, 0, 0], [0, -1, 0]))
        .revolve([0, 0, 1], { origin: [0, 0, 0] });
      return ring;
    }
    case "text": {
      // Tinkercad-style 3D text, centred on the origin
      const curve = Math.max(-350, Math.min(350, +p.curve || 0));
      if (Math.abs(curve) > 0.5) {
        // text bent along an arc: each letter turns to follow the curve
        const gl = glyphDrawings({ str: p.text, size: p.size, font: p.font });
        const span = Math.max(1e-3, gl[gl.length - 1].u - gl[0].u + (p.size || 10) * 0.7);
        const sgn = Math.sign(curve), R0 = span / ((Math.abs(curve) * Math.PI) / 180);
        const parts = gl.map((g) => {
          const th = g.u / R0;
          const x = R0 * Math.sin(th), y = sgn * (R0 * Math.cos(th) - R0);
          return g.d.rotate((-sgn * th * 180) / Math.PI, [0, 0]).translate(x, y).sketchOnPlane("XY").extrude(clampPos(p.h || 5));
        });
        let out = parts[0];
        for (let i = 1; i < parts.length; i++) { const f = out.fuse(parts[i]); out.delete(); parts[i].delete(); out = f; }
        const bb = out.boundingBox.center;
        return out.translate(-bb[0], -bb[1], 0);
      }
      let d = textDrawing({ str: p.text, size: p.size, font: p.font });
      const c = d.boundingBox.center;
      d = d.translate(-c[0], -c[1]);
      return d.sketchOnPlane("XY").extrude(clampPos(p.h || 5));
    }
    case "star": {
      const n = Math.max(3, Math.min(24, Math.round(p.points ?? 5)));
      const k = Math.max(0.1, Math.min(0.95, p.inner ?? 0.5));
      const pts = [];
      for (let i = 0; i < 2 * n; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? k : 1;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return polyDrawing(fitPts(pts, w, d)).sketchOnPlane("XY").extrude(h);
    }
    case "heart": {
      // four cubic curves, fitted exactly to the w x d box
      const segs = [
        [[0, -1], [0.35, -0.55], [1, -0.25], [1, 0.3]],
        [[1, 0.3], [1, 0.95], [0.1, 1.05], [0, 0.6]],
        [[0, 0.6], [-0.1, 1.05], [-1, 0.95], [-1, 0.3]],
        [[-1, 0.3], [-1, -0.25], [-0.35, -0.55], [0, -1]],
      ];
      const bez = (q, t) => { const u = 1 - t; return [0, 1].map((i) => u * u * u * q[0][i] + 3 * u * u * t * q[1][i] + 3 * u * t * t * q[2][i] + t * t * t * q[3][i]); };
      const all = [];
      for (const q of segs) for (let i = 0; i <= 64; i++) all.push(bez(q, i / 64));
      const map = fitMap(all, w, d);
      let pen = R.draw(map(segs[0][0]));
      for (const q of segs) pen = pen.cubicBezierCurveTo(map(q[3]), map(q[1]), map(q[2]));
      return pen.close().sketchOnPlane("XY").extrude(h);
    }
    case "roof": {
      // gable roof: a triangle across X, run along Y
      return polyDrawing([[-w / 2, 0], [w / 2, 0], [0, h]])
        .sketchOnPlane(new R.Plane([0, d / 2, 0], [1, 0, 0], [0, -1, 0]))
        .extrude(d);
    }
    case "roundroof": {
      // half of an oval cylinder lying along Y
      const pen = R.draw([w / 2, 0]).lineTo([-w / 2, 0]);
      const half = Math.abs(w / 2 - h) < 1e-9 ? pen.threePointsArcTo([w / 2, 0], [0, h]) : pen.ellipseTo([w / 2, 0], w / 2, h, 0, false, false);
      return half.close()
        .sketchOnPlane(new R.Plane([0, d / 2, 0], [1, 0, 0], [0, -1, 0]))
        .extrude(d);
    }
    case "paraboloid": {
      if (Math.abs(w - d) < 1e-9) {
        // a parabola is exactly one quadratic curve; spin it about Z
        return R.draw([0, 0]).lineTo([w / 2, 0]).quadraticBezierCurveTo([0, h], [w / 4, h]).close()
          .sketchOnPlane("XZ").revolve([0, 0, 1], { origin: [0, 0, 0] });
      }
      const fr = [0.8, 0.6, 0.4, 0.2];
      const base = ellipseDrawing(w / 2, d / 2).sketchOnPlane("XY");
      const lids = fr.map((f) => ellipseDrawing((w / 2) * f, (d / 2) * f).sketchOnPlane("XY", h * (1 - f * f)));
      return base.loftWith(lids, { endPoint: [0, 0, h], ruled: false });
    }
    case "gem": {
      // icosahedron stretched to the box
      const g = (1 + Math.sqrt(5)) / 2;
      const V = [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]];
      const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      const P = V.map(([x, y, z]) => [(x / g) * (w / 2), (y / g) * (d / 2), ((z / g) + 1) * (h / 2)]);
      return R.makeSolid(F.map((f) => R.makePolygon(f.map((i) => P[i]))));
    }
    case "capsule": {
      // a pill lying along X: length w, section d x h, rounded ends, resting on Z = 0
      const ry = d / 2, rz = h / 2, cx = Math.min(ry, rz, w / 2);
      const L = Math.max(0, w - 2 * cx);
      if (Math.abs(ry - rz) < 1e-6 && cx >= ry - 1e-6) {
        // round section: analytic cylinder + spheres (fast booleans)
        const r = ry;
        let out = R.makeSphere(r).translate(-L / 2, 0, rz);
        const add = (b) => { const f = out.fuse(b); out.delete(); b.delete(); out = f; };
        if (L > 1e-6) add(R.makeCylinder(r, L, [-L / 2, 0, rz], [1, 0, 0]));
        add(R.makeSphere(r).translate(L / 2, 0, rz));
        return out.simplify ? out.simplify() : out;
      }
      const parts = [];
      if (L > 1e-6) parts.push(ellipseDrawing(ry, rz).sketchOnPlane(new R.Plane([-L / 2, 0, rz], [0, 1, 0], [1, 0, 0])).extrude(L));
      parts.push(R.makeEllipsoid(cx, ry, rz).translate(-L / 2, 0, rz), R.makeEllipsoid(cx, ry, rz).translate(L / 2, 0, rz));
      let out = parts[0];
      for (let i = 1; i < parts.length; i++) { const f = out.fuse(parts[i]); out.delete(); parts[i].delete(); out = f; }
      return out;
    }
    case "arrow": {
      // a flat arrow pointing +X, fitted to w x d, h thick
      const head = Math.min(w * 0.45, d * 1.1), shaft = d * 0.42;
      const pts = [[-w / 2, -shaft / 2], [w / 2 - head, -shaft / 2], [w / 2 - head, -d / 2], [w / 2, 0], [w / 2 - head, d / 2], [w / 2 - head, shaft / 2], [-w / 2, shaft / 2]];
      return polyDrawing(pts).sketchOnPlane("XY").extrude(h);
    }
    case "spring": {
      const wire = Math.max(0.2, Math.min(p.wire ?? 2, Math.min(w, d) / 2 - 0.05));
      const r = Math.min(w, d) / 2 - wire / 2;
      const z0 = wire / 2, len = Math.max(0.01, h - wire);
      // never let the coils touch: a short spring gets fewer turns
      const turns = Math.max(0.25, Math.min(p.turns ?? 5, len / (wire * 1.05)));
      const pitch = len / turns;
      const helix = helixWire(pitch, len, r, [0, 0, z0], [0, 0, 1], false);
      const sp = helix.startPoint.toTuple();
      const rad = [sp[0], sp[1], 0], rl = Math.hypot(...rad) || 1;
      const tan0 = [-rad[1] / rl * 2 * Math.PI * r, rad[0] / rl * 2 * Math.PI * r, pitch], tl = Math.hypot(...tan0);
      const tan = tan0.map((v) => v / tl);
      const sk = R.drawCircle(wire / 2).sketchOnPlane(new R.Plane(sp, [rad[0] / rl, rad[1] / rl, 0], tan));
      const prof = sk.wire.clone();
      sk.delete();
      try { return R.genericSweep(prof, helix, { frenet: true }, false); }
      catch (e) { throw new Error("The spring couldn't be built with these sizes"); }
      finally { prof.delete(); helix.delete(); }
    }
    default:
      throw new Error("Unknown shape: " + kind);
  }
}

// ---------------------------------------------------------------- text
// size = height of capital letters in mm; (x, y) = left end of the baseline.
function textDrawing(t) {
  const str = String(t.str || "").replace(/\s+$/, "");
  if (!str.trim()) throw new Error("Type some text first");
  const fontName = KNOWN_FONTS.has(t.font) ? t.font : "sans";
  const font = R.getFont(fontName);
  const cap = (font.tables.os2 && font.tables.os2.sCapHeight) || font.unitsPerEm * 0.7;
  const fontSize = clampPos(t.size || 10) * font.unitsPerEm / cap;
  let d = R.drawText(str, { startX: 0, startY: 0, fontSize, fontFamily: fontName });
  // line the solid up with the outline the sketch shows (baseline at y = 0, text running +x)
  const pb = font.getPath(str, 0, 0, fontSize).getBoundingBox();
  const [lo] = d.boundingBox.bounds;
  d = d.translate(pb.x1 - lo[0], -pb.y2 - lo[1]);
  if (t.angle) d = d.rotate(t.angle, [0, 0]);
  return d.translate(t.x || 0, t.y || 0);
}

// ---------------------------------------------------------------- sketch regions
function loopDrawing(loop) {
  if (loop.length === 1 && loop[0].t === "circle") {
    const c = loop[0];
    return R.drawCircle(c.r).translate(c.c[0], c.c[1]);
  }
  let pen = R.draw(loop[0].a);
  for (let i = 0; i < loop.length; i++) {
    const s = loop[i];
    const last = i === loop.length - 1;
    const end = last ? loop[0].a : s.b;
    if (s.t === "line") pen = last ? pen : pen.lineTo(end);
    else if (s.t === "arc") pen = pen.threePointsArcTo(end, s.m);
    else if (s.t === "bez") {
      // spline pieces: cubic Bezier spans (the last one lands exactly on the loop start)
      s.spans.forEach((b, k) => { pen = pen.cubicBezierCurveTo(k === s.spans.length - 1 ? end : b[3], b[1], b[2]); });
    }
  }
  return pen.close();
}
function regionDrawing(region) {
  if (region.text) return textDrawing(region.text);
  let dr = loopDrawing(region.outer);
  for (const h of region.holes || []) dr = dr.cut(loopDrawing(h));
  return dr;
}
function regionsDrawing(regions, stretch) {
  let dr = null;
  for (const r of regions) {
    const d = regionDrawing(r);
    dr = dr ? dr.fuse(d) : d;
  }
  if (stretch) {
    if (Math.abs(stretch[0] - 1) > 1e-12) dr = dr.stretch(stretch[0], [0, 1], [0, 0]); // affinity about the y axis = stretch along x
    if (Math.abs(stretch[1] - 1) > 1e-12) dr = dr.stretch(stretch[1], [1, 0], [0, 0]);
  }
  return dr;
}
function planeOf(pl, shift = 0) {
  const o = [pl.o[0] + pl.n[0] * shift, pl.o[1] + pl.n[1] * shift, pl.o[2] + pl.n[2] * shift];
  return new R.Plane(o, pl.x, pl.n);
}
function buildExtrude(node) {
  if (!node.regions || !node.regions.length) throw new Error("Select a closed profile to extrude");
  const d1 = node.dist || 0;
  const mode = node.mode || "one";
  const mk = (start, len) => {
    const dr = regionsDrawing(node.regions, node.stretch);
    return dr.sketchOnPlane(planeOf(node.plane, start)).extrude(len);
  };
  if (Math.abs(d1) < 1e-6 && mode !== "two") throw new Error("Distance can't be zero");
  if (mode === "sym") return mk(-Math.abs(d1) / 2, Math.abs(d1));
  if (mode === "two") {
    const a = mk(0, Math.abs(d1) || 0.001);
    const d2 = Math.abs(node.dist2 || 0);
    if (d2 < 1e-6) return a;
    const b = mk(-d2, d2);
    const u = a.fuse(b); a.delete(); b.delete();
    return u;
  }
  return d1 > 0 ? mk(0, d1) : mk(d1, -d1);
}
function buildRevolve(node) {
  if (!node.regions || !node.regions.length) throw new Error("Select a closed profile to revolve");
  if (!node.axis && !node.axisWorld) throw new Error("Pick an axis: a sketch line, or X, Y or Z");
  const pl = planeOf(node.plane);
  let a, dir;
  if (node.axisWorld) { a = node.axisWorld.o; dir = node.axisWorld.d; }
  else {
    const st = node.stretch || [1, 1];
    const to3 = (p) => pl.toWorldCoords([p[0] * st[0], p[1] * st[1]]).toTuple();
    a = to3(node.axis.a);
    const b = to3(node.axis.b);
    dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  }
  const n = node.plane.n, dl = Math.hypot(...dir) || 1;
  if (Math.abs((dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2]) / (dl * (Math.hypot(...n) || 1))) > 1e-6) throw new Error("The axis must lie along the sketch plane, not point out of it");
  // a profile that crosses the axis would turn inside out
  {
    const dn = dir.map((v) => v / dl);
    let pos = false, neg = false;
    const st = node.stretch || [1, 1];
    for (const r of node.regions) for (const s of r.outer || []) for (const q0 of [s.a, s.b, s.m, s.c].filter(Boolean)) {
      const w = pl.toWorldCoords([q0[0] * st[0], q0[1] * st[1]]).toTuple();
      const v = [w[0] - a[0], w[1] - a[1], w[2] - a[2]];
      const side = (v[1] * dn[2] - v[2] * dn[1]) * n[0] + (v[2] * dn[0] - v[0] * dn[2]) * n[1] + (v[0] * dn[1] - v[1] * dn[0]) * n[2];
      if (side > 1e-2) pos = true;
      if (side < -1e-2) neg = true;
    }
    if (pos && neg) throw new Error("The profile crosses the axis. Move it to one side of the axis.");
  }
  // points a hair off the axis (typed lengths and angles round a little) go right onto it, so the
  // solid closes cleanly instead of turning inside out by a few thousandths of a millimeter
  let regions = node.regions;
  {
    const dn = dir.map((v) => v / dl), st = node.stretch || [1, 1];
    const snap = (q0) => {
      if (!q0) return q0;
      const w = pl.toWorldCoords([q0[0] * st[0], q0[1] * st[1]]).toTuple();
      const v = [w[0] - a[0], w[1] - a[1], w[2] - a[2]], t = v[0] * dn[0] + v[1] * dn[1] + v[2] * dn[2];
      const off = Math.hypot(v[0] - t * dn[0], v[1] - t * dn[1], v[2] - t * dn[2]);
      if (off < 1e-9 || off > 1e-2) return q0;
      const lp = pl.toLocalCoords(new R.Vector([a[0] + t * dn[0], a[1] + t * dn[1], a[2] + t * dn[2]]));
      const out = [lp.x / st[0], lp.y / st[1]];
      lp.delete && lp.delete();
      return out;
    };
    const fix = (s0) => ({ ...s0, a: snap(s0.a), b: snap(s0.b) });
    regions = node.regions.map((r) => ({ ...r, outer: (r.outer || []).map(fix), holes: (r.holes || []).map((h) => h.map(fix)) }));
  }
  const dr = regionsDrawing(regions, node.stretch);
  return dr.sketchOnPlane(pl).revolve(dir, { origin: a, angle: node.angle ?? 360 });
}

// Sweep (Fusion-style): closed profiles swept along a path of sketch lines and arcs.
function sweepPath(segs) {
  if (!segs || !segs.length) throw new Error("Pick a path: a sketch line, arc or a chain of them");
  const edges = segs.flatMap((s) => (s.t === "line" ? [R.makeLine(s.a, s.b)] : s.t === "arc" ? [R.makeThreePointArc(s.a, s.m, s.b)] : s.t === "bez" ? s.spans.map((b) => R.makeBezierCurve(b)) : s.t === "bsp" ? [bsplineThrough(s.pts)] : [R.makeCircle(s.r, s.c, s.n)]));
  return R.assembleWire(edges);
}
function pipe(wire, spine, orient) {
  const b = new OC.BRepOffsetAPI_MakePipeShell(spine.wrapped);
  try {
    b.SetTransitionMode(OC.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);
    if (orient === "parallel") {
      // the profile keeps its direction instead of turning with the path
      const ax = new OC.gp_Ax2(new OC.gp_Pnt(0, 0, 0), new OC.gp_Dir(0, 0, 1), new OC.gp_Dir(1, 0, 0));
      b.SetMode(ax);
      ax.delete();
    }
    b.Add(wire.wrapped, false, false);
    b.Build();
    if (!b.IsDone()) throw new Error("x");
    b.MakeSolid();
    const out = R.cast(b.Shape());
    if (!(safeVolume(out) > 1e-9)) { out.delete(); throw new Error("x"); }
    return out;
  } catch (e) {
    throw new Error("Couldn't sweep the profile along this path. Check that the profile is not wider than the path's tightest bend.");
  } finally { b.delete(); }
}
// ---------------------------------------------------------------- sweep: distance, taper, twist
// A path trimmed to a fraction of its length, and twisted/tapered sweeps built from profile
// copies placed along the path (rotation-minimizing frames), joined by one pipe shell.
const swV = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], len: (a) => Math.hypot(a[0], a[1], a[2]), nrm: (a) => {
  let l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}, lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] };
function swBezPt(s, t) {
  let u = 1 - t;
  return [0, 1, 2].map((i) => u * u * u * s[0][i] + 3 * u * u * t * s[1][i] + 3 * u * t * t * s[2][i] + t * t * t * s[3][i]);
}
function swBezD(s, t) {
  let u = 1 - t;
  return [0, 1, 2].map((i) => 3 * (u * u * (s[1][i] - s[0][i]) + 2 * u * t * (s[2][i] - s[1][i]) + t * t * (s[3][i] - s[2][i])));
}
function swBezSplitL(s, t) {
  let V = swV, a = V.lerp(s[0], s[1], t), b = V.lerp(s[1], s[2], t), c = V.lerp(s[2], s[3], t), d = V.lerp(a, b, t), e = V.lerp(b, c, t), f = V.lerp(d, e, t);
  return [s[0], a, d, f];
}
function swSeg(s) {
  let V = swV;
  if (s.t === "line") {
    let d = V.sub(s.b, s.a), L = V.len(d), tg2 = V.mul(d, 1 / (L || 1));
    return { s, len: L, at: (u) => ({ p: V.add(s.a, V.mul(d, u)), t: tg2 }), cut: (f) => ({ t: "line", a: s.a, b: V.add(s.a, V.mul(d, f)) }) };
  }
  if (s.t === "arc" || s.t === "circle") {
    let c, r, u02, v02, sweep;
    if (s.t === "arc") {
      let am2 = V.sub(s.m, s.a), ab = V.sub(s.b, s.a), nn = V.cross(ab, am2), d2 = V.dot(nn, nn);
      if (d2 < 1e-18) return swSeg({ t: "line", a: s.a, b: s.b });
      let num = V.cross(V.sub(V.mul(am2, V.dot(ab, ab)), V.mul(ab, V.dot(am2, am2))), nn);
      c = V.add(s.a, V.mul(num, 1 / (2 * d2)));
      let ra2 = V.sub(s.a, c);
      r = V.len(ra2);
      u02 = V.mul(ra2, 1 / r);
      let rm2 = V.sub(s.m, c), rb = V.sub(s.b, c), ax = V.nrm(V.cross(ra2, rm2));
      v02 = V.cross(ax, u02);
      let ang = (p) => {
        let a = Math.atan2(V.dot(p, v02), V.dot(p, u02));
        return a < 0 ? a + 2 * Math.PI : a;
      }, tm2 = ang(rm2), tb = ang(rb);
      sweep = tb > tm2 ? tb : tb - 2 * Math.PI;
    } else {
      let e = R.makeCircle(s.r, s.c, s.n), p02 = e.startPoint.toTuple();
      e.delete();
      c = s.c;
      r = s.r;
      u02 = V.nrm(V.sub(p02, c));
      v02 = V.cross(V.nrm(s.n), u02);
      sweep = 2 * Math.PI;
    }
    let P = (a) => V.add(c, V.add(V.mul(u02, r * Math.cos(a)), V.mul(v02, r * Math.sin(a)))), sg2 = Math.sign(sweep);
    return {
      s,
      len: r * Math.abs(sweep),
      at: (u) => {
        let a = u * sweep;
        return { p: P(a), t: V.mul(V.add(V.mul(u02, -Math.sin(a)), V.mul(v02, Math.cos(a))), sg2) };
      },
      cut: (f) => s.t === "circle" && f >= 1 - 1e-9 ? s : { t: "arc", a: P(0), b: P(f * sweep), m: P(f * sweep / 2) }
    };
  }
  if (s.t === "bez") {
    let K2 = 48, tab = [], total = 0;
    s.spans.forEach((sp, i) => {
      tab.push({ i, t: 0, l: total });
      let prev = sp[0];
      for (let j2 = 1; j2 <= K2; j2++) {
        let p = swBezPt(sp, j2 / K2);
        total += V.len(V.sub(p, prev));
        tab.push({ i, t: j2 / K2, l: total });
        prev = p;
      }
    });
    let loc = (f) => {
      let target = Math.max(0, Math.min(1, f)) * total;
      for (let k = 1; k < tab.length; k++) {
        let a = tab[k - 1], b = tab[k];
        if (a.i !== b.i) continue;
        if (b.l >= target - 1e-12) {
          let w = b.l - a.l > 1e-12 ? (target - a.l) / (b.l - a.l) : 0;
          return { i: b.i, t: a.t + (b.t - a.t) * Math.max(0, Math.min(1, w)) };
        }
      }
      let z = tab[tab.length - 1];
      return { i: z.i, t: 1 };
    };
    return {
      s,
      len: total,
      at: (u) => {
        let q2 = loc(u), sp = s.spans[q2.i], d = swBezD(sp, q2.t);
        if (V.len(d) < 1e-12) d = V.sub(sp[3], sp[0]);
        return { p: swBezPt(sp, q2.t), t: V.nrm(d) };
      },
      cut: (f) => {
        let q2 = loc(f), sp = s.spans.slice(0, q2.i);
        if (q2.t > 1e-9) sp.push(swBezSplitL(s.spans[q2.i], q2.t));
        if (!sp.length) sp.push(swBezSplitL(s.spans[0], 1e-6));
        return { t: "bez", a: sp[0][0], b: sp[sp.length - 1][3], spans: sp };
      }
    };
  }
  if (s.t === "bsp") {
    // a smooth curve through points: walked as the polyline through them (for stations and trims)
    const P = s.pts, cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + V.len(V.sub(P[i], P[i - 1])));
    const total = cum[cum.length - 1] || 1;
    const loc = (u) => { const L = Math.max(0, Math.min(1, u)) * total; let i = 1; while (i < P.length - 1 && cum[i] < L) i++; const w = (L - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return { i, w }; };
    return {
      s, len: total,
      at: (u) => { const { i, w } = loc(u); return { p: V.lerp(P[i - 1], P[i], w), t: V.nrm(V.sub(P[i], P[i - 1])) }; },
      cut: (f) => { const { i, w } = loc(f); const pts = P.slice(0, i).concat([V.lerp(P[i - 1], P[i], w)]); return pts.length < 2 ? { t: "line", a: P[0], b: P[1] } : { t: "bsp", a: pts[0], b: pts[pts.length - 1], pts }; },
    };
  }
  throw new Error("Unsupported path segment");
}
function swTrim(segs, f) {
  let ps2 = segs.map(swSeg), total = ps2.reduce((a, q2) => a + q2.len, 0), target = f * total, acc = 0, out = [];
  for (let q2 of ps2) {
    if (acc + q2.len <= target + 1e-9) {
      out.push(q2.s);
      acc += q2.len;
      if (Math.abs(acc - target) < 1e-9) break;
      continue;
    }
    out.push(q2.cut((target - acc) / q2.len));
    break;
  }
  return out;
}
function swMat3(a, b) {
  let r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j2 = 0; j2 < 3; j2++) r[i][j2] = a[i][0] * b[0][j2] + a[i][1] * b[1][j2] + a[i][2] * b[2][j2];
  return r;
}
function swRot(ax, an2) {
  let [x, y, z] = ax, c = Math.cos(an2), s = Math.sin(an2), t = 1 - c;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
}
function swApply(m, p) {
  return [m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2], m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2], m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2]];
}
function swStations(segs, n) {
  let V = swV, ps2 = segs.map(swSeg), total = ps2.reduce((a, q2) => a + q2.len, 0), K2 = Math.max(1, Math.ceil(240 / n)), D = n * K2, seg = 0, acc = 0, T2 = [], P = [], A = [], turn = 0;
  for (let j2 = 0; j2 <= D; j2++) {
    let s = j2 / D * total;
    while (seg < ps2.length - 1 && s >= acc + ps2[seg].len - 1e-12) {
      acc += ps2[seg].len;
      seg++;
    }
    let u = ps2[seg].len > 0 ? Math.max(0, Math.min(1, (s - acc) / ps2[seg].len)) : 0, r = ps2[seg].at(u);
    T2.push(r.t);
    P.push(r.p);
    if (j2 === 0) A.push([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    else {
      let a = T2[j2 - 1], b = r.t, c = V.cross(a, b), sn2 = V.len(c), cs2 = V.dot(a, b);
      if (sn2 > 1e-12) {
        let an2 = Math.atan2(sn2, cs2);
        turn += an2;
        A.push(swMat3(swRot(V.mul(c, 1 / sn2), an2), A[j2 - 1]));
      } else if (cs2 < 0) throw new Error("The path doubles back on itself");
      else A.push(A[j2 - 1]);
    }
  }
  let st2 = [];
  for (let k = 0; k <= n; k++) {
    let j2 = k * K2;
    st2.push({ s: k / n * total, p: P[j2], t: T2[j2], A: A[j2] });
  }
  return { total, st: st2, turn };
}
function swDiag(w) {
  let b = w.boundingBox, [a, c] = b.bounds;
  b.delete && b.delete();
  return Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
}
function swOffset(w, d, grow) {
  let d02 = swDiag(w), pick = (sg2) => {
    let o2 = w.clone().offset2D(sg2 * d, "intersection");
    return o2;
  }, o;
  try {
    o = pick(1);
    let bigger = swDiag(o) > d02 + 1e-9;
    if (bigger !== (d > 0 === grow)) {
      o.delete();
      o = pick(-1);
    }
  } catch (e) {
    throw new Error("The taper is too large: the profile collapses before the end of the sweep.");
  }
  return o;
}
function swPipe(spine, wires) {
  let ps2 = new OC.BRepOffsetAPI_MakePipeShell(spine.wrapped);
  try {
    ps2.SetTransitionMode(OC.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);
    for (let w of wires) ps2.Add(w.wrapped, false, false);
    ps2.Build();
    if (!ps2.IsDone()) throw new Error("x");
    ps2.MakeSolid();
    let o = R.cast(ps2.Shape()), v = safeVolume(o);
    if (v < 0) {
      let r = R.cast(o.wrapped.Reversed());
      o.delete();
      o = r;
      v = safeVolume(o);
    }
    if (!(v > 1e-9)) {
      o.delete();
      throw new Error("x");
    }
    return o;
  } catch (e) {
    throw new Error("Couldn't sweep with this twist and taper. Try a smaller angle, a shorter distance, or a gentler path.");
  } finally {
    ps2.delete();
  }
}
// A twist along one straight line (no taper): an exact helical sweep, the profile guided by a
// helix around the line. Far lighter than lofting through many turned copies of the profile,
// so patterns of these cuts (spiral fidget cones, twisted vases) build quickly.
function swHelical(wire, seg, twist) {
  const a = seg.a, b = seg.b, L = dist(a, b), tw = (twist * Math.PI) / 180;
  if (L < 1e-6 || Math.abs(tw) < 1e-9) return null;
  const dir = Vec.norm(Vec.sub(b, a));
  const pitch = (L * 2 * Math.PI) / Math.abs(tw);
  const helix = helixWire(pitch, L, 10, a, dir, tw < 0);
  const spine = sweepPath([seg]);
  const ps = new OC.BRepOffsetAPI_MakePipeShell(spine.wrapped);
  try {
    ps.SetMode(helix.wrapped, false, OC.BRepFill_TypeOfContact.BRepFill_NoContact);
    ps.Add(wire.wrapped, false, false);
    ps.Build();
    if (!ps.IsDone()) return null;
    ps.MakeSolid();
    const out = R.cast(ps.Shape());
    if (!(Math.abs(safeVolume(out)) > 1e-9)) { out.delete(); return null; }
    return out;
  } catch (e) { return null; }
  finally { ps.delete(); spine.delete(); helix.delete(); }
}
function swTwistTaper(wire, segs, taper, twist, isHole) {
  if (Math.abs(taper) < 1e-9 && segs.length === 1 && segs[0].t === "line" && !swTwistTaper.noHelix) {
    const h = swHelical(wire, segs[0], twist);
    if (h) return h;
  }
  let V = swV, tan = Math.tan(taper * Math.PI / 180), tw = twist * Math.PI / 180, ps2 = segs.map(swSeg), total = ps2.reduce((a, q2) => a + q2.len, 0);
  let nTw = Math.ceil(Math.abs(twist) / 12), n = Math.max(2, nTw, Math.min(segs.length + 1, 12)), probe = swStations(segs, n);
  n = Math.max(n, Math.ceil(probe.turn * 180 / Math.PI / 20) + 1);
  n = Math.min(n, 64);
  let S = n === probe.st.length - 1 ? probe : swStations(segs, n), P02 = S.st[0].p, wires = [], ec2 = null;
  try {
    for (let k = 0; k <= n; k++) {
      let st2 = S.st[k], d = tan * st2.s, w = wire.clone();
      if (Math.abs(d) > 1e-7) w = swOffset(w, d, !isHole);
      let ne = w.edges, cnt = ne.length;
      ne.forEach((e) => e.delete());
      if (ec2 === null) ec2 = cnt;
      else if (cnt !== ec2) throw new Error("The taper changes this profile too much (some of its edges vanish). Use a smaller taper angle or distance.");
      let Rm = swMat3(swRot(st2.t, tw * (S.total ? st2.s / S.total : 0)), st2.A), tr2 = V.sub(st2.p, swApply(Rm, P02)), m = [Rm[0][0], Rm[1][0], Rm[2][0], 0, Rm[0][1], Rm[1][1], Rm[2][1], 0, Rm[0][2], Rm[1][2], Rm[2][2], 0, tr2[0], tr2[1], tr2[2], 1];
      wires.push(transformShape(w, m));
    }
    let spine = sweepPath(segs);
    try {
      return swPipe(spine, wires);
    } finally {
      spine.delete();
    }
  } finally {
    wires.forEach((w) => w.delete && w.delete());
  }
}

// Path + guide rail (like Fusion's): the profile turns about the path to keep facing the rail and
// (with scale on) grows or shrinks with its distance from the path. At each station along the
// path the rail is found where it crosses the plane across the path there.
function railPoints(railSegs) {
  const pts = [];
  for (const s of railSegs) {
    if (s.t === "bsp") { for (const q of s.pts) pts.push(q); continue; }
    const g = swSeg(s);
    const n = s.t === "line" ? 1 : 64;
    for (let i = pts.length ? 1 : 0; i <= n; i++) pts.push(g.at(i / n).p);
  }
  return pts;
}
function railAt(R0, p, t, prev) {
  const V = swV;
  let best = null, bd = Infinity;
  for (let i = 1; i < R0.length; i++) {
    const a = R0[i - 1], b = R0[i];
    const da = V.dot(V.sub(a, p), t), db = V.dot(V.sub(b, p), t);
    if ((da > 0) === (db > 0) && Math.abs(da) > 1e-12 && Math.abs(db) > 1e-12) continue;
    const u = Math.abs(da - db) < 1e-15 ? 0 : da / (da - db);
    const q = V.lerp(a, b, Math.max(0, Math.min(1, u)));
    // nearest crossing to the path point (and to the last one, so a wavy rail is followed in order)
    const d = V.len(V.sub(q, p)) + (prev ? 0.25 * V.len(V.sub(q, prev)) : 0);
    if (d < bd) { bd = d; best = q; }
  }
  if (best) return best;
  // no crossing (the rail is shorter than the path): the nearest rail point
  for (const q of R0) { const d = V.len(V.sub(q, p)); if (d < bd) { bd = d; best = q; } }
  return best;
}
function swGuide(wire, segs, railSegs, scale) {
  const V = swV;
  const R0 = railPoints(railSegs);
  if (R0.length < 2) throw new Error("Pick a guide rail: a sketch curve or body edges");
  let n = Math.max(8, Math.min(48, segs.length * 8));
  const S = swStations(segs, n), P0 = S.st[0].p, t0 = S.st[0].t;
  const across = (v, t) => V.sub(v, V.mul(t, V.dot(v, t)));
  let q = railAt(R0, P0, t0, null);
  const v0 = across(V.sub(q, P0), t0), L0 = V.len(v0);
  if (L0 < 1e-4) throw new Error("The guide rail must not touch the path where the sweep starts");
  const wires = [];
  try {
    let prev = q;
    for (const st2 of S.st) {
      q = railAt(R0, st2.p, st2.t, prev); prev = q;
      const v = across(V.sub(q, st2.p), st2.t), L = V.len(v);
      const vt = swApply(st2.A, v0); // where the start direction is carried with no turning
      const ang = L > 1e-9 ? Math.atan2(V.dot(V.cross(vt, v), st2.t), V.dot(vt, v)) : 0;
      const k = scale && L > 1e-9 ? L / L0 : 1;
      const Rm = swMat3(swRot(st2.t, ang), st2.A);
      const RP = swApply(Rm, P0), tr = V.sub(st2.p, V.mul(RP, k));
      const m = [Rm[0][0] * k, Rm[1][0] * k, Rm[2][0] * k, 0, Rm[0][1] * k, Rm[1][1] * k, Rm[2][1] * k, 0, Rm[0][2] * k, Rm[1][2] * k, Rm[2][2] * k, 0, tr[0], tr[1], tr[2], 1];
      wires.push(transformShape(wire.clone(), m));
    }
    const spine = sweepPath(segs);
    try { return swPipe(spine, wires); }
    catch (e) { throw new Error("Couldn't sweep along this path with this guide rail. Keep the rail beside the path, about the same length, without sharp turns."); }
    finally { spine.delete(); }
  } finally { wires.forEach((w) => w.delete && w.delete()); }
}

// ---------------------------------------------------------------- sweep: any path
// a path run the other way
function swReverse(segs) {
  return segs.slice().reverse().map((x) => x.t === "bsp" ? { ...x, a: x.b, b: x.a, pts: x.pts.slice().reverse() } : x.t === "circle" ? x : { ...x, a: x.b, b: x.a, spans: x.spans && x.spans.slice().reverse().map((b) => [b[3], b[2], b[1], b[0]]) });
}
// a closed profile loop (sketch coordinates) as points
function swLoopPts(loop) {
  const out = [];
  for (const s of loop) {
    if (s.t === "circle") { for (let i = 0; i < 48; i++) { const a = (i / 48) * 2 * Math.PI; out.push([s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)]); } continue; }
    if (s.spans) { for (const b of s.spans) for (let k = 0; k < 8; k++) { const t = k / 8, u = 1 - t; out.push([0, 1].map((i) => u * u * u * b[0][i] + 3 * u * u * t * b[1][i] + 3 * u * t * t * b[2][i] + t * t * t * b[3][i])); } continue; }
    if (s.t === "arc" && s.m) {
      const [ax, ay] = s.a, [mx, my] = s.m, [bx, by] = s.b, d = 2 * (ax * (my - by) + mx * (by - ay) + bx * (ay - my));
      if (Math.abs(d) > 1e-12) {
        const ux = ((ax * ax + ay * ay) * (my - by) + (mx * mx + my * my) * (by - ay) + (bx * bx + by * by) * (ay - my)) / d, uy = ((ax * ax + ay * ay) * (bx - mx) + (mx * mx + my * my) * (ax - bx) + (bx * bx + by * by) * (mx - ax)) / d;
        const r = Math.hypot(ax - ux, ay - uy), a0 = Math.atan2(ay - uy, ax - ux), am = Math.atan2(my - uy, mx - ux), a1 = Math.atan2(by - uy, bx - ux);
        const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        let sweep = norm(a1 - a0);
        if (norm(am - a0) > sweep) sweep -= 2 * Math.PI;
        for (let k = 0; k < 12; k++) { const a = a0 + (sweep * k) / 12; out.push([ux + r * Math.cos(a), uy + r * Math.sin(a)]); }
        continue;
      }
    }
    out.push(s.a);
  }
  return out;
}
// ear clipping for a cap (simple polygon, counter-clockwise)
function swEars(P) {
  const n = P.length, idx = [...Array(n).keys()], tris = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      if (cross(P[i0], P[i1], P[i2]) <= 1e-12) continue;
      if (idx.some((k) => k !== i0 && k !== i1 && k !== i2 && inTri(P[k], P[i0], P[i1], P[i2]))) continue;
      tris.push([i0, i1, i2]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push(idx.slice());
  return tris;
}
// when the engine can't sweep a path (tight or wobbly bends, odd corners), build the sweep from
// copies of the profile carried along the path (no twisting), joined by triangles
function swMeshSolid(loop, toWorld, segs) {
  let P2 = swLoopPts(loop);
  let A2 = 0; for (let i = 0; i < P2.length; i++) { const a = P2[i], b = P2[(i + 1) % P2.length]; A2 += a[0] * b[1] - b[0] * a[1]; }
  if (A2 < 0) P2 = P2.reverse();
  const prof = P2.map(toWorld), m = prof.length;
  const S0 = swStations(segs, 8), total = S0.total;
  const n = Math.max(16, Math.min(600, Math.ceil(total / Math.max(0.3, Math.sqrt(Math.abs(A2)) / 4))));
  const S = swStations(segs, n), st0 = S.st[0].p;
  const first = S.st[0].p, last = S.st[S.st.length - 1].p;
  const closed = Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]) < 1e-3;
  const rings = closed ? S.st.slice(0, -1) : S.st;
  const V = [], I = [];
  for (const s of rings) for (const q of prof) { const r = swApply(s.A, swV.sub(q, st0)); V.push(s.p[0] + r[0], s.p[1] + r[1], s.p[2] + r[2]); }
  const R = rings.length, segN = closed ? R : R - 1;
  for (let i = 0; i < segN; i++) {
    const a = i * m, b = ((i + 1) % R) * m;
    for (let j = 0; j < m; j++) { const j1 = (j + 1) % m; I.push(a + j, a + j1, b + j, a + j1, b + j1, b + j); }
  }
  if (!closed) {
    const tris = swEars(P2), L = (R - 1) * m;
    for (const [x, y, z] of tris) { I.push(x, z, y); I.push(L + x, L + y, L + z); }
  }
  // outward facing: flip if the volume comes out negative
  let vol = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; vol += V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1]) - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c]) + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c]); }
  if (vol < 0) for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
  return solidFromMesh(new Float32Array(V), new Uint32Array(I));
}
// "Snap the profile to the path": the profile moved so its middle sits on the path's start, square
// to the path there (column-major matrix for transformShape)
function swSnapMatrix(pl, plane, loop, segs) {
  const c2 = loopCenter(loop), pc = pl.toWorldCoords(c2).toTuple();
  const S = swStations(segs, 8), p0 = S.st[0].p, t0 = S.st[0].t, n = Vec.norm(plane.n);
  const ax = Vec.cross(n, t0), s = Math.hypot(...ax), c = Vec.dot(n, t0);
  const Rm = s < 1e-9 ? (c > 0 ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : swRot(perpTo(n), Math.PI)) : swRot(ax.map((v) => v / s), Math.atan2(s, c));
  const RP = swApply(Rm, pc), tr = [p0[0] - RP[0], p0[1] - RP[1], p0[2] - RP[2]];
  return { m: [Rm[0][0], Rm[1][0], Rm[2][0], 0, Rm[0][1], Rm[1][1], Rm[2][1], 0, Rm[0][2], Rm[1][2], Rm[2][2], 0, tr[0], tr[1], tr[2], 1], R: Rm, tr };
}
function buildSweep(node) {
  if (!node.regions || !node.regions.length) throw new Error("Select a closed profile to sweep");
  const pl = planeOf(node.plane);
  // run the path from the end nearest the profile, so either end can be used
  let segs = node.pathSegs || [];
  const r0 = node.regions[0];
  const seg0 = r0 && r0.outer && r0.outer[0];
  const q = seg0 ? (seg0.t === "circle" ? seg0.c : seg0.a) : [0, 0];
  const pc = pl.toWorldCoords(q).toTuple();
  if (segs.length && segs[0].t !== "circle") {
    const s0 = segs[0].a, s1 = segs[segs.length - 1].b;
    if (dist(s1, pc) < dist(s0, pc) - 1e-9) segs = segs.slice().reverse().map((x) => ({ ...x, a: x.b, b: x.a, spans: x.spans && x.spans.slice().reverse().map((b) => [b[3], b[2], b[1], b[0]]) }));
  }
  // Distance (a fraction of the path), taper and twist, like Fusion 360's sweep
  const perp = node.orient !== "parallel";
  const frac = Math.max(1e-3, Math.min(1, node.dist == null ? 1 : +node.dist || 1));
  const taper = perp ? +node.taper || 0 : 0, twist = perp ? +node.twist || 0 : 0;
  const rail = node.railSegs && node.railSegs.length ? node.railSegs : null;
  const special = !!rail || Math.abs(taper) > 1e-9 || Math.abs(twist) > 1e-9;
  if (frac < 1 - 1e-9 && segs.length) segs = swTrim(segs, frac);
  const snap = node.snap && segs.length ? swSnapMatrix(pl, node.plane, r0.outer, segs) : null;
  if (special && !snap) {
    const what = rail ? "A guide rail needs" : "Twist and taper need";
    if (segs.length === 1 && segs[0].t === "circle") throw new Error(what + " an open path. Set Distance below 1, or use a path that is not a closed loop.");
    const start = segs[0].a;
    if (Math.abs(Vec.dot(Vec.sub(start, node.plane.o), Vec.norm(node.plane.n))) > 1e-3) throw new Error((rail ? "For a guide rail" : "For twist and taper") + ", the profile must sit at the start of the path.");
  }
  const spine = sweepPath(segs);
  let out = null;
  try {
    for (const r of node.regions) {
      if (r.text) throw new Error("Text profiles can't be swept yet");
      const solidOf = (loop, hole) => {
        const sk = loopDrawing(loop).sketchOnPlane(pl);
        const wire = snap ? transformShape(sk.wire.clone(), snap.m) : sk.wire;
        try { return rail ? swGuide(wire, segs, rail, node.railScale !== false) : special ? swTwistTaper(wire, segs, taper, twist, hole) : pipe(wire, spine, node.orient); }
        catch (err) {
          // the engine couldn't: carry the profile along the path ourselves (plain sweeps only)
          if (rail || special || node.orient === "parallel") throw err;
          const toW = (q) => { const w = pl.toWorldCoords(q).toTuple(); return snap ? swV.add(swApply(snap.R, w), snap.tr) : w; };
          try { return swMeshSolid(loop, toW, segs); } catch (e2) { throw err; }
        }
        finally { if (snap && wire.delete) wire.delete(); sk.delete(); }
      };
      let s1 = solidOf(r.outer, false);
      if (Math.abs(R.measureVolume(s1)) < 1e-9) throw new Error("Couldn't sweep");
      for (const h of r.holes || []) { const hs = solidOf(h, true); const c = s1.cut(hs); s1.delete(); hs.delete(); s1 = c; }
      if (!out) out = s1; else { const u = out.fuse(s1); out.delete(); s1.delete(); out = u; }
    }
  } finally { spine.delete(); }
  return out;
}

// ---------------------------------------------------------------- loft
// sections: [{ plane, region: { outer, holes } } | { pt: [x,y,z] }] in order; points only at the ends
function loopArea(loop) {
  // signed area of a closed loop of segments (sampled), in its sketch plane
  const pts = [];
  for (const s of loop) {
    if (s.t === "circle") { for (let i = 0; i < 24; i++) { const a = (i / 24) * 2 * Math.PI; pts.push([s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)]); } continue; }
    pts.push(s.a);
    if (s.m) pts.push(s.m);
  }
  let A = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; A += p[0] * q[1] - q[0] * p[1]; }
  return A / 2;
}
function buildLoft(node) {
  let secs = (node.sections || []).filter((s) => s && (s.region || s.pt));
  const regs = secs.filter((s) => s.region);
  if (secs.length < 2 || !regs.length) throw new Error("Pick at least two profiles (or a profile and a point)");
  if (secs.some((s, i) => s.pt && i !== 0 && i !== secs.length - 1)) throw new Error("A point can only be the first or last section");
  if (regs.some((s) => s.region.text)) throw new Error("Text profiles can't be lofted");
  // one consistent winding: every loop faces the same way along the loft
  const centroid = (s) => { const b = planeOf(s.plane); const c = b.toWorldCoords(loopCenter(s.region.outer)).toTuple(); b.delete && b.delete(); return c; };
  const nrm = (s, loop) => { const a = loopArea(loop) >= 0 ? 1 : -1; return s.plane.n.map((v) => v * a); };
  const keep = [];
  const wireFor = (s, loop, ref) => {
    const sk = loopDrawing(loop).sketchOnPlane(planeOf(s.plane));
    keep.push(sk);
    let w = sk.wire.wrapped;
    const n = nrm(s, loop);
    if (ref && n[0] * ref[0] + n[1] * ref[1] + n[2] * ref[2] < 0) w = OC.TopoDS.Wire(w.Reversed());
    return w;
  };
  // each section faces along the loft: the direction from the section before it to the one after it
  const along = (i) => {
    const cents = secs.map((s) => s.pt || centroid(s));
    const n = cents.length, closed = node.closed && n >= 3;
    const a = cents[i > 0 ? i - 1 : closed ? n - 1 : 0], b = cents[i < n - 1 ? i + 1 : closed ? 0 : n - 1];
    return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  };
  const vtx = (p) => { const mk = new OC.BRepBuilderAPI_MakeVertex(new OC.gp_Pnt(p[0], p[1], p[2])); const v = mk.Vertex(); mk.delete(); return v; };
  const loftOf = (loopOf) => {
    if (node.railSegs && node.railSegs.length) {
      // centerline loft: the sections ride along a path
      const spine = sweepPath(node.railSegs);
      const b = new OC.BRepOffsetAPI_MakePipeShell(spine.wrapped);
      try {
        b.SetMode(false);
        secs.forEach((s, i) => {
          if (s.pt) b.Add(vtx(s.pt), false, false);
          else b.Add(wireFor(s, loopOf(s), along(i)), false, false);
        });
        b.Build();
        if (!b.IsDone()) throw new Error("x");
        b.MakeSolid();
        return R.cast(b.Shape());
      } catch (e) { throw new Error("Couldn't loft along this centerline. Check that the profiles sit on the path, in order."); }
      finally { b.delete(); spine.delete(); }
    }
    const b = new OC.BRepOffsetAPI_ThruSections(true, !!node.ruled, 1e-6);
    try {
      b.CheckCompatibility(true);
      
      const wires = [];
      secs.forEach((s, i) => {
        if (s.pt) b.AddVertex(vtx(s.pt));
        else { const w = wireFor(s, loopOf(s), along(i)); wires.push(w); b.AddWire(w); }
      });
      b.Build();
      if (!b.IsDone()) throw new Error("x");
      return upright(R.cast(b.Shape()));
    } catch (e) { throw new Error("Couldn't loft these profiles. Try the Straight option, or profiles with similar shapes."); }
    finally { b.delete(); }
  };
  try {
    const closedLoop = node.closed && !secs[0].pt && !secs[secs.length - 1].pt && secs.length >= 3 && !(node.railSegs && node.railSegs.length);
    // a closed loop: the open loft through every section, plus a piece from the last back to the first
    const loftAll = (loopOf) => {
      if (!closedLoop) return loftOf(loopOf);
      const a = loftOf(loopOf);
      const keepSecs = secs;
      secs = [keepSecs[keepSecs.length - 1], keepSecs[0]];
      let b;
      try { b = loftOf(loopOf); } finally { secs = keepSecs; }
      const u = a.fuse(b); a.delete(); b.delete();
      return u;
    };
    let out = loftAll((s) => s.region.outer);
    if (!(Math.abs(safeVolume(out)) > 1e-9)) throw new Error("The loft came out empty. Check the profile order.");
    // holes that line up through every section are lofted too, then cut away
    const nh = regs[0].region.holes ? regs[0].region.holes.length : 0;
    if (nh && !secs.some((s) => s.pt) && regs.every((s) => (s.region.holes || []).length === nh)) {
      for (let h = 0; h < nh; h++) {
        try {
          const hs = loftAll((s) => s.region.holes[h]);
          const c = out.cut(hs); out.delete(); hs.delete(); out = c;
        } catch (e) { /* a hole that can't be lofted is left solid */ }
      }
    }
    return out;
  } finally { for (const k of keep) k.delete(); }
}
// a solid whose skin faces inward measures negative: turn it right side out
function centerOfMass(sh) {
  const props = new OC.GProp_GProps();
  OC.BRepGProp.VolumeProperties(sh.wrapped, props, false, false, false);
  const c = props.CentreOfMass();
  const out = [c.X(), c.Y(), c.Z()];
  props.delete();
  return out;
}
function upright(sh) {
  if (safeVolume(sh) < 0) { const r = R.cast(sh.wrapped.Reversed()); sh.delete(); return r; }
  return sh;
}
function loopCenter(loop) {
  let x = 0, y = 0, n = 0;
  for (const s of loop) { const p = s.t === "circle" ? s.c : s.a; x += p[0]; y += p[1]; n++; }
  return [x / n, y / n];
}
// ---------------------------------------------------------------- mirror
// a body mirrored across a plane (world space): node.src is the source body's node, node.srcM its placement
function buildMirror(node) {
  if (!node.src) throw new Error("The body to mirror is gone");
  const shape = transformShape(evalNode(node.src), node.srcM);
  const p = node.plane;
  const trsf = new OC.gp_Trsf();
  const ax = new OC.gp_Ax2(new OC.gp_Pnt(p.o[0], p.o[1], p.o[2]), new OC.gp_Dir(p.n[0], p.n[1], p.n[2]));
  trsf.SetMirror(ax);
  const op = new OC.BRepBuilderAPI_Transform(shape.wrapped, trsf, true, false);
  const out = R.cast(op.Shape());
  op.delete(); trsf.delete(); ax.delete(); shape.delete();
  return out;
}

// ---------------------------------------------------------------- edge / face matching
function edgeSig(edge, bb) {
  const a = edge.startPoint.toTuple(), b = edge.endPoint.toTuple();
  const m = edge.pointAt(0.5).toTuple();
  const n = m.map((v, i) => (bb.size[i] > 1e-9 ? (v - bb.min[i]) / bb.size[i] : 0.5));
  return { a, b, m, n, t: edge.geomType };
}
function bboxOf(shape) {
  const bb = shape.boundingBox;
  const [min, max] = bb.bounds;
  bb.delete();
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
// radius for a chord-length fillet on each edge: chord = 2 r sin(a / 2), a being the
// angle between the two faces' normals at the middle of the edge
function chordRadii(shape, radius) {
  const out = new Map();
  const faces = shape.faces;
  const owners = new Map();
  for (const f of faces) for (const e of f.edges) { const h = e.hashCode; if (radius.has(h)) { if (!owners.has(h)) owners.set(h, { e, fs: [] }); else e.delete(); owners.get(h).fs.push(f); } else e.delete(); }
  for (const [h, { e, fs }] of owners) {
    const set = radius.get(h);
    if (set.rt !== "chord" || fs.length < 2) continue;
    try {
      const p = e.pointAt(0.5);
      const n1 = unitT(fs[0].normalAt(p).toTuple()), n2 = unitT(fs[1].normalAt(p).toTuple());
      const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
      const a = Math.acos(Math.abs(dot) > 0.99999 ? Math.sign(dot) : dot);
      const sn = Math.sin(a / 2);
      if (sn > 1e-6) out.set(h, set.r / (2 * sn));
    } catch (err) {}
  }
  for (const { e } of owners.values()) e.delete();
  faces.forEach((f) => f.delete());
  return out;
}
// a chamfer by distance and angle (or two distances) is measured from one of the two faces at the
// edge: the upper one (the one facing up most), or the other one when flipped
function chamferFaces(shape, radius) {
  const out = new Map(), owners = new Map(), faces = shape.faces;
  for (const f of faces) for (const e of f.edges) { const h = e.hashCode; if (radius.has(h)) { if (!owners.has(h)) owners.set(h, { e, fs: [] }); else e.delete(); owners.get(h).fs.push(f); } else e.delete(); }
  for (const [h, { e, fs }] of owners) {
    const set = radius.get(h);
    if (!set.ct || set.ct === "equal" || !fs.length) continue;
    let pick = fs[0];
    if (fs.length > 1) {
      try {
        const p = e.pointAt(0.5), z = fs.map((f) => unitT(f.normalAt(p).toTuple())[2]);
        let i = Math.abs(z[0] - z[1]) > 1e-6 ? (z[0] >= z[1] ? 0 : 1) : 0;
        if (set.flip) i = 1 - i;
        pick = fs[i];
      } catch (err) {}
    }
    out.set(h, pick.hashCode);
  }
  for (const { e } of owners.values()) e.delete();
  faces.forEach((f) => f.delete());
  return out;
}
function matchEdges(shape, sigs) {
  // Returns a Set of edge hashCodes matching the stored signatures. Exact
  // positional match first; otherwise the closest edge in the shape's
  // normalized bounding box, so fillets survive resizing.
  const bb = bboxOf(shape);
  const edges = shape.edges;
  const cand = edges.map((e) => ({ e, s: edgeSig(e, bb), h: e.hashCode }));
  const tol = Math.max(1e-3, Math.max(...bb.size) * 1e-5);
  const out = new Set();
  for (const sig of sigs) {
    let best = null, bd = Infinity;
    for (const c of cand) {
      const d = dist(c.s.m, sig.m);
      if (d < bd) { bd = d; best = c; }
    }
    if (best && bd < tol) { out.add(best.h); continue; }
    best = null; bd = Infinity;
    for (const c of cand) {
      if (sig.t && c.s.t !== sig.t) continue;
      const d = dist(c.s.n, sig.n);
      if (d < bd) { bd = d; best = c; }
    }
    if (best && bd < 0.04) out.add(best.h);
  }
  edges.forEach((e) => e.delete());
  return out;
}

// ---------------------------------------------------------------- fillet builder
// Notes the engine wants shown to the person (a fillet that only partly fit, and so on). They are
// collected while one body is built and returned with its mesh.
let NOTES = null;
const note = (msg) => { if (NOTES && !NOTES.includes(msg)) NOTES.push(msg); };

// Polyline of one tangent contour of a fillet, in order along the spine, so a point anywhere on
// it can be turned into the spine's relative position 0..1 that OpenCascade's radius law uses.
function contourPolyline(mf, ic) {
  const n = mf.NbEdges(ic);
  const runs = [];
  for (let j = 1; j <= n; j++) {
    const e = R.cast(mf.Edge(ic, j));
    const run = [];
    for (let i = 0; i <= 48; i++) run.push(e.pointAt(i / 48).toTuple());
    runs.push(run);
  }
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const v = mf.FirstVertex(ic);
  const fp = OC.BRep_Tool.Pnt(v);
  const first = [fp.X(), fp.Y(), fp.Z()];
  fp.delete();
  // chain the runs end to end, starting at the spine's first vertex
  const line = [];
  let cur = first;
  for (let j = 0; j < runs.length; j++) {
    let run = runs[j];
    if (d2(run[run.length - 1], cur) < d2(run[0], cur)) run = run.slice().reverse();
    if (j === 0 && runs.length > 1) {
      // a closed or awkward start: orient the first run toward the second
      const nx = runs[1];
      const end = run[run.length - 1], st = run[0];
      const near = (p) => Math.min(d2(p, nx[0]), d2(p, nx[nx.length - 1]));
      if (near(st) < near(end) && d2(st, first) > 1e-6) run = run.slice().reverse();
    }
    for (const p of line.length ? run.slice(1) : run) line.push(p);
    cur = run[run.length - 1];
  }
  const acc = [0];
  for (let i = 1; i < line.length; i++) acc.push(acc[i - 1] + Math.sqrt(d2(line[i], line[i - 1])));
  return { line, acc, len: acc[acc.length - 1] || 1, closed: mf.Closed(ic) };
}
function relAlong(poly, p, withDist) {
  const { line, acc, len } = poly;
  let best = Infinity, at = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-12;
    let t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2;
    t = Math.max(0, Math.min(1, t));
    const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    if (d < best) { best = d; at = (acc[i - 1] + (acc[i] - acc[i - 1]) * t) / len; }
  }
  return withDist ? [at, Math.sqrt(best)] : at;
}
// The (u, r) pairs of a freeform radius: the person's points, sorted along the contour, with the
// ends filled in (an open contour keeps the nearest radius to its end, a closed one wraps round
// so its start and end agree).
function radiusLaw(poly, pts, k) {
  // only the points that sit on this contour (a set can hold several separate edges)
  const tol = Math.max(0.5, poly.len * 0.02);
  let uv = pts.map((q) => { const [u, d] = relAlong(poly, q.p, true); return d <= tol ? [u, Math.max(0.05, q.r * k)] : null; }).filter(Boolean).sort((a, b) => a[0] - b[0]);
  const clean = [];
  for (const q of uv) {
    if (clean.length && q[0] - clean[clean.length - 1][0] < 1e-3) clean[clean.length - 1][1] = q[1];
    else clean.push(q);
  }
  uv = clean;
  if (!uv.length) return null;
  if (poly.closed) {
    const a = uv[0], b = uv[uv.length - 1];
    const gap = 1 - b[0] + a[0];
    const r0 = gap > 1e-6 ? b[1] + (a[1] - b[1]) * ((1 - b[0]) / gap) : a[1];
    if (a[0] > 1e-3) uv.unshift([0, r0]); else uv[0] = [0, r0];
    if (b[0] < 1 - 1e-3) uv.push([1, r0]); else uv[uv.length - 1] = [1, r0];
  } else {
    if (uv[0][0] > 1e-3) uv.unshift([0, uv[0][1]]); else uv[0][0] = 0;
    if (uv[uv.length - 1][0] < 1 - 1e-3) uv.push([1, uv[uv.length - 1][1]]); else uv[uv.length - 1][0] = 1;
  }
  return uv;
}
// Fillet with OpenCascade directly: a number is a constant radius, [r1, r2] runs from one end to
// the other, and {pts} is a freeform radius set at points along the edge's tangent contour.
function filletWith(shape, fn) {
  const mf = new OC.BRepFilletAPI_MakeFillet(shape.wrapped, OC.ChFi3d_FilletShape.ChFi3d_Rational);
  const edges = shape.edges;
  let count = 0;
  try {
    const free = [];
    for (const e of edges) {
      const v = fn(e);
      if (v == null) continue;
      if (typeof v === "number") mf.Add(v, e.wrapped);
      else if (Array.isArray(v)) mf.Add(v[0], v[1], e.wrapped);
      else {
        if (mf.Contour(e.wrapped) > 0) continue; // already part of a contour added before
        mf.Add(v.r, e.wrapped);
        free.push([e, v]);
      }
      count++;
    }
    if (!count) throw new Error("no edge was selected");
    for (const [e, v] of free) {
      const ic = mf.Contour(e.wrapped);
      if (ic < 1) continue;
      const uv = radiusLaw(contourPolyline(mf, ic), v.pts, v.k);
      if (!uv || uv.length < 2) continue;
      const arr = new OC.NCollection_Array1_gp_Pnt2d(1, uv.length);
      uv.forEach(([u, r], i) => { const p = new OC.gp_Pnt2d(u, r); arr.SetValue(i + 1, p); p.delete(); });
      for (let j = 1; j <= mf.NbEdges(ic); j++) mf.SetRadius(arr, ic, j);
      arr.delete();
    }
    const pr = new OC.Message_ProgressRange();
    mf.Build(pr);
    pr.delete();
    if (!mf.IsDone()) throw new Error("fillet failed");
    const out = R.cast(mf.Shape());
    if (!out || !out.wrapped || out.wrapped.IsNull()) throw new Error("fillet failed");
    return out;
  } finally {
    edges.forEach((e) => e.delete());
    mf.delete();
  }
}
// An edge of a partly filleted shape that is what is left of the original edge `sig`: the same
// kind of curve, lying along the original (fillets at its ends only shorten it).
function edgeAlong(shape, sig) {
  const edges = shape.edges;
  const path = [sig.a, sig.m, sig.b];
  const segD = (p, a, b) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2));
    return Math.hypot(a[0] + ab[0] * t - p[0], a[1] + ab[1] * t - p[1], a[2] + ab[2] * t - p[2]);
  };
  const off = (p) => Math.min(segD(p, path[0], path[1]), segD(p, path[1], path[2]));
  const len = Math.hypot(sig.a[0] - sig.m[0], sig.a[1] - sig.m[1], sig.a[2] - sig.m[2]) + Math.hypot(sig.b[0] - sig.m[0], sig.b[1] - sig.m[1], sig.b[2] - sig.m[2]);
  // a curved edge's chords sit inside the curve, so allow for the sag
  const tol = sig.t === "LINE" ? 1e-3 : Math.max(1e-3, len * 0.15);
  let best = null, bd = Infinity;
  for (const e of edges) {
    if (sig.t && e.geomType !== sig.t) continue;
    const pts = [e.startPoint.toTuple(), e.pointAt(0.5).toTuple(), e.endPoint.toTuple()];
    if (sig.t !== "LINE" && Math.hypot(pts[1][0] - sig.m[0], pts[1][1] - sig.m[1], pts[1][2] - sig.m[2]) > tol) continue;
    const d = Math.max(...pts.map(off));
    if (d < bd) { bd = d; best = e.hashCode; }
  }
  edges.forEach((e) => e.delete());
  return best != null && bd < tol ? best : null;
}
// A fillet or chamfer result worth keeping: a valid solid, as many solids as before, and a volume
// close to the original (rounding only shaves or fills along the edges).
function roundingSane(out, before) {
  try {
    if (!out || !out.wrapped || out.wrapped.IsNull()) return false;
    const n = (sh) => { let k = 0; const ex = new OC.TopExp_Explorer(sh.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE); for (; ex.More(); ex.Next()) k++; ex.delete(); return k; };
    if (n(out) !== n(before)) return false;
    if (!validSolid(out)) return false;
    const v0 = R.measureVolume(before), v1 = R.measureVolume(out);
    return v1 > 0 && Math.abs(v1 - v0) <= Math.abs(v0) * 0.6;
  } catch (e) { return true; }
}
// Fallback when a whole fillet fails: each edge on its own, in turn, on the result so far. Edges
// are found again after every step, since earlier fillets renumber and shorten them.
function filletOneByOne(shape, sets, valueOf) {
  const jobs = [];
  for (const set of sets) {
    for (const sig of set.edges || []) {
      const h = [...matchEdges(shape, [sig])];
      if (!h.length) continue;
      jobs.push({ sig, v: (k) => valueOf(h[0], k) });
    }
  }
  // bigger radii first: they are the ones most likely to clash, and small ones blend into them
  const size = (j) => { const v = j.v(1); return typeof v === "number" ? v : Array.isArray(v) ? Math.max(...v) : v ? v.r : 0; };
  jobs.sort((a, b) => size(b) - size(a));
  let cur = shape.clone();
  let done = 0;
  const failed = [];
  const t0 = Date.now();
  for (const j of jobs) {
    if (Date.now() - t0 > 12000) { failed.push(j); continue; }
    const h = edgeAlong(cur, j.sig);
    if (h == null) { done++; continue; } // taken in by a tangent neighbour's fillet
    const v = j.v(1);
    try {
      const out = typeof v === "object" && v && !Array.isArray(v) ? filletWith(cur, (e) => (e.hashCode === h ? v : null)) : cur.fillet((e) => (e.hashCode === h ? v : null));
      if (!roundingSane(out, cur)) { out.delete(); throw new Error("broken"); }
      cur.delete(); cur = out; done++;
    } catch (err) {
      failed.push(j);
    }
  }
  if (!done || done === failed.length) { cur.delete(); return null; }
  if (failed.length) {
    const sizes = [...new Set(failed.map((j) => +size(j).toFixed(2)))].join(", ");
    note(`Fillet: ${done} edge${done === 1 ? "" : "s"} rounded; ${failed.length} left sharp because ${sizes} mm is too large there. Lower that size or leave those edges out.`);
  }
  return cur;
}

// ---------------------------------------------------------------- freehand router
// A groove cut along strokes drawn on the body. Each stroke stores, per point, where it lies on
// the surface (p), the surface's outward normal there (n) and how deep to cut (d), all in the
// body's own coordinates. Bits: "ball" (round bottom, sweeps a circle: works on any surface and
// any change of depth), "flat" (square bottom and straight walls) and "v" (a V-groove, like a
// scalpel or a V-bit; ang is the half angle). Strokes are split where they turn sharply, each
// piece is swept, and the ends and corners get the bit's own shape (a ball, a round end mill
// plunge or a cone), so the groove is clean wherever the bit stopped or turned.
const rV = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
function routeSpine(pts) {
  if (pts.length === 2) return R.assembleWire([R.makeLine(pts[0], pts[1])]);
  try { return R.assembleWire([R.makeBSplineApproximation(pts, { tolerance: 0.005, degMin: 3, degMax: 3 })]); }
  catch (e) { return R.assembleWire([R.makeBSplineApproximation(pts, { tolerance: 0.05, degMin: 2, degMax: 3 })]); }
}
// thin out points closer than `gap` (a sweep's spline wiggles through bunched points)
function routeThin(st, gap) {
  const out = [st[0]];
  for (let i = 1; i < st.length - 1; i++) if (rV.len(rV.sub(st[i].p, out[out.length - 1].p)) >= gap) out.push(st[i]);
  const last = st[st.length - 1];
  if (rV.len(rV.sub(last.p, out[out.length - 1].p)) < gap * 0.5 && out.length > 1) out[out.length - 1] = last; else out.push(last);
  return out;
}
function routeSweep(bit, piece, r, ang, H) {
  const tan0 = rV.norm(rV.sub(piece[1].c, piece[0].c));
  const spine = routeSpine(piece.map((q) => q.c));
  let prof = null, aux = null;
  const ps = new OC.BRepOffsetAPI_MakePipeShell(spine.wrapped);
  try {
    if (bit === "ball") {
      prof = R.assembleWire([R.makeCircle(r, piece[0].c, tan0)]);
      // guided like the other bits: the plain (corrected Frenet) sweep of a circle along a
      // curve in space makes a tube the booleans misread on curved bodies
      aux = routeSpine(piece.map((q) => rV.add(q.c, rV.mul(q.n, H))));
      ps.SetMode(aux.wrapped, false, OC.BRepFill_TypeOfContact.BRepFill_NoContact);
    } else {
      const n0 = piece[0].n;
      const u = rV.norm(rV.cross(tan0, n0));
      const up = rV.norm(rV.cross(u, tan0)); // n0 made square to the path
      const b = piece[0].c;
      const top = rV.add(b, rV.mul(up, H));
      const half = bit === "v" ? Math.max(r, H * Math.tan(ang)) : r;
      const corners = bit === "v" ? [b, rV.add(top, rV.mul(u, half)), rV.add(top, rV.mul(u, -half))] : [rV.add(b, rV.mul(u, -r)), rV.add(b, rV.mul(u, r)), rV.add(top, rV.mul(u, r)), rV.add(top, rV.mul(u, -r))];
      const edges = corners.map((c, i) => R.makeLine(c, corners[(i + 1) % corners.length]));
      prof = R.assembleWire(edges);
      // the profile stays upright to the surface: guided by a copy of the path lifted along the normals
      aux = routeSpine(piece.map((q) => rV.add(q.c, rV.mul(q.n, H))));
      ps.SetMode(aux.wrapped, false, OC.BRepFill_TypeOfContact.BRepFill_NoContact);
    }
    ps.Add(prof.wrapped, false, false);
    const pr = new OC.Message_ProgressRange();
    ps.Build(pr); pr.delete();
    if (!ps.IsDone()) throw new Error("sweep failed");
    ps.MakeSolid();
    let o = R.cast(ps.Shape());
    let v = safeVolume(o);
    if (v < 0) { const rr = R.cast(o.wrapped.Reversed()); o.delete(); o = rr; v = safeVolume(o); }
    if (!(v > 1e-9)) { o.delete(); throw new Error("sweep failed"); }
    return o;
  } finally {
    ps.delete(); spine.delete();
    if (prof) prof.delete();
    if (aux) aux.delete();
  }
}
// the bit standing at one spot: what it cuts if it plunges there
// (a hair smaller than the sweep, so its surface never lies exactly on the sweep's: booleans
// misread surfaces that coincide, and 0.3% is far below what a printer can show)
function routeCap(bit, q, r0, ang, H) {
  const r = r0 * 0.997;
  if (bit === "ball") return R.makeSphere(r).translate(q.c);
  if (bit === "flat") return R.makeCylinder(r, H * 0.999, q.c, q.n);
  // a cone, apex down: a triangle turned about the normal
  const n = q.n, side = rV.norm(Math.abs(n[0]) < 0.9 ? rV.cross(n, [1, 0, 0]) : rV.cross(n, [0, 1, 0]));
  const top = rV.add(q.c, rV.mul(n, H));
  const half = Math.max(r, H * Math.tan(ang)) * 0.997;
  const w = R.assembleWire([R.makeLine(q.c, top), R.makeLine(top, rV.add(top, rV.mul(side, half))), R.makeLine(rV.add(top, rV.mul(side, half)), q.c)]);
  const f = R.makeFace(w);
  w.delete();
  const out = R.revolution(f, q.c, n, 360);
  f.delete();
  return out;
}
function routeTools(mod) {
  const bit = mod.bit === "flat" || mod.bit === "v" ? mod.bit : "ball";
  const r = Math.max(0.1, (mod.w || 3) / 2);
  const ang = (Math.max(5, Math.min(75, mod.ang ?? 30)) * Math.PI) / 180;
  const groups = []; // one list of tools per stroke
  for (const s of mod.strokes || []) {
    const P = s.p || [];
    if (!P.length) continue;
    const tools = [];
    groups.push(tools);
    const dMax = Math.max(...P.map((_, i) => (s.d && s.d[i] != null ? s.d[i] : mod.depth || 1)));
    // the bit reaches this far above the surface, so the groove opens cleanly at the top
    const H = dMax + Math.max(1, r * 2);
    let st = P.map((p, i) => {
      const n = rV.norm(s.n && s.n[i] ? s.n[i] : [0, 0, 1]);
      const d = Math.max(0.02, s.d && s.d[i] != null ? s.d[i] : mod.depth || 1);
      // ball: the centre of the ball; flat and V: the bottom of the cut
      const c = bit === "ball" ? rV.sub(p, rV.mul(n, d - r)) : rV.sub(p, rV.mul(n, d));
      return { p, n, d, c };
    });
    st = routeThin(st, Math.max(0.05, r * 0.35));
    // a loop that nearly meets itself is closed exactly (two caps almost on top of each other
    // trip up the booleans)
    if (st.length > 3 && rV.len(rV.sub(st[0].c, st[st.length - 1].c)) < Math.max(r, 0.2)) st[st.length - 1] = { ...st[0] };
    // split where the path turns sharply: one smooth sweep per piece, the bit's shape at the joins
    const pieces = [];
    let cur = [st[0]];
    for (let i = 1; i < st.length; i++) {
      cur.push(st[i]);
      if (i < st.length - 1) {
        const a = rV.norm(rV.sub(st[i].c, st[i - 1].c)), b = rV.norm(rV.sub(st[i + 1].c, st[i].c));
        if (rV.dot(a, b) < Math.cos((40 * Math.PI) / 180)) { pieces.push(cur); cur = [st[i]]; }
      }
    }
    pieces.push(cur);
    const caps = [];
    // a sweep that comes out broken (a closed loop, a twist) is tried again in two halves, and
    // if a short piece still won't sweep, the bit is stood at each of its points
    const sweepPiece = (pc, depth) => {
      const len = pc.reduce((L, q, i) => (i ? L + rV.len(rV.sub(q.c, pc[i - 1].c)) : 0), 0);
      caps.push(pc[0], pc[pc.length - 1]);
      if (pc.length < 2 || len <= 1e-3) return;
      const closed = pc.length > 3 && rV.len(rV.sub(pc[0].c, pc[pc.length - 1].c)) < 1e-6;
      if (!closed) {
        try {
          const o = routeSweep(bit, pc, r, ang, H);
          if (validSolid(o)) { tools.push(o); return; }
          o.delete();
        } catch (e) {}
      }
      if (depth < 3 && pc.length >= 4) {
        const mid = Math.floor(pc.length / 2);
        sweepPiece(pc.slice(0, mid + 1), depth + 1);
        sweepPiece(pc.slice(mid), depth + 1);
        return;
      }
      for (const q of routeThin(pc, r * 0.5)) caps.push(q);
    };
    for (const pc of pieces) sweepPiece(pc, 0);
    const seen = [];
    for (const q of caps) {
      if (seen.some((o) => rV.len(rV.sub(o.c, q.c)) < 1e-4)) continue;
      seen.push(q);
      tools.push(routeCap(bit, q, r, ang, H));
    }
  }
  return groups.filter((g) => g.length);
}
// One cut with all of a stroke's pieces as tools (the caps are a hair smaller than the sweeps, so
// no two tool surfaces coincide). If that quietly takes nothing away, the pieces go one by one.
function cutWithTools(shape, tools) {
  if (!tools.length) return shape;
  const v0 = safeVolume(shape);
  const args = new OC.NCollection_List_TopoDS_Shape(), tl = new OC.NCollection_List_TopoDS_Shape();
  args.Append(shape.wrapped);
  for (const t of tools) tl.Append(t.wrapped);
  const op = new OC.BRepAlgoAPI_Cut();
  try {
    op.SetArguments(args); op.SetTools(tl); op.SetRunParallel(false);
    const pr = new OC.Message_ProgressRange();
    op.Build(pr); pr.delete();
    if (op.IsDone() && !op.HasErrors()) {
      const out = solidsOnly(R.cast(op.Shape()));
      const v = safeVolume(out);
      if (v > 1e-9 && v < v0 - 1e-7) return out;
      out.delete();
    }
  } catch (e) {
  } finally { op.delete(); args.delete(); tl.delete(); }
  let cur = shape.clone();
  for (const t of tools) {
    try { const o = cur.clone().cut(t.clone()); const v = safeVolume(o); if (v > 1e-9 && v <= safeVolume(cur) + 1e-6) { cur.delete(); cur = o; } else o.delete(); } catch (e) {}
  }
  return cur;
}

// ---------------------------------------------------------------- modifiers
function applyMod(shape, mod) {
  switch (mod.t) {
    case "route": {
      // stroke by stroke: each stroke's pieces fused into one tool, then cut
      const groups = routeTools(mod);
      let cur = shape;
      for (const tools of groups) {
        try {
          const out = cutWithTools(cur, tools);
          if (out !== cur) { cur.delete(); cur = out; }
        } finally { tools.forEach((t) => { try { t.delete(); } catch (e) {} }); }
      }
      return cur;
    }
    case "fillet":
    case "chamfer": {
      // one or more selection sets, each with its own size; a fillet's radius can be
      // constant, variable (start to end) or set by chord length, like Fusion 360
      const isF = mod.t === "fillet";
      const sets = mod.sets && mod.sets.length ? mod.sets : [{ edges: mod.edges || [], r: isF ? mod.r : mod.d }];
      const radius = new Map(); // edge hash -> radius config
      for (const set of sets) {
        const hits = matchEdges(shape, set.edges || []);
        for (const h of hits) radius.set(h, set);
      }
      if (!radius.size) throw new Error(`${isF ? "Fillet" : "Chamfer"}: its edges no longer exist`);
      const chordOf = isF && sets.some((x) => x.rt === "chord") ? chordRadii(shape, radius) : null;
      const refFace = !isF && sets.some((x) => x.ct && x.ct !== "equal") ? chamferFaces(shape, radius) : null;
      const valueOf = (h, k) => {
        const set = radius.get(h);
        if (!set) return null;
        if (!isF) {
          const fh = refFace && refFace.get(h);
          if (fh != null && set.ct === "angle") return { distance: set.r * k, angle: Math.max(1, Math.min(89, set.ang ?? 45)), selectedFace: (f) => f.when(({ element }) => element.hashCode === fh) };
          if (fh != null && set.ct === "two") return { distances: [set.r * k, (set.r2 ?? set.r) * k], selectedFace: (f) => f.when(({ element }) => element.hashCode === fh) };
          return set.r * k;
        }
        if (set.rt === "variable") return [set.r * k, (set.r2 ?? set.r) * k];
        if (set.rt === "chord") return (chordOf.get(h) || set.r) * k;
        if (set.rt === "points" && set.pts && set.pts.length) return { pts: set.pts, k, r: set.r * k };
        return set.r * k;
      };
      const free = isF && sets.some((x) => x.rt === "points" && x.pts && x.pts.length);
      const attempt = (k) => {
        const fn = (e) => valueOf(e.hashCode, k);
        const out = free ? filletWith(shape, fn) : isF ? shape.fillet(fn) : shape.chamfer(fn);
        // OpenCascade sometimes "succeeds" with a broken solid (loose faces, gaps) when the size
        // is too big: count that as a failure, so the fallback and the size hint take over
        if (!roundingSane(out, shape)) { out.delete(); throw new Error("fillet made a broken solid"); }
        return out;
      };
      let out;
      try {
        out = attempt(1);
      } catch (e) {
        // the whole set failed together: round the edges one at a time instead, keep every edge
        // that works, and say which ones stayed sharp (a fillet that only partly fits is far more
        // useful than none). Only when not one edge works does the size message below appear.
        let part = null;
        try { part = isF && radius.size > 1 ? filletOneByOne(shape, sets, valueOf) : null; } catch (err) { part = null; }
        if (part) { shape.delete(); return part; }
        // find roughly the largest size that does fit, so the message can say what to use
        let lo = 0, hi = 1;
        const t0 = Date.now();
        for (let n = 0; n < 7 && Date.now() - t0 < 2500; n++) {
          const mid = (lo + hi) / 2;
          try { const r = attempt(mid); r.delete(); lo = mid; } catch (err) { hi = mid; }
        }
        const main = sets[0].r;
        const fit = Math.floor(main * lo * 0.98 * 10) / 10;
        const what = isF ? "Fillet radius" : "Chamfer distance";
        throw new Error(`${what} ${main} mm is too large for the selected edges.` + (fit > 0 ? ` The largest that fits is about ${fit} mm.` : " Try a much smaller size."));
      }
      shape.delete();
      return out;
    }
    case "hole": {
      const spots = mod.at && mod.at.length ? mod.at : [{ p: mod.p, n: mod.n }];
      let cur = shape;
      for (const s of spots) {
        const tool = holeTool(cur, { ...mod, p: s.p, n: s.n });
        const out = cur.cut(tool);
        tool.delete(); cur.delete();
        cur = out;
      }
      // tapped holes: a modeled thread on each hole's wall
      if (mod.tapped && mod.pitch > 0) {
        for (const s of spots) {
          const c = holeWallCenter(cur, s.p, s.n, mod.dia / 2);
          if (!c) continue;
          cur = applyMod(cur, { t: "thread", face: { c, t: "CYLINDRE" }, pitch: mod.pitch, length: mod.through ? 0 : mod.depth, clear: mod.clear || 0 });
        }
      }
      return cur;
    }
    case "bool": {
      const tool = transformShape(evalNode(mod.tool), mod.m);
      let out;
      // Clearance: the gap must take away at least what the part itself takes away; on very
      // complex free-form parts the grown part can come out wrong and remove far too little
      if (mod.op === "cut" && mod.src === "clearance") {
        out = shape.cut(tool);
        const plainTool = { ...mod.tool, children: (mod.tool.children || []).map((c) => ({ ...c, node: { ...c.node, mods: (c.node.mods || []).filter((q) => !(q.t === "offset" && q.all)) } })) };
        let vPlain = NaN;
        try { const pt = transformShape(evalNode(plainTool), mod.m); const pc = shape.cut(pt); vPlain = safeVolume(pc); pc.delete(); pt.delete(); } catch (e) {}
        if (isFinite(vPlain) && safeVolume(out) > vPlain + Math.max(1e-3, vPlain * 1e-4)) {
          out.delete(); tool.delete();
          throw new Error(`Clearance: the geometry engine couldn't make the ${mod.gap || ""} mm gap around ${mod.other || "the other part"} (that part is too complex to grow). Delete this Clearance and offset the touching faces with Offset face instead.`);
        }
      } else if (mod.op === "cut") out = shape.cut(tool);
      else if (mod.op === "intersect") out = shape.intersect(tool);
      else {
        // join: a tool made of many solids (a pattern of ribs, say) is fused in one go, and the
        // result is checked, so the tools can never just disappear
        const parts = solidsOf(tool);
        out = fuseMany([shape.clone(), ...parts.map((x) => x.clone())]);
        for (const x of parts) x.delete();
      }
      tool.delete(); shape.delete();
      return out;
    }
    case "halfspace": {
      // Split body: keep the part of the body on one side of a plane (body coordinates)
      const p = mod.plane, n = Vec.norm(p.n).map((v) => v * (mod.side < 0 ? -1 : 1));
      const B = 1e4;
      const x = perpTo(n, null);
      const sk = R.drawRectangle(2 * B, 2 * B).sketchOnPlane(new R.Plane(p.o, x, n));
      const slab = sk.extrude(B);
      const out = shape.intersect(slab);
      shape.delete(); slab.delete();
      if (!(Math.abs(safeVolume(out)) > 1e-9)) { out.delete(); throw new Error("Split body: nothing of the body is on this side of the plane"); }
      return out;
    }
    case "sketchsplit": {
      // Split body with a sketch: the curves are pushed straight through the body (along the
      // sketch's normal) and cut it apart. Pieces are sorted to a side: inside / outside a closed
      // shape, or left / right of an open line. This body keeps mod.side.
      const w = sweepPath(mod.curves);
      const L = 4e3, n = Vec.norm(mod.plane.n);
      const moved = R.cast(w.translate(-n[0] * L / 2, -n[1] * L / 2, -n[2] * L / 2).wrapped);
      const pr = new OC.BRepPrimAPI_MakePrism(moved.wrapped, new OC.gp_Vec(n[0] * L, n[1] * L, n[2] * L), false, true);
      const sheet = R.cast(pr.Shape());
      pr.delete();
      const sp = new OC.BRepAlgoAPI_Splitter();
      const args = new OC.NCollection_List_TopoDS_Shape(); args.Append(shape.wrapped);
      const tools = new OC.NCollection_List_TopoDS_Shape(); tools.Append(sheet.wrapped);
      sp.SetArguments(args); sp.SetTools(tools); sp.Build();
      const all = R.cast(sp.Shape());
      sp.delete(); sheet.delete();
      const pieces = [];
      const ex = new OC.TopExp_Explorer(all.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
      for (; ex.More(); ex.Next()) pieces.push(R.cast(OC.TopoDS.Solid(ex.Current())));
      ex.delete();
      if (pieces.length < 2) { pieces.forEach((p) => p.delete()); throw new Error("Split body: the sketch doesn't cut through the body"); }
      // which side of the sketch a piece is on, measured in the sketch plane
      const P = mod.plane, y = Vec.cross(n, Vec.norm(P.x)), x = Vec.norm(P.x);
      const to2 = (q) => { const d = Vec.sub(q, P.o); return [Vec.dot(d, x), Vec.dot(d, y)]; };
      const poly = mod.poly;
      const inside = (pt) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
      const leftOf = (pt) => {
        let bd = Infinity, side = 0;
        for (let i = 0; i < poly.length - 1; i++) {
          const a = poly[i], b = poly[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(a[0] + dx * t - pt[0], a[1] + dy * t - pt[1]);
          if (d < bd) { bd = d; side = dx * (pt[1] - a[1]) - dy * (pt[0] - a[0]); }
        }
        return side > 0;
      };
      const distTo = (pt) => { let bd = Infinity; const m = mod.closed ? poly.length : poly.length - 1; for (let i = 0; i < m; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); bd = Math.min(bd, Math.hypot(a[0] + dx * t - pt[0], a[1] + dy * t - pt[1])); } return bd; };
      const keep = [];
      for (const pc of pieces) {
        // a corner of the piece far from the sketch tells which side the whole piece is on
        let q = to2(centerOfMass(pc));
        try {
          const ms = pc.mesh({ tolerance: 2, angularTolerance: 0.6 });
          let bd = distTo(q); // the centre counts too (a solid inside a closed shape has no far corners)
          for (let i = 0; i < ms.vertices.length; i += 3) { const v = to2([ms.vertices[i], ms.vertices[i + 1], ms.vertices[i + 2]]); const d = distTo(v); if (d > bd) { bd = d; q = v; } }
        } catch (e) { /* keep the centre */ }
        const a = mod.closed ? inside(q) : leftOf(q);
        if ((mod.side === "a") === a) keep.push(pc); else pc.delete();
      }
      all.delete(); shape.delete();
      if (!keep.length) throw new Error("Split body: nothing of the body is on this side of the sketch");
      let out = keep[0];
      for (let i = 1; i < keep.length; i++) { const f = out.fuse(keep[i]); out.delete(); keep[i].delete(); out = f; }
      return out;
    }
    case "splitface": {
      // Split face: draw dividing edges onto the picked faces; the body stays one solid
      const faces = shape.faces;
      const picked = [];
      for (const q of mod.faces || []) {
        let best = null, bd = Infinity;
        for (const f of faces) {
          if (q.t && f.geomType !== q.t) continue;
          if (f.geomType === "PLANE" && q.n) { let nn; try { nn = unitT(f.normalAt().toTuple()); } catch (e) { continue; } if (nn[0] * q.n[0] + nn[1] * q.n[1] + nn[2] * q.n[2] < 0.999) continue; }
          const d = dist(f.center.toTuple(), q.c);
          if (d < bd) { bd = d; best = f; }
        }
        if (best && !picked.includes(best)) picked.push(best);
      }
      if (!picked.length) { faces.forEach((f) => f.delete()); throw new Error("Split face: the picked face no longer exists"); }
      // the splitting tool: a plane, or sketch curves pushed along their sketch's normal into a sheet
      let sheet = null;
      if (mod.curves && mod.curves.length) {
        const w = sweepPath(mod.curves);
        const L = 2e3, n = Vec.norm(mod.dir || [0, 0, 1]);
        const moved = R.cast(w.translate(-n[0] * L, -n[1] * L, -n[2] * L).wrapped);
        const pr = new OC.BRepPrimAPI_MakePrism(moved.wrapped, new OC.gp_Vec(n[0] * 2 * L, n[1] * 2 * L, n[2] * 2 * L), false, true);
        sheet = R.cast(pr.Shape());
        pr.delete();
      }
      const edges = new OC.NCollection_List_TopoDS_Shape();
      let count = 0;
      for (const f of picked) {
        const sec = mod.plane
          ? new OC.BRepAlgoAPI_Section(f.wrapped, new OC.gp_Pln(new OC.gp_Pnt(mod.plane.o[0], mod.plane.o[1], mod.plane.o[2]), new OC.gp_Dir(mod.plane.n[0], mod.plane.n[1], mod.plane.n[2])), true)
          : new OC.BRepAlgoAPI_Section(f.wrapped, sheet.wrapped, true);
        const res = R.cast(sec.Shape());
        const ne = res.edges.length;
        if (ne) { edges.Append(res.wrapped); count += ne; }
        sec.delete();
      }
      faces.forEach((f) => f.delete());
      if (sheet) sheet.delete();
      if (!count) throw new Error("Split face: the splitting tool doesn't cross the picked faces");
      const sp = new OC.BRepAlgoAPI_Splitter();
      const args = new OC.NCollection_List_TopoDS_Shape();
      args.Append(shape.wrapped);
      sp.SetArguments(args); sp.SetTools(edges);
      sp.Build();
      let out = R.cast(sp.Shape());
      sp.delete();
      // the splitter wraps its result in a compound: take the solid back out
      if (out.wrapped.ShapeType() === OC.TopAbs_ShapeEnum.TopAbs_COMPOUND) {
        const ex = new OC.TopExp_Explorer(out.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
        if (ex.More()) { const so = R.cast(OC.TopoDS.Solid(ex.Current())); ex.delete(); out = so; } else ex.delete();
      }
      shape.delete();
      return out;
    }
    case "offset": {
      // Offset face (Fusion's Press Pull): push a face out (+) or in (-). Works on flat
      // and curved faces: the face is thickened into a slab that is added or removed.
      const dist0 = mod.d || 0;
      if (Math.abs(dist0) < 1e-6) return shape;
      // every face (picked with a selection window): the whole body grows or shrinks, with
      // round outside corners when it grows, like a solid offset in other CAD apps. Slabs face by
      // face would leave notches at every edge and corner.
      if (mod.all) {
        const vIn = safeVolume(shape);
        const out = offsetSolid(shape, dist0, vIn, dist0 > 0);
        if (!out) throw new Error(dist0 > 0 ? "Offset face couldn't grow the whole body by this distance. Try a smaller distance." : "Offset face couldn't shrink the whole body by this distance: it may be thinner than twice the distance somewhere.");
        // the engine can return a wrong shape for very complex free-form bodies: the volume must
        // change by about the surface area × the distance (corners and narrow parts change it
        // somewhat, so a wide margin)
        let area = NaN;
        try { area = R.measureArea(shape); } catch (e) {}
        const change = safeVolume(out) - vIn, expect = area * dist0;
        if (isFinite(expect) && Math.abs(expect) > 1e-6 && !(change / expect > 0.5 && change / expect < 1.6)) {
          out.delete();
          throw new Error("The geometry engine couldn't offset this whole body correctly (it is too complex). Offset some of its faces instead, or use a smaller distance.");
        }
        return out;
      }
      let cur = shape;
      for (const q of mod.faces || []) {
        const faces = cur.faces;
        let best = null, bd = Infinity;
        for (const f of faces) {
          const t = f.geomType;
          if (q.t && t !== q.t) continue;
          if (t === "PLANE" && q.n) {
            let n;
            try { n = unitT(f.normalAt().toTuple()); } catch (e) { continue; }
            if (n[0] * q.n[0] + n[1] * q.n[1] + n[2] * q.n[2] < 0.999) continue;
          }
          const d = dist(f.center.toTuple(), q.c);
          if (d < bd) { bd = d; best = f; }
        }
        if (!best) { faces.forEach((f) => f.delete()); throw new Error("Offset face: the picked face no longer exists"); }
        // a cylinder or sphere split into several faces is offset as one surface, like Fusion
        const sig = surfaceSig(best);
        const group = sig ? faces.filter((f) => f === best || sameSurface(surfaceSig(f), sig)) : [best];
        let slab = null;
        for (const f of group) {
          const piece = thickenFace(f, dist0, q);
          if (!slab) slab = piece;
          else { const u = slab.fuse(piece); slab.delete(); piece.delete(); slab = u; }
        }
        faces.forEach((f) => f.delete());
        let out;
        try { out = dist0 > 0 ? cur.fuse(slab) : cur.cut(slab); }
        catch (e) { slab.delete(); throw new Error("Offset face couldn't be built with this distance"); }
        slab.delete();
        cur.delete();
        cur = out;
      }
      return cur;
    }
    case "shell": {
      const t = Math.abs(mod.th || 1);
      const dir = mod.dir === "out" || mod.dir === "both" ? mod.dir : "in";
      // faces to remove are stored by their center; pick the nearest face for each
      const bb = bboxOf(shape);
      const faces = shape.faces;
      const cands = faces.map((f) => ({ h: f.hashCode, c: f.center.toTuple() }));
      faces.forEach((f) => f.delete());
      const open = new Set();
      for (const q of mod.faces || []) {
        let best = null, bd = Infinity;
        for (const c of cands) { const d = dist(c.c, q.c); if (d < bd) { bd = d; best = c; } }
        if (best && bd < Math.max(0.5, Math.hypot(...bb.size) * 0.05)) open.add(best.h);
      }
      if ((mod.faces || []).length && !open.size) throw new Error("Shell: the faces to remove weren't found. Edit the shell and pick them again.");
      if (mod.chain) tangentChain(shape, open);
      // removing every face leaves nothing to keep: make a closed, hollow body instead
      if (open.size >= cands.length) open.clear();
      const vIn = safeVolume(shape);
      let out = shellSolid(shape, t, open, dir, vIn, mod.method || "auto", mod.detail || 1);
      if (!out) throw new Error(`Shell: couldn't make a ${t} mm wall here. Try a thinner wall${dir === "in" ? ", or Outside" : ""}${mod.method && mod.method !== "auto" && mod.method !== "field" ? ", or the Any shape method" : ""}.`);
      // drain holes through the bottom of a closed hollow
      if (mod.drain && !open.size) {
        const d = drainHoles(out, shape, t, dir, mod.drain);
        if (d) { out.delete(); out = d; }
      }
      shape.delete();
      return out;
    }
    case "emboss": {
      const tool = embossTool(mod);
      let out;
      try {
        if (mod.mode === "deboss") out = cutAll(shape, [tool]);
        else out = shape.fuse(tool);
      } finally { tool.delete(); }
      if (!out) throw new Error("The text couldn't be cut into this face");
      shape.delete();
      return out;
    }
    case "facepat": {
      // a lattice on a solid body can be a lattice shell: the body is hollowed to a skin first
      // (unless it is already thin there, like a tube or a shelled part), so the cells go
      // through the skin only and the lattice follows the curved surface
      if (mod.lattice && mod.skin > 0) {
        const hollow = latticeSkin(shape, mod);
        if (hollow) { shape.delete(); shape = hollow; }
      }
      // a sphere (a ball, a dome, a hollow sphere): a geodesic lattice
      const sph = mod.lattice ? sphereLattice(shape, mod) : null;
      if (sph) {
        const out = cutAll(shape, [sph]);
        sph.delete();
        if (!out || !(safeVolume(out) > 1e-9) || safeVolume(out) > safeVolume(shape) - 1e-6) { if (out) out.delete(); throw new Error("Lattice: couldn't cut the cells into this sphere. Try a bigger cell size or a thicker skin."); }
        shape.delete();
        return out;
      }
      const tool = facePatTool(shape, mod);
      const v0 = safeVolume(shape);
      let out;
      try { out = mod.mode === "cut" ? cutAll(shape, [tool]) : fuseAllTools(shape, [tool]); } finally { tool.delete(); }
      if (!out || !(safeVolume(out) > 1e-9)) { if (out) out.delete(); throw new Error("Pattern: couldn't " + (mod.mode === "cut" ? "cut it into" : "raise it on") + " this face"); }
      void v0;
      shape.delete();
      return out;
    }
    case "thread": {
      const { groove, clipped, crest } = threadGroove(shape, mod);
      // the print offset's crest relief first (a plain ring), then the helical groove
      if (crest) {
        const relieved = cutAll(shape, [crest]);
        crest.delete();
        if (relieved && safeVolume(relieved) > 1e-9) { shape.delete(); shape = relieved; }
        else if (relieved) relieved.delete();
      }
      const v0 = safeVolume(shape);
      // a cut must remove material; anything else is a broken boolean
      const good = (r) => { if (!r) return false; const v = safeVolume(r); return v > 1e-9 && v < v0 - 1e-6; };
      let out = cutAll(shape, [groove]);
      if (!good(out)) {
        if (out) out.delete();
        const g2 = clipped();
        out = cutAll(shape, [g2]);
        g2.delete();
      }
      groove.delete();
      if (!good(out)) { if (out) out.delete(); throw new Error("Thread couldn't be cut here. Try a larger pitch or a shorter length."); }
      shape.delete();
      return out;
    }
    case "scale": return scaleShape(shape, mod.k, mod.o);
    default:
      throw new Error("Unknown feature " + mod.t);
  }
}

// Try OpenCascade's thick-solid with a few join styles and tolerances; keep the
// first result that really hollowed the body.
// ---------------------------------------------------------------- shell
// Shell a solid: walls of thickness t, inside (in), outside (out) or centered (both) on the
// surface, with the chosen faces left open (none: a closed, hollow body). OpenCascade's
// thick-solid first; when that can't cope (complex blends, booleans, many surface types),
// offset copies of the whole body are subtracted and the openings cut through.
function shellSolid(shape, t, open, dir, vIn, method = "auto", detail = 1) {
  const T0 = Date.now();
  // a method picked by the user
  if (method === "exact") return shellSolidOffset(shape, t, open, dir, vIn);
  if (method === "slices") return sliceShell(shape, t, open, dir);
  if (method === "field") return sdfShell(shape, t, open, dir, detail);
  // free-form sides (lofts, sweeps): the offset engine rarely manages them and takes long to give
  // up, so the slice method goes first there
  let freeform = false;
  for (const f of shape.faces) { const g = f.geomType; if (g === "BSPLINE_SURFACE" || g === "BEZIER_SURFACE" || g === "OFFSET_SURFACE" || g === "OTHER_SURFACE") freeform = true; f.delete(); }
  if (freeform) {
    const s0 = sliceShell(shape, t, open, dir);
    if (typeof process !== "undefined" && process.env && process.env.SHELL_T) console.log("slice shell first", s0 ? "ok" : "failed", Date.now() - T0, "ms");
    if (s0) return s0;
  }
  const r = shellSolidOffset(shape, t, open, dir, vIn);
  if (typeof process !== "undefined" && process.env && process.env.SHELL_T) console.log("offset shell", r ? "ok" : "failed", Date.now() - T0, "ms");
  if (r) return r;
  if (!freeform) {
    const T1 = Date.now();
    const s = sliceShell(shape, t, open, dir);
    if (typeof process !== "undefined" && process.env && process.env.SHELL_T) console.log("slice shell", s ? "ok" : "failed", Date.now() - T1, "ms");
    if (s) return s;
  }
  // anything else: the distance-field wall
  return sdfShell(shape, t, open, dir);
}
function shellSolidOffset(shape, t, open, dir, vIn) {
  const ok = (sh, more) => { const v = safeVolume(sh); return v > 1e-6 && (more ? v > vIn * 1.002 : v < vIn * 0.998); };
  // a wall can't hold much more than (area of the kept surface) x thickness; OpenCascade
  // sometimes "succeeds" by hollowing only part of a body, which this catches
  let keptArea = 0;
  for (const f of shape.faces) { if (!open.has(f.hashCode)) try { keptArea += R.measureArea(f); } catch (e) {} f.delete(); }
  const sane = (sh) => {
    if (!sh) return null;
    const v = safeVolume(sh);
    if (dir === "in" && keptArea > 0 && !(v < keptArea * t * 1.25 && v > keptArea * t * 0.25)) { sh.delete(); return null; }
    return sh;
  };
  if (open.size && dir !== "both") {
    const r = sane(thickSolid(shape, dir === "out" ? t : -t, open, vIn, dir === "out"));
    if (r) return r;
    // split coplanar faces (left by booleans) confuse it: merge them and retry
    const u = unified(shape);
    if (u) {
      const open2 = remapFaces(shape, u, open);
      const r2 = open2.size ? sane(thickSolid(u, dir === "out" ? t : -t, open2, vIn, dir === "out")) : null;
      if (r2) { u.delete(); return r2; }
      u.delete();
    }
  }
  // offset-and-subtract
  let outer = null, inner = null, walls = null;
  try {
    if (dir === "in") { inner = offsetSolid(shape, -t, vIn, false); if (!inner) return null; walls = shape.cut(inner); }
    else if (dir === "out") { outer = offsetSolid(shape, t, vIn, true); if (!outer) return null; walls = outer.cut(shape); }
    else {
      outer = offsetSolid(shape, t / 2, vIn, true); inner = offsetSolid(shape, -t / 2, vIn, false);
      if (!outer || !inner) return null;
      walls = outer.cut(inner);
    }
    if (!walls || !(safeVolume(walls) > 1e-6)) return null;
    if (!open.size) { const w = walls; walls = null; return w; }
    // the hollow inside, which each opening reaches
    const cavity = dir === "out" ? shape : inner;
    const tools = [];
    for (const f of shape.faces) {
      if (!open.has(f.hashCode)) { f.delete(); continue; }
      try { tools.push(openingTool(f, t, dir, cavity)); } catch (e) {}
      f.delete();
    }
    const cut = tools.length ? cutAll(walls, tools) : null;
    tools.forEach((x) => x && x.delete && x.delete());
    if (cut && ok(cut)) { walls.delete(); walls = null; return cut; }
    if (cut) cut.delete();
    return null;
  } catch (e) {
    return null;
  } finally {
    if (walls) walls.delete();
    if (inner) inner.delete();
    if (outer) outer.delete();
  }
}
// 2D offset of a closed outline (CCW points [u, v]): d > 0 grows it, d < 0 shrinks it. Each
// point moves along its normal; points that end up nearer than |d| to the outline (the folds
// at corners) are dropped, and arcs fill the gaps round corners on the growing side.
function polyOffset(P, d) {
  const n = P.length, ad = Math.abs(d), out = [];
  const nrm = (i) => { const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
  for (let i = 0; i < n; i++) {
    const n0 = nrm((i - 1 + n) % n), n1 = nrm(i), p = P[i];
    // turning at p: positive is a left (convex) turn for a CCW outline
    const cr = n0[0] * n1[1] - n0[1] * n1[0];
    if ((cr > 1e-9 && d > 0) || (cr < -1e-9 && d < 0)) {
      const a0 = Math.atan2(n0[1], n0[0]);
      let sw = Math.atan2(n1[1], n1[0]) - a0;
      while (sw > Math.PI) sw -= 2 * Math.PI; while (sw < -Math.PI) sw += 2 * Math.PI;
      const k = Math.max(1, Math.ceil(Math.abs(sw) / 0.2));
      for (let j = 0; j <= k; j++) { const t = a0 + (sw * j) / k; out.push([p[0] + Math.cos(t) * d, p[1] + Math.sin(t) * d]); }
    } else {
      const m = [n0[0] + n1[0], n0[1] + n1[1]], ml = Math.hypot(m[0], m[1]) || 1;
      out.push([p[0] + (m[0] / ml) * d, p[1] + (m[1] / ml) * d]);
    }
  }
  const dist = (q) => { let best = Infinity; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)); best = Math.min(best, Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1])); } return best; };
  return out.filter((q) => dist(q) >= ad * 0.97 - 1e-6);
}
// a closed outline sampled at k even angles round a center (so corners stay at the same angle
// from slice to slice and the loft through them doesn't twist); null when a ray from the center
// crosses the outline more than once
function angleLoop(P, k, c) {
  const n = P.length, out = [];
  for (let i = 0; i < k; i++) {
    const a = (2 * Math.PI * i) / k, dx = Math.cos(a), dy = Math.sin(a);
    let hits = 0, best = 0;
    for (let j = 0; j < n; j++) {
      const p = P[j], q = P[(j + 1) % n], ex = q[0] - p[0], ey = q[1] - p[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = p[0] - c[0], wy = p[1] - c[1];
      const t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
      if (t > 0 && u >= 0 && u < 1) { hits++; best = t; }
    }
    if (hits !== 1) return null;
    out.push([c[0] + dx * best, c[1] + dy * best]);
  }
  return out;
}
// a closed outline resampled to k points evenly along it, starting where it crosses +u
function resampleLoop(P, k) {
  const n = P.length, cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(P[i % n][0] - P[i - 1][0], P[i % n][1] - P[i - 1][1]));
  const L = cum[n];
  let c = [0, 0]; for (const p of P) { c[0] += p[0] / n; c[1] += p[1] / n; }
  let s0 = 0, best = -Infinity;
  for (let i = 0; i < n; i++) { const p = P[i], sc = (p[0] - c[0]) - Math.abs(p[1] - c[1]) * 4; if (sc > best) { best = sc; s0 = cum[i]; } }
  const out = [];
  let j = 0;
  for (let i = 0; i < k; i++) {
    let s = s0 + (L * i) / k; if (s >= L) s -= L;
    while (j > 0 && cum[j] > s) j--;
    while (cum[j + 1] < s) j++;
    const f = (s - cum[j]) / Math.max(1e-12, cum[j + 1] - cum[j]), a = P[j % n], b = P[(j + 1) % n];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    if (i + 1 < k && s0 + (L * (i + 1)) / k >= L && s < L) j = 0;
  }
  return out;
}
// Last resort for shells the offset engine can't make (lofts that run from corners into curves,
// like a hexagon into a circle, are the usual case): the body is cut into slices across an axis
// (the open face's normal, or Z), each slice's outline is offset in its own plane, and the
// outlines are lofted back into the inside (or outside) of the wall. The wall is measured across
// each slice, so it matches the thickness on sides that run along the axis.
// Any shape at all (the last resort, or chosen as the method): the wall from a distance field
// (see sdfshell.js). Inside: the shape minus the hollow, so the outside stays exact. Outside: the
// grown shape minus the shape, so the original surface stays exact inside. Both: the wall itself.
function meshPartsSolid(parts) {
  // closed pieces facing outward are solids; ones facing inward are hollows inside them
  const info = parts.map((p) => {
    let v = 0;
    const P = p.V, T = p.I, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < T.length; i += 3) { const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3; v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); }
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
    return { p, v: v / 6, lo, hi };
  });
  const outers = info.filter((x) => x.v > 0).sort((a, b) => a.v - b.v), holes = info.filter((x) => x.v < 0);
  if (!outers.length) return null;
  const inside = (h, o) => h.lo.every((v, k) => v >= o.lo[k] - 1e-6) && h.hi.every((v, k) => v <= o.hi[k] + 1e-6);
  const B = new OC.TopoDS_Builder();
  const solids = outers.map((o) => {
    const so = new OC.TopoDS_Solid();
    B.MakeSolid(so);
    B.Add(so, solidFromMesh(o.p.V, o.p.I, 1, false, true));
    o.so = so;
    return so;
  });
  // each hollow goes in the smallest solid round it
  for (const h of holes) { const o = outers.find((x) => inside(h, x)); if (o) B.Add(o.so, solidFromMesh(h.p.V, h.p.I, 1, false, true)); }
  if (solids.length === 1) return R.cast(solids[0]);
  const comp = new OC.TopoDS_Compound();
  B.MakeCompound(comp);
  for (const so of solids) B.Add(comp, so);
  return R.cast(comp);
}
function sdfShell(shape, t, open, dir, detail = 1) {
  const DBG = typeof process !== "undefined" && process.env && process.env.SHELL_T;
  const T0 = Date.now();
  const gc = [];
  try {
    const faces = shape.faces, openIdx = new Set();
    faces.forEach((f, i) => { if (open.has(f.hashCode)) openIdx.add(i); f.delete(); });
    const bb = bboxOf(shape), diag = Math.hypot(...bb.size) || 1;
    const tol = Math.max(0.005, Math.min(t / 8, diag * 0.0006)), ang = 0.12;
    const m = shape.mesh({ tolerance: tol, angularTolerance: ang });
    try { repairFaceMeshes(shape, m, tol, ang); } catch (e) {}
    const nt = m.triangles.length / 3, faceOf = new Int32Array(nt);
    m.faceGroups.forEach((g, fi) => { for (let k = g.start / 3; k < (g.start + g.count) / 3; k++) faceOf[k] = fi; });
    const mesh = { V: Float32Array.from(m.vertices), I: Uint32Array.from(m.triangles), faceOf };
    const part = (kind) => {
      const r = shellField(mesh, openIdx, t, kind, { detail, limit: Math.round(9000 * detail) });
      if (DBG) console.log("sdf", kind, "cell", r.h.toFixed(3), "pieces", r.parts.length, "tris", r.parts.reduce((a, p) => a + p.I.length / 3, 0), Date.now() - T0, "ms");
      const sol = meshPartsSolid(r.parts);
      if (sol) gc.push(sol);
      return sol;
    };
    // flat and round (cylinder, cone) faces: cut the hollow out with the geometry engine, so the
    // shape's own surface stays exact; anything else: the wall straight from the field (quick)
    let simple = true, nf = 0;
    for (const f of shape.faces) { nf++; const g = f.geomType; if (g !== "PLANE" && g !== "CYLINDRE" && g !== "CONE") simple = false; f.delete(); }
    if (nf > 150) simple = false;
    let walls;
    if (simple && dir === "in") { const c = part("cavity"); if (!c) return null; walls = shape.cut(c); }
    else if (simple && dir === "out") { const o = part("outer"); if (!o) return null; walls = o.cut(shape); }
    else { walls = part(dir === "in" ? "win" : dir === "out" ? "wout" : "wboth"); if (!walls) return null; gc.splice(gc.indexOf(walls), 1); }
    const v = safeVolume(walls);
    let kept = 0;
    for (const f of shape.faces) { if (!open.has(f.hashCode)) try { kept += R.measureArea(f); } catch (e) {} f.delete(); }
    if (DBG) console.log("sdf walls", v.toFixed(0), "expected about", (kept * t).toFixed(0), Date.now() - T0, "ms");
    if (!(v > 1e-6) || (kept > 0 && !(v > kept * t * 0.4 && v < kept * t * 2))) { walls.delete(); return null; }
    return walls;
  } catch (e) {
    if (DBG) console.log("sdf err", e && (e.message || e));
    return null;
  } finally {
    for (const g of gc) try { g.delete(); } catch (e) {}
  }
}
// holes up through the bottom wall of a hollow (to let resin or powder out): under the middle of
// the lowest downward face, or under the middle of the shape
function drainHoles(walls, shape, t, dir, dr) {
  const bb = bboxOf(shape);
  let best = null;
  for (const f of shape.faces) {
    try {
      if (f.geomType === "PLANE") {
        const n = unitT(f.normalAt().toTuple());
        if (n[2] < -0.9) {
          const c = f.center.toTuple(), fb = f.boundingBox, [lo, hi] = fb.bounds;
          if (!best || c[2] < best.c[2] - 1e-6) best = { c, w: [hi[0] - lo[0], hi[1] - lo[1]] };
          fb.delete && fb.delete();
        }
      }
    } catch (e) {}
    f.delete();
  }
  if (!best) best = { c: [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, bb.min[2]], w: [bb.size[0] * 0.5, bb.size[1] * 0.5] };
  const r = Math.max(0.25, (dr.d || 3) / 2), n = dr.n || 1;
  const below = dir === "out" ? t : dir === "both" ? t / 2 : 0, above = dir === "in" ? t : dir === "both" ? t / 2 : 0;
  const z0 = best.c[2] - below - 1, h = below + above + 2;
  const dx = Math.min(best.w[0] / 4, 30), dy = Math.min(best.w[1] / 4, 30);
  const spots = n >= 4 ? [[-dx, -dy], [dx, -dy], [dx, dy], [-dx, dy]] : n === 2 ? [[-dx, 0], [dx, 0]] : [[0, 0]];
  const v0 = safeVolume(walls);
  let cur = walls.clone();
  for (const [ox, oy] of spots) {
    try {
      const cyl = R.makeCylinder(r, h, [best.c[0] + ox, best.c[1] + oy, z0], [0, 0, 1]);
      const c2 = cur.cut(cyl); cyl.delete(); cur.delete(); cur = c2;
    } catch (e) {}
  }
  if (!(safeVolume(cur) < v0 - 1e-9) || !(safeVolume(cur) > v0 * 0.5)) { cur.delete(); return null; }
  return cur;
}
function fuzzyCut(a, b, fz) {
  const args = new OC.TopTools_ListOfShape(), tools = new OC.TopTools_ListOfShape();
  args.Append(a); tools.Append(b);
  const op = new OC.BRepAlgoAPI_Cut();
  op.SetArguments(args); op.SetTools(tools); op.SetFuzzyValue(fz); op.SetRunParallel(false);
  op.Build(new OC.Message_ProgressRange());
  const r = op.Shape();
  args.delete(); tools.delete();
  return r;
}
function sliceShell(shape, t, open, dir) {
  const gc = [], TS = Date.now();
  const keep = (s) => { if (s) gc.push(s); return s; };
  try {
    // the axis, and which ends are open
    let axis = null;
    const ends = [];
    for (const f of shape.faces) {
      if (open.has(f.hashCode)) {
        if (f.geomType !== "PLANE") { f.delete(); return null; }
        const n = unitT(f.normalAt().toTuple()), c = f.center.toTuple();
        ends.push({ n, c });
      }
      f.delete();
    }
    if (ends.length) {
      axis = ends[0].n;
      for (const e of ends) if (Math.abs(e.n[0] * axis[0] + e.n[1] * axis[1] + e.n[2] * axis[2]) < 0.999) return null;
    } else axis = [0, 0, 1];
    const L = Math.hypot(...axis); axis = axis.map((v) => v / L);
    const dot = (p) => p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2];
    const bb = bboxOf(shape), [a, b] = [bb.min, bb.max];
    let smin = Infinity, smax = -Infinity;
    for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) { const s = dot([x, y, z]); smin = Math.min(smin, s); smax = Math.max(smax, s); }
    // the real ends: the open faces sit exactly on them
    for (const e of ends) { const s = dot(e.c); if (dot(e.n) > 0) smax = Math.min(smax, s); else smin = Math.max(smin, s); }
    const openHi = ends.some((e) => dot(e.n) > 0), openLo = ends.some((e) => dot(e.n) < 0);
    const span = smax - smin;
    if (!(span > 3 * t)) return null;
    const diag = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 2 + 10;
    const xd = Math.abs(axis[2]) < 0.9 ? [axis[1], -axis[0], 0] : [1, 0, 0];
    const xl = Math.hypot(...xd), xDir = xd.map((v) => v / xl);
    const c0 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], s0 = dot(c0);
    const at = (s) => c0.map((v, i) => v + axis[i] * (s - s0));
    const planeFace = (s) => keep(R.drawRectangle(diag, diag).sketchOnPlane(new R.Plane(at(s), xDir, axis)).face());
    // the outline of the slice at s (a slice in two pieces, or with a hole in it, can't be done
    // this way), as points in its plane, counter-clockwise
    const eps = Math.min(0.05, span * 0.002);
    const yDir = [axis[1] * xDir[2] - axis[2] * xDir[1], axis[2] * xDir[0] - axis[0] * xDir[2], axis[0] * xDir[1] - axis[1] * xDir[0]];
    const sectionAt = (s) => {
      s = Math.max(smin + eps, Math.min(smax - eps, s));
      const sec = keep(keep(shape.clone()).intersect(planeFace(s)));
      const fs = sec.faces;
      if (fs.length !== 1) { fs.forEach((f) => f.delete()); throw new Error("slice in " + fs.length + " pieces"); }
      const f = fs[0];
      const nw = f.wires.length;
      if (nw !== 1) { f.delete(); throw new Error("slice with a hole"); }
      const w = keep(f.outerWire()); // (outerWire uses up the face)
      const M = 480, pts = [];
      for (let i = 0; i < M; i++) { const q = w.pointAt(i / M), v = q.toTuple(); q.delete && q.delete(); const r = [v[0] - c0[0], v[1] - c0[1], v[2] - c0[2]]; pts.push([r[0] * xDir[0] + r[1] * xDir[1] + r[2] * xDir[2], r[0] * yDir[0] + r[1] * yDir[1] + r[2] * yDir[2]]); }
      let A2 = 0; for (let i = 0; i < M; i++) { const p = pts[i], q = pts[(i + 1) % M]; A2 += p[0] * q[1] - q[0] * p[1]; }
      if (A2 < 0) pts.reverse();
      return { s, P: pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-6) };
    };
    // an outline offset in its plane (+ grows), as a smooth closed curve at height s
    const K = 120;
    // one center for every slice: the middle of the first slice
    let cen = null;
    const curve = (o, d, s) => {
      const Q = d ? polyOffset(o.P, d) : o.P;
      if (Q.length < 12) throw new Error("collapsed");
      if (!cen) { cen = [0, 0]; for (const p of o.P) { cen[0] += p[0] / o.P.length; cen[1] += p[1] / o.P.length; } }
      const R2 = angleLoop(Q, K, cen) || resampleLoop(Q, K), base = at(s);
      const p3 = R2.map(([u, v]) => [base[0] + u * xDir[0] + v * yDir[0], base[1] + u * xDir[1] + v * yDir[1], base[2] + u * xDir[2] + v * yDir[2]]);
      p3.push(p3[0]);
      try { return keep(R.assembleWire([keep(R.makeBSplineApproximation(p3, { tolerance: 0.01, degMin: 3, degMax: 3 }))])); }
      catch (err) { return keep(R.makePolygon(p3.slice(0, -1)).outerWire()); }
    };
    // a solid through slices from lo to hi, offset by d, run on straight past either end
    const N = 14;
    const lofted = (d, lo, hi, extLo, extHi) => {
      const ws = [], os = [];
      for (let k = 0; k < N; k++) os.push(sectionAt(lo + ((hi - lo) * k) / (N - 1)));
      if (extLo) ws.push(curve(os[0], d, lo - extLo));
      for (let k = 0; k < N; k++) ws.push(curve(os[k], d, lo + ((hi - lo) * k) / (N - 1)));
      if (extHi) ws.push(curve(os[N - 1], d, hi + extHi));
      return keep(R.loft(ws, { ruled: false }));
    };
    const tin = dir === "in" ? t : dir === "both" ? t / 2 : 0, tout = dir === "out" ? t : dir === "both" ? t / 2 : 0;
    // the outside of the wall: past closed ends by the wall
    const outer = tout ? lofted(tout, smin + eps, smax - eps, eps + (openLo ? 0 : tout), eps + (openHi ? 0 : tout)) : shape;
    // the hollow inside: short of closed ends by the wall, out through open ones
    const lo = openLo ? smin + eps : smin + tin, hi = openHi ? smax - eps : smax - tin;
    let inner = lofted(-tin, lo, hi, 0, 0);
    // open ends: a straight plug out through the opening (fused on: a loft that runs on past
    // the end can trip up the cut)
    const plug = (s, len) => { const f = keep(R.makeFace(curve(sectionAt(s), -tin, s))); return keep(R.basicFaceExtrusion(f, new R.Vector(axis).multiply(len))); };
    if (openLo) inner = keep(inner.fuse(plug(lo, -(eps + tout + 2))));
    if (openHi) inner = keep(inner.fuse(plug(hi, eps + tout + 2)));
    if (typeof process !== "undefined" && process.env && process.env.SHELL_T) console.log("solids ms", Date.now() - TS);
    let walls = outer.cut(inner);
    let v = safeVolume(walls);
    const vo = safeVolume(outer);
    // the boolean engine sometimes gives up on the loft as it is: a fuzzy cut usually does it
    if (!(v < vo * 0.999)) {
      walls.delete();
      for (const fz of [1e-4, 1e-3, 1e-2]) {
        try { walls = R.cast(fuzzyCut(outer.wrapped, inner.wrapped, fz)); v = safeVolume(walls); if (v > 1e-6 && v < vo * 0.999) break; } catch (e) {}
      }
    }
    if (typeof process !== "undefined" && process.env && process.env.SHELL_T) { const ib = bboxOf(inner); console.log("slice: outer", vo.toFixed(0), "inner", safeVolume(inner).toFixed(0), "inner z", ib.min[2].toFixed(2), ib.max[2].toFixed(2), "walls", v.toFixed(0), "openLo/Hi", openLo, openHi, "smin/smax", smin.toFixed(2), smax.toFixed(2)); }
    if (!(v > 1e-6) || !(v < vo * 0.999)) { walls.delete(); return null; }
    // a wall of thickness t round the kept surface holds about area x t: much less means the
    // slices thinned it somewhere (a dome, a steep overhang), so this method isn't right here
    let kept = 0;
    for (const f of shape.faces) { if (!open.has(f.hashCode)) try { kept += R.measureArea(f); } catch (e) {} f.delete(); }
    if (kept > 0 && !(v > kept * t * 0.6 && v < kept * t * 1.7)) { if (typeof process !== "undefined" && process.env && process.env.SHELL_T) console.log("slice wall check failed", v, kept * t); walls.delete(); return null; }
    return walls;
  } catch (e) {
    if (typeof process !== "undefined" && process.env && process.env.SHELL_T) console.log("slice err", e && (e.stack || e.message || e));
    return null;
  } finally {
    for (const s of gc) if (s !== shape) try { s.delete(); } catch (e) {}
  }
}
function thickSolid(shape, d, openHashes, vIn, grows) {
  const faces = shape.faces.filter((f) => openHashes.has(f.hashCode));
  const tries = [
    [OC.GeomAbs_JoinType.GeomAbs_Arc, 1e-3, false],
    [OC.GeomAbs_JoinType.GeomAbs_Intersection, 1e-3, false],
    [OC.GeomAbs_JoinType.GeomAbs_Arc, 1e-4, true],
    [OC.GeomAbs_JoinType.GeomAbs_Intersection, 1e-2, true],
  ];
  try {
    for (const [join, tol, inter] of tries) {
      const list = new OC.NCollection_List_TopoDS_Shape();
      for (const f of faces) list.Append(f.wrapped);
      const b = new OC.BRepOffsetAPI_MakeThickSolid();
      let res = null;
      try {
        b.MakeThickSolidByJoin(shape.wrapped, list, d, tol, OC.BRepOffset_Mode.BRepOffset_Skin, inter, false, join, false);
        if (b.IsDone()) {
          const sh = R.cast(b.Shape());
          const v = safeVolume(sh);
          // inside walls: less than the body; outside walls: more than... the walls alone are
          // smaller than the grown body, so only check they're a sensible solid
          if (v > 1e-6 && (grows ? validSolid(sh) : v < vIn * 0.995)) res = sh; else sh.delete();
        }
      } catch (e) { res = null; }
      b.delete(); list.delete();
      if (res) return res;
    }
    return null;
  } finally { faces.forEach((f) => f.delete()); }
}
function validSolid(sh) {
  try { const a = new OC.BRepCheck_Analyzer(sh.wrapped, true, false); const v = a.IsValid(); a.delete(); return v; } catch (e) { return true; }
}
// The whole body grown (d > 0) or shrunk (d < 0) by |d|, as a solid.
function offsetSolid(shape, d, vIn, grows) {
  const good = (sh) => { const v = safeVolume(sh); return v > 1e-6 && (grows ? v > vIn * 1.0005 : v < vIn * 0.9995); };
  const attempts = [
    (b) => b.PerformByJoin(shape.wrapped, d, 1e-3, OC.BRepOffset_Mode.BRepOffset_Skin, false, false, OC.GeomAbs_JoinType.GeomAbs_Arc, false),
    (b) => b.PerformByJoin(shape.wrapped, d, 1e-3, OC.BRepOffset_Mode.BRepOffset_Skin, true, false, OC.GeomAbs_JoinType.GeomAbs_Arc, false),
    (b) => b.PerformByJoin(shape.wrapped, d, 1e-2, OC.BRepOffset_Mode.BRepOffset_Skin, true, false, OC.GeomAbs_JoinType.GeomAbs_Intersection, false),
    (b) => b.PerformBySimple(shape.wrapped, d),
  ];
  for (const run of attempts) {
    const b = new OC.BRepOffsetAPI_MakeOffsetShape();
    let res = null;
    try {
      run(b);
      if (b.IsDone()) {
        let sh = R.cast(b.Shape());
        sh = asSolid(sh);
        if (sh && good(sh)) res = sh; else if (sh) sh.delete();
      }
    } catch (e) { res = null; }
    b.delete();
    if (res) return res;
  }
  // last resort for unified faces
  const u = unified(shape);
  if (u) {
    const b = new OC.BRepOffsetAPI_MakeOffsetShape();
    let res = null;
    try {
      b.PerformByJoin(u.wrapped, d, 1e-2, OC.BRepOffset_Mode.BRepOffset_Skin, true, false, OC.GeomAbs_JoinType.GeomAbs_Arc, false);
      if (b.IsDone()) { const sh = asSolid(R.cast(b.Shape())); if (sh && good(sh)) res = sh; else if (sh) sh.delete(); }
    } catch (e) {}
    b.delete(); u.delete();
    if (res) return res;
  }
  return null;
}
// offset results can come back as a shell or compound: make a solid of them
function asSolid(sh) {
  if (!sh) return null;
  if (sh.constructor && sh.constructor.name === "Solid") return sh;
  try {
    const ex = new OC.TopExp_Explorer(sh.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
    if (ex.More()) { const s = R.cast(OC.TopoDS.Solid(ex.Current())); ex.delete(); return s; }
    ex.delete();
  } catch (e) {}
  try {
    const ex = new OC.TopExp_Explorer(sh.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SHELL, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
    if (ex.More()) {
      const mk = new OC.BRepBuilderAPI_MakeSolid(OC.TopoDS.Shell(ex.Current()));
      ex.delete();
      if (mk.IsDone()) { const s = R.cast(mk.Solid()); mk.delete(); const fx = fixSolid(s); return fx; }
      mk.delete();
    } else ex.delete();
  } catch (e) {}
  return null;
}
// A boolean (join, cut) between faces that touch or line up can leave loose faces or shells
// beside the solid: thin sheets you can see but can't pick or delete. Keep only the solids.
function solidsOnly(shape) {
  try {
    const T = OC.TopAbs_ShapeEnum;
    const ex = new OC.TopExp_Explorer(shape.wrapped, T.TopAbs_FACE, T.TopAbs_SOLID);
    const loose = ex.More();
    ex.delete();
    if (!loose) return shape;
    const solids = [];
    const es = new OC.TopExp_Explorer(shape.wrapped, T.TopAbs_SOLID, T.TopAbs_SHAPE);
    for (; es.More(); es.Next()) solids.push(OC.TopoDS.Solid(es.Current()));
    es.delete();
    if (!solids.length) return shape;
    let out;
    if (solids.length === 1) out = R.cast(solids[0]);
    else {
      const b = new OC.TopoDS_Builder(), c = new OC.TopoDS_Compound();
      b.MakeCompound(c);
      for (const x of solids) b.Add(c, x);
      b.delete();
      out = R.cast(c);
    }
    shape.delete();
    return out;
  } catch (e) { return shape; }
}
function fixSolid(s) {
  try { const f = new OC.ShapeFix_Solid(); f.Init(s.wrapped); f.Perform(new OC.Message_ProgressRange()); const r = R.cast(f.Solid()); f.delete(); s.delete(); return r; } catch (e) { return s; }
}
function unified(shape) {
  try {
    const u = new OC.ShapeUpgrade_UnifySameDomain(shape.wrapped, true, true, false);
    u.Build();
    const s2 = R.cast(u.Shape());
    u.delete();
    return s2;
  } catch (e) { return null; }
}
function unifiedTol(shape, lin, ang) {
  try {
    const u = new OC.ShapeUpgrade_UnifySameDomain(shape.wrapped, true, true, false);
    u.SetLinearTolerance(lin);
    u.SetAngularTolerance(ang);
    u.Build();
    const s2 = R.cast(u.Shape());
    u.delete();
    return s2;
  } catch (e) { return null; }
}
// faces of b at the same places as the chosen faces of a (by center and normal)
function remapFaces(a, b, hashes) {
  const want = [];
  for (const f of a.faces) { if (hashes.has(f.hashCode)) want.push(f.center.toTuple()); f.delete(); }
  const out = new Set();
  const fb = b.faces;
  for (const f of fb) {
    const c = f.center.toTuple();
    // a merged face's center can move: keep it when a wanted center lies on it
    if (want.some((w) => dist(w, c) < 1e-3 || onFace(f, w))) out.add(f.hashCode);
    f.delete();
  }
  return out;
}
function onFace(f, p) {
  try { const v = R.makeVertex(p); const d = R.measureDistanceBetween ? R.measureDistanceBetween(v, f) : NaN; v.delete(); return d < 1e-4; } catch (e) { return false; }
}
// Add the faces that run smoothly (tangent) on from the chosen ones, like Fusion's
// "Tangent chain": clicking a rounded rim takes the whole rim.
function tangentChain(shape, open) {
  const faces = shape.faces;
  const byHash = new Map(faces.map((f) => [f.hashCode, f]));
  const edgeFaces = new Map(); // edge hash -> [{face hash, edge}]
  for (const f of faces) for (const e of f.edges) {
    const k = e.hashCode;
    if (!edgeFaces.has(k)) edgeFaces.set(k, []);
    edgeFaces.get(k).push({ f: f.hashCode, e });
  }
  const queue = [...open];
  try {
    while (queue.length) {
      const h = queue.pop();
      const f = byHash.get(h);
      if (!f) continue;
      for (const e of f.edges) {
        const list = edgeFaces.get(e.hashCode) || [];
        let p = null;
        for (const o of list) {
          if (o.f === h || open.has(o.f)) continue;
          if (!p) try { p = e.pointAt(0.5); } catch (err) { break; }
          try {
            const n1 = unitT(f.normalAt(p).toTuple()), n2 = unitT(unitT(byHash.get(o.f).normalAt(p).toTuple()));
            const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
            if (Math.abs(dot) > 0.9995) { open.add(o.f); queue.push(o.f); }
          } catch (err) {}
        }
        if (p) p.delete && p.delete();
        e.delete();
      }
    }
  } finally {
    for (const l of edgeFaces.values()) for (const o of l) try { o.e.delete(); } catch (e) {}
    faces.forEach((f) => f.delete());
  }
}
// The piece of wall to cut away so a removed face becomes an opening: a slab through the
// wall at that face, limited (on flat faces) to the area over the hollow inside.
function openingTool(face, t, dir, cavity) {
  const eps = Math.max(0.05, t * 0.05);
  const n = unitT(face.normalAt().toTuple()); // outward
  const span = dir === "in" ? [-(t + eps), eps] : dir === "out" ? [-eps, t + eps] : [-(t / 2 + eps), t / 2 + eps];
  const slabOf = (a, b) => {
    // slab from a to b along the normal (a < b)
    if (face.geomType === "PLANE") {
      const base = face.clone().translate(n.map((v) => v * a));
      const s = R.basicFaceExtrusion(base, new R.Vector(n).multiply(b - a));
      base.delete();
      return s;
    }
    const lo = a < 0 ? thickenFace(face, a) : null, hi = b > 0 ? thickenFace(face, b) : null;
    if (lo && hi) return lo.fuse(hi);
    return lo || hi;
  };
  const slab = slabOf(span[0], span[1]);
  if (face.geomType !== "PLANE") return slab;
  // only over the hollow: the inside pushed out through this face
  const reach = cavity.clone().translate(n.map((v) => v * (t + eps * 2)));
  const pushed = cavity.clone().fuse(reach);
  reach.delete();
  const tool = slab.intersect(pushed);
  slab.delete(); pushed.delete();
  return tool;
}
// axis/center + radius of a cylindrical or spherical face, for grouping split faces
function surfaceSig(face) {
  const t = face.geomType;
  if (t === "PLANE") return null;
  const ad = new OC.BRepAdaptor_Surface(face.wrapped, true);
  try {
    const ST = OC.GeomAbs_SurfaceType, k = ad.GetType();
    const P = (p) => [p.X(), p.Y(), p.Z()];
    if (k === ST.GeomAbs_Cylinder) { const c = ad.Cylinder(), a = c.Position(); return { k: "cyl", o: P(a.Location()), d: P(a.Direction()), r: c.Radius() }; }
    if (k === ST.GeomAbs_Sphere) { const c = ad.Sphere(); return { k: "sph", o: P(c.Position().Location()), r: c.Radius() }; }
    return null;
  } catch (e) { return null; } finally { ad.delete(); }
}
function sameSurface(a, b) {
  if (!a || !b || a.k !== b.k || Math.abs(a.r - b.r) > 1e-6) return false;
  if (a.k === "sph") return dist(a.o, b.o) < 1e-6;
  const dot = a.d[0] * b.d[0] + a.d[1] * b.d[1] + a.d[2] * b.d[2];
  if (Math.abs(Math.abs(dot) - 1) > 1e-9) return false;
  // same axis line: the offset between origins runs along the axis
  const w = [b.o[0] - a.o[0], b.o[1] - a.o[1], b.o[2] - a.o[2]];
  const along = w[0] * a.d[0] + w[1] * a.d[1] + w[2] * a.d[2];
  return Math.hypot(w[0] - along * a.d[0], w[1] - along * a.d[1], w[2] - along * a.d[2]) < 1e-6;
}
// A solid between a face and its offset copy (d along the face's outward normal).
// Flat faces: a prism. Cylinders and spheres: an exact revolved slab. Anything else:
// a thickened copy, checked against the face area so a bad result is rejected.
function thickenFace(face, d, q) {
  const t = face.geomType;
  if (t === "PLANE") {
    let n = q && q.n;
    if (!n) n = unitT(face.normalAt().toTuple());
    return R.basicFaceExtrusion(face, new R.Vector(n).multiply(d));
  }
  const ad = new OC.BRepAdaptor_Surface(face.wrapped, true);
  try {
    const kind = ad.GetType();
    const ST = OC.GeomAbs_SurfaceType;
    const uv = OC.BRepTools.UVBounds(face.wrapped, 0, 0, 0, 0);
    const reversed = face.wrapped.Orientation() === OC.TopAbs_Orientation.TopAbs_REVERSED;
    const P = (p) => [p.X(), p.Y(), p.Z()];
    if (kind === ST.GeomAbs_Cylinder || kind === ST.GeomAbs_Sphere) {
      const surf = kind === ST.GeomAbs_Cylinder ? ad.Cylinder() : ad.Sphere();
      const pos = surf.Position();
      const r = surf.Radius();
      const direct = pos.Direct();
      const loc = P(pos.Location()), dir = P(pos.Direction()), xd = P(pos.XDirection()), yd = P(pos.YDirection());
      const s = (direct ? 1 : -1) * (reversed ? -1 : 1); // outward of the material, in radius terms
      const r2 = r + s * d;
      if (r2 <= 1e-6) throw new Error(`Offset face: ${Math.abs(d)} mm would close this ${kind === ST.GeomAbs_Cylinder ? "hole or cylinder" : "sphere"} completely`);
      const lo = Math.min(r, r2), hi = Math.max(r, r2);
      const u0 = uv.UMin, u1 = uv.UMax;
      const radial = [0, 1, 2].map((i) => Math.cos(u0) * xd[i] + Math.sin(u0) * yd[i]);
      const axis = direct ? dir : dir.map((v) => -v);
      const normal = [radial[1] * dir[2] - radial[2] * dir[1], radial[2] * dir[0] - radial[0] * dir[2], radial[0] * dir[1] - radial[1] * dir[0]];
      let dr;
      if (kind === ST.GeomAbs_Cylinder) {
        const v0 = uv.VMin, v1 = uv.VMax;
        dr = R.draw([lo, v0]).lineTo([hi, v0]).lineTo([hi, v1]).lineTo([lo, v1]).close();
      } else {
        const v0 = uv.VMin, v1 = uv.VMax, vm = (v0 + v1) / 2;
        const pt = (rr, v) => [rr * Math.cos(v), rr * Math.sin(v)];
        let pen = R.draw(pt(lo, v0)).lineTo(pt(hi, v0)).threePointsArcTo(pt(hi, v1), pt(hi, vm)).lineTo(pt(lo, v1));
        dr = lo > 1e-6 ? pen.threePointsArcTo(pt(lo, v0), pt(lo, vm)).close() : pen.close();
      }
      const sweep = ((u1 - u0) * 180) / Math.PI;
      const sk = dr.sketchOnPlane(new R.Plane(loc, radial, normal));
      return sk.revolve(axis, { origin: loc, angle: Math.min(360, sweep) });
    }
  } finally { ad.delete(); }
  // other curved faces: thicken, then make sure the result is about the right size
  const b = new OC.BRepOffsetAPI_MakeThickSolid();
  let out = null;
  try {
    b.MakeThickSolidBySimple(face.wrapped, d);
    if (b.IsDone()) {
      let sh = R.cast(b.Shape());
      let v = safeVolume(sh);
      // thickening outward can come back inside-out: turn it the right way round
      if (v < 0) { const r = R.cast(sh.wrapped.Reversed()); sh.delete(); sh = r; v = safeVolume(sh); }
      let area = NaN;
      try { area = R.measureArea(face); } catch (e) {}
      const expect = area * Math.abs(d);
      if (v > 1e-9 && (!(expect > 0) || (v > expect * 0.6 && v < expect * 1.6))) out = sh; else sh.delete();
    }
  } catch (e) { out = null; }
  b.delete();
  if (!out) throw new Error("Offset face works on flat, cylindrical and spherical faces. This face shape isn't supported yet.");
  return out;
}
// ---------------------------------------------------------------- threads
// Is point p inside the solid? (a tiny cube intersected with the body)
function insideAt(shape, p, e = 0.01) {
  const cube = R.makeBox([p[0] - e, p[1] - e, p[2] - e], [p[0] + e, p[1] + e, p[2] + e]);
  let v = 0;
  try { const c = shape.intersect(cube); v = safeVolume(c); c.delete(); } catch (err) { v = 0; }
  cube.delete();
  return v > 1e-9;
}
// Axis, radius, axial range and material side of the cylinder a thread goes on.
export function cylinderInfo(shape, q) {
  const faces = shape.faces;
  try {
    let best = null, bd = Infinity;
    for (const f of faces) {
      if (f.geomType !== "CYLINDRE") continue;
      const d = dist(f.center.toTuple(), q.c);
      if (d < bd) { bd = d; best = f; }
    }
    if (!best) throw new Error("Thread: pick a cylindrical face (a round hole or a round boss)");
    const sig = surfaceSig(best);
    const group = faces.filter((f) => f === best || sameSurface(surfaceSig(f), sig));
    const o = sig.o, d = sig.d;
    let t0 = Infinity, t1 = -Infinity, side = 0;
    const P = (p) => [p.X(), p.Y(), p.Z()];
    for (const f of group) {
      const ad = new OC.BRepAdaptor_Surface(f.wrapped, true);
      try {
        const pos = ad.Cylinder().Position();
        const loc = P(pos.Location()), dir = P(pos.Direction());
        const uv = OC.BRepTools.UVBounds(f.wrapped, 0, 0, 0, 0);
        const base = (loc[0] - o[0]) * d[0] + (loc[1] - o[1]) * d[1] + (loc[2] - o[2]) * d[2];
        const k = dir[0] * d[0] + dir[1] * d[1] + dir[2] * d[2];
        for (const v of [uv.VMin, uv.VMax]) { const t = base + v * k; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
        const reversed = f.wrapped.Orientation() === OC.TopAbs_Orientation.TopAbs_REVERSED;
        if (f === best) side = (pos.Direct() ? 1 : -1) * (reversed ? -1 : 1);
      } finally { ad.delete(); }
    }
    // a radial direction perpendicular to the axis
    const a = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let x = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
    const xl = Math.hypot(...x); x = x.map((v) => v / xl);
    return { o, d, x, r: sig.r, t0, t1, external: side > 0 };
  } finally { faces.forEach((f) => f.delete()); }
}
// A helix wire made of one edge per turn: a single long helical edge makes sweeps
// and booleans slow and unreliable after a dozen turns.
function helixWire(pitch, height, radius, center, dir, left) {
  const surf = new OC.Geom_CylindricalSurface(R.makeAx3(center, dir), radius);
  const mw = new OC.BRepBuilderAPI_MakeWire();
  const n = Math.max(1, Math.ceil(height / pitch - 1e-9));
  const sgn = left ? -1 : 1;
  for (let k = 0; k < n; k++) {
    const h0 = k * pitch, h1 = Math.min(height, (k + 1) * pitch);
    const a = new OC.gp_Pnt2d((sgn * 2 * Math.PI * h0) / pitch, h0), b = new OC.gp_Pnt2d((sgn * 2 * Math.PI * h1) / pitch, h1);
    const seg = new OC.GC_MakeSegment2d(a, b);
    const me = new OC.BRepBuilderAPI_MakeEdge(seg.Value(), surf);
    const e = me.Edge();
    OC.BRepLib.BuildCurves3d(e, 1e-6, OC.GeomAbs_Shape.GeomAbs_C1, 14, 40);
    mw.Add(e);
    me.delete(); seg.delete(); a.delete(); b.delete();
  }
  const w = new R.Wire(mw.Wire());
  mw.delete();
  return w;
}
// ---------------------------------------------------------------- emboss / deboss text
// one drawing per letter, each centred on its own middle; u = its middle along the line
function glyphDrawings(t) {
  const str = String(t.str || "");
  if (!str.trim()) throw new Error("Type some text first");
  const fontName = KNOWN_FONTS.has(t.font) ? t.font : "sans";
  const font = R.getFont(fontName);
  const cap = (font.tables.os2 && font.tables.os2.sCapHeight) || font.unitsPerEm * 0.7;
  const fontSize = clampPos(t.size || 10) * font.unitsPerEm / cap;
  const total = font.getAdvanceWidth(str, fontSize);
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (!ch.trim()) continue;
    const adv = font.getAdvanceWidth(str.slice(0, i), fontSize);
    const pb = font.getPath(ch, 0, 0, fontSize).getBoundingBox();
    if (!(pb.x2 > pb.x1)) continue;
    let d = R.drawText(ch, { startX: 0, startY: 0, fontSize, fontFamily: fontName });
    const [lo] = d.boundingBox.bounds;
    d = d.translate(pb.x1 - lo[0], -pb.y2 - lo[1]);
    const mx = (pb.x1 + pb.x2) / 2;
    out.push({ d: d.translate(-mx, -(t.size || 10) / 2), u: adv + mx - total / 2 });
  }
  if (!out.length) throw new Error("Type some text first");
  return out;
}
// mirror a 2D drawing left-to-right about its own centre line
const flipX = (d) => d.mirror([0, 1], [0, 0], "plane");
function embossTool(m) {
  if (m.reverse) m = { ...m, str: Array.from(String(m.str || "")).reverse().join("") };
  const depth = clampPos(m.depth ?? 1), emb = m.mode !== "deboss", size = clampPos(m.size || 10);
  const N = Vec.norm;
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const rot = (v, axis, ang) => { // Rodrigues
    const k = N(axis), c = Math.cos(ang), s = Math.sin(ang), d = Vec.dot(k, v), x = Vec.cross(k, v);
    return [0, 1, 2].map((i) => v[i] * c + x[i] * s + k[i] * d * (1 - c));
  };
  const fuseAll = (list) => { let acc = list[0]; for (let i = 1; i < list.length; i++) { const f = acc.fuse(list[i]); acc.delete(); list[i].delete(); acc = f; } return acc; };
  if (m.kind === "cyl" || m.kind === "sphere") {
    const center = m.kind === "cyl" ? m.o : m.c, r = m.r;
    const s = m.ext === false ? -1 : 1; // inside a hole the "outside" points to the axis
    let up, e1;
    if (m.kind === "cyl") {
      up = N(m.ax);
      const v = Vec.sub(m.p, m.o), h = Vec.dot(v, up);
      e1 = N(Vec.sub(v, up.map((q) => q * h)));
    } else {
      e1 = N(Vec.sub(m.p, m.c));
      const z = m.up ? N(m.up) : [0, 0, 1];
      up = Vec.sub(z, e1.map((q) => q * Vec.dot(z, e1)));
      if (Math.hypot(...up) < 1e-6) up = Vec.sub([1, 0, 0], e1.map((q) => q * e1[0]));
      up = N(up);
    }
    const T = N(Vec.cross(up, e1)).map((q) => q * s);
    const base = m.kind === "cyl" ? add(m.o, up, Vec.dot(Vec.sub(m.p, m.o), up)) : m.c;
    const tilt = ((m.angle || 0) * Math.PI) / 180;
    const prisms = [];
    let glyphs = m.along && m.kind === "cyl" ? [{ d: centered(textDrawing({ str: m.str, size, font: m.font })), u: 0, whole: true }] : glyphDrawings({ str: m.str, size, font: m.font });
    if (m.mirror) glyphs = glyphs.map((g) => ({ ...g, d: flipX(g.d), u: -g.u }));
    for (const g of glyphs) {
      // a tilted line of text: each letter moves along the rotated baseline, not just around
      const ua = g.whole ? 0 : g.u * Math.cos(tilt), va = g.whole ? 0 : g.u * Math.sin(tilt);
      const phi = (s * ua) / r;
      let nr = N([0, 1, 2].map((i) => e1[i] * Math.cos(phi) + T[i] * s * Math.sin(phi)));
      let lift = va;
      if (m.kind === "sphere" && Math.abs(va) > 1e-9) { nr = N(rot(nr, Vec.cross(nr, up), va / r)); lift = 0; }
      let xd = N(Vec.cross(up, nr)).map((q) => q * s);
      let yd = up;
      if (g.whole) { xd = up; yd = null; } // running along the axis
      if (tilt && !g.whole) { xd = rot(xd, nr, tilt); }
      // the letter's plane faces whoever looks at this surface (outside a peg, inside a hole)
      const origin = add(add(base, nr, r - s * (depth + 1)), up, lift);
      const sk = g.d.sketchOnPlane(new R.Plane(origin, xd, nr.map((q) => q * s)));
      prisms.push(sk.extrude(2 * depth + 2));
      void yd;
    }
    const prism = fuseAll(prisms);
    // the shell the letters live in: just outside the surface (emboss) or just inside (deboss)
    let r0, r1;
    if (emb) { r0 = s > 0 ? r - 0.02 : r - depth; r1 = s > 0 ? r + depth : r + 0.02; }
    else { r0 = s > 0 ? r - depth : r - 0.5; r1 = s > 0 ? r + 0.5 : r + depth; }
    let shell;
    if (m.kind === "cyl") {
      const H = size * 4 + 2 * depth + Math.abs(glyphs.length * size), b0 = add(base, up, -H / 2);
      const outer = R.makeCylinder(r1, H, b0, up);
      if (r0 > 1e-3) { const inner = R.makeCylinder(r0, H, b0, up); shell = outer.cut(inner); outer.delete(); inner.delete(); } else shell = outer;
    } else {
      const outer = R.makeSphere(r1).translate(...center);
      if (r0 > 1e-3) { const inner = R.makeSphere(r0).translate(...center); shell = outer.cut(inner); outer.delete(); inner.delete(); } else shell = outer;
    }
    const tool = prism.intersect(shell);
    prism.delete(); shell.delete();
    return tool;
  }
  // flat faces (and a straight push for other curved faces)
  const n = N(m.n);
  let x = m.x ? N(m.x) : perpTo(n, null);
  if (m.angle) x = rot(x, n, (m.angle * Math.PI) / 180);
  let dr = centered(textDrawing({ str: m.str, size, font: m.font }));
  if (m.mirror) dr = flipX(dr);
  const curved = m.kind === "other";
  if (emb) {
    const start = curved ? size * 0.6 : 0.02; // reach into a curved face so every letter touches it
    return dr.sketchOnPlane(new R.Plane(add(m.p, n, -start), x, n)).extrude(depth + start);
  }
  return dr.sketchOnPlane(new R.Plane(add(m.p, n, -depth), x, n)).extrude(depth + 0.5);
}
// ---------------------------------------------------------------- face patterns
// A pattern of shapes (hexagons, diamond-plate bars, screen-mesh squares, ...) raised from or cut
// into one flat face. Parametric: it is rebuilt from its settings every time, centered on the face
// it was put on (found again by its direction and the point that was clicked, so it follows the
// face when the body is resized).
function facePatFace(shape, m) {
  const n = Vec.norm(m.n), p = m.p;
  let best = null, bd = Infinity;
  const faces = shape.faces;
  for (const f of faces) {
    if (f.geomType !== "PLANE") continue;
    let nf;
    try { nf = unitT(f.normalAt().toTuple()); } catch (e) { continue; }
    if (Vec.dot(nf, n) < 0.999) continue;
    let d;
    try { const v = R.makeVertex(p); d = R.measureDistanceBetween(v, f); v.delete(); } catch (e) { d = Infinity; }
    if (d < bd) { bd = d; best = f; }
  }
  for (const f of faces) if (f !== best) f.delete();
  return best;
}
// the face's outline (outer edge and holes) as 2D segments in the pattern's frame
function faceSegments2D(face, O, X, Y) {
  const segs = [];
  const to2 = (q) => { const d = Vec.sub(q, O); return [Vec.dot(d, X), Vec.dot(d, Y)]; };
  for (const w of face.wires) {
    for (const e of w.edges) {
      let k = 1;
      try { const t = e.geomType; k = t === "LINE" ? 1 : t === "CIRCLE" ? 48 : 32; } catch (err) { k = 24; }
      let prev = null;
      for (let i = 0; i <= k; i++) {
        let q;
        try { const v = e.pointAt(i / k); q = to2(v.toTuple()); v.delete && v.delete(); } catch (err) { continue; }
        if (prev) segs.push([prev[0], prev[1], q[0], q[1]]);
        prev = q;
      }
      e.delete();
    }
    w.delete();
  }
  return segs;
}
const segDist = (x, y, s) => {
  const dx = s[2] - s[0], dy = s[3] - s[1], L = dx * dx + dy * dy;
  let t = L > 0 ? ((x - s[0]) * dx + (y - s[1]) * dy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (s[0] + t * dx), y - (s[1] + t * dy));
};
function insideSegs(x, y, segs) {
  let c = false;
  for (const s of segs) {
    if ((s[1] > y) !== (s[3] > y) && x < s[0] + ((y - s[1]) * (s[2] - s[0])) / (s[3] - s[1])) c = !c;
  }
  return c;
}
function inPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if ((P[i][1] > y) !== (P[j][1] > y) && x < P[i][0] + ((y - P[i][1]) * (P[j][0] - P[i][0])) / (P[j][1] - P[i][1])) c = !c;
  }
  return c;
}
// ---- lattice shells and sphere lattices (v2.9.9.9.14)
// How thick the body is straight in from a point on its surface (to the next surface inside).
function wallAt(shape, p, n) {
  let mesh = null;
  try { mesh = shape.mesh({ tolerance: 0.05, angularTolerance: 0.2 }); } catch (e) { return Infinity; }
  const N = Vec.norm(n);
  return rayMeshDepth(mesh, p.map((x, i) => x - N[i] * 0.02), N.map((x) => -x)) + 0.02;
}
// The body hollowed to a closed skin of the chosen thickness, so a lattice on a curved face goes
// through the skin, not right through the solid. Not done where the body is already that thin.
function latticeSkin(shape, m) {
  const t = Math.max(0.4, +m.skin || 2);
  const w = wallAt(shape, m.p, m.n);
  if (isFinite(w) && w <= t * 2.2) return null;
  const v0 = safeVolume(shape);
  const out = shellSolid(shape.clone(), t, new Set(), "in", v0);
  if (!out) throw new Error("Lattice: couldn't hollow this body to a " + t + " mm skin. Try a thinner skin, or Cut right through.");
  return out;
}
// The spherical face clicked (by the stored point), with its centre and radius.
function sphereOf(shape, m) {
  const face = curvedPatFace(shape, m);
  if (!face) return null;
  try {
    const ad = new OC.BRepAdaptor_Surface(face.wrapped, true);
    try {
      if (ad.GetType() !== OC.GeomAbs_SurfaceType.GeomAbs_Sphere) return null;
      const sp = ad.Sphere(), loc = sp.Location();
      const out = { c: [loc.X(), loc.Y(), loc.Z()], r: sp.Radius() };
      sp.delete(); loc.delete();
      return { ...out, face: face.clone() };
    } finally { ad.delete(); }
  } finally { face.delete(); }
}
// Geodesic cells on a unit sphere: an icosahedron split n times along each edge. Returns the
// vertices and triangles. Cells: "hex" (the hexagons and twelve pentagons around each vertex,
// like a football), "triangles", "circles" and "mesh" (round and square holes at each vertex).
function geodesic(n) {
  const t = (1 + Math.sqrt(5)) / 2;
  const V0 = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(Vec.norm);
  const F0 = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const verts = [], key = new Map(), tris = [];
  const add = (p) => { const q = Vec.norm(p); const k = q.map((x) => Math.round(x * 1e6)).join(","); let i = key.get(k); if (i == null) { i = verts.length; verts.push(q); key.set(k, i); } return i; };
  for (const [a, b, c] of F0) {
    const A = V0[a], B = V0[b], C = V0[c], id = [];
    for (let i = 0; i <= n; i++) { id.push([]); for (let j = 0; j <= n - i; j++) { const k = n - i - j; id[i].push(add([0, 1, 2].map((d) => (A[d] * k + B[d] * i + C[d] * j) / n))); } }
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      tris.push([id[i][j], id[i + 1][j], id[i][j + 1]]);
      if (j < n - i - 1) tris.push([id[i + 1][j], id[i + 1][j + 1], id[i][j + 1]]);
    }
  }
  return { verts, tris };
}
// Shrink a convex polygon (in a tangent plane, 2D) inward by d.
function insetPoly(P, d) {
  const n = P.length;
  let area = 0; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const nx = (-dy / L) * sgn, ny = (dx / L) * sgn; // inward
    lines.push({ p: [a[0] + nx * d, a[1] + ny * d], d: [dx / L, dy / L] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i - 1 + n) % n], B = lines[i];
    const den = A.d[0] * B.d[1] - A.d[1] * B.d[0];
    if (Math.abs(den) < 1e-9) return null;
    const tt = ((B.p[0] - A.p[0]) * B.d[1] - (B.p[1] - A.p[1]) * B.d[0]) / den;
    out.push([A.p[0] + A.d[0] * tt, A.p[1] + A.d[1] * tt]);
  }
  // still the same way round and not turned inside out
  let a2 = 0; for (let i = 0; i < n; i++) { const a = out[i], b = out[(i + 1) % n]; a2 += a[0] * b[1] - b[0] * a[1]; }
  return a2 * sgn > 1e-6 && Math.abs(a2) < Math.abs(area) ? out : null;
}
// The lattice cells for a sphere: each cell a solid wedge reaching from inside the skin (rIn) to
// past the surface (rOut), its sides running toward the centre, so the ribs between cells stay
// the same width all the way through.
function sphereLattice(shape, m) {
  const S = sphereOf(shape, m);
  if (!S) return null;
  const { c: C, r: Rs, face } = S;
  try {
    const size = Math.max(1, +m.size || 10), gap = Math.max(0.3, +m.gap || 2);
    const wall = wallAt(shape, m.p, m.n);
    if (!isFinite(wall) || wall > Rs * 0.85) throw new Error("Lattice: this sphere is solid. Choose Lattice shell (a hollow ball with a lattice skin), or shell it first.");
    const rIn = Math.max(Rs * 0.05, Rs - wall - 0.6), rOut = Rs + 0.6;
    // how finely to split: neighbouring vertices about one cell size apart
    const n = Math.max(1, Math.min(40, Math.round((1.1071 * Rs) / size)));
    const g = geodesic(n);
    // turn the layout so a cell sits right where the face was clicked (then by the angle)
    const up = Vec.norm(Vec.sub(m.p, C));
    const rot = rotBetween([0, 1, 0].map((x, i) => g.verts[0][i]), up);
    const ang = ((+m.angle || 0) * Math.PI) / 180;
    const spin = (v) => { if (!ang) return v; const k = up, ca = Math.cos(ang), sa = Math.sin(ang), d = Vec.dot(k, v), x = Vec.cross(k, v); return [0, 1, 2].map((i) => v[i] * ca + x[i] * sa + k[i] * d * (1 - ca)); };
    const V = g.verts.map((v) => spin(rot(v)));
    // the cells, each as directions (unit vectors) round its outline
    const cells = [];
    const tangentFrame = (u) => { const a = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const e1 = Vec.norm(Vec.cross(u, a)), e2 = Vec.cross(u, e1); return [e1, e2]; };
    // a polygon of directions around centre direction u: into the tangent plane at radius Rs
    // (gnomonic), inset by half a rib, back out to directions
    const cellFrom = (u, dirs) => {
      const [e1, e2] = tangentFrame(u);
      const flat = dirs.map((d) => { const k = Rs / Vec.dot(d, u); return [Vec.dot(d, e1) * k, Vec.dot(d, e2) * k]; });
      const ins = insetPoly(flat, gap / 2);
      if (!ins) return null;
      return ins.map(([x, y]) => Vec.norm([0, 1, 2].map((i) => u[i] * Rs + e1[i] * x + e2[i] * y)));
    };
    const kind = m.kind || "hex";
    if (kind === "triangles") {
      for (const [a, b, c2] of g.tris) { const u = Vec.norm([0, 1, 2].map((i) => V[a][i] + V[b][i] + V[c2][i])); const q = cellFrom(u, [V[a], V[b], V[c2]]); if (q) cells.push({ u, q }); }
    } else if (kind === "hex") {
      // around each vertex: the middles of the triangles that meet there, in order
      const around = V.map(() => []);
      g.tris.forEach((t, ti) => t.forEach((vi) => around[vi].push(ti)));
      const mid = g.tris.map(([a, b, c2]) => Vec.norm([0, 1, 2].map((i) => V[a][i] + V[b][i] + V[c2][i])));
      V.forEach((u, vi) => {
        const [e1, e2] = tangentFrame(u);
        const ring = around[vi].map((ti) => mid[ti]).sort((p, q) => Math.atan2(Vec.dot(p, e2), Vec.dot(p, e1)) - Math.atan2(Vec.dot(q, e2), Vec.dot(q, e1)));
        const q = cellFrom(u, ring);
        if (q) cells.push({ u, q });
      });
    } else {
      // round holes (or square ones for the screen mesh) at each vertex
      const sides = kind === "mesh" ? 4 : 20;
      const rr = Math.max(0.3, (((1.1071 * Rs) / n) - gap) / (kind === "mesh" ? Math.SQRT2 : 2));
      for (const u of V) {
        const [e1, e2] = tangentFrame(u);
        const q = [];
        for (let i = 0; i < sides; i++) { const a = (i / sides) * 2 * Math.PI + (kind === "mesh" ? Math.PI / 4 : 0); q.push(Vec.norm([0, 1, 2].map((d) => u[d] * Rs + (e1[d] * Math.cos(a) + e2[d] * Math.sin(a)) * rr))); }
        cells.push({ u, q });
      }
    }
    // a sphere with edges (a dome, a ball cut flat): keep cells that lie on the face, a frame's
    // width in from its edges
    let edges = [];
    for (const e of face.edges) { let deg = false; try { deg = e.length < 1e-6; } catch (er) {} if (!deg) edges.push(e); else e.delete(); }
    const frame = Math.max(0, +m.border || 0);
    // how far inside the frame a direction lands: + inside, - in the frame or off the face
    const gAt = (d) => {
      const P = [0, 1, 2].map((i) => C[i] + d[i] * Rs);
      const vx = R.makeVertex(P);
      try {
        const off = R.measureDistanceBetween(vx, face);
        if (off > 0.02) return -off - frame;
        let near = Infinity;
        for (const e of edges) near = Math.min(near, R.measureDistanceBetween(vx, e));
        return near - frame;
      } finally { vx.delete(); }
    };
    const lerpDir = (a, b, t) => Vec.norm([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t));
    const kept = [];
    const whole = m.edge === "whole";
    for (const cl of cells) {
      if (!edges.length) { kept.push(cl); continue; }
      const g0 = cl.q.map(gAt);
      if (g0.every((x) => x >= 0)) { kept.push(cl); continue; }
      if (whole || g0.every((x) => x < 0)) continue;
      // trimmed at the frame: the outline clipped where it crosses the frame's edge
      const out = [];
      for (let i = 0; i < cl.q.length; i++) {
        const j = (i + 1) % cl.q.length, A = cl.q[i], B = cl.q[j], ga = g0[i], gb = g0[j];
        if (ga >= 0) out.push(A);
        if ((ga >= 0) !== (gb >= 0)) {
          let lo = 0, hi = 1, glo = ga;
          for (let k = 0; k < 9; k++) { const mid = (lo + hi) / 2, gm = gAt(lerpDir(A, B, mid)); if ((gm >= 0) === (glo >= 0)) { lo = mid; glo = gm; } else hi = mid; }
          out.push(lerpDir(A, B, (lo + hi) / 2));
        }
      }
      if (out.length < 3) continue;
      // too thin a sliver to print: left solid
      const u = Vec.norm(out.reduce((acc, d) => [acc[0] + d[0], acc[1] + d[1], acc[2] + d[2]], [0, 0, 0]));
      const [e1, e2] = tangentFrame(u);
      const fl = out.map((d) => { const k = Rs / Vec.dot(d, u); return [Vec.dot(d, e1) * k, Vec.dot(d, e2) * k]; });
      let ar = 0; for (let i = 0; i < fl.length; i++) { const p0 = fl[i], p1 = fl[(i + 1) % fl.length]; ar += p0[0] * p1[1] - p1[0] * p0[1]; }
      if (Math.abs(ar) / 2 < Math.max(0.6, gap * gap)) continue;
      kept.push({ u, q: out });
    }
    edges.forEach((e) => e.delete());
    if (!kept.length) throw new Error("Lattice: no cells fit on this sphere. Make the cells smaller or the frame thinner.");
    if (kept.length > 3000) throw new Error(`Lattice: that would be ${kept.length} cells. Make the cell size bigger.`);
    // trimmed cells at a dome's edge: the frame itself trims them (the frame stays solid)
    const solids = [];
    for (const cl of kept) {
      const k = cl.q.length;
      const O = cl.q.map((d) => [0, 1, 2].map((i) => C[i] + d[i] * rOut)), I = cl.q.map((d) => [0, 1, 2].map((i) => C[i] + d[i] * rIn));
      const mo = [0, 1, 2].map((i) => C[i] + cl.u[i] * rOut / Math.max(0.5, Math.min(...cl.q.map((d) => Vec.dot(d, cl.u))))), mi = [0, 1, 2].map((i) => C[i] + cl.u[i] * rIn);
      const faces = [];
      try {
        for (let i = 0; i < k; i++) {
          const j = (i + 1) % k;
          faces.push(R.makePolygon([O[i], O[j], I[j], I[i]]));
          faces.push(R.makePolygon([mo, O[j], O[i]]));
          faces.push(R.makePolygon([mi, I[i], I[j]]));
        }
        const sol = R.makeSolid(faces);
        if (safeVolume(sol) < 0) { const r2 = R.cast(sol.wrapped.Reversed()); sol.delete(); solids.push(r2); } else solids.push(sol);
      } catch (e) {
      } finally { faces.forEach((f) => { try { f.delete(); } catch (er) {} }); }
    }
    if (!solids.length) throw new Error("Lattice: couldn't make the cells");
    // the frame round a dome's edge: cells reaching into it are trimmed by a shell kept solid there
    return R.makeCompound(solids);
  } finally { face.delete(); }
}
// a rotation taking unit vector a to unit vector b
function rotBetween(a, b) {
  const v = Vec.cross(a, b), c = Vec.dot(a, b), s = Math.hypot(...v);
  if (s < 1e-9) return c > 0 ? (x) => x : (x) => { const p = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const k = Vec.norm(Vec.cross(a, p)); const d = Vec.dot(k, x); return [0, 1, 2].map((i) => -x[i] + 2 * k[i] * d); };
  const k = v.map((x) => x / s);
  return (x) => { const d = Vec.dot(k, x), cr = Vec.cross(k, x); return [0, 1, 2].map((i) => x[i] * c + cr[i] * s + k[i] * d * (1 - c)); };
}

// ---- patterns and lattices on curved faces (cylinders, cones, spheres, fillets, freeform)
// The pattern is laid out flat in the face's own surface coordinates, measured in mm along the
// surface (s round, t along), then each shape is stood on the surface where its middle lands:
// a prism square to the surface there, reaching far enough past it to allow for the curve.
// Faces that wrap all the way round get a whole number of shapes round, so there is no seam.
function curvedPatFace(shape, m) {
  const p = m.p, n = Vec.norm(m.n);
  let best = null, bd = Infinity;
  for (const f of shape.faces) {
    let d;
    try { const v = R.makeVertex(p); d = R.measureDistanceBetween(v, f); v.delete(); } catch (e) { d = Infinity; }
    if (d < 1e-3) { try { const nn = unitT(f.normalAt(p).toTuple()); if (Vec.dot(nn, n) < 0.5) d += 1; } catch (e) {} }
    if (d < bd) { if (best) best.delete(); bd = d; best = f; } else f.delete();
  }
  return bd < 2 ? best : (best && best.delete(), null);
}
function rayMeshDepth(mesh, o, dir) {
  // the first surface along the ray (further than a hair): Möller–Trumbore over every triangle
  const V = mesh.vertices, T = mesh.triangles;
  let best = Infinity;
  for (let k = 0; k < T.length; k += 3) {
    const a = T[k] * 3, b = T[k + 1] * 3, c = T[k + 2] * 3;
    const e1x = V[b] - V[a], e1y = V[b + 1] - V[a + 1], e1z = V[b + 2] - V[a + 2];
    const e2x = V[c] - V[a], e2y = V[c + 1] - V[a + 1], e2z = V[c + 2] - V[a + 2];
    const px = dir[1] * e2z - dir[2] * e2y, py = dir[2] * e2x - dir[0] * e2z, pz = dir[0] * e2y - dir[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, tx = o[0] - V[a], ty = o[1] - V[a + 1], tz = o[2] - V[a + 2];
    const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * inv; if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 0.08 && t < best) best = t;
  }
  return best;
}
function clipPolyRect(P, x0, x1, y0, y1) {
  const clipE = (pts, inside, cross) => { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], ia = inside(a), ib = inside(b); if (ia) out.push(a); if (ia !== ib) out.push(cross(a, b)); } return out; };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  let q = P;
  if (x0 > -Infinity) q = clipE(q, (a) => a[0] >= x0, (a, b) => lerp(a, b, (x0 - a[0]) / (b[0] - a[0])));
  if (q.length && x1 < Infinity) q = clipE(q, (a) => a[0] <= x1, (a, b) => lerp(a, b, (x1 - a[0]) / (b[0] - a[0])));
  if (q.length && y0 > -Infinity) q = clipE(q, (a) => a[1] >= y0, (a, b) => lerp(a, b, (y0 - a[1]) / (b[1] - a[1])));
  if (q.length && y1 < Infinity) q = clipE(q, (a) => a[1] <= y1, (a, b) => lerp(a, b, (y1 - a[1]) / (b[1] - a[1])));
  return q;
}
function facePatCurved(shape, m) {
  if (m.kind === "slots") throw new Error("Pattern: ribs only go on flat faces. Pick another pattern for a curved face.");
  if (m.lines) throw new Error("Pattern: “lines between” only works on flat faces. Choose “the shapes” for a curved face.");
  const face = curvedPatFace(shape, m);
  if (!face) throw new Error("Pattern: the curved face it was on is gone. Edit it and click a face again.");
  const bp = new OC.BRepGProp_Face(face.wrapped, false), gpt = new OC.gp_Pnt(), gvec = new OC.gp_Vec();
  try {
    let { uMin, uMax, vMin, vMax } = face.UVBounds;
    // a round surface split into pieces (a cone or sphere is often two half faces): the pattern
    // goes all the way round the surface, on whichever piece each shape lands
    let extended = false;
    try {
      const ad = new OC.BRepAdaptor_Surface(face.wrapped, true);
      if (ad.IsUPeriodic()) { const per = ad.UPeriod(); if (uMax - uMin < per - 1e-6) { uMax = uMin + per; extended = true; } }
      if (ad.IsVPeriodic()) { const per = ad.VPeriod(); if (vMax - vMin < per - 1e-6) { vMax = vMin + per; extended = true; } }
      ad.delete();
    } catch (e) {}
    const ev = (u, v) => { bp.Normal(u, v, gpt, gvec); const N = [gvec.X(), gvec.Y(), gvec.Z()], L = Math.hypot(...N) || 1; return { P: [gpt.X(), gpt.Y(), gpt.Z()], N: N.map((x) => x / L) }; };
    const NS = 96, um = (uMin + uMax) / 2, vm = (vMin + vMax) / 2;
    // arc length tables: along v at the middle u, and along u at any v (cached)
    const table = (f) => { const L = [0]; let prev = f(0); for (let i = 1; i <= NS; i++) { const q = f(i / NS); L.push(L[i - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2])); prev = q; } return L; };
    const inv = (L, x) => { if (x <= 0) return 0; const tot = L[NS]; if (x >= tot) return 1; let lo = 0, hi = NS; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L[mid] <= x) lo = mid; else hi = mid; } return (lo + (x - L[lo]) / Math.max(1e-12, L[hi] - L[lo])) / NS; };
    const Lv = table((a) => ev(um, vMin + a * (vMax - vMin)).P), H = Lv[NS];
    const rows = new Map();
    const rowAt = (v) => { const key = Math.round(v * 1e6); let r = rows.get(key); if (!r) { r = table((a) => ev(uMin + a * (uMax - uMin), v).P); rows.set(key, r); } return r; };
    const W = rowAt(vm)[NS];
    if (!(W > 0.5 && H > 0.5)) throw new Error("Pattern: this face is too small for a pattern");
    const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    let isCyl = false; try { isCyl = face.geomType === "CYLINDRE"; } catch (e) {}
    const uClosed = dist3(ev(uMin, vm).P, ev(uMax, vm).P) < 1e-3 * Math.max(1, W);
    const vClosed = dist3(ev(um, vMin).P, ev(um, vMax).P) < 1e-3 * Math.max(1, H);
    // where a point of the flat layout lands: t along, s round (squeezed in proportion on rows
    // that are shorter or longer than the middle one, e.g. toward the top of a sphere or a cone)
    const vOf = (t) => vMin + inv(Lv, t) * (vMax - vMin);
    const land = (sx, t) => {
      const v = vOf(t), L = rowAt(v), k = L[NS] / W;
      let sl = sx * k;
      if (uClosed) { sl = ((sl % L[NS]) + L[NS]) % L[NS]; }
      return { u: uMin + inv(L, sl) * (uMax - uMin), v, k };
    };
    // pattern size: on a face that wraps round, a whole number of shapes round
    let size = Math.max(0.5, +m.size || 6);
    if (uClosed && !(+m.angle)) { const nr = Math.max(3, Math.round(W / size)); size = W / nr; }
    const mm = { ...m, size };
    const ang = ((+m.angle || 0) * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    const ox = +m.ox || 0, oy = +m.oy || 0;
    // lay out over the whole face (and a bit), centered on it (from the seam on a wrapped face)
    const cxD = uClosed ? 0 : W / 2, cyD = H / 2;
    const R2 = Math.hypot(W, H) / 2 + size * 2;
    let cells = facePatCells(mm, uClosed && !ang ? [0, -cyD - size, W - 1e-6, cyD + size] : [-R2, -R2, R2, R2]);
    const toDom = ([x, y]) => [cxD + ox + x * ca - y * sa, cyD + oy + x * sa + y * ca];
    cells = cells.map((c) => ({ ...c, c: toDom(c.c), pts: c.r ? null : c.pts.map(toDom) }));
    if (uClosed && !ang) cells = cells.filter((c) => c.c[0] - ox >= -1e-6 && c.c[0] - ox < W - 1e-6);
    // edges: whole shapes inside the border, or shapes trimmed at the edge / the lattice frame
    const clip = m.edge === "clip";
    const fr = clip ? (m.through ? Math.max(0, +m.border || 0) : 0) : Math.max(0, +m.border || 0);
    const sx0 = uClosed ? -Infinity : fr, sx1 = uClosed ? Infinity : W - fr, ty0 = vClosed ? -Infinity : fr, ty1 = vClosed ? Infinity : H - fr;
    const circ = (c, k = 24) => { const o = []; for (let i = 0; i < k; i++) { const a = (i / k) * 2 * Math.PI; o.push([c.c[0] + c.r * Math.cos(a), c.c[1] + c.r * Math.sin(a)]); } return o; };
    const kept = [];
    for (const c of cells) {
      let pts = c.r ? circ(c) : c.pts;
      const inR = (q) => q[0] >= sx0 - 1e-9 && q[0] <= sx1 + 1e-9 && q[1] >= ty0 - 1e-9 && q[1] <= ty1 + 1e-9;
      if (clip) {
        if (pts.every(inR)) { kept.push(c); continue; }
        const q = clipPolyRect(pts, sx0, sx1, ty0, ty1);
        if (q.length >= 3) { let a2 = 0; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; a2 += a[0] * b[1] - b[0] * a[1]; } if (Math.abs(a2) / 2 > 0.04 * size * size) kept.push({ c: c.c, pts: q }); }
      } else if (pts.every(inR)) kept.push(c);
    }
    cells = kept;
    // shapes squeezed to nothing (near the pole of a sphere) are left off
    cells = cells.filter((c) => land(c.c[0], Math.max(0, Math.min(H, c.c[1]))).k > 0.3);
    // a face with holes or trimmed edges: only shapes whose middle is on the face
    let a0 = 0; try { a0 = R.measureArea(face); } catch (e) {}
    let est = 0; for (let i = 0; i < 24; i++) { const t0 = (i / 24) * H, t1 = ((i + 1) / 24) * H; est += rowAt(vOf((t0 + t1) / 2))[NS] * (t1 - t0); }
    const trimmed = extended || (a0 > 0 && Math.abs(a0 - est) / est > 0.03);
    // the faces of the body on this surface: a shape is kept when its middle lands on one of them
    const onFaces = [];
    if (trimmed) {
      let gt = null; try { gt = face.geomType; } catch (e) {}
      for (const f of shape.faces) { let g = null; try { g = f.geomType; } catch (e) {} if (g === gt) onFaces.push(f); else f.delete(); }
    }
    if (!cells.length) throw new Error("Pattern: no shapes fit on this face. Make the pattern smaller or the border thinner.");
    if (cells.length > 2500) throw new Error(`Pattern: that would be ${cells.length} shapes. Make the pattern size bigger (or pick a smaller face).`);
    const cut = m.mode === "cut" || !!m.through;
    const depth = clampPos(+m.depth || 1, 0.05), e = 0.05;
    let mesh = null;
    if (m.through) { try { mesh = shape.mesh({ tolerance: 0.05, angularTolerance: 0.2 }); } catch (err) { mesh = null; } }
    const [blo, bhi] = shape.boundingBox.bounds, diag = Math.hypot(bhi[0] - blo[0], bhi[1] - blo[1], bhi[2] - blo[2]);
    const prisms = [];
    try {
      for (const c of cells) {
        const ct = Math.max(0, Math.min(H, c.c[1]));
        const L0 = land(c.c[0], ct), A = ev(L0.u, L0.v), P = A.P, N = A.N;
        if (trimmed) {
          let d = 1; const vx = R.makeVertex(P);
          for (const f of onFaces) { try { d = Math.min(d, R.measureDistanceBetween(vx, f)); } catch (err) {} if (d <= 0.05) break; }
          vx.delete();
          if (d > 0.05) continue;
        }
        // the surface's directions here: round (Tu) and along (Tv)
        const du = (uMax - uMin) * 1e-4, dv = (vMax - vMin) * 1e-4;
        const Pu = ev(Math.min(uMax, L0.u + du), L0.v).P, Pu0 = ev(Math.max(uMin, L0.u - du), L0.v).P;
        const Pv = ev(L0.u, Math.min(vMax, L0.v + dv)).P, Pv0 = ev(L0.u, Math.max(vMin, L0.v - dv)).P;
        let Tu = Vec.norm(Vec.sub(Pu, Pu0)); Tu = Vec.norm(Vec.sub(Tu, N.map((x) => x * Vec.dot(Tu, N))));
        let Tv = Vec.cross(N, Tu); if (Vec.dot(Tv, Vec.sub(Pv, Pv0)) < 0) Tv = Tv.map((x) => -x);
        const k = L0.k;
        // true circles (squeezed ones toward a sphere's poles become 16-sided ovals)
        const pts = c.r && (isCyl || k > 0.85) ? null : (c.r ? circ(c, 16) : c.pts);
        // how far the surface curves away from this flat shape: the shape reaches past it
        let dmin = 0, dmax = 0;
        for (const q of pts || circ(c, 8)) { const Lq = land(q[0], Math.max(0, Math.min(H, q[1]))), S = ev(Lq.u, Lq.v).P, d = Vec.dot(Vec.sub(S, P), N); dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
        let z0, len;
        if (cut) {
          let dd = depth;
          if (m.through) { const t = mesh ? rayMeshDepth(mesh, P.map((x, i) => x - N[i] * 0.02), N.map((x) => -x)) : Infinity; dd = (isFinite(t) ? t : diag) + 0.5 - dmin; }
          z0 = -dd; len = dd + dmax + e + 0.3;
        } else { z0 = dmin - e; len = depth - z0; }
        const P3 = ([x, y]) => { const dx = (x - c.c[0]) * k, dy = y - c.c[1]; return [0, 1, 2].map((i) => P[i] + Tu[i] * dx + Tv[i] * dy + N[i] * z0); };
        let f;
        if (!pts) { const w = R.assembleWire([R.makeCircle(c.r, P.map((x, i) => x + N[i] * z0), N)]); f = R.makeFace(w); w.delete(); }
        else f = R.makePolygon(pts.map(P3));
        prisms.push(R.basicFaceExtrusion(f, new R.Vector(N.map((x) => x * len))));
        f.delete();
      }
    } catch (err) { prisms.forEach((q) => q.delete()); throw new Error("Pattern: couldn't make the shapes (" + (err.message || err) + ")"); }
    onFaces.forEach((f) => f.delete());
    if (!prisms.length) throw new Error("Pattern: no shapes fit on this face. Make the pattern smaller or the border thinner.");
    return R.makeCompound(prisms);
  } finally { bp.delete(); gpt.delete(); gvec.delete(); face.delete(); }
}
function facePatTool(shape, m) {
  if (m.curved) return facePatCurved(shape, m);
  const face = facePatFace(shape, m);
  if (!face) throw new Error("Pattern: the flat face it was on is gone. Edit the pattern and click a face again.");
  try {
    const n = Vec.norm(m.n);
    let X = Vec.norm(Vec.sub(m.x || perpTo(n, null), n.map((v) => v * Vec.dot(m.x || [1, 0, 0], n))));
    if (Math.hypot(...X) < 1e-6) X = perpTo(n, null);
    const ang = ((+m.angle || 0) * Math.PI) / 180;
    if (ang) { const Y0 = Vec.cross(n, X); X = Vec.norm([0, 1, 2].map((i) => X[i] * Math.cos(ang) + Y0[i] * Math.sin(ang))); }
    const Y = Vec.cross(n, X);
    // on the face's own plane (wherever the face is now); the pattern centers on the face
    const O0 = face.center.toTuple();
    let segs = faceSegments2D(face, O0, X, Y);
    if (!segs.length) throw new Error("Pattern: couldn't read this face's outline");
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const s of segs) { bx0 = Math.min(bx0, s[0], s[2]); bx1 = Math.max(bx1, s[0], s[2]); by0 = Math.min(by0, s[1], s[3]); by1 = Math.max(by1, s[1], s[3]); }
    // center the pattern on the face (plus the offsets), so it stays in the middle when the face grows
    const cx = (bx0 + bx1) / 2 + (+m.ox || 0), cy = (by0 + by1) / 2 + (+m.oy || 0);
    const O = [0, 1, 2].map((i) => O0[i] + X[i] * cx + Y[i] * cy);
    segs = segs.map((s) => [s[0] - cx, s[1] - cy, s[2] - cx, s[3] - cy]);
    const box = [bx0 - cx, by0 - cy, bx1 - cx, by1 - cy];
    let cells = facePatCells(m, box);
    const clip = m.edge === "clip" || m.kind === "slots";
    // a lattice trims its cells at a frame: the face's outline moved in by the border
    const frame = clip && m.through ? Math.max(0, +m.border || 0) : 0;
    const border = clip ? 0 : Math.max(0, +m.border || 0);
    const bpts = []; for (const s of segs) bpts.push([s[0], s[1]]);
    cells = cells.filter((c) => {
      if (clip) return c.strip || insideSegs(c.c[0], c.c[1], segs) || c.pts.some(([x, y]) => insideSegs(x, y, segs)) || bpts.some(([x, y]) => inPoly(x, y, c.pts));
      for (const [x, y] of c.pts) { if (!insideSegs(x, y, segs)) return false; if (border > 0) for (const s of segs) if (segDist(x, y, s) < border) return false; }
      for (const [x, y] of bpts) if (inPoly(x, y, c.pts)) return false; // a hole or corner inside the shape
      return true;
    });
    if (frame > 0) cells = cells.filter((c) => c.strip || c.pts.some(([x, y]) => insideSegs(x, y, segs) && !segs.some((s) => segDist(x, y, s) < frame)) || (insideSegs(c.c[0], c.c[1], segs) && !segs.some((s) => segDist(c.c[0], c.c[1], s) < frame)));
    if (!cells.length) throw new Error("Pattern: no shapes fit on this face. Make the pattern smaller or the border thinner.");
    if (cells.length > 2500) throw new Error(`Pattern: that would be ${cells.length} shapes. Make the pattern size bigger (or pick a smaller face).`);
    let depth = clampPos(+m.depth || 1, 0.05);
    const cut = m.mode === "cut" || !!m.through;
    if (m.through) {
      // right through the body: as deep as the body is along the face's normal
      const [lo, hi] = shape.boundingBox.bounds;
      let ext = 0;
      for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) ext = Math.max(ext, Vec.dot(Vec.sub([x, y, z], O0), n.map((v) => -v)));
      depth = ext + 1;
    }
    const e = 0.02;
    // raised: from just under the face up by the depth; cut: from the depth below up past the face
    const z0 = cut ? -depth : -e, len = cut ? depth + 0.4 : depth + e;
    const P3 = (x, y) => [0, 1, 2].map((i) => O[i] + X[i] * x + Y[i] * y + n[i] * z0);
    const vec = new R.Vector(n.map((v) => v * len));
    const prisms = [];
    try {
      for (const c of cells) {
        let f;
        if (c.r) { const w = R.assembleWire([R.makeCircle(c.r, P3(c.c[0], c.c[1]), n)]); f = R.makeFace(w); w.delete(); }
        else f = R.makePolygon(c.pts.map(([x, y]) => P3(x, y)));
        prisms.push(R.basicFaceExtrusion(f, vec));
        f.delete();
      }
    } catch (err) { prisms.forEach((p) => p.delete()); throw new Error("Pattern: couldn't make the shapes (" + (err.message || err) + ")"); }
    const comp = R.makeCompound(prisms);
    // the slab over the whole face: to trim shapes at the edge, or to raise / cut the lines between
    const slab = () => { const base = face.clone().translate(n.map((v) => v * z0)); const s = R.basicFaceExtrusion(base, vec); base.delete(); return s; };
    if (m.lines) {
      const sl = slab();
      const t = cutAll(sl, [comp]);
      sl.delete(); comp.delete();
      if (!t) throw new Error("Pattern: couldn't make the lines between the shapes");
      return t;
    }
    if (!clip) return comp;
    let sl = null;
    if (frame > 0) {
      const inner = insetFace(face, frame);
      if (!inner) { comp.delete(); throw new Error("Lattice: the frame is too wide for this face. Make the frame thinner."); }
      const base = inner.translate(n.map((v) => v * z0));
      sl = R.basicFaceExtrusion(base, vec); base.delete();
    } else sl = slab();
    const t = commonAll(comp, sl);
    sl.delete(); comp.delete();
    if (!t) throw new Error("Pattern: couldn't trim the shapes at the face's edge");
    return t;
  } finally { face.delete(); }
}
// a flat face with its outline (and holes) moved in by d: the inside of a lattice's frame
function insetFace(face, d) {
  let a0 = 0;
  try { a0 = R.measureArea(face); } catch (e) { return null; }
  for (const sgn of [-1, 1]) {
    let mk = null;
    const made = [];
    try {
      mk = new OC.BRepOffsetAPI_MakeOffset(face.wrapped, OC.GeomAbs_JoinType.GeomAbs_Arc, false);
      mk.Perform(sgn * d, 0);
      if (!mk.IsDone()) continue;
      const sh = R.cast(mk.Shape());
      const wires = sh instanceof R.Wire ? [sh] : [...(sh.wires || [])];
      // the outer wire is the one whose face is biggest; the others are the holes
      for (const w of wires) { try { const f = R.makeFace(w); made.push({ w, a: R.measureArea(f) }); f.delete(); } catch (e) {} }
      if (!made.length) continue;
      made.sort((p, q) => q.a - p.a);
      if (!(made[0].a < a0 - 1e-6)) continue;
      return R.makeFace(made[0].w, made.slice(1).map((x) => x.w));
    } catch (e) { continue; } finally { if (mk) mk.delete(); }
  }
  return null;
}
function commonAll(a, b) {
  const op = new OC.BRepAlgoAPI_Common();
  const L1 = new OC.NCollection_List_TopoDS_Shape(); L1.Append(a.wrapped);
  const L2 = new OC.NCollection_List_TopoDS_Shape(); L2.Append(b.wrapped);
  try {
    op.SetArguments(L1); op.SetTools(L2); op.Build();
    if (op.HasErrors()) return null;
    const sh = op.Shape(); if (sh.IsNull()) return null;
    return R.cast(sh);
  } catch (e) { return null; } finally { op.delete(); L1.delete(); L2.delete(); }
}
function fuseAllTools(shape, tools) {
  const op = new OC.BRepAlgoAPI_Fuse();
  const L1 = new OC.NCollection_List_TopoDS_Shape(); L1.Append(shape.wrapped);
  const L2 = new OC.NCollection_List_TopoDS_Shape(); for (const t of tools) L2.Append(t.wrapped);
  try {
    op.SetArguments(L1); op.SetTools(L2); op.Build();
    if (op.HasErrors()) return null;
    const sh = op.Shape(); if (sh.IsNull()) return null;
    return R.cast(sh);
  } catch (e) { return null; } finally { op.delete(); L1.delete(); L2.delete(); }
}

function centered(d) { const b = d.boundingBox.center; return d.translate(-b[0], -b[1]); }

// a helix on a cone (taper angle in degrees; 0 = plain cylinder), one edge per turn
function helixWireTaper(pitch, height, radius, center, dir, left, angleDeg) {
  if (!angleDeg || Math.abs(angleDeg) < 1e-6) return helixWire(pitch, height, radius, center, dir, left);
  const a = (angleDeg * Math.PI) / 180;
  const surf = new OC.Geom_ConicalSurface(R.makeAx3(center, dir), a, radius);
  const k = 1 / Math.cos(a);
  const mw = new OC.BRepBuilderAPI_MakeWire();
  const n = Math.max(1, Math.ceil(height / pitch - 1e-9));
  const sgn = left ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const h0 = i * pitch, h1 = Math.min(height, (i + 1) * pitch);
    const A = new OC.gp_Pnt2d((sgn * 2 * Math.PI * h0) / pitch, h0 * k), B = new OC.gp_Pnt2d((sgn * 2 * Math.PI * h1) / pitch, h1 * k);
    const seg = new OC.GC_MakeSegment2d(A, B);
    const me = new OC.BRepBuilderAPI_MakeEdge(seg.Value(), surf);
    const e = me.Edge();
    OC.BRepLib.BuildCurves3d(e, 1e-6, OC.GeomAbs_Shape.GeomAbs_C1, 14, 40);
    mw.Add(e);
    me.delete(); seg.delete(); A.delete(); B.delete();
  }
  const w = new R.Wire(mw.Wire());
  mw.delete();
  return w;
}
// cross-section drawings for pipes and coils, centred on the origin; x points "outward"
function sectionDrawing(kind, size) {
  const s = size;
  if (kind === "square") return polyDrawing([[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2], [-s / 2, s / 2]]);
  if (kind === "triangle" || kind === "triangle-in") {
    const h = (s * Math.sqrt(3)) / 2, f = kind === "triangle-in" ? -1 : 1;
    return polyDrawing([[f * (2 * h) / 3, 0], [-f * h / 3, s / 2], [-f * h / 3, -s / 2]].map(([x, y]) => [x, f * y]));
  }
  return R.drawCircle(s / 2);
}
const Vec = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); },
};
// a direction square to t, preferring one in the path's own plane
function perpTo(t, hint) {
  let x = hint ? Vec.sub(hint, t.map((v) => v * Vec.dot(hint, t))) : null;
  if (!x || Math.hypot(...x) < 1e-6) { const up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]; x = Vec.cross(up, t); }
  return Vec.norm(x);
}
// Pipe: a round, square or triangular section (optionally hollow) along a path
// one smooth cubic B-spline through many points (3D Sketch lines): far quicker and steadier for
// a tube to follow than a chain of short Bezier pieces
function bsplineThrough(pts) {
  const tol = Math.max(0.01, (node_tol_hint || 0.05));
  return R.makeBSplineApproximation(pts, { tolerance: tol, degMin: 3, degMax: 3 });
}
let node_tol_hint = 0.05;
// a 3D Sketch line (one smooth curve through many points): when the engine can't sweep it as it
// is (a bend tighter than the tube, a wobble), try again on a smoothed copy, and if that fails
// too, build the tube from triangles, which always works
function buildPipe(node) {
  // Distance (a fraction of the path) and which end it starts from, like Fusion 360's pipe
  if (node.flip || (node.dist != null && node.dist < 1)) {
    let sg = node.pathSegs || [];
    if (node.flip) sg = swReverse(sg);
    if (node.dist != null && node.dist < 1 && sg.length) sg = swTrim(sg, Math.max(1e-3, node.dist));
    node = { ...node, pathSegs: sg, flip: false, dist: 1 };
  }
  const segs = node.pathSegs || [];
  if (segs.length === 1 && segs[0].t === "bsp" && !node.hollow && !node._try) {
    const size = clampPos(node.size ?? 5), P0 = segs[0].pts;
    // a bend much tighter than the tube can't sweep (and finding that out is slow): smooth first
    // the engine's sweep can come out wrong without failing on a long hand-drawn line (flattened
    // into a twisting band, or with fins and lumps where the line wiggles), so each try is checked
    // against the line itself, and a tube built straight from the line is used when it's off
    const good = (shape, P) => { if (tubeFits(shape, P, size / 2)) return shape; shape.delete(); return null; };
    if (minBend(P0) > size * 0.55) { try { const s1 = good(buildPipeShell(node), P0); if (s1) return s1; } catch (e1) {} }
    const P = relaxPath(P0, size);
    try { const s2 = good(buildPipeShell({ ...node, _tol: Math.max(0.05, size * 0.1), pathSegs: [{ t: "bsp", a: P[0], b: P[P.length - 1], pts: P }] }), P); if (s2) return s2; } catch (e2) {}
    return solidFromMesh(...tubeMesh(P, size / 2));
  }
  return buildPipeShell(node);
}
// is this solid really a round tube of radius r along the points P? Every point of its surface
// must lie about r from the line, and its volume must be about that of the tube.
function tubeFits(shape, P, r) {
  let L = 0;
  for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]);
  const vol = safeVolume(shape), want = Math.PI * r * r * L;
  if (!(vol > want * 0.85 && vol < want * 1.15)) return false;
  let V;
  try { V = shape.mesh({ tolerance: Math.max(0.02, r * 0.08), angularTolerance: 0.35 }).vertices; } catch (e) { return false; }
  // the line's segments in a grid of cells, so each surface point checks only the nearby ones
  const cell = Math.max(r * 4, L / 60), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map();
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], lo = [0, 1, 2].map((k) => Math.floor((Math.min(a[k], b[k]) - 2 * r) / cell)), hi = [0, 1, 2].map((k) => Math.floor((Math.max(a[k], b[k]) + 2 * r) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const kk = `${x},${y},${z}`; if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(i); }
  }
  const lim = r * 1.2 + 0.05;
  for (let v = 0; v < V.length; v += 3) {
    const x = V[v], y = V[v + 1], z = V[v + 2], segs = grid.get(key(x, y, z));
    if (!segs) return false;
    let best = Infinity;
    for (const i of segs) {
      const a = P[i - 1], b = P[i], ab0 = b[0] - a[0], ab1 = b[1] - a[1], ab2 = b[2] - a[2], L2 = ab0 * ab0 + ab1 * ab1 + ab2 * ab2 || 1;
      let t = ((x - a[0]) * ab0 + (y - a[1]) * ab1 + (z - a[2]) * ab2) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(a[0] + ab0 * t - x, a[1] + ab1 * t - y, a[2] + ab2 * t - z);
      if (d < best) { best = d; if (best <= lim) break; }
    }
    if (best > lim) return false;
  }
  return true;
}
function minBend(pts) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let m = Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1], ab = d(a, b), bc = d(b, c), ca = d(c, a), s2 = (ab + bc + ca) / 2;
    const A = Math.sqrt(Math.max(0, s2 * (s2 - ab) * (s2 - bc) * (s2 - ca)));
    if (A > 1e-12) m = Math.min(m, (ab * bc * ca) / (4 * A));
  }
  return m;
}
function relaxPath(pts, size) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let L = 0; for (let i = 1; i < pts.length; i++) L += d(pts[i - 1], pts[i]);
  const closed = pts.length > 3 && d(pts[0], pts[pts.length - 1]) < 1e-3;
  // even spacing
  const step = Math.max(size * 0.8, L / 150), out = [pts[0].slice()];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1], seg = d(a, pts[i]);
    while (acc + seg >= step) { const t = (step - acc) / seg; const q = a.map((v, k) => v + (pts[i][k] - v) * t); out.push(q); a = q; seg = d(a, pts[i]); acc = 0; }
    acc += seg;
  }
  if (closed) out[out.length - 1] = out[0].slice(); else if (d(out[out.length - 1], pts[pts.length - 1]) > step * 0.3) out.push(pts[pts.length - 1].slice()); else out[out.length - 1] = pts[pts.length - 1].slice();
  // smooth until no bend is tighter than the tube (or it stops helping)
  const rad = (a, b, c) => { const ab = d(a, b), bc = d(b, c), ca = d(c, a); const s2 = (ab + bc + ca) / 2, A = Math.sqrt(Math.max(0, s2 * (s2 - ab) * (s2 - bc) * (s2 - ca))); return A < 1e-12 ? Infinity : (ab * bc * ca) / (4 * A); };
  let p = out;
  const n = p.length, m = closed ? n - 1 : n; // m distinct points (a closed path repeats its first)
  // only around the tight bends, so the rest of the line stays exactly where it was drawn
  const lo = closed ? 0 : 1, hi = closed ? m : m - 1, reach = 3;
  for (let it = 0; it < 80 && m > 2; it++) {
    const near = new Uint8Array(m);
    let tight = false;
    for (let i = lo; i < hi; i++) {
      if (rad(p[(i - 1 + m) % m], p[i], p[(i + 1) % m]) < size * 0.75) {
        tight = true;
        for (let j = -reach; j <= reach; j++) { const k = closed ? (i + j + m) % m : i + j; if (k >= lo && k < hi) near[k] = 1; }
      }
    }
    if (!tight) break;
    const q = p.map((v) => v.slice());
    for (let i = lo; i < hi; i++) {
      if (!near[i]) continue;
      const ia = p[(i - 1 + m) % m], b = p[i], ic = p[(i + 1) % m];
      for (let k = 0; k < 3; k++) q[i][k] = b[k] * 0.5 + (ia[k] + ic[k]) * 0.25;
    }
    if (closed) q[n - 1] = q[0].slice();
    p = q;
  }
  return p;
}
// a round tube along points as triangles: rings turned with the path (no twisting), flat ends,
// or joined up when the path closes
function tubeMesh(P, r, sides = 20) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const closed = P.length > 3 && d(P[0], P[P.length - 1]) < 1e-3;
  const pts = closed ? P.slice(0, -1) : P, n = pts.length;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], nrm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const T = pts.map((_, i) => nrm(closed ? sub(pts[(i + 1) % n], pts[(i - 1 + n) % n]) : sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  let ref = Math.abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let N = nrm(crs(crs(T[0], ref), T[0]));
  const Ns = [N];
  for (let i = 1; i < n; i++) { const t = T[i]; N = nrm(sub(N, t.map((v) => v * dot(N, t)))); Ns.push(N); }
  // a closed loop: spread the leftover twist along it so the last ring meets the first
  let twist = 0;
  if (closed) {
    const t0 = T[0], Nl = nrm(sub(Ns[n - 1], t0.map((v) => v * dot(Ns[n - 1], t0)))), B0 = crs(t0, Ns[0]);
    twist = Math.atan2(dot(Nl, B0), dot(Nl, Ns[0]));
  }
  const V = [], I = [];
  for (let i = 0; i < n; i++) {
    const t = T[i], b = crs(t, Ns[i]), off = closed ? (-twist * i) / n : 0;
    for (let j = 0; j < sides; j++) {
      const a = off + (2 * Math.PI * j) / sides, c = Math.cos(a), s = Math.sin(a);
      for (let k = 0; k < 3; k++) V.push(pts[i][k] + r * (Ns[i][k] * c + b[k] * s));
    }
  }
  const rings = closed ? n : n - 1;
  for (let i = 0; i < rings; i++) {
    const A0 = i * sides, B0 = ((i + 1) % n) * sides;
    for (let j = 0; j < sides; j++) { const j1 = (j + 1) % sides; I.push(A0 + j, B0 + j, A0 + j1, A0 + j1, B0 + j, B0 + j1); }
  }
  if (!closed) {
    const c0 = V.length / 3; V.push(...pts[0]); const c1 = c0 + 1; V.push(...pts[n - 1]);
    const L = (n - 1) * sides;
    for (let j = 0; j < sides; j++) { const j1 = (j + 1) % sides; I.push(c0, j1, j); I.push(c1, L + j, L + j1); }
  }
  return [new Float32Array(V), new Uint32Array(I)];
}
function buildPipeShell(node) {
  const segs = node.pathSegs || [];
  if (!segs.length) throw new Error("Pick a path: sketch curves or body edges");
  const size = clampPos(node.size ?? 5);
  const s0 = segs[0];
  let sp, t, hint = null;
  if (s0.t === "line") { sp = s0.a; t = Vec.norm(Vec.sub(s0.b, s0.a)); }
  else if (s0.t === "arc") {
    const n = Vec.norm(Vec.cross(Vec.sub(s0.m, s0.a), Vec.sub(s0.b, s0.a)));
    const c = circumcenter(s0.a, s0.m, s0.b);
    sp = s0.a; t = Vec.norm(Vec.cross(n, Vec.sub(s0.a, c)));
    if (Vec.dot(t, Vec.sub(s0.m, s0.a)) < 0) t = t.map((v) => -v);
    hint = Vec.sub(s0.a, c);
  } else if (s0.t === "bez") { const b = s0.spans[0]; sp = b[0]; t = Vec.norm(Vec.sub(b[1], b[0])); }
  else if (s0.t === "bsp") {
    node_tol_hint = node._tol || Math.max(0.02, (node.size || 3) * 0.02);
    // start on the fitted curve itself, along its own direction
    const e = bsplineThrough(s0.pts); sp = e.startPoint.toTuple(); const tv = e.tangentAt(0); t = Vec.norm(tv.toTuple()); tv.delete(); e.delete();
  }
  else {
    // a full circle: start where its edge starts
    const e = R.makeCircle(s0.r, s0.c, s0.n);
    sp = e.startPoint.toTuple(); const tv = e.tangentAt(0); t = Vec.norm(tv.toTuple()); tv.delete(); e.delete();
    hint = Vec.sub(sp, s0.c);
  }
  if (!hint && segs.length > 1) {
    // bend direction of the path keeps a square section square to the bend
    const s1 = segs[1]; const q = s1.t === "circle" ? s1.c : s1.b || s1.a; const w = Vec.sub(q, sp);
    const nn = Vec.cross(t, w); if (Math.hypot(...nn) > 1e-6) hint = Vec.cross(nn, t);
  }
  const x = perpTo(t, hint);
  const plane = new R.Plane(sp, x, t);
  const spine = sweepPath(segs);
  const solidOf = (sz) => { const sk = sectionDrawing(node.section || "circle", sz).sketchOnPlane(plane); try { return pipe(sk.wire, spine, "perp"); } finally { sk.delete(); } };
  try {
    let out = solidOf(size);
    if (node.hollow) {
      const inner = size - 2 * clampPos(node.wall ?? 1);
      if (inner <= 0.01) throw new Error("The wall is too thick for this pipe size");
      const h = solidOf(inner); const c = out.cut(h); out.delete(); h.delete(); out = c;
    }
    return out;
  } finally { spine.delete(); }
}
function circumcenter(a, m, b) {
  const ab = Vec.sub(b, a), am = Vec.sub(m, a), n = Vec.cross(ab, am), n2 = Vec.dot(n, n);
  const t1 = Vec.cross(n, ab).map((v) => v * Vec.dot(am, am)), t2 = Vec.cross(am, n).map((v) => v * Vec.dot(ab, ab));
  return [0, 1, 2].map((i) => a[i] + (t1[i] + t2[i]) / (2 * n2));
}
// Coil: a helical body standing on Z = 0 around the Z axis
function buildCoil(node) {
  const d = clampPos(node.d ?? 20), size = clampPos(node.size ?? 2);
  const turns = Math.max(0.25, node.turns ?? 5);
  // in height mode the whole coil, section included, is exactly h tall
  const pitch = node.mode === "pitch" ? clampPos(node.pitch ?? 4) : Math.max(0.01, clampPos(node.h ?? 20) - size) / turns;
  const height = pitch * turns;
  const sec = node.section || "circle";
  if (pitch < size * 1.01) throw new Error("The coils overlap: increase the pitch or height, or use a smaller section");
  const r = d / 2 + (node.pos === "inside" ? -size / 2 : node.pos === "outside" ? size / 2 : 0);
  const ang = node.angle || 0;
  const rEnd = r + height * Math.tan((ang * Math.PI) / 180);
  if (r - size / 2 <= 0.01 || rEnd - size / 2 <= 0.01) throw new Error("The coil gets too narrow: use a bigger diameter, a smaller section or less taper");
  const helix = helixWireTaper(pitch, height, r, [0, 0, size / 2], [0, 0, 1], !!node.left, ang);
  const e0 = helix.edges[0];
  const sp = e0.startPoint.toTuple(), tv = e0.tangentAt(0), t = Vec.norm(tv.toTuple());
  tv.delete(); e0.delete();
  const rad = Vec.norm([sp[0], sp[1], 0]);
  const x = perpTo(t, rad);
  const sk = sectionDrawing(sec, size).sketchOnPlane(new R.Plane(sp, x, t));
  const prof = sk.wire.clone();
  sk.delete();
  try { return R.genericSweep(prof, helix, { frenet: true }, false); }
  catch (e) { throw new Error("The coil couldn't be built with these sizes"); }
  finally { prof.delete(); helix.delete(); }
}
// The helical groove of a modeled ISO-style 60° thread: a 60° V profile swept along
// a helix on the cylinder, starting past the free end of the face.
function threadGroove(shape, mod) {
  const ci = cylinderInfo(shape, mod.face || {});
  const p = mod.pitch;
  if (!(p > 0.05)) throw new Error("Thread pitch must be at least 0.05 mm");
  const { o, d, x, r, t0, t1, external } = ci;
  const full = t1 - t0;
  if (p > r * 1.2) throw new Error(`Thread pitch is too large for this ${external ? "cylinder" : "hole"}`);
  const at = (t, rad) => [0, 1, 2].map((i) => o[i] + d[i] * t + x[i] * rad);
  // an end is free when there is no material just past it at thread depth
  const probeR = external ? r - 0.25 * p : r + 0.25 * p;
  const eps = Math.max(0.05, 0.05 * p);
  const free0 = !insideAt(shape, at(t0 - eps, probeR));
  const free1 = !insideAt(shape, at(t1 + eps, probeR));
  let fromStart = !(free1 && !free0); // start at the free end
  if (mod.flip) fromStart = !fromStart;
  const startFree = fromStart ? free0 : free1, farFree = fromStart ? free1 : free0;
  const L = mod.length > 0 ? Math.min(mod.length, full) : full;
  const tS = fromStart ? t0 : t1;
  const u = fromStart ? d : d.map((v) => -v);
  const a = startFree ? -p : 0.45 * p;
  const b = L >= full - 1e-6 && farFree ? L + p : L - 0.45 * p;
  if (b - a < 0.6 * p) throw new Error("Thread is too short for this pitch");
  if ((b - a) / p > 400) throw new Error("That thread has too many turns to model. Use a larger pitch or a shorter length.");
  const S = [0, 1, 2].map((i) => o[i] + d[i] * tS + u[i] * a);
  // print offset (clearance): every thread face moves c into the material. For the 60° V that
  // takes the groove 2c deeper (same flank angle) and the crest c lower.
  const c = Math.min(Math.abs(mod.clear || 0), 0.3 * p);
  const depth = (external ? 0.6134 : 0.5413) * p + 2 * c, over = 0.12 * p;
  const sgn = external ? 1 : -1;
  const tan30 = Math.tan(Math.PI / 6);
  const outR = r - sgn * c + sgn * over; // just past the (relieved) crest
  const w = (depth - c + over) * tan30;
  let pts = [[r - sgn * depth, 0], [outR, w], [outR, -w]];
  // a big offset on a fine pitch would make neighbouring turns of the groove overlap:
  // keep the groove a little narrower than the pitch (the tooth comes to a point)
  const wMax = 0.49 * p;
  if (w > wMax) {
    const rk = r - sgn * depth + (sgn * wMax) / tan30;
    pts = [[r - sgn * depth, 0], [rk, wMax], [outR, wMax], [outR, -wMax], [rk, -wMax]];
  }
  const helix = helixWire(p, b - a, r, S, u, !!mod.left);
  const sp = helix.startPoint.toTuple();
  let rad = [sp[0] - S[0], sp[1] - S[1], sp[2] - S[2]];
  const along = rad[0] * u[0] + rad[1] * u[1] + rad[2] * u[2];
  rad = rad.map((v, i) => v - along * u[i]);
  const rl = Math.hypot(...rad) || 1; rad = rad.map((v) => v / rl);
  const nrm = [rad[1] * u[2] - rad[2] * u[1], rad[2] * u[0] - rad[0] * u[2], rad[0] * u[1] - rad[1] * u[0]];
  const sk = polyDrawing(pts).sketchOnPlane(new R.Plane(S, rad, nrm));
  const wire = sk.wire.clone();
  sk.delete();
  let groove;
  try { groove = R.genericSweep(wire, helix, { frenet: true }, false); }
  catch (e) { throw new Error("Thread couldn't be swept on this face"); }
  finally { wire.delete(); helix.delete(); }
  // the run-out past the ends, trimmed to the cylinder's length (used if a cut with
  // the groove poking out of the body fails)
  const clipped = () => {
    const base = [0, 1, 2].map((i) => o[i] + d[i] * t0);
    const clip = R.makeCylinder(r + 3 * p, full, base, d);
    const c = groove.intersect(clip);
    clip.delete();
    return c;
  };
  // crest relief for the print offset: a thin ring over the threaded part of the face
  let crest = null;
  if (c > 1e-6) {
    const lo = fromStart ? t0 + Math.max(0, a) : t1 - Math.min(full, b);
    const hi = fromStart ? t0 + Math.min(full, b) : t1 - Math.max(0, a);
    const span = hi - lo;
    if (span > 1e-6) {
      const base = [0, 1, 2].map((i) => o[i] + d[i] * lo);
      if (external) {
        const outer = R.makeCylinder(r + 2 * p, span, base, d), inner = R.makeCylinder(r - c, span, base, d);
        crest = outer.cut(inner); outer.delete(); inner.delete();
      } else crest = R.makeCylinder(r + c, span, base, d);
    }
  }
  return { groove, clipped, crest };
}
// cut many tools in one boolean (no result simplification: it is slow on threads)
function cutAll(shape, tools) {
  const b = new OC.BRepAlgoAPI_Cut();
  const L1 = new OC.NCollection_List_TopoDS_Shape(); L1.Append(shape.wrapped);
  const L2 = new OC.NCollection_List_TopoDS_Shape(); for (const t of tools) L2.Append(t.wrapped);
  try {
    b.SetArguments(L1); b.SetTools(L2);
    b.Build();
    if (b.HasErrors()) return null;
    const sh = b.Shape();
    if (sh.IsNull()) return null;
    return R.cast(sh);
  } catch (e) { return null; } finally { b.delete(); L1.delete(); L2.delete(); }
}

// ---------------------------------------------------------------- scaling
// Scale x' = k*x + o (per axis) in the body's own frame. Uniform scaling is exact
// for any body; uneven stretching is rebuilt from the source where possible
// (see scaleNode), otherwise the body is rebuilt from a fine mesh.
function isUniform(k) { return Math.abs(k[0] - k[1]) < 1e-9 && Math.abs(k[0] - k[2]) < 1e-9; }
function scaleShape(shape, k, o) {
  if (isUniform(k)) {
    const trsf = new OC.gp_Trsf();
    trsf.SetValues(k[0], 0, 0, o[0], 0, k[0], 0, o[1], 0, 0, k[0], o[2]);
    const op = new OC.BRepBuilderAPI_Transform(shape.wrapped, trsf, true, false);
    const out = R.cast(op.Shape());
    op.delete(); trsf.delete(); shape.delete();
    return out;
  }
  return facetedScale(shape, k, o);
}
function facetedScale(shape, k, o) {
  const bb = bboxOf(shape);
  const diag = Math.hypot(...bb.size) || 1;
  const m = shape.mesh({ tolerance: Math.max(0.01, diag * 0.0008), angularTolerance: 0.12 });
  try { repairFaceMeshes(shape, m, Math.max(0.01, diag * 0.0008), 0.12); } catch (err) {}
  shape.delete();
  const V = (i) => [m.vertices[3 * i] * k[0] + o[0], m.vertices[3 * i + 1] * k[1] + o[1], m.vertices[3 * i + 2] * k[2] + o[2]];
  if (m.triangles.length / 3 > 4000) throw new Error("This body can't be stretched unevenly. Scale it evenly instead (hold Shift while dragging a corner handle).");
  const faces = [];
  for (let t = 0; t < m.triangles.length; t += 3) {
    const a = V(m.triangles[t]), b = V(m.triangles[t + 1]), c = V(m.triangles[t + 2]);
    const cr = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    if (Math.hypot(...cr) < 1e-10) continue;
    faces.push(R.makePolygon([a, b, c]));
  }
  if (faces.length > 4000) throw new Error("This body can't be stretched unevenly. Scale it evenly instead (hold Shift while dragging a corner handle).");
  let solid = R.makeSolid(faces);
  try {
    const u = new OC.ShapeUpgrade_UnifySameDomain(solid.wrapped, true, true, false);
    u.Build();
    const s2 = R.cast(u.Shape());
    u.delete(); solid.delete(); solid = s2;
  } catch (e) {}
  return solid;
}
// Rebuild a node so its geometry is stretched exactly, or return null when that
// isn't possible (then the mesh fallback is used).
const axisPerm = (v) => { // index and sign of a unit axis vector, or null
  const i = [0, 1, 2].find((j) => Math.abs(Math.abs(v[j]) - 1) < 1e-9);
  return i === undefined ? null : { i, s: Math.sign(v[i]) };
};
// Features are replayed on the stretched body with their reference points moved;
// holes, fillets, shells and threads keep their sizes (like editing the sketch).
function scaleMod(m, k, o) {
  const P = (p) => p && p.map((v, i) => v * k[i] + o[i]);
  const N = (n) => { if (!n) return n; const v = n.map((x, i) => x / k[i]); const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const uni = isUniform(k);
  switch (m.t) {
    case "fillet": case "chamfer": {
      const E = (list) => (list || []).map((e) => ({ ...e, a: P(e.a), b: P(e.b), m: P(e.m), t: e.t === "LINE" || uni ? e.t : undefined }));
      return { ...m, edges: E(m.edges), sets: m.sets && m.sets.map((x) => ({ ...x, edges: E(x.edges) })) };
    }
    case "hole":
      return { ...m, p: P(m.p), n: N(m.n), at: m.at && m.at.map((s) => ({ p: P(s.p), n: N(s.n) })) };
    case "offset": case "shell":
      return { ...m, faces: (m.faces || []).map((f) => ({ ...f, c: P(f.c), n: N(f.n) })) };
    case "thread":
      return { ...m, face: { ...m.face, c: P(m.face.c) } };
    case "facepat":
      return { ...m, p: P(m.p), n: N(m.n) };
    case "route":
      return { ...m, strokes: (m.strokes || []).map((s) => ({ ...s, p: s.p.map(P), n: s.n.map(N) })) };
    case "bool": {
      const g = scaleNode({ t: "group", children: [{ node: m.tool, m: m.m || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] }, k, o);
      if (!g) return null;
      return { ...m, tool: g.children[0].node, m: g.children[0].m };
    }
    default: return null;
  }
}
function scaleNode(node, k, o) {
  if (node.mods && node.mods.length) {
    const last = node.mods[node.mods.length - 1];
    if (last.t === "scale") {
      // a trailing scale folds in
      const kk = [0, 1, 2].map((i) => last.k[i] * k[i]), oo = [0, 1, 2].map((i) => last.o[i] * k[i] + o[i]);
      return scaleNode({ ...node, mods: node.mods.slice(0, -1) }, kk, oo);
    }
    const base = scaleNode({ ...node, mods: [] }, k, o);
    if (!base) return null;
    const mods = [...(base.mods || [])];
    for (const m of node.mods) {
      const mm = scaleMod(m, k, o);
      if (!mm) return null;
      mods.push(mm);
    }
    return { ...base, mods };
  }
  const T = (n) => ({ t: "group", children: [{ node: n, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, o[0], o[1], o[2], 1] }] });
  if (node.t === "prim") {
    const p = node.p || {};
    if (node.kind === "torus" && Math.abs(k[0] - k[1]) > 1e-9) return null;
    if (node.kind === "text" && Math.abs(k[0] - k[1]) > 1e-9) return null;
    if (node.kind === "spring" && Math.abs(k[0] - k[1]) > 1e-9) return null;
    if (node.kind === "text") return T({ ...node, p: { ...p, size: p.size * k[0], h: (p.h || 5) * k[2] } });
    const np = { ...p, w: p.w * k[0], d: p.d * k[1], h: p.h * k[2] };
    if (node.kind === "torus") np.tube = (p.tube ?? 5) * Math.min(k[0], k[2]);
    if (node.kind === "tube") np.wall = (p.wall ?? 2) * Math.min(k[0], k[1]);
    if (node.kind === "spring") np.wire = (p.wire ?? 2) * k[0];
    return T({ ...node, p: np });
  }
  if (node.t === "extrude" || node.t === "revolve") {
    const pl = node.plane;
    const y = [pl.n[1] * pl.x[2] - pl.n[2] * pl.x[1], pl.n[2] * pl.x[0] - pl.n[0] * pl.x[2], pl.n[0] * pl.x[1] - pl.n[1] * pl.x[0]];
    const ax = axisPerm(pl.x), ay = axisPerm(y), an = axisPerm(pl.n);
    if (!ax || !ay || !an) return null;
    const kx = k[ax.i], ky = k[ay.i], kn = k[an.i];
    const plane = { ...pl, o: [0, 1, 2].map((i) => pl.o[i] * k[i] + o[i]) };
    const out = { ...node, plane, stretch: [kx * ((node.stretch && node.stretch[0]) || 1), ky * ((node.stretch && node.stretch[1]) || 1)] };
    if (node.t === "extrude") {
      out.dist = (node.dist || 0) * kn;
      if (node.dist2 != null) out.dist2 = node.dist2 * kn;
      return out;
    }
    // revolve: only when the stretch keeps circles round around the axis
    let dir;
    if (node.axisWorld) dir = node.axisWorld.d;
    else if (node.axis) {
      const ax2 = [node.axis.b[0] - node.axis.a[0], node.axis.b[1] - node.axis.a[1]];
      dir = [0, 1, 2].map((i) => pl.x[i] * ax2[0] + y[i] * ax2[1]);
    } else return null;
    const ad = axisPerm(dir.map((v) => v / (Math.hypot(...dir) || 1)));
    if (!ad) return null;
    const others = [0, 1, 2].filter((i) => i !== ad.i);
    if (Math.abs(k[others[0]] - k[others[1]]) > 1e-9) return null;
    if (node.axisWorld) out.axisWorld = { o: [0, 1, 2].map((i) => node.axisWorld.o[i] * k[i] + o[i]), d: dir };
    return out;
  }
  if (node.t === "group") {
    const children = [];
    for (const c of node.children) {
      const m = c.m || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      // child frame axes must line up with the parent axes
      const cols = [0, 1, 2].map((j) => axisPerm([m[4 * j], m[4 * j + 1], m[4 * j + 2]]));
      if (cols.some((x) => !x)) return null;
      const kc = cols.map((x) => k[x.i]);
      const inner = scaleNode(c.node, kc, [0, 0, 0]);
      if (!inner) return null;
      const m2 = m.slice();
      for (let i = 0; i < 3; i++) m2[12 + i] = m[12 + i] * k[i] + o[i];
      children.push({ ...c, node: inner, m: m2 });
    }
    return { ...node, children };
  }
  return null;
}

function safeVolume(shape) {
  try { return R.measureVolume(shape); } catch (e) { return NaN; }
}
// Fallback shell: subtract an inward offset of the body, then open the chosen
// faces by pushing the matching inner faces back out through the wall.
// the centre of the round wall a hole at p (going along -n, radius r) left behind
function holeWallCenter(shape, p, n, r) {
  const faces = shape.faces;
  try {
    const nn = Vec.norm(n);
    let best = null, bd = Infinity;
    for (const f of faces) {
      if (f.geomType !== "CYLINDRE") continue;
      const sig = surfaceSig(f);
      if (Math.abs(sig.r - r) > 1e-3 * Math.max(1, r)) continue;
      if (Math.abs(Vec.dot(Vec.norm(sig.d), nn)) < 0.999) continue;
      const v = Vec.sub(p, sig.o), along = Vec.dot(v, Vec.norm(sig.d));
      const off = Math.hypot(...Vec.sub(v, Vec.norm(sig.d).map((q) => q * along)));
      if (off > 1e-3 * Math.max(1, r)) continue;
      const c = f.center.toTuple(), dd = dist(c, p);
      if (dd < bd) { bd = dd; best = c; }
    }
    return best;
  } finally { faces.forEach((f) => f.delete()); }
}
function holeTool(shape, mod) {
  const n = mod.n, p = mod.p;
  const len = Math.hypot(...n) || 1;
  const nn = n.map((v) => v / len);
  const down = nn.map((v) => -v);
  const lift = 0.05;
  const start = p.map((v, i) => v + nn[i] * lift);
  const bb = bboxOf(shape);
  const through = mod.through || !(mod.depth > 0);
  const depth = through ? Math.hypot(...bb.size) * 2 + 1 : mod.depth;
  const r = clampPos(mod.dia / 2);
  let tool = R.makeCylinder(r, depth + lift, start, down);
  // a drilled blind hole ends in a 118° point
  if (!through && mod.tip) {
    const hTip = r / Math.tan((59 * Math.PI) / 180);
    const at = start.map((v, i) => v + down[i] * (depth + lift));
    const cone = R.drawCircle(r).sketchOnPlane(new R.Plane(at, null, down)).loftWith([], { endPoint: at.map((v, i) => v + down[i] * hTip), ruled: true });
    const u = tool.fuse(cone); tool.delete(); cone.delete(); tool = u;
  }
  if (mod.kind === "cbore" && mod.cbDia > mod.dia) {
    const cb = R.makeCylinder(mod.cbDia / 2, clampPos(mod.cbDepth) + lift, start, down);
    const u = tool.fuse(cb); tool.delete(); cb.delete(); tool = u;
  } else if (mod.kind === "csink" && mod.csDia > mod.dia) {
    const ang = ((mod.csAngle || 90) * Math.PI) / 180;
    const hDepth = (mod.csDia / 2 - r) / Math.tan(ang / 2);
    const pl = new R.Plane(start, null, down);
    const top = R.drawCircle(mod.csDia / 2 + lift * Math.tan(ang / 2)).sketchOnPlane(pl);
    const bot = R.drawCircle(r).sketchOnPlane(new R.Plane(start.map((v, i) => v + down[i] * (hDepth + lift)), null, down));
    const cone = top.loftWith(bot, { ruled: true });
    const u = tool.fuse(cone); tool.delete(); cone.delete(); tool = u;
  }
  return tool;
}

// ---------------------------------------------------------------- evaluation
function stableKey(node) {
  return JSON.stringify(node, (k, v) => (k === "name" || k === "color" || k === "id" || k === "hidden" ? undefined : v));
}

// ---------------------------------------------------------------- imported models
// Files a design brings in (STL meshes, STEP models) are sent to the worker once as
// "assets"; nodes refer to them by id, so the big data never travels with every rebuild.
const assets = new Map(); // id -> { kind, bytes: Uint8Array }
export function setAsset(id, kind, bytes) {
  if (kind === "font") {
    // a Text-tool font from the main page
    const name = id.replace(/^font:/, "");
    registerFont(name, bytes);
    fontWait = fontWait.then(() => R.loadFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name, true)).then(() => KNOWN_FONTS.add(name)).catch((e) => console.warn("font", name, e));
    return;
  }
  assets.set(id, { kind, bytes });
}
const KNOWN_FONTS = new Set(["sans", "serif", "mono"]);
let fontWait = Promise.resolve();
export const fontsReady = () => fontWait;
export function hasAsset(id) { return assets.has(id); }
function assetBytes(node) {
  const a = assets.get(node.asset);
  if (!a) throw new Error("This imported model's data is missing. Import the file again.");
  return a.bytes;
}
// STL (indexed: [nv, nt] header, float32 positions, uint32 triangle indices) -> a solid
// made of the triangles (coplanar ones merged), or a surface if the mesh isn't closed
function buildMeshAsset(node) {
  const u8 = assetBytes(node);
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const head = new Uint32Array(buf, 0, 2), nv = head[0], nt = head[1];
  const V = new Float32Array(buf, 8, nv * 3), I = new Uint32Array(buf, 8 + nv * 12, nt * 3);
  return solidFromMesh(V, I, node.k || 1);
}
// a solid from triangles (shared corners, consistent winding)
function solidFromMesh(V, I, k = 1, merge = true, shellOnly = false) {
  const nv = V.length / 3, nt = I.length / 3;
  const T = { t0: Date.now() };
  // Build the faces on shared vertices and edges, so the triangles are already joined
  // (much faster than making loose triangles and sewing them together afterwards).
  const B = new OC.TopoDS_Builder();
  const verts = new Array(nv);
  const vert = (i) => {
    if (!verts[i]) {
      const p = new OC.gp_Pnt(V[i * 3] * k, V[i * 3 + 1] * k, V[i * 3 + 2] * k);
      const mv = new OC.BRepBuilderAPI_MakeVertex(p);
      verts[i] = mv.Vertex(); mv.delete(); p.delete();
    }
    return verts[i];
  };
  const edges = new Map();
  const edge = (i, j) => { // oriented i -> j
    const lo = Math.min(i, j), hi = Math.max(i, j), key = lo * nv + hi;
    let e = edges.get(key);
    if (!e) { const me = new OC.BRepBuilderAPI_MakeEdge(vert(lo), vert(hi)); e = me.Edge(); me.delete(); edges.set(key, e); }
    return i === lo ? e : e.Reversed();
  };
  const shell = new OC.TopoDS_Shell();
  B.MakeShell(shell);
  let nf = 0;
  for (let t = 0; t < nt; t++) {
    const ia = I[t * 3], ib = I[t * 3 + 1], ic = I[t * 3 + 2];
    const ax = V[ia * 3], ay = V[ia * 3 + 1], az = V[ia * 3 + 2];
    const ux = V[ib * 3] - ax, uy = V[ib * 3 + 1] - ay, uz = V[ib * 3 + 2] - az;
    const wx = V[ic * 3] - ax, wy = V[ic * 3 + 1] - ay, wz = V[ic * 3 + 2] - az;
    if (Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) < 1e-12) continue;
    try {
      const w = new OC.TopoDS_Wire();
      B.MakeWire(w);
      B.Add(w, edge(ia, ib)); B.Add(w, edge(ib, ic)); B.Add(w, edge(ic, ia));
      const mf = new OC.BRepBuilderAPI_MakeFace(w, true);
      if (mf.IsDone()) {
        // the face must point the way the triangle winds (outwards)
        let f = mf.Face();
        const fw = R.cast(f), n = fw.normalAt();
        const [nx, ny, nz] = n.toTuple(); n.delete();
        if (nx * (uy * wz - uz * wy) + ny * (uz * wx - ux * wz) + nz * (ux * wy - uy * wx) < 0) f = f.Reversed();
        B.Add(shell, f); nf++;
      }
      mf.delete(); w.delete();
    } catch (e) {}
  }
  if (!nf) throw new Error("This mesh has no usable triangles");
  if (shellOnly) return shell;
  T.faces = Date.now();
  let shape = null;
  try {
    const fix = new OC.ShapeFix_Solid();
    shape = R.cast(fix.SolidFromShell(shell));
    fix.delete();
  } catch (e) { shape = null; }
  if (!shape || !(Math.abs(safeVolume(shape)) > 1e-9)) {
    // not watertight: keep it as a surface (it shows and exports, but can't be cut)
    if (shape) shape.delete();
    shape = R.cast(shell);
  }
  T.solid = Date.now();
  if (safeVolume(shape) < 0) { const r = R.cast(shape.wrapped.Reversed()); shape.delete(); shape = r; }
  // merge the flat triangles of each face so the body has proper faces and edges
  // (skipped for dense, curved meshes where it is slow and merges little)
  // (with a small tolerance: STL corners are rounded to 7 digits, so the triangles of a flat
  // face are flat only to about a millionth of the model's size)
  if (merge && nf <= 20000) {
    const bb = bboxOf(shape), diag = Math.hypot(...bb.size) || 1;
    const u = unifiedTol(shape, Math.max(1e-6, diag * 2e-6), 2e-4);
    if (u) { shape.delete(); shape = u; }
  }
  T.unify = Date.now();
  if (typeof process !== "undefined" && process.env && process.env.MESH_T) console.log("mesh build ms: faces", T.faces - T.t0, "solid", T.solid - T.faces, "unify", T.unify - T.solid);
  return shape;
}
function buildStepAsset(node) {
  const bytes = assetBytes(node);
  const name = "import_" + Math.random().toString(36).slice(2);
  OC.FS.writeFile("/" + name, bytes);
  const reader = new OC.STEPControl_Reader();
  try {
    if (!reader.ReadFile(name)) throw new Error("This STEP file couldn't be read");
    reader.TransferRoots();
    let shape = R.cast(reader.OneShape());
    // one solid when the file has several
    const solids = [];
    const ex = new OC.TopExp_Explorer(shape.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) solids.push(R.cast(OC.TopoDS.Solid(ex.Current())));
    ex.delete();
    if (solids.length === 1) { shape.delete(); shape = solids[0]; }
    else if (solids.length > 1) { let acc = solids[0]; for (const x of solids.slice(1)) { const f = acc.fuse(x); acc.delete(); x.delete(); acc = f; } shape.delete(); shape = acc; }
    if ((node.k || 1) !== 1) shape = scaleShape(shape, [node.k, node.k, node.k], [0, 0, 0]);
    return shape;
  } finally {
    reader.delete();
    try { OC.FS.unlink("/" + name); } catch (e) {}
  }
}
// imported models sit centered on the origin, resting on the workplane
function placeImported(shape, node) {
  if (node.keepPos) return shape;
  const bb = bboxOf(shape);
  const dx = -(bb.min[0] + bb.max[0]) / 2, dy = -(bb.min[1] + bb.max[1]) / 2, dz = -bb.min[2];
  if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-9) return shape;
  const out = shape.translate(dx, dy, dz);
  return out;
}
function evalBase(node) {
  switch (node.t) {
    case "prim": return buildPrim(node.kind, node.p || {});
    case "mesh": return placeImported(buildMeshAsset(node), node);
    case "step": return placeImported(buildStepAsset(node), node);
    case "extrude": return buildExtrude(node);
    case "revolve": return buildRevolve(node);
    case "sweep": return buildSweep(node);
    case "pipe": return buildPipe(node);
    case "coil": return buildCoil(node);
    case "group": return buildGroup(node);
    case "loft": return buildLoft(node);
    case "mirror": return buildMirror(node);
    case "placed": return transformShape(evalNode(node.src), node.srcM); // another body, where it sits
    default: throw new Error("Unknown node type " + node.t);
  }
}

export function evalNode(node) {
  const key = stableKey(node);
  const hit = cacheGet(key);
  if (hit) { const n = cacheNotes.get(key); if (n) n.forEach(note); return hit; }
  const outer = NOTES;
  NOTES = [];
  let shape;
  try {
  const mods = node.mods || [];
  const last = mods[mods.length - 1];
  const exact = last && last.t === "scale" && !isUniform(last.k) ? scaleNode({ ...node, mods: mods.slice(0, -1) }, last.k, last.o) : null;
  if (exact) {
    try { shape = evalNode(exact); }
    catch (e) { shape = scaleShape(evalNode({ ...node, mods: mods.slice(0, -1) }), last.k, last.o); }
  } else if (mods.length) {
    // a run of plain cuts at the end (a pattern of cuts, say) with nothing of it built yet:
    // one boolean with every tool (OpenCascade works out the intersections together), much
    // quicker than one cut after another on a complicated body
    let k = mods.length;
    while (k > 0 && mods[k - 1].t === "bool" && mods[k - 1].op === "cut" && mods[k - 1].tool) k--;
    const run = mods.length - k;
    if (run >= 2 && !cache.has(stableKey({ ...node, mods: mods.slice(0, -1) }))) {
      const before = evalNode({ ...node, mods: mods.slice(0, k) });
      const out = cutMany(before, mods.slice(k));
      if (out) { before.delete(); shape = solidsOnly(out); }
      else shape = runMods(before, mods.slice(k));
    } else {
      // evaluate prefix (node without last mod) so editing the last feature is cheap
      const prefix = { ...node, mods: mods.slice(0, -1) };
      shape = evalNode(prefix);
      shape = solidsOnly(applyMod(shape, mods[mods.length - 1]));
    }
  } else {
    shape = solidsOnly(evalBase(node));
  }
  } finally {
    const mine = NOTES;
    NOTES = outer;
    if (mine.length) { mine.forEach(note); if (shape) cacheNotes.set(key, mine); }
  }
  cachePut(key, shape);
  return shape;
}

// the cuts one after another (when they can't all be done in one go)
function runMods(shape, list) {
  for (const m of list) shape = solidsOnly(applyMod(shape, m));
  return shape;
}
// cut several tools out of a shape in one boolean; null when that doesn't work
function cutMany(shape, list) {
  const tools = [];
  try {
    for (const m of list) tools.push(transformShape(evalNode(m.tool), m.m));
    const v0 = safeVolume(shape);
    const args = new OC.NCollection_List_TopoDS_Shape(), tl = new OC.NCollection_List_TopoDS_Shape();
    args.Append(shape.wrapped);
    for (const t of tools) tl.Append(t.wrapped);
    const op = new OC.BRepAlgoAPI_Cut();
    let out = null;
    try {
      op.SetArguments(args); op.SetTools(tl); op.SetRunParallel(false);
      try { op.SetUseOBB(true); } catch (e) {}
      const pr = new OC.Message_ProgressRange();
      op.Build(pr); pr.delete();
      if (op.IsDone() && !op.HasErrors()) {
        out = R.cast(op.Shape());
        const v = safeVolume(out);
        if (!(v > 1e-9) || !(v <= v0 + 1e-6)) { out.delete(); out = null; }
      }
    } finally { op.delete(); args.delete(); tl.delete(); }
    return out;
  } catch (e) {
    return null;
  } finally {
    for (const t of tools) try { t.delete(); } catch (e) {}
  }
}

function buildGroup(node) {
  const kids = node.children || [];
  if (!kids.length) throw new Error("Empty group");
  const solids = [], holes = [];
  for (const k of kids) {
    const s = transformShape(evalNode(k.node), k.m);
    (k.hole ? holes : solids).push(s);
  }
  let base;
  // many small touching pieces (stained-glass leading): kept as one compound, not fused (fast)
  if (node.op === "compound" && !holes.length) { const c = compoundOf(solids); for (const x of solids) x.delete(); return c; }
  if (node.op === "intersect") {
    if (solids.length < 2) throw new Error("Intersect needs at least two solid bodies");
    base = solids[0];
    for (let i = 1; i < solids.length; i++) { const n = base.intersect(solids[i]); base.delete(); solids[i].delete(); base = n; }
  } else if (solids.length) {
    base = fuseMany(solids);
  } else {
    // a group made only of holes stays a hole
    base = holes.shift();
    for (const h of holes.splice(0)) { const n = base.fuse(h); base.delete(); h.delete(); base = n; }
  }
  for (const h of holes) { const n = base.cut(h); base.delete(); h.delete(); base = n; }
  return base;
}

// the solids of a shape (a compound's pieces, or the shape itself)
function solidsOf(shape) {
  const T = OC.TopAbs_ShapeEnum, out = [];
  const ex = new OC.TopExp_Explorer(shape.wrapped, T.TopAbs_SOLID, T.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) out.push(R.cast(OC.TopoDS.Solid(ex.Current())));
  ex.delete();
  return out.length ? out : [shape.clone()];
}
function compoundOf(shapes) {
  const b = new OC.TopoDS_Builder(), c = new OC.TopoDS_Compound();
  b.MakeCompound(c);
  for (const x of shapes) for (const so of solidsOf(x)) b.Add(c, so.wrapped);
  b.delete();
  return R.cast(c);
}
// Fuse solids into one. One fuse with all of them is much faster and more reliable than adding
// them one at a time (64 overlapping swept ribs: 40 s and right, instead of minutes and empty).
// A result that lost material is refused: then one at a time, each step checked, and a piece
// that won't fuse is kept as its own solid rather than lost.
function fuseMany(solids) {
  if (solids.length === 1) return solids[0];
  const vols = solids.map((x) => Math.abs(safeVolume(x)) || 0);
  const vmax = Math.max(...vols), vsum = vols.reduce((a, b) => a + b, 0);
  const trust = vols.every((v) => v > 1e-9); // (a volume that can't be measured can't be checked)
  const ok = (r, lo, hi) => { if (!r) return false; if (!trust) return true; const v = Math.abs(safeVolume(r)); return v >= lo * 0.999 - 1e-6 && v <= hi * 1.001 + 1e-6; };
  if (solids.length > 2) {
    const r = fuseAllTools(solids[0], solids.slice(1));
    if (ok(r, vmax, vsum)) { for (const x of solids) x.delete(); return r; }
    if (r) r.delete();
  }
  let base = solids[0], vb = vols[0];
  const loose = [];
  for (let i = 1; i < solids.length; i++) {
    let n = null;
    try { n = base.fuse(solids[i]); } catch (e) { n = null; }
    if (ok(n, Math.max(vb, vols[i]), vb + vols[i])) { base.delete(); solids[i].delete(); base = n; vb = Math.abs(safeVolume(n)); }
    else { if (n) n.delete(); loose.push(solids[i]); }
  }
  if (!loose.length) return base;
  const c = compoundOf([base, ...loose]);
  base.delete(); for (const x of loose) x.delete();
  return c;
}

// ---------------------------------------------------------------- meshing
// The mesher sometimes triangulates a round face wrongly (seen on a cylinder band left by an
// offset or a boolean): long triangles cut straight across the part and show up as stray flat
// "planes" that can't be selected away. Each round face's triangles are checked against the true
// surface; a face that fails is repaired (ShapeFix_Face), meshed again on its own and swapped in.
function surfaceDeviation(f) {
  const ad = new OC.BRepAdaptor_Surface(f.wrapped, true);
  try {
    const t = f.geomType;
    const V = (p) => [p.X(), p.Y(), p.Z()];
    if (t === "CYLINDRE") {
      const cy = ad.Cylinder(), pos = cy.Position(), o = V(pos.Location()), a = V(pos.Direction()), r = cy.Radius();
      return { r, dev: (p) => { const v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]], d = v[0] * a[0] + v[1] * a[1] + v[2] * a[2]; return Math.abs(Math.hypot(v[0] - d * a[0], v[1] - d * a[1], v[2] - d * a[2]) - r); } };
    }
    if (t === "SPHERE") {
      const sp = ad.Sphere(), o = V(sp.Position().Location()), r = sp.Radius();
      return { r, dev: (p) => Math.abs(Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]) - r) };
    }
    if (t === "TORUS") {
      const to = ad.Torus(), pos = to.Position(), o = V(pos.Location()), a = V(pos.Direction()), R1 = to.MajorRadius(), r = to.MinorRadius();
      return { r, dev: (p) => { const v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]], d = v[0] * a[0] + v[1] * a[1] + v[2] * a[2]; const q = Math.hypot(v[0] - d * a[0], v[1] - d * a[1], v[2] - d * a[2]); return Math.abs(Math.hypot(q - R1, d) - r); } };
    }
    return null;
  } finally { ad.delete(); }
}
function badFaceTris(T, P, start, count, sd, tol) {
  const lim = Math.max(0.5, 3 * tol, sd.r * 0.05);
  let bad = 0;
  for (let i = start; i < start + count; i += 3) {
    const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
    if (sd.dev([(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3]) > lim) bad++;
  }
  return bad;
}
function repairFaceMeshes(shape, m, tol, ang) {
  const faces = shape.faces;
  try {
    if (faces.length !== m.faceGroups.length || faces.length > 3000) return 0;
    const fixes = new Map();
    faces.forEach((f, fi) => {
      const t = f.geomType;
      if (t !== "CYLINDRE" && t !== "SPHERE" && t !== "TORUS") return;
      const g = m.faceGroups[fi];
      let sd = null;
      try { sd = surfaceDeviation(f); } catch (err) { return; }
      if (!sd || !badFaceTris(m.triangles, m.vertices, g.start, g.count, sd, tol)) return;
      if (typeof process !== "undefined" && process.env && process.env.MESH_T) console.log("bad face mesh", fi, t, sd.r);
      // repair this face and mesh it by itself
      let nf = null;
      try {
        const fx = new OC.ShapeFix_Face();
        fx.Init_1 ? fx.Init_1(f.wrapped) : fx.Init(f.wrapped);
        fx.Perform();
        nf = R.cast(fx.Face());
        fx.delete();
        const fm = nf.mesh({ tolerance: tol, angularTolerance: ang });
        if (fm.triangles.length && !badFaceTris(fm.triangles, fm.vertices, 0, fm.triangles.length, sd, tol)) fixes.set(fi, fm);
      } catch (err) {} finally { if (nf) nf.delete(); }
    });
    if (!fixes.size) return 0;
    const V = Array.from(m.vertices), N = Array.from(m.normals), Tn = [], groups = [];
    m.faceGroups.forEach((g, fi) => {
      const start = Tn.length, fm = fixes.get(fi);
      if (!fm) { for (let i = g.start; i < g.start + g.count; i++) Tn.push(m.triangles[i]); }
      else {
        // keep the face's outward side: compare with the surface normals the mesher gave
        let ox = 0, oy = 0, oz = 0;
        for (let i = g.start; i < g.start + g.count; i++) { const k = m.triangles[i] * 3; ox += m.normals[k]; oy += m.normals[k + 1]; oz += m.normals[k + 2]; }
        let nx = 0, ny = 0, nz = 0;
        for (let k = 0; k < fm.normals.length; k += 3) { nx += fm.normals[k]; ny += fm.normals[k + 1]; nz += fm.normals[k + 2]; }
        const flipN = ox * nx + oy * ny + oz * nz < 0 && Math.hypot(ox, oy, oz) > 1e-6;
        // triangle winding must agree with the normals
        const FT = fm.triangles, FP = fm.vertices, FN = fm.normals;
        let wind = 0;
        for (let i = 0; i < FT.length; i += 3) {
          const a = FT[i] * 3, b = FT[i + 1] * 3, c = FT[i + 2] * 3;
          const ux = FP[b] - FP[a], uy = FP[b + 1] - FP[a + 1], uz = FP[b + 2] - FP[a + 2], vx = FP[c] - FP[a], vy = FP[c + 1] - FP[a + 1], vz = FP[c + 2] - FP[a + 2];
          wind += (uy * vz - uz * vy) * FN[a] + (uz * vx - ux * vz) * FN[a + 1] + (ux * vy - uy * vx) * FN[a + 2];
        }
        const flipT = (wind < 0) !== flipN;
        const base = V.length / 3;
        for (let k = 0; k < FP.length; k++) { V.push(FP[k]); N.push(flipN ? -FN[k] : FN[k]); }
        for (let i = 0; i < FT.length; i += 3) {
          if (flipT) Tn.push(base + FT[i], base + FT[i + 2], base + FT[i + 1]);
          else Tn.push(base + FT[i], base + FT[i + 1], base + FT[i + 2]);
        }
      }
      groups.push({ ...g, start, count: Tn.length - start });
    });
    m.vertices = V; m.normals = N; m.triangles = Tn; m.faceGroups = groups;
    return fixes.size;
  } finally { faces.forEach((f) => f.delete()); }
}

export function meshShape(shape, quality = 1) {
  const TT = [Date.now()], tick = () => TT.push(Date.now());
  const bb = bboxOf(shape);
  const diag = Math.hypot(...bb.size) || 1;
  const tol = Math.max(0.005, diag * 0.0006 / quality);
  const m = shape.mesh({ tolerance: tol, angularTolerance: 0.2 / quality });
  try { repairFaceMeshes(shape, m, tol, 0.2 / quality); } catch (err) {}
  tick();
  const e = shape.meshEdges({ tolerance: tol, angularTolerance: 0.2 / quality });
  tick();
  const faces = shape.faces;
  // Dense bodies (imported meshes): flat faces get their center and normal from the
  // display triangles, which is exact for flat faces and far quicker than integrating.
  const fastFlat = faces.length > 400 && m.faceGroups.length === faces.length;
  const flatFromMesh = (g) => {
    let ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0, A = 0;
    const T = m.triangles, P = m.vertices;
    for (let i = g.start; i < g.start + g.count; i += 3) {
      const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ar = Math.hypot(nx, ny, nz) / 2;
      ax += nx; ay += ny; az += nz; A += ar;
      cx += ar * (P[a] + P[b] + P[c]) / 3; cy += ar * (P[a + 1] + P[b + 1] + P[c + 1]) / 3; cz += ar * (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    }
    const L = Math.hypot(ax, ay, az);
    if (!(A > 0) || !(L > 0)) return null;
    return { n: [ax / L, ay / L, az / L], c: [cx / A, cy / A, cz / A] };
  };
  const faceInfo = faces.map((f, fi) => {
    const t = f.geomType;
    const info = { t };
    try {
      const quick = fastFlat && t === "PLANE" ? flatFromMesh(m.faceGroups[fi]) : null;
      if (quick) { info.n = quick.n; info.c = quick.c; }
      else if (t === "PLANE") {
        info.n = unitT(f.normalAt().toTuple());
        info.c = f.center.toTuple();
      } else {
        info.c = f.center.toTuple();
        if (t === "SPHERE") {
          const ad = new OC.BRepAdaptor_Surface(f.wrapped, true);
          try { const sp = ad.Sphere(); const L = sp.Position().Location(); info.r = sp.Radius(); info.o = [L.X(), L.Y(), L.Z()]; } finally { ad.delete(); }
        }
        if (t === "CYLINDRE") {
          // axis, radius and which side the material is on (for threads)
          const ad = new OC.BRepAdaptor_Surface(f.wrapped, true);
          try {
            const cy = ad.Cylinder(), pos = cy.Position();
            const P = (p) => [p.X(), p.Y(), p.Z()];
            const reversed = f.wrapped.Orientation() === OC.TopAbs_Orientation.TopAbs_REVERSED;
            info.r = cy.Radius(); info.ax = P(pos.Direction()); info.o = P(pos.Location());
            info.ext = (pos.Direct() ? 1 : -1) * (reversed ? -1 : 1) > 0;
          } finally { ad.delete(); }
        }
      }
    } catch (err) {}
    f.delete();
    return info;
  });
  tick();
  const edges = shape.edges;
  const edgeIndex = new Map(edges.map((ed, i) => [ed.hashCode, i]));
  const edgeInfo = edges.map((ed) => {
    const s = edgeSig(ed, bb);
    ed.delete();
    return s;
  });
  // which edges bound each face (so a face can be picked for a fillet)
  const faceEdges = [];
  for (const f of shape.faces) { const list = []; for (const ed of f.edges) { const i = edgeIndex.get(ed.hashCode); if (i !== undefined && !list.includes(i)) list.push(i); ed.delete(); } faceEdges.push(list); f.delete(); }
  // Dense bodies: hide the edges between nearly flush neighbours (the triangles of a
  // curved mesh surface), keeping the sharp ones, so it doesn't look like a wireframe.
  const groups = e.edgeGroups.map((g) => [g.start, g.count]);
  // seams: the edge where a round face (cylinder, cone, sphere, torus…) closes on itself. It is
  // not a real edge of the shape, so it isn't drawn (it showed as a stray line down a cylinder).
  for (const f of shape.faces) {
    const seen = new Map();
    for (const ed of f.edges) {
      const i = edgeIndex.get(ed.hashCode);
      let closed = false;
      try { closed = !!OC.BRep_Tool.IsClosed(ed.wrapped, f.wrapped); } catch (err) {}
      if (i !== undefined && closed) seen.set(i, 2);
      ed.delete();
    }
    f.delete();
    for (const [i, n] of seen) if (n > 1 && groups[i]) groups[i][1] = 0;
  }
  // smooth joins: where two faces meet without a crease (a round side made of several pieces, a
  // flat face split in two), there is no edge to see, so none is drawn
  if (edgeInfo.length <= 400 && faceEdges.length === faceInfo.length) {
    const owners = [];
    faceEdges.forEach((list, fi) => list.forEach((ei) => { (owners[ei] = owners[ei] || []).push(fi); }));
    const fl = shape.faces, el = shape.edges;
    try {
      for (let ei = 0; ei < el.length && ei < groups.length; ei++) {
        const o = owners[ei];
        if (!o || o.length !== 2 || !groups[ei][1]) continue;
        const A = faceInfo[o[0]], B = faceInfo[o[1]];
        let smooth = false;
        if (A.n && B.n) smooth = A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2] > 0.99985;
        else {
          try {
            const mid = el[ei].pointAt(0.5);
            const n1 = fl[o[0]].normalAt(mid), n2 = fl[o[1]].normalAt(mid);
            // (curved faces give normals that aren't unit length)
            const l1 = Math.hypot(n1.x, n1.y, n1.z) || 1, l2 = Math.hypot(n2.x, n2.y, n2.z) || 1;
            smooth = (n1.x * n2.x + n1.y * n2.y + n1.z * n2.z) / (l1 * l2) > 0.9994;
            n1.delete && n1.delete(); n2.delete && n2.delete(); mid.delete && mid.delete();
          } catch (err) {}
        }
        if (smooth) groups[ei][1] = 0;
      }
    } finally { fl.forEach((f) => f.delete()); el.forEach((x) => x.delete()); }
  }
  if (edgeInfo.length > 400 && faceEdges.length === faceInfo.length) {
    const owners = new Array(edgeInfo.length);
    faceEdges.forEach((list, fi) => list.forEach((ei) => { (owners[ei] = owners[ei] || []).push(fi); }));
    const cosLimit = Math.cos((25 * Math.PI) / 180);
    for (let ei = 0; ei < owners.length && ei < groups.length; ei++) {
      const o = owners[ei];
      if (!o || o.length !== 2) continue;
      const n1 = faceInfo[o[0]].n, n2 = faceInfo[o[1]].n;
      if (n1 && n2 && n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] > cosLimit) groups[ei][1] = 0;
    }
  }
  tick();
  let volume = null;
  try { volume = R.measureVolume(shape); } catch (err) {}
  tick();
  if (typeof process !== "undefined" && process.env && process.env.MESH_T) console.log("meshShape ms:", TT.slice(1).map((t, i) => t - TT[i]).join(" "));
  return {
    vertices: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    triangles: new Uint32Array(m.triangles),
    faceGroups: m.faceGroups.map((g) => [g.start, g.count]),
    faceInfo,
    lines: new Float32Array(e.lines),
    edgeGroups: groups,
    edgeInfo,
    faceEdges,
    bbox: { min: bb.min, max: bb.max },
    volume,
  };
}

export function buildBodies(bodies, quality = 1) {
  const out = [];
  for (const b of bodies) {
    NOTES = [];
    try {
      const t0 = Date.now();
      const shape = evalNode(b.node);
      const mesh = meshShape(shape, quality);
      shape.delete();
      out.push({ id: b.id, rev: b.rev, ok: true, mesh, ms: Date.now() - t0, notes: NOTES.length ? NOTES : undefined });
    } catch (e) {
      out.push({ id: b.id, rev: b.rev, ok: false, error: friendly(e) });
    }
    NOTES = null;
  }
  return out;
}

// STL / 3MF export: the display mesh is kept light so the view stays quick (curves in steps of
// about 11°, chords up to 0.06% of the part's size). Files for printing are meshed again here,
// much finer, from the exact shape: chord error (how far a flat triangle may sit from the true
// surface) and the angle between neighbouring triangles on a curve.
export const EXPORT_LEVELS = {
  standard: { rel: 2e-4, min: 0.01, max: 0.05, ang: 0.1 },   // ≤ 0.05 mm, ≤ 5.7°
  fine: { rel: 1e-4, min: 0.005, max: 0.02, ang: 0.06 },     // ≤ 0.02 mm, ≤ 3.4°
  extra: { rel: 5e-5, min: 0.002, max: 0.008, ang: 0.035 },  // ≤ 0.008 mm, ≤ 2°
};
export function exportTolerance(diag, level = "fine") {
  const L = EXPORT_LEVELS[level] || EXPORT_LEVELS.fine;
  return { tol: Math.min(L.max, Math.max(L.min, diag * L.rel)), ang: L.ang };
}
export function meshForExport(shape, level = "fine") {
  const bb = bboxOf(shape);
  const diag = Math.hypot(...bb.size) || 1;
  const { tol, ang } = exportTolerance(diag, level);
  const m = shape.mesh({ tolerance: tol, angularTolerance: ang });
  try { repairFaceMeshes(shape, m, tol, ang); } catch (err) {}
  return {
    vertices: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    triangles: new Uint32Array(m.triangles),
    faceGroups: m.faceGroups.map((g) => [g.start, g.count]),
    tol, ang,
  };
}
export function exportMeshes(bodies, level = "fine") {
  const out = [];
  for (const b of bodies) {
    try {
      const shape = evalNode(b.node);
      const mesh = meshForExport(shape, level);
      shape.delete();
      out.push({ id: b.id, ok: true, mesh });
    } catch (e) {
      out.push({ id: b.id, ok: false, error: friendly(e) });
    }
  }
  return out;
}

// Clearance: which bodies touch, overlap or sit closer than `gap` (parts that should move
// against each other). bodies: [{ id, node, m }]. Returns [{ a, b, d }] (d: closest distance,
// 0 when touching or overlapping) and each body's volume, so the tool can choose which to cut.
export function contactPairs(bodies, gap = 0.3) {
  const items = [];
  for (const b of bodies) {
    try {
      const sh = transformShape(evalNode(b.node), b.m);
      const bb = bboxOf(sh);
      items.push({ id: b.id, sh, bb, vol: safeVolume(sh) });
    } catch (e) {}
  }
  const near = gap + 0.01;
  const boxesMeet = (A, B) => [0, 1, 2].every((k) => A.min[k] - near <= B.max[k] && B.min[k] - near <= A.max[k]);
  // a part buried completely inside another: their surfaces are apart but they share volume
  const overlap = (A, B) => { try { const c = A.sh.intersect(B.sh); const v = safeVolume(c); c.delete(); return v > 1e-6; } catch (e) { return false; } };
  const pairs = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const A = items[i], B = items[j];
    if (!boxesMeet(A.bb, B.bb)) continue;
    let d = Infinity;
    try {
      const ds = new OC.BRepExtrema_DistShapeShape();
      ds.LoadS1(A.sh.wrapped); ds.LoadS2(B.sh.wrapped);
      const pr = new OC.Message_ProgressRange();
      if (ds.Perform(pr) && ds.IsDone()) d = ds.Value();
      pr.delete(); ds.delete();
    } catch (e) {}
    if (d > near) {
      // no surfaces close: one part may still be completely inside the other
      if (overlap(A, B)) d = 0;
    }
    if (d <= near) pairs.push({ a: A.id, b: B.id, d: Math.max(0, d) });
  }
  const vols = {};
  for (const it of items) { vols[it.id] = it.vol; try { it.sh.delete(); } catch (e) {} }
  return { pairs, vols };
}

function friendly(e) {
  if (typeof e === "number") return "The geometry kernel couldn't build this shape";
  const msg = (e && e.message) || String(e);
  if (/BRep|Standard_|StdFail|NotDone/i.test(msg)) return "The geometry kernel couldn't build this shape";
  return msg;
}

export function exportStep(bodies) {
  const shapes = [];
  for (const b of bodies) {
    try { shapes.push(transformShape(evalNode(b.node), b.m)); } catch (e) {}
  }
  if (!shapes.length) throw new Error("Nothing to export");
  const comp = shapes.length === 1 ? shapes[0] : R.makeCompound(shapes);
  return comp.blobSTEP();
}
export const _test = { solidFromMesh, safeVolume, shellSolid: (s, t, faces, dir, method) => shellSolid(s, t, new Set(faces.map((f) => f.hashCode)), dir, safeVolume(s), method || "auto") };
