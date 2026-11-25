// Views to 3D (v2.9.9.9.13): up to six pictures of an object (front, back, left, right, top,
// bottom: photos, scans or hand sketches, with or without dimensions) become a real CAD model.
// Each picture's outline is traced into an editable sketch on the matching plane, scaled to the
// sizes typed in (or worked out from the pictures), with the picture behind it for reference.
// The 3D object is every sketch pushed straight through the model and kept where they all
// overlap (the views' "visual hull"). The body stays linked to the sketches: change a sketch
// and the object follows. Choose "Make sketches to edit" to fix the outlines first, then build.
//
// Picture space: pixels, x right, y down. Model: mm, Z up, the front faces -Y, standing on z = 0.
import { store, findSketch, nextSeq, IDENTITY, regionsFor } from "./store.js";
import { el, uid, fmt, nextColor } from "./util.js";
import { addImportedCurves } from "./sketcher.js";
import { luminance, otsu, contours, ringArea, simplifyRing, smoothRing, pixelToSketch } from "./trace.js";
import { cutOut, fillHoles } from "./photo3d.js";
import { largestPiece } from "./puffy.js";

// where each view's sketch sits: its plane (x = the picture's right, n toward the viewer), and
// which two model sizes the picture shows (across, up)
export const VIEWS = {
  front: { label: "Front", plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, -1, 0] }, dims: ["W", "H"], thru: "D", tip: "Looking at the front" },
  back: { label: "Back", plane: { o: [0, 0, 0], x: [-1, 0, 0], n: [0, 1, 0] }, dims: ["W", "H"], thru: "D", tip: "Looking at the back" },
  left: { label: "Left", plane: { o: [0, 0, 0], x: [0, -1, 0], n: [-1, 0, 0] }, dims: ["D", "H"], thru: "W", tip: "From the left side (the front on the right)" },
  right: { label: "Right", plane: { o: [0, 0, 0], x: [0, 1, 0], n: [1, 0, 0] }, dims: ["D", "H"], thru: "W", tip: "From the right side (the front on the left)" },
  top: { label: "Top", plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, dims: ["W", "D"], thru: "H", tip: "From above, the front at the bottom" },
  bottom: { label: "Bottom", plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, -1] }, dims: ["W", "D"], thru: "H", tip: "From below, the front at the top" },
};
const ORDER = ["front", "right", "top", "back", "left", "bottom"];

// ------------------------------------------------------------------ outlines
function dilate(m, W, H, r) {
  let a = m;
  for (let k = 0; k < r; k++) {
    const b = new Uint8Array(a.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      b[i] = a[i] || (x > 0 && a[i - 1]) || (x < W - 1 && a[i + 1]) || (y > 0 && a[i - W]) || (y < H - 1 && a[i + W]) ? 1 : 0;
    }
    a = b;
  }
  return a;
}
const erode = (m, W, H, r) => { const inv = m.map((v) => (v ? 0 : 1)); return dilate(inv, W, H, r).map((v) => (v ? 0 : 1)); };

