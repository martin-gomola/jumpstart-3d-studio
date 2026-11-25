// Auto trace: turns a picture into sketch outlines.
// 1. brightness of each pixel (see-through parts count as white paper)
// 2. a light blur, then a threshold (picked automatically with Otsu's method) splits it into
//    "ink" and "paper"
// 3. the borders between ink and paper pixels are followed into closed loops
// 4. loops are simplified (fewer points), tiny specks dropped
//    (v2.9.9.9.10: each point sits where the brightness actually crosses the threshold, between
//    the two pixels, not on the pixel's edge: no staircase, and accurate to a fraction of a pixel;
//    or trace each colour of a logo as its own shapes)
// 5. each loop becomes straight lines where it is straight or has corners and smooth splines
//    where it curves
// Everything here works in picture pixels (y down); curvesFor maps to sketch coordinates.

// brightness 0..255 per pixel, over white
export function luminance(img) {
  const { data, width: W, height: H } = img, L = new Float32Array(W * H);
  for (let i = 0, j = 0; i < L.length; i++, j += 4) {
    const a = data[j + 3] / 255;
    L[i] = (0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]) * a + 255 * (1 - a);
  }
  return L;
}
function blur(L, W, H) {
  const T = new Float32Array(L.length), O = new Float32Array(L.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, a = x > 0 ? L[i - 1] : L[i], b = x < W - 1 ? L[i + 1] : L[i];
    T[i] = (a + 2 * L[i] + b) / 4;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, a = y > 0 ? T[i - W] : T[i], b = y < H - 1 ? T[i + W] : T[i];
    O[i] = (a + 2 * T[i] + b) / 4;
  }
  return O;
}
// the brightness that best splits the picture in two (Otsu)
export function otsu(L) {
  const hist = new Float64Array(256);
  for (let i = 0; i < L.length; i++) hist[Math.max(0, Math.min(255, L[i] | 0))]++;
  const n = L.length;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = 128, bv = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bv) { bv = v; best = t; }
  }
  return best + 0.5;
}

