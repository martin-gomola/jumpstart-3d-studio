// Expandable: a solid made into a hollow stack of rings that slide out of each other and catch,
// printed in one piece (like the expandable ghosts and pumpkins people print).
// The shape is hollowed to a wall, then cut into rings (level or tilted cuts). At each cut the
// wall is split in layers through its thickness: the outer ring keeps the outer layer and a lip
// at the top of its middle layer; the inner ring keeps the inner layer and a foot at the bottom
// of the middle layer. Pull the rings apart and each foot slides up its channel until it meets
// the lip, so the rings stay together. The channel is the foot's path (worked out on the grid by
// sliding the inner ring along the pull direction) plus the clearance, so tapered walls work too.
// The inner ring of each joint is the one toward the wider end of the shape, so it slides out
// into more room; on a ghost (wider at the bottom) the rings drop down out of the head.
// Everything is worked out on a grid of signed distances (negative inside), and each ring's
// surface is drawn as a mesh (surface nets).
import { distanceField, insideField, isoSurface, components } from "./sdfshell.js";
import { simplify } from "./meshimport.js";

// motion: slide (straight out), twist (screws out along a helix, guided by tabs in spiral
// grooves), spin (slides and spins freely all the way round, like fidget rings).
// catch: lock (the rings stay together), snap (a small ridge you can pop past, so they come
// apart and push back together), apart (no catch: the rings slide or unscrew right off).
export const EXPAND_DEFAULTS = { n: 5, wall: 3.2, clear: 0.45, stretch: 80, tilt: 0, dir: "auto", bottom: "open", detail: 1, motion: "slide", twist: 90, tabs: 3, catch: "lock", spacing: "even" };
export const EXPAND_PRESETS = {
  stretch: { name: "Classic stretch", motion: "slide", catch: "lock", tilt: 0 },
  slanted: { name: "Slanted bands", motion: "slide", catch: "lock", tilt: 15 },
  twist: { name: "Twist fidget", motion: "twist", catch: "lock", tilt: 0, twist: 120, tabs: 3 },
  spinner: { name: "Spinner rings", motion: "spin", catch: "lock", tilt: 0 },
  snap: { name: "Snap apart", motion: "slide", catch: "snap", tilt: 0 },
  unscrew: { name: "Unscrew apart", motion: "twist", catch: "apart", tilt: 0, twist: 180, tabs: 2 },
};
const BIG = 1e9;
const tick = () => new Promise((r) => setTimeout(r, 0));
const COLORS = ["#f2efe9", "#e9e3d8", "#f6f1e7", "#ece6db", "#f4eee4", "#e6dfd2", "#f0eadf", "#e8e1d5", "#f3ede2", "#ebe4d9", "#f5efe5", "#e7e0d4"];

// exact distance transform (Felzenszwalb) of a 2D mask, then signed (mm, negative inside)
function edt2(mask, W, H) {
  const INF = 1e20, M = Math.max(W, H), f = new Float64Array(M), d = new Float64Array(M), v = new Int32Array(M), z = new Float64Array(M + 1), out = new Float64Array(W * H);
  const pass = (n) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = mask[x + W * y] ? 0 : INF; pass(H); for (let y = 0; y < H; y++) out[x + W * y] = d[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = out[x + W * y]; pass(W); for (let x = 0; x < W; x++) out[x + W * y] = d[x]; }
  return out;
}
function signed2(mask, W, H, h) {
  const inv = new Uint8Array(W * H); for (let q = 0; q < W * H; q++) inv[q] = mask[q] ? 0 : 1;
  const a = edt2(mask, W, H), b = edt2(inv, W, H), out = new Float32Array(W * H);
  for (let q = 0; q < W * H; q++) out[q] = mask[q] ? -(Math.sqrt(b[q]) - 0.5) * h : (Math.sqrt(a[q]) - 0.5) * h;
  return out;
}

