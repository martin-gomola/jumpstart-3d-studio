// Helmets from any number of photos (v2.9.9.9.10): front, back, both sides, the corners in
// between, from above, from below at an angle, as many as you have. Each photo is a cut-out
// (mask) seen from a direction (azimuth round the helmet, elevation above it). Together they carve
// a block of voxels down to the helmet (a visual hull): what's left is everything that looks
// right from every photo. Then:
//  - Auto-align: every photo is lined up with what the others agree on (its exact angle, its
//    centre and its size), so photos that weren't taken at exactly 45° or 90°, or were framed
//    differently, still fit together; and a side photo that was marked as the wrong side is
//    turned round.
//  - Symmetric: a helmet is the same on the left and right, so each photo also counts mirrored
//    (one side photo covers both sides).
//  - Forgiving: a point is only carved away when it's clearly outside a photo, so small
//    mistakes in a cut-out or the framing don't bite holes in the helmet.
// The result is the radius map the Helmet Maker already uses (see helmetRadii in photo3d.js):
// helmet 1 tall (z 0..1), x across (the wearer's left), y towards the back, a radius for every
// direction from the head's centre. Plain arrays only: it runs offline and in Safari.
//
// Angles: azimuth 0 = looking at the face, 90 = from the wearer's left side (the face is on the
// left of that photo), 180 = from behind, 270 (or -90) = from the right side. Elevation 0 = level,
// 90 = from straight above (the face at the bottom of the photo when azimuth is 0).

const D2R = Math.PI / 180;

export function maskBox(m, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
// how far (pixels) each pixel is outside the mask: 0 inside (two-pass chamfer, close to Euclidean)
export function outsideDist(m, W, H) {
  const BIG = 1e9, d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = m[i] ? 0 : BIG;
  const a = 1, b = Math.SQRT2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let v = d[i]; if (!v) continue;
    if (x > 0) v = Math.min(v, d[i - 1] + a);
    if (y > 0) { v = Math.min(v, d[i - W] + a); if (x > 0) v = Math.min(v, d[i - W - 1] + b); if (x < W - 1) v = Math.min(v, d[i - W + 1] + b); }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let v = d[i]; if (!v) continue;
    if (x < W - 1) v = Math.min(v, d[i + 1] + a);
    if (y < H - 1) { v = Math.min(v, d[i + W] + a); if (x < W - 1) v = Math.min(v, d[i + W + 1] + b); if (x > 0) v = Math.min(v, d[i + W - 1] + b); }
    d[i] = v;
  }
  return d;
}
// the camera's right and up directions (body frame: x left, y back, z up)
export function camBasis(az, el) {
  const a = az * D2R, e = Math.max(-89.9, Math.min(89.9, el)) * D2R;
  const d = [Math.cos(e) * Math.sin(a), -Math.cos(e) * Math.cos(a), Math.sin(e)]; // towards the camera
  const f = [-d[0], -d[1], -d[2]];
  let r = [f[1], -f[0], 0]; // f × z
  const rl = Math.hypot(r[0], r[1]) || 1; r = [r[0] / rl, r[1] / rl, 0];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]; // r × f
  return { r, u, d };
}
const normAz = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

