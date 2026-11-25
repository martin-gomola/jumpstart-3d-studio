// Version 2.9.9.9.1: the tree maker (in Flower Studio): miniature trees for model scenery and tabletop
// games, lifelike or mechanical, through the seasons, at a choice of scales, on miniature bases; one
// tree or a grove. Made whole (one print) or as a snap-together kit that prints with no supports:
//  - the trunk stands on its base; its branches lean no more than 45 degrees and end in short upright
//    necks with a lip; foliage is flat "cushions" (cloud-shaped layers) with a slot and a hole that
//    snap sideways onto a neck, like Flower Studio's petal layers
//  - conifers and cypresses: tiers / layers that snap onto the trunk, each sitting on its own collar
//  - palms: a flat crown of fronds that snaps onto the top
import * as THREE from "three";
import { GEO, KIT } from "./flowers.js";
import { flatSolid, lobe, circle, rect } from "./flat2d.js";
const { mk, put, tube, lathe, outward, ellipsoid, cyl, rng } = GEO;
const deg = Math.PI / 180;

// ------------------------------------------------------------------ species
const G = { leaf: "#4f8a3a", dark: "#2f5e2c", pine: "#2c5a3a", lime: "#8ab84a", olive: "#6b7d3a", bark: "#6b4a32", grey: "#8a8580", white: "#e9e4dc", pink: "#f4b6cc", red: "#c8402a", orange: "#e0802a", yellow: "#e8c23a", snow: "#f4f6f8", fruitR: "#c82a2a", fruitO: "#f08a1a", crystal: "#7fd6e8", purple: "#8a5ab8", sand: "#c2a878" };
export const TREE_CATS = ["Broadleaf", "Conifers", "Fruit & blossom", "Palms & tropical", "Shrubs & hedges", "Fantasy & spooky"];
// crown: clumps (round tufts at the branch tips), tiers (cone layers up the trunk), column, fronds, drape (willow), none
export const TREES = [
  { id: "oak", name: "Oak", cat: "Broadleaf", real: 20, trunkR: 0.06, split: 0.35, crown: "clumps", n1: 6, a: [35, 70], len: 0.5, n2: 2, clump: 0.17, wide: 1.2, leaf: G.leaf, autumn: [G.orange, G.bark, G.yellow], bark: G.bark },
  { id: "maple", name: "Maple", cat: "Broadleaf", real: 15, trunkR: 0.045, split: 0.3, crown: "clumps", n1: 5, a: [30, 55], len: 0.45, n2: 2, clump: 0.16, leaf: G.leaf, autumn: [G.red, G.orange, G.red], bark: "#7a5a44" },
  { id: "birch", name: "Birch", cat: "Broadleaf", real: 18, trunkR: 0.03, split: 0.4, crown: "clumps", n1: 6, a: [20, 40], len: 0.35, n2: 1, clump: 0.1, slim: true, leaf: G.lime, autumn: [G.yellow, G.yellow, G.orange], bark: G.white },
  { id: "beech", name: "Beech", cat: "Broadleaf", real: 25, trunkR: 0.05, split: 0.3, crown: "clumps", n1: 6, a: [30, 60], len: 0.45, n2: 2, clump: 0.15, leaf: "#5a9a3a", autumn: [G.orange, "#a8602a", G.yellow], bark: G.grey },
  { id: "elm", name: "Elm", cat: "Broadleaf", real: 25, trunkR: 0.045, split: 0.45, crown: "clumps", n1: 5, a: [15, 35], len: 0.5, n2: 2, clump: 0.14, vase: true, leaf: G.leaf, autumn: [G.yellow, G.yellow, G.orange], bark: G.bark },
  { id: "willow", name: "Weeping willow", cat: "Broadleaf", real: 12, trunkR: 0.06, split: 0.4, crown: "drape", n1: 6, a: [40, 65], len: 0.4, n2: 1, clump: 0.12, leaf: G.lime, autumn: [G.yellow, G.lime, G.yellow], bark: G.bark },
  { id: "baobab", name: "Baobab", cat: "Broadleaf", real: 20, trunkR: 0.17, split: 0.6, crown: "clumps", n1: 7, a: [40, 70], len: 0.3, n2: 1, clump: 0.08, leaf: G.olive, autumn: [G.olive, G.yellow, G.olive], bark: "#9a8070" },
  { id: "pine", name: "Pine", cat: "Conifers", real: 25, trunkR: 0.035, split: 0.5, crown: "tiers", tiers: 5, tierR: 0.22, ever: true, leaf: G.pine, bark: "#7a4a2a" },
  { id: "spruce", name: "Spruce", cat: "Conifers", real: 30, trunkR: 0.035, split: 0.12, crown: "tiers", tiers: 8, tierR: 0.3, ever: true, leaf: G.dark, bark: G.bark },
  { id: "fir", name: "Fir", cat: "Conifers", real: 30, trunkR: 0.03, split: 0.15, crown: "tiers", tiers: 9, tierR: 0.22, ever: true, leaf: "#2f6a4a", bark: G.grey },
  { id: "cedar", name: "Cedar", cat: "Conifers", real: 25, trunkR: 0.05, split: 0.3, crown: "tiers", tiers: 4, tierR: 0.38, flat: true, ever: true, leaf: "#3a6a4a", bark: G.bark },
  { id: "cypress", name: "Cypress", cat: "Conifers", real: 20, trunkR: 0.03, split: 0.1, crown: "column", ever: true, colR: 0.14, leaf: G.dark, bark: G.bark },
  { id: "cherry", name: "Cherry blossom", cat: "Fruit & blossom", real: 8, trunkR: 0.05, split: 0.35, crown: "clumps", n1: 5, a: [40, 70], len: 0.5, n2: 2, clump: 0.14, wide: 1.3, blossom: G.pink, leaf: G.leaf, autumn: [G.red, G.orange, G.red], bark: "#5a3a3a" },
  { id: "apple", name: "Apple", cat: "Fruit & blossom", real: 6, trunkR: 0.05, split: 0.35, crown: "clumps", n1: 5, a: [40, 65], len: 0.45, n2: 2, clump: 0.15, blossom: G.white, fruit: G.fruitR, leaf: G.leaf, autumn: [G.yellow, G.leaf, G.orange], bark: G.bark },
  { id: "orange", name: "Orange tree", cat: "Fruit & blossom", real: 6, trunkR: 0.05, split: 0.3, crown: "clumps", n1: 4, a: [30, 55], len: 0.35, n2: 1, clump: 0.2, ever: true, fruit: G.fruitO, leaf: G.dark, bark: G.bark },
  { id: "palm", name: "Palm", cat: "Palms & tropical", real: 15, trunkR: 0.035, split: 0.92, crown: "fronds", fronds: 9, ever: true, curve: true, leaf: "#3a8a3a", bark: "#a08060" },
  { id: "bush", name: "Round bush", cat: "Shrubs & hedges", real: 2, trunkR: 0.08, split: 0.15, crown: "clumps", n1: 5, a: [35, 70], len: 0.3, n2: 1, clump: 0.3, wide: 1.4, leaf: G.leaf, autumn: [G.orange, G.red, G.yellow], bark: G.bark },
  { id: "topiary", name: "Topiary ball", cat: "Shrubs & hedges", real: 2, trunkR: 0.05, split: 0.55, crown: "ball", ever: true, leaf: G.dark, bark: G.bark },
  { id: "dead", name: "Dead tree", cat: "Fantasy & spooky", real: 12, trunkR: 0.055, split: 0.3, crown: "none", n1: 5, a: [25, 60], len: 0.5, n2: 2, bark: G.grey },
  { id: "spooky", name: "Spooky tree", cat: "Fantasy & spooky", real: 10, trunkR: 0.07, split: 0.25, crown: "none", n1: 6, a: [30, 75], len: 0.55, n2: 2, twist: 1, bark: "#3a3240" },
  { id: "crystal", name: "Crystal tree", cat: "Fantasy & spooky", real: 10, trunkR: 0.05, split: 0.35, crown: "clumps", crystal: true, n1: 5, a: [25, 50], len: 0.45, n2: 1, clump: 0.12, ever: true, leaf: G.crystal, bark: G.purple },
  { id: "mushroom", name: "Giant mushroom", cat: "Fantasy & spooky", real: 4, trunkR: 0.12, split: 0.8, crown: "cap", ever: true, leaf: "#c83a3a", bark: "#efe6d0" },
];
export const treeById = (id) => TREES.find((t) => t.id === id) || TREES[0];
export const SEASONS = [["spring", "Spring"], ["summer", "Summer"], ["autumn", "Autumn"], ["winter", "Winter"]];
export const TREE_BASES = [["none", "No base"], ["r25", "Round 25 mm"], ["r32", "Round 32 mm"], ["r40", "Round 40 mm"], ["r50", "Round 50 mm"], ["r60", "Round 60 mm"], ["s25", "Square 25 mm"], ["s40", "Square 40 mm"], ["h40", "Hex 40 mm"], ["h50", "Hex 50 mm"], ["rock", "Rocky ground 50 mm"]];
// scales for miniatures: the model's height is the real tree's height divided by the scale
export const TREE_SCALES = [["28", "28 mm heroic (1:56)", 56], ["32", "32 mm (1:50)", 50], ["15", "15 mm (1:100)", 100], ["6", "6 mm (1:285)", 285], ["oo", "OO railway (1:76)", 76], ["ho", "HO railway (1:87)", 87], ["n", "N gauge (1:160)", 160], ["free", "Any size", 0]];
// colours for a season
export function treeColors(sp, style, season) {
  const mech = style === "mech";
  const leaf = sp.leaf || G.leaf;
  const bare = season === "winter" && !sp.ever;
  return {
    trunk: mech ? "#8a9098" : sp.bark,
    leaf: mech ? (season === "autumn" && !sp.ever ? "#c8783a" : "#5aa08a") : season === "autumn" && sp.autumn ? sp.autumn[0] : season === "spring" && !sp.ever ? (sp.blossom ? sp.blossom : "#7ab84a") : leaf,
    leaf2: season === "autumn" && sp.autumn ? sp.autumn[1] : season === "spring" && sp.blossom ? G.lime : leaf,
    accent: sp.fruit && (season === "summer" || season === "autumn") ? sp.fruit : sp.blossom && season === "spring" ? G.white : G.snow,
    base: mech ? "#5a5f66" : "#7a6a52",
    bare,
  };
}

