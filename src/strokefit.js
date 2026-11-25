// Turning a hand-drawn stroke (finger, pen or mouse) into clean geometry. Used by the sketch's
// Freehand tool and by the Freehand Router. All 2D: points are [x, y].
//
// smoothStroke  - evens out the wobble of a hand (keeps the ends where they were)
// simplify      - Ramer-Douglas-Peucker: the fewest points that stay within eps of the stroke
// recognize     - SMART: a stroke that is nearly a straight line, a circle, a rectangle or a few
//                 straight sides comes back as exactly that; anything else as a smooth curve

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function strokeLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i], pts[i - 1]);
  return L;
}

// evenly spaced points along the stroke (a hand slows down at corners and bunches its samples)
export function resample(pts, step) {
  if (pts.length < 2 || !(step > 0)) return pts.slice();
  const out = [pts[0].slice()];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = dist(a, b);
    if (seg < 1e-12) continue;
    let d = step - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      d += step;
    }
    carry = seg - (d - step);
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.25) out.push(last.slice());
  else out[out.length - 1] = last.slice();
  return out;
}

// a light moving average, a few passes; closed strokes wrap round, open ones keep their ends
export function smoothStroke(pts, passes = 2, closed = false) {
  let p = pts.map((q) => q.slice());
  const n = p.length;
  if (n < 3) return p;
  for (let k = 0; k < passes; k++) {
    const q = p.map((v) => v.slice());
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
      q[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
    }
    p = q;
  }
  return p;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-18) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}

export function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bd = eps;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k], pts[i], pts[j]);
      if (d > bd) { bd = d; best = k; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// least-squares circle (Kasa)
export function fitCircle(pts) {
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p[0]; sy += p[1]; }
  const mx = sx / pts.length, my = sy / pts.length;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx, v = p[1] - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const b1 = (suuu + suvv) / 2, b2 = (svvv + svuu) / 2;
  const uc = (b1 * svv - b2 * suv) / det, vc = (b2 * suu - b1 * suv) / det;
  const c = [mx + uc, my + vc];
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
  let err = 0;
  for (const p of pts) err = Math.max(err, Math.abs(dist(p, c) - r));
  return { c, r, err };
}

const turn = (a, b, c) => {
  const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
  return Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
};

// How far round the stroke goes about a point (radians): a real circle goes all the way round.
function sweepAbout(pts, c) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    let d = Math.atan2(pts[i][1] - c[1], pts[i][0] - c[0]) - Math.atan2(pts[i - 1][1] - c[1], pts[i - 1][0] - c[0]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    s += d;
  }
  return Math.abs(s);
}

// Snap a direction to horizontal / vertical when it is within a few degrees of one.
function squareUp(poly, deg = 8) {
  const out = poly.map((p) => p.slice());
  const n = out.length;
  const tol = (deg * Math.PI) / 180;
  for (let i = 0; i < n - 1; i++) {
    const a = out[i], b = out[i + 1];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const m = ((ang % Math.PI) + Math.PI) % Math.PI;
    if (Math.min(m, Math.PI - m) < tol) { const y = (a[1] + b[1]) / 2; a[1] = y; b[1] = y; }
    else if (Math.abs(m - Math.PI / 2) < tol) { const x = (a[0] + b[0]) / 2; a[0] = x; b[0] = x; }
  }
  return out;
}