// photos: [{ mask: Uint8Array, W, H, az, el }]; o: { autoAlign, symmetric, tol (fraction of the
// height), boxy, smooth, headZ, headY, res, mapW, mapH }
export function helmetHull(photos, o = {}) {
  const V = photos.filter((p) => p && p.mask).map((p) => ({ ...p, box: maskBox(p.mask, p.W, p.H) })).filter((p) => p.box);
  if (!V.length) throw new Error("Add at least one photo of the helmet (the front or a side works best).");
  const level = (v) => Math.abs(v.el) < 30;
  if (!V.some(level)) throw new Error("Add at least one photo taken level with the helmet (front, side or back), not only from above.");
  const sym = o.symmetric !== false, tolF = o.tol ?? 0.015;
  for (const v of V) { v.az = normAz(v.az || 0); v.el = Math.max(-80, Math.min(90, v.el || 0)); v.dist = outsideDist(v.mask, v.W, v.H); v.flipTried = false; }
  // first guesses: a level photo is 1 tall, its bottom at z = 0, centred; the width and depth
  // follow from the level photos nearest the front and the side
  for (const v of V) if (level(v)) { const b = v.box; v.s = (b.y1 - b.y0) / Math.max(0.5, Math.cos(v.el * D2R) + 0.35 * Math.abs(Math.sin(v.el * D2R))); v.cx = (b.x0 + b.x1) / 2; v.cy = b.y1 - (v.el > 0 ? 0 : 0); }
  const near = (t) => V.filter(level).sort((p, q) => Math.abs(Math.sin((p.az - t) * D2R)) - Math.abs(Math.sin((q.az - t) * D2R)))[0];
  const vF = near(0), vS = near(90);
  let wx = Math.abs(Math.cos(vF.az * D2R)) > 0.7 ? (vF.box.x1 - vF.box.x0) / vF.s : null, wy = Math.abs(Math.sin(vS.az * D2R)) > 0.7 ? (vS.box.x1 - vS.box.x0) / vS.s : null;
  if (!wx && wy) wx = wy / 1.15; if (!wy && wx) wy = wx * 1.15; if (!wx) wx = wy = 1;
  for (const v of V) if (!level(v)) {
    // from above: the photo's box is about the helmet's width (or depth) across
    const b = v.box, ac = Math.abs(Math.cos(v.az * D2R)), as = Math.abs(Math.sin(v.az * D2R)), across = ac * wx + as * wy;
    // the box's middle is where the helmet's middle (0, 0, 0.5) lands
    const Bv = camBasis(v.az, v.el);
    v.s = (b.x1 - b.x0) / across; v.cx = (b.x0 + b.x1) / 2 - v.s * 0.5 * Bv.r[2]; v.cy = (b.y0 + b.y1) / 2 + v.s * 0.5 * Bv.u[2];
  }
  // the block to carve
  const X = Math.max(wx, wy) * 0.85, Y = X, Z0 = -0.03, Z1 = 1.03;
  const make = (n) => {
    const h = (Z1 - Z0) / n, nx = Math.ceil((2 * X) / h), ny = Math.ceil((2 * Y) / h), nz = n;
    return { h, nx, ny, nz, x0: -X + h / 2, y0: -Y + h / 2, z0: Z0 + h / 2 };
  };
  // project body point -> photo pixel
  const proj = (v, B, x, y, z) => [v.cx + v.s * (x * B.r[0] + y * B.r[1] + z * B.r[2]), v.cy - v.s * (x * B.u[0] + y * B.u[1] + z * B.u[2])];
  // where a photo's own centre is: for a level photo, its bottom is z = 0, so the vertical
  // place is fixed by the helmet's height; a photo from above is centred on the helmet
  const outside = (v, B, x, y, z, tol) => {
    const [px, py] = proj(v, B, x, y, z);
    const ix = Math.round(px), iy = Math.round(py);
    if (ix < 0 || iy < 0 || ix >= v.W || iy >= v.H) return true;
    return v.dist[iy * v.W + ix] > tol;
  };
  const carve = (G, views, keep = null) => {
    const n = G.nx * G.ny * G.nz, occ = keep ? keep.slice() : new Uint8Array(n).fill(1);
    const Bs = views.map((v) => camBasis(v.az, v.el)), tols = views.map((v) => Math.max(1, tolF * v.s));
    let i = 0;
    for (let k = 0; k < G.nz; k++) {
      const z = G.z0 + k * G.h;
      for (let j = 0; j < G.ny; j++) {
        const y = G.y0 + j * G.h;
        for (let q = 0; q < G.nx; q++, i++) {
          if (!occ[i]) continue;
          const x = G.x0 + q * G.h;
          for (let m = 0; m < views.length; m++) {
            const v = views[m], B = Bs[m];
            if (outside(v, B, x, y, z, tols[m]) || (sym && outside(v, B, -x, y, z, tols[m]))) { occ[i] = 0; break; }
          }
        }
      }
    }
    return occ;
  };
  // the hull's silhouette in a photo (for lining it up): occupied cells splatted onto the pixels
  const surfaceOf = (G, occ) => {
    const pts = [], at = (q, j, k) => q >= 0 && j >= 0 && k >= 0 && q < G.nx && j < G.ny && k < G.nz && occ[(k * G.ny + j) * G.nx + q];
    for (let k = 0; k < G.nz; k++) for (let j = 0; j < G.ny; j++) for (let q = 0; q < G.nx; q++) {
      if (!at(q, j, k)) continue;
      if (at(q - 1, j, k) && at(q + 1, j, k) && at(q, j - 1, k) && at(q, j + 1, k) && at(q, j, k - 1) && at(q, j, k + 1)) continue;
      pts.push(G.x0 + q * G.h, G.y0 + j * G.h, G.z0 + k * G.h);
    }
    return pts;
  };
  const silhouette = (v, pts, h, az, el) => {
    const B = camBasis(az, el), W = v.W, H = v.H, img = new Uint8Array(W * H), rr = Math.max(1, Math.round(v.s * h * 0.6));
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const P = [];
    for (let i = 0; i < pts.length; i += 3) for (const sx of sym ? [1, -1] : [1]) {
      const x = pts[i] * sx, y = pts[i + 1], z = pts[i + 2];
      P.push(x * B.r[0] + y * B.r[1] + z * B.r[2], x * B.u[0] + y * B.u[1] + z * B.u[2]);
    }
    return { P, rr, img, W, H, x0, y0, x1, y1 };
  };
  // lay the projected points at scale s, centre (cx, cy) and score against the photo (IoU)
  const score = (v, S, s, cx, cy) => {
    const { P, rr, W, H } = S, img = S.img; img.fill(0);
    for (let i = 0; i < P.length; i += 2) {
      const px = Math.round(cx + s * P[i]), py = Math.round(cy - s * P[i + 1]);
      for (let dy = -rr; dy <= rr; dy++) { const yy = py + dy; if (yy < 0 || yy >= H) continue; for (let dx = -rr; dx <= rr; dx++) { const xx = px + dx; if (xx >= 0 && xx < W) img[yy * W + xx] = 1; } }
    }
    let I = 0, U = 0;
    for (let i = 0; i < img.length; i++) { const a = img[i], b = v.mask[i]; if (a && b) I++; if (a || b) U++; }
    return U ? I / U : 0;
  };
  // for an angle: the scale and centre that line the hull's projection up with the photo's box
  const fit = (v, S, level0) => {
    let lx = Infinity, hx = -Infinity, ly = Infinity, hy = -Infinity;
    for (let i = 0; i < S.P.length; i += 2) { const a = S.P[i], b = S.P[i + 1]; if (a < lx) lx = a; if (a > hx) hx = a; if (b < ly) ly = b; if (b > hy) hy = b; }
    if (!isFinite(lx)) return null;
    const b = v.box, pad = S.rr;
    // a level photo's height is the helmet's height (keep its scale); others take the size that fits
    const s = level0 ? v.s : Math.max(1e-6, (b.x1 - b.x0 - 2 * pad) / Math.max(1e-6, hx - lx) * 0.5 + (b.y1 - b.y0 - 2 * pad) / Math.max(1e-6, hy - ly) * 0.5);
    const cx = (b.x0 + b.x1) / 2 - s * (lx + hx) / 2, cy = level0 ? v.cy : (b.y0 + b.y1) / 2 + s * (ly + hy) / 2;
    return { s, cx, cy, iou: score(v, S, s, cx, cy) };
  };
  // how much of each photo's helmet the hull covers (1 when they all agree)
  // (as the share of each photo's helmet pixels the hull leaves out, summed)
  const missing = (G, views) => {
    const occ = carve(G, views), pts = surfaceOf(G, occ);
    let c = 0;
    for (const v of views) { const S = silhouette(v, pts, G.h, v.az, v.el); score(v, S, v.s, v.cx, v.cy); let I = 0, M = 0; for (let i = 0; i < S.img.length; i++) if (v.mask[i]) { M++; if (S.img[i]) I++; } c += M ? (M - I) / M : 0; }
    return c;
  };
  if (o.autoAlign !== false && V.length > 1) {
    const G = make(44);
    // 1. a side photo marked as the wrong side: the face would be at the back. Keep whichever
    //    way round makes all the photos agree better
    const G2 = make(64);
    for (const v of V) {
      if (!level(v) || Math.abs(Math.cos(v.az * D2R)) > 0.6 || v.fixedAz) continue;
      const a0 = missing(G2, V), az0 = v.az;
      v.az = normAz(az0 + 180);
      const a1 = missing(G2, V);
      if (o.debug) console.log("flip test", az0, a0.toFixed(4), a1.toFixed(4));
      // only when it's clearly better (a front / back that's the same either way stays as marked)
      if (a1 < a0 * 0.6 && a0 - a1 > 0.004) v.flipped = true; else v.az = az0;
    }
    // 2. photos from above or at a slant: their size and centre from what the level photos agree on
    for (let pass = 0; pass < 2; pass++) for (const v of V) {
      if (level(v)) continue;
      const others = V.filter((w) => w !== v && level(w)), pts = surfaceOf(G, carve(G, others));
      if (pts.length < 30) continue;
      const f = fit(v, silhouette(v, pts, G.h, v.az, v.el), false);
      if (f) { v.s = f.s; v.cx = f.cx; v.cy = f.cy; }
    }
  }
  // the final carve, finer
  const G = make(o.res || 88);
  let occ = carve(G, V);
  // with few directions the hull is boxy between the photos (a level ring of photos sees the
  // corners): round each slice inside its own box, as the Helmet Maker did with 4 photos
  const bins = new Set();
  for (const v of V) if (level(v)) for (const a of sym ? [v.az, -v.az] : [v.az]) bins.add(Math.round((((a % 180) + 180) % 180) / 30) % 6);
  const pw = o.boxy ?? 2.4;
  const hasDepth = V.some((v) => !level(v) || Math.abs(Math.sin(v.az * D2R)) > 0.5), hasWidth = V.some((v) => !level(v) || Math.abs(Math.cos(v.az * D2R)) > 0.5);
  if (bins.size >= 3 && !o.roundAlways && o.support !== false) {
    // a ring of photos: in each slice, every level photo says how far the helmet reaches across
    // (its left and right edge on that row: the slice's "support" in two directions). Between
    // the photos' directions the reach is filled in smoothly, and the slice is everything within
    // reach in every direction: round where the helmet is round, flat or pointed where the
    // photos say so (the bare carving would leave corners between the photos)
    const LV = V.filter((v) => Math.abs(v.el) < 12), NPH = 180;
    const NX = new Float64Array(NPH), NY = new Float64Array(NPH);
    for (let a = 0; a < NPH; a++) { NX[a] = Math.cos((2 * Math.PI * a) / NPH); NY[a] = Math.sin((2 * Math.PI * a) / NPH); }
    for (let k = 0; k < G.nz; k++) {
      const z = G.z0 + k * G.h, smp = [];
      for (const v of LV) {
        const B = camBasis(v.az, v.el), py = Math.round(v.cy - v.s * z * B.u[2]);
        if (py < 0 || py >= v.H) continue;
        let a = -1, b = -1;
        for (let x = 0; x < v.W; x++) if (v.mask[py * v.W + x]) { if (a < 0) a = x; b = x; }
        if (a < 0) continue;
        const uR = (b + 0.5 - v.cx) / v.s, uL = (a - 0.5 - v.cx) / v.s, ph = Math.atan2(B.r[1], B.r[0]);
        smp.push([ph, uR], [ph + Math.PI, -uL]);
        if (sym) smp.push([Math.atan2(B.r[1], -B.r[0]), uR], [Math.atan2(-B.r[1], B.r[0]), -uL]);
      }
      if (smp.length < 6) continue;
      // merge directions within 3°, then a smooth periodic curve through them
      const pts = smp.map(([a, h]) => [((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), h]).sort((p2, q2) => p2[0] - q2[0]);
      const M = [];
      for (const q2 of pts) { const l = M[M.length - 1]; if (l && q2[0] - l[0] < 0.05) { l[1] = (l[1] * l[2] + q2[1]) / (l[2] + 1); l[2]++; } else M.push([q2[0], q2[1], 1]); }
      if (M.length > 1 && M[0][0] + 2 * Math.PI - M[M.length - 1][0] < 0.05) { const l = M.pop(); M[0][1] = (M[0][1] * M[0][2] + l[1] * l[2]) / (M[0][2] + l[2]); }
      const n = M.length; if (n < 3) continue;
      const P = (i) => { const j = ((i % n) + n) % n, wrap = Math.floor(i / n); return [M[j][0] + wrap * 2 * Math.PI, M[j][1]]; };
      const slope = (i) => { const a = P(i - 1), b = P(i), c = P(i + 1); return ((c[1] - b[1]) / (c[0] - b[0]) + (b[1] - a[1]) / (b[0] - a[0])) / 2; };
      const H = new Float64Array(NPH);
      for (let a = 0; a < NPH; a++) {
        const ph = (2 * Math.PI * a) / NPH;
        let i = 0; while (i < n && M[i][0] <= ph) i++;
        const p0 = P(i - 1), p1 = P(i), t0 = ph < p0[0] ? ph + 2 * Math.PI : ph, d = p1[0] - p0[0], t = (t0 - p0[0]) / d;
        const m0 = slope(i - 1) * d, m1 = slope(i) * d, t2 = t * t, t3 = t2 * t;
        H[a] = (2 * t3 - 3 * t2 + 1) * p0[1] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1[1] + (t3 - t2) * m1;
        // never inside what the photos themselves show
        let lo = -Infinity; for (const q2 of M) { const c = Math.cos(ph - q2[0]); if (c > 0.9999) lo = Math.max(lo, q2[1]); }
        H[a] = Math.max(H[a], lo);
      }
      const tl = Math.max(G.h * 0.5, tolF);
      for (let j = 0; j < G.ny; j++) for (let q = 0; q < G.nx; q++) {
        const i = (k * G.ny + j) * G.nx + q; if (!occ[i]) continue;
        const x = G.x0 + q * G.h, y = G.y0 + j * G.h;
        for (let a = 0; a < NPH; a++) if (x * NX[a] + y * NY[a] > H[a] + tl) { occ[i] = 0; break; }
      }
    }
  } else if (bins.size < 3 || o.roundAlways) {
    for (let k = 0; k < G.nz; k++) {
      let lx = Infinity, hx = -Infinity, ly = Infinity, hy = -Infinity;
      for (let j = 0; j < G.ny; j++) for (let q = 0; q < G.nx; q++) if (occ[(k * G.ny + j) * G.nx + q]) { const x = G.x0 + q * G.h, y = G.y0 + j * G.h; lx = Math.min(lx, x); hx = Math.max(hx, x); ly = Math.min(ly, y); hy = Math.max(hy, y); }
      if (!isFinite(lx)) continue;
      let cx = (lx + hx) / 2, cy = (ly + hy) / 2, rx = (hx - lx) / 2 + G.h / 2, ry = (hy - ly) / 2 + G.h / 2;
      // a direction no photo saw: as deep (or wide) as the usual helmet's proportions
      if (!hasDepth) { ry = rx * (wy / wx); cy = 0; } else if (!hasWidth) { rx = ry * (wx / wy); cx = 0; }
      for (let j = 0; j < G.ny; j++) for (let q = 0; q < G.nx; q++) {
        const i = (k * G.ny + j) * G.nx + q; if (!occ[i]) continue;
        const ex = Math.abs(G.x0 + q * G.h - cx) / rx, ey = Math.abs(G.y0 + j * G.h - cy) / ry;
        if (ex ** pw + ey ** pw > 1) occ[i] = 0;
      }
    }
  }
  // keep the biggest piece (stray bits from a messy cut-out)
  occ = biggestPiece(occ, G);
  // its size and centre
  let lx = Infinity, hx = -Infinity, ly = Infinity, hy = -Infinity, lz = Infinity, hz = -Infinity, cnt = 0;
  for (let k = 0, i = 0; k < G.nz; k++) for (let j = 0; j < G.ny; j++) for (let q = 0; q < G.nx; q++, i++) if (occ[i]) {
    cnt++; const x = G.x0 + q * G.h, y = G.y0 + j * G.h, z = G.z0 + k * G.h;
    lx = Math.min(lx, x); hx = Math.max(hx, x); ly = Math.min(ly, y); hy = Math.max(hy, y); lz = Math.min(lz, z); hz = Math.max(hz, z);
  }
  if (!cnt) throw new Error("The photos don't agree on a shape. Check each photo's angle (or switch on Auto-align) and its cut-out.");
  const ox = sym ? 0 : (lx + hx) / 2, oy = (ly + hy) / 2, ht = hz - lz + G.h;
  // a soft occupancy for smooth radii (a light blur of 0 / 1)
  const F = new Float32Array(occ.length);
  for (let i = 0; i < occ.length; i++) F[i] = occ[i];
  blur3(F, G);
  const sample = (x, y, z) => {
    const fx = (x - G.x0) / G.h, fy = (y - G.y0) / G.h, fz = (z - G.z0) / G.h;
    const q = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    if (q < 0 || j < 0 || k < 0 || q >= G.nx - 1 || j >= G.ny - 1 || k >= G.nz - 1) return 0;
    const u = fx - q, v = fy - j, w = fz - k, at = (a, b, c) => F[((k + c) * G.ny + (j + b)) * G.nx + (q + a)];
    return ((at(0, 0, 0) * (1 - u) + at(1, 0, 0) * u) * (1 - v) + (at(0, 1, 0) * (1 - u) + at(1, 1, 0) * u) * v) * (1 - w) + ((at(0, 0, 1) * (1 - u) + at(1, 0, 1) * u) * (1 - v) + (at(0, 1, 1) * (1 - u) + at(1, 1, 1) * u) * v) * w;
  };
  // rays from the head's centre (in the helmet's own units: 1 tall, bottom at 0)
  const wxN = (hx - lx + G.h) / ht, wyN = (hy - ly + G.h) / ht;
  const C = [ox, oy + (o.headY ?? 0) * (hy - ly), lz - G.h / 2 + (o.headZ ?? 0.55) * ht];
  const w = o.mapW || 144, h = o.mapH || 73, R = new Float32Array(w * h), step = G.h * 0.35;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = (2 * Math.PI * i) / w - Math.PI, t = (Math.PI * j) / (h - 1);
    const dx = Math.sin(t) * Math.sin(a), dy = -Math.sin(t) * Math.cos(a), dz = Math.cos(t);
    let last = 0, prev = sample(C[0], C[1], C[2]);
    for (let s = step; s < 2.2 * Math.max(1, X); s += step) {
      const cur = sample(C[0] + dx * s, C[1] + dy * s, C[2] + dz * s);
      if (prev >= 0.5 && cur < 0.5) last = s - step + (step * (prev - 0.5)) / Math.max(1e-6, prev - cur);
      else if (cur < 0.5 && last && s - last > 0.06) break;
      prev = cur;
    }
    R[j * w + i] = last ? Math.max(0.01, (last - tolF * 0.8) / ht) : 0;
  }
  // rays that missed (the centre outside a thin part): from their neighbours; then smooth
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (!R[j * w + i]) { let s = 0, c = 0; for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const jj = Math.max(0, Math.min(h - 1, j + dj)), v = R[jj * w + ((i + di + w) % w)]; if (v) { s += v; c++; } } R[j * w + i] = c ? s / c : 0; }
  let sm = R;
  for (let p = 0; p < (o.smooth ?? 2); p++) {
    const nx2 = sm.slice();
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let s = sm[j * w + i] * 4, c = 4; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const jj = j + dj; if (jj < 0 || jj >= h) continue; s += sm[jj * w + ((i + di + w) % w)]; c++; } nx2[j * w + i] = s / c; }
    sm = nx2;
  }
  // how well each photo agrees with the finished helmet
  const pts = surfaceOf(G, occ);
  const views = V.map((v) => { const S = silhouette(v, pts, G.h, v.az, v.el); return { az: Math.round(v.az * 10) / 10, el: Math.round(v.el * 10) / 10, iou: +score(v, S, v.s, v.cx, v.cy).toFixed(3), flipped: !!v.flipped }; });
  return { w, h, r: Array.from(sm, (v) => +v.toFixed(4)), wx: +wxN.toFixed(4), wy: +wyN.toFixed(4), headZ: o.headZ ?? 0.55, centre: C.map((v) => +v.toFixed(4)), height: +ht.toFixed(4), views, agree: +(views.reduce((a, q) => a + q.iou, 0) / views.length).toFixed(3) };
}