// ------------------------------------------------------------------ the tree's skeleton
// trunk and branches as paths with radii, and the places foliage goes (tips: position, size, level)
function skeleton(sp, H, o, R) {
  const kit = !!o.joints, maxA = kit ? 45 * deg : 80 * deg;
  const rb = Math.max(1.2, H * sp.trunkR) * (o.style === "mech" ? 1.1 : 1);
  const branches = [], tips = [];
  // the trunk: a gentle S (straight in a kit), a little lean
  const top = H * (sp.crown === "tiers" || sp.crown === "column" || sp.crown === "fronds" ? 0.92 : sp.crown === "cap" || sp.crown === "ball" ? sp.split : 0.82);
  const lean = kit ? 0 : (R() - 0.5) * 0.12 + (sp.curve ? 0.15 : 0), la = R() * 6.28;
  const trunk = [];
  const nT = kit ? 60 : 12; for (let i = 0; i <= nT; i++) { const t = i / nT, wob = kit ? 0 : Math.sin(t * 3 + R()) * rb * 0.25 * (sp.twist ? 3 : 1); trunk.push([Math.cos(la) * lean * t * t * H * 0.5 + wob, Math.sin(la) * lean * t * t * H * 0.5 + wob * 0.6, t * top]); }
  branches.push({ path: trunk, r0: rb, r1: Math.max(0.6, rb * (sp.crown === "cap" || sp.crown === "ball" ? 0.8 : 0.3)), level: 0 });
  const at = (path, t) => { const k = Math.min(path.length - 2, Math.floor(t * (path.length - 1))), f = t * (path.length - 1) - k, p = path[k], q = path[k + 1]; return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f]; };
  if (sp.crown === "clumps" || sp.crown === "drape" || sp.crown === "none") {
    const grow = (parent, level, n, lenK) => {
      for (let i = 0; i < n; i++) {
        const t = sp.split + (1 - sp.split) * (level ? 0.35 + 0.55 * ((i + R() * 0.5) / n) : (i + 0.5) / n) * (level ? 1 : 0.92);
        const p = at(parent.path, Math.min(0.97, t)), az = i * 2.39996 + R() * 0.8 + level;
        let a = (sp.a[0] + (sp.a[1] - sp.a[0]) * R()) * deg; if (sp.vase) a *= 0.8; a = Math.min(a, maxA);
        const L = H * sp.len * lenK * (1 - 0.45 * (t - sp.split) / (1 - sp.split + 1e-6)) * (sp.wide || 1) * (0.8 + R() * 0.3);
        const d = [Math.sin(a) * Math.cos(az), Math.sin(a) * Math.sin(az), Math.cos(a)];
        const pts = []; for (let k = 0; k <= 5; k++) { const u = k / 5, sag = kit ? 0 : (sp.twist ? Math.sin(u * 3) * 0.12 : 0) * L; pts.push([p[0] + d[0] * L * u + sag, p[1] + d[1] * L * u, p[2] + d[2] * L * u - (kit ? 0 : u * u * L * 0.08)]); }
        const r0 = Math.max(0.5, parent.r0 * 0.55 * (1 - 0.3 * level)), b = { path: pts, r0, r1: Math.max(0.45, r0 * 0.45), level: level + 1 };
        branches.push(b);
        if (level + 1 < (sp.n2 ? 2 : 1) && sp.n2 && !kit) grow(b, level + 1, sp.n2 + (sp.twist ? 1 : 0), 0.5);
        else tips.push({ p: pts[pts.length - 1], size: H * (sp.clump || 0.12) * (level ? 0.8 : 1) * (0.85 + R() * 0.3) * (kit ? 1.5 : 1), r: b.r1, level: level + 1, b });
      }
    };
    grow(branches[0], 0, sp.n1, 1);
    // one at the top of the trunk too
    tips.push({ p: trunk[trunk.length - 1], size: H * (sp.clump || 0.12) * 1.1 * (kit ? 1.3 : 1), r: branches[0].r1, level: 0, b: branches[0] });
  }
  return { branches, tips, trunk, top, rb };
}