// A drawing: dark lines on light paper. The lines are thickened a little to close small gaps,
// everything they enclose is filled, the biggest piece kept (dimension lines and notes standing
// apart drop away), then thinned back.
function drawingMask(img, sens) {
  const W = img.width, H = img.height;
  const L = luminance(img);
  const t = otsu(L) * (0.55 + sens / 100 * 0.6);
  let ink = new Uint8Array(W * H);
  for (let i = 0; i < ink.length; i++) ink[i] = L[i] < t ? 1 : 0;
  const gap = Math.max(1, Math.round(Math.max(W, H) / 220));
  let m = dilate(ink, W, H, gap);
  m = fillHoles(m, W, H);
  m = largestPiece(m, W, H);
  m = erode(m, W, H, gap);
  return { mask: m, ink };
}
export function viewMask(img, kind = "auto", sens = 50) {
  const W = img.width, H = img.height, n = W * H;
  if (kind === "drawing") return drawingMask(img, sens).mask;
  if (kind === "photo") return largestPiece(cutOut(img, { mode: "auto", sens }), W, H);
  // automatic: thin dark lines on a light page are a drawing; anything else a photo
  const d = drawingMask(img, sens);
  let inkN = 0, fillN = 0;
  for (let i = 0; i < n; i++) { inkN += d.ink[i]; fillN += d.mask[i]; }
  if (inkN < n * 0.22 && fillN > inkN * 2.2 && fillN > n * 0.02) return d.mask;
  const p = largestPiece(cutOut(img, { mode: "auto", sens }), W, H);
  let pN = 0; for (let i = 0; i < n; i++) pN += p[i];
  return pN > n * 0.01 ? p : d.mask;
}
// the outline rings of a mask: the outer one, plus holes through it when asked
export function viewRings(mask, W, H, holes = false) {
  let rings = contours(mask, W, H).filter((r) => r.length >= 3);
  if (!rings.length) return null;
  rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const tol = Math.max(0.6, Math.max(W, H) / 500);
  // long sides within a few degrees of level or upright are made exactly so (drawings and
  // photos of boxy parts come out square)
  const square = (r) => {
    const n = r.length, P = r.map((p) => p.slice());
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const big = Math.max(x1 - x0, y1 - y0) * 0.04, lim = Math.tan((3 * Math.PI) / 180);
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1];
      if (Math.hypot(dx, dy) < big) continue;
      if (Math.abs(dy) <= Math.abs(dx) * lim) { const y = (a[1] + b[1]) / 2; a[1] = y; b[1] = y; }
      else if (Math.abs(dx) <= Math.abs(dy) * lim) { const x = (a[0] + b[0]) / 2; a[0] = x; b[0] = x; }
    }
    return P;
  };
  const tidy = (r) => square(simplifyRing(smoothRing(r, 1), tol));
  const outer = tidy(rings[0]);
  const A = Math.abs(ringArea(rings[0]));
  const inner = holes ? rings.slice(1).filter((r) => Math.abs(ringArea(r)) > A * 0.004 && Math.sign(ringArea(r)) !== Math.sign(ringArea(rings[0]))).slice(0, 30).map(tidy) : [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of outer) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  return { outer, inner, box: [x0, y0, x1, y1] };
}

// ------------------------------------------------------------------ sizes
// Typed sizes win. The rest come from the pictures' proportions (front: H/W, side: H/D,
// top: D/W), and anything still unknown from sensible defaults.
export function solveDims(views, typed) {
  const d = { W: typed.W > 0 ? typed.W : null, D: typed.D > 0 ? typed.D : null, H: typed.H > 0 ? typed.H : null };
  const ratios = []; // [a, b, b/a]
  for (const [k, v] of Object.entries(views)) {
    if (!v || !v.rings) continue;
    const [x0, y0, x1, y1] = v.rings.box;
    const w = x1 - x0, h = y1 - y0;
    if (w > 1 && h > 1) ratios.push([VIEWS[k].dims[0], VIEWS[k].dims[1], h / w]);
  }
  if (!d.W && !d.D && !d.H) {
    // nothing typed: 60 mm across the first view's widest side
    const r = ratios[0];
    if (r) { if (r[2] <= 1) d[r[0]] = 60; else d[r[1]] = 60; } else d.W = 60;
  }
  for (let pass = 0; pass < 3; pass++) for (const [a, b, k] of ratios) {
    if (d[a] && !d[b]) d[b] = d[a] * k;
    else if (d[b] && !d[a]) d[a] = d[b] / k;
  }
  const known = [d.W, d.D, d.H].filter(Boolean);
  const fill = known.length ? Math.min(...known) * 0.5 : 20;
  for (const k of ["W", "D", "H"]) if (!d[k]) d[k] = fill;
  for (const k of ["W", "D", "H"]) d[k] = Math.round(d[k] * 100) / 100;
  return d;
}

