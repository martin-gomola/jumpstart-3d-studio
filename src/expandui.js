// The Expandable window (Advanced → Modify → Advanced Modify, and Chisel): make a shape into a
// stack of sliding rings, watch it stretch out and fold back (Play), look inside with the
// cut-away view, then add the rings to the design.
import * as THREE from "three";
import { el } from "./util.js";
import { store, findBody } from "./store.js";
import { addMeshBodies } from "./lsimport.js";
import { expandableFromMesh, EXPAND_DEFAULTS, EXPAND_PRESETS } from "./expand.js";

const PREF = "jumpstart3d.expandable";

// src: { V, I (mm, Z up), name, bodyId? }
export function openExpandable(app, src) {
  document.getElementById("xp-modal")?.remove();
  let pref = {}; try { pref = JSON.parse(localStorage.getItem(PREF) || "{}") || {}; } catch (e) {}
  const o = { ...EXPAND_DEFAULTS, ...pref };
  const st = { res: null, busy: false, playing: false, s: 0, dirn: 1, cut: false, hide: true, speed: 1, spin: 0 };

  const wrap = el("div", { id: "xp-modal", role: "dialog", "aria-modal": "true", "aria-label": "Expandable", style: { position: "fixed", inset: "0", zIndex: "3000", background: "rgba(10,14,20,.55)", display: "flex", alignItems: "center", justifyContent: "center" } });
  const box = el("div", { style: { width: "min(1100px,96vw)", height: "min(720px,92vh)", background: "var(--panel,#fff)", color: "var(--text,#1b2330)", borderRadius: "12px", display: "flex", overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,.35)" } });
  const side = el("div", { style: { width: "300px", minWidth: "260px", padding: "14px", overflowY: "auto", borderRight: "1px solid var(--line,#d6dbe3)", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" } });
  const view = el("div", { style: { flex: "1", position: "relative", background: "#20262f", touchAction: "none" } });
  box.append(side, view); wrap.append(box); document.body.append(wrap);

  // ---------------- the viewer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.localClippingEnabled = true;
  view.append(renderer.domElement);
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#20262f");
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1, -1.4, 2); scene.add(sun);
  const back = new THREE.DirectionalLight(0xffffff, 0.5); back.position.set(-1, 1, 0.5); scene.add(back);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  cam.up.set(0, 0, 1);
  const root = new THREE.Group(); scene.add(root);
  const clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let center = new THREE.Vector3(), radius = 50, az = -0.9, el2 = 0.35, dist = 3;
  const place = () => {
    const r = radius * dist;
    cam.position.set(center.x + r * Math.cos(el2) * Math.cos(az), center.y + r * Math.cos(el2) * Math.sin(az), center.z + r * Math.sin(el2));
    cam.lookAt(center);
  };
  const resize = () => {
    const w = view.clientWidth || 600, hh = view.clientHeight || 400;
    renderer.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix();
  };
  const meshOf = (V, I, color) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(V instanceof Float32Array ? V : Float32Array.from(V), 3));
    g.setIndex(new THREE.BufferAttribute(I instanceof Uint32Array ? I : Uint32Array.from(I), 1));
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.02, side: THREE.DoubleSide, clippingPlanes: [] }));
  };
  const clearRoot = () => { for (const m of [...root.children]) { root.remove(m); m.geometry.dispose(); m.material.dispose(); } };
  const frame = () => {
    const b = new THREE.Box3().setFromObject(root);
    if (b.isEmpty()) return;
    // room for the whole stretch
    if (st.res) { const ex = st.res.travel * (st.res.rings - 1); b.expandByVector(new THREE.Vector3(0, 0, ex / 2)); b.translate(new THREE.Vector3(0, 0, (st.res.axis[2] * ex) / 2)); }
    b.getCenter(center); radius = b.getSize(new THREE.Vector3()).length() / 2 || 50;
    clip.constant = -center.y;
    place();
  };
  const showSource = () => { clearRoot(); root.add(meshOf(src.V, src.I, "#c9ccd2")); frame(); };
  const applyCut = () => { for (const m of root.children) { m.material.clippingPlanes = st.cut ? [clip] : []; m.material.needsUpdate = true; } };
  const pose = () => {
    if (!st.res) return;
    // 0..1 stretches out to the stop; 1..2 (when the rings come apart) takes them apart
    const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
    const R = st.res, e = ease(Math.min(1, st.s)), x = st.s > 1 ? ease(Math.min(1, st.s - 1)) : 0;
    const rate = R.travel > 0 ? R.twist / R.travel : 0, [cx, cy] = R.center || [0, 0];
    for (const m of root.children) {
      const k = m.userData.ring;
      const dz = R.axis[2] * k * (R.travel * e + R.apart * x);
      let th = 0;
      if (R.motion === "twist") th = k * (R.twist * e + rate * R.apart * x);
      else if (R.motion === "spin") th = k * st.spin * (k % 2 ? -1 : 1) * (1 + 0.15 * k);
      const co = Math.cos(th), si = Math.sin(th);
      m.rotation.set(0, 0, th);
      m.position.set(cx - (co * cx - si * cy), cy - (si * cx + co * cy), dz);
    }
    const sl = document.getElementById("xp-slider"); if (sl && document.activeElement !== sl) sl.value = String(Math.round(st.s * 100));
  };
  let raf = 0, last = 0, alive = true;
  const loop = (t) => {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0; last = t;
    if (st.playing && st.res) {
      const top = st.res.latch === "lock" ? 1 : 2;
      st.s += st.dirn * dt * 0.45 * st.speed;
      if (st.s >= top) { st.s = top; st.dirn = -1; } else if (st.s <= 0) { st.s = 0; st.dirn = 1; }
      if (st.res.motion === "spin") st.spin += dt * 1.6 * st.speed;
      pose();
    }
    renderer.render(scene, cam);
  };
  // orbit: drag to turn, wheel or pinch to zoom
  const pts = new Map(); let pinch0 = 0;
  view.addEventListener("pointerdown", (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); view.setPointerCapture(e.pointerId); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  view.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    if (pts.size === 2) { pts.set(e.pointerId, [e.clientX, e.clientY]); const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0) dist = Math.max(0.8, Math.min(8, dist * (pinch0 / d))); pinch0 = d; place(); return; }
    az -= (e.clientX - p[0]) * 0.008; el2 = Math.max(-1.45, Math.min(1.45, el2 + (e.clientY - p[1]) * 0.008));
    pts.set(e.pointerId, [e.clientX, e.clientY]); place();
  });
  const up = (e) => { pts.delete(e.pointerId); pinch0 = 0; };
  view.addEventListener("pointerup", up); view.addEventListener("pointercancel", up);
  view.addEventListener("wheel", (e) => { e.preventDefault(); dist = Math.max(0.8, Math.min(8, dist * Math.exp(e.deltaY * 0.001))); place(); }, { passive: false });
  const ro = new ResizeObserver(resize); ro.observe(view);
  resize(); showSource(); raf = requestAnimationFrame(loop);

  // ---------------- the panel
  const close = () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); clearRoot(); renderer.dispose(); wrap.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  const msg = el("div", { id: "xp-msg", class: "hint", style: { padding: "2px 0", minHeight: "1.2em" } });
  const say = (m) => { msg.textContent = m; };
  const num = (label, k, opt) => {
    const i = el("input", { type: "number", id: "xp-" + k, value: String(o[k]), min: String(opt.min), max: String(opt.max), step: String(opt.step), style: { width: "100%" } });
    i.onchange = () => { let v = +i.value; if (!isFinite(v)) v = EXPAND_DEFAULTS[k]; v = Math.max(opt.min, Math.min(opt.max, v)); if (opt.int) v = Math.round(v); o[k] = v; i.value = String(v); };
    return el("label", { style: { display: "flex", flexDirection: "column", gap: "2px", flex: "1" } }, el("span", {}, label), i);
  };
  const seg = (label, k, opts, redraw) => {
    const g = el("div", { class: "seg", id: "xp-" + k, style: { display: "flex", flexWrap: "wrap" } });
    const draw = () => { g.innerHTML = ""; for (const [v, t] of opts) g.append(el("button", { "aria-pressed": String(o[k] === v), "data-v": String(v), onclick: () => { o[k] = v; redraw ? drawOpts() : draw(); } }, t)); };
    draw();
    return el("div", {}, el("div", { style: { marginBottom: "2px" } }, label), g);
  };
  const btn = (id, text, fn, primary) => el("button", { id, class: primary ? "primary" : "", style: { padding: "7px 10px" }, onclick: fn }, text);
  const two = (...k) => el("div", { style: { display: "flex", gap: "8px" } }, ...k);
  const playBtn = btn("xp-play", "▶ Play", () => { if (!st.res) return; st.playing = !st.playing; playBtn.textContent = st.playing ? "❚❚ Pause" : "▶ Play"; });
  playBtn.disabled = true;
  const slider = el("input", { type: "range", id: "xp-slider", min: "0", max: "200", value: "0", disabled: true, style: { width: "100%" }, "aria-label": "How far it is stretched" });
  slider.oninput = () => { st.s = +slider.value / 100; st.playing = false; playBtn.textContent = "▶ Play"; pose(); };
  const addBtn = btn("xp-add", "Add rings to the design", () => add(), true);
  addBtn.disabled = true;
  const makeBtn = btn("xp-make", "Make it expandable", () => make(), true);
  const cutBox = el("input", { type: "checkbox", id: "xp-cut", onchange: (e) => { st.cut = e.target.checked; applyCut(); } });
  const hideBox = el("input", { type: "checkbox", id: "xp-hide", checked: true, onchange: (e) => { st.hide = e.target.checked; } });
  const speed = el("select", { id: "xp-speed", onchange: (e) => { st.speed = +e.target.value; } }, ...[["0.5", "Slow"], ["1", "Normal"], ["2", "Fast"]].map(([v, t]) => el("option", { value: v, selected: v === "1" }, t)));

  const optsBox = el("div", { id: "xp-opts", style: { display: "flex", flexDirection: "column", gap: "8px" } });
  function drawOpts() {
    optsBox.innerHTML = "";
    const pre = el("div", { class: "seg", id: "xp-presets", style: { display: "flex", flexWrap: "wrap" } });
    for (const [k, p] of Object.entries(EXPAND_PRESETS)) {
      const on = Object.entries(p).every(([kk, vv]) => kk === "name" || o[kk] === vv);
      pre.append(el("button", { "aria-pressed": String(on), "data-v": k, onclick: () => { for (const [kk, vv] of Object.entries(p)) if (kk !== "name") o[kk] = vv; drawOpts(); } }, p.name));
    }
    optsBox.append(
      el("div", {}, el("div", { style: { marginBottom: "2px" } }, "Fidget style"), pre),
      seg("Motion", "motion", [["slide", "Slide"], ["twist", "Twist"], ["spin", "Slide & spin"]], true),
    );
    if (o.motion === "twist") optsBox.append(two(num("Twist per ring (°)", "twist", { min: 15, max: 720, step: 15 }), num("Tabs", "tabs", { min: 1, max: 6, step: 1, int: true })));
    optsBox.append(
      seg("Parts", "catch", [["lock", "Stay together"], ["snap", "Snap apart"], ["apart", "Come apart freely"]], true),
      two(num("Rings", "n", { min: 2, max: 12, step: 1, int: true }), num("Wall (mm)", "wall", { min: 1.2, max: 10, step: 0.2 })),
      two(num("Clearance (mm)", "clear", { min: 0.15, max: 1.5, step: 0.05 }), num("Stretch (%)", "stretch", { min: 20, max: 85, step: 5 })),
    );
    if (o.motion === "slide") optsBox.append(two(num("Tilt of cuts (°)", "tilt", { min: -40, max: 40, step: 5 })));
    optsBox.append(
      seg("Ring heights", "spacing", [["even", "Even"], ["graded", "Taller toward the wide end"]]),
      seg("Slides out", "dir", [["auto", "Auto"], ["down", "Downward"], ["up", "Upward"]]),
      seg("Bottom", "bottom", [["open", "Open"], ["closed", "Closed"]]),
      seg("Detail", "detail", [[1, "Normal"], [2.5, "Fine (slower)"]]),
      el("div", { class: "hint" }, o.motion === "twist" ? "Twist: tabs on each ring run in spiral grooves in the next, so the rings screw out as you pull (or turn them)." : o.motion === "spin" ? "Slide & spin: each ring also spins freely all the way round, like fidget rings. Round shapes work best for turning rings." : "Slide: the rings slide straight out.") ,
    );
  }
  drawOpts();

  side.append(
    el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, el("h3", { style: { margin: "0", fontSize: "16px" } }, "Expandable"), el("button", { id: "xp-close", "aria-label": "Close", title: "Close (Esc)", onclick: close }, "✕")),
    el("div", { class: "hint" }, `${src.name || "Shape"}: it becomes a hollow stack of rings that slide, twist or spin out of each other, printed in one piece (no supports between the rings). They can stay together, snap apart or come apart freely. Make it, then press Play to watch it move.`),
    optsBox,
    makeBtn, msg,
    el("div", { style: { borderTop: "1px solid var(--line,#d6dbe3)", paddingTop: "8px", display: "flex", flexDirection: "column", gap: "6px" } },
      el("b", {}, "Simulation"),
      two(playBtn, el("label", { style: { display: "flex", alignItems: "center", gap: "4px" } }, "Speed", speed)),
      el("label", {}, "Stretch it by hand", slider),
      el("div", { class: "hint", id: "xp-simhint" }, ""),
      el("label", { class: "check" }, cutBox, " Cut-away view (see the lips and feet)")),
    el("div", { style: { borderTop: "1px solid var(--line,#d6dbe3)", paddingTop: "8px", display: "flex", flexDirection: "column", gap: "6px" } },
      src.bodyId ? el("label", { class: "check" }, hideBox, " Hide the original shape") : "",
      addBtn),
    el("div", { class: "hint" }, "Tips: shapes with fairly upright sides work best (ghosts, pumpkins, bottles, rockets). Tilt the cuts for slanted bands like the ghost photos. Print with the rings collapsed, as they come out; a 0.4 mm clearance suits most printers."),
  );

  for (const k of side.children) k.style.flexShrink = "0";

  async function make() {
    if (st.busy) return;
    try { localStorage.setItem(PREF, JSON.stringify(o)); } catch (e) {}
    st.busy = true; makeBtn.disabled = true; addBtn.disabled = true; playBtn.disabled = true; slider.disabled = true;
    st.playing = false; playBtn.textContent = "▶ Play";
    try {
      const r = await expandableFromMesh(src.V, src.I, o, say);
      st.res = r; st.s = 0; st.dirn = 1; st.spin = 0;
      slider.max = r.latch === "lock" ? "100" : "200";
      document.getElementById("xp-simhint").textContent = r.latch === "lock" ? "" : "Past 100% the slider takes the rings apart" + (r.motion === "twist" ? " (unscrewing them)." : ".");
      clearRoot();
      r.parts.forEach((p) => { const m = meshOf(p.V, p.I, p.ring % 2 ? "#e8b04a" : "#f3efe6"); m.userData.ring = p.ring; root.add(m); });
      applyCut(); frame(); pose();
      say(r.info + " Press Play to watch it.");
      playBtn.disabled = false; slider.disabled = false; addBtn.disabled = false;
      // show it moving straight away
      st.playing = true; playBtn.textContent = "❚❚ Pause";
    } catch (e) {
      console.error(e); say("Couldn't make it: " + e.message); st.res = null; showSource();
    } finally { st.busy = false; makeBtn.disabled = false; }
  }
  function add() {
    const r = st.res; if (!r) return;
    const ids = addMeshBodies(app, r.parts.map((p) => ({ name: p.name, color: p.color, V: p.V, I: p.I })), "Expandable");
    const base = src.name || "Shape";
    store.update((doc) => {
      ids.forEach((id, i) => { const b = findBody(doc, id); if (b) { b.name = base + " · " + r.parts[i].name.toLowerCase(); b.expand = { ring: r.parts[i].ring, axis: r.axis, travel: r.travel, motion: r.motion, latch: r.latch }; } });
      if (src.bodyId && st.hide) { const b = findBody(doc, src.bodyId); if (b) b.hidden = true; }
    }, "Name the rings");
    app.toast(`Added ${r.parts.length} rings to the design.` + (src.bodyId && st.hide ? " The original shape is hidden (show it again in the Browser)." : "") + (src.fromChisel ? " Leave Chisel to see them." : ""));
    close();
  }
  return { close, make: () => make() };
}
