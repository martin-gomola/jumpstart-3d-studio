// Flower Studio: flowers and arrangements built from parameters, ready to 3D print.
// Every flower is made of whorls of petals (each petal a curved, thickened sheet), a center
// (disc, dome, cone, stamens, trumpet, gear), sepals, a stem with leaves, or a spike or cluster
// of small florets. Two looks: lifelike (curved, ruffled, cupped petals) and mechanical
// (flat plates with ribs and rivets, gear centers, jointed stems). Petals can be fixed, hinged
// (print-in-place pins on a hub, so they open and close) or flexible (a thin strip at the base
// that bends). Arrangements put several flowers in a vase, bowl, pot, basket or wrapped bouquet.
// All meshes are closed shells in mm, Z up; a part may hold several shells (they print as one).
import * as THREE from "three";
import { flatSolid, forkShapes, lobe, LEAF, circle, rect, FORK } from "./flat2d.js";

// ------------------------------------------------------------------ mesh helpers
const mk = () => ({ V: [], I: [] });
function put(acc, m, M) {
  const o = acc.V.length / 3, v = new THREE.Vector3();
  for (let i = 0; i < m.V.length; i += 3) { v.set(m.V[i], m.V[i + 1], m.V[i + 2]); if (M) v.applyMatrix4(M); acc.V.push(v.x, v.y, v.z); }
  for (const i of m.I) acc.I.push(i + o);
  return acc;
}
function signedVolume(m) {
  let s = 0; const V = m.V;
  for (let t = 0; t < m.I.length; t += 3) {
    const a = m.I[t] * 3, b = m.I[t + 1] * 3, c = m.I[t + 2] * 3;
    s += V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1]) - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c]) + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c]);
  }
  return s / 6;
}
function outward(m) { if (signedVolume(m) < 0) for (let t = 0; t < m.I.length; t += 3) { const x = m.I[t + 1]; m.I[t + 1] = m.I[t + 2]; m.I[t + 2] = x; } return m; }

// a thickened sheet: mid-surface pt(u, v) (u, v in 0..1), thickness th(u, v); closed
// (top: optional extra height on the upper side only, (u, v) => mm, for ribs and studs that are part of the
// same surface: the petal stays one closed shell, so a slicer can't split them off)
function sheet(pt, nu, nv, th, top) {
  const P = [], N = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) P.push(pt(i / nu, j / nv));
  const at = (i, j) => P[i * (nv + 1) + j];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const a = at(Math.min(nu, i + 1), j), b = at(Math.max(0, i - 1), j), c = at(i, Math.min(nv, j + 1)), d = at(i, Math.max(0, j - 1));
    const du = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dv = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
    let n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
    const l = Math.hypot(...n);
    if (l < 1e-12) n = N.length ? N[N.length - 1] : [0, 0, 1]; else n = n.map((x) => x / l);
    N.push(n);
  }
  const m = mk(), cnt = (nu + 1) * (nv + 1);
  for (let k = 0; k < cnt; k++) { const p = P[k], n = N[k], u = Math.floor(k / (nv + 1)) / nu, v = (k % (nv + 1)) / nv, t = th(u, v) / 2 + (top ? top(u, v) : 0); m.V.push(p[0] + n[0] * t, p[1] + n[1] * t, p[2] + n[2] * t); }
  for (let k = 0; k < cnt; k++) { const p = P[k], n = N[k], t = th((Math.floor(k / (nv + 1))) / nu, (k % (nv + 1)) / nv) / 2; m.V.push(p[0] - n[0] * t, p[1] - n[1] * t, p[2] - n[2] * t); }
  const T = (i, j) => i * (nv + 1) + j, B = (i, j) => cnt + T(i, j);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    m.I.push(T(i, j), T(i + 1, j), T(i + 1, j + 1), T(i, j), T(i + 1, j + 1), T(i, j + 1));
    m.I.push(B(i, j), B(i + 1, j + 1), B(i + 1, j), B(i, j), B(i, j + 1), B(i + 1, j + 1));
  }
  // the rim: walk round the edge of the grid
  const loop = [];
  for (let j = 0; j < nv; j++) loop.push([0, j]);
  for (let i = 0; i < nu; i++) loop.push([i, nv]);
  for (let j = nv; j > 0; j--) loop.push([nu, j]);
  for (let i = nu; i > 0; i--) loop.push([i, 0]);
  // the rim runs the other way to the top's own edges, so the shell is closed and consistent
  const topE = new Set(); for (let q = 0; q < m.I.length; q += 3) for (let c = 0; c < 3; c++) topE.add(m.I[q + c] + "," + m.I[q + ((c + 1) % 3)]);
  for (let k = 0; k < loop.length; k++) {
    const [i0, j0] = loop[k], [i1, j1] = loop[(k + 1) % loop.length], p = T(i0, j0), q = T(i1, j1);
    if (topE.has(p + "," + q)) m.I.push(q, p, cnt + p, q, cnt + p, cnt + q);
    else m.I.push(p, q, cnt + q, p, cnt + q, cnt + p);
  }
  return outward(m);
}
// a solid of revolution from a closed (r, z) loop; rmod(theta, k) scales the radius (gears, ruffles)
function lathe(prof, segs = 32, rmod = null) {
  const m = mk(), n = prof.length;
  for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    for (let k = 0; k < n; k++) { const f = rmod ? rmod(a, k) : 1, r = prof[k][0] * f; m.V.push(r * c, r * sn, prof[k][1]); }
  }
  for (let s = 0; s < segs; s++) for (let k = 0; k < n; k++) {
    const a = s * n + k, b = ((s + 1) % segs) * n + k, c = ((s + 1) % segs) * n + ((k + 1) % n), d = s * n + ((k + 1) % n);
    m.I.push(a, b, c, a, c, d);
  }
  return outward(m);
}
// a tube along a path (closed with flat ends)
function tube(path, rad, segs = 8) {
  const m = mk(), n = path.length;
  let prevN = null;
  for (let i = 0; i < n; i++) {
    const p = path[i], q = path[Math.min(n - 1, i + 1)], o = path[Math.max(0, i - 1)];
    const t = new THREE.Vector3(q[0] - o[0], q[1] - o[1], q[2] - o[2]).normalize();
    let nn = prevN ? prevN.clone() : (Math.abs(t.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0));
    nn.sub(t.clone().multiplyScalar(nn.dot(t))).normalize(); prevN = nn;
    const bn = new THREE.Vector3().crossVectors(t, nn);
    const r = typeof rad === "function" ? rad(i / (n - 1)) : rad;
    for (let s = 0; s < segs; s++) { const a = (s / segs) * Math.PI * 2, c = Math.cos(a) * r, sn = Math.sin(a) * r; m.V.push(p[0] + nn.x * c + bn.x * sn, p[1] + nn.y * c + bn.y * sn, p[2] + nn.z * c + bn.z * sn); }
  }
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < segs; s++) { const a = i * segs + s, b = i * segs + ((s + 1) % segs), c = (i + 1) * segs + ((s + 1) % segs), d = (i + 1) * segs + s; m.I.push(a, b, c, a, c, d); }
  const c0 = m.V.length / 3; m.V.push(...path[0]); const c1 = c0 + 1; m.V.push(...path[n - 1]);
  for (let s = 0; s < segs; s++) { m.I.push(c0, (s + 1) % segs, s); const o = (n - 1) * segs; m.I.push(c1, o + s, o + ((s + 1) % segs)); }
  return outward(m);
}
const ellipsoid = (rx, ry, rz, seg = 12) => { const prof = []; for (let k = 0; k <= seg / 2; k++) { const a = -Math.PI / 2 + (k / (seg / 2)) * Math.PI; prof.push([Math.max(1e-4, Math.cos(a)), Math.sin(a) * rz]); } const m = lathe(prof, seg); for (let i = 0; i < m.V.length; i += 3) { m.V[i] *= rx; m.V[i + 1] *= ry; } return m; };
const cyl = (r, h, seg = 12) => lathe([[1e-4, 0], [r, 0], [r, h], [1e-4, h]], seg);
const box = (w, d, h) => { const x = w / 2, y = d / 2; const m = { V: [-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0, -x, -y, h, x, -y, h, x, y, h, -x, y, h], I: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7] }; return outward(m); };
// a matrix from translation, rotations (radians: z, then y) and scale
const M4 = (x = 0, y = 0, z = 0, rz = 0, ry = 0, s = 1) => new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationZ(rz)).multiply(new THREE.Matrix4().makeRotationY(ry)).multiply(new THREE.Matrix4().makeScale(s, s, s));
// a matrix that turns +Z to direction d at point p
function aim(p, d, spin = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...d).normalize());
  const M = new THREE.Matrix4().makeRotationFromQuaternion(q).multiply(new THREE.Matrix4().makeRotationZ(spin));
  M.setPosition(p[0], p[1], p[2]);
  return M;
}
// ------------------------------------------------------------------ pegs and sockets (printing in pieces)
// A 3 mm peg in a socket 0.2 mm bigger all round (measured at the socket's flat sides, as it's a
// 24-sided polygon): a snug slip fit on FDM printers; a drop of glue makes it permanent. The
// socket is 0.5 mm deeper than the peg, so the shoulders meet.
export const PEG = { r: 1.5, len: 6, fit: 0.2, depth: 6.5, wall: 1.6, segs: 24 };
const SOCK_R = (PEG.r + PEG.fit) / Math.cos(Math.PI / PEG.segs), COLLAR_R = SOCK_R + PEG.wall;
// a peg standing on z = 0, pointing up (chamfered tip so it finds the hole)
const pegMesh = () => lathe([[1e-4, -0.3], [PEG.r, -0.3], [PEG.r, PEG.len - 0.5], [PEG.r - 0.45, PEG.len], [1e-4, PEG.len]], PEG.segs);
// a socket collar whose bottom is at z = zc: the hole opens at the bottom, PEG.depth deep, and the
// collar runs up to zTop (into the part it holds)
const collarMesh = (zc, zTop) => lathe([[1e-4, zc + PEG.depth], [SOCK_R, zc + PEG.depth], [SOCK_R, zc], [COLLAR_R, zc], [COLLAR_R, zTop], [1e-4, zTop]], PEG.segs);
// the stand for one flower; with a socket, it has a boss with the hole in it (top at z = 10)
export function standMesh(socket) {
  if (!socket) return lathe([[1e-4, 0], [26, 0], [24, 6], [1e-4, 6]], 40);
  return lathe([[1e-4, 10 - PEG.depth], [SOCK_R, 10 - PEG.depth], [SOCK_R, 10], [COLLAR_R + 2, 10], [COLLAR_R + 3, 6], [24, 6], [26, 0], [1e-4, 0]], 40);
}
export const STAND_TOP = (socket) => (socket ? 10 : 6);
// Snap-in petals: each petal prints flat, 1.6 mm thick, with a two-prong tab at its base. The hub has
// a panel for every petal with a slot 0.2 mm bigger all round than the tab; pushing the tab in
// squeezes the prongs together until their barbs pass the panel and click open behind it.
export const SNAP = { t: 1.6, tabW: 4.0, gapW: 1.2, barb: 0.45, fit: 0.2, wall: 2.4, behind: 1.6, lip: 2.2 };
const SNAP_SLOT_W = SNAP.tabW + 2 * SNAP.fit, SNAP_SLOT_H = SNAP.t + 2 * SNAP.fit;
// the tab, in the petal's own axes (x along the petal, into the hub when negative; z through it)
function snapTab() {
  const { tabW, gapW, barb, wall, behind, t } = SNAP, h = tabW / 2, g = gapW / 2, xb = -(wall + 0.25), xt = -(wall + behind);
  const sh = new THREE.Shape();
  const pts = [[1.5, -h], [1.5, h], [xb, h], [xb, h + barb], [xt, h], [xt, g], [0, g], [0, -g], [xt, -g], [xt, -h], [xb, -h - barb], [xb, -h]];
  pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  const g2 = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 1 });
  g2.translate(0, 0, -t / 2);
  return weldGeo(g2);
}
// a hub panel with the slot: in the petal's axes it spans x from -wall to 0 (its outer face at 0)
// (a trapezoid: half as wide as hw(z) at each height, to keep to its own slice of the crown)
function snapPanel(hw, Hp) {
  const sh = new THREE.Shape(), b = Hp / 2, a0 = hw(-b), a1 = hw(b);
  sh.moveTo(-a0, -b); sh.lineTo(a0, -b); sh.lineTo(a1, b); sh.lineTo(-a1, b); sh.lineTo(-a0, -b);
  const hl = new THREE.Path(), sw = SNAP_SLOT_W / 2, shh = SNAP_SLOT_H / 2;
  hl.moveTo(-sw, -shh); hl.lineTo(-sw, shh); hl.lineTo(sw, shh); hl.lineTo(sw, -shh); hl.lineTo(-sw, -shh);
  sh.holes.push(hl);
  const g = new THREE.ExtrudeGeometry(sh, { depth: SNAP.wall, bevelEnabled: false, curveSegments: 1 });
  // shape X -> y, shape Y -> z, extrusion -> x (from -wall to 0)
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -SNAP.wall, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  return weldGeo(g);
}
// a flat disc with round holes (polygon outline, extruded from z0 to z1)
function discWithHoles(R, holes, z0, z1) {
  const sh = new THREE.Shape();
  for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; i ? sh.lineTo(R * Math.cos(a), R * Math.sin(a)) : sh.moveTo(R, 0); }
  for (const [x, y] of holes) { const h = new THREE.Path(); for (let i = 0; i <= PEG.segs; i++) { const a = -(i / PEG.segs) * Math.PI * 2; i ? h.lineTo(x + SOCK_R * Math.cos(a), y + SOCK_R * Math.sin(a)) : h.moveTo(x + SOCK_R, y); } sh.holes.push(h); }
  const g = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, z0);
  return weldGeo(g);
}
// a three.js geometry as {V, I} with shared corners
function weldGeo(g) {
  const P = g.attributes.position.array, idx = g.index ? g.index.array : null, n = idx ? idx.length : P.length / 3;
  const map = new Map(), V = [], I = [];
  for (let k = 0; k < n; k++) {
    const i = (idx ? idx[k] : k) * 3, key = `${Math.round(P[i] * 1e4)},${Math.round(P[i + 1] * 1e4)},${Math.round(P[i + 2] * 1e4)}`;
    let v = map.get(key); if (v === undefined) { v = V.length / 3; V.push(P[i], P[i + 1], P[i + 2]); map.set(key, v); }
    I.push(v);
  }
  const J = []; for (let t = 0; t < I.length; t += 3) if (I[t] !== I[t + 1] && I[t + 1] !== I[t + 2] && I[t] !== I[t + 2]) J.push(I[t], I[t + 1], I[t + 2]);
  return outward({ V, I: J });
}
// a little seeded random
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }

// ------------------------------------------------------------------ petals
// width profiles along the petal (u from base 0 to tip 1)
const PROF = {
  round: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.75),
  oval: (u) => Math.sin(Math.PI * u),
  pointed: (u) => Math.sin(Math.PI * Math.pow(u, 0.55)) * Math.pow(1 - u, 0.25),
  spatula: (u) => Math.pow(u, 0.45) * Math.pow(Math.max(0, 1 - Math.pow(u, 5)), 0.5) * 1.05,
  strap: (u) => Math.min(1, u * 6) * Math.pow(Math.max(0, 1 - Math.pow(u, 8)), 0.5),
  heart: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.65)), 0.6) * 1.05,
  fan: (u) => Math.pow(u, 0.7) * Math.pow(Math.max(0, 1 - Math.pow(u, 10)), 0.4) * 1.1,
  lance: (u) => Math.sin(Math.PI * Math.pow(u, 0.7)) * Math.pow(1 - u * 0.95, 0.6),
};
// one petal in its own frame: base on the hinge line (local Y axis), running out along +X,
// facing +Z (the inside of the flower once it is tipped up)
// a flat snap-in petal: the outline of the petal and of its two-prong tab joined into one polygon (and
// mechanical ones with two round holes where the rivets would be), made 1.6 mm thick: one closed solid
function snapPetalMesh(pt, halfAt, along, w, holes, Wd) {
  // (if the result isn't closed, as can happen at a fringed tip, it is made again with a simpler outline)
  for (const [N, NT] of [[40, 16], [24, 8], [16, 4]]) { const m = snapPetalTry(pt, halfAt, along, w, holes, Wd, N, NT); if (closedMesh(m)) return m; }
  return snapPetalTry(pt, halfAt, along, w, false, Wd, 12, 2);
}
function closedMesh(m) {
  const E = new Map();
  for (let t = 0; t < m.I.length; t += 3) for (const [a, b] of [[m.I[t], m.I[t + 1]], [m.I[t + 1], m.I[t + 2]], [m.I[t + 2], m.I[t]]]) { const k = a < b ? a * 1e7 + b : b * 1e7 + a; E.set(k, (E.get(k) || 0) + 1); }
  for (const v of E.values()) if (v !== 2) return false;
  return true;
}
function snapPetalTry(pt, halfAt, along, w, holes, Wd, N, NT) {
  const { tabW, gapW, barb, wall, behind, t } = SNAP, h = tabW / 2, g = gapW / 2, xb = -(wall + 0.25), xt = -(wall + behind);
  const out = [];
  // the petal's edge: one side root to tip, round the tip, the other side back to the root
  const P = (u0, vv) => { const q = pt(u0, vv); return [q[0], q[1]]; };
  for (let i = 0; i <= N; i++) out.push(P(i / N, 0));
  for (let j = 1; j < NT; j++) out.push(P(1, j / NT));
  for (let i = N; i >= 0; i--) out.push(P(i / N, 1));
  // then the tab, from the root's one side, round the prongs, to the other
  const x0 = out[0][0];
  out.push([x0, h], [xb, h], [xb, h + barb], [xt, h], [xt, g], [0, g], [0, -g], [xt, -g], [xt, -h], [xb, -h - barb], [xb, -h], [x0, -h]);
  // (clean up: no repeated points)
  const pts = out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 1e-4);
  const area = pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  if (area < 0) pts.reverse();
  const sh = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  if (holes) {
    const r = Math.min(1.0, Wd * 0.07);
    for (const u of [0.3, 0.6]) {
      const [x] = along(u), y = Math.min(Wd * 0.22, halfAt(u) - r - 1.0);
      if (y < r + 0.8) continue;
      for (const s of [-1, 1]) { const hp = new THREE.Path(); for (let i = 0; i <= 16; i++) { const a = -(i / 16) * Math.PI * 2; i ? hp.lineTo(x + r * Math.cos(a), s * y + r * Math.sin(a)) : hp.moveTo(x + r, s * y); } sh.holes.push(hp); }
    }
  }
  const geo = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -t / 2);
  return weldGeo(geo);
}
function petalMesh(w, o) {
  const mech = o.style === "mech", flex = o.petals === "flex", hinge = o.petals === "hinged" && w.canHinge, snap = o.petals === "snap" && w.canSnap;
  const L = w.L, Wd = w.W, prof = PROF[w.prof] || PROF.round;
  const lo = w.res === "lo", mid = w.res === "mid" || w.res === "lo2", nu = lo ? 3 : mech ? (mid ? 6 : 10) : mid ? 6 : 10, nv = lo ? 2 : mech ? (mid ? 4 : 8) : mid ? 6 : 6;
  // hinged petals: less cupped and no twist, so each one stays in its own slice and can swing
  // snap-in petals print flat: no cup, ruffle, bend or twist, and an even 1.6 mm thickness
  const curl = mech || snap ? 0 : hinge ? Math.min(0.2, w.curl || 0) : w.curl || 0, ruffle = mech || snap ? 0 : w.ruffle || 0, bend = snap ? 0 : w.bend || 0, twist = mech || hinge || snap ? 0 : w.twist || 0;
  const t = snap ? SNAP.t : mech ? Math.max(1.3, w.t || 1.2) : w.t || 1.1;
  const x0 = hinge ? o.knuckle * 0.75 : snap ? 0.3 : 0;
  // the centre line: a curve in the XZ plane that bends by "bend" from base to tip
  const NS = 24, cx = [x0], cz = [0];
  for (let k = 1; k <= NS; k++) { const u = (k - 0.5) / NS, ph = bend * Math.pow(u, 1.4); cx.push(cx[k - 1] + Math.cos(ph) * (L / NS)); cz.push(cz[k - 1] + Math.sin(ph) * (L / NS)); }
  const along = (u) => { const f = Math.min(NS - 1e-6, Math.max(0, u * NS)), k = Math.floor(f), r = f - k; return [cx[k] + (cx[k + 1] - cx[k]) * r, cz[k] + (cz[k + 1] - cz[k]) * r, bend * Math.pow(u, 1.4)]; };
  const tipLen = (v) => {
    const a = Math.abs(v);
    if (w.tip === "notch") return 1 - 0.18 * Math.max(0, 1 - a * a * 2.2);
    if (w.tip === "fringe") return 1 - 0.12 * (0.5 + 0.5 * Math.cos((w.teeth || 7) * Math.PI * v));
    if (w.tip === "teeth") return 1 - 0.07 * (0.5 + 0.5 * Math.cos((w.teeth || 5) * Math.PI * v));
    return 1;
  };
  const halfAt = (u) => {
    const [x, z] = along(u);
    let half = (Wd / 2) * Math.max(0.05, (w.base ?? 0.25) + (1 - (w.base ?? 0.25)) * prof(u));
    if (snap) {
      // inside its own slice of the flower, with a gap to the next petal; and near the root at least as
      // wide as the tab (so the outline joins it cleanly)
      const rho = w.r0 + x * Math.cos(w.elev || 0) - z * Math.sin(w.elev || 0);
      half = Math.max(0.3, Math.min(half, rho * Math.sin(Math.PI / Math.max(2, w.nRing || w.n)) - 0.5));
      if (x < 2.2) half = Math.max(half, SNAP.tabW / 2 + 0.1);
    }
    if (hinge) {
      // between its own ears near the pin, and inside its own slice of the flower (with a gap to
      // the next petal) when printed open, so it is free to swing
      // (one grid step further out too, so the straight edge to the next row stays clear of the ears)
      if (x < o.knuckle + o.clear + 0.5 + L / nu) half = Math.min(half, o.knuckleLen(w) / 2);
      const rho = w.r0 + x * Math.cos(w.elev || 0) - z * Math.sin(w.elev || 0);
      half = Math.max(0.3, Math.min(half, rho * Math.sin(Math.PI / Math.max(2, w.nRing || w.n)) - o.gap - t * 0.5));
    }
    return half;
  };
  const pt = (u0, vv) => {
    const v = vv * 2 - 1, u = u0 * tipLen(v);
    const [x, z, ph] = along(u);
    const half = halfAt(u);
    let y = v * half, h = curl * half * v * v * Math.min(1, u * 3) + ruffle * half * Math.sin((w.waves || 5) * Math.PI * v + u * 4) * Math.pow(Math.abs(v), 2) * u;
    if (twist) { const a = twist * u; const yy = y * Math.cos(a) - h * Math.sin(a); h = y * Math.sin(a) + h * Math.cos(a); y = yy; }
    // offset across the curve: lift h along the curve's normal (-sin, cos)
    return [x - Math.sin(ph) * h, y, z + Math.cos(ph) * h];
  };
  const th = (u) => (flex && u < 0.16 ? 0.55 : t) * (mech || snap ? 1 : 1 - 0.35 * u);
  // snap-in petals are flat: the petal and its tab are one outline, made solid in one piece
  if (snap) return snapPetalMesh(pt, halfAt, along, w, mech && !lo && L >= 14 && Wd >= 7, Wd);
  // mechanical petals: a raised rib down the middle and two studs, part of the petal's own top surface
  // (not on a hinged flower's fixed inner petals: the swinging ones pass close over them)
  const deco = mech && !lo && !mid && L >= 14 && Wd >= 7 && !(o.petals === "hinged" && !hinge) ? (u, v) => {
    const vv = v * 2 - 1;
    let e = u > 0.08 && u < 0.9 && Math.abs(vv) < 1e-6 ? Math.min(0.8, Wd * 0.06) : 0;
    for (const uc of [0.3, 0.6]) if (Math.abs(u - uc) < 1e-6 && Math.abs(Math.abs(vv) - 0.5) < 1e-6) e = Math.max(e, 0.7);
    return e;
  } : null;
  const m = sheet(pt, nu, nv, th, deco);
  if (hinge) {
    // the knuckle: a tube round the hinge pin (the pin itself belongs to the hub)
    // the hole is sized at its flat sides (it is a 24-sided polygon), so the gap is never less than "clear"
    const kl = o.knuckleLen(w), ri = (o.pinR + o.clear) / Math.cos(Math.PI / 24), ro = o.knuckle;
    const pr = [[ri, -kl / 2], [ro, -kl / 2], [ro, kl / 2], [ri, kl / 2]];
    const k = lathe(pr, 24);
    put(m, k, new THREE.Matrix4().makeRotationX(Math.PI / 2));
  }
  return m;
}