// The sketch picture placement that maps the view's outline box onto its model sizes, and the
// traced curves in sketch coordinates.
export function viewSketchData(key, v, dims) {
  const V = VIEWS[key];
  const A = dims[V.dims[0]], B = dims[V.dims[1]];
  const [x0, y0, x1, y1] = v.rings.box;
  const sx = A / Math.max(1e-6, x1 - x0), sy = B / Math.max(1e-6, y1 - y0);
  const Wp = v.img.width, Hp = v.img.height;
  const w = Wp * sx, h = Hp * sy;
  // across: centred on 0; up: side views stand on z = 0, top and bottom are centred
  const vmin = V.dims[1] === "H" ? 0 : -B / 2;
  const cx = 0 - ((x0 + x1) / 2 - Wp / 2) * sx;
  const yc = vmin + B / 2;
  const cy = yc - (0.5 - (y0 + y1) / 2 / Hp) * h;
  const im = { w, h, cx, cy, rot: 0 };
  const T = pixelToSketch(im, Wp, Hp);
  const curves = [];
  const size = Math.max(x1 - x0, y1 - y0);
  for (const ring of [v.rings.outer, ...v.rings.inner]) for (const c of outlineCurves(ring, size)) {
    if (c.t === "line") curves.push({ t: "line", a: T(c.a), b: T(c.b) });
    else if (c.t === "circle") {
      // a round hole: a true circle (stretched pictures make it the average of the two scales)
      curves.push({ t: "circle", c: T(c.c), r: c.r * (sx + sy) / 2 });
    } else curves.push({ t: "spline", pts: c.pts.map(T), closed: c.closed });
  }
  return { im, curves, plane: { ...V.plane, o: V.dims[1] === "W" || V.dims[1] === "D" ? [0, 0, dims.H / 2] : V.plane.o } };
}
// A traced loop as clean sketch curves: corners found at the scale of the drawing (not pixel by
// pixel), straight lines between corners where the outline is straight, smooth splines where it
// curves, and a true circle for a round loop.
export function outlineCurves(ring, size) {
  const n = ring.length;
  if (n < 3) return [];
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const flat = Math.max(0.8, size * 0.006);
  // a round loop
  {
    let cx = 0, cy = 0; for (const p of ring) { cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
    const rs = ring.map((p) => d(p, [cx, cy])), r = rs.reduce((a, b) => a + b, 0) / n;
    // the points and the middles of the sides between them all sit on the circle
    const mids = ring.map((p, i) => { const q = ring[(i + 1) % n]; return d([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], [cx, cy]); });
    const tol = Math.max(1, r * 0.06);
    if (n >= 8 && Math.max(...rs.map((x) => Math.abs(x - r)), ...mids.map((x) => Math.abs(x - r))) < tol) return [{ t: "circle", c: [cx, cy], r }];
  }
  // turning at each point, measured over a window along the loop
  const per = ring.reduce((L, p, i) => L + d(p, ring[(i + 1) % n]), 0);
  const win = Math.max(2, per * 0.012);
  const reach = (i, dir) => { let L = 0, j = i; for (let k = 0; k < n; k++) { const q = (j + dir + n) % n; L += d(ring[j], ring[q]); j = q; if (L >= win) break; } return ring[j]; };
  const turn = ring.map((p, i) => {
    const a = reach(i, -1), b = reach(i, 1);
    const u = [p[0] - a[0], p[1] - a[1]], v = [b[0] - p[0], b[1] - p[1]];
    return Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
  });
  const corner = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < (32 * Math.PI) / 180) continue;
    // the sharpest point of its neighbourhood
    let best = true;
    for (let k = 1; k <= 3 && best; k++) for (const j of [(i + k) % n, (i - k + n) % n]) if (d(ring[j], ring[i]) < win && turn[j] > turn[i]) best = false;
    if (best && (!corner.length || d(ring[corner[corner.length - 1]], ring[i]) > win * 0.5)) corner.push(i);
  }
  if (!corner.length) return [{ t: "spline", pts: ring.slice(), closed: true }];
  const out = [];
  for (let c = 0; c < corner.length; c++) {
    const i = corner[c], j = corner[(c + 1) % corner.length];
    const run = [];
    for (let k = i; ; k = (k + 1) % n) { run.push(ring[k]); if (k === j && run.length > 1) break; if (run.length > n + 1) break; }
    const a = run[0], b = run[run.length - 1];
    const ab = d(a, b) || 1e-9;
    let dev = 0;
    for (const p of run) dev = Math.max(dev, Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / ab);
    if (dev < flat || run.length === 2) out.push({ t: "line", a, b });
    else out.push({ t: "spline", pts: run, closed: false });
  }
  return out;
}

