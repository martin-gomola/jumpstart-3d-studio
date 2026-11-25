// Flower Studio window (Beginner → Makers → Flower Studio, Advanced → Simulate → Makers, or
// Search tools): pick from dozens of flowers, lifelike or mechanical, with fixed, hinged or
// flexible petals; watch them bloom; build arrangements in vases, bowls, baskets and bouquets;
// then add every part to the design.
import * as THREE from "three";
import { el, makeZip } from "./util.js";
import { stlFile, threeMFFile } from "./archland.js";
import { picture, instructionsPDF } from "./flowerpdf.js";
import { addMeshBodies } from "./lsimport.js";
import { store, findBody } from "./store.js";
import { TREES, TREE_CATS, treeById, treeColors, buildTree, buildGrove, SEASONS, TREE_BASES, TREE_SCALES } from "./trees.js";
import { FLOWERS, FLOWER_CATS, byId, buildFlower, buildArrangement, petalMatrix, colorsFor, CONTAINERS, LAYOUTS, WREATH_LAYOUTS, PEG, SNAP, standMesh, STAND_TOP, layoutPieces, KIT, KIT_STAND_TOP, kitStand, kitSlot } from "./flowers.js";

const PREF = "jumpstart3d.flowers";
const PRESETS = [
  { name: "Wedding bouquet", container: "wrap", layout: "posy", style: "life", items: [["gardenrose", 4, "#f5f3ee"], ["peony", 2, "#f7c6d4"], ["lisianthus", 2, "#c3a6e0"], ["babysbreath", 3], ["eucalyptus", 3]] },
  { name: "Spring vase", container: "vase", layout: "dome", style: "life", items: [["tulip", 4, "#f28cb1"], ["daffodil", 3], ["hyacinth", 2, "#3f6fd8"], ["crocus", 2, "#7b3fa0"]] },
  { name: "Sunny jar", container: "bud", layout: "fan", style: "life", items: [["sunflower", 2], ["daisy", 3], ["rudbeckia", 2], ["wheat", 3]] },
  { name: "Tropical", container: "bowl", layout: "dome", style: "life", items: [["hibiscus", 2], ["birdofparadise", 1], ["orchid", 2, "#c2185b"], ["plumeria", 3], ["fern", 2]] },
  { name: "Wildflower basket", container: "basket", layout: "dome", style: "life", items: [["poppy", 3], ["cosmos", 3], ["queenanne", 2], ["lavender", 4], ["forgetmenot", 2]] },
  { name: "Robot garden", container: "pot", layout: "fan", style: "mech", items: [["tulip", 3], ["daisy", 2], ["lily", 2], ["sunflower", 1], ["lavender", 3]] },
  // wreaths (flat rings that hang on a wall; the size is the outside diameter)
  { name: "Autumn wreath", container: "wreath", layout: "ring", style: "life", height: 230, items: [["dahlia", 3, "#d9531e"], ["sunflower", 2], ["rudbeckia", 3], ["wheat", 3], ["eucalyptus", 3]] },
  { name: "Spring wreath", container: "wreath", layout: "crescent", style: "life", height: 230, items: [["peony", 2, "#f7c6d4"], ["tulip", 2, "#f28cb1"], ["daffodil", 2], ["lavender", 3], ["fern", 2]] },
  { name: "Robot wreath", container: "wreath", layout: "ring", style: "mech", height: 230, items: [["tulip", 3], ["daisy", 3], ["lily", 2], ["rose", 2], ["lavender", 3]] },
];