// ------------------------------------------------------------------ centers and bits
function centerMesh(c, o, D) {
  const m = mk(), mech = o.style === "mech";
  const r = c.r ?? D * 0.12, h = c.h ?? r * 0.5;
  switch (c.type) {
    case "disc": case "dome": {
      if (mech) {
        // a gear with a hex bolt
        const teeth = Math.max(8, Math.round(r * 1.6));
        put(m, lathe([[1e-4, 0], [r, 0], [r, h], [1e-4, h]], teeth * 4, (a, k) => (k === 1 || k === 2 ? (Math.cos(teeth * a) > 0 ? 1 : 0.86) : 1)));
        put(m, lathe([[1e-4, h], [r * 0.38, h], [r * 0.38, h + r * 0.35], [1e-4, h + r * 0.35]], 6));
        break;
      }
      const prof = [[1e-4, 0]]; for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI / 2; prof.push([Math.max(1e-4, r * Math.cos(a)), h * Math.sin(a)]); }
      put(m, lathe(prof, 28, c.seeds ? (a, k) => 1 + 0.03 * Math.cos(21 * a + k * 1.7) : null));
      break;
    }
    case "cone": {
      put(m, lathe([[1e-4, 0], [r, 0], [r * 0.9, h * 0.4], [r * 0.45, h], [1e-4, h * 1.1]], 24, mech ? null : (a, k) => (k > 0 ? 1 + 0.06 * Math.cos(13 * a + k) : 1)));
      break;
    }
    case "stamens": {
      const n = c.n || 6, len = c.len || D * 0.35;
      put(m, ellipsoid(r * 0.5, r * 0.5, r * 0.4, 10));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, sp = c.spread ?? 0.35;
        const tip = [Math.cos(a) * len * sp, Math.sin(a) * len * sp, len];
        const path = [[0, 0, 0], [tip[0] * 0.4, tip[1] * 0.4, len * 0.55], tip];
        put(m, tube(path, mech ? 0.7 : 0.55, 6));
        put(m, mech ? cyl(1.1, 1.6, 6) : ellipsoid(c.anther ? 1.6 : 1.0, 0.8, 0.8, 8), new THREE.Matrix4().makeTranslation(tip[0], tip[1], tip[2] - (mech ? 0.8 : 0)));
      }
      if (c.pistil) put(m, tube([[0, 0, 0], [0, 0, len * 1.1]], 0.7, 6)), put(m, ellipsoid(1.4, 1.4, 1, 8), new THREE.Matrix4().makeTranslation(0, 0, len * 1.1));
      break;
    }
    case "pod": {
      // poppy: a seed pod with a ridged cap, ringed by short stamens
      put(m, lathe([[1e-4, 0], [r * 0.7, 0], [r, h * 0.7], [r * 0.6, h], [1e-4, h * 1.05]], 24, mech ? null : (a, k) => (k >= 2 ? 1 + 0.08 * Math.cos(10 * a) : 1)));
      const n = 18; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; put(m, tube([[Math.cos(a) * r, Math.sin(a) * r, h * 0.3], [Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5, h * 0.9]], 0.4, 5)); }
      break;
    }
    case "trumpet": {
      // daffodil corona, morning-glory throat: a tube with a flared, ruffled rim
      const R0 = c.r0 ?? r, R1 = c.r1 ?? r * 1.6, L = c.len ?? D * 0.3, t = mech ? 1.4 : 1.0;
      const prof = [[R0 * 0.5, 0], [R0 + t, 0], [R1 + t, L], [R1, L], [R0, t], [R0 * 0.5, t]];
      put(m, lathe(prof, Math.max(8, Math.min(40, Math.round(R1 * 4))), mech ? null : (a, k) => (k === 2 || k === 3 ? 1 + (c.ruffle ?? 0.08) * Math.cos((c.waves || 12) * a) : 1)));
      if (c.stamens) put(m, centerMesh({ type: "stamens", n: 6, len: L * 0.8, r: R0 * 0.8, spread: 0.15 }, o, D));
      break;
    }
    case "spadix": put(m, tube([[0, 0, 0], [0, 0, c.len || D * 0.45]], c.r || 2.2, 10)); break;
    case "bun": put(m, ellipsoid(r, r, h, r < 2 ? 6 : 12)); break;
    case "filaments": {
      // passion flower: a ring of fine filaments round a raised centre
      const n = 40, R0 = r, R1 = c.r1 || D * 0.42;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; put(m, tube([[Math.cos(a) * R0, Math.sin(a) * R0, 0.6], [Math.cos(a) * (R0 + R1) / 2, Math.sin(a) * (R0 + R1) / 2, 1.6], [Math.cos(a) * R1, Math.sin(a) * R1, 1.0]], 0.45, 5)); }
      put(m, centerMesh({ type: "stamens", n: 5, len: D * 0.22, r: R0, spread: 0.6, pistil: true, anther: true }, o, D));
      break;
    }
    default: put(m, ellipsoid(r, r, h, 10));
  }
  return m;
}