// closed loops along the borders of the "ink" pixels; each point is the middle of a pixel edge
// sub: { L, thr } = move each point to where the brightness L crosses thr between the two pixels
export function contours(mask, W, H, sub = null) {
  const ink = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
  // how far from the ink pixel's centre towards the paper pixel's the border really is (0.5 = the edge)
  const cross = (x, y, nx, ny) => {
    if (!sub) return 0.5;
    const qx = x + nx, qy = y + ny;
    if (qx < 0 || qy < 0 || qx >= W || qy >= H) return 0.5;
    const a = sub.L[y * W + x], b = sub.L[qy * W + qx];
    if (Math.abs(b - a) < 1e-6) return 0.5;
    return Math.max(0.05, Math.min(0.95, (sub.thr - a) / (b - a)));
  };
  const px = [], py = [];
  // directed pixel edges with ink on the left: from lattice point (x, y) to the next
  const VW = W + 1, out = new Map(); // start vertex -> list of edge ids
  const ex = [], ey = [], edx = [], edy = [];
  const add = (x, y, dx, dy, cx, cy, nx, ny) => {
    const id = ex.length; ex.push(x); ey.push(y); edx.push(dx); edy.push(dy);
    const t = cross(cx, cy, nx, ny); px.push(cx + 0.5 + nx * t); py.push(cy + 0.5 + ny * t);
    const k = y * VW + x; const l = out.get(k); if (l) l.push(id); else out.set(k, [id]);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    // y grows downward; walking with ink on the left goes counter-clockwise on screen
    if (!ink(x, y - 1)) add(x + 1, y, -1, 0, x, y, 0, -1); // top edge, right to left
    if (!ink(x - 1, y)) add(x, y, 0, 1, x, y, -1, 0); // left edge, downward
    if (!ink(x, y + 1)) add(x, y + 1, 1, 0, x, y, 0, 1); // bottom edge, left to right
    if (!ink(x + 1, y)) add(x + 1, y + 1, 0, -1, x, y, 1, 0); // right edge, upward
  }
  const used = new Uint8Array(ex.length), rings = [];
  for (let s = 0; s < ex.length; s++) {
    if (used[s]) continue;
    const ring = [];
    let e = s;
    while (!used[e]) {
      used[e] = 1;
      ring.push([px[e], py[e]]);
      const nx = ex[e] + edx[e], ny = ey[e] + edy[e];
      const cand = out.get(ny * VW + nx);
      if (!cand) break;
      let next = -1;
      if (cand.length === 1) next = cand[0];
      else {
        // two ways on (pixels touching at a corner): keep turning the same way so touching
        // shapes stay separate loops
        for (const c of cand) if (!used[c] && edx[c] === edy[e] && edy[c] === -edx[e]) { next = c; break; }
        if (next < 0) for (const c of cand) if (!used[c]) { next = c; break; }
      }
      if (next < 0) break;
      e = next;
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}
export function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
// Douglas-Peucker on an open polyline
function dp(P, tol) {
  const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = P[a], [bx, by] = P[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
    let bi = -1, bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = L > 1e-9 ? Math.abs((P[i][0] - ax) * dy - (P[i][1] - ay) * dx) / L : Math.hypot(P[i][0] - ax, P[i][1] - ay);
      if (d > bd) { bd = d; bi = i; }
    }
    if (bi > 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return P.filter((_, i) => keep[i]);
}
// simplify a closed loop: split it at its two farthest-apart points and simplify each half
export function simplifyRing(r, tol) {
  if (r.length < 5) return r.slice();
  let i0 = 0, far = 0;
  for (let i = 0; i < r.length; i++) { const d = (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2; if (d > far) { far = d; i0 = i; } }
  let i1 = 0; far = 0;
  for (let i = 0; i < r.length; i++) { const d = (r[i][0] - r[i0][0]) ** 2 + (r[i][1] - r[i0][1]) ** 2; if (d > far) { far = d; i1 = i; } }
  const a = Math.min(i0, i1), b = Math.max(i0, i1);
  const h1 = dp(r.slice(a, b + 1), tol), h2 = dp(r.slice(b).concat(r.slice(0, a + 1)), tol);
  return h1.slice(0, -1).concat(h2.slice(0, -1));
}

// smooth a closed loop without shrinking it (Taubin: a step in, a slightly bigger step out)
export function smoothRing(r, passes = 1) {
  let P = r;
  const n = r.length;
  if (n < 5) return r.slice();
  for (let k = 0; k < passes * 2; k++) {
    const f = k % 2 ? -0.53 : 0.5, Q = new Array(n);
    for (let i = 0; i < n; i++) { const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n]; Q[i] = [b[0] + f * ((a[0] + c[0]) / 2 - b[0]), b[1] + f * ((a[1] + c[1]) / 2 - b[1])]; }
    P = Q;
  }
  return P;
}
// the picture's main colours (k-means on a sample of pixels, see-through counts as white)
export function mainColours(img, k) {
  const { data, width: W, height: H } = img, n = W * H, step = Math.max(1, Math.floor(n / 24000)), S = [];
  for (let i = 0; i < n; i += step) { const a = data[i * 4 + 3] / 255; S.push([data[i * 4] * a + 255 * (1 - a), data[i * 4 + 1] * a + 255 * (1 - a), data[i * 4 + 2] * a + 255 * (1 - a)]); }
  // start from colours far apart, then settle
  const C = [S[0]];
  while (C.length < k) { let best = null, bd = -1; for (const p of S) { let d = Infinity; for (const c of C) d = Math.min(d, (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2); if (d > bd) { bd = d; best = p; } } if (bd < 1) break; C.push(best.slice()); }
  for (let it = 0; it < 10; it++) {
    const sum = C.map(() => [0, 0, 0, 0]);
    for (const p of S) { let bi = 0, bd = Infinity; C.forEach((c, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = i; } }); const q = sum[bi]; q[0] += p[0]; q[1] += p[1]; q[2] += p[2]; q[3]++; }
    sum.forEach((q, i) => { if (q[3]) C[i] = [q[0] / q[3], q[1] / q[3], q[2] / q[3]]; });
  }
  return C;
}
const hex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
// each colour's shapes (the background's left out): rings with their colour
function traceColours(img, opts) {
  const W = img.width, H = img.height, { data } = img, k = Math.max(2, Math.min(10, opts.colours || 4));
  const C = mainColours(img, k), lab = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = data[i * 4 + 3] / 255, r = data[i * 4] * a + 255 * (1 - a), g = data[i * 4 + 1] * a + 255 * (1 - a), b = data[i * 4 + 2] * a + 255 * (1 - a);
    let bi = 0, bd = Infinity; for (let j = 0; j < C.length; j++) { const d = (r - C[j][0]) ** 2 + (g - C[j][1]) ** 2 + (b - C[j][2]) ** 2; if (d < bd) { bd = d; bi = j; } }
    lab[i] = bi;
  }
  // tidy: each pixel takes the most common colour around it (the soft edges between two colours
  // would otherwise make thin slivers of a third)
  const L2 = lab.slice(), cnt = new Uint16Array(C.length);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    cnt.fill(0); let bi = lab[y * W + x], bc = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const l = lab[(y + dy) * W + x + dx], c = ++cnt[l]; if (c > bc) { bc = c; bi = l; } }
    if (bc >= 5) L2[y * W + x] = bi;
  }
  // the background: the colour most of the picture's border is
  const bcount = new Array(C.length).fill(0);
  for (let x = 0; x < W; x++) { bcount[L2[x]]++; bcount[L2[(H - 1) * W + x]]++; }
  for (let y = 0; y < H; y++) { bcount[L2[y * W]]++; bcount[L2[y * W + W - 1]]++; }
  const bg = bcount.indexOf(Math.max(...bcount));
  const minA = (opts.minArea ?? 0.002) * W * H, rings = [], colours = [];
  for (let j = 0; j < C.length; j++) {
    if (j === bg && !opts.keepBackground) continue;
    const m = new Uint8Array(W * H); for (let i = 0; i < m.length; i++) m[i] = L2[i] === j;
    for (let r of contours(m, W, H)) {
      if (Math.abs(ringArea(r)) < Math.max(minA, 2)) continue;
      r = simplifyRing(smoothRing(r, 2), opts.tol ?? 1);
      if (r.length >= 3 && Math.abs(ringArea(r)) >= Math.max(minA, 2)) { rings.push(r); colours.push(hex(C[j])); }
    }
  }
  const idx = rings.map((_, i) => i).sort((a, b) => Math.abs(ringArea(rings[b])) - Math.abs(ringArea(rings[a])));
  const max = opts.maxRings ?? 400;
  return { rings: idx.slice(0, max).map((i) => rings[i]), colours: idx.slice(0, max).map((i) => colours[i]), dropped: Math.max(0, rings.length - max), threshold: null, palette: C.map(hex), background: hex(C[bg]), W, H };
}
// the whole trace, in picture pixels: { rings, threshold, W, H }
// opts: thr (0..255 or null = automatic), part ("dark" | "light"), tol (px), minArea (fraction of the picture)
export function traceImage(img, opts = {}) {
  if (opts.part === "colours") return traceColours(img, opts);
  const W = img.width, H = img.height;
  const L = blur(luminance(img), W, H);
  const thr = opts.thr == null ? otsu(L) : opts.thr;
  const mask = new Uint8Array(W * H);
  const light = opts.part === "light";
  for (let i = 0; i < mask.length; i++) mask[i] = light ? L[i] > thr : L[i] < thr;
  const minA = (opts.minArea ?? 0.002) * W * H;
  const sub = opts.subpixel === false ? null : { L, thr };
  let rings = contours(mask, W, H, sub).filter((r) => Math.abs(ringArea(r)) >= Math.max(minA, 2));
  rings = rings.map((r) => simplifyRing(sub ? smoothRing(r, 1) : r, opts.tol ?? 1)).filter((r) => r.length >= 3 && Math.abs(ringArea(r)) >= Math.max(minA, 2));
  rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const max = opts.maxRings ?? 400, dropped = Math.max(0, rings.length - max);
  return { rings: rings.slice(0, max), dropped, threshold: thr, W, H };
}

