// Storage from a shape: any solid made into storage that keeps its outside.
// Stacked bins: the shape cut into tiers, each hollowed into a bin with a floor; a lip on top of
// each bin fits into a rebate under the next, so the stack locks together; the top can be a lid.
// Drawers: the shape becomes a case with shelves, and each level a drawer that pulls straight out
// of the front (-Y). The drawer's front is the shape's own front surface, with a finger hole.
// Everything is worked out on a grid of signed distances to the shape's surface (negative inside),
// then each part's surface is drawn (surface nets) as a mesh.
import { makeGrid, distanceField, insideField, isoSurface, components } from "./sdfshell.js";
import { simplify } from "./meshimport.js";

const BIG = 1e9;
export const STORE_DEFAULTS = { style: "bins", n: 3, wall: 2.4, floor: 2, clear: 0.3, lip: 5, lid: true, finger: true, detail: 1 };
const tick = () => new Promise((r) => setTimeout(r, 0));

// exact distance transform (Felzenszwalb) of a 2D mask, in cells: squared distance to the nearest set cell
function edt2(mask, W, H) {
  const INF = 1e20, f = new Float64Array(Math.max(W, H)), d = new Float64Array(Math.max(W, H)), v = new Int32Array(Math.max(W, H)), z = new Float64Array(Math.max(W, H) + 1);
  const out = new Float64Array(W * H);
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
// signed distance (mm) to the edge of a 2D mask: negative inside
function signed2(mask, W, H, h) {
  const inv = new Uint8Array(W * H); for (let q = 0; q < W * H; q++) inv[q] = mask[q] ? 0 : 1;
  const a = edt2(mask, W, H), b = edt2(inv, W, H), out = new Float32Array(W * H);
  for (let q = 0; q < W * H; q++) out[q] = mask[q] ? -(Math.sqrt(b[q]) - 0.5) * h : (Math.sqrt(a[q]) - 0.5) * h;
  return out;
}
function meshParts(G, F, limit, minTris = 40) {
  const { nx, ny, nz, h } = G;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!i || !j || !k || i === nx - 1 || j === ny - 1 || k === nz - 1) { const q = i + nx * (j + ny * k); F[q] = Math.max(F[q], h); }
  const m = isoSurface(G, F);
  if (!m.I.length) return [];
  const total = m.I.length / 3;
  return components(m).filter((p) => p.I.length / 3 >= minTris).map((p) => {
    const lim = Math.max(400, Math.round((limit * p.I.length) / 3 / total));
    return p.I.length / 3 > lim ? simplify(p, lim).mesh : p;
  });
}
const lowZ = (m) => { let z = Infinity; for (let i = 2; i < m.V.length; i += 3) z = Math.min(z, m.V[i]); return z; };
const midX = (m) => { let a = Infinity, b = -Infinity; for (let i = 0; i < m.V.length; i += 3) { a = Math.min(a, m.V[i]); b = Math.max(b, m.V[i]); } return (a + b) / 2; };