// ------------------------------------------------------------------ species
// a whorl: n petals of length L and width W at radius r0, height z0, tipped up by elev (bloom open)
// and bud (closed) radians; prof, tip, curl, ruffle, bend, twist shape the petal
const deg = Math.PI / 180;
const W_ = (n, L, W, x = {}) => ({ n, L, W, prof: "round", elev: 15 * deg, bud: 80 * deg, r0: 0, z0: 0, phase: 0, curl: 0.3, ...x });
// a double flower: many whorls from a tight centre to open outer petals
function doubles(D, nW, x) {
  const ws = [];
  for (let k = 0; k < nW; k++) {
    const f = k / Math.max(1, nW - 1); // 0 = outside, 1 = centre
    ws.push(W_(Math.round((x.n0 || 5) + (x.n1 ?? 3) * (1 - f)), D * (0.5 - 0.3 * f) * (x.len || 1), D * (x.wid || 0.32) * (1 - 0.45 * f), {
      prof: x.prof || "round", tip: x.tip, teeth: x.teeth, r0: D * 0.04 * (1 - f), z0: f * D * (x.lift ?? 0.12), elev: (x.e0 ?? 10) * deg + f * (x.e1 ?? 65) * deg, bud: 85 * deg, phase: k * 0.62, curl: (x.curl ?? 0.6) + f * 0.4, ruffle: x.ruffle || 0, bend: (x.bend ?? 0.3) + f * 0.4, waves: x.waves,
    }));
  }
  return ws;
}
function rays(D, n, x = {}) { return [W_(n, D * 0.46, D * (x.wid || 0.1), { prof: x.prof || "spatula", tip: x.tip || "teeth", teeth: x.teeth || 3, r0: D * (x.r0 || 0.1), elev: (x.elev ?? 2) * deg, bud: 70 * deg, curl: x.curl ?? 0.15, bend: x.bend ?? -0.15, t: 0.9, phase: 0, ...x.more })]; }
const COLORS = {
  red: "#c8102e", crimson: "#9e1b32", pink: "#f28cb1", blush: "#f7c6d4", magenta: "#c2185b", white: "#f5f3ee", cream: "#f3e9c6", yellow: "#f6c90e", gold: "#e8a317", orange: "#f57c00", peach: "#f7a072",
  coral: "#ff6f61", purple: "#7b3fa0", lavender: "#a68fd0", lilac: "#c3a6e0", blue: "#3f6fd8", sky: "#7fb2f0", indigo: "#3b3c8c", violet: "#5e3a9b", green: "#5d9c3a", lime: "#a6c94a", brown: "#5b3a1e", black: "#2a2026",
};
const C = COLORS;
export const FLOWERS = [
  // ---- garden favourites
  { id: "rose", name: "Rose", cat: "Garden", colors: [C.red, C.pink, C.white, C.yellow, C.peach, C.coral], D: 50, whorls: (D) => doubles(D, 6, { n0: 5, n1: 2, e0: 18, e1: 62, curl: 0.9, bend: 0.5, lift: 0.18, wid: 0.36 }), center: { type: "bun", r: 3, h: 4 }, sepals: 5, leaf: "serrate", leaves: 3 },
  { id: "gardenrose", name: "Garden rose", cat: "Garden", colors: [C.blush, C.peach, C.white, C.pink], D: 60, whorls: (D) => doubles(D, 8, { n0: 7, n1: 4, e0: 8, e1: 55, curl: 0.7, bend: 0.4, lift: 0.1, ruffle: 0.08 }), center: { type: "bun", r: 3, h: 3 }, sepals: 5, leaf: "serrate", leaves: 3 },
  { id: "peony", name: "Peony", cat: "Garden", colors: [C.pink, C.blush, C.white, C.magenta, C.coral], D: 70, whorls: (D) => doubles(D, 9, { n0: 7, n1: 5, e0: 12, e1: 50, curl: 0.8, bend: 0.5, lift: 0.14, ruffle: 0.15, wid: 0.34 }), center: { type: "bun", r: 4, h: 4 }, sepals: 5, leaf: "lance", leaves: 3 },
  { id: "ranunculus", name: "Ranunculus", cat: "Garden", colors: [C.coral, C.yellow, C.white, C.pink, C.orange], D: 45, whorls: (D) => doubles(D, 10, { n0: 6, n1: 4, e0: 20, e1: 60, curl: 0.9, bend: 0.6, lift: 0.08, wid: 0.3, len: 0.85 }), center: { type: "bun", r: 3, h: 3, }, sepals: 5, leaf: "lance", leaves: 2 },
  { id: "camellia", name: "Camellia", cat: "Garden", colors: [C.red, C.pink, C.white], D: 55, whorls: (D) => doubles(D, 4, { n0: 7, n1: 2, e0: 10, e1: 50, curl: 0.4, bend: 0.2, lift: 0.08, wid: 0.4 }), center: { type: "stamens", n: 18, len: 9, r: 4, spread: 0.3, anther: true }, sepals: 5, leaf: "ovate", leaves: 3 },
  { id: "gardenia", name: "Gardenia", cat: "Garden", colors: [C.white, C.cream], D: 50, whorls: (D) => doubles(D, 4, { n0: 6, n1: 1, e0: 6, e1: 60, curl: 0.3, bend: -0.2, lift: 0.12, wid: 0.3, prof: "oval" }), center: { type: "bun", r: 2.5, h: 3 }, sepals: 5, leaf: "ovate", leaves: 4 },
  { id: "dahlia", name: "Dahlia", cat: "Garden", colors: [C.magenta, C.orange, C.red, C.pink, C.white, C.purple], D: 70, whorls: (D) => doubles(D, 8, { n0: 12, n1: 4, e0: 5, e1: 75, curl: 1.4, bend: 0.2, lift: 0.18, wid: 0.16, prof: "pointed", len: 0.95 }), center: { type: "bun", r: 3, h: 3 }, sepals: 8, leaf: "lance", leaves: 3 },
  { id: "pompom", name: "Pompom dahlia", cat: "Garden", colors: [C.magenta, C.orange, C.pink, C.yellow], D: 50, whorls: (D) => doubles(D, 9, { n0: 10, n1: 4, e0: -20, e1: 85, curl: 1.8, bend: 0.4, lift: 0.4, wid: 0.18, prof: "oval", len: 0.6 }), center: { type: "bun", r: 2, h: 2 }, sepals: 6, leaf: "lance", leaves: 2 },
  { id: "mum", name: "Chrysanthemum", cat: "Garden", colors: [C.yellow, C.white, C.orange, C.pink, C.crimson], D: 60, whorls: (D) => doubles(D, 7, { n0: 16, n1: 4, e0: 0, e1: 70, curl: 0.9, bend: 0.4, lift: 0.2, wid: 0.09, prof: "strap", len: 1 }), center: { type: "bun", r: 3, h: 3 }, sepals: 8, leaf: "oak", leaves: 3 },
  { id: "carnation", name: "Carnation", cat: "Garden", colors: [C.red, C.pink, C.white, C.peach, C.crimson], D: 45, whorls: (D) => doubles(D, 5, { n0: 5, n1: 2, e0: 20, e1: 60, curl: 0.5, bend: 0.2, lift: 0.1, wid: 0.36, prof: "fan", tip: "fringe", teeth: 9, ruffle: 0.25, waves: 7 }), center: { type: "bun", r: 2, h: 2 }, sepals: 5, calyx: true, leaf: "grass", leaves: 4 },
  { id: "zinnia", name: "Zinnia", cat: "Garden", colors: [C.magenta, C.orange, C.red, C.yellow, C.pink], D: 55, whorls: (D) => doubles(D, 5, { n0: 13, n1: 3, e0: 3, e1: 35, curl: 0.2, bend: 0, lift: 0.08, wid: 0.18, prof: "spatula", len: 0.95 }), center: { type: "cone", r: 5, h: 4 }, sepals: 8, leaf: "lance", leaves: 2 },
  { id: "marigold", name: "Marigold", cat: "Garden", colors: [C.orange, C.gold, C.yellow], D: 45, whorls: (D) => doubles(D, 7, { n0: 10, n1: 4, e0: 10, e1: 70, curl: 0.8, bend: 0.4, lift: 0.2, wid: 0.24, prof: "fan", tip: "fringe", teeth: 7, ruffle: 0.3 }), center: { type: "bun", r: 2, h: 2 }, sepals: 6, leaf: "fern", leaves: 3 },
  { id: "cosmos", name: "Cosmos", cat: "Garden", colors: [C.pink, C.white, C.magenta, C.orange], D: 60, whorls: (D) => [W_(8, D * 0.42, D * 0.22, { prof: "fan", tip: "teeth", teeth: 4, r0: D * 0.08, elev: 5 * deg, curl: 0.15 })], center: { type: "disc", r: 5, h: 3, seeds: true }, sepals: 8, leaf: "fern", leaves: 3 },
  { id: "daisy", name: "Daisy", cat: "Garden", colors: [C.white, C.pink, C.yellow], center0: C.yellow, D: 45, whorls: (D) => rays(D, 21, { wid: 0.11 }), center: { type: "disc", r: 6, h: 3, seeds: true }, sepals: 10, leaf: "spoon", leaves: 3 },
  { id: "gerbera", name: "Gerbera", cat: "Garden", colors: [C.orange, C.red, C.pink, C.yellow, C.white], center0: C.brown, D: 70, whorls: (D) => [...rays(D, 18, { wid: 0.13 }), ...rays(D * 0.82, 16, { wid: 0.1, more: { phase: 0.5, z0: 1.2, elev: 10 * deg } })], center: { type: "disc", r: 9, h: 4, seeds: true }, sepals: 12, leaf: "spoon", leaves: 3 },
  { id: "sunflower", name: "Sunflower", cat: "Garden", colors: [C.yellow, C.gold, C.orange], center0: C.brown, D: 90, whorls: (D) => [...rays(D, 22, { wid: 0.12, prof: "pointed", tip: "point", r0: 0.18 }), ...rays(D * 0.95, 20, { wid: 0.11, prof: "pointed", tip: "point", r0: 0.18, more: { phase: 0.5, z0: -1, elev: 12 * deg } })], center: { type: "disc", r: 17, h: 6, seeds: true }, sepals: 18, leaf: "heart", leaves: 2 },
  { id: "coneflower", name: "Coneflower", cat: "Garden", colors: [C.magenta, C.pink, C.white, C.orange], center0: C.orange, D: 70, whorls: (D) => rays(D, 13, { wid: 0.14, prof: "lance", elev: -30, bend: -0.2 }), center: { type: "cone", r: 9, h: 11 }, sepals: 10, leaf: "lance", leaves: 2 },
  { id: "rudbeckia", name: "Black-eyed Susan", cat: "Wildflowers", colors: [C.gold, C.yellow, C.orange], center0: C.brown, D: 55, whorls: (D) => rays(D, 13, { wid: 0.15, prof: "oval", elev: -8 }), center: { type: "dome", r: 7, h: 6 }, sepals: 10, leaf: "lance", leaves: 3 },
  { id: "aster", name: "Aster", cat: "Garden", colors: [C.lavender, C.purple, C.pink, C.white], center0: C.yellow, D: 40, whorls: (D) => [...rays(D, 26, { wid: 0.06, prof: "strap", tip: "point" }), ...rays(D * 0.9, 24, { wid: 0.06, prof: "strap", tip: "point", more: { phase: 0.5, z0: 1, elev: 15 * deg } })], center: { type: "disc", r: 5, h: 3, seeds: true }, sepals: 10, leaf: "lance", leaves: 3 },
  { id: "anemone", name: "Anemone", cat: "Garden", colors: [C.white, C.red, C.purple, C.pink, C.blue], center0: C.black, D: 55, whorls: (D) => [W_(6, D * 0.45, D * 0.36, { prof: "round", r0: D * 0.06, elev: 18 * deg, curl: 0.35 }), W_(5, D * 0.38, D * 0.32, { r0: D * 0.05, z0: 1.5, phase: 0.6, elev: 28 * deg, curl: 0.4 })], center: { type: "stamens", n: 16, len: 7, r: 6, spread: 0.6, anther: true }, sepals: 0, leaf: "fern", leaves: 3 },
  { id: "poppy", name: "Poppy", cat: "Wildflowers", colors: [C.red, C.orange, C.white, C.pink, C.yellow], center0: C.black, D: 60, whorls: (D) => [W_(2, D * 0.48, D * 0.6, { prof: "round", r0: D * 0.05, elev: 25 * deg, curl: 0.55, ruffle: 0.12 }), W_(2, D * 0.44, D * 0.56, { r0: D * 0.05, phase: Math.PI / 2, z0: 1.5, elev: 35 * deg, curl: 0.6, ruffle: 0.12 })], center: { type: "pod", r: 6, h: 8 }, sepals: 0, leaf: "fern", leaves: 2, hairy: true },
  { id: "pansy", noHinge: true, name: "Pansy", cat: "Garden", colors: [C.purple, C.yellow, C.blue, C.white, C.orange], center0: C.yellow, D: 45, whorls: (D) => [W_(2, D * 0.42, D * 0.42, { r0: 2, elev: 50 * deg, phase: 1.9, curl: 0.25 }), W_(2, D * 0.38, D * 0.38, { r0: 2, elev: 30 * deg, phase: 0.8, curl: 0.25 }), W_(1, D * 0.45, D * 0.5, { r0: 2, elev: 10 * deg, phase: -Math.PI / 2, curl: 0.2 })], center: { type: "bun", r: 2.5, h: 2.5 }, sepals: 5, leaf: "ovate", leaves: 3 },
  { id: "violet", noHinge: true, name: "Violet", cat: "Wildflowers", colors: [C.violet, C.purple, C.white], center0: C.yellow, D: 28, whorls: (D) => [W_(2, D * 0.42, D * 0.34, { r0: 1, elev: 55 * deg, phase: 1.9 }), W_(2, D * 0.4, D * 0.32, { r0: 1, elev: 25 * deg, phase: 0.6 }), W_(1, D * 0.46, D * 0.4, { r0: 1, elev: 0, phase: -Math.PI / 2 })], center: { type: "bun", r: 1.5, h: 1.5 }, sepals: 5, leaf: "heart", leaves: 2 },
  { id: "lisianthus", name: "Lisianthus", cat: "Garden", colors: [C.lilac, C.white, C.blush, C.purple], D: 50, whorls: (D) => doubles(D, 3, { n0: 5, n1: 0, e0: 45, e1: 25, curl: 0.5, bend: -0.2, lift: 0.1, wid: 0.45, twist: 0.3, ruffle: 0.1 }), center: { type: "stamens", n: 5, len: 12, r: 2, spread: 0.2, pistil: true }, sepals: 5, leaf: "ovate", leaves: 3 },
  { id: "clematis", name: "Clematis", cat: "Garden", colors: [C.purple, C.lavender, C.white, C.pink], center0: C.cream, D: 70, whorls: (D) => [W_(6, D * 0.48, D * 0.2, { prof: "pointed", r0: D * 0.04, elev: 2 * deg, curl: 0.1, ruffle: 0.08 })], center: { type: "stamens", n: 24, len: 9, r: 5, spread: 0.45, anther: true }, sepals: 0, leaf: "ovate", leaves: 2 },
  { id: "edelweiss", name: "Edelweiss", cat: "Wildflowers", colors: [C.white, C.cream], center0: C.cream, D: 40, whorls: (D) => [W_(9, D * 0.45, D * 0.14, { prof: "lance", r0: D * 0.12, elev: 5 * deg, curl: 0.2 })], center: { type: "dome", r: 7, h: 4 }, sepals: 0, leaf: "grass", leaves: 3 },
  { id: "forgetmenot", name: "Forget-me-not", cat: "Wildflowers", colors: [C.sky, C.blue, C.pink], center0: C.yellow, D: 12, form: "cluster", cluster: { n: 18, R: 14, flat: 0.6 }, whorls: (D) => [W_(5, D * 0.45, D * 0.42, { r0: 0.5, elev: 4 * deg, res: "lo" })], center: { type: "bun", r: 1.2, h: 1 }, leaf: "spoon", leaves: 3 },
  // ---- spring bulbs
  { id: "tulip", name: "Tulip", cat: "Spring bulbs", colors: [C.red, C.yellow, C.pink, C.purple, C.white, C.orange], D: 45, whorls: (D) => [W_(3, D * 0.75, D * 0.62, { prof: "oval", r0: 2, elev: 72 * deg, bud: 86 * deg, curl: 0.9, bend: -0.2 }), W_(3, D * 0.72, D * 0.6, { prof: "oval", r0: 2.5, phase: Math.PI / 3, elev: 68 * deg, bud: 84 * deg, curl: 0.9, bend: -0.2 })], center: { type: "stamens", n: 6, len: 10, r: 2, spread: 0.2, pistil: true }, sepals: 0, leaf: "strap", leaves: 2 },
  { id: "daffodil", name: "Daffodil", cat: "Spring bulbs", colors: [C.yellow, C.white, C.cream], center0: C.orange, D: 55, whorls: (D) => [W_(6, D * 0.42, D * 0.28, { prof: "oval", tip: "point", r0: D * 0.06, elev: 8 * deg, curl: 0.15 })], center: { type: "trumpet", r0: 6, r1: 10, len: 18, ruffle: 0.08, waves: 12 }, sepals: 0, leaf: "strap", leaves: 2, nod: 30 },
  { id: "crocus", name: "Crocus", cat: "Spring bulbs", colors: [C.purple, C.yellow, C.white, C.lavender], center0: C.orange, D: 35, whorls: (D) => [W_(3, D * 0.75, D * 0.36, { prof: "oval", r0: 1.5, elev: 62 * deg, curl: 0.6 }), W_(3, D * 0.7, D * 0.34, { prof: "oval", r0: 1.5, elev: 58 * deg, phase: Math.PI / 3, curl: 0.6 })], center: { type: "stamens", n: 3, len: 14, r: 1.5, spread: 0.25, anther: true }, sepals: 0, leaf: "grass", leaves: 3 },
  { id: "hyacinth", name: "Hyacinth", cat: "Spring bulbs", colors: [C.blue, C.pink, C.white, C.purple, C.lilac], D: 14, form: "spike", spike: { n: 34, from: 0.6, R: 11, out: 0.2 }, whorls: (D) => [W_(6, D * 0.42, D * 0.22, { prof: "pointed", r0: 1, elev: -10 * deg, bend: -0.6, res: "lo" })], center: { type: "trumpet", r0: 1.6, r1: 2.6, len: 4 }, leaf: "strap", leaves: 3 },
  { id: "iris", name: "Iris", cat: "Spring bulbs", colors: [C.violet, C.blue, C.purple, C.yellow, C.white], center0: C.yellow, D: 70, whorls: (D) => [W_(3, D * 0.5, D * 0.3, { prof: "oval", r0: 2, elev: 10 * deg, bend: -1.1, curl: 0.3, ruffle: 0.1 }), W_(3, D * 0.45, D * 0.26, { prof: "oval", r0: 1.5, z0: 3, phase: Math.PI / 3, elev: 70 * deg, bend: 0.5, curl: 0.5, ruffle: 0.12 })], center: { type: "bun", r: 2, h: 3 }, sepals: 0, leaf: "sword", leaves: 2 },
  { id: "bluebell", name: "Bluebell", cat: "Spring bulbs", colors: [C.blue, C.violet, C.white, C.pink], D: 14, form: "spike", spike: { n: 9, from: 0.55, R: 6, out: -0.7, oneSide: true, droop: 0.4 }, whorls: (D) => [W_(6, D * 0.9, D * 0.36, { prof: "oval", r0: 1, elev: 70 * deg, bend: -0.9, curl: 0.5, res: "lo" })], center: { type: "bun", r: 1, h: 1 }, leaf: "strap", leaves: 3 },
  // ---- lilies and tropical
  { id: "lily", name: "Lily", cat: "Lilies & orchids", colors: [C.pink, C.white, C.orange, C.yellow, C.magenta], D: 90, whorls: (D) => [W_(3, D * 0.5, D * 0.2, { prof: "pointed", r0: 2, elev: 40 * deg, bend: -0.7, curl: 0.3, ruffle: 0.06 }), W_(3, D * 0.48, D * 0.17, { prof: "pointed", r0: 2, phase: Math.PI / 3, elev: 45 * deg, bend: -0.8, curl: 0.25 })], center: { type: "stamens", n: 6, len: 28, r: 2, spread: 0.3, pistil: true, anther: true }, sepals: 0, leaf: "lance", leaves: 4 },
  { id: "tigerlily", name: "Tiger lily", cat: "Lilies & orchids", colors: [C.orange, C.red, C.yellow], D: 70, whorls: (D) => [W_(6, D * 0.5, D * 0.17, { prof: "pointed", r0: 2, elev: 30 * deg, bend: -2.2, curl: 0.2, phase: 0 })], center: { type: "stamens", n: 6, len: 26, r: 2, spread: 0.45, pistil: true, anther: true }, sepals: 0, leaf: "lance", leaves: 6, nod: 50 },
  { id: "calla", name: "Calla lily", cat: "Lilies & orchids", colors: [C.white, C.yellow, C.purple, C.peach, C.black], center0: C.yellow, D: 45, whorls: (D) => [W_(1, D * 1.3, D * 1.05, { prof: "heart", tip: "point", r0: 0, elev: 70 * deg, bend: -0.6, curl: 2.4, base: 0.6 })], center: { type: "spadix", len: 22, r: 2.4 }, sepals: 0, leaf: "heart", leaves: 2 },
  { id: "orchid", noHinge: true, name: "Orchid", cat: "Lilies & orchids", colors: [C.white, C.magenta, C.pink, C.purple, C.yellow], center0: C.yellow, D: 70, whorls: (D) => [W_(3, D * 0.45, D * 0.24, { prof: "oval", r0: 2, elev: 5 * deg, phase: Math.PI / 2, curl: 0.2 }), W_(2, D * 0.42, D * 0.42, { prof: "round", r0: 2, elev: 8 * deg, phase: 0, z0: 1, curl: 0.2 }), W_(1, D * 0.3, D * 0.28, { prof: "heart", tip: "notch", r0: 3, z0: 3, elev: 40 * deg, phase: -Math.PI / 2, curl: 1.2 })], center: { type: "bun", r: 2.5, h: 4 }, sepals: 0, leaf: "ovate", leaves: 2, arch: true },
  { id: "hibiscus", name: "Hibiscus", cat: "Tropical", colors: [C.red, C.pink, C.orange, C.yellow, C.white], center0: C.yellow, D: 90, whorls: (D) => [W_(5, D * 0.48, D * 0.44, { prof: "fan", r0: 2, elev: 25 * deg, curl: 0.25, ruffle: 0.12, twist: 0.25 })], center: { type: "stamens", n: 10, len: 36, r: 1.5, spread: 0.15, pistil: true, anther: true }, sepals: 5, leaf: "ovate", leaves: 3 },
  { id: "plumeria", name: "Plumeria", cat: "Tropical", colors: [C.white, C.pink, C.yellow, C.red], center0: C.yellow, D: 55, whorls: (D) => [W_(5, D * 0.5, D * 0.3, { prof: "spatula", r0: 2, elev: 15 * deg, curl: 0.2, twist: 0.6, bend: -0.3 })], center: { type: "trumpet", r0: 2, r1: 2.6, len: 4 }, sepals: 0, leaf: "lance", leaves: 4 },
  { id: "lotus", name: "Lotus", cat: "Tropical", colors: [C.pink, C.white, C.blush], center0: C.yellow, D: 85, whorls: (D) => doubles(D, 3, { n0: 8, n1: -2, e0: 25, e1: 45, curl: 0.8, bend: 0.2, lift: 0.08, wid: 0.36, prof: "oval", tip: "point" }), center: { type: "pod", r: 9, h: 7 }, sepals: 0, leaf: "pad", leaves: 1 },
  { id: "waterlily", name: "Water lily", cat: "Tropical", colors: [C.white, C.pink, C.yellow, C.lilac], center0: C.yellow, D: 75, whorls: (D) => doubles(D, 4, { n0: 9, n1: -2, e0: 2, e1: 55, curl: 0.4, bend: 0.1, lift: 0.08, wid: 0.18, prof: "pointed", tip: "point" }), center: { type: "stamens", n: 24, len: 8, r: 6, spread: 0.3, anther: true }, sepals: 0, leaf: "pad", leaves: 1 },
  { id: "passion", name: "Passion flower", cat: "Tropical", colors: [C.white, C.lavender, C.purple], center0: C.purple, D: 75, whorls: (D) => [W_(10, D * 0.45, D * 0.15, { prof: "oval", r0: 2, elev: 2 * deg, curl: 0.15 })], center: { type: "filaments", r: 5, r1: 30 }, sepals: 0, leaf: "palm", leaves: 2 },
  { id: "protea", name: "King protea", cat: "Tropical", colors: [C.pink, C.blush, C.cream, C.red], center0: C.cream, D: 85, whorls: (D) => doubles(D, 3, { n0: 12, n1: 2, e0: 50, e1: 25, curl: 0.5, bend: 0.1, lift: 0.04, wid: 0.15, prof: "pointed", tip: "point", len: 1.05 }), center: { type: "dome", r: 18, h: 16 }, sepals: 0, leaf: "lance", leaves: 3 },
  { id: "birdofparadise", noHinge: true, name: "Bird of paradise", cat: "Tropical", colors: [C.orange, C.gold], center0: C.blue, D: 90, whorls: (D) => [W_(3, D * 0.5, D * 0.1, { prof: "lance", r0: 0, elev: 65 * deg, phase: Math.PI / 2, curl: 0.4 }), W_(1, D * 0.45, D * 0.07, { prof: "lance", r0: 0, z0: 2, elev: 55 * deg, phase: Math.PI / 2 + 0.6, curl: 0.5, t: 1.4 })], center: { type: "spadix", len: 6, r: 3 }, sepals: 0, leaf: "paddle", leaves: 2, beak: true },
  { id: "magnolia", name: "Magnolia", cat: "Trees & shrubs", colors: [C.blush, C.white, C.pink, C.magenta], D: 80, whorls: (D) => [W_(3, D * 0.5, D * 0.3, { prof: "oval", r0: 3, elev: 40 * deg, curl: 0.8, bend: 0.2 }), W_(3, D * 0.48, D * 0.28, { prof: "oval", r0: 3, phase: Math.PI / 3, elev: 60 * deg, curl: 0.9, bend: 0.2, z0: 2 })], center: { type: "cone", r: 5, h: 14 }, sepals: 0, leaf: "ovate", leaves: 2 },
  { id: "cherry", name: "Cherry blossom", cat: "Trees & shrubs", colors: [C.blush, C.pink, C.white], center0: C.pink, D: 35, whorls: (D) => [W_(5, D * 0.42, D * 0.36, { prof: "heart", tip: "notch", r0: 1, elev: 18 * deg, curl: 0.3 })], center: { type: "stamens", n: 18, len: 7, r: 2, spread: 0.6, anther: true }, sepals: 5, leaf: "serrate", leaves: 2 },
  { id: "apple", name: "Apple blossom", cat: "Trees & shrubs", colors: [C.white, C.blush, C.pink], center0: C.yellow, D: 38, whorls: (D) => [W_(5, D * 0.44, D * 0.4, { prof: "round", r0: 1, elev: 20 * deg, curl: 0.45 })], center: { type: "stamens", n: 14, len: 7, r: 2, spread: 0.45, anther: true }, sepals: 5, leaf: "ovate", leaves: 2 },
  { id: "hydrangea", name: "Hydrangea", cat: "Trees & shrubs", colors: [C.sky, C.blue, C.pink, C.lilac, C.white, C.lime], D: 16, form: "cluster", cluster: { n: 46, R: 30, flat: 0.85 }, whorls: (D) => [W_(4, D * 0.48, D * 0.46, { prof: "round", r0: 0.5, elev: 6 * deg, curl: 0.2, res: "lo" })], center: { type: "bun", r: 1.2, h: 1 }, leaf: "ovate", leaves: 3 },
  { id: "lilac", name: "Lilac", cat: "Trees & shrubs", colors: [C.lilac, C.lavender, C.white, C.purple], D: 9, form: "spike", spike: { n: 46, from: 0.55, R: 14, out: 0.3, cone: true }, whorls: (D) => [W_(4, D * 0.45, D * 0.4, { r0: 0.4, elev: 8 * deg, res: "lo" })], center: { type: "bun", r: 0.9, h: 0.8 }, leaf: "heart", leaves: 2 },
  { id: "morningglory", name: "Morning glory", cat: "Wildflowers", colors: [C.blue, C.purple, C.pink, C.white], center0: C.white, D: 60, whorls: (D) => [], center: { type: "trumpet", r0: 3, r1: 28, len: 26, ruffle: 0.05, waves: 5 }, sepals: 5, leaf: "heart", leaves: 3 },
  // ---- spikes and clusters
  { id: "lavender", name: "Lavender", cat: "Spikes & clusters", colors: [C.lavender, C.purple, C.violet], D: 5, form: "spike", spike: { n: 44, from: 0.7, R: 4, out: 0.6, bud: true }, whorls: (D) => [], center: { type: "bun", r: 2, h: 2.6 }, leaf: "grass", leaves: 4 },
  { id: "snapdragon", name: "Snapdragon", cat: "Spikes & clusters", colors: [C.pink, C.yellow, C.white, C.red, C.orange], D: 20, form: "spike", spike: { n: 14, from: 0.55, R: 9, out: 0.1 }, whorls: (D) => [W_(2, D * 0.45, D * 0.5, { r0: 1, elev: 40 * deg, curl: 0.7, res: "lo", phase: Math.PI / 2 }), W_(1, D * 0.5, D * 0.55, { r0: 1, elev: 15 * deg, curl: 0.8, res: "lo", phase: -Math.PI / 2 })], center: { type: "bun", r: 2, h: 3 }, leaf: "lance", leaves: 4 },
  { id: "foxglove", name: "Foxglove", cat: "Spikes & clusters", colors: [C.magenta, C.pink, C.white, C.purple], D: 18, form: "spike", spike: { n: 14, from: 0.5, R: 9, out: -0.6, oneSide: true, droop: 0.5 }, whorls: (D) => [], center: { type: "trumpet", r0: 4, r1: 6, len: 20, ruffle: 0.1, waves: 5 }, leaf: "lance", leaves: 4 },
  { id: "delphinium", name: "Delphinium", cat: "Spikes & clusters", colors: [C.blue, C.sky, C.purple, C.white], center0: C.white, D: 22, form: "spike", spike: { n: 18, from: 0.5, R: 11, out: 0.25 }, whorls: (D) => [W_(5, D * 0.45, D * 0.4, { r0: 1, elev: 8 * deg, res: "lo", curl: 0.2 })], center: { type: "bun", r: 2, h: 2 }, leaf: "palm", leaves: 3 },
  { id: "lupine", name: "Lupine", cat: "Spikes & clusters", colors: [C.purple, C.blue, C.pink, C.yellow, C.white], D: 10, form: "spike", spike: { n: 40, from: 0.6, R: 9, out: 0.3, cone: true }, whorls: (D) => [W_(3, D * 0.5, D * 0.45, { r0: 0.5, elev: 40 * deg, res: "lo", curl: 0.6 })], center: { type: "bun", r: 1, h: 1 }, leaf: "palm", leaves: 3 },
  { id: "gladiolus", name: "Gladiolus", cat: "Spikes & clusters", colors: [C.red, C.pink, C.white, C.orange, C.yellow], D: 40, form: "spike", spike: { n: 9, from: 0.45, R: 14, out: 0.0, oneSide: true }, whorls: (D) => [W_(3, D * 0.45, D * 0.36, { r0: 1, elev: 30 * deg, curl: 0.5, ruffle: 0.1, res: "lo" }), W_(3, D * 0.42, D * 0.34, { r0: 1, elev: 40 * deg, phase: Math.PI / 3, curl: 0.5, res: "lo" })], center: { type: "bun", r: 2, h: 3 }, leaf: "sword", leaves: 2 },
  { id: "allium", name: "Allium", cat: "Spikes & clusters", colors: [C.purple, C.lavender, C.white], D: 10, form: "cluster", cluster: { n: 60, R: 30, flat: 0 }, whorls: (D) => [W_(6, D * 0.42, D * 0.14, { prof: "pointed", r0: 0.3, elev: 30 * deg, res: "lo" })], center: { type: "bun", r: 0.8, h: 0.8 }, leaf: "strap", leaves: 2 },
  { id: "queenanne", name: "Queen Anne's lace", cat: "Spikes & clusters", colors: [C.white, C.cream, C.blush], D: 7, form: "cluster", cluster: { n: 70, R: 34, flat: 1, umbel: true }, whorls: (D) => [W_(5, D * 0.45, D * 0.4, { r0: 0.3, elev: 4 * deg, res: "lo" })], center: { type: "bun", r: 0.6, h: 0.5 }, leaf: "fern", leaves: 2 },
  { id: "babysbreath", name: "Baby's breath", cat: "Fillers & greenery", colors: [C.white, C.blush, C.lilac], D: 5, form: "spray", spray: { n: 30, R: 38 }, whorls: (D) => [], center: { type: "bun", r: 2.2, h: 2 }, leaf: "none", leaves: 0 },
  { id: "eucalyptus", name: "Eucalyptus", cat: "Fillers & greenery", colors: [C.lime, C.green], D: 0, form: "greenery", leaf: "round", leaves: 14 },
  { id: "fern", name: "Fern", cat: "Fillers & greenery", colors: [C.green, C.lime], D: 0, form: "greenery", leaf: "frond", leaves: 1 },
  { id: "wheat", name: "Wheat", cat: "Fillers & greenery", colors: [C.gold, C.cream], D: 4, form: "spike", spike: { n: 26, from: 0.75, R: 3, out: 0.75, bud: true }, whorls: (D) => [], center: { type: "bun", r: 2, h: 3.2 }, leaf: "grass", leaves: 2 },
];
export const FLOWER_CATS = [...new Set(FLOWERS.map((f) => f.cat))];
export const byId = (id) => FLOWERS.find((f) => f.id === id) || FLOWERS[0];
export const METAL = { petal: ["#b8c4cf", "#c9a24a", "#b87333", "#5f7a8a", "#9a5ab8"], center: "#d4a017", stem: "#6e7882", leaf: "#7f8f7a" };