// sketch curves for traced loops: lines along straight runs and at corners, smooth splines
// (through the points) where a loop curves
export function ringCurves(ring, smooth = true) {
  const n = ring.length, out = [];
  const line = (a, b) => out.push({ t: "line", a, b });
  if (!smooth || n < 4) { for (let i = 0; i < n; i++) line(ring[i], ring[(i + 1) % n]); return out; }
  const segLen = ring.map((p, i) => Math.hypot(ring[(i + 1) % n][0] - p[0], ring[(i + 1) % n][1] - p[1]));
  const sorted = segLen.slice().sort((a, b) => a - b), med = sorted[n >> 1];
  const longSeg = segLen.map((l) => l > med * 3.5 && l > 6);
  const corner = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n], q = ring[i], r = ring[(i + 1) % n];
    const a1 = Math.atan2(q[1] - p[1], q[0] - p[0]), a2 = Math.atan2(r[1] - q[1], r[0] - q[0]);
    let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > (40 * Math.PI) / 180 || longSeg[i] || longSeg[(i - 1 + n) % n]) corner[i] = true;
  }
  const first = corner.indexOf(true);
  if (first < 0) { out.push({ t: "spline", pts: ring.slice(), closed: true }); return out; }
  // walk from corner to corner: a straight piece or a long one is a line, a run of short ones a spline
  let i = first;
  do {
    let j = (i + 1) % n;
    const run = [ring[i]];
    while (true) {
      run.push(ring[j]);
      if (corner[j] || longSeg[j] || longSeg[(j - 1 + n) % n] || j === first) break;
      j = (j + 1) % n;
    }
    if (run.length === 2) line(run[0], run[1]);
    else out.push({ t: "spline", pts: run, closed: false });
    i = j;
  } while (i !== first);
  return out;
}

// map picture pixels onto the sketch picture (center cx, cy; size w x h; turned rot degrees)
export function pixelToSketch(im, W, H) {
  const r = ((im.rot || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return (p) => {
    const x = (p[0] / W - 0.5) * im.w, y = (0.5 - p[1] / H) * im.h;
    return [(im.cx || 0) + x * c - y * s, (im.cy || 0) + x * s + y * c];
  };
}
export function curvesFor(trace, im, smooth = true) {
  const T = pixelToSketch(im, trace.W, trace.H), out = [];
  for (const ring of trace.rings) for (const c of ringCurves(ring, smooth)) {
    if (c.t === "line") out.push({ t: "line", a: T(c.a), b: T(c.b) });
    else out.push({ t: "spline", pts: c.pts.map(T), closed: c.closed });
  }
  return out;
}