// ------------------------------------------------------------------ bases
function baseMesh(kind, o, minR = 0) {
  if (!kind || kind === "none") return null;
  const t = 3, m = mk(), R = rng(7);
  const n = kind[0] === "s" ? 4 : kind[0] === "h" ? 6 : 64, r = Math.max(minR, (parseInt(kind.slice(1), 10) || 50) / 2);
  // (the top edge chamfered 45 degrees: neat, and nothing overhangs)
  const rr = n === 4 ? r * Math.SQRT2 : n === 6 ? r / Math.cos(Math.PI / 6) : r;
  const b = lathe([[1e-4, 0], [rr, 0], [rr, t - 1], [rr - 1, t], [1e-4, t]], n);
  if (n === 4) for (let i = 0; i < b.V.length; i += 3) { const x = b.V[i], y = b.V[i + 1]; b.V[i] = (x - y) * Math.SQRT1_2; b.V[i + 1] = (x + y) * Math.SQRT1_2; }
  put(m, outward(b));
  if (kind === "rock") for (let i = 0; i < 9; i++) { const a = R() * 6.28, d = r * (0.45 + R() * 0.4), s = 2 + R() * 3; put(m, outward(lathe([[1e-4, t - 0.5], [s, t - 0.5], [s * 0.4, t + s * 0.9], [1e-4, t + s * 0.9]], 5)), new THREE.Matrix4().makeTranslation(Math.cos(a) * d, Math.sin(a) * d, 0)); }
  return { mesh: m, top: t };
}