function biggestPiece(occ, G) {
  const n = occ.length, lab = new Int32Array(n), sizes = [0];
  let id = 0;
  const st = [];
  for (let s = 0; s < n; s++) {
    if (!occ[s] || lab[s]) continue;
    id++; let c = 0; lab[s] = id; st.push(s);
    while (st.length) {
      const i = st.pop(); c++;
      const q = i % G.nx, j = Math.floor(i / G.nx) % G.ny, k = Math.floor(i / (G.nx * G.ny));
      const nb = [q > 0 ? i - 1 : -1, q < G.nx - 1 ? i + 1 : -1, j > 0 ? i - G.nx : -1, j < G.ny - 1 ? i + G.nx : -1, k > 0 ? i - G.nx * G.ny : -1, k < G.nz - 1 ? i + G.nx * G.ny : -1];
      for (const m of nb) if (m >= 0 && occ[m] && !lab[m]) { lab[m] = id; st.push(m); }
    }
    sizes.push(c);
  }
  let best = 1; for (let i = 2; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = lab[i] === best ? 1 : 0;
  return out;
}
function blur3(F, G) {
  const T = new Float32Array(F.length), sx = 1, sy = G.nx, sz = G.nx * G.ny;
  for (const [st, n, len] of [[sx, G.nx, 0], [sy, G.ny, 1], [sz, G.nz, 2]]) {
    T.set(F);
    for (let i = 0; i < F.length; i++) {
      const c = len === 0 ? i % G.nx : len === 1 ? Math.floor(i / G.nx) % G.ny : Math.floor(i / sz);
      const a = c > 0 ? T[i - st] : T[i], b = c < n - 1 ? T[i + st] : T[i];
      F[i] = (a + 2 * T[i] + b) / 4;
    }
  }
}