// ------------------------------------------------------------------ one flower head
// returns { petals: [{ mesh, M0 (placement without opening), pivot data }], center, sepals, hub, size }
export function flowerHead(sp, o) {
  const D = sp.D * (o.scale || 1), mech = o.style === "mech";
  const whorls = (sp.whorls ? sp.whorls(D) : []).map((w) => ({ ...w }));
  // hinged petals: pins on a hub, knuckles on the petals (only whorls with room for them)
  const hinge = o.petals === "hinged";
  // print-in-place clearances (FDM, 0.4 mm nozzle): 0.4 mm round the pin and at the knuckle ends,
  // 0.5 mm between neighbouring petals; the pin is 2 mm thick
  const pinR = 1.0, clear = o.clear ?? 0.4, knuckle = pinR + clear + 1.2, ear = 1.6, gap = 0.5;
  const ho = { ...o, pinR, clear, knuckle, gap, knuckleLen: (w) => Math.max(2.5, Math.min(w.W * 0.75, (2 * Math.PI * w.hubR) / (w.nRing || w.n) - 2 * ear - 2 * clear - 0.6)) };
  const petals = [], hub = mk(), hubParts = []; // hubParts: for checking clearances
  const hubPut = (name, m, M) => { put(hub, m, M); if (o.debugHub) hubParts.push({ name, mesh: put(mk(), m, M) }); };
  // many petals (dahlias, mums): a lighter grid each, so the flower stays printable and quick
  const total = whorls.reduce((s2, w) => s2 + w.n, 0);
  if (total > 45) for (const w of whorls) if (!w.res) w.res = total > 90 ? "lo2" : "mid";
  // hinges: the outer petals (with the next ring too when a flower has only two, like a tulip's 3 + 3),
  // up to 12 round one hub ring made big enough to hold them all
  const room = 2.5 + 2 * ear + 2 * clear + 0.6;
  // (not flowers with petals at uneven angles: pansy, violet, orchid, bird of paradise)
  let ring = hinge && !sp.noHinge ? whorls.filter((w, wi) => (wi === 0 || whorls.length <= 2) && w.res !== "lo") : [];
  if (ring.reduce((a, w) => a + w.n, 0) > 12) ring = ring.slice(0, 1).filter((w) => w.n <= 12);
  const nRing = ring.reduce((a, w) => a + w.n, 0);
  const hubR = ring.length ? Math.max(...ring.map((w) => w.r0), D * 0.12, (nRing * room) / (2 * Math.PI)) : 0;
  if (hubR >= D * 0.4) ring = [];
  const z0h = ring.length ? ring[0].z0 : 0, rt = z0h - knuckle - clear - 0.1; // rt: top of the hub ring
  for (const w of ring) { w.canHinge = true; w.hubR = hubR; w.r0 = hubR; w.z0 = z0h; w.nRing = nRing; }
  // snap-in: the same choice of petals (up to 16, at least 12 mm long), on a crown of slotted panels
  // big enough that each panel is at least the slot plus 1.8 mm each side
  const snap = o.petals === "snap" && !sp.noHinge;
  let sRing = snap ? whorls.filter((w, wi) => (wi === 0 || whorls.length <= 2) && w.L >= 12 && w.W >= 5) : [];
  if (sRing.reduce((a, w) => a + w.n, 0) > 16) sRing = sRing.slice(0, 1).filter((w) => w.n <= 16);
  const nS = sRing.reduce((a, w) => a + w.n, 0);
  // (two rings of petals, like a tulip's 3 + 3, share one angle so their panels make an even crown)
  // (in a kit the crown leans no more than 40 degrees, so it prints without supports)
  const eS = sRing.length ? Math.min(o.kit ? 40 * deg : Infinity, sRing.reduce((a, w) => a + (w.elev || 0) * w.n, 0) / nS) : 0;
  // the crown's radius: each panel, measured at its inner face and its narrowest edge (panels lean
  // with the petals), must still hold the slot with 1.8 mm each side
  const HpS = SNAP_SLOT_H + 2 * SNAP.lip;
  const rS = nS ? Math.max(...sRing.map((w) => w.r0), D * 0.12, (SNAP_SLOT_W / 2 + 1.8) / Math.tan(Math.PI / Math.max(3, nS)) + SNAP.wall * Math.cos(eS) + (HpS / 2) * Math.abs(Math.sin(eS)), o.kit ? 10.5 : 9) : 0;
  if (rS >= D * 0.45) sRing = [];
  const z0s = sRing.length ? sRing[0].z0 : 0;
  for (const w of sRing) { w.canSnap = true; w.r0 = rS; w.z0 = z0s; w.nRing = nS; w.elev = eS; }
  if (sRing.length) { const e0 = Math.max(...sRing.map((w) => w.elev || 0)); for (const w of whorls) if (!w.canSnap) { w.elev = Math.max(w.elev || 0, e0 + 15 * deg); w.r0 = Math.min(w.r0, Math.max(1, rS - SNAP.wall - SNAP.behind - 1.7)); w.inner = true; } }
  // inner petals of a double flower stand a little more upright than the hinged ring, clear of it
  if (ring.length) { const e0 = Math.max(...ring.map((w) => w.elev || 0)); for (const w of whorls) if (!w.canHinge) w.elev = Math.max(w.elev || 0, e0 + 25 * deg); }
  let zTop = 0;
  whorls.forEach((w) => {
    const m = petalMesh(w, ho);
    for (let i = 0; i < w.n; i++) {
      const az = w.phase + (i / w.n) * Math.PI * 2;
      petals.push({ mesh: m, az, r0: w.r0, z0: w.z0, elev: w.elev, bud: w.bud ?? 80 * deg, hinged: w.canHinge, snap: !!w.canSnap, inner: !!w.inner });
      if (w.canHinge) {
        // the pin across the knuckle, held by two ears on the hub ring
        const kl = ho.knuckleLen(w), L2 = kl / 2 + clear + ear;
        const P = new THREE.Matrix4().makeTranslation(Math.cos(az) * w.r0, Math.sin(az) * w.r0, w.z0).multiply(new THREE.Matrix4().makeRotationZ(az));
        hubPut("pin " + i, tube([[0, -L2, 0], [0, L2, 0]], pinR, 12), P);
        // each ear: a disc round the pin (no bigger than the knuckle) and a post down to the hub ring,
        // on the hub's side, so nothing sticks out into the petal's swing
        const ringTop = rt - z0h;
        for (const s of [-1, 1]) {
          const yc = s * (kl / 2 + clear + ear / 2);
          hubPut("ear disc " + i, lathe([[1e-4, -ear / 2], [knuckle, -ear / 2], [knuckle, ear / 2], [1e-4, ear / 2]], 24), P.clone().multiply(new THREE.Matrix4().makeTranslation(0, yc, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
          hubPut("ear post " + i, box(knuckle, ear, -ringTop + 0.4), P.clone().multiply(new THREE.Matrix4().makeTranslation(-knuckle / 2, yc, ringTop - 0.4)));
        }
      }
    }
    zTop = Math.max(zTop, w.z0);
  });
  if (petals.some((p) => p.hinged)) {
    // the hub: a ring under the pins, on a post down to the stem
    const rr = hubR; // (its top is below the knuckles by the clearance)
    hubPut("ring", lathe([[1e-4, rt - 2.5], [rr, rt - 2.5], [rr, rt], [1e-4, rt]], 32));
    for (const w of whorls) if (w.canHinge) hubPut("post", lathe([[1e-4, rt - 2.5], [w.hubR - knuckle - clear - 0.6, rt - 2.5], [w.hubR - knuckle - clear - 0.6, w.z0 + 0.5], [1e-4, w.z0 + 0.5]], 24));
  }
  const center = sp.center ? centerMesh(sp.center, o, D) : null;
  let rtS = null, kitInfo = null;
  if (petals.some((p) => p.snap)) {
    // the crown: a slotted panel facing each snap-in petal, a ring and a disc joining their bottoms,
    // and a post up the middle to a cap that carries the centre (and a double flower's inner petals),
    // all clear of the tabs' prongs inside
    const sp2 = petals.filter((p) => p.snap), Hp = SNAP_SLOT_H + 2 * SNAP.lip, n = sp2.length;
    let low = Infinity, prongLow = Infinity, prongHigh = -Infinity, ra = Infinity, rb = 0;
    const corners = [];
    for (const p of sp2) {
      // half-width at height z (in the panel): its slice of the crown at the inner face, just meeting the next panel
      const hw = (z) => Math.max(SNAP_SLOT_W / 2 + 1.5, (p.r0 - SNAP.wall * Math.cos(p.elev) - z * Math.sin(p.elev)) * Math.tan(Math.PI / n) + 0.3), M = petalMatrix(p, 1);
      hubPut("panel", snapPanel(hw, Hp), M);
      for (const x of [-SNAP.wall, 0]) for (const z of [-Hp / 2, Hp / 2]) for (const y of [-hw(z), hw(z)]) { const v = new THREE.Vector3(x, y, z).applyMatrix4(M); corners.push(v); low = Math.min(low, v.z); }
      for (const x of [-(SNAP.wall + SNAP.behind), 0.3]) for (const y of [-(SNAP.tabW / 2 + SNAP.barb), SNAP.tabW / 2 + SNAP.barb]) for (const z of [-SNAP.t / 2, SNAP.t / 2]) { const v = new THREE.Vector3(x, y, z).applyMatrix4(M); prongLow = Math.min(prongLow, v.z); prongHigh = Math.max(prongHigh, v.z); }
    }
    for (const v of corners) if (v.z < low + (o.kit ? SNAP.wall * Math.sin(eS) + 0.5 : 1.0)) { const r = Math.hypot(v.x, v.y); ra = Math.min(ra, r); rb = Math.max(rb, r); }
    const zd1 = Math.min(low + 0.8, prongLow - 0.8), zd0 = zd1 - 2.2;
    // (a kit's ring rises to cover the leaning panels' bottom edges, so none of them overhang)
    // (a kit's ring follows the leaning panels' bottom edges with a sloping top, holding them up so
    // they don't overhang, and staying clear of the slots above)
    const ringTop = low + 0.8;
    if (o.kit) ra = Math.min(ra, rS - SNAP.wall * Math.cos(eS) + (Hp / 2) * Math.sin(eS) - 0.4);
    const rTopIn = o.kit ? low + 0.3 : ringTop, rTopOut = o.kit ? low + SNAP.wall * Math.sin(eS) + 0.3 : ringTop;
    hubPut("ring", outward(lathe([[Math.max(0.5, ra - 0.3), zd1 - 0.2], [rb + 0.3, zd1 - 0.2], [rb + 0.3, rTopOut], [Math.max(0.5, ra - 0.3), rTopIn]], 48)));
    const capZ = Math.max(prongHigh + 0.7, z0s + 0.5), capR = Math.max(2.6, rS - SNAP.wall - SNAP.behind - 1.2);
    // (a kit makes its own base, post and neck: see kitHead)
    if (o.kit) kitInfo = { zd1, capZ, rS, rb: rb + 0.3, z0s, eS, low };
    else {
      hubPut("disc", lathe([[1e-4, zd0], [rb + 0.3, zd0], [rb + 0.3, zd1], [1e-4, zd1]], 48));
      hubPut("post", lathe([[1e-4, zd0 + 0.5], [2.2, zd0 + 0.5], [2.2, capZ + 0.3], [1e-4, capZ + 0.3]], 24));
      hubPut("cap", lathe([[1e-4, capZ], [capR, capZ], [capR, capZ + 1.0], [1e-4, capZ + 1.0]], 32));
    }
    // inner (fixed) petals of a double flower sit on the cap
    for (const p of petals) if (p.inner) p.z0 = Math.max(p.z0, capZ + 0.6);
    rtS = zd0 + 2.3; // for the sepals, under the disc
    if (center) {
      // the centre sits on the cap, no wider than it
      let rc = 0, zmin = Infinity; for (let i = 0; i < center.V.length; i += 3) { rc = Math.max(rc, Math.hypot(center.V[i], center.V[i + 1])); zmin = Math.min(zmin, center.V[i + 2]); }
      const k = rc > capR + 1 ? Math.max(0.2, (capR + 1) / rc) : 1, dz = capZ + 0.8 - zmin;
      for (let i = 0; i < center.V.length; i += 3) { center.V[i] *= k; center.V[i + 1] *= k; center.V[i + 2] += dz; }
    }
  }
  if (center && ring.length) {
    // a centre wider than the room inside the knuckles is narrowed to fit, so it can't touch them
    let rc = 0; for (let i = 0; i < center.V.length; i += 3) rc = Math.max(rc, Math.hypot(center.V[i], center.V[i + 1]));
    const room2 = hubR - knuckle - clear - 0.3;
    if (rc > room2) { const k = Math.max(0.2, room2 / rc); for (let i = 0; i < center.V.length; i += 3) { center.V[i] *= k; center.V[i + 1] *= k; } }
  }
  // sepals: little green leaves under the head
  const sepals = mk();
  const ns = sp.sepals || 0;
  if (ns) {
    const sw = { n: ns, L: D * 0.22, W: D * 0.08, prof: "pointed", r0: D * 0.04, z0: -1.5, elev: -35 * deg, curl: 0.2, t: 1, res: "lo" };
    const sm = petalMesh(sw, { ...o, petals: "fixed" });
    for (let i = 0; i < ns; i++) { const az = (i / ns) * Math.PI * 2 + 0.3; put(sepals, sm, new THREE.Matrix4().makeTranslation(Math.cos(az) * sw.r0, Math.sin(az) * sw.r0, sw.z0).multiply(new THREE.Matrix4().makeRotationZ(az)).multiply(new THREE.Matrix4().makeRotationY(-sw.elev))); }
  }
  // a cup under the head that joins petals, sepals and stem
  put(sepals, lathe([[1e-4, -D * 0.06 - 3], [D * 0.05 + 1.8, -D * 0.04 - 1], [Math.max(2.4, D * 0.07), 0.6], [1e-4, 0.6]], mech ? 6 : 16));
  // with hinges, the sepals hang under the hub ring, clear of the knuckles
  if (ring.length) { const dz = rt - 2.5 - 0.6 + 0.8; for (let i = 2; i < sepals.V.length; i += 3) sepals.V[i] += dz; }
  if (rtS != null) { const dz = rtS - 2.5 - 0.6 + 0.8; for (let i = 2; i < sepals.V.length; i += 3) sepals.V[i] += dz; }
  return { petals, center, sepals, hub, hubParts, D, mech, kitInfo, whorls };
}
// the placement of one petal at a bloom (0 = closed bud, 1 = open)
export function petalMatrix(p, bloom) {
  const e = p.bud + (p.elev - p.bud) * bloom;
  return new THREE.Matrix4().makeTranslation(Math.cos(p.az) * p.r0, Math.sin(p.az) * p.r0, p.z0).multiply(new THREE.Matrix4().makeRotationZ(p.az)).multiply(new THREE.Matrix4().makeRotationY(-e));
}

// ------------------------------------------------------------------ leaves and stems
function leafMesh(type, L, Wd, o, t = 1.2) {
  const mech = o.style === "mech";
  if (type === "none") return null;
  if (type === "frond") {
    // a fern frond: a midrib with pairs of small leaflets
    const m = mk(), n = 9;
    put(m, tube([[0, 0, 0], [L * 0.5, 0, L * 0.08], [L, 0, -L * 0.05]], 1, 6));
    const lf = petalMesh({ L: L * 0.22, W: L * 0.07, prof: "lance", curl: 0.1, t: 1, res: mech ? "lo" : undefined, bend: -0.2 }, o);
    for (let i = 1; i < n; i++) { const u = i / n, x = L * u, z = L * 0.08 * Math.sin(Math.PI * u) - 0.05 * L * u * u, s = 1 - u * 0.75; for (const sd of [-1, 1]) put(m, lf, new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationZ(sd * 1.1)).multiply(new THREE.Matrix4().makeScale(s, s, 1))); }
    return m;
  }
  const P = { lance: ["lance", 0.28], serrate: ["oval", 0.45], ovate: ["oval", 0.55], heart: ["heart", 0.8], strap: ["strap", 0.12], grass: ["strap", 0.07], sword: ["pointed", 0.12], spoon: ["spatula", 0.35], oak: ["oval", 0.45], fern: ["lance", 0.3], palm: ["fan", 0.6], round: ["round", 0.85], pad: ["round", 1.0], paddle: ["oval", 0.35] }[type] || ["lance", 0.3];
  const w = { L, W: Wd || L * P[1], prof: P[0], tip: type === "serrate" || type === "oak" ? "teeth" : undefined, teeth: type === "oak" ? 5 : 9, curl: mech ? 0 : 0.35, bend: -0.5, t, ruffle: type === "oak" ? 0.15 : 0, res: undefined, base: 0.12 };
  const m = petalMesh(w, { ...o, petals: "fixed" });
  if (!mech) { const rib = tube([[0, 0, 0.4], [L * 0.45, 0, L * 0.1 * Math.sin(-0.25) + 0.5], [L * 0.85, 0, -L * 0.2]], 0.55, 5); put(m, rib); }
  return m;
}
// a stem along a curve: lifelike (smooth) or mechanical (jointed segments)
function stemMesh(path, r, o) {
  const m = mk();
  if (o.style !== "mech") { put(m, tube(path, (u) => r * (1 - 0.25 * u), 10)); return m; }
  put(m, tube(path, r, 6));
  // joints: rings every few segments
  for (let i = 3; i < path.length - 1; i += 4) {
    const p = path[i], q = path[i + 1], d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    put(m, lathe([[r * 0.5, -1.4], [r * 1.45, -1.4], [r * 1.45, 1.4], [r * 0.5, 1.4]], 8), aim(p, d));
  }
  return m;
}
const bez = (a, b, c, d, n) => { const out = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push([0, 1, 2].map((k) => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k])); } return out; };