// ------------------------------------------------------------------ whole trees
// a lumpy tuft of leaves (lifelike) or a faceted cluster (mechanical)
function clump(c, size, o, R, crystal) {
  const m = mk(), mech = o.style === "mech";
  const k = crystal ? 4 : mech ? 2 : 4;
  for (let i = 0; i < k; i++) {
    const s = size * (i ? 0.62 + R() * 0.2 : 0.75), a = R() * 6.28, d = i ? size * 0.45 : 0;
    const ctr = [c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d, c[2] + (i ? (R() - 0.3) * size * 0.4 : 0)];
    if (crystal) { const h = s * 1.6; put(m, outward(lathe([[1e-4, 0], [s * 0.35, h * 0.15], [s * 0.35, h * 0.75], [1e-4, h]], 6)), new THREE.Matrix4().makeTranslation(...ctr).multiply(new THREE.Matrix4().makeRotationX((R() - 0.5) * 1.2))); continue; }
    if (mech) { put(m, outward(lathe([[1e-4, -s * 0.5], [s, -s * 0.15], [s, s * 0.15], [1e-4, s * 0.5]], 8)), new THREE.Matrix4().makeTranslation(...ctr).multiply(new THREE.Matrix4().makeRotationZ(R()))); continue; }
    const ph = R() * 6;
    const prof = []; for (let j = 0; j <= 8; j++) { const b = -Math.PI / 2 + (j / 8) * Math.PI; prof.push([Math.max(1e-4, Math.cos(b) * s), Math.sin(b) * s * 0.8]); }
    put(m, outward(lathe(prof, 14, (aa, j) => 1 + 0.12 * Math.sin(aa * 5 + ph + j) + 0.06 * Math.sin(aa * 11 + j * 2))), new THREE.Matrix4().makeTranslation(...ctr));
  }
  return m;
}
export function buildTree(sp, o, at = [0, 0, 0], seed = 1) {
  if (o.joints) return buildTreeKit(sp, o, at, seed);
  const R = rng(seed), H = o.height || 80, C = o.colors, mech = o.style === "mech", parts = [];
  // (a base at least wide enough for the trunk)
  const minR = Math.max(1.2, H * sp.trunkR) * 1.1 * 1.3 + 3;
  const base = o.noBase ? null : baseMesh(o.base, o, minR), z0 = base ? base.top - 0.6 : 0;
  const T = new THREE.Matrix4().makeTranslation(at[0], at[1], at[2] + z0);
  const sk = skeleton(sp, H, o, R);
  const wood = mk();
  for (const b of sk.branches) put(wood, tube(b.path, (u) => b.r0 + (b.r1 - b.r0) * u, mech ? 6 : 9), T);
  // (mechanical: bolt rings where branches meet the trunk)
  if (mech) for (const b of sk.branches.slice(1)) put(wood, outward(lathe([[b.r0 * 0.8, -0.8], [b.r0 * 1.6, -0.8], [b.r0 * 1.6, 0.8], [b.r0 * 0.8, 0.8]], 6)), T.clone().multiply(new THREE.Matrix4().makeTranslation(...b.path[0])));
  const leaves = mk(), leaves2 = mk(), accent = mk();
  const bare = C.bare && sp.crown !== "tiers" && sp.crown !== "column";
  if (!bare) {
    if (sp.crown === "clumps" || sp.crown === "drape") sk.tips.forEach((tp, i) => {
      put(i % 3 === 2 ? leaves2 : leaves, clump(tp.p, tp.size, o, R, sp.crystal), T);
      // fruit, blossom or snow
      if (C.accent && (sp.fruit || sp.blossom || o.season === "winter")) { const nA = o.season === "winter" ? 1 : 3; for (let k = 0; k < nA; k++) { const a = R() * 6.28, el = o.season === "winter" ? Math.PI / 2 : (R() * 0.8 - 0.2), rr = tp.size * 0.85; const pp = [tp.p[0] + Math.cos(a) * Math.cos(el) * rr, tp.p[1] + Math.sin(a) * Math.cos(el) * rr, tp.p[2] + Math.sin(el) * rr * 0.8]; put(accent, o.season === "winter" ? ellipsoid(tp.size * 0.7, tp.size * 0.7, tp.size * 0.22, 10) : ellipsoid(Math.max(0.8, H * 0.012), Math.max(0.8, H * 0.012), Math.max(0.8, H * 0.012), 8), T.clone().multiply(new THREE.Matrix4().makeTranslation(...pp))); } }
      if (sp.crown === "drape") for (let k = 0; k < 5; k++) { const a = k * 1.256 + R(), r0 = tp.size * 0.7, p0 = [tp.p[0] + Math.cos(a) * r0, tp.p[1] + Math.sin(a) * r0, tp.p[2]], L = H * 0.35 * (0.7 + R() * 0.5); put(leaves, tube([p0, [p0[0] + Math.cos(a) * 2, p0[1] + Math.sin(a) * 2, p0[2] - L * 0.5], [p0[0] + Math.cos(a) * 3, p0[1] + Math.sin(a) * 3, Math.max(H * 0.15, p0[2] - L)]], (u) => Math.max(0.5, 1.4 - u), 5), T); }
    });
    if (sp.crown === "tiers") {
      const n = sp.tiers, zs = H * sp.split, zt = H * 0.98;
      for (let i = 0; i < n; i++) {
        const f = i / Math.max(1, n - 1), z = zs + (zt - zs) * f * 0.92, Rr = H * sp.tierR * (1 - 0.85 * f) * (sp.flat ? 1.1 : 1), h = sp.flat ? Rr * 0.25 : Rr * 0.75;
        const prof = [[1e-4, z + h], [Rr * 0.25, z + h * 0.7], [Rr, z], [Rr * 0.85, z - 1.2], [1e-4, z - 1.2]];
        put(i % 2 ? leaves2 : leaves, outward(lathe(prof, mech ? 8 : 18, (a, k) => (k >= 2 && k <= 3 ? 1 + (mech ? 0 : 0.12 * Math.sin(a * 9)) : 1))), T);
        if (o.season === "winter") put(accent, outward(lathe([[1e-4, z + h + 0.5], [Rr * 0.22, z + h * 0.72 + 0.5], [Rr * 0.7, z + h * 0.25 + 0.4], [Rr * 0.6, z + h * 0.25 - 0.3], [1e-4, z + h * 0.5]], 14)), T);
      }
    }
    if (sp.crown === "column") { const h = H * 0.85, prof = []; for (let j = 0; j <= 10; j++) { const t = j / 10; prof.push([Math.max(1e-4, H * sp.colR * Math.sin(Math.PI * Math.pow(t, 0.8))), H * 0.12 + h * t]); } put(leaves, outward(lathe(prof, mech ? 8 : 16, (a, k) => 1 + (mech ? 0 : 0.08 * Math.sin(a * 7 + k)))), T); }
    if (sp.crown === "fronds") { const tp = sk.trunk[sk.trunk.length - 1]; for (let i = 0; i < sp.fronds; i++) { const a = (i / sp.fronds) * 6.28, L = H * 0.35, pts = []; for (let k = 0; k <= 6; k++) { const u = k / 6; pts.push([tp[0] + Math.cos(a) * L * u, tp[1] + Math.sin(a) * L * u, tp[2] + L * 0.25 * Math.sin(u * 2.2) - L * 0.35 * u * u]); } put(leaves, tube(pts, (u) => Math.max(0.5, H * 0.03 * Math.sin(Math.PI * Math.min(0.95, u + 0.08))), 4), T); } }
    if (sp.crown === "ball") put(leaves, clump(sk.trunk[sk.trunk.length - 1].map((v, i) => (i === 2 ? v + H * 0.2 : v)), H * 0.25, o, R), T);
    if (sp.crown === "cap") { const tp = sk.trunk[sk.trunk.length - 1], Rc = H * 0.35; put(leaves, outward(lathe([[1e-4, tp[2] + Rc * 0.55], [Rc * 0.6, tp[2] + Rc * 0.45], [Rc, tp[2] + Rc * 0.05], [Rc * 0.9, tp[2] - Rc * 0.05], [1e-4, tp[2]]], 24)), T); for (let k = 0; k < 7; k++) { const a = R() * 6.28, d = Rc * (0.2 + R() * 0.55); put(accent, ellipsoid(Rc * 0.1, Rc * 0.1, Rc * 0.04, 8), T.clone().multiply(new THREE.Matrix4().makeTranslation(tp[0] + Math.cos(a) * d, tp[1] + Math.sin(a) * d, tp[2] + Rc * 0.55 * (1 - Math.pow(d / Rc, 2)) + 0.2))); } }
  }
  if (base) parts.push({ name: "Base", color: C.base, mesh: put(mk(), base.mesh, new THREE.Matrix4().makeTranslation(...at)) });
  parts.push({ name: sp.name + " trunk", color: C.trunk, mesh: wood });
  if (leaves.I.length) parts.push({ name: sp.name + " leaves", color: C.leaf, mesh: leaves });
  if (leaves2.I.length) parts.push({ name: sp.name + " leaves 2", color: C.leaf2, mesh: leaves2 });
  if (accent.I.length) parts.push({ name: sp.name + (o.season === "winter" ? " snow" : sp.fruit && o.season !== "spring" ? " fruit" : sp.crown === "cap" ? " spots" : " blossom"), color: o.season === "winter" ? G.snow : sp.crown === "cap" ? G.white : C.accent, mesh: accent });
  return parts;
}

