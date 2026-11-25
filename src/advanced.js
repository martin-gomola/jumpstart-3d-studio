// Advanced mode: Fusion-style ribbon, browser, timeline and feature commands.
import * as THREE from "three";
import { store, findBody, findSketch, nextSeq, IDENTITY, timeline, regionsFor, regionOwners, shapeGroup, userLoops, resolveNode, bodyKey, primName, bodyTypeName, pathChain, orderPath } from "./store.js";
import { el, fmt, uid, round, clone, nextColor, fileAccept } from "./util.js";
import { getUnit, withUnit, showLen } from "./units.js";
import { ICON } from "./icons.js";
import { fontSelect } from "./fonts.js";
import { planeMatrix } from "./scene.js";
import { thickLines } from "./thickline.js";
import { SKETCH_TOOLS, normalizeSketch, arcFrom3, addImportedCurves } from "./sketcher.js";
import { parseSVG, parseDXF, curvesBounds } from "./importers.js";
import { traceImage, curvesFor } from "./trace.js";
import { maskBox } from "./puffy.js";
import { cutOut, buildModel, shrink as photoShrink, colorAt as photoColorAt, PRESETS as PHOTO_PRESETS, PROFILES as PHOTO_PROFILES } from "./photo3d.js";
import { resolveSketch, sampleCurve, d2, polyArea, makeSplineCurve } from "./regions.js";
import { initViews3D } from "./views3d.js";
import { recognize as recognizeStroke, resample as resampleStroke, smoothStroke, strokeLength } from "./strokefit.js";
import { M4, arr, makePrimBody, frameOnFace, groupBodies, ungroupBody, deleteBodies, duplicateBodies, nextName, PRIM_DEFAULTS, transformBodies } from "./ops.js";
import { MATERIALS, matByKey, swatchCSS } from "./appearance.js";
import { renderImage, QUALITY, LIGHT_COLORS, LIGHT_TYPES, BACKGROUNDS } from "./render.js";
import { LIB, TEX_CATS, TEXTURE_DEFAULTS, textureThumb, texByKey, registerImageTexture, bytesToB64 } from "./texture.js";
import { initSimulate } from "./simulate.js";
import { readMeshFile, simplify, packMesh, meshBounds, toB64, contentId, MESH_LIMIT } from "./meshimport.js";
import { readLayerscape, addMeshBodies } from "./lsimport.js";
import { initMeasure } from "./measure.js";
import { textBounds } from "./textgeo.js";
import { initSection } from "./section.js";
import { sketchesDXF } from "./dxf.js";
import { initPipeCoil } from "./pipecoil.js";
import { initFasteners } from "./fasteners.js"; // jumpstart-3d: fasteners
import { initHolePattern } from "./holepattern.js"; // jumpstart-3d: hole pattern
import { initGears } from "./gears.js"; // jumpstart-3d: gears
import { dragAngle, arcPoints, nearestArc, snapSwitch } from "./rotationui.js"; // jumpstart-3d: rotation access
import { initGridfinityPart } from "./gridfinity-part.jsx"; // jumpstart-3d: Gridfinity part
import { initNamePlate } from "./nameplate.js"; // jumpstart-3d: name plates
import { initKnurl } from "./knurl.js"; // jumpstart-3d: knurl
import { initSpring } from "./spring.js"; // jumpstart-3d: spring
import { initPrintSim } from "./printsim.js";
import { FACEPAT, facePatCells } from "./facepat.js";
import { keyholeTool, KEYHOLE_SIZES, KEYHOLE_DEFAULTS, faceUp, ribTool, RIB_DEFAULTS } from "./ribkey.js";
import { DV_FITS } from "./bins.js";
import { jigSet, JIG_TYPES, JIG_DEFAULTS } from "./jigs.js";
import { binParts, binSet, BIN_DEFAULTS, BIN_STYLES, BIN_LOCKS, BIN_MORE, BIN_MORE_DEFAULTS } from "./bins.js";
import { storageFromMesh, STORE_DEFAULTS } from "./storage.js";
import { openExpandable } from "./expandui.js";
import { hingeParts, HINGE_DEFAULTS, HINGE_TYPES, PIN_KINDS } from "./hinges.js";
import { FASTENER_KINDS, kindOf as fastKind, sizesFor, LENGTHS, defaultLength, fastenerPart, holeSizes } from "./fastener-parts.js";

const BODY_COLORS = ["#9fb1c4", "#c9a27a", "#8fb79a", "#b49ac8", "#c98f8f", "#8fb8c9"];

export function initAdvanced(app) {
  const vp = app.vp, scene = app.scene, sketcher = app.sketcher;
  const $ = (id) => document.getElementById(id);
  const ribbonEl = $("ribbon");
  const ribbon = ribbonEl, browser = $("browser"), tl = $("timeline"), vpEl = $("viewport");
  const roll = { timer: null, hold: 0 }; // timeline stepping (rollback): the play timer
  const panel = el("div", { class: "float cmd", hidden: true, id: "cmd" });
  const palette = el("div", { class: "float cmd", hidden: true, id: "palette" });
  vpEl.append(panel, palette);

  // overlay for picked edges / faces / arrows
  const ov = new THREE.Group();
  vp.world.add(ov);
  function clearOv() { for (const c of [...ov.children]) { ov.remove(c); c.geometry && c.geometry.dispose(); } vp.request(); }

  // ------------------------------------------------------------------ base geometry (committed doc)
  // Picking runs against the committed shape, not the live preview, so edges stay stable.
  // (kept per committed design: working out a body's key on every pointer move was slow on big
  // designs, and every hover picks against every body)
  let baseDoc = null;
  const baseCache = new Map();
  function baseOf(bodyId) {
    if (baseDoc !== store.doc) { baseDoc = store.doc; baseCache.clear(); }
    const c = baseCache.get(bodyId);
    if (c) return c;
    const b = findBody(store.doc, bodyId);
    if (!b) return null;
    const key = bodyKey(resolveNode(b.node, store.doc));
    const r = app.kernel.get(key);
    const out = r && r.ok ? { body: b, data: r.mesh, m: M4(b.m) } : null;
    if (out) baseCache.set(bodyId, out);
    return out;
  }
  // a face's base (for Extrude and Sketch) from a face picked in the view
  function baseFace(sf) {
    const base = sf && baseOf(sf.body);
    if (!base || sf.face < 0 || sf.face >= base.data.faceGroups.length) return null;
    const point = sf.point ? sf.point.clone() : new THREE.Vector3(...base.data.faceInfo[sf.face].c).applyMatrix4(base.m);
    return { body: sf.body, base, face: sf.face, info: base.data.faceInfo[sf.face], point, normal: sf.normal, distance: sf.distance || 0 };
  }
  // the face picked with a click before a tool (like Fusion 360: click a face, then E or S)
  function takeSelFace() {
    const sf = app.selFace;
    if (!sf || sf.doc !== store.doc) return null;
    const f = baseFace(sf);
    return f && f.info && f.info.t === "PLANE" && !f.base.body.hole && !f.base.body.locked ? f : null;
  }
  // geometry is shared between identical bodies; each body gets its own mesh and matrix
  const pickGeoCache = new Map();
  function pickMesh(base) {
    let g = pickGeoCache.get(base.data);
    if (!g) {
      g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(base.data.vertices, 3));
      g.setIndex(new THREE.BufferAttribute(base.data.triangles, 1));
      g.computeBoundingSphere();
      pickGeoCache.set(base.data, g);
      if (pickGeoCache.size > 40) { const k = pickGeoCache.keys().next().value; pickGeoCache.get(k).dispose(); pickGeoCache.delete(k); }
    }
    const m = new THREE.Mesh(g, pickMat);
    m.matrixAutoUpdate = false;
    m.matrix.copy(base.m);
    m.matrixWorld.copy(base.m);
    m.userData.base = base;
    return m;
  }
  const pickMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  function bases(filter) {
    return store.doc.bodies.filter((b) => !b.hidden && (!filter || filter(b))).map((b) => baseOf(b.id)).filter(Boolean);
  }
  function pickBaseFace(e, filter) {
    const list = bases(filter);
    vp.ray(e);
    const hits = vp.raycaster.intersectObjects(list.map(pickMesh), false);
    if (!hits.length) return null;
    const h = hits[0];
    const base = h.object.userData.base;
    const idx = h.faceIndex * 3;
    const fg = base.data.faceGroups;
    let face = -1;
    for (let i = 0; i < fg.length; i++) if (idx >= fg[i][0] && idx < fg[i][0] + fg[i][1]) { face = i; break; }
    const nLocal = h.face.normal.clone();
    return { body: base.body.id, base, face, info: base.data.faceInfo[face], point: h.point.clone(), normal: nLocal.clone().transformDirection(base.m), nLocal, distance: h.distance };
  }
  // Sketch profiles under the pointer that can actually be seen: a profile behind a body (a sketch
  // on the far side, or inside it) doesn't take the click from the face in front, like Fusion 360
  function visibleRegionHits(e) {
    const hits = vp.pick(e, scene.regionMeshes());
    if (!hits.length) return hits;
    const f = pickBaseFace(e, (b) => !b.hole && !b.cmdPreview);
    if (!f) return hits;
    const lim = f.distance + Math.max(0.05, f.distance * 0.002);
    return hits.filter((h) => h.distance <= lim);
  }
  // A flat face as you see it: the face and its neighbours in the same plane that meet it along an
  // edge (an earlier cut or join can leave a flat face in pieces). Its outline is the edges that
  // belong to just one of them.
  function flatFace(base, face) {
    const d = base.data, info = d.faceInfo, FE = d.faceEdges;
    const I0 = info[face];
    if (!FE || FE.length !== info.length || !I0 || I0.t !== "PLANE" || !I0.n) return { faces: [face], edges: null };
    if (!d._owners) { d._owners = new Map(); FE.forEach((l, fi) => l.forEach((ei) => { if (!d._owners.has(ei)) d._owners.set(ei, []); d._owners.get(ei).push(fi); })); }
    const n0 = I0.n, c0 = I0.c;
    const same = (fi) => {
      const I = info[fi];
      if (!I || I.t !== "PLANE" || !I.n || !I.c) return false;
      if (I.n[0] * n0[0] + I.n[1] * n0[1] + I.n[2] * n0[2] < 0.99999) return false;
      return Math.abs(n0[0] * (I.c[0] - c0[0]) + n0[1] * (I.c[1] - c0[1]) + n0[2] * (I.c[2] - c0[2])) < 1e-4;
    };
    const faces = [face], seen = new Set(faces);
    for (let k = 0; k < faces.length; k++) for (const ei of FE[faces[k]]) for (const fj of d._owners.get(ei) || []) if (!seen.has(fj) && same(fj)) { seen.add(fj); faces.push(fj); }
    const count = new Map();
    for (const fi of faces) for (const ei of FE[fi]) count.set(ei, (count.get(ei) || 0) + 1);
    const edges = new Set();
    for (const [ei, c] of count) if (c === 1 || !(d._owners.get(ei) || []).every((fj) => seen.has(fj))) edges.add(ei);
    return { faces, edges };
  }
  function flatFaceArea(base, faces) {
    const d = base.data, V = d.vertices, T = d.triangles, P = (i) => new THREE.Vector3(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]).applyMatrix4(base.m);
    let a = 0;
    for (const fi of faces) { const [s0, c] = d.faceGroups[fi]; for (let k = s0; k < s0 + c; k += 3) { const A = P(T[k]), B = P(T[k + 1]), C = P(T[k + 2]); a += B.sub(A).cross(C.sub(A)).length() / 2; } }
    return a;
  }
  // the outline straight from the face's triangles (the edges used by just one triangle): when the
  // body's edges don't close the face's outline
  function projectTriOutline(sk, base, faces) {
    const toSk = planeMatrix(sk.plane).invert(), d = base.data, V = d.vertices, T = d.triangles;
    const key = (i) => { const q = new THREE.Vector3(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]).applyMatrix4(base.m).applyMatrix4(toSk); return [q.x, q.y]; };
    const pt = new Map(), cnt = new Map();
    const vid = (i) => { const q = key(i), k = Math.round(q[0] * 1e4) + "," + Math.round(q[1] * 1e4); if (!pt.has(k)) pt.set(k, q); return k; };
    for (const fi of faces) { const [s0, c] = d.faceGroups[fi]; for (let k = s0; k < s0 + c; k += 3) { const t = [vid(T[k]), vid(T[k + 1]), vid(T[k + 2])]; for (let j = 0; j < 3; j++) { const a = t[j], b = t[(j + 1) % 3]; if (a === b) continue; const e = a < b ? a + "|" + b : b + "|" + a; cnt.set(e, (cnt.get(e) || 0) + 1); } } }
    const ids = new Map();
    const P = (k) => { if (!ids.has(k)) { const id = uid("p"), q = pt.get(k); sk.pts.push({ id, x: Math.abs(q[0]) < 1e-9 ? 0 : q[0], y: Math.abs(q[1]) < 1e-9 ? 0 : q[1] }); ids.set(k, id); } return ids.get(k); };
    for (const [e, c] of cnt) if (c === 1) { const [a, b] = e.split("|"); sk.ents.push({ id: uid("e"), t: "line", a: P(a), b: P(b), proj: true }); }
    normalizeSketch(sk);
  }
  // (for the checks: how a face's outline is found)
  app._faceDebug = (bodyId, face) => {
    const base = baseOf(bodyId);
    const ff = flatFace(base, face);
    return { faces: ff.faces, edges: ff.edges ? [...ff.edges] : null, area: flatFaceArea(base, ff.faces), info: ff.faces.map((fi) => base.data.faceInfo[fi]), fe: base.data.faceEdges && base.data.faceEdges[face], nFaces: base.data.faceInfo.length, nFE: base.data.faceEdges && base.data.faceEdges.length,
      edgeInfo: ff.edges ? [...ff.edges].map((ei) => base.data.edgeInfo[ei]) : null };
  };
  // Is this point on a body's surface visible, or is some face in front of it? Checked along the
  // line of sight to the point itself (not the pointer), so edges deep inside cuts and holes, whose
  // walls are seen at a glancing angle, still count as visible.
  function seenPoint(p, meshes) {
    const ndc = p.clone().project(vp.camera);
    const rc = vp.raycaster;
    rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), vp.camera);
    const along = p.clone().sub(rc.ray.origin).dot(rc.ray.direction);
    const hits = rc.intersectObjects(meshes, false);
    return !hits.length || hits[0].distance >= along - Math.max(0.05, along * 0.004);
  }
  function pickBaseEdge(e, filter, px = vp.tol(8)) {
    const [mx, my] = vp.local(e);
    const list = bases(filter);
    const meshes = list.map(pickMesh);
    const cam = vp.camera;
    const cands = [];
    const t = new THREE.Vector3();
    for (const base of list) {
      const L = base.data.lines;
      const n = L.length / 3;
      const sx = new Float32Array(n), sy = new Float32Array(n), sd = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        t.set(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]).applyMatrix4(base.m);
        sd[i] = t.distanceTo(cam.position);
        t.project(cam);
        sx[i] = ((t.x + 1) / 2) * vp.w; sy[i] = ((1 - t.y) / 2) * vp.h;
      }
      base.data.edgeGroups.forEach(([s, c], ei) => {
        for (let i = s; i < s + c - 1; i++) {
          const dx = sx[i + 1] - sx[i], dy = sy[i + 1] - sy[i];
          const k = Math.max(0, Math.min(1, ((mx - sx[i]) * dx + (my - sy[i]) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(sx[i] + dx * k - mx, sy[i] + dy * k - my);
          if (d < px) {
            // perspective-correct point on the 3D edge
            const k3 = vp.useOrtho ? k : (k * sd[i]) / ((1 - k) * sd[i + 1] + k * sd[i] || 1);
            const a = new THREE.Vector3(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]), b = new THREE.Vector3(L[i * 3 + 3], L[i * 3 + 4], L[i * 3 + 5]);
            cands.push({ d, p: a.lerp(b, k3).applyMatrix4(base.m), body: base.body.id, edge: ei, info: base.data.edgeInfo[ei], base });
          }
        }
      });
    }
    // nearest visible edge under the pointer (skipping ones hidden behind faces)
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands.slice(0, 40)) if (seenPoint(c.p, meshes)) return { body: c.body, edge: c.edge, info: c.info, base: c.base };
    return null;
  }
  function edgeWorldPts(base, ei) {
    const [s, c] = base.data.edgeGroups[ei];
    const L = base.data.lines, out = [];
    for (let i = s; i < s + c; i++) out.push(new THREE.Vector3(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]).applyMatrix4(base.m));
    return out;
  }
  function drawLine(pts, color, width = 1) {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
    l.renderOrder = 12;
    ov.add(l);
    void width;
  }
  function drawFace(base, face, color, opacity = 0.45) {
    const [s, c] = base.data.faceGroups[face];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(base.data.vertices, 3));
    g.setIndex(Array.from(base.data.triangles.subarray(s, s + c)));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide }));
    m.matrixAutoUpdate = false;
    m.matrix.copy(base.m);
    m.matrixWorldNeedsUpdate = true;
    m.renderOrder = 11;
    ov.add(m);
  }
  function drawDot(p, color, sizePx = 9) {
    const g = new THREE.BufferGeometry().setFromPoints([p]);
    const m = new THREE.Points(g, new THREE.PointsMaterial({ color, size: sizePx, sizeAttenuation: false, depthTest: false, transparent: true }));
    m.renderOrder = 13;
    ov.add(m);
  }

  // Dragging an arrow along its direction, measured on screen. Steady from any view,
  // including when the arrow points straight at you (then dragging up = longer).
  function axisDragger(e, origin, n) {
    const [mx0, my0] = vp.local(e);
    const ps = vp.pixelSize(origin) || 0.1;
    const L = ps * 60;
    const p0 = vp.project(origin), p1 = vp.project(origin.clone().addScaledVector(n, L));
    let sx = (p1[0] - p0[0]) / L, sy = (p1[1] - p0[1]) / L;
    const ppm = 1 / ps;
    if (sx * sx + sy * sy < (0.3 * ppm) ** 2) {
      const toCam = vp.camera.position.clone().sub(origin);
      sx = 0; sy = -ppm * (n.dot(toCam) >= 0 ? 1 : -1);
    }
    const k2 = sx * sx + sy * sy;
    return (ev) => { const [mx, my] = vp.local(ev); return ((mx - mx0) * sx + (my - my0) * sy) / k2; };
  }
  // after a sketch the camera often looks straight down the extrude direction:
  // tilt it so the depth can be seen and dragged
  function tiltForDepth(n) {
    const dir = vp.camera.getWorldDirection(new THREE.Vector3());
    if (Math.abs(dir.dot(n)) < 0.92) return;
    const up = Math.abs(n.z) > 0.9 ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, 1);
    const side = new THREE.Vector3().crossVectors(up, n).normalize();
    const v = n.clone().multiplyScalar(0.55).addScaledVector(up, 0.68).addScaledVector(side, 0.48).normalize();
    vp.lookAlong(v, null, vp.view.target.clone(), vp.view.dist);
  }

  // ------------------------------------------------------------------ command framework
  // Selecting, resize handles (shared with Beginner) and window (marquee) selection
  let delegated = false, pressOn = null;
  const defaultHandler = {
    wantsTouch: (e) => !!app.beginner.pickHandle(e),
    hover(e) {
      if (app.beginner.hoverHandle(e)) { scene.setHovered(null); return; }
      const f = scene.pickFace(e);
      scene.setHovered(f ? f.body : null);
      vp.canvas.style.cursor = "default";
    },
    leave() { scene.setHovered(null); },
    down(e) {
      selSketch = null;
      if (app.beginner.handleDown(e)) { delegated = true; return true; }
      const f = scene.pickFace(e);
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (f) {
        // a click selects the body; dragging from it draws a selection window instead
        // (bodies can't be dragged in Advanced, so the window can start anywhere)
        pressOn = { id: f.body, add, start: vp.local(e), base: app.sel.slice(), face: f };
      } else {
        // drag a window on empty space to select every body it touches
        app.beginner.rubberDown(e, add);
        delegated = true;
      }
      return true;
    },
    move(e) {
      if (pressOn) {
        const [x, y] = vp.local(e);
        if (Math.hypot(x - pressOn.start[0], y - pressOn.start[1]) < 5) return;
        app.beginner.rubberDown(e, pressOn.add, pressOn.start, pressOn.base);
        pressOn = null;
        delegated = true;
      }
      if (delegated) app.beginner.handler.move(e);
    },
    up(e) {
      if (pressOn) {
        const { id, add, face } = pressOn;
        pressOn = null;
        app.select(add ? (app.sel.includes(id) ? app.sel.filter((x) => x !== id) : [...app.sel, id]) : [id]);
        // the face clicked is remembered (and shown) so Extrude (E) can push or pull it and
        // Sketch (S) can start on it straight away, like Fusion 360 and Inventor
        if (!add && face && face.face >= 0) setSelFace(face);
        renderBrowser();
        return;
      }
      if (delegated) { delegated = false; app.beginner.handler.up(e); renderBrowser(); }
    },
    cancel() { pressOn = null; if (delegated) { delegated = false; app.beginner.handler.cancel(); } },
    dblclick(e) {
      const hits = visibleRegionHits(e);
      if (hits.length) { app.enterSketch(hits[0].object.userData.region.sketch); return; }
      const f = scene.pickFace(e);
      if (f) { const b = findBody(store.doc, f.body); if (b) editBody(b); }
    },
  };

  function setSelFace(f) {
    app.selFace = f ? { body: f.body, face: f.face, point: f.point.clone(), normal: f.normal && f.normal.clone(), doc: store.doc } : null;
    const map = new Map();
    if (f) map.set(f.body, new Map([[f.face, 2]]));
    scene.setFaces(map);
  }
  app.setSelFace = setSelFace;
  function openCmd(def) {
    // a tool works on the whole design: leave the stepped-back view (and stop playing)
    if (roll.timer) { clearTimeout(roll.timer); roll.timer = null; }
    if (store.rollTo != null) { store.setRoll(null); app.toast("Back to the last step: tools work on the finished design."); }
    closeCmd(false);
    app.select(def.keepSelection ? app.sel : []);
    app.command = def;
    def.cancel = () => closeCmd(false);
    vp.handler = def.handler || defaultHandler;
    panel.hidden = false;
    panel.classList.toggle("wide", !!def.wide);
    def.render = () => {
      panel.innerHTML = "";
      panel.append(el("header", {}, el("h4", {}, def.title), el("button", { class: "xbtn", "aria-label": "Cancel", html: ICON.close, onclick: () => closeCmd(false) })));
      const body = el("div", { class: "body" });
      def.build(body);
      if (def.error) body.append(el("div", { class: "err-msg" }, def.error));
      panel.append(body);
      const ok = el("button", { class: def.okLabel === "Cancel" ? "btn" : "btn primary", id: "cmd-ok", disabled: def.canOk ? !def.canOk() : false, onclick: () => def.ok() }, def.okLabel || "OK");
      const foot = el("footer", {});
      if (def.onDelete) foot.append(el("button", { class: "btn danger", style: { marginRight: "auto" }, onclick: () => { def.onDelete(); } }, "Delete"));
      if (def.okLabel !== "Cancel" && def.okLabel !== "Done") foot.append(el("button", { class: "btn", onclick: () => closeCmd(false) }, "Cancel"));
      foot.append(ok);
      panel.append(foot);
    };
    def.render();
    def.refreshOk = () => { const b = $("cmd-ok"); if (b) b.disabled = (def.canOk ? !def.canOk() : false) || !!def.buildError; };
    if (def.start) def.start();
    app.refreshUI("command");
  }
  function closeCmd(committed) {
    const def = app.command;
    if (!def) return;
    app.command = null;
    if (!committed) store.setPreview(null);
    def.cleanup && def.cleanup();
    if (!committed && def.onCancel) def.onCancel();
    if (app.sketchSlice && app.sketchSlice.on && !sketcher.active) app.setSketchSlice(false);
    scene.state.forceSketch = null;
    scene.state.ghost = new Set();
    scene.highlightRegions(new Set(), null);
    scene.syncSketches(store.view);
    clearOv();
    panel.hidden = true;
    vp.handler = sketcher.active ? sketcher.handler : app.mode === "advanced" ? defaultHandler : app.beginner.handler;
    vp.canvas.style.cursor = "default";
    app.refreshUI("command");
  }
  let previewQueued = false;
  function schedulePreview(def) {
    // a changed value gets a fresh try: drop the last error (and its disabled OK) right away,
    // so a too-large size can simply be typed over
    if (def.buildError || panel.querySelector("#cmd-err")) {
      def.buildError = null;
      panel.querySelector("#cmd-err")?.remove();
      def.refreshOk && def.refreshOk();
    }
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(() => {
      previewQueued = false;
      if (app.command !== def) return;
      try {
        def.error = null;
        if (def.valid && !def.valid()) { store.setPreview(null); }
        else store.setPreview((doc) => { app.previewing = true; try { def.apply(doc); } finally { app.previewing = false; } });
      } catch (err) { def.error = err.message; }
      def.refreshOk && def.refreshOk();
    });
  }
  // the sketches a design's features use (profiles, paths, axes, loft sections…)
  function usedSketches(doc) {
    const out = new Set();
    const walk = (o, depth = 0) => {
      if (!o || typeof o !== "object" || depth > 40) return;
      if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
      for (const [k, v] of Object.entries(o)) {
        if ((k === "sketch" || k === "sketchId") && typeof v === "string") out.add(v);
        else if (v && typeof v === "object") walk(v, depth + 1);
      }
    };
    for (const b of doc.bodies || []) walk(b.node);
    return out;
  }
  function commit(def, label) {
    if (def.valid && !def.valid()) return;
    try {
      // like Fusion: a sketch that a new feature uses is tucked away once the feature is made
      // (it stays in the Browser; the eye shows it again)
      store.update((doc) => {
        const before = usedSketches(doc);
        const nodes0 = new Map((doc.bodies || []).map((b) => [b.id, JSON.stringify(b.node)]));
        def.apply(doc);
        // every sketch the new or changed features use (also one shown again to reuse it)
        const changed = { bodies: (doc.bodies || []).filter((b) => nodes0.get(b.id) !== JSON.stringify(b.node)) };
        const now = usedSketches(changed);
        for (const id of usedSketches(doc)) if (!before.has(id) || now.has(id)) { const sk = (doc.sketches || []).find((x) => x.id === id); if (sk) sk.hidden = true; }
      }, label);
    } catch (err) { app.toast(err.message, "err"); return; }
    closeCmd(true);
  }
  // the kernel reports preview failures asynchronously; show them in the open dialog
  function showBuildErrors() {
    const def = app.command;
    if (!def || panel.hidden) return;
    const doc = store.view;
    const msgs = [];
    for (const b of doc.bodies) if (scene.errors.has(b.id) && (!store.preview || store.preview === doc)) {
      const committed = findBody(store.doc, b.id);
      // only failures this command introduced
      if (store.preview && committed && bodyKey(resolveNode(committed.node, store.doc)) === b._key) continue;
      if (b._key && !app.kernel.get(b._key)) continue; // still building
      msgs.push(scene.errors.get(b.id));
    }
    let box = panel.querySelector("#cmd-err");
    if (!msgs.length) { if (box) box.remove(); def.buildError = null; def.refreshOk && def.refreshOk(); return; }
    def.buildError = msgs[0];
    if (!box) { box = el("div", { class: "err-msg", id: "cmd-err" }); panel.querySelector(".body").append(box); }
    if (box.dataset.msg !== msgs[0]) { box.textContent = msgs[0]; box.dataset.msg = msgs[0]; }
    def.onBuildError && def.onBuildError(msgs[0], box);
    const ok = document.getElementById("cmd-ok");
    if (ok) ok.disabled = true;
  }
  // ------------------------------------------------------------------ placing text on a face
  // Snap a point on a flat face (all vectors in one space): to the face's center lines when close,
  // otherwise to the grid measured from the face center. Returns the point and its offsets.
  const gridMM = () => { const v = +(document.getElementById("snap") || {}).value; return v > 0 ? v : 1; };
  function snapOnFace(p, c, x, up, tolMM, on) {
    let u = p.clone().sub(c).dot(x), v = p.clone().sub(c).dot(up);
    if (on) {
      const g = gridMM();
      u = Math.abs(u) < tolMM ? 0 : Math.round(u / g) * g;
      v = Math.abs(v) < tolMM ? 0 : Math.round(v / g) * g;
    }
    const n = new THREE.Vector3().crossVectors(x, up).normalize();
    const out = c.clone().addScaledVector(x, u).addScaledVector(up, v).addScaledVector(n, p.clone().sub(c).dot(n));
    return { p: out, u, v };
  }
  // a text-sized outline on a face while dragging (the real letters follow when you let go)
  function drawTextGhost(center, x, up, w, h, angleDeg, color = 0x1f4fa8) {
    const a = (angleDeg * Math.PI) / 180, n = new THREE.Vector3().crossVectors(x, up).normalize();
    const xr = x.clone().applyAxisAngle(n, a), ur = up.clone().applyAxisAngle(n, a);
    const lift = n.clone().multiplyScalar(0.05);
    const pt = (i, j) => center.clone().addScaledVector(xr, (i * w) / 2).addScaledVector(ur, (j * h) / 2).add(lift);
    drawLine([pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1), pt(-1, -1)], color);
    drawLine([center.clone().addScaledVector(xr, -w / 2 - 2).add(lift), center.clone().addScaledVector(xr, w / 2 + 2).add(lift)], 0x7fa6e0);
    drawLine([center.clone().addScaledVector(ur, -h / 2 - 2).add(lift), center.clone().addScaledVector(ur, h / 2 + 2).add(lift)], 0x7fa6e0);
  }
  const textSize = (str, size, font) => { const b = textBounds({ str: String(str || "TEXT"), size, x: 0, y: 0, angle: 0, font }); return [Math.max(size * 0.6, b.maxX - b.minX), Math.max(size, b.maxY - b.minY)]; };

  // ------------------------------------------------------------------ Emboss / deboss text
  // Text raised from or cut into a face: flat faces, round faces (wrapped letter by
  // letter around a cylinder or a hole), spheres, and a straight push on other curves.
  function embossCmd(editing = null, pre = null) {
    const st = { pick: null, str: "TEXT", font: "sans", size: 8, depth: 1, mode: "emboss", angle: 0, along: false, mirror: false, reverse: false, geo: null, body: null, snap: app.snapOn, dragging: false, lastPrev: 0 };
    // wrapping a Beginner text shape onto another shape: start from its text, and replace it on OK
    if (pre) { for (const k of ["str", "font", "size", "depth", "mode"]) if (pre[k] !== undefined) st[k] = pre[k]; st.removeAfter = pre.removeId || null; }
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      Object.assign(st, { str: m.str, font: m.font || "sans", size: m.size, depth: m.depth, mode: m.mode, angle: m.angle || 0, along: !!m.along, mirror: !!m.mirror, reverse: !!m.reverse, body: b.id, geo: geoOf(m) });
      // older text on an upside-down round face: same look, but shown as upright text at 0°
      if (st.geo.kind === "cyl" && !st.along && st.geo.ax) {
        const axW = new THREE.Vector3(...st.geo.ax).transformDirection(M4(b.m));
        if (axW.z < -0.35) { st.geo.ax = st.geo.ax.map((q) => -q); st.angle = (((st.angle + 180) % 360) + 360) % 360; }
      }
    }
    function geoOf(m) { const g = {}; for (const k of ["kind", "p", "n", "x", "o", "ax", "r", "ext", "c", "up", "fc"]) if (m[k] !== undefined) g[k] = m[k]; return g; }
    let hover = null;
    const r6 = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(6)));
    // where the text goes, in the body's own coordinates
    function geoFromPick(f, snapOn = false) {
      const inv = f.base.m.clone().invert();
      const pl = f.point.clone().applyMatrix4(inv);
      const tolMM = vp.tol(10) * vp.pixelSize(f.point);
      const info = f.info;
      const wn = f.normal.clone().normalize();
      const toLocalDir = (v) => v.clone().transformDirection(inv).normalize();
      // upright text: along world X on floors and ceilings, otherwise level across the face
      const wx = Math.abs(wn.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1).cross(wn).normalize();
      if (info.t === "PLANE" && info.n) {
        // snapping: the face's center lines when close, otherwise the grid measured from the face center
        const xl = toLocalDir(wx), nl = new THREE.Vector3(...info.n).normalize(), upl = new THREE.Vector3().crossVectors(nl, xl).normalize();
        const c = info.c ? new THREE.Vector3(...info.c) : null;
        const q = c ? snapOnFace(pl, c, xl, upl, tolMM, snapOn).p : pl;
        return { kind: "plane", p: r6(q), n: info.n.slice(), x: r6(xl), ...(c ? { fc: r6(c) } : {}) };
      }
      if (info.t === "CYLINDRE" && info.ax) {
        // a round face's axis can point either way; turn it so letters stand upright as you see them
        const axW = new THREE.Vector3(...info.ax).transformDirection(f.base.m);
        const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(vp.camera.quaternion);
        const flip = Math.abs(axW.z) > 0.35 ? axW.z < 0 : axW.dot(camUp) < 0;
        const ax = new THREE.Vector3(...info.ax).normalize(), o = new THREE.Vector3(...info.o);
        if (snapOn) { const h = pl.clone().sub(o).dot(ax), g = gridMM(); pl.addScaledVector(ax, Math.round(h / g) * g - h); }
        return { kind: "cyl", p: r6(pl), o: info.o.slice(), ax: flip ? info.ax.map((q) => -q) : info.ax.slice(), r: info.r, ext: info.ext !== false };
      }
      if (info.t === "SPHERE" && info.o) return { kind: "sphere", p: r6(pl), c: info.o.slice(), r: info.r, up: r6(toLocalDir(new THREE.Vector3(0, 0, 1))) };
      return { kind: "other", p: r6(pl), n: r6(f.nLocal.clone().normalize()), x: r6(toLocalDir(wx)) };
    }
    const KIND = { plane: "flat face", cyl: "round face", sphere: "sphere", other: "curved face" };
    const def = {
      title: (editing ? "Edit " : "") + "Emboss text",
      valid: () => !!st.geo && !!st.str.trim() && st.size > 0 && st.depth > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b) return;
        const props = { ...st.geo, str: st.str, font: st.font, size: st.size, depth: st.depth, mode: st.mode, angle: st.angle, along: st.along, mirror: st.mirror, reverse: st.reverse };
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); for (const k of ["kind", "p", "n", "x", "o", "ax", "r", "ext", "c", "up", "fc"]) delete m[k]; Object.assign(m, props); return; }
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "emboss", ...props });
        if (st.removeAfter) doc.bodies = doc.bodies.filter((x) => x.id !== st.removeAfter);
      },
      ok() { commit(def, st.mode === "deboss" ? "Deboss text" : "Emboss text"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.geo ? "Drag the text across the body to move it (or click a spot). Arrow keys nudge it. Hold Alt (Option) while dragging to move freely." : "Click where the text goes: a flat face, a round face or a sphere.",
      build(body) {
        body.append(pickbox(!st.geo, st.geo ? el("span", {}, el("b", {}, findBody(store.doc, st.body)?.name || "Body"), " · " + KIND[st.geo.kind]) : "Click a face", null));
        const txt = el("input", { class: "num", id: "em-text", value: st.str, style: { fontFamily: "var(--f-ui)" }, "aria-label": "Text" });
        txt.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { st.str = txt.value; app.submitCommand(); } });
        txt.addEventListener("input", () => { st.str = txt.value; clearTimeout(st.tt); st.tt = setTimeout(() => refresh(false), 350); });
        body.append(row("Text", txt, "em-text"));
        body.append(row("Font", textFontSelect(st.font, (v) => { st.font = v; refresh(false); }, "em-font"), "em-font"));
        body.append(row("Style", seg([["emboss", "Emboss (raised)"], ["deboss", "Deboss (cut in)"]], st.mode, (v) => { st.mode = v; refresh(); }, "em-mode")));
        const r3 = el("div", { class: "row3" });
        r3.append(el("label", {}, "Letter height", app.numField({ value: st.size, id: "em-size", min: 0.5, step: 1, onCommit: (v) => { st.size = v; refresh(false); } })));
        r3.append(el("label", {}, st.mode === "deboss" ? "Depth" : "Height", app.numField({ value: st.depth, id: "em-depth", min: 0.05, step: 0.2, onCommit: (v) => { st.depth = v; refresh(false); } })));
        r3.append(el("label", {}, "Angle °", app.numField({ value: st.angle, id: "em-angle", step: 15, onCommit: (v) => { st.angle = v; refresh(false); } })));
        body.append(r3);
        if (st.geo && st.geo.kind === "cyl") body.append(row("Direction", seg([[false, "Around"], [true, "Along"]], st.along, (v) => { st.along = v; refresh(); }, "em-along")));
        // fix text that reads backwards or upside down
        const flip = el("div", { class: "seg", id: "em-flip" },
          el("button", { id: "em-mirror", "aria-pressed": st.mirror, title: "Mirror the text left to right (for text that reads backwards, or to read correctly from the other side)", onclick: () => { st.mirror = !st.mirror; refresh(); } }, "⇋ Mirror"),
          el("button", { id: "em-reverse", "aria-pressed": st.reverse, title: "Reverse the order of the letters", onclick: () => { st.reverse = !st.reverse; refresh(); } }, "Reverse order"),
          el("button", { id: "em-rot180", title: "Turn the text upside down (adds 180° to the angle)", onclick: () => { st.angle = ((st.angle + 180) % 360 + 360) % 360; refresh(); } }, "↻ 180°"));
        body.append(row("Flip", flip, "em-flip"));
        // where it sits: offsets from the face center (flat faces), and snapping
        if (st.geo && st.geo.kind === "plane" && st.geo.fc) {
          const [u, v] = uvOf();
          const p3 = el("div", { class: "row3" });
          p3.append(el("label", {}, "Across", app.numField({ value: +u.toFixed(3), id: "em-u", step: 1, onCommit: (val) => { setUV(val, null); refresh(); } })));
          p3.append(el("label", {}, "Up", app.numField({ value: +v.toFixed(3), id: "em-v", step: 1, onCommit: (val) => { setUV(null, val); refresh(); } })));
          p3.append(el("label", {}, "\u00a0", el("button", { class: "btn", id: "em-center", title: "Put the text in the middle of the face", onclick: () => { setUV(0, 0); refresh(); } }, "Center")));
          body.append(el("div", { class: "subhead" }, "Position (from the face center)"), p3);
        }
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "em-snap", checked: st.snap, onchange: (e) => { st.snap = e.target.checked; } }), "Snap to the face center and the grid (" + withUnit(gridMM(), 3) + ")"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Drag the text to move it. Snap off (or holding Alt / Option while you drag) moves it freely. Arrow keys nudge it (Shift ×10, Alt ×0.1). On round faces each letter wraps around the curve. For 3D printing, keep letters at least 5 mm tall and 0.6 mm deep."));
      },
      start() { refresh(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && b.id !== st.removeAfter && (!st.body || !editing || b.id === st.body));
          hover = f && f.info ? f : null;
          draw();
          vp.canvas.style.cursor = hover ? "crosshair" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && b.id !== st.removeAfter && (!editing || b.id === st.body));
          if (!f || !f.info) return true;
          st.body = f.body;
          st.geo = geoFromPick(f, st.snap !== !!e.altKey);
          st.dragging = true; st.lastPrev = performance.now();
          refresh();
          return true;
        },
        // drag the text across the body's faces; the letters rebuild a few times a second and when you let go
        move(e) {
          if (!st.dragging) return;
          const f = pickBaseFace(e, (b) => b.id === st.body);
          if (!f || !f.info) return;
          st.geo = geoFromPick(f, st.snap !== !!e.altKey);
          draw();
          const now = performance.now();
          if (now - st.lastPrev > 350) { st.lastPrev = now; schedulePreview(def); }
        },
        up() { if (!st.dragging) return; st.dragging = false; refresh(); },
      },
      arrowKey(e) {
        if (!st.geo || !st.body) return false;
        const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (st.snap ? gridMM() : 1);
        const dx = e.key === "ArrowLeft" ? -k : e.key === "ArrowRight" ? k : 0, dy = e.key === "ArrowUp" ? k : e.key === "ArrowDown" ? -k : 0;
        const g = st.geo, P = new THREE.Vector3(...g.p);
        if (g.kind === "plane") { const [x, up] = axesOf(); P.addScaledVector(x, dx).addScaledVector(up, dy); }
        else if (g.kind === "cyl") { const ax = new THREE.Vector3(...g.ax).normalize(), o = new THREE.Vector3(...g.o); P.addScaledVector(ax, dy); if (dx) P.sub(o).applyAxisAngle(ax, -dx / Math.max(1e-6, g.r) * (g.ext === false ? -1 : 1)).add(o); }
        else return false;
        st.geo = { ...g, p: r6(P) };
        refresh();
        return true;
      },
    };
    // a flat face's directions (body coordinates): across (the text's x) and up
    function axesOf() { const g = st.geo, x = new THREE.Vector3(...g.x).normalize(), n = new THREE.Vector3(...g.n).normalize(); return [x, new THREE.Vector3().crossVectors(n, x).normalize(), n]; }
    function uvOf() { const g = st.geo, [x, up] = axesOf(), d = new THREE.Vector3(...g.p).sub(new THREE.Vector3(...g.fc)); return [d.dot(x), d.dot(up)]; }
    function setUV(u, v) {
      const g = st.geo, [x, up] = axesOf(), [u0, v0] = uvOf();
      const P = new THREE.Vector3(...g.p).addScaledVector(x, (u ?? u0) - u0).addScaledVector(up, (v ?? v0) - v0);
      st.geo = { ...g, p: r6(P) };
    }
    function draw() {
      clearOv();
      if (hover) drawFace(hover.base, hover.face, 0xe8a317);
      if (st.geo && st.body) {
        const base = baseOf(st.body);
        if (base) {
          const P = new THREE.Vector3(...st.geo.p).applyMatrix4(base.m);
          drawDot(P, 0x1f4fa8, 10);
          if (st.geo.kind === "plane") {
            const [x, up] = axesOf().map((v) => v.clone().transformDirection(base.m));
            const [w, h] = textSize(st.str, st.size, st.font);
            drawTextGhost(P, x, up, w, h, st.angle || 0);
            if (st.geo.fc) drawDot(new THREE.Vector3(...st.geo.fc).applyMatrix4(base.m), 0x7fa6e0, 7);
          }
        }
      }
      vp.request();
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }
  // ------------------------------------------------------------------ Pattern on face
  // Raise or cut a pattern (hexagons, diamond plate, screen mesh, ...) on one flat face. It is a
  // feature like a hole or emboss text: listed in the timeline, editable, rebuilt when the body changes.
  // Lattice (Advanced Modify): the same engine, cut right through the body inside a solid frame
  const LATTICE = { hex: { name: "Honeycomb", size: 10, g: 2 }, triangles: { name: "Triangles", size: 12, g: 2 }, circles: { name: "Circles", size: 9, g: 2 }, mesh: { name: "Screen mesh", size: 6, g: 1.6 } };
  function latticeCmd(editing = null) { return facePatternCmd(editing, true); }
  function facePatternCmd(editing = null, lat = false) {
    if (editing) { const b0 = findBody(store.doc, editing.body); const m0 = b0 && b0.node.mods.find((x) => x.id === editing.mod); if (m0 && m0.lattice) lat = true; }
    const KINDS = lat ? LATTICE : FACEPAT;
    const lsKey = lat ? "jumpstart3d.lattice.kind" : "jumpstart3d.facepat.kind";
    const lastKind = (() => { try { return localStorage.getItem(lsKey) || "hex"; } catch (e) { return "hex"; } })();
    const K0 = KINDS[lastKind] ? lastKind : "hex";
    const st = { kind: K0, size: KINDS[K0].size, gap: KINDS[K0].g, depth: 1, mode: lat ? "cut" : "raise", lines: false, edge: lat ? "clip" : "whole", border: lat ? 3 : 2, angle: 0, ox: 0, oy: 0, body: null, geo: null, face: -1, wall: "through", skin: 2 };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      Object.assign(st, { kind: m.kind, size: m.size, gap: m.gap, depth: m.depth, mode: m.mode, lines: !!m.lines, edge: m.edge || "whole", border: m.border ?? 2, angle: m.angle || 0, ox: m.ox || 0, oy: m.oy || 0, body: b.id, geo: { p: m.p, n: m.n, x: m.x, curved: !!m.curved, sphere: !!m.sphere }, wall: m.skin > 0 ? "shell" : "through", skin: m.skin > 0 ? m.skin : 2 });
    }
    let hover = null;
    const r6 = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(6)));
    function geoFromPick(f) {
      const inv = f.base.m.clone().invert();
      const pl = f.point.clone().applyMatrix4(inv);
      const wn = f.normal.clone().normalize();
      // pattern "across" direction: world X on floors and ceilings, otherwise level across the face
      const wx = Math.abs(wn.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1).cross(wn).normalize();
      const curved = !(f.info && f.info.t === "PLANE" && f.info.n);
      // a curved face: the normal where it was clicked, in the body's own coordinates
      const nl = curved ? wn.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(f.base.m).transpose()).normalize() : null;
      return { p: r6(pl), n: curved ? r6(nl) : f.info.n.slice(), x: r6(wx.clone().transformDirection(inv).normalize()), curved, sphere: !!(f.info && f.info.t === "SPHERE") };
    }
    // any face: flat, or curved (cylinders, cones, spheres, fillets, freeform)
    const flat = (f) => f && f.info;
    const def = {
      title: (editing ? "Edit " : "") + (lat ? "Lattice" : "Pattern on face"),
      valid: () => !!st.geo && st.size > 0 && st.depth > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b) return;
        const props = { p: st.geo.p, n: st.geo.n, x: st.geo.x, curved: !!st.geo.curved, kind: st.kind, size: st.size, gap: st.gap, depth: st.depth, mode: st.mode, lines: st.lines, edge: st.edge, border: st.border, angle: st.angle, ox: st.ox, oy: st.oy, ...(lat ? { lattice: true, through: true, mode: "cut", lines: false, skin: st.wall === "shell" ? st.skin : 0, sphere: !!st.geo.sphere || undefined } : {}) };
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); Object.assign(m, props); return; }
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "facepat", ...props });
      },
      ok() { try { localStorage.setItem(lsKey, st.kind); } catch (e) {} commit(def, lat ? KINDS[st.kind].name + " lattice" : FACEPAT[st.kind].name + (st.mode === "cut" ? " cut" : " pattern")); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => lat ? (st.geo ? "The pattern goes right through the body, inside a solid frame. Change the cells, rib width and frame; double-click it in the timeline to edit it later." : "Click a face of a solid body, flat or curved (the side of a tube, a dome): the lattice goes through it from that face.") : st.geo ? "Change the pattern, its size, depth and direction. It stays editable: double-click it in the timeline later. Click another flat face to move it there." : "Click a flat face to put the pattern on.",
      build(body) {
        body.append(pickbox(!st.geo, st.geo ? el("span", {}, el("b", {}, findBody(store.doc, st.body)?.name || "Body"), st.geo.curved ? " · curved face" : " · flat face") : "Click a face (flat or curved)", null));
        // the patterns, with little pictures
        const grid = el("div", { class: "fp-grid", id: "fp-kind" });
        for (const [k, d] of Object.entries(KINDS)) {
          if (k === "slots" && st.geo && st.geo.curved) continue; // ribs are for flat faces
          grid.append(el("button", { class: "fp-tile", "aria-pressed": String(st.kind === k), "data-k": k, title: d.name, onclick: () => { if (st.kind === k) return; st.kind = k; st.size = d.size; st.gap = d.g; if (k === "slots") st.edge = "clip"; refresh(); } },
            el("span", { html: patSVG(k) }), el("small", {}, d.name)));
        }
        body.append(grid);
        if (!lat) {
          body.append(row("Style", seg([["raise", "Raise"], ["cut", "Cut in"]], st.mode, (v) => { st.mode = v; refresh(); }, "fp-mode")));
          if (!(st.geo && st.geo.curved)) body.append(row("Make", seg([[false, "The shapes"], [true, "Lines between"]], st.lines, (v) => { st.lines = v; refresh(); }, "fp-lines")));
          else body.append(el("div", { class: "hint", style: { padding: 0 } }, "On a curved face the shapes follow the surface (and wrap all the way round a cylinder or cone with no seam)."));
        }
        const r3 = el("div", { class: "row3" });
        r3.append(el("label", {}, lat ? "Cell size" : "Pattern size", app.numField({ value: st.size, id: "fp-size", min: 0.5, step: 1, onCommit: (v) => { st.size = v; refresh(false); } })));
        r3.append(el("label", {}, lat ? (st.kind === "mesh" ? "Wire width" : "Rib width") : FACEPAT[st.kind].gap, app.numField({ value: st.gap, id: "fp-gap", min: lat ? 0.4 : 0, step: 0.2, onCommit: (v) => { st.gap = v; refresh(false); } })));
        if (lat) r3.append(el("label", {}, "Frame", app.numField({ value: st.border, id: "fp-border", min: 0, step: 0.5, onCommit: (v) => { st.border = v; refresh(false); } })));
        else r3.append(el("label", {}, st.mode === "cut" ? "Depth" : "Height", app.numField({ value: st.depth, id: "fp-depth", min: 0.05, step: 0.2, onCommit: (v) => { st.depth = v; refresh(false); } })));
        body.append(r3);
        const dirs = el("div", { class: "seg", id: "fp-dirs" }, ...[0, 30, 45, 60, 90].map((a) => el("button", { "aria-pressed": String(st.angle === a), onclick: () => { st.angle = a; refresh(); } }, a + "°")));
        body.append(row("Direction", el("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } }, dirs, app.numField({ value: st.angle, id: "fp-angle", step: 15, onCommit: (v) => { st.angle = v; refresh(); } })), "fp-angle"));
        if (lat) body.append(row("At the frame", seg([["clip", "Trim cells"], ["whole", "Whole cells only"]], st.edge, (v) => { st.edge = v; refresh(); }, "fp-edge")));
        if (lat) {
          // a lattice shell: the body hollowed to a skin first, so the cells go through the skin
          // and the lattice follows the curved surface; or straight through the solid
          const w = seg([["shell", "Lattice shell"], ["through", "Cut right through"]], st.wall, (v) => { st.wall = v; refresh(); }, "fp-wall");
          w.classList.add("seg-wide");
          body.append(el("div", { class: "subhead" }, "Body behind the face"), w);
          if (st.wall === "shell") body.append(row("Skin", app.numField({ value: st.skin, id: "fp-skin", min: 0.4, step: 0.5, onCommit: (v) => { st.skin = Math.max(0.4, v); refresh(false); } }), "fp-skin"));
          body.append(el("div", { class: "hint", style: { padding: 0 } }, st.wall === "shell" ? "Lattice shell: a solid body is hollowed to this skin, and the cells go through the skin only, following the curved surface (a lattice ball, lamp shade or vase). A body that is already thin there (a tube, a shelled part) is left as it is." : st.geo && st.geo.sphere ? "A solid ball can't be cut right through: choose Lattice shell, or shell the ball first." : "The cells go right through the body from this face."));
        }
        if (lat && st.geo && st.geo.sphere) body.append(el("div", { class: "hint", style: { padding: 0 } }, "On a sphere the cells follow a geodesic layout, even all over like a football: honeycomb (with twelve pentagons), triangles, circles or a square mesh. Direction turns it about the point you clicked."));
        else if (st.kind !== "slots") body.append(row("At the edges", seg([["whole", "Whole shapes"], ["clip", "Trim at edge"]], st.edge, (v) => { st.edge = v; refresh(); }, "fp-edge")));
        const r3b = el("div", { class: "row3" });
        if (!lat && st.edge !== "clip" && st.kind !== "slots") r3b.append(el("label", {}, "Border", app.numField({ value: st.border, id: "fp-border", min: 0, step: 0.5, onCommit: (v) => { st.border = v; refresh(false); } })));
        if (!(lat && st.geo && st.geo.sphere)) {
          r3b.append(el("label", {}, "Shift across", app.numField({ value: st.ox, id: "fp-ox", step: 0.5, onCommit: (v) => { st.ox = v; refresh(false); } })));
          r3b.append(el("label", {}, "Shift up", app.numField({ value: st.oy, id: "fp-oy", step: 0.5, onCommit: (v) => { st.oy = v; refresh(false); } })));
        }
        body.append(r3b);
        if (lat) body.append(el("div", { class: "hint", style: { padding: 0 } }, "Cell size is the distance from one cell to the next; rib width is the solid between them. The frame is the solid rim kept all round the face (and around any holes)."));
        else body.append(el("div", { class: "hint", style: { padding: 0 } }, "Pattern size is the distance from one shape to the next. The pattern is centered on the face and follows it when the body is resized. For 3D printing keep gaps and walls at least 0.8 mm and heights at least 0.4 mm."));
      },
      start() { refresh(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!editing || b.id === st.body));
          hover = flat(f) ? f : null;
          draw();
          vp.canvas.style.cursor = hover ? "crosshair" : f ? "not-allowed" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!editing || b.id === st.body));
          if (!f) return true;
          if (!flat(f)) { app.toast("Click a face of the body."); return true; }
          st.body = f.body; st.face = f.face;
          st.geo = geoFromPick(f);
          // a lattice on a curved face follows the surface as a lattice shell (a hollow body with a
          // lattice skin); on a flat face it goes right through
          if (lat && !editing) st.wall = st.geo.curved ? "shell" : "through";
          // ribs and "lines between" are for flat faces
          if (st.geo.curved) { st.lines = false; if (st.kind === "slots") { st.kind = "hex"; st.size = KINDS.hex.size; st.gap = KINDS.hex.g; } }
          st.ox = 0; st.oy = 0;
          refresh();
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      if (hover) drawFace(hover.base, hover.face, 0xe8a317, 0.35);
      if (st.geo && st.body) {
        const base = baseOf(st.body);
        if (base && st.face >= 0 && base.data.faceGroups[st.face]) drawFace(base, st.face, 0x1f4fa8, 0.18);
      }
      vp.request();
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }
  // a small picture of a pattern (SVG), from the same shapes the engine uses
  const patSVGCache = new Map();
  function patSVG(kind) {
    if (patSVGCache.has(kind)) return patSVGCache.get(kind);
    const d = FACEPAT[kind], W = 40, s = kind === "knurl" ? 9 : kind === "mesh" ? 8 : 12;
    const cells = facePatCells({ kind, size: s, gap: (d.g / d.size) * s }, [-W / 2, -W / 2, W / 2, W / 2]);
    let out = `<svg viewBox="${-W / 2} ${-W / 2} ${W} ${W}" width="40" height="40" aria-hidden="true"><rect x="${-W / 2}" y="${-W / 2}" width="${W}" height="${W}" rx="4" fill="#d9dee6"/><g fill="#1f4fa8">`;
    for (const c of cells) out += c.r ? `<circle cx="${c.c[0].toFixed(2)}" cy="${(-c.c[1]).toFixed(2)}" r="${c.r.toFixed(2)}"/>` : `<polygon points="${c.pts.map(([x, y]) => x.toFixed(2) + "," + (-y).toFixed(2)).join(" ")}"/>`;
    out += "</g></svg>";
    patSVGCache.set(kind, out);
    return out;
  }
  function textFontSelect(value, onPick, id) {
    const s = fontSelect(id, value);
    s.onchange = () => onPick(s.value);
    return s;
  }
  const row = (label, control, id) => el("div", { class: "row" }, el("label", { for: id }, label), control);
  const seg = (options, value, onPick, id) => el("div", { class: "seg", id }, ...options.map(([v, label]) => el("button", { "aria-pressed": v === value, onclick: () => onPick(v) }, label)));
  const pickbox = (active, text, onClear, onActivate) => {
    const d = el("div", { class: "picklist" + (active ? " active" : ""), onclick: onActivate }, text);
    if (onClear) d.append(el("button", { class: "clr", onclick: (e) => { e.stopPropagation(); onClear(); } }, "Clear"));
    return d;
  };

  // ------------------------------------------------------------------ Create sketch
  const planeGizmo = new THREE.Group();
  vp.world.add(planeGizmo);
  const ORIGIN_PLANES = {
    XY: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1], color: 0x2f6fd0 },
    XZ: { o: [0, 0, 0], x: [1, 0, 0], n: [0, -1, 0], color: 0x3f9b52 },
    YZ: { o: [0, 0, 0], x: [0, 1, 0], n: [1, 0, 0], color: 0xd9534f },
  };
  // labels and outlines sit in their own group so only the plane fills are pickable
  const planeGizmoDeco = new THREE.Group();
  vp.world.add(planeGizmoDeco);
  const PLANE_NAMES = { XY: "XY · Top", XZ: "XZ · Front", YZ: "YZ · Right" };
  function planeLabel(text, color) {
    const cv = document.createElement("canvas"), dpr = 2, fs = 26 * dpr;
    const ctx = cv.getContext("2d");
    ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width) + 28 * dpr, h = fs + 18 * dpr;
    cv.width = w; cv.height = h;
    ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
    const r = h / 2;
    ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(r, h); ctx.arc(r, r, r, Math.PI / 2, Math.PI * 1.5); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.textAlign = "center";
    ctx.fillText(text, w / 2, h / 2 + dpr);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.userData.aspect = w / h;
    sp.renderOrder = 12;
    return sp;
  }
  function showPlaneGizmo(on) {
    for (const c of [...planeGizmo.children]) { planeGizmo.remove(c); c.geometry.dispose(); c.material.dispose(); }
    for (const c of [...planeGizmoDeco.children]) { planeGizmoDeco.remove(c); c.geometry && c.geometry.dispose(); if (c.material) { c.material.map && c.material.map.dispose(); c.material.dispose(); } }
    // construction planes stand out more while you choose a plane
    if (!!scene.state.planesBold !== on) { scene.state.planesBold = on; scene.syncPlanes(store.view); }
    if (!on) { vp.request(); return; }
    const s = Math.max(30, vp.view.dist * 0.18);
    // the squares form an open corner toward the usual front-right view: XY · Top is the floor
    // in front, YZ · Right the left wall, XZ · Front the back wall, so none hides another
    const OFF = { XY: [0, -1], XZ: [0, 0], YZ: [-1, 0] };
    for (const [name, pl] of Object.entries(ORIGIN_PLANES)) {
      const M = planeMatrix(pl);
      const [ox, oy] = OFF[name].map((v) => v * s);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s).translate(s / 2 + ox, s / 2 + oy, 0), new THREE.MeshBasicMaterial({ color: pl.color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
      m.matrixAutoUpdate = false;
      m.matrix.copy(M);
      m.matrixWorldNeedsUpdate = true;
      m.userData.plane = name;
      m.renderOrder = 7;
      planeGizmo.add(m);
      // a solid border so each plane reads clearly against the grid
      const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[0, 0], [s, 0], [s, s], [0, s]].map(([x, y]) => new THREE.Vector3(x + ox, y + oy, 0))), new THREE.LineBasicMaterial({ color: pl.color, transparent: true, opacity: 0.95 }));
      edge.matrixAutoUpdate = false; edge.matrix.copy(M); edge.matrixWorldNeedsUpdate = true; edge.renderOrder = 8;
      planeGizmoDeco.add(edge);
      // a name tag in the plane's far corner
      const tag = planeLabel(PLANE_NAMES[name], pl.color);
      const th = s * 0.11;
      tag.scale.set(th * tag.userData.aspect, th, 1);
      tag.position.copy(new THREE.Vector3(ox ? -s * 0.72 : s * 0.72, oy ? -s * 0.8 : s * 0.86, 0).applyMatrix4(M));
      planeGizmoDeco.add(tag);
      m.userData.edge = edge; m.userData.tag = tag;
    }
    vp.request();
  }
  function hotGizmo(obj) {
    for (const m of planeGizmo.children) {
      const hot = obj === m;
      m.material.opacity = hot ? 0.55 : 0.3;
      m.userData.edge.material.color.set(hot ? 0xe8a317 : ORIGIN_PLANES[m.userData.plane].color);
      m.userData.tag.material.opacity = hot ? 1 : 0.9;
    }
  }
  let pendingTool = null;
  function createSketchCmd(opts = {}) {
    if (sketcher.active) app.exitSketch();
    pendingTool = opts.tool || null;
    // a flat face clicked just before: sketch on it straight away
    const pre = takeSelFace();
    if (pre) { makeSketch(planeFromFace(pre), pre); return; }
    let hoverFace = null, hoverKey = "";
    const def = {
      title: "Create sketch",
      okLabel: "Cancel",
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Click the workplane, a flat face of a shape, or pick a plane below."));
        body.append(row("Origin plane", seg([["XY", "XY · Top"], ["XZ", "XZ · Front"], ["YZ", "YZ · Right"]], null, (v) => makeSketch(ORIGIN_PLANES[v], null), "plane-seg")));
        const cps = (store.doc.planes || []);
        if (cps.length) {
          const sel = el("tool-choice", { class: "num", id: "sk-cplane", "aria-label": "Construction plane" }, el("option", { value: "" }, "Pick a construction plane…"), ...cps.map((p) => el("option", { value: p.id }, p.name)));
          sel.onchange = () => { const p = cps.find((q) => q.id === sel.value); if (p) makeSketch(p.plane, null); };
          body.append(row("Or", sel, "sk-cplane"));
        }
      },
      start() { showPlaneGizmo(true); },
      cleanup() { showPlaneGizmo(false); if (scene.state.hotPlane) { scene.state.hotPlane = null; scene.syncPlanes(store.view); } },
      ok() { closeCmd(false); },
      hint: () => "Click a plane or a flat face to start sketching.",
      handler: {
        hover(e) {
          const { g, f, cp } = pickPlaneOrFace(e);
          hotGizmo(g && g.object);
          if ((cp && cp.id) !== scene.state.hotPlane) { scene.state.hotPlane = cp ? cp.id : null; scene.syncPlanes(store.view); }
          const hf = !g && !cp && f && f.info && f.info.t === "PLANE" ? f : null;
          // (only redrawn when the face under the pointer changes: quick on big designs)
          const k = hf ? hf.body + "#" + hf.face : "";
          if (k !== hoverKey) { hoverKey = k; clearOv(); if (hf) drawFace(hf.base, hf.face, 0xe8a317); }
          hoverFace = hf;
          vp.canvas.style.cursor = hf || g || cp ? "pointer" : "default";
          vp.request();
        },
        down(e) {
          const { g, f, cp } = pickPlaneOrFace(e);
          if (cp) { scene.state.hotPlane = null; makeSketch(cp.plane, null); return true; }
          if (g) { makeSketch(ORIGIN_PLANES[g.object.userData.plane], null); return true; }
          if (f && f.info && f.info.t === "PLANE") makeSketch(planeFromFace(f), f);
          else if (f) app.toast("Sketches need a flat face. Pick a plane or a planar face.");
          else if (vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))) makeSketch(ORIGIN_PLANES.XY, null); // the workplane
          return true;
        },
      },
    };
    openCmd(def);
  }
  // the nearer of an origin plane and a body face wins
  function pickPlaneOrFace(e) {
    // construction planes you made come first (unless a face is in front of them)
    const ch = vp.pick(e, scene.planeMeshes())[0] || null;
    const f0 = pickBaseFace(e);
    if (ch && (!f0 || ch.distance <= f0.distance)) {
      const p = (store.doc.planes || []).find((q) => q.id === ch.object.userData.cplane);
      if (p) return { g: null, f: null, cp: p };
    }
    const gh = vp.pick(e, planeGizmo.children)[0] || null;
    const f = f0;
    // a face you can see through the see-through origin planes wins
    if (f) return { g: null, f };
    return { g: gh, f: null };
  }
  function planeFromFace(f) {
    const n = new THREE.Vector3(...f.info.n).transformDirection(f.base.m).normalize();
    const c = new THREE.Vector3(...f.info.c).applyMatrix4(f.base.m);
    // origin: world origin projected onto the face plane, so sketch coordinates match world ones
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, c);
    const o = pl.projectPoint(new THREE.Vector3(0, 0, 0), new THREE.Vector3());
    let x = new THREE.Vector3(1, 0, 0);
    if (Math.abs(n.x) > 0.9) x = new THREE.Vector3(0, 1, 0);
    x.sub(n.clone().multiplyScalar(x.dot(n))).normalize();
    const snap = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(9)));
    return { o: snap(o), x: snap(x), n: snap(n) };
  }
  function projectFaceEdges(sk, f, only = null) {
    // bring the face's boundary into the sketch as fixed geometry
    const toSk = planeMatrix(sk.plane).invert();
    const base = f.base;
    const P = (v) => { const q = v.clone().applyMatrix4(toSk); return [Math.abs(q.x) < 1e-9 ? 0 : q.x, Math.abs(q.y) < 1e-9 ? 0 : q.y, q.z]; };
    const addPt = (p) => {
      const hit = sk.pts.find((q) => Math.hypot(q.x - p[0], q.y - p[1]) < 1e-5);
      if (hit) return hit.id;
      const id = uid("p");
      sk.pts.push({ id, x: p[0], y: p[1] });
      return id;
    };
    const L = base.data.lines;
    const has = (a, b) => sk.ents.some((x) => x.t === "line" && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
    base.data.edgeGroups.forEach(([s, c], ei) => {
      if (only && !only.has(ei)) return;
      const pts = [];
      for (let i = s; i < s + c; i++) pts.push(P(new THREE.Vector3(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]).applyMatrix4(base.m)));
      if (pts.some((p) => Math.abs(p[2]) > 1e-4)) return;
      const info = base.data.edgeInfo[ei];
      const a = P(new THREE.Vector3(...info.a).applyMatrix4(base.m)), b = P(new THREE.Vector3(...info.b).applyMatrix4(base.m)), m = P(new THREE.Vector3(...info.m).applyMatrix4(base.m));
      if (info.t === "LINE") { const A = addPt(a), B = addPt(b); if (A !== B && !has(A, B)) sk.ents.push({ id: uid("e"), t: "line", a: A, b: B, proj: true }); }
      else if (info.t === "CIRCLE" && d2(a, b) < 1e-6) {
        const cc = [(a[0] + m[0]) / 2, (a[1] + m[1]) / 2];
        sk.ents.push({ id: uid("e"), t: "circle", c: addPt(cc), r: d2(a, m) / 2, proj: true });
      } else if (info.t === "CIRCLE") {
        const arc = arcFrom3(a, b, m);
        if (arc) sk.ents.push({ id: uid("e"), t: "arc", c: addPt(arc.c), a: addPt(arc.ccw ? a : b), b: addPt(arc.ccw ? b : a), proj: true });
      } else {
        for (let i = 0; i < pts.length - 1; i++) if (d2(pts[i], pts[i + 1]) > 1e-6) sk.ents.push({ id: uid("e"), t: "line", a: addPt(pts[i]), b: addPt(pts[i + 1]), proj: true });
      }
    });
    normalizeSketch(sk);
  }
  function makeSketch(plane, face) {
    closeCmd(false);
    if (app.selFace) setSelFace(null);
    let id;
    store.update((doc) => {
      const sk = { id: uid("s"), name: nextSketchName(doc), seq: nextSeq(doc), plane: { o: plane.o, x: plane.x, n: plane.n }, pts: [], ents: [], hidden: false };
      if (face) {
        sk.onBody = face.body;
        projectFaceEdges(sk, face);
        // remember the face's center so it can be seen and snapped to
        const q = new THREE.Vector3(...face.info.c).applyMatrix4(face.base.m).applyMatrix4(planeMatrix(sk.plane).invert());
        sk.faceCenter = [Math.abs(q.x) < 1e-9 ? 0 : +q.x.toFixed(9), Math.abs(q.y) < 1e-9 ? 0 : +q.y.toFixed(9)];
      }
      doc.sketches.push(sk);
      id = sk.id;
    }, "Create sketch");
    app.enterSketch(id);
    if (pendingTool) { sketcher.setTool(pendingTool); pendingTool = null; }
  }
  function nextSketchName(doc) {
    let n = 1;
    const names = new Set(doc.sketches.map((s) => s.name));
    while (names.has("Sketch " + n)) n++;
    return "Sketch " + n;
  }

  // ------------------------------------------------------------------ Extrude / Revolve
  function profileKey(sketchId, idx) { return sketchId + ":" + idx; }
  // a sketch made on the fly by clicking a face in Extrude; joins the design on OK
  let pendingSketch = null;
  const findSk = (doc, id) => findSketch(doc, id) || (pendingSketch && pendingSketch.id === id ? pendingSketch : null);
  function toolBox(doc, st) {
    const sk = findSk(doc, st.sketchId);
    if (!sk) return null;
    const regs = regionsFor(sk);
    const M = planeMatrix(sk.plane);
    const n = new THREE.Vector3(...sk.plane.n).normalize();
    const box = new THREE.Box3();
    const pts = [];
    for (const p of st.profiles.values()) {
      const r = regs[p.index];
      if (r) for (const q of r.poly) pts.push(new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M));
    }
    if (st.kind === "sweep") {
      for (const p of pts) box.expandByPoint(p);
      for (const q of sweepPathWorld(st)) box.expandByPoint(q);
      if (!box.isEmpty()) { const sz = box.getSize(new THREE.Vector3()); box.expandByScalar(0); void sz; }
      return box.isEmpty() ? null : box;
    }
    if (st.kind === "revolve") {
      const ax = revolveAxisWorld(st, M);
      if (!ax) return null;
      const { a, b } = ax;
      const dir = b.clone().sub(a).normalize();
      for (const p of pts) for (let k = 0; k < 8; k++) box.expandByPoint(p.clone().sub(a).applyAxisAngle(dir, (k * Math.PI) / 4).add(a));
      return box;
    }
    let lo = 0, hi = st.dist;
    if (st.mode === "sym") { lo = -Math.abs(st.dist) / 2; hi = Math.abs(st.dist) / 2; }
    if (st.mode === "two") { lo = -Math.abs(st.dist2); hi = Math.abs(st.dist); }
    for (const p of pts) { box.expandByPoint(p.clone().addScaledVector(n, lo)); box.expandByPoint(p.clone().addScaledVector(n, hi)); }
    return box;
  }
  function participants(doc, st) {
    const tb = toolBox(doc, st);
    if (!tb) return [];
    tb.expandByScalar(1e-3);
    return store.doc.bodies.filter((b) => !b.hole && !b.hidden && !b.locked && (!st.editing || st.editing.body !== b.id)).filter((b) => {
      const bb = scene.bodyTightBox(b.id);
      return bb && bb.intersectsBox(tb);
    }).map((b) => b.id);
  }
  // is world point p inside body id? (a ray straight up through its triangles, counting crossings)
  function insideBody(id, p) {
    const v = scene.views.get(id);
    if (!v || !v.data || !v.group) return false;
    const q = p.clone().applyMatrix4(v.group.matrixWorld.clone().invert());
    const P = v.data.vertices, T = v.data.triangles;
    let n = 0;
    const ex = 1.3e-5, ey = 2.7e-5, x = q.x + ex, y = q.y + ey;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const ax = P[a], ay = P[a + 1], bx = P[b], by = P[b + 1], cx = P[c], cy = P[c + 1];
      if ((x < ax && x < bx && x < cx) || (x > ax && x > bx && x > cx) || (y < ay && y < by && y < cy) || (y > ay && y > by && y > cy)) continue;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-14) continue;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      if (l1 * P[a + 2] + l2 * P[b + 2] + l3 * P[c + 2] > q.z) n++;
    }
    return n % 2 === 1;
  }
  // the bodies an extrude actually runs into (not just ones whose boxes overlap)
  function overlapping(doc, st, parts) {
    const sk = findSk(doc, st.sketchId);
    if (!sk || st.kind !== "extrude") return parts;
    const regs = regionsFor(sk), M = planeMatrix(sk.plane), n = new THREE.Vector3(...sk.plane.n).normalize();
    let lo = 0, hi = st.dist;
    if (st.mode === "sym") { lo = -Math.abs(st.dist) / 2; hi = Math.abs(st.dist) / 2; }
    if (st.mode === "two") { lo = -Math.abs(st.dist2); hi = Math.abs(st.dist); }
    const pts = [];
    for (const pr of st.profiles.values()) {
      const r = regs[pr.index];
      if (!r) continue;
      const c = r.pt || r.poly[0], step = Math.max(1, Math.floor(r.poly.length / 16));
      const flat = [c];
      for (let i = 0; i < r.poly.length; i += step) { const q = r.poly[i]; flat.push([c[0] + (q[0] - c[0]) * 0.9, c[1] + (q[1] - c[1]) * 0.9]); }
      for (const f of flat) for (const k of [0.15, 0.5, 0.85]) pts.push(new THREE.Vector3(f[0], f[1], 0).applyMatrix4(M).addScaledVector(n, lo + (hi - lo) * k));
    }
    return parts.filter((id) => pts.some((p) => insideBody(id, p)));
  }
  function resolvedOp(doc, st) {
    if (st.op !== "auto") return st.op;
    const parts = participants(doc, st);
    const sk = findSk(doc, st.sketchId);
    if (!parts.length) return "new";
    if (sk && sk.onBody) return (st.kind === "extrude" && st.dist < 0 && st.mode === "one") ? "cut" : "join";
    // like Fusion 360: a new shape that runs into a body joins it (otherwise it would sit hidden
    // inside it, listed in the browser but nowhere to be seen)
    if (overlapping(doc, st, parts).length) return "join";
    return "new";
  }
  // while previewing a cut, show the volume being removed in see-through red
  function showCut(doc, node) {
    doc.bodies.push({ id: "__cut_preview", name: "Cut preview", seq: 1e9, color: "#e5484d", hole: false, hidden: false, cutPreview: true, m: IDENTITY.slice(), node: { ...node, mods: [] } });
  }
  function featureNode(st) {
    const base = { t: st.kind, sketch: st.sketchId, profiles: [...st.profiles.values()].map((p) => p.ref) };
    if (st.kind === "extrude") Object.assign(base, { dist: st.dist, mode: st.mode, dist2: st.dist2 });
    else if (st.kind === "sweep") {
      Object.assign(base, { orient: st.orient, dist: st.sdist, taper: st.taper, twist: st.twist, chain: st.chain });
      // the path: sketch curves, or body edges (kept as fixed world-space segments)
      if (st.path && st.path.ents.length) base.path = st.path;
      else { const segs = st.edges.length ? pc.chainSegs(st.edges.map((e) => e.segs)) : st.fixedSegs; if (segs) base.edgeSegs = segs; }
      // an optional guide rail
      if (st.rail && st.rail.ents.length) base.rail = st.rail;
      else { const rs = st.railEdges.length ? pc.chainSegs(st.railEdges.map((e) => e.segs)) : st.fixedRail; if (rs) base.railEdgeSegs = rs; }
      if (base.rail || base.railEdgeSegs) base.railScale = st.railScale;
      if (st.snap) base.snap = true;
      if (st.around) base.aroundOff = st.aroundOff;
    }
    else Object.assign(base, { axis: st.axis, angle: st.angle });
    return base;
  }

  // sweep path as sampled world points (for previews and bounding boxes)
  function sweepPathLines(st, which = "path") {
    const sp = which === "rail" ? st.rail : st.path, edges = which === "rail" ? st.railEdges : st.edges, fixed = which === "rail" ? st.fixedRail : st.fixedSegs;
    if (edges && edges.length) return edges.map((x) => x.pts);
    if (fixed) return fixed.map((q) => q.t === "bsp" ? q.pts.map((p) => V3(p)) : q.t === "arc" ? [V3(q.a), V3(q.m), V3(q.b)] : q.t === "circle" ? [V3(q.c)] : [V3(q.a), V3(q.b)]);
    const sk = sp && findSk(store.view, sp.sketch);
    if (!sk) return [];
    const M = planeMatrix(sk.plane);
    return resolveSketch(sk).filter((c) => sp.ents.includes(c.id)).map((c) => sampleCurve(c).map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M)));
  }
  const sweepHasPath = (st) => !!((st.path && st.path.ents.length) || st.edges.length || st.fixedSegs);
  const sweepPathWorld = (st) => sweepPathLines(st).flat();
  function pathPts(h) {
    const sk = findSk(store.view, h.sketch);
    const M = planeMatrix(sk.plane);
    const ids = swChain ? pathChain(resolveSketch(sk), h.curve.id) : [h.curve.id];
    return resolveSketch(sk).filter((c) => ids.includes(c.id)).map((c) => sampleCurve(c).map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M)));
  }
  // sweep "Chain selection": clicking a path curve takes every connected curve
  let swChain = true;
  const KIND_NAME = { extrude: "Extrude", revolve: "Revolve", sweep: "Sweep" };
  // any sketch curve (line, arc, circle) near the pointer, in any shown sketch
  function pickSketchCurve(e) {
    const [mx, my] = vp.local(e);
    let best = null, bd = vp.tol(9);
    const shown = new Set(scene.sketchViews.keys());
    for (const sk of store.view.sketches) {
      if (!shown.has(sk.id)) continue;
      const M = planeMatrix(sk.plane);
      for (const c of resolveSketch(sk)) {
        if (c.t === "point") continue;
        const pts = sampleCurve(c).map((q) => vp.project(new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M)));
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((mx - a[0]) * dx + (my - a[1]) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(a[0] + dx * t - mx, a[1] + dy * t - my);
          if (d < bd) { bd = d; best = { sketch: sk.id, curve: c }; }
        }
      }
    }
    return best;
  }

  // revolve axis: a sketch line, or one of the origin axes (X, Y, Z)
  const WORLD_AXES = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
  function revolveAxisWorld(st, M) {
    if (WORLD_AXES[st.axis]) return { a: new THREE.Vector3(0, 0, 0), b: new THREE.Vector3(...WORLD_AXES[st.axis]) };
    const l = st.axisLine;
    if (!l) return null;
    return { a: new THREE.Vector3(l.a[0], l.a[1], 0).applyMatrix4(M), b: new THREE.Vector3(l.b[0], l.b[1], 0).applyMatrix4(M) };
  }
  // origin axes that lie in a sketch's plane direction (you can't revolve around the plane normal)
  function axesInPlane(sk) {
    if (!sk) return ["X", "Y", "Z"];
    const n = new THREE.Vector3(...sk.plane.n).normalize();
    return Object.keys(WORLD_AXES).filter((k) => Math.abs(n.dot(new THREE.Vector3(...WORLD_AXES[k]))) < 1e-6);
  }
  function extrudeCmd(kind = "extrude", editing = null, opts = {}) {
    // a new extrude starts at 0, like Fusion 360: picking a profile only highlights it; the
    // body appears once the arrow is dragged or a distance typed
    const big = app.mode === "beginner"; // Beginner: starts pulled up 10 mm, with a big arrow (easier to see and grab)
    // a flat face clicked before Extrude (E): pushed or pulled straight away
    const preFace = !editing && kind === "extrude" && !opts.sketch && !opts.region ? takeSelFace() : null;
    const st = { kind, profiles: new Map(), sketchId: null, dist: kind === "extrude" && !editing && !big ? 0 : 10, mode: "one", dist2: 5, op: "auto", angle: 360, axis: null, axisLine: null, pickAxis: false, path: null, pickPath: false, edges: [], fixedSegs: null, rail: null, railEdges: [], fixedRail: null, pickRail: false, railScale: true, orient: "perp", sdist: 1, taper: 0, twist: 0, chain: true, snap: false, around: null, aroundPick: false, aroundOff: 0, extent: "dist", toRef: null, pickTo: false, hoverPlane: null, hoverPlaneKey: "", editing };
    // coming straight from a sketch: show it and pick its profile when there is only one
    if (!editing && opts.sketch) {
      st.tiltOk = true;
      const sk = findSk(store.doc, opts.sketch);
      if (sk) {
        const regs = regionsFor(sk);
        st.sketchId = sk.id;
        // ignore profiles made only of a face's projected outline: the user drew something else
        const proj = new Set(sk.ents.filter((e) => e.proj).map((e) => e.id));
        // (a profile that uses any of the face's outline is the face around the drawings, not a drawing:
        // it is never picked by itself; it can still be clicked)
        const mine = regs.map((r, i) => [r, i]).filter(([r]) => !r.ents.some((id) => proj.has(id)));
        // a shape just closed in Beginner: that shape
        const fresh = opts.regionKeys ? regs.map((r, i) => [r, i]).filter(([r]) => opts.regionKeys.includes(r.key)) : [];
        // otherwise: when you drew one closed shape, all of its pieces (a face's outline can split it)
        const own = regionOwners(sk), groups = [...new Set(own.filter((o) => o.startsWith("u:")))];
        const drawn = groups.length === 1 ? regs.map((r, i) => [r, i]).filter(([, i]) => own[i] === groups[0]) : [];
        const pick = opts.regionKeys ? fresh : drawn.length ? drawn : mine.length === 1 ? mine : regs.length === 1 ? [[regs[0], 0]] : [];
        for (const [r, i] of pick) st.profiles.set(profileKey(sk.id, i), { index: i, ref: { key: r.key, pt: r.pt } });
        scene.state.forceSketch = sk.id;
        scene.syncSketches(store.view);
        if (!regs.length) app.toast("That sketch has no closed shapes to extrude yet.");
      }
    }
    // a profile clicked elsewhere (e.g. a sketch circle on a face picked with Offset face)
    if (!editing && opts.region) {
      const r = opts.region;
      st.sketchId = r.sketch;
      st.profiles.set(profileKey(r.sketch, r.index), { index: r.index, ref: { key: r.region.key, pt: r.region.pt } });
      if (opts.dist) st.dist = opts.dist;
      scene.state.forceSketch = r.sketch;
      scene.syncSketches(store.view);
    }
    // prefill from an existing feature
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const node = editing.mod ? b.node.mods.find((m) => m.id === editing.mod).tool : b.node;
      Object.assign(st, { sketchId: node.sketch, dist: node.dist ?? 10, mode: node.mode || "one", dist2: node.dist2 ?? 5, angle: node.angle ?? 360, axis: node.axis || null, path: node.path || null, orient: node.orient || "perp", sdist: kind === "sweep" && node.dist != null ? node.dist : 1, taper: node.taper ?? 0, twist: node.twist ?? 0, chain: node.chain !== false, fixedSegs: kind === "sweep" && !node.path && node.edgeSegs ? node.edgeSegs : null, rail: node.rail || null, fixedRail: node.railEdgeSegs || null, railScale: node.railScale !== false, snap: !!node.snap, aroundOff: node.aroundOff ?? 0 });
      st.op = editing.mod ? b.node.mods.find((m) => m.id === editing.mod).op : "new";
      const sk = findSk(store.doc, st.sketchId);
      if (sk) {
        const regs = regionsFor(sk);
        for (const ref of node.profiles || []) {
          const i = regs.findIndex((r) => r.key === ref.key && pointIn(r, ref.pt)) >= 0 ? regs.findIndex((r) => r.key === ref.key && pointIn(r, ref.pt)) : regs.findIndex((r) => pointIn(r, ref.pt));
          if (i >= 0) st.profiles.set(profileKey(sk.id, i), { index: i, ref });
        }
        if (st.axis && !WORLD_AXES[st.axis]) { const c = resolveSketch(sk).find((c) => c.id === st.axis); st.axisLine = c ? { a: c.a, b: c.b } : null; }
      }
      scene.state.forceSketch = st.sketchId;
      scene.syncSketches(store.view);
    }
    let hoverKey = null;
    let arrowDrag = null;
    const def = {
      title: (editing ? "Edit " : "") + KIND_NAME[kind],
      // (what's picked: its total area, for the checks)
      pickedArea() {
        const sk = pendingSketch && st.sketchId === pendingSketch.id ? pendingSketch : findSk(store.doc, st.sketchId);
        if (!sk) return 0;
        const regs = regionsFor(sk);
        let a = 0;
        for (const p of st.profiles.values()) if (regs[p.index]) a += Math.abs(regs[p.index].area);
        return a;
      },
      pickedFrom: () => (pendingSketch && st.sketchId === pendingSketch.id ? "face" : st.sketchId ? "sketch" : ""),
      valid: () => st.profiles.size > 0 && (kind === "extrude" ? Math.abs(st.dist) > 1e-6 || st.mode === "two" : kind === "sweep" ? sweepHasPath(st) : !!st.axis && st.angle > 0),
      canOk: () => def.valid(),
      apply(doc) {
        const node = featureNode(st);
        if (pendingSketch && pendingSketch.id === st.sketchId && !findSketch(doc, pendingSketch.id)) {
          const ps = JSON.parse(JSON.stringify(pendingSketch));
          ps.seq = nextSeq(doc);
          ps.name = nextSketchName(doc);
          doc.sketches.push(ps);
        }
        const sk = findSk(doc, st.sketchId);
        if (editing) {
          const b = findBody(doc, editing.body);
          if (editing.mod) {
            const m = b.node.mods.find((x) => x.id === editing.mod);
            m.tool = { ...node, mods: [] };
            m.op = st.op === "auto" || st.op === "new" ? m.op : st.op;
            if (app.previewing && m.op === "cut") showCut(doc, node);
          } else b.node = { ...node, mods: b.node.mods || [] };
          return;
        }
        const op = resolvedOp(doc, st);
        const parts = participants(doc, st);
        if (op === "new" || (op === "join" && !parts.length)) {
          doc.bodies.push({ id: st.newId || (st.newId = uid("b")), name: nextName(doc, "Body"), seq: nextSeq(doc), color: app.mode === "beginner" ? nextColor() : BODY_COLORS[doc.bodies.length % BODY_COLORS.length], hole: false, hidden: false, m: IDENTITY.slice(), node: { ...node, mods: [] }, ...(app.previewing ? { cmdPreview: true } : {}) });
        } else {
          if (!parts.length) throw new Error(op === "cut" ? "The profile doesn't reach any body to cut." : "The profile doesn't reach any body.");
          const ov = op === "join" ? overlapping(doc, st, parts) : [];
          const targets = op === "join" ? [ov[0] || parts[0]] : parts;
          const seq = nextSeq(doc);
          for (const id of targets) {
            const b = findBody(doc, id);
            b.node.mods = b.node.mods || [];
            b.node.mods.push({ id: uid("f"), seq, t: "bool", op, tool: { ...node, mods: [] }, m: arr(M4(b.m).invert()) });
          }
        }
        // (while previewing, the path and rail sketches stay shown so their curves can be picked)
        if (sk && !app.previewing) sk.hidden = true;
        if (!app.previewing) for (const ref of [st.path, st.rail]) if (ref) { const ps = findSk(doc, ref.sketch); if (ps) ps.hidden = true; }
        if (app.previewing && op === "cut") showCut(doc, node);
      },
      ok() { commit(def, editing ? "Edit " + kind : KIND_NAME[kind]); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => kind === "sweep" && st.aroundPick ? "Click a body where the sweep should go round it (at that height)." : st.pickPath ? (st.chain ? "Click a sketch line or arc for the path. Connected curves are added as one chain." : "Click sketch curves to add or remove them from the path.") : kind === "sweep" && st.profiles.size ? "Pick the path, then OK." : st.pickAxis ? "Click a straight sketch line to use as the axis, or pick X, Y or Z in the dialog." : st.profiles.size ? (kind === "extrude" ? (st.extent === "to" ? "Click a face or plane to extrude up to it." : "Drag the arrow (or the face) or type a distance. Click more profiles, or faces on the same plane, to add them; click a picked one to drop it.") : "Pick the axis, then set the angle.") : kind === "extrude" ? "Press on a flat face of a body and drag to push or pull it, or click closed profiles in a sketch." : "Click one or more closed profiles in a sketch.",
      build(body) {
        body.append(pickbox(!st.pickAxis && !st.pickPath, st.profiles.size ? el("span", {}, el("b", {}, st.profiles.size), ` profile${st.profiles.size > 1 ? "s" : ""} selected`) : "Select profiles", st.profiles.size ? () => { st.profiles.clear(); st.sketchId = null; refresh(); } : null, () => { st.pickAxis = false; st.pickPath = false; def.render(); }));
        if (kind === "sweep") {
          swChain = st.chain;
          const n = st.path ? st.path.ents.length : 0;
          const ne = st.edges.length, pathLabel = n ? el("span", {}, el("b", {}, n), ` curve${n > 1 ? "s" : ""}`) : ne ? el("span", {}, el("b", {}, ne), ` edge${ne > 1 ? "s" : ""}`) : st.fixedSegs ? el("b", {}, "body edges") : "Click a sketch path or body edges";
          body.append(row("Path", pickbox(st.pickPath, pathLabel, sweepHasPath(st) ? () => { st.path = null; st.edges = []; st.fixedSegs = null; st.pickPath = true; st.pickRail = false; refresh(); } : null, () => { st.pickPath = true; st.pickRail = false; def.render(); })));
          const rn = st.rail ? st.rail.ents.length : 0, re = st.railEdges.length, hasRail = !!(rn || re || st.fixedRail);
          const railLabel = rn ? el("span", {}, el("b", {}, rn), ` curve${rn > 1 ? "s" : ""}`) : re ? el("span", {}, el("b", {}, re), ` edge${re > 1 ? "s" : ""}`) : st.fixedRail ? el("b", {}, "body edges") : "None (optional)";
          body.append(row("Guide rail", pickbox(st.pickRail, railLabel, hasRail ? () => { st.rail = null; st.railEdges = []; st.fixedRail = null; refresh(); } : null, () => { st.pickRail = true; st.pickPath = false; def.render(); }), "sw-rail"));
          if (hasRail) body.append(el("label", { class: "check", title: "On: the profile grows and shrinks to keep touching the rail. Off: it only turns to face the rail." }, el("input", { type: "checkbox", id: "sw-rscale", checked: st.railScale, onchange: (e) => { st.railScale = e.target.checked; refresh(false); } }), "Scale the profile to the rail"));
          body.append(row("Orientation", seg([["perp", "Perpendicular"], ["parallel", "Parallel"]], st.orient, (v) => { st.orient = v; refresh(); }, "sw-orient")));
          body.append(el("label", { class: "check", title: "On: clicking a path curve selects every connected curve. Off: click curves one at a time." }, el("input", { type: "checkbox", id: "sw-chain", checked: st.chain, onchange: (e) => { st.chain = e.target.checked; swChain = st.chain; refresh(); } }), "Chain selection"));
          body.append(el("div", { class: "psbtns" }, el("button", { class: "btn" + (st.aroundPick ? " primary" : ""), id: "sw-around", title: "A path all the way round a body at the height you click (a rim, a band, a handle round a mug)", onclick: () => { st.aroundPick = !st.aroundPick; st.pickPath = false; st.pickRail = false; def.render(); } }, "Around a body…")));
          if (st.around) body.append(row("Offset", app.numField({ value: st.aroundOff, id: "sw-aoff", step: 0.5, live: true, onCommit: (v) => { st.aroundOff = v; swAround(); refresh(false); } }), "sw-aoff"));
          body.append(el("label", { class: "check", title: "Move the profile to the start of the path, square to it, wherever it was drawn. Handy for paths round a body or along edges." }, el("input", { type: "checkbox", id: "sw-snap", checked: st.snap, onchange: (e) => { st.snap = e.target.checked; refresh(false); } }), "Snap the profile to the path"));
          body.append(row("Distance", app.numField({ value: st.sdist, id: "sw-dist", min: 0.001, max: 1, step: 0.05, live: true, onCommit: (v) => { st.sdist = Math.min(1, Math.max(0.001, v)); refresh(false); } }), "sw-dist"));
          if (st.orient === "perp") {
            body.append(row("Taper angle", app.numField({ value: st.taper, id: "sw-taper", min: -89, max: 89, step: 1, angle: true, live: true, onCommit: (v) => { st.taper = v; refresh(false); } }), "sw-taper"));
            body.append(row("Twist angle", app.numField({ value: st.twist, id: "sw-twist", min: -3600, max: 3600, step: 5, angle: true, live: true, onCommit: (v) => { st.twist = v; refresh(false); } }), "sw-twist"));
          }
          body.append(el("div", { class: "hint", style: { padding: 0 } }, "Distance is a fraction of the path (0 to 1). Positive taper widens the sweep, negative narrows it. Twist is the total turn over the swept distance. Taper, twist and a guide rail need the profile at the start of the path. The path can be sketch curves (in another sketch than the profile), a 3D Sketch line or body edges."));
        } else if (kind === "revolve") {
          body.append(row("Axis", pickbox(st.pickAxis, WORLD_AXES[st.axis] ? el("span", {}, el("b", {}, st.axis), " axis") : st.axis ? el("span", {}, el("b", {}, "1"), " sketch line") : "Click a sketch line", null, () => { st.pickAxis = true; def.render(); })));
          const sk = findSk(store.doc, st.sketchId);
          const axes = axesInPlane(sk);
          body.append(row("…or use", seg(axes.map((k) => [k, k + " axis"]), WORLD_AXES[st.axis] ? st.axis : null, (v) => { st.axis = v; st.axisLine = null; st.pickAxis = false; refresh(); }, "rv-axes")));
          body.append(row("Angle", app.numField({ value: st.angle, id: "rv-angle", min: 0.1, max: 360, step: 15, live: true, onCommit: (v) => { st.angle = v; refresh(false); } }), "rv-angle"));
        } else {
          body.append(row("Extent", seg([["dist", "Distance"], ["to", "To object"]], st.extent, (v) => { st.extent = v; if (v === "dist") { st.toRef = null; st.pickTo = false; } else { st.mode = "one"; st.pickTo = !st.toRef; } refresh(); }, "ex-extent")));
          if (st.extent === "to") body.append(row("Object", pickbox(!st.toRef, st.toRef ? el("span", {}, el("b", {}, st.toRef.label || "Surface")) : "Click a face or plane", st.toRef ? () => { st.toRef = null; st.pickTo = true; refresh(); } : null, () => { st.pickTo = true; def.render(); }), "ex-object"));
          else body.append(row("Direction", seg([["one", "One side"], ["sym", "Symmetric"], ["two", "Two sides"]], st.mode, (v) => { st.mode = v; refresh(); }, "ex-mode")));
          const dl = st.mode === "sym" ? "Total distance" : st.mode === "two" ? "Side 1" : "Distance";
          body.append(row(dl, (def.distInput = app.numField({ value: st.dist, id: "ex-dist", step: 1, live: true, onCommit: (v) => { st.dist = v; const was = st.extent === "to"; st.extent = "dist"; st.toRef = null; refresh(was); } })), "ex-dist"));
          if (st.mode === "two") body.append(row("Side 2", app.numField({ value: st.dist2, id: "ex-dist2", min: 0, step: 1, live: true, onCommit: (v) => { st.dist2 = v; refresh(false); } }), "ex-dist2"));
        }
        if (!editing || editing.mod) {
          const ops = editing ? [["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]] : [["auto", "Automatic"], ["new", "New body"], ["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]];
          const sel = el("tool-choice", { class: "num", id: "ex-op" }, ...ops.map(([v, l]) => el("option", { value: v, selected: v === st.op }, l)));
          sel.onchange = () => { st.op = sel.value; refresh(); };
          body.append(row("Operation", sel, "ex-op"));
          if (st.op === "auto") body.append(el("div", { class: "hint", id: "ex-hint", style: { padding: 0 } }, opHint()));
        }
      },
      start() {
        scene.syncSketches(store.view);
        if (!scene.regionMeshes().length && !editing && kind !== "extrude") app.toast("No visible sketch profiles. Create a sketch with a closed shape first.");
        refresh();
        if (preFace) faceProfile(preFace);
      },
      cleanup() { scene.state.forceSketch = null; pendingSketch = null; vp.afterRender.delete(placeTag); tag.remove(); },
      // typing a number anywhere goes straight into the distance (or revolve angle), like Fusion
      typeInto: () => (!st.profiles.size ? null : kind === "extrude" ? def.distInput : kind === "revolve" ? document.getElementById("rv-angle") : null),
      handler: {
        wantsTouch: (e) => !!overArrow(e),
        hover(e) {
          if (arrowDrag) return;
          if (st.pickAxis) { const l = pickSketchLine(e, st.sketchId); vp.canvas.style.cursor = l ? "pointer" : "default"; return; }
          // sweep: a click inside a profile adds/removes it, a click on a curve sets the path
          if (kind === "sweep" && st.aroundPick) {
            const f = pickBaseFace(e, (b) => !b.hole && !b.cmdPreview && b.id !== "__cut_preview");
            const key = f ? "a" + f.body + ":" + f.point.z.toFixed(1) : null;
            if (key !== st.hoverPath) { st.hoverPath = key; const sg = f ? pc.aroundLoop(f.base, f.point, st.aroundOff) : null; st.hoverPathPts = sg ? pc.segsPts([sg]) : null; drawArrow(); }
            vp.canvas.style.cursor = f ? "crosshair" : "default";
            return;
          }
          if (kind === "sweep") {
            const h = sweepPathHit(e);
            const eh = !h ? sweepEdgeHit(e) : null;
            const key = h ? h.sketch + ":" + h.curve.id : eh ? "e" + eh.body + ":" + eh.edge : null;
            if (key !== st.hoverPath) { st.hoverPath = key; st.hoverPathPts = h ? pathPts(h) : eh ? (st.chain ? pc.tangentChain(eh.base, eh.edge) : [eh.edge]).map((k) => edgeWorldPts(eh.base, k)) : null; drawArrow(); }
            if (h || eh || st.pickPath || st.pickRail) { vp.canvas.style.cursor = h || eh ? "pointer" : "default"; return; }
          }
          if (overArrow(e)) { vp.canvas.style.cursor = "grab"; return; }
          const hits = visibleRegionHits(e);
          const k = hits.length ? profileKey(hits[0].object.userData.region.sketch, hits[0].object.userData.region.index) : null;
          // no sketch profile here: a flat face of a body can be pushed or pulled directly (also
          // with something picked already: a click picks that face instead, or adds it when it's
          // on the same body and plane); "To object" picks the face or plane to extrude up to
          const toPick = kind === "extrude" && st.profiles.size && (st.extent === "to" || st.pickTo || editing);
          const hf = !k && kind === "extrude" && !editing && !toPick ? pickExtrudeFace(e) : null;
          const fk = hf ? hf.body + "#" + hf.face : null;
          if (fk !== st.hoverFace) { st.hoverFace = fk; drawArrow(); if (hf) for (const fi of flatFace(hf.base, hf.face).faces) drawFace(hf.base, fi, 0xe8a317, 0.3); }
          const hp = !k && toPick ? pickRefPlane(e) : null;
          const hk = hp ? hp.label + hp.o.join() : "";
          if (hk !== st.hoverPlaneKey) { st.hoverPlaneKey = hk; st.hoverPlane = hp; drawArrow(); }
          vp.canvas.style.cursor = hf && onPicked(hf) ? "grab" : k || hf || st.hoverPlane ? "pointer" : "default";
          if (k !== hoverKey) { hoverKey = k; scene.highlightRegions(new Set(st.profiles.keys()), hoverKey); }
        },
        dblclick(e) {
          if (st.pickAxis || st.pickPath) return;
          const hits = visibleRegionHits(e);
          if (!hits.length) return;
          const r = hits[0].object.userData.region;
          const skc = findSk(store.doc, r.sketch);
          if (!skc) return;
          if (st.sketchId && st.sketchId !== r.sketch) st.profiles.clear();
          st.sketchId = r.sketch;
          const regsC = regionsFor(skc);
          for (const j of shapeGroup(skc, r.index)) if (regsC[j]) st.profiles.set(profileKey(r.sketch, j), { index: j, ref: { key: regsC[j].key, pt: regsC[j].pt } });
          scene.state.forceSketch = st.sketchId;
          if (kind === "sweep") st.pickPath = false;
          refresh();
        },
        down(e) {
          if (kind === "sweep" && st.aroundPick) {
            const f = pickBaseFace(e, (b) => !b.hole && !b.cmdPreview && b.id !== "__cut_preview");
            if (!f) return true;
            st.around = { base: f.base, p: f.point.clone() }; st.aroundPick = false;
            st.path = null; st.edges = [];
            st.snap = true; // a path round a body rarely starts where the profile was drawn
            swAround(); refresh();
            return true;
          }
          const sweepCurve = kind === "sweep" ? sweepPathHit(e) : null;
          const sweepEdge = kind === "sweep" && !sweepCurve ? sweepEdgeHit(e) : null;
          // a face while picking the path: the path runs round its outer edge
          if (kind === "sweep" && !sweepCurve && !sweepEdge && (st.pickPath || (st.profiles.size && !sweepHasPath(st))) && !visibleRegionHits(e).length) {
            const f = pickBaseFace(e, (b) => !b.hole && !b.cmdPreview && b.id !== "__cut_preview");
            const loop = f && f.face >= 0 ? pc.faceLoopEdges(f.base, f.face) : [];
            if (loop.length) {
              st.path = null; st.fixedSegs = null; st.around = null;
              st.edges = loop.map((k) => { const h = pc.edgeHit(f.base, k); return { body: h.body, edge: k, segs: pc.edgeSeg(h), pts: edgeWorldPts(f.base, k) }; });
              try { pc.chainSegs(st.edges.map((x) => x.segs)); def.error = null; } catch (err) { def.error = err.message; }
              st.pickPath = false;
              refresh();
              return true;
            }
          }
          if (kind === "sweep" && sweepEdge) {
            // body edges: added one click at a time (click again to drop), joined end to end
            const rail = st.pickRail;
            const list = rail ? st.railEdges : st.edges;
            if (rail) { st.rail = null; st.fixedRail = null; } else { st.path = null; st.fixedSegs = null; }
            if (!rail) st.around = null;
            // Chain selection: the edges that run on smoothly from the clicked one come too
            const chain = st.chain ? pc.tangentChain(sweepEdge.base, sweepEdge.edge) : [sweepEdge.edge];
            const i = list.findIndex((x) => x.body === sweepEdge.body && x.edge === sweepEdge.edge);
            if (i >= 0) { for (let j = list.length - 1; j >= 0; j--) if (list[j].body === sweepEdge.body && chain.includes(list[j].edge)) list.splice(j, 1); }
            else for (const k of chain) if (!list.some((x) => x.body === sweepEdge.body && x.edge === k)) { const h = pc.edgeHit(sweepEdge.base, k); list.push({ body: h.body, edge: k, segs: pc.edgeSeg(h), pts: edgeWorldPts(sweepEdge.base, k) }); }
            try { if (list.length) pc.chainSegs(list.map((x) => x.segs)); def.error = null; } catch (err) { def.error = err.message; }
            st.hoverPath = null; st.hoverPathPts = null;
            refresh();
            return true;
          }
          if (kind === "sweep" && st.pickRail && sweepCurve) {
            const sk = findSk(store.view, sweepCurve.sketch);
            st.rail = { sketch: sweepCurve.sketch, ents: st.chain ? pathChain(resolveSketch(sk), sweepCurve.curve.id) : [sweepCurve.curve.id] };
            st.railEdges = []; st.fixedRail = null; st.pickRail = false; st.hoverPath = null; st.hoverPathPts = null;
            refresh();
            return true;
          }
          if (kind === "sweep" && (sweepCurve || st.pickPath || st.pickRail)) {
            const h = sweepCurve;
            if (h) {
              st.edges = []; st.fixedSegs = null;
              const sk = findSk(store.view, h.sketch);
              const ids = st.chain ? pathChain(resolveSketch(sk), h.curve.id) : [h.curve.id];
              if (st.chain || !st.path || st.path.sketch !== h.sketch) st.path = { sketch: h.sketch, ents: ids };
              else { const cur = st.path.ents; st.path = { sketch: h.sketch, ents: cur.includes(ids[0]) ? cur.filter((x) => x !== ids[0]) : [...cur, ids[0]] }; }
              st.pickPath = false; st.hoverPath = null; st.hoverPathPts = null;
              refresh();
            }
            return true;
          }
          if (st.pickAxis) {
            const l = pickSketchLine(e, st.sketchId);
            if (l) { st.axis = l.id; st.axisLine = { a: l.a, b: l.b }; st.pickAxis = false; refresh(); }
            return true;
          }
          const ad = overArrow(e);
          if (ad) { arrowDrag = { ...ad, f: axisDragger(e, ad.origin, ad.n), v0: st.mode === "sym" ? st.dist / 2 : st.dist }; return true; }
          const hits = visibleRegionHits(e);
          if (!hits.length) {
            if (kind === "extrude" && st.profiles.size && (st.extent === "to" || st.pickTo || editing)) {
              const r = pickRefPlane(e);
              if (r) toObject(r);
              return true;
            }
            if (kind === "extrude" && !editing) {
              const f = pickExtrudeFace(e, true);
              if (f) pressFace(f, e);
            }
            return true;
          }
          const r = hits[0].object.userData.region;
          const k = profileKey(r.sketch, r.index);
          if (st.sketchId && st.sketchId !== r.sketch) { st.profiles.clear(); st.axis = null; st.axisLine = null; }
          st.sketchId = r.sketch;
          // a click picks (or drops) just the piece under the pointer, as before; a double-click takes
          // every piece of that drawn shape (handy when a face's outline splits a shape into parts)
          const skc = findSk(store.doc, r.sketch), regsC = skc ? regionsFor(skc) : [];
          const group = [r.index];
          // Extrude: press on a profile and drag to pull it straight away (a click on a picked
          // one drops it)
          if (kind === "extrude" && !editing) {
            if (st.profiles.has(k)) { startPress(e, { toggle: k }); return true; }
            if (regsC[r.index]) st.profiles.set(k, { index: r.index, ref: { key: regsC[r.index].key, pt: regsC[r.index].pt } });
            scene.state.forceSketch = st.sketchId;
            refresh();
            startPress(e, {});
            return true;
          }
          if (st.profiles.has(k)) for (const j of group) st.profiles.delete(profileKey(r.sketch, j));
          else for (const j of group) if (regsC[j]) st.profiles.set(profileKey(r.sketch, j), { index: j, ref: { key: regsC[j].key, pt: regsC[j].pt } });
          if (!st.profiles.size) st.sketchId = null;
          scene.state.forceSketch = st.sketchId;
          if (kind === "revolve" && st.profiles.size && !st.axis) st.pickAxis = true;
          if (kind === "sweep") st.pickPath = false; // profiles and the path can be picked in any order
          refresh();
          return true;
        },
        move(e) {
          if (!arrowDrag) return;
          // pressed on a face: it follows the pointer once it really moves (a click just picks)
          if (arrowDrag.press && !arrowDrag.moved) {
            const [x, y] = vp.local(e);
            if (Math.hypot(x - arrowDrag.press[0], y - arrowDrag.press[1]) < vp.tol(4)) return;
            arrowDrag.moved = true;
          }
          let s = arrowDrag.v0 + arrowDrag.f(e);
          const g = app.gridStep() || 0.1;
          s = round(s, g >= 1 ? 1 : g);
          if (st.mode === "sym") s = Math.abs(s) * 2;
          st.extent = "dist"; st.toRef = null;
          st.dist = s || (st.dist > 0 ? g : -g);
          def.distInput && def.distInput.setValue(st.dist);
          refresh(false);
        },
        up() {
          const a = arrowDrag;
          arrowDrag = null;
          // a click (no drag) on a face already picked: drop it
          if (a && a.toggle && !a.moved) {
            st.profiles.delete(a.toggle);
            if (!st.profiles.size) { st.sketchId = null; scene.state.forceSketch = null; }
            refresh();
          }
          vp.canvas.style.cursor = "default";
        },
      },
    };
    // The outline of exactly the face clicked (Fusion 360 and Inventor pick the face, not whatever
    // else lies in its plane): the body's own edges around that face, and if they don't close it
    // exactly (same area as the face), the outline of its triangles instead
    function regionAt(regs, pt) {
      let best = -1, area = Infinity;
      regs.forEach((r, i) => { if (!r.text && pointIn(r, pt)) { const a = Math.abs(polyArea(r.poly)); if (a < area) { area = a; best = i; } } });
      return best;
    }
    function outlineFace(sk, f) {
      const ff = flatFace(f.base, f.face), want = flatFaceArea(f.base, ff.faces);
      const q = f.point.clone().applyMatrix4(planeMatrix(sk.plane).invert()), pt = [q.x, q.y];
      const n0 = sk.ents.length, p0 = sk.pts.length;
      projectFaceEdges(sk, f, ff.edges);
      let regs = regionsFor(sk), best = regionAt(regs, pt);
      const fits = (i) => i >= 0 && Math.abs(Math.abs(regs[i].area) - want) <= Math.max(0.05, want * 0.003);
      if (!fits(best)) {
        sk.ents.length = n0; sk.pts.length = p0;
        projectTriOutline(sk, f.base, ff.faces);
        regs = regionsFor(sk); best = regionAt(regs, pt);
      }
      return { regs, best, faces: ff.faces };
    }
    // is this face (a hover or click) one of the faces picked already?
    function onPicked(f) {
      const ps = pendingSketch && st.sketchId === pendingSketch.id ? pendingSketch : null;
      if (!ps || f.body !== ps.onBody) return null;
      const v = f.point.clone().applyMatrix4(planeMatrix(ps.plane).invert());
      if (Math.abs(v.z) > 1e-4) return null;
      const regs = regionsFor(ps), pt = [v.x, v.y];
      for (const [k, p] of st.profiles) if (regs[p.index] && pointIn(regs[p.index], pt)) return k;
      return null;
    }
    // press on a flat face: pick it and pull it straight away (drag), like Press Pull. On the same
    // body and plane as the faces picked already it's added; a click on a picked face drops it.
    function pressFace(f, e) {
      const ps = pendingSketch && st.sketchId === pendingSketch.id ? pendingSketch : null;
      const picked = onPicked(f);
      if (picked) { startPress(e, { toggle: picked }); return; }
      if (ps && f.body === ps.onBody) {
        const v = f.point.clone().applyMatrix4(planeMatrix(ps.plane).invert());
        if (Math.abs(v.z) < 1e-4) {
          // its outline joins the sketch; the faces picked already are found again by a point inside
          const keep = [...st.profiles.values()].map((p) => regionsFor(ps)[p.index]).filter(Boolean).map((r) => r.pt);
          const { regs, best } = outlineFace(ps, f);
          st.profiles.clear();
          for (const k of keep) { const i = regionAt(regs, k); if (i >= 0) st.profiles.set(profileKey(ps.id, i), { index: i, ref: { key: regs[i].key, pt: regs[i].pt } }); }
          if (best >= 0) {
            st.profiles.set(profileKey(ps.id, best), { index: best, ref: { key: regs[best].key, pt: regs[best].pt } });
            st.hoverFace = null;
            refresh();
            startPress(e, {});
            return;
          }
        }
      }
      faceProfile(f, e);
      if (st.profiles.size) startPress(e, {});
    }
    function startPress(e, extra) {
      const a = def.arrow;
      if (!a) return;
      arrowDrag = { ...a, f: axisDragger(e, a.origin, a.n), v0: st.mode === "sym" ? st.dist / 2 : st.dist, press: vp.local(e), moved: false, ...extra };
      vp.canvas.style.cursor = "grabbing";
    }
    // "To object": the distance from the profile to a parallel face or plane
    function toObject(r) {
      const sk = findSk(store.doc, st.sketchId) || pendingSketch;
      if (!sk) { app.toast("Pick a profile first."); return; }
      const sn = new THREE.Vector3(...sk.plane.n).normalize(), tn = new THREE.Vector3(...r.n).normalize();
      if (Math.abs(sn.dot(tn)) < 0.9999) { app.toast("Pick a flat face or plane that is parallel to the profile."); return; }
      const d = +new THREE.Vector3(...r.o).sub(new THREE.Vector3(...sk.plane.o)).dot(sn).toFixed(6);
      if (Math.abs(d) < 1e-6) { app.toast("That surface is on the same plane as the profile."); return; }
      Object.assign(st, { extent: "to", toRef: r, pickTo: false, mode: "one", dist: d, hoverPlane: null, hoverPlaneKey: "" });
      def.distInput && def.distInput.setValue(d);
      refresh();
    }
    // the distance shown at the arrow tip, with a reminder that it can simply be typed
    const tag = el("div", { class: "ex-tag", hidden: true });
    vp.labels.append(tag);
    function placeTag() {
      const a = def.arrow;
      if (!a || kind !== "extrude" || app.command !== def) { tag.hidden = true; return; }
      const s = vp.project(a.head || a.tip);
      tag.hidden = false;
      const typing = def.distInput && document.activeElement === def.distInput;
      tag.innerHTML = `<b>${withUnit(st.dist, 2)}</b><span>${typing ? "Enter to finish" : "type a number or drag"}</span>`;
      tag.style.transform = `translate(${Math.round(s[0] + 14)}px, ${Math.round(s[1] - 12)}px)`;
    }
    vp.afterRender.add(placeTag);
    function pickExtrudeFace(e, tell) {
      const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
      if (!f) return null;
      if (!f.info || f.info.t !== "PLANE") { if (tell) app.toast("Only flat faces can be extruded directly. Sketch on a plane to extrude other shapes."); return null; }
      return f;
    }
    // click a flat face: make a sketch of its outline and pick the region under the click
    function faceProfile(f, e) {
      const plane = planeFromFace(f);
      const sk = { id: uid("s"), name: "Sketch", seq: 0, plane: { o: plane.o, x: plane.x, n: plane.n }, pts: [], ents: [], hidden: false, onBody: f.body, fromFace: true };
      const { regs, best } = outlineFace(sk, f);
      if (best < 0) { app.toast("Couldn't find the outline of that face."); return; }
      pendingSketch = sk;
      st.profiles.clear(); st.axis = null; st.axisLine = null;
      // (another face picked instead: it starts flat again, and "To object" goes back to a distance)
      if (st.extent === "to") { st.extent = "dist"; st.toRef = null; st.pickTo = false; }
      if (!big) { st.dist = 0; def.distInput && def.distInput.setValue(0); }
      st.sketchId = sk.id;
      st.profiles.set(profileKey(sk.id, best), { index: best, ref: { key: regs[best].key, pt: regs[best].pt } });
      scene.state.forceSketch = sk.id;
      st.hoverFace = null;
      refresh();
    }
    function overArrow(e) {
      const a = def.arrow;
      if (!a) return null;
      const [mx, my] = vp.local(e);
      const s = vp.project(a.head || a.tip);
      if (Math.hypot(s[0] - mx, s[1] - my) < vp.tol(big ? 30 : 20)) return a;
      // the shaft can be grabbed too
      const o = vp.project(big ? a.tip : a.origin), dx = s[0] - o[0], dy = s[1] - o[1], t = Math.max(0, Math.min(1, ((mx - o[0]) * dx + (my - o[1]) * dy) / (dx * dx + dy * dy || 1)));
      if (!big && Math.hypot(dx, dy) < 12) return null;
      return Math.hypot(o[0] + dx * t - mx, o[1] + dy * t - my) < vp.tol(big ? 10 : 7) ? a : null;
    }
    // a body edge for the sweep's path or rail: when picking them, or once a profile is chosen
    // and the pointer isn't over a sketch profile (the profile's own body edges are allowed)
    function swAround() {
      const sgm = st.around ? pc.aroundLoop(st.around.base, st.around.p, st.aroundOff) : null;
      st.fixedSegs = sgm ? [sgm] : null;
      def.error = st.around && !sgm ? "Couldn't find the body's outline at that height" : null;
    }
    function sweepEdgeHit(e) {
      if (!(st.pickPath || st.pickRail || (st.profiles.size && !sweepHasPath(st)) || st.edges.length || st.railEdges.length)) return null;
      if (!st.pickPath && !st.pickRail && visibleRegionHits(e).length) return null;
      return pickBaseEdge(e, (b) => !b.hole && !b.cmdPreview && b.id !== "__cut_preview");
    }
    // a sweep path pick: a sketch curve, unless the click is inside a profile of the same sketch
    function sweepPathHit(e) {
      const h = pickSketchCurve(e);
      if (!h) return null;
      if (st.pickPath) return h;
      // a click inside a profile picks the profile, even when the path line runs right through it
      // (a profile usually sits on the path's end, and the wide sketch lines are easy to touch);
      // the path can still be clicked anywhere outside the profiles, or picked with "Click a sketch path"
      const hits = visibleRegionHits(e);
      return hits.length ? null : h;
    }
    function opHint() {
      if (!st.profiles.size) return "";
      return "Will " + { new: "create a new body", join: "join the body it touches", cut: "cut the bodies it passes through", intersect: "keep only the overlap" }[resolvedOp(store.doc, st)] + ".";
    }
    function refresh(rerender = true) {
      if (rerender) def.render();
      const h = document.getElementById("ex-hint");
      if (h) h.textContent = opHint();
      scene.highlightRegions(new Set(st.profiles.keys()), hoverKey);
      drawArrow();
      schedulePreview(def);
      app.status();
      // (looking straight down on what's being extruded, the view tilts once so the depth shows:
      // in Beginner, and in Advanced only when Extrude opens on a finished sketch; never when a
      // face or profile is clicked, so the next click lands where it was aimed, like Fusion 360)
      if (def.arrow && !st.tilted && (big || st.tiltOk)) { st.tilted = true; tiltForDepth(def.arrow.n); }
    }
    function drawArrow() {
      clearOv();
      def.arrow = null;
      if (kind === "sweep") {
        for (const pl of sweepPathLines(st)) drawLine(pl, 0x2f66c8);
        for (const pl of sweepPathLines(st, "rail")) drawLine(pl, 0x9a3fd0);
        for (const pl of st.hoverPathPts || []) drawLine(pl, 0xe8a317);
        return;
      }
      if (!st.profiles.size) return;
      const sk = findSk(store.doc, st.sketchId);
      if (!sk) return;
      const regs = regionsFor(sk);
      const M = planeMatrix(sk.plane);
      if (kind === "sweep") {
        for (const pl of sweepPathLines(st)) drawLine(pl, 0x2f66c8);
        for (const pl of sweepPathLines(st, "rail")) drawLine(pl, 0x9a3fd0);
        for (const pl of st.hoverPathPts || []) drawLine(pl, 0xe8a317);
        return;
      }
      // axis line for revolve
      if (kind === "revolve") {
        const ax = revolveAxisWorld(st, M);
        if (ax) {
          const d = ax.b.clone().sub(ax.a).normalize().multiplyScalar(Math.max(60, vp.view.dist * 0.4));
          drawLine(WORLD_AXES[st.axis] ? [ax.a.clone().sub(d), ax.a.clone().add(d)] : [ax.a, ax.b], 0xe8a317);
        }
        return;
      }
      // a bold outline around the picked profiles, drawn over everything, so they stand out
      // from the faces around them
      const seg = [];
      const loop = (poly) => { for (let i = 0; i < poly.length; i++) { const a = new THREE.Vector3(poly[i][0], poly[i][1], 0).applyMatrix4(M), b = new THREE.Vector3(poly[(i + 1) % poly.length][0], poly[(i + 1) % poly.length][1], 0).applyMatrix4(M); seg.push(a.x, a.y, a.z, b.x, b.y, b.z); } };
      for (const p of st.profiles.values()) { const r = regs[p.index]; if (r) { loop(r.poly); (r.holePolys || []).forEach(loop); } }
      if (seg.length) { const o = thickLines(seg, 0x1f6fff, 4, false); o.renderOrder = 15; ov.add(o); }
      let cx = 0, cy = 0, n0 = 0;
      for (const p of st.profiles.values()) { const r = regs[p.index]; if (r) { cx += r.pt[0]; cy += r.pt[1]; n0++; } }
      if (!n0) return;
      const origin = new THREE.Vector3(cx / n0, cy / n0, 0).applyMatrix4(M);
      const n = new THREE.Vector3(...sk.plane.n).normalize();
      const len = st.mode === "sym" ? st.dist / 2 : st.dist;
      const tip = origin.clone().addScaledVector(n, len);
      const ps = vp.pixelSize(tip);
      // Beginner: a big handle standing out from the extruded face, the same size at any zoom
      // Advanced: a bold arrow; when the extrude is short (or still 0) it stands out a little past
      // the face, so there's always something to grab
      const minL = ps * 34, sg = Math.sign(len) || 1;
      const head = big ? tip.clone().addScaledVector(n, sg * ps * 58) : Math.abs(len) < minL ? origin.clone().addScaledVector(n, sg * minL) : tip;
      { const o = thickLines([origin.x, origin.y, origin.z, head.x, head.y, head.z], 0x1f4fa8, big ? 7 : 3, false); o.renderOrder = big ? 999 : 14; ov.add(o); }
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 16), new THREE.MeshBasicMaterial({ color: 0x1f4fa8, depthTest: false, transparent: true }));
      cone.scale.setScalar(ps * (big ? 11 : 8));
      cone.position.copy(head);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().multiplyScalar(Math.sign(len) || 1));
      cone.renderOrder = big ? 1000 : 14; // (Beginner's big arrow is drawn over the workplane)
      ov.add(cone);
      def.arrow = { origin, n, tip, head };
      if (st.toRef) { drawRefPlane(st.toRef, 0x1f4fa8); if (st.toRef.face) drawFace(st.toRef.face.base, st.toRef.face.face, 0x1f4fa8); }
      if (st.hoverPlane) { drawRefPlane(st.hoverPlane, 0xe8a317); if (st.hoverPlane.face) drawFace(st.hoverPlane.face.base, st.hoverPlane.face.face, 0xe8a317); }
    }
    // opened by itself when a Beginner sketch closed a shape: Cancel goes back to the sketch
    if (opts.backToSketch && opts.sketch) def.onCancel = () => setTimeout(() => { if (!app.command && app.mode === "beginner" && findSketch(store.doc, opts.sketch)) app.enterSketch(opts.sketch); }, 0);
    openCmd(def);
  }
  function pointIn(r, pt) {
    const inside = (poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    return inside(r.poly) && !r.holePolys.some(inside);
  }
  function pickSketchLine(e, sketchId) {
    const docSk = store.view.sketches.filter((s) => !sketchId || s.id === sketchId);
    const [mx, my] = vp.local(e);
    let best = null, bd = vp.tol(9);
    for (const sk of docSk) {
      const M = planeMatrix(sk.plane);
      for (const c of resolveSketch(sk)) {
        if (c.t !== "line") continue;
        const a = vp.project(new THREE.Vector3(c.a[0], c.a[1], 0).applyMatrix4(M)), b = vp.project(new THREE.Vector3(c.b[0], c.b[1], 0).applyMatrix4(M));
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((mx - a[0]) * dx + (my - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(a[0] + dx * t - mx, a[1] + dy * t - my);
        if (d < bd) { bd = d; best = c; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ Fillet / Chamfer
  // Like Fusion 360: Fillet or Chamfer type, several selection sets each with its own size,
  // constant / chord-length / variable radius, edges or whole faces, and tangent chain.
  function edgeCmd(kind, editing = null) {
    const st = { kind, sets: [], active: 0, chain: true, editing };
    const newSet = (value) => ({ items: [], keep: null, value, value2: value, rt: "const", ct: "equal", ang: 45, flip: false, pts: [], sel: -1 });
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      const sets = m.sets && m.sets.length ? m.sets : [{ edges: m.edges, r: kind === "fillet" ? m.r : m.d }];
      const M = M4(b.m);
      st.sets = sets.map((x) => ({ items: [], keep: x.edges || [], value: x.r, value2: x.r2 ?? x.r, rt: x.rt || "const", ct: x.ct || "equal", ang: x.ang ?? 45, flip: !!x.flip, sel: -1,
        pts: (x.pts || []).map((q) => ({ w: new THREE.Vector3(...q.p).applyMatrix4(M), r: q.r, body: b.id })) }));
      st.chain = m.chain !== false;
      st.lockedBody = b.id;
    } else st.sets = [newSet(kind === "fillet" ? 2 : 1)];
    const cur = () => st.sets[Math.min(st.active, st.sets.length - 1)];
    const isF = () => st.kind === "fillet";
    let hover = null, arrowDrag = null;
    const count = (s) => (s.items.length ? s.items.length : s.keep ? s.keep.length : 0);
    const def = {
      title: (editing ? "Edit " : "") + (kind === "fillet" ? "Fillet" : "Chamfer"),
      valid: () => st.sets.some((s) => count(s) > 0) && st.sets.every((s) => !count(s) || (s.value > 0 && (s.rt !== "points" || s.pts.every((q) => q.r > 0)) && (s.rt !== "variable" || s.value2 > 0) && (isF() || s.ct !== "angle" || (s.ang > 0 && s.ang < 90)) && (isF() || s.ct !== "two" || s.value2 > 0))),
      canOk: () => def.valid(),
      apply(doc) {
        // sets per body: [{ edges, r, r2, rt }]
        const sigsOf = (s) => (s.items.length ? s.items.map((e) => ({ body: e.body, info: e.info })) : (s.keep || []).map((info) => ({ body: editing && editing.body, info })));
        const byBody = new Map();
        for (const s of st.sets) {
          const sigs = sigsOf(s);
          if (!sigs.length) continue;
          const per = new Map();
          for (const g of sigs) { if (!per.has(g.body)) per.set(g.body, []); per.get(g.body).push(g.info); }
          for (const [body, edges] of per) {
            if (!byBody.has(body)) byBody.set(body, []);
            // freeform: the radius points go with the body, in its own coordinates
            const local = (w) => { const bb = findBody(doc, body); return w.clone().applyMatrix4(M4(bb.m).invert()).toArray().map((v) => +v.toFixed(5)); };
            byBody.get(body).push({ edges, r: s.value, ...(isF() && s.rt === "points" ? { rt: "points", pts: s.pts.filter((q) => q.body === body).map((q) => ({ p: local(q.w), r: q.r })) } : isF() && s.rt === "variable" ? { r2: s.value2, rt: "variable" } : isF() && s.rt === "chord" ? { rt: "chord" } : !isF() && s.ct === "angle" ? { ct: "angle", ang: s.ang, ...(s.flip ? { flip: true } : {}) } : !isF() && s.ct === "two" ? { ct: "two", r2: s.value2, ...(s.flip ? { flip: true } : {}) } : {}) });
          }
        }
        const modOf = (sets) => {
          const m = { t: st.kind, edges: sets[0].edges, chain: st.chain ? undefined : false };
          if (st.kind === "fillet") m.r = sets[0].r; else m.d = sets[0].r;
          if (sets.length > 1 || sets[0].rt || sets[0].ct) m.sets = sets;
          return m;
        };
        if (editing) {
          const b = findBody(doc, editing.body);
          const i = b.node.mods.findIndex((x) => x.id === editing.mod);
          const sets = byBody.get(editing.body);
          if (i >= 0 && sets) { const old = b.node.mods[i]; b.node.mods[i] = { id: old.id, seq: old.seq, ...modOf(sets) }; }
          return;
        }
        const seq = nextSeq(doc);
        for (const [id, sets] of byBody) {
          const b = findBody(doc, id);
          b.node.mods = b.node.mods || [];
          b.node.mods.push({ id: uid("f"), seq, ...modOf(sets) });
        }
      },
      ok() { commit(def, isF() ? "Fillet" : "Chamfer"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      // a build error like "too large… about 4.8 mm" gets a button to use that size
      onBuildError(msg, box) {
        const m = /about ([\d.]+) mm/.exec(msg);
        if (!m || box.querySelector("button")) return;
        const v = +m[1];
        box.append(el("button", { class: "btn", style: { marginTop: "6px" }, onclick: () => { cur().value = v; if (cur().value2 > v && cur().rt === "variable") cur().value2 = v; refresh(); } }, `Use ${fmt(v, 2)} mm`));
      },
      typeInto: () => (count(cur()) ? def.valInput : null),
      hint: () => editing && !cur().items.length ? "Drag the arrow or type a size, or click edges to pick a new set." : count(cur()) ? "Drag the arrow or type a size. Click edges or faces to add them; click again to remove. + adds a set with its own size." : "Click edges, or a face to take all its edges. Click again to remove.",
      build(body) {
        body.append(row("Type", seg([["fillet", "Fillet"], ["chamfer", "Chamfer"]], st.kind, (v) => { st.kind = v; def.title = (editing ? "Edit " : "") + (v === "fillet" ? "Fillet" : "Chamfer"); refresh(); }, "ed-type")));
        // selection sets, like Fusion's list with + and ×
        const list = el("div", { class: "edge-sets" });
        st.sets.forEach((s, i) => {
          const n = count(s);
          const label = `${n ? n : "No"} edge${n === 1 ? "" : "s"}` + (n ? ` · ${s.rt === "points" && isF() && s.pts.length ? "freeform " + fmt(Math.min(...s.pts.map((q) => q.r)), 2) + "–" + fmt(Math.max(...s.pts.map((q) => q.r)), 2) : s.rt === "variable" && isF() ? fmt(s.value, 2) + "–" + fmt(s.value2, 2) : !isF() && s.ct === "two" ? fmt(s.value, 2) + " × " + fmt(s.value2, 2) : fmt(s.value, 2)} mm${s.rt === "chord" && isF() ? " chord" : ""}${!isF() && s.ct === "angle" ? " at " + fmt(s.ang, 1) + "°" : ""}` : "");
          const r = el("div", { class: "edge-set" + (i === st.active ? " on" : ""), onclick: () => { st.active = i; refresh(); } }, el("span", { class: "sw", style: { background: SET_COLORS[i % SET_COLORS.length] } }), el("span", { class: "nm" }, `Set ${i + 1}: `, el("b", {}, label)));
          if (st.sets.length > 1) r.append(el("button", { class: "x", title: "Remove this set", "aria-label": "Remove set " + (i + 1), onclick: (e) => { e.stopPropagation(); st.sets.splice(i, 1); st.active = Math.max(0, Math.min(st.active, st.sets.length - 1)); refresh(); } }, "×"));
          else if (n) r.append(el("button", { class: "x", title: "Clear the selection", "aria-label": "Clear", onclick: (e) => { e.stopPropagation(); s.items = []; s.keep = editing ? s.keep : null; if (!editing) s.keep = null; refresh(); } }, "×"));
          list.append(r);
        });
        list.append(el("button", { class: "btn add-set", id: "ed-addset", title: "Add a selection set with its own size", onclick: () => { st.sets.push(newSet(cur().value)); st.active = st.sets.length - 1; refresh(); } }, "+ Add set"));
        body.append(list);
        // every edge of one shape at once (handy in Beginner: round a whole box)
        if (!editing) body.append(el("button", { class: "btn", id: "ed-all", title: "Pick every edge of the selected shape (or the shape of the edges already picked)", onclick: () => allEdges() }, isF() ? "Round all edges of the shape" : "Chamfer all edges of the shape"));
        const s = cur();
        if (isF()) {
          // four kinds: a wide row of its own so none is squeezed out
          const rt = seg([["const", "Constant"], ["chord", "Chord"], ["variable", "Variable"], ["points", "Freeform"]], s.rt, (v) => { s.rt = v; if (v === "points") st.place = count(s) > 0; refresh(); }, "ed-rtype");
          rt.classList.add("seg-wide");
          body.append(el("div", { class: "subhead" }, "Radius type"), rt);
        }
        // a chamfer: the same distance both ways, a distance and an angle, or two distances
        if (!isF()) body.append(row("Chamfer type", seg([["equal", "Equal distance"], ["angle", "Distance and angle"], ["two", "Two distances"]], s.ct || "equal", (v) => { s.ct = v; refresh(); }, "ed-ctype")));
        const lab = !isF() ? (s.ct === "two" ? "Distance 1" : "Distance") : s.rt === "chord" ? "Chord length" : s.rt === "variable" ? "Start radius" : s.rt === "points" ? "New point radius" : "Radius";
        body.append(row(lab, (def.valInput = app.numField({ value: s.value, id: "ed-val", min: 0.001, step: 0.5, live: true, onCommit: (v) => { s.value = v; refresh(false); } })), "ed-val"));
        if (!isF() && s.ct === "angle") {
          body.append(row("Angle", app.numField({ value: s.ang ?? 45, id: "ed-ang", min: 1, max: 89, step: 1, live: true, angle: true, unit: "°", onCommit: (v) => { s.ang = Math.max(1, Math.min(89, v)); refresh(false); } }), "ed-ang"));
        }
        if (!isF() && s.ct === "two") body.append(row("Distance 2", app.numField({ value: s.value2, id: "ed-val2", min: 0.001, step: 0.5, live: true, onCommit: (v) => { s.value2 = v; refresh(false); } }), "ed-val2"));
        if (!isF() && s.ct !== "equal" && s.ct) {
          body.append(el("label", { class: "check", title: "Measure the distance on the other face at each edge" }, el("input", { type: "checkbox", id: "ed-flip", checked: !!s.flip, onchange: (e) => { s.flip = e.target.checked; refresh(false); } }), "Flip (measure from the other face)"));
          body.append(el("div", { class: "hint", style: { padding: 0 } }, s.ct === "angle" ? "The distance runs along the upper face at each edge (Flip for the other face); the angle is the slope of the cut from that face. 45° is the same as an equal chamfer." : "Distance 1 runs along the upper face at each edge, Distance 2 down the other face (Flip swaps them)."));
        }
        if (isF() && s.rt === "variable") body.append(row("End radius", app.numField({ value: s.value2, id: "ed-val2", min: 0.001, step: 0.5, live: true, onCommit: (v) => { s.value2 = v; refresh(false); } }), "ed-val2"));
        body.append(el("label", { class: "check", title: "Picking an edge also takes the edges that run smoothly on from it" }, el("input", { type: "checkbox", id: "ed-chain", checked: st.chain, onchange: (e) => { st.chain = e.target.checked; } }), "Tangent chain"));
        if (isF() && s.rt === "chord") body.append(el("div", { class: "hint", style: { padding: 0 } }, "Chord length is the straight distance across the rounded edge."));
        if (isF() && s.rt === "variable") body.append(el("div", { class: "hint", style: { padding: 0 } }, "The radius changes smoothly from start to end along each edge."));
        if (isF() && s.rt === "points") freeformPanel(body, s);
      },
      start() { refresh(); },
      handler: {
        wantsTouch: (e) => !!overArrow(e) || !!ffHit(e),
        move(e) {
          if (ffDrag) { ffMove(e); return; }
          if (!arrowDrag) return;
          const sv = arrowDrag.v0 + arrowDrag.f(e);
          const g = app.gridStep();
          const step = g >= 1 ? 0.5 : g > 0 ? g : 0.01;
          cur().value = Math.max(step, round(sv, step));
          def.valInput && def.valInput.setValue(cur().value);
          refresh(false);
        },
        up() { if (ffDrag) { ffDrag = null; refresh(); } if (arrowDrag) { arrowDrag = null; vp.canvas.style.cursor = "default"; } },
        hover(e) {
          if (arrowDrag || ffDrag) return;
          if (overArrow(e) || ffHit(e)) { vp.canvas.style.cursor = "grab"; return; }
          if (freeOn() && st.place && count(cur())) {
            const sn = ffSnap(e, cur());
            const k = sn ? "snap" : null;
            ffHover = sn;
            if (k || hover) { hover = null; draw(); }
            vp.canvas.style.cursor = sn ? "crosshair" : "default";
            return;
          }
          const h = pickTarget(e);
          const k = h ? h.key : null;
          if (k !== (hover && hover.key)) { hover = h; draw(); }
          vp.canvas.style.cursor = h ? "pointer" : "default";
        },
        leave() { if (hover) { hover = null; draw(); } },
        down(e) {
          if (freeOn() && ffDown(e)) return true;
          const a = overArrow(e);
          if (a) { arrowDrag = { ...a, f: axisDragger(e, a.origin, a.n), v0: cur().value }; vp.canvas.style.cursor = "grabbing"; return true; }
          const h = pickTarget(e);
          if (!h) return true;
          const s = cur();
          if (editing && !s.items.length) s.keep = null; // clicking edges picks a new set of edges
          const has = (ei) => s.items.findIndex((x) => x.body === h.body && x.edge === ei);
          // a click on something already picked removes it (all of it, for a face or chain)
          if (h.edges.every((ei) => has(ei) >= 0)) s.items = s.items.filter((x) => !(x.body === h.body && h.edges.includes(x.edge)));
          else {
            // an edge belongs to one set only
            for (const o of st.sets) if (o !== s) o.items = o.items.filter((x) => !(x.body === h.body && h.edges.includes(x.edge)));
            for (const ei of h.edges) if (has(ei) < 0) s.items.push({ body: h.body, edge: ei, info: h.base.data.edgeInfo[ei], pts: edgeWorldPts(h.base, ei) });
          }
          refresh();
          return true;
        },
      },
    };
    function allEdges() {
      const usable = (b) => b && !b.hole && !b.locked && !b.hidden;
      const s = cur();
      let id = st.lockedBody || (s.items[0] && s.items[0].body) || app.sel.find((x) => usable(findBody(store.doc, x)));
      if (!id) { const all = store.doc.bodies.filter(usable); if (all.length === 1) id = all[0].id; }
      const base = id && baseOf(id);
      if (!base) { app.toast("Click a shape first (or one of its edges), then use this button."); return; }
      for (const o of st.sets) if (o !== s) o.items = o.items.filter((x) => x.body !== id);
      s.items = s.items.filter((x) => x.body !== id);
      base.data.edgeGroups.forEach(([, c], ei) => { if (c > 0) s.items.push({ body: id, edge: ei, info: base.data.edgeInfo[ei], pts: edgeWorldPts(base, ei) }); });
      refresh();
    }
    // ---- Freeform fillet: radius points placed anywhere along the picked edges. Each point has
    // its own radius; the engine blends smoothly between them along the whole tangent contour.
    let ffDrag = null, ffHover = null;
    function freeOn() { return isF() && cur().rt === "points"; }
    function ffLines(s) {
      if (s.items.length) return s.items.map((x) => ({ body: x.body, pts: x.pts }));
      if (editing && s.keep) {
        const b = findBody(store.doc, editing.body), M = M4(b.m);
        return s.keep.map((g) => ({ body: b.id, pts: [g.a, g.m, g.b].map((v) => new THREE.Vector3(...v).applyMatrix4(M)) }));
      }
      return [];
    }
    // the nearest point on the picked edges to a 3D point, with the edge's direction there
    function ffNearest(s, w) {
      let best = null, bd = Infinity;
      for (const ln of ffLines(s)) for (let k = 1; k < ln.pts.length; k++) {
        const a = ln.pts[k - 1], b = ln.pts[k], ab = b.clone().sub(a), l2 = ab.lengthSq() || 1e-12;
        const t = Math.max(0, Math.min(1, w.clone().sub(a).dot(ab) / l2));
        const q = a.clone().addScaledVector(ab, t), d = q.distanceToSquared(w);
        if (d < bd) { bd = d; best = { w: q, tan: ab.normalize(), body: ln.body }; }
      }
      return best;
    }
    // the point on the picked edges under the pointer (on screen, within a few pixels)
    function ffSnap(e, s) {
      const [mx, my] = vp.local(e);
      const tol = vp.tol(12);
      let best = null, bd = tol;
      for (const ln of ffLines(s)) for (let k = 1; k < ln.pts.length; k++) {
        const a = ln.pts[k - 1], b = ln.pts[k];
        const pa = vp.project(a), pb = vp.project(b);
        const dx = pb[0] - pa[0], dy = pb[1] - pa[1], l2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((mx - pa[0]) * dx + (my - pa[1]) * dy) / l2));
        const d = Math.hypot(pa[0] + dx * t - mx, pa[1] + dy * t - my);
        if (d < bd) { bd = d; best = { w: a.clone().lerp(b, t), tan: b.clone().sub(a).normalize(), body: ln.body }; }
      }
      return best;
    }
    // which way a point's radius "whisker" points: across the edge as seen on screen (so it is
    // never foreshortened), on the body's side
    function ffAnchor(q) {
      const near = ffNearest(cur(), q.w);
      const t = near ? near.tan : new THREE.Vector3(1, 0, 0);
      const b = findBody(store.doc, q.body);
      const box = b && scene.boxWithMatrix(q.body, M4(b.m));
      const inward = box ? box.getCenter(new THREE.Vector3()).sub(q.w) : new THREE.Vector3(0, 0, -1);
      const view = new THREE.Vector3();
      vp.camera.getWorldDirection(view);
      let n = t.clone().cross(view);
      if (n.lengthSq() < 1e-10) { n = inward.clone().sub(t.clone().multiplyScalar(inward.dot(t))); if (n.lengthSq() < 1e-12) n.set(0, 0, -1); }
      n.normalize();
      if (n.dot(inward) < 0) n.negate();
      return { n, t };
    }
    function ffHit(e) {
      if (!freeOn()) return null;
      const s = cur();
      const [mx, my] = vp.local(e);
      let best = null, bd = vp.tol(12);
      s.pts.forEach((q, i) => {
        const tip = q.w.clone().addScaledVector(ffAnchor(q).n, q.r);
        const pt = vp.project(tip), pd = vp.project(q.w);
        const dt = Math.hypot(pt[0] - mx, pt[1] - my), dd = Math.hypot(pd[0] - mx, pd[1] - my);
        if (dt < bd) { bd = dt; best = { i, part: "tip" }; }
        if (dd < bd) { bd = dd; best = { i, part: "dot" }; }
      });
      return best;
    }
    function ffDown(e) {
      const s = cur();
      const h = ffHit(e);
      if (h) {
        s.sel = h.i;
        const q = s.pts[h.i];
        ffDrag = h.part === "tip" ? { mode: "r", i: h.i, f: axisDragger(e, q.w, ffAnchor(q).n), v0: q.r } : { mode: "move", i: h.i };
        vp.canvas.style.cursor = "grabbing";
        refresh();
        return true;
      }
      if (st.place && count(s)) {
        const sn = ffSnap(e, s);
        if (sn) {
          s.pts.push({ w: sn.w, r: s.value, body: sn.body });
          s.sel = s.pts.length - 1;
          ffDrag = { mode: "move", i: s.sel };
          refresh();
          return true;
        }
        return true; // in point mode a click away from the edges does nothing
      }
      return false;
    }
    function ffMove(e) {
      const s = cur(), q = s.pts[ffDrag.i];
      if (!q) return;
      if (ffDrag.mode === "r") {
        const g = app.gridStep();
        const step = g >= 1 ? 0.1 : g > 0 ? Math.min(0.1, g) : 0.01;
        q.r = Math.max(0.05, round(ffDrag.v0 + ffDrag.f(e), step));
        const inp = panel.querySelector(`[data-ffi="${ffDrag.i}"] input`);
        if (inp) inp.value = fmt(q.r, 2);
      } else {
        const sn = ffSnap(e, s);
        if (sn) { q.w = sn.w; q.body = sn.body; }
      }
      draw();
      schedulePreview(def);
    }
    // radius points spread evenly along everything picked: the ends and the middle (or n)
    function ffSpread(s, n = 3) {
      const lines = ffLines(s);
      if (!lines.length) return;
      // the picked edges joined end to end where they meet, longest run first
      const runs = lines.map((l) => l.pts.slice());
      let path = runs.shift();
      const body = lines[0].body;
      for (let guard = 0; runs.length && guard < 400; guard++) {
        const end = path[path.length - 1], st0 = path[0];
        const k = runs.findIndex((r) => r[0].distanceTo(end) < 1e-3 || r[r.length - 1].distanceTo(end) < 1e-3 || r[0].distanceTo(st0) < 1e-3 || r[r.length - 1].distanceTo(st0) < 1e-3);
        if (k < 0) break;
        let r = runs.splice(k, 1)[0];
        if (r[0].distanceTo(end) < 1e-3) path = path.concat(r.slice(1));
        else if (r[r.length - 1].distanceTo(end) < 1e-3) path = path.concat(r.reverse().slice(1));
        else if (r[r.length - 1].distanceTo(st0) < 1e-3) path = r.concat(path.slice(1));
        else path = r.reverse().concat(path.slice(1));
      }
      const acc = [0];
      for (let i = 1; i < path.length; i++) acc.push(acc[i - 1] + path[i].distanceTo(path[i - 1]));
      const L = acc[acc.length - 1];
      if (L <= 0) return;
      const closed = path[0].distanceTo(path[path.length - 1]) < 1e-3;
      const at = (d) => { let i = 1; while (i < acc.length - 1 && acc[i] < d) i++; const seg = acc[i] - acc[i - 1] || 1; return path[i - 1].clone().lerp(path[i], (d - acc[i - 1]) / seg); };
      s.pts = [];
      const m = closed ? n : n - 1;
      for (let i = 0; i < n; i++) s.pts.push({ w: at((L * i) / m), r: s.value, body });
      s.sel = 0;
    }
    function freeformPanel(body, s) {
      body.append(row("Clicks", seg([["edges", "Pick edges"], ["points", "Add radius points"]], st.place ? "points" : "edges", (v) => { st.place = v === "points"; refresh(); }, "ed-ffmode")));
      const box = el("div", { class: "ff-pts", id: "ed-ffpts" });
      s.pts.forEach((q, i) => {
        const r = el("div", { class: "ff-pt" + (i === s.sel ? " on" : ""), "data-ffi": String(i), onclick: () => { s.sel = i; draw(); panel.querySelectorAll(".ff-pt").forEach((x, j) => x.classList.toggle("on", j === i)); } },
          el("span", { class: "nm" }, `Point ${i + 1}`),
          app.numField({ value: q.r, id: "ed-ffr" + i, min: 0.05, step: 0.5, live: true, onCommit: (v) => { q.r = Math.max(0.05, v); refresh(false); } }),
          el("button", { class: "x", title: "Remove this point", "aria-label": "Remove point " + (i + 1), onclick: (e) => { e.stopPropagation(); s.pts.splice(i, 1); s.sel = Math.min(s.sel, s.pts.length - 1); refresh(); } }, "×"));
        box.append(r);
      });
      if (!s.pts.length) box.append(el("div", { class: "hint", style: { padding: 0 } }, count(s) ? "No radius points yet: the whole edge uses the New point radius. Choose Add radius points and click along the edge, or use Spread points." : "Pick the edges first (one edge, a tangent chain or a face's edges)."));
      body.append(box);
      const btns = el("div", { class: "row-btns", style: { display: "flex", gap: "6px", flexWrap: "wrap" } });
      btns.append(el("button", { class: "btn", id: "ed-ffspread", disabled: !count(s), title: "Put radius points at the start, middle and end of the picked edges", onclick: () => { ffSpread(s, 3); st.place = true; refresh(); } }, "Spread 3 points"));
      btns.append(el("button", { class: "btn", id: "ed-ffspread5", disabled: !count(s), title: "Put five evenly spaced radius points along the picked edges", onclick: () => { ffSpread(s, 5); st.place = true; refresh(); } }, "Spread 5"));
      if (s.pts.length) btns.append(el("button", { class: "btn", id: "ed-ffclear", onclick: () => { s.pts = []; s.sel = -1; refresh(); } }, "Clear points"));
      body.append(btns);
      body.append(el("div", { class: "hint", style: { padding: 0 } }, "Freeform: click along the picked edges to drop radius points, drag a dot to slide it along the edge, drag its blue tip (or type) to set the radius there. The fillet blends smoothly from point to point, round corners and along tangent chains."));
    }
    function ffDraw() {
      const s = cur();
      const color = SET_COLOR_HEX[st.active % SET_COLOR_HEX.length];
      for (const [i, q] of s.pts.entries()) {
        const an = ffAnchor(q);
        const tip = q.w.clone().addScaledVector(an.n, q.r);
        drawLine([q.w, tip], i === s.sel ? 0xe8a317 : 0x1f4fa8);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: i === s.sel ? 0xe8a317 : color, depthTest: false, transparent: true }));
        dot.scale.setScalar(vp.pixelSize(q.w) * 5.5);
        dot.position.copy(q.w);
        dot.renderOrder = 16;
        ov.add(dot);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 16), new THREE.MeshBasicMaterial({ color: i === s.sel ? 0xe8a317 : 0x1f4fa8, depthTest: false, transparent: true }));
        cone.scale.setScalar(vp.pixelSize(tip) * 5);
        cone.position.copy(tip);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), an.n);
        cone.renderOrder = 16;
        ov.add(cone);
      }
      if (ffHover && st.place) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe8a317, depthTest: false, transparent: true, opacity: 0.7 }));
        dot.scale.setScalar(vp.pixelSize(ffHover.w) * 4.5);
        dot.position.copy(ffHover.w);
        dot.renderOrder = 16;
        ov.add(dot);
      }
    }
    // an edge (plus its tangent chain) or, away from edges, a whole face's edges
    function pickTarget(e) {
      const filter = (b) => !b.hole && !b.locked && (!st.lockedBody || b.id === st.lockedBody);
      const eh = pickBaseEdge(e, filter);
      if (eh) {
        const edges = st.chain ? tangentChainEdges(eh.base, eh.edge) : [eh.edge];
        return { key: eh.body + ":e" + eh.edge, body: eh.body, base: eh.base, edges, face: null };
      }
      const fh = pickBaseFace(e, filter);
      const fe = fh && fh.base.data.faceEdges && fh.base.data.faceEdges[fh.face];
      if (fe && fe.length) return { key: fh.body + ":f" + fh.face, body: fh.body, base: fh.base, edges: fe.slice(), face: fh.face };
      return null;
    }
    // where the drag arrow sits: the middle of the active set's first edge, pointing into the body
    function arrowAnchor() {
      const s = cur();
      let pts, bodyId;
      if (s.items.length) { pts = s.items[0].pts; bodyId = s.items[0].body; }
      else if (editing && s.keep && s.keep[0]) {
        const b = findBody(store.doc, editing.body);
        const sig = s.keep[0];
        const M = M4(b.m);
        pts = [new THREE.Vector3(...sig.a).applyMatrix4(M), new THREE.Vector3(...sig.m).applyMatrix4(M), new THREE.Vector3(...sig.b).applyMatrix4(M)];
        bodyId = b.id;
      } else return null;
      let total = 0;
      for (let k = 1; k < pts.length; k++) total += pts[k].distanceTo(pts[k - 1]);
      let acc = 0, mid = pts[0].clone(), t = new THREE.Vector3(1, 0, 0);
      for (let k = 1; k < pts.length; k++) {
        const seg = pts[k].distanceTo(pts[k - 1]);
        if (acc + seg >= total / 2 && seg > 0) { mid = pts[k - 1].clone().lerp(pts[k], (total / 2 - acc) / seg); t = pts[k].clone().sub(pts[k - 1]).normalize(); break; }
        acc += seg;
      }
      const b = findBody(store.doc, bodyId);
      const box = b && scene.boxWithMatrix(bodyId, M4(b.m));
      if (!box) return null;
      const n = box.getCenter(new THREE.Vector3()).sub(mid);
      n.sub(t.clone().multiplyScalar(n.dot(t)));
      if (n.lengthSq() < 1e-12) return null;
      n.normalize();
      return { origin: mid, n };
    }
    function overArrow(e) {
      const a = def.arrow;
      if (!a) return null;
      const [mx, my] = vp.local(e);
      const s = vp.project(a.tip);
      return Math.hypot(s[0] - mx, s[1] - my) < vp.tol(14) ? a : null;
    }
    function thick(ptsList, color, w) {
      const seg = [];
      for (const pts of ptsList) for (let k = 0; k < pts.length - 1; k++) seg.push(pts[k].x, pts[k].y, pts[k].z, pts[k + 1].x, pts[k + 1].y, pts[k + 1].z);
      if (!seg.length) return;
      const o = thickLines(seg, color, w, false);
      o.renderOrder = 15;
      ov.add(o);
    }
    function draw() {
      clearOv();
      st.sets.forEach((s, i) => thick(s.items.map((e) => e.pts), SET_COLOR_HEX[i % SET_COLOR_HEX.length], i === st.active ? 4 : 3));
      if (hover) thick(hover.edges.map((ei) => edgeWorldPts(hover.base, ei)), 0xe8a317, 4);
      def.arrow = null;
      if (freeOn()) { ffDraw(); return; }
      const an = arrowAnchor();
      if (an) {
        const tip = an.origin.clone().addScaledVector(an.n, cur().value);
        drawLine([an.origin, tip], 0x1f4fa8);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 16), new THREE.MeshBasicMaterial({ color: 0x1f4fa8, depthTest: false, transparent: true }));
        cone.scale.setScalar(vp.pixelSize(tip) * 6);
        cone.position.copy(tip);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), an.n);
        cone.renderOrder = 14;
        ov.add(cone);
        def.arrow = { origin: an.origin, n: an.n, tip };
      }
    }
    function refresh(rerender = true) {
      if (rerender) def.render();
      else {
        // keep the active set's size label in step while typing or dragging
        const s = cur(), n = count(s), b = panel.querySelector(".edge-set.on .nm b");
        if (b && n) b.textContent = `${n} edge${n === 1 ? "" : "s"} · ${s.rt === "variable" && isF() ? fmt(s.value, 2) + "–" + fmt(s.value2, 2) : fmt(s.value, 2)} mm${s.rt === "chord" && isF() ? " chord" : ""}`;
      }
      draw();
      schedulePreview(def);
    }
    openCmd(def);
  }
  // ---------------------------------------------------------------- Freehand Router
  // Draw on any face of a body, flat or curved, from any side, with a finger, a pen or the mouse,
  // and the bit routes a groove along the stroke. Ball, flat or V bit; the depth can be the same
  // all along, follow a pen's pressure, or taper from one depth to another. SMART tidies each
  // stroke: it evens out the wobble of a hand, and (on a flat face) turns a nearly straight
  // stroke into a straight line, a round one into a true circle and a rough box into a rectangle.
  function routerCmd(editing = null) {
    let saved = {}; try { saved = JSON.parse(localStorage.getItem("jumpstart3d.router") || "{}") || {}; } catch (e) {}
    const st = { bit: saved.bit || "ball", w: saved.w || 3, depth: saved.depth || 1.5, depth2: saved.depth2 || 0.3, ang: saved.ang || 30, mode: saved.mode || "const", smart: saved.smart !== false, smooth: saved.smooth ?? 0.5, strokes: [], body: null };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      Object.assign(st, { bit: m.bit || "ball", w: m.w || 3, depth: m.depth || 1.5, ang: m.ang || 30, body: b.id });
      st.strokes = (m.strokes || []).map((x) => ({ body: b.id, p: x.p, n: x.n, d: x.d }));
      st.depth0 = st.depth;
    }
    const save = () => { try { localStorage.setItem("jumpstart3d.router", JSON.stringify({ bit: st.bit, w: st.w, depth: st.depth, depth2: st.depth2, ang: st.ang, mode: st.mode, smart: st.smart, smooth: st.smooth })); } catch (e) {} };
    let live = null; // the stroke being drawn: { body, base, samples: [{ w, nW, sx, sy, pr }], plane }
    let hoverPt = null;
    const pickable = (b) => !b.hole && !b.locked && !b.cmdPreview && (!st.body || b.id === st.body);
    const def = {
      title: (editing ? "Edit " : "") + "Freehand Router",
      valid: () => st.strokes.length > 0 && st.w > 0 && st.depth > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const byBody = new Map();
        // editing: a new depth scales every stroke's depths (each keeps its own shape of depth)
        const k = editing && st.depth0 ? st.depth / st.depth0 : 1;
        for (const s of st.strokes) {
          if (!byBody.has(s.body)) byBody.set(s.body, []);
          byBody.get(s.body).push({ p: s.p, n: s.n, d: s.d.map((v) => +(v * k).toFixed(4)) });
        }
        const modOf = (strokes) => ({ t: "route", bit: st.bit, w: st.w, depth: st.depth, ...(st.bit === "v" ? { ang: st.ang } : {}), strokes });
        if (editing) {
          const b = findBody(doc, editing.body);
          const i = b.node.mods.findIndex((x) => x.id === editing.mod);
          if (i >= 0) { const old = b.node.mods[i]; b.node.mods[i] = { id: old.id, seq: old.seq, ...modOf(byBody.get(b.id) || []) }; }
          return;
        }
        const seq = nextSeq(doc);
        for (const [id, strokes] of byBody) {
          const b = findBody(doc, id);
          if (!b) continue;
          b.node.mods = b.node.mods || [];
          b.node.mods.push({ id: uid("rt"), seq, ...modOf(strokes) });
        }
      },
      ok() { save(); commit(def, "Freehand Router"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => !st.strokes.length ? (vp.touchMode ? "Draw on a face with your finger or pen. Two fingers turn and zoom the view between strokes." : "Drag across a face to route a groove. Right-drag (or Option-drag) turns the view between strokes, from any side.") : `${st.strokes.length} stroke${st.strokes.length === 1 ? "" : "s"}. Keep drawing, Undo stroke, or OK to cut.`,
      build(body) {
        const bt = seg([["ball", "Ball (round)"], ["flat", "Flat"], ["v", "V / Scalpel"]], st.bit, (v) => { st.bit = v; if (v === "v" && st.w > 1.5) st.w = 0.6; refresh(); }, "rt-bit");
        bt.classList.add("seg-wide");
        body.append(el("div", { class: "subhead" }, "Bit"), bt);
        body.append(row(st.bit === "v" ? "Tip width" : "Bit width", app.numField({ value: st.w, id: "rt-w", min: 0.1, step: 0.5, live: true, onCommit: (v) => { st.w = Math.max(0.1, v); refresh(false); } }), "rt-w"));
        if (st.bit === "v") body.append(row("V angle", app.numField({ value: st.ang * 2, id: "rt-ang", min: 10, max: 150, step: 5, angle: true, unit: "°", live: true, onCommit: (v) => { st.ang = Math.max(5, Math.min(75, v / 2)); refresh(false); } }), "rt-ang"));
        if (!editing) {
          const dm = seg([["const", "Same depth"], ["pressure", "Pen pressure"], ["taper", "Taper"]], st.mode, (v) => { st.mode = v; refresh(); }, "rt-dmode");
          dm.classList.add("seg-wide");
          body.append(el("div", { class: "subhead" }, "Depth"), dm);
        }
        body.append(row(st.mode === "taper" && !editing ? "Start depth" : st.mode === "pressure" && !editing ? "Deepest" : "Depth", app.numField({ value: st.depth, id: "rt-depth", min: 0.05, step: 0.5, live: true, onCommit: (v) => { st.depth = Math.max(0.05, v); if (!editing) restamp(); refresh(false); } }), "rt-depth"));
        if (st.mode === "taper" && !editing) body.append(row("End depth", app.numField({ value: st.depth2, id: "rt-depth2", min: 0.05, step: 0.5, live: true, onCommit: (v) => { st.depth2 = Math.max(0.05, v); restamp(); refresh(false); } }), "rt-depth2"));
        if (st.mode === "pressure" && !editing) body.append(el("div", { class: "hint", style: { padding: 0 } }, "Press harder to cut deeper (Apple Pencil, Surface Pen, Wacom). A mouse or finger cuts at half the depth."));
        if (editing) body.append(el("div", { class: "hint", style: { padding: 0 } }, "A new depth scales every stroke, keeping any taper or pressure changes along it."));
        body.append(el("label", { class: "check", title: "SMART: even out the wobble of your hand; on a flat face a nearly straight stroke becomes a straight line, a round one a circle, a rough box a rectangle" }, el("input", { type: "checkbox", id: "rt-smart", checked: st.smart, onchange: (e) => { st.smart = e.target.checked; refresh(false); } }), el("b", {}, "SMART"), " clean-up: smooth strokes, true lines, circles and rectangles"));
        const sm = seg([["0.15", "Light"], ["0.5", "Medium"], ["0.9", "Strong"]], String(st.smooth), (v) => { st.smooth = +v; refresh(false); }, "rt-smooth");
        body.append(row("Smoothing", sm));
        const btns = el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" } });
        btns.append(el("button", { class: "btn", id: "rt-undo", disabled: !st.strokes.length, onclick: () => { st.strokes.pop(); if (!st.strokes.length && !editing) st.body = null; refresh(); } }, "Undo stroke"));
        btns.append(el("button", { class: "btn", id: "rt-clear", disabled: !st.strokes.length, onclick: () => { st.strokes = []; if (!editing) st.body = null; refresh(); } }, "Clear all"));
        body.append(btns);
        body.append(el("div", { class: "hint", style: { padding: 0 } }, `${st.strokes.length} stroke${st.strokes.length === 1 ? "" : "s"}` + (st.body ? ` on ${findBody(store.doc, st.body)?.name || "the body"}` : "") + ". Turn the view between strokes to work on any side."));
      },
      start() { refresh(); },
      handler: {
        wantsTouch: (e) => !!pickBaseFace(e, pickable),
        down(e) {
          const h = pickBaseFace(e, pickable);
          if (!h) return false;
          const base = h.base;
          live = { body: h.body, base, inv: base.m.clone().invert(), samples: [], plane: h.info && h.info.t === "PLANE" ? { n: h.normal.clone().normalize(), o: h.point.clone(), face: h.face } : null, flat: true };
          addSample(e, h);
          drawOv();
          return true;
        },
        move(e) {
          if (!live) return;
          const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
          for (const ev of evs.length ? evs : [e]) {
            const h = pickBaseFace(ev, (b) => b.id === live.body);
            if (h) addSample(ev, h);
          }
          drawOv();
        },
        up() {
          if (!live) return;
          const L = live;
          live = null;
          finishStroke(L);
          refresh();
        },
        hover(e) {
          if (live) return;
          const h = pickBaseFace(e, pickable);
          hoverPt = h ? { p: h.point, n: h.normal } : null;
          vp.canvas.style.cursor = h ? "crosshair" : "default";
          drawOv();
        },
        leave() { hoverPt = null; drawOv(); },
        cancel() { live = null; drawOv(); },
      },
    };
    function addSample(e, h) {
      const last = live.samples[live.samples.length - 1];
      const step = Math.max(0.05, Math.min(0.5, st.w * 0.2));
      if (last && last.w.distanceTo(h.point) < step) return;
      const pr = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
      const [sx, sy] = vp.local(e);
      live.samples.push({ w: h.point.clone(), nW: h.normal.clone().normalize(), sx, sy, pr, face: h.face });
      if (live.plane && (!h.info || h.info.t !== "PLANE" || h.normal.dot(live.plane.n) < 0.9999)) live.flat = false;
    }
    // depths along a stroke, by how far along it each point is
    function depthsFor(fr, prs) {
      if (st.mode === "taper") return fr.map((t) => st.depth + (st.depth2 - st.depth) * t);
      if (st.mode === "pressure") return prs.map((p) => st.depth * Math.max(0.1, Math.min(1, p)));
      return fr.map(() => st.depth);
    }
    // the depth settings changed: strokes drawn so far follow (each keeps its pen pressure)
    function restamp() {
      for (const s of st.strokes) if (s.fr) s.d = depthsFor(s.fr, s.pr).map((v) => +v.toFixed(4));
    }
    function finishStroke(L) {
      const S = L.samples;
      if (!S.length) return;
      const step = Math.max(0.1, Math.min(1, st.w * 0.35));
      let W = [], N = [], PR = [];
      const prAt = (f) => { // pressure at a fraction along the raw stroke
        if (S.length === 1) return S[0].pr;
        const x = f * (S.length - 1), i = Math.min(S.length - 2, Math.floor(x));
        return S[i].pr + (S[i + 1].pr - S[i].pr) * (x - i);
      };
      if (S.length === 1) { W = [S[0].w]; N = [S[0].nW]; PR = [S[0].pr]; }
      else if (L.plane && L.flat) {
        // a flat face: tidy the stroke in the face's own plane, so circles stay round
        const n = L.plane.n, o = L.plane.o;
        const u = new THREE.Vector3().crossVectors(Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), n).normalize();
        const v = new THREE.Vector3().crossVectors(n, u);
        const to2 = (w) => { const d = w.clone().sub(o); return [d.dot(u), d.dot(v)]; };
        const raw = S.map((q) => to2(q.w));
        const out = tidy2D(raw);
        const base = L.base;
        for (const q of out.pts) {
          const w = o.clone().addScaledVector(u, q[0]).addScaledVector(v, q[1]);
          // keep only the parts that stay on the body
          if (!onBody(base, w, n)) continue;
          W.push(w); N.push(n.clone());
        }
        const fr = out.fr;
        PR = out.pts.map((_, i) => prAt(fr[i]));
      } else {
        // a curved face: tidy on the screen, then put each point back on the surface
        const raw = S.map((q) => [q.sx, q.sy]);
        const out = tidy2D(raw, true);
        const r = vp.canvas.getBoundingClientRect();
        out.pts.forEach((q, i) => {
          const h = pickBaseFace({ clientX: r.left + q[0], clientY: r.top + q[1] }, (b) => b.id === L.body);
          if (!h) return;
          W.push(h.point.clone()); N.push(h.normal.clone().normalize()); PR.push(prAt(out.fr[i]));
        });
        // the mesh's flat facets: even out the normals along the stroke
        for (let pass = 0; pass < 2; pass++) N = N.map((nn, i) => nn.clone().add(N[Math.max(0, i - 1)]).add(N[Math.min(N.length - 1, i + 1)]).normalize());
        // and thin the points to about the bit's step
        const keep = [0];
        for (let i = 1; i < W.length; i++) if (W[i].distanceTo(W[keep[keep.length - 1]]) >= step || i === W.length - 1) keep.push(i);
        W = keep.map((i) => W[i]); N = keep.map((i) => N[i]); PR = keep.map((i) => PR[i]);
      }
      if (!W.length) return;
      // fractions along the stroke, for taper
      const acc = [0];
      for (let i = 1; i < W.length; i++) acc.push(acc[i - 1] + W[i].distanceTo(W[i - 1]));
      const tot = acc[acc.length - 1] || 1;
      const fr = acc.map((a) => a / tot);
      const inv = L.inv;
      const nInv = new THREE.Matrix3().getNormalMatrix(inv);
      const p = W.map((w) => w.clone().applyMatrix4(inv).toArray().map((x) => +x.toFixed(4)));
      const nl = N.map((nn) => nn.clone().applyMatrix3(nInv).normalize().toArray().map((x) => +x.toFixed(5)));
      const d = depthsFor(fr, PR).map((x) => +x.toFixed(4));
      st.body = L.body;
      st.strokes.push({ body: L.body, p, n: nl, d, fr, pr: PR, world: W });
    }
    // SMART clean-up of a stroke in 2D; returns evenly spaced points (and their fractions along)
    function tidy2D(raw, screen = false) {
      const L = strokeLength(raw);
      const size = (() => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const p of raw) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); } return Math.max(b - a, d - c); })();
      const step = screen ? 3 : Math.max(0.1, Math.min(1, st.w * 0.35));
      let poly;
      const shape = recognizeStroke(raw, { smart: st.smart, smooth: st.smart ? st.smooth : Math.min(0.15, st.smooth), tol: screen ? 18 : size * 0.08 });
      if (!shape) poly = raw;
      else if (shape.kind === "line") poly = [shape.a, shape.b];
      else if (shape.kind === "circle") { poly = []; for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; poly.push([shape.c[0] + shape.r * Math.cos(a), shape.c[1] + shape.r * Math.sin(a)]); } }
      else if (shape.kind === "rect") { const [a, b] = [shape.a, shape.b]; poly = [a, [b[0], a[1]], b, [a[0], b[1]], a]; }
      else if (shape.kind === "poly") poly = shape.pts;
      else { const c = makeSplineCurve(shape.pts, shape.closed); poly = c && c.poly ? c.poly : shape.pts; if (shape.closed && poly.length && d2(poly[0], poly[poly.length - 1]) > 1e-9) poly = [...poly, poly[0]]; }
      // straight sides keep their corners: resample each side on its own
      let pts = [];
      if (shape && (shape.kind === "rect" || shape.kind === "poly" || shape.kind === "line")) {
        for (let i = 1; i < poly.length; i++) { const seg = resampleStroke([poly[i - 1], poly[i]], step); pts.push(...(i > 1 ? seg.slice(1) : seg)); }
      } else pts = resampleStroke(poly, step);
      if (pts.length < 1) pts = raw.slice(0, 1);
      const acc = [0];
      for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const tot = acc[acc.length - 1] || 1;
      return { pts, fr: acc.map((a) => a / tot), kind: shape && shape.kind, L };
    }
    // is this point on the flat face's plane still over the body (not off its edge)?
    function onBody(base, w, n) {
      const rc = new THREE.Raycaster(w.clone().addScaledVector(n, 0.5), n.clone().negate(), 0, 1.2);
      return rc.intersectObject(pickMesh(base), false).length > 0;
    }
    function drawOv() {
      clearOv();
      const col = 0xd9480f;
      for (const s of st.strokes) {
        const W = s.world || (() => { const b = findBody(store.doc, s.body); const M = M4(b.m); return s.p.map((q) => new THREE.Vector3(...q).applyMatrix4(M)); })();
        s.world = W;
        if (W.length === 1) { dot(W[0], col); continue; }
        const seg = [];
        for (let i = 1; i < W.length; i++) seg.push(W[i - 1].x, W[i - 1].y, W[i - 1].z, W[i].x, W[i].y, W[i].z);
        const o = thickLines(seg, col, 3, false); o.renderOrder = 15; ov.add(o);
      }
      if (live && live.samples.length) {
        const W = live.samples.map((q) => q.w);
        if (W.length === 1) dot(W[0], 0x1f4fa8);
        else { const seg = []; for (let i = 1; i < W.length; i++) seg.push(W[i - 1].x, W[i - 1].y, W[i - 1].z, W[i].x, W[i].y, W[i].z); const o = thickLines(seg, 0x1f4fa8, 4, false); o.renderOrder = 16; ov.add(o); }
      }
      if (hoverPt && !live) {
        // the bit's size where it would land
        const n = hoverPt.n.clone().normalize();
        const u = new THREE.Vector3().crossVectors(Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), n).normalize();
        const v = new THREE.Vector3().crossVectors(n, u);
        const r = st.bit === "v" ? Math.max(st.w / 2, st.depth * Math.tan((st.ang * Math.PI) / 180)) : st.w / 2;
        const ring = [];
        for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; ring.push(hoverPt.p.clone().addScaledVector(u, r * Math.cos(a)).addScaledVector(v, r * Math.sin(a))); }
        drawLine(ring, 0x1f4fa8);
      }
      vp.request();
    }
    function dot(w, color) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }));
      m.scale.setScalar(Math.max(st.w / 2, vp.pixelSize(w) * 3));
      m.position.copy(w); m.renderOrder = 15; ov.add(m);
    }
    function refresh(rerender = true) {
      if (rerender) def.render();
      drawOv();
      schedulePreview(def);
    }
    openCmd(def);
  }
  const SET_COLORS = ["#1f6fff", "#2f8a4c", "#8a5cd0", "#d9480f", "#0e9aa7"];
  const SET_COLOR_HEX = SET_COLORS.map((c) => parseInt(c.slice(1), 16));
  // edges that run on smoothly (tangent) from edge ei, through shared end points
  function tangentChainEdges(base, ei) {
    const groups = base.data.edgeGroups, L = base.data.lines;
    const P = (i) => [L[i * 3], L[i * 3 + 1], L[i * 3 + 2]];
    const ends = groups.map(([s, c]) => {
      const a = P(s), b = P(s + c - 1), a2 = P(Math.min(s + 1, s + c - 1)), b2 = P(Math.max(s, s + c - 2));
      const dir = (p, q) => { const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], l = Math.hypot(...d) || 1; return d.map((x) => x / l); };
      return { a, b, ta: dir(a, a2), tb: dir(b, b2), closed: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6 };
    });
    let size = 0;
    for (const e of ends) size = Math.max(size, Math.abs(e.a[0]), Math.abs(e.a[1]), Math.abs(e.a[2]));
    const tol = Math.max(1e-4, size * 1e-5);
    const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < tol;
    const out = new Set([ei]);
    const queue = [ei];
    while (queue.length) {
      const i = queue.pop();
      const E = ends[i];
      if (E.closed) continue;
      for (const [p, t] of [[E.a, E.ta], [E.b, E.tb]]) {
        // t points into edge i from p; a smooth continuation leaves p the opposite way
        const meet = [];
        ends.forEach((o, j) => { if (j === i || o.closed) return; if (same(o.a, p)) meet.push([j, o.ta]); else if (same(o.b, p)) meet.push([j, o.tb]); });
        for (const [j, tj] of meet) {
          if (out.has(j)) continue;
          const dot = t[0] * tj[0] + t[1] * tj[1] + t[2] * tj[2];
          if (dot < -0.996) { out.add(j); queue.push(j); }
        }
      }
    }
    return [...out];
  }

  // ------------------------------------------------------------------ Hole
  // standard screw sizes: clearance (normal fit), ISO 4762 counterbores, ISO 10642 countersinks (+0.4), coarse taps
  const CLEAR = { M2: 2.4, "M2.5": 2.9, M3: 3.4, M4: 4.5, M5: 5.5, M6: 6.6, M8: 9, M10: 11, M12: 13.5 };
  const CBORE = { M2: [4.4, 2.3], "M2.5": [5.5, 2.8], M3: [6.5, 3.3], M4: [8, 4.4], M5: [9.5, 5.4], M6: [11, 6.4], M8: [14.5, 8.6], M10: [17.5, 10.7], M12: [20, 12.8] };
  const CSINK = { M2: 4.8, "M2.5": 5.9, M3: 7.1, M4: 9.4, M5: 11.6, M6: 13.8, M8: 18.3, M10: 22.8, M12: 27.3 };
  const TAP = { M2: [2, 0.4], "M2.5": [2.5, 0.45], M3: [3, 0.5], M4: [4, 0.7], M5: [5, 0.8], M6: [6, 1], M8: [8, 1.25], M10: [10, 1.5], M12: [12, 1.75], M16: [16, 2], M20: [20, 2.5] };
  // inch screws (sizes in mm): close-fit clearance, socket-head counterbore, 82° flat-head countersink
  const IN = 25.4;
  const IN_SCREWS = [["#4", 0.112, 0.120, 0.219, 0.112, 0.225], ["#6", 0.138, 0.144, 0.250, 0.138, 0.279], ["#8", 0.164, 0.170, 0.281, 0.164, 0.332], ["#10", 0.190, 0.196, 0.328, 0.190, 0.385],
    ["1/4", 0.250, 0.257, 0.406, 0.250, 0.507], ["5/16", 0.3125, 0.323, 0.500, 0.3125, 0.635], ["3/8", 0.375, 0.386, 0.594, 0.375, 0.762], ["1/2", 0.500, 0.516, 0.812, 0.500, 1.007]];
  for (const [k, , c, cb, cbh, cs] of IN_SCREWS) { CLEAR[k] = +(c * IN).toFixed(3); CBORE[k] = [+(cb * IN).toFixed(3), +(cbh * IN).toFixed(3)]; CSINK[k] = +(cs * IN).toFixed(3); }
  // inch tapped holes: the UNC / UNF sizes below, [major diameter mm, pitch mm]
  const isInchKey = (k) => /^#|\//.test(k);
  function holeCmd(editing = null) {
    const st = { at: [], body: null, kind: "simple", dia: 3.4, through: true, depth: 10, cbDia: 6.5, cbDepth: 3.3, csDia: 6.9, csAngle: 90, size: "M3", pitch: 0.5, clear: store.doc.threadOffset || 0, tip: false };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      Object.assign(st, { kind: m.tapped ? "tapped" : m.kind, dia: m.dia, through: !!m.through, depth: m.depth || 10, cbDia: m.cbDia || 9, cbDepth: m.cbDepth || 3, csDia: m.csDia || 10, csAngle: m.csAngle || 90, body: b.id, size: m.size || "", pitch: m.pitch || 0.5, clear: m.clear || 0, tip: !!m.tip });
      const M = M4(b.m);
      st.at = (m.at || [{ p: m.p, n: m.n }]).map((s) => ({ ...s, world: new THREE.Vector3(...s.p).applyMatrix4(M) }));
    }
    function applySize(k) {
      if (st.kind === "tapped") { const t = TAP[k]; if (!t) return; st.pitch = t[1]; st.dia = +(t[0] - 1.0825 * t[1]).toFixed(3); return; }
      if (!CLEAR[k]) return;
      st.dia = CLEAR[k];
      if (CBORE[k]) { st.cbDia = CBORE[k][0]; st.cbDepth = CBORE[k][1]; }
      if (CSINK[k]) { st.csDia = CSINK[k]; st.csAngle = isInchKey(k) ? 82 : 90; }
    }
    if (!editing) applySize(st.size);
    let hoverPt = null;
    const def = {
      title: (editing ? "Edit " : "") + "Hole",
      valid: () => st.at.length > 0 && st.dia > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const tapped = st.kind === "tapped";
        const params = { kind: tapped ? "simple" : st.kind, dia: st.dia, through: st.through, depth: st.depth, cbDia: st.cbDia, cbDepth: st.cbDepth, csDia: st.csDia, csAngle: st.csAngle, size: st.size, tapped, pitch: tapped ? st.pitch : 0, clear: tapped ? st.clear : 0, tip: !st.through && st.tip, at: st.at.map((s) => ({ p: s.p, n: s.n })) };
        const b = findBody(doc, st.body);
        if (!b) throw new Error("Click a flat face to place the hole.");
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); Object.assign(m, params); return; }
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "hole", ...params });
      },
      ok() { commit(def, "Hole"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => "Click flat faces to place holes. They snap to face centers, circular edges and sketch points.",
      build(body) {
        body.append(pickbox(true, st.at.length ? el("span", {}, el("b", {}, st.at.length), ` position${st.at.length > 1 ? "s" : ""}`) : "Click a face to place", st.at.length && !editing ? () => { st.at = []; st.body = null; refresh(); } : null));
        const kinds = seg([["simple", "Simple"], ["cbore", "Counterbore"], ["csink", "Countersink"], ["tapped", "Tapped"]], st.kind, (v) => { st.kind = v; if (st.size) applySize(st.size); refresh(); }, "hole-kind");
        kinds.classList.add("seg-wide");
        body.append(el("div", { class: "subhead" }, "Hole type"), kinds);
        const sizes = st.kind === "tapped" ? Object.keys(TAP) : Object.keys(CLEAR);
        const label = (k) => st.kind === "tapped" ? (isInchKey(k) ? `${k} (${TAP[k][2]})` : `${k} × ${TAP[k][1]}`) : k + (st.kind === "simple" ? ` clearance (${withUnit(CLEAR[k], 3)})` : "");
        const opt = (k) => el("option", { value: k, selected: k === st.size }, label(k));
        const met = sizes.filter((k) => !isInchKey(k)), inch = sizes.filter(isInchKey);
        const groups = [el("optgroup", { label: "Metric (ISO)" }, ...met.map(opt)), el("optgroup", { label: "Inch (UNC / UNF)" }, ...inch.map(opt))];
        if (getUnit() === "in") groups.reverse();
        const ssel = el("tool-choice", { class: "num", id: "hole-size", "aria-label": "Screw size" }, el("option", { value: "" }, "Custom"), ...groups);
        ssel.onchange = () => { st.size = ssel.value; if (st.size) applySize(st.size); refresh(); };
        body.append(row(st.kind === "tapped" ? "Thread" : "Screw size", ssel, "hole-size"));
        const custom = (f) => (v) => { f(v); st.size = ""; const s2 = document.getElementById("hole-size"); if (s2) s2.value = ""; refresh(false); };
        body.append(row(st.kind === "tapped" ? "Tap drill" : "Diameter", app.numField({ value: st.dia, id: "hole-dia", min: 0.01, step: 0.1, live: true, onCommit: custom((v) => (st.dia = v)) }), "hole-dia"));
        if (st.kind === "tapped") {
          body.append(pitchRow(st.pitch, custom((v) => (st.pitch = v)), "hole-pitch", true));
          body.append(row("Print offset", offsetSelect(st.clear, (v) => { st.clear = v; refresh(false); }, "hole-clear"), "hole-clear"));
        }
        body.append(row("Extent", seg([[true, "Through all"], [false, "Depth"]], st.through, (v) => { st.through = v; refresh(); }, "hole-ext")));
        if (!st.through) {
          body.append(row("Depth", app.numField({ value: st.depth, id: "hole-depth", min: 0.01, step: 1, live: true, onCommit: (v) => { st.depth = v; refresh(false); } }), "hole-depth"));
          body.append(row("Bottom", seg([[false, "Flat"], [true, "118° drill"]], st.tip, (v) => { st.tip = v; refresh(); }, "hole-tip")));
        }
        if (st.kind === "cbore") {
          body.append(row("Bore dia.", app.numField({ value: st.cbDia, id: "hole-cbd", min: 0.01, step: 0.5, live: true, onCommit: custom((v) => (st.cbDia = v)) }), "hole-cbd"));
          body.append(row("Bore depth", app.numField({ value: st.cbDepth, id: "hole-cbh", min: 0.01, step: 0.5, live: true, onCommit: custom((v) => (st.cbDepth = v)) }), "hole-cbh"));
        }
        if (st.kind === "csink") {
          body.append(row("Sink dia.", app.numField({ value: st.csDia, id: "hole-csd", min: 0.01, step: 0.5, live: true, onCommit: custom((v) => (st.csDia = v)) }), "hole-csd"));
          body.append(row("Sink angle", app.numField({ value: st.csAngle, id: "hole-csa", min: 1, max: 179, step: 1, live: true, onCommit: custom((v) => (st.csAngle = v)) }), "hole-csa"));
        }
        if (st.kind === "tapped") body.append(el("p", { class: "hint" }, "Cuts real threads inside the hole, ready for a printed or metal screw. A print offset loosens them for 3D printing."));
        if (st.at.length === 1) {
          body.append(el("div", { class: "subhead" }, "Position (body coordinates)"));
          const r3 = el("div", { class: "row3" });
          ["X", "Y", "Z"].forEach((lab, i) => r3.append(el("label", {}, lab, app.numField({ value: st.at[0].p[i], id: "hole-p" + i, step: 0.5, onCommit: (v) => {
            st.at[0].p = st.at[0].p.slice(); st.at[0].p[i] = v;
            const b = findBody(store.doc, st.body);
            st.at[0].world = new THREE.Vector3(...st.at[0].p).applyMatrix4(M4(b.m));
            refresh(false);
          } }))));
          body.append(r3);
        }
      },
      start() { refresh(); },
      handler: {
        hover(e) { hoverPt = locate(e); draw(); vp.canvas.style.cursor = hoverPt ? "crosshair" : "default"; },
        down(e) {
          const l = locate(e);
          if (!l) return true;
          if (st.body && l.body !== st.body) { app.toast("One hole feature works on one body. Finish this one first."); return true; }
          st.body = l.body;
          st.at.push({ p: l.p, n: l.n, world: l.world });
          refresh();
          return true;
        },
      },
    };
    function locate(e) {
      // sketch points first
      const [mx, my] = vp.local(e);
      for (const sk of store.view.sketches) {
        if (sk.hidden || !scene.showSketches) continue;
        const M = planeMatrix(sk.plane);
        const n = new THREE.Vector3(...sk.plane.n).normalize();
        for (const c of resolveSketch(sk)) {
          const p2 = c.t === "point" ? c.p : c.t === "circle" ? c.c : null;
          if (!p2) continue;
          const w = new THREE.Vector3(p2[0], p2[1], 0).applyMatrix4(M);
          const s = vp.project(w);
          if (Math.hypot(s[0] - mx, s[1] - my) > vp.tol(9)) continue;
          // find the body under this point along the sketch normal
          const ray = new THREE.Raycaster(w.clone().addScaledVector(n, 1000), n.clone().negate());
          const list = bases((b) => !b.hole && !b.locked && (!st.body || b.id === st.body));
          const hit = ray.intersectObjects(list.map(pickMesh), false)[0];
          if (!hit) continue;
          const base = hit.object.userData.base;
          const inv = base.m.clone().invert();
          return { body: base.body.id, p: hit.point.clone().applyMatrix4(inv).toArray(), n: n.clone().transformDirection(inv).toArray(), world: hit.point.clone() };
        }
      }
      const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!st.body || b.id === st.body));
      if (!f || !f.info || f.info.t !== "PLANE") return null;
      const inv = f.base.m.clone().invert();
      let local = f.point.clone().applyMatrix4(inv);
      const nL = new THREE.Vector3(...f.info.n);
      // snap: face center, circular edge centers on this face, grid in face plane
      const tol = vp.pixelSize(f.point) * 10;
      const cands = [new THREE.Vector3(...f.info.c)];
      f.base.data.edgeInfo.forEach((ei) => {
        if (ei.t === "CIRCLE" && d2(ei.a, ei.b) < 1e-6 && Math.abs(ei.a[0] - ei.b[0]) < 1e-6 && Math.abs(ei.a[2] - ei.b[2]) < 1e-6) {
          const c = new THREE.Vector3((ei.a[0] + ei.m[0]) / 2, (ei.a[1] + ei.m[1]) / 2, (ei.a[2] + ei.m[2]) / 2);
          if (Math.abs(c.clone().sub(local).dot(nL)) < 1e-4) cands.push(c);
        }
      });
      let snapped = false;
      for (const c of cands) if (c.distanceTo(local) < tol) { local = c.clone(); snapped = true; break; }
      if (!snapped) {
        const g = app.gridStep();
        if (g > 0 && Math.abs(nL.z) > 0.999) { local.x = round(local.x, g); local.y = round(local.y, g); }
      }
      return { body: f.body, p: local.toArray(), n: nL.toArray(), world: local.clone().applyMatrix4(f.base.m) };
    }
    function draw() {
      clearOv();
      for (const s of st.at) drawDot(s.world, 0x1f4fa8, 10);
      if (hoverPt) drawDot(hoverPt.world, 0xe8a317, 9);
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Keyhole slots
  // Click flat faces (the back of a sign, a shelf, a frame…) to cut keyhole slots for hanging it on
  // screws. The slot runs "up" (the body's +Z laid onto the face, or +Y on a flat-lying face), or
  // turned by 90° steps. Stored as a cut with src "keyhole" and its settings, so it can be edited.
  const bodyUp = (b) => new THREE.Vector3(0, 0, 1).transformDirection(M4(b.m).invert()).toArray();
  function keyholeCmd(editing = null) {
    const st = { at: [], body: null, ...clone(KEYHOLE_DEFAULTS) };
    if (editing) {
      const b = findBody(store.doc, editing.body), m = b.node.mods.find((x) => x.id === editing.mod);
      Object.assign(st, clone(m.kh), { body: b.id });
      const M = M4(b.m);
      st.at = m.kh.at.map((q) => ({ ...q, world: new THREE.Vector3(...q.p).applyMatrix4(M) }));
    }
    let hoverPt = null;
    const spots = (b) => st.at.map((q) => ({ p: q.p, n: q.n, dir: faceUp(q.n, bodyUp(b), st.ang) }));
    const def = {
      title: (editing ? "Edit " : "") + "Keyhole slot",
      valid: () => st.at.length > 0 && st.head > st.shank && st.length > 0 && st.lip > 0 && st.depth > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b) throw new Error("Click a flat face to place the keyhole.");
        const kh = { size: st.size, head: st.head, shank: st.shank, length: st.length, lip: st.lip, depth: st.depth, ang: st.ang, at: st.at.map((q) => ({ p: q.p, n: q.n })) };
        const tool = keyholeTool(kh, spots(b));
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); Object.assign(m, { kh, tool }); return; }
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "bool", op: "cut", src: "keyhole", kh, tool, m: IDENTITY.slice() });
      },
      ok() { commit(def, "Keyhole slot"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => "Click a flat face (usually the back) where the screw head should go in. The slot runs up from there, so the part hangs on the screw.",
      build(body) {
        body.append(pickbox(true, st.at.length ? el("span", {}, el("b", {}, st.at.length), ` keyhole${st.at.length > 1 ? "s" : ""}`) : "Click a face to place", st.at.length && !editing ? () => { st.at = []; st.body = null; refresh(); } : null));
        const sizes = seg([...Object.entries(KEYHOLE_SIZES).map(([k, v]) => [k, v.name.split(" ")[0]]), ["custom", "Custom"]], st.size, (v) => { st.size = v; if (KEYHOLE_SIZES[v]) { const { name, ...dims } = KEYHOLE_SIZES[v]; void name; Object.assign(st, dims); } refresh(); }, "kh-size");
        body.append(el("div", { class: "subhead" }, "Screw size"), sizes);
        if (KEYHOLE_SIZES[st.size]) body.append(el("p", { class: "hint" }, `For ${KEYHOLE_SIZES[st.size].name.replace(/.*\(|\)/g, "")} screws (pan or round heads).`));
        const num = (lab, key, id, min, step) => body.append(row(lab, app.numField({ value: st[key], id, min, step, live: true, onCommit: (v) => { st[key] = v; st.size = "custom"; refresh(false); const sz = document.getElementById("kh-size"); if (sz) sz.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x.textContent === "Custom")); } }), id));
        num("Head hole", "head", "kh-head", 1, 0.5);
        num("Slot width", "shank", "kh-shank", 0.5, 0.1);
        num("Slot length", "length", "kh-length", 1, 1);
        num("Lip", "lip", "kh-lip", 0.4, 0.5);
        num("Head room", "depth", "kh-depth", 0.5, 0.5);
        body.append(el("p", { class: "hint" }, `Cuts ${withUnit(st.lip + st.depth, 2)} deep: make the part at least ${withUnit(st.lip + st.depth + 1.5, 2)} thick there. The lip is what the screw head hooks behind.`));
        body.append(row("Slot points", seg([[0, "Up"], [90, "Right"], [180, "Down"], [270, "Left"]], st.ang, (v) => { st.ang = v; refresh(); }, "kh-dir")));
      },
      start() { refresh(); },
      handler: {
        hover(e) { hoverPt = locate(e); draw(); vp.canvas.style.cursor = hoverPt ? "crosshair" : "default"; },
        down(e) {
          const l = locate(e);
          if (!l) return true;
          if (st.body && l.body !== st.body) { app.toast("One keyhole feature works on one body. Finish this one first."); return true; }
          st.body = l.body; st.at.push(l); refresh(); return true;
        },
      },
    };
    function locate(e) {
      const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!st.body || b.id === st.body));
      if (!f || !f.info || f.info.t !== "PLANE") return null;
      const inv = f.base.m.clone().invert();
      let local = f.point.clone().applyMatrix4(inv);
      const c = new THREE.Vector3(...f.info.c);
      if (c.distanceTo(local) < vp.pixelSize(f.point) * 10) local = c;
      return { body: f.body, p: local.toArray(), n: f.info.n.slice(), world: local.clone().applyMatrix4(f.base.m) };
    }
    function draw() {
      clearOv();
      const b = st.body && findBody(store.doc, st.body);
      for (const q of st.at) {
        drawDot(q.world, 0x1f4fa8, 10);
        if (b) { const M = M4(b.m), d = faceUp(q.n, bodyUp(b), st.ang); drawLine([q.world, new THREE.Vector3(...q.p.map((v, i) => v + d[i] * st.length)).applyMatrix4(M)], 0x1f4fa8); }
      }
      if (hoverPt) drawDot(hoverPt.world, 0xe8a317, 9);
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Ribs
  // Click where a rib starts and where it ends on a flat face; it stands up from the face. Straight
  // ribs stiffen a floor or wall; gussets (triangles) brace a corner: start one against a wall.
  function ribCmd(editing = null) {
    const st = { a: null, b: null, body: null, ...clone(RIB_DEFAULTS) };
    if (editing) {
      const b = findBody(store.doc, editing.body), m = b.node.mods.find((x) => x.id === editing.mod), M = M4(b.m);
      Object.assign(st, clone(m.rib), { body: b.id });
      st.a = { p: m.rib.a, n: m.rib.n, world: new THREE.Vector3(...m.rib.a).applyMatrix4(M) };
      st.b = { p: m.rib.b, n: m.rib.n, world: new THREE.Vector3(...m.rib.b).applyMatrix4(M) };
    }
    let hoverPt = null;
    const def = {
      title: (editing ? "Edit " : "") + "Rib",
      valid: () => !!(st.a && st.b) && st.height > 0 && st.thick > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b || !st.a || !st.b) throw new Error("Click where the rib starts and where it ends, on a flat face.");
        const rib = { shape: st.shape, height: st.height, thick: st.thick, count: st.count, spacing: st.spacing, flip: st.flip, a: st.a.p, b: st.b.p, n: st.a.n };
        const { tool } = ribTool(rib, rib.a, rib.b, rib.n);
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); Object.assign(m, { rib, tool }); return; }
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "bool", op: "join", src: "rib", rib, tool, m: IDENTITY.slice() });
      },
      ok() { commit(def, "Rib"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => !st.a ? "Click on a flat face where the rib starts (for a gusset: against the wall it braces)." : !st.b ? "Click where the rib ends, on the same face." : "Set the size, then OK. Click the face again to start the rib over.",
      build(body) {
        const len = st.a && st.b ? st.a.world.distanceTo(st.b.world) : 0;
        body.append(pickbox(true, st.a && st.b ? el("span", {}, "Rib ", el("b", {}, withUnit(len, 1)), " long") : st.a ? "Click where it ends" : "Click where it starts", st.a && !editing ? () => { st.a = st.b = null; st.body = null; refresh(); } : null));
        body.append(el("div", { class: "subhead" }, "Shape"), seg([["straight", "Straight"], ["gusset", "Gusset (triangle)"]], st.shape, (v) => { st.shape = v; refresh(); }, "rib-shape"));
        body.append(el("p", { class: "hint" }, st.shape === "gusset" ? "Full height at the start, down to nothing at the end: start it against a wall to brace the corner." : "An even wall standing on the face, to stiffen it."));
        if (st.shape === "gusset") body.append(row("Tall end", seg([[false, "At the start"], [true, "At the end"]], st.flip, (v) => { st.flip = v; refresh(); }, "rib-flip")));
        const num = (lab, key, id, min, step, int) => body.append(row(lab, app.numField({ value: st[key], id, min, step, len: !int, live: true, onCommit: (v) => { st[key] = int ? Math.max(1, Math.round(v)) : v; refresh(key === "count"); } }), id));
        num("Height", "height", "rib-height", 0.2, 1);
        num("Thickness", "thick", "rib-thick", 0.4, 0.2);
        num("Count", "count", "rib-count", 1, 1, true);
        if (st.count > 1) num("Spacing", "spacing", "rib-spacing", 0.5, 1);
        body.append(el("p", { class: "hint" }, "Tip: ribs about 0.6 to 1 times the wall thickness print cleanly and add stiffness without sink marks."));
      },
      start() { refresh(); },
      handler: {
        hover(e) { hoverPt = locate(e); draw(); vp.canvas.style.cursor = hoverPt ? "crosshair" : "default"; },
        down(e) {
          const l = locate(e);
          if (!l) return true;
          if (st.a && st.b && !editing) { st.a = null; st.b = null; st.body = null; }
          if (!st.a) { st.a = l; st.body = l.body; }
          else {
            if (l.body !== st.body) { app.toast("The rib's end must be on the same body."); return true; }
            const nA = new THREE.Vector3(...st.a.n), off = new THREE.Vector3(...l.p).sub(new THREE.Vector3(...st.a.p)).dot(nA);
            if (Math.abs(off) > 0.01) { app.toast("Click the end on the same flat face as the start."); return true; }
            st.b = l;
          }
          refresh(); return true;
        },
      },
    };
    function locate(e) {
      const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!st.body || b.id === st.body));
      if (!f || !f.info || f.info.t !== "PLANE") return null;
      const inv = f.base.m.clone().invert(), local = f.point.clone().applyMatrix4(inv);
      const nL = new THREE.Vector3(...f.info.n);
      const g = app.gridStep();
      if (g > 0) { const c = new THREE.Vector3(...f.info.c); for (const k of ["x", "y", "z"]) if (Math.abs(nL[k]) < 0.999 && Math.abs(nL.x) + Math.abs(nL.y) + Math.abs(nL.z) < 1.0001) local[k] = c[k] + round(local[k] - c[k], g); }
      return { body: f.body, p: local.toArray(), n: nL.toArray(), world: local.clone().applyMatrix4(f.base.m) };
    }
    function draw() {
      clearOv();
      if (st.a) drawDot(st.a.world, 0x1f4fa8, 10);
      if (st.b) { drawDot(st.b.world, 0x1f4fa8, 10); drawLine([st.a.world, st.b.world], 0x1f4fa8); }
      else if (st.a && hoverPt) drawLine([st.a.world, hoverPt.world], 0xe8a317);
      if (hoverPt) drawDot(hoverPt.world, 0xe8a317, 9);
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Construction planes
  const V3 = (a) => new THREE.Vector3(...a);
  const arr3 = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(9)));
  // a reference plane under the pointer: a construction plane, a flat body face or an origin plane
  const bboxCache = new WeakMap();
  function pickRefPlane(e) {
    const cands = [];
    const ph = vp.pick(e, scene.planeMeshes())[0];
    if (ph) { const p = (store.doc.planes || []).find((q) => q.id === ph.object.userData.cplane); if (p) cands.push({ d: ph.distance, ref: { ...p.plane, center: p.plane.o, size: p.size, label: p.name, cplane: p.id } }); }
    const f = pickBaseFace(e);
    if (f && f.info && f.info.t === "PLANE") {
      const pl = planeFromFace(f);
      const c = V3(f.info.c).applyMatrix4(f.base.m);
      let bb0 = bboxCache.get(f.base.data);
      if (!bb0) { bb0 = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(f.base.data.vertices, 3)); bboxCache.set(f.base.data, bb0); }
      const bb = bb0.clone().applyMatrix4(f.base.m);
      const size = Math.max(20, bb.getSize(new THREE.Vector3()).length() * 0.8);
      cands.push({ d: f.distance, ref: { ...pl, o: arr3(c), center: arr3(c), size, label: "Face", face: f } });
    }
    // a sketch: click one of its shapes or lines
    const rh = visibleRegionHits(e)[0];
    const sc = !rh ? pickSketchCurve(e) : null;
    const skId = rh ? rh.object.userData.region.sketch : sc ? sc.sketch : null;
    if (skId) { const r = sketchRef(skId); if (r) cands.push({ d: rh ? rh.distance - 1e-3 : 0, ref: r }); }
    const gh = vp.pick(e, planeGizmo.children)[0];
    if (gh) { const pl = ORIGIN_PLANES[gh.object.userData.plane]; cands.push({ d: gh.distance + 1e-3, ref: { o: pl.o, x: pl.x, n: pl.n, center: [0, 0, 0], size: 60, label: gh.object.userData.plane + " plane" } }); }
    cands.sort((a, b) => a.d - b.d);
    return cands.length ? cands[0].ref : null;
  }
  // a sketch's plane, centred on what is drawn in it
  function sketchRef(id) {
    const sk = findSketch(store.view, id);
    if (!sk) return null;
    const M = planeMatrix(sk.plane);
    const box = new THREE.Box3();
    for (const c of resolveSketch(sk)) for (const q of c.t === "point" ? [c.p] : sampleCurve(c)) box.expandByPoint(new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M));
    const center = box.isEmpty() ? V3(sk.plane.o) : new THREE.Plane().setFromNormalAndCoplanarPoint(V3(sk.plane.n).normalize(), V3(sk.plane.o)).projectPoint(box.getCenter(new THREE.Vector3()), new THREE.Vector3());
    const size = box.isEmpty() ? 60 : Math.max(20, box.getSize(new THREE.Vector3()).length() * 1.2);
    return { o: sk.plane.o.slice(), x: sk.plane.x.slice(), n: sk.plane.n.slice(), center: arr3(center), size, label: (sk.name || "Sketch") + " (sketch plane)", sketch: sk.id };
  }
  function drawRefPlane(ref, color) {
    if (!ref) return;
    const s = ref.size || 60, h = s / 2;
    const M = planeMatrix({ o: ref.center || ref.o, x: ref.x, n: ref.n });
    const pts = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(M));
    drawLine(pts, color);
  }
  function addPlane(doc, kind, def, plane, size) {
    doc.planes = doc.planes || [];
    let n = 1;
    const names = new Set(doc.planes.map((p) => p.name));
    while (names.has("Plane " + n)) n++;
    const p = { id: uid("pl"), name: "Plane " + n, seq: nextSeq(doc), kind, def, plane, size: Math.max(20, size || 60), hidden: false };
    doc.planes.push(p);
    return p;
  }
  function frameFrom(o, n, xHint) {
    const nn = V3(n).normalize();
    let x = xHint ? V3(xHint) : new THREE.Vector3(1, 0, 0);
    x.sub(nn.clone().multiplyScalar(x.dot(nn)));
    if (x.lengthSq() < 1e-8) { x = Math.abs(nn.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0); x.sub(nn.clone().multiplyScalar(x.dot(nn))); }
    return { o: arr3(V3(o)), x: arr3(x.normalize()), n: arr3(nn) };
  }
  // Offset plane: parallel to a plane or flat face, a distance away
  function offsetPlaneCmd(editing = null) {
    const st = { ref: null, d: 10 };
    if (editing) { const p = store.doc.planes.find((q) => q.id === editing); Object.assign(st, { ref: p.def.ref, d: p.def.d }); }
    let hover = null, arrowDrag = null;
    const def = {
      title: (editing ? "Edit " : "") + "Offset plane",
      valid: () => !!st.ref,
      canOk: () => def.valid(),
      apply(doc) {
        const r = st.ref, n = V3(r.n).normalize();
        const plane = frameFrom(V3(r.center || r.o).addScaledVector(n, st.d).toArray(), r.n, r.x);
        const ref = { o: r.o, x: r.x, n: r.n, center: r.center, size: r.size, label: r.label, sketch: r.sketch };
        if (editing) { const p = doc.planes.find((q) => q.id === editing); Object.assign(p, { plane, def: { ref, d: st.d } }); return; }
        addPlane(doc, "offset", { ref, d: st.d }, plane, r.size);
      },
      ok() { commit(def, "Offset plane"); },
      onDelete: editing ? () => { closeCmd(false); store.update((doc) => { doc.planes = doc.planes.filter((q) => q.id !== editing); }, "Delete plane"); } : null,
      hint: () => st.ref ? "Drag the arrow or type the distance." : "Click an origin plane, a construction plane, a flat face or a sketch (or choose a sketch in the list).",
      build(body) {
        body.append(pickbox(true, st.ref ? el("b", {}, st.ref.label || "Plane") : "Select a plane, face or sketch", st.ref && !editing ? () => { st.ref = null; refresh(); } : null));
        // the origin planes as buttons too (like Create sketch): easier than hitting them in the view
        if (!editing) {
          const cur = st.ref && /^(XY|XZ|YZ) plane$/.test(st.ref.label || "") ? st.ref.label.slice(0, 2) : null;
          body.append(row("Origin plane", seg([["XY", "XY · Top"], ["XZ", "XZ · Front"], ["YZ", "YZ · Right"]], cur, (v) => { const pl = ORIGIN_PLANES[v]; st.ref = { o: pl.o, x: pl.x, n: pl.n, center: [0, 0, 0], size: 60, label: v + " plane" }; refresh(); }, "pl-origin")));
        }
        // any sketch, even a hidden one, can be the starting plane
        const sks = store.doc.sketches || [];
        if (sks.length) {
          const sel = el("tool-choice", { class: "num", id: "pl-sketch" }, el("option", { value: "" }, "…or pick a sketch"), ...sks.map((k) => el("option", { value: k.id, selected: st.ref && st.ref.sketch === k.id }, k.name || "Sketch")));
          sel.onchange = () => { const r = sel.value && sketchRef(sel.value); if (r) { st.ref = r; refresh(); } };
          body.append(row("Sketch", sel, "pl-sketch"));
        }
        body.append(row("Distance", (def.distInput = app.numField({ value: st.d, id: "pl-d", step: 1, live: true, onCommit: (v) => { st.d = v; refresh(false); } })), "pl-d"));
      },
      start() { showPlaneGizmo(true); refresh(); },
      cleanup() { showPlaneGizmo(false); },
      handler: {
        wantsTouch: (e) => !!overArrow(e),
        hover(e) { if (arrowDrag) return; if (overArrow(e)) { vp.canvas.style.cursor = "grab"; return; } hover = st.ref ? null : pickRefPlane(e); draw(); vp.canvas.style.cursor = hover ? "pointer" : "default"; },
        down(e) {
          const a = overArrow(e);
          if (a) { arrowDrag = { f: axisDragger(e, a.origin, a.n), v0: st.d }; return true; }
          const r = pickRefPlane(e);
          if (r) { st.ref = r; hover = null; refresh(); }
          return true;
        },
        move(e) { if (!arrowDrag) return; const g = app.gridStep() || 0.1; st.d = round(arrowDrag.v0 + arrowDrag.f(e), g >= 1 ? 1 : g); def.distInput && def.distInput.setValue(st.d); refresh(false); },
        up() { arrowDrag = null; },
      },
    };
    function overArrow(e) { const a = def.arrow; if (!a) return null; const [mx, my] = vp.local(e); const s = vp.project(a.tip); return Math.hypot(s[0] - mx, s[1] - my) < vp.tol(14) ? a : null; }
    function draw() {
      clearOv();
      def.arrow = null;
      if (hover) drawRefPlane(hover, 0xe8a317);
      if (!st.ref) return;
      drawRefPlane(st.ref, 0x2f66c8);
      const n = V3(st.ref.n).normalize(), origin = V3(st.ref.center || st.ref.o), tip = origin.clone().addScaledVector(n, st.d);
      drawLine([origin, tip], 0x1f4fa8);
      drawRefPlane({ ...st.ref, center: tip.toArray() }, 0xe8a317);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 16), new THREE.MeshBasicMaterial({ color: 0x1f4fa8, depthTest: false, transparent: true }));
      cone.scale.setScalar(vp.pixelSize(tip) * 6); cone.position.copy(tip);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().multiplyScalar(Math.sign(st.d) || 1));
      cone.renderOrder = 14; ov.add(cone);
      def.arrow = { origin, n, tip };
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }
  // ------------------------------------------------------------------ sketches as DXF
  // ids: the sketches to save (null = all of them). One sketch keeps its own coordinates;
  // several go side by side in one file, each on a layer named after it.
  async function exportSketchesDXF(ids) {
    const all = store.doc.sketches || [];
    const list = ids ? all.filter((k) => ids.includes(k.id)) : all;
    if (!list.length) { app.toast("There are no sketches to save yet."); return; }
    const txt = sketchesDXF(list);
    if (!txt) { app.toast(list.length > 1 ? "Those sketches have nothing to save (construction lines and points are left out)." : "This sketch has nothing to save yet (construction lines and points are left out).", "err"); return; }
    const clean = (t) => (t || "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
    const name = (clean(store.doc.name) || "design") + (list.length === 1 ? "-" + (clean(list[0].name) || "sketch") : "-sketches") + ".dxf";
    await app.projects.saveModel(name, new TextEncoder().encode(txt));
    app.toast(list.length === 1 ? `Saved ${list[0].name} as DXF (millimetres).` : `Saved ${list.length} sketches in one DXF, side by side, each on its own layer (millimetres).`);
  }
  // ------------------------------------------------------------------ Section analysis
  // Like Fusion 360: cut the view with a plane to see inside. Nothing in the design changes,
  // and the section stays on after OK (clear it from the chip in the view or here).
  function sectionCmd() {
    const prev = section.info;
    const st = prev ? { ...prev } : { ref: null, d: 0, flip: false, hatch: true };
    let hover = null, arrowDrag = null, done = false;
    // where the arrow sits: the plane's own center, or the middle of the design on the plane
    const anchorOf = (ref) => {
      if (ref.center) return V3(ref.center);
      const box = new THREE.Box3();
      for (const b of store.view.bodies) if (!b.hidden) { const bb = scene.bodyTightBox(b.id); if (bb) box.union(bb); }
      const c = box.isEmpty() ? V3(ref.o) : box.getCenter(new THREE.Vector3());
      return new THREE.Plane().setFromNormalAndCoplanarPoint(V3(ref.n).normalize(), V3(ref.o)).projectPoint(c, new THREE.Vector3());
    };
    const live = () => section.set(st.ref ? { ref: { o: st.ref.o, n: st.ref.n, x: st.ref.x, center: anchorOf(st.ref).toArray(), size: st.ref.size, label: st.ref.label }, d: st.d, flip: st.flip, hatch: st.hatch } : null);
    const def = {
      title: "Section analysis",
      okLabel: "OK",
      valid: () => !!st.ref,
      canOk: () => !!st.ref,
      ok() { done = true; closeCmd(false); app.toast("Section on. Use the close button on the Section chip to clear it, or open Section analysis again to change it."); },
      onDelete: prev ? () => { done = true; section.clear(); closeCmd(false); } : null,
      hint: () => st.ref ? "Drag the arrow or type a distance to move the cut. Flip shows the other side." : "Click an origin plane, a construction plane or a flat face to cut along (or pick YZ / XZ / XY).",
      build(body) {
        body.append(row("Plane", pickbox(!st.ref, st.ref ? el("b", {}, st.ref.label || "Plane") : "Click a plane or flat face", st.ref ? () => { st.ref = null; refresh(); } : null), "sec-plane"));
        body.append(row("…or use", seg([["YZ", "YZ"], ["XZ", "XZ"], ["XY", "XY"]], st.ref && ["YZ", "XZ", "XY"].includes(st.ref.label) ? st.ref.label : null, (v) => { const p = ORIGIN_PLANES[v]; st.ref = { o: p.o.slice(), n: p.n.slice(), x: p.x.slice(), label: v }; st.d = 0; refresh(); }, "sec-origin")));
        body.append(row("Distance", (def.distInput = app.numField({ value: st.d, id: "sec-d", step: 1, live: true, onCommit: (v) => { st.d = v; refresh(false); } })), "sec-d"));
        body.append(row("Show", seg([[false, "This side"], [true, "Other side"]], st.flip, (v) => { st.flip = v; refresh(); }, "sec-flip")));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "sec-hatch", checked: st.hatch, onchange: (e) => { st.hatch = e.target.checked; refresh(false); } }), "Hatch the cut faces"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Only the view is cut: the design doesn't change. The cut faces show in each body's color."));
      },
      start() { showPlaneGizmo(true); refresh(); },
      cleanup() { showPlaneGizmo(false); if (!done) section.set(prev); },
      typeInto: () => (st.ref ? def.distInput : null),
      handler: {
        wantsTouch: (e) => !!overArrow(e),
        hover(e) { if (arrowDrag) return; if (overArrow(e)) { vp.canvas.style.cursor = "grab"; return; } hover = pickRefPlane(e); draw(); vp.canvas.style.cursor = hover ? "pointer" : "default"; },
        down(e) {
          const a = overArrow(e);
          if (a) { arrowDrag = { f: axisDragger(e, a.origin, a.n), v0: st.d }; return true; }
          const r = pickRefPlane(e);
          if (r) { st.ref = r; st.d = 0; hover = null; refresh(); }
          return true;
        },
        move(e) { if (!arrowDrag) return; const g = app.gridStep() || 0.1; st.d = round(arrowDrag.v0 + arrowDrag.f(e), g >= 1 ? 1 : g); def.distInput && def.distInput.setValue(st.d); refresh(false); },
        up() { arrowDrag = null; },
      },
    };
    function overArrow(e) { const a = def.arrow; if (!a) return null; const [mx, my] = vp.local(e); const s = vp.project(a.tip); return Math.hypot(s[0] - mx, s[1] - my) < vp.tol(14) ? a : null; }
    function draw() {
      clearOv();
      def.arrow = null;
      if (hover && (!st.ref || hover !== st.ref)) drawRefPlane(hover, 0xe8a317);
      if (!st.ref) return;
      const n = V3(st.ref.n).normalize(), at = anchorOf(st.ref).addScaledVector(n, st.d);
      // the arrow points to the side that is cut away
      const dir = st.flip ? n.clone().negate() : n.clone();
      const len = vp.pixelSize(at) * 60, tip = at.clone().addScaledVector(dir, len);
      drawLine([at, tip], 0x1f4fa8);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 16), new THREE.MeshBasicMaterial({ color: 0x1f4fa8, depthTest: false, transparent: true }));
      cone.scale.setScalar(vp.pixelSize(tip) * 6); cone.position.copy(tip);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      cone.renderOrder = 14; ov.add(cone);
      // dragging moves the plane along its normal, whichever way the arrow points
      def.arrow = { origin: at.clone().addScaledVector(n, -st.d), n, tip };
    }
    function refresh(rerender = true) { if (rerender) def.render(); live(); draw(); }
    openCmd(def);
  }
  // Plane at angle: through an axis (X, Y, Z or a straight edge), turned by an angle
  function anglePlaneCmd(editing = null) {
    const st = { axis: null, angle: 45 };
    if (editing) { const p = store.doc.planes.find((q) => q.id === editing); Object.assign(st, { axis: p.def.axis, angle: p.def.angle }); }
    let hover = null;
    const AX = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
    const planeOfAxis = (ax, angle) => {
      const d = V3(ax.d).normalize();
      const up = Math.abs(d.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const n0 = new THREE.Vector3().crossVectors(d, up).normalize();
      const n = n0.applyAxisAngle(d, (angle * Math.PI) / 180);
      return frameFrom(ax.o, n.toArray(), d.toArray());
    };
    const def = {
      title: (editing ? "Edit " : "") + "Plane at angle",
      valid: () => !!st.axis,
      canOk: () => def.valid(),
      apply(doc) {
        const plane = planeOfAxis(st.axis, st.angle);
        if (editing) { const p = doc.planes.find((q) => q.id === editing); Object.assign(p, { plane, def: { axis: st.axis, angle: st.angle } }); return; }
        addPlane(doc, "angle", { axis: st.axis, angle: st.angle }, plane, st.axis.len ? st.axis.len * 1.4 : 60);
      },
      ok() { commit(def, "Plane at angle"); },
      onDelete: editing ? () => { closeCmd(false); store.update((doc) => { doc.planes = doc.planes.filter((q) => q.id !== editing); }, "Delete plane"); } : null,
      hint: () => st.axis ? "Type the angle." : "Pick X, Y or Z, or click a straight edge of a body.",
      build(body) {
        body.append(row("Axis", pickbox(!st.axis, st.axis ? el("b", {}, st.axis.label) : "Click a straight edge", st.axis && !editing ? () => { st.axis = null; refresh(); } : null)));
        body.append(row("…or use", seg([["X", "X axis"], ["Y", "Y axis"], ["Z", "Z axis"]], st.axis && AX[st.axis.label] ? st.axis.label : null, (v) => { st.axis = { o: [0, 0, 0], d: AX[v], label: v, len: 0 }; refresh(); }, "pa-axes")));
        body.append(sliderRow("Angle", "pa-angle", st.angle, -180, 180, 1, "°", (v) => { st.angle = v; refresh(false); }));
      },
      start() { refresh(); },
      handler: {
        hover(e) { const h = pickBaseEdge(e); hover = h && h.info.t === "LINE" ? h : null; draw(); vp.canvas.style.cursor = hover ? "pointer" : "default"; },
        down(e) {
          const h = pickBaseEdge(e);
          if (!h) return true;
          if (h.info.t !== "LINE") { app.toast("Pick a straight edge for the axis."); return true; }
          const base = baseOf(h.body);
          const a = V3(h.info.a).applyMatrix4(base.m), b = V3(h.info.b).applyMatrix4(base.m);
          st.axis = { o: arr3(a.clone().add(b).multiplyScalar(0.5)), d: arr3(b.clone().sub(a)), label: "Edge", len: a.distanceTo(b) };
          refresh();
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      if (hover) scene.setEdges([], { body: hover.body, edge: hover.edge }); else scene.setEdges([], null);
      if (!st.axis) return;
      const d = V3(st.axis.d).normalize(), o = V3(st.axis.o), L = Math.max(40, (st.axis.len || 0) * 0.8);
      drawLine([o.clone().addScaledVector(d, -L), o.clone().addScaledVector(d, L)], 0xe8a317);
      const pl = planeOfAxis(st.axis, st.angle);
      drawRefPlane({ ...pl, center: pl.o, size: Math.max(40, (st.axis.len || 0) * 1.4) }, 0x2f66c8);
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    const prevCleanup = def.cleanup;
    def.cleanup = () => { scene.setEdges([], null); prevCleanup && prevCleanup(); };
    openCmd(def);
  }
  // Midplane: halfway between two flat faces or planes
  function midPlaneCmd() {
    const st = { a: null, b: null };
    let hover = null;
    const solve = () => {
      const A = st.a, B = st.b, na = V3(A.n).normalize(), nb = V3(B.n).normalize();
      const ca = V3(A.center || A.o), cb = V3(B.center || B.o);
      if (Math.abs(na.dot(nb)) > 0.9999) {
        const t = cb.clone().sub(ca).dot(na) / 2;
        const o = ca.clone().add(cb).multiplyScalar(0.5);
        o.addScaledVector(na, t - o.clone().sub(ca).dot(na));
        return frameFrom(o.toArray(), na.toArray(), A.x);
      }
      // two planes at an angle: the plane that splits the angle between them
      const nb2 = na.dot(nb) > 0 ? nb.clone() : nb.clone().negate();
      const n = na.clone().sub(nb2).normalize();
      const dir = new THREE.Vector3().crossVectors(na, nb).normalize();
      // a point on both planes
      const da = na.dot(ca), db = nb.dot(cb);
      const p = new THREE.Vector3().crossVectors(dir, nb).multiplyScalar(da).add(new THREE.Vector3().crossVectors(na, dir).multiplyScalar(db)).divideScalar(dir.dot(new THREE.Vector3().crossVectors(na, nb)) || 1);
      const mid = ca.clone().add(cb).multiplyScalar(0.5);
      const o = p.clone().addScaledVector(dir, mid.clone().sub(p).dot(dir));
      return frameFrom(o.toArray(), n.toArray(), dir.toArray());
    };
    const def = {
      title: "Midplane",
      valid: () => !!(st.a && st.b),
      canOk: () => def.valid(),
      apply(doc) { addPlane(doc, "mid", { a: strip(st.a), b: strip(st.b) }, solve(), Math.max(st.a.size || 60, st.b.size || 60)); },
      ok() { commit(def, "Midplane"); },
      hint: () => !st.a ? "Click the first face or plane." : !st.b ? "Click the second face or plane." : "OK to add the plane.",
      build(body) {
        body.append(row("First", pickbox(!st.a, st.a ? el("b", {}, st.a.label) : "Click a face or plane", st.a ? () => { st.a = null; st.b = null; refresh(); } : null)));
        body.append(row("Second", pickbox(!!st.a && !st.b, st.b ? el("b", {}, st.b.label) : "Click a face or plane", st.b ? () => { st.b = null; refresh(); } : null)));
      },
      start() { showPlaneGizmo(true); refresh(); },
      cleanup() { showPlaneGizmo(false); },
      handler: {
        hover(e) { hover = st.a && st.b ? null : pickRefPlane(e); draw(); vp.canvas.style.cursor = hover ? "pointer" : "default"; },
        down(e) { const r = pickRefPlane(e); if (!r) return true; if (!st.a) st.a = r; else if (!st.b) st.b = r; refresh(); return true; },
      },
    };
    const strip = (r) => ({ o: r.o, x: r.x, n: r.n, center: r.center, size: r.size, label: r.label });
    function draw() {
      clearOv();
      if (hover) drawRefPlane(hover, 0xe8a317);
      if (st.a) drawRefPlane(st.a, 0x2f66c8);
      if (st.b) drawRefPlane(st.b, 0x2f66c8);
      if (st.a && st.b) { const pl = solve(); drawRefPlane({ ...pl, center: pl.o, size: Math.max(st.a.size || 60, st.b.size || 60) }, 0xe8a317); }
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Insert SVG / DXF / image
  function pickFile(accept) {
    return new Promise((res) => {
      const inp = el("input", { type: "file", accept: fileAccept(accept), style: { display: "none" } });
      inp.onchange = () => { res(inp.files[0] || null); inp.remove(); };
      document.body.append(inp);
      inp.click();
    });
  }
  // shrink big pictures so designs stay small enough to save
  function loadImage(file, max = 1600) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        let src = cv.toDataURL("image/png");
        if (src.length > 700000) src = cv.toDataURL("image/jpeg", 0.85);
        res({ src, w, h, natW: img.naturalWidth });
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That picture couldn't be opened.")); };
      img.src = url;
    });
  }
  async function insertFile(kind = "any") {
    const MODELS = ".stl,.3mf,.step,.stp,.zip,model/stl,model/3mf,application/sla,application/zip";
    const accept = kind === "svg" ? ".svg,image/svg+xml" : kind === "dxf" ? ".dxf" : kind === "image" ? "image/png,image/jpeg,image/webp,image/gif,image/bmp" : kind === "model" ? MODELS : ".svg,.dxf,image/png,image/jpeg,image/webp,image/gif," + MODELS;
    const f = await pickFile(accept);
    if (!f) return;
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (ext === "stl" || ext === "3mf" || ext === "step" || ext === "stp" || ext === "zip") return importModel(f);
    const type = ext === "svg" ? "svg" : ext === "dxf" ? "dxf" : /^image\//.test(f.type) ? "image" : null;
    if (!type) { app.toast("Pick an SVG, DXF or picture file.", "err"); return; }
    try {
      if (type === "image") {
        const img = await loadImage(f);
        if (sketcher.active) insertImageCmd(img, f.name);
        else imageOnFaceCmd(img, f.name); // pick a face of a body (or the workplane) for it
      } else {
        const text = await f.text();
        const res = type === "svg" ? { curves: parseSVG(text), skipped: 0 } : parseDXF(text);
        ensureSketch();
        insertCurvesCmd(res.curves, f.name, type, res.skipped);
      }
    } catch (e) { app.toast(e.message || "That file couldn't be read.", "err"); }
  }
  // ------------------------------------------------------------------ STL / STEP import
  // Like Tinkercad: an STL becomes a shape you can move, group, cut holes in (and, in
  // Advanced, add features to). STEP files (e.g. from the Mesh to STEP Helper) come in as
  // true CAD solids.
  async function importModel(file, bytesIn) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const base = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Import";
    try {
      const bytes = bytesIn || new Uint8Array(await file.arrayBuffer());
      if (ext === "step" || ext === "stp") {
        addImported({ kind: "step", bytes, name: base, k: 1 });
        app.toast(`Imported ${file.name} as a CAD solid. It may take a moment to appear.`);
        return;
      }
      // a Layerscape 3D print kit (.zip) or its .3mf: one object per part, put together
      if (ext === "zip" || ext === "3mf") {
        const ls = await readLayerscape(bytes);
        if (ls) {
          const ids = addMeshBodies(app, ls.parts, "Import Layerscape " + ls.title);
          app.toast(ls.assembled ? `Imported "${ls.title}" from Layerscape: ${ids.length} parts, put together as the finished diorama. Group them to move it as one.` : `Imported "${ls.title}" from Layerscape: ${ids.length} parts, laid out flat as on the print plate. Kits made with Layerscape in 2.9.8.9.1 or later come in put together.`);
          return;
        }
        if (ext === "zip") { app.toast("That .zip isn't a Layerscape 3D print kit. Import an STL, 3MF or STEP file.", "err"); return; }
      }
      const big = bytes.length > 4e6;
      if (big) { app.toast("Reading " + file.name + "…"); await new Promise((r) => setTimeout(r, 60)); }
      const res = await readMeshFile(bytes);
      const nt0 = res.mesh.I.length / 3;
      let mesh = res.mesh, err = 0;
      if (nt0 > MESH_LIMIT) {
        if (!big) { app.toast("Simplifying " + nt0.toLocaleString() + " triangles…"); await new Promise((r) => setTimeout(r, 60)); }
        ({ mesh, err } = simplify(mesh, MESH_LIMIT));
      }
      importStlCmd(mesh, base, file.name, nt0, { ...res, err, bytes });
    } catch (e) { app.toast(e.message || "That file couldn't be read.", "err"); }
  }
  function addImported({ kind, bytes, name, k }) {
    const id = contentId(bytes);
    const data = toB64(bytes);
    let bodyId = null;
    store.update((doc) => {
      doc.assets = doc.assets || {};
      if (!doc.assets[id]) doc.assets[id] = { kind, name, data };
      const t = vp.view.target, g = 10;
      const b = { id: (bodyId = uid("b")), name: nextName(doc, name), seq: nextSeq(doc), color: app.mode === "beginner" ? nextColor() : BODY_COLORS[doc.bodies.length % BODY_COLORS.length], hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, Math.round(t.x / g) * g, Math.round(t.y / g) * g, 0, 1], node: { t: kind, asset: id, ...(k !== 1 ? { k } : {}), mods: [] } };
      doc.bodies.push(b);
    }, "Import " + name);
    app.select([bodyId]);
    if (data.length > 3e6) app.toast("This model is large: if saving in the browser fails, use Export → Save Project File to keep your design.");
    // big meshes take a few seconds to turn into a solid: say so, then say when it's there
    const t0 = Date.now();
    let told = false;
    const watch = setInterval(() => {
      const v = app.scene.views.get(bodyId), err = app.scene.errors && app.scene.errors.get(bodyId);
      if ((v && v.data) || err || Date.now() - t0 > 180000 || !store.doc.bodies.some((b) => b.id === bodyId)) {
        clearInterval(watch);
        if (v && v.data && Date.now() - t0 > 2500) app.toast(name + " is ready.");
      } else if (Date.now() - t0 > 1500 && !told) { told = true; app.toast("Preparing " + name + "… larger models can take up to a minute."); }
    }, 500);
    return bodyId;
  }
  function importStlCmd(mesh, name, fileName, ntOrig, info = {}) {
    const b = meshBounds(mesh);
    const st = { unit: "mm" };
    const K = { mm: 1, cm: 10, in: 25.4 };
    const fromFile = !!info.unitFromFile; // 3MF: the file says its units (already turned into mm)
    // a tiny STL is probably in inches or centimetres; a huge one in micrometres is rare
    if (!fromFile && Math.max(...b.size) < 6) st.unit = "in";
    const rep = info.report || {};
    const fixes = [];
    if (rep.flipped) fixes.push(`turned ${rep.flipped.toLocaleString()} inside-out triangle${rep.flipped > 1 ? "s" : ""} the right way`);
    if (rep.dupes) fixes.push(`removed ${rep.dupes.toLocaleString()} duplicate triangle${rep.dupes > 1 ? "s" : ""}`);
    if (rep.degenerate) fixes.push(`removed ${rep.degenerate.toLocaleString()} squashed triangle${rep.degenerate > 1 ? "s" : ""}`);
    if (rep.filled) fixes.push(`closed ${rep.filled} small hole${rep.filled > 1 ? "s" : ""}`);
    const def = {
      title: "Import " + (info.format || "STL"),
      valid: () => true,
      canOk: () => true,
      ok() { closeCmd(false); addImported({ kind: "mesh", bytes: packMesh(mesh), name, k: K[st.unit] }); },
      hint: () => "Pick the units the file was made in, then OK.",
      build(body) {
        const nt = mesh.I.length / 3;
        body.append(el("div", { class: "hint", style: { padding: 0 } }, el("b", {}, fileName), ` · ${nt.toLocaleString()} triangles`));
        const hint = (...c) => body.append(el("div", { class: "hint", style: { padding: 0 } }, ...c));
        if (info.parts > 1) hint(`${info.parts} parts, placed as in the file.`);
        if (ntOrig > nt) hint(`Simplified from ${ntOrig.toLocaleString()} triangles so it stays quick to edit. Largest change: about ${withUnit(info.err * K[st.unit], 2)}.`);
        if (fromFile) hint(`Units come from the file (${info.unitFromFile}${info.unitFromFile === "millimeter" ? "" : ", converted to mm"}). Change them only if the size looks wrong.`);
        body.append(row("File units", seg([["mm", "mm"], ["cm", "cm"], ["in", "inches"]], st.unit, (v) => { st.unit = v; def.render(); }, "imp-unit")));
        const s = b.size.map((v) => v * K[st.unit]);
        hint(`Size: ${s.map((v) => showLen(v, 1)).join(" × ")} ${getUnit()}`);
        if (fixes.length) hint("Repaired: " + fixes.join(", ") + ".");
        if (rep.open) hint(el("b", {}, "Not closed: "), `${rep.open.toLocaleString()} open edge${rep.open > 1 ? "s" : ""}. It will come in as a surface you can see and export, but not cut or fillet. Try fixing the file, or the Mesh to STEP Helper.`);
        else hint(el("b", {}, "Closed solid: "), "It comes in as a solid you can move, scale, group and cut holes in.");
        if (rep.nonManifold) hint(`${rep.nonManifold.toLocaleString()} edge${rep.nonManifold > 1 ? "s are" : " is"} shared by more than two triangles (touching parts). It may not build cleanly.`);
        if (info.bytes && app.meshstep) body.append(el("button", { class: "btn", id: "imp-tostep", style: { marginTop: "8px", width: "100%" }, title: "Turn the mesh into smooth, editable CAD faces (planes, cylinders, fillets) first", onclick: () => { closeCmd(false); app.meshstep.open({ bytes: info.bytes, name: fileName }); } }, "Convert to CAD faces in Mesh to STEP…"));
      },
      handler: { down: () => false, hover() {} },
    };
    openCmd(def);
  }
  // inserting outside a sketch starts one on the XY (top) plane
  function ensureSketch() {
    if (sketcher.active) return;
    makeSketch(ORIGIN_PLANES.XY, null);
    app.toast("Started a sketch on the top (XY) plane for it.");
  }
  function insertCurvesCmd(curves, name, type, skipped) {
    const b = curvesBounds(curves);
    const st = { w: +b.w.toFixed(3), center: true };
    const aspect = b.w > 1e-9 ? b.h / b.w : 1;
    const sketchId = sketcher.active;
    const def = {
      title: "Insert " + type.toUpperCase(),
      keepSelection: true,
      valid: () => st.w > 1e-6,
      canOk: () => def.valid(),
      apply(doc) {
        const sk = findSketch(doc, sketchId);
        if (!sk) return;
        const k = b.w > 1e-9 ? st.w / b.w : 1;
        const ox = st.center ? -(b.x0 + b.x1) / 2 : 0, oy = st.center ? -(b.y0 + b.y1) / 2 : 0;
        const T = (q) => [(q[0] + ox) * k, (q[1] + oy) * k];
        const mapped = curves.map((c) => c.t === "line" ? { t: "line", a: T(c.a), b: T(c.b) } : c.t === "circle" ? { t: "circle", c: T(c.c), r: c.r * k } : c.t === "arc" ? { t: "arc", c: T(c.c), a: T(c.a), b: T(c.b) } : { t: "spline", pts: c.pts.map(T), closed: c.closed });
        addImportedCurves(sk, mapped, Math.max(1e-5, Math.max(b.w, b.h) * k * 1e-5));
      },
      ok() { commit(def, "Insert " + type.toUpperCase()); },
      hint: () => "Set the size, then OK. Closed outlines become profiles you can extrude.",
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, el("b", {}, name), ` · ${curves.length} curve${curves.length === 1 ? "" : "s"} · ${fmt(b.w, 2)} × ${fmt(b.h, 2)} mm as drawn`));
        if (skipped) body.append(el("div", { class: "hint", style: { padding: 0 } }, `${skipped} item${skipped > 1 ? "s" : ""} (text, blocks or hatches) were left out.`));
        const hIn = app.numField({ value: +(st.w * aspect).toFixed(3), id: "ins-h", min: 0.001, step: 1, onCommit: (v) => { st.w = aspect > 1e-9 ? v / aspect : v; wIn.setValue(+st.w.toFixed(3)); refresh(false); } });
        const wIn = app.numField({ value: st.w, id: "ins-w", min: 0.001, step: 1, onCommit: (v) => { st.w = v; hIn.setValue(+(v * aspect).toFixed(3)); refresh(false); } });
        body.append(row("Width", wIn, "ins-w"), row("Height", hIn, "ins-h"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ins-center", checked: st.center, onchange: (e) => { st.center = e.target.checked; refresh(false); } }), "Center on the sketch origin"));
      },
      start() { refresh(); },
      handler: { down: () => false, hover() {} },
    };
    function refresh(rerender = true) { if (rerender) def.render(); schedulePreview(def); }
    openCmd(def);
  }
  // ------------------------------------------------------------------ sketch picture
  // Size, place and turn a sketch's reference picture: drag its handles on the canvas (corners
  // scale evenly, sides stretch, the knob on top turns it, inside moves it), type the numbers,
  // or click two points on it and type the real distance between them.
  function insertImageCmd(img, name, opts) { pictureCmd(sketcher.active, { img, name, ...(opts || {}) }); }
  // Image on a face: point at a flat face of a body (or the workplane) and click; a sketch is
  // made on that face with the picture on it, sized to the face, ready to trace over by hand or
  // with Auto trace, then extrude, emboss or cut.
  function imageOnFaceCmd(img, name) {
    let hover = null;
    const def = {
      title: "Picture on a face",
      valid: () => false,
      hint: () => "Click a flat face of a body to put the picture on it, or click the ground for the workplane.",
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, el("b", {}, name), ` · ${img.w} × ${img.h} px`));
        body.append(el("div", { class: "hint", style: { padding: "4px 0" } }, "Point at a flat face: it lights up. The picture is sized to fit the face. After placing it you can trace it on the face."));
        body.append(el("button", { class: "btn", id: "imf-xy", style: { width: "100%" }, onclick: () => place(null) }, "Use the workplane (XY) instead"));
      },
      start() { scene.syncSketches(store.view); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, (b) => !b.hole);
          const ok = f && f.info && f.info.t === "PLANE" ? f : null;
          const k = ok ? ok.body + "#" + ok.face : null;
          if (k !== (hover && hover.body + "#" + hover.face)) { hover = ok; clearOv(); if (ok) drawFace(ok.base, ok.face, 0xe8a317); vp.request(); }
          vp.canvas.style.cursor = ok ? "copy" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole);
          if (f && f.info && f.info.t === "PLANE") place(f);
          else if (!f) place(null);
          else app.toast("Pick a flat face: pictures go on flat faces.");
          return true;
        },
      },
    };
    function place(f) {
      clearOv();
      closeCmd(false);
      let fit = null;
      if (f) {
        makeSketch(planeFromFace(f), f);
        // the face's size in the sketch: from its outline projected into the sketch
        const sk = findSketch(store.doc, sketcher.active);
        if (sk && sk.pts.length) {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const q of sk.pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
          const aspect = img.h / img.w, w = Math.min((x1 - x0) * 0.8, ((y1 - y0) * 0.8) / aspect);
          if (w > 0.01) fit = { w: +w.toFixed(3), cx: +((x0 + x1) / 2).toFixed(4), cy: +((y0 + y1) / 2).toFixed(4) };
        }
      } else makeSketch(ORIGIN_PLANES.XY, null);
      insertImageCmd(img, name, { fit, onFace: !!f });
    }
    openCmd(def);
  }
  function pictureCmd(sketchId, fresh) {
    const sk0 = findSketch(store.doc, sketchId);
    const cur = fresh ? null : sk0 && sk0.image;
    if (!fresh && !cur) return;
    const aspect = fresh ? fresh.img.h / fresh.img.w : cur.h / cur.w;
    const fit = fresh && fresh.fit;
    const w0 = fit ? fit.w : fresh ? Math.min(300, Math.max(20, +(fresh.img.natW * 0.2646).toFixed(1))) : cur.w;
    const st = { w: w0, h: fresh ? +(w0 * aspect).toFixed(4) : cur.h, cx: fit ? fit.cx : fresh ? 0 : cur.cx || 0, cy: fit ? fit.cy : fresh ? 0 : cur.cy || 0, rot: fresh ? 0 : cur.rot || 0, opacity: fresh ? (fresh.onFace ? 0.9 : 0.6) : cur.opacity ?? 0.6, keep: true, cal: null, trace: false };
    let drag = null, hot = null;
    const f = {};
    const def = {
      title: fresh ? "Insert image" : "Size & place picture",
      keepSelection: true,
      valid: () => st.w > 0 && st.h > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const sk = findSketch(doc, sketchId);
        if (!sk) return;
        const base = fresh ? { src: fresh.img.src, name: fresh.name } : sk.image;
        if (!base) return;
        sk.image = { ...base, w: +st.w.toFixed(4), h: +st.h.toFixed(4), cx: +st.cx.toFixed(4), cy: +st.cy.toFixed(4), rot: +st.rot.toFixed(3), opacity: st.opacity };
      },
      ok() {
        commit(def, fresh ? "Insert image" : "Size picture");
        if (st.trace) setTimeout(() => traceCmd(sketchId), 0);
        else if (fresh && fresh.onFace) app.toast("The picture is on the face. Trace over it with the sketch tools, or use Auto trace in the Sketch palette.");
      },
      hint: () => st.cal ? (st.cal.pts.length < 2 ? `Click point ${st.cal.pts.length + 1} of 2 on the picture (two ends of something you know the length of).` : "Type the real length between the two points.") : "Drag the corners to scale, the sides to stretch, the round knob to turn, or inside to move.",
      build(body) {
        if (fresh) body.append(el("div", { class: "hint", style: { padding: 0 } }, el("b", {}, fresh.name), ` · ${fresh.img.w} × ${fresh.img.h} px`));
        f.w = app.numField({ value: st.w, id: "img-w", len: true, min: 0.01, step: 5, onCommit: (v) => setSize(v, st.keep ? v * st.h / st.w : st.h) });
        f.h = app.numField({ value: st.h, id: "img-h", len: true, min: 0.01, step: 5, onCommit: (v) => setSize(st.keep ? v * st.w / st.h : st.w, v) });
        body.append(row("Width", f.w, "img-w"), row("Height", f.h, "img-h"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "img-keep", checked: st.keep, onchange: (e) => { st.keep = e.target.checked; } }), "Keep proportions"));
        const r3 = el("div", { class: "row3" });
        f.x = app.numField({ value: st.cx, id: "img-x", len: true, onCommit: (v) => { st.cx = v; changed(); } });
        f.y = app.numField({ value: st.cy, id: "img-y", len: true, onCommit: (v) => { st.cy = v; changed(); } });
        f.r = app.numField({ value: st.rot, id: "img-rot", angle: true, step: 1, onCommit: (v) => { st.rot = v; changed(); } });
        r3.append(el("label", {}, "X", f.x), el("label", {}, "Y", f.y), el("label", {}, "Turn °", f.r));
        body.append(r3);
        body.append(sliderRow("Opacity", "img-op", st.opacity * 100, 5, 100, 1, "%", (v) => { st.opacity = v / 100; schedulePreview(def); }));
        if (fresh) body.append(el("label", { class: "check", title: "Turn the picture's shapes into sketch outlines on this face as soon as it's placed (you can also trace by hand)" }, el("input", { type: "checkbox", id: "img-trace", checked: st.trace, onchange: (e) => { st.trace = e.target.checked; } }), "Auto trace it after placing"));
        // scale from a known length
        if (!st.cal) body.append(el("button", { class: "btn", id: "img-cal", style: { width: "100%", marginTop: "6px" }, title: "Click both ends of something in the picture whose real size you know, then type that size", onclick: () => { st.cal = { pts: [] }; def.render(); draw(); app.status(); } }, "Scale with a known length…"));
        else {
          const box = el("div", { class: "cal-box" });
          box.append(el("div", { class: "hint", style: { padding: 0 } }, st.cal.pts.length < 2 ? `Click point ${st.cal.pts.length + 1} of 2 on the picture.` : "Now type how long that really is:"));
          if (st.cal.pts.length === 2) {
            const [a, b] = st.cal.pts, meas = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const inp = app.numField({ value: meas, id: "img-cal-len", len: true, min: 0.001, onCommit: (v) => calApply(v) });
            box.append(row("Real length", inp, "img-cal-len"));
            setTimeout(() => { inp.focus(); inp.select(); }, 0);
          }
          box.append(el("button", { class: "btn", style: { marginTop: "4px" }, onclick: () => { st.cal = null; def.render(); draw(); app.status(); } }, "Cancel scaling"));
          body.append(box);
        }
      },
      start() { vp.labelFns.add(draw); changed(); vp.request(); },
      cleanup() { vp.labelFns.delete(draw); ov.remove(); },
      handler: {
        hover(e) { if (drag) return; hot = st.cal ? null : hitHandle(e); vp.canvas.style.cursor = st.cal ? "crosshair" : CURSORS[hot] || "default"; draw(); },
        down(e) {
          const raw = sketcher.to2d(e);
          if (!raw) return false;
          if (st.cal) {
            if (st.cal.pts.length >= 2) st.cal.pts = [];
            st.cal.pts.push(raw);
            def.render(); draw(); app.status();
            return true;
          }
          const h = hitHandle(e);
          if (h == null) return false;
          drag = { h, raw0: raw, s0: { ...st } };
          return true;
        },
        move(e) {
          if (!drag) return;
          const raw = sketcher.to2d(e);
          if (!raw) return;
          dragTo(drag, raw, e);
          changed(false);
        },
        up() { if (drag) { drag = null; def.render(); } },
      },
    };
    const CURSORS = { move: "move", rot: "grab", 0: "nesw-resize", 1: "nwse-resize", 2: "nesw-resize", 3: "nwse-resize", 4: "ns-resize", 5: "ew-resize", 6: "ns-resize", 7: "ew-resize" };
    function setSize(w, h) { st.w = Math.max(0.01, w); st.h = Math.max(0.01, h); changed(); }
    // live: fields follow, the picture follows (preview), the handles follow
    function changed(rebuild = true) {
      if (!rebuild) {
        f.w && f.w.setValue(+st.w.toFixed(3)); f.h && f.h.setValue(+st.h.toFixed(3));
        f.x && f.x.setValue(+st.cx.toFixed(3)); f.y && f.y.setValue(+st.cy.toFixed(3)); f.r && f.r.setValue(+st.rot.toFixed(2));
      } else def.render();
      schedulePreview(def); draw();
    }
    function calApply(v) {
      const [a, b] = st.cal.pts, meas = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (meas < 1e-9) return;
      const k = v / meas;
      st.w *= k; st.h *= k;
      st.cx = a[0] + (st.cx - a[0]) * k; st.cy = a[1] + (st.cy - a[1]) * k;
      st.cal = null;
      app.toast(`Picture scaled ×${+k.toFixed(3)} so that length is ${withUnit(v, 3)}.`);
      changed(); app.status();
    }
    // picture frame in sketch coordinates
    const frameOf = (s) => {
      const r = (s.rot * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
      const P = (x, y) => [s.cx + x * c - y * sn, s.cy + x * sn + y * c];
      const toLocal = (q) => { const dx = q[0] - s.cx, dy = q[1] - s.cy; return [dx * c + dy * sn, -dx * sn + dy * c]; };
      return { P, toLocal, c, sn };
    };
    const SG = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]]; // corners, then side middles
    function screenPts() {
      const sk = findSketch(store.view, sketchId) || sk0;
      if (!sk) return null;
      const M = planeMatrix(sk.plane), fr = frameOf(st), px = sketcher.px ? sketcher.px() : 1;
      const S = (q) => { const p = vp.project(new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M)); return [p[0], p[1]]; };
      const hs = SG.map(([sx, sy]) => S(fr.P((sx * st.w) / 2, (sy * st.h) / 2)));
      const top = S(fr.P(0, st.h / 2)), knob = S(fr.P(0, st.h / 2 + 26 * px));
      return { hs, top, knob, S };
    }
    function hitHandle(e) {
      const sp = screenPts(); if (!sp) return null;
      const m = vp.local(e), R = matchMedia("(pointer: coarse)").matches ? 16 : 9;
      const near = (q) => Math.hypot(q[0] - m[0], q[1] - m[1]) <= R;
      if (near(sp.knob)) return "rot";
      for (let i = 0; i < 4; i++) if (near(sp.hs[i])) return i;
      for (let i = 4; i < 8; i++) if (near(sp.hs[i])) return i;
      // inside the picture
      const raw = sketcher.to2d(e); if (!raw) return null;
      const l = frameOf(st).toLocal(raw);
      if (Math.abs(l[0]) <= st.w / 2 && Math.abs(l[1]) <= st.h / 2) return "move";
      return null;
    }
    function dragTo(d, raw, e) {
      const s0 = d.s0, fr = frameOf(s0), h = d.h;
      if (h === "move") { st.cx = s0.cx + raw[0] - d.raw0[0]; st.cy = s0.cy + raw[1] - d.raw0[1]; return; }
      if (h === "rot") {
        let a = (Math.atan2(raw[1] - s0.cy, raw[0] - s0.cx) * 180) / Math.PI - 90;
        a = e.shiftKey ? Math.round(a / 15) * 15 : Math.round(a);
        st.rot = ((a % 360) + 540) % 360 - 180; return;
      }
      const [gx, gy] = SG[h];
      // the opposite corner or side stays put
      const anchor = fr.P((-gx * s0.w) / 2, (-gy * s0.h) / 2);
      const dx = raw[0] - anchor[0], dy = raw[1] - anchor[1];
      const lx = dx * fr.c + dy * fr.sn, ly = -dx * fr.sn + dy * fr.c;
      let w = s0.w, hh = s0.h;
      if (gx && gy) {
        w = Math.max(0.01, lx * gx); hh = Math.max(0.01, ly * gy);
        if (st.keep !== e.shiftKey) { const k = Math.max(0.001, (w * s0.w + hh * s0.h) / (s0.w * s0.w + s0.h * s0.h)); w = s0.w * k; hh = s0.h * k; }
      } else if (gx) { w = Math.max(0.01, lx * gx); if (st.keep && !e.shiftKey) hh = (w * s0.h) / s0.w; }
      else { hh = Math.max(0.01, ly * gy); if (st.keep && !e.shiftKey) w = (hh * s0.w) / s0.h; }
      st.w = w; st.h = hh;
      const ox = gx ? (gx * w) / 2 : 0, oy = gy ? (gy * hh) / 2 : 0;
      // the new center: from the fixed corner (or the middle of the fixed side) out by half the size
      st.cx = anchor[0] + ox * fr.c - oy * fr.sn;
      st.cy = anchor[1] + ox * fr.sn + oy * fr.c;
    }
    // the outline, handles and the measuring line, drawn over the 3D view
    const NS = "http://www.w3.org/2000/svg";
    const ov = document.createElementNS(NS, "svg");
    ov.setAttribute("class", "pic-ov");
    vpEl.append(ov);
    function draw() {
      const sp = screenPts();
      if (!sp || app.command !== def) { ov.innerHTML = ""; return; }
      const pt = (q) => q.map((v) => v.toFixed(1)).join(",");
      let h = `<polygon class="pic-frame" points="${sp.hs.slice(0, 4).map(pt).join(" ")}"/>`;
      if (!st.cal) {
        h += `<line class="pic-stem" x1="${sp.top[0]}" y1="${sp.top[1]}" x2="${sp.knob[0]}" y2="${sp.knob[1]}"/>`;
        h += `<circle class="pic-knob${hot === "rot" ? " hot" : ""}" cx="${sp.knob[0]}" cy="${sp.knob[1]}" r="6"/>`;
        sp.hs.forEach((q, i) => { const s = i < 4 ? 5 : 4; h += `<rect class="pic-h${hot === i ? " hot" : ""}" x="${q[0] - s}" y="${q[1] - s}" width="${2 * s}" height="${2 * s}"/>`; });
      } else {
        const P = st.cal.pts.map(sp.S);
        if (P.length === 2) h += `<line class="pic-cal" x1="${P[0][0]}" y1="${P[0][1]}" x2="${P[1][0]}" y2="${P[1][1]}"/>`;
        for (const q of P) h += `<circle class="pic-calpt" cx="${q[0]}" cy="${q[1]}" r="5"/>`;
      }
      ov.innerHTML = h;
    }
    openCmd(def);
  }

  // Auto trace: the picture's dark (or light) parts become closed sketch outlines to extrude
  function traceCmd(sketchId) {
    const sk0 = findSketch(store.doc, sketchId), im = sk0 && sk0.image;
    if (!im) return;
    const st = { thr: null, part: "dark", detail: "medium", specks: 0.2, smooth: true, fade: true, colours: 4 };
    let img = null, res = null, curves = [], busy = true, autoThr = 128, pic = null;
    // v2.9.9.9.10: the picture is read bigger for more detail, and the outlines are placed to a
    // fraction of a pixel (so the same tolerance in the picture's own size is finer)
    const RES = { low: 640, medium: 1000, high: 1400 }, TOL = { low: 2.2, medium: 1.1, high: 0.55 };
    const tolFor = (d) => TOL[d] * (RES[d] / 640) * 0.8;
    const def = {
      title: "Auto trace picture",
      keepSelection: true,
      valid: () => curves.length > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const sk = findSketch(doc, sketchId);
        if (!sk || !curves.length) return;
        addImportedCurves(sk, curves, Math.max(1e-5, Math.max(im.w, im.h) * 1e-5));
        if (st.fade && sk.image) sk.image.opacity = Math.min(sk.image.opacity ?? 0.6, 0.3);
      },
      ok() {
        const sk0 = findSketch(store.doc, sketchId), loops0 = new Set(sk0 ? userLoops(sk0).map((l) => l.key) : []);
        commit(def, "Auto trace");
        app.toast(`Traced ${res.rings.length} outline${res.rings.length === 1 ? "" : "s"}. Closed ones shade blue: they're ready to extrude.`);
        // Beginner: like drawing a closed shape, Extrude opens with the traced shapes picked
        const sk1 = findSketch(store.doc, sketchId);
        if (sk1 && app.onShapeClosed) {
          const loops = new Set(userLoops(sk1).filter((l) => !loops0.has(l.key)).map((l) => "u:" + l.key));
          const regs = regionsFor(sk1), own = regionOwners(sk1);
          const fresh = regs.filter((r, i) => loops.has(own[i])).map((r) => r.key);
          if (fresh.length) app.onShapeClosed(sketchId, fresh);
        }
      },
      hint: () => "Closed outlines become profiles you can extrude.",
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Turns the picture's shapes into sketch lines. Works best with a clear, high-contrast picture such as a logo or a drawing."));
        body.append(row("Trace", seg([["dark", "Dark parts"], ["light", "Light parts"], ["colours", "Each colour"]], st.part, (v) => { st.part = v; retrace(); def.render(); }, "tr-part"), "tr-part"));
        if (st.part === "colours") {
          body.append(sliderRow("Colours", "tr-colours", st.colours, 2, 8, 1, "", (v) => { st.colours = v; retraceSoon(); }));
          if (res && res.palette) body.append(el("div", { class: "hint", id: "tr-palette", style: { padding: 0, display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" } }, "Found:", ...res.palette.map((c) => el("span", { title: c === res.background ? c + " (the background, left out)" : c, style: { width: "16px", height: "16px", borderRadius: "4px", background: c, border: "1px solid var(--line)", opacity: c === res.background ? 0.35 : 1 } }))));
        } else {
          const thrPct = Math.round(((st.thr ?? autoThr) / 255) * 100);
          body.append(sliderRow("Threshold", "tr-thr", thrPct, 1, 99, 1, "%", (v) => { st.thr = (v / 100) * 255; retraceSoon(); }));
        }
        body.append(row("Detail", seg([["low", "Low"], ["medium", "Medium"], ["high", "High"]], st.detail, (v) => { st.detail = v; readAt(); retrace(); }, "tr-detail"), "tr-detail"));
        body.append(sliderRow("Ignore specks", "tr-specks", st.specks * 10, 0, 50, 1, "", (v) => { st.specks = v / 10; retraceSoon(); }));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "tr-smooth", checked: st.smooth, onchange: (e) => { st.smooth = e.target.checked; remap(); } }), "Smooth curves (off: straight lines only)"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "tr-fade", checked: st.fade, onchange: (e) => { st.fade = e.target.checked; schedulePreview(def); } }), "Fade the picture afterwards"));
        if (st.part !== "colours") body.append(el("button", { class: "btn", style: { width: "100%", marginTop: "4px" }, onclick: () => { st.thr = null; retrace(); } }, "Automatic threshold"));
        body.append(el("button", { class: "btn", id: "tr-to3d", style: { width: "100%", marginTop: "4px" }, title: "Puff the picture's subject up into a rounded 3D model instead", onclick: () => { closeCmd(false); puffyCmd(sketchId); } }, "Make a 3D model from the picture instead…"));
        body.append(el("div", { class: "hint", id: "tr-info", style: { padding: "6px 0 0" } }, info()));
      },
      start() { load(); },
      handler: { down: () => false, hover() {} },
    };
    function info() {
      if (busy) return "Reading the picture…";
      if (!res) return "";
      if (!res.rings.length) return "Nothing to trace at this threshold. Try moving the slider or tracing the light parts.";
      const n = res.rings.reduce((a, r) => a + r.length, 0);
      return `${res.rings.length} outline${res.rings.length === 1 ? "" : "s"} · ${curves.length} curves · ${n} points · read at ${res.W}×${res.H}` + (res.dropped ? ` (the ${res.dropped} smallest were left out)` : "");
    }
    function load() {
      pic = new Image();
      pic.onload = () => { readAt(); busy = false; retrace(); };
      pic.onerror = () => { busy = false; app.toast("That picture couldn't be read for tracing.", "err"); };
      pic.src = im.src;
    }
    function readAt() {
      if (!pic || !pic.naturalWidth) return;
      const k = Math.min(1, RES[st.detail] / Math.max(pic.naturalWidth, pic.naturalHeight));
      const W = Math.max(8, Math.round(pic.naturalWidth * k)), H = Math.max(8, Math.round(pic.naturalHeight * k));
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const g = cv.getContext("2d", { willReadFrequently: true });
      g.drawImage(pic, 0, 0, W, H);
      img = g.getImageData(0, 0, W, H);
    }
    let tmr = 0;
    function retraceSoon() { clearTimeout(tmr); tmr = setTimeout(retrace, 120); }
    function retrace() {
      if (!img || app.command !== def) return;
      const pal = res && res.palette ? res.palette.join() : "";
      res = traceImage(img, { thr: st.thr, part: st.part, tol: tolFor(st.detail), minArea: st.specks / 100, colours: st.colours });
      if (st.thr == null && res.threshold != null) autoThr = res.threshold;
      remap(true);
      if (st.part === "colours" && res.palette && res.palette.join() !== pal) def.render();
    }
    function remap(rerender = false) {
      if (!res) return;
      curves = curvesFor(res, im, st.smooth);
      if (rerender) def.render(); else { const i = $("tr-info"); if (i) i.textContent = info(); }
      schedulePreview(def);
      def.refreshOk && def.refreshOk();
    }
    openCmd(def);
  }
  // Picture → 3D model (v2.9.8.9.5): cut the subject out (automatic, or by picking its colours,
  // refined with keep / remove brushes), give it a real thickness (each limb, leg, stem or tail
  // round on its own), and carve it to match any side, back or top pictures too. A turning 3D
  // preview shows the result before OK; the main picture is painted on. Not an AI
  // reconstruction: the more views, the closer it gets to the real thing.
  function puffyCmd(sketchId) {
    const sk0 = findSketch(store.doc, sketchId), im = sk0 && sk0.image;
    if (!im) return;
    const P0 = PHOTO_PRESETS.animal;
    const st = { preset: "animal", mode: "auto", sens: 30, thr: 50, grow: 0, smooth: 2, keepHoles: false, allPieces: false, fg: [], bg: [], seeds: [], strokes: [],
      tool: "view", brush: 10, height: 60, profile: P0.profile, thick: P0.thick, maxT: P0.maxT, back: P0.back, flatBack: P0.flatBack, relief: P0.relief, round: P0.round, tsmooth: P0.smooth, res: "normal", paint: true };
    const RES = { draft: 64, normal: 96, fine: 132, extra: 170 };
    const views = {}; // side / back / top: { img, mask, sens, faces | front }
    let img = null, mask = null, busy = true;
    const prev = el("canvas", { class: "puffy-prev", id: "pf-cut", width: 300, height: 210, style: { touchAction: "none", cursor: "crosshair" } });
    const p3 = el("canvas", { class: "puffy-prev", id: "pf-3d", width: 300, height: 220, title: "Drag to turn the model", style: { touchAction: "none" } });
    const def = {
      title: "Picture to 3D model",
      keepSelection: true,
      valid: () => !!(mask && maskBox(mask, img.width, img.height)),
      canOk: () => def.valid(),
      apply() {},
      ok() {
        let res;
        try { res = buildModel(viewSet(), shapeOpts(RES[st.res])); }
        catch (err) { app.toast(err.message, "err"); return; }
        let mesh = { V: res.V, I: res.I };
        if (mesh.I.length / 3 > MESH_LIMIT) mesh = simplify(mesh, MESH_LIMIT).mesh;
        closeCmd(false);
        const base = (im.name || "Picture").replace(/\.[^.]+$/, "");
        const id = addImported({ kind: "mesh", bytes: packMesh(mesh), name: "3D " + base, k: 1 });
        const mid = uid("md");
        store.update((doc) => {
          const b = doc.bodies.find((x) => x.id === id);
          if (!b) return;
          b.color = res.color;
          if (st.paint) {
            doc.media = doc.media || {};
            doc.media[mid] = { kind: "image", name: im.name || "picture", src: im.src, w: img.width, h: img.height };
            b.media = { id: mid, map: "front", dir: [0, 1, 0], up: [0, 0, 1], both: !views.back, crop: res.crop, rep: 1, rot: 0, mirror: false };
          }
          const s = doc.sketches.find((x) => x.id === sketchId); if (s) s.hidden = true;
        }, "Paint picture on");
        if (sketcher.active) app.exitSketch && app.exitSketch();
        stop3d();
        const more = res.views.length ? ` Matched to ${res.views.length + 1} pictures.` : "";
        app.toast(`Made a 3D model, ${res.size.map((v) => showLen(v, 0)).join(" × ")} ${getUnit()}.${more} It's a real solid: you can print it.${st.paint ? " The picture is painted on (Media)." : ""}`);
      },
      cleanup() { stop3d(); },
      hint: () => "Refine the cut-out and the shape, check the 3D preview, then OK.",
      build(body) {
        const sub = (t) => el("div", { class: "pf-sub", style: { fontWeight: "700", margin: "10px 0 2px" } }, t);
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Cuts the subject out and gives it a real 3D shape. Add a side, back or top picture to match the real thing more closely. The 3D preview updates as you go."));
        body.append(sub("What is it?"));
        body.append(el("div", { class: "seg wrap", id: "pf-preset" }, ...Object.entries(PHOTO_PRESETS).map(([k, p]) => el("button", { "aria-pressed": st.preset === k, id: "pf-pre-" + k, title: p.tip, onclick: () => setPreset(k) }, p.label))));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, PHOTO_PRESETS[st.preset].tip));
        // the cut-out
        body.append(sub("Cut-out"));
        body.append(row("Find it by", seg([["auto", "Auto"], ["pick", "Picked colours"], ["dark", "Dark"], ["light", "Light"]], st.mode, (v) => { st.mode = v; if (v === "pick") st.tool = "fg"; def.render(); recut(); }, "pf-mode"), "pf-mode"));
        if (st.mode === "auto" || st.mode === "pick") body.append(sliderRow(st.mode === "pick" ? "Colour range" : "Sensitivity", "pf-sens", st.sens, 0, 100, 1, "%", (v) => { st.sens = v; recutSoon(); }));
        else body.append(sliderRow("Threshold", "pf-thr", st.thr, 1, 99, 1, "%", (v) => { st.thr = v; recutSoon(); }));
        body.append(prev);
        body.append(row("Tap the picture to", seg([["view", "Look"], ["keep", "Keep brush"], ["remove", "Remove brush"], ["fg", "Pick subject"], ["bg", "Pick background"]], st.tool, (v) => { st.tool = v; def.render(); }, "pf-tool"), "pf-tool"));
        if (st.tool === "keep" || st.tool === "remove") body.append(sliderRow("Brush size", "pf-brush", st.brush, 2, 60, 1, "px", (v) => { st.brush = v; }));
        body.append(el("div", { class: "btnrow", style: { display: "flex", gap: "4px", flexWrap: "wrap" } },
          el("button", { class: "btn", id: "pf-undo-stroke", disabled: !(st.strokes.length || st.fg.length || st.bg.length) || null, onclick: () => { if (st.strokes.length) st.strokes.pop(); else if (st.fg.length) { st.fg.pop(); st.seeds.pop(); } else st.bg.pop(); def.render(); recut(); } }, "Undo mark"),
          el("button", { class: "btn", id: "pf-clear-strokes", onclick: () => { st.strokes = []; st.fg = []; st.bg = []; st.seeds = []; def.render(); recut(); } }, "Clear marks")));
        body.append(sliderRow("Grow / shrink edge", "pf-grow", st.grow, -12, 12, 1, "px", (v) => { st.grow = v; recutSoon(); }));
        body.append(sliderRow("Smooth edge", "pf-smooth", st.smooth, 0, 6, 1, "", (v) => { st.smooth = v; recutSoon(); }));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pf-holes", checked: st.keepHoles || null, onchange: (e) => { st.keepHoles = e.target.checked; recut(); } }), "Keep holes (handles, gaps between legs)"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pf-pieces", checked: st.allPieces || null, onchange: (e) => { st.allPieces = e.target.checked; recut(); } }), "Keep every piece, not just the biggest"));
        body.append(el("div", { class: "hint", id: "pf-info", style: { padding: 0 } }, busy ? "Reading the picture…" : info()));
        // more pictures
        body.append(sub("More pictures (optional)"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "The same subject from other sides, each showing all of it. Each one carves the model to match."));
        for (const [k, name] of [["side", "Side"], ["back", "Back"], ["top", "Top"]]) {
          const v = views[k];
          const file = el("input", { type: "file", accept: "image/*", id: "pf-file-" + k, style: { display: "none" }, onchange: (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) loadView(k, f); } });
          const line = el("div", { class: "row", id: "pf-view-" + k, style: { alignItems: "center" } }, el("label", {}, name + " view"), file,
            v ? viewThumb(v) : null,
            el("button", { class: "btn", id: "pf-add-" + k, onclick: () => file.click() }, v ? "Change…" : "Add…"),
            v ? el("button", { class: "btn", id: "pf-rm-" + k, onclick: () => { delete views[k]; def.render(); preview3d(); } }, "Remove") : null);
          body.append(line);
          if (v) {
            body.append(sliderRow(name + " cut-out", "pf-vsens-" + k, v.sens, 0, 100, 1, "%", (x) => { v.sens = x; recutView(k); }));
            if (k === "side") body.append(row("Its front is on the", seg([["left", "Left"], ["right", "Right"]], v.faces, (x) => { v.faces = x; def.render(); preview3d(); }, "pf-faces"), "pf-faces"));
            if (k === "top") body.append(row("Its front is at the", seg([["bottom", "Bottom"], ["top", "Top"]], v.front, (x) => { v.front = x; def.render(); preview3d(); }, "pf-topfront"), "pf-topfront"));
          }
        }
        // the shape
        body.append(sub("Shape"));
        body.append(row("Height", app.numField({ value: st.height, id: "pf-h", len: true, min: 5, max: 1000, step: 5, onCommit: (v) => { st.height = v; preview3dSoon(); } }), "pf-h"));
        const multi = views.side || views.top;
        if (!multi) {
          body.append(row("Cross-section", el("tool-choice", { id: "pf-profile", onchange: (e) => { st.profile = e.target.value; custom(); preview3dSoon(); } }, ...PHOTO_PROFILES.map(([k, n]) => el("option", { value: k, selected: st.profile === k || null }, n))), "pf-profile"));
          body.append(sliderRow("Thickness", "pf-puff", st.thick, 10, 250, 5, "%", (v) => { st.thick = v; custom(); preview3dSoon(); }));
          body.append(sliderRow("Max thickness", "pf-maxt", st.maxT, 0, 200, 1, getUnit() === "in" ? "mm" : "mm (0: no limit)", (v) => { st.maxT = v; custom(); preview3dSoon(); }));
          body.append(sliderRow("Back depth", "pf-back", st.back, 0, 150, 5, "%", (v) => { st.back = v; custom(); preview3dSoon(); }));
          body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pf-flat", checked: st.flatBack || null, onchange: (e) => { st.flatBack = e.target.checked; custom(); preview3dSoon(); } }), "Flat back (for wall art, magnets, plaques)"));
        } else body.append(el("div", { class: "hint", style: { padding: 0 } }, "The depth comes from the " + (views.side ? "side" : "top") + " picture."));
        body.append(sliderRow("Surface detail", "pf-detail", st.relief, 0, 100, 5, "%", (v) => { st.relief = v; custom(); preview3dSoon(); }));
        body.append(sliderRow("Smooth shape", "pf-tsmooth", st.tsmooth, 0, 8, 1, "", (v) => { st.tsmooth = v; custom(); preview3dSoon(); }));
        body.append(sliderRow("Round the edges", "pf-round", st.round, 0, 6, 1, "", (v) => { st.round = v; custom(); preview3dSoon(); }));
        body.append(row("Detail", seg([["draft", "Draft"], ["normal", "Normal"], ["fine", "Fine"], ["extra", "Extra fine"]], st.res, (v) => { st.res = v; def.render(); preview3dSoon(); }, "pf-res"), "pf-res"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pf-paint", checked: st.paint, onchange: (e) => { st.paint = e.target.checked; } }), "Paint the picture on it"));
        body.append(sub("3D preview"));
        body.append(p3, el("div", { class: "hint", id: "pf-3dinfo", style: { padding: 0 } }, ""));
        drawPrev();
      },
      start() { load(); },
      handler: { down: () => false, hover() {} },
    };
    function custom() { if (st.preset !== "custom") { st.preset = "custom"; const b = document.querySelectorAll("#pf-preset button"); b.forEach((x) => x.setAttribute("aria-pressed", x.id === "pf-pre-custom")); } }
    function setPreset(k) {
      st.preset = k; const p = PHOTO_PRESETS[k];
      if (k !== "custom") Object.assign(st, { profile: p.profile, thick: p.thick, maxT: p.maxT, back: p.back, flatBack: p.flatBack, relief: p.relief, round: p.round, tsmooth: p.smooth });
      def.render(); preview3d();
    }
    function info() {
      if (!mask) return "";
      const b = maskBox(mask, img.width, img.height);
      if (!b) return "No subject found. Try another way to find it, or paint it in with the Keep brush.";
      return st.mode === "pick" && !st.fg.length ? "Tap the subject in the picture to pick its colours (tap a few spots for a multi-coloured subject)." : "Checkered = cut away. Fix mistakes with the Keep and Remove brushes.";
    }
    const viewSet = () => ({ front: { img, mask }, ...views });
    function shapeOpts(res) { return { height: st.height, profile: st.profile, thick: st.thick, maxT: st.maxT, back: st.back, flatBack: st.flatBack, relief: st.relief, round: st.round, smooth: st.tsmooth, res }; }
    function readPic(src, max = 420) {
      return new Promise((res, rej) => {
        const pic = new Image();
        pic.onload = () => res(photoShrink(pic, max));
        pic.onerror = () => rej(new Error("That picture couldn't be read."));
        pic.src = src;
      });
    }
    function load() {
      readPic(im.src).then((d) => { img = d; busy = false; recut(); }).catch((e) => { busy = false; app.toast(e.message, "err"); });
    }
    async function loadView(k, f) {
      const url = URL.createObjectURL(f);
      try {
        const d = await readPic(url, 300);
        views[k] = { img: d, mask: null, sens: 30, faces: (views[k] && views[k].faces) || "left", front: (views[k] && views[k].front) || "bottom" };
        recutView(k, true);
        def.render(); preview3d();
      } catch (e) { app.toast(e.message, "err"); }
      finally { URL.revokeObjectURL(url); }
    }
    function recutView(k, quiet) {
      const v = views[k]; if (!v) return;
      v.mask = cutOut(v.img, { mode: "auto", sens: v.sens, smooth: 2 });
      const t = document.getElementById("pf-thumb-" + k); if (t) drawThumb(t, v);
      if (!quiet) preview3dSoon();
    }
    function viewThumb(v) { const k = Object.keys(views).find((x) => views[x] === v); const c = el("canvas", { id: "pf-thumb-" + k, width: 64, height: 48, style: { border: "1px solid var(--line)", borderRadius: "4px" } }); drawThumb(c, v); return c; }
    function drawThumb(c, v) { drawCut(c, v.img, v.mask); }
    let tmr = 0;
    function recutSoon() { clearTimeout(tmr); tmr = setTimeout(recut, 120); }
    function recut() {
      if (!img || app.command !== def) return;
      mask = cutOut(img, { mode: st.mode, sens: st.sens, thr: (st.thr / 100) * 255, grow: st.grow, smooth: st.smooth, keepHoles: st.keepHoles, allPieces: st.allPieces, fg: st.fg, bg: st.bg, seeds: st.seeds, strokes: st.strokes });
      drawPrev();
      const i = $("pf-info"); if (i) i.textContent = info();
      const u = $("pf-undo-stroke"); if (u) u.disabled = !(st.strokes.length || st.fg.length || st.bg.length);
      def.refreshOk && def.refreshOk();
      preview3dSoon();
    }
    // the cut-out on a checkerboard (and where it maps, for the brush)
    let fit = null;
    function drawCut(c, im2, m) {
      const g = c.getContext("2d"), W = c.width, H = c.height, s = Math.max(4, Math.round(W / 30));
      for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) { g.fillStyle = ((x + y) / s) % 2 ? "#d9dde2" : "#f3f5f7"; g.fillRect(x, y, s, s); }
      if (!im2) return null;
      const t = document.createElement("canvas"); t.width = im2.width; t.height = im2.height;
      const id = new ImageData(new Uint8ClampedArray(im2.data), im2.width, im2.height);
      if (m) for (let i = 0; i < m.length; i++) if (!m[i]) id.data[i * 4 + 3] = 40;
      t.getContext("2d").putImageData(id, 0, 0);
      const k = Math.min(W / im2.width, H / im2.height), w = im2.width * k, h = im2.height * k, ox = (W - w) / 2, oy = (H - h) / 2;
      g.drawImage(t, ox, oy, w, h);
      return { k, ox, oy };
    }
    function drawPrev() {
      fit = drawCut(prev, img, mask);
      if (!fit) return;
      const g = prev.getContext("2d");
      for (const [x, y] of st.seeds) { g.strokeStyle = "#0a8f3a"; g.lineWidth = 2; g.beginPath(); g.arc(fit.ox + x * fit.k, fit.oy + y * fit.k, 5, 0, 7); g.stroke(); }
      for (const [x, y] of st.bgPts || []) { g.strokeStyle = "#c82020"; g.lineWidth = 2; g.beginPath(); g.arc(fit.ox + x * fit.k, fit.oy + y * fit.k, 5, 0, 7); g.stroke(); }
    }
    // marking the picture: brushes and colour picks
    let stroke = null;
    const toImg = (e) => { const r = prev.getBoundingClientRect(), cx = ((e.clientX - r.left) * prev.width) / r.width, cy = ((e.clientY - r.top) * prev.height) / r.height; return [(cx - fit.ox) / fit.k, (cy - fit.oy) / fit.k]; };
    prev.addEventListener("pointerdown", (e) => {
      if (!img || !fit || st.tool === "view") return;
      e.preventDefault(); prev.setPointerCapture(e.pointerId);
      const [x, y] = toImg(e);
      if (st.tool === "fg" || st.tool === "bg") {
        const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) return;
        const c = photoColorAt(img, xi, yi);
        if (st.tool === "fg") { st.fg.push(c); st.seeds.push([xi, yi]); if (st.mode !== "pick") st.mode = "pick"; }
        else { st.bg.push(c); (st.bgPts = st.bgPts || []).push([xi, yi]); }
        def.render(); recut(); return;
      }
      stroke = { keep: st.tool === "keep", r: st.brush / fit.k * 0.5 + 1, pts: [[x, y]] };
      st.strokes.push(stroke); recut();
    });
    prev.addEventListener("pointermove", (e) => { if (!stroke) return; stroke.pts.push(toImg(e)); recutSoon(); });
    const endStroke = () => { if (stroke) { stroke = null; recut(); } };
    prev.addEventListener("pointerup", endStroke); prev.addEventListener("pointercancel", endStroke);
    // ---- the 3D preview
    let R3 = null, mesh3 = null, spin = 0.6, raf3 = 0, drag3 = null, t3 = 0, gen = 0;
    function ensure3d() {
      if (R3) return;
      try {
        const r = new THREE.WebGLRenderer({ canvas: p3, antialias: true, alpha: true });
        r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.setSize(p3.width, p3.height, false);
        const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, p3.width / p3.height, 1, 100000);
        sc.add(new THREE.HemisphereLight("#ffffff", "#7a8494", 1.6)); const dl = new THREE.DirectionalLight("#ffffff", 1.8); dl.position.set(-1, -2, 3); sc.add(dl);
        R3 = { r, sc, cam };
      } catch (e) { R3 = null; }
      p3.addEventListener("pointerdown", (e) => { drag3 = e.clientX; p3.setPointerCapture(e.pointerId); });
      p3.addEventListener("pointermove", (e) => { if (drag3 == null) return; spin += (e.clientX - drag3) * 0.01; drag3 = e.clientX; });
      p3.addEventListener("pointerup", () => { drag3 = null; });
      const loop = () => { raf3 = requestAnimationFrame(loop); if (!R3 || !mesh3) return; if (drag3 == null) spin += 0.006; mesh3.rotation.z = spin; R3.r.render(R3.sc, R3.cam); };
      raf3 = requestAnimationFrame(loop);
    }
    function stop3d() { cancelAnimationFrame(raf3); if (R3) { R3.r.dispose(); R3 = null; } }
    function preview3dSoon() { clearTimeout(t3); t3 = setTimeout(preview3d, 350); }
    function preview3d() {
      if (!img || !mask || app.command !== def) return;
      ensure3d(); if (!R3) return;
      const my = ++gen, info3 = $("pf-3dinfo");
      if (info3) info3.textContent = "Building the preview…";
      setTimeout(() => {
        if (my !== gen) return;
        let res;
        try { res = buildModel(viewSet(), shapeOpts(Math.min(80, RES[st.res]))); }
        catch (e) { if (info3) info3.textContent = e.message; return; }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(res.V, 3)); geo.setIndex(new THREE.BufferAttribute(res.I, 1)); geo.computeVertexNormals();
        if (mesh3) { R3.sc.remove(mesh3); mesh3.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
        const pv = new THREE.Group(), m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: res.color, roughness: 0.75 }));
        m.position.set(0, 0, -res.size[2] / 2); pv.add(m);
        mesh3 = pv; R3.sc.add(pv);
        const L = Math.max(...res.size) || 1;
        R3.cam.up.set(0, 0, 1); R3.cam.position.set(0, -L * 3.1, L * 0.9); R3.cam.lookAt(0, 0, 0);
        const inf = $("pf-3dinfo"); if (inf) inf.textContent = `${res.size.map((v) => showLen(v, 0)).join(" × ")} ${getUnit()}${res.views.length ? ", matched to " + (res.views.length + 1) + " pictures" : ""}. Drag to turn it.`;
      }, 0);
    }
    openCmd(def);
  }
  app.puffyCmd = (id) => puffyCmd(id || sketcher.active);
  app.pictureCmd = (id) => pictureCmd(id || sketcher.active);
  app.traceCmd = (id) => traceCmd(id || sketcher.active);

  // ------------------------------------------------------------------ Thread
  // ISO metric coarse threads: [nominal diameter, pitch]
  // Unified inch threads (UNC coarse, UNF fine): [name, major diameter in, threads per inch]
  const UN = [["#2-56 UNC", 0.086, 56], ["#4-40 UNC", 0.112, 40], ["#6-32 UNC", 0.138, 32], ["#8-32 UNC", 0.164, 32], ["#10-24 UNC", 0.190, 24], ["#10-32 UNF", 0.190, 32],
    ["1/4-20 UNC", 0.250, 20], ["1/4-28 UNF", 0.250, 28], ["5/16-18 UNC", 0.3125, 18], ["5/16-24 UNF", 0.3125, 24], ["3/8-16 UNC", 0.375, 16], ["3/8-24 UNF", 0.375, 24],
    ["7/16-14 UNC", 0.4375, 14], ["1/2-13 UNC", 0.5, 13], ["1/2-20 UNF", 0.5, 20], ["9/16-12 UNC", 0.5625, 12], ["5/8-11 UNC", 0.625, 11], ["5/8-18 UNF", 0.625, 18], ["3/4-10 UNC", 0.75, 10], ["3/4-16 UNF", 0.75, 16],
    ["7/8-9 UNC", 0.875, 9], ["1-8 UNC", 1, 8], ["1-12 UNF", 1, 12], ["1-1/4-7 UNC", 1.25, 7], ["1-1/2-6 UNC", 1.5, 6], ["2-4.5 UNC", 2, 4.5]];
  // all standard sizes as [label, major diameter mm, pitch mm, family]
  const STD = [];
  const ISO_LIST = [[1, 0.25], [1.2, 0.25], [1.6, 0.35], [2, 0.4], [2.5, 0.45], [3, 0.5], [3.5, 0.6], [4, 0.7], [5, 0.8], [6, 1], [8, 1.25], [10, 1.5], [12, 1.75], [14, 2], [16, 2], [18, 2.5], [20, 2.5], [22, 2.5], [24, 3], [27, 3], [30, 3.5], [33, 3.5], [36, 4], [42, 4.5], [48, 5], [56, 5.5], [64, 6]];
  const ISO = ISO_LIST;
  for (const [d, p] of ISO) STD.push([`M${d} × ${p}`, d, p, "iso"]);
  for (const [n, d, tpi] of UN) STD.push([n, +(d * IN).toFixed(4), +(IN / tpi).toFixed(5), "un"]);
  for (const [n, d, tpi] of UN.filter((u) => /^#|^1\/4|^5\/16|^3\/8|^1\/2-13/.test(u[0]))) TAP[n.replace(/ UN[CF]$/, "").replace(/-\d+(\.\d+)?$/, "") + (n.endsWith("UNF") ? " fine" : "")] = [+(d * IN).toFixed(4), +(IN / tpi).toFixed(5), n];
  // the closest standard size for a boss (outer diameter) or a hole (minor diameter); in inch
  // mode inch sizes are tried first, in mm mode metric ones
  function isoFor(info) {
    const d = 2 * info.r, fam = getUnit() === "in" ? ["un", "iso"] : ["iso", "un"];
    const ref = (s) => (info.ext ? s[1] : s[1] - 1.0825 * s[2]);
    const tol = Math.max(0.15, d * 0.04);
    let pick = null;
    // the other system's sizes only win when they match almost exactly (a real inch bolt in mm mode)
    fam.forEach((f, n) => {
      if (pick && n && Math.abs(ref(pick) - d) < tol) return;
      let best = null, bd = Infinity;
      for (const s of STD) if (s[3] === f) { const e = Math.abs(ref(s) - d); if (e < bd) { bd = e; best = s; } }
      if (!pick) pick = best;
      else if (bd < Math.min(tol, 0.05)) pick = best;
    });
    return { label: pick[0], size: pick[1], pitch: pick[2], fam: pick[3], exact: Math.abs(ref(pick) - d) < tol };
  }
  // pitch: mm in metric mode; threads per inch in inch mode (stored as mm either way)
  function pitchRow(pitch, onCommit, id, live = false) {
    if (getUnit() !== "in") return row("Pitch", app.numField({ value: pitch, id, min: 0.1, step: id === "th-pitch" ? 0.25 : 0.05, live, onCommit }), id);
    const tpiId = id.replace("pitch", "tpi");
    const f = app.numField({ value: +(IN / pitch).toFixed(3), id: tpiId, min: 1, max: 254, step: 1, len: false, live, onCommit: (v) => onCommit(IN / v) });
    const wrap = el("div", { class: "tpi-wrap" }, f, el("span", { class: "hint", style: { padding: 0 } }, `= ${fmt(pitch, 3)} mm pitch`));
    return row("Threads / inch", wrap, tpiId);
  }
  function faceByCenter(base, c, type) {
    let best = -1, bd = Infinity;
    (base.data.faceInfo || []).forEach((f, i) => {
      if (!f || !f.c || (type && f.t !== type)) return;
      const d = Math.hypot(f.c[0] - c[0], f.c[1] - c[1], f.c[2] - c[2]);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  // clearance for 3D-printed threads: every thread face moves into the material
  const THREAD_OFFSETS = [0, -0.2, -0.25, -0.3, -0.35, -0.4, -0.45, -0.5];
  // inch mode: thousandths of an inch (stored in mm)
  const THREAD_OFFSETS_IN = [0, -0.005, -0.008, -0.010, -0.012, -0.015, -0.018, -0.020].map((v) => +(v * IN).toFixed(4));
  const offsetLabel = (v) => (!v ? "None" : getUnit() === "in" ? `${fmt(v / IN, 3)} in (${fmt(v, 2)} mm)` : `${fmt(v, 2)} mm`);
  function offsetSelect(value, onPick, id) {
    const list = (getUnit() === "in" ? THREAD_OFFSETS_IN : THREAD_OFFSETS).slice();
    const cur = value || 0;
    if (!list.some((v) => Math.abs(v - cur) < 1e-6)) { list.push(cur); list.sort((a, b) => b - a); }
    const sel = el("tool-choice", { class: "num", id, "aria-label": "Thread print offset" }, ...list.map((v) => el("option", { value: v, selected: Math.abs(v - cur) < 1e-6 }, offsetLabel(v))));
    sel.onchange = () => onPick(+sel.value);
    return sel;
  }
  // every thread feature in a body, including ones inside combined bodies
  function threadMods(node, out = []) {
    for (const m of node.mods || []) if (m.t === "thread" || (m.t === "hole" && m.tapped)) out.push(m);
    for (const c of node.children || []) if (!c.hole) threadMods(c.node, out); // jumpstart-3d: fasteners. a tap cutter keeps the offset it was made with
    return out;
  }
  function threadOffsetCmd() {
    const selIds = app.sel.slice();
    const count = (ids) => ids.reduce((n, id) => { const b = findBody(store.doc, id); return n + (b && !b.hole ? threadMods(b.node).length : 0); }, 0); // jumpstart-3d: fasteners
    const allIds = store.doc.bodies.map((b) => b.id);
    const nAll = count(allIds), nSel = count(selIds);
    const st = { clear: store.doc.threadOffset || -0.2, scope: nSel ? "sel" : "all", forNew: !nSel };
    const def = {
      title: "Thread print offset",
      keepSelection: true,
      apply(doc) {
        const ids = st.scope === "sel" ? selIds : doc.bodies.map((b) => b.id);
        for (const id of ids) { const b = findBody(doc, id); if (b && !b.hole) for (const m of threadMods(b.node)) m.clear = st.clear; } // jumpstart-3d: fasteners
        if (st.forNew) doc.threadOffset = st.clear;
      },
      ok() { commit(def, "Thread print offset"); app.toast(st.clear ? `Print offset ${offsetLabel(st.clear)} applied to ${st.scope === "sel" ? nSel : nAll} thread${(st.scope === "sel" ? nSel : nAll) === 1 ? "" : "s"}.` : "Print offset removed."); },
      hint: () => "Loosens printed threads so bolts and nuts screw together. Outside threads get thinner and inside threads get wider.",
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, getUnit() === "in" ? "Moves every thread surface into the material by this much, so printed parts fit. −0.008 in (0.2 mm) suits most printers; use more if threads bind." : "Moves every thread surface into the material by this much, so printed parts fit. −0.2 mm suits most printers; use more if threads bind."));
        body.append(row("Offset", offsetSelect(st.clear, (v) => { st.clear = v; def.render(); }, "to-clear"), "to-clear"));
        body.append(row("Apply to", seg([["all", `All threads (${nAll})`], ["sel", `Selected objects (${nSel})`]], st.scope, (v) => { if (v === "sel" && !selIds.length) { app.toast("Select objects first, then open this again."); return; } st.scope = v; def.render(); }, "to-scope")));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "to-new", checked: st.forNew, onchange: (e) => { st.forNew = e.target.checked; } }), "Also use for new threads"));
        if (!nAll) body.append(el("div", { class: "hint", style: { padding: 0 } }, "There are no threads yet. Tick the box above to use this offset for threads you make."));
      },
    };
    openCmd(def);
  }
  function threadCmd(editing = null) {
    const st = { pick: null, pitch: 1.5, full: true, length: 10, flip: false, left: false, preset: null, clear: store.doc.threadOffset || 0 };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      Object.assign(st, { pitch: m.pitch, full: !(m.length > 0), length: m.length || 10, flip: !!m.flip, left: !!m.left, body: b.id, keepFace: m.face, clear: m.clear || 0 });
      // the face is found on the shape before this thread
      const base = baseOf(b.id);
      if (base) {
        const i = faceByCenter(base, m.face.c, "CYLINDRE");
        if (i >= 0) st.pick = { body: b.id, base, face: i, info: base.data.faceInfo[i] };
      }
    }
    let hover = null;
    const def = {
      title: (editing ? "Edit " : "") + "Thread",
      valid: () => !!(st.pick || st.keepFace) && st.pitch > 0.05,
      canOk: () => def.valid(),
      apply(doc) {
        const id = st.pick ? st.pick.body : st.body;
        const b = findBody(doc, id);
        if (!b) return;
        const face = st.pick ? { c: st.pick.info.c, t: "CYLINDRE" } : st.keepFace;
        const props = { face, pitch: st.pitch, length: st.full ? 0 : st.length, flip: st.flip, left: st.left, clear: st.clear || 0 };
        if (editing) { Object.assign(b.node.mods.find((x) => x.id === editing.mod), props); return; }
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "thread", ...props });
      },
      ok() { commit(def, "Thread"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.pick ? "Modeled thread (ISO metric or inch UNC / UNF: both use the same 60° shape). Building it takes a few seconds." : "Click a round face: the outside of a cylinder (bolt) or the inside of a hole (nut).",
      build(body) {
        const info = st.pick && st.pick.info;
        const txt = info ? el("span", {}, el("b", {}, `Ø${withUnit(2 * info.r, 2)} ${info.ext ? "cylinder" : "hole"}`), info.ext ? " · outside thread" : " · inside thread") : "Select a round face";
        body.append(pickbox(true, txt, st.pick && !editing ? () => { st.pick = null; refresh(); } : null));
        if (info) {
          const iso = isoFor(info);
          body.append(el("div", { class: "hint", style: { padding: 0 } }, iso.exact ? `Matches ${iso.label}${iso.fam === "iso" ? " (ISO coarse)" : ""}.` : `Closest standard size: ${iso.label}. The thread is cut on the face as it is.`));
        }
        // sizes: metric and inch lists (the one for the current units first); value = the label
        const mk = (f) => STD.filter((s) => s[3] === f).map((s) => el("option", { value: s[0], selected: st.preset === s[0] }, s[0] + (f === "un" ? ` (Ø${fmt(s[1], 2)} mm)` : "")));
        const groups = [el("optgroup", { label: "Metric (ISO coarse)" }, ...mk("iso")), el("optgroup", { label: "Inch (UNC / UNF)" }, ...mk("un"))];
        if (getUnit() === "in") groups.reverse();
        const sel = el("tool-choice", { class: "num", id: "th-size", "aria-label": "Thread size" }, el("option", { value: "" }, "Custom pitch"), ...groups);
        sel.onchange = () => { const s = STD.find((x) => x[0] === sel.value || (x[3] === "iso" && String(x[1]) === sel.value)); st.preset = s ? s[0] : null; if (s) { st.pitch = s[2]; def.render(); refresh(false); } };
        body.append(row("Size", sel, "th-size"));
        body.append(pitchRow(st.pitch, (v) => { st.pitch = v; st.preset = null; refresh(); }, "th-pitch"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "th-full", checked: st.full, onchange: (e) => { st.full = e.target.checked; refresh(); } }), "Full length"));
        if (!st.full) body.append(row("Length", app.numField({ value: st.length, id: "th-len", min: 0.1, step: 1, onCommit: (v) => { st.length = v; refresh(false); } }), "th-len"));
        body.append(row("Start", seg([[false, "Open end"], [true, "Other end"]], st.flip, (v) => { st.flip = v; refresh(); }, "th-flip")));
        body.append(row("Hand", seg([[false, "Right"], [true, "Left"]], st.left, (v) => { st.left = v; refresh(); }, "th-hand")));
        body.append(row("Print offset", offsetSelect(st.clear, (v) => { st.clear = v; refresh(); }, "th-clear"), "th-clear"));
        if (st.clear && Math.abs(st.clear) > 0.3 * st.pitch + 1e-9) body.append(el("div", { class: "hint", style: { padding: 0 } }, `This pitch allows at most −${withUnit(0.3 * st.pitch, 3)}; that is used.`));
      },
      start() {
        // a selected body with one round face picked from it is common; otherwise wait for a click
        refresh();
      },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          hover = f && f.info && f.info.t === "CYLINDRE" ? f : null;
          draw();
          vp.canvas.style.cursor = hover ? "pointer" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          if (!f) return true;
          if (!f.info || f.info.t !== "CYLINDRE") { app.toast("Pick a round face: the side of a cylinder or the inside of a hole."); return true; }
          if (editing && f.body !== st.body) { app.toast("Pick a face on the same body."); return true; }
          st.pick = f;
          const iso = isoFor(f.info);
          if (!editing) { st.pitch = iso.pitch; st.preset = iso.exact ? iso.label : null; }
          refresh();
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      if (st.pick) drawFace(st.pick.base, st.pick.face, 0x2f66c8);
      if (hover && (!st.pick || hover.face !== st.pick.face || hover.body !== st.pick.body)) drawFace(hover.base, hover.face, 0xe8a317);
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Scale
  // Typed scaling for any body (the corner handles do the same by dragging).
  function scaleCmd(editing = null) {
    const st = { body: null, uniform: true, k: [1, 1, 1], anchor: "base" };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      st.body = b.id; st.k = m.k.slice(); st.uniform = Math.abs(m.k[0] - m.k[1]) < 1e-9 && Math.abs(m.k[0] - m.k[2]) < 1e-9;
      // the point that stays put: o = a - k*a
      st.fixed = m.k.map((k, i) => (Math.abs(1 - k) > 1e-9 ? m.o[i] / (1 - k) : 0));
    } else {
      const one = app.sel.filter((id) => !app.isLocked(id));
      if (one.length === 1) st.body = one[0];
    }
    const anchorPoint = (doc) => {
      if (st.fixed) return st.fixed;
      const v = scene.views.get(st.body);
      const bb = v && v.data ? v.data.kbbox || v.data.bbox : { min: [0, 0, 0], max: [0, 0, 0] };
      const c = [0, 1, 2].map((i) => (bb.min[i] + bb.max[i]) / 2);
      if (st.anchor === "base") c[2] = bb.min[2];
      if (st.anchor === "corner") return bb.min.slice();
      void doc;
      return c;
    };
    const def = {
      title: (editing ? "Edit " : "") + "Scale",
      valid: () => !!st.body && st.k.every((v) => v > 1e-4),
      canOk: () => def.valid() && (editing || st.k.some((v) => Math.abs(v - 1) > 1e-9)),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b) return;
        const a = anchorPoint(doc);
        const o = a.map((x, i) => +(x - st.k[i] * x).toPrecision(10));
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); m.k = st.k.slice(); m.o = o; return; }
        if (st.k.every((v) => Math.abs(v - 1) < 1e-12)) return;
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "scale", k: st.k.slice(), o });
      },
      ok() { commit(def, "Scale"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.body ? "Type a scale factor (2 = twice as big, 0.5 = half). Or drag the white handles on the body." : "Click the body to scale.",
      build(body) {
        const b = st.body && findBody(store.doc, st.body);
        body.append(pickbox(true, b ? el("b", {}, b.name) : "Select a body", b && !editing ? () => { st.body = null; refresh(); } : null));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "sc-uni", checked: st.uniform, onchange: (e) => { st.uniform = e.target.checked; if (st.uniform) st.k = [st.k[0], st.k[0], st.k[0]]; refresh(); } }), "Uniform"));
        if (st.uniform) body.append(row("Factor", app.numField({ value: st.k[0], id: "sc-k", min: 0.001, step: 0.1, live: true, onCommit: (v) => { st.k = [v, v, v]; refresh(false); } }), "sc-k"));
        else ["X", "Y", "Z"].forEach((ax, i) => body.append(row(ax + " factor", app.numField({ value: st.k[i], id: "sc-k" + ax.toLowerCase(), min: 0.001, step: 0.1, live: true, onCommit: (v) => { st.k[i] = v; refresh(false); } }), "sc-k" + ax.toLowerCase())));
        if (!st.fixed) body.append(row("Keep fixed", seg([["base", "Base"], ["center", "Center"], ["corner", "Corner"]], st.anchor, (v) => { st.anchor = v; refresh(); }, "sc-anchor")));
        if (!st.uniform) body.append(el("div", { class: "hint", style: { padding: 0 } }, "Uneven scaling stretches the body. Holes, fillets, shells and threads added in Advanced keep their size."));
      },
      start() { refresh(); },
      handler: {
        hover(e) { const f = pickBaseFace(e, (b) => !b.locked); vp.canvas.style.cursor = f && !editing ? "pointer" : "default"; },
        down(e) {
          if (editing) return true;
          const f = pickBaseFace(e, (b) => !b.locked);
          if (f) { st.body = f.body; refresh(); }
          return true;
        },
      },
    };
    function refresh(rerender = true) { if (rerender) def.render(); schedulePreview(def); }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Texture
  // Tactile surface textures (knurl, hex, wood, leather…) on any faces. They
  // change the display and STL mesh; STEP export keeps the smooth shape.
  function textureCmd(editing = null) {
    const st = { body: null, faces: [], all: false, cat: "all", target: "faces", bodies: [], ...TEXTURE_DEFAULTS };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const t = (b.textures || []).find((x) => x.id === editing.tex);
      Object.assign(st, clone(t), { body: b.id, faces: [], all: t.faces === "all", keepFaces: t.faces });
      const base = baseOf(b.id);
      if (base && t.faces !== "all") for (const q of t.faces) { const i = faceByCenter(base, q.c, q.t); if (i >= 0 && !st.faces.some((f) => f.face === i)) st.faces.push({ base, face: i, info: base.data.faceInfo[i] }); }
    } else {
      const one = app.sel.filter((id) => !app.isLocked(id) && !findBody(store.doc, id)?.hole);
      if (one.length === 1) st.body = one[0];
      // several shapes selected: texture them whole
      if (one.length > 1) { st.target = "objects"; st.bodies = one.slice(); }
    }
    let hover = null;
    const layer = () => ({ tex: st.tex, size: st.size, depth: st.depth, dir: st.dir, rot: st.rot, mapping: st.mapping, falloff: st.falloff, invert: st.invert, once: !!st.once });
    const newImages = {}; // pictures imported while this dialog is open
    const myImages = () => ({ ...(store.doc.texImages || {}), ...newImages });
    // turn a picture into a small grayscale height map: dark parts rise
    function importImage() {
      const inp = el("input", { type: "file", accept: "image/*,.svg" });
      inp.onchange = () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const MAX = 384, k = Math.min(1, MAX / Math.max(img.naturalWidth || img.width || 1, img.naturalHeight || img.height || 1));
          const w = Math.max(2, Math.round((img.naturalWidth || img.width || 256) * k)), h = Math.max(2, Math.round((img.naturalHeight || img.height || 256) * k));
          const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          const ctx = cv.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // see-through parts count as background
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          const px = ctx.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h);
          for (let i = 0; i < w * h; i++) out[i] = 255 - Math.round(0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]);
          const id = uid("img");
          const rec = { name: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "My image", w, h, b64: bytesToB64(out) };
          newImages[id] = rec;
          registerImageTexture(id, rec);
          st.tex = "img:" + id; st.cat = "mine"; st.once = true;
          if (st.size < 15) st.size = 30;
          refresh();
          app.toast(`Imported ${rec.name}. Dark parts rise; tick Invert to swap.`);
        };
        img.onerror = () => { URL.revokeObjectURL(url); app.toast("That picture couldn't be opened. Try a PNG, JPG or SVG.", "err"); };
        img.src = url;
      };
      inp.click();
    }
    const def = {
      title: (editing ? "Edit " : "") + "Texture",
      wide: true,
      valid: () => (st.target === "objects" ? st.bodies.length > 0 : !!st.body && (st.all || st.faces.length > 0)) && st.size > 0 && st.depth > 0,
      canOk: () => def.valid(),
      apply(doc) {
        if (st.target === "objects" && !editing) {
          if (st.tex.startsWith("img:")) { const id = st.tex.slice(4); doc.texImages = doc.texImages || {}; if (!doc.texImages[id] && newImages[id]) doc.texImages[id] = newImages[id]; }
          for (const id of st.bodies) {
            const b = findBody(doc, id);
            if (!b || b.hole) continue;
            b.textures = b.textures || [];
            b.textures.push({ id: uid("t"), seq: nextSeq(doc), faces: "all", ...layer() });
          }
          return;
        }
        const b = findBody(doc, st.body);
        if (!b) return;
        const faces = st.all ? "all" : st.faces.map((f) => (f.info.n ? { c: f.info.c, t: f.info.t, n: f.info.n } : { c: f.info.c, t: f.info.t }));
        b.textures = b.textures || [];
        if (st.tex.startsWith("img:")) {
          const id = st.tex.slice(4);
          doc.texImages = doc.texImages || {};
          if (!doc.texImages[id] && newImages[id]) doc.texImages[id] = newImages[id];
        }
        if (editing) { const t = b.textures.find((x) => x.id === editing.tex); Object.assign(t, layer(), { faces }); return; }
        b.textures.push({ id: uid("t"), seq: nextSeq(doc), faces, ...layer() });
      },
      ok() { commit(def, "Texture"); },
      onDelete: editing ? () => { closeCmd(false); store.update((doc) => { const b = findBody(doc, editing.body); b.textures = (b.textures || []).filter((x) => x.id !== editing.tex); }, "Remove texture"); } : null,
      hint: () => st.target === "objects" && !editing ? "Click objects to add or remove them; each is textured all over." : st.body ? "Click faces to texture (click again to remove), or use the whole body." : "Click the faces of a body to texture.",
      build(body) {
        if (!editing) body.append(row("Apply to", seg([["faces", "Faces"], ["objects", "Whole objects"]], st.target, (v) => { st.target = v; if (v === "objects") { st.bodies = st.body ? [st.body] : st.bodies; st.faces = []; st.all = false; } else { st.bodies = []; } refresh(); }, "tx-target")));
        if (st.target === "objects" && !editing) {
          const n = st.bodies.length;
          body.append(pickbox(true, n ? el("span", {}, el("b", {}, n), ` object${n > 1 ? "s" : ""} (whole)`) : "Click objects to texture", n ? () => { st.bodies = []; refresh(); } : null));
        }
        const b = st.body && findBody(store.doc, st.body);
        const what = st.all ? el("span", {}, el("b", {}, "Whole body")) : st.faces.length ? el("span", {}, el("b", {}, st.faces.length), ` face${st.faces.length > 1 ? "s" : ""}`) : b ? "Click faces, or…" : "Select faces";
        if (st.target !== "objects" || editing) body.append(pickbox(true, what, st.faces.length || st.all ? () => { st.faces = []; st.all = false; if (!editing && !app.sel.includes(st.body)) st.body = null; refresh(); } : null));
        if (b && !st.all && st.target !== "objects") body.append(el("button", { class: "btn", id: "tx-all", style: { marginBottom: "6px" }, onclick: () => { st.all = true; st.faces = []; refresh(); } }, "Texture the whole body"));
        // library
        body.append(el("div", { class: "tx-cats", id: "tx-cats" }, ...TEX_CATS.map(([k, label]) => el("button", { "aria-pressed": st.cat === k, onclick: () => { st.cat = k; def.render(); } }, label))));
        const grid = el("div", { class: "tx-grid", id: "tx-grid" });
        const mine = Object.keys(myImages()).map((id) => texByKey("img:" + id)).filter((t) => t && t.custom);
        const items = [...mine, ...LIB].filter((t) => st.cat === "all" || t.cat === st.cat);
        grid.append(el("button", { class: "tx-item tx-import", id: "tx-import", title: "Use your own picture (PNG, JPG, SVG) as a texture", onclick: importImage }, el("span", { class: "tx-plus", html: ICON.import }), el("span", {}, "Import image…")));
        for (const t of items) {
          const img = el("img", { alt: "", width: 44, height: 44 });
          const btn = el("button", { class: "tx-item", title: t.name, "aria-pressed": st.tex === t.key, "data-key": t.key, onclick: () => { const wasMine = st.tex.startsWith("img:"); st.tex = t.key; if (t.custom && !wasMine) { st.once = true; if (st.size < 15) st.size = 30; refresh(); return; } if (t.size && !st.sizeSet && !editing && Math.abs(st.size - t.size) > 1e-9) { st.size = t.size; const nf = document.getElementById("tx-size"), rg = document.getElementById("tx-size-range"); if (nf && nf.setValue) nf.setValue(t.size); else if (nf) nf.value = t.size; if (rg) { if (+rg.max < t.size) rg.max = 100; rg.value = t.size; } } grid.querySelectorAll(".tx-item").forEach((x) => x.setAttribute("aria-pressed", x.dataset.key === t.key)); schedulePreview(def); } }, img, el("span", {}, t.name));
          grid.append(btn);
          thumbQueue.push([img, t.key]);
        }
        pumpThumbs();
        body.append(grid);
        const live = (k) => (v) => { st[k] = v; refreshSoon(); };
        body.append(sliderRow("Tile size", "tx-size", st.size, 0.5, Math.max(20, st.size > 20 ? 100 : 20), 0.1, "mm", (v) => { st.sizeSet = true; live("size")(v); }));
        body.append(sliderRow("Depth", "tx-depth", st.depth, 0.05, 3, 0.05, "mm", live("depth")));
        body.append(row("Direction", seg([["raise", "Raise"], ["engrave", "Engrave"], ["both", "Both"]], st.dir, (v) => { st.dir = v; refresh(); }, "tx-dir")));
        body.append(sliderRow("Rotation", "tx-rot", st.rot, -180, 180, 1, "°", live("rot")));
        body.append(row("Mapping", seg([["auto", "Auto"], ["planar", "Flat"], ["cylindrical", "Round"], ["triplanar", "Box"]], st.mapping, (v) => { st.mapping = v; refresh(); }, "tx-map")));
        body.append(sliderRow("Edge blend", "tx-fall", st.falloff, 0, 10, 0.1, "mm", live("falloff")));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "tx-inv", checked: st.invert, onchange: (e) => { st.invert = e.target.checked; refresh(false); } }), "Invert pattern"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "tx-once", checked: !!st.once, onchange: (e) => { st.once = e.target.checked; refresh(false); } }), "Show once, centred (don't repeat)"));
        if (st.tex.startsWith("img:")) body.append(el("div", { class: "hint", style: { padding: 0 } }, "Your picture: dark parts rise, light parts stay flat. Tile size sets its width. High-contrast pictures (logos, line art) work best."));
        const v = st.body && scene.views.get(st.body);
        if (v && v.data && v.data.texInfo && v.data.texInfo.limited) body.append(el("div", { class: "hint", style: { padding: 0 } }, "Detail was capped to keep the mesh manageable. Try a bigger tile size."));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Textures shape the display and STL export. STEP export keeps the smooth body."));
      },
      cleanup() { scene.setHovered(null); scene.setSelected(app.sel); },
      start() { refresh(); },
      handler: {
        hover(e) {
          if (st.target === "objects" && !editing) { const f = pickBaseFace(e, (b) => !b.hole && !b.locked); scene.setHovered(f ? f.body : null); vp.canvas.style.cursor = f ? "pointer" : "default"; return; }
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!st.body || b.id === st.body || !(st.faces.length || st.all)));
          hover = f && f.info ? f : null;
          draw();
          vp.canvas.style.cursor = hover ? "pointer" : "default";
        },
        down(e) {
          if (st.target === "objects" && !editing) {
            const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
            if (f) { const k = st.bodies.indexOf(f.body); if (k >= 0) st.bodies.splice(k, 1); else st.bodies.push(f.body); refresh(); }
            return true;
          }
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          if (!f || !f.info) return true;
          if (st.body && f.body !== st.body && (st.faces.length || st.all || editing)) { app.toast("Texture one body at a time. Clear the faces to switch bodies."); return true; }
          if (st.body !== f.body) { st.body = f.body; st.faces = []; st.all = false; }
          if (st.all) { st.all = false; st.faces = (f.base.data.faceInfo || []).map((info, i) => ({ base: f.base, face: i, info })).filter((x) => x.info && x.info.c); }
          const i = st.faces.findIndex((x) => x.face === f.face);
          if (i >= 0) st.faces.splice(i, 1);
          else st.faces.push({ base: f.base, face: f.face, info: f.info });
          refresh();
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      for (const f of st.faces) drawFace(f.base, f.face, 0x2f66c8);
      if (hover && !st.faces.some((f) => f.face === hover.face && hover.body === st.body)) drawFace(hover.base, hover.face, 0xe8a317);
    }
    function refresh(rerender = true) { if (rerender) def.render(); if (st.target === "objects" && !editing) scene.setSelected(st.bodies); draw(); schedulePreview(def); }
    // sliders preview a moment after you stop moving them (textures take a little while to build)
    let soon = 0;
    function refreshSoon() { clearTimeout(soon); soon = setTimeout(() => { if (app.command === def) schedulePreview(def); }, 140); }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Loft (Fusion-style)
  // sections: sketch profiles, flat faces (outlined into a sketch on OK) or a sketch point at either end;
  // smooth or straight, open or closed, optionally along a centerline rail.
  function loftCmd(editing = null) {
    const st = { secs: [], rail: null, pickRail: false, ruled: false, closed: false, op: "auto", hoverKey: null, pend: new Map(), editing };
    const ownSketch = (id) => findSketch(store.view, id) || st.pend.get(id) || null;
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const node = editing.mod ? b.node.mods.find((m) => m.id === editing.mod).tool : b.node;
      st.secs = clone(node.sections || []);
      st.rail = node.rail ? clone(node.rail) : null;
      st.ruled = !!node.ruled; st.closed = !!node.closed;
      st.op = editing.mod ? b.node.mods.find((m) => m.id === editing.mod).op : "new";
    }
    const secKey = (s) => (s.point ? "p:" + s.point.sketch + ":" + s.point.id : s.sketch + ":" + s.ref.key + ":" + s.ref.pt.map((v) => v.toFixed(4)).join(","));
    const regionIndex = (s) => { const sk = ownSketch(s.sketch); if (!sk) return -1; const regs = regionsFor(sk); return regs.findIndex((r) => r.key === s.ref.key && pointIn(r, s.ref.pt)); };
    // world-space outline of a section (for the overlay and the bounding box)
    function secPts(s) {
      if (s.point) {
        const sk = ownSketch(s.point.sketch); if (!sk) return [];
        const c = resolveSketch(sk).find((q) => q.id === s.point.id); const p = (sk.pts || []).find((q) => q.id === s.point.id);
        const xy = c && c.t === "point" ? c.p : p ? [p.x, p.y] : null;
        return xy ? [new THREE.Vector3(xy[0], xy[1], 0).applyMatrix4(planeMatrix(sk.plane))] : [];
      }
      const sk = ownSketch(s.sketch); if (!sk) return [];
      const r = regionsFor(sk)[regionIndex(s)]; if (!r) return [];
      const M = planeMatrix(sk.plane);
      return r.poly.map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M));
    }
    const center = (pts) => pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, pts.length));
    function loftNode() { return { t: "loft", sections: st.secs.map((s) => clone(s)), rail: st.rail ? clone(st.rail) : null, ruled: st.ruled, closed: st.closed }; }
    function loftBox() {
      const box = new THREE.Box3();
      for (const s of st.secs) for (const p of secPts(s)) box.expandByPoint(p);
      return box.isEmpty() ? null : box;
    }
    function parts() {
      const tb = loftBox(); if (!tb) return [];
      tb.expandByScalar(1e-3);
      return store.doc.bodies.filter((b) => !b.hole && !b.hidden && !b.locked && (!editing || editing.body !== b.id)).filter((b) => { const bb = scene.bodyTightBox(b.id); return bb && bb.intersectsBox(tb); }).map((b) => b.id);
    }
    function opNow() {
      if (st.op !== "auto") return st.op;
      // a profile drawn on a body's face grows that body; otherwise a new body
      const onBody = st.secs.some((s) => { const sk = !s.point && ownSketch(s.sketch); return sk && sk.onBody; });
      return onBody && parts().length ? "join" : "new";
    }
    const def = {
      title: (editing ? "Edit " : "") + "Loft",
      wide: true,
      valid: () => st.secs.filter((s) => !s.point).length >= 1 && st.secs.length >= 2,
      canOk: () => def.valid(),
      apply(doc) {
        // face outlines picked during the loft become real (hidden) sketches
        for (const [id, sk] of st.pend) if (!findSketch(doc, id) && st.secs.some((s) => s.sketch === id)) { const c = clone(sk); c.seq = nextSeq(doc); c.name = nextSketchName(doc); c.hidden = true; doc.sketches.push(c); }
        const node = loftNode();
        if (editing) {
          const b = findBody(doc, editing.body);
          if (editing.mod) { const m = b.node.mods.find((x) => x.id === editing.mod); m.tool = { ...node, mods: [] }; if (st.op !== "auto" && st.op !== "new") m.op = st.op; if (app.previewing && m.op === "cut") showCut(doc, node); }
          else b.node = { ...node, mods: b.node.mods || [] };
          return;
        }
        const op = opNow();
        const ps = parts();
        if (op === "new" || !ps.length) {
          doc.bodies.push({ id: st.newId || (st.newId = uid("b")), name: nextName(doc, "Body"), seq: nextSeq(doc), color: BODY_COLORS[doc.bodies.length % BODY_COLORS.length], hole: false, hidden: false, m: IDENTITY.slice(), node: { ...node, mods: [] } });
        } else {
          const seq = nextSeq(doc);
          for (const id of op === "join" ? [ps[0]] : ps) {
            const b = findBody(doc, id);
            b.node.mods = b.node.mods || [];
            b.node.mods.push({ id: uid("f"), seq, t: "bool", op, tool: { ...node, mods: [] }, m: arr(M4(b.m).invert()) });
          }
          if (app.previewing && op === "cut") showCut(doc, node);
        }
        for (const s of st.secs) { const sk = !s.point && findSketch(doc, s.sketch); if (sk) sk.hidden = true; }
        if (st.rail) { const sk = findSketch(doc, st.rail.sketch); if (sk) sk.hidden = true; }
      },
      ok() { commit(def, editing ? "Edit loft" : "Loft"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.pickRail ? "Click a sketch line, arc or spline for the centerline. Connected curves join into one path." : "Click profiles in order: sketch shapes, flat faces of bodies, or a sketch point for a pointed end.",
      build(body) {
        body.append(pickbox(!st.pickRail, st.secs.length ? el("span", {}, el("b", {}, st.secs.length), ` section${st.secs.length > 1 ? "s" : ""}, in order`) : "Click profiles in order", st.secs.length ? () => { st.secs = []; refresh(); } : null, () => { st.pickRail = false; def.render(); }));
        // the ordered list: move up / down, remove
        if (st.secs.length) {
          const list = el("ol", { class: "loft-list", id: "loft-list" });
          st.secs.forEach((s, i) => {
            const sk = ownSketch(s.point ? s.point.sketch : s.sketch);
            const name = s.point ? "Point" + (sk ? " · " + (sk.name || "sketch") : "") : (sk ? (sk.fromFace && !findSketch(store.doc, sk.id) ? "Face outline" : sk.name || "Sketch") + " profile" : "Missing profile");
            const mv = (d) => { const j = i + d; if (j < 0 || j >= st.secs.length) return; [st.secs[i], st.secs[j]] = [st.secs[j], st.secs[i]]; refresh(); };
            list.append(el("li", {}, el("span", { class: "ln" }, String(i + 1)), el("span", { class: "lname" }, name),
              el("button", { class: "lbtn", title: "Move up", disabled: i === 0, onclick: () => mv(-1) }, "↑"),
              el("button", { class: "lbtn", title: "Move down", disabled: i === st.secs.length - 1, onclick: () => mv(1) }, "↓"),
              el("button", { class: "lbtn", title: "Remove", onclick: () => { st.secs.splice(i, 1); refresh(); } }, "×")));
          });
          body.append(list);
          body.append(el("button", { class: "btn", id: "loft-reverse", style: { alignSelf: "flex-start" }, onclick: () => { st.secs.reverse(); refresh(); } }, "Reverse order"));
        }
        body.append(row("Shape", seg([[false, "Smooth"], [true, "Straight"]], st.ruled, (v) => { st.ruled = v; refresh(); }, "loft-ruled")));
        const nReg = st.secs.filter((s) => !s.point).length;
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "loft-closed", checked: st.closed, disabled: nReg < 3 || !!st.rail, onchange: (e) => { st.closed = e.target.checked; refresh(); } }), "Closed loop (back to the first profile; needs 3+ profiles)"));
        const n = st.rail ? st.rail.ents.length : 0;
        body.append(row("Centerline", pickbox(st.pickRail, n ? el("span", {}, el("b", {}, n), ` curve${n > 1 ? "s" : ""}`) : "Optional: click to pick", n ? () => { st.rail = null; st.pickRail = false; refresh(); } : null, () => { st.pickRail = true; st.closed = false; def.render(); }), "loft-rail"));
        if (!editing || editing.mod) {
          const ops = editing ? [["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]] : [["auto", "Automatic"], ["new", "New body"], ["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]];
          const sel = el("tool-choice", { class: "num", id: "loft-op" }, ...ops.map(([v, l]) => el("option", { value: v, selected: v === st.op }, l)));
          sel.onchange = () => { st.op = sel.value; refresh(); };
          body.append(row("Operation", sel, "loft-op"));
        }
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Profiles can sit on any planes, at any angle. Different shapes blend into each other (square to circle, star to circle…). Points can only be first or last. A centerline makes the loft follow a path."));
      },
      start() {
        scene.state.forceSketches = new Set(store.doc.sketches.map((x) => x.id));
        scene.syncSketches(store.view);
        refresh();
      },
      cleanup() { scene.state.forceSketches = null; scene.syncSketches(store.view); },
      handler: {
        hover(e) {
          if (st.pickRail) { const h = pickSketchCurve(e); vp.canvas.style.cursor = h ? "pointer" : "default"; st.hoverRail = h ? pathPts(h) : null; draw(); return; }
          const pt = pickSketchPointAny(e);
          st.hoverPtSel = pt;
          if (pt) { vp.canvas.style.cursor = "pointer"; st.hoverFace = null; st.hoverPt = pt.world; draw(); return; }
          st.hoverPt = null;
          const hits = visibleRegionHits(e);
          const k = hits.length ? hits[0].object.userData.region.sketch + ":" + hits[0].object.userData.region.index : null;
          const hf = !k ? pickBaseFace(e, (b) => !b.hole && !b.locked) : null;
          st.hoverFace = hf && hf.info && hf.info.t === "PLANE" ? hf : null;
          vp.canvas.style.cursor = k || st.hoverFace ? "pointer" : "default";
          if (k !== st.hoverKey) { st.hoverKey = k; highlight(); }
          draw();
        },
        down(e) {
          if (st.pickRail) {
            const h = pickSketchCurve(e);
            if (h) { const sk = findSketch(store.view, h.sketch); st.rail = { sketch: h.sketch, ents: pathChain(resolveSketch(sk), h.curve.id) }; st.pickRail = false; st.hoverRail = null; refresh(); }
            return true;
          }
          const pt = pickSketchPointAny(e) || st.hoverPtSel;
          if (pt) { st.hoverPtSel = null; add({ point: { sketch: pt.sketch, id: pt.id } }); return true; }
          const hits = visibleRegionHits(e);
          if (hits.length) {
            // stacked profiles (seen from above they overlap): each click at the same spot takes the
            // next one down that isn't in the loft yet; when all are in, the nearest one comes out
            const secOf = (h) => { const r = h.object.userData.region; return { sketch: r.sketch, ref: { key: r.region.key, pt: r.region.pt } }; };
            const have = new Set(st.secs.map(secKey));
            const fresh = hits.find((h) => !have.has(secKey(secOf(h))));
            add(secOf(fresh || hits[0]));
            return true;
          }
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          if (f && f.info && f.info.t === "PLANE") { addFace(f, e); return true; }
          if (f) app.toast("Pick flat faces or sketch profiles for a loft.");
          return true;
        },
      },
    };
    function add(s) {
      const k = secKey(s);
      const i = st.secs.findIndex((x) => secKey(x) === k);
      if (i >= 0) st.secs.splice(i, 1);
      else {
        if (s.point && st.secs.some((x) => x.point) && st.secs.filter((x) => x.point).length >= 2) { app.toast("A loft can have a point at each end, no more."); return; }
        st.secs.push(s);
      }
      refresh();
    }
    // a flat face: its outline becomes a sketch (made real on OK)
    function addFace(f) {
      const plane = planeFromFace(f);
      const sk = { id: uid("s"), name: "Face outline", seq: 0, plane: { o: plane.o, x: plane.x, n: plane.n }, pts: [], ents: [], hidden: false, onBody: f.body, fromFace: true };
      projectFaceEdges(sk, f);
      const regs = regionsFor(sk);
      const q = f.point.clone().applyMatrix4(planeMatrix(sk.plane).invert());
      let best = -1, area = Infinity;
      regs.forEach((r, i) => { if (!r.text && pointIn(r, [q.x, q.y])) { const a = Math.abs(polyArea(r.poly)); if (a < area) { area = a; best = i; } } });
      if (best < 0) { app.toast("Couldn't find the outline of that face."); return; }
      st.pend.set(sk.id, sk);
      add({ sketch: sk.id, ref: { key: regs[best].key, pt: regs[best].pt } });
    }
    // sketch points and line ends (for a pointed loft end)
    function pickSketchPointAny(e) {
      vp.updateCamera();
      const [mx, my] = vp.local(e);
      let best = null, bd = vp.tol(8);
      for (const sk of [...store.view.sketches, ...st.pend.values()]) {
        if (!scene.sketchViews.has(sk.id)) continue;
        const M = planeMatrix(sk.plane);
        for (const c of resolveSketch(sk)) {
          if (c.t !== "point") continue;
          const w = new THREE.Vector3(c.p[0], c.p[1], 0).applyMatrix4(M);
          const s2 = vp.project(w);
          const d = Math.hypot(s2[0] - mx, s2[1] - my);
          if (d < bd) { bd = d; best = { sketch: sk.id, id: c.id, world: w }; }
        }
      }
      return best;
    }
    function highlight() {
      const sel = new Set();
      for (const s of st.secs) if (!s.point) { const i = regionIndex(s); if (i >= 0) sel.add(s.sketch + ":" + i); }
      scene.highlightRegions(sel, st.hoverKey);
    }
    function draw() {
      clearOv();
      const cs = [];
      st.secs.forEach((s, i) => {
        const pts = secPts(s);
        if (!pts.length) return;
        if (s.point) drawDot(pts[0], 0x2f66c8, 11);
        else drawLine([...pts, pts[0]], 0x2f66c8);
        cs.push(center(pts));
      });
      // the loft's order: a line through the section centres
      if (cs.length > 1) drawLine(st.closed ? [...cs, cs[0]] : cs, 0xe8a317);
      if (st.rail) { const sk = findSketch(store.view, st.rail.sketch); if (sk) { const M = planeMatrix(sk.plane); for (const c of resolveSketch(sk).filter((c) => st.rail.ents.includes(c.id))) drawLine(sampleCurve(c).map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M)), 0x7b4fa8); } }
      for (const pl of st.hoverRail || []) drawLine(pl, 0xe8a317);
      if (st.hoverFace) drawFace(st.hoverFace.base, st.hoverFace.face, 0xe8a317, 0.35);
      if (st.hoverPt) drawDot(st.hoverPt, 0xe8a317, 12);
    }
    function refresh(rerender = true) {
      // show the outlines of picked faces so they can be clicked again (to remove)
      scene.state.forceSketches = new Set([...store.doc.sketches.map((x) => x.id), ...st.pend.keys()]);
      if (rerender) def.render();
      highlight(); draw();
      schedulePreview(def);
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Mirror (bodies)
  function mirrorCmd() {
    const st = { bodies: app.sel.filter((id) => { const b = findBody(store.doc, id); return b && !b.locked; }), plane: null, planeName: "", join: false, pickPlane: false };
    // like Fusion: with bodies already picked, the next click chooses the plane; otherwise
    // clicks pick bodies until the Mirror plane box is clicked (origin planes work any time)
    st.pickPlane = st.bodies.length > 0;
    const def = {
      title: "Mirror",
      valid: () => st.bodies.length > 0 && !!st.plane,
      canOk: () => def.valid(),
      apply(doc) {
        const P = { o: st.plane.o.slice(), n: st.plane.n.slice() };
        for (const id of st.bodies) {
          const b = findBody(doc, id);
          if (!b) continue;
          if (st.join) {
            // one body: the original plus its mirror image (a snapshot of the body as it is now)
            b.node.mods = b.node.mods || [];
            b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "bool", op: "join", tool: { t: "mirror", src: clone(b.node), srcM: b.m.slice(), plane: P, mods: [] }, m: arr(M4(b.m).invert()) });
          } else {
            // a new body that follows the original when it changes
            doc.bodies.push({ id: (st.ids || (st.ids = {}))[id] || (st.ids[id] = uid("b")), name: (b.name || "Body") + " (mirror)", seq: nextSeq(doc), color: b.color, ...(b.role === undefined ? {} : { role: b.role }), hole: !!b.hole, hidden: false, m: IDENTITY.slice(), node: { t: "mirror", srcBody: b.id, plane: P, mods: [] } });
          }
        }
      },
      ok() { commit(def, "Mirror"); },
      hint: () => st.pickPlane ? "Click a plane or a flat face to mirror across (or pick YZ / XZ / XY)." : !st.bodies.length ? "Click the bodies to mirror." : !st.plane ? "Click more bodies, then click the Mirror plane box, or pick YZ / XZ / XY." : "Click bodies to add or remove them.",
      sceneSel: () => st.bodies,
      build(body) {
        body.append(row("Bodies", pickbox(!st.pickPlane, st.bodies.length ? el("span", {}, el("b", {}, st.bodies.length), ` bod${st.bodies.length > 1 ? "ies" : "y"}`) : "Click bodies", st.bodies.length ? () => { st.bodies = []; refresh(); } : null, () => { st.pickPlane = false; def.render(); }), "mir-bodies"));
        body.append(row("Mirror plane", pickbox(st.pickPlane || !st.plane, st.plane ? el("span", {}, el("b", {}, st.planeName)) : "Click a plane or face", null, () => { st.pickPlane = true; def.render(); }), "mir-plane"));
        body.append(row("…or use", seg([["YZ", "YZ"], ["XZ", "XZ"], ["XY", "XY"]], ["YZ", "XZ", "XY"].includes(st.planeName) ? st.planeName : null, (v) => { const p = ORIGIN_PLANES[v]; st.plane = { o: p.o.slice(), n: p.n.slice() }; st.planeName = v; st.pickPlane = false; refresh(); }, "mir-origin")));
        const cps = store.doc.planes || [];
        if (cps.length) {
          const sel = el("tool-choice", { class: "num", id: "mir-cplane" }, el("option", { value: "" }, "A construction plane…"), ...cps.map((p) => el("option", { value: p.id }, p.name)));
          sel.onchange = () => { const p = cps.find((q) => q.id === sel.value); if (p) { st.plane = { o: p.plane.o.slice(), n: p.plane.n.slice() }; st.planeName = p.name; st.pickPlane = false; refresh(); } };
          body.append(row("", sel, "mir-cplane"));
        }
        body.append(row("Result", seg([[false, "New body"], [true, "Join"]], st.join, (v) => { st.join = v; refresh(); }, "mir-op")));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, st.join ? "Join merges each body with its mirror image into one body." : "New body makes a linked copy: it updates when you change the original."));
      },
      start() { showPlaneGizmo(true); refresh(); },
      cleanup() { showPlaneGizmo(false); },
      handler: {
        hover(e) {
          const { g, f, cp } = pickPlaneOrFace(e);
          hotGizmo(g && g.object);
          st.hover = !g && !cp && f && f.info && f.info.t === "PLANE" ? f : null;
          draw();
          vp.canvas.style.cursor = g || cp || f ? "pointer" : "default";
        },
        down(e) {
          const { g, f, cp } = pickPlaneOrFace(e);
          const wantPlane = st.pickPlane;
          if (cp && (wantPlane || !f)) { st.plane = { o: cp.plane.o.slice(), n: cp.plane.n.slice() }; st.planeName = cp.name; st.pickPlane = false; refresh(); return true; }
          if (g && (wantPlane || !f)) { const p = ORIGIN_PLANES[g.object.userData.plane]; st.plane = { o: p.o.slice(), n: p.n.slice() }; st.planeName = g.object.userData.plane; st.pickPlane = false; refresh(); return true; }
          if (!f) return true;
          if (wantPlane && f.info && f.info.t === "PLANE") {
            const pl = planeFromFace(f);
            const c = new THREE.Vector3(...f.info.c).applyMatrix4(f.base.m);
            st.plane = { o: c.toArray(), n: pl.n }; st.planeName = "Face of " + (findBody(store.doc, f.body)?.name || "body"); st.pickPlane = false; refresh(); return true;
          }
          const b = findBody(store.doc, f.body);
          if (b && b.locked) return true;
          const i = st.bodies.indexOf(f.body);
          if (i >= 0) st.bodies.splice(i, 1); else st.bodies.push(f.body);
          refresh();
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      if (st.hover && st.pickPlane) drawFace(st.hover.base, st.hover.face, 0xe8a317, 0.35);
      if (st.plane) {
        // the mirror plane, sized to the bodies
        const n = new THREE.Vector3(...st.plane.n).normalize(), o = new THREE.Vector3(...st.plane.o);
        const box = new THREE.Box3();
        for (const id of st.bodies) { const bb = scene.bodyTightBox(id); if (bb) box.union(bb); }
        const s = box.isEmpty() ? 60 : Math.max(20, box.getSize(new THREE.Vector3()).length() * 1.2);
        const c = box.isEmpty() ? o : new THREE.Plane().setFromNormalAndCoplanarPoint(n, o).projectPoint(box.getCenter(new THREE.Vector3()), new THREE.Vector3());
        const u = new THREE.Vector3(0, 0, 1).cross(n); if (u.lengthSq() < 1e-6) u.set(1, 0, 0); u.normalize();
        const v = n.clone().cross(u).normalize();
        const P = (a, b) => c.clone().addScaledVector(u, a * s / 2).addScaledVector(v, b * s / 2);
        drawLine([P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), P(-1, -1)], 0x7b4fa8);
        drawLine([P(-1, 0), P(1, 0)], 0x7b4fa8);
      }
    }
    function refresh(rerender = true) {
      if (rerender) def.render();
      scene.setSelected(st.bodies);
      draw();
      schedulePreview(def);
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Split body / Split face (Fusion-style)
  // the splitting plane from the plane gizmo, a construction plane or a flat face (world coordinates)
  function planePickerRows(body, st, refresh) {
    body.append(row("Tool plane", seg([["YZ", "YZ"], ["XZ", "XZ"], ["XY", "XY"]], ["YZ", "XZ", "XY"].includes(st.planeName) ? st.planeName : null, (v) => { const p = ORIGIN_PLANES[v]; st.plane = { o: p.o.slice(), n: p.n.slice() }; st.planeName = v; st.toolBody = null; st.curves = null; refresh(); }, "sp-origin")));
    const cps = store.doc.planes || [];
    if (cps.length) {
      const sel = el("tool-choice", { class: "num", id: "sp-cplane" }, el("option", { value: "" }, "A construction plane…"), ...cps.map((p) => el("option", { value: p.id }, p.name)));
      sel.onchange = () => { const p = cps.find((q) => q.id === sel.value); if (p) { st.plane = { o: p.plane.o.slice(), n: p.plane.n.slice() }; st.planeName = p.name; st.toolBody = null; st.curves = null; refresh(); } };
      body.append(row("", sel, "sp-cplane"));
    }
  }
  function drawToolPlane(st, ids) {
    if (!st.plane) return;
    const n = new THREE.Vector3(...st.plane.n).normalize(), o = new THREE.Vector3(...st.plane.o);
    const box = new THREE.Box3();
    for (const id of ids) { const bb = scene.bodyTightBox(id); if (bb) box.union(bb); }
    const sz = box.isEmpty() ? 60 : Math.max(20, box.getSize(new THREE.Vector3()).length() * 1.15);
    const c = box.isEmpty() ? o : new THREE.Plane().setFromNormalAndCoplanarPoint(n, o).projectPoint(box.getCenter(new THREE.Vector3()), new THREE.Vector3());
    const u = new THREE.Vector3(0, 0, 1).cross(n); if (u.lengthSq() < 1e-6) u.set(1, 0, 0); u.normalize();
    const v = n.clone().cross(u).normalize();
    const P = (a, b) => c.clone().addScaledVector(u, a * sz / 2).addScaledVector(v, b * sz / 2);
    drawLine([P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), P(-1, -1)], 0xd9534f);
    drawLine([P(-1, 0), P(1, 0)], 0xd9534f); drawLine([P(0, -1), P(0, 1)], 0xd9534f);
  }
  // a world plane in a body's own coordinates
  function planeToLocal(pl, bodyM) {
    const inv = M4(bodyM).invert();
    const o = new THREE.Vector3(...pl.o).applyMatrix4(inv);
    const n = new THREE.Vector3(...pl.n).transformDirection(inv).normalize();
    const r = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-12 ? 0 : +q.toFixed(9)));
    return { o: r(o), n: r(n) };
  }
  function splitBodyCmd() {
    const one = app.sel.length === 1 && findBody(store.doc, app.sel[0]);
    const st = { body: one && !one.locked ? one.id : null, plane: null, planeName: "", toolBody: null, sketch: null, kind: "plane", pick: one ? "tool" : "body" };
    const def = {
      title: "Split body",
      valid: () => !!st.body && (!!st.plane || !!st.toolBody || !!st.sketch),
      canOk: () => def.valid(),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b) return;
        const before = clone(b.node);
        const piece = { id: st.newId || (st.newId = uid("b")), name: (b.name || "Body") + " (split)", seq: nextSeq(doc), color: BODY_COLORS[(doc.bodies.length + 3) % BODY_COLORS.length], hole: false, hidden: false, ...(b.role === undefined ? {} : { role: b.role }), m: b.m.slice(), node: before };
        piece.node.mods = (piece.node.mods || []).slice();
        b.node.mods = b.node.mods || [];
        if (st.sketch) {
          // a sketch: its curves are pushed through the body; each piece keeps one side
          const inv = M4(b.m).invert();
          const L = (p) => new THREE.Vector3(...p).applyMatrix4(inv).toArray();
          const D = (v) => new THREE.Vector3(...v).transformDirection(inv).toArray();
          const k = st.sketch;
          const curves = k.segs.map((x) => x.t === "circle" ? { t: "circle", c: L(x.c), r: x.r, n: D(x.n) } : { t: x.t, a: L(x.a), b: L(x.b), m: x.m && L(x.m), spans: x.spans && x.spans.map((q) => q.map(L)) });
          const plane = { o: L(k.plane.o), x: D(k.plane.x), n: D(k.plane.n) };
          const base = { t: "sketchsplit", curves, poly: k.poly, closed: k.closed, plane };
          b.node.mods.push({ id: uid("f"), seq: piece.seq, ...base, side: "a" });
          piece.node.mods.push({ id: uid("f"), seq: piece.seq, ...clone(base), side: "b" });
        } else if (st.plane) {
          const pl = planeToLocal(st.plane, b.m);
          b.node.mods.push({ id: uid("f"), seq: piece.seq, t: "halfspace", plane: pl, side: 1 });
          piece.node.mods.push({ id: uid("f"), seq: piece.seq, t: "halfspace", plane: pl, side: -1 });
        } else {
          // split by another body: the part inside the tool becomes its own body; the tool body stays
          const tb = findBody(doc, st.toolBody);
          const tool = { t: "placed", src: clone(tb.node), srcM: tb.m.slice(), mods: [] };
          const m = arr(M4(b.m).invert());
          b.node.mods.push({ id: uid("f"), seq: piece.seq, t: "bool", op: "cut", tool, m });
          piece.node.mods.push({ id: uid("f"), seq: piece.seq, t: "bool", op: "intersect", tool: clone(tool), m });
        }
        doc.bodies.push(piece);
      },
      ok() { commit(def, "Split body"); },
      hint: () => st.pick === "body" ? "Click the body to split." : st.kind === "sketch" ? "Click a line, arc, spline or circle in a sketch (or pick a sketch in the list)." : st.kind === "body" ? "Click the body to split with." : "Pick a plane below, or click a plane or flat face.",
      build(body) {
        const bb = st.body && findBody(store.doc, st.body);
        body.append(row("Body to split", pickbox(st.pick === "body", bb ? el("span", {}, el("b", {}, bb.name)) : "Click a body", bb ? () => { st.body = null; st.pick = "body"; refresh(); } : null, () => { st.pick = "body"; def.render(); }), "sp-body"));
        body.append(row("Tool type", seg([["plane", "Plane / face"], ["sketch", "Sketch"], ["body", "Body"]], st.kind, (v) => { st.kind = v; st.pick = "tool"; st.plane = null; st.planeName = ""; st.toolBody = null; st.sketch = null; refresh(); }, "sp-kind")));
        const tname = st.toolBody ? (findBody(store.doc, st.toolBody)?.name || "Body") + " (body)" : st.sketch ? st.sketch.label : st.planeName;
        const ask = st.kind === "sketch" ? "Click a sketch line, arc, spline or circle" : st.kind === "body" ? "Click another body" : "Plane or flat face";
        body.append(row("Splitting tool", pickbox(st.pick === "tool", tname ? el("span", {}, el("b", {}, tname)) : ask, null, () => { st.pick = "tool"; def.render(); }), "sp-tool"));
        if (st.kind === "plane") planePickerRows(body, st, refresh);
        if (st.kind === "sketch") {
          const sks = store.doc.sketches || [];
          if (sks.length) {
            const sel = el("tool-choice", { class: "num", id: "sp-sketch" }, el("option", { value: "" }, "…or a whole sketch"), ...sks.map((k) => el("option", { value: k.id }, k.name || "Sketch")));
            sel.onchange = () => { if (sel.value) useSketch(sel.value, null); };
            body.append(row("", sel, "sp-sketch"));
          }
        }
        body.append(el("div", { class: "hint", style: { padding: 0 } }, st.kind === "sketch"
          ? "The sketch is pushed straight through the body (along its plane's normal). A closed shape splits off what's inside it; a line or curve splits the body into its two sides. Lines are treated as running on past their ends."
          : "The body is cut in two where the tool crosses it. Both pieces become separate bodies; a tool body is kept."));
      },
      start() { showPlaneGizmo(true); scene.state.forceSketches = new Set(store.doc.sketches.map((x) => x.id)); scene.syncSketches(store.view); refresh(); },
      cleanup() { showPlaneGizmo(false); scene.state.forceSketches = null; scene.syncSketches(store.view); scene.setSelected(app.sel); },
      handler: {
        hover(e) {
          if (st.pick === "tool" && st.kind === "sketch") { const h = pickSketchCurve(e); st.hoverCurve = h ? pathPts(h) : null; vp.canvas.style.cursor = h ? "pointer" : "default"; draw(); return; }
          const { g, f, cp } = pickPlaneOrFace(e);
          hotGizmo(st.pick === "tool" && st.kind === "plane" ? g && g.object : null);
          st.hover = f && f.info ? f : null;
          draw();
          vp.canvas.style.cursor = g || cp || f ? "pointer" : "default";
        },
        down(e) {
          const { g, f, cp } = pickPlaneOrFace(e);
          if (st.pick === "body") {
            if (f && !findBody(store.doc, f.body)?.locked) { st.body = f.body; st.pick = "tool"; refresh(); }
            return true;
          }
          if (st.kind === "sketch") {
            const h = pickSketchCurve(e);
            if (h) useSketch(h.sketch, h.curve.id);
            return true;
          }
          if (cp && !f) { st.plane = { o: cp.plane.o.slice(), n: cp.plane.n.slice() }; st.planeName = cp.name; st.toolBody = null; refresh(); return true; }
          if (g && !f) { const p = ORIGIN_PLANES[g.object.userData.plane]; st.plane = { o: p.o.slice(), n: p.n.slice() }; st.planeName = g.object.userData.plane; st.toolBody = null; refresh(); return true; }
          if (!f) return true;
          if (st.kind === "body") {
            if (f.body === st.body) { app.toast("Pick a different body as the tool."); return true; }
            st.toolBody = f.body; st.plane = null; st.planeName = ""; refresh(); return true;
          }
          if (f.info.t === "PLANE") {
            const pl = planeFromFace(f);
            st.plane = { o: new THREE.Vector3(...f.info.c).applyMatrix4(f.base.m).toArray(), n: pl.n }; st.planeName = "Face plane"; st.toolBody = null; refresh();
          } else app.toast("Pick a flat face, a plane or a body.");
          return true;
        },
      },
    };
    // a sketch as the tool: the chain of curves through the clicked one (or the sketch's first chain)
    function useSketch(id, curveId) {
      const sk = findSketch(store.view, id);
      if (!sk) return;
      const curves = resolveSketch(sk).filter((c) => !c.cons && (c.t === "line" || c.t === "arc" || c.t === "circle" || c.t === "spline"));
      const startId = curveId || (curves[0] && curves[0].id);
      if (!startId) { app.toast("That sketch has no lines or curves."); return; }
      const ents = pathChain(resolveSketch(sk), startId);
      const ordered = orderPath(resolveSketch(sk), ents);
      const M = sk.plane, y = [M.n[1] * M.x[2] - M.n[2] * M.x[1], M.n[2] * M.x[0] - M.n[0] * M.x[2], M.n[0] * M.x[1] - M.n[1] * M.x[0]];
      const W = (p) => [0, 1, 2].map((i) => M.o[i] + M.x[i] * p[0] + y[i] * p[1]);
      const segs = ordered.map((x) => x.t === "circle" ? { t: "circle", c: W(x.c), r: x.r, n: M.n } : { t: x.t, a: W(x.a), b: W(x.b), m: x.m && W(x.m), spans: x.spans && x.spans.map((q) => q.map(W)) });
      // the 2D outline (sketch coordinates) used to sort pieces to a side
      const poly = [];
      for (const x of ordered) { for (const q of sampleCurve(x, 48)) { const last = poly[poly.length - 1]; if (!last || Math.hypot(last[0] - q[0], last[1] - q[1]) > 1e-6) poly.push([q[0], q[1]]); } }
      const closed = ordered.some((x) => x.t === "circle") || (poly.length > 2 && Math.hypot(poly[0][0] - poly[poly.length - 1][0], poly[0][1] - poly[poly.length - 1][1]) < 1e-4);
      if (closed && poly.length > 2) poly.pop();
      // an open line splits a body only if it runs right across: extend both ends far past the body
      if (!closed && poly.length >= 2) {
        const ext = (a, b) => { const dx = a[0] - b[0], dy = a[1] - b[1], l = Math.hypot(dx, dy) || 1; return [a[0] + (dx / l) * 1e4, a[1] + (dy / l) * 1e4]; };
        const p0 = ext(poly[0], poly[1]), p1 = ext(poly[poly.length - 1], poly[poly.length - 2]);
        const first = segs[0], last = segs[segs.length - 1];
        poly.unshift(p0); poly.push(p1);
        segs.unshift({ t: "line", a: W(p0), b: first.a });
        segs.push({ t: "line", a: last.b, b: W(p1) });
      }
      st.sketch = { segs, poly, closed, plane: { o: M.o.slice(), x: M.x.slice(), n: M.n.slice() }, label: (sk.name || "Sketch") + (closed ? " (closed shape)" : " (curve)"), sketchId: id, ents };
      st.hoverCurve = null;
      refresh();
    }
    function draw() {
      clearOv();
      if (st.hover && st.pick === "tool" && st.kind === "plane" && st.hover.info.t === "PLANE") drawFace(st.hover.base, st.hover.face, 0xe8a317, 0.3);
      if (st.kind === "plane") drawToolPlane(st, st.body ? [st.body] : []);
      if (st.sketch) {
        const sk = findSketch(store.view, st.sketch.sketchId);
        if (sk) { const M = planeMatrix(sk.plane); for (const c of resolveSketch(sk).filter((c) => st.sketch.ents.includes(c.id))) drawLine(sampleCurve(c).map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M)), 0xd9534f); }
      }
      for (const pl of st.hoverCurve || []) drawLine(pl, 0xe8a317);
    }

    function refresh(rerender = true) {
      if (rerender) def.render();
      scene.setSelected([st.body, st.toolBody].filter(Boolean));
      draw();
      schedulePreview(def);
    }
    openCmd(def);
  }
  function splitFaceCmd(editing = null) {
    const st = { faces: [], body: null, plane: null, planeName: "", curves: null, curvesRef: null, pick: "faces" };
    const def = {
      title: "Split face",
      valid: () => st.faces.length > 0 && (!!st.plane || !!st.curves),
      canOk: () => def.valid(),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b) return;
        const inv = M4(b.m).invert();
        const mod = { id: uid("f"), seq: nextSeq(doc), t: "splitface", faces: st.faces.map((f) => (f.info.n ? { c: f.info.c, t: f.info.t, n: f.info.n } : { c: f.info.c, t: f.info.t })) };
        if (st.plane) mod.plane = planeToLocal(st.plane, b.m);
        else {
          // sketch curves, in body coordinates, pushed along the sketch's normal
          const L = (p) => new THREE.Vector3(...p).applyMatrix4(inv).toArray();
          mod.curves = st.curves.map((s) => s.t === "circle" ? { t: "circle", c: L(s.c), r: s.r, n: new THREE.Vector3(...s.n).transformDirection(inv).toArray() } : { t: s.t, a: L(s.a), b: L(s.b), m: s.m && L(s.m), spans: s.spans && s.spans.map((q) => q.map(L)) });
          mod.dir = new THREE.Vector3(...st.curvesDir).transformDirection(inv).toArray();
        }
        b.node.mods = b.node.mods || [];
        b.node.mods.push(mod);
      },
      ok() { commit(def, "Split face"); },
      hint: () => st.pick === "faces" ? "Click the faces to split (one body). Then pick the tool." : st.pick === "curve" ? "Click a sketch line, arc or spline: it is pushed straight through the faces." : "Pick a plane below, a flat face of another body, or switch to a sketch.",
      build(body) {
        body.append(row("Faces", pickbox(st.pick === "faces", st.faces.length ? el("span", {}, el("b", {}, st.faces.length), ` face${st.faces.length > 1 ? "s" : ""}`) : "Click faces", st.faces.length ? () => { st.faces = []; st.body = null; refresh(); } : null, () => { st.pick = "faces"; def.render(); }), "sf-faces"));
        body.append(row("Tool", seg([["plane", "Plane / face"], ["curve", "Sketch curve"]], st.pick === "curve" || st.curves ? "curve" : "plane", (v) => { st.pick = v === "curve" ? "curve" : "tool"; if (v === "curve") { st.plane = null; st.planeName = ""; } else { st.curves = null; } def.render(); draw(); }, "sf-kind")));
        if (st.pick === "curve" || st.curves) body.append(row("Sketch curve", pickbox(st.pick === "curve", st.curves ? el("span", {}, el("b", {}, st.curvesRef.ents.length), " curve(s)") : "Click a sketch curve", st.curves ? () => { st.curves = null; st.pick = "curve"; refresh(); } : null, () => { st.pick = "curve"; def.render(); }), "sf-curve"));
        else {
          body.append(row("Plane", pickbox(st.pick === "tool", st.planeName ? el("span", {}, el("b", {}, st.planeName)) : "Click a plane or face", null, () => { st.pick = "tool"; def.render(); }), "sf-plane"));
          planePickerRows(body, st, refresh);
        }
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "The faces are divided where the tool crosses them; the body's shape stays the same. Use it to offset, extrude or color part of a face."));
      },
      start() { showPlaneGizmo(true); refresh(); },
      cleanup() { showPlaneGizmo(false); },
      handler: {
        hover(e) {
          if (st.pick === "curve") { const h = pickSketchCurve(e); st.hoverCurve = h ? pathPts(h) : null; vp.canvas.style.cursor = h ? "pointer" : "default"; draw(); return; }
          const { g, f } = pickPlaneOrFace(e);
          hotGizmo(st.pick === "tool" ? g && g.object : null);
          st.hover = f && f.info ? f : null;
          draw();
        },
        down(e) {
          if (st.pick === "curve") {
            const h = pickSketchCurve(e);
            if (h) {
              const sk = findSketch(store.view, h.sketch);
              const ents = pathChain(resolveSketch(sk), h.curve.id);
              const M = sk.plane, y = [M.n[1] * M.x[2] - M.n[2] * M.x[1], M.n[2] * M.x[0] - M.n[0] * M.x[2], M.n[0] * M.x[1] - M.n[1] * M.x[0]];
              const W = (p) => [0, 1, 2].map((i) => M.o[i] + M.x[i] * p[0] + y[i] * p[1]);
              st.curves = orderPath(resolveSketch(sk), ents).map((x) => x.t === "circle" ? { t: "circle", c: W(x.c), r: x.r, n: M.n } : { t: x.t, a: W(x.a), b: W(x.b), m: x.m && W(x.m), spans: x.spans && x.spans.map((q) => q.map(W)) });
              st.curvesDir = M.n.slice(); st.curvesRef = { sketch: h.sketch, ents };
              st.pick = st.faces.length ? null : "faces"; st.hoverCurve = null; refresh();
            }
            return true;
          }
          const { g, f, cp } = pickPlaneOrFace(e);
          if (st.pick === "faces" || !st.pick) {
            if (!f || !f.info) return true;
            if (st.body && f.body !== st.body) { app.toast("Split faces of one body at a time."); return true; }
            st.body = f.body;
            const i = st.faces.findIndex((x) => x.face === f.face);
            if (i >= 0) st.faces.splice(i, 1); else st.faces.push({ base: f.base, face: f.face, info: f.info });
            if (!st.faces.length) st.body = null;
            refresh(); return true;
          }
          if (cp && !f) { st.plane = { o: cp.plane.o.slice(), n: cp.plane.n.slice() }; st.planeName = cp.name; refresh(); return true; }
          if (g && !f) { const p = ORIGIN_PLANES[g.object.userData.plane]; st.plane = { o: p.o.slice(), n: p.n.slice() }; st.planeName = g.object.userData.plane; refresh(); return true; }
          if (f && f.info && f.info.t === "PLANE") { const pl = planeFromFace(f); st.plane = { o: new THREE.Vector3(...f.info.c).applyMatrix4(f.base.m).toArray(), n: pl.n }; st.planeName = "Face plane"; st.pick = "faces"; refresh(); }
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      for (const f of st.faces) drawFace(f.base, f.face, 0x2f66c8, 0.3);
      if (st.hover && (st.pick === "faces" || (st.pick === "tool" && st.hover.info.t === "PLANE"))) drawFace(st.hover.base, st.hover.face, 0xe8a317, 0.3);
      drawToolPlane(st, st.body ? [st.body] : []);
      if (st.curves) { for (const pl of pathPtsFromSegs(st.curves)) drawLine(pl, 0xd9534f); }
      for (const pl of st.hoverCurve || []) drawLine(pl, 0xe8a317);
    }
    function pathPtsFromSegs(segs) { return segs.map((x) => x.t === "circle" ? [] : [new THREE.Vector3(...x.a), ...(x.m ? [new THREE.Vector3(...x.m)] : []), new THREE.Vector3(...x.b)]); }
    function refresh(rerender = true) {
      if (rerender) def.render();
      draw();
      schedulePreview(def);
    }
    st.pick = "faces";
    openCmd(def);
  }

  // ------------------------------------------------------------------ FlexiGen (one object, worked on as a copy)
  function flexiGenCmd() {
    const ok = (id) => { const b = findBody(store.doc, id); return b && !b.hole && !b.hidden && scene.views.get(id)?.data; };
    const sel = app.sel.filter(ok);
    if (sel.length === 1) { app.flexigen.open(sel[0]); return; }
    let hover = null;
    const def = {
      title: "FlexiGen",
      okLabel: "Cancel",
      hint: () => "Click the one object to turn into a flexi model.",
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, sel.length > 1 ? "FlexiGen works on one object at a time. Click the one you want." : "Click the object to turn into a print-in-place flexi model."));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "FlexiGen works on a copy: your design, the 3D Print Sim and the simulations keep the original object."));
      },
      ok() { closeCmd(false); },
      cleanup() { scene.setHovered(null); },
      handler: {
        hover(e) { const f = pickBaseFace(e, (b) => !b.hole); const id = f ? f.body : null; if (id !== hover) { hover = id; scene.setHovered(id); } vp.canvas.style.cursor = id ? "pointer" : "default"; },
        down(e) { const f = pickBaseFace(e, (b) => !b.hole); if (f && ok(f.body)) { closeCmd(false); app.select([f.body]); app.flexigen.open(f.body); } return true; },
      },
    };
    openCmd(def);
  }
  // ------------------------------------------------------------------ Render (photo-style picture)
  const renderPrefs = { quality: "medium", shape: "view", lightType: "studio", lightColor: "neutral", customColor: "#ffe2b8", azimuth: -50, elevation: 45, intensity: 1, softness: 1, background: "studio", floor: true, bgImage: null, bgName: "" };
  function renderItems() {
    const items = [];
    const useAp = scene.state.appearance !== false;
    for (const b of store.doc.bodies) {
      if (b.hole || b.hidden) continue;
      const v = scene.views.get(b.id);
      if (!v || !v.mesh || !v.group.visible) continue;
      v.mesh.updateMatrixWorld(true);
      const ap = useAp ? b.appearance : null;
      const materials = [{ look: ap && ap.body ? ap.body : null, color: b.color }];
      let groups = null;
      if (useAp && v.faceMat && v.mats && v.mats.length > 3) {
        for (let i = 3; i < v.mats.length; i++) materials.push({ look: v.mats[i].userData.look, color: b.color });
        groups = v.mesh.geometry.groups.map((g, i) => { const m = v.faceMat.get(i); return m ? m - 2 : 0; });
      }
      items.push({ geometry: v.mesh.geometry, matrix: v.mesh.matrixWorld.clone(), materials, groups });
    }
    return items;
  }
  function renderSize(q) {
    const w = QUALITY[q].width;
    const shape = renderPrefs.shape;
    const a = shape === "16:9" ? 16 / 9 : shape === "4:3" ? 4 / 3 : shape === "1:1" ? 1 : vp.w / Math.max(1, vp.h);
    return [w, Math.round(w / a)];
  }
  function renderJob(over = {}) {
    const P = renderPrefs;
    const [W, H] = renderSize(P.quality);
    return { items: renderItems(), camera: vp.camera, width: W, height: H, samples: QUALITY[P.quality].samples, lightType: P.lightType, lightColor: P.lightColor, customColor: P.customColor,
      azimuth: P.azimuth, elevation: P.elevation, intensity: P.intensity, softness: P.softness, background: P.background, bgImage: P.bgImage, floor: P.floor, ...over };
  }
  function renderCmd() {
    const P = renderPrefs;
    let preview = null, pvTimer = 0;
    const pvCanvas = el("canvas", { class: "rd-preview", id: "rd-preview", width: 360, height: 220 });
    function updatePreview() {
      clearTimeout(pvTimer);
      pvTimer = setTimeout(() => {
        if (preview) preview.cancel();
        const [W, H] = renderSize(P.quality);
        const pw = 360, ph = Math.round(pw * H / W);
        const items = renderItems();
        if (!items.length) return;
        const job = renderJob({ width: pw, height: ph, samples: 14, items, onProgress: (n, t, cv) => draw(cv) });
        const draw = (cv) => { if (!pvCanvas.isConnected) return; pvCanvas.width = pw; pvCanvas.height = ph; const g = pvCanvas.getContext("2d"); g.clearRect(0, 0, pw, ph); g.drawImage(cv, 0, 0, pw, ph); };
        const r = (preview = renderImage(job));
        r.promise.then(() => { if (preview === r) preview = null; }).catch(() => {});
      }, 250);
    }
    const def = {
      title: "Render",
      wide: true,
      okLabel: "Render",
      valid: () => renderItems().length > 0,
      canOk: () => renderItems().length > 0,
      apply() {},
      ok() { startRender(); },
      hint: () => "Orbit, pan and zoom the view to frame the shot. The picture uses what the view shows.",
      build(body) {
        body.append(pvCanvas);
        body.append(el("div", { class: "hint", style: { padding: "0 0 6px" } }, "Quick preview (low quality). Frame the shot in the view, then press Render."));
        body.append(el("div", { class: "subhead" }, "Quality"));
        body.append(seg(Object.entries(QUALITY).map(([k, q]) => [k, q.label]), P.quality, (v) => { P.quality = v; def.render(); updatePreview(); }, "rd-quality"));
        const [W, H] = renderSize(P.quality);
        body.append(el("div", { class: "hint", style: { padding: "4px 0 0" } }, `${W} × ${H} pixels, ${QUALITY[P.quality].samples} passes: usually ${QUALITY[P.quality].note}.`));
        body.append(row("Picture shape", seg([["view", "View"], ["16:9", "16:9"], ["4:3", "4:3"], ["1:1", "Square"]], P.shape, (v) => { P.shape = v; def.render(); updatePreview(); }, "rd-shape")));
        body.append(el("div", { class: "subhead" }, "Lighting"));
        const lt = el("tool-choice", { class: "num", id: "rd-light" }, ...Object.entries(LIGHT_TYPES).map(([k, t]) => el("option", { value: k, selected: k === P.lightType }, t.label)));
        lt.onchange = () => { P.lightType = lt.value; updatePreview(); };
        body.append(row("Light type", lt, "rd-light"));
        const colors = [...Object.entries(LIGHT_COLORS).map(([k, c]) => [k, c.label]), ["custom", "Custom"]];
        const lc = el("div", { class: "rd-colors", id: "rd-color" }, ...colors.map(([k, label]) => el("button", { class: "rd-chip", "aria-pressed": P.lightColor === k, title: label, onclick: () => { P.lightColor = k; def.render(); updatePreview(); } },
          el("i", { style: { background: k === "custom" ? P.customColor : LIGHT_COLORS[k].color } }), label)));
        body.append(row("Light color", lc, "rd-color"));
        if (P.lightColor === "custom") {
          const ci = el("input", { type: "color", id: "rd-custom", value: P.customColor });
          ci.addEventListener("input", () => { P.customColor = ci.value; updatePreview(); });
          body.append(row("Custom color", ci, "rd-custom"));
        }
        const live = (k) => (v) => { P[k] = v; updatePreview(); };
        body.append(sliderRow("Direction", "rd-az", P.azimuth, -180, 180, 5, "°", live("azimuth")));
        body.append(el("div", { class: "hint", style: { padding: 0, marginTop: "-4px" } }, "Direction: 0° lights from behind you, −90° from the left, +90° from the right, 180° from behind the model."));
        body.append(sliderRow("Height", "rd-el", P.elevation, 3, 88, 1, "°", live("elevation")));
        body.append(sliderRow("Brightness", "rd-int", P.intensity, 0.2, 2.5, 0.05, "×", live("intensity")));
        body.append(sliderRow("Softness", "rd-soft", P.softness, 0, 3, 0.05, "×", live("softness")));
        body.append(el("div", { class: "subhead" }, "Background"));
        const bg = el("tool-choice", { class: "num", id: "rd-bg" }, ...Object.entries(BACKGROUNDS).map(([k, b]) => el("option", { value: k, selected: k === P.background }, b.label)));
        bg.onchange = () => { P.background = bg.value; def.render(); if (P.background === "image" && !P.bgImage) pickBg(); else updatePreview(); };
        body.append(row("Background", bg, "rd-bg"));
        if (P.background === "image") body.append(row("Picture", el("button", { class: "btn", id: "rd-bgpick", onclick: pickBg }, P.bgImage ? "Change: " + P.bgName : "Choose a picture…"), "rd-bgpick"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "rd-floor", checked: P.floor, onchange: (e) => { P.floor = e.target.checked; updatePreview(); } }), "Shadows on the floor"));
        body.append(el("div", { class: "rd-warn", id: "rd-warn" }, "Rendering can take several minutes, especially at High and Ultra high. Keep this tab open while it works; you can cancel any time."));
      },
      start() { def.render(); updatePreview(); },
      cleanup() { clearTimeout(pvTimer); if (preview) preview.cancel(); vp.onViewChange = null; },
      handler: {},
    };
    function pickBg() {
      const inp = el("input", { type: "file", accept: "image/*" });
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const img = new Image();
        img.onload = () => { P.bgImage = img; P.bgName = f.name.slice(0, 28); P.background = "image"; def.render(); updatePreview(); };
        img.onerror = () => app.toast("That picture couldn't be opened.", "err");
        img.src = URL.createObjectURL(f);
      };
      inp.click();
    }
    // the preview follows the view as you orbit
    vp.onViewChange = () => updatePreview();
    openCmd(def);
  }
  function startRender() {
    const items = renderItems();
    if (!items.length) { app.toast("There's nothing to render yet."); return; }
    const job = renderJob({ items });
    const back = el("div", { class: "modal-back" });
    const view = el("canvas", { class: "rd-out", id: "rd-out" });
    const bar = el("i", {});
    const info = el("div", { class: "rd-info", id: "rd-info" }, "Starting…");
    const cancelBtn = el("button", { class: "btn", id: "rd-cancel" }, "Cancel");
    const saveBtn = el("button", { class: "btn primary", id: "rd-save", hidden: true }, "Save PNG");
    const modal = el("div", { class: "modal render", role: "dialog", "aria-label": "Rendering" },
      el("header", {}, el("h2", {}, "Rendering"), el("span", { class: "rd-size" }, `${job.width} × ${job.height} · ${QUALITY[renderPrefs.quality].label}`)),
      el("div", { class: "mbody" }, el("div", { class: "rd-frame" }, view), el("div", { class: "rd-bar" }, bar), info,
        el("div", { class: "rd-btns" }, cancelBtn, saveBtn)));
    back.append(modal);
    document.body.append(back);
    const fmtT = (ms) => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
    const fit = () => { const mw = Math.min(innerWidth * 0.86, 1100), mh = innerHeight * 0.62; const k = Math.min(mw / job.width, mh / job.height); view.style.width = Math.round(job.width * k) + "px"; view.style.height = Math.round(job.height * k) + "px"; };
    view.width = Math.min(job.width, 1400); view.height = Math.round(view.width * job.height / job.width);
    fit();
    job.onProgress = (n, total, cv, ms) => {
      const g = view.getContext("2d"); g.clearRect(0, 0, view.width, view.height); g.drawImage(cv, 0, 0, view.width, view.height);
      bar.style.width = (100 * n / total).toFixed(1) + "%";
      const left = n ? (ms / n) * (total - n) : 0;
      info.textContent = n < total ? `Pass ${n} of ${total} · ${fmtT(ms)} so far · about ${fmtT(left)} left` : `Done in ${fmtT(ms)}`;
    };
    const r = renderImage(job);
    let done = null;
    cancelBtn.onclick = () => { if (done) { back.remove(); return; } r.cancel(); back.remove(); app.toast("Render cancelled"); };
    r.promise.then((res) => {
      done = res;
      cancelBtn.textContent = "Close";
      saveBtn.hidden = false;
      const name = (store.doc.name || "render").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "render";
      saveBtn.onclick = () => app.projects.saveImage(name + "-render.png", res.blob);
      saveBtn.focus();
    }).catch((e) => { if (e && e.message !== "cancelled") { info.textContent = "The render stopped: " + (e.message || e) + ". Try a lower quality."; cancelBtn.textContent = "Close"; done = true; } });
  }
  // ------------------------------------------------------------------ Appearance (display only)
  function appearanceCmd() {
    const st = { target: "body", bodies: [], faces: [], mat: "paint", color: "#2f6fd6", color2: "#9b3fc4", bands: 1, remove: false };
    for (const id of app.sel) if (!app.isLocked(id)) { const b = findBody(store.doc, id); if (b && !b.hole) st.bodies.push(id); }
    let hover = null;
    const faceRef = (info) => (info.n ? { c: info.c, t: info.t, n: info.n } : { c: info.c, t: info.t });
    const sameFace = (a, b) => a.t === b.t && Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]) < 1e-6;
    const count = () => (st.target === "body" ? st.bodies.length : st.faces.length);
    const def = {
      title: "Appearance",
      wide: true,
      valid: () => count() > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const fx = matByKey(st.mat).fx, look = { mat: st.mat, color: st.color };
        if (fx === "grad") look.color2 = st.color2;
        if (fx === "rainbow" && st.bands > 1) look.bands = st.bands;
        const tidy = (b) => { const a = b.appearance; if (a && !a.body && !(a.faces && a.faces.length)) delete b.appearance; };
        if (st.target === "body") {
          for (const id of st.bodies) {
            const b = findBody(doc, id);
            if (!b) continue;
            if (st.remove) { delete b.appearance; continue; }
            b.appearance = { ...(b.appearance || {}), body: look };
          }
        } else {
          for (const f of st.faces) {
            const b = findBody(doc, f.body);
            if (!b) continue;
            const ref = faceRef(f.info);
            const a = (b.appearance = { ...(b.appearance || {}) });
            a.faces = (a.faces || []).filter((x) => !sameFace(x, ref));
            if (!st.remove) a.faces.push({ ...ref, ...look });
            tidy(b);
          }
        }
      },
      ok() { commit(def, st.remove ? "Remove appearance" : "Appearance"); },
      hint: () => st.target === "body" ? "Click bodies to color them (click again to remove from the list)." : "Click faces to color them (click again to remove from the list).",
      build(body) {
        body.append(row("Apply to", seg([["body", "Bodies"], ["face", "Faces"]], st.target, (v) => { st.target = v; refresh(); }, "ap-target")));
        const n = count(), what = st.target === "body" ? "bod" + (n === 1 ? "y" : "ies") : "face" + (n === 1 ? "" : "s");
        body.append(pickbox(true, n ? el("span", {}, el("b", {}, n), " " + what) : st.target === "body" ? "Click bodies" : "Click faces", n ? () => { st.bodies = []; st.faces = []; refresh(); } : null));
        const m = matByKey(st.mat);
        body.append(row("Mode", seg([[false, "Apply"], [true, "Remove"]], st.remove, (v) => { st.remove = v; refresh(); }, "ap-mode")));
        if (!st.remove) {
          const lib = el("div", { class: "ap-lib", id: "ap-lib" });
          let grp = null;
          for (const it of MATERIALS) {
            if (it.group !== grp) { grp = it.group; lib.append(el("div", { class: "ap-group" }, grp)); }
            lib.append(el("button", { class: "ap-item", id: "ap-" + it.key, title: it.name, "aria-pressed": st.mat === it.key, onclick: () => { st.mat = it.key; if (!it.tint) st.color = it.color; else if (st.colorFor !== it.key && !st.userColor) st.color = it.color; st.colorFor = it.key; if (it.fx === "grad" && !st.userColor2) st.color2 = it.color2; refresh(); } },
              el("span", { class: "ap-ball", style: { background: swatchCSS({ mat: it.key, color: it.tint ? (st.mat === it.key ? st.color : it.color) : it.color, color2: st.mat === it.key ? st.color2 : it.color2 }) } }), el("span", { class: "ap-name" }, it.name)));
          }
          body.append(lib);
          const col = el("input", { type: "color", id: "ap-color", value: m.tint ? st.color : m.color, disabled: !m.tint, "aria-label": "Color" });
          col.addEventListener("input", () => { st.color = col.value; st.userColor = true; const ball = document.querySelector("#ap-" + st.mat + " .ap-ball"); if (ball) ball.style.background = swatchCSS({ mat: st.mat, color: st.color }); schedulePreview(def); });
          if (m.fx === "grad") {
            // two-tone gradient silk: the bottom color, then the top color
            const col2 = el("input", { type: "color", id: "ap-color2", value: st.color2, "aria-label": "Top color" });
            col2.addEventListener("input", () => { st.color2 = col2.value; st.userColor2 = true; const ball = document.querySelector("#ap-" + st.mat + " .ap-ball"); if (ball) ball.style.background = swatchCSS({ mat: st.mat, color: st.color, color2: st.color2 }); schedulePreview(def); });
            body.append(row("Bottom color", el("div", { class: "ap-colorrow" }, col, el("span", { class: "hint", style: { padding: 0 } }, "Fades upwards into the top color")), "ap-color"));
            body.append(row("Top color", el("div", { class: "ap-colorrow" }, col2), "ap-color2"));
          } else if (m.fx === "rainbow") {
            body.append(row("Rainbows", seg([[1, "1"], [2, "2"], [3, "3"], [4, "4"]], st.bands, (v) => { st.bands = v; refresh(); }, "ap-bands")));
            body.append(el("div", { class: "hint", style: { padding: 0 } }, "Rainbow silk changes color along the filament, so the colors run up the print in bands from bottom to top. Pick how many times the rainbow repeats."));
          } else body.append(row("Color", el("div", { class: "ap-colorrow" }, col, el("span", { class: "hint", style: { padding: 0 } }, m.tint ? "Pick any color" : m.name + " has its own color")), "ap-color"));
        }
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ap-show", checked: app.scene.state.appearance !== false, onchange: (e) => app.setAppearances(e.target.checked) }), "Show appearances"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Appearances only change how parts look on screen. Shapes and exports stay the same. Turn them off any time with the paint button by the view controls."));
      },
      start() { refresh(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          hover = f && f.info ? f : null;
          if (hover && st.target === "body") scene.setHovered(hover.body); else scene.setHovered(null);
          draw();
          vp.canvas.style.cursor = hover ? "pointer" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          if (!f || !f.info) return true;
          if (st.target === "body") {
            const i = st.bodies.indexOf(f.body);
            if (i >= 0) st.bodies.splice(i, 1); else st.bodies.push(f.body);
          } else {
            const i = st.faces.findIndex((x) => x.body === f.body && x.face === f.face);
            if (i >= 0) st.faces.splice(i, 1); else st.faces.push({ body: f.body, base: f.base, face: f.face, info: f.info });
          }
          refresh();
          return true;
        },
      },
      cleanup() { scene.setHovered(null); scene.setSelected(app.sel); },
    };
    function draw() {
      clearOv();
      if (st.target === "face") {
        for (const f of st.faces) drawFace(f.base, f.face, 0x2f66c8, 0.12);
        if (hover && !st.faces.some((f) => f.face === hover.face && f.body === hover.body)) drawFace(hover.base, hover.face, 0xe8a317, 0.35);
      }
    }
    function refresh(rerender = true) {
      if (rerender) def.render();
      scene.setSelected(st.target === "body" ? st.bodies : []);
      draw();
      schedulePreview(def);
    }
    openCmd(def);
  }
  // a labelled slider with a typed value next to it
  function sliderRow(label, id, value, min, max, step, unit, onChange) {
    const clampV = (v) => Math.min(max, Math.max(min, v));
    const range = el("input", { type: "range", class: "slider", id: id + "-range", min, max, step, value: clampV(value), "aria-label": label });
    const num = app.numField({ value, id, min, step, onCommit: (v) => { range.value = clampV(v); onChange(v); } });
    range.addEventListener("input", () => { const v = +range.value; num.setValue(v); onChange(v); });
    range.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && range.closest("#cmd")) app.submitCommand(); });
    return el("div", { class: "row sliderrow" }, el("label", { for: id }, label), el("div", { class: "slidebox" }, range, num, el("span", { class: "unit" }, unit)));
  }
  // texture thumbnails are drawn a few at a time so the panel opens instantly
  const thumbQueue = [];
  let thumbBusy = false;
  function pumpThumbs() {
    if (thumbBusy) return;
    thumbBusy = true;
    const step = () => {
      const t0 = performance.now();
      while (thumbQueue.length && performance.now() - t0 < 30) {
        const [img, key] = thumbQueue.shift();
        if (img.isConnected) img.src = textureThumb(key, 88);
      }
      if (thumbQueue.length) setTimeout(step, 0); else thumbBusy = false;
    };
    setTimeout(step, 0);
  }

  // ------------------------------------------------------------------ Shell
  // ------------------------------------------------------------------ Clearance (moving parts)
  // Finds bodies that touch or overlap (a wheel on its axle, a pin in a hinge, a lid in a box)
  // and cuts a gap into one of each pair: the other part, grown all over by the gap (Offset
  // face on every face), is cut away. Moving parts then print loose instead of fused.
  const CLEAR_KEY = "jumpstart3d.clearance";
  const CLEAR_PRESETS = [["0.2", "Snug", "0.2 mm: tight fit, well-tuned printer"], ["0.3", "Normal", "0.3 mm: most printers (best start)"], ["0.5", "Loose", "0.5 mm: print-in-place, rough printers"]];
  function clearanceCmd(editing = null) {
    if (editing) return clearanceEdit(editing);
    let saved = 0.3;
    try { const v = parseFloat(localStorage.getItem(CLEAR_KEY)); if (v > 0) saved = v; } catch (e) {}
    const solids = () => store.doc.bodies.filter((b) => !b.hole && !b.hidden);
    const preSel = app.sel.filter((id) => { const b = findBody(store.doc, id); return b && !b.hole; });
    const st = { scope: preSel.length >= 2 ? "sel" : "all", ids: preSel, gap: saved, pairs: null, busy: false, err: null, scanned: "" };
    const name = (id) => findBody(store.doc, id)?.name || "body";
    const inScope = () => (st.scope === "sel" ? st.ids.map((id) => findBody(store.doc, id)).filter((b) => b && !b.hole && !b.hidden) : solids());
    let scanNo = 0;
    async function scan() {
      const list = inScope();
      const sig = st.gap + "|" + list.map((b) => b.id + ":" + bodyKey(resolveNode(b.node, store.doc)) + ":" + b.m.join(",")).join(";");
      if (sig === st.scanned && st.pairs) return;
      const my = ++scanNo;
      st.busy = true; st.err = null; refresh();
      if (list.length < 2) { st.pairs = []; st.busy = false; st.scanned = sig; refresh(); return; }
      try {
        const res = await app.kernel.contacts(list.map((b) => ({ id: b.id, node: resolveNode(b.node, store.doc), m: b.m })), st.gap);
        if (my !== scanNo || app.command !== def) return;
        // the part that gets the gap: the bigger one (a wheel's hole grows, not its axle)
        st.pairs = res.pairs.map((p) => ({ ...p, on: true, cut: (res.vols[p.a] || 0) >= (res.vols[p.b] || 0) ? p.a : p.b }));
        st.scanned = sig;
      } catch (e) { if (my === scanNo) { st.err = "Couldn't check the parts: " + e.message; st.pairs = []; } }
      if (my !== scanNo) return;
      st.busy = false; refresh();
    }
    const chosen = () => (st.pairs || []).filter((p) => p.on);
    const def = {
      title: "Clearance",
      wide: true,
      keepSelection: false,
      valid: () => chosen().length > 0 && st.gap > 0,
      canOk: () => def.valid() && !st.busy,
      apply(doc) {
        for (const p of chosen()) {
          const tb = findBody(doc, p.cut), ob = findBody(doc, p.cut === p.a ? p.b : p.a);
          if (!tb || !ob) continue;
          const grown = clone(ob.node);
          grown.mods = [...(grown.mods || []), { id: uid("f"), t: "offset", all: true, d: st.gap, faces: [] }];
          tb.node.mods = tb.node.mods || [];
          tb.node.mods.push({
            id: uid("f"), seq: nextSeq(doc), t: "bool", src: "clearance", op: "cut", gap: st.gap, other: ob.name || "body",
            tool: { t: "group", children: [{ node: grown, m: ob.m.slice(), hole: false, name: ob.name }], mods: [] },
            m: arr(M4(tb.m).invert()),
          });
        }
      },
      ok() {
        try { localStorage.setItem(CLEAR_KEY, String(st.gap)); } catch (e) {}
        const n = chosen().length;
        commit(def, "Clearance");
        app.toast(`Added a ${withUnit(st.gap, 2)} gap to ${n} pair${n > 1 ? "s" : ""} of parts.`);
      },
      hint: () => st.scope === "sel" ? "Click or tap bodies to choose them (again to drop one), or drag a box around several. Pairs that touch get a gap." : "Parts that touch or overlap get a gap so they move freely after printing. Untick any pair that should stay joined, or click bodies to choose only some.",
      build(body) {
        body.append(row("Parts", seg([["all", "All bodies"], ["sel", `Chosen (${st.ids.length})`]], st.scope, (v) => {
          st.scope = v; st.pairs = null; scan();
        }, "cl-scope")));
        if (st.scope === "sel") body.append(el("div", { class: "hint", id: "cl-pickhint", style: { padding: 0 } }, st.ids.length ? st.ids.map(name).join(", ") + (st.ids.length < 2 ? ". Choose at least one more body." : "") : "Click or tap the bodies to check (two or more), or drag a box around them."));
        body.append(row("Gap", seg(CLEAR_PRESETS.map(([v, l]) => [v, l]), CLEAR_PRESETS.find((q) => +q[0] === st.gap)?.[0] || "", (v) => { st.gap = +v; def.gapInput && def.gapInput.setValue(st.gap); scan(); }, "cl-preset")));
        body.append(row("", (def.gapInput = app.numField({ value: st.gap, id: "cl-gap", len: true, min: 0.05, step: 0.05, onCommit: (v) => { if (v > 0) { st.gap = v; scan(); refresh(); } } })), "cl-gap"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "The gap between moving surfaces. 0.3 mm suits most printers; use more for parts printed already assembled."));
        const box = el("div", { class: "cl-list", id: "cl-pairs", style: { display: "flex", flexDirection: "column", gap: "6px", maxHeight: "260px", overflowY: "auto" } });
        if (st.busy) box.append(el("div", { class: "hint", style: { padding: 0 } }, "Looking for parts that touch…"));
        else if (st.err) box.append(el("div", { class: "err-msg" }, st.err));
        else if (st.scope === "sel" && st.ids.length < 2) box.append(el("div", { class: "hint", style: { padding: 0 } }, "Choose two or more bodies to check."));
        else if (st.pairs && !st.pairs.length) box.append(el("div", { class: "hint", style: { padding: 0 } }, "No parts touch or overlap" + (st.scope === "sel" ? " among the chosen bodies." : ".") + " Nothing needs a gap."));
        else if (st.pairs) {
          box.append(el("div", { class: "subhead" }, `${st.pairs.length} pair${st.pairs.length > 1 ? "s" : ""} touching`));
          st.pairs.forEach((p, i) => {
            const other = p.cut === p.a ? p.b : p.a;
            const how = p.d < 0.005 ? "touching or overlapping" : `${withUnit(p.d, 2)} apart`;
            const rowEl = el("div", { class: "cl-pair", id: "cl-pair-" + i, style: { border: "1px solid var(--line)", borderRadius: "6px", padding: "6px 8px", display: "flex", flexDirection: "column", gap: "4px" } },
              el("label", { class: "check" }, el("input", { type: "checkbox", id: "cl-on-" + i, checked: p.on, onchange: (e) => { p.on = e.target.checked; refresh(); } }), el("b", {}, name(p.a)), " and ", el("b", {}, name(p.b)), el("small", { style: { marginLeft: "auto", color: "var(--ink-3)" } }, how)),
              el("div", { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--ink-2)" } }, "Cut the gap into",
                el("tool-choice", { class: "num", id: "cl-cut-" + i, style: { width: "auto", flex: 1 }, disabled: !p.on || null, onchange: (e) => { p.cut = e.target.value; refresh(); } },
                  ...[p.cut, other].map((id) => el("option", { value: id, selected: id === p.cut || null }, name(id))))));
            rowEl.onmouseenter = () => { scene.setSelected([p.cut]); scene.setToolBodies([other]); scene.refresh(); };
            rowEl.onmouseleave = () => { scene.setSelected(def.sceneSel()); scene.setToolBodies([]); scene.refresh(); };
            box.append(rowEl);
          });
        }
        body.append(box);
      },
      start() { refresh(); scan(); },
      cleanup() { scanNo++; scene.setSelected([]); scene.setToolBodies([]); scene.setHovered(null); scene.refresh(); },
      // the chosen bodies stay highlighted
      sceneSel: () => (st.scope === "sel" ? st.ids.slice() : []),
      // a body clicked in the Browser
      pickBody(id) { toggle(id); },
      handler: {
        hover(e) { const id = under(e); scene.setHovered(id); vp.canvas.style.cursor = id ? "pointer" : "default"; },
        leave() { scene.setHovered(null); },
        down(e) { press = { start: vp.local(e), id: under(e) }; return true; },
        move(e) {
          if (rubber) { app.beginner.handler.move(e); return; }
          if (!press) return;
          const [x, y] = vp.local(e);
          if (Math.hypot(x - press.start[0], y - press.start[1]) < 5) return;
          // a selection window adds every body it catches
          app.beginner.rubberDown(e, true, press.start, [], (ids) => {
            const ok = ids.filter((id) => { const b = findBody(store.doc, id); return b && !b.hole && !b.hidden; });
            if (st.scope !== "sel") { st.scope = "sel"; st.ids = []; }
            for (const id of ok) if (!st.ids.includes(id)) st.ids.push(id);
            st.pairs = null; refresh(); scan();
          });
          rubber = true; press = null;
          app.beginner.handler.move(e);
        },
        up(e) {
          if (rubber) { rubber = false; app.beginner.handler.up(e); return; }
          const pr = press; press = null;
          if (pr && pr.id) toggle(pr.id);
        },
        cancel() { press = null; if (rubber) { rubber = false; app.beginner.handler.cancel(); } },
      },
    };
    let press = null, rubber = false;
    const under = (e) => { for (const h of vp.pick(e, scene.meshes())) { const b = h.object.userData.bodyView.body; if (b && !b.hole && !b.hidden) return b.id; } return null; };
    // choosing a body switches to "Chosen" (starting from none, so a first click picks just that one)
    function toggle(id) {
      const b = findBody(store.doc, id);
      if (!b || b.hole) return;
      if (st.scope !== "sel") { st.scope = "sel"; st.ids = []; }
      st.ids = st.ids.includes(id) ? st.ids.filter((x) => x !== id) : [...st.ids, id];
      st.pairs = null; refresh(); scan();
    }
    function refresh(rerender = true) { if (rerender) def.render(); scene.setSelected(def.sceneSel()); schedulePreview(def); }
    openCmd(def);
  }
  // change the gap of a clearance made earlier
  function clearanceEdit(editing) {
    const b = findBody(store.doc, editing.body), m = b && b.node.mods.find((x) => x.id === editing.mod);
    if (!m) return;
    const st = { gap: m.gap || 0.3 };
    const def = {
      title: "Edit Clearance",
      valid: () => st.gap > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const tb = findBody(doc, editing.body), mm = tb && tb.node.mods.find((x) => x.id === editing.mod);
        if (!mm) return;
        mm.gap = st.gap;
        for (const c of mm.tool.children || []) for (const q of c.node.mods || []) if (q.t === "offset" && q.all) q.d = st.gap;
      },
      ok() { commit(def, "Edit clearance"); },
      onDelete: () => deleteFeature(editing),
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, `Gap cut into ${b.name || "this body"} around ${m.other || "the other part"}.`));
        body.append(row("Gap", (def.gapInput = app.numField({ value: st.gap, id: "cl-gap", len: true, min: 0.05, step: 0.05, live: true, onCommit: (v) => { if (v > 0) { st.gap = v; schedulePreview(def); } } })), "cl-gap"));
      },
      start() { schedulePreview(def); },
    };
    openCmd(def);
  }
  // ------------------------------------------------------------------ Offset face (Press Pull)
  function offsetCmd(editing = null) {
    // all: bodies picked whole with a selection window: every face of each is offset (the
    // whole body grows or shrinks, a feature on each body)
    const st = { faces: [], d: 2, body: null, all: [] };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      st.d = m.d; st.body = b.id; st.keepFaces = m.faces; st.editAll = !!m.all;
    }
    let hover = null, arrowDrag = null, press = null, rubber = false;
    const faceCount = (id) => { const bs = baseOf(id); return bs && bs.data ? bs.data.faceGroups.length : 0; };
    const def = {
      title: (editing ? "Edit " : "") + "Offset face",
      valid: () => (editing || st.faces.length > 0 || st.all.length > 0) && Math.abs(st.d) > 1e-6,
      canOk: () => def.valid(),
      apply(doc) {
        if (!editing && st.all.length) {
          for (const id of st.all) {
            const b = findBody(doc, id);
            if (!b) continue;
            b.node.mods = b.node.mods || [];
            b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "offset", d: st.d, all: true, faces: [] });
          }
          return;
        }
        const b = findBody(doc, st.body);
        if (!b) return;
        const faces = st.faces.length ? st.faces.map((f) => (f.n ? { c: f.c, n: f.n, t: f.t } : { c: f.c, t: f.t })) : st.keepFaces;
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); m.d = st.d; m.faces = faces; return; }
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "offset", d: st.d, faces });
      },
      ok() { commit(def, "Offset face"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.all.length ? "Every face of the body moves: drag the arrow or type a distance. Positive makes the whole body bigger, negative smaller." : st.faces.length ? "Drag the arrow or type a distance: positive pushes the face out, negative pulls it in." : "Click one or more faces of a body (flat, holes, cylinders or rounded faces), or drag a box around a whole body to pick every face.",
      build(body) {
        if (st.all.length || st.editAll) {
          const n = st.all.reduce((s, id) => s + faceCount(id), 0);
          body.append(pickbox(true, st.editAll ? "Every face of the body" : el("span", {}, el("b", {}, n), ` faces, every face of ${st.all.length > 1 ? st.all.length + " bodies" : "the body"}`), st.all.length ? () => { st.all = []; refresh(); } : null));
          body.append(row("Distance", (def.distInput = app.numField({ value: st.d, id: "of-d", step: 0.5, live: true, onCommit: (v) => { st.d = v; refresh(false); } })), "of-d"));
          body.append(el("div", { class: "hint", style: { padding: 0 } }, "Positive makes the body thicker all over (outside corners become rounded), negative makes it thinner. Holes get smaller or bigger to match. Click a face instead to offset just that face."));
          return;
        }
        body.append(pickbox(true, st.faces.length ? el("span", {}, el("b", {}, st.faces.length), ` face${st.faces.length > 1 ? "s" : ""}`) : editing ? "Keeps the original faces" : "Select faces", st.faces.length ? () => { st.faces = []; if (!editing) st.body = null; refresh(); } : null));
        body.append(row("Distance", (def.distInput = app.numField({ value: st.d, id: "of-d", step: 0.5, live: true, onCommit: (v) => { st.d = v; refresh(false); } })), "of-d"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Positive adds material, negative removes it. On a hole, positive makes the hole smaller."));
      },
      start() { refresh(); },
      handler: {
        wantsTouch: (e) => !!overArrow(e),
        hover(e) {
          if (arrowDrag || rubber) return;
          if (overArrow(e)) { vp.canvas.style.cursor = "grab"; return; }
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!st.body || b.id === st.body));
          hover = f && f.info ? f : null;
          draw();
          vp.canvas.style.cursor = hover ? "pointer" : "default";
        },
        down(e) {
          const a = overArrow(e);
          if (a) { arrowDrag = { a, d0: st.d, f: axisDragger(e, a.origin, a.n) }; return true; }
          // a sketch profile drawn on the face (say a circle on a cylinder's top): pull just
          // that profile, like Fusion's Press Pull, instead of the whole face
          if (!editing && !st.faces.length) {
            const rh = vp.pick(e, scene.regionMeshes());
            const fh = pickBaseFace(e, (b) => !b.hole);
            if (rh.length && (!fh || rh[0].distance <= fh.distance + 0.05)) {
              const r = rh.sort((p, q) => p.distance - q.distance || p.object.userData.region.region.area - q.object.userData.region.region.area)[0].object.userData.region;
              closeCmd(false);
              extrudeCmd("extrude", null, { region: r, dist: st.d });
              return true;
            }
          }
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!st.body || b.id === st.body));
          // empty space: a drag draws a selection window around whole bodies
          if (!f) { if (!editing) press = { start: vp.local(e) }; return true; }
          if (!f.info || !f.info.c) { app.toast("That face can't be offset."); return true; }
          st.all = [];
          st.body = f.body;
          const i = st.faces.findIndex((x) => x.face === f.face);
          // the arrow starts where you clicked, along the surface normal there
          if (i >= 0) st.faces.splice(i, 1);
          else st.faces.push({ face: f.face, base: f.base, c: f.info.c, n: f.info.t === "PLANE" ? f.info.n : null, t: f.info.t, at: f.point.clone(), dir: f.normal.clone().normalize() });
          if (!st.faces.length && !editing) st.body = null;
          refresh();
          return true;
        },
        move(e) {
          if (rubber) { app.beginner.handler.move(e); return; }
          if (press) {
            const [x, y] = vp.local(e);
            if (Math.hypot(x - press.start[0], y - press.start[1]) < 5) return;
            app.beginner.rubberDown(e, false, press.start, [], (ids) => {
              const ok = ids.filter((id) => { const b = findBody(store.doc, id); return b && !b.hole && !b.hidden && !app.isLocked(id) && faceCount(id) > 0; });
              if (!ok.length) { if (ids.length) app.toast("Those bodies can't be offset (holes and locked bodies are skipped)."); return; }
              st.all = ok; st.faces = []; st.body = null; hover = null;
              app.toast(`Picked every face of ${ok.length > 1 ? ok.length + " bodies" : "the body"} (${ok.reduce((s, id) => s + faceCount(id), 0)} faces).`);
              refresh();
            });
            rubber = true; press = null;
            app.beginner.handler.move(e);
            return;
          }
          if (!arrowDrag) return;
          const s = arrowDrag.d0 + arrowDrag.f(e);
          const g = app.gridStep() || 0.1;
          st.d = round(s, g >= 1 ? 0.5 : g) || st.d;
          def.distInput && def.distInput.setValue(st.d);
          refresh(false);
        },
        up(e) {
          if (rubber) { rubber = false; app.beginner.handler.up(e); return; }
          press = null; arrowDrag = null;
        },
        cancel() { press = null; arrowDrag = null; if (rubber) { rubber = false; app.beginner.handler.cancel(); } },
      },
    };
    function pickExtrudeFace(e, tell) {
      const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
      if (!f) return null;
      if (!f.info || f.info.t !== "PLANE") { if (tell) app.toast("Only flat faces can be extruded directly. Sketch on a plane to extrude other shapes."); return null; }
      return f;
    }
    // click a flat face: make a sketch of its outline and pick the region under the click
    function faceProfile(f, e) {
      const plane = planeFromFace(f);
      const sk = { id: uid("s"), name: "Sketch", seq: 0, plane: { o: plane.o, x: plane.x, n: plane.n }, pts: [], ents: [], hidden: false, onBody: f.body, fromFace: true };
      projectFaceEdges(sk, f);
      const regs = regionsFor(sk);
      const q = f.point.clone().applyMatrix4(planeMatrix(sk.plane).invert());
      const pt = [q.x, q.y];
      let best = -1, area = Infinity;
      regs.forEach((r, i) => { if (!r.text && pointIn(r, pt)) { const a = Math.abs(polyArea(r.poly)); if (a < area) { area = a; best = i; } } });
      if (best < 0) { app.toast("Couldn't find the outline of that face."); return; }
      pendingSketch = sk;
      st.profiles.clear(); st.axis = null; st.axisLine = null;
      st.sketchId = sk.id;
      st.profiles.set(profileKey(sk.id, best), { index: best, ref: { key: regs[best].key, pt: regs[best].pt } });
      scene.state.forceSketch = sk.id;
      st.hoverFace = null;
      refresh();
    }
    function overArrow(e) {
      const a = def.arrow;
      if (!a) return null;
      const [mx, my] = vp.local(e);
      const s = vp.project(a.tip);
      return Math.hypot(s[0] - mx, s[1] - my) < vp.tol(14) ? a : null;
    }
    function draw() {
      clearOv();
      def.arrow = null;
      for (const f of st.faces) drawFace(f.base, f.face, 0x2f66c8);
      // whole bodies: every face lit, the arrow straight up from the top of the first one
      let wholeArrow = null;
      for (const id of st.all) {
        const bs = baseOf(id);
        if (!bs || !bs.data) continue;
        for (let i = 0; i < bs.data.faceGroups.length; i++) drawFace(bs, i, 0x2f66c8, 0.3);
        if (!wholeArrow) {
          const bb = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(bs.data.vertices, 3)).applyMatrix4(bs.m);
          wholeArrow = { at: new THREE.Vector3((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, bb.max.z), dir: new THREE.Vector3(0, 0, 1) };
        }
      }
      if (hover) drawFace(hover.base, hover.face, 0xe8a317);
      const f0 = wholeArrow || st.faces[0];
      if (f0) {
        const origin = f0.at ? f0.at.clone() : new THREE.Vector3(...f0.c).applyMatrix4(f0.base.m);
        const n = f0.dir ? f0.dir.clone() : new THREE.Vector3(...f0.n).transformDirection(f0.base.m).normalize();
        const tip = origin.clone().addScaledVector(n, st.d);
        drawLine([origin, tip], 0x1f4fa8);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 16), new THREE.MeshBasicMaterial({ color: 0x1f4fa8, depthTest: false, transparent: true }));
        cone.scale.setScalar(vp.pixelSize(tip) * 6);
        cone.position.copy(tip);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().multiplyScalar(Math.sign(st.d) || 1));
        cone.renderOrder = 14;
        ov.add(cone);
        def.arrow = { origin, n, tip };
      }
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Fill openings
  // jumpstart-3d: fill openings. Pick a flat face; its holes, slots and pockets (the face's inner loops) are filled.
  function fillOpeningsCmd(editing = null) {
    const st = { pick: null, on: [], mode: "opening", depth: 5, hot: -1 };
    let hover = null, keep = null;
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      keep = { body: b.id, face: m.face, loops: m.loops };
      if (typeof m.depth === "number") { st.mode = "set"; st.depth = m.depth; }
    }
    const openings = () => (st.pick ? st.pick.info.openings : []);
    const loops = () => (st.pick ? openings().filter((_, i) => st.on[i]).map((o) => ({ c: o.c, size: o.size })) : keep ? keep.loops : []);
    const label = (o) => (o.kind === "round" ? `Round, ${withUnit(o.size[0])} across` : `${o.kind === "slot" ? "Slot" : "Opening"}, ${showLen(o.size[0])} × ${withUnit(o.size[1])}`);
    const def = {
      title: (editing ? "Edit " : "") + "Fill openings",
      valid: () => loops().length > 0 && (st.mode === "opening" || st.depth > 0),
      canOk: () => def.valid(),
      apply(doc) {
        const b = findBody(doc, st.pick ? st.pick.body : keep && keep.body);
        if (!b) return;
        const fields = { face: st.pick ? { c: st.pick.info.c, n: st.pick.info.n } : keep.face, loops: loops(), depth: st.mode === "set" ? st.depth : "opening" };
        if (editing) { Object.assign(b.node.mods.find((x) => x.id === editing.mod), fields); return; }
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "fillopenings", ...fields });
      },
      ok() { commit(def, "Fill openings"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => (st.pick ? "Untick the openings to keep. Each one fills as deep as its side walls go, or to the depth you set." : "Click a flat face with holes, slots or pockets in it."),
      build(body) {
        body.append(pickbox(true, st.pick ? "1 face" : editing ? "Keeps the original face" : "Select a flat face", st.pick ? () => { st.pick = null; st.on = []; st.hot = -1; refresh(); } : null));
        if (st.pick) {
          body.append(el("div", { class: "subhead" }, "Openings"));
          openings().forEach((o, i) => body.append(el("label", { class: "check", onpointerenter: () => { st.hot = i; draw(); }, onpointerleave: () => { st.hot = -1; draw(); } },
            el("input", { type: "checkbox", id: "fo-open" + i, checked: st.on[i], onchange: (e) => { st.on[i] = e.target.checked; refresh(false); } }), label(o))));
        }
        body.append(row("Fill to", seg([["opening", "Opening depth"], ["set", "Set depth"]], st.mode, (v) => { st.mode = v; refresh(); }, "fo-mode")));
        if (st.mode === "set") body.append(row("Depth", app.numField({ value: st.depth, id: "fo-depth", step: 0.5, min: 0.01, live: true, onCommit: (v) => { st.depth = v; refresh(false); } }), "fo-depth"));
      },
      start() { refresh(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          hover = f && f.info ? f : null;
          draw();
          vp.canvas.style.cursor = hover ? "pointer" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          if (!f) return true;
          if (!f.info || f.info.t !== "PLANE") { app.toast("Pick a flat face"); return true; }
          if (!(f.info.openings && f.info.openings.length)) { app.toast("This face has no openings"); return true; }
          st.pick = f; st.on = f.info.openings.map(() => true); st.hot = -1;
          refresh();
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      if (st.pick) drawFace(st.pick.base, st.pick.face, 0x2f66c8);
      if (hover && !(st.pick && hover.base === st.pick.base && hover.face === st.pick.face)) drawFace(hover.base, hover.face, 0xe8a317);
      const o = openings()[st.hot];
      if (!o) return;
      // a ring around the opening under the pointer in the list
      const n = new THREE.Vector3(...st.pick.info.n);
      const u = new THREE.Vector3().crossVectors(n, Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
      const v = new THREE.Vector3().crossVectors(n, u), c = new THREE.Vector3(...o.c), r = Math.max(...o.size) / 2 + 1;
      const pts = [];
      for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push(c.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).applyMatrix4(st.pick.base.m)); }
      drawLine(pts, 0xe8a317);
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }

  // Shell, like Fusion 360: pick faces to remove (or none, for a closed hollow body), a
  // wall thickness, and whether the wall grows inside, outside or both ways.
  // Shell: Openings (pick faces to remove; the rest becomes a wall), or Hollow (the whole model is
  // hollow inside with a closed wall, for one or more bodies). Shared with Beginner.
  function shellCmd(editing = null, opts = {}) {
    let hollowPref = false; try { hollowPref = localStorage.getItem("jumpstart3d.shell.type") === "hollow"; } catch (e) {}
    let drainPref = null; try { drainPref = JSON.parse(localStorage.getItem("jumpstart3d.shell.drain")); } catch (e) {}
    const st = { faces: [], th: 2, body: null, bodies: [], dir: "in", chain: false, closed: opts.type ? opts.type === "hollow" : app.mode === "beginner" || hollowPref,
      method: "auto", detail: 1, drain: drainPref || { on: false, n: 1, d: 3 } };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      Object.assign(st, { th: m.th, body: b.id, keepFaces: m.faces, dir: m.dir || "in", chain: !!m.chain, closed: !(m.faces || []).length, method: m.method || "auto", detail: m.detail || 1, drain: m.drain ? { on: true, ...m.drain } : { on: false, n: 1, d: 3 } });
    }
    // the settings every shell made here shares
    const extra = () => ({ method: st.method === "auto" ? undefined : st.method, detail: st.method === "field" && st.detail !== 1 ? st.detail : undefined, drain: st.closed && st.drain.on ? { n: st.drain.n, d: st.drain.d } : undefined });
    // Hollow starts with the selected shapes (or the only one there is)
    const usable = (b) => b && !b.hole && !b.locked && !b.hidden;
    const preset = () => {
      if (editing) return;
      let ids = app.sel.filter((id) => usable(findBody(store.doc, id)));
      if (!ids.length) { const all = store.doc.bodies.filter(usable); if (all.length === 1) ids = [all[0].id]; }
      st.bodies = ids;
    };
    if (st.closed) preset();
    let hover = null;
    // openings can be picked on several shapes at once (each gets its own shell)
    const pickable = (b) => !b.hole && !b.locked && (!editing || b.id === st.body);
    const targets = () => (editing ? [st.body] : st.closed ? st.bodies : [...new Set(st.faces.map((f) => f.body))]);
    const def = {
      title: (editing ? "Edit " : "") + "Shell",
      valid: () => st.th > 0 && targets().length > 0 && (st.closed || editing || st.faces.length > 0),
      canOk: () => def.valid(),
      apply(doc) {
        if (editing) {
          const b = findBody(doc, st.body);
          if (!b) return;
          const faces = st.closed ? [] : st.faces.length ? st.faces.map((f) => ({ c: f.c })) : st.keepFaces || [];
          const m = b.node.mods.find((x) => x.id === editing.mod);
          for (const k of ["method", "detail", "drain"]) delete m[k];
          Object.assign(m, { th: st.th, faces, dir: st.dir === "in" ? undefined : st.dir, chain: st.chain && !st.closed ? true : undefined }, extra());
          return;
        }
        const seq = nextSeq(doc);
        for (const id of targets()) {
          const b = findBody(doc, id);
          if (!b) continue;
          const faces = st.closed ? [] : st.faces.filter((f) => f.body === id).map((f) => ({ c: f.c }));
          b.node.mods = b.node.mods || [];
          b.node.mods.push({ id: uid("f"), seq, t: "shell", th: st.th, faces, dir: st.dir === "in" ? undefined : st.dir, chain: st.chain && !st.closed ? true : undefined, ...extra() });
        }
      },
      ok() { try { localStorage.setItem("jumpstart3d.shell.type", st.closed ? "hollow" : "open"); } catch (e) {} commit(def, st.closed ? "Hollow" : "Shell"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.closed ? (st.bodies.length || editing ? "Set the wall thickness. Click shapes to add or remove them." : "Click the shape to make hollow (click more to hollow them too).") : "Click the faces to remove (openings). The rest of the body becomes a wall.",
      build(body) {
        body.append(row("Type", seg([["open", "Openings"], ["hollow", "Hollow"]], st.closed ? "hollow" : "open", (v) => {
          st.closed = v === "hollow";
          if (!editing) { st.faces = []; st.body = null; if (st.closed) preset(); }
          refresh();
        }, "sh-type")));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, st.closed ? "Hollow: the whole model becomes hollow inside, closed all round, with a wall as thick as you set." : "Openings: the faces you click are removed, like an open box or cup."));
        if (st.closed) {
          const n = targets().length;
          body.append(pickbox(true, n ? (n === 1 ? el("b", {}, findBody(store.doc, targets()[0])?.name || "1 shape") : el("span", {}, el("b", {}, n), " shapes")) : "Click a shape", n && !editing ? () => { st.bodies = []; refresh(); } : null));
        } else {
          const nb = targets().length;
          body.append(pickbox(true, st.faces.length ? el("span", {}, el("b", {}, st.faces.length), ` face${st.faces.length > 1 ? "s" : ""} to remove` + (nb > 1 ? ` on ${nb} shapes` : "")) : editing && (st.keepFaces || []).length ? "Keeps the original faces" : "Select faces to remove", st.faces.length ? () => { st.faces = []; refresh(); } : null));
        }
        if (!st.closed) body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "sh-chain", checked: st.chain, onchange: (e) => { st.chain = e.target.checked; refresh(false); } }), "Tangent chain (take smoothly joined faces too)"));
        body.append(row(st.closed ? "Wall thickness" : "Thickness", app.numField({ value: st.th, id: "sh-th", min: 0.01, step: 0.5, live: true, onCommit: (v) => { st.th = v; refresh(false); } }), "sh-th"));
        if (st.closed) body.append(row("Quick pick", seg([["1", "1 mm"], ["2", "2 mm"], ["3", "3 mm"], ["5", "5 mm"]], String(st.th), (v) => { st.th = +v; refresh(); }, "sh-thq")));
        body.append(row("Direction", seg([["in", "Inside"], ["out", "Outside"], ["both", "Both"]], st.dir, (v) => { st.dir = v; refresh(); }, "sh-dir")));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, st.dir === "in" ? "The outside stays the same size; the wall grows inward." : st.dir === "out" ? "The inside keeps the body's shape; the wall grows outward." : "The wall is centered on the surface."));
        // drain holes: let resin or powder out of a hollow print
        if (st.closed) {
          body.append(el("label", { class: "check", title: "Holes through the bottom wall, so liquid resin or loose powder can drain out of a hollow print" }, el("input", { type: "checkbox", id: "sh-drain", checked: st.drain.on, onchange: (e) => { st.drain.on = e.target.checked; saveDrain(); refresh(); } }), "Drain holes in the bottom"));
          if (st.drain.on) {
            body.append(row("Holes", seg([["1", "1"], ["2", "2"], ["4", "4"]], String(st.drain.n), (v) => { st.drain.n = +v; saveDrain(); refresh(); }, "sh-drain-n")));
            body.append(row("Hole size", app.numField({ value: st.drain.d, id: "sh-drain-d", min: 0.5, max: 50, step: 0.5, onCommit: (v) => { st.drain.d = v; saveDrain(); refresh(false); } }), "sh-drain-d"));
          }
        }
        // how the wall is made (Auto tries them in turn)
        const det = el("details", { class: "sh-more", open: st.method !== "auto" || undefined });
        det.append(el("summary", {}, "Method"),
          row("Method", el("tool-choice", { class: "num", id: "sh-method", style: { width: "auto" }, onchange: (e) => { st.method = e.target.value; refresh(); } },
            ...[["auto", "Auto (best that works)"], ["exact", "Exact offset"], ["slices", "Slices (lofts, vases)"], ["field", "Any shape (distance field)"]].map(([v, l]) => el("option", { value: v, selected: st.method === v }, l))), "sh-method"),
          el("div", { class: "hint", style: { padding: 0 } }, st.method === "exact" ? "Offsets every face exactly: the cleanest walls, but complex shapes can fail." : st.method === "slices" ? "Builds the wall from slices across the shape: for lofts and vases with flat openings." : st.method === "field" ? "Works on any shape: holes, branches, curved openings, joined shapes. The new wall surfaces are fine triangles; the rest of the shape stays as it is where possible." : "Tries the exact offset, then slices, then the distance field, and uses the first that works."));
        if (st.method === "field") det.append(row("Detail", seg([["1", "Normal"], ["2", "Fine"]], String(st.detail), (v) => { st.detail = +v; refresh(); }, "sh-detail")));
        body.append(det);
      },
      start() { refresh(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, pickable);
          hover = f;
          if (st.closed) scene.setHovered(f ? f.body : null);
          draw();
          vp.canvas.style.cursor = f ? "pointer" : "default";
        },
        leave() { hover = null; scene.setHovered(null); draw(); },
        down(e) {
          const f = pickBaseFace(e, pickable);
          if (!f) return true;
          if (st.closed) {
            if (!editing) { const i = st.bodies.indexOf(f.body); if (i >= 0) st.bodies.splice(i, 1); else st.bodies.push(f.body); }
            refresh(); return true;
          }
          if (editing) st.body = f.body;
          const i = st.faces.findIndex((x) => x.face === f.face && x.body === f.body);
          const c = f.info && f.info.c ? f.info.c : f.point.clone().applyMatrix4(f.base.m.clone().invert()).toArray();
          if (i >= 0) st.faces.splice(i, 1); else st.faces.push({ face: f.face, base: f.base, c, body: f.body });
          refresh();
          return true;
        },
      },
      cleanup() { scene.setHovered(null); scene.setSelected(app.sel); },
      sceneSel: () => (st.closed ? targets() : app.sel),
    };
    function saveDrain() { try { localStorage.setItem("jumpstart3d.shell.drain", JSON.stringify(st.drain)); } catch (e) {} }
    function draw() {
      clearOv();
      if (!st.closed) {
        for (const f of st.faces) drawFace(f.base, f.face, 0x2f66c8);
        if (hover) drawFace(hover.base, hover.face, 0xe8a317);
      }
    }
    function refresh(rerender = true) {
      if (rerender) def.render();
      draw();
      scene.setSelected(st.closed ? targets() : []);
      schedulePreview(def);
      def.refreshOk && def.refreshOk();
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Combine
  // Combine, like Fusion 360: pick a target body, then tool bodies; join, cut or intersect.
  // The result stays the target body (same name and history) with a Combine feature on the
  // timeline. Used-up tool bodies are kept inside the feature, so deleting it brings them back.
  function combineCmd(editing = null) {
    const st = { target: null, tools: [], op: "join", keep: false };
    let picking = "target";
    if (editing) {
      const b = findBody(store.doc, editing.body), m = b && b.node.mods.find((x) => x.id === editing.mod);
      if (!m) return;
      Object.assign(st, { target: b.id, op: m.op || "join", keep: !m.tools });
      picking = null;
    } else {
      // bodies selected before starting: the first is the target, the rest are tools
      const pre = app.sel.filter((id) => !app.isLocked(id) && findBody(store.doc, id));
      if (pre.length) { st.target = pre[0]; st.tools = pre.slice(1); picking = "tools"; }
    }
    const name = (id) => findBody(store.doc, id)?.name || "body";
    const def = {
      title: editing ? "Edit Combine" : "Combine",
      keepSelection: false,
      valid: () => !!st.target && (editing || st.tools.length > 0),
      canOk: () => def.valid(),
      apply(doc) {
        const tb = findBody(doc, st.target);
        if (editing) {
          const m = tb.node.mods.find((x) => x.id === editing.mod);
          m.op = st.op === "join" ? undefined : st.op;
          return;
        }
        const tools = st.tools.map((id) => findBody(doc, id)).filter(Boolean);
        tb.node.mods = tb.node.mods || [];
        tb.node.mods.push({
          id: uid("f"), seq: nextSeq(doc), t: "bool", src: "combine", op: st.op === "join" ? undefined : st.op,
          tool: { t: "group", children: tools.map((b) => ({ node: clone(b.node), m: b.m.slice(), hole: false, name: b.name })), mods: [] },
          m: arr(M4(tb.m).invert()),
          tools: st.keep ? undefined : tools.map((b) => clone(b)),
        });
        // (the preview leaves the tools in place, faint, so they can still be clicked)
        if (!st.keep && !app.previewing) { const gone = new Set(st.tools); doc.bodies = doc.bodies.filter((b) => !gone.has(b.id)); }
      },
      ok() { const t = st.target; commit(def, "Combine"); if (t && !editing) app.select([t]); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => editing ? "Change the operation, then OK." : picking === "target" ? "Select the target body: the one that stays." : "Select tool bodies: click them, drag a window, or Ctrl+click in the Browser. Click one again to drop it.",
      build(body) {
        const box = (which, label, content, onClear) => row(label, pickbox(picking === which, content, onClear, editing ? null : () => { picking = which; refresh(); }));
        body.append(box("target", "Target body", st.target ? el("span", {}, el("i", { class: "sw", style: { background: "#2f6fe8" } }), el("b", {}, name(st.target))) : "Select", !editing && st.target ? () => { st.target = null; picking = "target"; refresh(); } : null));
        if (!editing) body.append(box("tools", "Tool bodies", st.tools.length ? el("span", {}, el("i", { class: "sw", style: { background: "#f08a24" } }), el("b", {}, st.tools.length), " selected") : "Select", st.tools.length ? () => { st.tools = []; refresh(); } : null));
        if (!editing && st.tools.length) body.append(el("div", { class: "hint cb-names", style: { padding: "0 0 4px" } }, st.tools.map(name).join(", ")));
        body.append(row("Operation", seg([["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]], st.op, (v) => { st.op = v; refresh(); }, "cb-op")));
        if (!editing) body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "cb-keep", checked: st.keep, onchange: (e) => { st.keep = e.target.checked; refresh(); } }), "Keep tools"));
      },
      start() { refresh(); },
      cleanup() { scene.setSelected([]); scene.setToolBodies([]); scene.state.ghost = new Set(); scene.refresh(); },
      // a body clicked in the Browser while Combine is open
      pickBody(id) { pick(id); },
      sceneSel: () => (st.target ? [st.target] : []),
      handler: {
        hover(e) { scene.setHovered(editing ? null : under(e)); },
        leave() { scene.setHovered(null); },
        down(e) { press = { start: vp.local(e), id: editing ? null : under(e) }; return true; },
        move(e) {
          if (rubber) { app.beginner.handler.move(e); return; }
          if (!press || editing) return;
          const [x, y] = vp.local(e);
          if (Math.hypot(x - press.start[0], y - press.start[1]) < 5) return;
          // a selection window adds every body it catches
          app.beginner.rubberDown(e, true, press.start, [], (ids) => {
            for (const id of ids) {
              if (app.isLocked(id) || id === st.target) continue;
              if (picking === "target" || !st.target) { st.target = id; picking = "tools"; continue; }
              if (!st.tools.includes(id)) st.tools.push(id);
            }
            picking = st.target ? "tools" : "target";
            refresh();
          });
          rubber = true; press = null;
          app.beginner.handler.move(e);
        },
        up(e) {
          if (rubber) { rubber = false; app.beginner.handler.up(e); return; }
          const p = press; press = null;
          if (p && p.id) pick(p.id);
        },
        cancel() { press = null; if (rubber) { rubber = false; app.beginner.handler.cancel(); } },
      },
    };
    let press = null, rubber = false;
    // the body under the pointer; while choosing tools, look past the target so bodies
    // inside or behind it can still be picked
    function under(e) {
      const ids = [];
      for (const h of vp.pick(e, scene.meshes())) { const id = h.object.userData.bodyView.body.id; if (!ids.includes(id)) ids.push(id); }
      if (picking === "tools" && st.target) return ids.find((id) => id !== st.target) || null;
      return ids[0] || null;
    }
    function pick(id) {
      if (editing) return;
      if (app.isLocked(id)) { app.toast("That body is locked."); return; }
      if (picking === "target") {
        st.target = id;
        st.tools = st.tools.filter((t) => t !== id);
        picking = "tools"; // like Fusion, go straight on to the tools
      } else if (id === st.target) return;
      else { const i = st.tools.indexOf(id); if (i >= 0) st.tools.splice(i, 1); else st.tools.push(id); }
      refresh();
    }
    function refresh() {
      def.render();
      scene.setSelected(st.target ? [st.target] : []);
      scene.setToolBodies(st.tools);
      // the live result: tool bodies show through faintly so they can still be clicked
      scene.state.ghost = new Set(def.valid() && !editing ? st.tools : []);
      schedulePreview(def);
      app.status();
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Move / Copy
  function moveCmd(opts = {}) {
    // rot: the turn so far (about the selection center), shown as X/Y/Z angles
    const st = { ids: app.sel.filter((id) => !app.isLocked(id)), d: [0, 0, 0], rot: new THREE.Quaternion(), copy: false, drag: opts.drag || "ground", center: new THREE.Vector3() };
    if (st.ids.length < app.sel.length) app.toast("Locked bodies stay where they are.");
    const inputs = [];
    let drag = null, hotArrow = null;
    // gizmo: X/Y/Z arrows for moving along an axis, a ball for free 3D moves
    const giz = new THREE.Group();
    const AX = [["x", 0xd9534f, new THREE.Vector3(1, 0, 0)], ["y", 0x3f9b52, new THREE.Vector3(0, 1, 0)], ["z", 0x2f6fd0, new THREE.Vector3(0, 0, 1)]];
    for (const [name, color, dir] of AX) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8).translate(0, 0.5, 0), mat);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 14).translate(0, 1.12, 0), mat);
      // fat invisible grab zone
      const grab = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.3, 6).translate(0, 0.65, 0), new THREE.MeshBasicMaterial({ visible: false }));
      g.add(shaft, tip, grab);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.userData.axis = name; g.userData.dir = dir; g.userData.mat = mat; g.userData.color = color;
      g.renderOrder = 20; shaft.renderOrder = tip.renderOrder = 20;
      giz.add(g);
    }
    const ballMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), ballMat);
    ball.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshBasicMaterial({ color: 0x18202a, depthTest: false, side: THREE.BackSide })));
    ball.userData.axis = "free"; ball.renderOrder = 21;
    giz.add(ball);
    // rotation rings (Free in 3D: all three; Free on ground: the Z ring), dragged to turn
    const rings = [];
    for (const [name, color, dir] of AX) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.026, 8, 72), mat);
      const grab = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.1, 6, 56), new THREE.MeshBasicMaterial({ visible: false }));
      g.add(ring, grab);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir); // torus lies in XY: its axis is Z
      g.userData.axis = "rot-" + name; g.userData.dir = dir; g.userData.mat = mat; g.userData.color = color; g.userData.ring = true;
      ring.renderOrder = 19;
      giz.add(g);
      rings.push(g);
    }
    giz.visible = false;
    vp.overlay.add(giz);
    const sizeGiz = () => {
      if (!st.ids.length) { giz.visible = false; return; }
      giz.visible = true;
      giz.position.copy(st.center).add(new THREE.Vector3(...st.d));
      giz.scale.setScalar(vp.pixelSize(giz.position) * 70);
      for (const g of giz.children) if (g.userData.mat) g.userData.mat.color.set(hotArrow === g || (drag && drag.ring === g) ? 0xe8a317 : g.userData.color);
      ballMat.color.set(hotArrow === ball ? 0xe8a317 : 0xffffff);
      for (const r of rings) r.visible = st.drag === "screen" || r.userData.axis === "rot-z";
    };
    vp.afterRender.add(sizeGiz);
    const pickGiz = (e) => {
      if (!giz.visible) return null;
      vp.ray(e);
      const hits = vp.raycaster.intersectObjects(giz.children.filter((c) => c.visible), true);
      // arrows and the ball win over the rings they sit inside
      const pickOf = (h) => { let o = h.object; while (o && !o.userData.axis) o = o.parent; return o; };
      const first = hits.map(pickOf).find((o) => o && !o.userData.ring);
      if (first) return first;
      // jumpstart-3d: rotation access. A finger gets the ring drawn nearest the touch (a 44 px wide zone), never an invisible one
      if (vp.touchMode) return nearestArc(vp, e, rings.filter((r) => r.visible).map((r) => ({ key: r, pts: arcPoints(r, 0.95) })));
      return hits.length ? pickOf(hits[0]) : null;
    };
    // the rotation center comes from where the bodies are now (not the preview)
    const recenter = () => {
      const box = new THREE.Box3();
      for (const id of st.ids) { const b = findBody(store.doc, id); const bb = b && scene.boxWithMatrix(id, M4(b.m)); if (bb) box.union(bb); }
      st.center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    };
    const def = {
      title: "Move / Copy",
      keepSelection: true,
      valid: () => st.ids.length > 0,
      canOk: () => def.valid() && (st.d.some((v) => v) || Math.abs(st.rot.w) < 1 - 1e-9),
      mat() {
        const c = st.center;
        return new THREE.Matrix4().makeTranslation(...st.d)
          .multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z))
          .multiply(new THREE.Matrix4().makeRotationFromQuaternion(st.rot))
          .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      },
      apply(doc) {
        const T = def.mat();
        st.copyIds = st.copyIds || {};
        for (const id of st.ids) {
          const b = findBody(doc, id);
          if (!b) continue;
          if (st.copy) {
            const c = clone(b);
            c.id = st.copyIds[id] || (st.copyIds[id] = uid("b"));
            c.seq = nextSeq(doc); c.name = nextName(doc, b.name.replace(/\s\d+$/, ""));
            c.m = arr(M4(b.m).premultiply(T));
            doc.bodies.push(c);
          } else b.m = arr(M4(b.m).premultiply(T));
        }
      },
      ok() { commit(def, st.copy ? "Copy" : "Move"); },
      hint: () => st.ids.length ? (st.drag === "screen" ? "Drag the shape to move it in 3D, an arrow to move along an axis, or a ring to rotate (15° steps; hold Shift or choose Free for any angle). Arrow keys move it as it looks on screen (Ctrl+↑↓ up and down); , and . turn it 1°. Or type exact values." : "Drag the shape to move it on the ground, an arrow to move along an axis, or the blue ring to turn it. Arrow keys move it as it looks on screen (Ctrl+↑↓ up and down); , and . turn it 1° (Shift: 15°). Choose Free in 3D to rotate around any axis.") : "Click the shapes to move.",
      build(body) {
        body.append(pickbox(true, st.ids.length ? el("span", {}, el("b", {}, st.ids.length), ` bod${st.ids.length > 1 ? "ies" : "y"}`) : "Click bodies", st.ids.length ? () => { st.ids = []; changed(); } : null));
        body.append(row("Drag shape", seg([["ground", "Free on ground"], ["screen", "Free in 3D"]], st.drag, (v) => { st.drag = v; def.render(); }, "mv-drag")));
        body.append(row("Ring turn", snapSwitch())); // jumpstart-3d: rotation access
        body.append(el("div", { class: "subhead" }, "Move by (" + getUnit() + ")"));
        const r3 = el("div", { class: "row3" });
        inputs.length = 0;
        ["X", "Y", "Z"].forEach((l, i) => {
          const f = app.numField({ value: st.d[i], id: "mv-d" + i, step: 1, live: true, onCommit: (v) => { st.d[i] = v; changed(false); } });
          inputs.push(f);
          r3.append(el("label", {}, l, f));
        });
        body.append(r3);
        body.append(el("div", { class: "subhead" }, "Rotate around the selection center (°)"));
        const r3b = el("div", { class: "row3" });
        angInputs.length = 0;
        const ang = eulerDeg();
        ["X", "Y", "Z"].forEach((l, i) => {
          const f = app.numField({ value: ang[i], id: "mv-r" + i, step: 15, live: true, onCommit: (v) => { const cur = eulerDeg(); cur[i] = v; setEuler(cur); ringReadout = null; changed(false); } });
          angInputs.push(f);
          r3b.append(el("label", {}, l, f));
        });
        body.append(r3b);
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "mv-copy", checked: st.copy, onchange: (e) => { st.copy = e.target.checked; changed(false); } }), "Create a copy"));
        body.append(el("button", { class: "btn", id: "mv-reset", onclick: () => { st.d = [0, 0, 0]; st.rot.identity(); changed(); } }, "Reset"));
      },
      start() { recenter(); scene.setSelected(st.ids); vp.request(); },
      cleanup() { vp.afterRender.delete(sizeGiz); vp.overlay.remove(giz); tag.remove(); scene.setSelected([]); vp.request(); },
      handler: {
        wantsTouch: (e) => !!(pickGiz(e) || scene.pickFace(e)),
        hover(e) {
          if (drag) return;
          const h = pickGiz(e);
          if (h !== hotArrow) { hotArrow = h; vp.request(); }
          if (h) { vp.canvas.style.cursor = "grab"; scene.setHovered(null); return; }
          const f = scene.pickFace(e);
          scene.setHovered(f ? f.body : null);
          vp.canvas.style.cursor = f ? (st.ids.includes(f.body) ? "move" : "pointer") : "default";
        },
        down(e) {
          const h = pickGiz(e);
          if (h && h.userData.ring) return startRotate(e, h);
          if (h) return startDrag(e, h.userData.axis, h.userData.dir);
          const f = scene.pickFace(e);
          if (!f) return true;
          if (e.shiftKey) {
            const i = st.ids.indexOf(f.body);
            if (i >= 0) st.ids.splice(i, 1); else st.ids.push(f.body);
            changed();
            return true;
          }
          if (app.isLocked(f.body)) { app.toast("That body is locked."); return true; }
          if (!st.ids.includes(f.body)) { st.ids.push(f.body); changed(); }
          return startDrag(e, st.drag === "screen" ? "free" : "ground", null, f.point);
        },
        move(e) { if (drag) drag.move(e); },
        // jumpstart-3d: rotation access. A second finger, or a touch the browser took over, drops the gesture: the pose and preview go back to how they were before it
        cancel() {
          if (!drag) return;
          const restore = drag.restore;
          drag = null; ringReadout = null; tag.hidden = true; app.clearSnapGuides(); vp.canvas.style.cursor = "default";
          if (restore) restore();
          changed();
        },
        up(e) { if (e && e.type === "pointercancel") return def.handler.cancel(); if (drag) { drag = null; ringReadout = null; tag.hidden = true; app.clearSnapGuides(); vp.canvas.style.cursor = "default"; def.render(); } },
      },
    };
    const angInputs = [];
    let ringReadout = null, keyRing = null;
    // arrow keys move it the way it looks on screen (Ctrl/Cmd + Up/Down: lift); , and . turn it
    def.arrowKey = (e) => {
      if (!st.ids.length || e.altKey) return false;
      const d = app.arrowDelta(e, (app.gridStep() || 1) * (e.shiftKey ? 10 : 1));
      st.d = st.d.map((v, i) => +(v + d.getComponent(i)).toFixed(6));
      inputs.forEach((f, i) => f.setValue && f.setValue(st.d[i]));
      changed(false);
      return true;
    };
    // , and . : turn 1° (Shift: 15°) around the ring last dragged (the blue Z ring at first)
    def.turnKey = (e) => {
      if (!st.ids.length || e.ctrlKey || e.metaKey || e.altKey) return false;
      const ringObj = keyRing || rings[2], axis = ringObj.userData.dir.clone();
      const s = (e.code === "Period" ? 1 : -1) * (e.shiftKey ? 15 : 1);
      st.rot.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, (s * Math.PI) / 180));
      const ang = eulerDeg();
      angInputs.forEach((f, i) => f.setValue(ang[i]));
      const sc = vp.project(giz.position);
      tag.hidden = false;
      tag.innerHTML = `<b>${s > 0 ? "+" : ""}${s}°</b><span>around ${ringObj.userData.axis.slice(4).toUpperCase()} · , and . keys</span>`;
      tag.style.transform = `translate(${Math.round(sc[0] + 40)}px, ${Math.round(sc[1] - 40)}px)`;
      clearTimeout(def.turnKey.t); def.turnKey.t = setTimeout(() => { if (!drag) tag.hidden = true; }, 1400);
      changed(false);
      return true;
    };
    // X/Y/Z angles of the turn (extrinsic X, then Y, then Z), in degrees
    function eulerDeg() {
      const e = new THREE.Euler().setFromQuaternion(st.rot, "ZYX");
      return [e.x, e.y, e.z].map((v) => +((v * 180) / Math.PI).toFixed(2));
    }
    function setEuler([x, y, z]) { st.rot.setFromEuler(new THREE.Euler((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180, "ZYX")); }
    // the angle while dragging a ring, shown by the pointer
    const tag = el("div", { class: "ex-tag", hidden: true });
    vp.labels.append(tag);
    function startRotate(e, ringObj) {
      keyRing = ringObj;
      const axis = ringObj.userData.dir.clone();
      const center = giz.position.clone();
      const q0 = st.rot.clone();
      const cs = () => { const s = vp.project(center); return [s[0], s[1]]; };
      // angle of the pointer around the ring's center, on screen; which way round counts as
      // positive depends on whether the axis faces the viewer
      const facing = Math.sign(axis.dot(vp.camera.position.clone().sub(center))) || 1;
      const angAt = (ev) => { const [mx, my] = vp.local(ev); const [cx, cy] = cs(); return Math.atan2(-(my - cy), mx - cx); };
      const a0 = angAt(e);
      let total = 0, prev = a0;
      drag = {
        ring: ringObj,
        move(ev) {
          const a = angAt(ev);
          let da = a - prev;
          if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
          prev = a;
          total += da * facing;
          const deg = dragAngle((total * 180) / Math.PI, ev.shiftKey); // jumpstart-3d: rotation access. 15° steps; Shift or Free: the pointer's own angle
          st.rot.copy(new THREE.Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180).multiply(q0));
          ringReadout = deg;
          const ang = eulerDeg();
          angInputs.forEach((f, i) => f.setValue(ang[i]));
          const [mx, my] = vp.local(ev);
          tag.hidden = false;
          tag.innerHTML = `<b>${deg > 0 ? "+" : ""}${deg}°</b><span>around ${ringObj.userData.axis.slice(4).toUpperCase()} · Shift for any angle</span>`;
          tag.style.transform = `translate(${Math.round(mx + 18)}px, ${Math.round(my - 10)}px)`;
          changed(false);
        },
      };
      drag.restore = () => { st.rot.copy(q0); }; // jumpstart-3d: rotation access
      vp.canvas.style.cursor = "grabbing";
      return true;
    }
    function startDrag(e, kind, dir, grabPoint) {
      const d0 = st.d.slice();
      const origin = grabPoint ? grabPoint.clone() : giz.position.clone();
      let plane;
      if (kind === "ground") plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -origin.z);
      else if (kind === "free") plane = new THREE.Plane().setFromNormalAndCoplanarPoint(vp.camera.getWorldDirection(new THREE.Vector3()).negate(), origin);
      const p0 = plane ? vp.rayPlane(e, plane) : null;
      const g = app.gridStep();
      // position along the axis line closest to the pointer ray
      const axisParam = (ev) => {
        const ray = vp.ray(ev);
        const w0 = origin.clone().sub(ray.origin);
        const b = dir.dot(ray.direction), c = ray.direction.dot(ray.direction), d = dir.dot(w0), ee = ray.direction.dot(w0);
        const den = c - b * b;
        return Math.abs(den) < 1e-9 ? null : (b * ee - c * d) / den;
      };
      const s0 = dir ? axisParam(e) || 0 : 0;
      // where the bodies are when the drag starts (for snapping to other shapes)
      const boxes0 = new Map(st.ids.map((id) => { const b = findBody(store.doc, id); const bx = b && scene.boxWithMatrix(id, M4(b.m)); return [id, bx ? bx.translate(new THREE.Vector3(...d0)) : null]; }));
      drag = {
        restore() { st.d = d0; }, // jumpstart-3d: rotation access
        move(ev) {
          let delta;
          if (dir) {
            const s = axisParam(ev);
            if (s == null) return;
            delta = dir.clone().multiplyScalar(round(s - s0, g));
          } else {
            const p = vp.rayPlane(ev, plane);
            if (!p || !p0) return;
            delta = p.sub(p0);
            if (g > 0) delta.set(round(delta.x, g), round(delta.y, g), round(delta.z, g));
            delta = app.snapToObjects(st.ids, boxes0, delta, kind === "ground" ? ["x", "y"] : ["x", "y", "z"]).delta;
          }
          st.d = [d0[0] + delta.x, d0[1] + delta.y, d0[2] + delta.z].map((v) => +v.toFixed(4));
          inputs.forEach((f, i) => f.setValue(st.d[i]));
          changed(false);
        },
      };
      vp.canvas.style.cursor = "grabbing";
      return true;
    }
    function changed(rerender = true) {
      if (rerender) { recenter(); def.render(); }
      scene.setSelected(st.ids);
      schedulePreview(def);
      def.refreshOk();
      vp.request();
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Align
  // Bounds: line up edges or centers (like Tinkercad). Faces: put a face of one
  // body against, or flush with, a face of another (like Fusion's Align).
  function alignCmd() {
    const st = { ids: app.sel.filter((id) => !app.isLocked(id)), mode: "bounds", ax: { x: null, y: null, z: null }, to: "selection", src: null, dst: null, flush: false, center: true, pick: "src" };
    if (app.sel.some((id) => app.isLocked(id))) app.toast("Locked shapes stay where they are.");
    const AX = ["x", "y", "z"];
    const boxOf = (id) => { const b = findBody(store.doc, id); return b ? scene.boxWithMatrix(id, M4(b.m)) : null; };
    const def = {
      title: "Align",
      keepSelection: true,
      valid: () => st.mode === "bounds" ? st.ids.length > 0 && AX.some((k) => st.ax[k]) && (st.to !== "first" || st.ids.length > 1) : !!(st.src && st.dst),
      canOk: () => def.valid(),
      apply(doc) {
        if (st.mode === "bounds") {
          let target;
          if (st.to === "first") target = boxOf(st.ids[0]);
          else if (st.to === "origin") target = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
          else { target = new THREE.Box3(); for (const id of st.ids) { const b = boxOf(id); if (b) target.union(b); } }
          if (!target) return;
          const val = (box, k, how) => how === "min" ? box.min[k] : how === "max" ? box.max[k] : (box.min[k] + box.max[k]) / 2;
          for (const id of st.ids) {
            if (st.to === "first" && id === st.ids[0]) continue;
            const box = boxOf(id);
            if (!box) continue;
            const d = new THREE.Vector3();
            for (const k of AX) if (st.ax[k]) d[k] = val(target, k, st.ax[k]) - val(box, k, st.ax[k]);
            const b = findBody(doc, id);
            b.m = arr(M4(b.m).premultiply(new THREE.Matrix4().makeTranslation(d.x, d.y, d.z)));
          }
        } else {
          const { src, dst } = st;
          const n1 = src.n.clone(), n2 = dst.n.clone();
          const R = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(n1, st.flush ? n2 : n2.clone().negate()));
          const c1 = src.p, c2 = dst.p;
          const t = st.center ? c2.clone().sub(c1) : n2.clone().multiplyScalar(c2.clone().sub(c1).dot(n2));
          const T = new THREE.Matrix4().makeTranslation(c1.x + t.x, c1.y + t.y, c1.z + t.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-c1.x, -c1.y, -c1.z));
          const b = findBody(doc, src.body);
          b.m = arr(M4(b.m).premultiply(T));
        }
      },
      ok() { commit(def, "Align"); },
      hint: () => st.mode === "bounds" ? "Pick how each axis lines up. Click shapes to add or remove them." : st.pick === "src" ? "Click the face on the shape that will move." : "Click the face to align it to.",
      build(body) {
        body.append(row("Method", seg([["bounds", "Edges & centers"], ["faces", "Face to face"]], st.mode, (v) => { st.mode = v; st.pick = "src"; changed(); }, "al-mode")));
        if (st.mode === "bounds") {
          body.append(pickbox(true, st.ids.length ? el("span", {}, el("b", {}, st.ids.length), ` shape${st.ids.length > 1 ? "s" : ""}`) : "Click shapes", st.ids.length ? () => { st.ids = []; changed(); } : null));
          const names = { x: ["Left", "Center", "Right"], y: ["Front", "Center", "Back"], z: ["Bottom", "Middle", "Top"] };
          for (const k of AX) body.append(row(k.toUpperCase() + " axis", seg([[null, "—"], ["min", names[k][0]], ["mid", names[k][1]], ["max", names[k][2]]], st.ax[k], (v) => { st.ax[k] = v; changed(); }, "al-" + k)));
          body.append(row("Align to", seg([["selection", "All selected"], ["first", "First shape"], ["origin", "Origin"]], st.to, (v) => { st.to = v; changed(); }, "al-to")));
          if (st.to === "first" && st.ids[0]) body.append(el("div", { class: "hint", style: { padding: 0 } }, `${findBody(store.doc, st.ids[0])?.name} stays still; the others move to it.`));
        } else {
          body.append(row("Moving face", pickbox(st.pick === "src", st.src ? el("b", {}, findBody(store.doc, st.src.body)?.name || "1 face") : "Click a face", null, () => { st.pick = "src"; def.render(); })));
          body.append(row("Target face", pickbox(st.pick === "dst", st.dst ? el("b", {}, findBody(store.doc, st.dst.body)?.name || "1 face") : "Click a face", null, () => { st.pick = "dst"; def.render(); })));
          body.append(row("Result", seg([[false, "Facing (touching)"], [true, "Flush (same way)"]], st.flush, (v) => { st.flush = v; changed(); }, "al-flush")));
          body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "al-center", checked: st.center, onchange: (e) => { st.center = e.target.checked; changed(false); } }), "Center on the target face"));
        }
      },
      start() { scene.setSelected(st.ids); changed(false); if (app.mode === "beginner") makeDots(); },
      cleanup() { scene.setSelected([]); if (dotsEl) { dotsEl.remove(); dotsEl = null; vp.labelFns.delete(placeDots); } },
      handler: {
        hover(e) {
          if (st.mode === "bounds") { const f = scene.pickFace(e); scene.setHovered(f ? f.body : null); return; }
          const f = pickBaseFace(e, (b) => st.pick === "dst" || !b.locked);
          clearOv();
          drawPicked();
          if (f) drawFace(f.base, f.face, 0xe8a317);
        },
        down(e) {
          if (st.mode === "bounds") {
            const f = scene.pickFace(e);
            if (!f) return true;
            if (app.isLocked(f.body)) { app.toast("That shape is locked."); return true; }
            const i = st.ids.indexOf(f.body);
            if (i >= 0) st.ids.splice(i, 1); else st.ids.push(f.body);
            changed();
            return true;
          }
          const f = pickBaseFace(e, (b) => st.pick === "dst" || !b.locked);
          if (!f) return true;
          const p = f.info && f.info.t === "PLANE" ? new THREE.Vector3(...f.info.c).applyMatrix4(f.base.m) : f.point.clone();
          const n = f.info && f.info.t === "PLANE" ? new THREE.Vector3(...f.info.n).transformDirection(f.base.m).normalize() : f.normal.clone().normalize();
          const pick = { body: f.body, face: f.face, base: f.base, p, n };
          if (st.pick === "src") { st.src = pick; st.pick = "dst"; if (st.dst && st.dst.body === pick.body) st.dst = null; }
          else {
            if (st.src && pick.body === st.src.body) { app.toast("Pick a face on a different shape."); return true; }
            st.dst = pick;
          }
          changed();
          return true;
        },
      },
    };
    // Beginner: Tinkercad-style black dots around the selection. Each axis has three (one end, the
    // middle, the other end); click one to line everything up there, click it again to undo that axis.
    let dotsEl = null, dotLines = null;
    const dotBox = { key: null, box: null };
    const DOT_NAMES = { x: ["Left", "Center", "Right"], y: ["Front", "Center", "Back"], z: ["Bottom", "Middle", "Top"] };
    function makeDots() {
      dotsEl = el("div", { class: "al-dots", id: "al-dots" });
      for (const k of AX) ["min", "mid", "max"].forEach((v, i) => {
        dotsEl.append(el("button", { class: "al-dot", "data-ax": k, "data-v": v, title: `${k.toUpperCase()}: line up the ${DOT_NAMES[k][i].toLowerCase()}s`, "aria-label": `Align ${DOT_NAMES[k][i]} (${k.toUpperCase()})`,
          onclick: (e) => { e.stopPropagation(); st.ax[k] = st.ax[k] === v ? null : v; changed(); placeDots(); } }));
      });
      dotLines = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      dotLines.setAttribute("class", "al-lines");
      for (let i = 0; i < 3; i++) dotLines.append(document.createElementNS("http://www.w3.org/2000/svg", "line"));
      dotsEl.prepend(dotLines);
      vp.container.append(dotsEl);
      vp.labelFns.add(placeDots);
      placeDots();
    }
    function placeDots() {
      if (!dotsEl) return;
      // measured once per selection, before any preview moves the shapes, so the dots stay put
      const key = st.ids.join(",");
      if (dotBox.key !== key) { dotBox.key = key; dotBox.box = new THREE.Box3(); for (const id of st.ids) { const b = boxOf(id); if (b) dotBox.box.union(b); } }
      const box = dotBox.box;
      if (st.mode !== "bounds" || st.ids.length < 2 || box.isEmpty()) { dotsEl.hidden = true; return; }
      dotsEl.hidden = false;
      const sz = box.getSize(new THREE.Vector3()), g = Math.max(4, 0.15 * Math.max(sz.x, sz.y, sz.z));
      const val = (k, v) => (v === "min" ? box.min[k] : v === "max" ? box.max[k] : (box.min[k] + box.max[k]) / 2);
      const at = { x: (q) => new THREE.Vector3(q, box.min.y - g, box.min.z), y: (q) => new THREE.Vector3(box.min.x - g, q, box.min.z), z: (q) => new THREE.Vector3(box.max.x + g, box.min.y - g, q) };
      AX.forEach((k, i) => {
        const a = vp.project(at[k](box.min[k])), c = vp.project(at[k](box.max[k])), ln = dotLines.children[i];
        ln.setAttribute("x1", a[0]); ln.setAttribute("y1", a[1]); ln.setAttribute("x2", c[0]); ln.setAttribute("y2", c[1]);
      });
      for (const b of dotsEl.querySelectorAll(".al-dot")) {
        const k = b.dataset.ax, v = b.dataset.v;
        const p = vp.project(at[k](val(k, v)));
        b.style.transform = `translate(${p[0] - 7}px, ${p[1] - 7}px)`;
        b.hidden = p[2] > 1;
        b.classList.toggle("on", st.ax[k] === v);
      }
    }
    function drawPicked() {
      if (st.src) drawFace(st.src.base, st.src.face, 0x2f66c8);
      if (st.dst) drawFace(st.dst.base, st.dst.face, 0x29a35a);
    }
    function changed(rerender = true) {
      if (rerender) def.render();
      clearOv();
      if (st.mode === "faces") drawPicked();
      scene.setSelected(st.mode === "bounds" ? st.ids : []);
      if (def.valid()) schedulePreview(def); else store.setPreview(null);
      def.refreshOk && def.refreshOk();
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Pattern
  // Rectangular (one or two directions) or circular copies of bodies, like Fusion's
  // Pattern. Copies can stay separate or be joined into one body.
  function patternCmd() {
    const st = {
      ids: app.sel.slice(), type: "rect",
      ax1: "x", n1: 3, s1: 20, ax2: "y", n2: 1, s2: 20, sym: false,
      cax: "z", cn: 6, angle: 360, about: "origin", join: false,
      // pattern along a path (a chain of sketch curves): count, spread over the whole path or a
      // fixed spacing, keep the copies' direction or turn them with the path
      path: null, pickPath: false, pn: 6, pdist: "fit", pspace: 20, orient: "same", flip: false,
      // onPath: move the object onto the path first, so every copy sits on it (null: decide when
      // the path is picked, on when the object is away from it)
      onPath: null,
      // what is copied: whole bodies, or features (cuts, bosses, holes, text) on one body
      what: "bodies", fbody: null, feats: [],
      center: new THREE.Vector3(), idmap: {},
      // circular: the axis of a round edge or face that was clicked (world: c point, d direction)
      axisRef: null, pickAxis: false, autoAxis: true,
    };
    const AXV = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

    // ---------------- the axis of something round, for a circular pattern
    // the circle through points on a curve (a circular edge): its plane by the points' smallest
    // spread, then a least-squares circle in that plane
    function circleFit(pts) {
      if (pts.length < 3) return null;
      const c0 = new THREE.Vector3(); pts.forEach((p) => c0.add(p)); c0.divideScalar(pts.length);
      const n = smallestAxis(pts.map((p) => p.clone().sub(c0)));
      if (!n) return null;
      const u = new THREE.Vector3().crossVectors(n, Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize(), v = new THREE.Vector3().crossVectors(n, u);
      // Kasa fit: x² + y² + D x + E y + F = 0
      let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sz = 0, szx = 0, szy = 0;
      for (const p of pts) { const q = p.clone().sub(c0), x = q.dot(u), y = q.dot(v), z = x * x + y * y; sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; sz += z; szx += z * x; szy += z * y; }
      const N = pts.length, A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, N]], B = [-szx, -szy, -sz];
      const s = solve3(A, B);
      if (!s) return null;
      const cx = -s[0] / 2, cy = -s[1] / 2, r = Math.sqrt(Math.max(0, cx * cx + cy * cy - s[2]));
      if (!(r > 1e-6)) return null;
      // how round it really is (a straight edge or a wiggle isn't a circle)
      let err = 0; for (const p of pts) { const q = p.clone().sub(c0); err = Math.max(err, Math.abs(Math.hypot(q.dot(u) - cx, q.dot(v) - cy) - r)); }
      if (err > Math.max(0.02, r * 0.03)) return null;
      return { c: c0.clone().addScaledVector(u, cx).addScaledVector(v, cy), d: n, r };
    }
    function solve3(A, b) {
      const m = A.map((r, i) => [...r, b[i]]);
      for (let i = 0; i < 3; i++) {
        let piv = i; for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[piv][i])) piv = k;
        if (Math.abs(m[piv][i]) < 1e-12) return null;
        [m[i], m[piv]] = [m[piv], m[i]];
        for (let k = 0; k < 3; k++) if (k !== i) { const f = m[k][i] / m[i][i]; for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j]; }
      }
      return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
    }
    // the direction in which a cloud of vectors spreads least (power iteration on the inverse)
    function smallestAxis(vs) {
      const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const p of vs) { const a = [p.x, p.y, p.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += a[i] * a[j]; }
      const tr = C[0][0] + C[1][1] + C[2][2] || 1;
      for (let i = 0; i < 3; i++) C[i][i] += tr * 1e-9;
      let x = [0.31, 0.53, 0.79];
      for (let it = 0; it < 60; it++) { const y = solve3(C, x); if (!y) break; const l = Math.hypot(...y) || 1; x = y.map((q) => q / l); }
      return new THREE.Vector3(...x).normalize();
    }
    // a round face: cylinders know their axis; cones, spheres, tori and other turned faces are
    // fitted from the face's normals (they all cross the center line)
    function axisOfFace(base, face) {
      const info = base.data.faceInfo[face] || {};
      const M = base.m, N3 = new THREE.Matrix3().getNormalMatrix(M);
      if (info.t === "CYLINDRE" && info.ax && info.o) {
        const d = new THREE.Vector3(...info.ax).applyMatrix3(N3).normalize(), c = new THREE.Vector3(...info.o).applyMatrix4(M);
        // put the center at the middle of the face along the axis
        const fc = info.c ? new THREE.Vector3(...info.c).applyMatrix4(M) : c;
        return { c: c.clone().addScaledVector(d, fc.clone().sub(c).dot(d)), d, r: info.r ? info.r * new THREE.Vector3().setFromMatrixColumn(M, 0).length() : 0, label: "Cylinder" };
      }
      if (info.t === "PLANE") {
        // a flat face: its largest circular edge (the top of a cylinder, a round plate)
        let best = null;
        for (const ei of (base.data.faceEdges && base.data.faceEdges[face]) || []) { const f = circleFit(edgeWorldPts(base, ei)); if (f && (!best || f.r > best.r)) best = f; }
        if (best) return { ...best, label: "Round face" };
        return null;
      }
      const d = base.data, V = d.vertices, T = d.triangles, [s0, cnt] = d.faceGroups[face];
      const P = (i) => new THREE.Vector3(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]).applyMatrix4(M);
      const ns = [], ps = [];
      for (let k = s0; k < s0 + cnt; k += 3) {
        const A = P(T[k]), B = P(T[k + 1]), C = P(T[k + 2]), n = B.clone().sub(A).cross(C.clone().sub(A));
        if (n.lengthSq() < 1e-14) continue;
        ns.push(n.normalize()); ps.push(A.add(B).add(C).divideScalar(3));
      }
      if (ns.length < 6) return null;
      const mean = new THREE.Vector3(); ns.forEach((n) => mean.add(n)); mean.divideScalar(ns.length);
      const dir = smallestAxis(ns.map((n) => n.clone().sub(mean)));
      // the point nearest every normal line, then onto a line along dir
      const A3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b3 = [0, 0, 0];
      ns.forEach((n, i) => { const q = ps[i], nn = [n.x, n.y, n.z], qq = [q.x, q.y, q.z]; for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) { const m = (a === c ? 1 : 0) - nn[a] * nn[c] - 0; A3[a][c] += m; b3[a] += m * qq[c]; } });
      // the normals of a turned face all meet the axis: allow any point along dir
      for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) A3[a][c] += 1e-6 * (a === c ? 1 : 0);
      const sol = solve3(A3, b3);
      if (!sol) return null;
      let c = new THREE.Vector3(...sol);
      // check: every face point sits about the same distance from this line (turned around it)
      const rs = ps.map((p) => { const q = p.clone().sub(c); return q.sub(dir.clone().multiplyScalar(q.dot(dir))).length(); });
      const rMean = rs.reduce((a, b) => a + b, 0) / rs.length;
      const mid = new THREE.Vector3(); ps.forEach((p) => mid.add(p)); mid.divideScalar(ps.length);
      c = c.clone().addScaledVector(dir, mid.clone().sub(c).dot(dir));
      const label = { CONE: "Cone", SPHERE: "Sphere", TORUS: "Torus" }[info.t] || "Round face";
      if (info.t !== "CONE" && info.t !== "SPHERE" && info.t !== "TORUS" && info.t !== "REVOLUTION") {
        const spread = Math.max(...rs) - Math.min(...rs);
        if (!(rMean > 1e-3) || spread > Math.max(0.05, rMean * 0.08)) return null;
      }
      return { c, d: dir, r: info.t === "CONE" || info.t === "SPHERE" ? rMean : rMean, label };
    }
    function axisOfEdge(base, ei) {
      const f = circleFit(edgeWorldPts(base, ei));
      return f ? { ...f, label: "Circular edge" } : null;
    }
    // what's under the pointer that has an axis: a round edge first, then the face
    function pickAxisAt(e) {
      const eh = pickBaseEdge(e, (b) => !b.cmdPreview);
      if (eh) { const a = axisOfEdge(eh.base, eh.edge); if (a) return { ...a, key: eh.body + ":e" + eh.edge, base: eh.base, edge: eh.edge }; }
      const fh = pickBaseFace(e, (b) => !b.cmdPreview);
      if (fh && fh.face >= 0) { const a = axisOfFace(fh.base, fh.face); if (a) return { ...a, key: fh.body + ":f" + fh.face, base: fh.base, face: fh.face }; }
      return null;
    }
    // features on a round body: go around the body's own center line (its biggest cylinder)
    function autoAxisFor(bodyId) {
      const base = bodyId && baseOf(bodyId);
      if (!base) return null;
      let best = null;
      base.data.faceInfo.forEach((info, fi) => { if (info && info.t === "CYLINDRE" && info.r && (!best || info.r > best.r)) best = { fi, r: info.r }; });
      return best ? axisOfFace(base, best.fi) : null;
    }
    // do the copies land on top of the original? (the object sits on the axis)
    function stacked() {
      if (st.type !== "circ") return false;
      const T = transforms();
      if (!T.length) return false;
      const p = st.center.clone();
      return T.every((x) => p.clone().applyMatrix4(x.m).distanceTo(p) < 1e-3);
    }

    // ---------------- features that can be copied, and where each one sits (world)
    const featLabel = (m) => m.t === "hole" ? (m.tapped ? "Tapped hole" : m.kind === "csink" ? "Countersunk hole" : m.kind === "cbore" ? "Counterbored hole" : "Hole") + ((m.at || []).length > 1 ? ` ×${m.at.length}` : "")
      : m.t === "emboss" ? (m.mode === "deboss" ? "Deboss" : "Emboss") + ` "${String(m.str || "").slice(0, 12)}"`
      : m.src === "rib" ? (m.rib && m.rib.shape === "gusset" ? "Gusset" : "Rib") + (m.rib && m.rib.count > 1 ? ` ×${m.rib.count}` : "")
      : m.src === "keyhole" ? "Keyhole slot" + (m.kh && m.kh.at.length > 1 ? ` ×${m.kh.at.length}` : "")
      : ({ extrude: "Extrude ", revolve: "Revolve ", sweep: "Sweep " }[m.tool && m.tool.t] || "") + (m.op === "cut" ? "cut" : m.op === "intersect" ? "intersect" : "join");
    const featOK = (m) => m.t === "hole" || (m.t === "emboss" && m.kind !== "other") || (m.t === "bool" && (m.src === "rib" || m.src === "keyhole") && m.tool) || (m.t === "bool" && m.src !== "combine" && m.src !== "clearance" && m.tool && ["extrude", "revolve", "sweep"].includes(m.tool.t) && m.tool.sketch);
    const featsOf = (b) => (b && b.node.mods ? b.node.mods.filter(featOK) : []);
    function featRef(b, m) {
      const B = M4(b.m), loc = (p) => new THREE.Vector3(...p).applyMatrix4(B);
      if (m.t === "hole") { const a = (m.at && m.at.length ? m.at : [{ p: m.p }]); const c = new THREE.Vector3(); a.forEach((x) => c.add(loc(x.p))); return c.divideScalar(a.length); }
      if (m.t === "emboss") return loc(m.p);
      // ribs and keyholes: their own points (body coordinates)
      if (m.src === "rib" && m.rib) return loc(m.rib.a).add(loc(m.rib.b)).multiplyScalar(0.5);
      if (m.src === "keyhole" && m.kh) { const c = new THREE.Vector3(); m.kh.at.forEach((x) => c.add(loc(x.p))); return c.divideScalar(Math.max(1, m.kh.at.length)); }
      const sk = findSketch(store.doc, m.tool.sketch);
      if (!sk) return null;
      const P = planeMatrix(sk.plane), c = new THREE.Vector3(); let n = 0;
      for (const pr of m.tool.profiles || []) if (pr.pt) { c.add(new THREE.Vector3(pr.pt[0], pr.pt[1], 0).applyMatrix4(P)); n++; }
      if (!n) return null;
      // the tool sits in the body through m (body coordinates when it was made)
      return c.divideScalar(n).applyMatrix4(new THREE.Matrix4().fromArray(m.m || IDENTITY)).applyMatrix4(B);
    }
    const chosenFeats = () => { const b = findBody(store.doc, st.fbody); return b ? featsOf(b).filter((m) => st.feats.includes(m.id)) : []; };

    // ---------------- a feature's shape in the world, so it can be clicked on the model (like
    // Fusion 360: click a face of the cut or boss to pick that feature) and outlined when picked
    function featShape(b, m) {
      const B = M4(b.m);
      if (m.t === "hole") {
        const r = (m.dia || 1) / 2;
        const rmax = Math.max(r, m.kind === "cbore" ? (m.cbDia || 0) / 2 : 0, m.kind === "csink" ? (m.csDia || 0) / 2 : 0);
        const through = m.through || !(m.depth > 0);
        return { kind: "hole", B, spots: m.at && m.at.length ? m.at : [{ p: m.p, n: m.n }], r, rmax, depth: through ? null : m.depth + (m.tip ? r / Math.tan((59 * Math.PI) / 180) : 0) };
      }
      if (m.t === "emboss") return { kind: "emboss", B, p: m.p, n: m.n || [0, 0, 1], ext: Math.max(m.size || 5, ((m.size || 5) * String(m.str || "").length * 0.62) / 2 + 1), depth: m.depth || 1 };
      // ribs and keyholes: their real shape, built by the geometry engine
      if (m.src === "rib" || m.src === "keyhole") { const W = B.clone().multiply(new THREE.Matrix4().fromArray(m.m || IDENTITY)); return { kind: m.src, W, Wi: W.clone().invert(), regs: [], z0: 0, z1: 0, mesh: toolMesh(b, m) }; }
      const sk = findSketch(store.doc, m.tool.sketch);
      if (!sk) return null;
      const regs = regionsFor(sk), rs = [];
      for (const ref of m.tool.profiles || []) {
        let i = regs.findIndex((r) => r.key === ref.key && pointIn(r, ref.pt));
        if (i < 0) i = regs.findIndex((r) => pointIn(r, ref.pt));
        if (i >= 0 && !rs.includes(regs[i])) rs.push(regs[i]);
      }
      const W = B.clone().multiply(new THREE.Matrix4().fromArray(m.m || IDENTITY)).multiply(planeMatrix(sk.plane));
      const t = m.tool;
      // revolves, sweeps (twisted or not) and other tools: their real shape, built by the
      // geometry engine, so any face they made can be clicked (like Fusion 360)
      if (t.t !== "extrude") return { kind: t.t, W, Wi: W.clone().invert(), regs: rs, z0: 0, z1: 0, mesh: toolMesh(b, m) };
      let z0 = 0, z1 = 0;
      if (t.t === "extrude") {
        const d = t.dist || 0;
        if (t.mode === "sym") { z0 = -Math.abs(d) / 2; z1 = -z0; }
        else if (t.mode === "two") { z0 = -Math.abs(t.dist2 || 0); z1 = Math.abs(d); }
        else { z0 = Math.min(0, d); z1 = Math.max(0, d); }
      }
      return { kind: t.t, W, Wi: W.clone().invert(), regs: rs, z0, z1 };
    }
    // start building the shapes of a body's revolve / sweep features, so a click can find them
    function prefetchFeats(b) { if (b) for (const m of featsOf(b)) if (m.t === "bool" && m.tool.t !== "extrude") toolMesh(b, m); }
    // the world-space triangles of a feature's tool (null until the geometry engine has built it)
    const toolCache = new Map();
    function toolMesh(b, m) {
      let key;
      try { key = "feat:" + bodyKey(resolveNode(m.tool, store.doc)); } catch (e) { return null; }
      const res = app.kernel.get(key);
      if (!res) {
        if (!app.kernel.isPending(key)) { try { app.kernel.request([{ id: "feat-" + m.id, key, node: resolveNode(m.tool, store.doc) }]); } catch (e) {} }
        return null;
      }
      if (!res.ok || !res.mesh) return null;
      const M = M4(b.m).multiply(new THREE.Matrix4().fromArray(m.m || IDENTITY));
      const ck = key + JSON.stringify(M.elements);
      let c = toolCache.get(ck);
      if (!c) {
        const V = res.mesh.vertices, T = res.mesh.triangles, v = new THREE.Vector3(), pts = new Float32Array(V.length);
        for (let i = 0; i < V.length; i += 3) { v.set(V[i], V[i + 1], V[i + 2]).applyMatrix4(M); pts[i] = v.x; pts[i + 1] = v.y; pts[i + 2] = v.z; }
        const box = new THREE.Box3(); for (let i = 0; i < pts.length; i += 3) box.expandByPoint(v.set(pts[i], pts[i + 1], pts[i + 2]));
        c = { pts, tri: T, box };
        toolCache.set(ck, c);
      }
      return c;
    }
    // how far P is from the surface of a mesh (Infinity when far outside its box)
    function meshDist(mesh, P, tol) {
      if (mesh.box.distanceToPoint(P) > tol) return Infinity;
      const { pts, tri } = mesh, tr = new THREE.Triangle(), q = new THREE.Vector3(), a = new THREE.Vector3(), bb = new THREE.Vector3(), cc = new THREE.Vector3();
      let best = Infinity;
      for (let i = 0; i < tri.length; i += 3) {
        const i0 = tri[i] * 3, i1 = tri[i + 1] * 3, i2 = tri[i + 2] * 3;
        a.set(pts[i0], pts[i0 + 1], pts[i0 + 2]); bb.set(pts[i1], pts[i1 + 1], pts[i1 + 2]); cc.set(pts[i2], pts[i2 + 1], pts[i2 + 2]);
        // quick reject on the triangle's own box
        if (P.x < Math.min(a.x, bb.x, cc.x) - tol || P.x > Math.max(a.x, bb.x, cc.x) + tol || P.y < Math.min(a.y, bb.y, cc.y) - tol || P.y > Math.max(a.y, bb.y, cc.y) + tol || P.z < Math.min(a.z, bb.z, cc.z) - tol || P.z > Math.max(a.z, bb.z, cc.z) + tol) continue;
        tr.set(a, bb, cc).closestPointToPoint(P, q);
        const d = q.distanceTo(P);
        if (d < best) { best = d; if (best < 1e-4) break; }
      }
      return best;
    }
    // distance from a 2D point to a profile's outline
    const outlineDist = (r, q) => {
      let best = Infinity;
      for (const poly of [r.poly, ...(r.holePolys || [])]) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j], c = poly[i], dx = c[0] - a[0], dy = c[1] - a[1], l2 = dx * dx + dy * dy || 1e-12;
        const f = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2));
        best = Math.min(best, Math.hypot(a[0] + f * dx - q[0], a[1] + f * dy - q[1]));
      }
      return best;
    };
    // how far a clicked point is from lying on the feature's surface (Infinity: not on it)
    function featScore(fs, P, tol) {
      if (!fs) return Infinity;
      if (fs.kind === "hole") {
        const q = P.clone().applyMatrix4(fs.B.clone().invert());
        let best = Infinity;
        for (const s of fs.spots) {
          const n = new THREE.Vector3(...s.n).normalize(), v = q.clone().sub(new THREE.Vector3(...s.p));
          const along = v.dot(n), rad = v.clone().addScaledVector(n, -along).length();
          if (along > tol || (fs.depth != null && along < -fs.depth - tol)) continue;
          if (rad < fs.r - tol || rad > fs.rmax + tol) continue;
          best = Math.min(best, fs.rmax > fs.r + tol ? 0 : Math.abs(rad - fs.r));
        }
        return best;
      }
      if (fs.kind === "emboss") {
        const q = P.clone().applyMatrix4(fs.B.clone().invert());
        const n = new THREE.Vector3(...fs.n).normalize(), v = q.clone().sub(new THREE.Vector3(...fs.p));
        const h = v.dot(n), inPlane = v.clone().addScaledVector(n, -h).length();
        return Math.abs(h) <= fs.depth + tol && inPlane <= fs.ext ? tol * 0.5 : Infinity;
      }
      if (fs.mesh) return meshDist(fs.mesh, P, Math.max(tol, 0.3));
      if (fs.kind !== "extrude" || !fs.regs.length) return Infinity;
      const q = P.clone().applyMatrix4(fs.Wi);
      if (q.z < fs.z0 - tol || q.z > fs.z1 + tol) return Infinity;
      let best = Infinity;
      for (const r of fs.regs) {
        const d = outlineDist(r, [q.x, q.y]), inside = pointIn(r, [q.x, q.y]);
        if (!inside && d > tol) continue;
        // on a side wall, or on the end cap (top of a boss, floor of a cut)
        best = Math.min(best, d, inside ? Math.min(Math.abs(q.z - fs.z0), Math.abs(q.z - fs.z1)) : Infinity);
      }
      return best;
    }
    // the feature of body b under a clicked point, or null
    function featAt(b, P) {
      const tol = Math.max(0.15, vp.pixelSize(P) * 4);
      let best = null, bs = Infinity;
      featsOf(b).forEach((m) => { const s = featScore(featShape(b, m), P, tol); if (s <= tol && s <= bs) { bs = s; best = m; } });
      return best;
    }
    // outline of a feature: its profiles at both ends with a few side lines, or its hole circles
    function featLines(b, m) {
      const fs = featShape(b, m), seg = [];
      if (!fs) return seg;
      if (fs.mesh) {
        // the feature's own sharp edges (its real shape)
        if (!fs.mesh.edges) {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(fs.mesh.pts, 3));
          g.setIndex(new THREE.BufferAttribute(fs.mesh.tri instanceof Uint32Array ? fs.mesh.tri : new Uint32Array(fs.mesh.tri), 1));
          const eg = new THREE.EdgesGeometry(g, 28);
          fs.mesh.edges = Array.from(eg.attributes.position.array);
          g.dispose(); eg.dispose();
        }
        return fs.mesh.edges;
      }
      const push = (a, c) => seg.push(a.x, a.y, a.z, c.x, c.y, c.z);
      if (fs.kind === "hole" || fs.kind === "emboss") {
        const list = fs.kind === "hole" ? fs.spots.map((s) => ({ p: s.p, n: s.n, r: fs.rmax, d: fs.depth == null ? Math.max(4, fs.r * 3) : fs.depth })) : [{ p: fs.p, n: fs.n, r: fs.ext, d: 0 }];
        for (const s of list) {
          const n = new THREE.Vector3(...s.n).normalize(), u = new THREE.Vector3(1, 0, 0);
          if (Math.abs(u.dot(n)) > 0.9) u.set(0, 1, 0);
          u.projectOnPlane(n).normalize();
          const w = n.clone().cross(u), c0 = new THREE.Vector3(...s.p);
          const ring = (off) => { const pts = []; for (let k = 0; k <= 40; k++) { const a = (k / 40) * Math.PI * 2; pts.push(c0.clone().addScaledVector(u, s.r * Math.cos(a)).addScaledVector(w, s.r * Math.sin(a)).addScaledVector(n, -off).applyMatrix4(fs.B)); } for (let k = 1; k < pts.length; k++) push(pts[k - 1], pts[k]); return pts; };
          const top = ring(0);
          if (s.d) { const bot = ring(s.d); for (let k = 0; k < 40; k += 10) push(top[k], bot[k]); }
        }
        return seg;
      }
      const zs = fs.kind === "extrude" ? [fs.z0, fs.z1] : [0];
      for (const r of fs.regs) for (const poly of [r.poly, ...(r.holePolys || [])]) {
        const at = (p, z) => new THREE.Vector3(p[0], p[1], z).applyMatrix4(fs.W);
        for (const z of zs) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) push(at(poly[j], z), at(poly[i], z));
        if (zs.length > 1 && fs.z1 - fs.z0 > 1e-6) { const stp = Math.max(1, Math.floor(poly.length / 8)); for (let i = 0; i < poly.length; i += stp) push(at(poly[i], fs.z0), at(poly[i], fs.z1)); }
      }
      return seg;
    }
    let hoverFeat = null;
    // the picked features are marked in the timeline as well
    function markTimeline(off = false) {
      const on = new Set(off || st.what !== "features" ? [] : st.feats);
      for (const x of tl.querySelectorAll(".tl-item")) x.classList.toggle("pt-on", on.has(x.getAttribute("data-mod")));
    }
    function toggleFeat(bodyId, modId) {
      if (st.fbody !== bodyId) { st.fbody = bodyId; st.feats = []; }
      st.feats = st.feats.includes(modId) ? st.feats.filter((x) => x !== modId) : [...st.feats, modId];
      changed();
    }

    // ---------------- the path: sampled into a world polyline with arc-length
    // a 3D line (from 3D Sketch, or any tube made along a path) as a path: its centre lines
    function lineBodyPaths(b) {
      const out = [];
      const sampleSeg = (sg, push) => {
        if (sg.pts) sg.pts.forEach(push);
        else if (sg.t === "line") { push(sg.a); push(sg.b); }
        else if (sg.t === "arc" && sg.m) {
          const A = new THREE.Vector3(...sg.a), Mv = new THREE.Vector3(...sg.m), B = new THREE.Vector3(...sg.b);
          const ab = B.clone().sub(A), am = Mv.clone().sub(A), n = ab.clone().cross(am);
          const n2 = n.lengthSq();
          if (n2 < 1e-12) { push(sg.a); push(sg.b); return; }
          const c = A.clone().add(am.clone().cross(n).multiplyScalar(ab.lengthSq()).add(n.clone().cross(ab).multiplyScalar(am.lengthSq())).divideScalar(2 * n2));
          const u = A.clone().sub(c), r = u.length(); u.normalize();
          const nn = n.clone().normalize(), v = nn.clone().cross(u);
          const ang = (p) => { const d = p.clone().sub(c); return Math.atan2(d.dot(v), d.dot(u)); };
          let a1 = ang(B); if (a1 <= 0) a1 += 2 * Math.PI;
          const k = Math.max(8, Math.ceil(a1 / 0.1));
          for (let i = 0; i <= k; i++) { const t = (a1 * i) / k; push(c.clone().addScaledVector(u, r * Math.cos(t)).addScaledVector(v, r * Math.sin(t)).toArray()); }
        } else if (sg.t === "circle" && sg.c) {
          const n = new THREE.Vector3(...(sg.n || [0, 0, 1])).normalize(), u = new THREE.Vector3(1, 0, 0);
          if (Math.abs(u.dot(n)) > 0.9) u.set(0, 1, 0);
          u.projectOnPlane(n).normalize(); const v = n.clone().cross(u);
          for (let i = 0; i <= 96; i++) { const t = (i / 96) * 2 * Math.PI; push(new THREE.Vector3(...sg.c).addScaledVector(u, sg.r * Math.cos(t)).addScaledVector(v, sg.r * Math.sin(t)).toArray()); }
        } else if (sg.spans) {
          for (const sp of sg.spans) for (let k = 0; k <= 24; k++) { const t = k / 24, u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; push([0, 1, 2].map((i) => w[0] * sp[0][i] + w[1] * sp[1][i] + w[2] * sp[2][i] + w[3] * sp[3][i])); }
        } else if (sg.a && sg.b) { push(sg.a); push(sg.b); }
      };
      const walk = (node, M) => {
        if (!node) return;
        const segs = node.t === "pipe" || node.t === "coil" ? node.edgeSegs : null;
        if (segs && segs.length) {
          const pts = [];
          const push = (p) => { const v = new THREE.Vector3(...p).applyMatrix4(M); if (!pts.length || pts[pts.length - 1].distanceTo(v) > 1e-6) pts.push(v); };
          for (const sg of segs) sampleSeg(sg, push);
          if (pts.length > 1) out.push(pts);
        }
        if (node.t === "group") for (const c of node.children || []) walk(c.node, M.clone().multiply(new THREE.Matrix4().fromArray(c.m || IDENTITY)));
      };
      walk(b.node, M4(b.m));
      return out;
    }
    const isLineBody = (b) => !!b && !b.hole && lineBodyPaths(b).length > 0;
    // a 3D line under the pointer (and which of its lines, for a joined 3D sketch)
    function pickLineBody(e) {
      const f = scene.pickFace(e);
      const b = f && findBody(store.doc, f.body);
      if (!b || !isLineBody(b)) return null;
      const lines = lineBodyPaths(b);
      let line = 0, bd = Infinity;
      lines.forEach((pts, i) => { for (const p of pts) { const d = p.distanceTo(f.point); if (d < bd) { bd = d; line = i; } } });
      return { body: b.id, line };
    }
    function pathData() {
      if (!st.path) return null;
      if (st.path.body) {
        const b = findBody(store.doc, st.path.body);
        const lines = b ? lineBodyPaths(b) : [];
        const pts = lines[Math.min(st.path.line || 0, lines.length - 1)];
        if (!pts || pts.length < 2) return null;
        return pathFrom(pts.map((p) => p.clone()), null, 1);
      }
      const sk = findSketch(store.view, st.path.sketch) || findSketch(store.doc, st.path.sketch);
      if (!sk) return null;
      const segs = orderPath(resolveSketch(sk), st.path.ents);
      if (!segs.length) return null;
      const P2 = [];
      const push = (q) => { const l = P2[P2.length - 1]; if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 1e-9) P2.push(q); };
      for (const g of segs) {
        if (g.t === "line") { push(g.a); push(g.b); }
        else if (g.t === "circle") { for (let k = 0; k <= 96; k++) { const t = (k / 96) * Math.PI * 2; push([g.c[0] + g.r * Math.cos(t), g.c[1] + g.r * Math.sin(t)]); } }
        else if (g.t === "arc") {
          // circle through a, m, b; walk from a through m to b
          const [ax, ay] = g.a, [mx, my] = g.m, [bx, by] = g.b;
          const d = 2 * (ax * (my - by) + mx * (by - ay) + bx * (ay - my));
          if (Math.abs(d) < 1e-12) { push(g.a); push(g.b); continue; }
          const ux = ((ax * ax + ay * ay) * (my - by) + (mx * mx + my * my) * (by - ay) + (bx * bx + by * by) * (ay - my)) / d;
          const uy = ((ax * ax + ay * ay) * (bx - mx) + (mx * mx + my * my) * (ax - bx) + (bx * bx + by * by) * (mx - ax)) / d;
          const r = Math.hypot(ax - ux, ay - uy), ang = (x, y) => Math.atan2(y - uy, x - ux);
          const a0 = ang(ax, ay), am = ang(mx, my), a1 = ang(bx, by), TAU = Math.PI * 2;
          const norm = (v) => ((v % TAU) + TAU) % TAU;
          let sw = norm(a1 - a0); if (norm(am - a0) > sw) sw -= TAU; // go the way that passes m
          const n = Math.max(8, Math.ceil(Math.abs(sw) / (Math.PI / 32)));
          for (let k = 0; k <= n; k++) { const t = a0 + (sw * k) / n; push([ux + r * Math.cos(t), uy + r * Math.sin(t)]); }
        } else if (g.t === "bez") {
          for (const sp of g.spans || []) for (let k = 0; k <= 24; k++) {
            const t = k / 24, u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
            push([0, 1].map((i) => w[0] * sp[0][i] + w[1] * sp[1][i] + w[2] * sp[2][i] + w[3] * sp[3][i]));
          }
        }
      }
      const M = planeMatrix(sk.plane);
      const pts = P2.map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M));
      if (pts.length < 2) return null;
      return pathFrom(pts, new THREE.Vector3(...sk.plane.n).normalize(), segs.length);
    }
    // a polyline with arc length; n: the plane it lies in (a 3D line works out its own, if flat)
    function pathFrom(pts, n, segCount) {
      const closed = pts[0].distanceTo(pts[pts.length - 1]) < 1e-6;
      if (!n) {
        // a flat 3D line still turns its copies in its own plane; a twisting one follows in 3D
        const c = new THREE.Vector3(); pts.forEach((p) => c.add(p)); c.divideScalar(pts.length);
        let best = null, bl = 0;
        for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 40))) for (let j = i + 1; j < pts.length; j += Math.max(1, Math.floor(pts.length / 40))) {
          const v = pts[i].clone().sub(c).cross(pts[j].clone().sub(c)), l = v.length();
          if (l > bl) { bl = l; best = v; }
        }
        if (best && bl > 1e-9) {
          best.normalize();
          const span = pts.reduce((m, p) => Math.max(m, p.distanceTo(c)), 0) || 1;
          if (pts.every((p) => Math.abs(p.clone().sub(c).dot(best)) < span * 1e-3 + 1e-4)) n = best;
        }
      }
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + pts[k].distanceTo(pts[k - 1]));
      const L = cum[cum.length - 1];
      // side: at a corner, which segment gives the direction (+1 the one after it, -1 the one before)
      const at = (s, side = 1) => {
        s = closed ? ((s % L) + L) % L : Math.max(0, Math.min(L, s));
        if (closed && side < 0 && s < 1e-9) s = L; // going backwards from the start: the last segment
        const q = Math.max(0, Math.min(L, s + side * 1e-6 * Math.max(1, L)));
        let k = 1;
        if (side > 0) { while (k < cum.length - 1 && cum[k] <= q) k++; } else { while (k < cum.length - 1 && cum[k] < q) k++; }
        const f = (s - cum[k - 1]) / Math.max(1e-12, cum[k] - cum[k - 1]);
        const tan = pts[k].clone().sub(pts[k - 1]).normalize();
        return { p: pts[k - 1].clone().lerp(pts[k], f), t: tan };
      };
      // the arc length of the point on the path nearest to q
      const nearest = (q) => {
        let best = 0, bd = Infinity;
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], d = pts[k].clone().sub(a), len2 = d.lengthSq() || 1e-12;
          const f = Math.max(0, Math.min(1, q.clone().sub(a).dot(d) / len2)), c = a.clone().addScaledVector(d, f), e = c.distanceTo(q);
          if (e < bd) { bd = e; best = cum[k - 1] + f * Math.sqrt(len2); }
        }
        return best;
      };
      return { pts, closed, L, at, nearest, n, segCount, is3d: !!(st.path && st.path.body) };
    }

    const recenter = () => {
      const box = new THREE.Box3();
      if (st.what === "features") {
        const b = findBody(store.doc, st.fbody);
        for (const m of chosenFeats()) { const r = b && featRef(b, m); if (r) box.expandByPoint(r); }
      } else for (const id of st.ids) { const b = findBody(store.doc, id); const bb = b && scene.boxWithMatrix(id, M4(b.m)); if (bb) box.union(bb); }
      st.center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    };
    // the transform of every copy (the original is not included)
    function transforms() {
      const out = [];
      if (st.type === "rect") {
        const n1 = Math.max(1, Math.round(st.n1)), n2 = Math.max(1, Math.round(st.n2));
        // "both sides": the count is per side and the original stays in the middle
        const r1 = st.sym ? [-(n1 - 1), n1 - 1] : [0, n1 - 1], r2 = st.sym ? [-(n2 - 1), n2 - 1] : [0, n2 - 1];
        for (let i = r1[0]; i <= r1[1]; i++) for (let j = r2[0]; j <= r2[1]; j++) {
          if (i === 0 && j === 0) continue;
          const v = AXV[st.ax1].clone().multiplyScalar(i * st.s1).add(AXV[st.ax2].clone().multiplyScalar(j * st.s2));
          out.push({ key: i + "," + j, m: new THREE.Matrix4().makeTranslation(v.x, v.y, v.z) });
        }
      } else if (st.type === "circ") {
        const n = Math.max(2, Math.round(st.cn));
        const full = st.angle >= 359.999;
        const step = full ? 360 / n : st.angle / (n - 1);
        const useRef = st.about === "axis" && st.axisRef;
        const c = useRef ? st.axisRef.c : st.about === "center" ? st.center : new THREE.Vector3();
        const ax = useRef ? st.axisRef.d : AXV[st.cax];
        for (let i = 1; i < n; i++) {
          const R = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)
            .multiply(new THREE.Matrix4().makeRotationAxis(ax, (i * step * Math.PI) / 180))
            .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
          out.push({ key: "c" + i, m: R });
        }
      } else {
        const pd = pathData();
        if (!pd) return out;
        const n = Math.max(2, Math.round(st.pn));
        const { s0, dir } = pathStart(pd);
        const T0 = onPathMove(pd);
        // spacing: the whole path shared out (a closed path: n equal steps all the way round;
        // an open one: from the object to the end of the path), or a typed distance
        let step = st.pspace;
        if (st.pdist === "fit") step = pd.closed ? pd.L / n : (dir > 0 ? pd.L - s0 : s0) / (n - 1);
        const A = pd.at(s0, dir);
        for (let i = 1; i < n; i++) {
          const s = s0 + dir * i * step;
          if (!pd.closed && (s < -1e-6 || s > pd.L + 1e-6)) break; // past the end of an open path
          const B = pd.at(s, dir);
          let m = new THREE.Matrix4().makeTranslation(B.p.x - A.p.x, B.p.y - A.p.y, B.p.z - A.p.z);
          if (st.orient === "follow" && pd.n) {
            // turn by the change in the path's direction, around the path's plane normal
            const t0 = A.t.clone().projectOnPlane(pd.n).normalize(), t1 = B.t.clone().projectOnPlane(pd.n).normalize();
            const ang = Math.atan2(t0.clone().cross(t1).dot(pd.n), t0.dot(t1));
            m = new THREE.Matrix4().makeTranslation(B.p.x, B.p.y, B.p.z)
              .multiply(new THREE.Matrix4().makeRotationAxis(pd.n, ang))
              .multiply(new THREE.Matrix4().makeTranslation(-A.p.x, -A.p.y, -A.p.z));
          } else if (st.orient === "follow") {
            // a path that twists through 3D: carry the copy's turn along the path step by step
            // (no sudden spins), so it stays the same way round relative to the path
            const q = new THREE.Quaternion(), qs = new THREE.Quaternion();
            const steps = Math.max(1, Math.ceil(Math.abs(s - s0) / Math.max(pd.L / 400, 0.2)));
            let prev = A.t.clone();
            for (let k = 1; k <= steps; k++) { const tk = pd.at(s0 + ((s - s0) * k) / steps, dir).t; qs.setFromUnitVectors(prev, tk); q.premultiply(qs); prev = tk; }
            m = new THREE.Matrix4().makeTranslation(B.p.x, B.p.y, B.p.z)
              .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
              .multiply(new THREE.Matrix4().makeTranslation(-A.p.x, -A.p.y, -A.p.z));
          }
          out.push({ key: "p" + i, m: m.multiply(T0) });
        }
      }
      return out;
    }
    // bodies on a path: should the object go onto the path (its centre on the nearest point)?
    function wantsOnPath(pd) {
      if (st.what !== "bodies" || !pd) return false;
      if (st.onPath == null) {
        // away from the path (more than half its own size): put it on, so the copies follow the line
        const A = pd.at(pd.nearest(st.center)), box = new THREE.Box3();
        for (const id of st.ids) { const b = findBody(store.doc, id); const bb = b && scene.boxWithMatrix(id, M4(b.m)); if (bb) box.union(bb); }
        const size = box.isEmpty() ? 0 : box.getSize(new THREE.Vector3()).length();
        return A.p.distanceTo(st.center) > Math.max(1, size * 0.5);
      }
      return !!st.onPath;
    }
    // where the copies start along the path, and which way they go. Put on the path, the object
    // goes to the end of an open path nearer to it and the copies run along the whole line (Go the
    // other way starts from the far end); otherwise they start beside the object's nearest point.
    function pathStart(pd) {
      const near = pd.nearest(st.center);
      if (wantsOnPath(pd) && !pd.closed) {
        let fromEnd = near > pd.L / 2;
        if (st.flip) fromEnd = !fromEnd;
        return { s0: fromEnd ? pd.L : 0, dir: fromEnd ? -1 : 1 };
      }
      return { s0: near, dir: st.flip ? -1 : 1 };
    }
    // the move that puts the object on the path (identity when it stays where it is)
    function onPathMove(pd) {
      if (!wantsOnPath(pd)) return new THREE.Matrix4();
      const { s0, dir } = pathStart(pd), A = pd.at(s0, dir);
      return new THREE.Matrix4().makeTranslation(A.p.x - st.center.x, A.p.y - st.center.y, A.p.z - st.center.z);
    }
    // a feature copied by a world transform W, in its body's own coordinates
    function movedFeature(b, m, W, key, doc) {
      const B = M4(b.m), L = B.clone().invert().multiply(W).multiply(B);
      const P = (p) => new THREE.Vector3(...p).applyMatrix4(L).toArray().map((v) => +v.toFixed(9));
      const D = (v) => new THREE.Vector3(...v).transformDirection(L).toArray().map((x) => +x.toFixed(9));
      const c = clone(m);
      c.id = st.idmap[m.id + key] || (st.idmap[m.id + key] = uid("f"));
      c.seq = nextSeq(doc);
      if (m.t === "hole") {
        if (c.at) c.at = c.at.map((x) => ({ ...x, p: P(x.p), n: D(x.n) }));
        if (c.p) c.p = P(c.p);
        if (c.n) c.n = D(c.n);
      } else if (m.t === "emboss") {
        for (const k of ["p", "o", "c"]) if (c[k]) c[k] = P(c[k]);
        for (const k of ["n", "x", "ax", "up"]) if (c[k]) c[k] = D(c[k]);
      } else if (m.src === "rib" && m.rib) {
        // ribs keep their points, so a copy can still be edited
        c.rib = { ...m.rib, a: P(m.rib.a), b: P(m.rib.b), n: D(m.rib.n) };
        c.tool = ribTool(c.rib, c.rib.a, c.rib.b, c.rib.n).tool;
      } else if (m.src === "keyhole" && m.kh) {
        c.kh = { ...m.kh, at: m.kh.at.map((x) => ({ p: P(x.p), n: D(x.n) })) };
        c.tool = keyholeTool(c.kh, c.kh.at.map((q) => ({ p: q.p, n: q.n, dir: faceUp(q.n, bodyUp(b), c.kh.ang || 0) })));
      } else {
        c.m = arr(L.clone().multiply(new THREE.Matrix4().fromArray(m.m || IDENTITY)));
      }
      return c;
    }
    const def = {
      title: "Pattern",
      keepSelection: true,
      valid: () => (st.what === "features" ? chosenFeats().length > 0 : st.ids.length > 0) && transforms().length > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const T = transforms();
        if (st.type === "path" && st.path && st.path.body && st.hidePath) { const pb = findBody(doc, st.path.body); if (pb) pb.hidden = true; }
        if (st.what === "features") {
          const b = findBody(doc, st.fbody);
          if (!b) return;
          const src = featsOf(b).filter((m) => st.feats.includes(m.id));
          // copies go right after their originals' place in the list, original order kept
          for (const t of T) for (const m of src) b.node.mods.push(movedFeature(b, m, t.m, t.key, doc));
          return;
        }
        const made = [];
        // the object itself moves onto the path first (when asked), so it is the first bead
        const T0 = st.type === "path" ? onPathMove(pathData()) : null;
        for (const id of st.ids) {
          const b = findBody(doc, id);
          if (!b) continue;
          const m0 = M4(b.m);
          if (T0) b.m = arr(m0.clone().premultiply(T0));
          const group = [b];
          for (const t of T) {
            const c = clone(b);
            c.id = st.idmap[id + t.key] || (st.idmap[id + t.key] = uid("b"));
            c.seq = nextSeq(doc);
            c.name = nextName(doc, b.name.replace(/\s\d+$/, ""));
            c.m = arr(m0.clone().premultiply(t.m));
            doc.bodies.push(c);
            group.push(c);
          }
          made.push(group);
        }
        if (st.join) {
          // one body per patterned shape: the original and its copies fused
          for (const group of made) {
            const first = group[0];
            const g = {
              id: st.idmap["join" + first.id] || (st.idmap["join" + first.id] = uid("b")),
              name: first.name + " pattern", seq: nextSeq(doc), color: first.color, hole: !!first.hole, hidden: false,
              m: IDENTITY.slice(),
              node: { t: "group", children: group.map((b) => ({ node: b.node, m: b.m, hole: false, name: b.name, color: b.color })), mods: [] },
            };
            const ids = new Set(group.map((b) => b.id));
            const at = doc.bodies.findIndex((b) => b.id === first.id);
            doc.bodies = doc.bodies.filter((b) => !ids.has(b.id));
            doc.bodies.splice(Math.min(at, doc.bodies.length), 0, g);
          }
        }
      },
      ok() { commit(def, "Pattern"); },
      hint: () => wantAxis() ? "Click a circular edge, the side of a cylinder or cone, or a round flat face to pattern around it."
        : stacked() ? "The copies land on top of the original: it sits on the center line. Choose Round edge or face and click the round part to go around."
        : st.type === "path" && (st.pickPath || !st.path) ? "Click a sketch line, arc, circle or polygon for the path (connected curves are picked together), or a 3D line from 3D Sketch."
        : st.what === "features" ? (st.fbody ? "Click a cut, boss, hole or text on the model, or in the timeline, to pick it (click again to unpick). You can also tick features in the list." : "Click a cut, boss, hole or text on the model, or in the timeline, to pick it.")
        : st.ids.length ? "Set the count and spacing. The copies preview in place." : "Click the shapes to pattern.",
      build(body) {
        body.append(row("Objects", seg([["bodies", "Bodies"], ["features", "Features"]], st.what, (v) => {
          st.what = v;
          if (v === "features" && !st.fbody) { const b = st.ids.map((id) => findBody(store.doc, id)).find((x) => featsOf(x).length) || store.doc.bodies.find((x) => featsOf(x).length); st.fbody = b ? b.id : null; prefetchFeats(b); }
          changed();
        }, "pt-what")));
        if (st.what === "bodies") {
          body.append(pickbox(!st.pickPath, st.ids.length ? el("span", {}, el("b", {}, st.ids.length), ` bod${st.ids.length > 1 ? "ies" : "y"}`) : "Click bodies", st.ids.length ? () => { st.ids = []; changed(); } : null, () => { st.pickPath = false; def.render(); }));
        } else {
          const b = findBody(store.doc, st.fbody), list = featsOf(b);
          body.append(pickbox(!st.pickPath, b ? el("span", {}, el("b", {}, b.name), ` · ${st.feats.length} of ${list.length} feature${list.length === 1 ? "" : "s"}`) : "Click a body", null, () => { st.pickPath = false; def.render(); }));
          if (b && !list.length) body.append(el("div", { class: "hint", style: { padding: 0 } }, "This body has no features that can be copied. Cuts and bosses made by extruding a sketch, holes and embossed text can be patterned."));
          if (list.length) body.append(el("div", { class: "pt-feats", id: "pt-feats" }, ...list.map((m) => el("label", { class: "check" + (st.feats.includes(m.id) ? " on" : ""), onmouseenter: () => { hoverFeat = { key: b.id + ":" + m.id, body: b.id, mod: m.id }; draw(); }, onmouseleave: () => { hoverFeat = null; draw(); } },
            el("input", { type: "checkbox", "data-mod": m.id, checked: st.feats.includes(m.id), onchange: (e) => { st.feats = e.target.checked ? [...st.feats, m.id] : st.feats.filter((x) => x !== m.id); changed(); } }), featLabel(m)))));
        }
        const types = seg([["rect", "Rectangular"], ["circ", "Circular"], ["path", "Path"]], st.type, (v) => { st.type = v; if (v === "path" && !st.path) st.pickPath = true; changed(); }, "pt-type");
        types.classList.add("seg-wide");
        body.append(el("div", { class: "subhead" }, "Type"), types);
        const num = (label, key, opts) => row(label, app.numField({ value: st[key], id: "pt-" + key, live: true, ...opts, onCommit: (v) => { st[key] = v; changed(false); } }), "pt-" + key);
        const axes = (key) => seg([["x", "X"], ["y", "Y"], ["z", "Z"]], st[key], (v) => { st[key] = v; changed(); }, "pt-" + key);
        if (st.type === "rect") {
          body.append(el("div", { class: "subhead" }, "Direction 1"));
          body.append(row("Along", axes("ax1")));
          body.append(num("Count", "n1", { min: 1, max: 200, step: 1 }));
          body.append(num("Spacing", "s1", { step: 1 }));
          body.append(el("div", { class: "subhead" }, "Direction 2 (count 1 = off)"));
          body.append(row("Along", axes("ax2")));
          body.append(num("Count", "n2", { min: 1, max: 200, step: 1 }));
          body.append(num("Spacing", "s2", { step: 1 }));
          body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pt-sym", checked: st.sym, onchange: (e) => { st.sym = e.target.checked; changed(false); } }), "Both sides of the original (count per side)"));
        } else if (st.type === "circ") {
          const th = seg([["axis", "Round edge or face"], ["origin", "Origin"], ["center", st.what === "features" ? "Feature center" : "Shape center"]], st.about, (v) => { st.about = v; st.autoAxis = false; st.pickAxis = v === "axis" && !st.axisRef; changed(); }, "pt-about");
          th.classList.add("seg-wide");
          body.append(el("div", { class: "subhead" }, "Around"), th);
          if (st.about === "axis") {
            const a = st.axisRef;
            body.append(row("Axis", pickbox(st.pickAxis || !a, a ? el("span", {}, el("b", {}, a.label), a.r ? ` · Ø ${withUnit(a.r * 2, 2)}` : "") : "Click a round edge or face", a ? () => { st.axisRef = null; st.pickAxis = true; changed(); } : null, () => { st.pickAxis = true; def.render(); }), "pt-axis"));
            body.append(el("div", { class: "hint", style: { padding: 0 } }, "Click a circular edge, the side of a cylinder or cone, or a round flat face. The copies go around its center line."));
          } else body.append(row("Axis", axes("cax")));
          body.append(num("Count", "cn", { min: 2, max: 360, step: 1 }));
          body.append(num("Total angle", "angle", { min: 1, max: 360, step: 15 }));
          body.append(el("div", { class: "hint", style: { padding: 0 } }, "360° spaces the copies evenly around the full circle."));
        } else {
          const pd = pathData();
          body.append(row("Path", pickbox(st.pickPath, pd ? (pd.is3d ? el("span", {}, el("b", {}, "3D line"), ` · ${pd.closed ? "closed" : "open"} · ${withUnit(pd.L, 1)}`) : el("span", {}, el("b", {}, pd.segCount), ` curve${pd.segCount > 1 ? "s" : ""} · ${pd.closed ? "closed" : "open"} · ${withUnit(pd.L, 1)}`)) : "Click a sketch path or a 3D line", pd ? () => { st.path = null; st.pickPath = true; changed(); } : null, () => { st.pickPath = true; def.render(); }), "pt-path"));
          body.append(num("Count", "pn", { min: 2, max: 500, step: 1 }));
          body.append(row("Spread", seg([["fit", pd && !pd.closed ? "To the end" : "Whole path"], ["space", "Spacing"]], st.pdist, (v) => { st.pdist = v; changed(); }, "pt-pdist")));
          if (st.pdist === "space") body.append(num("Spacing", "pspace", { min: 0.01, step: 1 }));
          body.append(row("Copies", seg([["same", "Same direction"], ["follow", "Follow path"]], st.orient, (v) => { st.orient = v; changed(); }, "pt-orient")));
          if (st.what === "bodies" && pd) body.append(el("label", { class: "check", title: "Moves the object so its centre sits on the path, and every copy follows the path. Off: the object stays where it is and the copies keep the same distance from the path." }, el("input", { type: "checkbox", id: "pt-onpath", checked: wantsOnPath(pd), onchange: (e) => { st.onPath = e.target.checked; changed(false); } }), "Put the object on the path"));
          body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pt-flip", checked: st.flip, onchange: (e) => { st.flip = e.target.checked; changed(false); } }), "Go the other way along the path"));
          if (pd && pd.is3d) body.append(el("label", { class: "check", title: "Hide the 3D line once the copies are made (it stays in the browser; the eye button shows it again)" }, el("input", { type: "checkbox", id: "pt-hidepath", checked: !!st.hidePath, onchange: (e) => { st.hidePath = e.target.checked; } }), "Hide the 3D line afterwards"));
          body.append(el("div", { class: "hint", style: { padding: 0 } }, (st.what === "features" ? "Copies start where the features sit (the nearest point on the path)" : wantsOnPath(pd) ? (pd.closed ? "The object moves onto the path (its nearest point), and the copies" : "The object moves to the nearer end of the path, and the copies") : "Copies start where the object sits, beside the nearest point on the path, and") + (st.what === "features" ? " and step along it." : " step along it.") + " Follow path turns each copy with the path, like beads on a string."));
        }
        const total = transforms().length + 1;
        body.append(el("div", { class: "hint", id: "pt-total", style: { padding: 0 } }, `${total} instance${total === 1 ? "" : "s"} in total.`));
        if (st.what === "bodies") body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pt-join", checked: st.join, onchange: (e) => { st.join = e.target.checked; changed(false); } }), "Join copies into one body"));
      },
      start() { recenter(); scene.setSelected(st.what === "features" ? [] : st.ids); draw(); schedulePreview(def); },
      afterTimeline: () => markTimeline(),
      // Features: clicking a feature in the timeline picks it too (as in Fusion 360)
      timelinePick(it) {
        const b = it.body && findBody(store.doc, it.body), m = b && it.mod && featsOf(b).find((x) => x.id === it.mod);
        if (!m) { app.toast("That timeline item can't be patterned as a feature. Cuts, bosses, holes and text can."); return; }
        if (st.what !== "features") st.what = "features";
        toggleFeat(b.id, m.id);
      },
      cleanup() { scene.setSelected([]); clearOv(); markTimeline(true); },
      handler: {
        hover(e) {
          if (wantAxis()) { const a = pickAxisAt(e); const k = a ? a.key : null; if (k !== (hoverAxis && hoverAxis.key)) { hoverAxis = a; draw(); } vp.canvas.style.cursor = a ? "pointer" : "default"; scene.setHovered(null); return; }
          if (st.type === "path" && st.pickPath) { const h = pickSketchCurve(e), lb = h ? null : pickLineBody(e); vp.canvas.style.cursor = h || lb ? "pointer" : "default"; scene.setHovered(lb ? lb.body : null); return; }
          const f = scene.pickFace(e);
          if (st.what === "features") {
            // the feature under the pointer is outlined (not the whole body)
            const b = f && findBody(store.doc, f.body);
            const m = b ? featAt(b, f.point) : null;
            const k = m ? b.id + ":" + m.id : null;
            if (k !== (hoverFeat && hoverFeat.key)) { hoverFeat = m ? { key: k, body: b.id, mod: m.id } : null; draw(); }
            scene.setHovered(null);
            vp.canvas.style.cursor = f ? "pointer" : "default";
            return;
          }
          scene.setHovered(f ? f.body : null); vp.canvas.style.cursor = f ? "pointer" : "default";
        },
        down(e) {
          // the center line for a circular pattern: a round edge or face
          if (wantAxis()) {
            const a = pickAxisAt(e);
            if (a) { st.axisRef = { c: a.c, d: a.d, r: a.r, label: a.label }; st.pickAxis = false; st.autoAxis = false; hoverAxis = null; changed(); }
            else app.toast("Click a circular edge, the side of a cylinder or cone, or a round flat face.");
            return true;
          }
          // the path: a sketch curve and the curves joined to it, or a 3D line
          if (st.type === "path" && (st.pickPath || !scene.pickFace(e))) {
            const h = pickSketchCurve(e);
            if (h) {
              const sk = findSk(store.view, h.sketch);
              st.path = { sketch: h.sketch, ents: pathChain(resolveSketch(sk), h.curve.id) };
              st.pickPath = false; changed();
              return true;
            }
            const lb = st.pickPath ? pickLineBody(e) : null;
            if (lb) {
              st.path = { body: lb.body, line: lb.line };
              // the line itself isn't one of the copies
              st.ids = st.ids.filter((id) => id !== lb.body);
              st.pickPath = false; changed();
              return true;
            }
            if (st.pickPath) return true;
          }
          const f = scene.pickFace(e);
          if (!f || !findBody(store.doc, f.body)) return true; // copies in the preview aren't pickable
          if (st.what === "features") {
            // a click on a face of a cut, boss, hole or text picks (or unpicks) that feature
            const b = findBody(store.doc, f.body), m = featAt(b, f.point);
            if (m) { toggleFeat(b.id, m.id); return true; }
            if (st.fbody !== f.body) { st.fbody = f.body; st.feats = []; prefetchFeats(b); changed(); }
            else if (featsOf(b).some((x) => x.t === "bool" && x.tool.t !== "extrude" && !featShape(b, x)?.mesh)) app.toast("Working out the exact shape of this body's features… click the face again in a moment.");
            else app.toast(featsOf(b).length ? "That face isn't part of a feature that can be patterned. Click a face of a cut, boss, hole or text, or tick it in the list." : "This body has no features that can be patterned.");
            return true;
          }
          const i = st.ids.indexOf(f.body);
          if (i >= 0) st.ids.splice(i, 1); else st.ids.push(f.body);
          changed();
          return true;
        },
      },
    };
    let hoverAxis = null;
    const wantAxis = () => st.type === "circ" && st.about === "axis" && (st.pickAxis || !st.axisRef);
    // the picked path, drawn bold, with a dot where each copy goes
    function draw() {
      clearOv();
      // circular: the center line it goes around (and the one under the pointer)
      if (st.type === "circ") {
        for (const [a, col] of [[st.about === "axis" ? st.axisRef : null, 0x2f66c8], [hoverAxis, 0xe8a317]]) {
          if (!a) continue;
          const L = Math.max(10, (a.r || 10) * 2.5), p0 = a.c.clone().addScaledVector(a.d, -L), p1 = a.c.clone().addScaledVector(a.d, L);
          const o = thickLines([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z], col, 3, true); o.renderOrder = 16; ov.add(o);
          if (a.r) { const u = new THREE.Vector3().crossVectors(a.d, Math.abs(a.d.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize(), v = new THREE.Vector3().crossVectors(a.d, u), seg = [];
            for (let k = 0; k < 64; k++) { const t0 = (k / 64) * Math.PI * 2, t1 = ((k + 1) / 64) * Math.PI * 2; const q0 = a.c.clone().addScaledVector(u, a.r * Math.cos(t0)).addScaledVector(v, a.r * Math.sin(t0)), q1 = a.c.clone().addScaledVector(u, a.r * Math.cos(t1)).addScaledVector(v, a.r * Math.sin(t1)); seg.push(q0.x, q0.y, q0.z, q1.x, q1.y, q1.z); }
            const r = thickLines(seg, col, 2.5, false); r.renderOrder = 16; ov.add(r); }
        }
        vp.request();
      }
      if (st.what === "features") {
        // picked features in blue, the one under the pointer in orange
        const b = findBody(store.doc, st.fbody);
        if (b) for (const m of chosenFeats()) { const sg = featLines(b, m); if (sg.length) { const o = thickLines(sg, 0x2f66c8, 2.6, false); o.renderOrder = 15; ov.add(o); } }
        const hb = hoverFeat && findBody(store.doc, hoverFeat.body), hm = hb && featsOf(hb).find((x) => x.id === hoverFeat.mod);
        if (hm) { const sg = featLines(hb, hm); if (sg.length) { const o = thickLines(sg, 0xe8a317, 2.6, false); o.renderOrder = 16; ov.add(o); } }
        vp.request();
      }
      markTimeline();
      if (st.type !== "path") return;
      const pd = pathData();
      if (!pd) return;
      const seg = [];
      for (let k = 1; k < pd.pts.length; k++) { const a = pd.pts[k - 1], b = pd.pts[k]; seg.push(a.x, a.y, a.z, b.x, b.y, b.z); }
      const o = thickLines(seg, 0xe8a317, 4, false); o.renderOrder = 15; ov.add(o);
      const { s0, dir } = pathStart(pd), A = pd.at(s0, dir), mk = [], on = wantsOnPath(pd);
      for (const t of [{ m: on ? onPathMove(pd) : new THREE.Matrix4() }, ...transforms()]) {
        const q = (on ? st.center : A.p).clone().applyMatrix4(t.m), r = vp.pixelSize(q) * 5;
        mk.push(q.x - r, q.y, q.z, q.x + r, q.y, q.z, q.x, q.y - r, q.z, q.x, q.y + r, q.z);
      }
      const d = thickLines(mk, 0x2f66c8, 5, false); d.renderOrder = 16; ov.add(d);
    }
    function changed(rerender = true) {
      // patterning features on a round body: go around its center line unless told otherwise
      if (st.type === "circ" && st.autoAxis && st.what === "features" && st.fbody && (!st.axisRef || st.axisRef.body !== st.fbody)) {
        const a = autoAxisFor(st.fbody);
        if (a) { st.axisRef = { c: a.c, d: a.d, r: a.r, label: "Body center line", body: st.fbody }; st.about = "axis"; st.pickAxis = false; }
      }
      recenter();
      if (rerender) def.render();
      const t = document.getElementById("pt-total");
      if (t) { const n = transforms().length + 1; t.textContent = `${n} instance${n === 1 ? "" : "s"} in total.`; }
      scene.setSelected(st.what === "features" ? [] : st.ids);
      draw();
      schedulePreview(def);
      def.refreshOk();
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Primitive
  function primCmd(kind, editingId = null) {
    const existing = editingId ? findBody(store.doc, editingId) : null;
    const st = { kind: existing ? existing.node.kind : kind, p: existing ? { ...existing.node.p } : { ...PRIM_DEFAULTS[kind] }, m: existing ? existing.m.slice() : null, id: existing ? existing.id : uid("b"), placed: !!existing };
    st.rackBaseFollowsModule = st.kind === "rack" && Math.abs(st.p.baseDepth - 2 * st.p.module) < 1e-9;
    if (!st.m) { const t = vp.view.target; st.m = arr(new THREE.Matrix4().makeTranslation(round(t.x, 5), round(t.y, 5), 0)); }
    const def = {
      title: (existing ? "Edit " : "") + primName(st.kind),
      apply(doc) {
        let b = findBody(doc, st.id);
        if (!b) { b = makePrimBody(doc, st.kind, st.m, { color: BODY_COLORS[doc.bodies.length % BODY_COLORS.length] }); b.id = st.id; doc.bodies.push(b); }
        b.node.p = { ...st.p };
        if (st.kind === "torus") b.node.p.d = b.node.p.w;
        b.m = st.m.slice();
      },
      ok() { commit(def, existing ? "Edit " + primName(st.kind).toLowerCase() : "Add " + primName(st.kind).toLowerCase()); },
      onDelete: existing ? () => { closeCmd(false); deleteBodies([existing.id]); } : null,
      hint: () => existing ? "Edit the sizes." : "Click the ground or a flat face to place it, then set the sizes.",
      build(body) {
        if (st.kind === "gear" || st.kind === "bevelgear" || st.kind === "rack") {
          body.append(el("div", { class: "subhead" }, st.kind === "gear" ? "Spur gear" : st.kind === "bevelgear" ? "Straight bevel gear" : "Rack"));
          const fields = [["Module", "module", 0.2, 50, 0.25], ["Teeth", "teeth", 6, 120, 1], ["Pressure angle °", "pressureAngle", 14, 30, 1], ["Face width", "thickness", 0.1, 10000, 0.5]];
          if (st.kind === "gear" || st.kind === "bevelgear") fields.push(["Bore", "bore", 0, 10000, 0.5]);
          if (st.kind === "bevelgear") fields.push(["Pitch cone angle °", "coneAngle", 5, 80, 1]);
          if (st.kind === "rack") fields.push(["Base depth", "baseDepth", 0.1, 10000, 0.5]);
          for (const [label, key, min, max, step] of fields) body.append(row(label, app.numField({ value: st.p[key], id: "pr-gear-" + key, min, max, step, live: true, onCommit: (v) => {
            st.p[key] = v;
            if (key === "module" && st.rackBaseFollowsModule) { st.p.baseDepth = 2 * v; def.render(); }
            if (key === "baseDepth") st.rackBaseFollowsModule = false;
            schedulePreview(def);
          } }), "pr-gear-" + key));
        } else {
          const dims = st.kind === "torus" ? [["Diameter", "w"], ["Tube", "tube"]] : st.kind === "sphere" ? [["X", "w"], ["Y", "d"], ["Z", "h"]] : [["Width", "w"], ["Depth", "d"], ["Height", "h"]];
          const r3 = el("div", { class: "row3" });
          for (const [l, k] of dims) r3.append(el("label", {}, l, app.numField({ value: st.p[k], id: "pr-" + k, min: 0.01, step: 1, live: true, onCommit: (v) => { st.p[k] = v; schedulePreview(def); } })));
          body.append(el("div", { class: "subhead" }, "Size"), r3);
          const extra = { cone: [["Top ratio", "top", 0, 1]], pyramid: [["Sides", "sides", 3, 12]], prism: [["Sides", "sides", 3, 24]], tube: [["Wall", "wall", 0.1, 1e9]], box: [["Fillet all", "r", 0, 1e9], ["Chamfer all", "c", 0, 1e9]], cylinder: [["Fillet ends", "r", 0, 1e9]] }[st.kind] || [];
          for (const [l, k, mn, mx] of extra) body.append(row(l, app.numField({ value: st.p[k] ?? 0, id: "pr-x-" + k, min: mn, max: mx, step: k === "top" ? 0.1 : 1, live: true, onCommit: (v) => { st.p[k] = v; schedulePreview(def); } }), "pr-x-" + k));
        }
        const pos = new THREE.Vector3().setFromMatrixPosition(M4(st.m));
        const p3 = el("div", { class: "row3" });
        ["X", "Y", "Z"].forEach((l, i) => p3.append(el("label", {}, l, app.numField({ value: pos.getComponent(i), id: "pr-pos" + i, step: 1, onCommit: (v) => {
          const m = M4(st.m); const p = new THREE.Vector3().setFromMatrixPosition(m); p.setComponent(i, v); m.setPosition(p); st.m = arr(m); schedulePreview(def);
        } }))));
        body.append(el("div", { class: "subhead" }, "Base position"), p3);
      },
      start() { schedulePreview(def); },
      handler: {
        hover(e) {
          if (st.placed) return;
          const mat = placeOn(e, st.id);
          if (mat) { st.m = arr(mat); schedulePreview(def); }
        },
        down(e) {
          const mat = placeOn(e, st.id);
          if (mat) { st.m = arr(mat); st.placed = true; def.render(); schedulePreview(def); }
          return true;
        },
      },
    };
    openCmd(def);
  }

  // ------------------------------------------------------------------ fasteners library
  // Bolts, screws, nuts, washers, inserts and pins in metric and inch sizes. Point at a face to
  // place one (it stands on the face), or at a round hole to drop it in, lined up with the hole.
  function fastenerCmd(editingId = null) {
    const existing = editingId ? findBody(store.doc, editingId) : null;
    let pref = {}; try { pref = JSON.parse(localStorage.getItem("jumpstart3d.fastener") || "{}") || {}; } catch (e) {}
    const f0 = existing ? existing.fastener : null;
    const st = { kind: (f0 || pref).kind || "shcs", std: (f0 || pref).std || (getUnit() === "in" ? "inch" : "metric"), size: (f0 || pref).size || null, len: f0 ? f0.len : null, threads: f0 ? !!f0.threads : !!pref.threads,
      id: existing ? existing.id : uid("b"), m: existing ? existing.m.slice() : null, placed: !!existing, where: null };
    const fix = () => {
      if (fastKind(st.kind).metricOnly) st.std = "metric";
      const sizes = sizesFor(st.kind, st.std);
      if (!sizes.includes(st.size)) st.size = sizes.includes(st.std === "inch" ? '1/4"-20' : "M3") ? (st.std === "inch" ? '1/4"-20' : "M3") : sizes[0];
      if (!(st.len > 0)) st.len = defaultLength(st.kind, st.std, st.size);
    };
    fix();
    if (!st.m) { const t = vp.view.target; st.m = arr(new THREE.Matrix4().makeTranslation(round(t.x, 5), round(t.y, 5), 0)); }
    const part = () => fastenerPart(st.kind, st.std, st.size, st.len, { threads: st.threads, clear: store.doc.threadOffset || 0 });
    // over a round hole: stand on its rim, along its axis (toward the camera side)
    function holePlace(e) {
      const hit = scene.pickFace(e, (b) => b.id !== st.id && !b.hole);
      if (!hit || !hit.info || hit.info.t !== "CYLINDRE" || hit.info.ext !== false || !hit.info.ax) return null;
      const G = hit.view.group.matrixWorld;
      const o = V3(hit.info.o).applyMatrix4(G), a = V3(hit.info.ax).transformDirection(G).normalize(), r = hit.info.r;
      if (a.dot(vp.camera.position.clone().sub(hit.point)) < 0) a.negate();
      const t = hit.point.clone().sub(o).dot(a), c = o.clone().addScaledVector(a, t);
      const u = new THREE.Vector3().crossVectors(a, Math.abs(a.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
      const ray = new THREE.Raycaster(c.clone().addScaledVector(a, 1e4).addScaledVector(u, r * 1.3 + 0.2), a.clone().negate());
      const hits = ray.intersectObject(hit.view.mesh, false);
      const top = hits.length ? hits[0].point.clone().sub(c).dot(a) : 0;
      const m = frameOnFace(c.clone().addScaledVector(a, top), a);
      return { m, label: "hole Ø" + withUnit(2 * r, 2) };
    }
    const def = {
      title: (existing ? "Edit " : "") + "Fastener",
      apply(doc) {
        const pt = part();
        let b = findBody(doc, st.id);
        if (!b) { b = { id: st.id, name: pt.name, seq: nextSeq(doc), color: pt.color, hole: false, hidden: false, m: st.m.slice(), node: pt.node }; doc.bodies.push(b); }
        else if (!existing || existing.name === existing.fastener?.name) b.name = pt.name;
        b.node = pt.node; b.m = st.m.slice();
        b.fastener = { kind: st.kind, std: st.std, size: st.size, len: st.len, threads: st.threads, name: pt.name };
      },
      ok() {
        try { localStorage.setItem("jumpstart3d.fastener", JSON.stringify({ kind: st.kind, std: st.std, size: st.size, threads: st.threads })); } catch (e) {}
        commit(def, existing ? "Edit fastener" : "Add fastener");
      },
      onDelete: existing ? () => { closeCmd(false); deleteBodies([existing.id]); } : null,
      hint: () => existing ? "Change the part, then OK." : "Point at a face to stand it there, or at a round hole to drop it in. Click to place, then OK.",
      build(body) {
        const k = fastKind(st.kind);
        const sel = el("tool-choice", { id: "fs-kind", onchange: (e) => { st.kind = e.target.value; st.len = null; fix(); def.render(); schedulePreview(def); } });
        for (const gname of [...new Set(FASTENER_KINDS.map((x) => x.group))]) {
          const og = el("optgroup", { label: gname });
          for (const x of FASTENER_KINDS.filter((y) => y.group === gname)) og.append(el("option", { value: x.id, selected: x.id === st.kind }, x.label));
          sel.append(og);
        }
        body.append(row("Part", sel, "fs-kind"));
        if (!k.metricOnly) body.append(row("Standard", seg([["metric", "Metric (ISO)"], ["inch", "Inch (UNC)"]], st.std, (v) => { st.std = v; st.len = null; fix(); def.render(); schedulePreview(def); }, "fs-std")));
        const ss = el("tool-choice", { id: "fs-size", onchange: (e) => { st.size = e.target.value; st.len = null; fix(); def.render(); schedulePreview(def); } }, ...sizesFor(st.kind, st.std).map((z) => el("option", { value: z, selected: z === st.size }, z)));
        body.append(row("Size", ss, "fs-size"));
        if (k.len) {
          const opts = st.std === "inch" ? LENGTHS.inch.map(([v, l]) => [v * 25.4, l]) : LENGTHS.metric.map((v) => [v, v + " mm"]);
          const ls = el("tool-choice", { id: "fs-lenpick", onchange: (e) => { if (e.target.value) { st.len = +e.target.value; def.render(); schedulePreview(def); } } },
            el("option", { value: "" }, "Standard…"), ...opts.map(([v, l]) => el("option", { value: v, selected: Math.abs(v - st.len) < 1e-6 }, l)));
          body.append(row("Length", el("div", { style: { display: "flex", gap: "6px" } }, app.numField({ value: st.len, id: "fs-len", len: true, min: 0.5, step: 1, onCommit: (v) => { st.len = v; schedulePreview(def); } }), ls), "fs-len"));
        }
        if (k.thread) body.append(el("label", { class: "check", title: "Cut a real helical thread (slower to build; plain is lighter and fine for most models)" }, el("input", { type: "checkbox", id: "fs-threads", checked: st.threads, onchange: (e) => { st.threads = e.target.checked; schedulePreview(def); } }), "Modeled threads"));
        const hs = holeSizes(st.std, st.size);
        if (hs) body.append(el("div", { class: "hint", id: "fs-holes", style: { padding: "2px 0" } }, `Holes for ${st.size}: clearance ${withUnit(hs.clearance, 2)}, tap drill ${withUnit(hs.tap, 2)}` + (st.kind === "insert" && hs.insert ? `, insert hole ${withUnit(hs.insert, 2)}` : "") + "."));
        if (st.where) body.append(el("div", { class: "hint", style: { padding: 0 } }, "Placed in the " + st.where + "."));
      },
      start() { schedulePreview(def); },
      handler: {
        hover(e) {
          if (st.placed) return;
          const h = holePlace(e);
          const mat = h ? h.m : placeOn(e, st.id);
          if (mat) { st.m = arr(mat); schedulePreview(def); }
          vp.canvas.style.cursor = h ? "copy" : "default";
        },
        down(e) {
          const h = holePlace(e);
          const mat = h ? h.m : placeOn(e, st.id);
          if (mat) { st.m = arr(mat); st.placed = true; st.where = h ? h.label : null; def.render(); schedulePreview(def); }
          return true;
        },
      },
    };
    openCmd(def);
  }

  // ------------------------------------------------------------------ bin & box maker
  // Small part bins and organiser boxes: size, a grid of compartments, their shape, walls, finger
  // scoops, label lips, a stackable foot and a lid. Edit it later from the Browser (double-click).
  function binCmd(editingId = null) {
    const existing = editingId ? findBody(store.doc, editingId) : null;
    let pref = {}; try { pref = JSON.parse(localStorage.getItem("jumpstart3d.bins") || "{}") || {}; } catch (e) {}
    const b0 = existing ? existing.bin : null;
    // every part of the set (bins, cases, drawers, tilt bins, doors, the lid) is its own body;
    // the first holds the settings and the ids of the others
    const ids = { ...(b0 && b0.ids || {}) };
    if (b0 && b0.lidId && !ids.lid) ids.lid = b0.lidId;
    const st = { o: { ...BIN_DEFAULTS, ...BIN_MORE_DEFAULTS, ...(b0 || pref) }, id: existing ? existing.id : uid("b"), m: existing ? existing.m.slice() : null, placed: !!existing };
    delete st.o.ids; delete st.o.lidId;
    if (!st.m) { const t = vp.view.target; st.m = arr(new THREE.Matrix4().makeTranslation(round(t.x, 1), round(t.y, 1), 0)); }
    let info = null;
    const infoText = () => { try { const r = binSet(st.o), c = r.cell; return (r.info ? r.info + " " : "") + (c ? `Each compartment: ${withUnit(c.w, 1)} x ${withUnit(c.d, 1)}, ${withUnit(c.h, 1)} deep.` : ""); } catch (err) { return err.message; } };
    // all the bodies of this set: placing it must not land on its own drawers or upper cases
    const mine = (id) => id === st.id || Object.values(ids).includes(id);
    const def = {
      title: existing ? "Edit bin" : "Bin & Box Maker",
      apply(doc) {
        const set = binSet(st.o);
        info = set;
        const keep = new Set();
        // the parts this doc has now (the preview works on a copy: never change the real list here)
        const prev = findBody(doc, st.id), old = { ...(prev && prev.bin && prev.bin.ids || {}) };
        if (prev && prev.bin && prev.bin.lidId && !old.lid) old.lid = prev.bin.lidId;
        const now = {};
        for (const q of set.parts) {
          const id = q.key === "main" ? st.id : (now[q.key] = ids[q.key] = ids[q.key] || old[q.key] || uid("b"));
          keep.add(id);
          const M = arr(M4(st.m).multiply(new THREE.Matrix4().makeTranslation(q.dx || 0, q.dy || 0, q.z || 0)));
          let b = findBody(doc, id);
          if (!b) { b = { id, name: q.key === "main" ? nextName(doc, { bin: "Bin", carousel: "Carousel", round: "Round drawers", swivel: "Swivel trays", honey: "Honeycomb" }[st.o.style || "bin"] || "Case") : "", seq: nextSeq(doc), color: q.color, hole: false, hidden: false, m: M, node: q.node }; doc.bodies.push(b); }
          b.node = q.node; b.m = M;
          if (q.key !== "main") { b.binPart = st.id; delete b.bin; }
        }
        const main = findBody(doc, st.id);
        for (const q of set.parts) if (q.key !== "main") { const b = findBody(doc, ids[q.key]); if (b) b.name = main.name + " · " + q.name.charAt(0).toLowerCase() + q.name.slice(1); }
        // parts no longer in the set (fewer units, no lid, another style)
        const gone = new Set(Object.values(old).filter((id) => !keep.has(id)));
        if (gone.size) doc.bodies = doc.bodies.filter((b) => !gone.has(b.id));
        main.bin = { ...st.o, ids: now };
      },
      ok() {
        try { const keep = { ...st.o }; delete keep.ids; localStorage.setItem("jumpstart3d.bins", JSON.stringify(keep)); } catch (e) {}
        commit(def, existing ? "Edit bin" : "Bin");
      },
      onDelete: existing ? () => { closeCmd(false); deleteBodies([existing.id, ...Object.values(ids)].filter((id) => findBody(store.doc, id))); } : null,
      hint: () => existing ? "Change the bin, then OK." : "Pick a style and size. Click the ground or a flat face to place it, then OK.",
      build(body) {
        const o = st.o, cab = o.style && o.style !== "bin";
        // typing a number rebuilds every part of the set: wait until the typing pauses
        const upd = (rerender, now) => {
          clearTimeout(st.typing);
          const go = () => {
            schedulePreview(def);
            if (!rerender) { infoNow(); return; }
            // redrawing the panel: keep the keyboard on the same box or button (Tab already moved on)
            const F = () => [...panel.querySelectorAll("input, button, select")].filter((x) => !x.disabled && x.offsetParent);
            const was = F().indexOf(document.activeElement);
            def.render();
            if (was >= 0) { const n = F()[was]; if (n) n.focus({ preventScroll: true }); }
          };
          if (rerender) st.typing = setTimeout(go, 0); else if (now) go(); else st.typing = setTimeout(go, 350);
        };
        const infoNow = () => { const n = panel.querySelector("#bn-info"); if (n) n.textContent = infoText(); };
        const num = (label, k, opt = {}) => el("label", {}, label, app.numField({ value: o[k], id: "bn-" + k, len: opt.len !== false, min: opt.min ?? 0.4, max: opt.max ?? 1e5, step: opt.step ?? 1, live: !opt.rerender, onCommit: (v) => { o[k] = opt.int ? Math.max(1, Math.round(v)) : v; upd(opt.rerender); } }));
        const r3 = (...kids) => el("div", { class: "row3" }, ...kids);
        const check = (id, k, label, title, rr = true) => el("label", { class: "check", title }, el("input", { type: "checkbox", id, checked: !!o[k], onchange: (e) => { o[k] = e.target.checked; upd(rr); } }), label);
        // eight styles: a grid of buttons, two rows of four, so none are cut off in a narrow panel
        const styleSeg = seg(BIN_STYLES, o.style || "bin", (v) => { o.style = v; upd(true); }, "bn-style");
        styleSeg.classList.add("seg-grid");
        body.append(el("div", { class: "subhead" }, "Style"), styleSeg);
        body.append(el("div", { class: "hint", style: { padding: "0 0 4px" } }, { bin: "An open bin with compartments.", drawer: "A case with a drawer that slides out.", tilt: "A case with a bin that tips forward on two pins: tilt it out to reach in.", door: "A case with a door that swings open on pins top and bottom.", carousel: "Wedge bins round a centre cup on a round tray, which can spin on a base.", round: "Round cases that stack, each with a curved drawer and a finger hole.", swivel: "A tower of trays that swing out on a rod at the front corner.", honey: "Hexagon cells: honeycomb shelves or upright cups, in one piece or separate." }[o.style || "bin"]));
        // the round, swivel and hexagon organisers have their own few settings
        if (BIN_MORE.has(o.style)) {
          const show = () => { if (["round", "swivel"].includes(o.style) || (o.style === "honey" && o.hJoin === "separate")) body.append(row("Show", seg([["stack", "Assembled"], ["print", "Laid out to print"]], o.layout === "print" ? "print" : "stack", (v) => { o.layout = v; upd(true); }, "bn-layout"))); };
          if (o.style === "carousel") {
            body.append(el("div", { class: "subhead" }, "Carousel"), r3(num("Diameter", "cDia", { min: 80 }), num("Bin height", "cH", { min: 20 }), num("Bins", "cN", { len: false, int: true, min: 3, max: 16, rerender: true })));
            body.append(r3(num("Centre cup", "cHub", { min: 20 }), num("Wall", "wall"), num("Floor", "floor")));
            body.append(check("bn-cspin", "cSpin", "Spinning base", "A low base with a pin the tray turns on"), check("bn-chand", "cHandles", "Hand holes", "A slot near the top of each bin's outer wall to lift it out"));
          } else if (o.style === "round") {
            body.append(el("div", { class: "subhead" }, "Round drawers"), r3(num("Diameter", "rDia", { min: 80 }), num("Height of each", "rH", { min: 40 }), num("Stacked", "units", { len: false, int: true, min: 1, max: 8, rerender: true })));
            body.append(r3(num("Case wall", "caseT", { min: 1.6 }), num("Drawer wall", "wall"), num("Floor", "floor")));
            body.append(r3(num("Opening (of the width)", "rOpen", { len: false, min: 0.4, max: 0.92, step: 0.02 }), num("Fit clearance", "clear", { min: 0.1, step: 0.05 })));
            show();
          } else if (o.style === "swivel") {
            body.append(el("div", { class: "subhead" }, "Swivel trays"), r3(num("Width", "sW", { min: 60 }), num("Tray height", "sTrayH", { min: 8 }), num("Trays", "sN", { len: false, int: true, min: 1, max: 16, rerender: true })));
            body.append(r3(num("Rod", "sRod", { min: 3, step: 0.5 }), num("Tray wall", "wall"), num("Case wall", "caseT", { min: 1.6 })));
            body.append(r3(num("Floor", "floor"), num("Fit clearance", "clear", { min: 0.1, step: 0.05 })));
            show();
          } else {
            body.append(el("div", { class: "subhead" }, "Honeycomb"), r3(num("Across the flats", "hF", { min: 15 }), num("Depth", "hDepth", { min: 10 }), num("Wall", "wall")));
            body.append(r3(num("Columns", "hCols", { len: false, int: true, min: 1, max: 12, rerender: true }), num("Rows", "hRows", { len: false, int: true, min: 1, max: 12, rerender: true }), num(o.hOrient === "desk" ? "Floor" : "Back", "floor")));
            body.append(row("Cells", seg([["shelf", "Shelves (on their side)"], ["desk", "Cups (standing up)"]], o.hOrient === "desk" ? "desk" : "shelf", (v) => { o.hOrient = v; upd(true); }, "bn-horient")));
            body.append(row("Made as", seg([["one", "One piece"], ["separate", "Separate cells"]], o.hJoin === "separate" ? "separate" : "one", (v) => { o.hJoin = v; upd(true); }, "bn-hjoin")));
            if (o.hJoin === "separate") {
              body.append(row("Join", seg([["slides", "Dovetail slides"], ["pegs", "Pegs"], ["holes", "Screw holes"]], o.hLock || "slides", (v) => { o.hLock = v; upd(true); }, "bn-hlock")));
              body.append(el("div", { class: "hint", style: { padding: "0 0 4px" } }, { slides: "Rails on three sides of each cell slide into grooves on the next cell, from the open end, and stop flush. Change the fit with Fit clearance.", pegs: "Two pegs on three sides of each cell press into holes in the next cell.", holes: "A hole in each side, to join cells with M3 screws and nuts, pins or cable ties." }[o.hLock || "slides"]));
              if ((o.hLock || "slides") !== "holes") body.append(r3(num("Fit clearance", "clear", { min: 0.05, step: 0.05 })));
            }
            show();
          }
          body.append(el("div", { class: "hint", id: "bn-info", style: { padding: "2px 0" } }, infoText()));
          return;
        }
        body.append(el("div", { class: "subhead" }, cab ? "Outside size of one case" : "Outside size"), r3(num("Width", "w", { min: 10 }), num("Depth", "d", { min: 10 }), num("Height", "h", { min: 5 })));
        // stacking: how many, one on another, and how they lock together
        body.append(el("div", { class: "subhead" }, "Stacking and side by side"), r3(num(cab ? "Cases high" : "Bins high", "units", { len: false, int: true, min: 1, max: 8, rerender: true }), num(cab ? "Cases across" : "Bins across", "across", { len: false, int: true, min: 1, max: 8, rerender: true })));
        if ((o.across || 1) > 1) {
          body.append(row("Side join", seg(BIN_LOCKS, o.sideLock || "none", (v) => { o.sideLock = v; upd(true); }, "bn-sidelock")));
          body.append(el("div", { class: "hint", style: { padding: "0 0 4px" } }, { dovetail: "Rails on the right side slide into grooves in the left side of the next one, from the front, and stop flush. Build a grid of any size.", pegs: "Pegs on the right side fit holes in the left side of the next one.", none: "Flat sides: they just stand next to each other." }[o.sideLock || "none"]));
        }
        if (cab) {
          body.append(row(o.units > 1 ? "Stack join" : "Interlock", seg(BIN_LOCKS, o.lock || "none", (v) => { o.lock = v; upd(true); }, "bn-lock")));
          body.append(el("div", { class: "hint", style: { padding: "0 0 4px" } }, { dovetail: "Dovetail rails on top slide into grooves under the case above, from the front, and stop flush.", pegs: "Four pegs on top fit holes under the case above.", none: "Flat tops and bottoms: the cases just sit on each other." }[o.lock || "none"]));
        } else body.append(check("bn-stack", "stack", "Interlocking rim and foot", "A foot under each bin fits into the rim of the bin below, so a stack can't slide apart"));
        // how tightly the dovetails fit, wherever the set uses them
        if ((cab && o.lock === "dovetail") || ((o.across || 1) > 1 && o.sideLock === "dovetail")) {
          const nGap = Math.max(0, o.clear ?? 0.25), fit = DV_FITS[o.dvFit] != null ? o.dvFit : "normal";
          body.append(row("Dovetail fit", seg([["snug", "Snug"], ["normal", "Normal"], ["loose", "Loose"]], fit, (v) => { o.dvFit = v; upd(true); }, "bn-dvfit")));
          body.append(el("div", { class: "hint", style: { padding: "0 0 4px" } }, { snug: `${DV_FITS.snug} mm gap around each rail: a firm push to slide together, and very little wobble. For a well-tuned printer.`, normal: `${+nGap.toFixed(2)} mm gap around each rail: slides together easily on most printers.`, loose: `${DV_FITS.loose} mm gap around each rail: slides freely. Use it if Normal is tight on your printer, or for PETG.` }[fit]));
        }
        // lock clips: only where boxes join with dovetails (they slide along the rails)
        const dvStack = cab && o.units > 1 && o.lock === "dovetail", dvSide = (o.across || 1) > 1 && o.sideLock === "dovetail";
        if (dvStack || dvSide) {
          body.append(row("Lock clips", seg([["none", "None"], ["back", "On the back"]], o.clips === "back" ? "back" : "none", (v) => { o.clips = v; upd(true); }, "bn-clips")));
          body.append(el("div", { class: "hint", style: { padding: "0 0 4px" } }, o.clips === "back" ? "Small plates press onto the backs across each dovetail join, a peg in each box, so the boxes can't slide apart when you grab one. Pull a clip off to slide the boxes apart." : "Dovetailed boxes can slide apart along their rails. Add lock clips to hold them."));
        }
        // plates that join two boxes using their open dovetails: grooved plates slide over the open
        // rails (on top of cases side by side, up the right side of a stack); railed plates slide
        // into the open grooves (under cases side by side, up the left side of a stack)
        const plTop = cab && (o.across || 1) > 1 && o.lock === "dovetail", plSide = o.units > 1 && dvSide;
        if (plTop || plSide) {
          const both = plTop && plSide ? [["both", "Both"]] : [];
          const opts = [["none", "None"], ...(plTop ? [["top", "On top"]] : []), ...(plSide ? [["side", "Right side"]] : []), ...both];
          const gopts = [["none", "None"], ...(plTop ? [["under", "Underneath"]] : []), ...(plSide ? [["side", "Left side"]] : []), ...both];
          const cur = opts.some(([k]) => k === o.plates) ? o.plates : "none", gcur = gopts.some(([k]) => k === o.gplates) ? o.gplates : "none";
          // one click for every side at once: over the rails on top and the right, in the grooves
          // underneath and on the left (each where this set has open dovetails)
          const allOn = (!plTop || (/top|both/.test(cur) && /under|both/.test(gcur))) && (!plSide || (/side|both/.test(cur) && /side|both/.test(gcur)));
          const allBtn = el("button", { class: "btn" + (allOn ? " primary" : ""), id: "bn-plates-all", "aria-pressed": allOn, onclick: () => { if (allOn) { o.plates = "none"; o.gplates = "none"; } else { o.plates = plTop && plSide ? "both" : plTop ? "top" : "side"; o.gplates = plTop && plSide ? "both" : plTop ? "under" : "side"; } upd(true); } },
            allOn ? "Remove all plates" : plTop && plSide ? "Plates on all four sides" : plTop ? "Plates on top and underneath" : "Plates on both sides");
          body.append(row("Plates", allBtn));
          body.append(row("Plates over rails", seg(opts, cur, (v) => { o.plates = v; upd(true); }, "bn-plates")));
          body.append(row("Plates in grooves", seg(gopts, gcur, (v) => { o.gplates = v; upd(true); }, "bn-gplates")));
          if (cur !== "none" || gcur !== "none") {
            body.append(row("Plate fit", seg([["tight", "Tight"], ["snug", "Snug"], ["loose", "Loose"]], o.plateFit || "snug", (v) => { o.plateFit = v; upd(true); }, "bn-platefit")));
            body.append(el("div", { class: "hint", style: { padding: "0 0 4px" } }, { tight: "0.08 mm gap around each dovetail: for a well-tuned printer; may need sanding.", snug: "0.12 mm gap around each dovetail: slides in with a firm push and stays put.", loose: "0.2 mm gap around each dovetail: slides easily; use if Snug is too tight on your printer." }[o.plateFit || "snug"]));
          }
          body.append(el("div", { class: "hint", style: { padding: "0 0 4px" } }, "Plates join two boxes using their open dovetails. Plates over rails have grooves and slide over the open rails (on top, or the right side). Plates in grooves have rails and slide into the open grooves (underneath, or the left side). Both slide on from the back and stop at the front, and print flat."));
        }
        if (!cab && o.stack) body.append(row("Foot height", app.numField({ value: o.foot, id: "bn-foot", len: true, min: 1, step: 0.5, live: true, onCommit: (v) => { o.foot = v; upd(); } }), "bn-foot"));
        if (o.units > 1 || (o.across || 1) > 1 || cab) body.append(row("Show", seg([["stack", "Assembled"], ["print", "Laid out to print"]], o.layout === "print" ? "print" : "stack", (v) => { o.layout = v === "print" ? "print" : ""; upd(true); }, "bn-layout")));
        if (cab) {
          body.append(el("div", { class: "subhead" }, "Case"), r3(num("Case wall", "caseT", { min: 1.2 }), num("Corner radius", "radius", { min: 0 }), num("Fit clearance", "clear", { min: 0, step: 0.05 })));
          if (o.style === "drawer") {
            body.append(el("div", { class: "subhead" }, "Drawer"), r3(num("Columns", "cols", { len: false, int: true, min: 1, max: 12 }), num("Rows", "rows", { len: false, int: true, min: 1, max: 12 }), num("Divider", "divider")));
            body.append(r3(num("Wall", "wall"), num("Floor", "floor")));
            body.append(row("Pull", seg([["bar", "Bar"], ["knob", "Knob"], ["notch", "Finger notch"]], o.pull || "bar", (v) => { o.pull = v; upd(true); }, "bn-pull")));
          } else if (o.style === "tilt") {
            body.append(el("div", { class: "subhead" }, "Tilt-out bin"), r3(num("Sections", "cols", { len: false, int: true, min: 1, max: 8 }), num("Divider", "divider"), num("Wall", "wall")));
          } else {
            body.append(row("Hinge side", seg([["left", "Left"], ["right", "Right"]], o.hinge || "left", (v) => { o.hinge = v; upd(true); }, "bn-hinge")));
            body.append(row("Pull", seg([["knob", "Knob"], ["hole", "Finger hole"], ["bar", "Bar"]], o.doorPull || "knob", (v) => { o.doorPull = v; upd(true); }, "bn-doorpull")));
            body.append(row("Door catch", seg([["none", "None"], ["light", "Light"], ["firm", "Firm"]], o.doorCatch || "light", (v) => { o.doorCatch = v; upd(true); }, "bn-catch")));
            body.append(el("div", { class: "hint", style: { padding: "0 0 4px" } }, "Small bumps by the door's free edge hold it shut: it clicks closed and needs a little pull to open. Firm holds tighter; if your printer runs tight, try Light."));
            body.append(el("div", { class: "hint", style: { padding: "0 0 4px" } }, "The back of the door is flat, so it prints lying on it (Laid out to print turns it that way)."));
          }
        } else {
          body.append(el("div", { class: "subhead" }, "Compartments"), r3(num("Columns", "cols", { len: false, int: true, min: 1, max: 20 }), num("Rows", "rows", { len: false, int: true, min: 1, max: 20 }), num("Divider", "divider")));
          body.append(row("Shape", seg([["square", "Square"], ["round", "Round"], ["hex", "Hex"]], o.shape, (v) => { o.shape = v; upd(true); }, "bn-shape")));
          body.append(el("div", { class: "subhead" }, "Walls"), r3(num("Wall", "wall"), num("Floor", "floor"), num("Corner radius", "radius", { min: 0 })));
          if (o.shape === "square") {
            body.append(row("Inside corners", app.numField({ value: o.inner, id: "bn-inner", len: true, min: 0, step: 0.5, live: true, onCommit: (v) => { o.inner = v; upd(); } }), "bn-inner"));
            body.append(check("bn-scoop", "scoop", "Finger scoops", "A curved ramp at the front of each compartment, so small parts slide out under a finger"));
            if (o.scoop) body.append(row("Scoop radius", app.numField({ value: o.scoopR, id: "bn-scoopR", len: true, min: 1, step: 1, live: true, onCommit: (v) => { o.scoopR = v; upd(); } }), "bn-scoopR"));
            body.append(check("bn-label", "label", "Label lips", "A sloped shelf at the back of each compartment for a label"));
            if (o.label) body.append(row("Lip width", app.numField({ value: o.labelW, id: "bn-labelW", len: true, min: 2, step: 1, live: true, onCommit: (v) => { o.labelW = v; upd(); } }), "bn-labelW"));
          }
          body.append(check("bn-lid", "lid", "Lid (made next to the bin)", ""));
          if (o.lid || o.stack) body.append(row("Fit clearance", app.numField({ value: o.clear, id: "bn-clear", len: true, min: 0, step: 0.05, live: true, onCommit: (v) => { o.clear = v; upd(); } }), "bn-clear"));
        }
        body.append(el("div", { class: "hint", id: "bn-info", style: { padding: "2px 0" } }, infoText()));
        void info;
      },
      start() { schedulePreview(def); },
      handler: {
        hover(e) { if (st.placed) return; const mat = placeOn(e, mine); if (mat && !sameM(mat)) { st.m = arr(mat); schedulePreview(def); } },
        down(e) { const mat = placeOn(e, mine); if (mat) { st.m = arr(mat); st.placed = true; schedulePreview(def); } return true; },
      },
    };
    // the preview is only rebuilt when the spot under the pointer really changes
    const sameM = (mat) => arr(mat).every((v, i) => Math.abs(v - st.m[i]) < 1e-6);
    openCmd(def);
  }


  // ------------------------------------------------------------------ storage from a shape
  // Any solid made into storage that keeps its outside: stacked bins that lock together (the top
  // can be a lid), or a case with drawers that pull out of the front. Works on the shape's mesh.
  function storageCmd() {
    const usable = (b) => b && !b.hole && !b.hidden && !b.locked;
    let id = app.sel.find((x) => usable(findBody(store.doc, x)));
    if (!id) { const all = store.doc.bodies.filter(usable); if (all.length === 1) id = all[0].id; }
    let pref = {}; try { pref = JSON.parse(localStorage.getItem("jumpstart3d.storage") || "{}") || {}; } catch (e) {}
    const st = { o: { ...STORE_DEFAULTS, ...pref }, busy: false, msg: "" };
    const def = {
      title: "Storage from Shape",
      keepSelection: true,
      okLabel: "Make it",
      canOk: () => !!id && !st.busy,
      build(body) {
        const o = st.o, b = id && findBody(store.doc, id);
        body.append(el("div", { class: "hint", style: { padding: "0 0 6px" } }, b ? `Shape: ${b.name}. It keeps its outside; the inside becomes storage.` : "Select the shape to turn into storage (click it in the view or the Browser), then open this again."));
        body.append(row("Make", seg([["bins", "Stacked bins"], ["drawers", "Drawers in a case"]], o.style === "drawers" ? "drawers" : "bins", (v) => { o.style = v; def.render(); }, "st-style")));
        body.append(el("div", { class: "hint", style: { padding: "0 0 4px" } }, o.style === "drawers" ? "The shape becomes a case with shelves, and each level a drawer that pulls straight out of the front (-Y): the drawer's front is the shape's own front, with a finger hole. Turn the shape so a broad side faces the front first." : "The shape is cut into bins that stack: a lip on top of each bin fits into the one above, so the stack locks together. The top piece can be a lid."));
        const num = (label, k, opt = {}) => el("label", {}, label, app.numField({ value: o[k], id: "st-" + k, len: opt.len !== false, min: opt.min ?? 0.4, max: opt.max ?? 1e4, step: opt.step ?? 0.5, onCommit: (v) => { o[k] = opt.int ? Math.max(1, Math.round(v)) : v; } }));
        body.append(el("div", { class: "row3" }, num(o.style === "drawers" ? "Drawers" : "Bins", "n", { len: false, int: true, min: 1, max: 10, step: 1 }), num("Wall", "wall", { min: 0.8 }), num("Floor", "floor", { min: 0.8 })));
        body.append(el("div", { class: "row3" }, num("Fit clearance", "clear", { min: 0.05, step: 0.05 }), ...(o.style === "drawers" ? [] : [num("Lip height", "lip", { min: 2 })])));
        if (o.style === "drawers") body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "st-finger", checked: o.finger !== false, onchange: (e) => { o.finger = e.target.checked; } }), "Finger hole in each drawer"));
        else body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "st-lid", checked: o.lid !== false, onchange: (e) => { o.lid = e.target.checked; } }), "The top piece is a lid (otherwise the top bin is open)"));
        body.append(row("Detail", seg([["1", "Normal"], ["2.5", "Fine (slower)"]], String(o.detail || 1) === "2.5" ? "2.5" : "1", (v) => { o.detail = +v; }, "st-detail")));
        if (st.msg) body.append(el("div", { class: "hint", id: "st-msg", style: { padding: "4px 0" } }, st.msg));
      },
      async ok() {
        const b = id && findBody(store.doc, id), v = b && scene.views.get(b.id);
        if (!v || !v.data) { app.toast("That shape isn't ready yet: try again in a moment."); return; }
        try { localStorage.setItem("jumpstart3d.storage", JSON.stringify(st.o)); } catch (e) {}
        st.busy = true; def.refreshOk && def.refreshOk();
        const say = (m) => { st.msg = m; const n = panel.querySelector("#st-msg"); if (n) n.textContent = m; else def.render(); };
        try {
          v.group.updateMatrixWorld(true);
          const P = v.data.vertices, T = v.data.triangles, M = v.mesh ? v.mesh.matrixWorld : v.group.matrixWorld, V = new Float32Array(P.length), p = new THREE.Vector3();
          for (let i = 0; i < P.length; i += 3) { p.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M); V[i] = p.x; V[i + 1] = p.y; V[i + 2] = p.z; }
          const r = await storageFromMesh(V, new Uint32Array(T), st.o, say);
          closeCmd(false);
          const ids = addMeshBodies(app, r.parts.map((q) => ({ name: q.name, color: q.color, V: q.V, I: q.I })), "Storage from shape");
          store.update((doc) => { const o = findBody(doc, b.id); if (o) o.hidden = true; ids.forEach((nid, i) => { const nb = findBody(doc, nid); if (nb) nb.name = b.name + " · " + r.parts[i].name.toLowerCase(); }); }, "Hide the original shape");
          app.toast(r.info + " The original shape is hidden (show it again in the Browser).");
          void ids;
        } catch (e) {
          console.error(e); st.busy = false; st.msg = "Couldn't make it: " + e.message; def.render(); def.refreshOk && def.refreshOk();
        }
      },
    };
    openCmd(def);
  }

  // Expandable: the selected body made into sliding rings, in its own window with a simulation
  function expandableCmd() {
    const usable = (b) => b && !b.hole && !b.hidden && !b.locked;
    let id = app.sel.find((x) => usable(findBody(store.doc, x)));
    if (!id) { const all = store.doc.bodies.filter(usable); if (all.length === 1) id = all[0].id; }
    const b = id && findBody(store.doc, id), v = b && scene.views.get(b.id);
    if (!b) { app.toast("Select the shape to make expandable (click it in the view or the Browser), then choose Expandable."); return; }
    if (!v || !v.data) { app.toast("That shape isn't ready yet: try again in a moment."); return; }
    if (app.command) closeCmd(false);
    v.group.updateMatrixWorld(true);
    const P = v.data.vertices, T = v.data.triangles, M = v.mesh ? v.mesh.matrixWorld : v.group.matrixWorld, V = new Float32Array(P.length), p = new THREE.Vector3();
    for (let i = 0; i < P.length; i += 3) { p.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M); V[i] = p.x; V[i + 1] = p.y; V[i + 2] = p.z; }
    const I = new Uint32Array(T);
    if (M.determinant() < 0) for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
    return openExpandable(app, { V, I, name: b.name, bodyId: b.id });
  }
  app.openExpandable = expandableCmd;

  // ------------------------------------------------------------------ quick hinges
  // Ready-made hinges: print-in-place, pin or living. Point at a face (or the ground) to lay it
  // there with its pin along the face, spin it, click to place, then OK. Leaf A and leaf B are
  // separate bodies (they print together); Join a leaf to your part to fix it on.
  function hingeCmd(editingId = null) {
    const existing = editingId ? findBody(store.doc, editingId) : null;
    let pref = {}; try { pref = JSON.parse(localStorage.getItem("jumpstart3d.hinge") || "{}") || {}; } catch (e) {}
    const h0 = existing ? existing.hinge : null;
    const st = { o: { ...HINGE_DEFAULTS, ...(h0 || pref) }, id: existing ? existing.id : uid("b"), bId: h0 && h0.bId || uid("b"), pinId: h0 && h0.pinId || uid("b"),
      m: existing ? existing.m.slice() : null, placed: !!existing, spin: 0, base: null };
    if (!st.m) { const t = vp.view.target; st.m = arr(new THREE.Matrix4().makeTranslation(round(t.x, 1), round(t.y, 1), 0)); }
    st.base = st.m.slice();
    const ids = () => [st.id, st.bId, st.pinId];
    const placeAt = (mat) => { st.base = arr(mat); st.m = arr(M4(st.base).multiply(new THREE.Matrix4().makeRotationZ((st.spin * Math.PI) / 180))); };
    let info = null;
    const def = {
      title: existing ? "Edit hinge" : "Quick Hinge",
      apply(doc) {
        const parts = hingeParts(st.o);
        info = parts.info;
        const kindName = (HINGE_TYPES.find((x) => x[0] === st.o.type) || HINGE_TYPES[0])[1];
        let a = findBody(doc, st.id);
        if (!a) { a = { id: st.id, name: nextName(doc, st.o.type === "living" ? "Living hinge" : "Hinge"), seq: nextSeq(doc), color: "#d08a2e", hole: false, hidden: false, m: st.m.slice(), node: parts.a }; doc.bodies.push(a); }
        a.node = parts.a; a.m = st.m.slice();
        a.hinge = { ...st.o, bId: parts.b ? st.bId : null, pinId: parts.pin ? st.pinId : null, kind: kindName };
        const side = (id, node, name, color, off) => {
          let b = findBody(doc, id);
          if (node) {
            const M = arr(off ? M4(st.m).multiply(off) : M4(st.m));
            if (!b) { b = { id, name: a.name + " " + name, seq: nextSeq(doc), color, hole: false, hidden: false, m: M, node }; doc.bodies.push(b); }
            else { b.node = node; b.m = M; }
            b.hingePart = st.id;
          } else if (b) doc.bodies = doc.bodies.filter((x) => x.id !== id);
        };
        if (parts.b && !/leaf A$/.test(a.name)) a.name = a.name.replace(/( leaf A)?$/, " leaf A");
        side(st.bId, parts.b, "leaf B".replace(/^/, ""), "#5b8fd6", null);
        const bb = findBody(doc, st.bId); if (bb) bb.name = a.name.replace(/ leaf A$/, "") + " leaf B";
        side(st.pinId, parts.pin, "pin", "#8a8f98", new THREE.Matrix4().makeTranslation(0, -(st.o.leafW + 8), 0));
        const pb = findBody(doc, st.pinId); if (pb) pb.name = a.name.replace(/ leaf A$/, "") + " pin";
      },
      ok() {
        try { const { bId, pinId, kind, ...keep } = st.o; void bId; void pinId; void kind; localStorage.setItem("jumpstart3d.hinge", JSON.stringify(keep)); } catch (e) {}
        commit(def, existing ? "Edit hinge" : "Hinge");
      },
      onDelete: existing ? () => { closeCmd(false); deleteBodies(ids().filter((id) => findBody(store.doc, id))); } : null,
      hint: () => existing ? "Change the hinge, then OK." : "Point at a face to lay the hinge on it (pin along the face), or on the ground. Spin it, click to place, then OK. Use Join to fix a leaf to your part.",
      build(body) {
        const o = st.o;
        const num = (label, k, opt = {}) => el("label", {}, label, app.numField({ value: o[k], id: "hg-" + k, len: opt.len !== false, min: opt.min ?? 0.1, max: opt.max ?? 1e5, step: opt.step ?? 0.5, live: true, onCommit: (v) => { o[k] = opt.int ? Math.max(1, Math.round(v)) : v; schedulePreview(def); def.render(); } }));
        const r3 = (...kids) => el("div", { class: "row3" }, ...kids);
        body.append(row("Type", seg(HINGE_TYPES.map(([v, l, t]) => [v, l, t]), o.type, (v) => { o.type = v; if (v === "pip" && o.clear < 0.3) o.clear = 0.4; if (v === "pin" && o.clear > 0.3) o.clear = 0.25; def.render(); schedulePreview(def); }, "hg-type")));
        const presets = o.type === "living" ? [["Small", { len: 30, leafW: 12, leafT: 2, gap: 2.5, thin: 0.45 }], ["Box lid", { len: 60, leafW: 20, leafT: 2.4, gap: 3, thin: 0.5 }], ["Large", { len: 100, leafW: 30, leafT: 3, gap: 4, thin: 0.6 }]]
          : [["Small", { len: 25, dia: 6, knuckles: 5, leafW: 12, leafT: 2 }], ["Box lid", { len: 40, dia: 8, knuckles: 5, leafW: 16, leafT: 2.4 }], ["Door", { len: 80, dia: 12, knuckles: 7, leafW: 30, leafT: 3.2 }], ["Large", { len: 120, dia: 16, knuckles: 9, leafW: 40, leafT: 4 }]];
        body.append(row("Size", el("div", { class: "seg", id: "hg-presets", style: { flexWrap: "wrap" } }, ...presets.map(([l, v]) => el("button", { onclick: () => { Object.assign(o, v); def.render(); schedulePreview(def); } }, l))), "hg-presets"));
        if (o.type === "living") {
          body.append(r3(num("Length", "len", { min: 6 }), num("Leaf width", "leafW", { min: 3 }), num("Leaf thickness", "leafT", { min: 0.8 })));
          body.append(r3(num("Bend gap", "gap", { min: 1 }), num("Strip thickness", "thin", { min: 0.2, step: 0.05 })));
          body.append(el("div", { class: "hint", style: { padding: "2px 0" } }, "Print it flat in PETG, PP or TPU (PLA cracks after a few bends). Two or three wall lines across the strip are enough."));
        } else {
          body.append(r3(num("Length", "len", { min: 6 }), num("Barrel", "dia", { min: 3 }), num("Knuckles", "knuckles", { len: false, int: true, min: 3, max: 25, step: 2 })));
          body.append(r3(num("Leaf width", "leafW", { min: 3 }), num("Leaf thickness", "leafT", { min: 0.6 }), num("Clearance", "clear", { min: 0.05, step: 0.05 })));
          if (o.type === "pin") body.append(row("Pin", seg(PIN_KINDS.map(([v, l]) => [v, l]), o.pin, (v) => { o.pin = v; def.render(); schedulePreview(def); }, "hg-pin")));
          body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "hg-screws", checked: o.screws, onchange: (e) => { o.screws = e.target.checked; def.render(); schedulePreview(def); } }), "Screw holes in the leaves"));
          if (o.screws) body.append(row("Screw hole", app.numField({ value: o.screwD, id: "hg-screwD", len: true, min: 1.5, step: 0.1, live: true, onCommit: (v) => { o.screwD = v; schedulePreview(def); } }), "hg-screwD"));
        }
        body.append(row("Spin", el("div", { style: { display: "flex", gap: "6px" } }, app.numField({ value: st.spin, id: "hg-spin", min: -360, max: 360, step: 15, live: true, onCommit: (v) => { st.spin = v; placeAt(M4(st.base)); schedulePreview(def); } }),
          el("button", { class: "btn", id: "hg-spin90", title: "Turn the hinge a quarter turn on the face", onclick: () => { st.spin = (st.spin + 90) % 360; placeAt(M4(st.base)); def.render(); schedulePreview(def); } }, "↻ 90°")), "hg-spin"));
        let msg = "";
        try {
          const p = hingeParts(o).info;
          msg = o.type === "living" ? `Strip ${withUnit(p.strip, 2)} thick.` : o.type === "pip" ? `${p.knuckles} knuckles; pin ${withUnit(p.pinD, 2)} in a ${withUnit(p.hole, 2)} hole (${withUnit(o.clear, 2)} gap). Print it flat as it is, then work it back and forth to free it.` : `${p.knuckles} knuckles; pin hole ${withUnit(p.hole, 2)}` + (o.pin === "printed" ? `, printed pin ${withUnit(p.pinD, 2)} (made beside the hinge).` : ".");
        } catch (err) { msg = err.message; }
        body.append(el("div", { class: "hint", id: "hg-info", style: { padding: "2px 0" } }, msg));
        void info;
      },
      start() { schedulePreview(def); },
      handler: {
        hover(e) { if (st.placed) return; const mat = hingePlace(e); if (mat) { placeAt(mat); schedulePreview(def); } },
        down(e) { const mat = hingePlace(e); if (mat) { placeAt(mat); st.placed = true; schedulePreview(def); } return true; },
      },
    };
    function hingePlace(e) {
      const g = app.gridStep(), mine = new Set(ids());
      const hit = scene.pickFace(e, (b) => !mine.has(b.id) && !b.hole);
      if (hit) return hit.normal.z > 0.999 ? new THREE.Matrix4().makeTranslation(round(hit.point.x, g), round(hit.point.y, g), hit.point.z) : frameOnFace(hit.point, hit.normal);
      const p = vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
      return p ? new THREE.Matrix4().makeTranslation(round(p.x, g), round(p.y, g), 0) : null;
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ gears
  // A gear set (one gear, a meshing pair, a ring gear with its pinion, a rack and pinion or a
  // planetary set) laid on a face or the ground. Each gear is its own body; with "Joints for a
  // motion study" each gets a joint, linked to the gear that drives it by the tooth ratio, so
  // Motion study turns the whole train from any one of them.
  function gearCmd(editingId = null) {
    const existing = editingId ? findBody(store.doc, editingId) : null;
    let pref = {}; try { pref = JSON.parse(localStorage.getItem("jumpstart3d.gear") || "{}") || {}; } catch (e) {}
    const g0 = existing ? existing.gear : null;
    const st = { o: { ...GEAR_DEFAULTS, ...(g0 ? g0.o : pref) }, id: existing ? existing.id : uid("b"), ids: { ...(g0 ? g0.ids : {}) }, jids: { ...(g0 ? g0.jids : {}) },
      m: existing ? (g0.base || existing.m).slice() : null, placed: !!existing, spin: g0 ? g0.spin || 0 : 0, base: null };
    if (!st.m) { const t = vp.view.target; st.m = arr(new THREE.Matrix4().makeTranslation(round(t.x, 1), round(t.y, 1), 0)); }
    st.base = g0 && g0.base0 ? g0.base0.slice() : st.m.slice();
    const placeAt = (mat) => { st.base = arr(mat); st.m = arr(M4(st.base).multiply(new THREE.Matrix4().makeRotationZ((st.spin * Math.PI) / 180))); };
    const allIds = () => [st.id, ...Object.values(st.ids)];
    let info = [];
    const def = {
      title: existing ? "Edit gears" : "Gears",
      apply(doc) {
        const set = gearSet(st.o); info = set.info;
        const keep = new Set();
        set.parts.forEach((p, i) => {
          const id = i === 0 ? st.id : (st.ids[p.key] = st.ids[p.key] || uid("b"));
          keep.add(id);
          const M = arr(M4(st.m).multiply(new THREE.Matrix4().makeTranslation(p.x, p.y, 0)).multiply(new THREE.Matrix4().makeRotationZ(p.rot)));
          let b = findBody(doc, id);
          if (!b) { b = { id, name: nextName(doc, p.name), seq: nextSeq(doc), color: p.color, hole: false, hidden: false, m: M, node: p.node }; doc.bodies.push(b); }
          b.node = p.node; b.m = M;
          if (i === 0) { delete b.gearPart; b.gear = { o: { ...st.o }, ids: { ...st.ids, [p.key]: id }, jids: { ...st.jids }, base: st.m.slice(), base0: st.base.slice(), spin: st.spin }; }
          else { delete b.gear; b.gearPart = st.id; }
          p.id = id;
        });
        // parts the new set no longer has (a planet fewer, no rack…)
        const gone = Object.values(st.ids).filter((id) => !keep.has(id));
        if (gone.length) { doc.bodies = doc.bodies.filter((b) => !gone.includes(b.id)); doc.joints = (doc.joints || []).filter((j) => !gone.includes(j.body)); }
        for (const [k, id] of Object.entries(st.ids)) if (!keep.has(id)) delete st.ids[k];
        // joints for the motion study, linked by the tooth ratios
        doc.joints = (doc.joints || []).filter((j) => !keep.has(j.body));
        const main = findBody(doc, st.id);
        if (st.o.joints) {
          const jid = {};
          for (const p of set.parts) jid[p.key] = st.jids[p.key] = st.jids[p.key] || uid("j");
          const z = new THREE.Vector3(0, 0, 1).transformDirection(M4(st.m));
          for (const p of set.parts) {
            const c = new THREE.Vector3(p.x, p.y, 0).applyMatrix4(M4(st.m));
            const d = p.joint.d ? new THREE.Vector3(...p.joint.d).transformDirection(M4(st.m)) : z;
            const names = new Set(doc.joints.map((j) => j.name));
            const name = (findBody(doc, p.id) || {}).name + " joint";
            doc.joints.push({ id: jid[p.key], name: names.has(name) ? name + " 2" : name, seq: nextSeq(doc), type: p.joint.type, body: p.id, parent: null, o: [c.x, c.y, c.z].map((v) => round(v, 1e-6)), d: [d.x, d.y, d.z].map((v) => +v.toFixed(6)), limited: false, min: -180, max: 180, ...(p.joint.link ? { link: { to: jid[p.joint.link.to], ratio: +p.joint.link.ratio.toFixed(8) } } : {}) });
          }
        }
        if (main && main.gear) main.gear.jids = { ...st.jids };
      },
      ok() {
        try { localStorage.setItem("jumpstart3d.gear", JSON.stringify(st.o)); } catch (e) {}
        commit(def, existing ? "Edit gears" : "Gears");
      },
      onDelete: existing ? () => { closeCmd(false); const ids = allIds().filter((id) => findBody(store.doc, id)); store.update((doc) => { doc.joints = (doc.joints || []).filter((j) => !ids.includes(j.body)); }, "Delete gear joints"); deleteBodies(ids); } : null,
      hint: () => existing ? "Change the gears, then OK. Simulate → Motion study turns them." : "Point at a face to lay the gears on it, or on the ground. Spin them, click to place, then OK. Simulate → Motion study turns them.",
      build(body) {
        const o = st.o;
        const num = (label, k, opt = {}) => el("label", {}, label, app.numField({ value: o[k], id: "gr-" + k, len: opt.len !== false, min: opt.min ?? 0.1, max: opt.max ?? 1e5, step: opt.step ?? 1, live: true, onCommit: (v) => { o[k] = opt.int ? Math.max(opt.min || 1, Math.round(v)) : v; schedulePreview(def); def.render(); } }));
        const r3 = (...kids) => el("div", { class: "row3" }, ...kids);
        body.append(row("Type", el("div", { class: "seg", id: "gr-type", style: { flexWrap: "wrap" } }, ...GEAR_TYPES.map(([v, l, tt]) => el("button", { "aria-pressed": String(o.type === v), title: tt, onclick: () => { o.type = v; if (v === "ring" && o.z2 - o.z < 8) o.z2 = o.z * 3; def.render(); schedulePreview(def); } }, l)))));
        body.append(row("Module", el("div", { class: "seg", id: "gr-mod", style: { flexWrap: "wrap" } }, ...[0.8, 1, 1.25, 1.5, 2, 2.5, 3].map((m) => el("button", { "aria-pressed": String(Math.abs(o.m - m) < 1e-9), title: `Module ${m}: teeth ${+(Math.PI * m).toFixed(2)} mm apart`, onclick: () => { o.m = m; def.render(); schedulePreview(def); } }, String(m))))));
        if (o.type === "planet") body.append(r3(num("Sun teeth", "zs", { len: false, int: true, min: 8, max: 200 }), num("Planet teeth", "zp", { len: false, int: true, min: 8, max: 200 }), num("Planets", "nPlanets", { len: false, int: true, min: 2, max: 6 })));
        else body.append(r3(num(o.type === "ring" ? "Pinion teeth" : o.type === "pair" ? "Teeth (gear 1)" : "Teeth", "z", { len: false, int: true, min: 6, max: 300 }), o.type === "pair" || o.type === "ring" ? num(o.type === "ring" ? "Ring teeth" : "Teeth (gear 2)", "z2", { len: false, int: true, min: 6, max: 400 }) : o.type === "rack" ? num("Rack length", "rackLen", { min: 0 }) : el("span"), num("Module (mm)", "m", { min: 0.3, step: 0.25 })));
        body.append(r3(num("Thickness", "thick", { min: 0.5 }), num("Backlash", "backlash", { min: 0, step: 0.05 }), el("label", {}, "Pressure angle", (() => { const s = el("tool-choice", { class: "num", id: "gr-pa" }, ...[14.5, 20, 25].map((v) => el("option", { value: v, selected: o.pa === v }, v + "°"))); s.onchange = () => { o.pa = +s.value; schedulePreview(def); def.render(); }; return s; })())));
        body.append(row("Bore", seg(BORES, o.bore, (v) => { o.bore = v; def.render(); schedulePreview(def); }, "gr-bore")));
        if (o.bore !== "none") body.append(r3(num("Bore Ø", "boreD", { min: 0.5, step: 0.5 }), el("label", { class: "check", style: { alignSelf: "end" } }, el("input", { type: "checkbox", id: "gr-hub", checked: o.hub, onchange: (e) => { o.hub = e.target.checked; if (o.hub && !(o.hubD > o.boreD)) o.hubD = o.boreD * 2.2; def.render(); schedulePreview(def); } }), "Hub"), o.hub ? num("Hub Ø", "hubD", { min: 1 }) : el("span")));
        if (o.hub && o.bore !== "none") body.append(r3(num("Hub height", "hubH", { min: 0.5 }), el("span"), el("span")));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "gr-spokes", checked: o.spokes, onchange: (e) => { o.spokes = e.target.checked; schedulePreview(def); } }), "Lightening holes in big gears"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "gr-joints", checked: o.joints, onchange: (e) => { o.joints = e.target.checked; schedulePreview(def); } }), "Joints for a motion study (linked by the tooth ratio)"));
        body.append(row("Spin", el("div", { style: { display: "flex", gap: "6px" } }, app.numField({ value: st.spin, id: "gr-spin", min: -360, max: 360, step: 15, live: true, onCommit: (v) => { st.spin = v; placeAt(M4(st.base)); schedulePreview(def); } }),
          el("button", { class: "btn", id: "gr-spin90", onclick: () => { st.spin = (st.spin + 90) % 360; placeAt(M4(st.base)); def.render(); schedulePreview(def); } }, "↻ 90°")), "gr-spin"));
        let lines = [];
        try { lines = gearSet(o).info; } catch (err) { lines = [err.message]; }
        lines.push(`Backlash ${withUnit(o.backlash, 2)} is taken off each tooth so printed gears turn freely. Print them flat, with 3+ walls; a 0.2 mm layer suits module 1.5 and up.`);
        body.append(el("div", { class: "hint", id: "gr-info", style: { padding: "2px 0", whiteSpace: "pre-line" } }, lines.join("\n")));
        void info;
      },
      start() { schedulePreview(def); },
      handler: {
        hover(e) { if (st.placed) return; const mat = gearPlace(e); if (mat) { placeAt(mat); schedulePreview(def); } },
        down(e) { const mat = gearPlace(e); if (mat) { placeAt(mat); st.placed = true; schedulePreview(def); } return true; },
      },
    };
    function gearPlace(e) {
      const g = app.gridStep(), mine = new Set(allIds());
      const hit = scene.pickFace(e, (b) => !mine.has(b.id) && !b.hole);
      if (hit) return hit.normal.z > 0.999 ? new THREE.Matrix4().makeTranslation(round(hit.point.x, g), round(hit.point.y, g), hit.point.z) : frameOnFace(hit.point, hit.normal);
      const p = vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
      return p ? new THREE.Matrix4().makeTranslation(round(p.x, g), round(p.y, g), 0) : null;
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Jig Maker
  // Quick woodworking jigs: pick a kind, set its sizes, point to place it on the ground (or click),
  // then OK. The set's first body remembers the settings, so double-clicking it opens the maker again.
  function jigCmd(editingId = null) {
    const existing = editingId ? findBody(store.doc, editingId) : null;
    let pref = {}; try { pref = JSON.parse(localStorage.getItem("jumpstart3d.jig") || "{}") || {}; } catch (e) {}
    const j0 = existing ? existing.jig : null;
    const st = { o: { ...JIG_DEFAULTS, ...(j0 ? j0.o : pref) }, id: existing ? existing.id : uid("b"), ids: { ...(j0 ? j0.ids : {}) }, m: existing ? j0.base.slice() : null, placed: !!existing };
    if (!st.m) { const t = vp.view.target; st.m = arr(new THREE.Matrix4().makeTranslation(round(t.x, 1), round(t.y, 1), 0)); }
    const allIds = () => [st.id, ...Object.values(st.ids)];
    const def = {
      title: existing ? "Edit jig" : "Jig Maker",
      apply(doc) {
        const set = jigSet(st.o), keep = new Set();
        set.parts.forEach((p, i) => {
          const id = i === 0 ? st.id : (st.ids[p.key] = st.ids[p.key] || uid("b"));
          keep.add(id);
          const M = arr(M4(st.m).multiply(new THREE.Matrix4().makeTranslation(p.x, p.y, 0)));
          let b = findBody(doc, id);
          if (!b) { b = { id, name: nextName(doc, p.name), seq: nextSeq(doc), color: p.color, hole: false, hidden: false, m: M, node: p.node }; doc.bodies.push(b); }
          b.node = p.node; b.m = M;
          if (i === 0) { delete b.jigPart; b.jig = { o: { ...st.o }, ids: { ...st.ids }, base: st.m.slice() }; } else { delete b.jig; b.jigPart = st.id; }
        });
        const gone = Object.values(st.ids).filter((id) => !keep.has(id));
        if (gone.length) doc.bodies = doc.bodies.filter((b) => !gone.includes(b.id));
        for (const [k, id] of Object.entries(st.ids)) if (!keep.has(id)) delete st.ids[k];
        const main = findBody(doc, st.id); if (main && main.jig) main.jig.ids = { ...st.ids };
      },
      ok() { try { localStorage.setItem("jumpstart3d.jig", JSON.stringify(st.o)); } catch (e) {} commit(def, existing ? "Edit jig" : "Jig Maker"); },
      onDelete: existing ? () => { closeCmd(false); const ids = allIds().filter((id) => findBody(store.doc, id)); store.update((doc) => { doc.bodies = doc.bodies.filter((b) => !ids.includes(b.id)); }, "Delete jig"); } : null,
      hint: () => existing ? "Change the jig, then OK." : "Pick a jig and set its sizes. Point on the ground to move it, click to place, then OK.",
      build(body) {
        const o = st.o;
        const re = () => { def.render(); schedulePreview(def); };
        const num = (label, k, opt = {}) => el("label", {}, label, app.numField({ value: o[k], id: "jg-" + k, len: opt.len !== false, min: opt.min ?? 0, max: opt.max ?? 1e4, step: opt.step ?? 1, live: true, onCommit: (v) => { o[k] = opt.int ? Math.max(opt.min ?? 1, Math.round(v)) : v; if (opt.rerender) re(); else schedulePreview(def); } }));
        const txt = (label, k, ph) => el("label", {}, label, (() => { const i = el("input", { class: "num", id: "jg-" + k, value: o[k], placeholder: ph }); i.addEventListener("change", () => { o[k] = i.value; re(); }); return i; })());
        const r3 = (...kids) => el("div", { class: "row3" }, ...kids);
        const chk = (k, label) => el("label", { class: "check" }, el("input", { type: "checkbox", id: "jg-" + k, checked: !!o[k], onchange: (e) => { o[k] = e.target.checked; re(); } }), label);
        body.append(el("div", { class: "seg", id: "jg-type", style: { flexWrap: "wrap", marginBottom: "6px" } }, ...JIG_TYPES.map(([v, l, tt]) => el("button", { "aria-pressed": String(o.type === v), title: tt, onclick: () => { o.type = v; re(); } }, l))));
        body.append(el("p", { class: "hint" }, (JIG_TYPES.find((t) => t[0] === o.type) || JIG_TYPES[0])[2] + "."));
        if (o.type === "miter") {
          body.append(r3(num("Stock width", "mStock", { min: 5 }), num("Stock height", "mHeight", { min: 8 }), num("Saw kerf", "mKerf", { min: 0.3, step: 0.1 })));
          body.append(r3(num("Wall", "mWall", { min: 3 }), num("Length (0 = auto)", "mLength", { min: 0, step: 5 }), el("span")));
          body.append(row("Cuts", seg([["90", "90°"], ["45", "90° + 45°"], ["both", "90° + 45° both ways"], ["22", "+ 22.5°"]], o.mAngles, (v) => { o.mAngles = v; re(); }, "jg-mAngles")));
          body.append(chk("mEars", "Ears with screw holes, to fix it to the bench"));
        } else if (o.type === "dowel") {
          body.append(r3(num("Board thickness", "dBoard", { min: 3, step: 0.5 }), num("Dowel Ø", "dDowel", { min: 2, step: 0.5 }), num("Holes", "dCount", { len: false, int: true, min: 1, max: 8 })));
          body.append(r3(num("Spacing", "dSpacing", { min: 5 }), num("First hole from end", "dFirst", { min: 5 }), num("Guide length", "dGuide", { min: 8 })));
          body.append(r3(num("Cheek depth", "dDrop", { min: 4 }), num("Bushing Ø (0 = none)", "dBush", { min: 0, step: 0.5 }), el("span")));
          body.append(el("div", { class: "seg", id: "jg-dowsize", style: { flexWrap: "wrap" } }, ...[[6, "6 mm"], [8, "8 mm"], [10, "10 mm"], [6.35, '1/4"'], [7.94, '5/16"'], [9.53, '3/8"']].map(([v, l]) => el("button", { "aria-pressed": String(Math.abs(o.dDowel - v) < 0.01), onclick: () => { o.dDowel = v; re(); } }, l))));
          body.append(chk("dStop", "End stop, to line up on the board's end"));
        } else if (o.type === "pocket") {
          body.append(r3(num("Board thickness", "pBoard", { min: 6, step: 0.5 }), num("Drill Ø", "pDrill", { min: 3, step: 0.1 }), num("Angle °", "pAngle", { len: false, min: 8, max: 30, step: 1 })));
          body.append(r3(num("Guides", "pCount", { len: false, int: true, min: 1, max: 3 }), num("Spacing", "pSpacing", { min: 10 }), num("Bushing Ø (0 = none)", "pBush", { min: 0, step: 0.5 })));
          body.append(el("div", { class: "seg", id: "jg-pboard", style: { flexWrap: "wrap" } }, ...[[12.7, '1/2"'], [15.9, '5/8"'], [19, '3/4"'], [28.6, '1-1/8"'], [38, '1-1/2"']].map(([v, l]) => el("button", { "aria-pressed": String(Math.abs(o.pBoard - v) < 0.05), title: `Board ${l} thick`, onclick: () => { o.pBoard = v; re(); } }, l))));
        } else if (o.type === "square") {
          body.append(r3(num("Blade length", "sBlade", { min: 40, step: 10 }), num("Stock length", "sStock", { min: 40, step: 10 }), el("span")));
          body.append(row("Ruled in", seg([["mm", "mm"], ["in", "inches"]], o.sUnits, (v) => { o.sUnits = v; re(); }, "jg-sUnits")));
          body.append(chk("sNumbers", "Numbers on the ruler (they take 10 to 20 seconds to build)"));
        } else if (o.type === "angle") {
          body.append(r3(txt("Angles (°)", "aList", "45, 30, 22.5"), num("Size", "aSize", { min: 30, step: 5 }), el("span")));
        } else if (o.type === "drill") {
          body.append(r3(txt("Hole sizes (mm)", "gSizes", "3, 4, 5, 6, 8"), num("Height", "gHeight", { min: 10 }), el("span")));
          body.append(chk("gVee", "V groove underneath, for dowels and round stock"));
        } else if (o.type === "dove") {
          body.append(r3(num("Board thickness", "vBoard", { min: 6, step: 0.5 }), num("Board width", "vWidth", { min: 30, step: 5 }), num("Tails", "vTails", { len: false, int: true, min: 1, max: 12 })));
          body.append(r3(num("Pin width (narrow)", "vPin", { min: 2, step: 0.5 }), num("Slope 1 :", "vSlope", { len: false, min: 3, max: 14, step: 0.5 }), el("span")));
          body.append(row("Slope", seg([[5, "1:5"], [6, "1:6 softwood"], [7, "1:7"], [8, "1:8 hardwood"]], o.vSlope, (v) => { o.vSlope = v; re(); }, "jg-vSlope")));
        } else if (o.type === "box") {
          body.append(r3(num("Board thickness", "bBoard", { min: 4, step: 0.5 }), num("Board width", "bWidth", { min: 20, step: 5 }), num("Finger width", "bFinger", { min: 3, step: 0.5 })));
          body.append(el("div", { class: "seg", id: "jg-bfinger", style: { flexWrap: "wrap" } }, ...[[6.35, '1/4"'], [9.53, '3/8"'], [12.7, '1/2"'], [19.05, '3/4"'], [6, "6 mm"], [10, "10 mm"], [12, "12 mm"]].map(([v, l]) => el("button", { "aria-pressed": String(Math.abs(o.bFinger - v) < 0.01), onclick: () => { o.bFinger = v; re(); } }, l))));
        } else if (o.type === "mortise") {
          body.append(r3(num("Board thickness", "tBoard", { min: 8, step: 0.5 }), num("Mortise width", "tWidth", { min: 3, step: 0.5 }), num("Mortise length", "tLength", { min: 5 })));
          body.append(r3(num("Off centre", "tOffset", { min: -50, max: 50, step: 0.5 }), num("Tenon length", "tDepth", { min: 5 }), el("span")));
          body.append(el("div", { class: "seg", id: "jg-twidth", style: { flexWrap: "wrap" } }, ...[[6.35, '1/4"'], [9.53, '3/8"'], [12.7, '1/2"'], [6, "6 mm"], [8, "8 mm"], [10, "10 mm"], [12, "12 mm"]].map(([v, l]) => el("button", { "aria-pressed": String(Math.abs(o.tWidth - v) < 0.01), title: `A ${l} chisel or bit`, onclick: () => { o.tWidth = v; re(); } }, l))));
        } else if (o.type === "lap") {
          body.append(r3(num("Board thickness", "lBoard", { min: 4, step: 0.5 }), num("Board width", "lWidth", { min: 15 }), num("Mating board width", "lMate", { min: 10 })));
        }
        if (o.type !== "square" && o.type !== "angle") body.append(row("Hole fit", seg([[0.15, "Snug"], [0.25, "Normal"], [0.4, "Loose"]], o.fit, (v) => { o.fit = v; re(); }, "jg-fit")));
        body.append(chk("hex", "Honeycomb inside: lighter and stiff, using less plastic"));
        if (o.hex) body.append(r3(num("Cell size", "hCell", { min: 4, max: 30, step: 0.5 }), num("Cell walls", "hWeb", { min: 1.2, max: 6, step: 0.2 }), el("span")));
        let lines = [];
        try { lines = jigSet(o).info; } catch (err) { lines = [err.message]; }
        body.append(el("div", { class: "hint", id: "jg-info", style: { padding: "2px 0", whiteSpace: "pre-line" } }, lines.join("\n")));
      },
      start() { schedulePreview(def); },
      handler: {
        hover(e) { if (st.placed) return; const m = place(e); if (m) { st.m = m; schedulePreview(def); } },
        down(e) { const m = place(e); if (m) { st.m = m; st.placed = true; schedulePreview(def); } return true; },
      },
    };
    function place(e) {
      const g = app.gridStep(), p = vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
      return p ? arr(new THREE.Matrix4().makeTranslation(round(p.x, g), round(p.y, g), 0)) : null;
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ 3D text on a surface
  // A text body that lies on any face (or the ground) and reads upright. Point to place it, then
  // drag it anywhere: it follows the faces, snapping to face centers and the grid (Snap off or Alt
  // moves it freely). Arrow keys nudge it; Angle spins it on the face.
  function textCmd(editingId = null) {
    const existing = editingId ? findBody(store.doc, editingId) : null;
    const p0 = existing ? existing.node.p : {};
    const st = { id: existing ? existing.id : uid("b"), str: p0.text || "TEXT", font: p0.font || "sans", size: p0.size || 10, h: p0.h || 2, angle: 0, sink: 0,
      snap: app.snapOn, placed: !!existing, dragging: false, at: null };
    // where it sits: a point on a surface, the surface's normal, the text's "across" direction, and the face center
    if (existing) {
      const m = M4(existing.m), x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
      m.extractBasis(x, y, z);
      st.at = { p: new THREE.Vector3().setFromMatrixPosition(m), n: z.normalize(), x: x.normalize(), c: null, ground: false };
    } else { const t = vp.view.target; st.at = { p: new THREE.Vector3(round(t.x, 5), round(t.y, 5), 0), n: new THREE.Vector3(0, 0, 1), x: new THREE.Vector3(1, 0, 0), c: new THREE.Vector3(0, 0, 0), ground: true }; }
    const upOf = (a) => new THREE.Vector3().crossVectors(a.n, a.x).normalize();
    function matrix() {
      const a = st.at, z = a.n.clone().normalize();
      const x = a.x.clone().applyAxisAngle(z, ((st.angle || 0) * Math.PI) / 180), y = new THREE.Vector3().crossVectors(z, x);
      const m = new THREE.Matrix4().makeBasis(x, y, z);
      m.setPosition(a.p.clone().addScaledVector(z, -(st.sink || 0)));
      return arr(m);
    }
    // the surface under the pointer, as a place for the text
    function pick(e) {
      const snapOn = st.snap !== !!e.altKey;
      const f = pickBaseFace(e, (b) => b.id !== st.id && !b.hole && b.visible !== false);
      if (f && f.info) {
        const n = f.normal.clone().normalize();
        const x = Math.abs(n.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1).cross(n).normalize();
        let p = f.point.clone(), c = null;
        if (f.info.t === "PLANE" && f.info.c) {
          c = new THREE.Vector3(...f.info.c).applyMatrix4(f.base.m);
          p = snapOnFace(p, c, x, new THREE.Vector3().crossVectors(n, x).normalize(), vp.tol(10) * vp.pixelSize(f.point), snapOn).p;
        }
        return { p, n, x, c, ground: false, name: f.base.body.name };
      }
      const g = vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
      if (!g) return null;
      const c = new THREE.Vector3(0, 0, 0);
      const p = snapOnFace(g, c, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), vp.tol(10) * vp.pixelSize(g), snapOn).p;
      return { p, n: new THREE.Vector3(0, 0, 1), x: new THREE.Vector3(1, 0, 0), c, ground: true, name: "Workplane" };
    }
    const uv = () => { const a = st.at; if (!a.c) return null; const d = a.p.clone().sub(a.c); return [d.dot(a.x), d.dot(upOf(a))]; };
    function setUV(u, v) {
      const a = st.at, cur = uv(); if (!cur) return;
      a.p.addScaledVector(a.x, (u ?? cur[0]) - cur[0]).addScaledVector(upOf(a), (v ?? cur[1]) - cur[1]);
    }
    const def = {
      title: (existing ? "Edit " : "") + "3D text",
      valid: () => !!st.str.trim() && st.size > 0 && st.h > 0,
      canOk: () => def.valid() && st.placed,
      apply(doc) {
        let b = findBody(doc, st.id);
        if (!b) { b = makePrimBody(doc, "text", matrix(), { color: BODY_COLORS[doc.bodies.length % BODY_COLORS.length] }); b.id = st.id; doc.bodies.push(b); }
        b.node.p = { ...(b.node.p || {}), text: st.str, size: st.size, h: st.h, font: st.font };
        b.m = matrix();
      },
      ok() { commit(def, existing ? "Edit 3D text" : "Add 3D text"); },
      onDelete: existing ? () => { closeCmd(false); deleteBodies([existing.id]); } : null,
      hint: () => st.placed ? "Drag to move the text over any face or the workplane. Arrow keys nudge it; hold Alt (Option) while dragging to move freely." : "Point at a face or the workplane and click to place the text.",
      build(body) {
        body.append(pickbox(!st.placed, st.placed ? el("span", {}, "On ", el("b", {}, st.at.name || (st.at.ground ? "Workplane" : "a face"))) : "Click a face or the workplane", null));
        const txt = el("input", { class: "num", id: "tx-text", value: st.str, style: { fontFamily: "var(--f-ui)" }, "aria-label": "Text" });
        txt.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { st.str = txt.value; txt.blur(); schedulePreview(def); } });
        txt.addEventListener("input", () => { st.str = txt.value; clearTimeout(st.tt); st.tt = setTimeout(() => { schedulePreview(def); draw(); }, 300); });
        body.append(row("Text", txt, "tx-text"));
        body.append(row("Font", textFontSelect(st.font, (v) => { st.font = v; schedulePreview(def); draw(); }, "tx-font"), "tx-font"));
        const r3 = el("div", { class: "row3" });
        r3.append(el("label", {}, "Letter height", app.numField({ value: st.size, id: "tx-size", min: 0.5, step: 1, onCommit: (v) => { st.size = v; schedulePreview(def); draw(); } })));
        r3.append(el("label", {}, "Thickness", app.numField({ value: st.h, id: "tx-h", min: 0.1, step: 0.5, onCommit: (v) => { st.h = v; schedulePreview(def); } })));
        r3.append(el("label", {}, "Angle °", app.numField({ value: st.angle, id: "tx-angle", step: 15, onCommit: (v) => { st.angle = v; schedulePreview(def); draw(); } })));
        body.append(r3);
        const turn = (d) => { st.angle = (((st.angle + d) % 360) + 360) % 360; def.render(); schedulePreview(def); draw(); };
        body.append(row("Turn", el("div", { class: "seg", id: "tx-turn" },
          el("button", { onclick: () => turn(-90), title: "Turn 90° to the left" }, "↺ 90°"), el("button", { onclick: () => turn(-15) }, "−15°"),
          el("button", { onclick: () => turn(15) }, "+15°"), el("button", { onclick: () => turn(90), title: "Turn 90° to the right" }, "↻ 90°")), "tx-turn"));
        body.append(row("Sink into the face", app.numField({ value: st.sink, id: "tx-sink", min: 0, step: 0.1, onCommit: (v) => { st.sink = v; schedulePreview(def); } }), "tx-sink"));
        const c = uv();
        if (st.placed && c) {
          const p3 = el("div", { class: "row3" });
          p3.append(el("label", {}, "Across", app.numField({ value: +c[0].toFixed(3), id: "tx-u", step: 1, onCommit: (v) => { setUV(v, null); after(); } })));
          p3.append(el("label", {}, "Up", app.numField({ value: +c[1].toFixed(3), id: "tx-v", step: 1, onCommit: (v) => { setUV(null, v); after(); } })));
          p3.append(el("label", {}, " ", el("button", { class: "btn", id: "tx-center", title: st.at.ground ? "Put the text on the origin" : "Put the text in the middle of the face", onclick: () => { setUV(0, 0); after(); } }, "Center")));
          body.append(el("div", { class: "subhead" }, st.at.ground ? "Position (from the origin)" : "Position (from the face center)"), p3);
        }
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "tx-snap", checked: st.snap, onchange: (e) => { st.snap = e.target.checked; } }), "Snap to face centers and the grid (" + withUnit(gridMM(), 3) + ")"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "The text is its own body: use Combine (Join) to make it one part with the shape, or try Decorate › Emboss text. A small Sink (0.2 mm) helps it join cleanly."));
      },
      start() { schedulePreview(def); draw(); },
      handler: {
        hover(e) {
          if (st.placed || st.dragging) return;
          const a = pick(e); if (!a) return;
          st.at = a; schedulePreview(def); draw();
        },
        down(e) {
          const a = pick(e); if (!a) return true;
          st.at = a; st.placed = true; st.dragging = true;
          schedulePreview(def); draw();
          return true;
        },
        move(e) {
          if (!st.dragging) return;
          const a = pick(e); if (!a) return;
          st.at = a; schedulePreview(def); draw();
        },
        up() { if (!st.dragging) return; st.dragging = false; def.render(); draw(); },
      },
      arrowKey(e) {
        if (!st.placed) return false;
        const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (st.snap ? gridMM() : 1);
        const dx = e.key === "ArrowLeft" ? -k : e.key === "ArrowRight" ? k : 0, dy = e.key === "ArrowUp" ? k : e.key === "ArrowDown" ? -k : 0;
        st.at.p.addScaledVector(st.at.x, dx).addScaledVector(upOf(st.at), dy);
        after();
        return true;
      },
    };
    function after() { def.render(); schedulePreview(def); draw(); }
    function draw() {
      clearOv();
      if (!st.at) return;
      const [w, h] = textSize(st.str, st.size, st.font);
      const lift = st.at.n.clone().multiplyScalar(st.h + 0.05);
      drawTextGhost(st.at.p.clone().add(lift), st.at.x, upOf(st.at), w, h, st.angle || 0, st.placed ? 0x1f4fa8 : 0xe8a317);
      if (st.at.c && st.placed) drawDot(st.at.c, 0x7fa6e0, 7);
      vp.request();
    }
    openCmd(def);
  }
  function placeOn(e, ignore) {
    const g = app.gridStep();
    // ignore: a body id, or a test of ids (a set of bodies being placed must not land on itself)
    const skip = typeof ignore === "function" ? ignore : (id) => id === ignore;
    const hit = scene.pickFace(e, (b) => !skip(b.id) && !b.hole);
    if (hit) {
      if (hit.normal.z > 0.999) return new THREE.Matrix4().makeTranslation(round(hit.point.x, g), round(hit.point.y, g), hit.point.z);
      return frameOnFace(hit.point, hit.normal);
    }
    const p = vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
    return p ? new THREE.Matrix4().makeTranslation(round(p.x, g), round(p.y, g), 0) : null;
  }

  // ------------------------------------------------------------------ edit / delete features
  function editBody(b) {
    if (b.locked) { app.toast("This body is locked. Unlock it to edit (Ctrl+L)."); return; }
    if (b.node.t === "prim" && b.node.kind === "text") textCmd(b.id);
    else if (b.node.t === "prim") primCmd(b.node.kind, b.id);
    else if (b.gear || b.gearPart) gearCmd(b.gear ? b.id : b.gearPart);
    else if (b.jig || b.jigPart) jigCmd(b.jig ? b.id : b.jigPart);
    else if (b.node.t === "extrude" || b.node.t === "revolve" || b.node.t === "sweep") extrudeCmd(b.node.t, { body: b.id });
    else if (b.node.t === "pipe") pipeCmd({ body: b.id });
    else if (b.node.t === "coil") coilCmd({ body: b.id });
    else if (b.node.t === "loft") loftCmd({ body: b.id });
    else if (b.node.t === "mirror") app.toast("A mirror follows its original body. Edit the original, or delete the mirror and make a new one.");
    else if (b.fastener) fastenerCmd(b.id);
    else if (b.bin) binCmd(b.id);
    else if (b.binPart || b.binLid) binCmd(b.binPart || b.binLid);
    else if (b.hinge || b.hingePart) hingeCmd(b.hinge ? b.id : b.hingePart);
    else if (b.node.t === "group") combineInfo(b);
    else if (b.sculpt) app.toast("This is a sculpt: switch to Chisel to keep sculpting it. Here you can move it, scale it or cut holes in it.");
    else if (b.node.t === "mesh" || b.node.t === "step") app.toast("This is an imported model: move it, scale it, cut holes in it or add features to it.");
  }
  function editPlane(id) {
    const p = (store.doc.planes || []).find((q) => q.id === id);
    if (!p) return;
    if (p.kind === "offset") offsetPlaneCmd(id);
    else if (p.kind === "angle") anglePlaneCmd(id);
    else app.toast("A midplane can't be edited. Delete it and make a new one.");
  }
  function editItem(it) {
    if (it.kind === "sketch") { app.enterSketch(it.sketch); return; }
    if (it.kind === "plane") { editPlane(it.plane); return; }
    if (it.kind === "joint") { jointCmd(it.joint); return; }
    const b = findBody(store.doc, it.body);
    if (!b) return;
    if (b.locked) { app.toast("This body is locked. Unlock it to edit (Ctrl+L)."); return; }
    if (it.tex) return textureCmd({ body: b.id, tex: it.tex });
    if (!it.mod) return editBody(b);
    const m = b.node.mods.find((x) => x.id === it.mod);
    if (m.t === "fillet" || m.t === "chamfer") edgeCmd(m.t, { body: b.id, mod: m.id });
    else if (m.t === "hole") holeCmd({ body: b.id, mod: m.id });
    else if (m.t === "shell") shellCmd({ body: b.id, mod: m.id });
    else if (m.t === "offset") offsetCmd({ body: b.id, mod: m.id });
    else if (m.t === "fillopenings") fillOpeningsCmd({ body: b.id, mod: m.id }); // jumpstart-3d: fill openings
    else if (m.t === "thread") threadCmd({ body: b.id, mod: m.id });
    else if (m.t === "scale") scaleCmd({ body: b.id, mod: m.id });
    else if (m.t === "emboss") embossCmd({ body: b.id, mod: m.id });
    else if (m.t === "facepat") facePatternCmd({ body: b.id, mod: m.id });
    else if (m.t === "route") routerCmd({ body: b.id, mod: m.id });
    else if (m.t === "halfspace" || m.t === "sketchsplit" || m.t === "splitface") app.toast(m.t !== "splitface" ? "A split can't be edited. Undo it, or delete it from the timeline and split again." : "A face split can't be edited. Delete it from the timeline and split again.");
    else if (m.t === "bool" && m.src === "keyhole") keyholeCmd({ body: b.id, mod: m.id });
    else if (m.t === "bool" && m.src === "rib") ribCmd({ body: b.id, mod: m.id });
    else if (m.t === "bool" && m.src === "combine") combineCmd({ body: b.id, mod: m.id });
    else if (m.t === "bool" && m.src === "clearance") clearanceCmd({ body: b.id, mod: m.id });
    else if (m.t === "bool" && m.tool.t === "pipe") pipeCmd({ body: b.id, mod: m.id });
    else if (m.t === "bool" && m.tool.t === "coil") coilCmd({ body: b.id, mod: m.id });
    else if (m.t === "bool" && m.tool.t === "loft") loftCmd({ body: b.id, mod: m.id });
    else if (m.t === "bool" && m.tool.t === "mirror") app.toast("This mirror join is fixed. Delete it from the timeline and mirror again to change it.");
    else if (m.t === "bool") extrudeCmd(m.tool.t, { body: b.id, mod: m.id });
  }
  function combineInfo(b) {
    const def = {
      title: b.node.op === "intersect" ? "Intersect" : "Combine",
      okLabel: "Done",
      ok() { closeCmd(false); },
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, `${b.name} combines ${b.node.children.length} bodies: ${b.node.children.map((c) => (c.hole ? "−" : "+") + " " + (c.name || "body")).join(", ")}.`));
        body.append(el("button", { class: "btn", onclick: () => {
          if ((b.node.mods || []).length) { app.toast("Delete the features on this body first, then undo the combine.", "err"); return; }
          closeCmd(false); app.select(ungroupBody(b.id));
        } }, "Split back into bodies"));
      },
    };
    openCmd(def);
  }
  function deleteFeature(it) {
    closeCmd(false);
    if (it.sketch) {
      const users = store.doc.bodies.filter((b) => JSON.stringify(b.node).includes(`"sketch":"${it.sketch}"`)).length;
      store.update((doc) => { doc.sketches = doc.sketches.filter((s) => s.id !== it.sketch); }, "Delete sketch");
      if (users) app.toast(`${users} feature${users > 1 ? "s" : ""} used this sketch and can no longer rebuild. Undo to bring it back.`, "err");
      return;
    }
    if (it.plane) { store.update((doc) => { doc.planes = doc.planes.filter((x) => x.id !== it.plane); }, "Delete plane"); return; }
    if (it.joint) { store.update((doc) => { doc.joints = doc.joints.filter((x) => x.id !== it.joint); }, "Delete joint"); return; }
    if (it.tex) { store.update((doc) => { const b = findBody(doc, it.body); b.textures = (b.textures || []).filter((x) => x.id !== it.tex); }, "Remove texture"); return; }
    if (!it.mod) { deleteBodies([it.body]); return; }
    store.update((doc) => {
      const b = findBody(doc, it.body);
      const gone = b.node.mods.find((m) => m.id === it.mod);
      b.node.mods = b.node.mods.filter((m) => m.id !== it.mod);
      // deleting a Combine brings back the tool bodies it used up
      if (gone && gone.src === "combine" && gone.tools) for (const t of gone.tools) if (!findBody(doc, t.id)) doc.bodies.push(clone(t));
    }, "Delete feature");
  }

  // ------------------------------------------------------------------ ribbon
  let workspace = "design";
  // the tool search: every ribbon tool of every workspace (or the sketch tools while sketching)
  function toolIndex() {
    const out = [], save = workspace;
    try {
      if (sketcher.active) renderRibbon({ out, ws: null });
      else for (const w of ["design", "print", "simulate"]) { workspace = w; renderRibbon({ out, ws: w }); }
    } finally { workspace = save; }
    const seen = new Set();
    return out.filter((t) => { const k = t.label.toLowerCase() + "|" + t.ws; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  function runTool(t) {
    if (t.ws && t.ws !== workspace && !sketcher.active) { const tab = document.getElementById("ws-" + t.ws); if (tab) tab.click(); }
    setTimeout(() => { try { t.fn(); } catch (e) { console.error(e); app.toast("Couldn't start " + t.label + ": " + e.message); } }, 30);
  }
  let edgeTool = "fillet"; // the Edge tools button runs the last one used
  // harvest: { out, ws } lists every tool (for the tool search) instead of drawing the ribbon
  function renderRibbon(harvest = null) {
    const ribbon = harvest ? document.createElement("div") : ribbonEl;
    ribbon.innerHTML = "";
    if (!harvest && !sketcher.active) cPalette(null);
    const group = (title, cls, items) => {
      if (harvest) {
        const add = (it, parent) => {
          if (!it || !it.label) return;
          if (it.fn && !it.dropdown) harvest.out.push({ id: it.id, label: it.label, title: it.title || "", group: parent ? title + " › " + parent : title, ws: harvest.ws, fn: it.fn });
          for (const sub of it.dropdown || []) add(sub, it.label);
          for (const sub of it.menu || []) if (sub.id !== it.id) add(sub, it.label);
        };
        for (const it of items) add(it, null);
        return;
      }
      const g = el("div", { class: "rgroup " + (cls || "") });
      const r = el("div", { class: "rrow" });
      for (const it of items) {
        const b = el("button", { class: "rbtn " + (it.cls || ""), id: it.id, title: it.title || it.label, "aria-pressed": it.pressed ? "true" : null, html: ICON[it.icon] });
        b.append(el("span", {}, it.label));
        b.onclick = it.fn;
        if (it.dropdown) {
          // a plain drop-down: the button only opens its list
          b.classList.add("rdrop");
          b.setAttribute("aria-haspopup", "menu"); b.setAttribute("aria-expanded", "false");
          b.querySelector("span").append(el("i", { class: "dcaret", html: '<svg viewBox="0 0 10 10" width="9" height="9"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' }));
          b.onclick = (e) => { e.stopPropagation(); openRibbonMenu(b, it.dropdown); };
          r.append(b);
          continue;
        }
        if (!it.menu) { r.append(b); continue; }
        // split button: the main part runs the current choice, the arrow opens the list
        const caret = el("button", { class: "rcaret", id: it.id + "-more", title: "More " + it.label.toLowerCase() + " types", "aria-label": "More " + it.label.toLowerCase() + " types", "aria-haspopup": "menu", "aria-expanded": "false", html: '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
        caret.onclick = (e) => { e.stopPropagation(); openRibbonMenu(caret, it.menu); };
        r.append(el("div", { class: "rsplit" + (it.pressed ? " on" : "") }, b, caret));
      }
      g.append(r, el("div", { class: "rtitle" }, title));
      ribbon.append(g);
    };
    if (sketcher.active) {
      const tool = sketcher.tool;
      const t = (k, icon) => ({ id: "sk-" + k, label: SKETCH_TOOLS[k].label.replace("2-point rectangle", "Rectangle").replace("Center rectangle", "Ctr rect").replace("Center circle", "Circle").replace("3-point arc", "Arc").replace("Center arc", "Ctr arc"), title: SKETCH_TOOLS[k].label + (SKETCH_TOOLS[k].key ? ` (${SKETCH_TOOLS[k].key})` : ""), icon: icon || k, pressed: tool === k, fn: () => sketcher.setTool(k) });
      const rectKind = ["rect", "rect3", "rectc"].includes(tool) ? tool : sketcher.rectMode || "rect";
      const RECT_NAMES = { rect: "2-point rectangle", rect3: "3-point rectangle", rectc: "Center rectangle" };
      const rectItem = { id: "sk-rect", label: "Rectangle", title: RECT_NAMES[rectKind] + " (R)", icon: rectKind, pressed: ["rect", "rect3", "rectc"].includes(tool), fn: () => sketcher.setTool(rectKind),
        menu: ["rect", "rect3", "rectc"].map((k) => ({ id: "sk-" + k, label: RECT_NAMES[k], icon: k, on: tool === k, fn: () => sketcher.setTool(k) })) };
      group("Create", "sketch", [t("line"), rectItem, t("circle"), t("arc3"), t("arcc"), t("polygon"), t("spline"), t("freehand"), t("point"), t("text")]);
      if (tool === "freehand") {
        // the freehand tool's own choices: Smart shapes and how much to smooth the hand
        const fo = sketcher.freeOpts || (sketcher.freeOpts = { smart: true, smooth: 0.5 });
        const SM = [[0.15, "Light"], [0.5, "Medium"], [0.9, "Strong"]];
        const smLabel = (SM.find(([v]) => Math.abs(v - fo.smooth) < 0.01) || SM[1])[1];
        group("Freehand", "sketch", [
          { id: "sk-fh-smart", label: "Smart shapes", title: "SMART: a nearly straight stroke becomes a line, a round one a circle, a rough box a rectangle, a few straight strokes clean straight lines. Off: every stroke becomes a smooth curve.", icon: "constraints", pressed: fo.smart, fn: () => { fo.smart = !fo.smart; app.onSketchTool && app.onSketchTool("freehand"); } },
          { id: "sk-fh-smooth", label: "Smoothing: " + smLabel, title: "How much to even out the wobble of your hand", icon: "spline", dropdown: SM.map(([v, n]) => ({ id: "sk-fh-sm-" + n.toLowerCase(), label: n, icon: "spline", on: Math.abs(v - fo.smooth) < 0.01, fn: () => { fo.smooth = v; app.onSketchTool && app.onSketchTool("freehand"); } })) },
        ]);
      }
      group("Insert", "sketch", [
        { id: "sk-insert", label: "Insert", title: "Insert an SVG, DXF or picture into this sketch", icon: "import", dropdown: [
          { id: "sk-ins-svg", label: "SVG drawing", title: "Insert an SVG drawing into this sketch", icon: "svgfile", fn: () => app.insertFile("svg") },
          { id: "sk-ins-dxf", label: "DXF drawing", title: "Insert a DXF drawing into this sketch", icon: "dxffile", fn: () => app.insertFile("dxf") },
          { id: "sk-ins-img", label: "Image to trace", title: "Place a picture on this sketch plane to trace over", icon: "image", fn: () => app.insertFile("image") },
        ] },
      ]);
      const CICON = { coincident: "cCoincident", horizontal: "cHorizontal", vertical: "cVertical", parallel: "cParallel", perpendicular: "cPerpendicular", tangent: "cTangent", concentric: "cConcentric", equal: "cEqual", midpoint: "cMidpoint" };
      const cTool = tool.startsWith("c-") ? tool : null;
      group("Constrain", "sketch", [
        { id: "sk-constraints", label: "Constraints", title: "Keep lines horizontal, parallel, tangent, equal… (select shapes first, or pick after choosing)", icon: "constraints", pressed: !!cTool, dropdown: Object.keys(CICON).map((k) => ({ id: "sk-c-" + k, label: SKETCH_TOOLS["c-" + k].label.replace(" constraint", ""), icon: CICON[k], on: tool === "c-" + k, fn: () => sketcher.setTool("c-" + k) })) },
        { id: "sk-cpin", label: cPinState().on ? "Unpin" : "Pin", title: cPinState().on ? "Put the Constraints palette away" : "Pin every constraint button on the workspace as a palette you can drag anywhere", icon: "pin", pressed: cPinState().on, fn: () => { cPinState().on = !cPinState().on; saveCPin(); renderRibbon(); } },
      ]);
      if (!harvest) cPalette(cPinState().on ? { CICON, tool } : null);
      group("Modify", "sketch", [t("trim"), t("dim"), { id: "sk-cons", label: "Construction", title: "Toggle construction (X)", icon: "construction", fn: () => sketcher.toggleConstruction() }, t("select")]);
      group("Finish", "sketch", [{ id: "sk-extrude", label: "Extrude", title: "Extrude this sketch now, without finishing it first (E)", icon: "extrude", fn: () => app.quickExtrude() }, { id: "sk-finish", label: "Finish sketch", icon: "finish", cls: "finish", fn: () => app.exitSketch() }]);
      ribbon.append(el("div", { class: "note" }, "Profiles shade blue when closed."));
      return;
    }
    ribbon.append(el("div", { class: "wstabs", role: "tablist", "aria-label": "Workspace" },
      ...[["design", "Design"], ["print", "3D Print Sim"], ["simulate", "Simulate"]].map(([w, label]) => el("button", { role: "tab", id: "ws-" + w, "aria-selected": workspace === w ? "true" : "false", onclick: () => setWorkspace(w) }, label))));
    if (workspace === "print") {
      // like Orca Slicer: Prepare (the plate) and Preview (the sliced layers), Slice plate
      const pv = psim.st.view === "layers";
      ribbon.append(el("div", { class: "orca-tabs", role: "tablist", "aria-label": "Prepare or preview" },
        el("button", { role: "tab", id: "ps-r-prepare", "aria-selected": String(!pv), onclick: () => { psim.setView("model"); renderRibbon(); } }, "Prepare"),
        el("button", { role: "tab", id: "ps-r-preview", "aria-selected": String(pv), onclick: () => { psim.setView("layers"); renderRibbon(); } }, "Preview")));
      group("Plate", "", [
        { id: "ps-r-auto", label: "Auto orient", title: "Turn the part to need the least support", icon: "printer3d", fn: () => psim.autoOrient() },
        { id: "ps-r-lay", label: "Lay on face", title: "Click a face to put it on the plate", icon: "drop", fn: () => psim.layFace() },
        { id: "ps-r-rx", label: "Rotate X", title: "Turn 90° about X", icon: "revolve", fn: () => psim.rotate("x") },
        { id: "ps-r-ry", label: "Rotate Y", title: "Turn 90° about Y", icon: "revolve", fn: () => psim.rotate("y") },
        { id: "ps-r-arrange", label: "Arrange", title: "Pack every object neatly on the plate", icon: "pattern", fn: () => psim.arrange() },
      ]);
      group("Full color", "", [
        { id: "ps-r-litho", label: "Color lithophane", title: "Color Lithophane Studio: turn a photo into a full-colour lithophane printed with white, cyan, magenta and yellow filament, then slice it here", icon: "image", fn: () => app.colorLitho.open() },
      ]);
      group("Preview", "", [
        { id: "ps-r-model", label: "Model", title: "Part, overhangs and supports", icon: "body", pressed: psim.st.view === "model", fn: () => { psim.setView("model"); renderRibbon(); } },
        { id: "ps-r-layers", label: "Layers", title: "Layer-by-layer print preview", icon: "pattern", pressed: psim.st.view === "layers", fn: () => { psim.setView("layers"); renderRibbon(); } },
        { id: "ps-r-strength", label: "Strength", title: "Strong and weak spots of the print", icon: "stress", pressed: psim.st.view === "strength", fn: () => { psim.setView("strength"); renderRibbon(); } },
      ]);
      group("Print", "", [
        { id: "ps-r-play", label: "Play print", title: "Watch the part being printed, layer by layer", icon: "motion", fn: () => { psim.togglePlay(); renderRibbon(); } },
        { id: "ps-r-gcode", label: "Export G-code", title: "Save the sliced plate as a .gcode file for your printer (SD card, USB stick or the printer's app)", icon: "archExport", fn: () => psim.exportGcode() },
      ]);
      ribbon.append(el("span", { class: "orca-sp" }));
      ribbon.append(el("button", { class: "btn orca-slice", id: "ps-r-slice", title: "Slice the plate and show the layers (Preview)", onclick: () => { psim.setView("layers"); renderRibbon(); } }, "Slice plate"));
      return;
    }
    if (workspace === "simulate") {
      group("Joints", "", [
        { id: "sim-joint", label: "Joint", title: "Connect two parts so one can turn or slide", icon: "joint", fn: () => sim.jointCmd() },
        { id: "sim-drive", label: "Drive", title: "Move a joint by hand", icon: "drive", fn: () => sim.driveCmd() },
      ]);
      group("Motion", "", [
        { id: "sim-motion", label: "Motion study", title: "Animate joints and check for collisions", icon: "motion", fn: () => sim.motionCmd() },
      ]);
      group("Analysis", "", [
        { id: "sim-stress", label: "Stress test", title: "Load or pressure test: stress, deflection and safety factor", icon: "stress", fn: () => sim.stressCmd() },
        { id: "sim-print", label: "Print strength", title: "3D-print strength by filament and print orientation", icon: "printer3d", fn: () => sim.printCmd() },
      ]);
      group("Visualize", "", [
        { id: "sim-render", label: "Render", title: "Make a photo-style picture of your design (PNG)", icon: "render", fn: () => renderCmd() },
      ]);
      group("Convert", "", [
        { id: "sim-meshstep", label: "Mesh to STEP", title: "Mesh to STEP Helper: turn an STL or 3MF mesh into an editable STEP solid, then open it here", icon: "import", fn: () => app.meshstep.open() },
      ]);
      group("Bricks", "", [
        { id: "sim-bricks", label: "Jump Brick Builder", title: "Rebuild the selected objects (or all) out of stud-and-tube building bricks you can print, press together and take apart", icon: "bricks", fn: () => app.bricks.open() },
      ]);
      group("CAM", "", [
        { id: "sim-cam", label: "CAM Studio", title: "Plan and simulate cutting the design on a CNC router, mill or laser, then save or send the G-code (your design is not changed)", icon: "cam", fn: () => app.cam.open() },
      ]);
      group("Voxels", "", [
        { id: "sim-voxel", label: "Voxel Studio", title: "Turn the selected objects (or all) into cubes you can paint face by face, then export STL or 3MF or add them to the design (your design is not changed until you add it)", icon: "voxel", fn: () => app.voxel.open() },
      ]);
      group("Makers", "", [
        { id: "sim-bins", label: "Bin & Box Maker", title: "Make part bins and organiser boxes: open bins, drawers, tilt-out bins and door cabinets, carousels, round drawer stacks, swivel trays and honeycomb, stacked and interlocking, with compartments, scoops, label lips and lids", icon: "box", fn: () => binCmd() },
        { id: "sim-storage", label: "Storage from Shape", title: "Turn any solid into storage that keeps its outside: stacked bins that lock together (with a lid), or a case with drawers that pull out of the front", icon: "box", fn: () => storageCmd() },
        { id: "sim-fasteners", label: "Fasteners", title: "Parts library: bolts, screws, nuts, washers, heat-set inserts and pins (metric and inch)", icon: "thread", fn: () => fastenerCmd() },
        { id: "sim-hinge", label: "Quick Hinge", title: "Ready-made hinges: print-in-place, pin or living hinges, without FlexiGen", icon: "hinge", fn: () => hingeCmd() },
        { id: "sim-gears", label: "Gears", title: "Gear library: involute spur gears, pairs, ring gears, rack and pinion and planetary sets, with joints for a motion study", icon: "gear", fn: () => gearCmd() },
      ]);
      group("Flowers", "", [
        { id: "sim-flowers", label: "Flower Studio", title: "Flower Studio: build flowers, arrangements, wreaths and miniature trees (tabletop and model railway scenery), lifelike or mechanical, whole or as snap-together kits that print without supports", icon: "flower", fn: () => app.flowers.open() },
      ]);
      group("Woodcraft", "", [
        { id: "sim-chipcarve", label: "Chip Carving", title: "Chip carve a board, plate, log or a shape from your design with chip knives, a stab knife, pencil and sanding block. Pen pressure sets the depth. Add it to the design or export STL, 3MF or OBJ.", icon: "chipcarve", fn: () => app.carve.open() },
        { id: "sim-lathe", label: "Lathe", title: "Turn a body or a wood blank on a virtual lathe", icon: "lathe", fn: () => app.lathe.open() },
      ]);
      group("Cosplay", "", [
        { id: "sim-cosforge", label: "CosForge", title: "Design cosplay costumes: a mannequin from your measurements, themed parts to shape, sculpt and fit, then cut into printable pieces with joints (opens in its own window)", icon: "cosforge", fn: () => app.cosforge.open() },
        { id: "sim-layerscape", label: "Layerscape", title: "Layerscape: turn a photo into a layered, slot-together diorama: pick the pieces, check the build in 3D, then export laser-cut sheets, printable art or a 3D print kit, or add the finished diorama to your design (opens in its own window)", icon: "layerscape", fn: () => app.layerscape.open() },
        { id: "sim-helmet", label: "Helmet Maker", title: "Build a contemporary sci-fi helmet sized to the wearer's head: templates, a traced or drawn visor, details, finishes and a rendered picture, then cut it for printing (opens in its own window)", icon: "helmet", fn: () => app.cosforge.open({ mode: "helmet" }) },
      ]);
      group("Flexi", "", [
        { id: "sim-flexigen", label: "FlexiGen", title: "Turn one object into a print-in-place articulated flexi model (your design is not changed)", icon: "flexigen", fn: () => flexiGenCmd() },
      ]);
      group("Pose", "", [
        { id: "sim-reset", label: "Reset pose", title: "Put moved parts back", icon: "clearSim", fn: () => sim.resetPose() },
        { id: "sim-apply", label: "Apply pose", title: "Keep the moved positions in the design", icon: "move", fn: () => sim.applyPose() },
      ]);
      group("Signs", "", [
        { id: "sim-neon", label: "Neon Sign Builder", title: "Neon Sign Builder: glowing text, shapes and traced images as 3D-printed shells for LED strips, with a snap-in backing, cut into pieces for your printer, and a light show", icon: "neon", fn: () => app.neon.open() },
      ]);
      group("Glass", "", [
        { id: "sim-sglass", label: "Stained Glass", title: "Turn an object or a lamp shade into stained glass (a Tiffany-style lamp or a glass statue): glass and frame thickness, painting, STL / 3MF / OBJ export", icon: "stainedglass", fn: () => app.stainedGlass.open() },
      ]);
      ribbon.append(el("button", { class: "ibtn panel-toggle", style: { alignSelf: "center" }, onclick: () => browser.classList.toggle("collapsed") }, el("span", { class: "lbl" }, "Browser")));
      return;
    }
    group("Create", "", [
      { id: "ad-sketch", label: "Sketch", title: "Create sketch (S)", icon: "sketch", fn: () => createSketchCmd() },
      { id: "ad-extrude", label: "Extrude", title: "Extrude (E)", icon: "extrude", fn: () => extrudeCmd("extrude") },
      { id: "ad-sketch3d", label: "3D Sketch", title: "Draw lines in 3D on a body, a virtual sphere or cube, or in the air, with a split camera view. Works with touch, pen, mouse and trackpad.", icon: "spline", fn: () => app.sketch3d.open() },
      { id: "ad-hole", label: "Hole", title: "Hole (H): simple, counterbore, countersink or tapped, with standard screw sizes", icon: "hole", fn: () => holeCmd() },
      { id: "ad-features", label: "Advanced Create", title: "Views to 3D, revolve, sweep, pipe, coil, loft, rib, keyhole slot, mirror, hole, thread and fasteners", icon: "features", dropdown: [
        { id: "ad-views3d", label: "Views to 3D", title: "Views to 3D: up to six pictures or drawings (front, back, sides, top, bottom) become editable sketches and a 3D object, sized to the dimensions you type", icon: "views3d", fn: () => views3d.open() },
        { id: "ad-revolve", label: "Revolve", title: "Revolve (Shift+R)", icon: "revolve", fn: () => extrudeCmd("revolve") },
        { id: "ad-sweep", label: "Sweep", title: "Sweep a profile along a path", icon: "sweep", fn: () => extrudeCmd("sweep") },
        { id: "ad-pipe", label: "Pipe", title: "A round, square or triangular tube along a path", icon: "pipe", fn: () => pipeCmd() },
        { id: "ad-coil", label: "Coil", title: "Springs and spirals", icon: "coil", fn: () => coilCmd() },
        { id: "ad-loft", label: "Loft", title: "Blend between profiles on different planes (square to circle, to a point, along a centerline…)", icon: "loft", fn: () => loftCmd() },
        { id: "ad-rib", label: "Rib", title: "Reinforce: straight ribs or corner gussets standing on a flat face", icon: "rib", fn: () => ribCmd() },
        { id: "ad-keyhole", label: "Keyhole slot", title: "Cut keyhole slots in a face so the part hangs on screws", icon: "keyhole", fn: () => keyholeCmd() },
        { id: "ad-mirror", label: "Mirror", title: "Mirror bodies across a plane or flat face", icon: "mirror", fn: () => mirrorCmd() },
        { id: "ad-hole-m", label: "Hole", title: "Hole (H)", icon: "hole", fn: () => holeCmd() },
        { id: "ad-gridfinity", label: "Gridfinity part", title: "A Gridfinity bin, insert with measured pockets, or baseplate", icon: "grid", fn: () => gridfinityPart.cmd() }, // jumpstart-3d: Gridfinity part
        { id: "ad-drawer", label: "Drawer layout", title: "Plan Gridfinity bins and baseplates for a drawer from its inside size", icon: "drawerGrid", fn: () => app.mcp?.openWorkspace("drawer") }, // jumpstart-3d: drawer layout
        { id: "ad-holepattern", label: "Hole pattern", title: "Rows, staggered rows or a circle of round, square, hex or slot holes on a flat face", icon: "hole", fn: () => holePattern.cmd() }, // jumpstart-3d: hole pattern
        { id: "ad-thread", label: "Thread", title: "Modeled metric (ISO) and inch (UNC / UNF) threads on round faces", icon: "thread", fn: () => threadCmd() },
        { id: "ad-thread-offset", label: "Thread print offset…", title: "Loosen printed threads", icon: "thread", fn: () => threadOffsetCmd() },
        { id: "ad-fastener", label: "Fastener", title: "Bolts, nuts, threaded rods and tap cutters, metric and inch", icon: "thread", fn: () => fasteners.cmd() }, // jumpstart-3d: fasteners
        { id: "ad-gear", label: "Gear", title: "Spur gears, bevel gears and racks by module and tooth count", icon: "gear", fn: () => gears.cmd() }, // jumpstart-3d: gears
        { id: "ad-nameplate", label: "Name plate", title: "A tag or name plate sized to its text, with raised or cut-in letters", icon: "tag", fn: () => namePlate.cmd() }, // jumpstart-3d: name plates
        { id: "ad-knurl", label: "Knurled knob", title: "A knob or grip with straight V grooves all round and an optional round, hex or D bore", icon: "knurl", fn: () => knurl.cmd() }, // jumpstart-3d: knurl
        { id: "ad-spring", label: "Spring", title: "A compression spring of round wire, with open ends or ends cut flat", icon: "spring", fn: () => spring.cmd() }, // jumpstart-3d: spring
        { id: "ad-fasteners", label: "Fasteners", title: "Parts library: bolts, screws, nuts, washers, heat-set inserts and pins (metric and inch), with optional modeled threads", icon: "thread", fn: () => fastenerCmd() },
        { id: "ad-hinge", label: "Quick Hinge", title: "Ready-made hinges: print-in-place, pin (filament, screw or printed pin) or living hinges, laid on any face", icon: "hinge", fn: () => hingeCmd() },
        { id: "ad-gears", label: "Gears", title: "Gear library: involute spur gears, pairs, ring gears, rack and pinion and planetary sets, with joints for a motion study", icon: "gear", fn: () => gearCmd() },
      ] },
      { id: "ad-prims", label: "Primitives", title: "Box, cylinder, sphere, torus, prism and more", icon: "box", dropdown: [
        { id: "ad-box", label: "Box", icon: "box", fn: () => primCmd("box") },
        { id: "ad-cyl", label: "Cylinder", icon: "cylinder", fn: () => primCmd("cylinder") },
        { id: "ad-sphere", label: "Sphere", icon: "sphere", fn: () => primCmd("sphere") },
        { id: "ad-torus", label: "Torus", icon: "torus", fn: () => primCmd("torus") },
        { id: "ad-prism", label: "Prism", title: "Prism with 3 to 24 sides", icon: "prism", fn: () => primCmd("prism") },
        { id: "ad-cone", label: "Cone", icon: "cone", fn: () => primCmd("cone") },
        { id: "ad-pyramid", label: "Pyramid", icon: "pyramid", fn: () => primCmd("pyramid") },
        { id: "ad-tube", label: "Tube", icon: "tube", fn: () => primCmd("tube") },
        { id: "ad-capsule", label: "Capsule", icon: "capsule", fn: () => primCmd("capsule") },
        { id: "ad-text3d", label: "3D text", title: "Text that sits on any face or the workplane: drag it into place", icon: "text", fn: () => textCmd() },
      ] },
    ]);
    group("Construct", "", [
      { id: "ad-construct", label: "Planes", title: "Construction planes", icon: "planeOffset", dropdown: [
        { id: "ad-plane-off", label: "Offset plane", title: "Plane parallel to a plane or face", icon: "planeOffset", fn: () => offsetPlaneCmd() },
        { id: "ad-plane-ang", label: "Plane at angle", title: "Plane through an axis or edge, at an angle", icon: "planeAngle", fn: () => anglePlaneCmd() },
        { id: "ad-plane-mid", label: "Midplane", title: "Plane halfway between two faces", icon: "planeMid", fn: () => midPlaneCmd() },
      ] },
    ]);
    group("Insert", "", [
      { id: "ad-insert", label: "Insert", title: "Insert an SVG, DXF or picture", icon: "import", dropdown: [
        { id: "ad-ins-svg", label: "SVG drawing", title: "Insert an SVG drawing as a sketch", icon: "svgfile", fn: () => insertFile("svg") },
        { id: "ad-ins-dxf", label: "DXF drawing", title: "Insert a DXF drawing as a sketch", icon: "dxffile", fn: () => insertFile("dxf") },
        { id: "ad-ins-img", label: "Image on a face", title: "Put a picture on a flat face of a body (or the workplane) to trace over by hand or with Auto trace", icon: "image", fn: () => insertFile("image") },
        { id: "ad-ins-fast", label: "Fasteners (bolts, nuts…)", title: "Parts library: bolts, screws, nuts, washers, heat-set inserts and pins in metric and inch sizes, with optional modeled threads", icon: "thread", fn: () => fastenerCmd() },
        { id: "ad-ins-hinge", label: "Quick Hinge", title: "Ready-made hinges: print-in-place, pin or living", icon: "hinge", fn: () => hingeCmd() },
        { id: "ad-ins-gear", label: "Gears", title: "Gear library: accurate involute spur gears, gear pairs, ring gears, rack and pinion and planetary sets, ready for a motion study and 3D printing", icon: "gear", fn: () => gearCmd() },
        { id: "ad-ins-model", label: "STL / 3MF / STEP model", title: "Import a 3D model: an STL or 3MF mesh, a STEP solid, or a Layerscape 3D print kit (.zip or .3mf, one object per part)", icon: "import", fn: () => insertFile("model") },
      ] },
    ]);
    group("Modify", "", [
      { id: "ad-moverot", label: "Move / Rotate", title: "Move or turn the selected shape in 3D: drag an arrow to move, a ring to turn, or type exact values", icon: "move", fn: () => moveCmd({ drag: "screen" }) }, // jumpstart-3d: rotation access
      { id: "ad-edge", label: edgeTool === "chamfer" ? "Chamfer" : "Fillet", title: "Edge tools: round (fillet) or bevel (chamfer) edges. The arrow switches tools.", icon: edgeTool, fn: () => edgeCmd(edgeTool),
        menu: [
          { id: "ad-fillet", label: "Fillet", title: "Round edges (F)", icon: "fillet", on: edgeTool === "fillet", fn: () => { edgeTool = "fillet"; renderRibbon(); edgeCmd("fillet"); } },
          { id: "ad-chamfer", label: "Chamfer", title: "Bevel edges (C)", icon: "chamfer", on: edgeTool === "chamfer", fn: () => { edgeTool = "chamfer"; renderRibbon(); edgeCmd("chamfer"); } },
        ] },
      { id: "ad-offset", label: "Offset face", title: "Offset face / press pull (Q)", icon: "offset", fn: () => offsetCmd() },
      { id: "ad-fillopen", label: "Fill openings", title: "Fill the holes, slots and pockets that open onto a flat face", icon: "fillOpenings", fn: () => fillOpeningsCmd() }, // jumpstart-3d: fill openings
      { id: "ad-shell", label: "Shell", icon: "shell", fn: () => shellCmd() },
      { id: "ad-advmod", label: "Advanced Modify", title: "Freehand Router, Offset face, Clearance, Combine, Split body, Lattice, Expandable and Split face", icon: "combine", dropdown: [
        { id: "ad-router", label: "Freehand Router", title: "Freehand Router: draw on any face, flat or curved, with a finger, pen or mouse to cut a groove. Ball, flat or V (scalpel) bit, any depth, pen pressure or taper, SMART clean-up", icon: "router", fn: () => routerCmd() },
        { id: "ad-offset", label: "Offset face", title: "Offset face / press pull (Q): click faces, or drag a box around a whole body", icon: "offset", fn: () => offsetCmd() },
        { id: "ad-clearance", label: "Clearance", title: "Give moving parts room: finds bodies that touch or overlap and cuts a small gap (0.2-0.5 mm) so they don't print fused", icon: "joint", fn: () => clearanceCmd() },
        { id: "ad-combine", label: "Combine", title: "Join, cut or intersect bodies (B)", icon: "combine", fn: () => combineCmd() },
        { id: "ad-splitbody", label: "Split body", title: "Cut a body into pieces with a plane, a face or another body", icon: "splitBody", fn: () => splitBodyCmd() },
        { id: "ad-lattice", label: "Lattice", title: "Turn a solid body into a honeycomb, triangle, circle or screen-mesh lattice inside a solid frame", icon: "facePattern", fn: () => latticeCmd() },
        { id: "ad-expandable", label: "Expandable", title: "Make a solid shape expandable: a hollow stack of rings that slide, twist or spin out, and stay together or come apart (fidget toys), printed in one piece", icon: "shell", fn: () => app.openExpandable && app.openExpandable() },
        { id: "ad-splitface", label: "Split face", title: "Divide faces with a plane or sketch curve (the shape stays the same)", icon: "splitFace", fn: () => splitFaceCmd() },
      ] },
      { id: "ad-pattern", label: "Pattern", title: "Pattern (P)", icon: "pattern", fn: () => patternCmd() },
      { id: "ad-transform", label: "Transform", title: "Move/Copy, Scale and Align", icon: "move", dropdown: [
        { id: "ad-move", label: "Move/Copy", title: "Move / Copy (M)", icon: "move", fn: () => moveCmd() },
        { id: "ad-scale", label: "Scale", title: "Scale a body by typed factors (or drag its white handles)", icon: "scale", fn: () => scaleCmd() },
        { id: "ad-align", label: "Align", title: "Align (A)", icon: "align", fn: () => alignCmd() },
      ] },
      { id: "ad-decorate", label: "Decorate", title: "Surface styling: texture, patterns on faces, emboss text and appearance", icon: "texture", dropdown: [
        { id: "ad-texture", label: "Texture", title: "Surface texture (T)", icon: "texture", fn: () => textureCmd() },
        { id: "ad-facepat", label: "Pattern on face", title: "Raise or cut a hexagon, diamond plate, screen mesh or other pattern on a face, flat or curved (cylinders, cones, spheres, fillets)", icon: "facePattern", fn: () => facePatternCmd() },
        { id: "ad-emboss", label: "Emboss text", title: "Raise or cut text on a flat or curved face", icon: "emboss", fn: () => embossCmd() },
        { id: "ad-appearance", label: "Appearance", title: "Colors and materials for bodies or faces (display only)", icon: "appearance", fn: () => appearanceCmd() },
      ] },
    ]);
    group("Inspect", "", [
      { id: "ad-measure", label: "Measure", title: "Measure sizes, distances and angles (I)", icon: "measure", fn: () => measureCmd() },
      { id: "ad-section", label: "Section Analysis", title: "Cut the view with a plane to look inside your design (the design doesn't change)", icon: "section", fn: () => sectionCmd() },
    ]);
    // far right: the parts library, then the workshop tools (each opens in its own window)
    group("Workshop", "", [
      { id: "ad-fastbtn", label: "Fasteners", title: "Parts library: bolts, screws, nuts, washers, heat-set inserts and pins (metric and inch), with optional modeled threads", icon: "thread", fn: () => fastenerCmd() },
      { id: "ad-workshop", label: "Workshop", title: "Woodworking: Jig Maker, Chip Carving and the Lathe", icon: "lathe", dropdown: [
        { id: "ad-jigs", label: "Jig Maker", title: "Woodworking jigs: miter box, dowel and pocket-hole jigs, square, angle templates, drill guide, and jigs for dovetails, box joints, mortise and tenon and lap joints, all honeycombed inside to save plastic", icon: "jig", fn: () => jigCmd() },
        { id: "ad-chipcarve", label: "Chip Carving", title: "Chip carve a board, plate, log or a shape from your design with knives; pen pressure sets the depth. The result is a mesh body.", icon: "chipcarve", fn: () => app.carve.open() },
        { id: "ad-lathe", label: "Lathe", title: "Turn a body or a wood blank on a virtual lathe with chisels (Space is the pedal), then hollow it out. The result is a mesh body.", icon: "lathe", fn: () => app.lathe.open() },
      ] },
    ]);
    ribbon.append(el("button", { class: "ibtn panel-toggle", style: { alignSelf: "center" }, onclick: () => browser.classList.toggle("collapsed") }, el("span", { class: "lbl" }, "Browser")));
  }
  // ---------------------------------------------------------------- the pinned Constraints palette
  // While sketching, every constraint can sit on the workspace as a small palette: drag it by its
  // title bar, flip it between names and icons only, and it stays where it was put (on this computer).
  // (functions, so the ribbon can use them however early it is first drawn)
  function cPinState() {
    if (!cPinState.v) { const d = { on: false, x: null, y: null, icons: false, cols: 2 }; try { cPinState.v = Object.assign(d, JSON.parse(localStorage.getItem("jumpstart.cpalette") || "{}")); } catch (e) { cPinState.v = d; } }
    return cPinState.v;
  }
  function saveCPin() { try { localStorage.setItem("jumpstart.cpalette", JSON.stringify(cPinState())); } catch (e) {} }
  function cPalette(opt) {
    const vpEl = document.getElementById("viewport");
    let pal = document.getElementById("cpalette");
    if (!opt) { if (pal) pal.remove(); return; }
    const { CICON, tool } = opt;
    if (!pal) {
      pal = el("div", { class: "cpal", id: "cpalette", role: "toolbar", "aria-label": "Constraints" });
      vpEl.append(pal);
    }
    pal.classList.toggle("icons", !!cPinState().icons);
    pal.style.setProperty("--cols", cPinState().icons ? 4 : cPinState().cols);
    pal.innerHTML = "";
    const head = el("header", { title: "Drag to move the palette" }, el("span", { class: "grip", "aria-hidden": "true" }, "⋮⋮"), el("span", { class: "t" }, "Constraints"),
      el("button", { id: "cpal-size", title: cPinState().icons ? "Show names" : "Icons only (smaller)", "aria-label": cPinState().icons ? "Show names" : "Icons only", onclick: () => { cPinState().icons = !cPinState().icons; saveCPin(); renderRibbon(); } }, cPinState().icons ? "⤢" : "⤡"),
      el("button", { id: "cpal-close", title: "Unpin (the Constraints list stays on the toolbar)", "aria-label": "Unpin the Constraints palette", onclick: () => { cPinState().on = false; saveCPin(); renderRibbon(); } }, "✕"));
    const grid = el("div", { class: "cgrid" });
    for (const k of Object.keys(CICON)) {
      const tk = "c-" + k, label = SKETCH_TOOLS[tk].label.replace(" constraint", "");
      grid.append(el("button", { id: "cpal-" + k, title: SKETCH_TOOLS[tk].label, "aria-pressed": String(tool === tk), html: ICON[CICON[k]], onclick: () => sketcher.setTool(tool === tk ? "select" : tk) }, el("span", {}, label)));
    }
    pal.append(head, grid, el("div", { class: "chint" }, "Pick a constraint, then click the lines or points it joins. Click it again to stop."));
    // where it sits: where it was left, kept inside the view
    const place = () => {
      const W = vpEl.clientWidth, H = vpEl.clientHeight, w = pal.offsetWidth, h = pal.offsetHeight;
      const x = cPinState().x == null ? 12 : cPinState().x, y = cPinState().y == null ? Math.max(12, H - h - 60) : cPinState().y;
      pal.style.left = Math.max(4, Math.min(x, W - w - 4)) + "px";
      pal.style.top = Math.max(4, Math.min(y, H - h - 4)) + "px";
    };
    place();
    head.onpointerdown = (e) => {
      if (e.target.closest("button")) return;
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY, ox = pal.offsetLeft, oy = pal.offsetTop;
      head.setPointerCapture(e.pointerId);
      head.onpointermove = (m) => { cPinState().x = ox + m.clientX - sx; cPinState().y = oy + m.clientY - sy; place(); };
      head.onpointerup = head.onpointercancel = () => { head.onpointermove = null; head.onpointerup = null; saveCPin(); };
    };
    pal.onpointerdown = (e) => e.stopPropagation();
    pal.onwheel = (e) => e.stopPropagation();
  }
  // put a ribbon list next to its button for the layout (below on top, beside a side rail, above a
  // bottom bar), always inside the window
  function placeMenu(menu, r) {
    const L = document.documentElement.dataset.layout, m = menu.getBoundingClientRect();
    let x = r.left, y = r.bottom + 4;
    if (L === "clean") { x = r.right + 6; y = r.top; }
    else if (L === "classic") { x = r.left - m.width - 6; y = r.top; }
    else if (L === "tablet") y = r.top - m.height - 4;
    menu.style.left = Math.max(4, Math.min(x, innerWidth - m.width - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(y, innerHeight - m.height - 4)) + "px";
    if (m.height > innerHeight - 8) { menu.style.maxHeight = innerHeight - 8 + "px"; menu.style.overflowY = "auto"; menu.style.top = "4px"; }
  }
  // a small drop-down list under a ribbon split button
  function openRibbonMenu(anchor, items) {
    const old = document.getElementById("ribbon-menu");
    if (old) { old.remove(); if (old.dataset.for === anchor.id) { anchor.setAttribute("aria-expanded", "false"); return; } }
    const r = (anchor.closest(".rsplit") || anchor).getBoundingClientRect();
    const menu = el("div", { class: "rmenu", id: "ribbon-menu", role: "menu", "data-for": anchor.id, style: { left: r.left + "px", top: r.bottom + 4 + "px" } },
      ...items.map((it) => {
        const b = it.on === undefined
          ? el("button", { role: "menuitem", id: it.id, title: it.title || null, html: ICON[it.icon] }, el("span", {}, it.label))
          : el("button", { role: "menuitemradio", id: it.id, "aria-checked": it.on ? "true" : "false", html: ICON[it.icon] }, el("span", {}, it.label));
        b.onclick = () => { close(); it.fn(); };
        return b;
      }));
    const close = () => { menu.remove(); anchor.setAttribute("aria-expanded", "false"); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", esc, true); };
    const outside = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); anchor.focus(); } };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", esc, true);
    document.body.append(menu);
    placeMenu(menu, r);
    anchor.setAttribute("aria-expanded", "true");
    const first = menu.querySelector("[aria-checked=true]") || menu.querySelector("button");
    first && first.focus();
  }
  function copySel() {
    if (selSketch && !app.sel.length) {
      const s = findSketch(store.doc, selSketch);
      if (s) { const c = clone(s); delete c.onBody; delete c.faceCenter; app.sketchClip = c; app.clipKind = "sketch"; app.toast(`Copied ${s.name}. Press Ctrl+V, then click any face, plane or the ground to place it.`); return; }
    }
    app.clipKind = "bodies";
    const s2 = app.selected();
    if (!s2.length) { app.toast("Select one or more bodies to copy."); return; }
    app.clipboard = clone(s2);
    app.toast(`Copied ${s2.length} bod${s2.length > 1 ? "ies" : "y"}`);
  }
  function pasteClip() {
    if (app.clipKind === "sketch" && app.sketchClip) { placeSketchCmd(app.sketchClip); return; }
    if (!app.clipboard || !app.clipboard.length) { app.toast("Nothing copied yet."); return; }
    const g = Math.max(app.gridStep(), 1) * 5, ids = [];
    store.update((doc) => {
      for (const b of app.clipboard) {
        const c = clone(b);
        c.id = uid("b");
        c.seq = nextSeq(doc);
        c.name = nextName(doc, (b.name || "Body").replace(/\s+\d+$/, ""));
        c.m = arr(M4(c.m).premultiply(new THREE.Matrix4().makeTranslation(g, g, 0)));
        doc.bodies.push(c);
        ids.push(c.id);
      }
    }, "Paste");
    // the next paste lands a bit further on
    app.clipboard = app.clipboard.map((b) => ({ ...b, m: arr(M4(b.m).premultiply(new THREE.Matrix4().makeTranslation(g, g, 0))) }));
    app.select(ids);
  }
  // a copied sketch, placed on any flat face, construction plane, origin plane or the ground:
  // centred where you click, turned by Spin; click again to place more copies, OK when done
  function placeSketchCmd(src) {
    const pts = src.pts || [];
    let cx = 0, cy = 0;
    if (pts.length) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; }
    const curves = resolveSketch(src).filter((c) => c.t !== "point");
    const st = { spin: 0, at: null, n: 0, made: [] };
    const frame = (pl, point) => {
      const n = new THREE.Vector3(...pl.n).normalize(), x0 = new THREE.Vector3(...pl.x).normalize();
      const x = x0.applyAxisAngle(n, (st.spin * Math.PI) / 180), y = new THREE.Vector3().crossVectors(n, x);
      const o = point.clone().addScaledVector(x, -cx).addScaledVector(y, -cy);
      const s = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(9)));
      return { o: s(o), x: s(x), n: s(n) };
    };
    const where = (e) => {
      const g = app.gridStep() || 1, { g: gz, f, cp } = pickPlaneOrFace(e);
      if (cp) { const p = vp.rayPlane(e, new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...cp.plane.n), new THREE.Vector3(...cp.plane.o))); return p && { pl: cp.plane, p, label: cp.name }; }
      if (f && f.info && f.info.t === "PLANE") {
        const pl = planeFromFace(f); let p = f.point.clone();
        // snap to the face's centre when close
        const c = new THREE.Vector3(...f.info.c).applyMatrix4(f.base.m);
        if (app.snapOn !== false && !e.altKey && p.distanceTo(c) < vp.pixelSize(p) * vp.tol(14)) p = c;
        return { pl, p, label: "a face" };
      }
      if (gz) { const P = ORIGIN_PLANES[gz.object.userData.plane], p = vp.rayPlane(e, new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...P.n), new THREE.Vector3(...P.o))); return p && { pl: P, p, label: "the " + gz.object.userData.plane + " plane" }; }
      const p = vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
      if (!p) return null;
      if (app.snapOn !== false && !e.altKey) { p.x = round(p.x, g); p.y = round(p.y, g); }
      return { pl: ORIGIN_PLANES.XY, p, label: "the ground" };
    };
    const show = () => {
      clearOv();
      if (!st.at) return;
      const F = frame(st.at.pl, st.at.p), M = planeMatrix(F), lift = new THREE.Vector3(...F.n).multiplyScalar(0.05);
      for (const c of curves) drawLine(sampleCurve(c, 48).map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M).add(lift)), 0xe8a317);
      vp.request();
    };
    const def = {
      title: "Place sketch",
      okLabel: "Done",
      ok() { clearOv(); closeCmd(false); if (st.made.length) { selSketch = st.made[st.made.length - 1]; renderBrowser(); } },
      cleanup() { clearOv(); },
      hint: () => `Point at any flat face, plane or the ground and click to place a copy of ${src.name}${st.n ? ` (${st.n} placed)` : ""}. Spin turns it. Done when finished.`,
      build(body) {
        body.append(el("p", { class: "hint", style: { padding: "0 0 6px" } }, `A copy of ${src.name}, centred where you click. It becomes its own sketch you can extrude, cut or edit.`));
        body.append(row("Spin", el("div", { style: { display: "flex", gap: "6px" } }, app.numField({ value: st.spin, id: "ps-spin", min: -360, max: 360, step: 15, live: true, onCommit: (v) => { st.spin = v; show(); } }),
          el("button", { class: "btn", id: "ps-spin90", onclick: () => { st.spin = (st.spin + 90) % 360; def.render(); show(); } }, "↻ 90°")), "ps-spin"));
        body.append(el("div", { class: "hint", id: "ps-count" }, st.n ? `${st.n} cop${st.n === 1 ? "y" : "ies"} placed.` : "Nothing placed yet."));
      },
      handler: {
        hover(e) { st.at = where(e); show(); },
        down(e) {
          const w = where(e); if (!w) return true;
          const F = frame(w.pl, w.p);
          let id = null;
          store.update((doc) => { const c = clone(src); c.id = id = uid("s"); c.name = nextSketchName(doc); c.seq = nextSeq(doc); c.plane = F; c.hidden = false; delete c.onBody; delete c.faceCenter; doc.sketches.push(c); }, "Paste sketch");
          st.made.push(id); st.n++; def.render(); show();
          return true;
        },
      },
    };
    openCmd(def);
  }
  function deleteSelected() {
    if (selSketch) { deleteFeature({ sketch: selSketch }); selSketch = null; return; }
    if (!app.sel.length) return;
    const ids = app.sel.filter((id) => !app.isLocked(id));
    if (ids.length < app.sel.length) app.toast(ids.length ? "Locked bodies were kept." : "That body is locked. Unlock it first (Ctrl+L).");
    if (ids.length) { deleteBodies(ids); app.select(app.sel.filter((id) => !ids.includes(id))); }
  }
  function toggleLock(ids = app.sel) {
    if (!ids.length) return;
    const lock = !ids.every((id) => app.isLocked(id));
    store.update((doc) => { for (const id of ids) { const b = findBody(doc, id); if (b) b.locked = lock; } }, lock ? "Lock" : "Unlock");
    app.toast(lock ? "Locked: it can't be moved, changed or deleted." : "Unlocked");
  }

  // ------------------------------------------------------------------ browser
  let selSketch = null;
  // ---- folders in the Browser
  let dragIds = null;
  function newFolder(ids) {
    const f = { id: uid("fd"), name: "Folder", open: true };
    store.update((d) => {
      d.folders = d.folders || [];
      const names = new Set(d.folders.map((x) => x.name)); let n = 1; while (names.has("Folder " + n)) n++;
      f.name = "Folder " + n; d.folders.push(f);
      for (const b of d.bodies) if (ids.includes(b.id)) b.folder = f.id;
    }, "New folder");
    app.toast(ids.length ? `${f.name}: ${ids.length} bod${ids.length === 1 ? "y" : "ies"} in it. Drag more bodies onto it, double-click it to rename.` : `${f.name} made: drag bodies onto it in the Browser.`);
  }
  function moveToFolder(ids, fid) {
    store.update((d) => { for (const b of d.bodies) if (ids.includes(b.id)) { if (fid) b.folder = fid; else delete b.folder; } const f = fid && (d.folders || []).find((x) => x.id === fid); if (f) f.open = true; }, fid ? "Move to folder" : "Take out of folder");
  }
  function renderBrowser() {
    const doc = { ...store.view, bodies: store.view.bodies.filter((b) => !b.cutPreview) };
    browser.innerHTML = "";
    if (workspace === "print") {
      browser.append(el("h3", {}, "3D Print Sim"));
      browser.append(el("div", { class: "hint", style: { padding: "6px 14px" } }, "Your design is locked while you simulate: nothing you do here changes it. Choose the parts to print in the panel on the right."));
      return;
    }
    browser.append(el("h3", {}, "Browser"));
    const tree = el("div", { class: "tree scroll", style: { flex: 1 } });
    tree.append(el("div", { class: "folder" }, `Bodies (${doc.bodies.length})`,
      el("button", { class: "dxf-all", id: "br-newfolder", title: app.sel.length ? "Put the selected bodies in a new folder" : "Make a new folder (drag bodies onto it)", onclick: (e) => { e.stopPropagation(); newFolder(app.sel.slice()); } }, "+ Folder")));
    if (!doc.bodies.length) tree.append(el("div", { class: "empty" }, "No bodies yet."));
    // folders of bodies: open or closed, named, hidden or shown together; drag bodies onto them
    const folders = doc.folders || [], inFolder = (b) => b.folder && folders.some((f) => f.id === b.folder);
    const dropOn = (node, fid) => {
      node.addEventListener("dragover", (e) => { if (dragIds) { e.preventDefault(); node.classList.add("drop"); } });
      node.addEventListener("dragleave", () => node.classList.remove("drop"));
      node.addEventListener("drop", (e) => { e.preventDefault(); node.classList.remove("drop"); if (dragIds) moveToFolder(dragIds, fid); dragIds = null; });
    };
    const bodyRow = (b, sub) => {
      const eye = el("button", { class: "eye", title: b.hidden ? "Show" : "Hide", "aria-label": b.hidden ? "Show " + b.name : "Hide " + b.name, html: b.hidden ? ICON.eyeOff : ICON.eye, onclick: (e) => { e.stopPropagation(); store.update((d) => { findBody(d, b.id).hidden = !b.hidden; }, b.hidden ? "Show body" : "Hide body"); } });
      const n = el("div", { class: "node" + (app.sel.includes(b.id) ? " sel" : ""), title: b.name }, eye,
        el("span", { class: "swatch", style: { background: b.hole ? "repeating-linear-gradient(135deg,#c2c9d1 0 2px,#fff 2px 4px)" : b.color } }),
        el("span", { class: "nm" }, b.name + (b.hole ? " (hole)" : "")),
        scene.errors.has(b.id) ? el("span", { class: "err-dot", title: scene.errors.get(b.id) }) : null,
        el("button", { class: "eye lockbtn" + (b.locked ? " on" : ""), title: b.locked ? "Unlock" : "Lock", "aria-label": (b.locked ? "Unlock " : "Lock ") + b.name, "aria-pressed": !!b.locked, html: ICON[b.locked ? "lock" : "unlock"], onclick: (e) => { e.stopPropagation(); toggleLock([b.id]); } }));
      n.onclick = (e) => { if (app.command && app.command.pickBody) { app.command.pickBody(b.id); return; } selSketch = null; const add = e.shiftKey || e.ctrlKey || e.metaKey; app.select(add ? (app.sel.includes(b.id) ? app.sel.filter((x) => x !== b.id) : [...app.sel, b.id]) : [b.id]); };
      n.ondblclick = () => editBody(b);
      if (sub) n.classList.add("infolder");
      n.draggable = true;
      n.addEventListener("dragstart", (e) => { dragIds = app.sel.includes(b.id) ? app.sel.slice() : [b.id]; try { e.dataTransfer.setData("text/plain", b.name); e.dataTransfer.effectAllowed = "move"; } catch (err) {} });
      n.addEventListener("dragend", () => { dragIds = null; });
      tree.append(n);
    };
    for (const f of folders) {
      const kids = doc.bodies.filter((b) => b.folder === f.id), allHidden = kids.length && kids.every((b) => b.hidden);
      const eye = el("button", { class: "eye", title: allHidden ? "Show the folder" : "Hide the folder", "aria-label": (allHidden ? "Show " : "Hide ") + f.name, html: allHidden ? ICON.eyeOff : ICON.eye, onclick: (e) => { e.stopPropagation(); store.update((d) => { for (const b of d.bodies) if (b.folder === f.id) b.hidden = !allHidden; }, allHidden ? "Show folder" : "Hide folder"); } });
      const tog = el("button", { class: "eye fold-tog", title: f.open === false ? "Open" : "Close", "aria-label": (f.open === false ? "Open " : "Close ") + f.name, "aria-expanded": String(f.open !== false), onclick: (e) => { e.stopPropagation(); store.update((d) => { const q = d.folders.find((x) => x.id === f.id); q.open = q.open === false; }, "Folder"); } }, f.open === false ? "▸" : "▾");
      const nm = el("span", { class: "nm" }, f.name + ` (${kids.length})`);
      const del = el("button", { class: "eye", title: "Remove the folder (its bodies stay)", "aria-label": "Remove folder " + f.name, html: ICON.del, onclick: (e) => { e.stopPropagation(); store.update((d) => { d.folders = d.folders.filter((x) => x.id !== f.id); for (const b of d.bodies) if (b.folder === f.id) delete b.folder; }, "Remove folder"); } });
      const n = el("div", { class: "node fold" + (kids.length && kids.every((b) => app.sel.includes(b.id)) ? " sel" : ""), "data-folder": f.id, title: "Click to select everything in it, double-click to rename. Drag bodies here." }, tog, eye, nm, del);
      n.onclick = (e) => { selSketch = null; const ids = kids.map((b) => b.id); app.select(e.shiftKey || e.ctrlKey || e.metaKey ? [...new Set([...app.sel, ...ids])] : ids); };
      n.ondblclick = (e) => { e.stopPropagation(); const v = prompt("Folder name", f.name); if (v && v.trim()) store.update((d) => { d.folders.find((x) => x.id === f.id).name = v.trim().slice(0, 60); }, "Rename folder"); };
      dropOn(n, f.id);
      tree.append(n);
      if (f.open !== false) for (const b of kids) bodyRow(b, true);
    }
    for (const b of doc.bodies) if (!inFolder(b)) bodyRow(b, false);
    if (folders.length) { const out = el("div", { class: "node fold-out", title: "Drop bodies here to take them out of their folder" }, el("span", { class: "nm" }, "↥ Not in a folder")); dropOn(out, null); tree.append(out); }
    tree.append(el("div", { class: "folder" }, `Sketches (${doc.sketches.length})`,
      doc.sketches.length ? el("button", { class: "dxf-all", id: "dxf-all", title: "Download every sketch as one DXF file (each sketch on its own layer)", onclick: (e) => { e.stopPropagation(); exportSketchesDXF(null); } }, "DXF ↓ all") : null));
    if (!doc.sketches.length) tree.append(el("div", { class: "empty" }, "Create a sketch to draw profiles."));
    for (const s of doc.sketches) {
      const eye = el("button", { class: "eye", title: s.hidden ? "Show" : "Hide", "aria-label": (s.hidden ? "Show " : "Hide ") + s.name, html: s.hidden ? ICON.eyeOff : ICON.eye, onclick: (e) => { e.stopPropagation(); store.update((d) => { findSketch(d, s.id).hidden = !s.hidden; }, s.hidden ? "Show sketch" : "Hide sketch"); } });
      const dl = el("button", { class: "eye dxf-one", title: "Download this sketch as DXF", "aria-label": "Download " + s.name + " as DXF", html: ICON.import, onclick: (e) => { e.stopPropagation(); exportSketchesDXF([s.id]); } });
      const n = el("div", { class: "node" + (selSketch === s.id || sketcher.active === s.id ? " sel" : ""), title: "Double-click to edit" }, eye, el("span", { class: "nm" }, s.name + (sketcher.active === s.id ? " (editing)" : "")), dl);
      n.onclick = () => { selSketch = s.id; app.select([]); renderBrowser(); };
      n.ondblclick = () => app.enterSketch(s.id);
      tree.append(n);
    }
    const planes = doc.planes || [];
    if (planes.length) {
      tree.append(el("div", { class: "folder" }, `Construction (${planes.length})`));
      for (const p of planes) {
        const eye = el("button", { class: "eye", title: p.hidden ? "Show" : "Hide", "aria-label": (p.hidden ? "Show " : "Hide ") + p.name, html: p.hidden ? ICON.eyeOff : ICON.eye, onclick: (e) => { e.stopPropagation(); store.update((d) => { const q = d.planes.find((x) => x.id === p.id); q.hidden = !q.hidden; }, p.hidden ? "Show plane" : "Hide plane"); } });
        const n = el("div", { class: "node", title: "Double-click to edit" }, eye, el("span", { class: "nm" }, p.name),
          el("button", { class: "eye", title: "Delete plane", "aria-label": "Delete " + p.name, html: ICON.del, onclick: (e) => { e.stopPropagation(); store.update((d) => { d.planes = d.planes.filter((x) => x.id !== p.id); }, "Delete plane"); } }));
        n.ondblclick = () => editPlane(p.id);
        tree.append(n);
      }
    }
    const joints = doc.joints || [];
    if (joints.length) {
      tree.append(el("div", { class: "folder" }, `Joints (${joints.length})`));
      for (const j of joints) {
        const n = el("div", { class: "node", title: "Double-click to edit" }, el("span", { class: "eye", html: ICON.joint }), el("span", { class: "nm" }, j.name),
          el("button", { class: "eye", title: "Delete joint", "aria-label": "Delete " + j.name, html: ICON.del, onclick: (e) => { e.stopPropagation(); sim.resetPose(); store.update((d) => { d.joints = d.joints.filter((x) => x.id !== j.id); }, "Delete joint"); } }));
        n.ondblclick = () => jointCmd(j.id);
        tree.append(n);
      }
    }
    browser.append(tree);
    // properties
    const sel = app.selected();
    if (sel.length === 1) {
      const b = sel[0];
      const v = scene.views.get(b.id);
      const box = scene.bodyTightBox(b.id);
      const size = box ? box.getSize(new THREE.Vector3()) : null;
      const dl = el("dl", {},
        el("dt", {}, "Type"), el("dd", { style: { fontFamily: "var(--f-ui)" } }, bodyTypeName(b.node)),
        el("dt", {}, "Size"), el("dd", {}, size ? `${showLen(size.x, 1)} × ${showLen(size.y, 1)} × ${showLen(size.z, 1)} ${getUnit()}` : "–"),
        el("dt", {}, "Volume"), el("dd", {}, v && v.data && v.data.volume != null ? fmt(v.data.volume / 1000, 3) + " cm³" : "–"),
        el("dt", {}, "Features"), el("dd", {}, String((b.node.mods || []).length)));
      const color = el("input", { type: "color", value: b.color || "#9fb1c4", id: "prop-color", title: "Body color", style: { width: "34px", height: "24px", border: 0, padding: 0, background: "none" } });
      color.onchange = () => store.update((d) => { findBody(d, b.id).color = color.value; }, "Color");
      const name = el("input", { class: "num", value: b.name, id: "prop-name", style: { fontFamily: "var(--f-ui)" } });
      name.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") name.blur(); };
      name.onchange = () => store.update((d) => { findBody(d, b.id).name = name.value.trim() || b.name; }, "Rename");
      browser.append(el("div", { class: "props" }, el("div", { style: { display: "flex", gap: "6px", marginBottom: "8px" } }, name, color), dl,
        el("div", { style: { display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" } },
          el("button", { class: "btn", disabled: !!b.locked, onclick: () => editBody(b) }, "Edit"),
          el("button", { class: "btn", id: "prop-lock", onclick: () => toggleLock([b.id]) }, b.locked ? "Unlock" : "Lock"),
          el("button", { class: "btn danger", disabled: !!b.locked, onclick: () => deleteSelected() }, "Delete"))));
    } else if (sel.length > 1) {
      const fs = doc.folders || [];
      const pick = el("tool-choice", { class: "num", id: "prop-folder", "aria-label": "Folder" }, el("option", { value: "" }, "Not in a folder"), ...fs.map((f) => el("option", { value: f.id }, f.name)), el("option", { value: "+" }, "+ New folder"));
      const cur = new Set(sel.map((b) => b.folder || "")); if (cur.size === 1) pick.value = [...cur][0];
      pick.onchange = () => { const ids = sel.map((b) => b.id); if (pick.value === "+") newFolder(ids); else moveToFolder(ids, pick.value || null); };
      browser.append(el("div", { class: "props" }, el("div", { class: "hint", style: { padding: "0 0 6px" } }, `${sel.length} bodies selected`), el("div", { class: "row" }, el("label", {}, "Folder"), pick)));
    } else if (selSketch) {
      const s = findSketch(doc, selSketch);
      if (s) browser.append(el("div", { class: "props" }, el("dl", {}, el("dt", {}, "Profiles"), el("dd", {}, String(regionsFor(s).length)), el("dt", {}, "Curves"), el("dd", {}, String(s.ents.length))),
        el("div", { style: { display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" } }, el("button", { class: "btn", onclick: () => app.enterSketch(s.id) }, "Edit sketch"),
          el("button", { class: "btn", id: "sk-copyplace", title: "Copy this sketch and place copies on any face, plane or the ground (Ctrl+C, Ctrl+V)", onclick: () => { app.select([]); selSketch = s.id; copySel(); placeSketchCmd(app.sketchClip); } }, "Copy & place…"),
          el("button", { class: "btn danger", onclick: () => deleteSelected() }, "Delete"))));
    }
  }

  // ------------------------------------------------------------------ timeline
  const TL_ICON = { sketch: "sketch", prim: "prim", extrude: "extrude", revolve: "revolve", fillet: "fillet", chamfer: "chamfer", hole: "hole", shell: "shell", offset: "offset", fillopenings: "fillOpenings", combine: "combineIcon", bool: "extrude", thread: "thread", scale: "scale", texture: "texture", sweep: "sweep", pipe: "pipe", coil: "coil", loft: "loft", mirror: "mirror", halfspace: "splitBody", sketchsplit: "splitBody", splitface: "splitFace", emboss: "emboss", facepat: "facePattern", plane: "planeOffset", joint: "joint" }; // jumpstart-3d: fill openings
  let lastTl = null, lastTlT = 0;
  // ---- stepping through the timeline (rollback): see the design as it was after any step
  const TL_SVG = {};
  const tlSteps = () => timeline(store.doc);
  function rollIndex(items) {
    if (store.rollTo == null) return items.length - 1;
    const i = items.findIndex((it) => it.seq === store.rollTo);
    return i >= 0 ? i : items.length - 1;
  }
  function rollToIndex(i, quiet) {
    const items = tlSteps();
    if (!items.length) return;
    if (app.command) closeCmd(false);
    i = Math.max(0, Math.min(items.length - 1, i));
    store.setRoll(i >= items.length - 1 ? null : items[i].seq);
    if (!quiet) app.toast(i >= items.length - 1 ? "Showing the finished design (the last step)." : `Step ${i + 1} of ${items.length}: ${items[i].label}`);
  }
  function rollStop() { clearTimeout(roll.timer); roll.timer = null; renderTimeline(); }
  // play: from the first step (or where you are), one step each time the last one has built
  function rollPlay() {
    if (roll.timer) { rollStop(); return; }
    const items = tlSteps();
    if (items.length < 2) return;
    let i = store.rollTo == null ? 0 : rollIndex(items) + 1;
    if (i >= items.length) i = 0;
    rollToIndex(i, true);
    let since = Date.now();
    const tick = () => {
      // wait for the shapes of this step to be built (up to 30 s: a very slow body keeps
      // building in the background), then hold it a moment
      const building = scene.busy() || app.kernel.inflight || app.kernel.queue.size || (app.kernel.isLooking && app.kernel.isLooking());
      if (building && Date.now() - since < 30000) { roll.timer = setTimeout(tick, 200); return; }
      roll.timer = setTimeout(() => {
        const all = tlSteps(), j = rollIndex(all) + 1;
        if (store.rollTo == null || j >= all.length) { roll.timer = null; store.setRoll(null); app.toast("Played every step. This is the finished design."); renderTimeline(); return; }
        rollToIndex(j, true);
        since = Date.now();
        roll.timer = setTimeout(tick, 250);
      }, roll.hold || 900);
    };
    roll.timer = setTimeout(tick, 250);
    renderTimeline();
  }
  app.timelineRoll = { toIndex: rollToIndex, play: rollPlay, stop: () => { if (roll.timer) rollStop(); }, index: () => rollIndex(tlSteps()), count: () => tlSteps().length, setHold: (ms) => { roll.hold = ms; } };
  function renderTimeline() {
    if (!TL_SVG.play) Object.assign(TL_SVG, {
      first: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 5 9 12l9 7z" fill="currentColor"/></svg>',
      back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5 7 12l9 7z" fill="currentColor"/></svg>',
      play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>',
      pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor"/><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor"/></svg>',
      fwd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l9 7-9 7z" fill="currentColor"/></svg>',
      last: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 5l9 7-9 7z" fill="currentColor"/></svg>',
    });
    tl.innerHTML = "";
    tl.classList.toggle("locked", workspace === "print");
    tl.append(el("span", { class: "tl-title" }, "Timeline"));
    // rolled back: the steps come from the whole design; the ones after the marker are dimmed
    const items = timeline(store.rollTo != null ? store.doc : store.view);
    const at = rollIndex(items), rolled = store.rollTo != null;
    if (items.length > 1) {
      const ctl = (id, icon, title, fn, dis) => el("button", { class: "tl-ctl", id, title, "aria-label": title, disabled: dis || null, html: icon, onclick: fn });
      const playing = !!roll.timer;
      const box = el("span", { class: "tl-ctls", role: "group", "aria-label": "Step through the timeline" },
        ctl("tl-first", TL_SVG.first, "Go to the first step", () => { if (playing) rollStop(); rollToIndex(0); }, !playing && at === 0),
        ctl("tl-back", TL_SVG.back, "Step back: show the design one step earlier", () => { if (playing) rollStop(); rollToIndex(at - 1); }, !playing && at === 0),
        ctl("tl-play", playing ? TL_SVG.pause : TL_SVG.play, playing ? "Pause" : "Play: build the design step by step", () => rollPlay()),
        ctl("tl-fwd", TL_SVG.fwd, "Step forward: show the next step", () => { if (playing) rollStop(); rollToIndex(at + 1); }, !playing && !rolled),
        ctl("tl-last", TL_SVG.last, "Go to the last step (the finished design)", () => { if (playing) rollStop(); rollToIndex(items.length - 1); }, !playing && !rolled));
      tl.append(box);
      if (rolled || playing) tl.append(el("span", { class: "tl-step", id: "tl-step" }, `${at + 1} / ${items.length}`));
    }
    if (!items.length) tl.append(el("span", { class: "empty" }, "Features appear here as you build. Double-click one to edit it."));
    items.forEach((it, idx) => {
      const err = it.body && scene.errors.has(it.body);
      const cls = "tl-item" + (err ? " err" : "") + (rolled && idx > at ? " tl-future" : "") + (rolled && idx === at ? " tl-now" : "");
      const b = el("button", { class: cls, "data-mod": it.mod || "", "data-step": idx, title: `${it.label}${err ? " — " + scene.errors.get(it.body) : ""}\n${rolled ? "Click to show the design at this step. " : ""}Double-click (or tap twice) to edit`, "aria-label": it.label, html: ICON[TL_ICON[it.kind]] || ICON.prim });
      b.onclick = () => {
        if (app.command && app.command.timelinePick && it.mod) { app.command.timelinePick(it); return; }
        // while stepping through: a click moves the marker to that step
        if (rolled) { if (roll.timer) rollStop(); rollToIndex(idx); return; }
        const key = it.mod || it.body || it.sketch;
        if (lastTl === key && performance.now() - lastTlT < 2500 && vp.touchMode) { lastTl = null; editItem(it); return; }
        lastTl = key; lastTlT = performance.now();
        if (it.body) { selSketch = null; app.select([it.body]); }
        else if (it.sketch) { selSketch = it.sketch; app.select([]); renderBrowser(); }
      };
      b.ondblclick = () => { if (roll.timer) rollStop(); if (store.rollTo != null) { store.setRoll(null); } editItem(it); };
      tl.append(b);
    });
    // keep the current step in sight
    if (rolled) { const cur = tl.querySelector(".tl-now"); if (cur) cur.scrollIntoView({ block: "nearest", inline: "center" }); }
    else tl.scrollLeft = tl.scrollWidth;
    if (app.command && app.command.afterTimeline) app.command.afterTimeline();
  }

  // ------------------------------------------------------------------ sketch palette
  function renderPalette() {
    if (!sketcher.active || app.command) { palette.hidden = true; return; }
    palette.hidden = false;
    palette.innerHTML = "";
    const sk = sketcher.sketch;
    palette.append(el("header", {}, el("h4", {}, "Sketch palette · " + (sk ? sk.name : ""))));
    const body = el("div", { class: "body" });
    body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pal-snap", checked: sketcher.snapOn, onchange: (e) => { sketcher.snapOn = e.target.checked; } }), (sketcher.snapOn ? "Snap to grid points (" + withUnit(sketcher.gridSpacing(), 3) + " at this zoom)" : "Snap to grid points")));
    if (sketcher.tool === "select") body.append(el("div", { class: "hint", id: "pal-select-hint", style: { padding: "2px 0 6px" } }, "Editing: click a line, circle or arc to type its size (it becomes a dimension). Drag shapes to move them. Double-click a dimension to change it."));
    if (["rect", "rect3", "rectc"].includes(sketcher.tool)) body.append(row("Rectangle", seg([["rect", "2-point"], ["rect3", "3-point"], ["rectc", "Center"]], sketcher.tool, (v) => sketcher.setTool(v), "pal-rect")));
    if (sk && sk.image) {
      const im = sk.image;
      const setImg = (patch, label = "Edit image") => store.update((doc) => { const s2 = findSketch(doc, sk.id); if (s2 && s2.image) Object.assign(s2.image, patch); }, label);
      body.append(el("div", { class: "subhead" }, "Image · " + (im.name || "picture")));
      const r3 = el("div", { class: "row3" });
      r3.append(el("label", {}, "Width", app.numField({ value: im.w, id: "pal-imw", min: 0.1, onCommit: (v) => setImg({ w: v, h: +((v * im.h) / im.w).toFixed(4) }, "Size picture") })));
      r3.append(el("label", {}, "Height", app.numField({ value: im.h, id: "pal-imh", len: true, min: 0.1, onCommit: (v) => setImg({ h: v, w: +((v * im.w) / im.h).toFixed(4) }, "Size picture") })));
      r3.append(el("label", {}, "Turn °", app.numField({ value: im.rot || 0, id: "pal-imr", angle: true, onCommit: (v) => setImg({ rot: v }, "Turn picture") })));
      body.append(r3);
      const r3b = el("div", { class: "row3" });
      r3b.append(el("label", {}, "X", app.numField({ value: im.cx, id: "pal-imx", onCommit: (v) => setImg({ cx: v }) })));
      r3b.append(el("label", {}, "Y", app.numField({ value: im.cy, id: "pal-imy", onCommit: (v) => setImg({ cy: v }) })));
      body.append(r3b);
      body.append(el("div", { class: "pal-btns" },
        el("button", { class: "btn", id: "pal-imfit", title: "Drag handles to scale, stretch, turn or move the picture, or scale it from a length you know", onclick: () => pictureCmd(sk.id) }, "Size & place…"),
        el("button", { class: "btn", id: "pal-imtrace", title: "Turn the picture's shapes into sketch outlines you can extrude", onclick: () => traceCmd(sk.id) }, "Auto trace…"),
        el("button", { class: "btn", id: "pal-im3d", style: { gridColumn: "1 / -1" }, title: "Puff the picture's subject up into a rounded 3D model with the picture painted on", onclick: () => puffyCmd(sk.id) }, "Picture to 3D model…")));
      let opT = 0;
      body.append(sliderRow("Opacity", "pal-imop", Math.round(im.opacity * 100), 5, 100, 1, "%", (v) => { clearTimeout(opT); opT = setTimeout(() => setImg({ opacity: v / 100 }), 120); }));
      body.append(el("button", { class: "btn", id: "pal-imdel", onclick: () => store.update((doc) => { const s2 = findSketch(doc, sk.id); if (s2) delete s2.image; }, "Remove image") }, "Remove image"));
    }
    if (sketcher.tool === "polygon") body.append(row("Sides", app.numField({ value: sketcher.polySides, id: "pal-sides", min: 3, max: 64, step: 1, onCommit: (v) => { sketcher.polySides = Math.round(v); } }), "pal-sides"));
    const ids = [...sketcher.sel];
    if (ids.length === 1 && sk) {
      const id = ids[0];
      if (id.startsWith("pt:")) {
        const p = sk.pts.find((q) => q.id === id.slice(3));
        if (p) {
          const r3 = el("div", { class: "row3" });
          r3.append(el("label", {}, "X", app.numField({ value: p.x, id: "pal-px", onCommit: (v) => sketcher.setPointProps(p.id, v, p.y) })));
          r3.append(el("label", {}, "Y", app.numField({ value: p.y, id: "pal-py", onCommit: (v) => sketcher.setPointProps(p.id, p.x, v) })));
          body.append(el("div", { class: "subhead" }, "Point"), r3);
        }
      } else if (sk.ents.find((x) => x.id === id && x.t === "text")) {
        const ent = sk.ents.find((x) => x.id === id);
        const p = sk.pts.find((q) => q.id === ent.p) || { x: 0, y: 0 };
        body.append(el("div", { class: "subhead" }, "Text"));
        const txt = el("input", { class: "num", id: "pal-text", value: ent.str || "", style: { fontFamily: "var(--f-ui)" }, "aria-label": "Text" });
        txt.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") txt.blur(); });
        txt.addEventListener("change", () => sketcher.setEntProps(id, { str: txt.value }));
        body.append(txt);
        body.append(textFontSelect(ent.font || "sans", (v) => sketcher.setEntProps(id, { font: v }), "pal-font"));
        const f = (label, value, key, opts = {}) => el("label", {}, label, app.numField({ value, id: "pal-" + key, ...opts, onCommit: (v) => sketcher.setEntProps(id, { [key]: v }) }));
        body.append(el("div", { class: "row3" }, f("Size", ent.size || 10, "size", { min: 0.1 }), f("Angle °", ent.angle || 0, "angle"), el("span")));
        body.append(el("div", { class: "row3" }, f("X", p.x, "x"), f("Y", p.y, "y"), el("span")));
        const onFace = !!sk.faceCenter;
        body.append(row(onFace ? "Center on face" : "Center on origin", el("div", { class: "seg", id: "pal-tcenter" },
          el("button", { id: "pal-tc-both", onclick: () => sketcher.centerText(id, "both"), title: "Put the middle of the text on the " + (onFace ? "face center" : "origin") }, "Both"),
          el("button", { id: "pal-tc-h", onclick: () => sketcher.centerText(id, "h") }, "↔ Across"),
          el("button", { id: "pal-tc-v", onclick: () => sketcher.centerText(id, "v") }, "↕ Up")), "pal-tcenter"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pal-tsnap", checked: app.snapOn, onchange: (e) => app.setSnap(e.target.checked) }), "Snap while dragging (" + (onFace ? "face center, " : "") + "points, shape centers, grid)"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Size is the height of capital letters. Drag the text to move it: its middle snaps into place. Hold Alt (Option) while dragging, or turn Snap off, to move it freely. Arrow keys nudge it (Shift ×10, Alt ×0.1)."));
      } else {
        const c = resolveSketch(sk).find((x) => x.id === id);
        const ent = sk.ents.find((x) => x.id === id);
        if (c && ent) {
          const f = (label, value, key, opts = {}) => el("label", {}, label, app.numField({ value, id: "pal-" + key, ...opts, onCommit: (v) => sketcher.setEntProps(id, { [key]: v }) }));
          if (c.t === "spline") {
            body.append(el("div", { class: "subhead" }, `Spline · ${ent.pts.length} points`));
            body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pal-closed", checked: !!ent.closed, onchange: (ev) => sketcher.setEntProps(id, { closed: ev.target.checked }) }), "Closed loop"));
            body.append(el("div", { class: "hint", style: { padding: 0 } }, "Drag its points to reshape it. Select a point and press Delete to remove it."));
          } else if (c.t === "line") {
            const L = d2(c.a, c.b), A = ((Math.atan2(c.b[1] - c.a[1], c.b[0] - c.a[0]) * 180) / Math.PI + 360) % 360;
            body.append(el("div", { class: "subhead" }, ent.proj ? "Projected line (fixed)" : "Line"));
            body.append(el("div", { class: "row3" }, f("Length", L, "len", { min: 0.001 }), f("Angle °", A, "ang"), el("span")));
            body.append(el("div", { class: "row3" }, f("Start X", c.a[0], "ax"), f("Start Y", c.a[1], "ay"), el("span")));
            body.append(el("div", { class: "row3" }, f("End X", c.b[0], "bx"), f("End Y", c.b[1], "by"), el("span")));
          } else if (c.t === "circle") {
            body.append(el("div", { class: "subhead" }, "Circle"));
            body.append(el("div", { class: "row3" }, f("Diameter", c.r * 2, "dia", { min: 0.001 }), f("Center X", c.c[0], "cx"), f("Center Y", c.c[1], "cy")));
          } else if (c.t === "arc") {
            body.append(el("div", { class: "subhead" }, "Arc"));
            body.append(el("div", { class: "row3" }, f("Radius", c.r, "r", { min: 0.001 }), f("Center X", c.c[0], "cx"), f("Center Y", c.c[1], "cy")));
          } else if (c.t === "point") {
            body.append(el("div", { class: "subhead" }, "Point"));
            body.append(el("div", { class: "row3" }, f("X", c.p[0], "x"), f("Y", c.p[1], "y"), el("span")));
          }
          if (!ent.proj && c.t !== "point") body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pal-cons", checked: !!ent.cons, onchange: (e) => sketcher.setEntProps(id, { cons: e.target.checked }) }), "Construction (not part of profiles)"));
        }
      }
    } else if (ids.length > 1) body.append(el("div", { class: "hint", style: { padding: 0 } }, `${ids.length} items selected.`));
    if (ids.length) body.append(el("button", { class: "btn danger", onclick: () => sketcher.deleteSelection() }, "Delete selected"));
    if (!["select", "trim", "dim"].includes(sketcher.tool)) body.append(el("button", { class: "btn", id: "pal-stop", onclick: () => { sketcher.done(); app.status(); } }, "Stop drawing (Esc)"));
    if (sk) body.append(el("label", { class: "check", title: "Cut away the part of the bodies between you and the sketch plane (view only), like Fusion's Slice" }, el("input", { type: "checkbox", id: "pal-slice", checked: !!(app.sketchSlice && app.sketchSlice.on), onchange: (e) => app.setSketchSlice(e.target.checked) }), "Slice (see inside bodies)"));
    if (sk) body.append(el("div", { class: "hint", style: { padding: 0 } }, `${regionsFor(sk).length} closed profile${regionsFor(sk).length === 1 ? "" : "s"}.`));
    palette.append(body);
    palette.append(el("footer", {}, el("button", { class: "btn", id: "pal-extrude", title: "Go straight to Extrude (E)", onclick: () => app.quickExtrude() }, "Extrude (E)"), el("button", { class: "btn primary", id: "pal-finish", onclick: () => app.exitSketch() }, "Finish sketch")));
  }
  app.onSketchTool = () => { renderRibbon(); renderPalette(); app.status(); };
  app.onSketchSelection = () => renderPalette();

  // ------------------------------------------------------------------ keys
  function key(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "a") { app.select(store.doc.bodies.map((b) => b.id)); return true; }
    if (mod && k === "l") { toggleLock(); return true; }
    if (/^Arrow/.test(e.key) && !e.altKey && app.sel.length) {
      const ids = app.sel.filter((id) => !app.isLocked(id) && findBody(store.doc, id));
      if (!ids.length) return true;
      const d = app.arrowDelta(e, (app.gridStep() || 1) * (e.shiftKey ? 10 : 1));
      transformBodies(ids, new THREE.Matrix4().makeTranslation(d.x, d.y, d.z), "Nudge");
      return true;
    }
    if (e.key === "Delete" || e.key === "Backspace") { deleteSelected(); return true; }
    if ((e.ctrlKey || e.metaKey) && k === "c") { copySel(); return true; }
    if ((e.ctrlKey || e.metaKey) && k === "v") { pasteClip(); return true; }
    if ((e.ctrlKey || e.metaKey) && k === "d") { if (app.sel.length) app.select(duplicateBodies(app.sel)); return true; }
    if (mod) return false;
    if (k === "f" && e.shiftKey) { app.fit(); return true; }
    // Fusion-style: L / R / C start a sketch with that tool
    const map = e.shiftKey
      ? { r: () => extrudeCmd("revolve"), c: () => edgeCmd("chamfer") }
      : { i: () => measureCmd(), t: () => textureCmd(), s: createSketchCmd, q: () => offsetCmd(), p: () => patternCmd(), a: () => alignCmd(), h: () => holeCmd(), f: () => edgeCmd("fillet"), m: () => moveCmd(), b: () => combineCmd() };
    const sketchKey = !e.shiftKey && (k === "l" || k === "r" || k === "c");
    // only a key that starts another tool closes the open one (Shift, arrows and so on don't)
    if (!sketchKey && !map[k]) return false;
    if (app.command) app.command.cancel();
    if (sketchKey) { app.startSketchTool({ l: "line", r: "rect*", c: "circle" }[k]); return true; }
    map[k]();
    return true;
  }

  const sim = initSimulate(app, { vp, scene, openCmd, closeCmd, commit, schedulePreview, pickBaseFace, baseOf, drawLine, drawFace, drawDot, clearOv, row, seg, pickbox, sliderRow });
  function jointCmd(id) { sim.jointCmd(id); }
  const { pipeCmd, coilCmd } = initPipeCoil(app, { vp, scene, openCmd, closeCmd, commit, schedulePreview, pickBaseFace, pickBaseEdge, edgeWorldPts, drawLine, drawDot, clearOv, row, seg, pickbox, pickSketchCurve, pathPts, deleteFeature, frameFrom });
  const fasteners = initFasteners(app, { openCmd, commit, row, seg, offsetSelect, STD }); // jumpstart-3d: fasteners
  const holePattern = initHolePattern(app, { openCmd, commit, row, seg, pickbox, pickBaseFace, baseOf, drawFace, ov, clearOv, offsetSelect, pitchRow, planeFromFace, CLEAR, CBORE, CSINK, TAP, isInchKey }); // jumpstart-3d: hole pattern
  const gears = initGears(app, { openCmd, commit, row, seg }); // jumpstart-3d: gears
  const gridfinityPart = initGridfinityPart(app, { openCmd, commit, schedulePreview }); // jumpstart-3d: Gridfinity part
  const namePlate = initNamePlate(app, { openCmd, commit, row, seg }); // jumpstart-3d: name plates
  const knurl = initKnurl(app, { openCmd, commit, row, seg }); // jumpstart-3d: knurl
  const spring = initSpring(app, { openCmd, commit, row, seg }); // jumpstart-3d: spring
  // section analysis: lives on after its dialog closes; a chip in the view shows it is on
  const section = (app.section = initSection(app, vp, scene));
  const secChip = el("div", { class: "section-chip", id: "section-chip", hidden: true },
    el("span", { class: "dot" }), el("span", { class: "txt" }, "Section analysis"),
    el("button", { class: "btn", id: "section-edit", title: "Change the section", onclick: () => { if (app.mode !== "advanced") app.setMode("advanced"); sectionCmd(); } }, "Edit"),
    el("button", { class: "xbtn", id: "section-clear", "aria-label": "Turn off section analysis", title: "Turn off section analysis", html: ICON.close, onclick: () => section.clear() }));
  vp.canvas.parentElement.append(secChip);
  section.onChange((info) => { secChip.hidden = !info || !!info.slice; if (info) secChip.querySelector(".txt").textContent = "Section: " + (info.ref.label || "plane") + (info.d ? ` ${info.d > 0 ? "+" : ""}${withUnit(info.d, 1)}` : ""); });
  const { measureCmd } = initMeasure(app, { vp, openCmd, closeCmd, pickBaseFace, pickBaseEdge, edgeWorldPts, drawLine, drawFace, drawDot, clearOv, row, seg });
  const views3d = (app.views3d = initViews3D(app));
  const psim = initPrintSim(app, { vp, scene, openCmd, closeCmd, row, seg, sliderRow, onView: () => { if (app.mode === "advanced") renderRibbon(); }, onClose: () => leftPrintSim() });
  // the sim panel closed (Done, ×, a mode switch…): unlock the design again
  function leftPrintSim() {
    app.simLock = false;
    document.body.classList.remove("simlock");
    if (workspace === "print") { workspace = "design"; if (app.mode === "advanced") { renderRibbon(); renderBrowser(); renderTimeline(); } }
  }
  // the sim with objects from outside the design (the Color Lithophane Studio)
  function openPrintSimWith(list, o) {
    psim.loadExternal(list, o);
    if (app.mode === "advanced" && workspace !== "print") { setWorkspace("print"); return; }
    if (app.command) closeCmd(false);
    if (app.mode === "advanced") { workspace = "print"; app.simLock = true; renderRibbon(); renderBrowser(); psim.open(); return; }
    openPrintSim();
  }
  // Beginner mode opens the same sim as a tool
  function openPrintSim() {
    if (app.mode === "advanced") { setWorkspace("print"); return; }
    if (app.sketcher.active) app.exitSketch();
    if (app.command) closeCmd(false);
    app.simLock = true;
    document.body.classList.add("simlock");
    psim.open();
  }
  function setWorkspace(w) {
    if (workspace === w) return;
    const was = workspace;
    workspace = w;
    app.simLock = w === "print";
    if (app.command) closeCmd(false);
    if (w === "design" || was === "simulate") sim.resetPose();
    renderRibbon();
    renderBrowser();
    if (w === "print") psim.open();
  }

  let lastKind = null;
  // ---------------------------------------------------------------- right-click menu (both modes)
  app.contextMenu = (e) => {
    if (app.command || app.sketcher.active || app.simLock) return;
    const hit = scene.pickFace(e, (b) => !b.locked || true);
    if (hit && !app.sel.includes(hit.body)) app.select([hit.body]);
    const beg = app.mode === "beginner";
    // the same actions as the keyboard shortcuts in each mode
    const fire = (k, ctrl) => (beg ? app.beginner.key : key)({ key: k, ctrlKey: !!ctrl, metaKey: false, shiftKey: false, altKey: false, preventDefault() {}, target: document.body });
    const has = app.sel.length > 0;
    const items = [
      { id: "cm-copy", label: "Copy", kbd: "Ctrl+C", icon: "copy2", off: !has, fn: () => fire("c", true) },
      { id: "cm-paste", label: "Paste", kbd: "Ctrl+V", icon: "paste2", off: !(app.clipboard && app.clipboard.length), fn: () => fire("v", true) },
      { id: "cm-dup", label: "Duplicate", kbd: "Ctrl+D", icon: "duplicate", off: !has, fn: () => fire("d", true) },
      { id: "cm-del", label: "Delete", kbd: "Del", icon: "del", off: !has, fn: () => fire("Delete") },
    ];
    if (!beg && has) items.push({ sep: true },
      { id: "cm-move", label: "Move/Copy", kbd: "M", icon: "move", fn: () => moveCmd() },
      { id: "cm-appear", label: "Appearance…", icon: "appearance", fn: () => appearanceCmd() });
    showContext(e, items);
  };
  function showContext(e, items) {
    document.getElementById("ctx-menu")?.remove();
    const menu = el("div", { class: "rmenu ctxmenu", id: "ctx-menu", role: "menu", style: { left: e.clientX + "px", top: e.clientY + "px" } });
    for (const it of items) {
      if (it.sep) { menu.append(el("div", { class: "ctxsep" })); continue; }
      const b = el("button", { role: "menuitem", id: it.id, disabled: !!it.off, html: ICON[it.icon] || "" }, el("span", {}, it.label), it.kbd ? el("span", { class: "kbd ctxkbd" }, it.kbd) : null);
      b.onclick = () => { close(); it.fn(); };
      menu.append(b);
    }
    const close = () => { menu.remove(); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", esc, true); };
    const outside = (ev) => { if (!menu.contains(ev.target)) close(); };
    const esc = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", esc, true);
    document.body.append(menu);
    // keep it on screen
    const r = menu.getBoundingClientRect();
    if (r.right > innerWidth - 4) menu.style.left = Math.max(4, innerWidth - r.width - 4) + "px";
    if (r.bottom > innerHeight - 4) menu.style.top = Math.max(4, e.clientY - r.height) + "px";
  }
  return {
    cancel: () => { if (app.command) closeCmd(false); },
    sim,
    printSim: psim,
    openPrintSim,
    openPrintSimWith,
    // the Bin & Box Maker, for Beginner's ribbon too
    openBins: (id) => { if (app.command) closeCmd(false); binCmd(id || null); },
    openStorage: () => { if (app.command) closeCmd(false); storageCmd(); },
    toolIndex, runTool,
    lattice: () => { if (app.command) closeCmd(false); latticeCmd(); },
    setWorkspace,
    handler: defaultHandler,
    key,
    refresh(kind) {
      // another mode or design: back to the finished design
      if ((kind === "mode" || kind === "load") && (store.rollTo != null || roll.timer)) { if (roll.timer) { clearTimeout(roll.timer); roll.timer = null; } if (store.rollTo != null) { store.setRoll(null); return; } }
      // switching mode or opening another design leaves the simulation workspaces
      if ((kind === "mode" || kind === "load") && workspace !== "design") { workspace = "design"; app.simLock = false; if (app.command) closeCmd(false); psim.teardown(); sim.resetPose(); }
      if (kind === "mode" || kind === "sketch" || kind === "load" || !ribbon.querySelector(".rgroup") || lastKind === "mode-b") renderRibbon();
      lastKind = kind;
      renderBrowser();
      renderTimeline();
      renderPalette();
      if (app.command && (kind === "change" || kind === "load") && app.command.render && !app.command.noRerenderOnChange) {/* keep dialog */}
    },
    editItem,
    // shared with Beginner mode
    createSketch: (opts) => createSketchCmd(opts || {}),
    hinge: (id) => hingeCmd(id || null),
    pattern: () => patternCmd(),
    align: () => alignCmd(),
    move: () => moveCmd(),
    texture: (opts) => textureCmd(opts || null),
    insertFile: (kind) => insertFile(kind),
    importModel: (file, bytes) => importModel(file, bytes),
    exportSketchesDXF,
    get selectedSketch() { return selSketch; },
    scale: () => scaleCmd(),
    measure: () => measureCmd(),
    emboss: (pre) => embossCmd(null, pre || null),
    facePattern: (opts) => facePatternCmd(opts || null),
    text3d: (id) => textCmd(id || null),
    hole: () => holeCmd(),
    shell: (opts) => shellCmd(null, opts || {}),
    fillet: () => edgeCmd("fillet"),
    fastener: () => fasteners.cmd(), addFastener: (spec) => fasteners.add(spec), // jumpstart-3d: fasteners
    holePattern: () => holePattern.cmd(), addHolePattern: (spec) => holePattern.add(spec), // jumpstart-3d: hole pattern
    gear: () => gears.cmd(), addGear: (spec) => gears.add(spec), // jumpstart-3d: gears
    gridfinityPart: () => gridfinityPart.cmd(), addGridfinityPart: (spec, at) => gridfinityPart.add(spec, at), // jumpstart-3d: Gridfinity part
    namePlate: () => namePlate.cmd(), addNamePlate: (spec) => namePlate.add(spec), // jumpstart-3d: name plates
    knurl: () => knurl.cmd(), addKnurl: (spec) => knurl.add(spec), // jumpstart-3d: knurl
    spring: () => spring.cmd(), addSpring: (spec) => spring.add(spec), // jumpstart-3d: spring
    editFeature: (body, mod) => editItem({ body, mod }),
    appearance: () => appearanceCmd(),
    extrude: (opts) => extrudeCmd("extrude", null, opts || {}),
    sketchUI(kind) {
      if (kind === "sketch" || !ribbon.querySelector(".rgroup.sketch")) renderRibbon();
      renderPalette();
    },
    showBuildErrors,
  };
}