// ---- surface clean-up: the grid's surfaces are made smooth and true to the shape
function sampler(G, A) {
  const { o, h, nx, ny, nz } = G, sy = nx, sz = nx * ny;
  return (x, y, z) => {
    const fx = (x - o[0]) / h, fy = (y - o[1]) / h, fz = (z - o[2]) / h;
    const i = Math.min(nx - 2, Math.max(0, Math.floor(fx))), j = Math.min(ny - 2, Math.max(0, Math.floor(fy))), k = Math.min(nz - 2, Math.max(0, Math.floor(fz)));
    const u = fx - i, v = fy - j, w = fz - k, q = i + sy * j + sz * k;
    const a = A[q], b = A[q + 1], c = A[q + sy], d = A[q + sy + 1], e = A[q + sz], f = A[q + sz + 1], g = A[q + sz + sy], hh = A[q + sz + sy + 1];
    if (a > 1e8 || b > 1e8 || c > 1e8 || d > 1e8 || e > 1e8 || f > 1e8 || g > 1e8 || hh > 1e8) return NaN;
    const c00 = a + (b - a) * u, c10 = c + (d - c) * u, c01 = e + (f - e) * u, c11 = g + (hh - g) * u;
    const c0 = c00 + (c10 - c00) * v, c1 = c01 + (c11 - c01) * v;
    return c0 + (c1 - c0) * w;
  };
}
// the nearest point on the original shape's surface (triangles bucketed on a coarse grid)
function surfaceSnapper(V, I, cell) {
  const tri = I.length / 3, B = new Map(), key = (i, j, k) => i + "," + j + "," + k;
  for (let t = 0; t < tri; t++) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let c = 0; c < 3; c++) { const q = I[t * 3 + c] * 3; x0 = Math.min(x0, V[q]); x1 = Math.max(x1, V[q]); y0 = Math.min(y0, V[q + 1]); y1 = Math.max(y1, V[q + 1]); z0 = Math.min(z0, V[q + 2]); z1 = Math.max(z1, V[q + 2]); }
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(y0 / cell); j <= Math.floor(y1 / cell); j++) for (let k = Math.floor(z0 / cell); k <= Math.floor(z1 / cell); k++) {
      const kk = key(i, j, k); let L = B.get(kk); if (!L) B.set(kk, (L = [])); L.push(t);
    }
  }
  const cp = (p, a, b, c) => {
    // closest point on a triangle (Ericson, Real-Time Collision Detection 5.1.5)
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return a;
    const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return b;
    const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; }
    const cpp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dot(ab, cpp), d6 = dot(ac, cpp); if (d6 >= 0 && d5 <= d6) return c;
    const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
    const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]; }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
  };
  const P = (q) => [V[q * 3], V[q * 3 + 1], V[q * 3 + 2]];
  return (p, maxD) => {
    const i0 = Math.floor(p[0] / cell), j0 = Math.floor(p[1] / cell), k0 = Math.floor(p[2] / cell);
    let best = null, bd = maxD * maxD;
    const seen = new Set();
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (let k = k0 - 1; k <= k0 + 1; k++) {
      const L = B.get(key(i, j, k)); if (!L) continue;
      for (const t of L) { if (seen.has(t)) continue; seen.add(t); const q = cp(p, P(I[t * 3]), P(I[t * 3 + 1]), P(I[t * 3 + 2])); const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2; if (d < bd) { bd = d; best = q; } }
    }
    return best;
  };
}
// smooth the mesh a little (Taubin, so it doesn't shrink), then put every point back on the
// ring's surface, and the points on the outside of the shape exactly on the original surface
function refineMesh(m, fF, fS, snap, h, smooth) {
  const V = m.V instanceof Float32Array ? m.V : Float32Array.from(m.V), I = m.I, nv = V.length / 3;
  if (smooth) {
    const nb = Array.from({ length: nv }, () => new Set());
    for (let t = 0; t < I.length; t += 3) for (let c = 0; c < 3; c++) { const a = I[t + c], b = I[t + ((c + 1) % 3)]; nb[a].add(b); nb[b].add(a); }
    const tmp = new Float32Array(V.length);
    for (let it = 0; it < 4; it++) for (const lam of [0.5, -0.53]) {
      for (let v = 0; v < nv; v++) {
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const w of nb[v]) { sx += V[w * 3]; sy += V[w * 3 + 1]; sz += V[w * 3 + 2]; n++; }
        if (!n) { tmp[v * 3] = V[v * 3]; tmp[v * 3 + 1] = V[v * 3 + 1]; tmp[v * 3 + 2] = V[v * 3 + 2]; continue; }
        for (let a = 0; a < 3; a++) tmp[v * 3 + a] = V[v * 3 + a] + lam * ([sx, sy, sz][a] / n - V[v * 3 + a]);
      }
      V.set(tmp);
    }
  }
  const e = h * 0.35;
  for (let v = 0; v < nv; v++) {
    let x = V[v * 3], y = V[v * 3 + 1], z = V[v * 3 + 2];
    const x0 = x, y0 = y, z0 = z;
    for (let it = 0; it < 4; it++) {
      const f = fF(x, y, z); if (!isFinite(f) || Math.abs(f) < 1e-4) break;
      const gx = (fF(x + e, y, z) - fF(x - e, y, z)) / (2 * e), gy = (fF(x, y + e, z) - fF(x, y - e, z)) / (2 * e), gz = (fF(x, y, z + e) - fF(x, y, z - e)) / (2 * e);
      const g2 = gx * gx + gy * gy + gz * gz; if (!(g2 > 1e-6)) break;
      x -= (gx * f) / g2; y -= (gy * f) / g2; z -= (gz * f) / g2;
    }
    // never far from where it was
    const dd = Math.hypot(x - x0, y - y0, z - z0); if (!(dd < 0.6 * h)) { x = x0; y = y0; z = z0; }
    // on the outside of the shape: exactly on the original surface
    const s = fS(x, y, z), f2 = fF(x, y, z);
    if (isFinite(s) && Math.abs(s) < 0.5 * h && Math.abs(f2 - s) < 0.12 * h) { const q = snap([x, y, z], h); if (q) { x = q[0]; y = q[1]; z = q[2]; } }
    V[v * 3] = x; V[v * 3 + 1] = y; V[v * 3 + 2] = z;
  }
  return { V, I };
}