export function openFlowers(app) {
  document.getElementById("fl-modal")?.remove();
  let pref = {}; try { pref = JSON.parse(localStorage.getItem(PREF) || "{}") || {}; } catch (e) {}
  const st = {
    tab: pref.tab || "one", id: pref.id || "rose", style: pref.style || "life", petals: pref.petals || "fixed", colors: null, scale: 100, stemLen: 150, bloom: 1, playing: false, dirn: -1,
    arr: pref.arr || { container: "vase", layout: "dome", height: 230, seed: 1, items: [{ id: "rose", n: 3 }, { id: "tulip", n: 3 }, { id: "babysbreath", n: 2 }, { id: "eucalyptus", n: 2 }] },
    search: "", built: null, fly: 0,
    // printing: the whole flower in one go, or in pieces that push together; STL or 3MF
    out: pref.out || "whole", fmt: pref.fmt || "3mf", holder: null,
    // the tree maker: one tree or a grove, for miniatures and model scenery
    tree: { id: "oak", season: "summer", scale: "28", size: 80, base: "r32", grove: false, seed: 1, gsize: 120, shape: "round", items: [{ id: "oak", n: 1 }, { id: "pine", n: 2 }, { id: "bush", n: 2 }], ...(pref.tree || {}) }, tcol: {},
  };
  // a tree's height on the model: the real tree's height at the chosen scale (or any size)
  // (compressed to half, as model scenery usually is: full-height trees would tower over the table)
  const TREE_COMPRESS = 0.5;
  const treeH = (sp) => { const sc = TREE_SCALES.find((x) => x[0] === st.tree.scale); return sc && sc[2] ? Math.max(15, Math.min(250, Math.round((sp.real * 1000 * TREE_COMPRESS) / sc[2]))) : st.tree.size; };
  const tColors = (sp) => ({ ...treeColors(sp, st.style, st.tree.season), ...st.tcol });
  const resetColors = () => { st.colors = colorsFor(byId(st.id), st.style); st.colors.container = st.style === "mech" ? "#8a949e" : "#e9e4da"; };
  resetColors();

  const wrap = el("div", { id: "fl-modal", role: "dialog", "aria-modal": "true", "aria-label": "Flower Studio", style: { position: "fixed", inset: "0", zIndex: "3000", background: "rgba(10,14,20,.55)", display: "flex", alignItems: "center", justifyContent: "center" } });
  const box = el("div", { style: { width: "min(1200px,97vw)", height: "min(780px,94vh)", background: "var(--panel,#fff)", color: "var(--text,#1b2330)", borderRadius: "12px", display: "flex", overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,.35)" } });
  const side = el("div", { id: "fl-side", style: { width: "340px", minWidth: "280px", padding: "12px", overflowY: "auto", borderRight: "1px solid var(--line,#d6dbe3)", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" } });
  const view = el("div", { style: { flex: "1", position: "relative", background: "linear-gradient(#eef3f6,#cfd9e0)", touchAction: "none" } });
  box.append(side, view); wrap.append(box); document.body.append(wrap);

  // ---------------- viewer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  view.append(renderer.domElement);
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7d6a, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(1.2, -1.5, 2.2); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xfff2e0, 0.5); fill.position.set(-1, 1, 0.6); scene.add(fill);
  const cam = new THREE.PerspectiveCamera(32, 1, 1, 5000); cam.up.set(0, 0, 1);
  const root = new THREE.Group(); scene.add(root);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshStandardMaterial({ color: 0xdfe6ea, roughness: 1 })); ground.position.z = -0.5; scene.add(ground);
  let center = new THREE.Vector3(0, 0, 80), radius = 120, az = -1.15, el2 = 0.3, dist = 3.6;
  const place = () => { const r = radius * dist; cam.position.set(center.x + r * Math.cos(el2) * Math.cos(az), center.y + r * Math.cos(el2) * Math.sin(az), center.z + r * Math.sin(el2)); cam.lookAt(center); };
  const resize = () => { const w = view.clientWidth || 600, h = view.clientHeight || 400; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  const mats = new Map();
  const mat = (color) => { const k = color + st.style; if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: st.style === "mech" ? 0.35 : 0.6, metalness: st.style === "mech" ? 0.65 : 0.0, side: THREE.DoubleSide })); return mats.get(k); };
  const geo = (m) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(m.V), 3)); g.setIndex(m.I); g.computeVertexNormals(); return g; };
  const clear = () => { for (const c of [...root.children]) { root.remove(c); c.traverse((o) => o.geometry && o.geometry.dispose()); } };
  // petals that bloom: one object per petal, moved by its own matrix
  let bloomers = [];
  function show(parts) {
    clear(); bloomers = [];
    const geos = new Map();
    for (const p of parts) {
      if (p.head) {
        const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(p.head.M); root.add(g);
        for (const pt of p.head.petals) {
          if (!geos.has(pt.mesh)) geos.set(pt.mesh, geo(pt.mesh));
          const m = new THREE.Mesh(geos.get(pt.mesh), mat(p.color)); m.matrixAutoUpdate = false; g.add(m); bloomers.push({ m, pt });
        }
      } else root.add(new THREE.Mesh(geo(p.mesh), mat(p.color)));
    }
    pose();
  }
  const pose = () => { for (const b of bloomers) b.m.matrix.copy(petalMatrix(b.pt, st.bloom)); const s = document.getElementById("fl-bloom"); if (s && document.activeElement !== s) s.value = String(Math.round(st.bloom * 100)); };
  const frame = () => { root.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(root); if (b.isEmpty()) return; b.getCenter(center); radius = b.getSize(new THREE.Vector3()).length() / 2 || 80; place(); };
  let raf = 0, last = 0, alive = true;
  const loop = (t) => {
    if (!alive) return; raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0; last = t;
    if (st.playing) { st.bloom += st.dirn * dt * 0.4; if (st.bloom <= 0) { st.bloom = 0; st.dirn = 1; } if (st.bloom >= 1) { st.bloom = 1; st.dirn = -1; } pose(); }
    renderer.render(scene, cam);
  };
  const pts = new Map(); let pinch0 = 0;
  view.addEventListener("pointerdown", (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); view.setPointerCapture(e.pointerId); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  view.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    if (pts.size === 2) { pts.set(e.pointerId, [e.clientX, e.clientY]); const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0) dist = Math.max(0.6, Math.min(8, dist * (pinch0 / d))); pinch0 = d; place(); return; }
    az -= (e.clientX - p[0]) * 0.008; el2 = Math.max(-0.2, Math.min(1.45, el2 + (e.clientY - p[1]) * 0.008)); pts.set(e.pointerId, [e.clientX, e.clientY]); place();
  });
  const up = (e) => { pts.delete(e.pointerId); pinch0 = 0; };
  view.addEventListener("pointerup", up); view.addEventListener("pointercancel", up);
  view.addEventListener("wheel", (e) => { e.preventDefault(); dist = Math.max(0.6, Math.min(8, dist * Math.exp(e.deltaY * 0.001))); place(); }, { passive: false });
  const ro = new ResizeObserver(resize); ro.observe(view);
  resize(); raf = requestAnimationFrame(loop);

  // ---------------- building
  const opts = () => ({ style: st.style, petals: st.petals, bloom: st.bloom, printOpen: st.bloom, colors: st.colors, scale: st.scale / 100 });
  let timer = 0;
  function rebuild(refit = false) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const o = opts();
        // the shape is built fully open; the viewer opens and closes the petals
        st.built = makeParts({ ...o, bloom: 1, printOpen: 1 });
        show(st.built);
        if (refit || !st.fly) { frame(); st.fly = 1; }
        info();
      } catch (e) { console.error(e); say("Couldn't build it: " + e.message); }
    }, 60);
  }
  // the parts as they'll print: whole (as it stands) or in pieces laid out on the plate. Hinged
  // petals are always made open (their clearances are worked out open); fixed petals as the slider shows
  // forPrint: laid out for the plate. Snap-in petals always print on their own, lying flat (with a whole
  // flower or arrangement standing among them); the view shows them in place unless printing in pieces
  function makeParts(o, forPrint, assembled) {
    const pieces = st.out === "pieces";
    const oo = { ...o, joints: pieces ? {} : null };
    let parts;
    st.holder = null;
    if (st.tab === "tree") {
      const T = st.tree, sp = treeById(T.id);
      // (a grove: each tree at its own species' height for the scale)
      parts = T.grove ? buildGrove({ items: T.items, size: T.gsize, shape: T.shape, seed: T.seed }, { ...oo, season: T.season, height: (() => { const sc = TREE_SCALES.find((x) => x[0] === T.scale); return sc && sc[2] ? Math.round((15000 * TREE_COMPRESS) / sc[2]) : T.size; })(), colors: tColors(sp), base: T.base }).parts
        : buildTree(sp, { ...oo, season: T.season, height: treeH(sp), base: T.base, colors: tColors(sp) }, [0, 0, 0], T.seed);
      st.wreath = null;
    } else if (st.tab === "one") {
      const zt = pieces ? KIT_STAND_TOP : STAND_TOP(false), sp = byId(st.id), base = [0, 0, zt], top = [0, 0, Math.max(st.stemLen, zt + 30)];
      parts = buildFlower(sp, oo, base, top, [0, 0, 1], 7);
      // (in pieces: a stand with a slot for the stem's fork, printed upside down)
      if (pieces) parts.unshift({ name: "Stand", color: st.colors.container, mesh: kitStand(parts.filter((q) => q.slot).map((q) => kitSlot(q.slot.at, q.slot.u, q.slot.s, zt))), piece: "stand", frame: new THREE.Matrix4().makeRotationX(Math.PI) });
      else parts.unshift({ name: "Stand", color: st.colors.container, mesh: standMesh(false), piece: "stand" });
      st.wreath = null;
    } else {
      const r = buildArrangement({ ...st.arr }, oo);
      parts = r.parts; st.holder = r.holder; st.wreath = r.wreath || null;
    }
    if (assembled) return parts;
    if (pieces) return layoutPieces(parts, { width: 240 });
    if (forPrint && parts.some((p) => p.snapPetal)) return layoutPieces(parts.map((p) => (p.snapPetal ? p : { ...p, piece: "assembly", frame: undefined })), { width: 240 });
    return parts;
  }
  const say = (m) => { const e = document.getElementById("fl-msg"); if (e) e.textContent = m; };
  function info() {
    if (!st.built) return;
    const tris = st.built.reduce((s, p) => s + p.mesh.I.length / 3, 0);
    const hinged = st.built.reduce((s, p) => s + (p.head ? p.head.petals.filter((q) => q.hinged).length : 0), 0);
    const pcs = new Set(st.built.map((p) => p.piece || p.name)).size;
    if (st.tab === "tree") {
      const sp = treeById(st.tree.id), nl = st.built.filter((p) => p.kitLayer).length;
      say(`${st.built.length} parts, ${tris.toLocaleString()} triangles. ${st.tree.grove ? "A grove" : sp.name + ", " + treeH(sp) + " mm tall"} for ${(TREE_SCALES.find((x) => x[0] === st.tree.scale) || [0, "any size"])[1]} miniatures.` + (st.out === "pieces" ? ` In pieces: ${pcs} pieces, all printing with no supports. The trunk stands up on its base (branches lean no more than 45 degrees); the ${nl} foliage layers print flat and each snaps sideways onto a neck through its slit, resting on a collar under a lip.` : " Whole: one print standing up; turn on tree supports for the foliage."));
      return;
    }
    const tipsP = st.out !== "pieces" ? "" : ` In pieces: ${pcs} pieces, each lying on a flat side so nothing needs supports. Stems are flat strips with a snap fork at each end that clicks through a slot (${KIT.holeFit} mm fit); heads sit on a flat star and snap onto their stem's top fork; petal layers slide sideways onto the head's neck through their slit and are held by its lip, the centre going on last.` + (st.holder ? ` The ${st.wreath ? "ring" : "holder"} has ${st.holder.sockets} slot${st.holder.sockets === 1 ? "" : "s"} for ${st.holder.stems} stems${st.holder.sockets < st.holder.stems ? ` (this container only has room for ${st.holder.sockets}: glue the rest, pick a wider container, or use fewer flowers)` : ""}.` + (st.holder.touching ? ` ${st.holder.touching} pairs of flowers may still touch: try Shuffle or a taller Height.` : " Stems are straight and spaced so each one goes in on its own.") : "");
    const tips = st.petals === "hinged" ? (hinged ? ` ${hinged} petals swing on print-in-place pins (0.4 mm gap round each pin and knuckle, 0.5 mm between petals); they're made open, so print them open and move them gently once cool.` : " These petals stay fixed: hinges need up to 12 petals evenly round the flower with room for the pins (tulip, lily, cosmos, rose's outer petals); petals at uneven angles (pansy, violet, orchid, bird of paradise) or very many small ones can't swing free.") : st.petals === "flex" ? " Each petal has a thin strip at its base that bends: print in PETG or TPU, or PLA for gentle flexing." : "";
    const snaps = st.built.filter((p) => p.snapPetal).length;
    const tipsS = st.petals !== "snap" ? "" : snaps ? ` ${snaps} snap-in petals print flat (${SNAP.t} mm thick, no supports) beside the rest. Push each petal's tab into its slot in the flower's crown until it clicks: the slot is ${SNAP.fit} mm bigger all round, and the tab's two prongs squeeze together and spring open behind the panel.` : " These petals stay fixed: snap-in needs up to 16 petals at least 12 mm long, evenly round the flower (not daisies, sunflowers, mums, pansies or orchids).";
    const tipsW = st.wreath ? ` Wreath: ${st.wreath.Dw} mm across, lying flat to print, with a loop to hang it by.${st.wreath.size < 100 ? ` In pieces the flowers are made ${st.wreath.size}% size so each has its own room round the ring and none touch as you push them in.` : ""}${st.wreath.grew > 0 ? ` The wreath also grew ${st.wreath.grew} mm to fit them all: use fewer flowers for a smaller one.` : ""}` : "";
    say(`${st.built.length} parts, ${tris.toLocaleString()} triangles.${tips}${tipsS}${tipsW}${tipsP}`);
  }

  // ---------------- panel
  const close = () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); clear(); renderer.dispose(); wrap.remove(); document.removeEventListener("keydown", onKey, true); try { localStorage.setItem(PREF, JSON.stringify({ tab: st.tab, id: st.id, style: st.style, petals: st.petals, out: st.out, fmt: st.fmt, arr: st.arr, tree: st.tree })); } catch (e) {} };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  const seg = (id, opts2, val, pick) => el("div", { class: "seg", id, style: { display: "flex", flexWrap: "wrap" } }, ...opts2.map(([v, t]) => el("button", { "aria-pressed": String(val === v), "data-v": String(v), onclick: () => pick(v) }, t)));
  const lab = (t, ...k) => el("div", {}, el("div", { style: { margin: "2px 0" } }, t), ...k);
  const colorIn = (k, label) => el("label", { style: { display: "flex", alignItems: "center", gap: "4px" } }, el("input", { type: "color", id: "fl-c-" + k, value: st.colors[k], oninput: (e) => { st.colors[k] = e.target.value; rebuild(); } }), label);
  function draw() {
    side.innerHTML = "";
    side.append(el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, el("h3", { style: { margin: 0, fontSize: "16px" } }, "Flower Studio"), el("button", { id: "fl-close", "aria-label": "Close", title: "Close (Esc)", onclick: close }, "✕")));
    side.append(seg("fl-tab", [["one", "One flower"], ["arr", "Arrangement"], ["tree", "Miniature trees"]], st.tab, (v) => { st.tab = v; st.fly = 0; draw(); rebuild(true); }));
    side.append(lab("Look", seg("fl-style", [["life", "Lifelike"], ["mech", "Mechanical / robotic"]], st.style, (v) => { st.style = v; resetColors(); st.tcol = {}; draw(); rebuild(); })));
    if (st.tab === "tree") { drawTree(); return; }
    side.append(lab("Petals", seg("fl-petals", [["fixed", "Fixed"], ["hinged", "Hinged (they swing)"], ["flex", "Flexible (they bend)"], ["snap", "Snap-in (print flat)"]], st.petals, (v) => { st.petals = v; draw(); rebuild(); })));
    if (st.tab === "one") {
      const q = el("input", { type: "search", id: "fl-search", placeholder: `Find a flower (${FLOWERS.length} kinds)…`, value: st.search, style: { width: "100%" }, oninput: (e) => { st.search = e.target.value; drawList(); } });
      const list = el("div", { id: "fl-list", style: { maxHeight: "250px", overflowY: "auto", border: "1px solid var(--line,#d6dbe3)", borderRadius: "8px", padding: "4px" } });
      const drawList = () => {
        list.innerHTML = "";
        const s = st.search.toLowerCase().trim();
        for (const cat of FLOWER_CATS) {
          const fs = FLOWERS.filter((f) => f.cat === cat && (!s || f.name.toLowerCase().includes(s) || cat.toLowerCase().includes(s)));
          if (!fs.length) continue;
          list.append(el("div", { style: { fontSize: "11px", fontWeight: 700, opacity: 0.7, margin: "4px 2px 2px", textTransform: "uppercase" } }, cat));
          const g = el("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px" } });
          for (const f of fs) g.append(el("button", { class: "chip", "data-flower": f.id, "aria-pressed": String(st.id === f.id), title: f.name, style: { display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 8px", borderRadius: "14px", border: "1px solid var(--line,#d6dbe3)", background: st.id === f.id ? "var(--accent-soft,#dfe9fb)" : "transparent" }, onclick: () => { st.id = f.id; resetColors(); st.fly = 0; draw(); rebuild(true); } }, el("i", { style: { width: "10px", height: "10px", borderRadius: "50%", background: f.colors[0], display: "inline-block", border: "1px solid rgba(0,0,0,.2)" } }), f.name));
          list.append(g);
        }
      };
      drawList();
      side.append(q, list);
      const sp = byId(st.id);
      side.append(lab("Colours", el("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px" } }, colorIn("petal", "Petals"), colorIn("center", "Centre"), colorIn("stem", "Stem"), colorIn("leaf", "Leaves"))));
      side.append(el("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap" } }, ...(st.style === "mech" ? [] : sp.colors).map((c) => el("button", { title: c, "aria-label": "Petal colour " + c, style: { width: "20px", height: "20px", borderRadius: "50%", background: c, border: "1px solid rgba(0,0,0,.25)" }, onclick: () => { st.colors.petal = c; draw(); rebuild(); } }))));
      side.append(el("div", { style: { display: "flex", gap: "8px" } },
        el("label", { style: { flex: 1 } }, "Size %", el("input", { type: "number", id: "fl-size", min: "40", max: "250", step: "10", value: String(st.scale), style: { width: "100%" }, onchange: (e) => { st.scale = Math.max(40, Math.min(250, +e.target.value || 100)); rebuild(true); } })),
        el("label", { style: { flex: 1 } }, "Stem (mm)", el("input", { type: "number", id: "fl-stem", min: "40", max: "300", step: "10", value: String(st.stemLen), style: { width: "100%" }, onchange: (e) => { st.stemLen = Math.max(40, Math.min(300, +e.target.value || 150)); rebuild(true); } }))));
    } else {
      const A = st.arr;
      side.append(lab("Ideas", el("div", { id: "fl-presets", style: { display: "flex", flexWrap: "wrap", gap: "4px" } }, ...PRESETS.map((p, i) => el("button", { class: "chip", "data-preset": String(i), style: { padding: "3px 8px", borderRadius: "14px", border: "1px solid var(--line,#d6dbe3)" }, onclick: () => { st.arr = { ...A, height: p.height || (A.container === "wreath" ? 230 : A.height), container: p.container, layout: p.layout, items: p.items.map(([id, n, c]) => ({ id, n, color: c })) }; st.style = p.style; resetColors(); st.fly = 0; draw(); rebuild(true); } }, p.name)))));
      const sel = (id, list, v, pick) => el("select", { id, onchange: (e) => pick(e.target.value), style: { width: "100%" } }, ...list.map(([k, n]) => el("option", { value: k, selected: k === v }, n)));
      side.append(el("div", { style: { display: "flex", gap: "8px" } }, el("label", { style: { flex: 1 } }, "Container", sel("fl-container", CONTAINERS, A.container, (v) => { const was = A.container; A.container = v; if ((v === "wreath") !== (was === "wreath")) { A.layout = v === "wreath" ? "ring" : "dome"; draw(); } rebuild(true); })), el("label", { style: { flex: 1 } }, "Shape", sel("fl-layout", A.container === "wreath" ? WREATH_LAYOUTS : LAYOUTS, A.layout, (v) => { A.layout = v; rebuild(true); }))));
      const rows = el("div", { id: "fl-items", style: { display: "flex", flexDirection: "column", gap: "4px" } });
      A.items.forEach((it, i) => {
        const sp = byId(it.id);
        rows.append(el("div", { style: { display: "flex", gap: "4px", alignItems: "center" } },
          el("select", { "aria-label": "Flower", "data-row": String(i), style: { flex: 1 }, onchange: (e) => { it.id = e.target.value; it.color = undefined; draw(); rebuild(); } }, ...FLOWER_CATS.map((cat) => el("optgroup", { label: cat }, ...FLOWERS.filter((f) => f.cat === cat).map((f) => el("option", { value: f.id, selected: f.id === it.id }, f.name))))),
          el("input", { type: "number", min: "0", max: "20", value: String(it.n), "aria-label": "How many", style: { width: "48px" }, onchange: (e) => { it.n = Math.max(0, Math.min(20, +e.target.value | 0)); rebuild(); } }),
          el("input", { type: "color", "aria-label": "Colour", value: it.color || (st.style === "mech" ? colorsFor(sp, "mech", i).petal : sp.colors[0]), oninput: (e) => { it.color = e.target.value; rebuild(); } }),
          el("button", { "aria-label": "Remove", title: "Remove", onclick: () => { A.items.splice(i, 1); draw(); rebuild(); } }, "✕")));
      });
      side.append(lab("Flowers", rows), el("div", { style: { display: "flex", gap: "6px" } },
        el("button", { id: "fl-additem", onclick: () => { A.items.push({ id: FLOWERS[(A.items.length * 7) % FLOWERS.length].id, n: 2 }); draw(); rebuild(); } }, "+ Add flowers"),
        el("button", { id: "fl-shuffle", title: "Arrange them a different way", onclick: () => { A.seed = (A.seed || 1) + 1; rebuild(); } }, "Shuffle")));
      // (for a wreath this is its size: the ring's outside diameter)
      const wr = A.container === "wreath", lo = wr ? 140 : 120, hi = wr ? 400 : 320;
      side.append(el("label", {}, wr ? "Wreath size (mm across)" : "Height (mm)", el("input", { type: "number", id: "fl-height", min: String(lo), max: String(hi), step: "10", value: String(A.height), style: { width: "100%" }, onchange: (e) => { A.height = Math.max(lo, Math.min(hi, +e.target.value || 230)); rebuild(true); } })));
      side.append(lab("Colours", el("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px" } }, colorIn("stem", "Stems"), colorIn("leaf", "Leaves"), colorIn("center", "Centres"), colorIn("container", A.container === "wreath" ? "Ring" : "Container"))));
    }
    side.append(el("div", { style: { borderTop: "1px solid var(--line,#d6dbe3)", paddingTop: "8px", display: "flex", flexDirection: "column", gap: "6px" } },
      el("b", {}, "Bloom"),
      el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
        el("button", { id: "fl-play", onclick: (e) => { st.playing = !st.playing; e.currentTarget.textContent = st.playing ? "❚❚ Pause" : "▶ Play bloom"; } }, st.playing ? "❚❚ Pause" : "▶ Play bloom"),
        el("input", { type: "range", id: "fl-bloom", min: "0", max: "100", value: String(Math.round(st.bloom * 100)), style: { flex: 1 }, "aria-label": "Bud to open", oninput: (e) => { st.bloom = +e.target.value / 100; st.playing = false; const b = document.getElementById("fl-play"); if (b) b.textContent = "▶ Play bloom"; pose(); } })),
      el("div", { class: "hint" }, st.petals === "fixed" ? "The flower is made the way the slider shows it: slide toward bud for a closed flower." : "The petals open and close here the way they move on the print. It is made at the slider's position.")));
    printPanel();
  }
  function printPanel() {
    // printing and export
    side.append(el("div", { id: "fl-print", style: { borderTop: "1px solid var(--line,#d6dbe3)", paddingTop: "8px", display: "flex", flexDirection: "column", gap: "6px" } },
      el("b", {}, "Print & export"),
      seg("fl-out", [["whole", st.tab === "tree" ? "Whole tree" : "Whole flower"], ["pieces", "In pieces (snap together)"]], st.out, (v) => { st.out = v; st.fly = 0; draw(); rebuild(true); }),
      el("div", { class: "hint" }, st.out === "pieces" ? (st.tab === "tree" ? "Every piece has a flat side on the plate: the trunk stands on its base, foliage layers lie flat. They snap together, no glue or supports needed." : "Every piece lies on a flat side so nothing overhangs: stems and leaves flat, heads on their flat star, petal layers flat, the stand or holder upside down. Snap forks click through slots with a 0.2 mm fit; no glue or supports needed.") : "One print, standing up as you see it. Hinged petals still swing; each part is its own colour in a 3MF file."),
      el("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
        seg("fl-fmt", [["3mf", "3MF"], ["stl", "STL"]], st.fmt, (v) => { st.fmt = v; draw(); }),
        el("button", { id: "fl-export", style: { flex: 1 }, title: st.fmt === "3mf" ? "3MF keeps each part and its colour (for multi-colour printers)" : st.out === "pieces" ? "One STL file per piece, in a .zip" : "One STL file with the whole flower", onclick: () => exportIt() }, "Export " + (st.fmt === "3mf" ? "3MF" : st.out === "pieces" ? "STLs (.zip)" : "STL"))),
      el("button", { id: "fl-pdf", title: "Assembly instructions as a PDF: what you need, how to print it, and each step with a picture (also saved with every 3MF export)", onclick: () => savePDF() }, "Assembly instructions (PDF)"),
      el("button", { id: "fl-tosim", title: "Open these parts in the 3D Print Sim: supports, layers, print time and G-code", onclick: () => toSim() }, "Send to 3D Print Sim")));
    side.append(el("div", { id: "fl-msg", class: "hint" }, ""));
    side.append(el("button", { id: "fl-add", class: "primary", style: { padding: "8px" }, onclick: () => add() }, st.tab === "one" ? "Add this flower to the design" : st.tab === "tree" ? (st.tree.grove ? "Add the grove to the design" : "Add this tree to the design") : "Add the arrangement to the design"));
    for (const k of side.children) k.style.flexShrink = "0";
    info();
  }
  // ---------------- the tree maker's panel
  function drawTree() {
    const T = st.tree, sp = treeById(T.id);
    const sel = (id, list, v, pick, label) => el("select", { id, "aria-label": label || id, onchange: (e) => pick(e.target.value), style: { width: "100%" } }, ...list.map(([k, n]) => el("option", { value: k, selected: k === v }, n)));
    side.append(seg("fl-tmode", [[false, "One tree"], [true, "A grove"]], T.grove, (v) => { T.grove = v; st.fly = 0; draw(); rebuild(true); }));
    if (!T.grove) {
      const list = el("div", { id: "fl-tlist", style: { maxHeight: "220px", overflowY: "auto", border: "1px solid var(--line,#d6dbe3)", borderRadius: "8px", padding: "4px" } });
      for (const cat of TREE_CATS) {
        list.append(el("div", { style: { fontSize: "11px", fontWeight: 700, opacity: 0.7, margin: "4px 2px 2px", textTransform: "uppercase" } }, cat));
        list.append(el("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px" } }, ...TREES.filter((t) => t.cat === cat).map((t) => el("button", { class: "chip", "data-tree": t.id, "aria-pressed": String(T.id === t.id), style: { display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 8px", borderRadius: "14px", border: "1px solid var(--line,#d6dbe3)", background: T.id === t.id ? "var(--accent-soft,#dfe9fb)" : "transparent" }, onclick: () => { T.id = t.id; st.tcol = {}; st.fly = 0; draw(); rebuild(true); } }, el("i", { style: { width: "10px", height: "10px", borderRadius: "50%", background: t.leaf || t.bark, display: "inline-block", border: "1px solid rgba(0,0,0,.2)" } }), t.name))));
      }
      side.append(list);
    } else {
      const rows = el("div", { id: "fl-titems", style: { display: "flex", flexDirection: "column", gap: "4px" } });
      T.items.forEach((it, i) => rows.append(el("div", { style: { display: "flex", gap: "4px", alignItems: "center" } },
        el("select", { "aria-label": "Tree", "data-trow": String(i), style: { flex: 1 }, onchange: (e) => { it.id = e.target.value; rebuild(); } }, ...TREE_CATS.map((cat) => el("optgroup", { label: cat }, ...TREES.filter((t) => t.cat === cat).map((t) => el("option", { value: t.id, selected: t.id === it.id }, t.name))))),
        el("input", { type: "number", min: "0", max: "12", value: String(it.n), "aria-label": "How many", style: { width: "48px" }, onchange: (e) => { it.n = Math.max(0, Math.min(12, +e.target.value | 0)); rebuild(); } }),
        el("button", { "aria-label": "Remove", title: "Remove", onclick: () => { T.items.splice(i, 1); draw(); rebuild(); } }, "✕"))));
      side.append(lab("Trees", rows), el("div", { style: { display: "flex", gap: "6px" } },
        el("button", { id: "fl-addtree", onclick: () => { T.items.push({ id: TREES[(T.items.length * 5) % TREES.length].id, n: 2 }); draw(); rebuild(); } }, "+ Add trees"),
        el("button", { id: "fl-tshuffle", title: "Place them a different way", onclick: () => { T.seed = (T.seed || 1) + 1; rebuild(); } }, "Shuffle")));
      side.append(el("div", { style: { display: "flex", gap: "8px" } },
        el("label", { style: { flex: 1 } }, "Ground (mm across)", el("input", { type: "number", id: "fl-gsize", min: "60", max: "250", step: "10", value: String(T.gsize), style: { width: "100%" }, onchange: (e) => { T.gsize = Math.max(60, Math.min(250, +e.target.value || 120)); rebuild(true); } })),
        el("label", { style: { flex: 1 } }, "Ground shape", sel("fl-gshape", [["round", "Round"], ["oval", "Oval"], ["hill", "Hill"]], T.shape, (v) => { T.shape = v; rebuild(true); }))));
    }
    side.append(lab("Season", seg("fl-season", SEASONS, T.season, (v) => { T.season = v; st.tcol = {}; draw(); rebuild(); })));
    side.append(el("div", { style: { display: "flex", gap: "8px" } },
      el("label", { style: { flex: 1 } }, "Scale", sel("fl-tscale", TREE_SCALES.map(([k, n]) => [k, n]), T.scale, (v) => { T.scale = v; draw(); rebuild(true); })),
      T.scale === "free" ? el("label", { style: { flex: 1 } }, "Height (mm)", el("input", { type: "number", id: "fl-theight", min: "15", max: "250", step: "5", value: String(T.size), style: { width: "100%" }, onchange: (e) => { T.size = Math.max(15, Math.min(250, +e.target.value || 80)); rebuild(true); } }))
        : el("div", { style: { flex: 1, alignSelf: "end", opacity: 0.8 } }, T.grove ? "Each tree at its real height for the scale" : `${treeH(sp)} mm tall (a ${sp.real} m ${sp.name.toLowerCase()}, compressed to half as model scenery usually is)`)));
    if (!T.grove) side.append(el("div", { style: { display: "flex", gap: "8px" } },
      el("label", { style: { flex: 1 } }, "Base", sel("fl-tbase", TREE_BASES, T.base, (v) => { T.base = v; rebuild(true); })),
      el("button", { id: "fl-tvary", style: { alignSelf: "end" }, title: "Grow this tree a different way", onclick: () => { T.seed = (T.seed || 1) + 1; rebuild(); } }, "Vary")));
    const C = tColors(sp), cIn = (k, label) => el("label", { style: { display: "flex", alignItems: "center", gap: "4px" } }, el("input", { type: "color", id: "fl-tc-" + k, value: C[k], oninput: (e) => { st.tcol[k] = e.target.value; rebuild(); } }), label);
    side.append(lab("Colours", el("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px" } }, cIn("leaf", "Leaves"), cIn("leaf2", "Leaves 2"), cIn("trunk", "Trunk"), cIn("base", "Base"))));
    if (C.bare && !sp.ever) side.append(el("div", { class: "hint" }, "Winter: this tree has lost its leaves (the bare branches print on their own)."));
    printPanel();
  }
  function add() {
    // made at the bloom on the slider
    const parts = makeParts({ ...opts(), bloom: st.bloom, printOpen: 1 }, true);
    const ids = addMeshBodies(app, parts.filter((p) => p.mesh.I.length).map((p) => ({ name: p.name, color: p.color, V: Float32Array.from(p.mesh.V), I: Uint32Array.from(p.mesh.I) })), "Flower Studio");
    // marked, so the parts can be found again (and tutorials can see them)
    store.update((doc) => { for (const id of ids) { const b = findBody(doc, id); if (b) b.flower = { style: st.style, petals: st.petals, kind: st.tab === "one" ? st.id : st.tab === "tree" ? "tree:" + st.tree.id : "arrangement" }; } }, "Flower parts");
    app.toast(`Added ${ids.length} parts to the design. Each part is its own body, so you can recolour, move or print them separately.`);
    close();
  }
  // ---------------- export and print
  const title = () => (st.tab === "tree" ? (st.tree.grove ? "Miniature grove" : "Miniature " + treeById(st.tree.id).name.toLowerCase()) : st.tab === "one" ? byId(st.id).name : st.arr.container === "wreath" ? "Flower wreath" : "Flower arrangement") + (st.out === "pieces" ? " (pieces)" : "");
  const fileName = (t) => t.replace(/[^\w\- ()]+/g, "").trim() || "flower";
  const printParts = () => makeParts({ ...opts(), bloom: st.bloom, printOpen: 1 }, true).filter((p) => p.mesh.I.length);
  const soup = (m) => { const P = new Float32Array(m.I.length * 3); for (let t = 0; t < m.I.length; t++) { const i = m.I[t] * 3; P[t * 3] = m.V[i]; P[t * 3 + 1] = m.V[i + 1]; P[t * 3 + 2] = m.V[i + 2]; } return P; };
  async function exportIt() {
    try {
      say("Exporting…");
      const parts = printParts(), t = title();
      const asParts = (L) => L.map((p) => ({ name: p.name, color: p.color, pos: soup(p.mesh) }));
      let bytes, name;
      if (st.fmt === "3mf") {
        // one object per piece (a whole flower: one object), made of its coloured parts
        const gm = new Map(); parts.forEach((p, i) => { const k = st.out === "pieces" || p.snapPetal || p.piece === "assembly" ? p.piece || p.name : "whole"; if (!gm.has(k)) gm.set(k, []); gm.get(k).push(i); });
        const groups = [...gm].map(([k, ix]) => ({ name: k === "whole" ? t : pieceName(k, ix.map((i) => parts[i])), parts: ix }));
        bytes = await threeMFFile(asParts(parts), 1, [0, 0, 0], t, groups); name = fileName(t) + ".3mf";
      }
      let pdf = null;
      if (st.fmt === "3mf") { say("Exporting… (and drawing the assembly instructions)"); pdf = await instructions(); }
      else if (st.out !== "pieces") { bytes = stlFile(asParts(parts), 1, [0, 0, 0]); name = fileName(t) + ".stl"; }
      else {
        // one STL per piece (each piece's parts together), plus how to put it together
        const groups = new Map(); for (const p of parts) { const k = p.piece || p.name; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
        const files = [], used = new Set();
        for (const [k, L] of groups) {
          let n = fileName(pieceName(k, L)); while (used.has(n)) n += "_"; used.add(n);
          files.push({ name: n + ".stl", data: stlFile(asParts(L), 1, [0, 0, 0]) });
        }
        files.push({ name: "How to put it together.txt", data: new TextEncoder().encode(assembly(groups)) });
        say("Exporting… (and drawing the assembly instructions)");
        files.push({ name: "Assembly instructions.pdf", data: await instructions() });
        bytes = new Uint8Array(await makeZip(files).arrayBuffer()); name = fileName(t) + ` (${groups.size} STL files).zip`;
      }
      st.lastExport = { fmt: st.fmt, out: st.out, name, size: bytes.length, parts: parts.length };
      if (app.projects && app.projects.saveModel) await app.projects.saveModel(name, bytes);
      const pdfName = fileName(t) + " - assembly instructions.pdf";
      if (pdf && app.projects && app.projects.saveModel) await app.projects.saveModel(pdfName, pdf);
      st.lastExport.pdf = pdf ? pdf.length : 0;
      app.onExport && app.onExport(st.fmt);
      say(`Saved ${name}${pdf ? " and " + pdfName : st.out === "pieces" && st.fmt === "stl" ? " (with the assembly instructions as a PDF inside)" : ""}.`);
    } catch (e) { console.error(e); say("Couldn't export: " + (e.message || e)); }
  }
  // a readable name for a piece: "Rose 2 head", "Stand", "Stem holder"
  function pieceName(k, L) {
    if (k === "assembly") return title().replace(/ \(.*\)$/, "") + " (without its snap-in petals)";
    if (k === "ring") return "Wreath ring";
    if (k === "holder") return "Stem holder";
    if (k === "handle") return "Basket handle";
    if (/^t\d*:trunk$/.test(k)) return L[0].name + (st.tree.grove ? " " + (+k.slice(1).split(":")[0] + 1) : "") + " (with its base)";
    if (/^t\d*:layer\d+$/.test(k)) return L[0].name + (st.tree.grove ? ` (tree ${+k.slice(1).split(":")[0] + 1})` : "");
    const ml = /^f(\d*):layer(\d+)$/.exec(k);
    if (ml) return L[0].name.replace(/^(.*?) ((petals|centre|layer).*)$/, (x, a, b) => `${a}${ml[1] ? " " + (+ml[1] + 1) : ""} ${b}`) + (/centre/.test(L[0].name) ? "" : "");
    const m = /^f(\d*):(stem|head|petal(\d+))$/.exec(k);
    if (!m) return L[0].name;
    const fl = L[0].name.replace(/ (stem|leaves|petals|centre|centres|flowers|hub and pins|calyx and socket|petal \d+)$/, "");
    return `${fl}${m[1] ? " " + (+m[1] + 1) : ""} ${m[3] ? "petal " + m[3] : m[2]}`;
  }
  function assembly(groups) {
    const lines = [title(), "", "Pieces:"];
    for (const [k, L] of groups) lines.push(" - " + pieceName(k, L));
    if (st.tab === "tree") lines.push("", "Putting it together:",
      " - Every piece prints with no supports: the trunk stands on its base, the foliage layers lie flat.",
      " - Stand the trunk up. Each branch ends in a short neck with a collar under it and a lip on top.",
      " - Slide each foliage layer sideways onto a neck through its slit (the slit is a little narrower than the neck, so it clicks over), then let it drop onto the collar. Do the biggest layer on each neck first; on a conifer, start at the bottom tier.",
      " - A drop of glue makes a layer permanent for gaming pieces that get handled a lot.",
      "", "Created with Vibe Coding Assistance (JumpStart 3D Flower Studio).");
    if (st.tab === "tree") return lines.join("\n");
    lines.push("", "Putting it together:",
      ` - Every piece prints lying on a flat side, with no supports. The joints are snap forks: two springy prongs with barbs that squeeze through a slot (${KIT.holeFit} mm fit) and click open behind it.`,
      " - Set the stand down with its slots up (or drop the holder into the container: its skirt stands on the container's floor).",
      " - Push each stem's bottom fork down through a slot until it clicks. The leaves are part of the stem.",
      " - Push each flower head (its flat star underneath) down onto the fork at the top of its stem until it clicks.",
      " - Petal layers: slide each one sideways onto the head's neck through its slit, biggest first, then the centre on top. The lip at the top of the neck holds them.",
      " - Basket: push the handle's two forks into the slots in the top rim.",
      " - To take a fork out again, pinch its two prongs together and pull. A drop of glue makes a joint permanent.",
      " - Hinged petals: print them open, then move each one gently once the print has cooled.",
      ` - Snap-in petals print flat. Push each petal's tab straight into its slot in the flower's crown (any slot of that flower) until it clicks: the slot is ${SNAP.fit} mm bigger all round than the tab, and the tab's two prongs squeeze together, then spring open behind the panel. To take a petal out, pinch the prongs together from inside.`,
      " - Wreath: the stems' pegs push into the sockets in the ring. Hang it by the loop at the top.",
      "", "Created with Vibe Coding Assistance (JumpStart 3D Flower Studio).");
    return lines.join("\n");
  }
  // ---------------- assembly instructions (PDF): a cover with the finished design and what you'll need,
  // how to print it (the plate, with tips), then each step with a picture of it so far
  async function instructions() {
    const o = { ...opts(), bloom: st.bloom, printOpen: 1 }, pieces = st.out === "pieces", t = title().replace(/ \(pieces\)$/, "");
    const all = makeParts(o, false, true).filter((p) => p.mesh.I.length), laid = printParts();
    const role = (p) => (p.snapPetal ? "petal" : p.kitLayer ? "layer" : p.piece === "handle" ? "handle" : /^(stand|holder|ring|container)$/.test(p.piece || "") || /:trunk$/.test(p.piece || "") ? "base" : /:stem$/.test(p.piece || "") ? "stem" : /:head$/.test(p.piece || "") ? "head" : pieces ? "base" : "whole");
    const tree = st.tab === "tree";
    const has = (r) => all.some((p) => role(p) === r);
    const pic = (L, opt) => picture(L, opt);
    const nPieces = new Set(laid.map((p) => p.piece || p.name)).size, nSnap = all.filter((p) => p.snapPetal).length;
    const hinged = all.reduce((s2, p) => s2 + (p.head ? p.head.petals.filter((q) => q.hinged).length : 0), 0);
    // the plate it needs
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const p of laid) for (let i = 0; i < p.mesh.V.length; i += 3) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], p.mesh.V[i + d]); hi[d] = Math.max(hi[d], p.mesh.V[i + d]); }
    const plate = hi.map((v, d) => Math.ceil(v - lo[d]));
    const cols = [], seenC = new Set(); for (const p of all) { const c = p.color.toLowerCase(); if (!seenC.has(c)) { seenC.add(c); cols.push([c, p.name.replace(/ \d+$/, "")]); } }
    const pages = [];
    // 1. cover
    pages.push({ title: t, image: await pic(all), imageH: 330, blocks: [
      { p: `${tree ? (st.tree.grove ? "A grove of miniature trees" : "A miniature tree") : st.tab === "one" ? "One flower" : st.wreath ? "A wreath" : "A flower arrangement"}, ${st.style === "mech" ? "mechanical style" : "lifelike"}, ${pieces ? `printed in ${nPieces} pieces that snap together, with no supports` : nSnap ? `printed in one piece, with ${nSnap} snap-in petals printed flat beside it` : "printed in one piece"}.` },
      { h: "You'll need" },
      { li: `A 3D printer with a bed of at least ${plate[0]} x ${plate[1]} mm and ${plate[2]} mm of height (all the pieces on one plate; you can also split them over several plates in your slicer).` },
      { li: `Filament in ${cols.length} colour${cols.length > 1 ? "s" : ""} (or paint a single colour afterwards):` },
      { swatches: cols.slice(0, 12) },
      ...(pieces || nSnap ? [{ li: "Optional: a little glue, to make a joint permanent; fine sandpaper, in case a fit is tight on your printer." }] : []),
      { h: "How the parts fit" },
      ...(pieces && !tree ? [{ li: `Snap forks: two springy prongs with barbs push through a slot (${KIT.holeFit} mm fit all round) and click open behind it. Pinch the prongs to take one out.` }, { li: "Petal layers have a hole and a slit: they slide sideways onto a neck and the lip on top holds them." }] : []),
      ...(pieces && tree ? [{ li: "Foliage layers have a hole and a slit: each slides sideways onto a neck, drops onto the collar under it, and the lip on top holds it." }] : []),
      ...(nSnap ? [{ li: `Snap-in petals: each tab goes into a slot ${SNAP.fit} mm bigger all round; its two prongs squeeze together and click open behind the slot.` }] : []),
      ...(hinged ? [{ li: `${hinged} hinged petals print already on their pins, with a 0.4 mm gap all round, so they swing.` }] : []),
      ...(!pieces && !nSnap && !hinged ? [{ li: "Everything prints joined together: there's nothing to put together afterwards." }] : []),
    ] });
    // 2. printing
    pages.push({ title: "Print it", image: await pic(laid, { el: 1.0, az: -1.2 }), imageH: 300, blocks: [
      { p: `The plate: ${nPieces} piece${nPieces > 1 ? "s" : ""}${pieces || nSnap ? ", each lying the way it prints best" : ""}. Open the 3MF in your slicer (Bambu Studio, Orca Slicer, PrusaSlicer and others): each piece comes in as one object, its parts already in their colours.` },
      { h: "Settings" },
      { li: "0.2 mm layers, 15% infill, 2-3 walls are fine. PLA or PETG." },
      { li: `Supports: ${pieces ? "none needed: every piece has a flat side on the plate and nothing overhangs more than 45 degrees (short bridges over slots print fine). " : nSnap ? "the flower needs tree supports where petals lean out; the flat snap-in petals don't. " : tree ? "turn on tree supports: the foliage leans out. " : "turn on tree supports: petals and leaves lean out. "}${pieces ? "" : "Keep supports out of slots and hinge gaps (use the slicer's support blocker there)."}` },
      ...(nSnap ? [{ li: "Snap-in petals lie flat on the plate: no supports, and they come out smooth." }] : []),
      ...(st.petals === "flex" ? [{ li: "Flexible petals bend on a thin strip: print in PETG (or TPU) so they don't snap." }] : []),
      ...(hinged ? [{ li: "Hinged petals: don't let supports fill the 0.4 mm gaps round the pins. Once the print is cool, move each petal gently until it swings freely." }] : []),
      { li: "Tip: try the 3D Print Sim in JumpStart 3D first to see the time, filament and where supports go." },
    ] });
    // 3. the steps, each with a picture of the design so far
    const steps = [];
    const upTo = (rs) => all.filter((p) => rs.includes(role(p)));
    if (pieces) {
      const baseOnly = all.filter((p) => role(p) === "base");
      if (tree) steps.push({ title: st.tree.grove ? "Stand up the trunks" : "Stand up the trunk", parts: baseOnly, text: ["Stand each trunk on its base. Every branch ends in a short neck, with a collar underneath and a lip on top."] });
      else if (st.tab === "arr" && !st.wreath && baseOnly.some((p) => p.piece === "holder") && baseOnly.some((p) => p.piece === "container")) steps.push({ title: "Put the holder in", parts: baseOnly, text: ["Drop the stem holder into the container: its foot stands on the container's floor, sockets facing up."] });
      else if (baseOnly.length) steps.push({ title: st.wreath ? "The wreath ring" : "The stand", parts: baseOnly, text: [st.wreath ? "Lay the ring flat, sockets up. The loop at the top is for hanging it." : "Set the stand down, socket up."] });
      if (has("stem")) steps.push({ title: "Snap in the stems", parts: upTo(["base", "stem"]), text: [`Push each stem's bottom fork down through ${st.tab === "one" ? "the slot" : "its slot"} in the ${st.wreath ? "ring" : st.tab === "one" ? "stand" : "holder"} until the barbs click out underneath. ${st.tab === "one" ? "" : "Each slot is made for one stem's lean: the picture shows which goes where. "}The leaves are part of the stem.`, "If a fork is tight, squeeze its prongs together as you push. To take it out, pinch the prongs and pull."] });
      if (has("head")) steps.push({ title: "Snap on the flower heads", parts: upTo(["base", "stem", "head"]), text: ["Push each flower head down onto the fork at the top of its stem: the fork goes into the slot in the head's flat star and clicks."] });
      if (has("layer")) steps.push({ title: tree ? "Snap on the foliage" : "Slide on the petal layers", parts: upTo(["base", "stem", "head", "layer"]), text: tree ? ["Slide each foliage layer sideways onto a neck through its slit: it clicks over the neck, then drops onto the collar. Put the biggest layer on each neck first; on a conifer, start with the bottom tier.", "The lip on top of the neck holds the layers on. A drop of glue makes them permanent for pieces that get handled a lot."] : ["Slide each petal layer sideways onto its flower's neck through the slit, biggest first, and let it drop down. The centre goes on last.", "The lip at the top of the neck holds the layers on."] });
      if (has("handle")) steps.push({ title: "Snap on the handle", parts: all.filter((p) => role(p) !== "petal"), text: ["Push the handle's two forks down into the slots in the basket's top rim until they click."] });
    }
    if (nSnap) steps.push({ title: "Snap in the petals", parts: all, text: [`Push each petal's tab straight into a slot in its flower's crown until it clicks (any slot of that flower). The slot is ${SNAP.fit} mm bigger all round than the tab; the tab's two prongs squeeze together going in and spring open behind the panel.`, "To take a petal out again, pinch the prongs together from inside the crown and pull."] });
    if (hinged) steps.push({ title: "Free the hinged petals", parts: all, text: ["After printing, move each hinged petal gently up and down a few times until it swings freely. If one is stuck, check for support material in the gap round its pin."] });
    if (!steps.length) steps.push({ title: "That's it", parts: all, text: ["It prints as one piece: take it off the plate, remove any supports, and it's done."] });
    let n = 0;
    for (const s2 of steps) {
      n++;
      const newest = s2.parts.filter((p) => !(steps[n - 2] && steps[n - 2].parts.includes(p)));
      pages.push({ title: `Step ${n}: ${s2.title}`, image: await pic(s2.parts, { fade: (p) => p.piece === "container" || (n > 1 && newest.length < s2.parts.length && !newest.includes(p)) }), imageH: 360, blocks: s2.text.map((x, i) => ({ n: i + 1, text: x })) });
    }
    pages[pages.length - 1].blocks.push({ h: "Done!" }, { p: tree ? "Ready for the table: paint or flock the base to match your scenery." : st.wreath ? "Hang it up by its loop." : "Enjoy your flowers: they never wilt." });
    return instructionsPDF({ title: t + " - assembly instructions", pages, footer: `${t} - JumpStart 3D Flower Studio - Created with Vibe Coding Assistance` });
  }
  async function savePDF() {
    try { say("Drawing the assembly instructions…"); const b = await instructions(), nm = fileName(title()) + " - assembly instructions.pdf"; st.lastPDF = b.length; if (app.projects && app.projects.saveModel) await app.projects.saveModel(nm, b); say(`Saved ${nm}.`); }
    catch (e) { console.error(e); say("Couldn't make the instructions: " + (e.message || e)); }
  }
  function toSim() {
    const parts = printParts();
    if (!app.advanced || !app.advanced.openPrintSimWith) { say("The 3D Print Sim isn't ready yet: try again in a moment."); return; }
    const colors = [...new Set(parts.map((p) => p.color.toLowerCase()))];
    const list = parts.map((p) => ({ name: p.name, color: p.color, slot: colors.indexOf(p.color.toLowerCase()), V: Float32Array.from(p.mesh.V), I: Uint32Array.from(p.mesh.I) }));
    const name = title();
    close();
    app.advanced.openPrintSimWith(list, { slots: colors.map((c, i) => ({ color: c, name: "Colour " + (i + 1) })), name });
  }
  draw(); rebuild(true);
  return { close, state: st, exportIt, toSim, printParts, instructions };
}