// ------------------------------------------------------------------ a whole flower (head, stem, leaves)
// base: stem foot; top: where the head sits; dir: which way the head faces
export function buildFlower(sp, o, base, top, dir, seed = 1) {
  // in pieces: a snap-together kit that prints flat (see "kits" below)
  if (o.joints) return buildKit(sp, o, base, top, dir, seed);
  const R = rng(seed), mech = o.style === "mech";
  const parts = []; // { name, color, mesh, petals? }
  const leafC = o.colors.leaf, stemC = o.colors.stem;
  const stem = mk(), leaves = mk(), green = mk();
  const len = Math.hypot(top[0] - base[0], top[1] - base[1], top[2] - base[2]);
  const sr = mech ? 2.4 : 1.6 + Math.min(1.6, (sp.D || 30) / 60);
  const nod = (sp.nod || 0) * deg;
  // head direction, nodding a little for daffodils and lilies
  let hd = new THREE.Vector3(...dir).normalize();
  if (nod) { const side = new THREE.Vector3(hd.x, hd.y, 0); if (side.length() < 1e-3) side.set(1, 0, 0); side.normalize(); hd = hd.clone().multiplyScalar(Math.cos(nod)).add(side.multiplyScalar(Math.sin(nod))).normalize(); }
  // printing in pieces: the head comes off; it gets a socket collar under it, and the stem stops at
  // the collar with a peg (worked out before the stem, as the stem ends there)
  const single = !["greenery", "spike", "cluster", "spray"].includes(sp.form);
  const J = o.joints && single ? { h: flowerHead(sp, o) } : null;
  if (J) {
    const L = [], h = J.h;
    for (const p of h.petals) if (!p.snap) L.push(put(mk(), p.mesh, petalMatrix(p, p.hinged ? o.printOpen ?? 1 : o.bloom)));
    for (const m of [h.center, h.hub, h.sepals]) if (m) L.push(m);
    if (sp.beak) L.push(J.beak = put(mk(), petalMesh({ L: sp.D * 0.7, W: sp.D * 0.12, prof: "lance", curl: 0.5, t: 2, bend: 0.2 }, { ...o, petals: "fixed" }), new THREE.Matrix4().makeRotationZ(-Math.PI / 2).multiply(new THREE.Matrix4().makeRotationY(1.35))));
    let zmin = 0;
    for (const m of L) for (let i = 0; i < m.V.length; i += 3) if (Math.hypot(m.V[i], m.V[i + 1]) < COLLAR_R + 0.5) zmin = Math.min(zmin, m.V[i + 2]);
    J.zc = zmin - 0.4 - PEG.depth; J.zTop = zmin + 1.2;
  }
  const topS = J ? [top[0] + hd.x * J.zc, top[1] + hd.y * J.zc, top[2] + hd.z * J.zc] : top;
  // (straight when an arrangement is printed in pieces, so the stems fan out and never cross)
  // (rising straight up for 12 mm first, so neighbouring stems stay apart at their sockets)
  const lead = [base[0], base[1], base[2] + (o.lead ?? 12)];
  const path = o.straight ? [base, [base[0], base[1], base[2] + (o.lead ?? 12) / 2], ...Array.from({ length: 16 }, (_, k) => lead.map((v, c) => v + ((topS[c] - v) * k) / 15))] : bez(base, [base[0], base[1], base[2] + len * 0.4], [top[0] - hd.x * len * 0.25, top[1] - hd.y * len * 0.25, top[2] - hd.z * len * 0.25], topS, 18);
  // a peg at the foot, down into the stand's (or holder's) socket
  if (o.joints && o.joints.foot !== false) {
    // a short straight shoulder that stands flat on the socket, and the peg under it (the curved
    // stem starts a little higher, inside the shoulder)
    put(stem, pegMesh(), new THREE.Matrix4().makeTranslation(...base).multiply(new THREE.Matrix4().makeRotationX(Math.PI)));
    put(stem, lathe([[1e-4, 0], [Math.max(sr, COLLAR_R - 0.6), 0], [Math.max(sr, COLLAR_R - 0.6), 3], [1e-4, 3]], PEG.segs), new THREE.Matrix4().makeTranslation(...base));
    path[0] = [base[0], base[1], base[2] + (o.straight ? 3 : 1.5)];
  }
  const tag = (list) => { if (o.joints) for (const p of list) p.piece = p.piece || (o.pieceId || "f") + ":stem"; return list; };
  if (sp.form === "greenery") {
    // a branch of leaves (eucalyptus) or a fern frond
    put(stem, stemMesh(path, sr * 0.8, o));
    if (sp.leaf === "frond") { const L = len * 0.8; put(leaves, leafMesh("frond", L, 0, o), aim(path[4], [path[16][0] - path[4][0], path[16][1] - path[4][1], path[16][2] - path[4][2]], 0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2))); }
    else for (let i = 0; i < sp.leaves; i++) { const k = 3 + Math.floor((i / sp.leaves) * (path.length - 4)), p = path[k], az = i * 2.4; put(leaves, leafMesh(sp.leaf, 13 - i * 0.3, 11, o, 1.1), new THREE.Matrix4().makeTranslation(...p).multiply(new THREE.Matrix4().makeRotationZ(az)).multiply(new THREE.Matrix4().makeRotationY(-0.4))); }
    parts.push({ name: sp.name + " stem", color: stemC, mesh: stem }, { name: sp.name + " leaves", color: o.colors.petal || leafC, mesh: leaves });
    return tag(parts);
  }
  put(stem, stemMesh(path, sr, o));
  // leaves along the stem
  const nl = o.noLeaves ? 0 : sp.leaves || 0;
  for (let i = 0; i < nl; i++) {
    const k = 2 + Math.floor(((i + 0.5) / nl) * (path.length * (sp.form === "spike" ? 0.5 : 0.65))), p = path[k], q = path[k + 1];
    const az = i * 2.2 + R() * 0.6, L = sp.leaf === "grass" || sp.leaf === "strap" || sp.leaf === "sword" ? len * 0.45 : Math.max(18, (sp.D || 30) * 0.7);
    const lm = leafMesh(sp.leaf, L, 0, o, mech ? 1.4 : 1.2);
    if (lm) put(leaves, lm, new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]).multiply(new THREE.Matrix4().makeRotationZ(az)).multiply(new THREE.Matrix4().makeRotationY(sp.leaf === "pad" ? -0.05 : -0.75)));
    void q;
  }
  parts.push({ name: sp.name + " stem", color: stemC, mesh: stem });
  if (leaves.I.length) parts.push({ name: sp.name + " leaves", color: leafC, mesh: leaves });
  const headAt = aim(top, [hd.x, hd.y, hd.z], R() * 6);
  if (sp.form === "spike" || sp.form === "cluster" || sp.form === "spray") {
    // many small florets: up a spike, on a ball or dome, or on a spray of fine branches
    const fl = sp.whorls && sp.whorls(sp.D).length ? flowerHead(sp, { ...o, petals: "fixed", scale: 1 }) : null;
    const flor = mk(), cen = mk();
    const one = (M) => {
      if (fl) { for (const p of fl.petals) put(flor, p.mesh, M.clone().multiply(petalMatrix(p, o.bloom))); if (fl.center) put(cen, fl.center, M); }
      else if (sp.center) put(flor, centerMesh(sp.center, o, sp.D), M);
    };
    if (sp.form === "spike") {
      const S = sp.spike, n = S.n;
      for (let i = 0; i < n; i++) {
        const u = S.from + (1 - S.from) * (i / n), k = Math.min(path.length - 2, Math.floor(u * (path.length - 1)));
        const p = path[k], q = path[k + 1], ax = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
        const az = S.oneSide ? (i % 2 ? 0.35 : -0.35) : i * 2.4, rr = S.R * (S.cone ? 1 - 0.7 * (i / n) : 1) * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, (i + 1) / n)));
        const side = new THREE.Vector3(Math.cos(az), Math.sin(az), 0); side.sub(ax.clone().multiplyScalar(side.dot(ax))).normalize();
        const pos = [p[0] + side.x * rr * 0.5, p[1] + side.y * rr * 0.5, p[2] + side.z * rr * 0.5];
        const d = side.clone().multiplyScalar(1).add(ax.clone().multiplyScalar(S.out)).normalize();
        if (S.bud) put(flor, ellipsoid(sp.center.r * 0.9, sp.center.r * 0.9, sp.center.h, 8), aim(pos, [d.x, d.y, d.z]));
        else one(aim(pos, [d.x, d.y, d.z], i));
        if (!S.bud) put(stem, tube([[p[0], p[1], p[2]], pos], 0.7, 5));
      }
      // the top of the stem runs up through the spike
    } else if (sp.form === "cluster") {
      const S = sp.cluster, n = S.n, Rr = S.R * (o.scale || 1);
      const ctr = new THREE.Vector3(...top).add(hd.clone().multiplyScalar(S.umbel ? Rr * 0.1 : Rr * 0.75));
      for (let i = 0; i < n; i++) {
        // Fibonacci points on the upper part of a sphere (flat: a dome; umbel: a flat plate)
        const f = (i + 0.5) / n, cz = 1 - f * (S.flat ? 0.75 : 1.6), r2 = Math.sqrt(Math.max(0, 1 - cz * cz)), a = i * 2.39996;
        let v = new THREE.Vector3(Math.cos(a) * r2, Math.sin(a) * r2, cz);
        if (S.umbel) v = new THREE.Vector3(Math.cos(a) * Math.sqrt(f), Math.sin(a) * Math.sqrt(f), 0.15);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hd);
        const vw = v.clone().applyQuaternion(q);
        const pos = ctr.clone().add(vw.clone().multiplyScalar(S.umbel ? Rr : Rr * 0.6));
        one(aim([pos.x, pos.y, pos.z], S.umbel ? [hd.x, hd.y, hd.z] : [vw.x, vw.y, vw.z], i));
        put(stem, tube([top, [ctr.x + (pos.x - ctr.x) * 0.85, ctr.y + (pos.y - ctr.y) * 0.85, ctr.z + (pos.z - ctr.z) * 0.85]], S.umbel ? 0.55 : 0.8, 5));
      }
    } else {
      // baby's breath: fine branches, each ending in a tiny puff
      const S = sp.spray, n = S.n;
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996, f = (i + 0.5) / n, rr = S.R * Math.sqrt(f), up = (1 - f) * S.R * 0.4;
        const end = [top[0] + Math.cos(a) * rr, top[1] + Math.sin(a) * rr, top[2] + up];
        const mid = [top[0] + Math.cos(a) * rr * 0.4, top[1] + Math.sin(a) * rr * 0.4, top[2] + up * 0.3 - 3];
        put(stem, tube([top, mid, end], 0.6, 5));
        put(flor, ellipsoid(sp.center.r, sp.center.r, sp.center.h, 8), new THREE.Matrix4().makeTranslation(...end));
      }
    }
    parts.push({ name: sp.name + " flowers", color: o.colors.petal, mesh: flor });
    if (cen.I.length) parts.push({ name: sp.name + " centres", color: o.colors.center, mesh: cen });
    return tag(parts);
  }
  // a single head
  const h = J ? J.h : flowerHead(sp, o);
  const pm = mk();
  for (const p of h.petals) if (!p.snap) put(pm, p.mesh, headAt.clone().multiply(petalMatrix(p, p.hinged ? o.printOpen ?? 1 : o.bloom)));
  const hp = [];
  if (pm.I.length) hp.push({ name: sp.name + " petals", color: o.colors.petal, mesh: pm, head: { M: headAt, petals: h.petals.filter((p) => !p.snap) } });
  // snap-in petals: each its own part, printed flat (its frame is the petal's own axes)
  const snaps = h.petals.filter((p) => p.snap).map((p, k) => { const F = headAt.clone().multiply(petalMatrix(p, 1)); return { name: `${sp.name} petal ${k + 1}`, color: o.colors.petal, mesh: put(mk(), p.mesh, F), piece: `${o.pieceId || "f"}:petal${k + 1}`, frame: F, snapPetal: true }; });
  if (h.center) hp.push({ name: sp.name + " centre", color: o.colors.center, mesh: put(mk(), h.center, headAt) });
  if (h.hub.I.length) hp.push({ name: sp.name + " hub and pins", color: mech ? METAL.center : o.colors.stem, mesh: put(mk(), h.hub, headAt) });
  const beak = () => petalMesh({ L: sp.D * 0.7, W: sp.D * 0.12, prof: "lance", curl: 0.5, t: 2, bend: 0.2 }, { ...o, petals: "fixed" });
  const beakM = headAt.clone().multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationY(1.35));
  if (!J) {
    put(stem, h.sepals, headAt);
    if (sp.beak) put(stem, beak(), beakM);
    parts.push(...hp, ...snaps);
    return parts;
  }
  // in pieces: the sepals, beak and socket collar go with the head; the stem gets a shoulder and a peg
  const calyx = put(mk(), h.sepals, headAt);
  if (sp.beak) put(calyx, beak(), beakM);
  put(calyx, collarMesh(J.zc, J.zTop), headAt);
  hp.push({ name: sp.name + " calyx and socket", color: stemC, mesh: calyx });
  put(stem, lathe([[1e-4, J.zc - 3], [COLLAR_R, J.zc - 3], [COLLAR_R, J.zc], [1e-4, J.zc]], PEG.segs), headAt);
  put(stem, pegMesh(), headAt.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, J.zc)));
  for (const p of hp) { p.piece = (o.pieceId || "f") + ":head"; p.frame = headAt; }
  tag(parts);
  parts.push(...hp, ...snaps);
  return parts;
}

// ------------------------------------------------------------------ containers
export const CONTAINERS = [["vase", "Vase"], ["bud", "Bud vase"], ["bowl", "Bowl"], ["pot", "Square pot"], ["basket", "Basket"], ["wrap", "Wrapped bouquet"], ["none", "None (one stem)"], ["wreath", "Wreath (hangs on a wall)"]];
// a wreath's shapes (the arrangement's Shape list shows these instead when the container is a wreath)
export const WREATH_LAYOUTS = [["ring", "Full ring"], ["crescent", "Crescent (lower part)"]];
export function containerMesh(kind, o) {
  const mech = o.style === "mech", t = 2.4, segs = mech ? 8 : 48;
  const shell = (outer) => {
    // outer profile (r, z) bottom to rim; the inside is the same moved in by the wall
    const pr = [[1e-4, 0], ...outer, ...outer.slice().reverse().map(([r, z]) => [Math.max(1e-4, r - t), Math.max(z, t)]), [1e-4, t]];
    return lathe(pr, segs);
  };
  switch (kind) {
    case "vase": return { mesh: shell([[34, 0], [40, 30], [36, 70], [26, 100], [30, 118]]), mouth: [0, 0, 112], r: 22, h: 118 };
    case "bud": return { mesh: shell([[26, 0], [32, 22], [24, 48], [9, 82], [9, 96], [12, 100]]), mouth: [0, 0, 96], r: 6, h: 100 };
    // (a kit's bowl flares no more than 45 degrees, so it prints without supports)
    case "bowl": return { mesh: shell(o.joints ? [[30, 0], [52, 22], [63, 46], [65, 52]] : [[30, 0], [56, 22], [66, 46], [68, 52]]), mouth: [0, 0, 40], r: 50, h: 52 };
    case "pot": { const m = lathe([[1e-4, 0], [40, 0], [46, 70], [46, 76], [42, 76], [36, t], [1e-4, t]], 4); for (let i = 0; i < m.V.length; i += 3) { const x = m.V[i], y = m.V[i + 1]; m.V[i] = (x - y) * Math.SQRT1_2; m.V[i + 1] = (x + y) * Math.SQRT1_2; } return { mesh: outward(m), mouth: [0, 0, 64], r: 34, h: 76 }; }
    case "basket": {
      // a woven-look basket: a base, slats round the side, rims, and a handle
      const m = mk();
      put(m, cyl(48, 3, segs));
      const n = mech ? 12 : 24;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; put(m, box(5, 2.4, 58), new THREE.Matrix4().makeTranslation(Math.cos(a) * 49, Math.sin(a) * 49, 0).multiply(new THREE.Matrix4().makeRotationZ(a + Math.PI / 2))); }
      if (o.joints) {
        // a kit: rims chamfered underneath (45 degrees), the top rim with two slots, and the handle a
        // separate flat arch whose forks snap down into them (between two slats)
        for (const z of [11, 27, 43]) put(m, outward(lathe([[47, z], [52, z + 5], [47, z + 5]], segs)));
        // the top rim and the handle: in the gap between slats that keeps the handle clear of every stem
        // and flower (stems: [{ a, b, r }] segments with a radius; heads: [{ c, r }])
        const kitTop = (stems) => {
          const near = (P, Q, A, B) => { const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 || 1e-9, t = Math.max(0, Math.min(1, ((P[0] - A[0]) * d[0] + (P[1] - A[1]) * d[1] + (P[2] - A[2]) * d[2]) / L2)); return Math.hypot(P[0] - A[0] - d[0] * t, P[1] - A[1] - d[1] * t, P[2] - A[2] - d[2] * t); };
          let best = null;
          for (let k = 0; k < n; k++) {
            const ah = Math.PI / n + (k * 2 * Math.PI) / n; let worst = Infinity;
            for (let j = 0; j <= 40; j++) { const t = Math.PI * (j / 40), P = [Math.cos(ah) * Math.cos(t) * 49.5, Math.sin(ah) * Math.cos(t) * 49.5, 61 + Math.sin(t) * 49.5]; for (const q of stems) worst = Math.min(worst, (q.b ? near(P, q.a, q.a, q.b) : Math.hypot(P[0] - q.a[0], P[1] - q.a[1], P[2] - q.a[2])) - q.r - 3); }
            if (!best || worst > best[1]) best = [ah, worst];
          }
          return { ...handleAt(best[0]), clear: best[1] };
        };
        const handleAt = (ah) => {
        const e = [Math.cos(ah), Math.sin(ah)], th = [-Math.sin(ah), Math.cos(ah)];
        const slot = (sg) => { const c = [sg * 49.5 * e[0], sg * 49.5 * e[1]], sw = FORK.w / 2 + FORK.fit, st2 = KIT.ts / 2 + FORK.fit; return [[-sw, -st2], [sw, -st2], [sw, st2], [-sw, st2]].map(([a, b]) => [c[0] + e[0] * a + th[0] * b, c[1] + e[1] * a + th[1] * b]); };
        const pad = (sg) => { const c = [sg * 49.5 * e[0], sg * 49.5 * e[1]]; const P = [[-4, -4], [4, -4], [4, 4], [-4, 4]].map(([a, b]) => [c[0] + e[0] * a + th[0] * b, c[1] + e[1] * a + th[1] * b]); const sh2 = new THREE.Shape(P.map(([x, y]) => new THREE.Vector2(x, y))); const hp = new THREE.Path(slot(sg).map(([x, y]) => new THREE.Vector2(x, y))); sh2.holes.push(hp); return sh2; };
        const rim = slottedPlate(52, 47, [slot(1), slot(-1)], 58, 61, [pad(1), pad(-1)]);
        // the handle, in the plane through the axis at angle ah: a half ring 5 mm wide, forks at both ends
        const shp = [];
        const arc = []; for (let k = 0; k <= 48; k++) { const a = Math.PI * (k / 48); arc.push([Math.cos(a) * 52, Math.sin(a) * 52 + 0.01]); } for (let k = 48; k >= 0; k--) { const a = Math.PI * (k / 48); arc.push([Math.cos(a) * 47, Math.sin(a) * 47 + 0.01]); }
        shp.push({ poly: arc });
        for (const sg of [-1, 1]) for (const f of forkShapes(3, 0, -1)) shp.push({ poly: f.poly.map(([x, y]) => [sg * 49.5 + y, x]) });
        const F = new THREE.Matrix4().makeBasis(new THREE.Vector3(e[0], e[1], 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(th[0], th[1], 0).negate()).setPosition(0, 0, 61);
        const hm = put(mk(), flatSolid(shp, -KIT.ts / 2, KIT.ts / 2), F);
        return { rim, handle: { mesh: hm, frame: F } };
        };
        return { mesh: m, mouth: [0, 0, 50], r: 38, h: 61, kitTop };
      }
      for (const z of [14, 30, 46, 58]) put(m, lathe([[47, z], [52, z], [52, z + 3], [47, z + 3]], segs));
      const hp = []; for (let k = 0; k <= 20; k++) { const a = Math.PI * (k / 20); hp.push([Math.cos(a) * 50, 0, 58 + Math.sin(a) * 70]); }
      put(m, tube(hp, 3, 8));
      return { mesh: m, mouth: [0, 0, 50], r: 38, h: 61 };
    }
    case "wrap": {
      // paper cone round the stems, tied with a ribbon
      const m = mk(); const pr = [[10, 0], [70, 120], [70 - t, 120], [10 - t, 0]];
      put(m, lathe(pr, mech ? 8 : 40, (a, k) => (k >= 1 ? 1 + 0.06 * Math.cos(5 * a) : 1)));
      put(m, lathe([[15.5, 18], [19, 18], [19, 28], [15.5, 28]], segs));
      put(m, lathe([[1e-4, 0], [10, 0], [12, 20], [1e-4, 20]], 16));
      return { mesh: m, mouth: [0, 0, 22], r: 10, h: 120, wrap: true };
    }
    default: return { mesh: null, mouth: [0, 0, 6], r: 0, h: 0, base: true };
  }
}

