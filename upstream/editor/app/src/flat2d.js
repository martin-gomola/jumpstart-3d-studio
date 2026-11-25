// Version 2.9.9.9.1: flat pieces from 2D shapes. Shapes (polygons and circles) are joined and cut on a
// fine grid of signed distances, the outline is traced along the zero line (marching squares, with
// interpolation, so straight edges come out exact to a few hundredths of a mm), simplified, and made
// into one closed solid of even thickness. Used for every part of a flower kit that prints lying flat:
// stems with their leaves and snap tabs, petal layers, sepal stars, sprigs.
import * as THREE from "three";

// shape: { poly: [[x, y], ...] } or { circle: [x, y], r }, with cut: true to take it away
function bounds(s) {
  if (s.circle) return [s.circle[0] - s.r, s.circle[1] - s.r, s.circle[0] + s.r, s.circle[1] + s.r];
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of s.poly) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [a, b, c, d];
}
// signed distance (negative inside)
function sd(s, x, y) {
  if (s.circle) return Math.hypot(x - s.circle[0], y - s.circle[1]) - s.r;
  const P = s.poly, n = P.length;
  let d = Infinity, inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ax, ay] = P[j], [bx, by] = P[i], ex = bx - ax, ey = by - ay, wx = x - ax, wy = y - ay;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
    d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
    if ((ay > y) !== (by > y) && x < ax + ((y - ay) * ex) / (ey || 1e-12)) inside = !inside;
  }
  return inside ? -d : d;
}
// the outline loops of the joined shapes: [{ pts, area, hole }]
export function outline(shapes, cell = 0.12) {
  const add = shapes.filter((s) => !s.cut), cut = shapes.filter((s) => s.cut);
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  for (const s of add) { const b = bounds(s); X0 = Math.min(X0, b[0]); Y0 = Math.min(Y0, b[1]); X1 = Math.max(X1, b[2]); Y1 = Math.max(Y1, b[3]); }
  X0 -= 3 * cell; Y0 -= 3 * cell; X1 += 3 * cell; Y1 += 3 * cell;
  const nx = Math.ceil((X1 - X0) / cell) + 1, ny = Math.ceil((Y1 - Y0) / cell) + 1;
  const G = new Float32Array(nx * ny).fill(1e3);
  const each = (s, f) => { const b = bounds(s), m = 3 * cell; const i0 = Math.max(0, Math.floor((b[0] - m - X0) / cell)), i1 = Math.min(nx - 1, Math.ceil((b[2] + m - X0) / cell)), j0 = Math.max(0, Math.floor((b[1] - m - Y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((b[3] + m - Y0) / cell)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * nx + i, X0 + i * cell, Y0 + j * cell); };
  // (far from a shape the grid keeps "outside" as a clamped distance: only the sign matters there)
  // each shape's signed distance on its own patch of the grid: inside or out by a scanline fill,
  // exact distance only near its edges (outside that band, +-3 cells is enough: only the sign matters)
  const band = 3 * cell;
  const field = (s) => {
    const b = bounds(s), i0 = Math.max(0, Math.floor((b[0] - band - X0) / cell)), i1 = Math.min(nx - 1, Math.ceil((b[2] + band - X0) / cell)), j0 = Math.max(0, Math.floor((b[1] - band - Y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((b[3] + band - Y0) / cell));
    const w = i1 - i0 + 1, h = j1 - j0 + 1, D = new Float32Array(w * h).fill(band);
    if (s.circle) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = sd(s, X0 + (i0 + i) * cell, Y0 + (j0 + j) * cell); D[j * w + i] = Math.max(-band, Math.min(band, v)); } return { i0, j0, w, h, D }; }
    const P = s.poly, n = P.length;
    // inside: even-odd along each row
    for (let j = 0; j < h; j++) {
      const y = Y0 + (j0 + j) * cell, xs = [];
      for (let a = 0, c = n - 1; a < n; c = a++) { const [ax, ay] = P[c], [bx, by] = P[a]; if ((ay > y) !== (by > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay)); }
      xs.sort((p, q) => p - q);
      for (let m = 0; m + 1 < xs.length; m += 2) { const a0 = Math.max(0, Math.ceil((xs[m] - X0) / cell) - i0), a1 = Math.min(w - 1, Math.floor((xs[m + 1] - X0) / cell) - i0); for (let i = a0; i <= a1; i++) D[j * w + i] = -band; }
    }
    // exact distances near each edge
    for (let a = 0, c = n - 1; a < n; c = a++) {
      const [ax, ay] = P[c], [bx, by] = P[a], ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1e-12;
      const ia = Math.max(0, Math.floor((Math.min(ax, bx) - band - X0) / cell) - i0), ib = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + band - X0) / cell) - i0);
      const ja = Math.max(0, Math.floor((Math.min(ay, by) - band - Y0) / cell) - j0), jb = Math.min(h - 1, Math.ceil((Math.max(ay, by) + band - Y0) / cell) - j0);
      for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
        const x = X0 + (i0 + i) * cell, y = Y0 + (j0 + j) * cell, wx = x - ax, wy = y - ay, t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / L2)), d = Math.hypot(wx - ex * t, wy - ey * t);
        const k = j * w + i, cur = D[k];
        if (d < Math.abs(cur)) D[k] = cur < 0 ? -d : d;
      }
    }
    return { i0, j0, w, h, D };
  };
  for (const s of add) { const f = field(s); for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) { const k = (f.j0 + j) * nx + f.i0 + i, v = f.D[j * f.w + i]; if (v < G[k]) G[k] = v; } }
  for (const s of cut) { const f = field(s); for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) { const k = (f.j0 + j) * nx + f.i0 + i, v = -f.D[j * f.w + i]; if (v > G[k]) G[k] = v; } }
  // never exactly zero (keeps the tracing unambiguous)
  for (let k = 0; k < G.length; k++) if (G[k] === 0) G[k] = 1e-7;
  // marching squares: a point on each crossed grid edge, keyed by the edge
  const pt = new Map();
  const edgePt = (i0, j0, i1, j1) => {
    const a = j0 * nx + i0, b = j1 * nx + i1, key = a < b ? a * 2 + (j0 === j1 ? 0 : 1) : b * 2 + (j0 === j1 ? 0 : 1);
    if (!pt.has(key)) { const va = G[a], vb = G[b], t = va / (va - vb); pt.set(key, [X0 + (i0 + (i1 - i0) * t) * cell, Y0 + (j0 + (j1 - j0) * t) * cell]); }
    return key;
  };
  const next = new Map(); // segment from -> to (keys), oriented with the inside on the left
  const seg = (a, b) => next.set(a, b);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v0 = G[j * nx + i], v1 = G[j * nx + i + 1], v2 = G[(j + 1) * nx + i + 1], v3 = G[(j + 1) * nx + i];
    const c = (v0 < 0 ? 1 : 0) | (v1 < 0 ? 2 : 0) | (v2 < 0 ? 4 : 0) | (v3 < 0 ? 8 : 0);
    if (c === 0 || c === 15) continue;
    const B = () => edgePt(i, j, i + 1, j), Rt = () => edgePt(i + 1, j, i + 1, j + 1), T = () => edgePt(i, j + 1, i + 1, j + 1), L = () => edgePt(i, j, i, j + 1);
    const mid = (v0 + v1 + v2 + v3) / 4;
    switch (c) {
      case 1: seg(L(), B()); break; case 2: seg(B(), Rt()); break; case 3: seg(L(), Rt()); break;
      case 4: seg(Rt(), T()); break; case 6: seg(B(), T()); break; case 7: seg(L(), T()); break;
      case 8: seg(T(), L()); break; case 9: seg(T(), B()); break; case 11: seg(T(), Rt()); break;
      case 12: seg(Rt(), L()); break; case 13: seg(Rt(), B()); break; case 14: seg(B(), L()); break;
      case 5: if (mid < 0) { seg(L(), T()); seg(Rt(), B()); } else { seg(L(), B()); seg(Rt(), T()); } break;
      case 10: if (mid < 0) { seg(B(), L()); seg(T(), Rt()); } else { seg(B(), Rt()); seg(T(), L()); } break;
    }
  }
  // chain the segments into loops
  const loops = [];
  while (next.size) {
    const [start] = next.keys(); const L = []; let k = start, guard = 0;
    while (next.has(k) && guard++ < 1e7) { L.push(pt.get(k)); const n2 = next.get(k); next.delete(k); k = n2; if (k === start) break; }
    if (L.length >= 3) loops.push(simplify(L, 0.012));
  }
  const L = loops.map((pts) => ({ pts, area: Math.abs(area(pts)) })).filter((l) => l.area > cell * cell * 2);
  // outer edge or hole: by how many other loops it sits inside (even: an outer edge)
  for (const l of L) { const [x, y] = l.pts[0]; const depth = L.filter((o) => o !== l && o.area > l.area && inside(o.pts, x, y)).length; l.hole = depth % 2 === 1; }
  return L;
}
const area = (P) => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += P[j][0] * P[i][1] - P[i][0] * P[j][1]; return a / 2; };
// Douglas-Peucker on a closed loop
function simplify(P, tol) {
  if (P.length < 8) return P;
  // split at the two farthest-apart points, simplify both halves
  let a = 0, b = 0, best = -1;
  for (let i = 0; i < P.length; i += Math.max(1, Math.floor(P.length / 64))) { const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1]); if (d > best) { best = d; b = i; } }
  const dp = (Q) => { if (Q.length < 3) return Q; const [x0, y0] = Q[0], [x1, y1] = Q[Q.length - 1], L = Math.hypot(x1 - x0, y1 - y0) || 1e-12; let m = 0, mi = 0; for (let i = 1; i < Q.length - 1; i++) { const d = Math.abs((Q[i][0] - x0) * (y1 - y0) - (Q[i][1] - y0) * (x1 - x0)) / L; if (d > m) { m = d; mi = i; } } if (m <= tol) return [Q[0], Q[Q.length - 1]]; const l = dp(Q.slice(0, mi + 1)), r = dp(Q.slice(mi)); return [...l.slice(0, -1), ...r]; };
  const h1 = dp(P.slice(a, b + 1)), h2 = dp([...P.slice(b), P[0]]);
  return [...h1.slice(0, -1), ...h2.slice(0, -1)];
}
const inside = (P, x, y) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [ax, ay] = P[j], [bx, by] = P[i]; if ((ay > y) !== (by > y) && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) c = !c; } return c; };
// one closed solid from z0 to z1 (each separate outline is its own solid; a joined shape gives one)
export function flatSolid(shapes, z0, z1, cell = 0.12) {
  const loops = outline(shapes, cell), outer = loops.filter((l) => !l.hole), holes = loops.filter((l) => l.hole);
  const sh = outer.map((o) => { const s = new THREE.Shape(o.pts.map(([x, y]) => new THREE.Vector2(x, y))); s.userData = o; return s; });
  for (const h of holes) {
    const [x, y] = h.pts[0];
    // the smallest outer edge round it
    let host = null; for (const s of sh) if (inside(s.userData.pts, x, y) && (!host || s.userData.area < host.userData.area)) host = s;
    if (host) host.holes.push(new THREE.Path(h.pts.map(([px, py]) => new THREE.Vector2(px, py))));
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, z0);
  return weld(g);
}
export function weld(g) {
  const P = g.attributes.position.array, idx = g.index ? g.index.array : null, n = idx ? idx.length : P.length / 3;
  const map = new Map(), V = [], I = [];
  for (let k = 0; k < n; k++) {
    const i = (idx ? idx[k] : k) * 3, key = `${Math.round(P[i] * 1e4)},${Math.round(P[i + 1] * 1e4)},${Math.round(P[i + 2] * 1e4)}`;
    let v = map.get(key); if (v === undefined) { v = V.length / 3; V.push(P[i], P[i + 1], P[i + 2]); map.set(key, v); }
    I.push(v);
  }
  const J = []; for (let t = 0; t < I.length; t += 3) if (I[t] !== I[t + 1] && I[t + 1] !== I[t + 2] && I[t] !== I[t + 2]) J.push(I[t], I[t + 1], I[t + 2]);
  return { V, I: J };
}
// ------------------------------------------------------------------ the shapes a kit is made of
// a snap fork pointing along +x from x = 0 (its root), in a part of thickness t: two prongs 1.4 mm wide
// with a 1.2 mm gap, 'wall' long (the plate it goes through) plus 1.6 mm behind, barbs 0.45 mm proud
export const FORK = { w: 4.0, gap: 1.2, barb: 0.45, behind: 1.6, fit: 0.2 };
export function forkShapes(wall, x0 = 0, dir = 1) {
  // (the barbs' backs clear the plate's far side by 0.3 mm)
  const h = FORK.w / 2, g = FORK.gap / 2, xb = wall + 0.3, xt = wall + FORK.behind;
  const X = (x) => x0 + dir * x;
  const prong = (s) => ({ poly: [[X(-0.6), s * g], [X(xb), s * g], [X(xt), s * g], [X(xt), s * h], [X(xb), s * (h + FORK.barb)], [X(xb), s * h], [X(-0.6), s * h]].map(([x, y]) => [x, y]) });
  // (the gap between the prongs runs right down to the root, so they can flex)
  return [prong(1), prong(-1)];
}
// a leaf or petal outline along +x from (x0, 0) at angle a, length L, half-width at u: hw(u)
export function lobe(x0, y0, a, L, hw, n = 24) {
  const c = Math.cos(a), s = Math.sin(a), P = [];
  for (let i = 0; i <= n; i++) { const u = i / n, x = L * u, y = -hw(u); P.push([x0 + c * x - s * y, y0 + s * x + c * y]); }
  for (let i = n - 1; i >= 0; i--) { const u = i / n, x = L * u, y = hw(u); P.push([x0 + c * x - s * y, y0 + s * x + c * y]); }
  return { poly: P };
}
export const LEAF = {
  lance: (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.92 + 0.04)), 0.85) * (1 - 0.35 * u),
  oval: (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.94 + 0.03)), 0.6),
  round: (u) => Math.sqrt(Math.max(0, 1 - Math.pow(2 * u - 1, 2))),
  heart: (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.9 + 0.1)), 0.5) * (u < 0.15 ? 0.6 + u * 2.6 : 1),
  strap: (u) => Math.min(1, u * 8 + 0.3) * (u > 0.85 ? (1 - u) / 0.15 : 1),
  pointed: (u) => Math.min(1, u * 3 + 0.2) * (1 - Math.pow(u, 1.6)),
  spatula: (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.85 + 0.15)), 0.5) * (0.35 + 0.65 * u),
};
export const circle = (x, y, r) => ({ circle: [x, y], r });
export const rect = (x0, y0, x1, y1) => ({ poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