// ------------------------------------------------------------------ tree kits
// a flat foliage layer: a cloud (lifelike), a gear (mechanical), a star of needles (conifer) or of
// fronds (palm), with a hole for the neck and a slit to snap it on
function foliageLayer(kind, Rr, o, R, rh, phi0 = null) {
  const mech = o.style === "mech", sh = [];
  if (kind === "star" || kind === "fronds") {
    const n = kind === "fronds" ? 9 : mech ? 8 : 10;
    sh.push(circle(0, 0, Math.max(rh + 2.6, Rr * (kind === "fronds" ? 0.15 : 0.35))));
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + R() * 0.2, L = Rr * (0.85 + R() * 0.15) - rh; sh.push(lobe(Math.cos(a) * rh, Math.sin(a) * rh, a, L, (u) => Math.max(0.8, (kind === "fronds" ? Rr * 0.12 : Rr * 0.22) * Math.sin(Math.PI * Math.min(0.97, 0.15 + u * 0.85)) * (1 - u * 0.4)), mech ? 5 : 16)); }
  } else if (mech) {
    const P = []; for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2, r = i % 8 < 4 ? Rr : Rr * 0.86; P.push([r * Math.cos(a), r * Math.sin(a)]); }
    sh.push({ poly: P });
  } else {
    // a cloud: overlapping round lobes
    sh.push(circle(0, 0, Rr * 0.7));
    const n = 7; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + R() * 0.5; sh.push(circle(Math.cos(a) * Rr * 0.55, Math.sin(a) * Rr * 0.55, Rr * (0.38 + R() * 0.1))); }
  }
  sh.push({ circle: [0, 0], r: rh, cut: true });
  const w = KIT.slitW / 2 * Math.min(1, (rh - KIT.holeFit) / KIT.neckR), phi = phi0 == null ? R() * 6.28 : phi0, c = Math.cos(phi), s = Math.sin(phi);
  sh.push({ poly: [[0, -w], [Rr + 3, -w], [Rr + 3, w], [0, w]].map(([x, y]) => [c * x - s * y, s * x + c * y]), cut: true });
  return sh;
}
// a neck for foliage layers: a collar (45 degrees under it) to sit on, the neck, a lip at the top
// (lift: how far above p the collar's top is, clear of the branch's end)
function neck(m, p, rn, hLayers, M, lift = 0) {
  const z = p[2] + lift, rc = rn + 1.6, zl = z + hLayers + 0.6;
  put(m, outward(lathe([[1e-4, p[2] - 1.6], [rn, p[2] - 1.6], [rn, z - 1.9], [rc, z - 0.3], [rc, z], [rn, z], [rn, zl], [rn + 0.6, zl + 0.6], [rn + 0.6, zl + 1.1], [1e-4, zl + 1.1]], 20)), M.clone().multiply(new THREE.Matrix4().makeTranslation(p[0], p[1], 0)));
  return z;
}
const NECK_TOP = (hLayers) => hLayers + 0.6 + 1.1;
function buildTreeKit(sp, o, at, seed) {
  const R = rng(seed), H = o.height || 80, C = o.colors, mech = o.style === "mech", parts = [], pid = o.pieceId || "t";
  const minR = Math.max(1.2, H * sp.trunkR) * 1.1 * 1.3 + 3;
  const base = o.noBase ? null : baseMesh(o.base && o.base !== "none" ? o.base : "r25", o, minR), z0 = base ? base.top - 0.6 : 0;
  const T = new THREE.Matrix4().makeTranslation(at[0], at[1], at[2] + z0);
  const sk = skeleton(sp, H, o, R);
  // (necks: as thick as small miniatures allow)
  const rn = Math.max(1.4, Math.min(KIT.neckR, H * 0.02)), rh = rn + KIT.holeFit, tL = Math.max(1.6, Math.min(3, H * 0.03)), gap = 0.15;
  const trunk = mk();
  if (base) put(trunk, base.mesh, new THREE.Matrix4().makeTranslation(0, 0, -z0));
  // (tiers and columns: the trunk narrows to the neck size where the layers start, so each layer's
  // hole fits over it and rests on its own collar)
  const stacked = sp.crown === "tiers" || sp.crown === "column", uS = stacked ? Math.max(0.05, (H * (sp.split || 0.15) - 2) / sk.top) : 2;
  for (const b of sk.branches) put(trunk, tube(b.path, b.level === 0 && stacked ? (u) => (u < uS * 0.7 ? b.r0 : u < uS ? b.r0 + (rn - b.r0) * (u - uS * 0.7) / (uS * 0.3) : rn) : (u) => Math.max(rn + 0.2, b.r0 + (b.r1 - b.r0) * u), mech ? 6 : 10));
  const layers = []; // { mesh (at its own origin), at: [x, y, z], color, name }
  const bare = C.bare && sp.crown !== "tiers" && sp.crown !== "column";
  const addStack = (p, radii, kind, colors) => {
    const zb = neck(trunk, p, rn, radii.length * (tL + gap), new THREE.Matrix4());
    radii.forEach((Rr, k) => layers.push({ mesh: flatSolid(foliageLayer(kind, Rr, o, R, rh), 0, tL), at: [p[0], p[1], zb + k * (tL + gap)], color: colors[k % colors.length], name: kind === "fronds" ? "fronds" : kind === "star" ? "tier " + (layers.length + 1) : "leaves " + (layers.length + 1) }));
  };
  if (!bare) {
    if (sp.crown === "clumps" || sp.crown === "drape" || sp.crown === "ball") {
      // two layers on each branch tip, the top one smaller: a little cloud of leaves
      const tips = sp.crown === "ball" ? [{ p: sk.trunk[sk.trunk.length - 1], size: H * 0.25, r: sk.branches[0].r1, b: sk.branches[0] }] : sk.tips;
      // each cushion kept clear of the other branches and of the other cushions at its height
      // (shrunk where needed; dropped if it would be too small to hold)
      const K = 1.05, st = tips.map((tp) => { const n = tp.size > 8 ? 3 : 2, lift = (tp.r || rn) * 0.75 + 0.4, z0 = tp.p[2] + lift; return { tp, n, lift, z0, z1: z0 + NECK_TOP(n * (tL + gap)), Rr: Math.max(rh + 3, tp.size) }; });
      const pts = []; for (const b of sk.branches) { const n = b.path.length; for (let k = 0; k < n - 1; k++) for (let f = 0; f < 1; f += 0.2) { const p = b.path[k], q = b.path[k + 1], u = (k + f) / (n - 1); pts.push({ b, x: p[0] + (q[0] - p[0]) * f, y: p[1] + (q[1] - p[1]) * f, z: p[2] + (q[2] - p[2]) * f, r: Math.max(rn + 0.2, b.r0 + (b.r1 - b.r0) * u) }); } }
      for (const S of st) for (const q of pts) { if (q.b === S.tp.b) continue; if (q.z + q.r < S.z0 - 0.3 || q.z - q.r > S.z1) continue; const d = Math.hypot(q.x - S.tp.p[0], q.y - S.tp.p[1]) - q.r - 0.8; S.Rr = Math.min(S.Rr, d / K); }
      for (let it = 0; it < 4; it++) for (let a = 0; a < st.length; a++) for (let b = a + 1; b < st.length; b++) {
        const A = st[a], B = st[b]; if (A.z1 < B.z0 - 0.3 || B.z1 < A.z0 - 0.3) continue;
        const d = Math.hypot(A.tp.p[0] - B.tp.p[0], A.tp.p[1] - B.tp.p[1]) - 0.8, need = K * (A.Rr + B.Rr);
        if (need > d) { const f = Math.max(0, d) / need; A.Rr *= f; B.Rr *= f; }
        // (and each clear of the other's neck)
        const rc = rn + 1.6 + 0.8; A.Rr = Math.min(A.Rr, (d + 0.8 - rc) / K); B.Rr = Math.min(B.Rr, (d + 0.8 - rc) / K);
      }
      for (const S of st) {
        if (S.Rr < rh + 3) continue;
        const p = S.tp.p, zb = neck(trunk, p, rn, S.n * (tL + gap), new THREE.Matrix4(), S.lift), phi = Math.atan2(p[1] - sk.trunk[0][1], p[0] - sk.trunk[0][0]);
        [S.Rr, S.Rr * 0.72, S.Rr * 0.45].slice(0, S.n).forEach((Rr, k) => layers.push({ mesh: flatSolid(foliageLayer(sp.crystal ? "star" : "cloud", Math.max(rh + 2.5, Rr), o, R, rh, phi), 0, tL), at: [p[0], p[1], zb + k * (tL + gap)], color: k % 2 ? C.leaf2 : C.leaf, name: "leaves " + (layers.length + 1) }));
      }
    } else if (sp.crown === "tiers" || sp.crown === "column") {
      // up the trunk: each tier (or slice of the column) on its own collar
      // (as many as fit: each needs its collar, its layer and its lip)
      const zs = H * (sp.split || 0.15), zt = sk.top, need = 1.9 + NECK_TOP(tL + gap) + 0.4;
      const n = Math.max(2, Math.min(sp.crown === "tiers" ? sp.tiers : 7, Math.floor(((zt - zs) * 0.92) / need) + 1));
      for (let i = 0; i < n; i++) {
        const f = i / Math.max(1, n - 1), z = zs + (zt - zs) * f * 0.92;
        const Rr = sp.crown === "tiers" ? H * sp.tierR * (1 - 0.8 * f) : H * sp.colR * Math.sin(Math.PI * Math.min(0.95, 0.1 + f * 0.85));
        const p = [sk.trunk[0][0], sk.trunk[0][1], z];
        const zb = neck(trunk, p, rn, tL + gap, new THREE.Matrix4());
        layers.push({ mesh: flatSolid(foliageLayer(sp.crown === "tiers" ? "star" : "cloud", Math.max(rh + 3, Rr), o, R, rh), 0, tL), at: [p[0], p[1], zb], color: i % 2 ? C.leaf2 : C.leaf, name: (sp.crown === "tiers" ? "tier " : "layer ") + (i + 1) });
      }
    } else if (sp.crown === "fronds") addStack(sk.trunk[sk.trunk.length - 1], [H * 0.35, H * 0.25], "fronds", [C.leaf, C.leaf2]);
    else if (sp.crown === "cap") addStack(sk.trunk[sk.trunk.length - 1], [H * 0.35, H * 0.28, H * 0.18], "cloud", [C.leaf, C.leaf, G.white]);
  }
  const TT = new THREE.Matrix4().makeTranslation(at[0], at[1], at[2] + z0);
  parts.push({ name: sp.name + " trunk", color: C.trunk, mesh: put(mk(), trunk, TT), piece: pid + ":trunk", frame: new THREE.Matrix4().makeTranslation(at[0], at[1], at[2]) });
  layers.forEach((L, k) => { const F = TT.clone().multiply(new THREE.Matrix4().makeTranslation(...L.at)); parts.push({ name: `${sp.name} ${L.name}`, color: L.color, mesh: put(mk(), L.mesh, F), piece: `${pid}:layer${k + 1}`, frame: F, kitLayer: true }); });
  return parts;
}