// ------------------------------------------------------------------ arrangements
export const LAYOUTS = [["dome", "Dome"], ["fan", "Fan (one-sided)"], ["cascade", "Cascade"], ["posy", "Tight posy"], ["row", "Row (window box)"]];
// items: [{ id, n, color }]; returns { parts, height }
export function buildArrangement(a, o) {
  if (a.container === "wreath") return buildWreath(a, o);
  const R = rng(a.seed || 1);
  const ct = containerMesh(a.container, o);
  const parts = [];
  if (ct.mesh) parts.push({ name: "Container", color: o.colors.container, mesh: ct.mesh });
  if (ct.base && !o.joints) parts.push({ name: "Base", color: o.colors.container, mesh: cyl(22, 6, 32) });
  if (ct.mesh && o.joints) parts[parts.length - 1].piece = "container";
  const containerPart = ct.mesh ? parts[parts.length - 1] : null;
  const list = [];
  for (const it of a.items) for (let k = 0; k < Math.max(0, Math.min(20, it.n | 0)); k++) list.push(it);
  // big flowers in the middle, small ones and greenery round them
  list.sort((p, q) => (byId(q.id).D || 0) - (byId(p.id).D || 0));
  const n = list.length, H = a.height || 220, mouth = ct.mouth;
  // printing in pieces: a holder with a socket for every stem drops into the container
  const HD = o.joints ? holderFor(a.container, ct, list.map((it) => byId(it.id)), o, Math.max(4, mouth[2] - 30)) : null;
  const holderPart = HD ? { name: HD.base ? "Base with slots" : "Stem holder", color: o.colors.container, mesh: HD.mesh, piece: "holder", frame: new THREE.Matrix4().makeRotationX(Math.PI) } : null;
  if (HD) parts.push(holderPart);
  const topZ = Math.max(mouth[2] + 50, H - 40);
  const plan = [];
  list.forEach((it, i) => {
    const sp = byId(it.id), f = n > 1 ? i / (n - 1) : 0;
    let p, d;
    const ga = i * 2.39996 + R() * 0.3;
    if (a.layout === "fan") { const x = (f - 0.5) * 2; p = [x * H * 0.38, -10 + Math.abs(x) * 8, topZ - Math.abs(x) * H * 0.25 - (i % 2) * 16]; d = [x * 0.6, -0.8, 0.5]; }
    else if (a.layout === "cascade") { p = [Math.cos(ga) * 30 * Math.sqrt(f), -f * H * 0.45, topZ - f * H * 0.55]; d = [Math.cos(ga) * 0.3, -0.6 - f * 0.3, 0.6 - f * 0.9]; }
    else if (a.layout === "posy") { const rr = 34 * Math.sqrt(f + 0.02); p = [Math.cos(ga) * rr, Math.sin(ga) * rr, topZ - f * 18]; d = [Math.cos(ga) * f * 0.6, Math.sin(ga) * f * 0.6, 1]; }
    else if (a.layout === "row") { const x = (f - 0.5) * Math.max(80, n * 26); p = [x, (i % 2) * 18 - 9, topZ - (i % 3) * 14]; d = [x * 0.004, -0.2, 1]; }
    else { const th = Math.sqrt(f) * 1.15, rr = H * 0.42; p = [Math.cos(ga) * Math.sin(th) * rr, Math.sin(ga) * Math.sin(th) * rr, topZ - rr + Math.cos(th) * rr]; d = [Math.cos(ga) * Math.sin(th), Math.sin(ga) * Math.sin(th), Math.cos(th)]; }
    // stems start inside the container's mouth (and below it, so they look planted)
    const sa = ga + Math.PI, sr = (ct.r || 6) * 0.5 * Math.sqrt(R());
    plan.push({ it, sp, p, d, base: [mouth[0] + Math.cos(sa) * sr, mouth[1] + Math.sin(sa) * sr, Math.max(4, mouth[2] - 30)] });
  });
  if (HD) {
    // in pieces every flower must go in on its own, so the heads are pushed apart until none overlap…
    const rad0 = (sp) => 0.5 * Math.max(sp.D || 30, sp.cluster ? sp.cluster.R * 2.2 : 0, sp.spray ? sp.spray.R * 2.2 : 0, sp.form === "greenery" ? 40 : 0) * (o.scale || 1);
    // (a kit: each kind measured as built: how far its head reaches from the top of its stem)
    const meas = new Map();
    const rad = (sp) => {
      if (!o.joints) return rad0(sp);
      if (!meas.has(sp.id)) {
        const H0 = 100, built = buildFlower(sp, { ...o, joints: { foot: false }, noLeaves: true, colors: { ...o.colors } }, [0, 0, 0], [0, 0, H0], [0, 0, 1], 3);
        let r = 0; for (const q of built) { if (/ stem$/.test(q.name)) continue; for (let i = 0; i < q.mesh.V.length; i += 3) r = Math.max(r, Math.hypot(q.mesh.V[i], q.mesh.V[i + 1], q.mesh.V[i + 2] - H0)); }
        meas.set(sp.id, Math.max(rad0(sp) * 0.6, r + 1));
      }
      return meas.get(sp.id);
    };
    const p0 = plan.map((q) => q.p.slice()), MAXMOVE = 35;
    for (let it2 = 0; it2 < 80; it2++) {
      let moved = false;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const A = plan[i].p, B = plan[j].p, v = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(...v) || 1e-3, need = rad(plan[i].sp) + rad(plan[j].sp) + 3;
        if (L >= need) continue;
        const k = (need - L) / 2 / L; moved = true;
        for (let c = 0; c < 3; c++) { A[c] -= v[c] * k; B[c] += v[c] * k; }
        A[2] = Math.max(A[2], mouth[2] + 30); B[2] = Math.max(B[2], mouth[2] + 30);
        for (const [q, q0] of [[A, p0[i]], [B, p0[j]]]) { const v = [q[0] - q0[0], q[1] - q0[1], q[2] - q0[2]], L = Math.hypot(...v); if (L > 35) for (let c = 0; c < 3; c++) q[c] = q0[c] + (v[c] / L) * 35; }
      }
      if (!moved) break;
    }
    // (a kit: up to three rounds of choosing sockets and spreading, until nothing touches)
    for (let round = 0; round < (o.joints ? 3 : 1); round++) {
    // …and each gets the socket that points toward its head, so the stems fan out without crossing
      const free = HD.holes.map((h, k) => k), rmax = Math.max(1, ...plan.map((q) => Math.hypot(q.p[0] - mouth[0], q.p[1] - mouth[1])));
      const ur = Math.max(1, ...HD.holes.map((h) => Math.hypot(h[0], h[1])));
      const order = plan.map((q, i) => i).sort((x, y) => Math.hypot(plan[y].p[0], plan[y].p[1]) - Math.hypot(plan[x].p[0], plan[x].p[1]));
      for (const i of order) {
        if (!free.length) break;
        const q = plan[i], hx = q.p[0] - mouth[0], hy = q.p[1] - mouth[1], hr = Math.hypot(hx, hy), want = [(hx / (hr || 1)) * ur * Math.min(1, hr / rmax), (hy / (hr || 1)) * ur * Math.min(1, hr / rmax)];
        let bi = 0; for (let k = 1; k < free.length; k++) if (Math.hypot(HD.holes[free[k]][0] - want[0], HD.holes[free[k]][1] - want[1]) < Math.hypot(HD.holes[free[bi]][0] - want[0], HD.holes[free[bi]][1] - want[1])) bi = k;
        const h = HD.holes[free.splice(bi, 1)[0]];
        q.sock = [mouth[0] + h[0], mouth[1] + h[1], HD.zb];
      }
      // a kit's stems are straight: each must lean no more than KIT.maxLean and stay inside the container
      // all the way up (sampled every 3 mm), with its head above the rim
      const prof2 = [];
      if (o.joints && ct.mesh) for (let zz = HD.zb + 1; zz <= ct.h; zz += 3) prof2.push([zz, innerRadius(ct.mesh, zz, zz)]);
      const kitClamp = (q) => {
        if (!o.joints || !q.sock) return;
        const b = q.sock;
        q.p[2] = Math.max(q.p[2], (ct.h || 0) + 12 + rad(q.sp) * 0.5, b[2] + 30);
        const v = [q.p[0] - b[0], q.p[1] - b[1], q.p[2] - b[2]];
        const hz = Math.hypot(v[0], v[1]), maxH = v[2] * Math.tan(KIT.maxLean - 0.03);
        if (hz > maxH) { v[0] *= maxH / hz; v[1] *= maxH / hz; }
        for (const [zz, rin] of prof2) {
          const f = (zz - b[2]) / v[2]; if (f <= 0 || f >= 1) continue;
          const x = b[0] + v[0] * f, y = b[1] + v[1] * f, lim = rin - 5, r = Math.hypot(x, y);
          if (r > lim) { const bx = Math.hypot(b[0], b[1]), sc = Math.max(0, (lim - bx) / Math.max(1e-6, r - bx)); v[0] *= sc; v[1] *= sc; }
        }
        q.p = [b[0] + v[0], b[1] + v[1], b[2] + v[2]];
      };
      for (const q of plan) kitClamp(q);
      // then spread them until no stem or head comes near another: stems as tubes along their curves,
      // heads as balls (moving the heads moves the stems' upper parts with them)
      // (mechanical stems have joint rings 1.45× wider; spikes carry florets round the stem)
      // (k: 0 the lower stem, 1 the upper part, where a spike's florets are)
      // (a kit's stems are flat strips: their half-diagonal)
      const kitW = (sp) => (o.style === "mech" ? 2.8 : Math.max(2.4, Math.min(3.2, 1.6 + (sp.D || 30) / 60 + 0.6)));
      const sr = (sp, k = 0) => o.joints && !(k && sp.spike) ? Math.hypot(kitW(sp), KIT.ts / 2) + 0.6 : Math.max(sp.form === "greenery" ? 12 : o.style === "mech" ? 2.4 * 1.45 : 1.6 + Math.min(1.6, (sp.D || 30) / 60), k && sp.spike ? sp.spike.R * 0.75 + 1 : 0) + 0.5;
      // (from 15 mm up: below that the sockets' spacing already keeps the stems apart)
      const curve = (q) => { const b = q.sock || q.base, t = q.p, a0 = o.joints ? [b[0] + (t[0] - b[0]) * 0.02, b[1] + (t[1] - b[1]) * 0.02, b[2] + 2] : [b[0], b[1], b[2] + 12], L = Math.hypot(t[0] - a0[0], t[1] - a0[1], t[2] - a0[2]) || 1, f = Math.min(0.5, 4 / L), g = q.sp.spike ? Math.max(f, (q.sp.spike.from || 0.5) - 0.05) : 0.6; const at = (u) => [a0[0] + (t[0] - a0[0]) * u, a0[1] + (t[1] - a0[1]) * u, a0[2] + (t[2] - a0[2]) * u]; return [at(f), at(g), t]; };
      const segD = (p1, q1, p2, q2) => { // closest points of two segments
        const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]], d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]], r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
        const a1 = d1[0] ** 2 + d1[1] ** 2 + d1[2] ** 2, e = d2[0] ** 2 + d2[1] ** 2 + d2[2] ** 2, f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2], c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2], b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2], den = a1 * e - b * b;
        let s1 = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0, t1 = e > 1e-9 ? (b * s1 + f) / e : 0;
        if (t1 < 0) { t1 = 0; s1 = Math.max(0, Math.min(1, -c / (a1 || 1))); } else if (t1 > 1) { t1 = 1; s1 = Math.max(0, Math.min(1, (b - c) / (a1 || 1))); }
        const x = [p1[0] + d1[0] * s1 - p2[0] - d2[0] * t1, p1[1] + d1[1] * s1 - p2[1] - d2[1] * t1, p1[2] + d1[2] * s1 - p2[2] - d2[2] * t1];
        return [Math.hypot(...x), s1, t1];
      };
      // (each head moves at most 35 mm from where the arrangement put it; stems without a socket stay put)
      let touching = 0;
      const clampMove = (i) => { const q = plan[i].p, v = [q[0] - p0[i][0], q[1] - p0[i][1]], L = Math.hypot(...v); if (L > MAXMOVE) { q[0] = p0[i][0] + (v[0] / L) * MAXMOVE; q[1] = p0[i][1] + (v[1] / L) * MAXMOVE; } };
      for (let it2 = 0; it2 < 200; it2++) {
        const C = plan.map(curve);
        touching = 0;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          if (!plan[i].sock || !plan[j].sock) continue;
          const A = C[i], B = C[j];
          let worst = 0, wa = 0, wb = 0;
          for (let u = 0; u + 1 < A.length; u++) for (let v = 0; v + 1 < B.length; v++) { const need = sr(plan[i].sp, u) + sr(plan[j].sp, v), [dd, s1, t1] = segD(A[u], A[u + 1], B[v], B[v + 1]); if (need - dd > worst) { worst = need - dd; wa = (u + s1) / (A.length - 1); wb = (v + t1) / (B.length - 1); } }
          // heads against the other one's stem
          for (const [P, Q, rr, spQ] of [[plan[i], C[j], rad(plan[i].sp), plan[j].sp], [plan[j], C[i], rad(plan[j].sp), plan[i].sp]]) for (let v = 0; v + 1 < Q.length; v++) { const [dd] = segD(P.p, P.p, Q[v], Q[v + 1]); if (rr + sr(spQ, v) - dd > worst) { worst = rr + sr(spQ, v) - dd; wa = wb = 1; } }
          if (worst <= 0) continue;
          touching++;
          // push the two heads apart sideways (more when the touch is high up the stems)
          const pi = plan[i].p, pj = plan[j].p, h = [pj[0] - pi[0], pj[1] - pi[1]], hl = Math.hypot(...h) || 1, k = Math.min(4, (worst + 0.5) / Math.max(0.25, (wa + wb) / 2) / 2);
          pi[0] -= (h[0] / hl) * k; pi[1] -= (h[1] / hl) * k; pj[0] += (h[0] / hl) * k; pj[1] += (h[1] / hl) * k;
          clampMove(i); clampMove(j);
          // (a kit: the smaller flower also rises a little, as its stem can't lean out far)
          if (o.joints) { const sm = rad(plan[i].sp) < rad(plan[j].sp) ? plan[i] : plan[j]; sm.p[2] += Math.min(6, worst + 1); kitClamp(plan[i]); kitClamp(plan[j]); }
        }
        if (!touching) break;
      }
      HD.touching = touching;
        if (!HD.touching) break;
    }
  }
  plan.forEach(({ it, sp, p, d, base, sock }, i) => {
    const oo = { ...o, noLeaves: !!HD && sp.form !== "greenery", straight: !!HD, colors: { ...o.colors, petal: it.color || o.colors.petal, center: it.center || o.colors.center }, pieceId: "f" + i };
    if (HD) { if (sock) base = sock; else { oo.joints = { ...o.joints, foot: false }; base = [base[0], base[1], HD.zb]; } }
    for (const pt of buildFlower(sp, oo, base, p, d, (a.seed || 1) * 31 + i)) { if (sock) pt.socketed = true; parts.push(pt); }
  });
  // a kit: count the flowers that really touch (exact, between their meshes), for the panel to report
  if (HD && o.joints) {
    const byF = new Map(); for (const q of parts) { const f = (q.piece || "").split(":")[0]; if (!/^f\d/.test(f)) continue; if (!byF.has(f)) byF.set(f, []); byF.get(f).push(q.mesh); }
    const F = [...byF.values()].map((L) => { const m = { V: [], I: [] }; for (const x of L) put(m, x); let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < m.V.length; i += 3) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], m.V[i + d]); hi[d] = Math.max(hi[d], m.V[i + d]); } return { m, lo, hi }; });
    let t2 = 0; for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) { const A = F[i], B = F[j]; if ([0, 1, 2].some((d) => A.hi[d] < B.lo[d] - 0.2 || B.hi[d] < A.lo[d] - 0.2)) continue; if (meshesTouch(A.m, B.m, 0.15)) t2++; }
    HD.touching = t2;
  }
  // a kit's holder gets a slot for each stem's fork, as each stem leans
  if (HD && HD.kit) holderPart.mesh = HD.kit(parts.filter((q) => q.slot && q.socketed).map((q) => kitSlot(q.slot.at, q.slot.u, q.slot.s, HD.zb)));
  // a kit basket: its top rim and handle, placed clear of the stems and flowers
  if (ct.kitTop && containerPart) {
    const obs = [];
    for (const q of parts) if (q.slot && q.slot.top) { obs.push({ a: q.slot.at, b: q.slot.top, r: (q.slot.w || 3) + 1.5 }, { a: q.slot.top, r: q.slot.headR }); }
    const t = ct.kitTop(obs);
    put(containerPart.mesh, t.rim);
    parts.push({ name: "Basket handle", color: o.colors.container, mesh: t.handle.mesh, piece: "handle", frame: t.handle.frame });
  }
  return { parts, height: H, holder: HD && { sockets: plan.filter((q) => q.sock).length, stems: n, touching: HD.touching || 0 } };
}
// the holder: a disc with sockets on a post with a foot, sized to drop in through the container's
// mouth and stand on its floor (zf); the stems' feet sit on its top (zb)
const HOLD = { vase: { zf: 2.4, R: 23 }, bud: { zf: 2.4, R: 6.1 }, bowl: { zf: 2.4, R: 27 }, pot: { zf: 2.4, R: 27, foot: 25 }, basket: { zf: 3, R: 46 }, wrap: { zf: 20, R: 17 }, none: { zf: 0, R: 22, base: true } };
// the smallest distance from the container's middle line to its inside, between two heights
// (sliced every half mm): how wide a part can be to pass down to zFrom
function innerRadius(m, zFrom, zTo) {
  let best = Infinity;
  for (let z = zFrom; z <= zTo; z += 0.5) {
    for (let t = 0; t < m.I.length; t += 3) {
      const q = [];
      for (let e = 0; e < 3; e++) {
        const a = m.I[t + e] * 3, b = m.I[t + ((e + 1) % 3)] * 3, za = m.V[a + 2] - z, zb = m.V[b + 2] - z;
        if ((za < 0) !== (zb < 0)) { const f = za / (za - zb); q.push([m.V[a] + (m.V[b] - m.V[a]) * f, m.V[a + 1] + (m.V[b + 1] - m.V[a + 1]) * f]); }
      }
      if (q.length !== 2) continue;
      const [p1, p2] = q, dx = p2[0] - p1[0], dy = p2[1] - p1[1], L2 = dx * dx + dy * dy;
      const u = L2 ? Math.max(0, Math.min(1, -(p1[0] * dx + p1[1] * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(p1[0] + dx * u, p1[1] + dy * u));
    }
  }
  return best;
}
function holderFor(kind, ct, sps, o, z0) {
  const H0 = HOLD[kind] || HOLD.vase, n = sps.length;
  // as wide as it can be and still go in through the top and stand on the floor (0.5 mm gap all round)
  const H = { ...H0 };
  if (ct.mesh) { const ir = innerRadius(ct.mesh, H.zf + 0.05, ct.h) - 0.5; H.R = Math.min(H.R, ir); H.foot = Math.min(H.foot || H.R, ir); }
  // (the widest stem, counting a mechanical stem's joint rings)
  const srMax = Math.max(2.4, ...sps.map((sp) => (o.style === "mech" ? 2.4 * 1.45 : 1.6 + Math.min(1.6, (sp.D || 30) / 60))));
  // (a kit: slots 9 mm apart, inside the skirt that holds the plate up, leaving room for the barbs)
  const Rs = Math.min(H.R, H.foot || H.R);
  const step = o.joints ? 9 : Math.max(2 * SOCK_R + 1.2, 2 * Math.max(srMax, COLLAR_R - 0.6) + 0.8), usable = o.joints ? Rs - 2 - 4.5 : H.R - SOCK_R - 1.2;
  const zb = H.base ? 8 : Math.max(z0, H.zf + 8 + 4);
  // sockets on a sunflower spiral, as many as fit
  const at = [];
  const holes = [];
  // (points along a spiral, each at least a step from the others)
  for (let k = 0; holes.length < n && k < 3000; k++) {
    const r = step * 0.5 * Math.sqrt(k), a = k * 2.39996, x = r * Math.cos(a), y = r * Math.sin(a);
    if (r > Math.max(0, usable)) break;
    if (holes.every(([u, v]) => Math.hypot(u - x, v - y) >= step)) holes.push([x, y]);
  }
  for (let i = 0; i < n; i++) at.push(holes[i] ? [ct.mouth[0] + holes[i][0], ct.mouth[1] + holes[i][1], zb] : null);
  holes.length = Math.min(holes.length, n);
  // a kit's holder: a slotted plate on a skirt that stands on the floor; it prints upside down
  if (o.joints) return { mesh: null, at, holes, zb, base: !!H.base, kit: (slots) => { const m = mk(); put(m, slottedPlate(H.R, 0, slots, zb - KIT.plate, zb)); put(m, outward(lathe([[Rs - 2, H.zf], [Rs, H.zf], [Rs, zb - KIT.plate + 0.2], [Rs - 2, zb - KIT.plate + 0.2]], 64))); return m; } };
  const m = mk();
  put(m, discWithHoles(H.R, holes, zb - PEG.depth, zb));
  put(m, discWithHoles(H.R, [], zb - PEG.depth - 1.8, zb - PEG.depth + 0.2));
  if (!H.base) {
    // post and foot down to the floor
    const fr = H.foot || H.R;
    put(m, lathe([[1e-4, H.zf], [fr, H.zf], [fr, H.zf + 2], [7, H.zf + 2], [7, zb - PEG.depth - 1.6], [1e-4, zb - PEG.depth - 1.6]], 48));
  }
  return { mesh: m, at, holes, zb, base: !!H.base };
}
// ------------------------------------------------------------------ laying the pieces out to print
// parts carry .piece (which piece they belong to) and heads a .frame (the head's own axes); each piece
// is turned to print well (heads upright on their collar, stems lying flat), set on the plate and
// packed in rows. Returns new parts (the head of a laid-out flower keeps its petal info for the viewer).
export function layoutPieces(parts, o = {}) {
  const groups = new Map();
  for (const p of parts) { const k = p.piece || "p:" + p.name; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const xf = (m, M) => put(mk(), m, M);
  const bbox = (L) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const p of L) for (let i = 0; i < p.mesh.V.length; i += 3) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], p.mesh.V[i + d]); hi[d] = Math.max(hi[d], p.mesh.V[i + d]); } return { lo, hi }; };
  const placed = [];
  for (const [k, L] of groups) {
    let T = new THREE.Matrix4();
    if (L[0].frame) T = L[0].frame.clone().invert();
    else if (/:stem$/.test(k)) {
      // lay it flat: its long axis along X, then the turn round that axis with the lowest height
      const V = []; for (const p of L) for (let i = 0; i < p.mesh.V.length; i += 3 * Math.max(1, Math.floor(p.mesh.V.length / 3 / 4000))) V.push(new THREE.Vector3(p.mesh.V[i], p.mesh.V[i + 1], p.mesh.V[i + 2]));
      const c = V.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / V.length);
      let far = V[0]; for (const v of V) if (v.distanceTo(c) > far.distanceTo(c)) far = v;
      let far2 = far; for (const v of V) if (v.distanceTo(far) > far2.distanceTo(far)) far2 = v;
      const ax = far2.clone().sub(far).normalize();
      const A = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(ax, new THREE.Vector3(1, 0, 0))).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      let best = null;
      for (let s = 0; s < 24; s++) {
        const Ms = new THREE.Matrix4().makeRotationX((s / 24) * Math.PI * 2).multiply(A);
        let lo = 1e9, hi = -1e9; const e = Ms.elements;
        for (const v of V) { const z = e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14]; lo = Math.min(lo, z); hi = Math.max(hi, z); }
        if (!best || hi - lo < best[0]) best = [hi - lo, Ms];
      }
      T = best[1];
    }
    const out = L.map((p) => ({ ...p, mesh: xf(p.mesh, T), head: p.head ? { ...p.head, M: T.clone().multiply(p.head.M) } : undefined, frame: undefined }));
    const b = bbox(out);
    placed.push({ k, out, b, w: b.hi[0] - b.lo[0], d: b.hi[1] - b.lo[1] });
  }
  // shelf packing, biggest first, rows up to the plate width
  const W = o.width || 240, gap = 6;
  placed.sort((p, q) => q.w * q.d - p.w * p.d);
  let x = 0, y = 0, row = 0;
  const res = [];
  for (const P of placed) {
    if (x > 0 && x + P.w > W) { x = 0; y += row + gap; row = 0; }
    const M = new THREE.Matrix4().makeTranslation(x - P.b.lo[0], y - P.b.lo[1], -P.b.lo[2]);
    for (const p of P.out) res.push({ ...p, mesh: xf(p.mesh, M), head: p.head ? { ...p.head, M: M.clone().multiply(p.head.M) } : undefined });
    x += P.w + gap; row = Math.max(row, P.d);
  }
  // centred on the origin
  const b = bbox(res), C = new THREE.Matrix4().makeTranslation(-(b.lo[0] + b.hi[0]) / 2, -(b.lo[1] + b.hi[1]) / 2, 0);
  return res.map((p) => ({ ...p, mesh: xf(p.mesh, C), head: p.head ? { ...p.head, M: C.clone().multiply(p.head.M) } : undefined }));
}
// default colors for a flower in a style
export function colorsFor(sp, style, k = 0) {
  if (style === "mech") return { petal: METAL.petal[k % METAL.petal.length], center: METAL.center, stem: METAL.stem, leaf: METAL.leaf };
  return { petal: sp.colors[k % sp.colors.length], center: sp.center0 || (sp.center && sp.center.type === "stamens" ? "#f2c14e" : "#e0b84a"), stem: "#4f7f2f", leaf: "#5d9c3a" };
}