// V, I: the shape's triangles in mm (Z up). Returns { parts: [{ name, color, V, I }], info }
export async function storageFromMesh(V, I, o0, progress = () => {}) {
  const o = { ...STORE_DEFAULTS, ...o0 };
  const t = Math.max(0.8, o.wall), c = Math.max(0.05, o.clear), fl = Math.max(0.8, o.floor), n = Math.max(1, Math.min(10, Math.round(o.n)));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], V[i + a]); max[a] = Math.max(max[a], V[i + a]); }
  const G = makeGrid(min, max, t, o.detail || 1, t + 3);
  const { nx, ny, nz, h } = G, O = G.o, N = nx * ny * nz;
  if (t < 2 * h) throw new Error(`The wall is thinner than this grid can hold (${(2 * h).toFixed(1)} mm): make the wall thicker, or choose Fine detail.`);
  const L = Math.max(2, o.lip), band = 2 * t + c + 3 * h + 0.5;
  progress("Measuring the shape…"); await tick();
  const all = []; for (let k = 0; k < I.length / 3; k++) all.push(k);
  const D = distanceField(G, V, I, all, band);
  await tick();
  const ins = insideField(G, V, I);
  const S = new Float32Array(N);
  for (let q = 0; q < N; q++) { const d = Math.min(D[q], band); S[q] = ins[q] ? -d : d; }
  const X = (i) => O[0] + i * h, Y = (j) => O[1] + j * h, Z = (k) => O[2] + k * h, idx = (i, j, k) => i + nx * (j + ny * k);
  // the inside (deeper than the wall) from bottom to top
  let zi0 = Infinity, zi1 = -Infinity;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (S[idx(i, j, k)] < -t) { zi0 = Math.min(zi0, Z(k)); zi1 = Math.max(zi1, Z(k)); }
  if (!(zi1 > zi0 + 3 * t)) throw new Error("This shape is too small or too thin to hollow out with that wall: make it bigger or the wall thinner.");
  const parts = [];
  const colors = ["#5b8fd6", "#e0a43a", "#6cbf84", "#d46a8c", "#8a7fd6", "#4fb8b3", "#d9875b", "#9bb85a"];
  if (o.style !== "drawers") {
    // ---------------- stacked bins
    const z0 = min[2], z1 = max[2], cut = (m) => z0 + ((z1 - z0) * m) / n;
    const lid = o.lid && n > 1;
    for (let tier = 0; tier < n; tier++) {
      progress(`Making bin ${tier + 1} of ${n}…`); await tick();
      const a = tier ? cut(tier) : z0 - 2, b = tier < n - 1 ? cut(tier + 1) : z1 + 2, top = tier === n - 1, isLid = top && lid;
      const floorZ = tier ? a + L + c + fl : z0 + fl;
      // an open top: above the highest inside point of each column, the skin comes away
      let colTop = null, colIn = null;
      if (top && !lid) {
        const m2 = new Uint8Array(nx * ny); colTop = new Float32Array(nx * ny).fill(-BIG);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let k = nz - 1; k >= 0; k--) { const z = Z(k); if (z < a) break; if (S[idx(i, j, k)] < -t) { colTop[i + nx * j] = z; m2[i + nx * j] = 1; break; } }
        colIn = signed2(m2, nx, ny, h);
      }
      const F = new Float32Array(N);
      for (let k = 0; k < nz; k++) {
        const z = Z(k);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const q = idx(i, j, k), s = S[q];
          let f = Math.max(s, a - z, z - b);
          let cav = isLid ? Math.max(s + t, a - 1 - z) : Math.max(s + t, floorZ - z, z - (b + 1));
          if (colTop) { const c2 = i + nx * j; cav = Math.min(cav, Math.max(colIn[c2], colTop[c2] - h - z, floorZ - z)); }
          f = Math.max(f, -cav);
          // above a lower bin: only the outer half of the wall, round the lip below
          if (tier) f = Math.max(f, -Math.max(s + t / 2, a - 1 - z, z - (a + L + c)));
          // the lip: the inner half of the wall, standing up into the bin above
          if (!top) f = Math.min(f, Math.max(-(s + t), s + t / 2 + c, b - z, z - (b + L)));
          F[q] = f;
        }
      }
      const ms = meshParts(G, F, 7000);
      ms.forEach((m, q) => parts.push({ name: isLid ? "Lid" : `Bin ${tier + 1}${ms.length > 1 ? String.fromCharCode(97 + q) : ""}`, color: colors[tier % colors.length], ...m }));
    }
    return { parts, info: `${n} ${lid ? "pieces: " + (n - 1) + " bin" + (n > 2 ? "s" : "") + " and a lid" : "bins"}, each locking onto the one below with a ${L} mm lip.` };
  }
  // ---------------- drawers in a case
  const sh = t, cuts = []; for (let m = 1; m < n; m++) cuts.push(zi0 + ((zi1 - zi0) * m) / n);
  const shelfF = (z) => { let d = BIG; for (const cz of cuts) d = Math.min(d, Math.abs(z - cz) - sh / 2); return d; };
  // columns front to back (x, z): where the first run of inside cells is, and its middle
  progress("Finding the drawers…"); await tick();
  const W2 = nx, H2 = nz, Om = new Uint8Array(W2 * H2), ymid = new Float32Array(W2 * H2).fill(BIG);
  for (let k = 0; k < nz; k++) {
    const z = Z(k); if (shelfF(z) < c) continue;
    for (let i = 0; i < nx; i++) {
      let jf = -1, jl = -1;
      for (let j = 0; j < ny; j++) { const inside = S[idx(i, j, k)] < -t; if (inside && jf < 0) jf = j; if (jf >= 0) { if (inside) jl = j; else break; } }
      if (jf >= 0 && jl - jf >= 2) { Om[i + W2 * k] = 1; ymid[i + W2 * k] = (Y(jf) + Y(jl)) / 2; }
    }
  }
  // each level's opening, and the same carried up into the shelf above (so the drawer is open on top)
  const Oup = Om.slice();
  const upN = Math.ceil((c + t) / h) + 2;
  for (let i = 0; i < nx; i++) { let run = 0; for (let k = 1; k < nz; k++) { if (Om[i + W2 * k]) { run = 0; continue; } if (Oup[i + W2 * (k - 1)] && run < upN) { Oup[i + W2 * k] = 1; run++; } else run = upN; } }
  const cO = signed2(Om, W2, H2, h), cIn = signed2(Oup, W2, H2, h);
  for (let i = 0; i < nx; i++) for (let k = 1; k < nz; k++) if (!Om[i + W2 * k] && Om[i + W2 * (k - 1)]) ymid[i + W2 * k] = ymid[i + W2 * (k - 1)];
  for (let i = 0; i < nx; i++) for (let k = nz - 2; k >= 0; k--) if (!Om[i + W2 * k] && ymid[i + W2 * k] >= BIG && Om[i + W2 * (k + 1)]) ymid[i + W2 * k] = ymid[i + W2 * (k + 1)];
  // a finger hole in each drawer's front, a little above its middle
  const levels = []; for (let m = 0; m < n; m++) levels.push({ sx: 0, sz: 0, cnt: 0, z0: m ? cuts[m - 1] : zi0, z1: m < n - 1 ? cuts[m] : zi1 });
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (Om[i + W2 * k]) { const z = Z(k), m = levels.findIndex((L2) => z >= L2.z0 - h && z <= L2.z1 + h); if (m >= 0) { levels[m].sx += X(i); levels[m].sz += z; levels[m].cnt++; } }
  const holes = levels.filter((L2) => L2.cnt).map((L2) => { const hz = L2.z1 - L2.z0; return { x: L2.sx / L2.cnt, z: L2.sz / L2.cnt + hz * 0.12, r: Math.max(4, Math.min(13, hz * 0.17)) }; });
  const tf = Math.max(t, 2);
  progress("Making the drawers…"); await tick();
  const F = new Float32Array(N), C = new Float32Array(N);
  for (let k = 0; k < nz; k++) {
    const z = Z(k), shf = shelfF(z);
    for (let j = 0; j < ny; j++) {
      const y = Y(j);
      for (let i = 0; i < nx; i++) {
        const q = idx(i, j, k), s = S[q], c2 = i + W2 * k, front = y < ymid[c2];
        // the drawer: inside the shape, within its opening less the clearance, short of the back by the clearance
        let f = Math.max(s, cO[c2] + c, front ? -BIG : s + t + c);
        const cav = Math.max(cIn[c2] + c + t, front ? s + tf : s + t + c + t);
        f = Math.max(f, -cav);
        if (o.finger && front) for (const hl of holes) { const d = Math.hypot(X(i) - hl.x, z - hl.z) - hl.r; if (d < h * 3) f = Math.max(f, -Math.max(d, -(s + tf + 1))); }
        F[q] = f;
        // the case: the shell and shelves, with an opening for each drawer
        let cs = Math.max(s, -Math.max(s + t, -shf));
        cs = Math.max(cs, -Math.max(s - h, cO[c2], front ? -BIG : s + t));
        C[q] = cs;
      }
    }
  }
  const drawers = meshParts(G, F, 6000, 60).sort((p, q) => lowZ(p) - lowZ(q) || midX(p) - midX(q));
  progress("Making the case…"); await tick();
  const cases = meshParts(G, C, 9000, 60);
  cases.forEach((m, q) => parts.push({ name: cases.length > 1 ? "Case " + (q + 1) : "Case", color: "#9aa3ad", ...m }));
  drawers.forEach((m, q) => parts.push({ name: "Drawer " + (q + 1), color: colors[q % colors.length], ...m }));
  if (!drawers.length) throw new Error("No drawer fits: the inside of this shape doesn't reach the front (-Y). Turn the shape so a broad side faces the front, or use fewer drawers.");
  return { parts, info: `A case with ${drawers.length} drawer${drawers.length > 1 ? "s" : ""} that pull out of the front (-Y)${o.finger ? ", each with a finger hole" : ""}.` };
}