// opts: { smart: true, smooth: 0..1 (how much to even out), tol: size of a "near" in the
// stroke's units (the closing gap and corner snapping use it) }
export function recognize(raw, opts = {}) {
  const smart = opts.smart !== false;
  const smooth = Math.max(0, Math.min(1, opts.smooth ?? 0.5));
  if (raw.length < 2) return null;
  const L = strokeLength(raw);
  if (L < 1e-9) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of raw) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const size = Math.max(maxX - minX, maxY - minY, 1e-9);
  const near = opts.tol ?? size * 0.08;
  const gap = dist(raw[0], raw[raw.length - 1]);
  const closed = raw.length > 4 && gap < Math.max(near, L * 0.06) && L > 3 * gap && size > near * 1.5;
  let pts = resample(raw, L / Math.max(24, Math.min(400, raw.length * 2)));
  if (closed) pts[pts.length - 1] = pts[0].slice();
  pts = smoothStroke(pts, 1 + Math.round(smooth * 4), closed);
  if (closed) { pts.pop(); }

  if (smart) {
    // a straight line
    if (!closed) {
      let dev = 0;
      for (const p of pts) dev = Math.max(dev, segDist(p, raw[0], raw[raw.length - 1]));
      if (dev < Math.max(L * 0.035, 1e-9)) {
        let [a, b] = [raw[0].slice(), raw[raw.length - 1].slice()];
        [a, b] = squareUp([a, b], 6);
        return { kind: "line", a, b };
      }
    }
    // a circle
    if (closed || sweepAbout(pts, fitCircle(pts)?.c || [0, 0]) > 1.85 * Math.PI) {
      const c = fitCircle(pts);
      if (c && c.err < c.r * 0.14 && sweepAbout(pts, c.c) > 1.75 * Math.PI) return { kind: "circle", c: c.c, r: c.r };
    }
    // a few straight sides (a triangle, a rectangle, a zig-zag)
    const corners = simplify(closed ? [...pts, pts[0]] : pts, size * 0.06);
    const sides = corners.length - 1;
    if (sides >= 2 && sides <= 8) {
      let dev = 0;
      const poly = corners;
      for (const p of pts) {
        let d = Infinity;
        for (let i = 1; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i - 1], poly[i]));
        dev = Math.max(dev, d);
      }
      let sharp = true;
      for (let i = 1; i < poly.length - 1; i++) if (turn(poly[i - 1], poly[i], poly[i + 1]) < 0.45) sharp = false;
      let minSide = Infinity;
      for (let i = 1; i < poly.length; i++) minSide = Math.min(minSide, dist(poly[i - 1], poly[i]));
      // each side must really be straight: a gentle wave is a curve, not a zig-zag
      if (dev < Math.max(minSide * 0.06, size * 0.02) && dev < size * 0.07 && sharp) {
        let out = poly.map((p) => p.slice());
        if (closed) out[out.length - 1] = out[0];
        // a rectangle drawn roughly square to the page becomes exact
        if (closed && sides === 4) {
          const axis = [0, 1, 2, 3].every((i) => { const a = out[i], b = out[i + 1]; const ang = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0])) % (Math.PI / 2); return Math.min(ang, Math.PI / 2 - ang) < 0.21; });
          if (axis) {
            const xs = out.map((p) => p[0]), ys = out.map((p) => p[1]);
            return { kind: "rect", a: [Math.min(...xs), Math.min(...ys)], b: [Math.max(...xs), Math.max(...ys)] };
          }
        }
        out = squareUp(out, 6);
        if (closed) out[out.length - 1] = out[0];
        return { kind: "poly", pts: out, closed };
      }
    }
  }
  // a smooth curve: as few fit points as keep it within a small part of its size
  const eps = size * (0.004 + smooth * 0.02);
  let fit = simplify(closed ? [...pts, pts[0]] : pts, eps);
  if (closed) fit.pop();
  // splines need at least a few points to stay smooth through long sweeps
  if (fit.length < (closed ? 4 : 2)) fit = resample(closed ? [...pts, pts[0]] : pts, L / (closed ? 6 : 3)).slice(0, closed ? -1 : undefined);
  if (fit.length > 60) fit = resample(fit, strokeLength(fit) / 60);
  if (!closed) { fit[0] = raw[0].slice(); fit[fit.length - 1] = raw[raw.length - 1].slice(); }
  return { kind: "spline", pts: fit, closed };
}