// The solid made from view sketches: each sketch's outlines (not the holes in them) pushed right
// through, all kept where they overlap. Holes traced inside an outline go right through too.
export function hullNode(doc, sketchIds, dims) {
  const kids = [];
  for (const id of sketchIds) {
    const sk = findSketch(doc, id);
    if (!sk) continue;
    const V = VIEWS[sk.views3d];
    const regs = regionsFor(sk).filter((r) => r.area > 1e-6);
    if (!regs.length) continue;
    // material regions: inside an odd number of loops (an outline, not a hole in it)
    const depth = (r) => regs.filter((o) => o !== r && o.area > r.area && o.poly && pointIn(r.pt, o.poly)).length;
    const keep = regs.filter((r) => depth(r) % 2 === 0);
    const thru = (V ? dims[V.thru] : 100) + 2;
    kids.push({ node: { t: "extrude", sketch: id, profiles: keep.map((r) => ({ key: r.key, pt: r.pt })), mode: "sym", dist: +thru.toFixed(3), mods: [] }, m: IDENTITY.slice() });
  }
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0].node;
  return { t: "group", op: "intersect", children: kids, mods: [] };
}
function pointIn(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------------ the dialog
export function initViews3D(app) {
  const st = { views: {}, typed: { W: null, D: null, H: null }, holes: false };
  let back = null;

  async function readFile(file) {
    const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    const pic = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn't a picture this browser can read.")); i.src = url; });
    return { pic, name: file.name || "picture" };
  }
  // the picture (turned rot quarter turns) at two sizes: a small one to trace, a modest JPEG to
  // keep behind the sketch
  function prepare(v) {
    const p = v.pic, q = ((v.rot || 0) % 4 + 4) % 4;
    const draw = (max, type) => {
      const k = Math.min(1, max / Math.max(p.naturalWidth, p.naturalHeight));
      const w0 = Math.max(8, Math.round(p.naturalWidth * k)), h0 = Math.max(8, Math.round(p.naturalHeight * k));
      const cv = document.createElement("canvas");
      cv.width = q % 2 ? h0 : w0; cv.height = q % 2 ? w0 : h0;
      const g = cv.getContext("2d", { willReadFrequently: true });
      g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
      g.translate(cv.width / 2, cv.height / 2); g.rotate((q * Math.PI) / 2);
      g.drawImage(p, -w0 / 2, -h0 / 2, w0, h0);
      return type ? cv.toDataURL(type, 0.82) : g.getImageData(0, 0, cv.width, cv.height);
    };
    v.img = draw(560);
    v.src = draw(1000, "image/jpeg");
    retrace(v);
  }
  function retrace(v) {
    if (!v.img) return;
    v.mask = viewMask(v.img, v.kind || "auto", v.sens ?? 50);
    v.rings = viewRings(v.mask, v.img.width, v.img.height, st.holes);
  }
  const loaded = () => ORDER.filter((k) => st.views[k] && st.views[k].rings);
  const viewSketches = (doc) => (doc.sketches || []).filter((s) => s.views3d && VIEWS[s.views3d]);

  // make the sketches (and, when build, the object) in the design
  function make(build) {
    const keys = loaded();
    if (!keys.length) { app.toast("Add at least one picture with a clear outline first."); return; }
    const dims = solveDims(st.views, st.typed);
    let bodyId = null;
    store.update((doc) => {
      const ids = [];
      for (const k of keys) {
        const v = st.views[k];
        const data = viewSketchData(k, v, dims);
        const sk = { id: uid("s"), name: "View: " + VIEWS[k].label, seq: nextSeq(doc), plane: data.plane, pts: [], ents: [], cons: [], hidden: false, views3d: k,
          image: { src: v.src, name: v.name, w: +data.im.w.toFixed(4), h: +data.im.h.toFixed(4), cx: +data.im.cx.toFixed(4), cy: +data.im.cy.toFixed(4), rot: 0, opacity: 0.35 } };
        addImportedCurves(sk, data.curves, Math.max(1e-5, Math.max(data.im.w, data.im.h) * 1e-5));
        doc.sketches.push(sk);
        ids.push(sk.id);
      }
      if (build) bodyId = addBody(doc, ids, dims);
    }, build ? "Views to 3D" : "Views to 3D sketches");
    close();
    if (build && bodyId) { app.select && app.select([bodyId]); app.needFit = true; app.toast("Made from " + keys.length + " view" + (keys.length === 1 ? "" : "s") + `: ${fmt(dims.W, 1)} × ${fmt(dims.D, 1)} × ${fmt(dims.H, 1)} mm. Change a view sketch and the object follows.`); }
    else if (!build) { app.needFit = true; app.toast("View sketches made. Edit any of them (double-click it in the Browser), then open Views to 3D again and choose Build from my view sketches."); }
    app.fit && setTimeout(() => app.fit(), 400);
  }
  function addBody(doc, ids, dims) {
    const node = hullNode(doc, ids, dims);
    if (!node) return null;
    const id = uid("b");
    doc.bodies.push({ id, name: "From views", seq: nextSeq(doc), color: nextColor(), hole: false, hidden: false, m: IDENTITY.slice(), node });
    for (const sid of ids) { const sk = findSketch(doc, sid); if (sk) sk.hidden = true; }
    return id;
  }
  function buildFromSketches() {
    const sks = viewSketches(store.doc);
    if (!sks.length) return;
    // the sizes the sketches were drawn at: each one's own extent across and up
    const dims = { W: 0, D: 0, H: 0 };
    for (const sk of sks) {
      const V = VIEWS[sk.views3d];
      const xs = sk.pts.map((p) => p.x), ys = sk.pts.map((p) => p.y);
      if (!xs.length) continue;
      dims[V.dims[0]] = Math.max(dims[V.dims[0]], Math.max(...xs) - Math.min(...xs));
      dims[V.dims[1]] = Math.max(dims[V.dims[1]], Math.max(...ys) - Math.min(...ys));
    }
    for (const k of ["W", "D", "H"]) if (!dims[k]) dims[k] = Math.max(dims.W, dims.D, dims.H) || 50;
    let id = null;
    store.update((doc) => { id = addBody(doc, viewSketches(doc).map((s) => s.id), dims); }, "Views to 3D");
    close();
    if (id) { app.select && app.select([id]); app.toast("Built from your view sketches. Change a sketch and the object follows."); setTimeout(() => app.fit && app.fit(), 400); }
    else app.toast("The view sketches have no closed outlines to build from.");
  }

  function close() { if (back) { back.remove(); back = null; } }
  function open() {
    close();
    back = el("div", { class: "modal-back", id: "v3d-back" });
    const modal = el("div", { class: "modal v3d", role: "dialog", "aria-label": "Views to 3D" });
    back.append(modal);
    document.body.append(back);
    render();
  }
  function render() {
    if (!back) return;
    const modal = back.querySelector(".modal");
    modal.innerHTML = "";
    const dims = solveDims(st.views, st.typed);
    const grid = el("div", { class: "v3d-grid" });
    for (const k of ORDER) grid.append(slot(k));
    const size = el("div", { class: "v3d-size" });
    for (const [k, lab] of [["W", "Width (X)"], ["D", "Depth (Y)"], ["H", "Height (Z)"]]) {
      const inp = el("input", { type: "text", inputmode: "decimal", id: "v3d-" + k, placeholder: fmt(dims[k], 1), value: st.typed[k] ? String(st.typed[k]) : "", "aria-label": lab + " in mm",
        onchange: (e) => { const v = parseFloat(String(e.target.value).replace(",", ".")); st.typed[k] = v > 0 ? v : null; render(); } });
      size.append(el("label", {}, el("span", {}, lab), inp, el("i", {}, "mm")));
    }
    const holes = el("label", { class: "check" }, el("input", { type: "checkbox", id: "v3d-holes", checked: st.holes, onchange: (e) => { st.holes = e.target.checked; for (const k of ORDER) if (st.views[k]) retrace(st.views[k]); render(); } }), "Keep holes inside the outlines (they go right through)");
    const n = loaded().length;
    const existing = viewSketches(store.doc).length;
    const btns = el("div", { class: "v3d-btns" },
      el("button", { class: "btn", onclick: close }, "Cancel"),
      ...(existing ? [el("button", { class: "btn", id: "v3d-fromsk", title: "Build the object from the view sketches already in your design (after editing them)", onclick: buildFromSketches }, `Build from my ${existing} view sketch${existing === 1 ? "" : "es"}`)] : []),
      el("button", { class: "btn", id: "v3d-sketches", disabled: !n, title: "Trace each picture into a sketch you can edit with the sketch tools first", onclick: () => make(false) }, "Make sketches to edit"),
      el("button", { class: "btn primary", id: "v3d-build", disabled: !n, onclick: () => make(true) }, "Make the 3D object"));
    modal.append(
      el("header", {}, el("h2", {}, "Views to 3D"), el("button", { class: "x", "aria-label": "Close", onclick: close }, "×")),
      el("div", { class: "mbody" },
        el("p", { class: "v3d-intro" }, "Add up to six pictures of the object: photos, scans or your own drawings, with or without dimensions. Each outline is traced into a sketch; the 3D object is what all the views agree on. Front alone gives a flat shape; add a side and the top for a full one."),
        grid,
        el("div", { class: "subhead" }, "Size"),
        el("p", { class: "v3d-note" }, "Type the sizes you know (from the dimensions on your drawing). Empty boxes are worked out from the pictures' proportions."),
        size, holes,
        el("p", { class: "v3d-note", id: "v3d-sum" }, n ? `${n} view${n === 1 ? "" : "s"} ready · ${fmt(dims.W, 1)} × ${fmt(dims.D, 1)} × ${fmt(dims.H, 1)} mm` : "No pictures yet."),
        btns));
  }
  function slot(k) {
    const v = st.views[k];
    const V = VIEWS[k];
    const cv = el("canvas", { width: 180, height: 140, class: "v3d-cv" });
    const file = el("input", { type: "file", accept: "image/*", hidden: true, id: "v3d-file-" + k, onchange: async (e) => { const f = e.target.files && e.target.files[0]; if (f) await load(k, f); e.target.value = ""; } });
    const box = el("div", { class: "v3d-slot" + (v ? " on" : ""), id: "v3d-slot-" + k },
      el("div", { class: "v3d-h" }, el("b", {}, V.label), el("span", {}, V.tip)), cv, file);
    // drop a picture on the slot
    box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("drop"); });
    box.addEventListener("dragleave", () => box.classList.remove("drop"));
    box.addEventListener("drop", async (e) => { e.preventDefault(); box.classList.remove("drop"); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) await load(k, f); });
    if (!v) {
      cv.onclick = () => file.click();
      box.append(el("button", { class: "btn", onclick: () => file.click() }, "Add picture"));
    } else {
      const kind = el("select", { "aria-label": V.label + " picture kind", onchange: (e) => { v.kind = e.target.value; retrace(v); render(); } },
        ...[["auto", "Auto"], ["drawing", "Drawing (lines)"], ["photo", "Photo (object)"]].map(([val, lab]) => el("option", { value: val, selected: (v.kind || "auto") === val }, lab)));
      const sens = el("input", { type: "range", min: 0, max: 100, value: v.sens ?? 50, "aria-label": "Sensitivity", title: "Sensitivity: higher picks up fainter lines or more of a photo", onchange: (e) => { v.sens = +e.target.value; retrace(v); render(); } });
      box.append(el("div", { class: "v3d-row" }, kind, sens),
        el("div", { class: "v3d-row" },
          el("button", { class: "btn", title: "Turn the picture a quarter turn", onclick: () => { v.rot = (v.rot || 0) + 1; prepare(v); render(); } }, "Turn"),
          el("button", { class: "btn", title: "Use a different picture", onclick: () => file.click() }, "Replace"),
          el("button", { class: "btn", title: "Remove this view", onclick: () => { delete st.views[k]; render(); } }, "Remove")),
        ...(v.rings ? [] : [el("div", { class: "v3d-warn" }, "No outline found: try Drawing or Photo, or the sensitivity.")]));
    }
    requestAnimationFrame(() => paint(cv, v));
    return box;
  }
  function paint(cv, v) {
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    if (!v || !v.img) { g.fillStyle = "#8a93a3"; g.font = "13px system-ui, sans-serif"; g.textAlign = "center"; g.fillText("Click or drop a picture", cv.width / 2, cv.height / 2); return; }
    const W = v.img.width, H = v.img.height, k = Math.min(cv.width / W, cv.height / H), ox = (cv.width - W * k) / 2, oy = (cv.height - H * k) / 2;
    const tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H; tmp.getContext("2d").putImageData(v.img, 0, 0);
    g.globalAlpha = 0.55; g.drawImage(tmp, ox, oy, W * k, H * k); g.globalAlpha = 1;
    if (!v.rings) return;
    g.lineWidth = 2; g.strokeStyle = "#d9480f"; g.fillStyle = "rgba(217,72,15,.14)";
    g.beginPath();
    for (const r of [v.rings.outer, ...v.rings.inner]) r.forEach((p, i) => (i ? g.lineTo(ox + p[0] * k, oy + p[1] * k) : g.moveTo(ox + p[0] * k, oy + p[1] * k)));
    g.closePath(); g.fill("evenodd"); g.stroke();
  }
  async function load(k, f) {
    try {
      const { pic, name } = await readFile(f);
      const v = { pic, name, kind: "auto", sens: 50, rot: 0 };
      prepare(v);
      st.views[k] = v;
      render();
    } catch (e) { app.toast(e.message || "Couldn't read that picture.", "err"); }
  }
  // for tests and scripts: a picture straight from an <img> or canvas
  async function loadImage(k, pic, name = "picture") {
    const v = { pic: pic.naturalWidth ? pic : await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = pic.toDataURL(); }), name, kind: "auto", sens: 50, rot: 0 };
    prepare(v); st.views[k] = v; render();
  }
  return { open, close, make, buildFromSketches, loadImage, state: st };
}