// ------------------------------------------------------------------ groves
// several trees on one base (whole), or each on its own little base (a kit)
export function buildGrove(g, o) {
  const R = rng(g.seed || 1), parts = [], W = Math.max(60, g.size || 120);
  const list = []; for (const it of g.items) for (let k = 0; k < Math.max(0, Math.min(12, it.n | 0)); k++) list.push(it);
  list.sort((a, b) => treeById(b.id).real - treeById(a.id).real);
  // spots spread over the base, biggest first, each kept clear of the others' crowns
  const pos = [], H0 = o.height || 80;
  for (const it of list) {
    const sp = treeById(it.id), h = H0 * Math.min(1.4, Math.max(0.35, sp.real / 15)), rC = Math.max(8, h * Math.max(sp.clump || 0.15, sp.tierR || 0, sp.colR || 0) * 1.6);
    let best = null;
    for (let k = 0; k < 120; k++) { const a = R() * 6.28, d = Math.sqrt(R()) * (W / 2 - 8), p = [Math.cos(a) * d * (g.shape === "oval" ? 1.4 : 1), Math.sin(a) * d * (g.shape === "oval" ? 0.7 : 1)]; const sc = Math.min(...pos.map((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) - q.r - rC), 999); if (!best || sc > best[1]) best = [p, sc]; }
    pos.push({ p: best[0], r: rC, it, h });
  }
  const kit = !!o.joints;
  if (!kit) {
    // one base for all
    const t = 4, m = mk(), sx = g.shape === "oval" ? 1.4 : 1, sy = g.shape === "oval" ? 0.7 : 1;
    const b = outward(lathe([[1e-4, 0], [W / 2, 0], [W / 2, t - 1.2], [W / 2 - 1.2, t], [1e-4, t]], 64)); for (let i = 0; i < b.V.length; i += 3) { b.V[i] *= sx; b.V[i + 1] *= sy; }
    put(m, b);
    if (g.shape === "hill") put(m, outward(lathe([[1e-4, t - 0.5], [W * 0.42, t - 0.5], [W * 0.2, t + W * 0.08], [1e-4, t + W * 0.1]], 32)));
    parts.push({ name: "Grove base", color: o.colors.base, mesh: m });
  }
  pos.forEach((q, i) => {
    const sp = treeById(q.it.id), oo = { ...o, height: q.h, colors: treeColors(sp, o.style, o.season), base: kit ? "r25" : "none", noBase: !kit, pieceId: "t" + i };
    const zTop = !kit && g.shape === "hill" ? Math.max(0, W * 0.1 * (1 - Math.hypot(q.p[0], q.p[1]) / (W * 0.42))) : 0;
    for (const p of buildTree(sp, oo, [q.p[0], q.p[1], kit ? 0 : 3.4 + zTop], 11 + i * 7)) parts.push(p);
  });
  return { parts };
}