// ------------------------------------------------------------------ wreaths
// A flat ring that prints lying down, with a loop to hang it by. Flowers stand up from its top on
// short stems, facing out of the wall; greenery and spikes (eucalyptus, fern, lavender) lie along
// the ring. Each flower gets its own stretch of the ring, so none overlap (two rows when they need
// the room). "height" is the wreath's outside diameter. In pieces, the ring has a socket for every stem.
function wreathRing(Dw, Wr, T, holes, mech) {
  const Ro = Dw / 2, Ri = Dw / 2 - Wr, m = mk();
  const layer = (z0, z1, hs) => {
    const sh = new THREE.Shape();
    for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; i ? sh.lineTo(Ro * Math.cos(a), Ro * Math.sin(a)) : sh.moveTo(Ro, 0); }
    const inner = new THREE.Path(); for (let i = 0; i <= 96; i++) { const a = -(i / 96) * Math.PI * 2; i ? inner.lineTo(Ri * Math.cos(a), Ri * Math.sin(a)) : inner.moveTo(Ri, 0); } sh.holes.push(inner);
    for (const [x, y] of hs) { const h = new THREE.Path(); for (let i = 0; i <= PEG.segs; i++) { const a = -(i / PEG.segs) * Math.PI * 2; i ? h.lineTo(x + SOCK_R * Math.cos(a), y + SOCK_R * Math.sin(a)) : h.moveTo(x + SOCK_R, y); } sh.holes.push(h); }
    const g = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 }); g.translate(0, 0, z0); return weldGeo(g);
  };
  if (holes.length) { put(m, layer(0, T - PEG.depth + 0.2, [])); put(m, layer(T - PEG.depth, T, holes)); }
  else put(m, layer(0, T, []));
  // a loop to hang it by, at the top
  put(m, lathe([[4, 0], [8.5, 0], [8.5, 4], [4, 4]], 32), new THREE.Matrix4().makeTranslation(0, Ro + 6, 0));
  if (mech) for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; if (Math.abs(a - Math.PI / 2) < 0.12) continue; put(m, box(4, 4, T * 0.6), new THREE.Matrix4().makeRotationZ(a).multiply(new THREE.Matrix4().makeTranslation(Ro + 1.2, 0, 0))); }
  return m;
}
// a kit's wreath ring: a slotted plate on two walls (a channel, open at the back, so it prints upside
// down on its face), with the loop to hang it by in the plate
function kitWreathRing(Dw, Wr, T, slots, mech) {
  const Ro = Dw / 2, Ri = Dw / 2 - Wr, m = mk();
  // (the loop: a ring in the plate, at the top)
  const loop = new THREE.Shape(); for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; i ? loop.lineTo(8.5 * Math.cos(a), Ro + 6 + 8.5 * Math.sin(a)) : loop.moveTo(8.5, Ro + 6); }
  const lh = new THREE.Path(); for (let i = 0; i <= 48; i++) { const a = -(i / 48) * Math.PI * 2; i ? lh.lineTo(4 * Math.cos(a), Ro + 6 + 4 * Math.sin(a)) : lh.moveTo(4, Ro + 6); } loop.holes.push(lh);
  put(m, slottedPlate(Ro, Ri, slots, T - KIT.plate, T, [loop]));
  put(m, outward(lathe([[Ri, 0], [Ri + 2, 0], [Ri + 2, T - KIT.plate + 0.2], [Ri, T - KIT.plate + 0.2]], 128)));
  put(m, outward(lathe([[Ro - 2, 0], [Ro, 0], [Ro, T - KIT.plate + 0.2], [Ro - 2, T - KIT.plate + 0.2]], 128)));
  if (mech) for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; if (Math.abs(a - Math.PI / 2) < 0.12) continue; put(m, box(4, 4, T), new THREE.Matrix4().makeRotationZ(a).multiply(new THREE.Matrix4().makeTranslation(Ro + 1.2, 0, 0))); }
  return m;
}
function buildWreath(a, o) {
  const R = rng(a.seed || 1), mech = o.style === "mech";
  let Dw = Math.max(140, Math.min(400, a.height || 230));
  const T = 10;
  const list = [];
  for (const it of a.items) for (let k = 0; k < Math.max(0, Math.min(20, it.n | 0)); k++) list.push(it);
  const lying = (sp) => sp.form === "greenery" || !!sp.spike;
  const colorsOf = (it) => ({ ...o.colors, petal: it.color || o.colors.petal, center: it.center || o.colors.center });
  // measure each kind once, built as it will be: standing ones on the origin (head at 60 mm), lying
  // ones along X. r: the head's reach round its stem; below / above: how far its head hangs under /
  // stands over the head's point (anything outside the stem's own column); lying: length, half-width,
  // and how much higher its start must be so nothing touches the ring
  const meas = new Map();
  // k: the flowers' size (1 = as chosen)
  const measure = (it, k = 1) => {
    const key = it.id + "|" + (it.color || "") + "|" + k.toFixed(3);
    if (meas.has(key)) return meas.get(key);
    const sp = byId(it.id), oo = { ...o, scale: (o.scale || 1) * k, colors: colorsOf(it), noLeaves: !lying(sp), straight: !!o.joints, lead: 4 };
    const m = { r: 0, below: 0, above: 0, x0: 0, x1: 0, w: 0, low: 1e9 };
    if (lying(sp)) {
      const L = 60 * Math.max(0.6, k);
      // (everything counts for "low" except the stem's own foot)
      for (const pt of buildFlower(sp, oo, [0, 0, 0], [L, 0, 5], [0.97, 0, 0.24], 7)) { const st = / stem$/.test(pt.name); for (let v = 0; v < pt.mesh.V.length; v += 3) { const x = pt.mesh.V[v], y = pt.mesh.V[v + 1], z = pt.mesh.V[v + 2]; m.x0 = Math.min(m.x0, x); m.x1 = Math.max(m.x1, x); m.w = Math.max(m.w, Math.abs(y)); if (!st || Math.hypot(x, y) > 4.5) m.low = Math.min(m.low, z); m.above = Math.max(m.above, z); } }
      m.L = L; m.half = (m.x1 - m.x0) / 2;
    } else {
      const H0 = 60;
      for (const pt of buildFlower(sp, oo, [0, 0, 0], [0, 0, H0], [0, 0, 1], 7)) for (let v = 0; v < pt.mesh.V.length; v += 3) {
        const x = pt.mesh.V[v], y = pt.mesh.V[v + 1], z = pt.mesh.V[v + 2], r = Math.hypot(x, y);
        if (r > 4.2 || z > H0 - 25) { m.r = Math.max(m.r, r); m.below = Math.max(m.below, H0 - z); m.above = Math.max(m.above, z - H0); }
      }
    }
    meas.set(key, m);
    return m;
  };
  // flowers big to small, greenery spread evenly between them
  const flw = list.filter((it) => !lying(byId(it.id))).sort((p, q) => measure(q).r - measure(p).r), gr = list.filter((it) => lying(byId(it.id)));
  const seq = [];
  { let gi = 0; flw.forEach((it, i) => { seq.push(it); const want = Math.round(((i + 1) * gr.length) / Math.max(1, flw.length)); while (gi < want) seq.push(gr[gi++]); }); while (gi < gr.length) seq.push(gr[gi++]); }
  const n = seq.length, ly = seq.map((it) => lying(byId(it.id)));
  const crescent = a.layout === "crescent", span = crescent ? Math.PI * 1.25 : Math.PI * 2, ring = !crescent;
  const reach = (i, k) => { const m = measure(seq[i], k); return ly[i] ? m.half : m.r; };
  // the stretch of ring between neighbours' middles, measured straight across (4 mm between them)
  const gaps = (k) => seq.map((it, i) => (i + 1 < n || ring ? reach(i, k) + reach((i + 1) % n, k) + 4 : 0));
  const total = (k) => gaps(k).reduce((a1, b1) => a1 + b1, 0) + (ring ? 0 : reach(0, k) + reach(n - 1, k));
  let Wr = Math.max(28, Dw * 0.16), Rc = Dw / 2 - Wr / 2, grew = 0, k = 1;
  if (o.joints) {
    // in pieces nothing may touch: the flowers get a little smaller to fit (down to 55%), then the
    // wreath grows if it must
    for (let it2 = 0; it2 < 4 && total(k) * 1.04 > span * Rc && k > 0.55; it2++) k = Math.max(0.55, (k * span * Rc) / (total(k) * 1.04));
    if (total(k) * 1.04 > span * Rc) { const need = (total(k) * 1.04) / span; const D2 = 2 * need + Wr; grew = Math.round(D2 - Dw); Dw = D2; Wr = Math.max(28, Dw * 0.16); Rc = Dw / 2 - Wr / 2; }
  }
  // whole: when crowded, two rows (leaning out and in), squeezed to fit; they may overlap (it prints as one)
  const rows = !o.joints && total(1) > span * Rc ? 2 : 1;
  const g = gaps(k), fit = (span * Rc) / Math.max(1, total(k)), spread = o.joints ? Math.max(1, fit) : rows === 2 ? Math.min(1, fit) * 2 : Math.min(1.6, fit);
  let th = crescent ? -Math.PI / 2 - span / 2 + (reach(0, k) * spread) / Rc : -Math.PI / 2 + R() * 0.3;
  const parts = [], holes = [];
  seq.forEach((it, i) => {
    const sp = byId(it.id), m = measure(it, k), row = rows === 2 ? i % 2 : 0, rr = Rc + (rows === 2 ? (row ? -1 : 1) * Wr * 0.22 : 0);
    const tm = th; th += (g[i] * spread) / Rc / (rows === 2 ? 2 : 1);
    const c = Math.cos(tm), s2 = Math.sin(tm);
    let base, top, d, lead = 4;
    if (ly[i]) {
      // lying along the ring through its stretch
      const half = m.L / 2, t0 = tm - half / rr, t1 = tm + half / rr, up = Math.max(0, 1.5 - m.low);
      lead = 4 + up;
      base = [rr * Math.cos(t0), rr * Math.sin(t0), T];
      top = [rr * Math.cos(t1), rr * Math.sin(t1), T + 5 + up];
      const tg = [top[0] - base[0], top[1] - base[1]], tl = Math.hypot(...tg) || 1;
      d = [tg[0] / tl, tg[1] / tl, 0.25];
    } else {
      // snug on the ring: just high enough that nothing hangs to its top (whole: leaning a little)
      const lift = Math.max(5, m.below + (o.joints ? 2 : 0.5)), lean = rows === 2 ? (row ? -0.3 : 0.3) : o.joints ? 0 : 0.12 * (R() - 0.5);
      base = [rr * c, rr * s2, T];
      top = [base[0] + c * lean * lift, base[1] + s2 * lean * lift, T + lift];
      d = [c * lean * 1.6, s2 * lean * 1.6, 1];
    }
    const b2 = base.slice(); if (!o.joints) b2[2] = T - 1; // (sunk 1 mm into the ring, so a whole print is joined)

    // build it; in pieces, if anything but its stem's foot comes within 1.5 mm of the ring's top, lift it and build again
    let built;
    for (let kk = 0; kk < 4; kk++) {
      built = buildFlower(sp, { ...o, scale: (o.scale || 1) * k, colors: colorsOf(it), pieceId: "f" + i, noLeaves: !ly[i], straight: !!o.joints, lead }, b2, top, d, (a.seed || 1) * 31 + i);
      if (!o.joints) break;
      let zl = Infinity;
      for (const pt of built) { const st = / stem$/.test(pt.name); for (let v = 0; v < pt.mesh.V.length; v += 3) if (!st || Math.hypot(pt.mesh.V[v] - base[0], pt.mesh.V[v + 1] - base[1]) > 4.5) zl = Math.min(zl, pt.mesh.V[v + 2]); }
      if (zl >= T + 1.5) break;
      const upz = T + 2 - zl; lead += upz; top = [top[0], top[1], top[2] + upz];
    }
    for (const pt of built) { if (o.joints) pt.socketed = true; parts.push(pt); }
  });
  for (const q of parts) if (q.slot) holes.push(kitSlot(q.slot.at, q.slot.u, q.slot.s, T));
  parts.unshift({ name: "Wreath ring", color: o.colors.container, mesh: o.joints ? kitWreathRing(Dw, Wr, T, holes, mech) : wreathRing(Dw, Wr, T, [], mech), piece: "ring", frame: o.joints ? new THREE.Matrix4().makeRotationX(Math.PI) : undefined });
  return { parts, height: T + 40, holder: o.joints ? { sockets: n, stems: n, touching: 0 } : null, wreath: { Dw: Math.round(Dw), rows, grew, size: Math.round(k * 100) } };
}

