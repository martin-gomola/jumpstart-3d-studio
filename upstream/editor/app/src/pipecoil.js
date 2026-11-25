// Pipe (a round, square or triangular section along sketch curves or body edges, solid
// or hollow) and Coil (a helix body: springs, threads-to-print, spirals), as in Fusion 360.
import * as THREE from "three";
import { store, findBody, findSketch, nextSeq, IDENTITY, pathChain } from "./store.js";
import { el, uid, nextColor } from "./util.js";
import { resolveSketch } from "./regions.js";
import { M4, arr, nextName } from "./ops.js";
import { planeMatrix } from "./scene.js";

const BODY_COLORS = ["#9fb1c4", "#c9a27a", "#8fb79a", "#b49ac8", "#c98f8f", "#8fb8c9"];
const SECTIONS = [["circle", "Round"], ["square", "Square"], ["triangle", "Triangle"]];

export function initPipeCoil(app, X) {
  const { vp, scene, openCmd, closeCmd, commit, schedulePreview, pickBaseFace, pickBaseEdge, edgeWorldPts, drawLine, drawDot, clearOv, row, seg, pickbox, pickSketchCurve, pathPts, deleteFeature, frameFrom } = X;
  const V3 = (a) => new THREE.Vector3(...a);
  const r6 = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(6)));

  // ------------------------------------------------------------ shared: operation
  function opRow(body, st, editing) {
    if (editing && !editing.mod) return;
    const ops = editing ? [["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]] : [["new", "New body"], ["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]];
    const sel = el("select", { class: "num", id: "pc-op" }, ...ops.map(([v, l]) => el("option", { value: v, selected: v === st.op }, l)));
    sel.onchange = () => { st.op = sel.value; st.refresh(); };
    body.append(row("Operation", sel, "pc-op"));
  }
  function bodiesTouching(box, skip) {
    return store.doc.bodies.filter((b) => !b.hole && !b.hidden && !b.locked && b.id !== skip).filter((b) => { const bb = scene.bodyTightBox(b.id); return bb && bb.intersectsBox(box); }).map((b) => b.id);
  }
  // put the new feature in the design: a new body, or join/cut/intersect into the bodies it reaches
  function place(doc, st, node, m, box) {
    const editing = st.editing;
    if (editing) {
      const b = findBody(doc, editing.body);
      if (editing.mod) { const md = b.node.mods.find((x) => x.id === editing.mod); md.tool = { ...node, mods: [] }; md.op = st.op === "new" ? md.op : st.op; md.m = arr(M4(b.m).invert().multiply(M4(m))); }
      else { b.node = { ...node, mods: b.node.mods || [] }; b.m = m.slice(); }
      return;
    }
    const parts = st.op === "new" ? [] : bodiesTouching(box);
    if (st.op === "new" || (st.op === "join" && !parts.length)) {
      doc.bodies.push({ id: st.newId || (st.newId = uid("b")), name: nextName(doc, node.t === "coil" ? "Coil" : "Pipe"), seq: nextSeq(doc), color: app.mode === "beginner" ? nextColor() : BODY_COLORS[doc.bodies.length % BODY_COLORS.length], hole: false, hidden: false, m: m.slice(), node: { ...node, mods: [] } });
      return;
    }
    if (!parts.length) throw new Error(st.op === "cut" ? "It doesn't reach any body to cut." : "It doesn't reach any body.");
    // while previewing a cut, show the volume being removed in see-through red
    if (app.previewing && st.op === "cut") doc.bodies.push({ id: "__cut_preview", name: "Cut preview", seq: 1e9, color: "#e5484d", hole: false, hidden: false, cutPreview: true, m: m.slice(), node: { ...node, mods: [] } });
    const seq = nextSeq(doc);
    for (const id of st.op === "join" ? [parts[0]] : parts) {
      const b = findBody(doc, id);
      b.node.mods = b.node.mods || [];
      b.node.mods.push({ id: uid("f"), seq, t: "bool", op: st.op, tool: { ...node, mods: [] }, m: arr(M4(b.m).invert().multiply(M4(m))) });
    }
  }
  function existing(editing) {
    if (!editing) return null;
    const b = findBody(store.doc, editing.body);
    if (!b) return null;
    if (!editing.mod) return { node: b.node, m: b.m, op: "new" };
    const md = b.node.mods.find((x) => x.id === editing.mod);
    return { node: md.tool, m: arr(M4(b.m).multiply(M4(md.m || IDENTITY))), op: md.op };
  }

  // ------------------------------------------------------------ shared: smarter paths
  // (like Fusion 360's chain selection: one click takes the edges that run on smoothly from it)
  const edgeHit = (base, ei) => ({ base, edge: ei, info: base.data.edgeInfo[ei], body: base.body.id });
  function edgeEnds(base, ei) {
    const P = edgeWorldPts(base, ei), n = P.length;
    if (n < 2) return null;
    return { a: P[0], b: P[n - 1], ta: P[1].clone().sub(P[0]).normalize(), tb: P[n - 1].clone().sub(P[n - 2]).normalize(), closed: P[0].distanceTo(P[n - 1]) < 1e-4 };
  }
  // the edges of the same body joined end to end with the clicked one where they meet at less
  // than maxDeg (0..180: 180 takes every connected edge)
  function tangentChain(base, ei, maxDeg = 25) {
    const N = base.data.edgeGroups.length, ends = [];
    for (let i = 0; i < N; i++) ends.push(edgeEnds(base, i));
    const out = [ei], used = new Set([ei]), tol = 1e-3, cosM = Math.cos((maxDeg * Math.PI) / 180);
    if (!ends[ei] || ends[ei].closed) return out;
    // walk from each end of the chain: the next edge sharing that point and running on smoothly
    const walk = (p, dir) => {
      for (let guard = 0; guard < N; guard++) {
        let best = -1, bestDot = -2, nextP = null, nextDir = null;
        for (let i = 0; i < N; i++) {
          if (used.has(i) || !ends[i] || ends[i].closed) continue;
          const E = ends[i];
          let d = null, np = null, nd = null;
          if (E.a.distanceTo(p) < tol) { d = dir.dot(E.ta); np = E.b; nd = E.tb; }
          else if (E.b.distanceTo(p) < tol) { d = dir.dot(E.tb.clone().negate()); np = E.a; nd = E.ta.clone().negate(); }
          if (d != null && d > bestDot) { bestDot = d; best = i; nextP = np; nextDir = nd; }
        }
        if (best < 0 || bestDot < cosM) return;
        used.add(best); out.push(best); p = nextP; dir = nextDir;
      }
    };
    walk(ends[ei].b, ends[ei].tb);
    walk(ends[ei].a, ends[ei].ta.clone().negate());
    return out;
  }
  // a face's outer boundary (its longest loop of edges), for a path all the way round it
  function faceLoopEdges(base, face) {
    const FE = base.data.faceEdges && base.data.faceEdges[face];
    if (!FE || !FE.length) return [];
    const list = [...FE], loops = [];
    while (list.length) {
      const loop = [list.shift()];
      let grew = true;
      while (grew) {
        grew = false;
        for (let j = 0; j < list.length; j++) {
          const E = edgeEnds(base, list[j]);
          if (!E) { list.splice(j, 1); j--; continue; }
          if (loop.some((k) => { const F = edgeEnds(base, k); return F && [F.a, F.b].some((q) => q.distanceTo(E.a) < 1e-3 || q.distanceTo(E.b) < 1e-3); })) { loop.push(list.splice(j, 1)[0]); j--; grew = true; }
        }
      }
      loops.push(loop);
    }
    const len = (loop) => loop.reduce((s, k) => { const P = edgeWorldPts(base, k); let L = 0; for (let i = 1; i < P.length; i++) L += P[i].distanceTo(P[i - 1]); return s + L; }, 0);
    loops.sort((a, b) => len(b) - len(a));
    return loops[0];
  }
  // "Around a body": the body's outline where a level plane through the point cuts it, pushed out
  // by off (negative goes inside), as one smooth closed path
  function aroundLoop(base, point, off = 0) {
    const d = base.data, V = d.vertices, T = d.triangles, m = base.m, z = point.z;
    const W = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < V.length; i += 3) { v.set(V[i], V[i + 1], V[i + 2]).applyMatrix4(m); W.push(v.x, v.y, v.z); }
    const segs = [];
    for (let t = 0; t < T.length; t += 3) {
      const p = [T[t], T[t + 1], T[t + 2]].map((k) => [W[k * 3], W[k * 3 + 1], W[k * 3 + 2]]), cut = [];
      for (let e = 0; e < 3; e++) {
        const a = p[e], b = p[(e + 1) % 3], da = a[2] - z, db = b[2] - z;
        if ((da < 0) !== (db < 0)) { const s = da / (da - db); cut.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]); }
      }
      if (cut.length === 2) segs.push(cut);
    }
    if (!segs.length) return null;
    // join the pieces into loops
    const key = (q) => Math.round(q[0] * 1e4) + "," + Math.round(q[1] * 1e4);
    const at = new Map();
    segs.forEach((s, i) => { for (const q of s) { const k = key(q); if (!at.has(k)) at.set(k, []); at.get(k).push(i); } });
    const used = new Uint8Array(segs.length), loops = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const L = [segs[i][0], segs[i][1]];
      for (;;) {
        const nx = (at.get(key(L[L.length - 1])) || []).find((j) => !used[j]);
        if (nx == null) break;
        used[nx] = 1;
        const s = segs[nx];
        L.push(key(s[0]) === key(L[L.length - 1]) ? s[1] : s[0]);
      }
      if (L.length > 3) loops.push(L);
    }
    const area = (P) => { let A = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; A += a[0] * b[1] - b[0] * a[1]; } return A / 2; };
    // the loop round the clicked point's side of the body: the biggest one that isn't a hole
    const near = (P) => Math.min(...P.map((q) => Math.hypot(q[0] - point.x, q[1] - point.y)));
    loops.sort((a, b) => near(a) - near(b) || Math.abs(area(b)) - Math.abs(area(a)));
    let P = loops[0];
    if (key(P[0]) === key(P[P.length - 1])) P = P.slice(0, -1);
    if (area(P) < 0) P = P.reverse();
    // even spacing, then push out along the outline's normal
    let per = 0; for (let i = 0; i < P.length; i++) per += Math.hypot(P[(i + 1) % P.length][0] - P[i][0], P[(i + 1) % P.length][1] - P[i][1]);
    const step = Math.max(0.4, per / 160), R = [];
    let acc = 0;
    R.push(P[0]);
    for (let i = 0; i < P.length; i++) {
      let a = P[i]; const b = P[(i + 1) % P.length];
      let L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (acc + L >= step) { const s = (step - acc) / L; a = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]; R.push(a); L = Math.hypot(b[0] - a[0], b[1] - a[1]); acc = 0; }
      acc += L;
    }
    if (R.length > 2 && Math.hypot(R[R.length - 1][0] - R[0][0], R[R.length - 1][1] - R[0][1]) < step * 0.5) R.pop();
    const n = R.length;
    const Q = R.map((q, i) => {
      const a = R[(i - 1 + n) % n], b = R[(i + 1) % n], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
      return [q[0] + (ty / l) * off, q[1] - (tx / l) * off, z];
    });
    // a few smoothing passes so the offset corners stay round
    for (let it = 0; it < 2; it++) for (let i = 0; i < n; i++) { const a = Q[(i - 1 + n) % n], b = Q[(i + 1) % n]; Q[i] = [Q[i][0] * 0.5 + (a[0] + b[0]) * 0.25, Q[i][1] * 0.5 + (a[1] + b[1]) * 0.25, z]; }
    const pts = Q.map((q) => q.map((x) => +x.toFixed(4)));
    pts.push(pts[0].slice());
    return { t: "bsp", a: pts[0], b: pts[pts.length - 1], pts };
  }
  const segsPts = (segs) => segs.map((s) => s.t === "bsp" ? s.pts.map((q) => V3(q)) : s.t === "line" ? [V3(s.a), V3(s.b)] : s.t === "arc" ? [V3(s.a), V3(s.m), V3(s.b)] : []);

  // ------------------------------------------------------------ Pipe
  // a body edge as a fixed world-space path segment
  function edgeSeg(h) {
    const base = h.base, info = h.info, m = base.m;
    const A = V3(info.a).applyMatrix4(m), B = V3(info.b).applyMatrix4(m), Mid = V3(info.m).applyMatrix4(m);
    if (info.t === "LINE") return [{ t: "line", a: r6(A), b: r6(B) }];
    const pts = edgeWorldPts(base, h.edge);
    if (info.t === "CIRCLE") {
      if (A.distanceTo(B) < 1e-6) {
        const p1 = pts[Math.floor(pts.length / 3)], p2 = pts[Math.floor((2 * pts.length) / 3)];
        const c = circum(A, p1, p2);
        if (c) return [{ t: "circle", c: r6(c), r: +A.distanceTo(c).toFixed(6), n: r6(new THREE.Vector3().crossVectors(p1.clone().sub(A), p2.clone().sub(A)).normalize()) }];
      } else return [{ t: "arc", a: r6(A), m: r6(Mid), b: r6(B) }];
    }
    // other curves: follow the drawn polyline
    const out = [];
    for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 1e-6) out.push({ t: "line", a: r6(pts[i - 1]), b: r6(pts[i]) });
    return out;
  }
  function circum(a, m, b) {
    const ab = b.clone().sub(a), am = m.clone().sub(a), n = new THREE.Vector3().crossVectors(ab, am), n2 = n.lengthSq();
    if (n2 < 1e-12) return null;
    return a.clone().add(new THREE.Vector3().crossVectors(n, ab).multiplyScalar(am.lengthSq()).add(new THREE.Vector3().crossVectors(am, n).multiplyScalar(ab.lengthSq())).divideScalar(2 * n2));
  }
  // join picked edges end to end into one path
  function chainSegs(groups) {
    const segs = groups.flat();
    if (segs.length === 1 || segs.some((s) => s.t === "circle")) {
      if (segs.length > 1) throw new Error("A full circle edge has to be the whole path");
      return segs;
    }
    const tol = 1e-3, same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < tol;
    const rev = (s) => ({ ...s, a: s.b, b: s.a });
    const left = segs.slice();
    // start from an end that nothing else touches (or anywhere for a closed loop)
    let startI = left.findIndex((s) => !left.some((o) => o !== s && (same(o.a, s.a) || same(o.b, s.a))));
    let cur;
    if (startI >= 0) cur = [left.splice(startI, 1)[0]];
    else {
      startI = left.findIndex((s) => !left.some((o) => o !== s && (same(o.a, s.b) || same(o.b, s.b))));
      cur = startI >= 0 ? [rev(left.splice(startI, 1)[0])] : [left.shift()];
    }
    while (left.length) {
      const end = cur[cur.length - 1].b;
      const i = left.findIndex((s) => same(s.a, end) || same(s.b, end));
      if (i < 0) throw new Error("The picked edges must connect end to end");
      const s = left.splice(i, 1)[0];
      cur.push(same(s.a, end) ? s : rev(s));
    }
    return cur;
  }
  function pipeCmd(editing = null) {
    const ex = existing(editing);
    const st = { path: null, edges: [], section: "circle", size: 5, hollow: false, wall: 1, op: "new", editing, hover: null, chain: true, dist: 1, flip: false, around: null, aroundPick: false, aroundOff: 0 };
    if (ex) {
      const n = ex.node;
      Object.assign(st, { path: n.path || null, section: n.section || "circle", size: n.size ?? 5, hollow: !!n.hollow, wall: n.wall ?? 1, op: ex.op, fixedSegs: n.edgeSegs || null, dist: n.dist ?? 1, flip: !!n.flip, aroundOff: n.aroundOff ?? 0 });
    }
    const pathSegsNow = () => (st.edges.length ? chainSegs(st.edges.map((e) => e.segs)) : st.fixedSegs || null);
    const addEdges = (base, list) => {
      for (const ei of list) if (!st.edges.some((x) => x.body === base.body.id && x.edge === ei)) { const h = edgeHit(base, ei); st.edges.push({ body: h.body, edge: ei, segs: edgeSeg(h), pts: edgeWorldPts(base, ei) }); }
    };
    const checkPath = () => { try { pathSegsNow(); def.error = null; } catch (err) { def.error = err.message; } };
    const def = {
      title: (editing ? "Edit " : "") + "Pipe",
      valid: () => !!((st.path && st.path.ents.length) || st.edges.length || st.fixedSegs),
      canOk: () => def.valid(),
      apply(doc) {
        const node = { t: "pipe", section: st.section, size: st.size, hollow: st.hollow, wall: st.wall };
        if (st.dist < 1) node.dist = st.dist;
        if (st.flip) node.flip = true;
        if (st.around) node.aroundOff = st.aroundOff;
        if (st.path) node.path = st.path; else node.edgeSegs = pathSegsNow();
        place(doc, st, node, IDENTITY.slice(), toolBox());
        if (st.path && !editing) { const ps = findSketch(doc, st.path.sketch); if (ps) ps.hidden = true; }
      },
      ok() { commit(def, editing ? "Edit pipe" : "Pipe"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.aroundPick ? "Click a body where the pipe should go round it (at that height)." : def.valid() ? "Set the section and size, then OK. Drag the Distance to run the pipe part of the way." : "Click a sketch curve or a body edge for the path (Chain takes the curves or edges that run on from it), or click a face to go round its edge.",
      build(body) {
        const n = st.path ? st.path.ents.length : st.edges.length;
        const label = st.around ? "round a body" : st.path ? `${n} sketch curve${n > 1 ? "s" : ""}` : st.edges.length ? `${n} edge${n > 1 ? "s" : ""}` : st.fixedSegs ? "body edges" : null;
        body.append(row("Path", pickbox(!label && !st.aroundPick, label ? el("b", {}, label) : "Click curves, edges or a face", label ? () => { st.path = null; st.edges = []; st.fixedSegs = null; st.around = null; refresh(); } : null)));
        body.append(el("label", { class: "check", title: "On: one click takes every connected sketch curve, or the body edges that run on smoothly from the one clicked. Off: one at a time." }, el("input", { type: "checkbox", id: "pp-chain", checked: st.chain, onchange: (e) => { st.chain = e.target.checked; refresh(); } }), "Chain selection"));
        body.append(el("div", { class: "psbtns" }, el("button", { class: "btn" + (st.aroundPick ? " primary" : ""), id: "pp-around", title: "Go all the way round a body at the height you click, like a rim or a band", onclick: () => { st.aroundPick = !st.aroundPick; refresh(); } }, "Around a body…")));
        if (st.around) body.append(row("Offset", app.numField({ value: st.aroundOff, id: "pp-aoff", step: 0.5, live: true, onCommit: (v) => { st.aroundOff = v; makeAround(); refresh(false); } }), "pp-aoff"));
        body.append(row("Section", seg(SECTIONS, st.section, (v) => { st.section = v; refresh(); }, "pp-sec")));
        body.append(row(st.section === "circle" ? "Diameter" : "Size", app.numField({ value: st.size, id: "pp-size", min: 0.05, step: 0.5, live: true, onCommit: (v) => { st.size = v; refresh(false); } }), "pp-size"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pp-hollow", checked: st.hollow, onchange: (e) => { st.hollow = e.target.checked; refresh(); } }), "Hollow"));
        if (st.hollow) body.append(row("Section thickness", app.numField({ value: st.wall, id: "pp-wall", min: 0.05, step: 0.1, live: true, onCommit: (v) => { st.wall = v; refresh(false); } }), "pp-wall"));
        body.append(row("Distance", app.numField({ value: st.dist, id: "pp-dist", min: 0.01, max: 1, step: 0.05, live: true, onCommit: (v) => { const was = st.dist < 1; st.dist = Math.min(1, Math.max(0.01, v)); refresh(was !== st.dist < 1); } }), "pp-dist"));
        if (st.dist < 1) body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pp-flip", checked: st.flip, onchange: (e) => { st.flip = e.target.checked; refresh(); } }), "Start from the other end"));
        opRow(body, st, editing);
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Distance is the part of the path the pipe follows (0 to 1), as in Fusion 360. Click a face to run round its outer edge; Around a body follows a body's outline at a height (Offset pushes it out, or in when negative)."));
      },
      start() { scene.syncSketches(store.view); refresh(); },
      handler: {
        hover(e) {
          let h = null;
          if (st.aroundPick) {
            const f = pickBaseFace(e, (b) => !b.hole);
            if (f) { const key = f.body + ":" + f.point.z.toFixed(2); if (st.hover && st.hover.key === key) return; const s = aroundLoop(f.base, f.point, st.aroundOff); if (s) h = { key, pts: segsPts([s]) }; }
          } else {
            const c = pickSketchCurve(e);
            if (c) h = { kind: "sketch", c, pts: pathPts(c) };
            else {
              const eh = pickBaseEdge(e, (b) => !b.hole);
              if (eh) h = { kind: "edge", eh, pts: (st.chain ? tangentChain(eh.base, eh.edge) : [eh.edge]).map((k) => edgeWorldPts(eh.base, k)) };
              else { const f = pickBaseFace(e, (b) => !b.hole); if (f && f.face >= 0) h = { kind: "face", pts: faceLoopEdges(f.base, f.face).map((k) => edgeWorldPts(f.base, k)) }; }
            }
          }
          st.hover = h; draw();
          vp.canvas.style.cursor = h ? "pointer" : "default";
        },
        down(e) {
          if (st.aroundPick) {
            const f = pickBaseFace(e, (b) => !b.hole);
            if (!f) return true;
            st.around = { body: f.body, base: f.base, p: f.point.clone() }; st.aroundPick = false;
            st.path = null; st.edges = [];
            makeAround(); refresh();
            return true;
          }
          const c = pickSketchCurve(e);
          if (c) {
            const sk = findSketch(store.view, c.sketch);
            st.edges = []; st.fixedSegs = null; st.around = null;
            if (st.chain || !st.path || st.path.sketch !== c.sketch) st.path = { sketch: c.sketch, ents: st.chain ? pathChain(resolveSketch(sk), c.curve.id) : [c.curve.id] };
            else { const cur = st.path.ents; st.path = { sketch: c.sketch, ents: cur.includes(c.curve.id) ? cur.filter((x) => x !== c.curve.id) : [...cur, c.curve.id] }; if (!st.path.ents.length) st.path = null; }
            refresh();
            return true;
          }
          const eh = pickBaseEdge(e, (b) => !b.hole);
          if (eh) {
            st.path = null; st.fixedSegs = null; st.around = null;
            const i = st.edges.findIndex((x) => x.body === eh.body && x.edge === eh.edge);
            const chain = st.chain ? tangentChain(eh.base, eh.edge) : [eh.edge];
            if (i >= 0) st.edges = st.edges.filter((x) => !(x.body === eh.body && chain.includes(x.edge)));
            else addEdges(eh.base, chain);
            checkPath(); refresh();
            return true;
          }
          const f = pickBaseFace(e, (b) => !b.hole);
          if (f && f.face >= 0) {
            const loop = faceLoopEdges(f.base, f.face);
            if (loop.length) { st.path = null; st.fixedSegs = null; st.around = null; st.edges = []; addEdges(f.base, loop); checkPath(); refresh(); }
          }
          return true;
        },
      },
    };
    function makeAround() {
      const s = st.around ? aroundLoop(st.around.base, st.around.p, st.aroundOff) : null;
      st.fixedSegs = s ? [s] : null;
      def.error = s ? null : "Couldn't find the body's outline at that height";
    }
    function pathLines() {
      if (st.path) return st.path.ents.map((id) => pathPts({ sketch: st.path.sketch, curve: { id } })).flat();
      if (st.edges.length) return st.edges.map((x) => x.pts);
      if (st.fixedSegs) return st.fixedSegs.map((s) => s.t === "circle" ? circlePts(s) : s.t === "bsp" ? s.pts.map((q) => V3(q)) : s.t === "arc" ? [V3(s.a), V3(s.m), V3(s.b)] : [V3(s.a), V3(s.b)]);
      return [];
    }
    function circlePts(s) {
      const c = V3(s.c), n = V3(s.n).normalize(), u = new THREE.Vector3().crossVectors(n, Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize(), w = new THREE.Vector3().crossVectors(n, u);
      const out = [];
      for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; out.push(c.clone().addScaledVector(u, Math.cos(a) * s.r).addScaledVector(w, Math.sin(a) * s.r)); }
      return out;
    }
    function toolBox() {
      const box = new THREE.Box3();
      for (const pl of pathLines()) for (const p of pl) box.expandByPoint(p);
      if (!box.isEmpty()) box.expandByScalar(st.size / 2 + 1e-3);
      return box;
    }
    function draw() {
      clearOv();
      for (const pl of pathLines()) drawLine(pl, 0x2f66c8);
      if (st.hover) for (const pl of st.hover.pts) drawLine(pl, 0xe8a317);
      vp.request();
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    st.refresh = refresh;
    openCmd(def);
  }

  // ------------------------------------------------------------ Coil
  const AXES = { Z: [0, 0, 1], X: [1, 0, 0], Y: [0, 1, 0] };
  function coilCmd(editing = null) {
    const ex = existing(editing);
    const t = vp.view.target;
    const st = { o: [+t.x.toFixed(1), +t.y.toFixed(1), 0], n: [0, 0, 1], axis: "Z", d: 20, turns: 5, h: 20, pitch: 4, mode: "height", angle: 0, section: "circle", size: 2, pos: "on", left: false, op: "new", editing };
    if (ex) {
      const n = ex.node, M = M4(ex.m);
      const o = new THREE.Vector3().setFromMatrixPosition(M), z = new THREE.Vector3().setFromMatrixColumn(M, 2).normalize();
      Object.assign(st, { d: n.d ?? 20, turns: n.turns ?? 5, h: n.h ?? 20, pitch: n.pitch ?? 4, mode: n.mode || "height", angle: n.angle || 0, section: n.section || "circle", size: n.size ?? 2, pos: n.pos || "on", left: !!n.left, op: ex.op, o: r6(o), n: r6(z), axis: null });
      for (const [k, v] of Object.entries(AXES)) if (z.distanceTo(V3(v)) < 1e-6) st.axis = k;
    }
    let hover = null;
    const matrix = () => arr(planeMatrix(frameFrom(st.o, st.n)));
    const def = {
      title: (editing ? "Edit " : "") + "Coil",
      apply(doc) {
        const node = { t: "coil", d: st.d, turns: st.turns, mode: st.mode, h: st.h, pitch: st.pitch, angle: st.angle, section: st.section, size: st.size, pos: st.pos, left: st.left };
        const m = matrix();
        const tall = st.mode === "pitch" ? st.pitch * st.turns + st.size : st.h;
        const box = new THREE.Box3(new THREE.Vector3(-st.d / 2 - st.size, -st.d / 2 - st.size, 0), new THREE.Vector3(st.d / 2 + st.size, st.d / 2 + st.size, tall)).applyMatrix4(M4(m));
        place(doc, st, node, m, box);
      },
      ok() { commit(def, editing ? "Edit coil" : "Coil"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => "Click the ground or a flat face to place the coil's center, then set its size.",
      build(body) {
        const num = (label, key, id, min, step, unit) => row(label, app.numField({ value: st[key], id, min, step, live: true, onCommit: (v) => { st[key] = v; refresh(false); } }), id);
        body.append(num("Diameter", "d", "cl-d", 0.1, 1));
        body.append(row("Type", seg([["height", "Turns & height"], ["pitch", "Turns & pitch"]], st.mode, (v) => { st.mode = v; refresh(); }, "cl-mode")));
        body.append(num("Turns", "turns", "cl-turns", 0.25, 0.5));
        body.append(st.mode === "pitch" ? num("Pitch", "pitch", "cl-pitch", 0.05, 0.5) : num("Height", "h", "cl-h", 0.1, 1));
        body.append(num("Taper °", "angle", "cl-angle", -60, 1));
        body.append(row("Twist", seg([["right", "Right-hand"], ["left", "Left-hand"]], st.left ? "left" : "right", (v) => { st.left = v === "left"; refresh(); }, "cl-hand")));
        body.append(el("div", { class: "subhead" }, "Section"));
        body.append(row("Shape", seg([["circle", "Round"], ["square", "Square"], ["triangle", "Tri out"], ["triangle-in", "Tri in"]], st.section, (v) => { st.section = v; refresh(); }, "cl-sec")));
        body.append(num("Size", "size", "cl-size", 0.05, 0.5));
        body.append(row("Sits", seg([["inside", "Inside"], ["on", "On"], ["outside", "Outside"]], st.pos, (v) => { st.pos = v; refresh(); }, "cl-pos")));
        body.append(el("div", { class: "subhead" }, "Placement"));
        const p3 = el("div", { class: "row3" });
        ["X", "Y", "Z"].forEach((l, i) => p3.append(el("label", {}, l, app.numField({ value: st.o[i], id: "cl-o" + i, step: 1, onCommit: (v) => { st.o = st.o.slice(); st.o[i] = v; refresh(false); } }))));
        body.append(p3);
        body.append(row("Axis", seg([["Z", "Z"], ["X", "X"], ["Y", "Y"]], st.axis, (v) => { st.axis = v; st.n = AXES[v]; refresh(); }, "cl-axis")));
        opRow(body, st, editing);
      },
      start() { refresh(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, (b) => !b.hole && (!editing || b.id !== editing.body));
          hover = f && f.info && f.info.t === "PLANE" ? f.point.clone() : f ? null : vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
          draw();
          vp.canvas.style.cursor = hover ? "crosshair" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole && (!editing || b.id !== editing.body));
          if (f && f.info && f.info.t === "PLANE") { st.o = r6(f.point); st.n = r6(V3(f.info.n).transformDirection(f.base.m).normalize()); st.axis = null; for (const [k, v] of Object.entries(AXES)) if (V3(st.n).distanceTo(V3(v)) < 1e-6) st.axis = k; }
          else if (!f) { const p = vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)); if (!p) return true; st.o = r6(p); st.n = [0, 0, 1]; st.axis = "Z"; }
          else { app.toast("Place a coil on a flat face or the ground."); return true; }
          refresh();
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      const o = V3(st.o), n = V3(st.n).normalize(), L = Math.max(st.d, st.mode === "pitch" ? st.pitch * st.turns : st.h) * 0.75 + 5;
      drawLine([o.clone().addScaledVector(n, -2), o.clone().addScaledVector(n, L)], 0x1f4fa8);
      drawDot(o, 0x1f4fa8, 9);
      if (hover) drawDot(hover, 0xe8a317, 9);
      vp.request();
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    st.refresh = refresh;
    openCmd(def);
  }

  return { pipeCmd, coilCmd, edgeSeg, chainSegs, tangentChain, faceLoopEdges, aroundLoop, edgeHit, segsPts };
}