// V, I: the shape's triangles in mm (Z up). Returns { parts: [{ name, color, ring, V, I }], axis, travel, info }
export async function expandableFromMesh(V, I, o0 = {}, progress = () => {}) {
  const o = { ...EXPAND_DEFAULTS, ...o0 };
  const n = Math.max(2, Math.min(12, Math.round(o.n)));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], V[i + a]); max[a] = Math.max(max[a], V[i + a]); }
  if (!(max[2] > min[2])) throw new Error("This shape is empty.");
  // the grid: fine enough to keep the clearance gaps open, within the budget
  const budget = 6e6 * Math.max(1, +o.detail || 1);
  const want = Math.max(0.12, Math.min(+o.clear || 0.4, (+o.wall || 3.2) / 7) * 0.95);
  const pad0 = 3;
  const vol = (max[0] - min[0] + 2 * pad0) * (max[1] - min[1] + 2 * pad0) * (max[2] - min[2] + 2 * pad0);
  let h = Math.max(want, Math.cbrt(vol / budget));
  const notes = [];
  const c = Math.max(+o.clear || 0.4, h * 1.05);
  if (c > (+o.clear || 0.4) + 1e-6) notes.push(`clearance raised to ${c.toFixed(2)} mm for this size (Fine detail keeps it closer)`);
  const t = Math.max(+o.wall || 3.2, 2 * c + 3 * h);
  if (t > (+o.wall || 3.2) + 1e-6) notes.push(`wall made ${t.toFixed(1)} mm so its layers fit`);
  const pad = Math.max(pad0, 2 * h + 1);
  const O = [min[0] - pad, min[1] - pad, min[2] - pad];
  const nx = Math.ceil((max[0] - min[0] + 2 * pad) / h) + 1, ny = Math.ceil((max[1] - min[1] + 2 * pad) / h) + 1, nz = Math.ceil((max[2] - min[2] + 2 * pad) / h) + 1;
  const G = { o: O, h, nx, ny, nz }, N = nx * ny * nz;
  const X = (i) => O[0] + i * h, Z = (k) => O[2] + k * h, idx = (i, j, k) => i + nx * (j + ny * k);
  progress("Measuring the shape…"); await tick();
  const band = t + 3 * h + 0.5;
  const all = []; for (let k = 0; k < I.length / 3; k++) all.push(k);
  const D = distanceField(G, V, I, all, band);
  await tick();
  const ins = insideField(G, V, I);
  const S = new Float32Array(N);
  for (let q = 0; q < N; q++) { const d = Math.min(D[q], band); S[q] = ins[q] ? -d : d; }
  // stray inside/outside mistakes (a ray grazing an edge of the shape's mesh) show as specks:
  // a point away from the surface takes the side most of its neighbours are on
  for (let pass = 0; pass < 2; pass++) {
    let fixed = 0;
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const q = idx(i, j, k); if (D[q] < 1.2 * h) continue;
      const me = S[q] < 0; let same = 0;
      for (const d of [1, -1, nx, -nx, nx * ny, -nx * ny]) if ((S[q + d] < 0) === me) same++;
      if (same <= 1) { S[q] = -S[q]; fixed++; }
    }
    if (!fixed) break;
  }
  // which end is wider: the inner ring of each joint slides toward it
  const area = (z) => { const k = Math.max(0, Math.min(nz - 1, Math.round((z - O[2]) / h))); let a = 0; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (S[idx(i, j, k)] < 0) a++; return a; };
  const zr = max[2] - min[2];
  const sgn = o.dir === "up" ? 1 : o.dir === "down" ? -1 : area(min[2] + zr * 0.3) > area(min[2] + zr * 0.7) ? -1 : 1;
  // the hollow inside, open at the bottom if asked: the skin at the very bottom, under the hollow
  let colBot = null, colIn = null;
  if (o.bottom === "open") {
    const m2 = new Uint8Array(nx * ny); colBot = new Float32Array(nx * ny).fill(BIG);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) if (S[idx(i, j, k)] < -t) { colBot[i + nx * j] = Z(k); m2[i + nx * j] = 1; break; }
    colIn = signed2(m2, nx, ny, h);
  }
  const CAV = new Float32Array(N);
  let anyCav = false;
  for (let k = 0; k < nz; k++) {
    const z = Z(k);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const q = idx(i, j, k);
      let cv = S[q] + t;
      if (colBot) { const c2 = i + nx * j; cv = Math.min(cv, Math.max(colIn[c2], z - Math.min(colBot[c2] + h, min[2] + t + 2 * h))); }
      CAV[q] = cv;
      if (cv < 0) anyCav = true;
    }
  }
  if (!anyCav) throw new Error("This shape is too thin to hollow with that wall: make it bigger or the wall thinner.");
  // the tilted coordinate the cuts run across (w grows in the pull direction)
  const motion = ["twist", "spin"].includes(o.motion) ? o.motion : "slide", latch = ["snap", "apart"].includes(o.catch) ? o.catch : "lock";
  // rings that turn need level cuts: a tilted cut would turn into the next ring
  const tn = motion === "slide" ? Math.tan((Math.max(-40, Math.min(40, +o.tilt || 0)) * Math.PI) / 180) : 0;
  if (motion !== "slide" && +o.tilt) notes.push("cuts are level for rings that turn");
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
  const W = (i, k) => sgn * Z(k) + tn * (X(i) - cx);
  // the cuts go across the upright part of the shape: the longest run of slices whose size
  // changes slowly with height (walls within about 20° of upright). A dome, a point or a flared
  // skirt at the ends stays whole in the end rings, where rings couldn't slide.
  const sliceR = new Float32Array(nz);
  for (let k = 0; k < nz; k++) { let a2 = 0; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (S[idx(i, j, k)] < 0) a2++; sliceR[k] = Math.sqrt((a2 * h * h) / Math.PI); }
  const up = new Uint8Array(nz), dk = Math.max(1, Math.round(1.5 / h));
  for (let k = dk; k < nz - dk; k++) up[k] = sliceR[k] > t * 1.5 && Math.abs(sliceR[k + dk] - sliceR[k - dk]) / (2 * dk * h) < 0.27 ? 1 : 0;
  let best = [0, -1];
  for (let k = 0; k < nz; ) { if (!up[k]) { k++; continue; } let e = k; while (e + 1 < nz && up[e + 1]) e++; if (e - k > best[1] - best[0]) best = [k, e]; k = e + 1; }
  let za = Z(best[0]), zb = Z(best[1]);
  if (!(zb - za > 4 * t)) { za = min[2] + 0.15 * zr; zb = max[2] - 0.15 * zr; notes.push("this shape has no long upright part, so the rings may not slide freely"); }
  za += t; zb -= t;
  // a cut is a tilted plane: it must stay inside the upright part all the way across the shape
  const R0 = Math.max(cx - min[0], max[0] - cx), half = Math.abs(tn) * R0;
  let w0 = Math.min(sgn * za, sgn * zb) + half, w1 = Math.max(sgn * za, sgn * zb) - half;
  if (!(w1 - w0 > 4 * t)) throw new Error(tn ? "The cuts are tilted too much for this shape's upright part: use less tilt." : "This shape's upright part is too short for sliding rings.");
  // the cuts sit inside that part, the end rings reach out to the ends
  const nIn = n - 1;
  // each joint runs from its cut into the next Hb, so the last joint ends at the end of the upright part
  // even spacing, or graded: rings get taller toward the wide end (the last joint is the tallest)
  const wt = []; for (let m = 0; m < nIn; m++) wt.push(o.spacing === "graded" && nIn > 1 ? 1 + (0.7 * m) / (nIn - 1) : 1);
  const wsum = wt.reduce((x, y) => x + y, 0);
  const cuts = []; { let acc = w0; for (let m = 0; m < nIn; m++) { cuts.push(acc); acc += ((w1 - w0) * wt[m]) / wsum; } }
  const Hb = ((w1 - w0) * Math.min(...wt)) / wsum;
  // round enough to turn? (rings that turn inside a shape that isn't round rub through it)
  if (motion !== "slide") {
    const k = Math.max(0, Math.min(nz - 1, Math.round((0.5 * (za + zb) - O[2]) / h)));
    let rmin = Infinity, rmax = 0;
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const q = idx(i, j, k); if (!(S[q] < 0)) continue;
      if (S[q - 1] >= 0 || S[q + 1] >= 0 || S[q - nx] >= 0 || S[q + nx] >= 0) { const r = Math.hypot(X(i) - cx, O[1] + j * h - cy); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
    }
    if (rmax > 0 && rmin / rmax < 0.9) notes.push("this shape isn't round, so rings that turn will rub grooves through the next ring: round shapes (cylinders, bottles, pumpkins) twist and spin best");
  }
  // the joint: J tall, with a foot and a lip l tall; the rings slide T apart
  let J = Math.min((Math.max(20, Math.min(85, +o.stretch || 60)) / 100) * Hb, Hb - c - 2 * h);
  const l = Math.max(2 * h, Math.min(2, J * 0.16));
  const T = J - 2 * l - 2 * c;
  if (!(T > 2 * h)) throw new Error(`The rings are too short to slide (${Hb.toFixed(1)} mm each): use fewer rings, more stretch, or a bigger shape.`);
  const tp = t - 2 * c, a = 0.34 * tp, b = a + c + 0.36 * tp;
  const R0xy = Math.max(max[0] - cx, cx - min[0], max[1] - cy, cy - min[1]) + pad;
  const pm = 2 * Math.abs(tn) * R0xy + 3 * h; // how much of the inner ring's own wall is checked as it moves
  const Tapart = J + c + 2 * h + pm; // far enough for the foot to leave the joint
  const twistTotal = motion === "twist" ? ((Math.max(15, Math.min(720, +o.twist || 90)) * Math.PI) / 180) : 0;
  const rate = T > 0 ? twistTotal / T : 0; // radians per mm of travel
  const nTabs = Math.max(1, Math.min(6, Math.round(+o.tabs || 3)));
  const tabHalf = Math.max(1.6, Math.min(4, l * 1.5)); // half the width of a tab (mm, round the ring)
  const ov = latch === "snap" ? c + Math.max(0.3, Math.min(0.6, 0.25 * (b - a))) : 0; // a snap leaves this much lip
  const FA = new Float32Array(N), SW = new Float32Array(N), SW2 = new Float32Array(N), F = new Float32Array(N);
  const Yc = (j) => O[1] + j * h;
  // the inner ring's pieces at a joint (inner layer, foot, and the start of its own full wall),
  // as the ring above the cut has them; shallow: a foot that only just meets a snap's ridge
  const aField = (q, v, i, j, shallow = false) => {
    const s2 = S[q];
    const Il = Math.max(b + c + s2, -CAV[q], c - v, v - (J + c + h));
    let foot = Math.max(a + c + (shallow ? ov : 0) + s2, -s2 - (b + c), c - v, v - (c + l));
    if (motion === "twist") {
      // tabs, not a whole ring: they run in spiral grooves, so the ring screws out
      const x = X(i) - cx, y = Yc(j) - cy, r = Math.hypot(x, y), ph = Math.atan2(y, x), st = (2 * Math.PI) / nTabs;
      let d = ph - Math.round(ph / st) * st;
      foot = Math.max(foot, Math.abs(d) * r - tabHalf);
    }
    const own = Math.max(Math.max(s2, -CAV[q]), J + c - v, v - (J + c + pm));
    return Math.min(Il, foot, own);
  };
  // the inner ring's pieces swept along their whole path: straight, along a helix, or spun all round
  const sweep = (hi, len, shallow, out) => {
    FA.fill(BIG);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = W(i, k) - hi;
      if (v < c - 2 * h || v > J + c + pm) continue;
      FA[idx(i, j, k)] = aField(idx(i, j, k), v, i, j, shallow);
    }
    const Kn = Math.max(1, Math.round(len / h)), step = sgn > 0 ? 1 : -1, sl = nx * ny;
    out.fill(BIG);
    if (motion === "slide") {
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
        let m = BIG;
        for (let s2 = 0; s2 <= Kn; s2++) { const kk = k - step * s2; if (kk < 0 || kk >= nz) break; const f = FA[i + nx * j + sl * kk]; if (f < m) m = f; }
        out[i + nx * j + sl * k] = m;
      }
    } else if (motion === "spin") {
      // all the way round: the least of each slice at each distance from the axis
      const hb = h * 0.5, nb = Math.ceil(R0xy / hb) + 3, prof = new Float32Array(nz * nb).fill(BIG);
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const f = FA[idx(i, j, k)]; if (f >= BIG) continue;
        const rb = Math.min(nb - 1, Math.round(Math.hypot(X(i) - cx, Yc(j) - cy) / hb)), p = k * nb + rb;
        if (f < prof[p]) prof[p] = f;
      }
      const pr2 = new Float32Array(nz * nb).fill(BIG);
      for (let k = 0; k < nz; k++) for (let rb = 0; rb < nb; rb++) {
        let m = BIG;
        for (let s2 = 0; s2 <= Kn; s2++) { const kk = k - step * s2; if (kk < 0 || kk >= nz) break; const f = prof[kk * nb + rb]; if (f < m) m = f; }
        pr2[k * nb + rb] = m;
      }
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const rr = Math.min(nb - 1.001, Math.hypot(X(i) - cx, Yc(j) - cy) / hb), b0 = Math.floor(rr), fr = rr - b0, f0 = pr2[k * nb + b0], f1 = pr2[k * nb + b0 + 1]; out[idx(i, j, k)] = f0 >= BIG || f1 >= BIG ? Math.min(f0, f1) : f0 + (f1 - f0) * fr; }
    } else {
      // a helix: each step moves h along the axis and turns rate·h about it
      const angs = []; for (let s2 = 0; s2 <= Kn; s2++) { const th = -rate * s2 * h; angs.push([Math.cos(th), Math.sin(th)]); }
      for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const v = W(i, k) - hi;
          if (v < c - 3 * h || v > J + c + pm + len + 2 * h) continue;
          const x = X(i) - cx, y = Yc(j) - cy;
          let m = BIG;
          for (let s2 = 0; s2 <= Kn; s2++) {
            const kk = k - step * s2; if (kk < 0 || kk >= nz) break;
            const [co, si] = angs[s2];
            // bilinear between the four nearest columns (nearest alone would nibble the thin layers)
            const fx = (cx + co * x - si * y - O[0]) / h, fy = (cy + si * x + co * y - O[1]) / h, i0 = Math.floor(fx), j0 = Math.floor(fy);
            if (i0 < 0 || j0 < 0 || i0 >= nx - 1 || j0 >= ny - 1) continue;
            const tx = fx - i0, ty = fy - j0, q0 = i0 + nx * j0 + sl * kk;
            const f00 = FA[q0], f10 = FA[q0 + 1], f01 = FA[q0 + nx], f11 = FA[q0 + nx + 1];
            const f = f00 >= BIG || f10 >= BIG || f01 >= BIG || f11 >= BIG ? Math.max(Math.min(f00, f10, f01, f11), 0) + (f00 >= BIG && f10 >= BIG && f01 >= BIG && f11 >= BIG ? BIG : 0) : (f00 * (1 - tx) + f10 * tx) * (1 - ty) + (f01 * (1 - tx) + f11 * tx) * ty;
            if (f < m) m = f;
          }
          out[idx(i, j, k)] = m;
        }
      }
    }
  };
  const fS = sampler(G, S), snap = surfaceSnapper(V, I, Math.max(2 * h, 1));
  const parts = [];
  for (let r = 0; r < n; r++) {
    progress(`Making ring ${r + 1} of ${n}…`); await tick();
    const lo = r > 0 ? cuts[r - 1] : -BIG, hi = r < n - 1 ? cuts[r] : BIG;
    // the channel of the joint above this ring: the inner ring's pieces moved along their whole
    // path (to the lip; right out for "comes apart"; and for a snap, a shallow foot right out,
    // which leaves a thin ridge of lip to pop over)
    if (r < n - 1) {
      sweep(hi, latch === "apart" ? Tapart : T, false, SW);
      if (latch === "snap") { sweep(hi, Tapart, true, SW2); for (let q = 0; q < N; q++) if (SW2[q] < SW[q]) SW[q] = SW2[q]; }
    }
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const q = idx(i, j, k), s = S[q], w = W(i, k);
      const shell = Math.max(s, -CAV[q]);
      let f = Math.max(shell, r > 0 ? lo + J + c - w : -BIG, w - hi);
      if (r > 0) { const v = w - lo; if (v > c - 2 * h && v < J + c + 2 * h) f = Math.min(f, aField(q, v, i, j)); }
      if (r < n - 1) {
        const v = w - hi;
        if (v > -2 * h && v < J + 2 * h) f = Math.min(f, Math.max(s, -s - b, -h - v, v - J));
        f = Math.max(f, c - SW[q]);
      }
      F[q] = Math.max(f, s, -CAV[q]);
    }
    if (o.debugXY != null && o.debugXYout) { const k = Math.round((o.debugXY - O[2]) / h), sl = new Float32Array(nx * ny); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) sl[i + nx * j] = F[idx(i, j, k)]; o.debugXYout.push({ r, nx, nz: ny, sl }); }
    if (o.debug) { const j = (ny / 2) | 0, sl = new Float32Array(nx * nz); for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) sl[i + nx * k] = F[idx(i, j, k)]; o.debug.push({ r, nx, nz, sl }); }
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!i || !j || !k || i === nx - 1 || j === ny - 1 || k === nz - 1) F[idx(i, j, k)] = BIG;
    let m = isoSurface(G, F);
    if (!m.I.length) continue;
    const fF = sampler(G, F);
    m = refineMesh(m, fF, fS, snap, h, true);
    const comps = components(m).filter((p) => p.I.length / 3 >= 30);
    const total = comps.reduce((s2, p) => s2 + p.I.length / 3, 0);
    comps.forEach((p, ci) => {
      const lim = Math.max(800, Math.round((19000 * p.I.length) / 3 / total));
      // fewer triangles, then back onto the surfaces (simplifying cuts corners off curves)
      const mm = p.I.length / 3 > lim ? refineMesh(simplify(p, lim).mesh, fF, fS, snap, h, false) : p;
      parts.push({ name: `Ring ${r + 1}${comps.length > 1 ? String.fromCharCode(97 + ci) : ""}`, color: COLORS[r % COLORS.length], ring: r, V: mm.V, I: mm.I });
    });
  }
  if (parts.length < 2) throw new Error("Couldn't make the rings for this shape: try fewer rings or a thinner wall.");
  const dirWord = sgn > 0 ? "up" : "down";
  const how = motion === "twist" ? `twist out ${dirWord} (${Math.round((twistTotal * 180) / Math.PI)}° and ${T.toFixed(1)} mm each, on ${nTabs} tab${nTabs > 1 ? "s" : ""} in spiral grooves)` : motion === "spin" ? `slide ${dirWord} ${T.toFixed(1)} mm each and spin freely` : `slide ${dirWord} ${T.toFixed(1)} mm each (${(T * (n - 1)).toFixed(0)} mm in all)`;
  const end = latch === "apart" ? (motion === "twist" ? " and unscrew right off to come apart" : " and slide right off to come apart") : latch === "snap" ? ", stop at a small ridge, and pop past it to come apart (push them back together the same way)" : " and stay together";
  return {
    parts, axis: [0, 0, sgn], center: [cx, cy], travel: T, rings: n, motion, latch, twist: twistTotal, apart: latch === "lock" ? 0 : J + c + 4,
    info: `${n} rings that ${how}${end}, printed in one piece.` + (notes.length ? " Note: " + notes.join("; ") + "." : ""),
  };
}