// ================================================================== kits (printing in pieces)
// Version 2.9.9.9.1: in pieces, every part snaps together and every part lies on a flat face to
// print, with nothing overhanging more than 45 degrees (only short bridges over the snap pockets):
//  - stems print flat (2.4 mm strips) with their leaves in the same plane and a two-prong barbed
//    fork at each end; a fork snaps through a slot in a 2.4 mm plate, its barbs catching behind it
//  - a flower head is a core that stands on a flat star of sepals (the stem's top fork snaps up into
//    it) with a neck; the petals are flat layers, each a ring with a slit that snaps sideways onto the
//    neck (a lip at the top keeps them on), the centre being the last layer. Flowers that can take
//    snap-in petals (Petals: Snap-in) keep their crown of slotted panels, leaning at most 45 degrees
//  - lavender, hydrangeas, baby's breath, ferns and eucalyptus are flat sprigs
//  - the stand, the holder in a container and the wreath ring print upside down on their flat tops,
//    the slots through them and the pockets for the barbs underneath
export const KIT = { ts: 2.4, plate: 2.4, cavR: 3.4, postR: 4.6, neckR: 2.4, lip: 0.7, layerT: 1.6, layerGap: 0.15, centerT: 2.4, slitW: 4.0, maxLean: 30 * deg, holeFit: 0.2 };
const V3 = (a) => new THREE.Vector3(...a);
const basis = (o, x, y, z) => new THREE.Matrix4().makeBasis(x, y, z).setPosition(o);
// the slot a stem's fork needs through a level plate whose top is at zTop: the fork (FORK.w wide
// across s, KIT.ts thick) comes down along -u through the plate's thickness; returns the hole as a
// polygon in plan (x, y), with the fit gap all round
export function kitSlot(at, u, s, zTop, T = KIT.plate) {
  const U = V3(u).normalize(), S = V3(s).normalize(), N = new THREE.Vector3().crossVectors(U, S);
  const hz = new THREE.Vector3(-S.y, S.x, 0); // across, level
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const z of [zTop, zTop - T]) for (const bs of [-FORK.w / 2, FORK.w / 2]) for (const cn of [-KIT.ts / 2, KIT.ts / 2]) {
    // the point on that fork edge at height z
    const p0 = V3(at).addScaledVector(S, bs).addScaledVector(N, cn), k = (z - p0.z) / (U.z || 1e-9), p = p0.addScaledVector(U, k);
    const ds = (p.x - at[0]) * S.x + (p.y - at[1]) * S.y, dh = (p.x - at[0]) * hz.x + (p.y - at[1]) * hz.y;
    a0 = Math.min(a0, ds); a1 = Math.max(a1, ds); b0 = Math.min(b0, dh); b1 = Math.max(b1, dh);
  }
  const f = KIT.holeFit;
  a0 -= f; a1 += f; b0 -= f; b1 += f;
  return [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(([a, b]) => [at[0] + S.x * a + hz.x * b, at[1] + S.y * a + hz.y * b]);
}
// (a closed solid with its faces pointing out: by its volume's sign)
const outwardRing = (m) => outward(m);
// a level plate (outer circle, optional inner circle) with slots, from z0 to z1
function slottedPlate(R, Rin, slots, z0, z1, extra = []) {
  const sh = new THREE.Shape();
  for (let i = 0; i <= 128; i++) { const a = (i / 128) * Math.PI * 2; i ? sh.lineTo(R * Math.cos(a), R * Math.sin(a)) : sh.moveTo(R, 0); }
  if (Rin > 0) { const p = new THREE.Path(); for (let i = 0; i <= 128; i++) { const a = -(i / 128) * Math.PI * 2; i ? p.lineTo(Rin * Math.cos(a), Rin * Math.sin(a)) : p.moveTo(Rin, 0); } sh.holes.push(p); }
  for (const P of slots) { const p = new THREE.Path(); P.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.lineTo(P[0][0], P[0][1]); sh.holes.push(p); }
  const g = new THREE.ExtrudeGeometry([sh, ...extra], { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, z0);
  return weldGeo(g);
}
// the stand for one flower: a plate on a rim, printed upside down
export const KIT_STAND_TOP = 8;
export function kitStand(slots) {
  const m = mk(), T = KIT_STAND_TOP;
  put(m, slottedPlate(25, 0, slots, T - KIT.plate, T));
  put(m, outward(lathe([[22, 0], [25, 0], [25, T - KIT.plate + 0.2], [22, T - KIT.plate + 0.2]], 64)));
  return m;
}
// a petal layer: a ring of petals (flat) round a hole that fits the neck, with a slit to snap it on
function layerShapes(whorls, o, Rcore, rLim, phase0) {
  const mech = o.style === "mech";
  // (a flower with a wide centre, like a sunflower: the layer is a disc out to where its petals start)
  const Rd = Math.max(Rcore, Math.min(Math.max(...whorls.map((w) => w.r0 || 0)), rLim - 4));
  const sh = [circle(0, 0, Rd)];
  for (const w of whorls) {
    const prof = PROF[w.prof] || PROF.round;
    const r0 = Math.max(Rcore - 1.4, Math.min(w.r0 || 0, Rd - 1.4));
    const L = Math.max(3, Math.min(rLim - r0, w.L * (0.6 + 0.4 * Math.cos(Math.min(w.elev || 0, 70 * deg)))));
    for (let i = 0; i < w.n; i++) {
      const a = (w.phase || 0) + (i / w.n) * Math.PI * 2;
      sh.push(lobe(r0 * Math.cos(a), r0 * Math.sin(a), a, L, (u) => Math.max(u < 0.15 ? 1.1 : 0.3, (w.W / 2) * prof(Math.min(0.999, u))), mech ? 6 : 20));
    }
  }
  return sh;
}
function addSlit(sh, rHole, Rmax, phi) {
  const c = Math.cos(phi), s2 = Math.sin(phi), w = KIT.slitW / 2, P = [[0, -w], [Rmax + 2, -w], [Rmax + 2, w], [0, w]].map(([x, y]) => [c * x - s2 * y, s2 * x + c * y]);
  sh.push({ circle: [0, 0], r: rHole, cut: true }, { poly: P, cut: true });
  return sh;
}
const maxR = (m) => { let r = 0; for (let i = 0; i < m.V.length; i += 3) r = Math.max(r, Math.hypot(m.V[i], m.V[i + 1])); return r; };
// a flower head as a kit, in its own axes (z up the stem; its bottom at z = 0; x across the stem's
// fork): { core, layers: [{ mesh, z, color, name }], snaps: [{ mesh, frame }], zPetal }
function kitHead(sp, o) {
  const mech = o.style === "mech", D = sp.D * (o.scale || 1);
  const h = flowerHead(sp, { ...o, petals: o.petals === "snap" ? "snap" : "fixed", kit: true });
  const KI = h.kitInfo, crown = !!KI;
  const whorls = h.whorls.filter((w) => !w.canSnap);
  // the bottom (the sepal star) and where things go, in flowerHead's axes first
  const zB = crown ? KI.zd1 - KIT.plate : 0;
  const zCav = zB + KIT.plate + 2.6, zSh = crown ? Math.max(KI.capZ, zCav + 1.4) : zCav + 1.4;
  // petal layers: outermost at the bottom; more than six rings are paired up, two to a layer
  let groups = whorls.map((w) => [w]);
  while (groups.length > 6) { const g2 = []; for (let i = 0; i < groups.length; i += 2) g2.push([...groups[i], ...(groups[i + 1] || [])]); groups = g2; }
  const rn = KIT.neckR, rh = rn + KIT.holeFit, Rcore = rh + 2.6;
  const layers = [];
  let z = zSh;
  groups.forEach((g, gi) => {
    // (inside a crown, keep clear of its panels, which lean out as they rise)
    // (below the panels' tops: inside their inner faces, which lean in as they rise; above them: short
    // of where the petals, rising at the crown's angle, reach the layer)
    const e = KI ? KI.eS : 0, panelTop = KI ? KI.z0s + (SNAP_SLOT_H / 2 + SNAP.lip) * Math.cos(e) : 0;
    const rLim = !crown ? Infinity : z < panelTop + 0.3 ? KI.rS - SNAP.wall * Math.cos(e) - (z + KIT.layerT - KI.z0s + SNAP.wall * Math.sin(e)) * Math.tan(e) - 1.0 : KI.rS + (z - KI.z0s - 1.4) / Math.max(0.05, Math.tan(e)) - 1.5;
    if (rLim < Rcore + 3) return;
    const shp = layerShapes(g, o, Rcore, rLim);
    const Rm = Math.max(...g.map((w) => (w.r0 || 0) + w.L)) + 2;
    addSlit(shp, rh, Rm, (g[0].phase || 0) + Math.PI / g[0].n);
    layers.push({ mesh: flatSolid(shp, 0, KIT.layerT), z, color: o.colors.petal, name: "petal layer " + (gi + 1) });
    z += KIT.layerT + KIT.layerGap;
  });
  // the centre: the top layer
  if (sp.center) {
    const e = KI ? KI.eS : 0, panelTop = KI ? KI.z0s + (SNAP_SLOT_H / 2 + SNAP.lip) * Math.cos(e) : 0;
    const rLim = !crown ? 99 : z < panelTop + 0.3 ? KI.rS - SNAP.wall * Math.cos(e) - (z + KIT.centerT - KI.z0s + SNAP.wall * Math.sin(e)) * Math.tan(e) - 1.0 : KI.rS + (z - KI.z0s - 1.4) / Math.max(0.05, Math.tan(e)) - 1.5;
    const cm = centerMesh(sp.center, o, D), Rc = Math.max(Rcore + 0.8, Math.min(maxR(cm), rLim));
    const shp = [mech ? { poly: Array.from({ length: 48 }, (_, i) => { const a = (i / 48) * Math.PI * 2, r = i % 4 < 2 ? Rc : Rc - 1.2; return [r * Math.cos(a), r * Math.sin(a)]; }) } : circle(0, 0, Rc)];
    addSlit(shp, rh, Rc, 0.3);
    layers.push({ mesh: flatSolid(shp, 0, KIT.centerT), z, color: o.colors.center, name: "centre" });
    z += KIT.centerT + KIT.layerGap;
  }
  const zN = Math.max(z + 0.2, zSh + 2);
  // the core: a sepal star (with the slot for the stem's fork) under a post with the pocket for the
  // barbs, a shoulder for the layers, the neck, and the lip on top
  const core = mk();
  const Rstar = Math.max(KIT.postR + 1.6, crown ? KI.rb + 0.6 : 0), nS2 = mech ? 6 : 5, Lsep = Math.max(4, Math.min(16, D * 0.2));
  const star = [circle(0, 0, Rstar)];
  for (let i = 0; i < nS2; i++) { const a = (i / nS2) * Math.PI * 2 + 0.3; star.push(lobe((Rstar - 2) * Math.cos(a), (Rstar - 2) * Math.sin(a), a, Lsep, (u) => Math.max(0.4, 2.4 * PROF.pointed(Math.min(0.999, u))), mech ? 5 : 16)); }
  const sw = FORK.w / 2 + FORK.fit, st = KIT.ts / 2 + FORK.fit;
  star.push({ poly: [[-sw, -st], [sw, -st], [sw, st], [-sw, st]], cut: true });
  put(core, flatSolid(star, zB, zB + KIT.plate));
  put(core, outwardRing(lathe([[KIT.cavR, zB + KIT.plate - 0.2], [KIT.postR, zB + KIT.plate - 0.2], [KIT.postR, zSh], [rn, zSh], [rn, zN], [rn + KIT.lip, zN + KIT.lip], [rn + KIT.lip, zN + KIT.lip + 0.8], [1e-4, zN + KIT.lip + 0.8], [1e-4, zCav], [KIT.cavR, zCav]], 32)));
  if (crown) put(core, h.hub);
  // everything moved so the bottom is at z = 0
  const Tz = new THREE.Matrix4().makeTranslation(0, 0, -zB);
  const coreM = put(mk(), core, Tz);
  const snaps = h.petals.filter((p) => p.snap).map((p) => { const F = Tz.clone().multiply(petalMatrix(p, 1)); return { mesh: put(mk(), p.mesh, F), frame: F }; });
  for (const L of layers) L.z -= zB;
  return { core: coreM, layers, snaps, zPetal: (crown ? KI.z0s : zSh + 1) - zB, top: zN + KIT.lip + 0.8 - zB };
}
// a stem (and whatever is flat with it) as flat shapes along x from 0 (its foot) to Ls, y across
export function kitStemShapes(sp, o, Ls, wsh, foot, R) {
  // (a leaning stem's flat foot starts a little up, so its lower corner doesn't dig into the plate)
  const mech = o.style === "mech", main = [rect(o.footLift || 0, -wsh, Ls, wsh)];
  if (mech) for (let x = 12; x < Ls - 8; x += 16) main.push(rect(x - 1.5, -wsh - 1, x + 1.5, wsh + 1));
  if (foot) main.push(...forkShapes(foot, 0, -1));
  // leaves, alternately each side, pointing up the stem, in the stem's plane
  const nl = o.noLeaves ? 0 : Math.min(4, sp.leaves || 0);
  const longL = ["grass", "strap", "sword"].includes(sp.leaf);
  const shape = { lance: LEAF.lance, serrate: LEAF.oval, ovate: LEAF.oval, heart: LEAF.heart, strap: LEAF.strap, grass: LEAF.strap, sword: LEAF.pointed, spoon: LEAF.spatula, oak: LEAF.oval, pad: LEAF.round }[sp.leaf] || LEAF.lance;
  for (let i = 0; i < nl; i++) {
    const side = i % 2 ? -1 : 1, x = Ls * (0.18 + (0.42 * (i + 0.5)) / Math.max(1, nl)), L = Math.min(Ls * (longL ? 0.5 : 0.32), longL ? Ls * 0.45 : Math.max(14, (sp.D || 30) * 0.6));
    const Wd = L * (longL ? 0.1 : sp.leaf === "heart" || sp.leaf === "pad" ? 0.7 : 0.32), a = side * (longL ? 18 : 40) * deg + (R() - 0.5) * 0.1;
    main.push(lobe(x, side * (wsh - 0.6), a, L, (u) => Math.max(0.5, (Wd / 2) * shape(Math.min(0.999, u))), mech ? 6 : 22));
  }
  return main;
}
function buildKit(sp, o, base, top, dir, seed) {
  const R = rng(seed), mech = o.style === "mech", pid = o.pieceId || "f";
  const stemC = o.colors.stem, parts = [];
  // the stem's line, leaning no more than KIT.maxLean
  let u = V3(top).sub(V3(base)); const len = u.length(); u.normalize();
  const tilt = Math.acos(Math.max(-1, Math.min(1, u.z)));
  if (tilt > KIT.maxLean) { const hzn = new THREE.Vector3(u.x, u.y, 0).normalize(); u = new THREE.Vector3(0, 0, 1).multiplyScalar(Math.cos(KIT.maxLean)).addScaledVector(hzn, Math.sin(KIT.maxLean)); }
  let s = new THREE.Vector3(0, 0, 1).cross(u); if (s.length() < 1e-3) { const a = R() * 6.28; s.set(Math.cos(a), Math.sin(a), 0); } s.normalize();
  const n = new THREE.Vector3().crossVectors(u, s);
  const wsh = mech ? 2.8 : Math.max(2.4, Math.min(3.2, 1.6 + (sp.D || 30) / 60 + 0.6));
  // (a leaning stem: the fork goes through the plate at a slant, and its barbs' backs tilt with it)
  const footWall = KIT.plate / Math.max(0.5, u.z) + (KIT.ts / 2) * Math.tan(Math.acos(Math.min(1, u.z))) + 0.05, foot = o.joints && o.joints.foot === false ? 0 : footWall;
  const B = V3(base);
  o = { ...o, footLift: (KIT.ts / 2) * Math.tan(Math.acos(Math.min(1, u.z))) + 0.05 };
  const stemFrame = (Ls) => basis(B, u, s, n);
  const single = !["greenery", "spike", "cluster", "spray"].includes(sp.form);
  let Ls = len;
  if (single) {
    const kh = kitHead(sp, o);
    Ls = Math.max(20, len - kh.zPetal);
    const Hp = B.clone().addScaledVector(u, Ls), headAt = basis(Hp, s, n, u);
    const shp = kitStemShapes(sp, o, Ls, wsh, foot, R);
    shp.push(...forkShapes(KIT.plate, Ls, 1));
    const F = stemFrame(Ls);
    parts.push({ name: sp.name + " stem", color: stemC, mesh: put(mk(), flatSolid(shp, -KIT.ts / 2, KIT.ts / 2), F), piece: pid + ":stem", frame: F, slot: foot ? { at: base, u: [u.x, u.y, u.z], s: [s.x, s.y, s.z], top: [Hp.x, Hp.y, Hp.z], headR: (sp.D || 30) * (o.scale || 1) * 0.55, w: wsh } : null });
    const hubC = mech ? METAL.center : stemC;
    parts.push({ name: sp.name + " head", color: hubC, mesh: put(mk(), kh.core, headAt), piece: pid + ":head", frame: headAt });
    kh.layers.forEach((L, k) => { const F2 = headAt.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, L.z)); parts.push({ name: `${sp.name} ${L.name}`, color: L.color, mesh: put(mk(), L.mesh, F2), piece: `${pid}:layer${k + 1}`, frame: F2, kitLayer: true }); });
    kh.snaps.forEach((q, k) => { const F2 = headAt.clone().multiply(q.frame); parts.push({ name: `${sp.name} petal ${k + 1}`, color: o.colors.petal, mesh: put(mk(), q.mesh, headAt), piece: `${pid}:petal${k + 1}`, frame: F2, snapPetal: true }); });
    return parts;
  }
  // sprigs: all flat, in the stem's plane
  const F = stemFrame(Ls), flo = [], main = kitStemShapes(sp, { ...o, noLeaves: o.noLeaves || sp.form === "greenery" }, Ls, wsh, foot, R);
  let floC = o.colors.petal, x0 = Ls;
  if (sp.form === "greenery") {
    if (sp.leaf === "frond") {
      // a fern frond: pairs of leaflets up the midrib
      for (let i = 1; i <= 9; i++) { const x = Ls * (0.22 + 0.075 * i), L = Math.max(4, Ls * 0.24 * (1 - i * 0.075)); for (const sd of [-1, 1]) main.push(lobe(x, sd * (wsh - 0.6), sd * 50 * deg, L, (q) => Math.max(0.5, L * 0.18 * LEAF.lance(Math.min(0.999, q))), mech ? 5 : 14)); }
      main.push(lobe(Ls - 1, 0, 0, Ls * 0.12, (q) => Math.max(0.5, 2.2 * LEAF.lance(Math.min(0.999, q))), 14));
    } else {
      // round leaves in pairs (eucalyptus)
      for (let i = 0; i < 7; i++) { const x = Ls * (0.25 + 0.11 * i), r = Math.max(3, 7 - i * 0.5); for (const sd of [-1, 1]) main.push(circle(x, sd * (wsh + r * 0.75), r)); }
    }
    parts.push({ name: sp.name, color: o.colors.petal || o.colors.leaf, mesh: put(mk(), flatSolid(main, -KIT.ts / 2, KIT.ts / 2), F), piece: pid + ":stem", frame: F, slot: foot ? { at: base, u: [u.x, u.y, u.z], s: [s.x, s.y, s.z] } : null });
    return parts;
  }
  if (sp.form === "spike") {
    // florets up the top of the stem, overlapping into one flat spike
    const S = sp.spike; x0 = Ls * S.from; const r = Math.max(2.2, Math.min(5, S.R * 0.42));
    flo.push(rect(x0 - 0.4, -wsh, Ls, wsh));
    const k = Math.max(3, Math.round((Ls - x0) / (r * 1.1)));
    for (let i = 0; i <= k; i++) { const x = x0 + ((Ls - x0 - r) * i) / k + r * 0.5, taper = S.cone ? 1 - 0.5 * (i / k) : 1; for (const sd of S.oneSide ? [i % 2 ? 1 : -1] : [-1, 0, 1]) flo.push(circle(x, sd * (wsh + r * 0.35) * taper, r * taper)); }
  } else if (sp.form === "cluster") {
    // a flat round head of florets at the top
    const S = sp.cluster, Rr = Math.max(8, S.R * (o.scale || 1) * (S.umbel ? 1 : 0.8)), r = Math.max(2, Math.min(5, (sp.D || 12) * 0.32)), cx = Ls + Rr * 0.8;
    flo.push(rect(Ls - 2, -wsh, cx, wsh), circle(cx, 0, Rr - r * 0.6));
    const nf = Math.max(8, Math.min(60, Math.round((Rr * Rr) / (r * r)))); for (let i = 0; i < nf; i++) { const f = Math.sqrt((i + 0.5) / nf) * (Rr - r * 0.5), a = i * 2.39996; flo.push(circle(cx + f * Math.cos(a), f * Math.sin(a), r)); }
    x0 = Ls - 2;
  } else {
    // baby's breath: fine branches fanning out, a puff at each end
    const S = sp.spray, nb = Math.min(14, S.n), Rr = Math.max(15, S.R), rp = Math.max(1.8, (sp.center?.r || 1.5) * 1.3);
    flo.push(rect(Ls - 2, -wsh, Ls + 2, wsh));
    for (let i = 0; i < nb; i++) {
      const a = ((i / (nb - 1)) - 0.5) * 2.2, rr = Rr * (0.55 + 0.45 * ((i * 7) % 5) / 4), ex = Ls + Math.cos(a) * rr, ey = Math.sin(a) * rr;
      const c = Math.cos(a), sn = Math.sin(a); flo.push({ poly: [[Ls - sn * 0.8, c * 0.8], [ex - sn * 0.8, ey + c * 0.8], [ex + sn * 0.8, ey - c * 0.8], [Ls + sn * 0.8, -c * 0.8]] });
      for (const [dx, dy] of [[0, 0], [1.4, 1], [1.4, -1]]) flo.push(circle(ex + dx * rp * c - dy * rp * sn, ey + dx * rp * sn + dy * rp * c, rp));
    }
    x0 = Ls - 2;
  }
  // the stem part (stem colour) and the flowers part (flower colour): one piece, two colours
  // (the stem part stops where the flowers start: no joint rings past it)
  const mainCut = main.filter((q, i) => i === 0 || !q.poly || q.poly.some(([x]) => x < x0 - 1)); mainCut[0] = rect(o.footLift || 0, -wsh, x0, wsh);
  const slot = foot ? { at: base, u: [u.x, u.y, u.z], s: [s.x, s.y, s.z] } : null;
  parts.push({ name: sp.name + " stem", color: stemC, mesh: put(mk(), flatSolid(mainCut, -KIT.ts / 2, KIT.ts / 2), F), piece: pid + ":stem", frame: F, slot });
  parts.push({ name: sp.name + " flowers", color: floC, mesh: put(mk(), flatSolid(flo, -KIT.ts / 2, KIT.ts / 2), F), piece: pid + ":stem", frame: F });
  return parts;
}

// do two meshes come within d of each other (or cross)? Vertex-to-triangle distances both ways, and
// edges through triangles, looked up in a coarse grid of each mesh's triangles (made once per mesh)
const GRID_CELL = 6;
function triGrid(M, d) {
  if (M._grid && M._gridD === d) return M._grid;
  const g = new Map(), c = GRID_CELL, K = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
  for (let t = 0; t < M.I.length; t += 3) {
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let k = 0; k < 3; k++) { const i = M.I[t + k] * 3; x0 = Math.min(x0, M.V[i]); x1 = Math.max(x1, M.V[i]); y0 = Math.min(y0, M.V[i + 1]); y1 = Math.max(y1, M.V[i + 1]); z0 = Math.min(z0, M.V[i + 2]); z1 = Math.max(z1, M.V[i + 2]); }
    for (let x = Math.floor((x0 - d) / c); x <= Math.floor((x1 + d) / c); x++) for (let y = Math.floor((y0 - d) / c); y <= Math.floor((y1 + d) / c); y++) for (let z = Math.floor((z0 - d) / c); z <= Math.floor((z1 + d) / c); z++) { const k = K(x, y, z); let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(t); }
  }
  M._grid = g; M._gridD = d;
  return g;
}
export function meshesTouch(A, B, d) {
  const c = GRID_CELL, K = (x, y, z) => (Math.floor(x / c) + 512) * 1048576 + (Math.floor(y / c) + 512) * 1024 + (Math.floor(z / c) + 512);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3(), tri = new THREE.Triangle(a, b, cc), cp = new THREE.Vector3(), v = new THREE.Vector3(), ray = new THREE.Ray(), hit = new THREE.Vector3(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
  const setT = (M, t) => { let i = M.I[t] * 3; a.set(M.V[i], M.V[i + 1], M.V[i + 2]); i = M.I[t + 1] * 3; b.set(M.V[i], M.V[i + 1], M.V[i + 2]); i = M.I[t + 2] * 3; cc.set(M.V[i], M.V[i + 1], M.V[i + 2]); };
  const one = (P, Q) => {
    const g = triGrid(Q, d);
    for (let i = 0; i < P.V.length; i += 3) { v.set(P.V[i], P.V[i + 1], P.V[i + 2]); const L = g.get(K(v.x, v.y, v.z)); if (!L) continue; for (const t of L) { setT(Q, t); tri.closestPointToPoint(v, cp); if (cp.distanceToSquared(v) < d * d) return true; } }
    for (let t = 0; t < P.I.length; t += 3) for (const [x, y] of [[0, 1], [1, 2], [2, 0]]) {
      let i = P.I[t + x] * 3; p0.set(P.V[i], P.V[i + 1], P.V[i + 2]); i = P.I[t + y] * 3; p1.set(P.V[i], P.V[i + 1], P.V[i + 2]);
      const L = g.get(K((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2)); if (!L) continue;
      const len = p0.distanceTo(p1); if (!len) continue; ray.origin.copy(p0); ray.direction.copy(p1).sub(p0).multiplyScalar(1 / len);
      for (const tt of L) { setT(Q, tt); if (ray.intersectTriangle(a, b, cc, false, hit) && hit.distanceTo(p0) < len) return true; }
    }
    return false;
  };
  return one(A, B) || one(B, A);
}
// (shared with the tree maker)
export const GEO = { mk, put, tube, lathe, outward, ellipsoid, cyl, box, rng, aim, weldGeo };
